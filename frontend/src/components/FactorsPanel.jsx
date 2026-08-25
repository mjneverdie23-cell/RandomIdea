/**
 * The factors listed here are read back out of the feature row the model
 * actually scored. Nothing is generated to fill the panel: if a feature was
 * unavailable for this fixture, it simply does not appear.
 */
export default function FactorsPanel({ factors }) {
  if (!factors?.length) {
    return (
      <div className="card card-muted">
        <div className="card-head"><h3>Main factors</h3></div>
        <p className="muted">No factors available - this fixture has too little history.</p>
      </div>
    )
  }
  return (
    <div className="card">
      <div className="card-head">
        <h3>Main factors</h3>
        <span className="hint">what is driving this prediction</span>
      </div>
      <ul className="factor-list">
        {factors.map((f) => (
          <li key={f.name} className={`factor favours-${f.favours}`}>
            <div className="factor-top">
              <span className="factor-name">{f.name}</span>
              <span className={`factor-tag tag-${f.favours}`}>
                {f.favours === 'neutral' ? 'context' : `favours ${f.favours}`}
              </span>
            </div>
            <div className="factor-detail">{f.detail}</div>
            <span className="factor-track">
              <span className="factor-fill" style={{ width: `${f.weight * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
