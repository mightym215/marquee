import type { MovieSummary } from "./schemas.js";
import type { TmdbClient } from "./tmdb.js";

/**
 * Reads a Letterboxd member's public diary from their RSS feed
 * (https://letterboxd.com/<username>/rss/). Letterboxd has no open API, but
 * every public profile publishes this feed, and it carries the TMDB id for
 * each film, so entries map straight onto TMDB data.
 * The feed holds recent activity only (roughly the last 50 entries).
 */

export interface LetterboxdEntry {
  title: string;
  year: number | null;
  tmdbId: number | null;
  /** Stars from 0.5 to 5, or null when the member didn't rate it. */
  rating: number | null;
  liked: boolean;
  rewatch: boolean;
  watchedDate: string | null;
  url: string | null;
}

export interface LetterboxdFilm extends LetterboxdEntry {
  /** TMDB data for the film, when it could be matched. */
  movie: MovieSummary | null;
}

export interface LetterboxdDiary {
  username: string;
  profileUrl: string;
  films: LetterboxdFilm[];
}

export class LetterboxdError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LetterboxdError";
  }
}

export const LETTERBOXD_USERNAME = /^[A-Za-z0-9_]{2,40}$/;

export function letterboxdFilmUrl(tmdbId: number): string {
  return `https://letterboxd.com/tmdb/${tmdbId}/`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#039": "'", "#39": "'" };

function decode(text: string): string {
  return text
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      const lower = code.toLowerCase();
      if (ENTITIES[lower]) return ENTITIES[lower];
      if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
      return match;
    })
    .trim();
}

function tag(item: string, name: string): string | null {
  const escaped = name.replace(":", "\\:");
  const match = item.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "i"));
  return match ? decode(match[1] ?? "") : null;
}

/** Turns the feed XML into diary entries. List posts and other non-film items are skipped. */
export function parseLetterboxdRss(xml: string): LetterboxdEntry[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const entries: LetterboxdEntry[] = [];
  for (const item of items) {
    const title = tag(item, "letterboxd:filmTitle");
    if (!title) continue;
    const year = Number.parseInt(tag(item, "letterboxd:filmYear") ?? "", 10);
    const tmdbId = Number.parseInt(tag(item, "tmdb:movieId") ?? "", 10);
    const rating = Number.parseFloat(tag(item, "letterboxd:memberRating") ?? "");
    entries.push({
      title,
      year: Number.isFinite(year) ? year : null,
      tmdbId: Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null,
      rating: Number.isFinite(rating) && rating > 0 ? rating : null,
      liked: (tag(item, "letterboxd:memberLike") ?? "").toLowerCase() === "yes",
      rewatch: (tag(item, "letterboxd:rewatch") ?? "").toLowerCase() === "yes",
      watchedDate: tag(item, "letterboxd:watchedDate"),
      url: tag(item, "link"),
    });
  }
  return entries;
}

export async function fetchLetterboxdEntries(
  username: string,
  doFetch: typeof fetch = globalThis.fetch,
): Promise<LetterboxdEntry[]> {
  if (!LETTERBOXD_USERNAME.test(username)) {
    throw new LetterboxdError("That doesn't look like a Letterboxd username. Use letters, numbers, and underscores.", 400);
  }
  const res = await doFetch(`https://letterboxd.com/${username}/rss/`, {
    headers: { accept: "application/rss+xml, application/xml;q=0.9", "user-agent": "Marquee/1.0 (movie concierge)" },
  });
  if (res.status === 404) throw new LetterboxdError(`No public Letterboxd profile named "${username}".`, 404);
  if (!res.ok) throw new LetterboxdError(`Letterboxd didn't respond (${res.status}). Try again in a moment.`, 502);
  return parseLetterboxdRss(await res.text());
}

/** Runs async work over items with a small concurrency limit, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Fetches a member's diary and matches every film to TMDB. Uses the TMDB id
 * from the feed when present, otherwise searches by title and year.
 */
export async function loadLetterboxdDiary(
  tmdb: TmdbClient,
  username: string,
  doFetch: typeof fetch = globalThis.fetch,
): Promise<LetterboxdDiary> {
  const entries = await fetchLetterboxdEntries(username, doFetch);
  const films = await mapLimit(entries, 6, async (entry): Promise<LetterboxdFilm> => {
    try {
      if (entry.tmdbId) return { ...entry, movie: await tmdb.movie(entry.tmdbId) };
      const { movies } = await tmdb.search(entry.title, { year: entry.year ?? undefined });
      const movie = movies[0] ?? null;
      return { ...entry, tmdbId: movie?.id ?? null, movie };
    } catch {
      return { ...entry, movie: null };
    }
  });
  return { username, profileUrl: `https://letterboxd.com/${username}/`, films };
}
