import type {
  CastMember,
  Genre,
  MovieDetails,
  MoviePage,
  MovieSummary,
  WatchProviders,
} from "./schemas.js";

/**
 * A small, typed client for the TMDB v3 API.
 * Accepts either a v3 API key or a v4 read access token (the long "eyJ..." one).
 */

export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export class TmdbError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TmdbError";
  }
}

export type SortBy = "popularity" | "rating" | "release_date" | "revenue";

export interface DiscoverFilters {
  genreIds?: number[];
  excludeGenreIds?: number[];
  minRating?: number;
  minVotes?: number;
  yearFrom?: number;
  yearTo?: number;
  maxRuntime?: number;
  originalLanguage?: string;
  sortBy?: SortBy;
  page?: number;
}

export interface TmdbClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  language?: string;
  /** ISO country code used for now playing and where to watch. */
  region?: string;
}

export interface TmdbClient {
  nowPlaying(page?: number): Promise<MoviePage>;
  trending(window?: "day" | "week", page?: number): Promise<MoviePage>;
  search(query: string, options?: { year?: number; page?: number }): Promise<MoviePage>;
  discover(filters: DiscoverFilters): Promise<MoviePage>;
  details(id: number): Promise<MovieDetails>;
  /** Just the summary for one movie (cached), for matching imported lists. */
  movie(id: number): Promise<MovieSummary>;
  recommendations(id: number, page?: number): Promise<MoviePage>;
  genres(): Promise<Genre[]>;
}

// Raw TMDB shapes (only the fields we read).
interface RawMovie {
  id: number;
  title?: string;
  name?: string;
  release_date?: string | null;
  vote_average?: number;
  vote_count?: number;
  overview?: string;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  original_language?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
}

interface RawPage {
  page: number;
  total_pages: number;
  total_results: number;
  results: RawMovie[];
}

interface RawDetails extends RawMovie {
  runtime?: number | null;
  tagline?: string | null;
  imdb_id?: string | null;
  credits?: {
    cast?: { name: string; character?: string; profile_path?: string | null; order?: number }[];
    crew?: { name: string; job?: string }[];
  };
  videos?: { results?: { key: string; site: string; type: string; official?: boolean }[] };
  "watch/providers"?: {
    results?: Record<
      string,
      {
        link?: string;
        flatrate?: { provider_name: string }[];
        rent?: { provider_name: string }[];
        buy?: { provider_name: string }[];
      }
    >;
  };
}

const SORT_PARAM: Record<SortBy, string> = {
  popularity: "popularity.desc",
  rating: "vote_average.desc",
  release_date: "primary_release_date.desc",
  revenue: "revenue.desc",
};

export function imageUrl(path: string | null, size = "w342"): string | null {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : null;
}

