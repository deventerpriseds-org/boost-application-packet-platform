import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useApp, useRoute, go, useIsMobile } from './state.jsx'
import { overlayVariant, FOCUSABLE_SELECTOR, wrapFocusIndex, routeKeyOf, hasNavigated } from './overlay.js'

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
  panel: { bg: 'var(--proto-panel-deep)', fg: 'var(--proto-ink-on-panel)' },
  orange: { bg: 'var(--proto-yellow-soft)', fg: 'var(--proto-orange)' },
  ok: { bg: 'var(--proto-green-soft)', fg: 'var(--proto-green)' },
  warn: { bg: 'var(--proto-yellow-soft)', fg: 'var(--proto-yellow)' },
}

// Exported so the contrast sweep (test/browser/run-tones.mjs) measures THE table rather than a
// copy of it. A guard holding its own copy of the thing it checks cannot fail when the real one
// changes; three inert guards shipped in this repo that way before this rule was written.
export const TONE_TABLE = TONE

export const Pill = ({ children, tone, style }) => {
  const t = TONE[tone]
  return (
    <span className="px-pill" style={{ ...(t ? { background: t.bg, color: t.fg } : {}), ...style }}>{children}</span>
  )
}

// Resolve a tone to real tokens. EVERY tone consumer must go through these — building
// interpolating a tone into a custom-property name is the bug that made todo pills invisible,
// and it stayed live wherever done by hand (tone 'orange' has no -soft token at all).
// toneFill  → { background, color } for a filled chip.
// toneColor → a single solid color for a rail/border/number.
export const toneFill = (tone) => {
  const t = TONE[tone]
  return t ? { background: t.bg, color: t.fg } : { background: 'var(--proto-panel)', color: 'var(--proto-ink2)' }
}
const TONE_SOLID = {
  accent: 'var(--proto-accent)', green: 'var(--proto-green)', red: 'var(--proto-red)',
  yellow: 'var(--proto-yellow)', purple: 'var(--proto-purple)', orange: 'var(--proto-orange)',
  ok: 'var(--proto-green)', warn: 'var(--proto-yellow)',
  // `panel` as a solid was painting a rail in the panel background — invisible by construction.
  // ink3 is the intended "no signal" grey and is actually visible.
  panel: 'var(--proto-ink3)',
}
export const toneColor = (tone) => TONE_SOLID[tone] || 'var(--proto-ink3)'

