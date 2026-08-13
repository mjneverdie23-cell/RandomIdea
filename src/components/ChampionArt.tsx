import { useEffect, useState } from 'react';
import {
  championHue,
  championIconSources,
  championInitials,
  championPortraitSources,
} from '../domain/champions.ts';
import type { Champion } from '../domain/types.ts';

interface ChampionArtProps {
  champion: Champion;
  /** `portrait` uses tall face-cropped loading art, `icon` the square face. */
  variant: 'portrait' | 'icon';
  className?: string;
}

/**
 * Champion art with a source chain and a graceful floor.
 *
 * Tries the downloaded local copy first, then Riot's CDN, then gives up and
 * renders a deterministic colored plate with the champion's initials. The CDN
 * can be blocked, offline, or simply missing art for a champion the CSV names,
 * and a broken image in the middle of a draft is worse than a colored tile.
 */
export function ChampionArt({ champion, variant, className }: ChampionArtProps) {
  const sources = variant === 'portrait'
    ? championPortraitSources(champion)
    : championIconSources(champion);

  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // Reset when the card is recycled for a different champion.
  const key = `${champion.id}:${variant}`;
  useEffect(() => {
    setIndex(0);
    setLoaded(false);
  }, [key]);

  const src = sources[index];
  const exhausted = index >= sources.length;

  return (
    <>
      {!loaded && (
        <span className="pick-fallback" aria-hidden="true">
          {champion.id ? championInitials(champion) : '—'}
        </span>
      )}
      {!exhausted && src && (
        <img
          key={src}
          className={[className, loaded ? 'is-loaded' : ''].filter(Boolean).join(' ')}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setIndex((current) => current + 1)}
        />
      )}
    </>
  );
}

/** Inline style hook so art-less cards still get a distinct color. */
export function championStyle(champion: Champion): React.CSSProperties {
  return { ['--pick-hue' as string]: String(championHue(champion)) };
}
