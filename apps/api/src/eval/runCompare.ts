/**
 * Runs the eval cases against two or more models and writes a comparison.
 *
 *   npm run eval:compare -- --models claude,xlam --trials 3
 *   npm run eval:compare -- --models xlam --trials 1 --cases 5
 *
 * Claude needs ANTHROPIC_API_KEY. Local models need a server already running
 * (see README). TMDB_API_KEY is always required, since every pick is checked
 * against real movie data.
 */
import { createTmdbClient } from "@marquee/tmdb-mcp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runConcierge } from "../agent.js";
import { connectMcp } from "../mcp.js";
import { CASES } from "./cases.js";
import { comparisonMarkdown, summarizeTrials, type ModelComparison } from "./compare.js";
import { createClient, resolveBackend } from "./models.js";
import { runEval, type EvalReport } from "./runEval.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const tmdbKey = process.env.TMDB_API_KEY;
if (!tmdbKey) {
  console.error("Set TMDB_API_KEY in .env. Every pick is verified against real TMDB data.");
  process.exit(1);
}

const modelKeys = arg("models", "claude,xlam").split(",").map((s) => s.trim()).filter(Boolean);
const trials = Math.max(1, Number(arg("trials", "3")));
const caseLimit = Number(arg("cases", String(CASES.length))) || CASES.length;
const cases = CASES.slice(0, caseLimit);

const backends = modelKeys.map(resolveBackend);
const tmdb = createTmdbClient({ apiKey: tmdbKey, region: process.env.TMDB_REGION ?? "US" });
const mcp = await connectMcp(tmdb);

console.log(`${cases.length} cases × ${trials} trial${trials === 1 ? "" : "s"} × ${backends.length} model${backends.length === 1 ? "" : "s"}\n`);

const comparisons: ModelComparison[] = [];

for (const backend of backends) {
  let client;
  try {
    client = createClient(backend);
  } catch (err) {
    console.error(`Skipping ${backend.label}: ${err instanceof Error ? err.message : err}\n`);
    continue;
  }

  const reports: EvalReport[] = [];
  for (let trial = 1; trial <= trials; trial++) {
    console.log(`${backend.label} — trial ${trial}/${trials}`);
    const report = await runEval(
      cases,
      {
        runAgent: (req) => runConcierge(req, { anthropic: client, mcp, model: backend.model }),
        getDetails: (id) => tmdb.details(id),
        // local models serve one request at a time; pushing concurrency just queues
        concurrency: Number(process.env.EVAL_CONCURRENCY ?? (backend.provider === "anthropic" ? 2 : 1)),
        onProgress: (score, done, total) => {
          const failed = score.checks.filter((c) => !c.pass).map((c) => c.name);
          console.log(
            `  ${String(done).padStart(2)}/${total} ${score.pass ? "PASS" : "FAIL"}  ${score.prompt}` +
              (failed.length ? `  (${failed.join(", ")})` : "") +
              (score.error ? `  error: ${score.error}` : ""),
          );
        },
      },
      backend.model,
    );
    reports.push(report);
    console.log(`  → ${report.summary.casesPassed}/${report.summary.cases}\n`);
  }

  if (!reports.length) continue;

  // If the server had no parser for this model's tool calls, the adapter
  // recovered them from the content. That changes how the numbers should be
  // read, so it goes in the report rather than staying in the console.
  const stats = (client as { stats?: { requests: number; recoveredToolCalls: number; malformedToolArgs: number } }).stats;
  const annotated =
    stats && stats.recoveredToolCalls > 0
      ? {
          ...backend,
          note: [
            backend.note,
            `tool calls were not returned in the OpenAI tool_calls field; ${stats.recoveredToolCalls} were recovered from the model's own JSON content across ${stats.requests} requests`,
          ]
            .filter(Boolean)
            .join(" — "),
        }
      : backend;

  comparisons.push(summarizeTrials(annotated, reports));
}

if (!comparisons.length) {
  console.error("No model ran. Check your keys and that any local server is up.");
  process.exit(1);
}

const markdown = comparisonMarkdown(comparisons);
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../eval-reports");
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, "comparison.md"), markdown);
await writeFile(path.join(dir, "comparison.json"), JSON.stringify(comparisons, null, 2));

console.log("\n" + comparisonMarkdown(comparisons).split("## Where each model breaks")[0]);
console.log("Full report: apps/api/eval-reports/comparison.md");
process.exit(0);
