import { useEffect, useState } from 'react';
import {
  championHue,
  championIconUrl,
  championInitials,
  championPortraitUrl,
} from '../domain/champions.ts';
import type { Champion } from '../domain/types.ts';

interface ChampionArtProps {
  champion: Champion;
  /** `portrait` uses tall face-focused loading art, `icon` uses the square. */
  variant: 'portrait' | 'icon';
  className?: string;
}

/**
 * Champion art with a graceful degradation path.
 *
 * Data Dragon is a third-party CDN: it can be blocked, offline, or simply not
 * have art for a champion the CSV names. Rather than leaving a broken image,
 * the card falls back to a deterministic colored plate with the champion's
 * initials, so the draft stays readable either way.
 */
export function ChampionArt({ champion, variant, className }: ChampionArtProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const src = variant === 'portrait' ? championPortraitUrl(champion) : championIconUrl(champion);

  // Reset when the card is recycled for a different champion.
  useEffect(() => {
    setStatus('loading');
  }, [src]);

  if (!champion.id) {
    return <span className="pick-fallback" aria-hidden="true">—</span>;
  }

  return (
    <>
      {status !== 'loaded' && (
        <span className="pick-fallback" aria-hidden="true">
          {championInitials(champion)}
        </span>
      )}
      {status !== 'failed' && (
        <img
          className={[className, status === 'loaded' ? 'is-loaded' : ''].filter(Boolean).join(' ')}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('failed')}
        />
      )}
    </>
  );
}

/** Inline style hook so art-less cards still get a distinct color. */
export function championStyle(champion: Champion): React.CSSProperties {
  return { ['--pick-hue' as string]: String(championHue(champion)) };
}
