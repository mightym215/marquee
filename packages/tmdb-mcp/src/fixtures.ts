/**
 * Sample TMDB responses for tests and for demo mode (MARQUEE_DEMO=1),
 * so the app runs end to end without an API key. Ratings and overviews are
 * illustrative, not live TMDB data. Poster paths are left empty on purpose.
 */

const GENRES = [
  { id: 28, name: "Action" },
  { id: 12, name: "Adventure" },
  { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 14, name: "Fantasy" },
  { id: 36, name: "History" },
  { id: 27, name: "Horror" },
  { id: 10402, name: "Music" },
  { id: 9648, name: "Mystery" },
  { id: 10749, name: "Romance" },
  { id: 878, name: "Science Fiction" },
  { id: 10770, name: "TV Movie" },
  { id: 53, name: "Thriller" },
  { id: 10752, name: "War" },
  { id: 37, name: "Western" },
];

interface FixtureMovie {
  id: number;
  title: string;
  release_date: string;
  vote_average: number;
  vote_count: number;
  genre_ids: number[];
  overview: string;
  runtime: number;
  director: string;
  cast: string[];
  tagline: string;
  stream: string[];
  lang?: string;
}

export const FIXTURE_MOVIES: FixtureMovie[] = [
  {
    id: 157336,
    title: "Interstellar",
    release_date: "2014-11-05",
    vote_average: 8.4,
    vote_count: 36000,
    genre_ids: [12, 18, 878],
    overview:
      "A team of explorers travel through a wormhole in space in an attempt to ensure humanity's survival.",
    runtime: 169,
    director: "Christopher Nolan",
    cast: ["Matthew McConaughey", "Anne Hathaway", "Jessica Chastain", "Michael Caine", "Mackenzie Foy"],
    tagline: "Mankind was born on Earth. It was never meant to die here.",
    stream: ["Paramount Plus"],
  },
  {
    id: 286217,
    title: "The Martian",
    release_date: "2015-09-30",
    vote_average: 7.7,
    vote_count: 20000,
    genre_ids: [18, 12, 878],
    overview:
      "An astronaut stranded on Mars has to rely on his ingenuity to find a way to signal to Earth that he is alive.",
    runtime: 141,
    director: "Ridley Scott",
    cast: ["Matt Damon", "Jessica Chastain", "Kristen Wiig", "Jeff Daniels", "Michael Peña"],
    tagline: "Bring Him Home",
    stream: ["Hulu"],
  },
  {
    id: 926,
    title: "Galaxy Quest",
    release_date: "1999-12-23",
    vote_average: 7.0,
    vote_count: 2700,
    genre_ids: [35, 12, 878, 10751],
    overview:
      "The stars of a canceled space TV show get beamed into a real intergalactic conflict by aliens who think the show was real.",
    runtime: 102,
    director: "Dean Parisot",
    cast: ["Tim Allen", "Sigourney Weaver", "Alan Rickman", "Tony Shalhoub", "Sam Rockwell"],
    tagline: "The show has been canceled. But the adventure is just beginning.",
    stream: ["Paramount Plus"],
  },
  {
    id: 118340,
    title: "Guardians of the Galaxy",
    release_date: "2014-07-30",
    vote_average: 7.9,
    vote_count: 28000,
    genre_ids: [28, 878, 12, 35],
    overview: "A band of misfit outlaws team up to stop a fanatical warrior from taking control of the universe.",
    runtime: 121,
    director: "James Gunn",
    cast: ["Chris Pratt", "Zoe Saldaña", "Dave Bautista", "Vin Diesel", "Bradley Cooper"],
    tagline: "All heroes start somewhere.",
    stream: ["Disney Plus"],
  },
  {
    id: 329865,
    title: "Arrival",
    release_date: "2016-11-10",
    vote_average: 7.6,
    vote_count: 18000,
    genre_ids: [18, 878, 9648],
    overview: "A linguist works with the military to communicate with alien lifeforms after mysterious spacecraft land.",
    runtime: 116,
    director: "Denis Villeneuve",
    cast: ["Amy Adams", "Jeremy Renner", "Forest Whitaker", "Michael Stuhlbarg", "Tzi Ma"],
    tagline: "Why are they here?",
    stream: ["Netflix"],
  },
  {
    id: 346648,
    title: "Paddington 2",
    release_date: "2017-11-09",
    vote_average: 7.5,
    vote_count: 3600,
    genre_ids: [12, 35, 10751],
    overview: "Paddington takes on odd jobs to buy a gift for his aunt, until the gift is stolen and he is framed.",
    runtime: 104,
    director: "Paul King",
    cast: ["Ben Whishaw", "Hugh Grant", "Hugh Bonneville", "Sally Hawkins", "Brendan Gleeson"],
    tagline: "Paddington is back.",
    stream: ["Max"],
  },
  {
    id: 496243,
    title: "Parasite",
    release_date: "2019-05-30",
    vote_average: 8.5,
    vote_count: 19000,
    genre_ids: [35, 53, 18],
    overview: "A poor family schemes to become employed by a wealthy family by posing as unrelated, skilled workers.",
    runtime: 133,
    director: "Bong Joon Ho",
    cast: ["Song Kang-ho", "Lee Sun-kyun", "Cho Yeo-jeong", "Choi Woo-shik", "Park So-dam"],
    tagline: "Act like you own the place.",
    stream: ["Max"],
    lang: "ko",
  },
  {
    id: 545611,
    title: "Everything Everywhere All at Once",
    release_date: "2022-03-24",
    vote_average: 7.8,
    vote_count: 7000,
    genre_ids: [28, 12, 878, 35],
    overview:
      "A laundromat owner is swept into an adventure where she alone can save existence by exploring other universes.",
    runtime: 140,
    director: "Daniel Kwan",
    cast: ["Michelle Yeoh", "Ke Huy Quan", "Stephanie Hsu", "Jamie Lee Curtis", "James Hong"],
    tagline: "The universe is so much bigger than you realize.",
    stream: ["Showtime"],
  },
  {
    id: 129,
    title: "Spirited Away",
    release_date: "2001-07-20",
    vote_average: 8.5,
    vote_count: 17000,
    genre_ids: [16, 10751, 14],
    overview: "A girl wanders into a world ruled by gods and spirits, where her parents are turned into pigs.",
    runtime: 125,
    director: "Hayao Miyazaki",
    cast: ["Rumi Hiiragi", "Miyu Irino", "Mari Natsuki", "Takashi Naito", "Yasuko Sawaguchi"],
    tagline: "Nothing that happens is ever forgotten.",
    stream: ["Max"],
    lang: "ja",
  },
  {
    id: 546554,
    title: "Knives Out",
    release_date: "2019-11-27",
    vote_average: 7.8,
    vote_count: 15000,
    genre_ids: [35, 80, 9648],
    overview: "A detective investigates the death of a wealthy crime novelist and his eccentric, combative family.",
    runtime: 131,
    director: "Rian Johnson",
    cast: ["Daniel Craig", "Chris Evans", "Ana de Armas", "Jamie Lee Curtis", "Michael Shannon"],
    tagline: "Hell, any of them could have done it.",
    stream: ["Prime Video"],
  },
];

