import type { BlendResult, LetterboxdDiary, LetterboxdFilm, MovieDetails, MoviePage, MovieSummary } from "@marquee/tmdb-mcp";

export type { BlendResult, LetterboxdDiary, LetterboxdFilm, MovieDetails, MoviePage, MovieSummary };

export type AgentEvent =
  | { type: "step"; step: number }
  | { type: "tool_start"; id: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_end"; id: string; tool: string; ok: boolean; ms: number; summary: string };

export interface ConciergeBody {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  watched: string[];
  favorites: string[];
  letterboxd?: string;
}

export interface ToolTrace {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  ms: number;
  summary: string;
}

export interface ConciergeResult {
  reply: string;
  picks: { movie: MovieSummary; reason: string; grounded: boolean }[];
  trace: ToolTrace[];
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
  droppedPicks: number;
  ms: number;
}

export interface Health {
  ok: boolean;
  demo: boolean;
  concierge: boolean;
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
}

export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`);
  return body;
}

export const api = {
  health: () => call<Health>("/api/health"),
  tools: () => call<{ tools: McpTool[] }>("/api/tools"),
  list: (list: "now_playing" | "trending", page: number) => call<MoviePage>(`/api/movies?list=${list}&page=${page}`),
  search: (q: string, page: number) => call<MoviePage>(`/api/search?q=${encodeURIComponent(q)}&page=${page}`),
  details: (id: number) => call<MovieDetails>(`/api/movies/${id}`),
  recommendations: (id: number) => call<MoviePage>(`/api/movies/${id}/recommendations`),
  letterboxd: (username: string) => call<LetterboxdDiary>(`/api/letterboxd/${encodeURIComponent(username)}`),
  blend: (a: string, b: string) =>
    call<BlendResult>(`/api/blend?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
  concierge: (body: ConciergeBody) =>
    call<ConciergeResult>("/api/concierge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  /** Streams the agent's steps as server-sent events, then resolves with the final result. */
  async conciergeStream(body: ConciergeBody, onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<ConciergeResult> {
    let res: Response;
    try {
      res = await fetch("/api/concierge/stream", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      throw new ApiError("Can't reach the server. Check your connection and try again.");
    }
    if (!res.ok || !res.body) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(err.error ?? `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split: number;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const event = chunk.match(/^event: (.+)$/m)?.[1];
        const data = chunk.match(/^data: (.+)$/m)?.[1];
        if (!event || !data) continue; // keep-alive comments
        const payload = JSON.parse(data);
        if (event === "done") return payload as ConciergeResult;
        if (event === "error") throw new ApiError((payload as { error: string }).error);
        onEvent(payload as AgentEvent);
      }
    }
    throw new ApiError("The connection closed before the concierge finished. Try again.");
  },
};

export type ImageSize = "w92" | "w185" | "w342" | "w500" | "w780" | "w1280";

export function img(path: string | null, size: ImageSize = "w342"): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

export function label(movie: Pick<MovieSummary, "title" | "year">): string {
  return movie.year ? `${movie.title} (${movie.year})` : movie.title;
}

/** 4.5 becomes ★★★★½ */
export function stars(rating: number): string {
  const full = Math.floor(rating);
  return "★".repeat(full) + (rating - full >= 0.5 ? "½" : "");
}

export const links = {
  letterboxd: (tmdbId: number) => `https://letterboxd.com/tmdb/${tmdbId}/`,
  tmdb: (tmdbId: number) => `https://www.themoviedb.org/movie/${tmdbId}`,
  imdb: (imdbId: string) => `https://www.imdb.com/title/${imdbId}/`,
};
