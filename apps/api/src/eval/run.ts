/**
 * Runs the concierge against every eval case with live TMDB and Claude, then
 * writes eval-reports/latest.md and latest.json.
 *
 *   npm run eval            (all cases)
 *   npm run eval -- 5       (first 5 cases, for a quick check)
 *
 * Needs TMDB_API_KEY and ANTHROPIC_API_KEY. A full run makes roughly 60 to 100
 * Claude calls, so check the estimated cost in the report.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createTmdbClient } from "@marquee/tmdb-mcp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runConcierge } from "../agent.js";
import { connectMcp } from "../mcp.js";
import { CASES } from "./cases.js";
import { runEval, toMarkdown } from "./runEval.js";

const tmdbKey = process.env.TMDB_API_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (!tmdbKey || !anthropicKey) {
  console.error("The eval runs the real agent. Set TMDB_API_KEY and ANTHROPIC_API_KEY in .env first.");
  process.exit(1);
}

const limit = Number(process.argv[2]) || CASES.length;
const cases = CASES.slice(0, limit);
const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
const tmdb = createTmdbClient({ apiKey: tmdbKey, region: process.env.TMDB_REGION ?? "US" });
const mcp = await connectMcp(tmdb);
const anthropic = new Anthropic({ apiKey: anthropicKey });

console.log(`Running ${cases.length} eval cases against ${model}…\n`);
const report = await runEval(
  cases,
  {
    runAgent: (req) => runConcierge(req, { anthropic, mcp, model }),
    getDetails: (id) => tmdb.details(id),
    concurrency: Number(process.env.EVAL_CONCURRENCY ?? 2),
    onProgress: (score, done, total) => {
      const failed = score.checks.filter((c) => !c.pass).map((c) => c.name);
      console.log(
        `${String(done).padStart(2)}/${total} ${score.pass ? "PASS" : "FAIL"}  ${score.prompt}` +
          (failed.length ? `  (${failed.join(", ")})` : "") +
          (score.error ? `  error: ${score.error}` : ""),
      );
    },
  },
  model,
);

const markdown = toMarkdown(report, {
  input: Number(process.env.EVAL_PRICE_IN ?? 3),
  output: Number(process.env.EVAL_PRICE_OUT ?? 15),
});
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../eval-reports");
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, "latest.md"), markdown);
await writeFile(path.join(dir, "latest.json"), JSON.stringify(report, null, 2));

const s = report.summary;
console.log(`\n${s.casesPassed}/${s.cases} cases passed · report: apps/api/eval-reports/latest.md`);
process.exit(0);
