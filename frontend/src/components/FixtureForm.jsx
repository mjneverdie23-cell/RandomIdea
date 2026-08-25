import { useEffect, useMemo, useState } from 'react'
import { getTeams } from '../api.js'

/** Competition -> season -> teams -> date. Teams are scoped to the chosen
 *  competition and season so the form can only build fixtures that exist. */
export default function FixtureForm({ competitions, onSubmit, busy }) {
  const [competition, setCompetition] = useState('')
  const [season, setSeason] = useState('')
  const [teams, setTeams] = useState([])
  const [homeTeam, setHomeTeam] = useState('')
  const [awayTeam, setAwayTeam] = useState('')
  const [date, setDate] = useState('')
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [error, setError] = useState(null)

  const selected = useMemo(
    () => competitions.find((c) => c.code === competition),
    [competitions, competition],
  )

  useEffect(() => {
    if (!competitions.length || competition) return
    const first = competitions[0]
    setCompetition(first.code)
    setSeason(first.seasons[first.seasons.length - 1] ?? '')
  }, [competitions, competition])

  useEffect(() => {
    if (!competition || !season) return
    let cancelled = false
    setLoadingTeams(true)
    setError(null)
    getTeams(competition, season)
      .then((data) => {
        if (cancelled) return
        setTeams(data.teams)
        setHomeTeam((prev) => (data.teams.some((t) => t.name === prev) ? prev : data.teams[0]?.name ?? ''))
        setAwayTeam((prev) => (data.teams.some((t) => t.name === prev) ? prev : data.teams[1]?.name ?? ''))
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoadingTeams(false))
    return () => { cancelled = true }
  }, [competition, season])

  // Default the kickoff date to the middle of the chosen season, which is
  // always a date that competition was actually playing on.
  useEffect(() => {
    if (!season) return
    const startYear = parseInt(season.slice(0, 4), 10)
    setDate(season.includes('/') ? `${startYear + 1}-02-15` : `${startYear}-06-15`)
  }, [season])

  const handleCompetition = (code) => {
    setCompetition(code)
    const comp = competitions.find((c) => c.code === code)
    setSeason(comp?.seasons[comp.seasons.length - 1] ?? '')
  }

  const swap = () => {
    setHomeTeam(awayTeam)
    setAwayTeam(homeTeam)
  }

  const submit = (event) => {
    event.preventDefault()
    if (!homeTeam || !awayTeam) return setError('pick both teams')
    if (homeTeam === awayTeam) return setError('a team cannot play itself')
    setError(null)
    onSubmit({ competition, season, home_team: homeTeam, away_team: awayTeam, date })
  }

  return (
    <form className="fixture-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="competition">Competition</label>
        <select id="competition" value={competition}
                onChange={(e) => handleCompetition(e.target.value)}>
          {competitions.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}{c.country && c.country !== 'INT' ? ` (${c.country})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="season">Season</label>
        <select id="season" value={season} onChange={(e) => setSeason(e.target.value)}>
          {(selected?.seasons ?? []).slice().reverse().map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="field field-team">
        <label htmlFor="home">Home team</label>
        <select id="home" value={homeTeam} disabled={loadingTeams}
                onChange={(e) => setHomeTeam(e.target.value)}>
          {teams.map((t) => <option key={t.name} value={t.name}>{t.display}</option>)}
        </select>
      </div>

      <button type="button" className="swap" onClick={swap} title="Swap home and away"
              aria-label="Swap home and away">&#8646;</button>

      <div className="field field-team">
        <label htmlFor="away">Away team</label>
        <select id="away" value={awayTeam} disabled={loadingTeams}
                onChange={(e) => setAwayTeam(e.target.value)}>
          {teams.map((t) => <option key={t.name} value={t.name}>{t.display}</option>)}
        </select>
      </div>

      <div className="field">
        <label htmlFor="date">Match date</label>
        <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <button type="submit" className="predict" disabled={busy || loadingTeams}>
        {busy ? 'Modelling…' : 'Predict'}
      </button>

      {error && <p className="form-error">{error}</p>}
    </form>
  )
}
