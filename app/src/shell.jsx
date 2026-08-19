import React from 'react'
import { useApp, useRoute, go, useIsMobile } from './state.jsx'

const NAV = [
  { path: '/today',              label: 'Today',        icon: '◉' },
  { path: '/swipe',              label: 'Swipe',        icon: '⧉' },
  { path: '/opportunities',      label: 'Opportunities', icon: '◇' },
  { path: '/pipeline',           label: 'Pipeline',      icon: '▤' },
  { path: '/packets',            label: 'Packets',       icon: '▦' },
  { path: '/outreach',           label: 'Outreach',      icon: '✉' },
  { path: '/interview',          label: 'Interviews',    icon: '◍' },
  { path: '/library',            label: 'Assets',        icon: '◫' },
  { path: '/roles',              label: 'Roles & Titles', icon: '☰' },
  { path: '/library/roles',      label: 'Role Profiles', icon: '◈' },
  { path: '/library/playbooks',  label: 'Playbooks',     icon: '▥' },
  { path: '/call',               label: 'Coach',         icon: '☎' },
  { path: '/intake',             label: 'Intake',        icon: '⇊' },
]

// Shared primitives (ported from the handoff shell.jsx)
//
// TONE is an EXPLICIT map, not string interpolation into a custom property.
// The old form interpolated the tone name into a custom-property name at render time, which
// silently produced INVALID declarations for every tone lacking a `-soft` token. Only
// accent/green/red/yellow/purple have one, so `panel` (every `todo` artifact), `orange`, `ok` and
// `warn` all rendered as an invalid background plus, for `panel`, near-white text on a near-white
// pill — i.e. invisible. A missing token must fall back to the readable `.px-pill` default, never
// to an unrendered declaration, so every tone is listed here with a real bg/fg pair.
const TONE = {
  accent: { bg: 'var(--proto-accent-soft)', fg: 'var(--proto-accent)' },
  green: { bg: 'var(--proto-green-soft)', fg: 'var(--proto-green)' },
  red: { bg: 'var(--proto-red-soft)', fg: 'var(--proto-red)' },
  yellow: { bg: 'var(--proto-yellow-soft)', fg: 'var(--proto-yellow)' },
  purple: { bg: 'var(--proto-purple-soft)', fg: 'var(--proto-purple)' },
  // No -soft token exists for these; pair them with defined tokens instead of inventing one.
  panel: { bg: 'var(--proto-panel-deep)', fg: 'var(--proto-ink2)' },
  orange: { bg: 'var(--proto-yellow-soft)', fg: 'var(--proto-orange)' },
  ok: { bg: 'var(--proto-green-soft)', fg: 'var(--proto-green)' },
  warn: { bg: 'var(--proto-yellow-soft)', fg: 'var(--proto-yellow)' },
}

export const Pill = ({ children, tone, style }) => {
  const t = TONE[tone]
  return (
    <span className="px-pill" style={{ ...(t ? { background: t.bg, color: t.fg } : {}), ...style }}>{children}</span>
  )
}

// ── ONE signal indicator, config-driven by `kind` ────────────────────────────────────────────────
// Two independent per-opp signals share one component (styling/label/tooltip live in one place):
//  • temperature = posting recency → a FLAME, colored Hot(orange)→Warm(yellow)→Cooling(blue)→Cold(white)
//  • priority    = journey urgency → a rounded WARNING TRIANGLE w/ white "!", Urgent(red)→Active(green)
//                  →Ready(yellow)→New(white)
// Both render together on a card; a new signal later = one more row in these tables, not a 4th component.
const TEMP_META = {
  hot:     { label: 'Hot',     color: '#ef5a34' },  // fiery orange-red
  warm:    { label: 'Warm',    color: '#e8a90b' },  // yellow
  cooling: { label: 'Cooling', color: '#3b82f6' },  // blue
  cold:    { label: 'Cold',    color: '#cbd2dc', pale: true },  // white/pale — needs a stroke to show
}
const PRIO_META = {
  urgent: { label: 'Urgent', color: '#ef4444' },  // red
  active: { label: 'Active', color: '#22c55e' },  // green
  ready:  { label: 'Ready',  color: '#e8a90b' },  // yellow
  new:    { label: 'New',    color: '#cbd2dc', pale: true },  // white/pale
  done:   { label: 'Won',    color: '#22c55e' },
}
// Left-bar / accent color per priority (used where a full icon is too much, e.g. Today's do-next rail).
export const PRIORITY_COLOR = { urgent: '#ef4444', active: '#22c55e', ready: '#e8a90b', new: 'var(--proto-ink3)', done: '#22c55e' }