function rawSummary(m: FixtureMovie) {
  return {
    id: m.id,
    title: m.title,
    release_date: m.release_date,
    vote_average: m.vote_average,
    vote_count: m.vote_count,
    genre_ids: m.genre_ids,
    overview: m.overview,
    original_language: m.lang ?? "en",
    poster_path: null,
    backdrop_path: null,
  };
}

function page(movies: FixtureMovie[]) {
  return { page: 1, total_pages: 1, total_results: movies.length, results: movies.map(rawSummary) };
}

function rawDetails(m: FixtureMovie) {
  return {
    ...rawSummary(m),
    genres: m.genre_ids.map((id) => GENRES.find((g) => g.id === id)!),
    runtime: m.runtime,
    tagline: m.tagline,
    imdb_id: null,
    credits: {
      cast: m.cast.map((name, order) => ({ name, character: "", profile_path: null, order })),
      crew: [{ name: m.director, job: "Director" }],
    },
    videos: { results: [] },
    "watch/providers": {
      results: { US: { link: `https://www.themoviedb.org/movie/${m.id}/watch`, flatrate: m.stream.map((p) => ({ provider_name: p })) } },
    },
  };
}

/**
 * A sample Letterboxd diary feed in the real feed's shape. One entry has no TMDB id, and one item is a list post.
 * Usernames starting with a letter whose char code is even (like "friend") get a second, different diary,
 * so Blend has two tastes to compare in demo mode.
 */
