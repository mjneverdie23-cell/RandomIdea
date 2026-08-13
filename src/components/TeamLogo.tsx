import { useEffect, useState } from 'react';
import { teamLogoUrl } from '../domain/teams.ts';

interface TeamLogoProps {
  teamName: string;
  /** Monogram shown when there is no logo file (or it fails to load). */
  tag: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Team logo with a monogram fallback.
 *
 * Logos are an optional download (`npm run assets`), so the fallback is the
 * normal state on a fresh clone, not an error path — it has to look
 * deliberate. Both branches render the same box so the layout never shifts.
 */
export function TeamLogo({ teamName, tag, size = 'md', className }: TeamLogoProps) {
  const src = teamLogoUrl(teamName);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const classes = ['team-logo', `team-logo--${size}`, className].filter(Boolean).join(' ');

  if (!src || failed) {
    return (
      <span className={`${classes} is-monogram`} aria-hidden="true" title={teamName}>
        {tag}
      </span>
    );
  }

  return (
    <span className={classes} aria-hidden="true" title={teamName}>
      <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
    </span>
  );
}
