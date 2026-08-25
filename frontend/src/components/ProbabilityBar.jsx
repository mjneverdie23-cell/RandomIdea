const pct = (value) => `${(value * 100).toFixed(0)}%`

/**
 * The HUB split: home / draw / away as one continuous bar.
 * HUB is the Scandinavian name for the three-way result market
 * (Hjemmeseier, Uavgjort, Borteseier) and settles on regulation time.
 */
export default function ProbabilityBar({ hub, homeName, awayName }) {
  const segments = [
    { key: 'home', label: homeName, value: hub.home, className: 'seg-home' },
    { key: 'draw', label: 'Draw', value: hub.draw, className: 'seg-draw' },
    { key: 'away', label: awayName, value: hub.away, className: 'seg-away' },
  ]
  const leader = segments.reduce((best, s) => (s.value > best.value ? s : best))

  return (
    <section className="prob-block">
      <div className="prob-head">
        <h2>HUB &mdash; full-time result</h2>
        <span className="hint">Home / Draw (Uavgjort) / Away &middot; regulation time</span>
      </div>

      <div className="prob-bar" role="img"
           aria-label={`Home ${pct(hub.home)}, draw ${pct(hub.draw)}, away ${pct(hub.away)}`}>
        {segments.map((s) => (
          <div key={s.key} className={`prob-seg ${s.className}`}
               style={{ width: `${Math.max(s.value * 100, 6)}%` }}>
            <span className="prob-seg-value">{pct(s.value)}</span>
          </div>
        ))}
      </div>

      <div className="prob-legend">
        {segments.map((s) => (
          <div key={s.key} className={`legend-item ${s.key === leader.key ? 'is-leader' : ''}`}>
            <span className={`swatch ${s.className}`} />
            <span className="legend-label">{s.label}</span>
            <span className="legend-value">{(s.value * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </section>
  )
}
