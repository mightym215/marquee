import type Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { LETTERBOXD_USERNAME, type MovieDetails, type MovieSummary } from "@marquee/tmdb-mcp";
import { z } from "zod";

/** The slice of the Anthropic SDK the agent uses, so tests can pass a fake. */
export interface MessagesClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export const conciergeRequestSchema = z.object({
  message: z.string().trim().min(1, "Ask for something").max(500),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
    .max(12)
    .default([]),
  watched: z.array(z.string().max(200)).max(80).default([]),
  favorites: z.array(z.string().max(200)).max(60).default([]),
  letterboxd: z.string().regex(LETTERBOXD_USERNAME).optional(),
});
export type ConciergeRequest = z.infer<typeof conciergeRequestSchema>;

export interface ToolTrace {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  ms: number;
  summary: string;
}

export interface MoviePick {
  movie: MovieSummary;
  reason: string;
  /** True when the movie came back from a tool call in this run, not from the model's memory. */
  grounded: boolean;
}

export interface ConciergeResult {
  reply: string;
  picks: MoviePick[];
  trace: ToolTrace[];
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
  /** Picks dropped because the id didn't match a real movie. */
  droppedPicks: number;
  ms: number;
}

/** Progress events, so the UI can show the agent working in real time. */
export type ConciergeEvent =
  | { type: "step"; step: number }
  | { type: "tool_start"; id: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_end"; id: string; tool: string; ok: boolean; ms: number; summary: string };

export interface ConciergeOptions {
  anthropic: MessagesClient;
  mcp: Client;
  model: string;
  maxSteps?: number;
  now?: Date;
  onEvent?: (event: ConciergeEvent) => void;
  /** Stops the loop early, for example when the browser disconnects. */
  signal?: AbortSignal;
}

/** Pulls every movie out of a tool's structured output, whatever its shape. */
function collectMovies(structured: unknown, into: Map<number, MovieSummary>): void {
  const s = structured as
    | {
        movies?: MovieSummary[];
        movie?: MovieDetails;
        films?: { movie: MovieSummary | null }[];
        picks?: { movie: MovieSummary }[];
        sharedLoves?: { movie: MovieSummary }[];
      }
    | undefined;
  if (!s) return;
  for (const m of s.movies ?? []) into.set(m.id, m);
  if (s.movie) into.set(s.movie.id, s.movie);
  for (const f of s.films ?? []) if (f.movie) into.set(f.movie.id, f.movie);
  for (const p of s.picks ?? []) into.set(p.movie.id, p.movie);
  for (const p of s.sharedLoves ?? []) into.set(p.movie.id, p.movie);
}

const PRESENT_PICKS = "present_picks";
const MAX_PICKS = 6;

const presentPicksTool: Anthropic.Tool = {
  name: PRESENT_PICKS,
  description:
    "Show your final movie picks to the user as cards. Call this once, after you have found good matches with the " +
    "other tools. Only use movie ids that came from tool results.",
  input_schema: {
    type: "object",
    properties: {
      picks: {
        type: "array",
        minItems: 1,
        maxItems: MAX_PICKS,
        items: {
          type: "object",
          properties: {
            movie_id: { type: "integer", description: "TMDB id from a tool result" },
            reason: { type: "string", description: "One sentence on why it fits this request" },
          },
          required: ["movie_id", "reason"],
        },
      },
    },
    required: ["picks"],
  },
};

const picksInput = z.object({
  picks: z.array(z.object({ movie_id: z.number().int(), reason: z.string() })).min(1),
});

export function systemPrompt(req: Pick<ConciergeRequest, "watched" | "favorites" | "letterboxd">, now: Date): string {
  const list = (items: string[]) => (items.length ? items.slice(0, 60).join("; ") : "none yet");
  const letterboxd = req.letterboxd
    ? [
        `- The user is on Letterboxd as "${req.letterboxd}". Their recent diary and star ratings (out of 5) are already in the watched list below.`,
        "- Lean on their highest rated films: for vague requests, start from a 4.5 or 5 star film with get_recommendations, and mention that connection in your reasons.",
        "- Call get_letterboxd_diary only if you need more than what is listed.",
      ]
    : [];
  return [
    "You are Marquee, a friendly movie concierge. You help people decide what to watch.",
    `Today is ${now.toISOString().slice(0, 10)}.`,
    "",
    "How to work:",
    "- Use the movie tools to find real options. Never recommend or describe a movie that did not come from a tool result.",
    "- Translate moods into filters: 'funny' means Comedy, 'short' means max_runtime_minutes around 105, 'classic' means older years with high ratings.",
    "- For 'like X' requests, search for X first, then call get_recommendations with its id.",
    "- If a 'like X' request adds a twist ('like Interstellar, but funny'), recommendations alone rarely fit it. Also call discover_movies with the twist's genre plus X's main genres, and pick from movies that match both.",
    "- Every pick must meet every hard constraint in the request: genre words ('funny' means Comedy, 'scary' means Horror, 'animated' means Animation), runtime, years, and language. Check each movie's genres and details in the tool results, and leave out any movie that doesn't qualify, even if it's otherwise a great match.",
    "- If a tool returns an error, read it and try again with a fix.",
    "- Skip movies the user has already watched unless they ask for rewatches.",
    `- When you have good matches, call ${PRESENT_PICKS} once with 3 to ${MAX_PICKS} picks, best first, each with a one sentence reason tied to the request.`,
    "- Then reply in 1 to 3 short, warm sentences. Do not repeat the list; the app shows the picks as cards.",
    "- For a movie night with a friend who is on Letterboxd, call blend_letterboxd with both usernames and pick from its results.",
    "- If the request is not about movies, say briefly that you only help with movies.",
    ...letterboxd,
    "",
    `Movies the user has watched: ${list(req.watched)}`,
    `The user's favorites: ${list(req.favorites)}`,
  ].join("\n");
}

/** Keeps history valid for the Messages API: starts with a user turn and alternates roles. */
export function normalizeHistory(history: ConciergeRequest["history"]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const turn of history) {
    const content = turn.content.trim();
    if (!content) continue;
    if (out.length === 0 && turn.role !== "user") continue;
    const last = out.at(-1);
    if (last && last.role === turn.role) last.content = `${String(last.content)}\n\n${content}`;
    else out.push({ role: turn.role, content });
  }
  if (out.at(-1)?.role === "user") out.pop(); // the new message will be the next user turn
  return out;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: "text"; text: string } => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

