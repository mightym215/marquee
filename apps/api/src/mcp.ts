import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type TmdbClient } from "@marquee/tmdb-mcp";

/**
 * Starts the TMDB MCP server inside this process and connects an MCP client to it.
 * The agent talks to the server over the real MCP protocol, just like Claude Desktop
 * does over stdio, without needing a separate process on the host.
 */
export async function connectMcp(tmdb: TmdbClient, letterboxdFetch?: typeof fetch): Promise<Client> {
  const server = createServer(tmdb, { fetch: letterboxdFetch });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "marquee-concierge", version: "1.1.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
