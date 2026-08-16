import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useDataset } from '../../state/DatasetContext.tsx';
import { formatCount } from '../../lib/format.ts';

const LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/setup', label: 'Play' },
  { to: '/predictor', label: 'Predictor' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/data', label: 'Data' },
] as const;

export function NavBar() {
  const { dataset, isDemo, status } = useDataset();
  const [open, setOpen] = useState(false);

  return (
    <header className="nav">
      <div className="nav-inner">
        <NavLink to="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark" aria-hidden="true">
            DC
          </span>
          <span className="brand-text">
            <strong>DraftCall</strong>
            <span className="brand-sub">Read the draft. Call the winner.</span>
          </span>
        </NavLink>

        <button
          type="button"
          className="nav-toggle"
          aria-expanded={open}
          aria-label="Toggle navigation"
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden="true">{open ? '✕' : '☰'}</span>
        </button>

        <nav className={`nav-links${open ? ' is-open' : ''}`} aria-label="Main">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={'end' in link ? link.end : false}
              className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="nav-status">
          {status === 'loading' ? (
            <span className="badge">Loading data…</span>
          ) : (
            <>
              <span className="badge badge-strong" title={dataset?.source.label}>
                {formatCount(dataset?.games.length ?? 0, 'game')}
              </span>
              {isDemo && <span className="badge badge-demo">Demo data</span>}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
