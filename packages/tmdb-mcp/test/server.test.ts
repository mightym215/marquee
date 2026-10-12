import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { createFixtureFetch } from "../src/fixtures.js";
import { createServer, resolveGenres } from "../src/server.js";
import { createTmdbClient } from "../src/tmdb.js";

let client: Client;

beforeAll(async () => {
  const fetchImpl = createFixtureFetch();
  const server = createServer(createTmdbClient({ apiKey: "test", fetch: fetchImpl }), { fetch: fetchImpl });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const first = (result.content as { type: string; text?: string }[])[0];
  return first?.text ?? "";
}

describe("MCP server", () => {
  it("exposes the movie tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "blend_letterboxd",
      "discover_movies",
      "get_letterboxd_diary",
      "get_movie_details",
      "get_recommendations",
      "get_trending",
      "list_genres",
      "search_movies",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("returns compact text for the model and full data as structured content", async () => {
    const result = await client.callTool({ name: "search_movies", arguments: { query: "galaxy" } });
    const forModel = JSON.parse(textOf(result));
    expect(forModel.movies.map((m: { title: string }) => m.title)).toEqual(["Galaxy Quest", "Guardians of the Galaxy"]);
    expect(forModel.movies[0]).not.toHaveProperty("posterPath");
    const structured = result.structuredContent as { movies: { posterPath: unknown }[] };
    expect(structured.movies[0]).toHaveProperty("posterPath");
  });

  it("discovers by genre names, including aliases like sci-fi", async () => {
    const result = await client.callTool({
      name: "discover_movies",
      arguments: { genres: ["sci-fi", "comedy"], max_runtime_minutes: 125 },
    });
    const titles = JSON.parse(textOf(result)).movies.map((m: { title: string }) => m.title);
    expect(titles).toEqual(["Galaxy Quest", "Guardians of the Galaxy"]);
  });

  it("tells the model which genres are valid when it guesses wrong", async () => {
    const result = await client.callTool({ name: "discover_movies", arguments: { genres: ["space opera"] } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Unknown genre\(s\): space opera\. Valid genres: Action/);
  });

  it("returns details with where to watch", async () => {
    const result = await client.callTool({ name: "get_movie_details", arguments: { movie_id: 329865 } });
    const details = JSON.parse(textOf(result));
    expect(details).toMatchObject({ title: "Arrival", director: "Denis Villeneuve", runtime_minutes: 116 });
    expect(details.where_to_watch.stream).toEqual(["Netflix"]);
  });

  it("reads a Letterboxd diary with star ratings for the model", async () => {
    const result = await client.callTool({ name: "get_letterboxd_diary", arguments: { username: "@michael" } });
    const forModel = JSON.parse(textOf(result));
    expect(forModel.username).toBe("michael");
    expect(forModel.films[0]).toMatchObject({ tmdb_id: 329865, title: "Arrival", stars: 5, liked: true });
    const structured = result.structuredContent as { films: { movie: { posterPath: unknown } | null }[] };
    expect(structured.films).toHaveLength(5);
    expect(structured.films[0]?.movie).toHaveProperty("posterPath");
  });

  it("blends two Letterboxd tastes for movie night", async () => {
    const result = await client.callTool({ name: "blend_letterboxd", arguments: { username_a: "michael", username_b: "@friend" } });
    const forModel = JSON.parse(textOf(result));
    expect(forModel.both_loved).toEqual(["Parasite", "Paddington 2"]);
    expect(forModel.picks[0].because.length).toBeGreaterThan(0);
    expect((result.structuredContent as { matchPercent: number }).matchPercent).toBeGreaterThan(0);
  });

  it("explains a missing Letterboxd profile as a tool error", async () => {
    const result = await client.callTool({ name: "get_letterboxd_diary", arguments: { username: "nobody" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No public Letterboxd profile/);
  });

  it("turns TMDB failures into tool errors instead of crashing", async () => {
    const result = await client.callTool({ name: "get_movie_details", arguments: { movie_id: 1 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/404/);
  });
});

describe("resolveGenres", () => {
  const genres = [
    { id: 35, name: "Comedy" },
    { id: 878, name: "Science Fiction" },
  ];
  it("matches names case-insensitively and dedupes", () => {
    expect(resolveGenres(["COMEDY", "scifi", "Science Fiction"], genres)).toEqual({ ids: [35, 878], unknown: [] });
  });
  it("reports unknown names", () => {
    expect(resolveGenres(["Mumblecore"], genres)).toEqual({ ids: [], unknown: ["Mumblecore"] });
  });
});