// Recency-temperature chips, resolved the SAME way and for the same reason.
//
// Today.jsx and Opportunities.jsx each built these declarations by interpolating the temperature
// key into the custom-property name — `var(--temp-${k}-tint)` — which is the exact construct that
// made the `todo` pill invisible: a key with no matching token produces an INVALID declaration,
// and CSS drops an invalid declaration without a word. It happened to resolve here only because
// all four keys have tokens today; the day a fifth temperature is added it silently paints
// nothing. Listing them makes the failure a missing entry in this table instead.
//
// Both screens also hand-built the same chip style, so this returns the whole style and the two
// can no longer drift apart.
const TEMP_TOKENS = {
  hot: { solid: 'var(--temp-hot)', tint: 'var(--temp-hot-tint)' },
  warm: { solid: 'var(--temp-warm)', tint: 'var(--temp-warm-tint)' },
  cooling: { solid: 'var(--temp-cooling)', tint: 'var(--temp-cooling-tint)' },
  cold: { solid: 'var(--temp-cold)', tint: 'var(--temp-cold-tint)' },
}
// Exported for the SAME reason as TONE_TABLE: the contrast sweep measures THESE keys, not a copy
// of them, so a fifth temperature is swept the day it is added and cannot ship below threshold.
export const TEMP_KEYS = Object.keys(TEMP_TOKENS)
/** A temperature's two tokens. An unknown key falls back to visible ink, never to nothing. */
export const tempColor = (key) => (TEMP_TOKENS[key] || { solid: 'var(--proto-ink3)', tint: 'transparent' })
/** The chip style, tinted when the filter is on and outlined in both states. */
export const tempChipStyle = (key, on) => {
  const t = tempColor(key)
  return { background: on ? t.tint : 'transparent', color: t.solid, border: `1px solid ${t.solid}` }
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
  on ? <span title={title} aria-label="favorite" style={{ color: 'var(--gold)', fontSize: size, lineHeight: 1 }}>★</span> : null

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

// ── Overlay: the ONE drawer/modal primitive (D10) ────────────────────────────────────────────────
//
// It lives here, beside Pill/MatchScore, because the behaviours below are GLOBAL rules that must
// not be re-implemented (or forgotten) by whichever screen happens to open a panel:
//   • close on navigation (P8.5) — see the route effect;
//   • Escape closes the TOPMOST overlay only;
//   • focus enters on open, is trapped while open, and returns to the trigger on close;
//   • backdrop click closes;
//   • the page behind stops scrolling.
// Variant geometry and the token map live in overlay.js so they can be unit-tested without a DOM.
//
// Rendered through a portal onto <body>. Inline `position:fixed` is NOT reliable in this shell:
// the content pane carries `.px-fade`, whose keyframes animate `transform`, and an ancestor with a
// transform becomes the containing block for fixed descendants. A portal removes that class of
// bug entirely. The theme class lives on <html>, so a portalled overlay still themes correctly.

// Mounted overlays, oldest first. Escape must dismiss only the topmost one, or a modal opened from
// a drawer would close both on one key press.
const OVERLAY_STACK = []

// Page-scroll lock, reference-counted so closing an inner overlay does not unlock while an outer
// one is still open. NOTE: `body` is already `overflow:hidden` (theme.css) — the element that
// actually scrolls is the shell's content pane, so that is what has to be frozen. Its scrollTop is
// saved and restored, because flipping overflow auto -> hidden -> auto can otherwise drop the
// reader back at the top of a long packet.
let scrollLocks = 0
let lockedPanes = null
function lockPageScroll() {
  if (++scrollLocks > 1) return
  lockedPanes = Array.from(document.querySelectorAll('.ee-scrollpane')).map((el) => ({ el, overflow: el.style.overflow, top: el.scrollTop }))
  lockedPanes.forEach((s) => { s.el.style.overflow = 'hidden' })
  document.body.classList.add('ee-overlay-open')
}
function unlockPageScroll() {
  if (scrollLocks > 0) scrollLocks -= 1
  if (scrollLocks > 0) return
  ;(lockedPanes || []).forEach((s) => {
    s.el.style.overflow = s.overflow
    // Chromium keeps scrollTop across an overflow auto->hidden->auto round trip, so this is a
    // belt-and-braces restore rather than the load-bearing part; it costs nothing and guards
    // engines that clamp instead.
    if (s.el.scrollTop !== s.top) s.el.scrollTop = s.top
  })
  lockedPanes = null
  document.body.classList.remove('ee-overlay-open')
}

export function Overlay({
  open = true,          // `{cond && <Overlay/>}` also works: unmount runs the same cleanup
  onClose,
  variant = 'modal',    // 'drawer' | 'modal'
  title,
  subtitle,
  headerRight,          // e.g. a gate badge, rendered left of the close button
  footer,
  width,                // optional override; the variant default already clamps to the viewport
  ariaLabel,            // required only when no `title` is given
  children,
}) {
  const v = overlayVariant(variant)
  const panelRef = useRef(null)
  const instanceRef = useRef({})     // stable identity for this overlay in OVERLAY_STACK
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const titleId = React.useId()

  // Close on navigation (P8.5). Read from the SAME hash router every screen uses (state.jsx
  // `useRoute`), so "the route" has one definition in the app. Query-string changes are ignored on
  // purpose — see routeKeyOf() in overlay.js.
  const { parts } = useRoute()
  const routeKey = routeKeyOf(parts)
  const routeAtOpen = useRef(null)
  useEffect(() => {
    if (!open) { routeAtOpen.current = null; return }
    if (routeAtOpen.current == null) { routeAtOpen.current = routeKey; return }
    if (hasNavigated(routeAtOpen.current, routeKey)) onCloseRef.current && onCloseRef.current()
  }, [open, routeKey])

  // Stack registration, scroll lock, Escape, focus in / focus back.
  useEffect(() => {
    if (!open) return
    const id = instanceRef.current
    OVERLAY_STACK.push(id)
    lockPageScroll()
    const trigger = document.activeElement
    if (panelRef.current) panelRef.current.focus({ preventScroll: true })

    const isTop = () => OVERLAY_STACK[OVERLAY_STACK.length - 1] === id
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || !isTop()) return
      e.preventDefault()
      e.stopPropagation()
      onCloseRef.current && onCloseRef.current()
    }
    // Second half of the trap: Tab is handled on the panel, but focus can also arrive from a click
    // or from the browser chrome. If it lands outside while we are topmost, pull it back.
    const onFocusIn = (e) => {
      if (!isTop()) return
      const p = panelRef.current
      if (p && !p.contains(e.target)) p.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      const i = OVERLAY_STACK.indexOf(id)
      if (i >= 0) OVERLAY_STACK.splice(i, 1)
      unlockPageScroll()
      if (trigger && typeof trigger.focus === 'function' && document.contains(trigger)) trigger.focus({ preventScroll: true })
    }
  }, [open])

  // Tab / Shift+Tab wrap inside the panel. The index arithmetic is wrapFocusIndex() in overlay.js.
  const onPanelKeyDown = (e) => {
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const nodes = Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => el.offsetParent !== null)
    e.preventDefault()
    if (!nodes.length) { panel.focus({ preventScroll: true }); return }
    const next = wrapFocusIndex(nodes.length, nodes.indexOf(document.activeElement), e.shiftKey)
    if (nodes[next]) nodes[next].focus({ preventScroll: true })
  }

  if (!open) return null

  const label = title ? { 'aria-labelledby': titleId } : { 'aria-label': ariaLabel || (variant === 'drawer' ? 'Panel' : 'Dialog') }
  const close = () => onCloseRef.current && onCloseRef.current()

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: v.zIndex, display: 'flex', alignItems: v.align, justifyContent: v.justify, padding: v.padding }}>
      <div onClick={close} aria-hidden="true"
        style={{ position: 'absolute', inset: 0, background: 'var(--qc-scrim)', backdropFilter: 'blur(2px)' }} />
      <div ref={panelRef} className="px-fade" role="dialog" aria-modal="true" tabIndex={-1} onKeyDown={onPanelKeyDown} {...label}
        style={{
          // border-box, or the 1px frame is ADDED to the width and a `min(680px, 100vw)` drawer
          // measures 681px on a 680px allowance — one pixel of horizontal overflow on a phone.
          position: 'relative', display: 'flex', flexDirection: 'column', outline: 'none', boxSizing: 'border-box',
          width: width || v.width, maxWidth: '100%', height: v.height, maxHeight: v.maxHeight,
          background: 'var(--proto-paper)', color: 'var(--proto-ink)', overflow: 'hidden',
          boxShadow: v.shadow, ...v.frame,
        }}>
        {(title || subtitle || headerRight || onClose) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', flexShrink: 0, borderBottom: '1px solid var(--proto-rule-soft)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && <div id={titleId} style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>}
              {subtitle && <div className="px-small">{subtitle}</div>}
            </div>
            {headerRight}
            {onClose && (
              <button type="button" className="px-btn" onClick={close} aria-label="Close" title="Close" style={{ padding: '2px 8px' }}>✕</button>
            )}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14 }}>{children}</div>
        {footer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 14px', flexShrink: 0, borderTop: '1px solid var(--proto-rule-soft)' }}>{footer}</div>
        )}
      </div>
    </div>,
    document.body,
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
        {/* `ee-scrollpane` marks the element that actually scrolls (body is overflow:hidden), so
            Overlay can freeze the page behind it and restore the position on close. */}
        <div className="px-fade ee-scrollpane" key={active} style={{ flex: 1, overflow: 'auto', padding: mobile ? 14 : 24 }}>
          <div style={{ maxWidth: 1280, margin: '0 auto' }}>{children}</div>
        </div>
      </div>
      {mobile && <BottomNav />}
    </div>
  )
}
