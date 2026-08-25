/** Confidence and data quality, side by side. Neither is a promise about
 *  the outcome - they describe how much the forecast rests on. */
export default function QualityPanel({ confidence, quality, model }) {
  return (
    <div className="card quality">
      <div className="card-head"><h3>Confidence &amp; data quality</h3></div>

      <div className="quality-badges">
        <div className={`badge badge-${confidence.label.toLowerCase()}`}>
          <span className="badge-label">Confidence</span>
          <strong>{confidence.label}</strong>
          <span className="badge-score">{(confidence.score * 100).toFixed(0)}/100</span>
        </div>
        <div className={`badge badge-${quality.label.toLowerCase()}`}>
          <span className="badge-label">Data</span>
          <strong>{quality.label}</strong>
          <span className="badge-score">{(quality.score * 100).toFixed(0)}/100</span>
        </div>
      </div>

      <ul className="component-list">
        {Object.entries(confidence.components).map(([name, value]) => (
          <li key={name}>
            <span className="component-name">{name.replace(/_/g, ' ')}</span>
            <span className="market-track">
              <span className="market-fill" style={{ width: `${value * 100}%` }} />
            </span>
            <span className="market-value">{(value * 100).toFixed(0)}</span>
          </li>
        ))}
      </ul>

      {(confidence.notes?.length > 0 || quality.warnings?.length > 0) && (
        <ul className="notes">
          {confidence.notes.map((n) => <li key={n}>{n}</li>)}
          {quality.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <div className="model-note">
        {model.mode === 'historical_replay'
          ? 'Past date: team state was replayed to the day before kickoff and the goal models refitted on earlier matches only, so this is an out-of-sample forecast.'
          : `Forecast from models trained through ${model.trained_through}.`}
        <div className="model-members">
          {model.members.length} model{model.members.length === 1 ? '' : 's'}: {model.members.join(', ')}
        </div>
      </div>

      <p className="disclaimer">
        These are probabilities, not predictions of certainty. A 70% forecast is
        meant to be wrong about three times in ten.
      </p>
    </div>
  )
}
