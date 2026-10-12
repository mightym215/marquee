import Anthropic from "@anthropic-ai/sdk";
import { createFixtureFetch, createTmdbClient } from "@marquee/tmdb-mcp";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runConcierge } from "./agent.js";
import { createApp } from "./app.js";
import { connectMcp } from "./mcp.js";

const demo = process.env.MARQUEE_DEMO === "1";
const tmdbKey = process.env.TMDB_API_KEY;

if (!tmdbKey && !demo) {
  console.error("Set TMDB_API_KEY (free at themoviedb.org), or run with MARQUEE_DEMO=1 to use sample data.");
  process.exit(1);
}

const fixtureFetch = demo ? createFixtureFetch() : undefined;
const tmdb = createTmdbClient({
  apiKey: tmdbKey ?? "demo",
  fetch: fixtureFetch,
  region: process.env.TMDB_REGION ?? "US",
});

const mcp = await connectMcp(tmdb, fixtureFetch);
const { tools } = await mcp.listTools();

const anthropicKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

const here = path.dirname(fileURLToPath(import.meta.url));
const app = createApp({
  tmdb,
  demo,
  tools: tools.map(({ name, title, description }) => ({ name, title, description })),
  concierge: anthropic ? (req, hooks) => runConcierge(req, { anthropic, mcp, model, ...hooks }) : null,
  staticDir: path.resolve(here, "../../web/dist"),
  letterboxdFetch: fixtureFetch,
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`Marquee API on http://localhost:${port}`);
  console.log(`  TMDB: ${demo ? "sample data (demo mode)" : "live"}`);
  console.log(`  Concierge: ${anthropic ? `on (${model})` : "off, set ANTHROPIC_API_KEY to enable"}`);
  console.log(`  MCP tools: ${tools.map((t) => t.name).join(", ")}`);
});
