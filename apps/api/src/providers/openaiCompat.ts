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

/** A tool call the model wrote into its content instead of into tool_calls. */
interface NativeToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** Models often wrap their JSON in a markdown fence. */
function stripFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced?.[1]?.trim() ?? text;
}

/** Arguments may arrive as an object, as a JSON string, or not at all. */
function asArguments(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * xLAM emits tool calls as its own JSON in the content: [{"name": ..., "arguments": {...}}].
 * A server with a matching parser lifts those into `tool_calls` for you — that
 * is what vLLM's `--tool-call-parser xlam` and llama.cpp's `--jinja` do. Ollama
 * ships no xLAM parser, so without this the model's correct tool call arrives
 * as prose, the agent sees no call, and the case fails for a reason that has
 * nothing to do with the model's decision.
 *
 * The guards matter more than the parsing. A recovery only happens when the
 * whole content is JSON and *every* entry names a tool that was actually
 * declared in this request. Anything else is left as text rather than guessed
 * into a call, so the adapter can never invent a tool the model did not ask
 * for. Recoveries are counted, because needing one is itself a finding about
 * the serving stack.
 */
function recoverNativeToolCalls(text: string, declared: Set<string>): NativeToolCall[] | undefined {
  const trimmed = stripFence(text.trim());
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (!items.length) return undefined;

  const calls: NativeToolCall[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") return undefined;
    const { name, arguments: rawArgs } = item as { name?: unknown; arguments?: unknown };
    if (typeof name !== "string" || !declared.has(name)) return undefined;
    const input = asArguments(rawArgs);
    if (!input) return undefined;
    calls.push({ name, arguments: input });
  }
  return calls;
}

/** Counts of things worth reporting in a benchmark but not worth failing on. */
export interface CompatStats {
  requests: number;
  malformedToolArgs: number;
  missingToolCallIds: number;
  /** Tool calls found in content because the server had no parser for them. */
  recoveredToolCalls: number;
}

export interface OpenAICompatClient extends MessagesClient {
  stats: CompatStats;
}

export function createOpenAICompatClient(opts: OpenAICompatOptions): OpenAICompatClient {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const stats: CompatStats = { requests: 0, malformedToolArgs: 0, missingToolCallIds: 0, recoveredToolCalls: 0 };
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
        const apiToolCalls = choice?.message?.tool_calls ?? [];

        // Only look in the content when the server returned no tool calls of
        // its own, and only against the tools this request actually declared.
        const declared = new Set(((params.tools ?? []) as Anthropic.Tool[]).map((t) => t.name));
        const recovered =
          !apiToolCalls.length && text && declared.size ? recoverNativeToolCalls(text, declared) : undefined;
        if (recovered) stats.recoveredToolCalls += recovered.length;

        // Recovered calls were the whole content, so it is not also the reply.
        if (text && !recovered) content.push({ type: "text", text, citations: null } as Anthropic.TextBlock);

        for (const call of apiToolCalls) {
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

        for (const call of recovered ?? []) {
          content.push({
            type: "tool_use",
            id: `call_${++generatedId}`,
            name: call.name,
            input: call.arguments,
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
