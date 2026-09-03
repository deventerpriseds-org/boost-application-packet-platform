import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, setOwner, setIncludeDemo, setUnauthorizedHandler } from './api.js'
import { loadUser, signInMicrosoft, signInGoogle, signOut as authSignOut, providerReady, handleGoogleCallback, refreshSessionSilent, maybeRefreshSessionOnLoad } from './auth.js'

// Derive a display first name from an email address or displayName string.
// "von.ellis@enterpriseds.io" → "Von", "Von Ellis" → "Von"
export function firstNameFrom(emailOrName) {
  if (!emailOrName) return ''
  if (emailOrName.includes('@')) {
    const local = emailOrName.split('@')[0].split('.')[0].split('_')[0]
    return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase()
  }
  return emailOrName.split(' ')[0]
}

const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

// Minimal hash router: #/opportunities, #/pipeline, #/opp/:id, default #/today
export function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash || '#/today')
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || '#/today')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const [pathPart, queryPart] = hash.replace(/^#\//, '').split('?')
  const parts = pathPart.split('/').filter(Boolean)
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''))
  return { hash, parts, query }
}
export const go = (path) => { window.location.hash = path.startsWith('#') ? path : `#${path.startsWith('/') ? '' : '/'}${path}` }

// True on phone-width viewports — drives the shell's nav swap.
export function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false))
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const onChange = () => setMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [breakpoint])
  return mobile
}

// True on viewports wide enough to DOCK the assistant beside the packet rather than float it.
// Deliberately the mirror of useIsMobile rather than a second mechanism -- same hook shape, same
// matchMedia lifecycle, same SSR-safe initialiser. The threshold is DERIVED in assistantPanel.js
// from the column arithmetic; it is passed in rather than read here so this file keeps knowing
// nothing about layout.
export function useIsWide(breakpoint) {
  const [wide, setWide] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= breakpoint : false))
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`)
    const onChange = () => setWide(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [breakpoint])
  return wide
}

const DEMO_OWNER = 'demo@executive-engine.local'

export function AppProvider({ children }) {
  const [dark, setDark] = useState(false)
  const [toasts, setToasts] = useState([])
  // Client-side auth (EnterpriseDS house pattern): Microsoft (MSAL) + Google,
  // no server token exchange. Signed-in email becomes the data owner; otherwise
  // shared demo mode so the app stays usable without login.
  const [auth, setAuth] = useState({ loading: true, user: loadUser() })
  useEffect(() => {
    // Session auto-refresh: on a 401 anywhere, silently re-mint the token and retry.
    setUnauthorizedHandler(refreshSessionSilent)
    handleGoogleCallback()
      .then((u) => setAuth({ loading: false, user: u || loadUser() }))
      .catch(() => setAuth({ loading: false, user: loadUser() }))
      // Then proactively refresh the session ahead of expiry so writes never 401 mid-use.
      .finally(() => { maybeRefreshSessionOnLoad().catch(() => {}) })
  }, [])

  const owner = auth.user?.email || DEMO_OWNER
  const displayName = firstNameFrom(auth.user?.displayName || auth.user?.email || '')
  useEffect(() => { setOwner(owner) }, [owner])

  // Show sample/demo data toggle (persisted). Off hides all is_demo rows.
  const [showDemo, setShowDemoState] = useState(() => {
    try { return localStorage.getItem('ee_show_demo') !== 'false' } catch { return true }
  })
  useEffect(() => { setIncludeDemo(showDemo) }, [showDemo])
  const setShowDemo = useCallback((v) => {
    setShowDemoState(v)
    try { localStorage.setItem('ee_show_demo', v ? 'true' : 'false') } catch {}
  }, [])

  // Soft login gate: once the user chooses "explore in demo mode" we remember it
  // so they aren't nagged every load. Signing out clears it so the gate returns.
  const [demoBypass, setDemoBypassState] = useState(() => {
    try { return localStorage.getItem('ee_demo_bypass') === 'true' } catch { return false }
  })
  const enterDemo = useCallback(() => {
    setDemoBypassState(true); try { localStorage.setItem('ee_demo_bypass', 'true') } catch {}
  }, [])

  const signIn = useCallback(async (provider = 'microsoft') => {
    try {
      const user = provider === 'google' ? await signInGoogle() : await signInMicrosoft()
      setAuth({ loading: false, user })
      return user
    } catch (e) { throw e }
  }, [])
  const signOut = useCallback(async () => {
    await authSignOut(); setAuth({ loading: false, user: null })
    setDemoBypassState(false); try { localStorage.removeItem('ee_demo_bypass') } catch {}
  }, [])

  useEffect(() => {
    // BOTH, and the second one is the fix.
    //
    // The Compass dark palette in `tokens/fig-tokens.css` is defined on
    // `:root[data-theme="dark"], .dark` — 104 tokens. This effect toggled only `.proto-dark`,
    // which matches NEITHER selector, so that palette had never once applied. `theme.css`'s
    // `.proto-dark` block is a later hand-written patch covering 33 tokens, about a third of it,
    // and everything outside those 33 kept its LIGHT value in dark mode.
    //
    // That is why an accent pill was unreadable: `--surface-brand-subtle` is one of the 33 and
    // went near-black, while `--surface-brand-default` is one of the missing 71 and stayed a
    // mid-dark teal — so the pill rendered dark teal on near-black teal, measured at 1.90:1
    // against a 4.5:1 requirement, across 15+ live sites. The pills were the visible symptom;
    // the disease was dark mode running on a third of its palette.
    //
    // `theme.css` still says dark "just works ... without a separate .proto-dark block". It was
    // right about the mechanism and wrong about the trigger. Setting the attribute makes the
    // comment true. `.proto-dark` stays: its 33 overrides are deliberate skin choices that layer
    // ON TOP of the real palette, and removing them is a separate, visual decision.
    document.documentElement.classList.toggle('proto-dark', dark)
    if (dark) document.documentElement.setAttribute('data-theme', 'dark')
    else document.documentElement.removeAttribute('data-theme')
  }, [dark])

  const toast = useCallback((msg) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200)
  }, [])

  const value = {
    displayName,
    dark, setDark, toast,
    auth, owner, signIn, signOut, providerReady,
    demoBypass, enterDemo, isDemo: owner === DEMO_OWNER,
    showDemo, setShowDemo,
  }
  return (
    <AppCtx.Provider value={value}>
      {children}
      <ToastTray toasts={toasts} />
    </AppCtx.Provider>
  )
}

// zIndex comes from the token scale, not a literal: overlays now sit at 200/300 (--zindex-overlay /
// --zindex-modal), so the old hardcoded 100 would have hidden every toast behind an open drawer.
function ToastTray({ toasts }) {
  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 'var(--zindex-toast)' }}>
      {toasts.map((t) => (
        <div key={t.id} className="px-box" style={{ padding: '10px 14px', fontSize: 13, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', animation: 'toast-in 200ms ease-out' }}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}
