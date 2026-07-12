import React from 'react'
import { useApp, useRoute, go } from './state.jsx'
import { signOut } from './auth.js'

const NAV = [
  { path: '/upload',   label: 'Upload',   icon: '⇑',  desc: 'Add inputs' },
  { path: '/extract',  label: 'Extract',  icon: '✦',  desc: 'AI analysis' },
  { path: '/review',   label: 'Review',   icon: '◈',  desc: 'Edit tokens' },
  { path: '/export',   label: 'Export',   icon: '⇓',  desc: 'Download' },
  { path: '/showcase', label: 'Showcase', icon: '▦',  desc: 'Live preview' },
]

export function Shell({ children }) {
  const { state, dispatch } = useApp()
  const { path } = useRoute()
  const active = '/' + (path.replace(/^\//, '').split('/')[0] || 'upload')
  const signedIn = !!state.user

  async function handleSignOut() {
    await signOut()
    dispatch({ type: 'SET_USER', user: null })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ height: 'var(--dlg-topbar)', display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 16px', borderBottom: '1px solid var(--dlg-border)',
        background: 'var(--dlg-surface)', flexShrink: 0, zIndex: 10 }}>
        <div onClick={() => go('/upload')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="26" height="26" viewBox="0 0 32 32" style={{ flexShrink: 0 }}>
            <rect width="32" height="32" rx="8" fill="var(--dlg-brand)"/>
            <rect x="6" y="6" width="8" height="8" rx="2" fill="#fff"/>
            <rect x="18" y="6" width="8" height="8" rx="2" fill="var(--dlg-brand-light)"/>
            <rect x="6" y="18" width="8" height="8" rx="2" fill="var(--dlg-brand-light)"/>
            <rect x="18" y="18" width="8" height="8" rx="2" fill="#fff"/>
          </svg>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.3 }}>Design Library<span style={{ color: 'var(--dlg-brand)' }}>·</span>Gen</span>
        </div>
        <div style={{ flex: 1 }} />
        <button className="dlg-btn dlg-btn-ghost" onClick={() => dispatch({ type: 'TOGGLE_DARK' })} title="Toggle theme" style={{ padding: '0 8px' }}>
          {state.dark ? '☾' : '☀'}
        </button>
        {signedIn ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--dlg-text-2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{state.user.email}</span>
            <button className="dlg-btn dlg-btn-ghost" onClick={handleSignOut} style={{ fontSize: 12, padding: '0 8px' }}>Sign out</button>
          </div>
        ) : (
          <button className="dlg-btn" onClick={() => go('/upload')} style={{ fontSize: 13 }}>Sign in to save</button>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar nav */}
        <nav style={{ width: 'var(--dlg-sidebar)', flexShrink: 0, borderRight: '1px solid var(--dlg-border)',
          background: 'var(--dlg-surface)', padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map((n) => {
            const on = active === n.path
            return (
              <button key={n.path} onClick={() => go(n.path)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderRadius: 'var(--dlg-radius-md)', cursor: 'pointer', border: 'none',
                  background: on ? 'var(--dlg-brand-soft)' : 'transparent',
                  color: on ? 'var(--dlg-brand)' : 'var(--dlg-text-2)',
                  fontWeight: on ? 600 : 500, fontSize: 14, width: '100%', textAlign: 'left',
                  fontFamily: 'inherit', transition: 'all 0.15s' }}>
                <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>{n.icon}</span>
                <div>
                  <div>{n.label}</div>
                  <div style={{ fontSize: 11, color: on ? 'var(--dlg-brand)' : 'var(--dlg-text-3)', fontWeight: 400 }}>{n.desc}</div>
                </div>
              </button>
            )
          })}

          <div style={{ flex: 1 }} />

          {/* Step indicator */}
          <div style={{ padding: '12px 12px 4px', borderTop: '1px solid var(--dlg-border)' }}>
            <div className="t-label" style={{ color: 'var(--dlg-text-3)', marginBottom: 8 }}>Workflow</div>
            {NAV.slice(0, 4).map((n, i) => {
              const stepOn = active === n.path
              const stepDone = NAV.slice(0, i).some(m => m.path === active) || (active !== n.path && i < NAV.findIndex(m => m.path === active))
              return (
                <div key={n.path} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                    background: stepOn ? 'var(--dlg-brand)' : stepDone ? 'var(--dlg-success)' : 'var(--dlg-border)',
                    color: (stepOn || stepDone) ? '#fff' : 'var(--dlg-text-3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                    {stepDone ? '✓' : i + 1}
                  </div>
                  <span style={{ fontSize: 12, color: stepOn ? 'var(--dlg-text)' : 'var(--dlg-text-3)' }}>{n.label}</span>
                </div>
              )
            })}
          </div>
        </nav>

        {/* Main content */}
        <main style={{ flex: 1, overflow: 'auto', background: 'var(--dlg-bg)' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
