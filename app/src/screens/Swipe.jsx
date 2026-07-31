import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useApp, go } from '../state.jsx'
import { api } from '../api.js'
import { Pill, UrgencyPill, MatchScore, FavStar } from '../shell.jsx'
import { Loading, ErrorBox } from './Today.jsx'

const QUEUE_STAGES = ['discovered', 'saved', 'enriched']

// Short date for the swipe card (posting / extraction). Real value only — '—' when absent.
const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt) ? '—' : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Tinder-style triage: keep (→saved), maybe (→enriched), pass (dismiss).
export default function Swipe({ opps }) {
  const { toast } = useApp()
  const { loading, error, opportunities, optimisticMove, optimisticDismiss, optimisticUndismiss } = opps
  const [roleFilter, setRoleFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all') // ACT-31: source / intake-channel facet
  const [workFilter, setWorkFilter] = useState('all')      // ACT-33: remote / hybrid / onsite facet
  // ACT-32/33: the owner's persisted target metros + remote-only preference (from Settings ▸ Locations).
  const [prefs, setPrefs] = useState({ targetGeoIds: new Set(), remoteOnly: false })
  useEffect(() => {
    let alive = true
    api.searchPrefsGet().then((p) => { if (alive && p && p.ok !== false) setPrefs({ targetGeoIds: new Set(p.targetGeoIds || []), remoteOnly: !!p.remoteOnly }) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // Stage-eligible review queue, before the group pill is applied. Favorites first so promoted
  // roles surface at the top of triage.
  const stageQueue = useMemo(() => (
    opportunities.filter((o) => QUEUE_STAGES.includes(o.stage))
      .sort((a, b) => (Number(!!b.isFavorite) - Number(!!a.isFavorite)) || ((b.match || 0) - (a.match || 0)))
  ), [opportunities])
  const matchesRole = (o) => {
    if (roleFilter === 'all') return true
    if (roleFilter === 'fav') return !!o.isFavorite
    if (roleFilter === 'other') return !o.matchedGroup
    return o.matchedGroup === roleFilter
  }
  // Source/intake facet. The opportunity `source` already encodes both the board and how it came in
  // (LinkedIn = mailbox alert · LinkedIn Search = scheduled search · Extension · Email · Indeed).
  const matchesSource = (o) => sourceFilter === 'all' || (o.source || 'Unknown') === sourceFilter
  // ACT-33 ad-hoc work-mode facet (from the location's Remote/Hybrid/On-site modifier).
  const matchesWork = (o) => workFilter === 'all' || (o.workMode || 'unspecified') === workFilter
  // ACT-32/33 persisted prefs: target metros + remote-only. Empty target set = no location filter.
  const matchesPrefs = (o) => {
    const inTarget = prefs.targetGeoIds.size === 0 || (o.metroGeoId && prefs.targetGeoIds.has(o.metroGeoId))
    if (!prefs.remoteOnly) return inTarget
    // remote-only: keep remote roles OR roles inside a target metro; drop on-site elsewhere.
    return (o.workMode === 'remote') || (o.metroGeoId && prefs.targetGeoIds.has(o.metroGeoId)) || (prefs.targetGeoIds.size === 0 && o.workMode === 'remote')
  }
  // Cards already triaged THIS session, tracked by id. Deriving the queue from a
  // reviewed-set (not a positional index) is immune to the 15s poll reordering the
  // array, and to keep/maybe leaving a card in QUEUE_STAGES — a decided card never
  // reappears. `reviewedCount` gives a stable, monotonic "reviewed" tally.
  const [reviewed, setReviewed] = useState(() => new Set())
  const queue = useMemo(
    () => stageQueue.filter((o) => matchesRole(o) && matchesSource(o) && matchesWork(o) && matchesPrefs(o) && !reviewed.has(o.id)),
    [stageQueue, roleFilter, sourceFilter, workFilter, prefs, reviewed],
  )
  // Taxonomy group counts for the pill bar (remaining, within the active source facet so the two compose).
  const roleCounts = useMemo(() => {
    const c = { all: 0, fav: 0, csuite: 0, vp: 0, director: 0, other: 0 }
    for (const o of stageQueue) {
      if (reviewed.has(o.id) || !matchesSource(o) || !matchesWork(o) || !matchesPrefs(o)) continue
      c.all += 1
      if (o.isFavorite) c.fav += 1
      if (o.matchedGroup && c[o.matchedGroup] != null) c[o.matchedGroup] += 1
      else if (!o.matchedGroup) c.other += 1
    }
    return c
  }, [stageQueue, reviewed, sourceFilter, workFilter, prefs])
  // Source facet counts (remaining, within the active role facet). Built from the REAL distinct
  // `source` values present — no hardcoded list.
  const sourceCounts = useMemo(() => {
    const by = new Map()
    let all = 0
    for (const o of stageQueue) {
      if (reviewed.has(o.id) || !matchesRole(o) || !matchesWork(o) || !matchesPrefs(o)) continue
      all += 1
      const s = o.source || 'Unknown'
      by.set(s, (by.get(s) || 0) + 1)
    }
    return { all, items: [...by.entries()].sort((a, b) => b[1] - a[1]) }
  }, [stageQueue, reviewed, roleFilter, workFilter, prefs])
  // ACT-33 work-mode facet counts (remote/hybrid/onsite), composed with role+source+prefs.
  const workCounts = useMemo(() => {
    const c = { all: 0, remote: 0, hybrid: 0, onsite: 0 }
    for (const o of stageQueue) {
      if (reviewed.has(o.id) || !matchesRole(o) || !matchesSource(o) || !matchesPrefs(o)) continue
      c.all += 1
      const w = o.workMode
      if (w && c[w] != null) c[w] += 1
    }
    return c
  }, [stageQueue, reviewed, roleFilter, sourceFilter, prefs])
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false, decision: null })
  const [last, setLast] = useState(null) // { decision, opp, prevStage } — for undo
  const cardRef = useRef(null)
  const busyRef = useRef(false)

  const current = queue[0]
  const next = queue[1]

  // Lazy-load full opportunity detail (incl. JD summary/requirements/ATS table — fields the
  // list doesn't carry) for the current + next card, cached by id. Real data only; the JD tabs
  // simply don't appear when the opp has no parsed JD.
  const [details, setDetails] = useState({})
  useEffect(() => {
    let cancelled = false
    const need = [current, next].filter((o) => o && details[o.id] === undefined)
    need.forEach((o) => {
      api.getOpportunity(o.id)
        .then((full) => { if (!cancelled && full && !full.error) setDetails((d) => ({ ...d, [o.id]: full })) })
        .catch(() => { if (!cancelled) setDetails((d) => ({ ...d, [o.id]: null })) })
    })
    return () => { cancelled = true }
  }, [current?.id, next?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const withDetail = (o) => (o ? { ...o, ...(details[o.id] || {}) } : o)

  const decide = (decision, { build = false } = {}) => {
    if (!current) return
    if (busyRef.current) return
    busyRef.current = true
    const oppId = current.id
    // snapshot for undo (the full row + its stage before we changed it)
    setLast({ decision, opp: current, prevStage: current.stage })
    setReviewed((r) => { const n = new Set(r); n.add(oppId); return n }) // pull it out of the deck immediately
    if (decision === 'keep') { optimisticMove(oppId, 'saved', (e) => toast(`Failed: ${e.message}`)); toast(build ? `Saved ${current.company} — building packet` : `Saved ${current.company} · ⌘Z to undo`) }
    else if (decision === 'maybe') { optimisticMove(oppId, 'enriched', (e) => toast(`Failed: ${e.message}`)); toast(`${current.company} → Maybe · ⌘Z to undo`) }
    else if (decision === 'pass') { optimisticDismiss(oppId, (e) => toast(`Failed: ${e.message}`)); toast(`Dismissed ${current.company} · ⌘Z to undo`) }
    setDrag({ x: 0, y: 0, active: false, decision: null })
    // release the lock after the card transition so a held/repeated key can't double-act
    setTimeout(() => { busyRef.current = false }, 240)
    if (build && oppId) go(`/packet/${oppId}`)
  }

  // Undo the most recent decision: restore the opp to its prior stage / un-dismiss it
  // and drop it back out of the reviewed-set so it returns to the front of the deck.
  const undo = () => {
    if (!last || busyRef.current) return
    const { decision, opp, prevStage } = last
    if (decision === 'pass') optimisticUndismiss(opp, (e) => toast(`Undo failed: ${e.message}`))
    else optimisticMove(opp.id, prevStage, (e) => toast(`Undo failed: ${e.message}`))
    setReviewed((r) => { const n = new Set(r); n.delete(opp.id); return n })
    setLast(null)
    toast(`Restored ${opp.company}`)
  }

  // Keyboard triage: ← dismiss, → keep, ↓ maybe. Mirrors the action buttons.
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement
      const tag = el && el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (el && el.isContentEditable)) return
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); decide('pass') }
      else if (e.key === 'ArrowRight') { e.preventDefault(); decide('keep') }
      else if (e.key === 'ArrowDown') { e.preventDefault(); decide('maybe') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />

  const onDown = (e) => { cardRef.current?.setPointerCapture?.(e.pointerId); setDrag({ x: 0, y: 0, active: true, decision: null, startX: e.clientX, startY: e.clientY }) }
  const onMove = (e) => {
    if (!drag.active) return
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY
    let decision = null
    if (dx > 60) decision = 'keep'; else if (dx < -60) decision = 'pass'; else if (dy > 60) decision = 'maybe'
    setDrag((d) => ({ ...d, x: dx, y: dy, decision }))
  }
  const onUp = () => {
    if (!drag.active) return
    const { x, y } = drag
    if (x > 100) return decide('keep')
    if (x < -100) return decide('pass')
    if (y > 100) return decide('maybe')
    setDrag({ x: 0, y: 0, active: false, decision: null })
  }

  const rolePills = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <RolePills counts={roleCounts} value={roleFilter} onChange={setRoleFilter} />
      <SourcePills counts={sourceCounts} value={sourceFilter} onChange={setSourceFilter} />
      <WorkPills counts={workCounts} value={workFilter} onChange={setWorkFilter} />
    </div>
  )

  if (!current) {
    return (
      <div style={{ maxWidth: 460, margin: '0 auto', textAlign: 'center', padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        {rolePills}
        <div style={{ fontSize: 48 }}>✓</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Inbox zero</div>
        <div className="px-small">{roleFilter === 'all' ? 'All new opportunities reviewed. Fresh ones arrive overnight.' : 'No opportunities left for this role. Switch roles above or clear the filter.'}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {last && <button className="px-btn" onClick={undo}>↩ Undo {last.opp.company}</button>}
          {reviewed.size > 0 && <button className="px-btn" onClick={() => { setReviewed(new Set()); setLast(null) }}>Re-review all</button>}
          <button className="px-btn px-btn-accent" onClick={() => go('/pipeline')}>Open pipeline →</button>
        </div>
      </div>
    )
  }

  const rotation = drag.x / 14
  const done = reviewed.size          // decisions made this session (monotonic)
  const left = queue.length           // cards remaining in the current role scope
  const total = done + left
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div style={{ maxWidth: 460, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rolePills}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="px-small" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{done} of {total} reviewed</span>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {last && <span className="px-link" title="Undo last swipe (⌘Z / Ctrl+Z)" onClick={undo}>↩ Undo</span>}
            <span>{left} left</span>
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--proto-line, rgba(0,0,0,.1))', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--proto-green)', transition: 'width 220ms ease-out' }} />
        </div>
      </div>
      <div style={{ position: 'relative', height: 420 }}>
        {next && <SwipeCard o={withDetail(next)} style={{ position: 'absolute', inset: 0, transform: 'scale(0.96) translateY(8px)', opacity: 0.5, pointerEvents: 'none', zIndex: 1 }} />}
        <SwipeCard o={withDetail(current)} cardRef={cardRef} decision={drag.decision}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          style={{ position: 'absolute', inset: 0, zIndex: 2, touchAction: 'none', cursor: 'grab',
            transform: drag.active ? `translate(${drag.x}px, ${drag.y}px) rotate(${rotation}deg)` : 'none',
            transition: drag.active ? 'none' : 'transform 220ms ease-out' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-around', padding: '8px 0' }}>
        <ActionBtn label="✕ Dismiss" tone="red" onClick={() => decide('pass')} />
        <ActionBtn label="↓ Maybe" tone="yellow" onClick={() => decide('maybe')} />
        <ActionBtn label="✓ Keep" tone="green" onClick={() => decide('keep')} />
      </div>
      {current.id && (
        <button className="px-btn px-btn-accent" onClick={() => decide('keep', { build: true })}
          style={{ justifyContent: 'center', fontWeight: 700 }}>
          ✓ Keep &amp; build packet now →
        </button>
      )}
      <div style={{ textAlign: 'center', paddingBottom: 8 }}>
        <span className="px-link" style={{ fontSize: 12 }} onClick={() => go(`/opp/${current.id}`)}>Open full detail →</span>
      </div>
    </div>
  )
}

// Role priority pills — filter the triage queue so review can be worked one role at a time.
function RolePills({ counts, value, onChange }) {
  const items = [
    { key: 'all', name: 'All' }, { key: 'fav', name: '★ Favorites' },
    { key: 'csuite', name: 'C Suite' }, { key: 'vp', name: 'VP & Head of' },
    { key: 'director', name: 'Director' }, { key: 'other', name: 'Unclassified' },
  ]
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
      {items.map((r) => {
        const n = counts[r.key] || 0
        if ((r.key === 'other' || r.key === 'fav') && n === 0) return null // hide empty Other/Favorites
        const on = value === r.key
        return (
          <span key={r.key} className="px-pill" onClick={() => onChange(r.key)}
            style={{ cursor: 'pointer', background: on ? 'var(--surface-brand-default)' : undefined, color: on ? 'var(--text-on-brand)' : undefined }}>
            {r.name} {n}
          </span>
        )
      })}
    </div>
  )
}

// Source / intake-channel pills — filter the triage queue by where the opportunity came from
// (LinkedIn alert · LinkedIn Search · Indeed · Email · Extension …). Built from the real distinct
// sources in the deck; hidden entirely when there's only one source to choose from.
function SourcePills({ counts, value, onChange }) {
  if (!counts.items.length || (counts.items.length === 1 && value === 'all')) return null
  const chip = (key, name, n, on) => (
    <span key={key} className="px-pill" onClick={() => onChange(key)}
      style={{ cursor: 'pointer', fontSize: 11, background: on ? 'var(--surface-brand-default)' : undefined, color: on ? 'var(--text-on-brand)' : undefined }}>
      {name} {n}
    </span>
  )
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
      {chip('all', 'All sources', counts.all, value === 'all')}
      {counts.items.map(([s, n]) => chip(s, s, n, value === s))}
    </div>
  )
}

// Work-mode pills (ACT-33) — Remote / Hybrid / On-site, from the location modifier. Hidden when the
// deck has no work-mode signal at all.
function WorkPills({ counts, value, onChange }) {
  const opts = [['remote', 'Remote'], ['hybrid', 'Hybrid'], ['onsite', 'On-site']]
  if (!opts.some(([k]) => counts[k] > 0)) return null
  const chip = (key, name, n, on) => (
    <span key={key} className="px-pill" onClick={() => onChange(key)}
      style={{ cursor: 'pointer', fontSize: 11, background: on ? 'var(--surface-brand-default)' : undefined, color: on ? 'var(--text-on-brand)' : undefined }}>
      {name} {n}
    </span>
  )
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
      {chip('all', 'Any mode', counts.all, value === 'all')}
      {opts.filter(([k]) => counts[k] > 0).map(([k, n]) => chip(k, n, counts[k], value === k))}
    </div>
  )
}