function FlameGlyph({ color, stroke, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M12.5 2c.4 3-1.6 4.2-2.8 5.8C8.4 9.5 8 10.8 8 12.4A4 4 0 0 0 16 13c0-1.4-.5-2.4-1.2-3.3.1 1-.5 1.8-1.3 2 .6-1.6.3-3.6-1-5.5-.3.9-.9 1.4-1.6 1.7.8-1.7 1.3-3.9 1.6-6.1z"
        fill={color} stroke={stroke || 'none'} strokeWidth={stroke ? 1 : 0} strokeLinejoin="round" />
    </svg>
  )
}
function WarnTriangle({ color, stroke, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M12 3.6c.72 0 1.38.4 1.73 1.03l7.4 13.2c.68 1.22-.2 2.77-1.73 2.77H4.6c-1.53 0-2.4-1.55-1.73-2.77l7.4-13.2A1.98 1.98 0 0 1 12 3.6z"
        fill={color} stroke={stroke || 'none'} strokeWidth={stroke ? 1 : 0} strokeLinejoin="round" />
      <rect x="11.05" y="9" width="1.9" height="5.2" rx="0.95" fill="#fff" />
      <circle cx="12" cy="16.6" r="1.05" fill="#fff" />
    </svg>
  )
}

// kind: 'temperature' | 'priority'. showLabel toggles the text beside the glyph (default on).
export function SignalIcon({ kind, value, ageDays, showLabel = true, size = 15 }) {
  const isTemp = kind === 'temperature'
  const m = (isTemp ? TEMP_META : PRIO_META)[value]
  if (!m) return null
  const stroke = m.pale ? 'var(--proto-rule)' : null   // pale glyphs get an outline so they show on white
  const age = isTemp && ageDays != null ? (ageDays < 1 ? ' · <1d' : ` · ${Math.round(ageDays)}d`) : ''
  const tip = isTemp ? (ageDays != null ? `${m.label} — posted ~${ageDays}d ago` : m.label) : `${m.label} — action priority`
  return (
    <span title={tip} aria-label={tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      {isTemp ? <FlameGlyph color={m.color} stroke={stroke} size={size} /> : <WarnTriangle color={m.color} stroke={stroke} size={size} />}
      {showLabel && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--proto-ink2)' }}>{m.label}{age}</span>}
    </span>
  )
}

export const StageBadge = ({ stage }) => <span className="px-chip" style={{ textTransform: 'capitalize' }}>{stage}</span>

// Gold favorite star — rendered only for is_favorite opportunities (priority flag).
export const FavStar = ({ on, title = 'Favorite role — promoted', size = 14 }) =>
  on ? <span title={title} aria-label="favorite" style={{ color: '#c08a1e', fontSize: size, lineHeight: 1 }}>★</span> : null

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
  const activePath = '/' + parts.slice(0, 2).filter(Boolean).join('/')
  return (
    <div style={{ width: 196, borderRight: '1px solid var(--proto-rule-soft)', background: 'var(--proto-paper)', padding: 12, flexShrink: 0, overflowY: 'auto' }}>
      {NAV.map((n) => {
        const on = activePath === n.path || activePath.startsWith(n.path + '/') && n.path !== '/today'
        return (
          <div key={n.label} onClick={() => go(n.path)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 2, fontSize: 13, fontWeight: on ? 600 : 500,
              background: on ? 'var(--proto-accent-soft)' : 'transparent', color: on ? 'var(--text-brand)' : 'var(--proto-ink2)' }}>
            <span style={{ width: 16, textAlign: 'center' }}>{n.icon}</span>{n.label}
          </div>
        )
      })}
    </div>
  )
}

// Mobile bottom nav shows a condensed subset
const MOBILE_NAV = ['Today', 'Opportunities', 'Packets', 'Outreach', 'Coach']

function BottomNav() {
  const { parts } = useRoute()
  const activePath = '/' + (parts[0] || 'today')
  const mobileItems = NAV.filter((n) => MOBILE_NAV.includes(n.label))
  return (
    <div style={{ display: 'flex', borderTop: '1px solid var(--proto-rule-soft)', background: 'var(--proto-paper)', flexShrink: 0, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {mobileItems.map((n) => {
        const on = activePath === n.path
        return (
          <div key={n.label} onClick={() => go(n.path)}
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
