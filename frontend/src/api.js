// All network access goes through here so the base URL is configurable in one
// place: Vite proxies /api to the FastAPI service in development.
const BASE = import.meta.env.VITE_API_BASE ?? '/api'

async function request(path, options) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* response had no JSON body; keep the status text */
    }
    throw new Error(detail)
  }
  return response.json()
}

export const getHealth = () => request('/health')
export const getCompetitions = () => request('/competitions')
export const getTeams = (code, season) =>
  request(`/competitions/${code}/teams${season ? `?season=${encodeURIComponent(season)}` : ''}`)
export const postPrediction = (payload) =>
  request('/predict', { method: 'POST', body: JSON.stringify(payload) })