function ActionBtn({ label, tone, onClick }) {
  return (
    <button onClick={onClick} className="px-btn"
      style={{ padding: '10px 18px', fontSize: 14, fontWeight: 700, minWidth: 92, justifyContent: 'center',
        color: `var(--proto-${tone})`, borderColor: `var(--proto-${tone})` }}>
      {label}
    </button>
  )
}

function SwipeCard({ o, decision, cardRef, style, ...handlers }) {
  // Compact tabs so JD detail lives on the card without a click-through. Only include JD tabs
  // whose data actually exists (real parsed JD) — no empty/fake tabs.
  const tabs = useMemo(() => {
    const t = [{ key: 'overview', label: 'Overview' }]
    if (o?.jdRequirements) t.push({ key: 'reqs', label: 'Requirements' })
    if (o?.jdTable) t.push({ key: 'ats', label: 'ATS' })
    return t
  }, [o?.jdRequirements, o?.jdTable])
  const [tab, setTab] = useState('overview')
  useEffect(() => { setTab('overview') }, [o?.id]) // new card resets to Overview
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'overview'
  const stop = (e) => e.stopPropagation() // don't let tab clicks / JD scroll start a card drag

  return (
    <div ref={cardRef} {...handlers} className="px-box"
      style={{ display: 'flex', flexDirection: 'column', padding: 16, gap: 10, userSelect: 'none', boxShadow: '4px 6px 20px rgba(0,0,0,.08)', ...style }}>
      {decision === 'keep' && <Overlay tilt={-12} label="KEEP" tone="green" pos="left" />}
      {decision === 'pass' && <Overlay tilt={12} label="PASS" tone="red" pos="right" />}
      {decision === 'maybe' && <Overlay tilt={0} label="MAYBE" tone="yellow" pos="bottom" />}

      {/* Identity header — always visible */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <FavStar on={o.isFavorite} size={16} />{o.company}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{o.jdTitle || o.role}</div>
          <div className="px-small">{[o.matchedRole, o.location, o.comp].filter(Boolean).join(' · ') || '—'}</div>
        </div>
        <MatchScore value={o.match} size={44} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {o.urgency && <UrgencyPill urgency={o.urgency} />}
        {o.fit && <Pill tone="accent">{o.fit}</Pill>}
        {o.workMode === 'remote' && <Pill tone="green">🌐 Remote</Pill>}
        {o.workMode === 'hybrid' && <Pill>Hybrid</Pill>}
        {o.workMode === 'onsite' && <Pill>On-site</Pill>}
        {o.metroName && <Pill>{o.metroName}</Pill>}
        {o.source && <Pill>{o.source}</Pill>}
      </div>

      {/* Tab bar (only when there's JD detail to tab into) */}
      {tabs.length > 1 && (
        <div onPointerDown={stop} style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--proto-rule-soft)' }}>
          {tabs.map((t) => (
            <button key={t.key} onClick={(e) => { stop(e); setTab(t.key) }} onPointerDown={stop}
              style={{ appearance: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px',
                fontSize: 12, fontWeight: 700, color: activeTab === t.key ? 'var(--text-brand)' : 'var(--proto-ink3)',
                borderBottom: activeTab === t.key ? '2px solid var(--surface-brand-default)' : '2px solid transparent', marginBottom: -1 }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Tab content — scrolls within the card so long JD stays compact */}
      <div onPointerDown={activeTab === 'overview' ? undefined : stop}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 2 }}>
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Posting date (when the job was listed) + extraction date (when we ingested it) */}
            <div className="px-small" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span>📅 Posted: <b>{fmtDate(o.sourceDate)}</b></span>
              <span>⬇ Found: <b>{fmtDate(o.createdAt)}</b></span>
            </div>
            {o.why && (
              <div>
                <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Why surfaced</div>
                <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.45 }}>{o.why}</div>
              </div>
            )}
            {o.hm && o.hm !== '—' && (
              <div className="px-box" style={{ padding: 8, fontSize: 12 }}>
                <span className="px-small">Hiring manager</span> · <b>{o.hm}</b>
              </div>
            )}
            {o.jdSummary && (
              <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Summary</div>
                {o.jdTitle && <div className="px-small" style={{ marginBottom: 4 }}><b>Title:</b> {o.jdTitle}{o.jdCompany ? ` · ${o.jdCompany}` : ''}</div>}
                <div>{o.jdSummary}</div>
              </div>
            )}
            {!o.why && (!o.hm || o.hm === '—') && !o.jdSummary && <div className="px-small">Swipe to triage — open full detail for more.</div>}
          </div>
        )}
        {activeTab === 'reqs' && (
          <div style={{ fontSize: 13, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: o.jdRequirements }} />
        )}
        {activeTab === 'ats' && (
          <div style={{ fontSize: 12 }} dangerouslySetInnerHTML={{ __html: o.jdTable }} />
        )}
      </div>

      <div style={{ textAlign: 'center' }}>
        <div className="px-small">⟵ swipe or use the buttons ⟶</div>
      </div>
    </div>
  )
}

function Overlay({ label, tone, tilt, pos }) {
  return (
    <div style={{ position: 'absolute',
      top: pos === 'bottom' ? 'auto' : 24, bottom: pos === 'bottom' ? 24 : 'auto',
      left: pos === 'left' ? 16 : (pos === 'bottom' ? 0 : 'auto'),
      right: pos === 'right' ? 16 : (pos === 'bottom' ? 0 : 'auto'),
      margin: pos === 'bottom' ? '0 auto' : 0, width: pos === 'bottom' ? 'fit-content' : 'auto',
      padding: '6px 16px', border: `3px solid var(--proto-${tone})`, color: `var(--proto-${tone})`,
      fontSize: 26, fontWeight: 900, transform: `rotate(${tilt}deg)`, background: 'var(--proto-paper)', borderRadius: 8, zIndex: 5 }}>
      {label}
    </div>
  )
}
