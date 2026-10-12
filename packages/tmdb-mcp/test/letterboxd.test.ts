import { describe, expect, it, vi } from "vitest";
import { createFixtureFetch, fixtureLetterboxdRss } from "../src/fixtures.js";
import { fetchLetterboxdEntries, LetterboxdError, loadLetterboxdDiary, parseLetterboxdRss } from "../src/letterboxd.js";
import { createTmdbClient } from "../src/tmdb.js";

describe("parseLetterboxdRss", () => {
  it("reads films, ratings, likes, rewatches, and TMDB ids, and skips list posts", () => {
    const entries = parseLetterboxdRss(fixtureLetterboxdRss("michael"));
    expect(entries.map((e) => e.title)).toEqual(["Arrival", "Interstellar", "Parasite", "Paddington 2", "The Martian"]);
    expect(entries[0]).toEqual({
      title: "Arrival",
      year: 2016,
      tmdbId: 329865,
      rating: 5,
      liked: true,
      rewatch: false,
      watchedDate: "2026-10-10",
      url: "https://letterboxd.com/michael/film/arrival-2016/",
    });
    expect(entries[1]).toMatchObject({ rewatch: true, rating: 4.5 });
    expect(entries[2]).toMatchObject({ title: "Parasite", tmdbId: null });
  });

  it("decodes entities and CDATA, and treats unrated films as null", () => {
    const xml = `<rss><channel><item>
      <letterboxd:filmTitle><![CDATA[Crouching Tiger, Hidden Dragon]]></letterboxd:filmTitle>
      <letterboxd:filmYear>2000</letterboxd:filmYear>
    </item><item>
      <letterboxd:filmTitle>Fast &amp; Furious &#039;09</letterboxd:filmTitle>
    </item></channel></rss>`;
    const [first, second] = parseLetterboxdRss(xml);
    expect(first).toMatchObject({ title: "Crouching Tiger, Hidden Dragon", year: 2000, rating: null, liked: false });
    expect(second?.title).toBe("Fast & Furious '09");
  });
});

describe("loading a diary", () => {
  const fetchImpl = createFixtureFetch();
  const tmdb = createTmdbClient({ apiKey: "test", fetch: fetchImpl });

  it("matches every film to TMDB, searching by title and year when the feed has no id", async () => {
    const diary = await loadLetterboxdDiary(tmdb, "michael", fetchImpl);
    expect(diary.profileUrl).toBe("https://letterboxd.com/michael/");
    expect(diary.films.map((f) => [f.title, f.tmdbId, f.movie?.title])).toEqual([
      ["Arrival", 329865, "Arrival"],
      ["Interstellar", 157336, "Interstellar"],
      ["Parasite", 496243, "Parasite"],
      ["Paddington 2", 346648, "Paddington 2"],
      ["The Martian", 286217, "The Martian"],
    ]);
  });

  it("rejects bad usernames without calling Letterboxd", async () => {
    const spy = vi.fn(fetchImpl);
    await expect(fetchLetterboxdEntries("not a user!", spy)).rejects.toThrow(LetterboxdError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("explains a missing profile", async () => {
    await expect(fetchLetterboxdEntries("nobody", fetchImpl)).rejects.toThrow(/No public Letterboxd profile named "nobody"/);
  });
});
