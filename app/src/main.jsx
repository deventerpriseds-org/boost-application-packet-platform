import React from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import App from './App.jsx'

// Prevent a single runtime error from rendering a blank page — show a message
// (and the error) instead so failures are visible, not silent.
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('App error:', error, info) }
  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 640, margin: '80px auto', padding: 24, fontFamily: 'Inter, system-ui, sans-serif', color: '#333' }}>
          <h2 style={{ marginTop: 0 }}>Something went wrong.</h2>
          <p>The app hit an error while loading. Try a hard refresh; if it persists, this detail helps debugging:</p>
          <pre style={{ background: '#f6f6f6', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12 }}>{String(this.state.error?.stack || this.state.error)}</pre>
          <button onClick={() => { try { localStorage.clear() } catch {} location.reload() }} style={{ padding: '8px 16px', cursor: 'pointer' }}>Clear local data &amp; reload</button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary><App /></ErrorBoundary>
)
