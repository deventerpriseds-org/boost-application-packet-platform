import React from 'react'
import { useApp, useRoute, go, useIsMobile } from './state.jsx'

const NAV = [
  { path: '/today', label: 'Today', icon: '◉' },
  { path: '/intake', label: 'Intake', icon: '⇊' },
  { path: '/swipe', label: 'Swipe', icon: '◈' },
  { path: '/opportunities', label: 'Opps', icon: '◇' },
  { path: '/pipeline', label: 'Pipeline', icon: '▤' },
  { path: '/packets', label: 'Packets', icon: '▦' },
  { path: '/outreach', label: 'Outreach', icon: '✉' },
  { path: '/call', label: 'Coach', icon: '☎' },
  { path: '/library', label: 'Library', icon: '▤' },
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
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--proto-panel-deep)" strokeWidth="3" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

function TopBar({ title }) {
  const { dark, setDark, auth } = useApp()
  const signedIn = !!auth?.user
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', height: 54, borderBottom: '1px solid var(--proto-rule-soft)', background: 'var(--proto-paper)', flexShrink: 0 }}>
      <div onClick={() => go('/today')} style={{ cursor: 'pointer', fontWeight: 700, fontSize: 16, letterSpacing: -0.3, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
        Pipeline<span style={{ color: 'var(--proto-accent)' }}>·</span>Exec
      </div>
      <div className="ee-hide-sm" style={{ borderLeft: '1px solid var(--proto-rule-soft)', paddingLeft: 12, fontSize: 13, color: 'var(--proto-ink2)' }}>{title}</div>
      <div style={{ flex: 1 }} />
      <button className="px-btn" onClick={() => go('/settings/account')} title={signedIn ? auth.user.email : 'Sign in'}
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: signedIn ? 'var(--surface-success-default)' : 'var(--proto-ink3)' }} />
        <span className="ee-hide-sm" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{signedIn ? auth.user.email : 'Sign in'}</span>
      </button>
      <button className="px-btn" onClick={() => go('/settings')} title="Settings">⚙</button>
      <button className="px-btn" onClick={() => setDark(!dark)} title="Toggle theme">{dark ? '☾' : '☀'}</button>
    </div>
  )
}

function SideNav() {
  const { parts } = useRoute()
  const active = '/' + (parts[0] || 'today')
  return (
    <div style={{ width: 196, borderRight: '1px solid var(--proto-rule-soft)', background: 'var(--proto-paper)', padding: 12, flexShrink: 0 }}>
      {NAV.map((n) => {
        const on = active === n.path
        return (
          <div key={n.path} onClick={() => go(n.path)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 2, fontSize: 13, fontWeight: on ? 600 : 500,
              background: on ? 'var(--proto-accent-soft)' : 'transparent', color: on ? 'var(--text-brand)' : 'var(--proto-ink2)' }}>
            <span style={{ width: 16, textAlign: 'center' }}>{n.icon}</span>{n.label === 'Opps' ? 'Opportunities' : n.label}
          </div>
        )
      })}
    </div>
  )
}

function BottomNav() {
  const { parts } = useRoute()
  const active = '/' + (parts[0] || 'today')
  return (
    <div style={{ display: 'flex', borderTop: '1px solid var(--proto-rule-soft)', background: 'var(--proto-paper)', flexShrink: 0, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {NAV.map((n) => {
        const on = active === n.path
        return (
          <div key={n.path} onClick={() => go(n.path)}
            style={{ flex: 1, textAlign: 'center', padding: '9px 4px 11px', cursor: 'pointer',
              color: on ? 'var(--text-brand)' : 'var(--proto-ink2)', fontWeight: on ? 600 : 500 }}>
            <div style={{ fontSize: 18, lineHeight: 1.1 }}>{n.icon}</div>
            <div style={{ fontSize: 11, marginTop: 2 }}>{n.label}</div>
          </div>
        )
      })}
    </div>
  )
}

export function DesktopShell({ children, title }) {
  const mobile = useIsMobile()
  const { parts } = useRoute()
  const active = '/' + (parts[0] || 'today')
  return (
    <div className="px-root">
      <TopBar title={title} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {!mobile && <SideNav />}
        <div className="px-fade" key={active} style={{ flex: 1, overflow: 'auto', padding: mobile ? 14 : 24 }}>
          <div style={{ maxWidth: 1280, margin: '0 auto' }}>{children}</div>
        </div>
      </div>
      {mobile && <BottomNav />}
    </div>
  )
}
