/**
 * Eval cases for the concierge. Each one is a real request plus checks a
 * correct answer has to pass. Constraints are checked against TMDB data for
 * every pick, so the agent can't pass by sounding confident.
 */

export interface EvalExpect {
  /** At least this many picks (default 3). */
  minPicks?: number;
  /** The agent should decline and show no picks (off topic requests). */
  noPicks?: boolean;
  /** Every pick has at least one of these genres. */
  genresAny?: string[];
  /** Every pick has all of these genres. */
  genresAll?: string[];
  yearFrom?: number;
  yearTo?: number;
  /** Every pick runs at most this many minutes. */
  maxRuntime?: number;
  /** Every pick has at least this TMDB rating. */
  minRating?: number;
  /** Every pick's original language (ISO 639-1). */
  language?: string;
}

export interface EvalCase {
  id: string;
  prompt: string;
  /** Sent as the user's watched list, the way the app sends it. */
  watched?: string[];
  /** TMDB ids that must never be picked (already watched). */
  watchedIds?: number[];
  expect: EvalExpect;
}

const thisYear = new Date().getFullYear();

export const CASES: EvalCase[] = [
  { id: "interstellar-but-funny", prompt: "Something like Interstellar, but funny", expect: { genresAny: ["Comedy"] } },
  { id: "cozy-under-2h", prompt: "A cozy movie under 2 hours", expect: { maxRuntime: 120 } },
  {
    id: "korean-thrillers",
    prompt: "The best Korean thrillers",
    expect: { language: "ko", genresAny: ["Thriller", "Crime", "Mystery"], minRating: 7 },
  },
  { id: "90s-classic", prompt: "A 90s classic I probably missed", expect: { yearFrom: 1990, yearTo: 1999, minRating: 7 } },
  { id: "family-animation", prompt: "Animated movies for a family movie night", expect: { genresAll: ["Animation"] } },
  { id: "2010s-horror", prompt: "A horror movie from the 2010s", expect: { genresAll: ["Horror"], yearFrom: 2010, yearTo: 2019 } },
  {
    id: "like-parasite-already-seen",
    prompt: "Something like Parasite",
    watched: ["Parasite (2019), 5 stars"],
    watchedIds: [496243],
    expect: {},
  },
  { id: "music-documentary", prompt: "A great music documentary", expect: { genresAll: ["Documentary"] } },
  {
    id: "2000s-romcom",
    prompt: "A romantic comedy from the 2000s",
    expect: { genresAll: ["Romance", "Comedy"], yearFrom: 2000, yearTo: 2009 },
  },
  { id: "war-under-150", prompt: "A war movie under two and a half hours", expect: { genresAll: ["War"], maxRuntime: 150 } },
  {
    id: "japanese-animation-seen",
    prompt: "Japanese animated films like Spirited Away",
    watched: ["Spirited Away (2001), 5 stars"],
    watchedIds: [129],
    expect: { language: "ja", genresAll: ["Animation"] },
  },
  { id: "pre-1985-scifi", prompt: "Science fiction from before 1985", expect: { genresAll: ["Science Fiction"], yearTo: 1984 } },
  {
    id: "more-space-skip-seen",
    prompt: "More space movies like the ones I've watched",
    watched: ["Interstellar (2014), 5 stars", "The Martian (2015), 4 stars", "Arrival (2016), 4.5 stars"],
    watchedIds: [157336, 286217, 329865],
    expect: { genresAny: ["Science Fiction"] },
  },
  { id: "western", prompt: "A western worth watching", expect: { genresAll: ["Western"] } },
  { id: "short-mystery", prompt: "A mystery under 100 minutes", expect: { genresAll: ["Mystery"], maxRuntime: 100 } },
  { id: "off-topic", prompt: "What's the capital of France?", expect: { noPicks: true } },
  { id: "french-romance", prompt: "A French romance", expect: { language: "fr", genresAll: ["Romance"] } },
  {
    id: "70s-crime",
    prompt: "Highly rated crime movies from the 70s",
    expect: { genresAll: ["Crime"], yearFrom: 1970, yearTo: 1979, minRating: 7.5 },
  },
  { id: "recent-and-good", prompt: "Something good that came out in the last two years", expect: { yearFrom: thisYear - 2 } },
  {
    id: "2000s-heist",
    prompt: "A smart heist movie from the 2000s",
    expect: { genresAny: ["Crime", "Thriller", "Action"], yearFrom: 2000, yearTo: 2009 },
  },
  {
    id: "from-my-ratings",
    prompt: "Pick something based on my 5 star films",
    watched: ["Arrival (2016), 5 stars", "Knives Out (2019), 5 stars", "The Martian (2015), 2 stars"],
    watchedIds: [329865, 546554, 286217],
    expect: {},
  },
];
