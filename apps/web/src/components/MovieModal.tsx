import { useEffect, useRef, useState } from "react";
import { api, img, links, stars, type MovieDetails, type MovieSummary } from "../api";
import type { LibraryApi } from "../useLibrary";
import { Icon } from "./Icon";
import { Rating, ShelfButtons } from "./MovieCard";
import { Poster } from "./Poster";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function runtime(min: number | null): string | null {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function MovieModal({
  movieId,
  library,
  onClose,
  onOpen,
}: {
  movieId: number | null;
  library: LibraryApi;
  onClose: () => void;
  onOpen: (id: number) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [movie, setMovie] = useState<MovieDetails | null>(null);
  const [similar, setSimilar] = useState<MovieSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [trailer, setTrailer] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (movieId !== null && !dialog.open) dialog.showModal();
    if (movieId === null && dialog.open) dialog.close();
  }, [movieId]);

  useEffect(() => {
    if (movieId === null) return;
    let live = true;
    setMovie(null);
    setSimilar([]);
    setError(null);
    setTrailer(false);
    ref.current?.scrollTo({ top: 0 });
    api
      .details(movieId)
      .then((m) => live && setMovie(m))
      .catch((e: Error) => live && setError(e.message));
    api
      .recommendations(movieId)
      .then((p) => live && setSimilar(p.movies.slice(0, 8)))
      .catch(() => live && setSimilar([]));
    return () => {
      live = false;
    };
  }, [movieId]);

  const backdrop = movie ? img(movie.backdropPath, "w1280") : null;
  const mine = movie ? library.ratingFor(movie.id) : null;

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="modal-inner">
        <button type="button" className="modal-close" onClick={() => ref.current?.close()} aria-label="Close details">
          <Icon name="x" size={20} />
        </button>

        {error && (
          <div className="modal-state" role="alert">
            <Icon name="alert" size={22} />
            <p>{error}</p>
          </div>
        )}

        {!movie && !error && (
          <div className="modal-state" aria-live="polite">
            <span className="loader" aria-hidden="true" />
            <p>Loading details…</p>
          </div>
        )}

        {movie && (
          <>
            <div className="modal-hero" style={backdrop ? { backgroundImage: `url(${backdrop})` } : undefined}>
              <div className="modal-hero-fade" />
            </div>
            <div className="modal-head">
              <Poster movie={movie} size="w342" className="modal-poster" />
              <div className="modal-titles">
                <h2 id="modal-title">{movie.title}</h2>
                {movie.tagline && <p className="tagline">{movie.tagline}</p>}
                <p className="facts">
                  {movie.year && <span>{movie.year}</span>}
                  {runtime(movie.runtime) && (
                    <span>
                      <Icon name="clock" size={14} /> {runtime(movie.runtime)}
                    </span>
                  )}
                  <Rating value={movie.rating} />
                  {mine && (
                    <span className="your-rating" aria-label={`You rated it ${mine} out of 5 on Letterboxd`}>
                      You: {stars(mine)}
                    </span>
                  )}
                </p>
                <ul className="genre-list" aria-label="Genres">
                  {movie.genres.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
                <div className="modal-actions">
                  {movie.trailerYoutubeKey && (
                    <button type="button" className="btn btn-primary" onClick={() => setTrailer((t) => !t)} aria-expanded={trailer}>
                      <Icon name="play" size={16} filled />
                      {trailer ? "Hide trailer" : "Play trailer"}
                    </button>
                  )}
                  <ShelfButtons movie={movie} library={library} />
                </div>
                <p className="ext-links">
                  <a href={links.letterboxd(movie.id)} target="_blank" rel="noreferrer">
                    Letterboxd <Icon name="external" size={13} />
                  </a>
                  {movie.imdbId && (
                    <a href={links.imdb(movie.imdbId)} target="_blank" rel="noreferrer">
                      IMDb <Icon name="external" size={13} />
                    </a>
                  )}
                  <a href={links.tmdb(movie.id)} target="_blank" rel="noreferrer">
                    TMDB <Icon name="external" size={13} />
                  </a>
                </p>
              </div>
            </div>

            {trailer && movie.trailerYoutubeKey && (
              <div className="trailer">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${movie.trailerYoutubeKey}?autoplay=1&rel=0`}
                  title={`${movie.title} trailer`}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}

            <div className="modal-body">
              <section>
                <h3>Overview</h3>
                <p className="overview">{movie.overview || "No overview yet."}</p>
              </section>

              {movie.cast.length > 0 && (
                <section>
                  <h3>Cast</h3>
                  <ul className="cast">
                    {movie.cast.slice(0, 8).map((c) => {
                      const photo = img(c.profilePath, "w185");
                      return (
                        <li key={c.name}>
                          {photo ? (
                            <img src={photo} alt="" loading="lazy" className="cast-photo" />
                          ) : (
                            <span className="cast-photo cast-initials" aria-hidden="true">
                              {initials(c.name)}
                            </span>
                          )}
                          <span className="cast-name">{c.name}</span>
                          {c.character && <span className="cast-role">{c.character}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              <div className="modal-cols">
                <section>
                  <h3>Director</h3>
                  <p>{movie.director ?? "Unknown"}</p>
                </section>

                <section>
                  <h3>Where to watch</h3>
                  {movie.watchProviders && (movie.watchProviders.stream.length || movie.watchProviders.rent.length) ? (
                    <div className="providers">
                      {movie.watchProviders.stream.length > 0 && (
                        <p>
                          <span className="provider-kind">Stream</span>
                          {movie.watchProviders.stream.join(", ")}
                        </p>
                      )}
                      {movie.watchProviders.rent.length > 0 && (
                        <p>
                          <span className="provider-kind">Rent</span>
                          {movie.watchProviders.rent.slice(0, 4).join(", ")}
                        </p>
                      )}
                      {movie.watchProviders.link && (
                        <a className="link" href={movie.watchProviders.link} target="_blank" rel="noreferrer">
                          All options <Icon name="external" size={14} />
                        </a>
                      )}
                    </div>
                  ) : (
                    <p className="muted">No streaming info for the US yet.</p>
                  )}
                </section>
              </div>

              {similar.length > 0 && (
                <section>
                  <h3>More like this</h3>
                  <ul className="rail">
                    {similar.map((m) => (
                      <li key={m.id}>
                        <button type="button" onClick={() => onOpen(m.id)} className="rail-item">
                          <Poster movie={m} size="w185" />
                          <span>{m.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
