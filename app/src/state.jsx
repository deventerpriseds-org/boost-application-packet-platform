import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

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

export function AppProvider({ children }) {
  const [personaKey, setPersonaKey] = useState('CTO')
  const [dark, setDark] = useState(false)
  const [toasts, setToasts] = useState([])

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
