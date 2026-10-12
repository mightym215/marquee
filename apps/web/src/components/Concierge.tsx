import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, label, type AgentEvent, type ConciergeResult, type Health, type McpTool, type ToolTrace } from "../api";
import type { LibraryApi } from "../useLibrary";
import { Icon } from "./Icon";
import { Rating, ShelfButtons } from "./MovieCard";
import { Poster } from "./Poster";

export const SUGGESTIONS = [
  "Something like Interstellar, but funny",
  "A cozy movie under 2 hours",
  "The best Korean thrillers",
  "A 90s classic I probably missed",
];

/** Claude sometimes writes *Title* or **bold**. Show those as real italics and bold instead of raw asterisks. */
function Formatted({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (/^\*\*[^*\n]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (/^\*[^*\s][^*\n]*\*$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
        return part;
      })}
    </>
  );
}

interface LiveStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  state: "running" | "ok" | "fail";
  summary?: string;
}

type Turn =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; state: "loading"; steps: LiveStep[]; thinking: number }
  | { id: number; role: "assistant"; state: "done"; result: ConciergeResult }
  | { id: number; role: "assistant"; state: "error"; error: string };

const LANGUAGES: Record<string, string> = {
  ko: "Korean", ja: "Japanese", fr: "French", es: "Spanish", hi: "Hindi", it: "Italian", de: "German", zh: "Chinese", en: "English",
};

/** Plain English for what the agent is doing right now. */
export function describeStep(tool: string, args: Record<string, unknown>): string {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (tool) {
    case "search_movies":
      return `Searching for “${str(args.query)}”`;
    case "discover_movies": {
      const parts: string[] = [];
      const genres = Array.isArray(args.genres) ? (args.genres as string[]) : [];
      if (genres.length) parts.push(genres.join(" + "));
      const lang = str(args.original_language);
      if (lang) parts.push(LANGUAGES[lang] ?? lang.toUpperCase());
      if (args.year_from || args.year_to) parts.push(`${args.year_from ?? "…"} to ${args.year_to ?? "now"}`);
      if (args.max_runtime_minutes) parts.push(`under ${args.max_runtime_minutes} min`);
      if (args.min_rating) parts.push(`rated ${args.min_rating}+`);
      return parts.length ? `Browsing ${parts.join(" · ")}` : "Browsing movies";
    }
    case "get_movie_details":
      return "Checking the details";
    case "get_recommendations":
      return "Finding what fans of it also love";
    case "get_trending":
      return "Checking what's trending";
    case "get_letterboxd_diary":
      return `Reading @${str(args.username).replace(/^@/, "")}'s Letterboxd`;
    case "blend_letterboxd":
      return `Blending @${str(args.username_a).replace(/^@/, "")} and @${str(args.username_b).replace(/^@/, "")}`;
    case "list_genres":
      return "Looking up genres";
    case "present_picks":
      return "Choosing the best picks";
    default:
      return tool;
  }
}

function LiveSteps({ steps, thinking }: { steps: LiveStep[]; thinking: number }) {
  return (
    <div className="bubble bubble-bot live">
      <ol className="live-steps">
        {steps.map((s) => (
          <li key={s.id} className={`live-${s.state}`}>
            <span className="live-icon" aria-hidden="true">
              {s.state === "running" ? <span className="loader loader-xs" /> : <Icon name={s.state === "ok" ? "check" : "x"} size={13} />}
            </span>
            <span className="live-text">{describeStep(s.tool, s.args)}</span>
            {s.summary && s.tool !== "present_picks" && <span className="live-summary">{s.summary}</span>}
          </li>
        ))}
        {steps.every((s) => s.state !== "running") && (
          <li className="live-running">
            <span className="live-icon" aria-hidden="true">
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
            </span>
            <span className="live-text">{thinking <= 1 && steps.length === 0 ? "Reading your request" : "Thinking"}</span>
          </li>
        )}
      </ol>
    </div>
  );
}

