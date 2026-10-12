import type Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createFixtureFetch, createTmdbClient } from "@marquee/tmdb-mcp";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeHistory, runConcierge, type MessagesClient } from "../src/agent.js";
import { connectMcp } from "../src/mcp.js";

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

function message(content: Block[], stop: "tool_use" | "end_turn"): Anthropic.Message {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "test",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  } as unknown as Anthropic.Message;
}

/** A fake Claude that replays a script and records what it was sent. */
function scripted(responses: Anthropic.Message[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    messages: {
      async create(params) {
        calls.push(structuredClone(params));
        const next = responses.shift();
        if (!next) throw new Error("script ran out");
        return next;
      },
    },
  };
  return { client, calls };
}

let mcp: Client;
beforeAll(async () => {
  mcp = await connectMcp(createTmdbClient({ apiKey: "test", fetch: createFixtureFetch() }));
});

const base = { history: [], watched: [], favorites: [] };

describe("concierge agent", () => {
  it("runs the tool loop over MCP and returns picks with full movie data", async () => {
    const { client, calls } = scripted([
      message([{ type: "tool_use", id: "t1", name: "search_movies", input: { query: "Interstellar" } }], "tool_use"),
      message([{ type: "tool_use", id: "t2", name: "get_recommendations", input: { movie_id: 157336 } }], "tool_use"),
      message(
        [
          {
            type: "tool_use",
            id: "t3",
            name: "present_picks",
            input: {
              picks: [
                { movie_id: 286217, reason: "Same survival in space feel, with more jokes." },
                { movie_id: 329865, reason: "Big ideas and a quiet, emotional core." },
                { movie_id: 424242, reason: "Made up id that should be dropped." },
              ],
            },
          },
        ],
        "tool_use",
      ),
      message([{ type: "text", text: "Two great follow ups to Interstellar." }], "end_turn"),
    ]);

    const events: string[] = [];
    const result = await runConcierge(
      { ...base, message: "something like Interstellar" },
      { anthropic: client, mcp, model: "test", onEvent: (e) => events.push(e.type === "step" ? `step ${e.step}` : `${e.type} ${e.tool}`) },
    );

    expect(result.reply).toBe("Two great follow ups to Interstellar.");
    expect(result.picks.map((p) => p.movie.title)).toEqual(["The Martian", "Arrival"]);
    expect(result.picks[0]?.reason).toMatch(/survival/);
    expect(result.trace.map((t) => [t.tool, t.ok, t.summary])).toEqual([
      ["search_movies", true, "1 movie"],
      ["get_recommendations", true, "7 movies"],
      ["present_picks", true, "3 picks"],
    ]);
    expect(result.steps).toBe(4);
    expect(result.picks.every((p) => p.grounded)).toBe(true);
    expect(result.droppedPicks).toBe(1);
    expect(events).toEqual([
      "step 1",
      "tool_start search_movies",
      "tool_end search_movies",
      "step 2",
      "tool_start get_recommendations",
      "tool_end get_recommendations",
      "step 3",
      "tool_start present_picks",
      "tool_end present_picks",
      "step 4",
    ]);
    expect(result.usage).toEqual({ inputTokens: 400, outputTokens: 80 });

    // Claude saw the MCP tools plus present_picks, and got tool results back.
    const toolNames = calls[0]!.tools!.map((t) => (t as Anthropic.Tool).name);
    expect(toolNames).toContain("discover_movies");
    expect(toolNames).toContain("present_picks");
    const lastUserTurn = calls[1]!.messages.at(-1)!;
    expect(JSON.stringify(lastUserTurn.content)).toContain("tool_result");
    expect(JSON.stringify(lastUserTurn.content)).toContain("Interstellar");
  });

  it("passes tool errors back so the model can fix its call", async () => {
    const { client, calls } = scripted([
      message([{ type: "tool_use", id: "t1", name: "discover_movies", input: { genres: ["space opera"] } }], "tool_use"),
      message([{ type: "text", text: "Let me try that again." }], "end_turn"),
    ]);
    const result = await runConcierge({ ...base, message: "space opera" }, { anthropic: client, mcp, model: "test" });
    expect(result.trace[0]).toMatchObject({ tool: "discover_movies", ok: false });
    const toolResult = (calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(toolResult.is_error).toBe(true);
    expect(String(toolResult.content)).toMatch(/Valid genres/);
  });

  it("stops after the step limit", async () => {
    const loop = () => message([{ type: "tool_use", id: "t", name: "get_trending", input: {} }], "tool_use");
    const { client, calls } = scripted([loop(), loop(), loop(), loop()]);
    const result = await runConcierge({ ...base, message: "anything" }, { anthropic: client, mcp, model: "test", maxSteps: 3 });
    expect(calls).toHaveLength(3);
    expect(result.picks).toEqual([]);
    expect(result.reply).toMatch(/couldn't find/);
  });

  it("puts the user's watched list in the system prompt", async () => {
    const { client, calls } = scripted([message([{ type: "text", text: "ok" }], "end_turn")]);
    await runConcierge(
      { ...base, message: "hi", watched: ["Interstellar (2014)"], favorites: ["Arrival (2016)"] },
      { anthropic: client, mcp, model: "test" },
    );
    expect(calls[0]!.system).toMatch(/watched: Interstellar \(2014\)/);
    expect(calls[0]!.system).toMatch(/favorites: Arrival \(2016\)/);
    expect(calls[0]!.system).not.toMatch(/Letterboxd as/);
  });

  it("tells the model about a connected Letterboxd account", async () => {
    const { client, calls } = scripted([message([{ type: "text", text: "ok" }], "end_turn")]);
    await runConcierge(
      { ...base, message: "surprise me", letterboxd: "michael", watched: ["Arrival (2016), 5 stars"] },
      { anthropic: client, mcp, model: "test" },
    );
    expect(calls[0]!.system).toMatch(/Letterboxd as "michael"/);
    expect(calls[0]!.system).toMatch(/Arrival \(2016\), 5 stars/);
  });
});

describe("grounding", () => {
  it("marks picks the model named from memory as not grounded", async () => {
    const { client } = scripted([
      message([{ type: "tool_use", id: "p", name: "present_picks", input: { picks: [{ movie_id: 926, reason: "from memory" }] } }], "tool_use"),
      message([{ type: "text", text: "Try this." }], "end_turn"),
    ]);
    const result = await runConcierge({ ...base, message: "anything" }, { anthropic: client, mcp, model: "test" });
    expect(result.picks[0]).toMatchObject({ grounded: false, movie: { title: "Galaxy Quest" } });
  });

  it("stops when the request is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { client, calls } = scripted([message([{ type: "text", text: "never" }], "end_turn")]);
    const result = await runConcierge({ ...base, message: "hi" }, { anthropic: client, mcp, model: "test", signal: controller.signal });
    expect(calls).toHaveLength(0);
    expect(result.steps).toBe(0);
  });
});

describe("normalizeHistory", () => {
  it("drops leading assistant turns, merges repeats, and ends on an assistant turn", () => {
    expect(
      normalizeHistory([
        { role: "assistant", content: "Welcome!" },
        { role: "user", content: "a" },
        { role: "user", content: "b" },
        { role: "assistant", content: "c" },
        { role: "user", content: "dangling" },
      ]),
    ).toEqual([
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c" },
    ]);
  });
});
