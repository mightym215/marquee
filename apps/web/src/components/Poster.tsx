import { useState, type CSSProperties } from "react";
import { img, type MovieSummary } from "../api";
import { Icon } from "./Icon";

/** A poster image, or a titled placeholder when TMDB has no poster. */
export function Poster({
  movie,
  size = "w342",
  className = "",
}: {
  movie: Pick<MovieSummary, "id" | "title" | "posterPath">;
  size?: "w185" | "w342" | "w500";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = img(movie.posterPath, size);

  if (!src || failed) {
    return (
      <div className={`poster poster-empty ${className}`} style={{ "--hue": (movie.id * 47) % 360 } as CSSProperties}>
        <Icon name="film" size={22} />
        <span>{movie.title}</span>
      </div>
    );
  }
  return <img className={`poster ${className}`} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
