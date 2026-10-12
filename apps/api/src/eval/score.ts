import type { MovieDetails } from "@marquee/tmdb-mcp";
import type { ConciergeResult } from "../agent.js";
import type { EvalCase } from "./cases.js";

export interface CheckResult {
  name: string;
  pass: boolean;
  /** Picks that satisfied a per pick constraint, out of picks checked. */
  hits?: number;
  total?: number;
  detail?: string;
}

export interface CaseScore {
  id: string;
  prompt: string;
  pass: boolean;
  checks: CheckResult[];
  picks: { title: string; year: number | null; grounded: boolean }[];
  steps: number;
  toolCalls: number;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  /** Picks that met every per pick constraint on this case. */
  accuratePicks: number;
  error?: string;
}

/** Scores one agent result. `details` must hold TMDB details for every pick. */
export function scoreCase(c: EvalCase, result: ConciergeResult, details: Map<number, MovieDetails>): CaseScore {
  const checks: CheckResult[] = [];
  const picks = result.picks;
  const e = c.expect;
  const failedPickIds = new Set<number>();

  const perPick = (name: string, ok: (m: MovieDetails) => boolean | null) => {
    let hits = 0;
    let total = 0;
    const misses: string[] = [];
    for (const p of picks) {
      const d = details.get(p.movie.id);
      const verdict = d ? ok(d) : null;
      if (verdict === null) continue; // unknown data (e.g. no runtime on TMDB) is skipped, not failed
      total += 1;
      if (verdict) hits += 1;
      else {
        misses.push(p.movie.title);
        failedPickIds.add(p.movie.id);
      }
    }
    checks.push({
      name,
      pass: hits === total,
      hits,
      total,
      detail: misses.length ? `missed: ${misses.join(", ")}` : undefined,
    });
  };

  if (e.noPicks) {
    checks.push({ name: "declines off topic", pass: picks.length === 0, detail: picks.length ? `${picks.length} picks` : undefined });
  } else {
    const min = e.minPicks ?? 3;
    checks.push({ name: "enough picks", pass: picks.length >= min, detail: `${picks.length} of ${min}` });
  }

  const ungrounded = picks.filter((p) => !p.grounded).length;
  checks.push({
    name: "grounded",
    pass: ungrounded === 0 && result.droppedPicks === 0,
    hits: picks.length - ungrounded,
    total: picks.length + result.droppedPicks,
    detail:
      ungrounded || result.droppedPicks
        ? `${ungrounded} from memory, ${result.droppedPicks} invalid ids`
        : undefined,
  });

  if (c.watchedIds?.length) {
    const seen = new Set(c.watchedIds);
    perPick("skips watched", (m) => !seen.has(m.id));
  }
  if (e.genresAny) perPick(`genre: any of ${e.genresAny.join(", ")}`, (m) => m.genres.some((g) => e.genresAny!.includes(g)));
  if (e.genresAll) perPick(`genre: ${e.genresAll.join(" + ")}`, (m) => e.genresAll!.every((g) => m.genres.includes(g)));
  if (e.yearFrom !== undefined || e.yearTo !== undefined) {
    perPick(`years ${e.yearFrom ?? "any"} to ${e.yearTo ?? "now"}`, (m) =>
      m.year === null ? null : m.year >= (e.yearFrom ?? 0) && m.year <= (e.yearTo ?? 9999),
    );
  }
  if (e.maxRuntime) perPick(`runtime ≤ ${e.maxRuntime} min`, (m) => (m.runtime ? m.runtime <= e.maxRuntime! : null));
  if (e.minRating) perPick(`rating ≥ ${e.minRating}`, (m) => (m.voteCount < 20 ? null : m.rating >= e.minRating!));
  if (e.language) perPick(`language: ${e.language}`, (m) => (m.originalLanguage ? m.originalLanguage === e.language : null));

  return {
    id: c.id,
    prompt: c.prompt,
    pass: checks.every((x) => x.pass),
    checks,
    picks: picks.map((p) => ({ title: p.movie.title, year: p.movie.year, grounded: p.grounded })),
    accuratePicks: picks.filter((p) => p.grounded && !failedPickIds.has(p.movie.id)).length,
    steps: result.steps,
    toolCalls: result.trace.filter((t) => t.tool !== "present_picks").length,
    ms: result.ms,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  };
}
