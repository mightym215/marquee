/**
 * Runs ONE case against one backend and prints every step the agent takes.
 *
 *   npm run eval:inspect -- --model xlam --case 0
 *
 * The comparison report tells you a case failed and which check broke. It does
 * not tell you why, and with a local model "why" is usually a protocol problem
 * rather than a taste problem: the model never calls present_picks, or calls it
 * with arguments that do not match the schema. Both show up here as the actual
 * tool name and the actual arguments, so the failure has a cause instead of a
 * label.
 */
import { createTmdbClient } from "@marquee/tmdb-mcp";
import { runConcierge } from "../agent.js";
import { connectMcp } from "../mcp.js";
import { CASES } from "./cases.js";
import { createClient, resolveBackend } from "./models.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const tmdbKey = process.env.TMDB_API_KEY;
if (!tmdbKey) {
  console.error("Set TMDB_API_KEY in .env.");
  process.exit(1);
}

const backend = resolveBackend(arg("model", "xlam"));
const caseIndex = Number(arg("case", "0"));
const testCase = CASES[caseIndex];
if (!testCase) {
  console.error(`No case ${caseIndex}. There are ${CASES.length}, indexed from 0.`);
  process.exit(1);
}

const tmdb = createTmdbClient({ apiKey: tmdbKey, region: process.env.TMDB_REGION ?? "US" });
const mcp = await connectMcp(tmdb);
const client = createClient(backend);

console.log(`${backend.label} (${backend.model})`);
console.log(`Case ${caseIndex}: ${testCase.prompt}\n`);

const result = await runConcierge(
  {
    message: testCase.prompt,
    history: [],
    watched: testCase.watched ?? [],
    favorites: [],
  },
  {
    anthropic: client,
    mcp,
    model: backend.model,
    onEvent: (event) => {
      if (event.type === "step") console.log(`\n── step ${event.step}`);
      if (event.type === "tool_start") {
        console.log(`  → ${event.tool}`);
        console.log(`    args: ${JSON.stringify(event.args)}`);
      }
      if (event.type === "tool_end") {
        console.log(`  ← ${event.tool} ${event.ok ? "ok" : "FAILED"} (${event.ms}ms) ${event.summary}`);
      }
    },
  },
);

console.log(`\n── result`);
console.log(`picks: ${result.picks.length}`);
for (const p of result.picks) {
  console.log(`  ${p.movie.title}${p.grounded ? "" : "  [not grounded, id was looked up]"}`);
}
console.log(`reply: ${result.reply || "(empty)"}`);

// The adapter counts the two ways a small model breaks the protocol without
// erroring: arguments that are not valid JSON objects, and tool calls with no
// id, which it has to invent so the transcript stays well formed.
const stats = (client as { stats?: Record<string, number> }).stats;
if (stats) {
  console.log(`\n── adapter`);
  console.log(`  requests: ${stats.requests}`);
  console.log(`  malformed tool arguments: ${stats.malformedToolArgs}`);
  console.log(`  tool calls missing an id: ${stats.missingToolCallIds}`);
}

process.exit(0);