function yearOf(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

export function createTmdbClient(options: TmdbClientOptions): TmdbClient {
  const {
    apiKey,
    fetch: doFetch = globalThis.fetch,
    baseUrl = "https://api.themoviedb.org/3",
    language = "en-US",
    region = "US",
  } = options;
  if (!apiKey) throw new Error("A TMDB API key or read access token is required.");

  const useBearer = apiKey.startsWith("eyJ");
  let genreCache: Promise<Map<number, string>> | null = null;
  const summaryCache = new Map<number, MovieSummary>();
  const SUMMARY_CACHE_MAX = 2000;

  async function request<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(baseUrl + path);
    url.searchParams.set("language", language);
    if (!useBearer) url.searchParams.set("api_key", apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (useBearer) headers.authorization = `Bearer ${apiKey}`;

    const res = await doFetch(url, { headers });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = (await res.json()) as { status_message?: string };
        if (body.status_message) detail = body.status_message;
      } catch {
        // keep the status text
      }
      throw new TmdbError(`TMDB request to ${path} failed (${res.status}): ${detail}`, res.status);
    }
    return (await res.json()) as T;
  }

  function genreMap(): Promise<Map<number, string>> {
    if (!genreCache) {
      genreCache = request<{ genres: Genre[] }>("/genre/movie/list")
        .then((body) => new Map(body.genres.map((g) => [g.id, g.name])))
        .catch((err: unknown) => {
          genreCache = null; // try again next time
          throw err;
        });
    }
    return genreCache;
  }

  function toSummary(raw: RawMovie, genres: Map<number, string>): MovieSummary {
    const genreNames = raw.genres
      ? raw.genres.map((g) => g.name)
      : (raw.genre_ids ?? []).map((id) => genres.get(id)).filter((name): name is string => Boolean(name));
    return {
      id: raw.id,
      title: raw.title ?? raw.name ?? "Untitled",
      year: yearOf(raw.release_date),
      releaseDate: raw.release_date || null,
      rating: Math.round((raw.vote_average ?? 0) * 10) / 10,
      voteCount: raw.vote_count ?? 0,
      overview: raw.overview ?? "",
      genres: genreNames,
      originalLanguage: raw.original_language ?? null,
      posterPath: raw.poster_path ?? null,
      backdropPath: raw.backdrop_path ?? null,
    };
  }

  async function toPage(raw: RawPage): Promise<MoviePage> {
    const genres = await genreMap();
    return {
      page: raw.page,
      totalPages: raw.total_pages,
      totalResults: raw.total_results,
      movies: raw.results.map((m) => toSummary(m, genres)),
    };
  }

  function toProviders(raw: RawDetails): WatchProviders | null {
    const entry = raw["watch/providers"]?.results?.[region];
    if (!entry) return null;
    const names = (list?: { provider_name: string }[]) => (list ?? []).map((p) => p.provider_name);
    return {
      country: region,
      link: entry.link ?? null,
      stream: names(entry.flatrate),
      rent: names(entry.rent),
      buy: names(entry.buy),
    };
  }

  function toTrailerKey(raw: RawDetails): string | null {
    const videos = (raw.videos?.results ?? []).filter((v) => v.site === "YouTube");
    const best =
      videos.find((v) => v.type === "Trailer" && v.official) ??
      videos.find((v) => v.type === "Trailer") ??
      videos.find((v) => v.type === "Teaser");
    return best?.key ?? null;
  }

  return {
    async nowPlaying(page = 1) {
      return toPage(await request<RawPage>("/movie/now_playing", { page, region }));
    },

    async trending(window = "week", page = 1) {
      return toPage(await request<RawPage>(`/trending/movie/${window}`, { page }));
    },

    async search(query, { year, page = 1 } = {}) {
      return toPage(
        await request<RawPage>("/search/movie", { query, primary_release_year: year, page, include_adult: "false" }),
      );
    },

    async discover(filters) {
      const sortBy = filters.sortBy ?? "popularity";
      // Rating sorts surface obscure films with 3 votes unless we require some votes.
      const minVotes = filters.minVotes ?? (sortBy === "rating" ? 300 : 50);
      return toPage(
        await request<RawPage>("/discover/movie", {
          with_genres: filters.genreIds?.join(","),
          without_genres: filters.excludeGenreIds?.join(","),
          "vote_average.gte": filters.minRating,
          "vote_count.gte": minVotes,
          "primary_release_date.gte": filters.yearFrom ? `${filters.yearFrom}-01-01` : undefined,
          "primary_release_date.lte": filters.yearTo ? `${filters.yearTo}-12-31` : undefined,
          "with_runtime.lte": filters.maxRuntime,
          with_original_language: filters.originalLanguage,
          sort_by: SORT_PARAM[sortBy],
          include_adult: "false",
          page: filters.page ?? 1,
        }),
      );
    },

    async details(id) {
      const raw = await request<RawDetails>(`/movie/${id}`, {
        append_to_response: "credits,videos,watch/providers",
      });
      const summary = toSummary(raw, await genreMap());
      const cast: CastMember[] = [...(raw.credits?.cast ?? [])]
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
        .slice(0, 8)
        .map((c) => ({ name: c.name, character: c.character ?? "", profilePath: c.profile_path ?? null }));
      return {
        ...summary,
        runtime: raw.runtime || null,
        tagline: raw.tagline || null,
        director: raw.credits?.crew?.find((c) => c.job === "Director")?.name ?? null,
        cast,
        trailerYoutubeKey: toTrailerKey(raw),
        watchProviders: toProviders(raw),
        imdbId: raw.imdb_id || null,
      };
    },

    async movie(id) {
      const cached = summaryCache.get(id);
      if (cached) return cached;
      const summary = toSummary(await request<RawMovie>(`/movie/${id}`), await genreMap());
      if (summaryCache.size >= SUMMARY_CACHE_MAX) summaryCache.delete(summaryCache.keys().next().value!);
      summaryCache.set(id, summary);
      return summary;
    },

    async recommendations(id, page = 1) {
      return toPage(await request<RawPage>(`/movie/${id}/recommendations`, { page }));
    },

    async genres() {
      const map = await genreMap();
      return [...map.entries()].map(([id, name]) => ({ id, name }));
    },
  };
}
