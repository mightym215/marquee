import { stars, type MovieSummary } from "../api";
import type { LibraryApi } from "../useLibrary";
import { Icon } from "./Icon";
import { Poster } from "./Poster";

export function ShelfButtons({ movie, library, compact = false }: { movie: MovieSummary; library: LibraryApi; compact?: boolean }) {
  const fav = library.has("favorites", movie.id);
  const seen = library.has("watched", movie.id);
  return (
    <div className={`shelf ${compact ? "shelf-compact" : ""}`}>
      <button
        type="button"
        className="icon-toggle fav"
        aria-pressed={fav}
        aria-label={fav ? `Remove ${movie.title} from favorites` : `Add ${movie.title} to favorites`}
        title={fav ? "Favorited" : "Favorite"}
        onClick={() => library.toggle("favorites", movie)}
      >
        <Icon name="heart" size={17} filled={fav} />
      </button>
      <button
        type="button"
        className="icon-toggle seen"
        aria-pressed={seen}
        aria-label={seen ? `Mark ${movie.title} as not watched` : `Mark ${movie.title} as watched`}
        title={seen ? "Watched" : "Mark watched"}
        onClick={() => library.toggle("watched", movie)}
      >
        <Icon name={seen ? "check" : "eye"} size={17} />
      </button>
    </div>
  );
}

export function Rating({ value }: { value: number }) {
  if (!value) return <span className="rating rating-none">Not rated</span>;
  return (
    <span className="rating" aria-label={`Rated ${value.toFixed(1)} out of 10`}>
      <Icon name="star" size={13} filled />
      {value.toFixed(1)}
    </span>
  );
}

export function MovieCard({ movie, library, onOpen }: { movie: MovieSummary; library: LibraryApi; onOpen: (id: number) => void }) {
  const mine = library.ratingFor(movie.id);
  return (
    <article className="card">
      <button type="button" className="card-hit" onClick={() => onOpen(movie.id)} aria-label={`${movie.title}, open details`}>
        <Poster movie={movie} />
        {mine && (
          <span className="your-stars" aria-label={`You rated it ${mine} out of 5`}>
            {stars(mine)}
          </span>
        )}
      </button>
      <div className="card-body">
        <h3 className="card-title">
          <button type="button" onClick={() => onOpen(movie.id)}>
            {movie.title}
          </button>
        </h3>
        <p className="card-meta">
          <span>{movie.year ?? "TBA"}</span>
          <Rating value={movie.rating} />
        </p>
      </div>
      <ShelfButtons movie={movie} library={library} compact />
    </article>
  );
}
