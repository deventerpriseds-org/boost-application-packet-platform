// EnterpriseDS house auth: client-side Microsoft (MSAL browser + PKCE) and
// Google sign-in. No server token exchange, no client secret. Client IDs are
// injected at build time (VITE_MS_CLIENT_ID / VITE_GOOGLE_CLIENT_ID).
import { PublicClientApplication } from '@azure/msal-browser'

const TENANT = import.meta.env.VITE_MS_TENANT_ID || 'ee633423-c321-413c-a191-ace8b07e4196'
const MS_CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID || ''
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const LS_KEY = 'ee_auth_user'

export const providerReady = { microsoft: !!MS_CLIENT_ID, google: !!GOOGLE_CLIENT_ID }

// --- persistence: remember the signed-in identity across reloads ------------
export function loadUser() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') } catch { return null }
}
function saveUser(u) {
  try { u ? localStorage.setItem(LS_KEY, JSON.stringify(u)) : localStorage.removeItem(LS_KEY) } catch {}
}

// --- Microsoft (MSAL) -------------------------------------------------------
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
  const email = acct?.username || res.idTokenClaims?.email || res.idTokenClaims?.preferred_username
  const user = { email, name: acct?.name || email, provider: 'microsoft' }
  saveUser(user)
  return user
}

async function signOutMicrosoft() {
  try { const app = await getMsal(); const acct = app.getAllAccounts()[0]; if (acct) await app.clearCache?.() } catch {}
}

// --- Google Identity Services (loaded on demand) ----------------------------
function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true; s.defer = true
    s.onload = () => resolve(); s.onerror = () => reject(new Error('Google script failed to load'))
    document.head.appendChild(s)
  })
}
function decodeJwt(t) { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) } catch { return {} } }

export async function signInGoogle() {
  if (!GOOGLE_CLIENT_ID) throw new Error('Google sign-in not configured (VITE_GOOGLE_CLIENT_ID missing)')
  await loadGis()
  return new Promise((resolve, reject) => {
    try {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (resp) => {
          const claims = decodeJwt(resp.credential || '')
          const user = { email: claims.email, name: claims.name || claims.email, provider: 'google' }
          saveUser(user); resolve(user)
        },
      })
      window.google.accounts.id.prompt() // shows the One Tap / account chooser
    } catch (e) { reject(e) }
  })
}

export async function signOut() {
  saveUser(null)
  await signOutMicrosoft()
  try { window.google?.accounts?.id?.disableAutoSelect?.() } catch {}
}
