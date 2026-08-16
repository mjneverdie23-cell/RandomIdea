import { useCallback, useEffect, useRef, useState } from 'react';
import {
  championHue,
  championIconSources,
  championInitials,
  championPortraitSources,
} from '../domain/champions.ts';
import type { Champion } from '../domain/types.ts';

/** A dropped connection shouldn't cost a card its art for the rest of the run. */
const ATTEMPTS_PER_SOURCE = 2;
const RETRY_DELAY_MS = 450;

interface ChampionArtProps {
  champion: Champion;
  /** `portrait` uses tall face-cropped loading art, `icon` the square face. */
  variant: 'portrait' | 'icon';
  className?: string;
}

interface LoadState {
  /** Champion + variant this state belongs to. */
  identity: string;
  /** Which entry of the source chain is being tried. */
  index: number;
  /** Attempt number for the current source. */
  attempt: number;
  loaded: boolean;
}

/**
 * Champion art with a source chain, a retry, and a graceful floor.
 *
 * Tries the downloaded local copy, then Riot's CDN, then gives up and renders a
 * deterministic colored plate with the champion's initials. Two details matter
 * more than they look:
 *
 * - Each source gets a second attempt. Ten portraits load per question, and a
 *   single dropped request used to strand that card on its initials for the
 *   rest of the quiz — which reads as art randomly failing.
 * - A cached image can finish loading before React attaches `onLoad`, so the
 *   event never fires and the art would sit at opacity 0 behind the fallback.
 *   The ref callback asks the element what actually happened.
 */
export function ChampionArt({ champion, variant, className }: ChampionArtProps) {
  const sources =
    variant === 'portrait' ? championPortraitSources(champion) : championIconSources(champion);
  const identity = `${champion.id}:${variant}`;

  const [state, setState] = useState<LoadState>(() => ({
    identity,
    index: 0,
    attempt: 0,
    loaded: false,
  }));

  // Reset during render rather than in an effect, so a recycled card never
  // paints the previous champion's art for a frame.
  if (state.identity !== identity) {
    setState({ identity, index: 0, attempt: 0, loaded: false });
  }

  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  const markLoaded = useCallback(() => {
    setState((current) => (current.loaded ? current : { ...current, loaded: true }));
  }, []);

  const handleError = useCallback(() => {
    setState((current) => {
      if (current.loaded) return current;
      if (current.attempt + 1 < ATTEMPTS_PER_SOURCE) {
        // Same source, one more go — most failures here are transient.
        return { ...current, attempt: current.attempt + 1 };
      }
      return { ...current, index: current.index + 1, attempt: 0 };
    });
  }, []);

  const attachImage = useCallback(
    (node: HTMLImageElement | null) => {
      if (!node || !node.complete) return;
      if (node.naturalWidth > 0) markLoaded();
      else handleError();
    },
    [markLoaded, handleError],
  );

  const src = state.identity === identity ? sources[state.index] : undefined;

  return (
    <>
      {!state.loaded && (
        <span className="pick-fallback" aria-hidden="true">
          {champion.id ? championInitials(champion) : '—'}
        </span>
      )}
      {src && (
        <img
          key={`${src}#${state.attempt}`}
          ref={attachImage}
          className={[className, state.loaded ? 'is-loaded' : ''].filter(Boolean).join(' ')}
          src={src}
          alt=""
          /* The draft is the point of the page — don't defer its portraits. */
          loading={variant === 'portrait' ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={markLoaded}
          onError={() => {
            if (retryTimer.current) clearTimeout(retryTimer.current);
            retryTimer.current = setTimeout(handleError, RETRY_DELAY_MS);
          }}
        />
      )}
    </>
  );
}

/** Inline style hook so art-less cards still get a distinct color. */
export function championStyle(champion: Champion): React.CSSProperties {
  return { ['--pick-hue' as string]: String(championHue(champion)) };
}
