import { useEffect, useState } from 'react'
import { getCompetitions, getHealth, postPrediction } from './api.js'
import FixtureForm from './components/FixtureForm.jsx'
import MatchHeader from './components/MatchHeader.jsx'
import ProbabilityBar from './components/ProbabilityBar.jsx'
import MarketCard from './components/MarketCard.jsx'
import ScoreList from './components/ScoreList.jsx'
import HalvesPanel from './components/HalvesPanel.jsx'
import FactorsPanel from './components/FactorsPanel.jsx'
import QualityPanel from './components/QualityPanel.jsx'

export default function App() {
  const [health, setHealth] = useState(null)
  const [competitions, setCompetitions] = useState([])
  const [prediction, setPrediction] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('full')

  useEffect(() => {
    getHealth().then(setHealth).catch((e) => setError(e.message))
    getCompetitions()
      .then((d) => setCompetitions(d.competitions))
      .catch((e) => setError(e.message))
  }, [])

  const predict = async (payload) => {
    setBusy(true)
    setError(null)
    try {
      setPrediction(await postPrediction(payload))
    } catch (e) {
      setError(e.message)
      setPrediction(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <nav className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span>Football Match Predictor</span>
        </div>
        {health?.status === 'ok' && (
          <div className="topbar-meta">
            {health.n_matches?.toLocaleString()} matches &middot;{' '}
            {health.competitions} competitions &middot; trained through {health.trained_through}
          </div>
        )}
      </nav>

      <main>
        <FixtureForm competitions={competitions} onSubmit={predict} busy={busy} />

        {error && <div className="banner banner-error">{error}</div>}

        {!prediction && !error && (
          <div className="empty">
            <h2>Pick a fixture</h2>
            <p>
              Choose a competition, season, the two teams and a kickoff date. Every
              market below is derived from one goal distribution, so the numbers
              agree with each other.
            </p>
          </div>
        )}

        {prediction && (
          <>
            <MatchHeader fixture={prediction.fixture}
                         expected={prediction.expected_goals}
                         hub={prediction.hub} />

            <ProbabilityBar hub={prediction.hub}
                            homeName={prediction.fixture.home_display}
                            awayName={prediction.fixture.away_display} />

            <div className="tabs">
              <button className={tab === 'full' ? 'is-active' : ''}
                      onClick={() => setTab('full')}>Full time</button>
              <button className={tab === 'halves' ? 'is-active' : ''}
                      onClick={() => setTab('halves')}>Halves</button>
              <button className={tab === 'why' ? 'is-active' : ''}
                      onClick={() => setTab('why')}>Why</button>
            </div>

            {tab === 'full' && (
              <div className="grid">
                <MarketCard
                  title="Both teams to score"
                  subtitle="BTTS"
                  rows={[
                    { label: 'Yes', value: prediction.btts.yes },
                    { label: 'No', value: prediction.btts.no },
                  ]}
                />
                <MarketCard
                  title="Total goals"
                  subtitle={`${prediction.expected_goals.total.toFixed(2)} expected`}
                  rows={Object.entries(prediction.totals).map(([line, v]) => ({
                    label: `Over ${line}`, value: v.over,
                  }))}
                />
                <MarketCard
                  title={`${prediction.fixture.home_display} goals`}
                  subtitle={`${prediction.team_goals.home.expected.toFixed(2)} expected`}
                  rows={[
                    ...Object.entries(prediction.team_goals.home.over).map(([line, v]) => ({
                      label: `Over ${line}`, value: v,
                    })),
                    { label: 'Clean sheet', value: prediction.team_goals.home.clean_sheet },
                  ]}
                />
                <MarketCard
                  title={`${prediction.fixture.away_display} goals`}
                  subtitle={`${prediction.team_goals.away.expected.toFixed(2)} expected`}
                  rows={[
                    ...Object.entries(prediction.team_goals.away.over).map(([line, v]) => ({
                      label: `Over ${line}`, value: v,
                    })),
                    { label: 'Clean sheet', value: prediction.team_goals.away.clean_sheet },
                  ]}
                />
                <ScoreList scores={prediction.most_likely_scores} />
                <QualityPanel confidence={prediction.confidence}
                              quality={prediction.data_quality}
                              model={prediction.model} />
              </div>
            )}

            {tab === 'halves' && (
              <HalvesPanel halves={prediction.halves} fixture={prediction.fixture} />
            )}

            {tab === 'why' && (
              <div className="grid grid-two">
                <FactorsPanel factors={prediction.factors} />
                <QualityPanel confidence={prediction.confidence}
                              quality={prediction.data_quality}
                              model={prediction.model} />
              </div>
            )}
          </>
        )}
      </main>

      <footer>
        Probabilities from a calibrated ensemble of Dixon-Coles, Poisson, Elo and
        gradient-boosting models, validated walk-forward. Forecasts, not guarantees.
      </footer>
    </div>
  )
}
