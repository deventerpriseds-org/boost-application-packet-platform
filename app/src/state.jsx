import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, setOwner, setIncludeDemo } from './api.js'
import { loadUser, signInMicrosoft, signInGoogle, signOut as authSignOut, providerReady, handleGoogleCallback } from './auth.js'

// Three executive personas (spec §4) — re-filter the opportunity catalog.
export const PERSONAS = {
  CTO: { key: 'CTO', name: 'Jordan Davis', role: 'CTO', comp: '$420–520k + eq' },
  VPE: { key: 'VPE', name: 'Riley Park', role: 'VP Engineering', comp: '$370–450k + eq' },
  VPP: { key: 'VPP', name: 'Sam Cohen', role: 'VP Product', comp: '$340–410k + eq' },
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
  const parts = hash.replace(/^#\//, '').split('/').filter(Boolean)
  return { hash, parts }
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

const DEMO_OWNER = 'demo@executive-engine.local'

export function AppProvider({ children }) {
  const [personaKey, setPersonaKey] = useState('CTO')
  const [dark, setDark] = useState(false)
  const [toasts, setToasts] = useState([])
  // Client-side auth (EnterpriseDS house pattern): Microsoft (MSAL) + Google,
  // no server token exchange. Signed-in email becomes the data owner; otherwise
  // shared demo mode so the app stays usable without login.
  const [auth, setAuth] = useState({ loading: true, user: loadUser() })
  useEffect(() => {
    // Complete a Google broker redirect if we came back with a code, else load
    // any persisted identity.
    handleGoogleCallback()
      .then((u) => setAuth({ loading: false, user: u || loadUser() }))
      .catch(() => setAuth({ loading: false, user: loadUser() }))
  }, [])

  const owner = auth.user?.email || DEMO_OWNER
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
    document.documentElement.classList.toggle('proto-dark', dark)
  }, [dark])

  const toast = useCallback((msg) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200)
  }, [])

  const value = {
    personaKey, setPersonaKey, persona: PERSONAS[personaKey],
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

function ToastTray({ toasts }) {
  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 100 }}>
      {toasts.map((t) => (
        <div key={t.id} className="px-box" style={{ padding: '10px 14px', fontSize: 13, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', animation: 'toast-in 200ms ease-out' }}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}
