import type { MovieDetails } from "@marquee/tmdb-mcp";
import type { ConciergeRequest, ConciergeResult } from "../agent.js";
import type { EvalCase } from "./cases.js";
import { scoreCase, type CaseScore } from "./score.js";

export interface EvalDeps {
  runAgent: (req: ConciergeRequest) => Promise<ConciergeResult>;
  getDetails: (id: number) => Promise<MovieDetails>;
  concurrency?: number;
  onProgress?: (score: CaseScore, done: number, total: number) => void;
}

export interface EvalSummary {
  model: string;
  ranAt: string;
  cases: number;
  casesPassed: number;
  /** Per check type: how many cases passed it, out of cases it applied to. */
  checkPassRates: Record<string, { passed: number; total: number }>;
  /** Across every pick: share that was grounded and met every constraint on its case. */
  pickAccuracy: { hits: number; total: number };
  groundedPicks: { hits: number; total: number };
  avgSteps: number;
  avgToolCalls: number;
  avgMs: number;
  p95Ms: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  errors: number;
}

export interface EvalReport {
  summary: EvalSummary;
  results: CaseScore[];
}

function checkFamily(name: string): string {
  if (name.startsWith("genre")) return "genre";
  if (name.startsWith("years")) return "years";
  if (name.startsWith("runtime")) return "runtime";
  if (name.startsWith("rating")) return "rating";
  if (name.startsWith("language")) return "language";
  return name;
}

export async function runEval(cases: EvalCase[], deps: EvalDeps, model: string): Promise<EvalReport> {
  const { runAgent, getDetails, concurrency = 2, onProgress } = deps;
  const results: CaseScore[] = new Array(cases.length);
  const detailCache = new Map<number, MovieDetails>();
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < cases.length) {
      const i = next++;
      const c = cases[i]!;
      try {
        const result = await runAgent({
          message: c.prompt,
          history: [],
          watched: c.watched ?? [],
          favorites: [],
        });
        for (const p of result.picks) {
          if (!detailCache.has(p.movie.id)) {
            try {
              detailCache.set(p.movie.id, await getDetails(p.movie.id));
            } catch {
              // leave it out; per pick checks skip unknown data
            }
          }
        }
        results[i] = scoreCase(c, result, detailCache);
      } catch (err) {
        results[i] = {
          id: c.id,
          prompt: c.prompt,
          pass: false,
          checks: [{ name: "ran without error", pass: false }],
          picks: [],
          steps: 0,
          toolCalls: 0,
          ms: 0,
          inputTokens: 0,
          outputTokens: 0,
          accuratePicks: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      done += 1;
      onProgress?.(results[i]!, done, cases.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker));

  const ok = results.filter((r) => !r.error);
  const checkPassRates: EvalSummary["checkPassRates"] = {};
  const pickAccuracy = { hits: 0, total: 0 };
  const groundedPicks = { hits: 0, total: 0 };

  for (const r of results) {
    for (const check of r.checks) {
      const family = checkFamily(check.name);
      const entry = (checkPassRates[family] ??= { passed: 0, total: 0 });
      entry.total += 1;
      if (check.pass) entry.passed += 1;
    }
    const grounded = r.checks.find((x) => x.name === "grounded");
    if (grounded?.total) {
      groundedPicks.hits += grounded.hits ?? 0;
      groundedPicks.total += grounded.total;
    }
    pickAccuracy.hits += r.accuratePicks;
    pickAccuracy.total += r.picks.length;
  }

  const latencies = ok.map((r) => r.ms).sort((a, b) => a - b);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : 0);

  return {
    summary: {
      model,
      ranAt: new Date().toISOString(),
      cases: results.length,
      casesPassed: results.filter((r) => r.pass).length,
      checkPassRates,
      pickAccuracy,
      groundedPicks,
      avgSteps: avg(ok.map((r) => r.steps)),
      avgToolCalls: avg(ok.map((r) => r.toolCalls)),
      avgMs: Math.round(avg(latencies)),
      p95Ms: latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]! : 0,
      totalInputTokens: results.reduce((s, r) => s + r.inputTokens, 0),
      totalOutputTokens: results.reduce((s, r) => s + r.outputTokens, 0),
      errors: results.length - ok.length,
    },
    results,
  };
}

const pct = (hits: number, total: number) => (total ? `${Math.round((hits / total) * 1000) / 10}%` : "n/a");

export function toMarkdown(report: EvalReport, pricePerMillion = { input: 3, output: 15 }): string {
  const s = report.summary;
  const cost = (s.totalInputTokens / 1e6) * pricePerMillion.input + (s.totalOutputTokens / 1e6) * pricePerMillion.output;
  const lines = [
    "# Concierge eval",
    "",
    `Model \`${s.model}\` · ${s.ranAt.slice(0, 16).replace("T", " ")} UTC · ${s.cases} cases`,
    "",
    "| Metric | Result |",
    "| --- | --- |",
    `| Cases passing every check | ${s.casesPassed} / ${s.cases} (${pct(s.casesPassed, s.cases)}) |`,
    `| Picks meeting every constraint | ${pct(s.pickAccuracy.hits, s.pickAccuracy.total)} (${s.pickAccuracy.hits} / ${s.pickAccuracy.total}) |`,
    `| Grounded picks (came from a tool result) | ${pct(s.groundedPicks.hits, s.groundedPicks.total)} |`,
    `| Average steps / tool calls | ${s.avgSteps} / ${s.avgToolCalls} |`,
    `| Latency, average / p95 | ${(s.avgMs / 1000).toFixed(1)}s / ${(s.p95Ms / 1000).toFixed(1)}s |`,
    `| Tokens in / out | ${s.totalInputTokens.toLocaleString("en-US")} / ${s.totalOutputTokens.toLocaleString("en-US")} |`,
    `| Estimated cost | $${cost.toFixed(2)} total, $${(cost / Math.max(s.cases, 1)).toFixed(3)} per request |`,
    `| Errors | ${s.errors} |`,
    "",
    "## By check",
    "",
    "| Check | Cases passed |",
    "| --- | --- |",
    ...Object.entries(s.checkPassRates).map(([name, r]) => `| ${name} | ${r.passed} / ${r.total} (${pct(r.passed, r.total)}) |`),
    "",
    "## Cases",
    "",
    "| | Case | Picks | Notes |",
    "| --- | --- | --- | --- |",
    ...report.results.map((r) => {
      const failed = r.checks.filter((x) => !x.pass).map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ""}`);
      const picks = r.picks.map((p) => `${p.title}${p.year ? ` (${p.year})` : ""}${p.grounded ? "" : " ⚠"}`).join(", ") || "none";
      return `| ${r.pass ? "✅" : "❌"} | ${r.prompt} | ${picks} | ${r.error ?? (failed.join("; ") || "")} |`;
    }),
    "",
    `Cost uses $${pricePerMillion.input} / $${pricePerMillion.output} per million input / output tokens. Set EVAL_PRICE_IN and EVAL_PRICE_OUT to match your model.`,
    "",
  ];
  return lines.join("\n");
}
