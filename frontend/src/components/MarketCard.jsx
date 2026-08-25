const pct = (v) => `${(v * 100).toFixed(1)}%`

/** A row of two-way outcomes with proportional bars. */
export default function MarketCard({ title, subtitle, rows, compact }) {
  return (
    <div className={`card ${compact ? 'card-compact' : ''}`}>
      <div className="card-head">
        <h3>{title}</h3>
        {subtitle && <span className="hint">{subtitle}</span>}
      </div>
      <ul className="market-rows">
        {rows.map((row) => (
          <li key={row.label}>
            <span className="market-label">{row.label}</span>
            <span className="market-track">
              <span className="market-fill" style={{ width: `${row.value * 100}%` }} />
            </span>
            <span className="market-value">{pct(row.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
