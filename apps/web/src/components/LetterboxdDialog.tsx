import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, stars, type LetterboxdDiary } from "../api";
import type { ImportSummary, LibraryApi } from "../useLibrary";
import { Icon } from "./Icon";
import { Poster } from "./Poster";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; diary: LetterboxdDiary; summary: ImportSummary };

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function LetterboxdDialog({ open, onClose, library }: { open: boolean; onClose: () => void; library: LibraryApi }) {
  const ref = useRef<HTMLDialogElement>(null);
  const connected = library.library.letterboxd;
  const [username, setUsername] = useState(connected?.username ?? "");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [confirmClear, setConfirmClear] = useState(false);
  const { watched, favorites } = library.library;
  const hasLists = watched.length + favorites.length > 0;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setState({ kind: "idle" });
      setConfirmClear(false);
      setUsername(library.library.letterboxd?.username ?? "");
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function sync(name: string) {
    const clean = name.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?letterboxd\.com\//, "").replace(/\/.*$/, "");
    if (!clean) return;
    setState({ kind: "loading" });
    try {
      const diary = await api.letterboxd(clean);
      const summary = library.importDiary(diary);
      setState({ kind: "done", diary, summary });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Import failed." });
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void sync(username);
  }

  const matched = state.kind === "done" ? state.diary.films.filter((f) => f.movie) : [];

  return (
    <dialog
      ref={ref}
      className="modal lb-dialog"
      aria-labelledby="lb-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="lb-inner">
        <button type="button" className="modal-close" onClick={() => ref.current?.close()} aria-label="Close">
          <Icon name="x" size={20} />
        </button>

        <p className="lb-eyebrow">
          <Icon name="link" size={15} />
          Letterboxd sync
        </p>
        <h2 id="lb-title">{connected ? "Your Letterboxd is connected" : "Bring your Letterboxd"}</h2>
        <p className="muted lb-copy">
          Marquee reads your public diary: what you logged, your star ratings, and your hearts. Your films land in
          Watched, hearts go to Favorites, and the concierge uses your ratings to pick for you. Nothing is posted to
          Letterboxd.
        </p>

        <form className="lb-form" onSubmit={onSubmit}>
          <label htmlFor="lb-username">Letterboxd username</label>
          <div className="lb-row">
            <span className="lb-prefix" aria-hidden="true">
              letterboxd.com/
            </span>
            <input
              id="lb-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your_username"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={80}
            />
            <button type="submit" className="btn btn-primary" disabled={state.kind === "loading" || !username.trim()}>
              <Icon name={connected ? "refresh" : "download"} size={16} />
              {state.kind === "loading" ? "Importing…" : connected ? "Sync" : "Import"}
            </button>
          </div>
        </form>

        <div aria-live="polite">
          {state.kind === "loading" && (
            <p className="lb-status">
              <span className="loader loader-sm" aria-hidden="true" /> Reading your diary and matching films on TMDB…
            </p>
          )}

          {state.kind === "error" && (
            <p className="lb-status lb-error" role="alert">
              <Icon name="alert" size={16} /> {state.message}
            </p>
          )}

          {state.kind === "done" && (
            <div className="lb-done">
              <p className="lb-status lb-ok">
                <Icon name="check" size={16} />
                Synced {plural(matched.length, "film")} from @{state.diary.username}. {state.summary.added} new in Watched,{" "}
                {state.summary.rated} with your stars, {state.summary.liked} new favorites.
              </p>
              {matched.length > 0 && (
                <ul className="lb-strip" aria-label="Imported films">
                  {matched.slice(0, 12).map((f) => (
                    <li key={`${f.tmdbId}-${f.watchedDate}`}>
                      <Poster movie={f.movie!} size="w185" />
                      {f.rating && <span className="lb-stars">{stars(f.rating)}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {state.diary.films.length === 0 && (
                <p className="muted">That diary is empty, or the profile is private. Log a film on Letterboxd and sync again.</p>
              )}
              <p className="muted lb-note">Letterboxd's feed covers your most recent entries, about the last 50.</p>
            </div>
          )}
        </div>

        {(connected || hasLists) && state.kind !== "loading" && (
          <div className="lb-foot">
            {connected ? (
              <a className="link" href={`https://letterboxd.com/${connected.username}/`} target="_blank" rel="noreferrer">
                View @{connected.username} on Letterboxd <Icon name="external" size={14} />
              </a>
            ) : (
              <span />
            )}
            <div className="lb-foot-actions">
              {connected && !confirmClear && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => library.disconnectLetterboxd()}>
                  Disconnect
                </button>
              )}
              {hasLists &&
                (confirmClear ? (
                  <span className="confirm" role="group" aria-label="Confirm clearing your lists">
                    <span>
                      Remove all {watched.length} watched, {favorites.length} favorites, and your ratings?
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => {
                        library.clearAll();
                        setConfirmClear(false);
                        setState({ kind: "idle" });
                      }}
                    >
                      Yes, clear
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(false)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)}>
                    Clear my lists
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
