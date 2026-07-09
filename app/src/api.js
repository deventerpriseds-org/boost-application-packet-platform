// API client for the Executive Engine service layer (Azure Functions).
// Reads from boost_resume_n_packet_builder via the app/* endpoints.
const API_BASE =
  import.meta.env.VITE_API_URL || 'https://job-platform-api.azurewebsites.net/api'

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`)
  return res.json()
}
async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`)
  return res.json()
}

export const api = {
  listOpportunities: ({ owner, persona, stage } = {}) => {
    const qs = new URLSearchParams()
    if (owner) qs.set('owner', owner)
    if (persona) qs.set('persona', persona)
    if (stage) qs.set('stage', stage)
    const q = qs.toString()
    return get(`/app/opportunities${q ? `?${q}` : ''}`)
  },
  getOpportunity: (id) => get(`/app/opportunity/${id}`),
  moveStage: (id, stage) => post(`/app/opportunity/${id}/stage`, { stage }),
  dismiss: (id) => post(`/app/opportunity/${id}/dismiss`, {}),
}

export { API_BASE }
