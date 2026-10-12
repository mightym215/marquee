import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, stars, type Health, type McpTool, type MovieSummary } from "./api";
import { BlendDialog } from "./components/BlendDialog";
import { Concierge, SUGGESTIONS } from "./components/Concierge";
import { Icon } from "./components/Icon";
import { LetterboxdDialog } from "./components/LetterboxdDialog";
import { MovieCard } from "./components/MovieCard";
import { MovieModal } from "./components/MovieModal";
import { Rail } from "./components/Rail";
import { useLibrary } from "./useLibrary";

type View = "now_playing" | "trending" | "watched" | "favorites";
type Sort = "default" | "title" | "newest" | "rating";

const VIEWS: { id: View; label: string }[] = [
  { id: "now_playing", label: "Now playing" },
  { id: "trending", label: "Trending" },
  { id: "favorites", label: "Favorites" },
  { id: "watched", label: "Watched" },
];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function sortMovies(movies: MovieSummary[], sort: Sort): MovieSummary[] {
  if (sort === "default") return movies;
  const copy = [...movies];
  if (sort === "title") copy.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "newest") copy.sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
  if (sort === "rating") copy.sort((a, b) => b.rating - a.rating);
  return copy;
}

export default function App() {
  const library = useLibrary();
  const [health, setHealth] = useState<Health | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);

  const [view, setView] = useState<View>("now_playing");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 350);
  const [sort, setSort] = useState<Sort>("default");

  const [movies, setMovies] = useState<MovieSummary[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<number | null>(null);
  const [conciergeOpen, setConciergeOpen] = useState(false);
  const [seed, setSeed] = useState<{ text: string; n: number } | null>(null);
  const [ask, setAsk] = useState("");
  const [lbOpen, setLbOpen] = useState(false);
  const [blendOpen, setBlendOpen] = useState(false);
  const [because, setBecause] = useState<MovieSummary[]>([]);

  const shelfView = !q && (view === "watched" || view === "favorites");
  const { watched, favorites, letterboxd } = library.library;

  // Fill in posters for saved movies that don't have one (for example, entries saved in demo mode).
  const posterTried = useRef(new Set<number>());
  useEffect(() => {
    if (!health || health.demo) return;
    const missing = [...watched, ...favorites]
      .filter((m) => !m.posterPath && !posterTried.current.has(m.id))
      .slice(0, 40);
    if (missing.length === 0) return;
    for (const m of missing) posterTried.current.add(m.id);
    // Not cancelled when the lists change: refreshMovies merges by id, so late results are still safe to apply.
    (async () => {
      const found: MovieSummary[] = [];
      for (let i = 0; i < missing.length; i += 4) {
        const batch = await Promise.all(missing.slice(i, i + 4).map((m) => api.details(m.id).catch(() => null)));
        for (const d of batch) if (d?.posterPath) found.push(d);
      }
      library.refreshMovies(found);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health, watched, favorites]);

  // The film to build "Because you..." on: your latest 4+ star watch, else your latest favorite.
  const anchor = useMemo(() => {
    const rated = watched.find((m) => (library.ratingFor(m.id) ?? 0) >= 4);
    if (rated) return { movie: rated, rating: library.ratingFor(rated.id) };
    const fav = favorites[0];
    return fav ? { movie: fav, rating: null } : null;
  }, [watched, favorites, library]);

  useEffect(() => {
    if (!anchor) {
      setBecause([]);
      return;
    }
    let live = true;
    const seen = new Set(watched.map((m) => m.id));
    api
      .recommendations(anchor.movie.id)
      .then((p) => live && setBecause(p.movies.filter((m) => !seen.has(m.id)).slice(0, 12)))
      .catch(() => live && setBecause([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor?.movie.id]);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ ok: false, demo: false, concierge: false }));
    api.tools().then((r) => setTools(r.tools)).catch(() => setTools([]));
  }, []);

  useEffect(() => {
    if (shelfView) return;
    let live = true;
    setLoading(true);
    setError(null);
    const request = q ? api.search(q, 1) : api.list(view as "now_playing" | "trending", 1);
    request
      .then((res) => {
        if (!live) return;
        setMovies(res.movies);
        setPage(res.page);
        setTotalPages(res.totalPages);
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [q, view, shelfView]);

  async function loadMore() {
    setLoading(true);
    try {
      const next = page + 1;
      const res = q ? await api.search(q, next) : await api.list(view as "now_playing" | "trending", next);
      setMovies((cur) => {
        const ids = new Set(cur.map((m) => m.id));
        return [...cur, ...res.movies.filter((m) => !ids.has(m.id))];
      });
      setPage(res.page);
      setTotalPages(res.totalPages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load more.");
    } finally {
      setLoading(false);
    }
  }

  const shown = useMemo(
    () => sortMovies(shelfView ? library.library[view as "watched" | "favorites"] : movies, sort),
    [shelfView, library.library, view, movies, sort],
  );

  function openConcierge(text?: string) {
    if (text?.trim()) setSeed({ text: text.trim(), n: Date.now() });
    setConciergeOpen(true);
  }

  function onAsk(e: FormEvent) {
    e.preventDefault();
    openConcierge(ask);
    setAsk("");
  }

  const heading = q ? `Results for “${q}”` : VIEWS.find((v) => v.id === view)!.label;

  return (
    <>
      <a href="#movies" className="skip-link">
        Skip to movies
      </a>

      <header className="topbar">
        <div className="wrap topbar-inner">
          <a href="/" className="logo" aria-label="Marquee home">
            <span className="logo-mark" aria-hidden="true">
              M
            </span>
            <span className="logo-word">Marquee</span>
          </a>
          <div className="search">
            <Icon name="search" size={17} className="search-icon" />
            <label htmlFor="search" className="sr-only">
              Search movies
            </label>
            <input
              id="search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search movies"
              autoComplete="off"
            />
            {query && (
              <button type="button" className="search-clear" onClick={() => setQuery("")} aria-label="Clear search">
                <Icon name="x" size={15} />
              </button>
            )}
          </div>
          <button
            type="button"
            className={`btn btn-ghost lb-btn ${letterboxd ? "is-connected" : ""}`}
            onClick={() => setLbOpen(true)}
            aria-label={letterboxd ? `Letterboxd connected as ${letterboxd.username}` : "Connect Letterboxd"}
          >
            <Icon name={letterboxd ? "user" : "link"} size={16} />
            <span>{letterboxd ? `@${letterboxd.username}` : "Letterboxd"}</span>
          </button>
          <button type="button" className="btn btn-primary ask-btn" onClick={() => openConcierge()}>
            <Icon name="sparkles" size={16} />
            <span>Ask Marquee</span>
          </button>
        </div>
      </header>

      {health?.demo && (
        <p className="demo-bar">
          Demo mode: sample movie data, no posters. Add a TMDB key to go live.
        </p>
      )}

      <main>
        {!q && (
          <section className="hero" aria-labelledby="hero-title">
            <div className="wrap">
              <div className="sign">
                <span className="bulbs bulbs-top" aria-hidden="true" />
                <p className="sign-eyebrow">Now showing: your next favorite movie</p>
                <h1 id="hero-title">What are you in the mood for?</h1>
                <form className="ask" onSubmit={onAsk}>
                  <label htmlFor="ask" className="sr-only">
                    Describe the movie you want
                  </label>
                  <input
                    id="ask"
                    value={ask}
                    onChange={(e) => setAsk(e.target.value)}
                    placeholder="Something like Interstellar, but funny"
                    maxLength={500}
                    autoComplete="off"
                  />
                  <button type="submit" className="btn btn-primary">
                    <Icon name="sparkles" size={16} />
                    Ask
                  </button>
                </form>
                <div className="chips chips-center">
                  {SUGGESTIONS.slice(1).map((s) => (
                    <button key={s} type="button" className="chip" onClick={() => openConcierge(s)}>
                      {s}
                    </button>
                  ))}
                </div>
                <span className="bulbs bulbs-bottom" aria-hidden="true" />
              </div>
            </div>
          </section>
        )}

        {!q && (
          <div className="wrap personal">
            {!letterboxd && watched.length === 0 && (
              <div className="lb-banner">
                <div>
                  <p className="lb-banner-title">Already on Letterboxd?</p>
                  <p className="muted">
                    Sync your diary and Marquee learns your taste from your star ratings. Picks get personal right away.
                  </p>
                </div>
                <button type="button" className="btn btn-primary" onClick={() => setLbOpen(true)}>
                  <Icon name="link" size={16} />
                  Connect Letterboxd
                </button>
              </div>
            )}

            <div className="blend-card">
              <span className="blend-card-icon" aria-hidden="true">
                <Icon name="ticket" size={22} />
              </span>
              <div>
                <p className="blend-card-title">Movie night for two</p>
                <p className="muted">
                  Blend your Letterboxd with a friend's. See your taste match and find something you'll both love.
                </p>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setBlendOpen(true)}>
                Start a blend
                <Icon name="arrowRight" size={16} />
              </button>
            </div>

            {anchor && (
              <Rail
                title={
                  anchor.rating ? (
                    <>
                      Because you gave {anchor.movie.title} <span className="row-stars">{stars(anchor.rating)}</span>
                    </>
                  ) : (
                    <>Because you loved {anchor.movie.title}</>
                  )
                }
                subtitle="Recommendations you haven't logged yet"
                movies={because}
                onOpen={setOpenId}
                action={
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => openConcierge(`More like ${anchor.movie.title}, but surprise me`)}
                  >
                    <Icon name="sparkles" size={14} />
                    Ask for more
                  </button>
                }
              />
            )}

            {watched.length > 0 && (
              <Rail
                title="Your recent watches"
                subtitle={letterboxd ? `Synced from @${letterboxd.username} on Letterboxd` : "Movies you marked watched"}
                movies={watched.slice(0, 12)}
                onOpen={setOpenId}
                ratingFor={library.ratingFor}
              />
            )}
          </div>
        )}

        <section className="wrap listing" id="movies" aria-labelledby="listing-title">
          <div className="toolbar">
            {q ? (
              <h2 id="listing-title" className="listing-title">
                {heading}
              </h2>
            ) : (
              <>
                <h2 id="listing-title" className="sr-only">
                  {heading}
                </h2>
                <div className="tabs" role="group" aria-label="Choose a list">
                  {VIEWS.map((v) => {
                    const count = v.id === "watched" || v.id === "favorites" ? library.library[v.id].length : null;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className="tab"
                        aria-pressed={view === v.id}
                        onClick={() => setView(v.id)}
                      >
                        {v.label}
                        {count !== null && <span className="tab-count">{count}</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <label className="sort">
              <span>Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="default">{q ? "Best match" : shelfView ? "Recently added" : "Popular"}</option>
                <option value="title">Title, A to Z</option>
                <option value="newest">Release date, newest</option>
                <option value="rating">Rating, highest</option>
              </select>
            </label>
          </div>

          {error && (
            <div className="empty" role="alert">
              <Icon name="alert" size={22} />
              <p>{error}</p>
            </div>
          )}

          {!error && shown.length === 0 && !loading && (
            <div className="empty">
              <Icon name={shelfView ? "popcorn" : "search"} size={24} />
              {shelfView ? (
                <>
                  <p>
                    {view === "favorites" ? "No favorites yet." : "Nothing marked as watched yet."} Tap the{" "}
                    {view === "favorites" ? "heart" : "eye"} on any movie to add it here.
                  </p>
                  {!letterboxd && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLbOpen(true)}>
                      <Icon name="download" size={14} />
                      Or import from Letterboxd
                    </button>
                  )}
                </>
              ) : (
                <p>No movies match “{q}”. Try a different title, or ask Marquee to find something by mood.</p>
              )}
            </div>
          )}

          <ul className="grid" aria-busy={loading}>
            {shown.map((m) => (
              <li key={m.id}>
                <MovieCard movie={m} library={library} onOpen={setOpenId} />
              </li>
            ))}
          </ul>

          {loading && shown.length === 0 && (
            <ul className="grid" aria-hidden="true">
              {Array.from({ length: 10 }, (_, i) => (
                <li key={i} className="skeleton" />
              ))}
            </ul>
          )}

          {!shelfView && !error && page < totalPages && shown.length > 0 && (
            <div className="more">
              <button type="button" className="btn btn-ghost" onClick={loadMore} disabled={loading}>
                {loading ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </section>
        <section className="maker" aria-labelledby="maker-title">
          <div className="wrap maker-inner">
            <p className="maker-eyebrow">From the builder</p>
            <h2 id="maker-title">Why I built Marquee</h2>
            <div className="maker-copy">
              <p>
                I love movies. They're how I escape. Even if it's only for 30 minutes, I get to live alongside the characters
                for a while, and honestly that feels like an honor. I also love the other side of watching: catching the
                details a director put there on purpose and figuring out why.
              </p>
              <p>
                Marquee is the movie friend I always wanted. It knows what I've loved on Letterboxd, and when I say
                “something like Interstellar, but funny,” it actually gets it.
              </p>
            </div>
            <p className="maker-sign">
              <span>Michael Mensah</span>
              <a href="https://github.com/mightym215/marquee" target="_blank" rel="noreferrer">
                Code on GitHub <Icon name="external" size={13} />
              </a>
              <a href="https://www.linkedin.com/in/michaelkwasimensah" target="_blank" rel="noreferrer">
                LinkedIn <Icon name="external" size={13} />
              </a>
            </p>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <p>
            Movie data from <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">TMDB</a>. This product uses
            the TMDB API but is not endorsed or certified by TMDB.
          </p>
          <p>
            Built by <a href="https://github.com/mightym215" target="_blank" rel="noreferrer">Michael Mensah</a> with React,
            Express, MCP, and Claude. Diary sync reads public Letterboxd feeds; Marquee isn't affiliated with Letterboxd.
          </p>
        </div>
      </footer>

      <MovieModal movieId={openId} library={library} onClose={() => setOpenId(null)} onOpen={setOpenId} />
      <Concierge
        open={conciergeOpen}
        seed={seed}
        onClose={() => setConciergeOpen(false)}
        library={library}
        onOpenMovie={setOpenId}
        health={health}
        tools={tools}
        onConnectLetterboxd={() => setLbOpen(true)}
      />
      <LetterboxdDialog open={lbOpen} onClose={() => setLbOpen(false)} library={library} />
      <BlendDialog
        open={blendOpen}
        onClose={() => setBlendOpen(false)}
        library={library}
        onOpenMovie={setOpenId}
        onAsk={(prompt) => {
          setBlendOpen(false);
          openConcierge(prompt);
        }}
      />
    </>
  );
}
