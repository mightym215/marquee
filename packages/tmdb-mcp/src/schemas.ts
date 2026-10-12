import { z } from "zod";

/** A movie as it appears in lists (search, discover, trending). */
export const movieSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  year: z.number().int().nullable(),
  releaseDate: z.string().nullable(),
  rating: z.number(),
  voteCount: z.number().int(),
  overview: z.string(),
  genres: z.array(z.string()),
  /** ISO 639-1 code of the original language, like "ko" or "ja". */
  originalLanguage: z.string().nullable(),
  posterPath: z.string().nullable(),
  backdropPath: z.string().nullable(),
});

export const castMemberSchema = z.object({
  name: z.string(),
  character: z.string(),
  profilePath: z.string().nullable(),
});

export const watchProvidersSchema = z.object({
  country: z.string(),
  link: z.string().nullable(),
  stream: z.array(z.string()),
  rent: z.array(z.string()),
  buy: z.array(z.string()),
});

/** Everything the details view and the agent need about one movie. */
export const movieDetailsSchema = movieSummarySchema.extend({
  runtime: z.number().int().nullable(),
  tagline: z.string().nullable(),
  director: z.string().nullable(),
  cast: z.array(castMemberSchema),
  trailerYoutubeKey: z.string().nullable(),
  watchProviders: watchProvidersSchema.nullable(),
  imdbId: z.string().nullable(),
});

export const genreSchema = z.object({ id: z.number().int(), name: z.string() });

export const letterboxdFilmSchema = z.object({
  title: z.string(),
  year: z.number().int().nullable(),
  tmdbId: z.number().int().nullable(),
  rating: z.number().nullable(),
  liked: z.boolean(),
  rewatch: z.boolean(),
  watchedDate: z.string().nullable(),
  url: z.string().nullable(),
  movie: movieSummarySchema.nullable(),
});

const blendPersonSchema = z.object({
  username: z.string(),
  profileUrl: z.string(),
  films: z.number().int(),
  topGenres: z.array(z.string()),
  averageRating: z.number().nullable(),
});

export const blendOutput = {
  people: z.tuple([blendPersonSchema, blendPersonSchema]),
  matchPercent: z.number(),
  sharedGenres: z.array(z.string()),
  sharedLoves: z.array(z.object({ movie: movieSummarySchema, ratings: z.tuple([z.number().nullable(), z.number().nullable()]) })),
  picks: z.array(
    z.object({
      movie: movieSummarySchema,
      because: z.array(z.object({ username: z.string(), title: z.string(), rating: z.number().nullable() })),
      score: z.number(),
    }),
  ),
};

export const movieListOutput = { movies: z.array(movieSummarySchema) };
export const letterboxdOutput = {
  username: z.string(),
  profileUrl: z.string(),
  films: z.array(letterboxdFilmSchema),
};
export const movieDetailsOutput = { movie: movieDetailsSchema };
export const genreListOutput = { genres: z.array(genreSchema) };

export type MovieSummary = z.infer<typeof movieSummarySchema>;
export type MovieDetails = z.infer<typeof movieDetailsSchema>;
export type CastMember = z.infer<typeof castMemberSchema>;
export type WatchProviders = z.infer<typeof watchProvidersSchema>;
export type Genre = z.infer<typeof genreSchema>;

export interface MoviePage {
  page: number;
  totalPages: number;
  totalResults: number;
  movies: MovieSummary[];
}
