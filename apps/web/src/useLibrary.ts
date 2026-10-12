import { useCallback, useEffect, useState } from "react";
import type { LetterboxdDiary, MovieSummary } from "./api";

type Shelf = "watched" | "favorites";

interface Library {
  watched: MovieSummary[];
  favorites: MovieSummary[];
  /** Your star ratings (0.5 to 5) by TMDB id, from Letterboxd. */
  ratings: Record<string, number>;
  letterboxd: { username: string; syncedAt: string } | null;
}

export interface ImportSummary {
  films: number;
  added: number;
  rated: number;
  liked: number;
}

const KEY = "marquee-library-v2";
const OLD_KEY = "marquee-library-v1";
const EMPTY: Library = { watched: [], favorites: [], ratings: {}, letterboxd: null };

function load(): Library {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<Library>) };
  } catch {
    // private mode or corrupted storage: start fresh
  }
  return EMPTY;
}

function slim(movie: MovieSummary): MovieSummary {
  const { id, title, year, releaseDate, rating, voteCount, overview, genres, originalLanguage, posterPath, backdropPath } = movie;
  return { id, title, year, releaseDate, rating, voteCount, overview, genres, originalLanguage: originalLanguage ?? null, posterPath, backdropPath };
}

/** Watched, favorites, and Letterboxd ratings, saved in this browser. */
export function useLibrary() {
  const [library, setLibrary] = useState<Library>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(library));
    } catch {
      // storage full or blocked; the session still works
    }
  }, [library]);

  const has = useCallback((shelf: Shelf, id: number) => library[shelf].some((m) => m.id === id), [library]);
  const ratingFor = useCallback((id: number): number | null => library.ratings[id] ?? null, [library]);

  const toggle = useCallback((shelf: Shelf, movie: MovieSummary) => {
    setLibrary((lib) => {
      const exists = lib[shelf].some((m) => m.id === movie.id);
      return { ...lib, [shelf]: exists ? lib[shelf].filter((m) => m.id !== movie.id) : [slim(movie), ...lib[shelf]] };
    });
  }, []);

  /** Merges a Letterboxd diary in: films go to Watched (newest first), stars to ratings, hearts to Favorites. */
  const importDiary = useCallback(
    (diary: LetterboxdDiary): ImportSummary => {
      const matched = diary.films.filter((f) => f.movie);
      const fresh = new Map(matched.map((f) => [f.movie!.id, slim(f.movie!)]));
      // Existing entries get the fresh data too, so a re-sync fixes old posters and details.
      const refresh = (list: MovieSummary[]) => list.map((m) => fresh.get(m.id) ?? m);
      const watched = refresh(library.watched);
      const favorites = refresh(library.favorites);
      const watchedIds = new Set(watched.map((m) => m.id));
      const favIds = new Set(favorites.map((m) => m.id));
      const newWatched: MovieSummary[] = [];
      const newFavs: MovieSummary[] = [];
      const ratings = { ...library.ratings };
      for (const film of matched) {
        const movie = fresh.get(film.movie!.id)!;
        if (!watchedIds.has(movie.id)) {
          watchedIds.add(movie.id);
          newWatched.push(movie);
        }
        if (film.rating) ratings[movie.id] = film.rating;
        if (film.liked && !favIds.has(movie.id)) {
          favIds.add(movie.id);
          newFavs.push(movie);
        }
      }
      setLibrary({
        watched: [...newWatched, ...watched],
        favorites: [...newFavs, ...favorites],
        ratings,
        letterboxd: { username: diary.username, syncedAt: new Date().toISOString() },
      });
      return {
        films: diary.films.length,
        added: newWatched.length,
        rated: matched.filter((f) => f.rating).length,
        liked: newFavs.length,
      };
    },
    [library],
  );

  /** Swaps in fresher data (like posters) for movies already in your lists. */
  const refreshMovies = useCallback((updates: MovieSummary[]) => {
    if (updates.length === 0) return;
    const fresh = new Map(updates.map((m) => [m.id, slim(m)]));
    setLibrary((lib) => ({
      ...lib,
      watched: lib.watched.map((m) => fresh.get(m.id) ?? m),
      favorites: lib.favorites.map((m) => fresh.get(m.id) ?? m),
    }));
  }, []);

  /** Wipes watched, favorites, ratings, and the Letterboxd connection from this browser. */
  const clearAll = useCallback(() => setLibrary(EMPTY), []);

  const disconnectLetterboxd = useCallback(() => setLibrary((lib) => ({ ...lib, letterboxd: null })), []);

  return { library, has, ratingFor, toggle, importDiary, refreshMovies, clearAll, disconnectLetterboxd };
}

export type LibraryApi = ReturnType<typeof useLibrary>;
