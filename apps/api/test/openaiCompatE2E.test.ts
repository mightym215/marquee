/**
 * End-to-end proof that the concierge can run on an OpenAI-compatible server
 * instead of Claude: a real HTTP server stands in for the model, the real
 * agent loop drives it, and the real MCP tools answer from TMDB fixtures.
 *
 * The stand-in deliberately behaves like a small local model, emitting tool
 * calls with string-encoded arguments and no ids, so the adapter's rough edges
 * are exercised rather than assumed.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createFixtureFetch, createTmdbClient } from "@marquee/tmdb-mcp";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runConcierge } from "../src/agent.js";
import { connectMcp } from "../src/mcp.js";
import { createOpenAICompatClient } from "../src/providers/openaiCompat.js";

/** Replies like a tool-calling model: search, then present picks, then talk. */
function completionFor(turn: number) {
  if (turn === 1) {
    return {
      choices: [
        {
          // no id, the way some local servers emit them
          message: { content: "", tool_calls: [{ function: { name: "search_movies", arguments: '{"query":"Interstellar"}' } }] },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 420, completion_tokens: 18 },
    };
  }
  if (turn === 2) {
    return {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "picks",
                function: {
                  name: "present_picks",
                  arguments: JSON.stringify({
                    picks: [{ movie_id: 157336, reason: "The one you asked about, and still the best of its kind." }],
                  }),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 900, completion_tokens: 44 },
    };
  }
  return {
    choices: [{ message: { content: "Here's one to start with." }, finish_reason: "stop" }],
    usage: { prompt_tokens: 980, completion_tokens: 9 },
  };
}

let server: Server;
let baseUrl: string;
let mcp: Client;
let turns = 0;
const bodies: { messages: { role: string }[] }[] = [];

beforeAll(async () => {
  mcp = await connectMcp(createTmdbClient({ apiKey: "test", fetch: createFixtureFetch() }));

  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      turns += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(completionFor(turns)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("concierge over an OpenAI-compatible server", () => {
  it("completes the tool loop and returns a grounded pick", async () => {
    const client = createOpenAICompatClient({ baseUrl, apiKey: "local" });

    const result = await runConcierge(
      { message: "Something like Interstellar", history: [], watched: [], favorites: [] },
      { anthropic: client, mcp, model: "xlam-2-3b-fc-r" },
    );

    expect(result.picks).toHaveLength(1);
    expect(result.picks[0]?.movie.title).toBe("Interstellar");
    // grounded means the id came back from a tool call this run, not the model's memory
    expect(result.picks[0]?.grounded).toBe(true);
    expect(result.reply).toBe("Here's one to start with.");
    expect(result.trace.map((t) => t.tool)).toEqual(["search_movies", "present_picks"]);
    expect(result.usage.inputTokens).toBe(420 + 900 + 980);
    expect(client.stats.missingToolCallIds).toBe(1);
  });

  it("sends tool results back as role:tool messages the server can read", async () => {
    const afterFirstCall = bodies[1];
    expect(afterFirstCall).toBeDefined();
    const roles = afterFirstCall!.messages.map((m) => m.role);
    expect(roles[0]).toBe("system");
    expect(roles).toContain("tool");
    // the assistant turn carrying the tool call has to sit before its result
    expect(roles.indexOf("assistant")).toBeLessThan(roles.indexOf("tool"));
  });
});
