import { useEffect, useRef, useState } from 'react';

const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Below this many milliseconds the ring turns red and pulses. */
const URGENT_MS = 3500;

interface CountdownProps {
  /** `performance.now()` timestamp of when this question went live. */
  startedAt: number;
  durationMs: number;
  /** Stops the clock (used the moment an answer is submitted). */
  frozen: boolean;
  onExpire: () => void;
}

/**
 * Self-contained countdown.
 *
 * Owns its own animation frame loop so a 60fps ring doesn't re-render the
 * draft board. Remaining time is always derived from wall-clock deltas, never
 * accumulated per frame, so throttled tabs and dropped frames can't hand the
 * player extra time.
 */
export function Countdown({ startedAt, durationMs, frozen, onExpire }: CountdownProps) {
  const [remaining, setRemaining] = useState(durationMs);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    if (frozen) return;
    let frame = 0;
    let done = false;

    const tick = () => {
      const left = Math.max(0, durationMs - (performance.now() - startedAt));
      setRemaining(left);
      if (left <= 0) {
        if (!done) {
          done = true;
          expireRef.current();
        }
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [startedAt, durationMs, frozen]);

  const fraction = durationMs > 0 ? Math.min(1, Math.max(0, remaining / durationMs)) : 0;
  const seconds = remaining / 1000;
  const urgent = !frozen && remaining <= URGENT_MS;

  return (
    <div
      className={`countdown${urgent ? ' is-urgent' : ''}${frozen ? ' is-frozen' : ''}`}
      role="timer"
      aria-live="off"
      aria-label={`${seconds.toFixed(0)} seconds remaining`}
    >
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle className="countdown-track" cx="40" cy="40" r={RADIUS} />
        <circle
          className="countdown-progress"
          cx="40"
          cy="40"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>
      <div className="countdown-value num">{seconds.toFixed(1)}</div>
      <div className="countdown-unit">sec</div>
    </div>
  );
}
