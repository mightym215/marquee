import { loadLetterboxdDiary, type LetterboxdDiary, type LetterboxdFilm } from "./letterboxd.js";
import type { MovieSummary } from "./schemas.js";
import type { TmdbClient } from "./tmdb.js";

/**
 * Blend: movie night for two. Compares two Letterboxd diaries and finds
 * movies both people are likely to love that neither has logged.
 *
 * 1. Taste vectors: each person's genres, weighted by how they rated films in them.
 * 2. Match percent: cosine similarity of the two vectors.
 * 3. Seeds: each person's top loved films. TMDB recommendations for every seed are pooled,
 *    and a movie scores higher when seeds from BOTH people point to it.
 */

export interface BlendPerson {
  username: string;
  profileUrl: string;
  films: number;
  topGenres: string[];
  averageRating: number | null;
}

export interface BlendPick {
  movie: MovieSummary;
  /** The loved films that led here, from either person. */
  because: { username: string; title: string; rating: number | null }[];
  score: number;
}

export interface BlendResult {
  people: [BlendPerson, BlendPerson];
  matchPercent: number;
  sharedGenres: string[];
  /** Films both people loved (4+ stars or a heart). */
  sharedLoves: { movie: MovieSummary; ratings: [number | null, number | null] }[];
  picks: BlendPick[];
}

const SEEDS_PER_PERSON = 3;
const MAX_PICKS = 12;

function loves(film: LetterboxdFilm): boolean {
  return Boolean(film.movie) && ((film.rating ?? 0) >= 4 || film.liked);
}

/** How much a logged film says about someone's taste: 5 stars counts a lot, 1 star counts against. */
function weight(film: LetterboxdFilm): number {
  return (film.rating ?? 3) - 2 + (film.liked ? 1 : 0);
}

export function tasteVector(films: LetterboxdFilm[]): Map<string, number> {
  const v = new Map<string, number>();
  for (const f of films) {
    for (const genre of f.movie?.genres ?? []) v.set(genre, (v.get(genre) ?? 0) + weight(f));
  }
  return v;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, x] of a) na += Math.max(x, 0) ** 2;
  for (const [, y] of b) nb += Math.max(y, 0) ** 2;
  for (const [genre, x] of a) dot += Math.max(x, 0) * Math.max(b.get(genre) ?? 0, 0);
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function topGenres(v: Map<string, number>, n: number): string[] {
  return [...v.entries()]
    .filter(([, w]) => w > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, n)
    .map(([g]) => g);
}

function seedsFor(diary: LetterboxdDiary): LetterboxdFilm[] {
  const ranked = diary.films
    .filter((f) => f.movie)
    .sort((x, y) => (y.rating ?? (y.liked ? 4 : 3)) - (x.rating ?? (x.liked ? 4 : 3)));
  const loved = ranked.filter(loves);
  const pool = loved.length > 0 ? loved : ranked;
  const unique: LetterboxdFilm[] = [];
  for (const f of pool) {
    if (!unique.some((u) => u.movie!.id === f.movie!.id)) unique.push(f);
    if (unique.length === SEEDS_PER_PERSON) break;
  }
  return unique;
}

function person(diary: LetterboxdDiary, vector: Map<string, number>): BlendPerson {
  const rated = diary.films.filter((f) => f.rating);
  const avg = rated.length ? rated.reduce((s, f) => s + f.rating!, 0) / rated.length : null;
  return {
    username: diary.username,
    profileUrl: diary.profileUrl,
    films: diary.films.length,
    topGenres: topGenres(vector, 3),
    averageRating: avg === null ? null : Math.round(avg * 10) / 10,
  };
}

/** Blends two diaries that are already loaded. Pure apart from TMDB recommendation calls. */
export async function blendLoaded(tmdb: TmdbClient, a: LetterboxdDiary, b: LetterboxdDiary): Promise<BlendResult> {
  const va = tasteVector(a.films);
  const vb = tasteVector(b.films);
  const matchPercent = Math.round(cosine(va, vb) * 100);

  const topA = topGenres(va, 5);
  const topB = new Set(topGenres(vb, 5));
  const sharedGenres = topA
    .filter((g) => topB.has(g))
    .sort((x, y) => (va.get(y)! + vb.get(y)!) - (va.get(x)! + vb.get(x)!))
    .slice(0, 3);

  const lovedB = new Map(b.films.filter(loves).map((f) => [f.movie!.id, f]));
  const sharedLoves: BlendResult["sharedLoves"] = [];
  for (const f of a.films.filter(loves)) {
    const other = lovedB.get(f.movie!.id);
    if (other && !sharedLoves.some((s) => s.movie.id === f.movie!.id)) {
      sharedLoves.push({ movie: f.movie!, ratings: [f.rating, other.rating] });
    }
  }

  const logged = new Set([...a.films, ...b.films].map((f) => f.movie?.id).filter((id): id is number => Boolean(id)));
  const seeds = [
    ...seedsFor(a).map((film) => ({ film, owner: a.username })),
    ...seedsFor(b).map((film) => ({ film, owner: b.username })),
  ];

  const pages = await Promise.all(
    seeds.map(({ film }) => tmdb.recommendations(film.movie!.id).catch(() => ({ movies: [] as MovieSummary[] }))),
  );

  const pool = new Map<number, { movie: MovieSummary; score: number; because: BlendPick["because"]; owners: Set<string> }>();
  pages.forEach((page, i) => {
    const { film, owner } = seeds[i]!;
    page.movies.forEach((movie, rank) => {
      if (logged.has(movie.id)) return;
      const entry = pool.get(movie.id) ?? { movie, score: 0, because: [], owners: new Set<string>() };
      // Higher ranked recommendations from higher rated seeds count more.
      entry.score += 1 + ((film.rating ?? 3.5) - 3) * 0.25 + (page.movies.length - rank) * 0.02;
      if (!entry.because.some((x) => x.title === film.title && x.username === owner)) {
        entry.because.push({ username: owner, title: film.title, rating: film.rating });
      }
      entry.owners.add(owner);
      pool.set(movie.id, entry);
    });
  });

  // Show reasons from both people when there are some, alternating, at most 3.
  const mixReasons = (because: BlendPick["because"]) => {
    const fromA = because.filter((x) => x.username === a.username);
    const fromB = because.filter((x) => x.username !== a.username);
    const mixed: BlendPick["because"] = [];
    for (let i = 0; mixed.length < 3 && (i < fromA.length || i < fromB.length); i++) {
      if (fromA[i]) mixed.push(fromA[i]!);
      if (fromB[i] && mixed.length < 3) mixed.push(fromB[i]!);
    }
    return mixed;
  };

  const picks = [...pool.values()]
    .map((e) => ({
      movie: e.movie,
      because: mixReasons(e.because),
      // Movies both people's favorites point to are the point of a blend.
      score: Math.round((e.score + (e.owners.size === 2 ? 1.5 : 0) + e.movie.rating / 10) * 100) / 100,
    }))
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_PICKS);

  return { people: [person(a, va), person(b, vb)], matchPercent, sharedGenres, sharedLoves, picks };
}

export async function blendDiaries(
  tmdb: TmdbClient,
  usernameA: string,
  usernameB: string,
  doFetch: typeof fetch = globalThis.fetch,
): Promise<BlendResult> {
  const [a, b] = await Promise.all([
    loadLetterboxdDiary(tmdb, usernameA, doFetch),
    loadLetterboxdDiary(tmdb, usernameB, doFetch),
  ]);
  return blendLoaded(tmdb, a, b);
}
