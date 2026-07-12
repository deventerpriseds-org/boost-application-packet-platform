import React, { createContext, useContext, useReducer, useState, useEffect } from 'react'
import { loadUser } from './auth.js'

// ── Router ─────────────────────────────────────────────────────────────────
export function useRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/upload')
  useEffect(() => {
    const h = () => setHash(window.location.hash || '#/upload')
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  const path = hash.replace(/^#/, '') || '/upload'
  const parts = path.replace(/^\//, '').split('/')
  return { path, parts }
}

export function go(path) {
  window.location.hash = path
}

// ── App State ───────────────────────────────────────────────────────────────
const Ctx = createContext(null)

const INITIAL = {
  user: null,
  dark: false,
  // extraction session
  uploadedFiles: [],    // { id, name, dataUrl, type }
  inputUrls: [],        // string[]
  description: '',
  projectName: '',
  primaryColorHint: '',
  extractionLog: [],    // { category, message, done }
  extracting: false,
  result: null,         // the full design-system JSON once extracted
  // saved systems (for showcase dropdown)
  savedSystems: [],
  activeSystemId: null,
}

function reducer(s, a) {
  switch (a.type) {
    case 'SET_USER': return { ...s, user: a.user }
    case 'TOGGLE_DARK': return { ...s, dark: !s.dark }
    case 'SET_FILES': return { ...s, uploadedFiles: a.files }
    case 'SET_URLS': return { ...s, inputUrls: a.urls }
    case 'SET_DESC': return { ...s, description: a.description }
    case 'SET_NAME': return { ...s, projectName: a.name }
    case 'SET_COLOR_HINT': return { ...s, primaryColorHint: a.color }
    case 'START_EXTRACT': return { ...s, extracting: true, extractionLog: [], result: null }
    case 'LOG_CHUNK': return { ...s, extractionLog: [...s.extractionLog, a.event] }
    case 'SET_RESULT': return { ...s, extracting: false, result: a.result }
    case 'EXTRACT_ERROR': return { ...s, extracting: false }
    case 'PATCH_RESULT': return { ...s, result: { ...s.result, ...a.patch } }
    case 'SET_SAVED': return { ...s, savedSystems: a.systems }
    case 'ADD_SAVED': return { ...s, savedSystems: [a.system, ...s.savedSystems], activeSystemId: a.system.id }
    case 'SET_ACTIVE': return { ...s, activeSystemId: a.id }
    default: return s
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, { ...INITIAL, user: loadUser() })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.dark ? 'dark' : 'light')
  }, [state.dark])

  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>
}

export function useApp() { return useContext(Ctx) }
