/**
 * Lets the concierge run on any OpenAI-compatible endpoint (Ollama, vLLM,
 * llama.cpp server) without touching the agent.
 *
 * The agent only ever calls `anthropic.messages.create`, so this implements
 * that one method and translates both ways: Anthropic's system prompt, tool
 * schemas and tool_use/tool_result blocks on the way out, OpenAI's tool_calls
 * and finish_reason on the way back.
 *
 * Built for running Salesforce's xLAM action models against the same eval
 * cases the Claude agent runs, so the two are measured on identical work.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { MessagesClient } from "../agent.js";

export interface OpenAICompatOptions {
  /** Base URL including the version path, e.g. http://localhost:11434/v1 */
  baseUrl: string;
  /** Most local servers ignore this, but send something so auth headers exist. */
  apiKey?: string;
  /** Per-request timeout. Small models on CPU are slow; default is generous. */
  timeoutMs?: number;
}

/** What the server sends back. Only the fields the agent needs are typed. */
interface ChatCompletion {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] | null;
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

type OpenAIMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

/** Pulls the text out of any Anthropic content, whatever block types it holds. */
function textFromBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: "text"; text: string } => {
      return Boolean(b) && typeof b === "object" && (b as { type?: unknown }).type === "text";
    })
    .map((b) => b.text)
    .join("\n");
}

/** Tool results arrive as blocks inside a user message; OpenAI wants one message each. */
function toolResultMessages(content: Anthropic.MessageParam["content"]): OpenAIMessage[] {
  if (typeof content === "string") return [];
  return content
    .filter((b): b is Anthropic.ToolResultBlockParam => b.type === "tool_result")
    .map((b) => ({
      role: "tool" as const,
      tool_call_id: b.tool_use_id,
      content: typeof b.content === "string" ? b.content : textFromBlocks(b.content ?? []),
    }));
}

function toOpenAIMessages(system: string, messages: Anthropic.MessageParam[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: "system", content: system }];

  for (const message of messages) {
    if (message.role === "user") {
      const results = toolResultMessages(message.content);
      if (results.length) {
        out.push(...results);
        continue;
      }
      out.push({ role: "user", content: textFromBlocks(message.content) });
      continue;
    }

    // assistant: may carry tool calls alongside its text
    const blocks = typeof message.content === "string" ? [] : message.content;
    const toolUses = blocks.filter((b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use");
    const text = textFromBlocks(message.content);

    if (toolUses.length) {
      out.push({
        role: "assistant",
        content: text,
        tool_calls: toolUses.map((u) => ({
          id: u.id,
          type: "function" as const,
          function: { name: u.name, arguments: JSON.stringify(u.input ?? {}) },
        })),
      });
    } else {
      out.push({ role: "assistant", content: text });
    }
  }

  return out;
}

function toOpenAITools(tools: Anthropic.Tool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? t.name,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Small models sometimes emit arguments that aren't valid JSON. Returning an
 * empty object keeps the agent alive: its own schema validation rejects the
 * call and the model gets an error back, which is exactly what we want to
 * measure rather than crash on.
 */
function parseArguments(raw: string | undefined): { input: Record<string, unknown>; malformed: boolean } {
  if (!raw) return { input: {}, malformed: false };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { input: parsed as Record<string, unknown>, malformed: false };
    }
    return { input: {}, malformed: true };
  } catch {
    return { input: {}, malformed: true };
  }
}

/** Counts of things worth reporting in a benchmark but not worth failing on. */
export interface CompatStats {
  requests: number;
  malformedToolArgs: number;
  missingToolCallIds: number;
}

export interface OpenAICompatClient extends MessagesClient {
  stats: CompatStats;
}

export function createOpenAICompatClient(opts: OpenAICompatOptions): OpenAICompatClient {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const stats: CompatStats = { requests: 0, malformedToolArgs: 0, missingToolCallIds: 0 };
  let generatedId = 0;

  return {
    stats,
    messages: {
      async create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
        const system = typeof params.system === "string" ? params.system : textFromBlocks(params.system ?? []);
        const body = {
          model: params.model,
          max_tokens: params.max_tokens,
          messages: toOpenAIMessages(system, params.messages),
          ...(params.tools?.length ? { tools: toOpenAITools(params.tools as Anthropic.Tool[]), tool_choice: "auto" } : {}),
        };

        stats.requests += 1;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
          response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(`${params.model} returned ${response.status}: ${detail.slice(0, 300)}`);
        }

        const data = (await response.json()) as ChatCompletion;
        const choice = data.choices?.[0];
        const content: Anthropic.ContentBlock[] = [];

        const text = choice?.message?.content?.trim();
        if (text) content.push({ type: "text", text, citations: null } as Anthropic.TextBlock);

        for (const call of choice?.message?.tool_calls ?? []) {
          const { input, malformed } = parseArguments(call.function?.arguments);
          if (malformed) stats.malformedToolArgs += 1;
          let id = call.id;
          if (!id) {
            stats.missingToolCallIds += 1;
            id = `call_${++generatedId}`;
          }
          content.push({
            type: "tool_use",
            id,
            name: call.function?.name ?? "unknown",
            input,
          } as Anthropic.ToolUseBlock);
        }

        const usedTools = content.some((b) => b.type === "tool_use");

        return {
          id: `compat_${stats.requests}`,
          type: "message",
          role: "assistant",
          model: params.model,
          content,
          stop_reason: usedTools ? "tool_use" : "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: data.usage?.prompt_tokens ?? 0,
            output_tokens: data.usage?.completion_tokens ?? 0,
          },
        } as Anthropic.Message;
      },
    },
  };
}
