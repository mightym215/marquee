import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompatClient } from "../src/providers/openaiCompat.js";

/** Captures the body sent to /chat/completions and replies with a canned completion. */
function stubServer(completion: unknown, status = 200) {
  const sent: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => completion,
      text: async () => JSON.stringify(completion),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return sent;
}

const TOOLS = [
  { name: "search_movies", description: "Find movies", input_schema: { type: "object", properties: { query: { type: "string" } } } },
] as unknown as Anthropic.Tool[];

function call(client: ReturnType<typeof createOpenAICompatClient>, messages: Anthropic.MessageParam[]) {
  return client.messages.create({
    model: "xlam-2-3b",
    max_tokens: 1024,
    system: "You are a movie concierge.",
    tools: TOOLS,
    messages,
  } as Anthropic.MessageCreateParamsNonStreaming);
}

describe("openai-compatible adapter", () => {
  let client: ReturnType<typeof createOpenAICompatClient>;

  beforeEach(() => {
    client = createOpenAICompatClient({ baseUrl: "http://localhost:11434/v1", apiKey: "local" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("moves the system prompt into the message list and reshapes tools", async () => {
    const sent = stubServer({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: {} });
    await call(client, [{ role: "user", content: "a cozy movie" }]);

    const body = sent[0] as { messages: { role: string; content: string }[]; tools: { type: string; function: { name: string; parameters: unknown } }[] };
    expect(body.messages[0]).toEqual({ role: "system", content: "You are a movie concierge." });
    expect(body.messages[1]).toEqual({ role: "user", content: "a cozy movie" });
    expect(body.tools[0].type).toBe("function");
    expect(body.tools[0].function.name).toBe("search_movies");
    expect(body.tools[0].function.parameters).toEqual(TOOLS[0].input_schema);
  });

  it("turns tool_calls back into tool_use blocks the agent understands", async () => {
    stubServer({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [{ id: "c1", function: { name: "search_movies", arguments: '{"query":"cozy"}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 40, completion_tokens: 12 },
    });

    const res = await call(client, [{ role: "user", content: "a cozy movie" }]);
    expect(res.stop_reason).toBe("tool_use");
    expect(res.content).toEqual([{ type: "tool_use", id: "c1", name: "search_movies", input: { query: "cozy" } }]);
    expect(res.usage).toEqual({ input_tokens: 40, output_tokens: 12 });
  });

  it("flattens an assistant turn with tool calls, then one tool message per result", async () => {
    const sent = stubServer({ choices: [{ message: { content: "done" }, finish_reason: "stop" }], usage: {} });

    await call(client, [
      { role: "user", content: "a cozy movie" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "looking" },
          { type: "tool_use", id: "c1", name: "search_movies", input: { query: "cozy" } },
        ] as unknown as Anthropic.ContentBlockParam[],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "c1", content: "Found 3 movies" }] as unknown as Anthropic.ContentBlockParam[],
      },
    ]);

    const body = sent[0] as { messages: Record<string, unknown>[] };
    expect(body.messages[2]).toEqual({
      role: "assistant",
      content: "looking",
      tool_calls: [{ id: "c1", type: "function", function: { name: "search_movies", arguments: '{"query":"cozy"}' } }],
    });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "Found 3 movies" });
  });

  it("survives malformed tool arguments instead of throwing, and counts them", async () => {
    stubServer({
      choices: [
        {
          message: { content: "", tool_calls: [{ id: "c1", function: { name: "search_movies", arguments: "{query: cozy" } }] },
          finish_reason: "tool_calls",
        },
      ],
      usage: {},
    });

    const res = await call(client, [{ role: "user", content: "a cozy movie" }]);
    expect(res.content[0]).toEqual({ type: "tool_use", id: "c1", name: "search_movies", input: {} });
    expect(client.stats.malformedToolArgs).toBe(1);
  });

  it("invents an id when the server omits one, so tool results can be matched", async () => {
    stubServer({
      choices: [
        { message: { content: "", tool_calls: [{ function: { name: "search_movies", arguments: "{}" } }] }, finish_reason: "tool_calls" },
      ],
      usage: {},
    });

    const res = await call(client, [{ role: "user", content: "hi" }]);
    expect((res.content[0] as { id: string }).id).toMatch(/^call_\d+$/);
    expect(client.stats.missingToolCallIds).toBe(1);
  });

  it("reports a server error with its status and body", async () => {
    stubServer({ error: "model not found" }, 404);
    await expect(call(client, [{ role: "user", content: "hi" }])).rejects.toThrow(/returned 404/);
  });
});

/**
 * Ollama renders tools into the prompt but ships no xLAM response parser, so
 * the model's tool call comes back as content. Recovering it measures the
 * model's decision instead of the server's missing parser — but only when the
 * content really is a call to a tool this request declared.
 */
describe("tool calls written into the content", () => {
  let client: ReturnType<typeof createOpenAICompatClient>;

  beforeEach(() => {
    client = createOpenAICompatClient({ baseUrl: "http://localhost:11434/v1", apiKey: "local" });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** What xLAM-2 actually returned through Ollama. */
  const asContent = (content: string) => ({
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: {},
  });

  it("recovers xLAM's native format and reports it as a tool call", async () => {
    stubServer(asContent('[{"name": "search_movies", "arguments": {"query": "Interstellar"}}]'));

    const res = await call(client, [{ role: "user", content: "Something like Interstellar, but funny" }]);
    expect(res.stop_reason).toBe("tool_use");
    expect(res.content).toHaveLength(1);
    expect(res.content[0]).toMatchObject({ type: "tool_use", name: "search_movies", input: { query: "Interstellar" } });
    expect(client.stats.recoveredToolCalls).toBe(1);
  });

  it("accepts a bare object, a markdown fence, and arguments as a JSON string", async () => {
    stubServer(asContent('```json\n{"name": "search_movies", "arguments": "{\\"query\\":\\"cozy\\"}"}\n```'));

    const res = await call(client, [{ role: "user", content: "a cozy movie" }]);
    expect(res.content[0]).toMatchObject({ type: "tool_use", name: "search_movies", input: { query: "cozy" } });
  });

  it("will not invent a tool the request never declared", async () => {
    stubServer(asContent('[{"name": "delete_everything", "arguments": {}}]'));

    const res = await call(client, [{ role: "user", content: "hi" }]);
    expect(res.stop_reason).toBe("end_turn");
    expect(res.content[0]!.type).toBe("text");
    expect(client.stats.recoveredToolCalls).toBe(0);
    expect(client.stats.rejectedToolCallJson).toBe(1);
  });

  it("treats an empty array as a clean end of turn, not a reply and not a rejection", async () => {
    stubServer(asContent("[]"));

    const res = await call(client, [{ role: "user", content: "hi" }]);
    expect(res.stop_reason).toBe("end_turn");
    expect(res.content).toEqual([]);
    expect(client.stats.rejectedToolCallJson).toBe(0);
    expect(client.stats.recoveredToolCalls).toBe(0);
  });

  it("does not count ordinary prose as rejected tool-call JSON", async () => {
    stubServer(asContent("You might enjoy The Martian."));

    await call(client, [{ role: "user", content: "hi" }]);
    expect(client.stats.rejectedToolCallJson).toBe(0);
  });

  it("leaves a JSON reply that is not a tool call as text", async () => {
    stubServer(asContent('{"title": "Interstellar", "year": 2014}'));

    const res = await call(client, [{ role: "user", content: "hi" }]);
    expect(res.stop_reason).toBe("end_turn");
    expect(res.content[0]).toMatchObject({ type: "text" });
    expect(client.stats.recoveredToolCalls).toBe(0);
  });

  it("rejects the whole batch if any entry names an undeclared tool", async () => {
    stubServer(
      asContent('[{"name": "search_movies", "arguments": {"query": "cozy"}}, {"name": "rm_rf", "arguments": {}}]'),
    );

    const res = await call(client, [{ role: "user", content: "hi" }]);
    expect(res.content.every((b) => b.type === "text")).toBe(true);
    expect(client.stats.recoveredToolCalls).toBe(0);
  });

  it("never looks in the content when the server returned real tool calls", async () => {
    stubServer({
      choices: [
        {
          message: {
            content: '[{"name": "search_movies", "arguments": {"query": "ignored"}}]',
            tool_calls: [{ id: "c1", function: { name: "search_movies", arguments: '{"query":"real"}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {},
    });

    const res = await call(client, [{ role: "user", content: "hi" }]);
    const uses = res.content.filter((b) => b.type === "tool_use");
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({ input: { query: "real" } });
    expect(client.stats.recoveredToolCalls).toBe(0);
  });

  it("leaves plain prose alone", async () => {
    stubServer(asContent("You might enjoy The Martian."));

    const res = await call(client, [{ role: "user", content: "hi" }]);
    expect(res.stop_reason).toBe("end_turn");
    expect(res.content[0]).toMatchObject({ type: "text", text: "You might enjoy The Martian." });
  });
});
