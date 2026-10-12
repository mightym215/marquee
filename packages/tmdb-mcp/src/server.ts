import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { blendDiaries } from "./blend.js";
import { LetterboxdError, loadLetterboxdDiary } from "./letterboxd.js";
import {
  blendOutput,
  genreListOutput,
  letterboxdOutput,
  movieDetailsOutput,
  movieListOutput,
  type Genre,
  type MovieDetails,
  type MovieSummary,
} from "./schemas.js";
import { TmdbError, type SortBy, type TmdbClient } from "./tmdb.js";

export interface ServerOptions {
  name?: string;
  version?: string;
  /** fetch used for Letterboxd feeds (tests and demo mode pass a fake). */
  fetch?: typeof fetch;
}

/** How many movies a list tool returns. Enough to choose from, small enough to keep tokens down. */
export const LIST_LIMIT = 10;

const GENRE_ALIASES: Record<string, string> = {
  "sci-fi": "science fiction",
  scifi: "science fiction",
  "sci fi": "science fiction",
  romcom: "romance",
  "rom-com": "romance",
  animated: "animation",
  cartoon: "animation",
  scary: "horror",
  funny: "comedy",
  musical: "music",
  doc: "documentary",
  "war film": "war",
  superhero: "action",
};

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

/** Compact shape sent to the model: the fields it needs to reason, nothing it doesn't. */
function forModel(movie: MovieSummary) {
  const overview = movie.overview.length > 220 ? `${movie.overview.slice(0, 217)}...` : movie.overview;
  return {
    id: movie.id,
    title: movie.title,
    year: movie.year,
    rating: movie.rating,
    votes: movie.voteCount,
    genres: movie.genres,
    language: movie.originalLanguage,
    overview,
  };
}

function detailsForModel(movie: MovieDetails) {
  return {
    ...forModel(movie),
    overview: movie.overview,
    runtime_minutes: movie.runtime,
    tagline: movie.tagline,
    director: movie.director,
    cast: movie.cast.slice(0, 5).map((c) => c.name),
    has_trailer: Boolean(movie.trailerYoutubeKey),
    where_to_watch: movie.watchProviders
      ? { stream: movie.watchProviders.stream, rent: movie.watchProviders.rent }
      : "unknown",
  };
}

function listResult(movies: MovieSummary[], emptyHint: string): CallToolResult {
  const top = movies.slice(0, LIST_LIMIT);
  const text =
    top.length === 0 ? JSON.stringify({ movies: [], note: emptyHint }) : JSON.stringify({ movies: top.map(forModel) });
  return { content: [{ type: "text", text }], structuredContent: { movies: top } };
}

