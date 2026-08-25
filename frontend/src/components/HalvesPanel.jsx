import MarketCard from './MarketCard.jsx'
import ScoreList from './ScoreList.jsx'

/**
 * Half-time markets come from a first-half model fitted on first-half goals,
 * not from halving the full-time numbers - the measured split is closer to
 * 44/56 than 50/50, and the panel shows the model's own figure.
 */
export default function HalvesPanel({ halves, fixture }) {
  if (!halves?.available) {
    return (
      <div className="card card-muted">
        <div className="card-head"><h3>Half-time markets</h3></div>
        <p className="muted">{halves?.reason ?? 'unavailable for this competition'}</p>
      </div>
    )
  }

  const fh = halves.first_half
  const sh = halves.second_half
  const split = halves.goal_split

  return (
    <div className="halves">
      <div className="card">
        <div className="card-head">
          <h3>Half-time result (HUB)</h3>
          <span className="hint">score at the break</span>
        </div>
        <ul className="market-rows">
          {[
            { label: fixture.home_display, value: fh.hub.home },
            { label: 'Draw', value: fh.hub.draw },
            { label: fixture.away_display, value: fh.hub.away },
          ].map((row) => (
            <li key={row.label}>
              <span className="market-label">{row.label}</span>
              <span className="market-track">
                <span className="market-fill" style={{ width: `${row.value * 100}%` }} />
              </span>
              <span className="market-value">{(row.value * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
        <div className="split-note">
          First-half expected goals <strong>{fh.expected_goals.total.toFixed(2)}</strong>
          {split && <> &middot; {(split.first_half_share * 100).toFixed(0)}% of the match total</>}
        </div>
      </div>

      <MarketCard
        title="First-half goals"
        subtitle={`${fh.expected_goals.home.toFixed(2)} - ${fh.expected_goals.away.toFixed(2)} expected`}
        rows={[
          ...Object.entries(fh.totals).map(([line, v]) => ({
            label: `Over ${line}`, value: v.over,
          })),
          { label: 'Both teams score (1H)', value: fh.btts.yes },
          { label: `${fixture.home_display} scores (1H)`, value: fh.team_goals['home_over_0.5'] },
          { label: `${fixture.away_display} scores (1H)`, value: fh.team_goals['away_over_0.5'] },
        ]}
      />

      {sh && (
        <MarketCard
          title="Second-half goals"
          subtitle={`${sh.expected_goals.total.toFixed(2)} expected`
            + (split ? ` (${(split.second_half_share * 100).toFixed(0)}% of the match)` : '')}
          rows={Object.entries(sh.totals).map(([line, v]) => ({
            label: `Over ${line}`, value: v.over,
          }))}
        />
      )}

      <ScoreList scores={fh.most_likely_scores} title="Likely half-time scores" />
    </div>
  )
}
