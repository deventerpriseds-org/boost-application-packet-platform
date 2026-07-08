import React from 'react'
import { useApp, useRoute, go, PERSONAS } from './state.jsx'

const NAV = [
  { path: '/today', label: 'Today', icon: '◉' },
  { path: '/opportunities', label: 'Opportunities', icon: '◇' },
  { path: '/pipeline', label: 'Pipeline', icon: '▤' },
]

// Shared primitives (ported from the handoff shell.jsx)
export const Pill = ({ children, tone }) => (
  <span className="px-pill" style={tone ? { background: `var(--proto-${tone}-soft)`, color: `var(--proto-${tone})` } : undefined}>{children}</span>
)

const STAGE_TONE = { Hot: 'red', Warm: 'yellow', Cool: 'accent' }
export const UrgencyPill = ({ urgency }) => (
  <span className="px-pill" style={{ background: `var(--proto-${STAGE_TONE[urgency] || 'panel'}-soft)`, color: `var(--proto-${STAGE_TONE[urgency] || 'ink2'})` }}>{urgency}</span>
)

export const StageBadge = ({ stage }) => <span className="px-chip" style={{ textTransform: 'capitalize' }}>{stage}</span>

export function MatchScore({ value, size = 34 }) {
  const r = (size - 6) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - (value || 0) / 100)
  const color = value >= 88 ? 'var(--proto-green)' : value >= 78 ? 'var(--proto-accent)' : 'var(--proto-yellow)'
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--proto-panel-deep)" strokeWidth="3" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

export function DesktopShell({ children, title }) {
  const { persona, personaKey, setPersonaKey, dark, setDark } = useApp()
  const { parts } = useRoute()
  const active = '/' + (parts[0] || 'today')
  return (
    <div className="px-root">
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 56, borderBottom: '1px solid var(--proto-rule-soft)', background: 'var(--proto-paper)', flexShrink: 0 }}>
        <div onClick={() => go('/today')} style={{ cursor: 'pointer', fontWeight: 700, fontSize: 17, letterSpacing: -0.3, color: 'var(--text-primary)' }}>
          Pipeline<span style={{ color: 'var(--proto-accent)' }}>·</span>Exec
        </div>
        <div style={{ borderLeft: '1px solid var(--proto-rule-soft)', paddingLeft: 12, fontSize: 13, color: 'var(--proto-ink2)' }}>{title}</div>
        <div style={{ flex: 1 }} />
        <select className="px-btn" value={personaKey} onChange={(e) => setPersonaKey(e.target.value)} style={{ fontSize: 12 }}>
          {Object.values(PERSONAS).map((p) => <option key={p.key} value={p.key}>{p.role} · {p.name}</option>)}
        </select>
        <button className="px-btn" onClick={() => setDark(!dark)} title="Toggle theme">{dark ? '☾' : '☀'}</button>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left nav */}
        <div style={{ width: 196, borderRight: '1px solid var(--proto-rule-soft)', background: 'var(--proto-paper)', padding: 12, flexShrink: 0 }}>
          {NAV.map((n) => {
            const on = active === n.path
            return (
              <div key={n.path} onClick={() => go(n.path)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 2, fontSize: 13, fontWeight: on ? 600 : 500,
                  background: on ? 'var(--proto-accent-soft)' : 'transparent', color: on ? 'var(--text-brand)' : 'var(--proto-ink2)' }}>
                <span style={{ width: 16, textAlign: 'center' }}>{n.icon}</span>{n.label}
              </div>
            )
          })}
          <div className="px-divider" style={{ margin: '12px 0' }} />
          <div className="px-small" style={{ padding: '0 12px', lineHeight: 1.6 }}>
            Persona<br /><b style={{ color: 'var(--proto-ink)' }}>{persona.role}</b><br />{persona.comp}
          </div>
        </div>
        {/* Body */}
        <div className="px-fade" key={active} style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          <div style={{ maxWidth: 1280, margin: '0 auto' }}>{children}</div>
        </div>
      </div>
    </div>
  )
}
