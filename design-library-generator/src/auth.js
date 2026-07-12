// Reuses the EnterpriseDS house auth pattern: MSAL browser (Microsoft) +
// shared Google broker. No secrets in the browser.
import { PublicClientApplication } from '@azure/msal-browser'
import { API_BASE, setSessionToken } from './api.js'

const TENANT = import.meta.env.VITE_MS_TENANT_ID || 'ee633423-c321-413c-a191-ace8b07e4196'
const MS_CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID || ''
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const GOOGLE_REDIRECT_URI = import.meta.env.VITE_GOOGLE_REDIRECT_URI || ''
const LS_KEY = 'dlg_auth_user'

export const providerReady = {
  microsoft: !!MS_CLIENT_ID,
  google: !!GOOGLE_CLIENT_ID && !!GOOGLE_REDIRECT_URI,
}

export function loadUser() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') } catch { return null }
}
function saveUser(u) {
  try { u ? localStorage.setItem(LS_KEY, JSON.stringify(u)) : localStorage.removeItem(LS_KEY) } catch {}
}

let msalApp = null
async function getMsal() {
  if (!MS_CLIENT_ID) throw new Error('Microsoft sign-in not configured (VITE_MS_CLIENT_ID missing)')
  if (!msalApp) {
    msalApp = new PublicClientApplication({
      auth: { clientId: MS_CLIENT_ID, authority: `https://login.microsoftonline.com/${TENANT}`, redirectUri: window.location.origin },
      cache: { cacheLocation: 'localStorage' },
    })
    await msalApp.initialize()
  }
  return msalApp
}

export async function signInMicrosoft() {
  const app = await getMsal()
  const res = await app.loginPopup({ scopes: ['openid', 'email', 'profile', 'User.Read'] })
  const acct = res.account
  const user = { email: acct?.username, name: acct?.name || acct?.username, provider: 'microsoft' }
  try {
    let accessToken = res.accessToken
    if (!accessToken) { const t = await app.acquireTokenSilent({ scopes: ['User.Read'], account: acct }); accessToken = t.accessToken }
    if (accessToken) {
      const r = await fetch(`${API_BASE}/auth/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msAccessToken: accessToken }) })
      const d = await r.json().catch(() => ({}))
      if (d?.token) { setSessionToken(d.token); if (d.email) user.email = d.email }
    }
  } catch { /* falls back gracefully */ }
  saveUser(user)
  return user
}

const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function fromB64url(s) { return atob(s.replace(/-/g, '+').replace(/_/g, '/')) }

function buildGoogleAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export function signInGoogle() {
  if (!providerReady.google) throw new Error('Google sign-in not configured')
  const state = b64url(JSON.stringify({ p: 'google', o: window.location.origin }))
  window.location.href = buildGoogleAuthUrl(state)
}

let handledCode = null
export async function handleGoogleCallback() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code'); const stateRaw = params.get('state')
  if (!code || !stateRaw) return null
  let state
  try { state = JSON.parse(fromB64url(stateRaw)) } catch { return null }
  if (state.p !== 'google' || handledCode === code) return null
  handledCode = code
  window.history.replaceState({}, '', window.location.pathname + window.location.hash)
  try {
    const res = await fetch(`${API_BASE}/auth/google/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri: GOOGLE_REDIRECT_URI }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `${res.status}`)
    const d = await res.json()
    const user = { email: d.email, name: d.displayName || d.email, provider: 'google' }
    if (d.token) setSessionToken(d.token)
    saveUser(user)
    return user
  } catch (e) { handledCode = null; throw e }
}

export async function signOut() {
  saveUser(null)
  setSessionToken(null)
  try { const app = await getMsal(); const a = app.getAllAccounts?.()[0]; if (a) await app.clearCache?.() } catch {}
}
