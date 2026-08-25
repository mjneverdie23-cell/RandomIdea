/** Most likely exact scorelines, read off the same distribution as every
 *  other market on the page. */
export default function ScoreList({ scores, title = 'Most likely scores' }) {
  const top = scores[0]?.probability ?? 1
  return (
    <div className="card">
      <div className="card-head"><h3>{title}</h3></div>
      <ul className="score-list">
        {scores.map((s) => (
          <li key={s.score}>
            <span className="score-line">{s.score}</span>
            <span className="market-track">
              <span className="market-fill" style={{ width: `${(s.probability / top) * 100}%` }} />
            </span>
            <span className="market-value">{(s.probability * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
