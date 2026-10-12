import type Anthropic from "@anthropic-ai/sdk";
import { createFixtureFetch, createTmdbClient, type MovieDetails } from "@marquee/tmdb-mcp";
import { describe, expect, it } from "vitest";
import { runConcierge, type ConciergeResult, type MessagesClient } from "../src/agent.js";
import { CASES, type EvalCase } from "../src/eval/cases.js";
import { runEval, toMarkdown } from "../src/eval/runEval.js";
import { scoreCase } from "../src/eval/score.js";
import { connectMcp } from "../src/mcp.js";

const tmdb = createTmdbClient({ apiKey: "test", fetch: createFixtureFetch() });

async function detailsFor(...ids: number[]) {
  const map = new Map<number, MovieDetails>();
  for (const id of ids) map.set(id, await tmdb.details(id));
  return map;
}

async function result(picks: { id: number; grounded?: boolean }[], dropped = 0): Promise<ConciergeResult> {
  return {
    reply: "ok",
    picks: await Promise.all(
      picks.map(async (p) => ({ movie: await tmdb.movie(p.id), reason: "r", grounded: p.grounded ?? true })),
    ),
    trace: [{ tool: "discover_movies", args: {}, ok: true, ms: 5, summary: "3 movies" }],
    steps: 2,
    usage: { inputTokens: 1000, outputTokens: 100 },
    droppedPicks: dropped,
    ms: 4200,
  };
}

describe("eval scoring", () => {
  it("checks every pick against TMDB data, not the model's claims", async () => {
    const c: EvalCase = { id: "cozy", prompt: "A cozy movie under 2 hours", expect: { maxRuntime: 120 } };
    // Galaxy Quest is 102 min, Paddington 2 is 104, Interstellar is 169.
    const score = scoreCase(c, await result([{ id: 926 }, { id: 346648 }, { id: 157336 }]), await detailsFor(926, 346648, 157336));
    const runtime = score.checks.find((x) => x.name.startsWith("runtime"))!;
    expect(runtime).toMatchObject({ pass: false, hits: 2, total: 3, detail: "missed: Interstellar" });
    expect(score.pass).toBe(false);
    expect(score.accuratePicks).toBe(2);
  });

  it("fails grounding for picks named from memory or invalid ids", async () => {
    const c: EvalCase = { id: "x", prompt: "x", expect: {} };
    const score = scoreCase(c, await result([{ id: 926 }, { id: 129, grounded: false }, { id: 346648 }], 1), await detailsFor(926, 129, 346648));
    const grounded = score.checks.find((x) => x.name === "grounded")!;
    expect(grounded).toMatchObject({ pass: false, hits: 2, total: 4 });
    expect(score.accuratePicks).toBe(2);
  });

  it("catches already watched picks and checks language and years", async () => {
    const c: EvalCase = {
      id: "x",
      prompt: "x",
      watchedIds: [496243],
      expect: { language: "ko", yearFrom: 2015, minPicks: 1 },
    };
    const score = scoreCase(c, await result([{ id: 496243 }]), await detailsFor(496243));
    expect(score.checks.find((x) => x.name === "skips watched")?.pass).toBe(false);
    expect(score.checks.find((x) => x.name === "language: ko")?.pass).toBe(true);
    expect(score.checks.find((x) => x.name.startsWith("years"))?.pass).toBe(true);
  });

  it("passes an off topic case only when there are no picks", async () => {
    const c = CASES.find((x) => x.id === "off-topic")!;
    expect(scoreCase(c, await result([]), new Map()).pass).toBe(true);
    expect(scoreCase(c, await result([{ id: 926 }]), await detailsFor(926)).pass).toBe(false);
  });

  it("has a varied, well formed case set", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });
});

describe("eval runner", () => {
  it("runs the real agent loop over MCP and builds a report", async () => {
    const mcp = await connectMcp(tmdb);
    const msg = (content: unknown[], stop: string) =>
      ({ id: "m", type: "message", role: "assistant", model: "t", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 500, output_tokens: 50 } }) as unknown as Anthropic.Message;
    // A scripted stand in for Claude: discover sci-fi comedies, pick two.
    const fakeClaude = (): MessagesClient => {
      const script = [
        msg([{ type: "tool_use", id: "a", name: "discover_movies", input: { genres: ["Comedy", "Science Fiction"] } }], "tool_use"),
        msg([{ type: "tool_use", id: "b", name: "present_picks", input: { picks: [{ movie_id: 926, reason: "r" }, { movie_id: 118340, reason: "r" }] } }], "tool_use"),
        msg([{ type: "text", text: "Two fun ones." }], "end_turn"),
      ];
      return { messages: { create: async () => script.shift()! } };
    };
    const cases: EvalCase[] = [
      { id: "funny", prompt: "Something like Interstellar, but funny", expect: { genresAny: ["Comedy"], minPicks: 2 } },
      { id: "short", prompt: "under 105 minutes", expect: { maxRuntime: 105, minPicks: 2 } },
    ];
    const progress: string[] = [];
    const report = await runEval(
      cases,
      {
        runAgent: (req) => runConcierge(req, { anthropic: fakeClaude(), mcp, model: "stand-in" }),
        getDetails: (id) => tmdb.details(id),
        onProgress: (s, done, total) => progress.push(`${done}/${total} ${s.id}`),
      },
      "stand-in",
    );

    expect(report.summary.cases).toBe(2);
    expect(report.summary.casesPassed).toBe(1); // Guardians is 121 min, so the runtime case fails
    expect(report.summary.groundedPicks).toEqual({ hits: 4, total: 4 });
    expect(report.summary.pickAccuracy).toEqual({ hits: 3, total: 4 });
    expect(report.summary.totalInputTokens).toBe(3000);
    expect(progress).toHaveLength(2);

    const md = toMarkdown(report);
    expect(md).toContain("| Cases passing every check | 1 / 2 (50%) |");
    expect(md).toContain("missed: Guardians of the Galaxy");
  });

  it("records agent crashes as failed cases instead of stopping the run", async () => {
    const report = await runEval(
      [{ id: "x", prompt: "x", expect: {} }],
      { runAgent: async () => { throw new Error("rate limited"); }, getDetails: (id) => tmdb.details(id) },
      "m",
    );
    expect(report.summary.errors).toBe(1);
    expect(report.results[0]?.error).toBe("rate limited");
  });
});
