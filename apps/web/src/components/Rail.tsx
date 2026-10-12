import type { ReactNode } from "react";
import { stars, type MovieSummary } from "../api";
import { Poster } from "./Poster";

/** A horizontal row of posters, used for personal rows on the home page. */
export function Rail({
  title,
  subtitle,
  movies,
  onOpen,
  ratingFor,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  movies: MovieSummary[];
  onOpen: (id: number) => void;
  ratingFor?: (id: number) => number | null;
  action?: ReactNode;
}) {
  if (movies.length === 0) return null;
  return (
    <section className="row" aria-label={typeof title === "string" ? title : undefined}>
      <div className="row-head">
        <div>
          <h2 className="row-title">{title}</h2>
          {subtitle && <p className="row-sub">{subtitle}</p>}
        </div>
        {action}
      </div>
      <ul className="row-rail">
        {movies.map((m) => {
          const mine = ratingFor?.(m.id) ?? null;
          return (
            <li key={m.id}>
              <button type="button" className="row-item" onClick={() => onOpen(m.id)}>
                <span className="row-poster">
                  <Poster movie={m} size="w342" />
                  {mine && <span className="your-stars" aria-label={`You rated it ${mine} out of 5`}>{stars(mine)}</span>}
                </span>
                <span className="row-name">{m.title}</span>
                <span className="row-year">{m.year ?? ""}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
