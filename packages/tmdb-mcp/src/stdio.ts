#!/usr/bin/env node
/**
 * Runs the Marquee TMDB tools as a standalone MCP server over stdio,
 * so any MCP client (Claude Desktop, Claude Code, the MCP Inspector) can use them.
 *
 *   TMDB_API_KEY=... node dist/stdio.js
 *
 * stdout carries the MCP protocol, so logs go to stderr only.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { createTmdbClient } from "./tmdb.js";

const apiKey = process.env.TMDB_API_KEY;
if (!apiKey) {
  console.error("Set TMDB_API_KEY to your TMDB API key or read access token.");
  process.exit(1);
}

const server = createServer(createTmdbClient({ apiKey, region: process.env.TMDB_REGION ?? "US" }));
await server.connect(new StdioServerTransport());
console.error("Marquee TMDB MCP server running on stdio");