function summarize(tool: string, structured: unknown, isError: boolean, text: string): string {
  if (isError) return text.slice(0, 140);
  const s = structured as
    | { movies?: unknown[]; movie?: { title?: string }; genres?: unknown[]; films?: unknown[]; matchPercent?: number; picks?: unknown[] }
    | undefined;
  if (s?.movies) return `${s.movies.length} movie${s.movies.length === 1 ? "" : "s"}`;
  if (s?.movie?.title) return s.movie.title;
  if (s?.matchPercent !== undefined) return `${s.matchPercent}% taste match, ${s.picks?.length ?? 0} picks`;
  if (s?.films) return `${s.films.length} diary entries`;
  if (s?.genres) return `${s.genres.length} genres`;
  return tool === PRESENT_PICKS ? "shown" : "done";
}

export async function runConcierge(req: ConciergeRequest, opts: ConciergeOptions): Promise<ConciergeResult> {
  const { anthropic, mcp, model, maxSteps = 6, now = new Date(), onEvent, signal } = opts;
  const startedAt = Date.now();
  const emit = (event: ConciergeEvent) => {
    try {
      onEvent?.(event);
    } catch {
      // a listener failing must never break the agent
    }
  };

  const { tools: mcpTools } = await mcp.listTools();
  const tools: Anthropic.Tool[] = [
    ...mcpTools.map((t) => ({
      name: t.name,
      description: t.description ?? t.title ?? t.name,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    })),
    presentPicksTool,
  ];
  const mcpToolNames = new Set(mcpTools.map((t) => t.name));

  const messages: Anthropic.MessageParam[] = [...normalizeHistory(req.history), { role: "user", content: req.message }];
  const seen = new Map<number, MovieSummary>();
  const trace: ToolTrace[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let requestedPicks: { movie_id: number; reason: string }[] = [];
  let reply = "";
  let steps = 0;

  while (steps < maxSteps) {
    if (signal?.aborted) break;
    steps += 1;
    emit({ type: "step", step: steps });
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt(req, now),
      tools,
      messages,
    });
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) reply = text;

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

    messages.push({ role: "assistant", content: response.content });

    const results = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
        const started = Date.now();
        const args = (use.input ?? {}) as Record<string, unknown>;
        emit({ type: "tool_start", id: use.id, tool: use.name, args });
        const finish = (ok: boolean, summary: string) => {
          const ms = Date.now() - started;
          trace.push({ tool: use.name, args, ok, ms, summary });
          emit({ type: "tool_end", id: use.id, tool: use.name, ok, ms, summary });
        };

        if (use.name === PRESENT_PICKS) {
          const parsed = picksInput.safeParse(args);
          const ok = parsed.success;
          if (ok) requestedPicks = parsed.data.picks.slice(0, MAX_PICKS);
          finish(ok, ok ? `${requestedPicks.length} picks` : "invalid picks");
          return {
            type: "tool_result",
            tool_use_id: use.id,
            content: ok ? "Shown to the user. Now write your short reply." : "Invalid input: send picks as [{movie_id, reason}].",
            is_error: !ok,
          };
        }

        if (!mcpToolNames.has(use.name)) {
          finish(false, "unknown tool");
          return { type: "tool_result", tool_use_id: use.id, content: `Unknown tool ${use.name}`, is_error: true };
        }

        try {
          const result = await mcp.callTool({ name: use.name, arguments: args });
          const isError = Boolean(result.isError);
          const content = textOf(result.content);
          collectMovies(result.structuredContent, seen);
          finish(!isError, summarize(use.name, result.structuredContent, isError, content));
          return { type: "tool_result", tool_use_id: use.id, content, is_error: isError };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Tool failed";
          finish(false, message.slice(0, 140));
          return { type: "tool_result", tool_use_id: use.id, content: message, is_error: true };
        }
      }),
    );

    messages.push({ role: "user", content: results });
  }

  // Resolve picks to full movie data. Ids the agent never saw in a tool result are looked up, not trusted.
  const picks: MoviePick[] = [];
  let droppedPicks = 0;
  for (const { movie_id, reason } of requestedPicks) {
    let movie = seen.get(movie_id);
    const grounded = Boolean(movie);
    if (!movie) {
      try {
        const result = await mcp.callTool({ name: "get_movie_details", arguments: { movie_id } });
        movie = result.isError ? undefined : (result.structuredContent as { movie?: MovieDetails } | undefined)?.movie;
      } catch {
        movie = undefined;
      }
    }
    if (!movie) droppedPicks += 1;
    else if (!picks.some((p) => p.movie.id === movie.id)) picks.push({ movie, reason, grounded });
  }

  if (!reply) {
    reply = picks.length
      ? "Here are a few I think you'll like."
      : "I couldn't find a good match for that. Try describing a mood, a genre, or a movie you loved.";
  }

  return { reply, picks, trace, steps, usage, droppedPicks, ms: Date.now() - startedAt };
}