function argsText(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  const text = parts.join(" · ");
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

function Trace({ trace, steps }: { trace: ToolTrace[]; steps: number }) {
  if (trace.length === 0) return null;
  const total = trace.reduce((sum, t) => sum + t.ms, 0);
  return (
    <details className="trace">
      <summary>
        <Icon name="tool" size={14} />
        How I found these · {trace.length} tool call{trace.length === 1 ? "" : "s"} over {steps} step{steps === 1 ? "" : "s"} ·{" "}
        {total < 1000 ? `${total} ms` : `${(total / 1000).toFixed(1)}s`} in tools
      </summary>
      <ol>
        {trace.map((t, i) => (
          <li key={i} className={t.ok ? "" : "trace-fail"}>
            <code>{t.tool}</code>
            {Object.keys(t.args).length > 0 && t.tool !== "present_picks" && <span className="trace-args">{argsText(t.args)}</span>}
            <span className="trace-out">
              {t.ok ? "→" : "✕"} {t.summary}
            </span>
            <span className="trace-ms">{t.ms} ms</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function Concierge({
  open,
  seed,
  onClose,
  library,
  onOpenMovie,
  health,
  tools,
  onConnectLetterboxd,
}: {
  onConnectLetterboxd: () => void;
  open: boolean;
  seed: { text: string; n: number } | null;
  onClose: () => void;
  library: LibraryApi;
  onOpenMovie: (id: number) => void;
  health: Health | null;
  tools: McpTool[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const nextId = useRef(1);
  const lastSeed = useRef(0);
  const enabled = health?.concierge ?? false;
  const busy = turns.some((t) => t.role === "assistant" && t.state === "loading");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy || !enabled) return;

    const history = turns.flatMap((t): { role: "user" | "assistant"; content: string }[] => {
      if (t.role === "user") return [{ role: "user", content: t.text }];
      if (t.state === "done") return [{ role: "assistant", content: t.result.reply }];
      return [];
    });
    const userTurn: Turn = { id: nextId.current++, role: "user", text: message };
    const pendingId = nextId.current++;
    setTurns((all) => [...all, userTurn, { id: pendingId, role: "assistant", state: "loading", steps: [], thinking: 0 }]);
    setDraft("");

    const onEvent = (e: AgentEvent) =>
      setTurns((all) =>
        all.map((t) => {
          if (t.id !== pendingId || t.role !== "assistant" || t.state !== "loading") return t;
          if (e.type === "step") return { ...t, thinking: e.step };
          if (e.type === "tool_start") {
            return { ...t, steps: [...t.steps, { id: e.id, tool: e.tool, args: e.args, state: "running" }] };
          }
          return {
            ...t,
            steps: t.steps.map((s) => (s.id === e.id ? { ...s, state: e.ok ? "ok" : "fail", summary: e.summary } : s)),
          };
        }),
      );

    try {
      const result = await api.conciergeStream({
        message,
        history: history.slice(-10),
        watched: library.library.watched.slice(0, 80).map((m) => {
          const mine = library.ratingFor(m.id);
          return mine ? `${label(m)}, ${mine} stars` : label(m);
        }),
        favorites: library.library.favorites.slice(0, 60).map(label),
        letterboxd: library.library.letterboxd?.username,
      }, onEvent);
      setTurns((all) => all.map((t) => (t.id === pendingId ? { id: pendingId, role: "assistant", state: "done", result } : t)));
    } catch (err) {
      const error = err instanceof Error ? err.message : "Something went wrong.";
      setTurns((all) => all.map((t) => (t.id === pendingId ? { id: pendingId, role: "assistant", state: "error", error } : t)));
    }
  }

  useEffect(() => {
    if (open && seed && seed.n !== lastSeed.current && health) {
      lastSeed.current = seed.n;
      void send(seed.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed, health]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby="concierge-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="drawer-inner">
        <header className="drawer-head">
          <div>
            <h2 id="concierge-title">
              <Icon name="sparkles" size={18} /> Ask Marquee
            </h2>
            <p className="drawer-sub">
              <Icon name="plug" size={13} /> Claude + {tools.length || 7} movie tools over MCP
            </p>
          </div>
          <div className="drawer-head-actions">
            {turns.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTurns([])} disabled={busy}>
                New chat
              </button>
            )}
            <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Close concierge">
              <Icon name="x" size={20} />
            </button>
          </div>
        </header>

        <div className="drawer-list" ref={listRef} aria-live="polite">
          {turns.length === 0 && (
            <div className="drawer-empty">
              <p className="drawer-empty-title">What are you in the mood for?</p>
              <p className="muted">
                Describe a vibe, a length, an era, or a movie you loved. I search TMDB live and skip what you've already
                watched.
              </p>
              {!enabled && health && (
                <p className="notice" role="note">
                  The concierge needs an Anthropic API key on the server. Browsing, search, and your lists still work.
                </p>
              )}
              {library.library.letterboxd ? (
                <p className="lb-connected">
                  <Icon name="check" size={14} /> Using your Letterboxd ratings from @{library.library.letterboxd.username}
                </p>
              ) : (
                <button type="button" className="lb-cta" onClick={onConnectLetterboxd}>
                  <Icon name="link" size={16} />
                  <span>
                    <b>Connect Letterboxd</b> for picks based on your ratings
                  </span>
                  <Icon name="arrowRight" size={16} />
                </button>
              )}
              <div className="chips">
                {(library.library.letterboxd ? ["Pick something based on my 5 star films", ...SUGGESTIONS.slice(0, 3)] : SUGGESTIONS).map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => void send(s)} disabled={!enabled}>
                    {s}
                  </button>
                ))}
              </div>
              {tools.length > 0 && (
                <div className="tool-list">
                  <p className="tool-list-head">Tools the agent can call</p>
                  <ul>
                    {tools.map((t) => (
                      <li key={t.name} title={t.description}>
                        <code>{t.name}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {turns.map((t) => {
            if (t.role === "user") {
              return (
                <div key={t.id} className="bubble bubble-user">
                  {t.text}
                </div>
              );
            }
            if (t.state === "loading") {
              return <LiveSteps key={t.id} steps={t.steps} thinking={t.thinking} />;
            }
            if (t.state === "error") {
              return (
                <div key={t.id} className="bubble bubble-bot bubble-error" role="alert">
                  <Icon name="alert" size={16} /> {t.error}
                </div>
              );
            }
            const { result } = t;
            return (
              <div key={t.id} className="bot-turn">
                <div className="bubble bubble-bot">
                  <Formatted text={result.reply} />
                </div>
                {result.picks.length > 0 && (
                  <ul className="picks">
                    {result.picks.map(({ movie, reason }) => (
                      <li key={movie.id} className="pick">
                        <button type="button" className="pick-poster" onClick={() => onOpenMovie(movie.id)} aria-label={`${movie.title}, open details`}>
                          <Poster movie={movie} size="w185" />
                        </button>
                        <div className="pick-body">
                          <p className="pick-title">
                            <button type="button" onClick={() => onOpenMovie(movie.id)}>
                              {movie.title}
                            </button>
                            <span className="pick-year">{movie.year}</span>
                          </p>
                          <Rating value={movie.rating} />
                          <p className="pick-reason">
                            <Formatted text={reason} />
                          </p>
                        </div>
                        <ShelfButtons movie={movie} library={library} compact />
                      </li>
                    ))}
                  </ul>
                )}
                <Trace trace={result.trace} steps={result.steps} />
              </div>
            );
          })}
        </div>

        <form className="drawer-form" onSubmit={onSubmit}>
          <label htmlFor="concierge-input" className="sr-only">
            Ask for a movie
          </label>
          <input
            id="concierge-input"
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={enabled ? "Try: a smart heist movie from the 2000s" : "Concierge is off on this server"}
            maxLength={500}
            disabled={!enabled}
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary" disabled={!enabled || busy || !draft.trim()} aria-label="Send">
            <Icon name="send" size={16} />
          </button>
        </form>
      </div>
    </dialog>
  );
}