function errorResult(err: unknown): CallToolResult {
  const message =
    err instanceof TmdbError || err instanceof LetterboxdError
      ? err.message
      : err instanceof Error
        ? `Unexpected error: ${err.message}`
        : "Unexpected error";
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Turns genre names like "sci-fi" or "Comedy" into TMDB genre ids. */
export function resolveGenres(names: string[], genres: Genre[]): { ids: number[]; unknown: string[] } {
  const byName = new Map(genres.map((g) => [g.name.toLowerCase(), g.id]));
  const ids: number[] = [];
  const unknown: string[] = [];
  for (const raw of names) {
    const key = raw.trim().toLowerCase();
    const id = byName.get(key) ?? byName.get(GENRE_ALIASES[key] ?? "");
    if (id === undefined) unknown.push(raw);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unknown };
}

export function createServer(tmdb: TmdbClient, options: ServerOptions = {}): McpServer {
  const { name = "marquee-tmdb", version = "1.1.0", fetch: doFetch = globalThis.fetch } = options;
  const server = new McpServer(
    { name, version },
    {
      instructions:
        "Movie tools backed by The Movie Database (TMDB), plus Letterboxd diaries. Use search_movies for titles, " +
        "discover_movies for mood, genre, era, rating, or length requests, get_recommendations for 'more like X', " +
        "get_movie_details before describing a specific film, get_letterboxd_diary to learn someone's taste " +
        "from their Letterboxd, and blend_letterboxd to plan a movie night for two people. Only state facts that " +
        "come from tool results.",
    },
  );

  server.registerTool(
    "search_movies",
    {
      title: "Search movies",
      description: "Find movies by title or keyword. Returns up to 10 matches with ids, years, ratings, and genres.",
      inputSchema: {
        query: z.string().min(1).max(200).describe("Movie title or keywords, for example 'Interstellar'"),
        year: z.number().int().min(1880).max(2100).optional().describe("Release year, if known"),
      },
      outputSchema: movieListOutput,
      annotations: readOnly,
    },
    async ({ query, year }) => {
      try {
        const page = await tmdb.search(query, { year });
        return listResult(page.movies, "No matches. Try a shorter title or drop the year.");
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "discover_movies",
    {
      title: "Discover movies",
      description:
        "Find movies by genre, era, rating, and length. Use this for requests like 'a funny 90s sci-fi under 2 hours'. " +
        "Genres are names such as Comedy, Science Fiction, Horror, Animation, Thriller, Romance, Documentary.",
      inputSchema: {
        genres: z.array(z.string()).max(4).optional().describe("Genres the movie must have (all of them)"),
        exclude_genres: z.array(z.string()).max(4).optional().describe("Genres to leave out"),
        min_rating: z.number().min(0).max(10).optional().describe("Minimum TMDB rating out of 10"),
        min_votes: z.number().int().min(0).optional().describe("Minimum vote count, to skip obscure titles"),
        year_from: z.number().int().min(1880).max(2100).optional(),
        year_to: z.number().int().min(1880).max(2100).optional(),
        max_runtime_minutes: z.number().int().min(30).max(400).optional(),
        original_language: z
          .string()
          .length(2)
          .optional()
          .describe("ISO 639-1 language code, for example 'ko' for Korean films"),
        sort_by: z.enum(["popularity", "rating", "release_date", "revenue"]).optional(),
      },
      outputSchema: movieListOutput,
      annotations: readOnly,
    },
    async (args) => {
      try {
        const all = await tmdb.genres();
        const include = resolveGenres(args.genres ?? [], all);
        const exclude = resolveGenres(args.exclude_genres ?? [], all);
        const unknown = [...include.unknown, ...exclude.unknown];
        if (unknown.length > 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Unknown genre(s): ${unknown.join(", ")}. Valid genres: ${all.map((g) => g.name).join(", ")}.`,
              },
            ],
          };
        }
        const page = await tmdb.discover({
          genreIds: include.ids,
          excludeGenreIds: exclude.ids,
          minRating: args.min_rating,
          minVotes: args.min_votes,
          yearFrom: args.year_from,
          yearTo: args.year_to,
          maxRuntime: args.max_runtime_minutes,
          originalLanguage: args.original_language,
          sortBy: args.sort_by as SortBy | undefined,
        });
        return listResult(page.movies, "Nothing matched. Loosen a filter, like the rating or the years.");
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_movie_details",
    {
      title: "Get movie details",
      description: "Full details for one movie: runtime, director, cast, tagline, trailer, and where to watch in the US.",
      inputSchema: { movie_id: z.number().int().positive().describe("TMDB movie id from another tool") },
      outputSchema: movieDetailsOutput,
      annotations: readOnly,
    },
    async ({ movie_id }) => {
      try {
        const movie = await tmdb.details(movie_id);
        return {
          content: [{ type: "text", text: JSON.stringify(detailsForModel(movie)) }],
          structuredContent: { movie },
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_recommendations",
    {
      title: "Get recommendations",
      description: "Movies that fans of a given movie also like. Use for 'more like X' requests after finding X's id.",
      inputSchema: { movie_id: z.number().int().positive().describe("TMDB movie id of the movie to start from") },
      outputSchema: movieListOutput,
      annotations: readOnly,
    },
    async ({ movie_id }) => {
      try {
        const page = await tmdb.recommendations(movie_id);
        return listResult(page.movies, "No recommendations for this movie. Try discover_movies with its genres.");
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_trending",
    {
      title: "Get trending movies",
      description: "The movies people are watching and talking about right now.",
      inputSchema: { window: z.enum(["day", "week"]).optional().describe("Trending today or this week (default)") },
      outputSchema: movieListOutput,
      annotations: readOnly,
    },
    async ({ window }) => {
      try {
        const page = await tmdb.trending(window ?? "week");
        return listResult(page.movies, "Nothing trending right now.");
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_letterboxd_diary",
    {
      title: "Get Letterboxd diary",
      description:
        "A Letterboxd member's recent diary from their public profile: films they logged, their star ratings " +
        "(0.5 to 5), likes, and rewatches, matched to TMDB ids. Use it to learn someone's taste, then build on " +
        "their highest rated films with get_recommendations. Covers about the last 50 entries.",
      inputSchema: {
        username: z.string().min(2).max(40).describe("Letterboxd username, as in letterboxd.com/<username>"),
      },
      outputSchema: letterboxdOutput,
      annotations: readOnly,
    },
    async ({ username }) => {
      try {
        const diary = await loadLetterboxdDiary(tmdb, username.trim().replace(/^@/, ""), doFetch);
        const films = diary.films.map((f) => ({
          tmdb_id: f.tmdbId,
          title: f.title,
          year: f.year,
          stars: f.rating,
          liked: f.liked || undefined,
          rewatch: f.rewatch || undefined,
          watched: f.watchedDate,
          genres: f.movie?.genres,
        }));
        const text =
          films.length === 0
            ? JSON.stringify({ username: diary.username, films: [], note: "No diary entries yet, or the profile is private." })
            : JSON.stringify({ username: diary.username, films });
        return { content: [{ type: "text", text }], structuredContent: { ...diary } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "blend_letterboxd",
    {
      title: "Blend two Letterboxd tastes",
      description:
        "Movie night for two. Compares two Letterboxd members' diaries and returns their taste match percent, " +
        "genres they share, films they both loved, and up to 12 movies neither has logged that both are likely to " +
        "enjoy, each with the loved films that led to it.",
      inputSchema: {
        username_a: z.string().min(2).max(40).describe("First Letterboxd username"),
        username_b: z.string().min(2).max(40).describe("Second Letterboxd username"),
      },
      outputSchema: blendOutput,
      annotations: readOnly,
    },
    async ({ username_a, username_b }) => {
      try {
        const clean = (u: string) => u.trim().replace(/^@/, "");
        const blend = await blendDiaries(tmdb, clean(username_a), clean(username_b), doFetch);
        const text = JSON.stringify({
          match_percent: blend.matchPercent,
          shared_genres: blend.sharedGenres,
          both_loved: blend.sharedLoves.map((s) => s.movie.title),
          people: blend.people.map((p) => ({ username: p.username, top_genres: p.topGenres, films_logged: p.films })),
          picks: blend.picks.slice(0, 10).map((p) => ({
            ...forModel(p.movie),
            because: p.because.map((x) => `${x.username} loved ${x.title}`),
          })),
        });
        return { content: [{ type: "text", text }], structuredContent: { ...blend } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_genres",
    {
      title: "List genres",
      description: "Every movie genre TMDB supports, by name.",
      outputSchema: genreListOutput,
      annotations: readOnly,
    },
    async () => {
      try {
        const genres = await tmdb.genres();
        return {
          content: [{ type: "text", text: JSON.stringify(genres.map((g) => g.name)) }],
          structuredContent: { genres },
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}
