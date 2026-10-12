import { describe, expect, it } from "vitest";
import { blendDiaries, cosine, tasteVector } from "../src/blend.js";
import { createFixtureFetch } from "../src/fixtures.js";
import type { LetterboxdFilm } from "../src/letterboxd.js";
import { createTmdbClient } from "../src/tmdb.js";

const fetchImpl = createFixtureFetch();
const tmdb = createTmdbClient({ apiKey: "test", fetch: fetchImpl });

function film(genres: string[], rating: number | null, liked = false): LetterboxdFilm {
  return {
    title: "x",
    year: 2000,
    tmdbId: 1,
    rating,
    liked,
    rewatch: false,
    watchedDate: null,
    url: null,
    movie: {
      id: 1,
      title: "x",
      year: 2000,
      releaseDate: null,
      rating: 7,
      voteCount: 1,
      overview: "",
      genres,
      originalLanguage: "en",
      posterPath: null,
      backdropPath: null,
    },
  };
}

describe("taste math", () => {
  it("weights genres by stars, so loved genres dominate and hated ones go negative", () => {
    const v = tasteVector([film(["Horror"], 5), film(["Horror", "Comedy"], 4, true), film(["Romance"], 1)]);
    expect(v.get("Horror")).toBe(3 + 3);
    expect(v.get("Comedy")).toBe(3);
    expect(v.get("Romance")).toBe(-1);
  });

  it("scores identical tastes 1, unrelated tastes 0, and ignores dislikes", () => {
    const horror = tasteVector([film(["Horror"], 5)]);
    expect(cosine(horror, horror)).toBeCloseTo(1);
    expect(cosine(horror, tasteVector([film(["Comedy"], 5)]))).toBe(0);
    expect(cosine(horror, tasteVector([film(["Horror"], 1)]))).toBe(0);
  });
});

describe("blendDiaries", () => {
  it("finds shared loves and picks that neither person has logged", async () => {
    const blend = await blendDiaries(tmdb, "michael", "friend", fetchImpl);

    expect(blend.people.map((p) => p.username)).toEqual(["michael", "friend"]);
    expect(blend.matchPercent).toBeGreaterThan(0);
    expect(blend.matchPercent).toBeLessThanOrEqual(100);
    expect(blend.sharedLoves.map((s) => s.movie.title)).toEqual(["Parasite", "Paddington 2"]);
    expect(blend.sharedLoves[0]?.ratings).toEqual([4.5, 5]);

    const logged = new Set([329865, 157336, 496243, 346648, 286217, 545611]);
    expect(blend.picks.length).toBeGreaterThan(0);
    expect(blend.picks.every((p) => !logged.has(p.movie.id))).toBe(true);
    for (const pick of blend.picks) expect(pick.because.length).toBeGreaterThan(0);
    // sorted best first
    const scores = blend.picks.map((p) => p.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("credits picks that both people's favorites point to", async () => {
    const blend = await blendDiaries(tmdb, "michael", "friend", fetchImpl);
    const top = blend.picks[0]!;
    expect(new Set(top.because.map((b) => b.username)).size).toBe(2);
  });
});
