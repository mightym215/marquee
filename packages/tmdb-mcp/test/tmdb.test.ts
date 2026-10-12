import { describe, expect, it, vi } from "vitest";
import { createFixtureFetch } from "../src/fixtures.js";
import { createTmdbClient, imageUrl, TmdbError } from "../src/tmdb.js";

function client(fetchImpl: typeof fetch = createFixtureFetch(), apiKey = "v3-key") {
  return createTmdbClient({ apiKey, fetch: fetchImpl });
}

describe("TMDB client", () => {
  it("maps list results to summaries with genre names and years", async () => {
    const page = await client().nowPlaying();
    const interstellar = page.movies.find((m) => m.id === 157336);
    expect(interstellar).toMatchObject({
      title: "Interstellar",
      year: 2014,
      rating: 8.4,
      genres: ["Adventure", "Drama", "Science Fiction"],
    });
  });

  it("sends a v3 key as a query param and a read token as a bearer header", async () => {
    const spy = vi.fn(createFixtureFetch());
    await client(spy, "abc123").search("mars");
    const [url, init] = spy.mock.calls.find(([u]) => String(u).includes("/search/movie"))!;
    expect(String(url)).toContain("api_key=abc123");
    expect((init?.headers as Record<string, string>).authorization).toBeUndefined();

    const spy2 = vi.fn(createFixtureFetch());
    await client(spy2, "eyJhbGciOi.token").search("mars");
    const [url2, init2] = spy2.mock.calls.find(([u]) => String(u).includes("/search/movie"))!;
    expect(String(url2)).not.toContain("api_key");
    expect((init2?.headers as Record<string, string>).authorization).toBe("Bearer eyJhbGciOi.token");
  });

  it("builds discover filters into TMDB query params", async () => {
    const spy = vi.fn(createFixtureFetch());
    await client(spy).discover({ genreIds: [35, 878], maxRuntime: 120, yearFrom: 1990, yearTo: 1999, sortBy: "rating" });
    const call = spy.mock.calls.find(([u]) => String(u).includes("/discover/movie"))!;
    const url = new URL(String(call[0]));
    expect(url.searchParams.get("with_genres")).toBe("35,878");
    expect(url.searchParams.get("with_runtime.lte")).toBe("120");
    expect(url.searchParams.get("primary_release_date.gte")).toBe("1990-01-01");
    expect(url.searchParams.get("sort_by")).toBe("vote_average.desc");
    // rating sorts require enough votes so obscure films don't win
    expect(url.searchParams.get("vote_count.gte")).toBe("300");
  });

  it("assembles details with director, cast, and where to watch", async () => {
    const movie = await client().details(926);
    expect(movie.director).toBe("Dean Parisot");
    expect(movie.cast[0]?.name).toBe("Tim Allen");
    expect(movie.runtime).toBe(102);
    expect(movie.watchProviders?.stream).toEqual(["Paramount Plus"]);
  });

  it("throws a TmdbError with TMDB's message on failure", async () => {
    await expect(client().details(1)).rejects.toThrow(TmdbError);
    await expect(client().details(1)).rejects.toThrow(/could not be found/);
  });

  it("builds image urls", () => {
    expect(imageUrl("/abc.jpg")).toBe("https://image.tmdb.org/t/p/w342/abc.jpg");
    expect(imageUrl(null)).toBeNull();
  });
});