export function fixtureLetterboxdRss(username: string): string {
  const film = (o: {
    title: string;
    year: number;
    tmdb?: number;
    rating?: string;
    liked?: boolean;
    rewatch?: boolean;
    date: string;
    slug: string;
  }) => `
    <item>
      <title>${o.title}, ${o.year}${o.rating ? " - ★★★★" : ""}</title>
      <link>https://letterboxd.com/${username}/film/${o.slug}/</link>
      <guid isPermaLink="false">letterboxd-watch-${o.slug}</guid>
      <pubDate>Sat, ${o.date.slice(8)} Oct 2026 20:00:00 +1300</pubDate>
      <letterboxd:watchedDate>${o.date}</letterboxd:watchedDate>
      <letterboxd:rewatch>${o.rewatch ? "Yes" : "No"}</letterboxd:rewatch>
      <letterboxd:filmTitle>${o.title}</letterboxd:filmTitle>
      <letterboxd:filmYear>${o.year}</letterboxd:filmYear>
      ${o.rating ? `<letterboxd:memberRating>${o.rating}</letterboxd:memberRating>` : ""}
      ${o.liked ? "<letterboxd:memberLike>Yes</letterboxd:memberLike>" : ""}
      ${o.tmdb ? `<tmdb:movieId>${o.tmdb}</tmdb:movieId>` : ""}
      <description><![CDATA[<p>Watched on ${o.date}.</p>]]></description>
      <dc:creator>${username}</dc:creator>
    </item>`;
  const head = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:letterboxd="https://letterboxd.com" xmlns:tmdb="https://themoviedb.org">
  <channel>
    <title>Letterboxd - ${username}</title>
    <link>https://letterboxd.com/${username}/</link>`;

  if (username.toLowerCase().charCodeAt(0) % 2 === 0) {
    return `${head}
    ${film({ title: "Parasite", year: 2019, tmdb: 496243, rating: "5.0", liked: true, date: "2026-10-09", slug: "parasite-2019" })}
    ${film({ title: "Everything Everywhere All at Once", year: 2022, tmdb: 545611, rating: "4.5", liked: true, date: "2026-10-06", slug: "everything-everywhere-all-at-once" })}
    ${film({ title: "Paddington 2", year: 2017, tmdb: 346648, rating: "4.5", date: "2026-10-02", slug: "paddington-2" })}
  </channel>
</rss>`;
  }

  return `${head}
    ${film({ title: "Arrival", year: 2016, tmdb: 329865, rating: "5.0", liked: true, date: "2026-10-10", slug: "arrival-2016" })}
    ${film({ title: "Interstellar", year: 2014, tmdb: 157336, rating: "4.5", rewatch: true, date: "2026-10-08", slug: "interstellar" })}
    ${film({ title: "Parasite", year: 2019, rating: "4.5", liked: true, date: "2026-10-05", slug: "parasite-2019" })}
    <item>
      <title>Best space movies</title>
      <link>https://letterboxd.com/${username}/list/best-space-movies/</link>
      <description><![CDATA[<p>A list.</p>]]></description>
    </item>
    ${film({ title: "Paddington 2", year: 2017, tmdb: 346648, rating: "4.0", date: "2026-10-03", slug: "paddington-2" })}
    ${film({ title: "The Martian", year: 2015, tmdb: 286217, rating: "3.5", date: "2026-10-01", slug: "the-martian" })}
  </channel>
</rss>`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch replacement that answers TMDB API paths from the fixtures above. */
export function createFixtureFetch(): typeof fetch {
  return async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));

    if (url.hostname === "letterboxd.com") {
      const user = url.pathname.match(/^\/([A-Za-z0-9_]+)\/rss\/?$/)?.[1];
      if (!user || user === "nobody") return new Response("Not found", { status: 404 });
      return new Response(fixtureLetterboxdRss(user), { headers: { "content-type": "application/rss+xml" } });
    }

    const path = url.pathname.replace(/^\/3/, "");
    const q = url.searchParams;

    if (path === "/genre/movie/list") return json({ genres: GENRES });
    if (path === "/movie/now_playing" || path.startsWith("/trending/movie/")) return json(page(FIXTURE_MOVIES));

    if (path === "/search/movie") {
      const query = (q.get("query") ?? "").toLowerCase();
      return json(page(FIXTURE_MOVIES.filter((m) => m.title.toLowerCase().includes(query))));
    }

    if (path === "/discover/movie") {
      const withGenres = (q.get("with_genres") ?? "").split(",").filter(Boolean).map(Number);
      const without = (q.get("without_genres") ?? "").split(",").filter(Boolean).map(Number);
      const maxRuntime = Number(q.get("with_runtime.lte") ?? Infinity);
      const minRating = Number(q.get("vote_average.gte") ?? 0);
      const lang = q.get("with_original_language");
      const from = q.get("primary_release_date.gte") ?? "0000";
      const to = q.get("primary_release_date.lte") ?? "9999";
      const hits = FIXTURE_MOVIES.filter(
        (m) =>
          withGenres.every((g) => m.genre_ids.includes(g)) &&
          !without.some((g) => m.genre_ids.includes(g)) &&
          m.runtime <= maxRuntime &&
          m.vote_average >= minRating &&
          m.release_date >= from &&
          m.release_date <= to &&
          (!lang || (m.lang ?? "en") === lang),
      );
      return json(page(hits));
    }

    const recs = path.match(/^\/movie\/(\d+)\/recommendations$/);
    if (recs) {
      const id = Number(recs[1]);
      const base = FIXTURE_MOVIES.find((m) => m.id === id);
      if (!base) return json({ status_message: "The resource you requested could not be found." }, 404);
      const related = FIXTURE_MOVIES.filter((m) => m.id !== id && m.genre_ids.some((g) => base.genre_ids.includes(g)));
      return json(page(related));
    }

    const detail = path.match(/^\/movie\/(\d+)$/);
    if (detail) {
      const movie = FIXTURE_MOVIES.find((m) => m.id === Number(detail[1]));
      return movie
        ? json(rawDetails(movie))
        : json({ status_message: "The resource you requested could not be found." }, 404);
    }

    return json({ status_message: `No fixture for ${path}` }, 404);
  };
}
