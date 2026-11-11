/**
 * Checks that the comparison surfaces inconsistency rather than averaging it
 * away: a model that passes a case on one trial and fails it on the next must
 * show up as flaky, not as a half-point.
 */
import { describe, expect, it } from "vitest";
import { comparisonMarkdown, summarizeTrials } from "../src/eval/compare.js";
import type { ModelBackend } from "../src/eval/models.js";
import type { EvalReport } from "../src/eval/runEval.js";

const backend: ModelBackend = {
  key: "fake",
  label: "Fake 3B",
  provider: "openai-compat",
  model: "fake-3b",
  price: { input: 0, output: 0 },
  note: "test double",
};

/** One trial: `outcomes` says which cases passed. */
function report(outcomes: Record<string, boolean>): EvalReport {
  const results = Object.entries(outcomes).map(([id, pass]) => ({
    id,
    prompt: `prompt for ${id}`,
    pass,
    checks: [
      { name: "grounded", pass: true, hits: 3, total: 3 },
      { name: "genre", pass, ...(pass ? {} : { detail: "wrong genre" }) },
    ],
    picks: [],
    steps: 3,
    toolCalls: 2,
    ms: 4000,
    inputTokens: 1000,
    outputTokens: 100,
    accuratePicks: pass ? 3 : 0,
  }));

  return {
    summary: {
      model: "fake-3b",
      ranAt: new Date().toISOString(),
      cases: results.length,
      casesPassed: results.filter((r) => r.pass).length,
      checkPassRates: {
        grounded: { passed: results.length, total: results.length },
        genre: { passed: results.filter((r) => r.pass).length, total: results.length },
      },
      pickAccuracy: { hits: 0, total: 0 },
      groundedPicks: { hits: results.length * 3, total: results.length * 3 },
      avgSteps: 3,
      avgToolCalls: 2,
      avgMs: 4000,
      p95Ms: 6000,
      totalInputTokens: results.length * 1000,
      totalOutputTokens: results.length * 100,
      errors: 0,
    },
    results,
  } as EvalReport;
}

describe("multi-trial comparison", () => {
  const trials = [
    report({ a: true, b: true, c: false }),
    report({ a: true, b: false, c: false }),
    report({ a: true, b: true, c: false }),
  ];
  const summary = summarizeTrials(backend, trials);

  it("separates always-passing cases from flaky ones", () => {
    expect(summary.alwaysPassed).toBe(1); // only a
    expect(summary.flaky).toBe(1); // b passed twice of three
    expect(summary.perCase.find((c) => c.id === "b")?.passed).toBe(2);
    expect(summary.perCase.find((c) => c.id === "c")?.passed).toBe(0);
  });

  it("reports the spread across trials, not just the mean", () => {
    expect(summary.casesPassed.mean).toBe(1.7);
    expect(summary.casesPassed.min).toBe(1);
    expect(summary.casesPassed.max).toBe(2);
  });

  it("names the check that failed on the flaky case", () => {
    expect(summary.perCase.find((c) => c.id === "b")?.failedChecks).toContain("genre");
  });

  it("pools check pass rates across trials", () => {
    expect(summary.checkPassRates.genre).toEqual({ passed: 5, total: 9 });
  });

  it("renders a comparison table with a flaky marker", () => {
    const md = comparisonMarkdown([summary]);
    expect(md).toContain("Flaky (passed some, failed some)");
    expect(md).toContain("⚠️ 2/3");
    expect(md).toContain("$0 (local)");
    expect(md).toContain("Fake 3B");
  });
});
