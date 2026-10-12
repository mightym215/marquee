import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { api, type BlendResult } from "../api";
import type { LibraryApi } from "../useLibrary";
import { Icon } from "./Icon";
import { Rating } from "./MovieCard";
import { Poster } from "./Poster";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; blend: BlendResult };

const clean = (u: string) =>
  u.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?letterboxd\.com\//, "").replace(/\/.*$/, "");

function matchWord(pct: number): string {
  if (pct >= 85) return "Basically the same person";
  if (pct >= 70) return "Great movie night match";
  if (pct >= 50) return "Plenty of common ground";
  if (pct >= 30) return "Opposites, with some overlap";
  return "Wildly different tastes";
}

export function BlendDialog({
  open,
  onClose,
  library,
  onOpenMovie,
  onAsk,
}: {
  open: boolean;
  onClose: () => void;
  library: LibraryApi;
  onOpenMovie: (id: number) => void;
  onAsk: (prompt: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [you, setYou] = useState("");
  const [friend, setFriend] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setYou((cur) => cur || library.library.letterboxd?.username || "");
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const a = clean(you);
    const b = clean(friend);
    if (!a || !b) return;
    setState({ kind: "loading" });
    try {
      setState({ kind: "done", blend: await api.blend(a, b) });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Blend failed." });
    }
  }

  const blend = state.kind === "done" ? state.blend : null;
  const [a, b] = blend?.people ?? [];

  return (
    <dialog
      ref={ref}
      className="modal blend-dialog"
      aria-labelledby="blend-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="lb-inner">
        <button type="button" className="modal-close" onClick={() => ref.current?.close()} aria-label="Close">
          <Icon name="x" size={20} />
        </button>
        <p className="lb-eyebrow blend-eyebrow">
          <Icon name="ticket" size={15} />
          Blend
        </p>
        <h2 id="blend-title">Movie night for two</h2>
        <p className="muted lb-copy">
          Put two Letterboxd accounts together. Marquee compares your ratings, finds what you both love, and picks movies
          neither of you has logged that you'll both enjoy.
        </p>

        <form className="blend-form" onSubmit={onSubmit}>
          <div className="blend-field">
            <label htmlFor="blend-a">You</label>
            <input id="blend-a" value={you} onChange={(e) => setYou(e.target.value)} placeholder="your_username" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={80} />
          </div>
          <span className="blend-plus" aria-hidden="true">
            +
          </span>
          <div className="blend-field">
            <label htmlFor="blend-b">Your friend</label>
            <input id="blend-b" value={friend} onChange={(e) => setFriend(e.target.value)} placeholder="their_username" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={80} />
          </div>
          <button type="submit" className="btn btn-primary blend-go" disabled={state.kind === "loading" || !you.trim() || !friend.trim()}>
            <Icon name="sparkles" size={16} />
            {state.kind === "loading" ? "Blending…" : "Blend"}
          </button>
        </form>

        <div aria-live="polite">
          {state.kind === "loading" && (
            <p className="lb-status">
              <span className="loader loader-sm" aria-hidden="true" /> Reading both diaries and comparing tastes…
            </p>
          )}
          {state.kind === "error" && (
            <p className="lb-status lb-error" role="alert">
              <Icon name="alert" size={16} /> {state.message}
            </p>
          )}
        </div>

        {blend && a && b && (
          <div className="blend-result">
            <div className="match">
              <div className="match-ring" style={{ "--pct": blend.matchPercent } as CSSProperties} aria-hidden="true">
                <span>{blend.matchPercent}%</span>
              </div>
              <div>
                <p className="match-title">
                  {blend.matchPercent}% taste match · {matchWord(blend.matchPercent)}
                </p>
                <p className="muted">
                  {blend.sharedGenres.length
                    ? `You both gravitate toward ${blend.sharedGenres.join(", ")}.`
                    : "Your favorite genres barely overlap, so these picks bridge the gap."}
                </p>
                <ul className="people">
                  {[a, b].map((p) => (
                    <li key={p.username}>
                      <a href={p.profileUrl} target="_blank" rel="noreferrer">
                        @{p.username}
                      </a>
                      <span>
                        {p.topGenres.join(", ") || "not enough ratings yet"}
                        {p.averageRating ? ` · averages ${p.averageRating}★` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {blend.sharedLoves.length > 0 && (
              <section className="blend-section">
                <h3>You both loved</h3>
                <ul className="lb-strip">
                  {blend.sharedLoves.slice(0, 8).map(({ movie, ratings }) => (
                    <li key={movie.id}>
                      <button type="button" className="strip-btn" onClick={() => onOpenMovie(movie.id)} aria-label={`${movie.title}, open details`}>
                        <Poster movie={movie} size="w185" />
                      </button>
                      <span className="lb-stars" aria-label={`Rated ${ratings[0] ?? "liked"} and ${ratings[1] ?? "liked"}`}>
                        {ratings[0] ? `${ratings[0]}★` : "♥"} · {ratings[1] ? `${ratings[1]}★` : "♥"}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="blend-section">
              <div className="blend-picks-head">
                <h3>Watch together</h3>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onAsk(`Movie night with @${a.username} and @${b.username} on Letterboxd. Which one should we watch tonight?`)}
                >
                  <Icon name="sparkles" size={14} />
                  Ask Marquee to choose
                </button>
              </div>
              {blend.picks.length === 0 ? (
                <p className="muted">You two have seen everything we'd suggest. Impressive. Try asking Marquee for something new.</p>
              ) : (
                <ul className="together">
                  {blend.picks.slice(0, 8).map((p) => {
                    const reasons = p.because.slice(0, 2).map((x) => `@${x.username} loved ${x.title}`);
                    return (
                      <li key={p.movie.id}>
                        <button type="button" className="together-item" onClick={() => onOpenMovie(p.movie.id)}>
                          <Poster movie={p.movie} size="w185" />
                          <span className="together-body">
                            <span className="together-title">
                              {p.movie.title} <span className="pick-year">{p.movie.year}</span>
                            </span>
                            <Rating value={p.movie.rating} />
                            <span className="together-why">Because {reasons.join(" and ")}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </dialog>
  );
}
