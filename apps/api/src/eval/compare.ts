/**
 * Aggregates several eval runs per model into one comparison.
 *
 * The point of running each case more than once is consistency, not accuracy:
 * a model that passes a case on one attempt and fails it on the next is the
 * interesting result, and a single run hides it entirely.
 */
import type { EvalReport } from "./runEval.js";
import type { ModelBackend } from "./models.js";

export interface CaseConsistency {
  id: string;
  prompt: string;
  /** How many trials passed every check, out of how many ran. */
  passed: number;
  trials: number;
  /** Check names that failed at least once, most frequent first. */
  failedChecks: string[];
}

export interface ModelComparison {
  backend: ModelBackend;
  trials: number;
  /** Mean cases passed per trial, and the spread across trials. */
  casesPassed: { mean: number; min: number; max: number; of: number };
  /** Cases that passed every single trial. The strict number. */
  alwaysPassed: number;
  /** Cases that passed at least once but not always. The jagged ones. */
  flaky: number;
  perCase: CaseConsistency[];
  checkPassRates: Record<string, { passed: number; total: number }>;
  groundedPicks: { hits: number; total: number };
  avgMs: number;
  p95Ms: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  costPerRequest: number;
  errors: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarizeTrials(backend: ModelBackend, reports: EvalReport[]): ModelComparison {
  const trials = reports.length;
  const passedCounts = reports.map((r) => r.summary.casesPassed);
  const caseIds = reports[0]?.results.map((r) => r.id) ?? [];

  const perCase: CaseConsistency[] = caseIds.map((id) => {
    const across = reports.map((r) => r.results.find((x) => x.id === id));
    const prompt = across.find((r) => r)?.prompt ?? id;
    const passed = across.filter((r) => r?.pass).length;
    const failTally = new Map<string, number>();
    for (const r of across) {
      for (const check of r?.checks ?? []) {
        if (!check.pass) failTally.set(check.name, (failTally.get(check.name) ?? 0) + 1);
      }
      if (r?.error) failTally.set("error", (failTally.get("error") ?? 0) + 1);
    }
    return {
      id,
      prompt,
      passed,
      trials,
      failedChecks: [...failTally.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
    };
  });

  const checkPassRates: ModelComparison["checkPassRates"] = {};
  for (const report of reports) {
    for (const [name, r] of Object.entries(report.summary.checkPassRates)) {
      const entry = (checkPassRates[name] ??= { passed: 0, total: 0 });
      entry.passed += r.passed;
      entry.total += r.total;
    }
  }

  const grounded = { hits: 0, total: 0 };
  for (const report of reports) {
    grounded.hits += report.summary.groundedPicks.hits;
    grounded.total += report.summary.groundedPicks.total;
  }

  const totalInputTokens = reports.reduce((s, r) => s + r.summary.totalInputTokens, 0);
  const totalOutputTokens = reports.reduce((s, r) => s + r.summary.totalOutputTokens, 0);
  const requests = Math.max(
    reports.reduce((s, r) => s + r.summary.cases, 0),
    1,
  );
  const cost = (totalInputTokens / 1e6) * backend.price.input + (totalOutputTokens / 1e6) * backend.price.output;

  return {
    backend,
    trials,
    casesPassed: {
      mean: round1(mean(passedCounts)),
      min: Math.min(...passedCounts),
      max: Math.max(...passedCounts),
      of: caseIds.length,
    },
    alwaysPassed: perCase.filter((c) => c.passed === c.trials).length,
    flaky: perCase.filter((c) => c.passed > 0 && c.passed < c.trials).length,
    perCase,
    checkPassRates,
    groundedPicks: grounded,
    avgMs: Math.round(mean(reports.map((r) => r.summary.avgMs))),
    p95Ms: Math.max(...reports.map((r) => r.summary.p95Ms)),
    totalInputTokens,
    totalOutputTokens,
    costPerRequest: cost / requests,
    errors: reports.reduce((s, r) => s + r.summary.errors, 0),
  };
}

const pct = (hits: number, total: number) => (total ? `${Math.round((hits / total) * 1000) / 10}%` : "n/a");

export function comparisonMarkdown(comparisons: ModelComparison[]): string {
  if (!comparisons.length) return "# Model comparison\n\nNothing ran.\n";
  const cols = comparisons.map((c) => c.backend.label);
  const headerFor = (first: string) => `| ${first} | ${cols.join(" | ")} |`;
  const header = headerFor("Metric");
  const divider = `| --- | ${cols.map(() => "---").join(" | ")} |`;
  const row = (label: string, cell: (c: ModelComparison) => string) =>
    `| ${label} | ${comparisons.map(cell).join(" | ")} |`;

  const trials = comparisons[0]!.trials;
  const caseCount = comparisons[0]!.casesPassed.of;

  const lines = [
    "# Tool-calling comparison",
    "",
    `${caseCount} cases · ${trials} trial${trials === 1 ? "" : "s"} each · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    "Every pick is checked against live TMDB data, so a model cannot pass by sounding confident.",
    "",
    header,
    divider,
    row("Cases passed (mean of trials)", (c) => `${c.casesPassed.mean} / ${c.casesPassed.of}`),
    row("Spread across trials", (c) => (c.trials > 1 ? `${c.casesPassed.min}–${c.casesPassed.max}` : "n/a")),
    row("Passed every trial", (c) => `${c.alwaysPassed} / ${c.casesPassed.of}`),
    row("Flaky (passed some, failed some)", (c) => String(c.flaky)),
    row("Grounded picks", (c) => pct(c.groundedPicks.hits, c.groundedPicks.total)),
    row("Latency, mean / p95", (c) => `${(c.avgMs / 1000).toFixed(1)}s / ${(c.p95Ms / 1000).toFixed(1)}s`),
    row("Cost per request", (c) => (c.backend.price.input || c.backend.price.output ? `$${c.costPerRequest.toFixed(4)}` : "$0 (local)")),
    row("Errors", (c) => String(c.errors)),
    "",
    "## Where each model breaks",
    "",
    "Pass rate per constraint type, pooled across trials.",
    "",
    headerFor("Check"),
    divider,
    ...[...new Set(comparisons.flatMap((c) => Object.keys(c.checkPassRates)))].sort().map((name) =>
      row(name, (c) => {
        const r = c.checkPassRates[name];
        return r ? `${pct(r.passed, r.total)}` : "n/a";
      }),
    ),
    "",
    "## Case by case",
    "",
    `Trials passed out of ${trials}.`,
    "",
    headerFor("Case"),
    divider,
    ...(comparisons[0]?.perCase ?? []).map((c) =>
      row(c.prompt, (comparison) => {
        const entry = comparison.perCase.find((x) => x.id === c.id);
        if (!entry) return "n/a";
        const mark = entry.passed === entry.trials ? "✅" : entry.passed === 0 ? "❌" : "⚠️";
        const why = entry.passed === entry.trials ? "" : ` ${entry.failedChecks.slice(0, 2).join(", ")}`;
        return `${mark} ${entry.passed}/${entry.trials}${why}`;
      }),
    ),
    "",
    "## Setup",
    "",
    ...comparisons.map((c) => `- **${c.backend.label}** (\`${c.backend.model}\`)${c.backend.note ? ` — ${c.backend.note}` : ""}`),
    "",
  ];
  return lines.join("\n");
}
