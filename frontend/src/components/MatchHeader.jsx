/** Two teams facing off, with the model's expected goals for each. */
export default function MatchHeader({ fixture, expected, hub }) {
  return (
    <header className="match-head">
      <div className="team team-home">
        <span className="team-side">Home</span>
        <h1>{fixture.home_display}</h1>
        <div className="team-xg">
          <span className="xg-value">{expected.home.toFixed(2)}</span>
          <span className="xg-label">expected goals</span>
        </div>
        <div className="team-win">{(hub.home * 100).toFixed(0)}%</div>
      </div>

      <div className="match-centre">
        <div className="scoreline">
          {expected.home.toFixed(2)} <span>&ndash;</span> {expected.away.toFixed(2)}
        </div>
        <div className="match-meta">
          <div>{fixture.competition_name}</div>
          <div>{fixture.season} &middot; {fixture.date}</div>
          {fixture.neutral_venue && <div className="tag">neutral venue</div>}
          {fixture.stage && <div className="tag">{fixture.stage.replace(/_/g, ' ')}</div>}
        </div>
        <div className="total-goals">
          <span className="total-value">{expected.total.toFixed(2)}</span>
          <span className="total-label">total expected goals</span>
        </div>
      </div>

      <div className="team team-away">
        <span className="team-side">Away</span>
        <h1>{fixture.away_display}</h1>
        <div className="team-xg">
          <span className="xg-value">{expected.away.toFixed(2)}</span>
          <span className="xg-label">expected goals</span>
        </div>
        <div className="team-win">{(hub.away * 100).toFixed(0)}%</div>
      </div>
    </header>
  )
}
