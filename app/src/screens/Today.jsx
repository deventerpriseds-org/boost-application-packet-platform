import React, { useMemo, useState, useEffect, useCallback } from 'react'
import { useApp, go } from '../state.jsx'
import { useOpportunities } from '../data.jsx'
import { api } from '../api.js'
import { Pill, UrgencyPill, MatchScore, StageBadge } from '../shell.jsx'

// Next-best action per opportunity stage → a real destination in the app.
function priorityActions(opps) {
  const first = (pred) => opps.find(pred)
  const items = []
  const hot = first((o) => ['final', 'panel', 'offer'].includes(o.stage))
  const screen = first((o) => o.stage === 'screen' || o.stage === 'r1')
  const reach = first((o) => o.stage === 'outreach' || o.stage === 'engaged')
  const stale = first((o) => o.urgency === 'Cool')
  if (hot) items.push({ id: hot.id, who: hot.company, t: hot.stage === 'offer' ? 'Offer on the table — open negotiation' : `${hot.stage === 'final' ? 'Final round' : 'Panel'} — prep now`, cta: hot.stage === 'offer' ? 'Negotiate' : 'Prep', to: hot.stage === 'offer' ? `/offer/${hot.id}` : `/interview/${hot.id}`, tone: 'red' })
  if (reach) items.push({ id: reach.id, who: reach.company, t: 'Outreach in flight — send the next touch', cta: 'Compose', to: `/compose/${reach.id}`, tone: 'yellow' })
  if (screen) items.push({ id: screen.id, who: screen.company, t: 'Recorded screen — debrief it', cta: 'Debrief', to: `/interview/${screen.id}/debrief`, tone: 'accent' })
  if (stale) items.push({ id: stale.id, who: stale.company, t: 'Going stale — decide next move', cta: 'Review', to: `/opp/${stale.id}`, tone: 'panel' })
  return items.slice(0, 5)
}

// Stage groupings for the "Today" hero: what's fresh to triage vs. in-flight.
// FRESH_STAGES includes 'enriched' because mail ingest advances rows discovered→enriched
// immediately; without it the KPI shows 0 even when opportunities exist.
const FRESH_STAGES = ['discovered', 'saved', 'enriched']
const ACTIVE_STAGES = ['applied', 'outreach', 'engaged', 'screen', 'r1', 'panel', 'final', 'offer']

// Bin an opportunity into a monitored-role family (mirrors the intake design).
function roleFamily(o) {
  const r = (o.role || '').toLowerCase()
  if (r.includes('cto')) return 'CTO Roles'
  if (r.includes('ai')) return 'VP AI Transformation'
  if (r.includes('vp engineering')) return 'VP Engineering'
  if (r.includes('product')) return 'VP Product'
  if (r.includes('head') || r.includes('digital')) return 'Head of Digital'
  if (r.includes('engineering')) return 'VP Engineering'
  return 'Other roles'
}
const ROLE_DOT = {
  'CTO Roles': 'var(--surface-brand-default)',
  'VP Engineering': 'var(--surface-success-default)',
  'VP Product': 'var(--proto-purple)',
  'VP AI Transformation': 'var(--proto-orange)',
  'Head of Digital': 'var(--surface-error-default)',
  'Other roles': 'var(--proto-ink3)',
}

// "Latest inbox scrub" hero — new roles found overnight, binned by role family,
// with a swipe-review CTA. Ported from the design handoff (home.jsx).
function InboxScrubHero({ newToday, backlog, toast }) {
  const bins = useMemo(() => {
    const map = {}
    newToday.forEach((o) => { const f = roleFamily(o); map[f] = (map[f] || 0) + 1 })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [newToday])
  const total = newToday.length
  const companies = [...new Set(newToday.slice(0, 6).map((o) => o.company))]

  const [watch, setWatch] = useState(null)
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    api.mailSubscriptions().then((r) => {
      const watches = (r.value || []).filter((w) => (w.notificationUrl || '').includes('/mail/notify'))
      setWatch(watches[0] || null)
    }).catch(() => setWatch(null))
  }, [])

  const rescan = useCallback(async () => {
    setScanning(true)
    try {
      const res = await api.mailPollNow(60)
      if (res.error) throw new Error(res.error)
      toast(`Scanned ${res.scanned ?? 0} messages · ${res.trace?.filter((t) => t.result?.inserted > 0).reduce((n, t) => n + (t.result?.inserted || 0), 0)} new opportunities`)
    } catch (e) { toast(`Scan failed: ${e.message || e}`) } finally { setScanning(false) }
  }, [toast])

  return (
    <div className="px-box" style={{ padding: 0, overflow: 'hidden', borderColor: 'var(--surface-brand-default)' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', flexWrap: 'wrap' }}>
        {/* Left accent block */}
        <div style={{ background: 'var(--surface-brand-subtle)', padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 200, flex: '1 1 200px', borderRight: '1px solid var(--proto-rule-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--surface-success-default)', boxShadow: '0 0 0 3px var(--surface-success-subtle)' }} />
            <span className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-brand)' }}>Latest inbox scrub</span>
          </div>
          <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, marginTop: 8, color: 'var(--text-brand)' }}>{total}</div>
          <div className="px-small" style={{ marginTop: 2 }}>new today{backlog.length > 0 ? ` · ${backlog.length} backlog` : ''}</div>
        </div>

        {/* Middle: per-role breakdown */}
        <div style={{ flex: '2 1 280px', padding: '14px 18px', minWidth: 240 }}>
          <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Discovered by role</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '6px 20px' }}>
            {bins.length === 0 && <div className="px-small">Inbox is clear — no new roles overnight.</div>}
            {bins.map(([fam, n]) => (
              <div key={fam} onClick={() => go('/opportunities?filter=new')} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '3px 0' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: ROLE_DOT[fam] || 'var(--proto-ink3)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{fam}</span>
                <span className="px-pill">{n} new</span>
              </div>
            ))}
          </div>
          {companies.length > 0 && <div className="px-small" style={{ marginTop: 10 }}>Sources: {companies.slice(0, 5).join(' · ')}{companies.length > 5 ? ' …' : ''}</div>}
        </div>

        {/* Right: CTA */}
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, borderLeft: '1px solid var(--proto-rule-soft)', flex: '1 1 170px', minWidth: 150 }}>
          <div className="px-btn px-btn-accent" style={{ justifyContent: 'center' }} onClick={() => go('/swipe')}>Review {total} in swipe →</div>
          <div className="px-btn" style={{ justifyContent: 'center', fontSize: 12 }} onClick={() => go('/settings/intake')}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: watch ? 'var(--surface-success-default)' : 'var(--proto-ink3)', display: 'inline-block', marginRight: 5 }} />
            {watch ? 'Watching inbox' : 'No active watch'}
          </div>
          <div className="px-btn" style={{ justifyContent: 'center', fontSize: 12, opacity: scanning ? 0.6 : 1, pointerEvents: scanning ? 'none' : 'auto' }} onClick={rescan}>
            {scanning ? 'Scanning…' : '↻ Re-scan now'}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Today({ opps }) {
  const { displayName, toast } = useApp()
  const { loading, error, opportunities } = opps

  const { newToday, backlog, active, hot, avgMatch } = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const fresh = opportunities.filter((o) => FRESH_STAGES.includes(o.stage))
    const newToday = fresh.filter((o) => o.createdAt && new Date(o.createdAt).getTime() > cutoff)
    const backlog = fresh.filter((o) => !o.createdAt || new Date(o.createdAt).getTime() <= cutoff)
    const active = opportunities.filter((o) => ACTIVE_STAGES.includes(o.stage))
    const hot = opportunities.filter((o) => o.urgency === 'Hot')
    const scored = opportunities.filter((o) => typeof o.match === 'number')
    const avgMatch = scored.length ? Math.round(scored.reduce((a, o) => a + o.match, 0) / scored.length) : null
    return { newToday, backlog, active, hot, avgMatch }
  }, [opportunities])

  const priorities = useMemo(() => priorityActions(opportunities), [opportunities])

  // "This week" — real upcoming outreach touches (due/scheduled) across opps.
  const [week, setWeek] = useState([])
  const [weekError, setWeekError] = useState(null)
  useEffect(() => {
    let alive = true
    api.outreachQueue().then((r) => {
      if (!alive) return
      if (r.error) { setWeekError('Outreach schedule unavailable'); return }
      const up = (r.messages || []).filter((m) => m.state === 'due' || m.state === 'scheduled')
        .sort((a, b) => (a.dayOffset ?? 99) - (b.dayOffset ?? 99)).slice(0, 5)
      setWeek(up)
    }).catch(() => { if (alive) setWeekError('Outreach schedule unavailable') })
    return () => { alive = false }
  }, [opportunities])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Greeting */}
      <div>
        <div style={{ fontSize: 'clamp(20px, 5.5vw, 26px)', fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.15 }}>
          {(() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' })()}{displayName ? `, ${displayName}` : ''}.
        </div>
        <div className="px-small" style={{ marginTop: 4 }}>
          {newToday.length} new today · {backlog.length} backlog · {active.length} active · {hot.length} hot
        </div>
      </div>

      {/* Latest inbox scrub — most immediate attention */}
      <InboxScrubHero newToday={newToday} backlog={backlog} toast={toast} />

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <Kpi label="New today" value={newToday.length} tone="accent" onClick={() => go('/opportunities?filter=new')} />
        <Kpi label="Backlog" value={backlog.length} tone="default" onClick={() => go('/opportunities?filter=backlog')} />
        <Kpi label="Active" value={active.length} tone="green" onClick={() => go('/opportunities?filter=active')} />
        <Kpi label="Hot" value={hot.length} tone="red" onClick={() => go('/opportunities?filter=hot')} />
      </div>

      {/* Do these next — next-best actions */}
      {priorities.length > 0 && (
        <Section title="Do these next">
          {priorities.map((a) => (
            <div key={a.id + a.cta} className="px-box" onClick={() => go(a.to)} style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <div style={{ width: 5, alignSelf: 'stretch', borderRadius: 3, background: `var(--proto-${a.tone})` }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{a.who}</div>
                <div className="px-small">{a.t}</div>
              </div>
              <button className="px-btn px-btn-accent" style={{ fontSize: 12 }} onClick={(e) => { e.stopPropagation(); go(a.to) }}>{a.cta}</button>
            </div>
          ))}
        </Section>
      )}

      {/* This week — real upcoming outreach cadence */}
      {(week.length > 0 || weekError) && (
        <Section title="This week">
          {weekError && <div className="px-box" style={{ padding: 14, color: 'var(--proto-ink2)', fontSize: 13 }}>{weekError}</div>}
          {week.map((m) => (
            <div key={m.id} className="px-box" onClick={() => go(`/compose/${m.oppId}`)} style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <div className="px-small" style={{ width: 54, flexShrink: 0 }}>Day {m.dayOffset ?? '—'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{m.company}</div>
                <div className="px-small">{m.channelLabel}</div>
              </div>
              <Pill tone={m.state === 'due' ? 'red' : 'accent'}>{m.state}</Pill>
            </div>
          ))}
        </Section>
      )}

      {/* Do next — new today first, then backlog */}
      <Section title={`New today (${newToday.length})`}>
        {newToday.length === 0 && <Empty>Nothing new in the last 24 hours.</Empty>}
        {newToday.map((o) => <OppRow key={o.id} o={o} />)}
      </Section>

      {backlog.length > 0 && (
        <Section title={`Backlog (${backlog.length})`}>
          {backlog.map((o) => <OppRow key={o.id} o={o} />)}
        </Section>
      )}


      <Section title="In flight">
        {active.length === 0 && <Empty>No active opportunities yet.</Empty>}
        {active.slice(0, 8).map((o) => <OppRow key={o.id} o={o} />)}
      </Section>
    </div>
  )
}

function Kpi({ label, value, tone, onClick }) {
  return (
    <div className="px-box" onClick={onClick} style={{ padding: 16, cursor: onClick ? 'pointer' : 'default' }}>
      <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: `var(--proto-${tone})` }}>{value}</div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--proto-ink2)', margin: '0 0 8px' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

function OppRow({ o }) {
  return (
    <div className="px-box" onClick={() => go(`/opp/${o.id}`)} style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}>
      <MatchScore value={o.match} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{o.company}</span>
          <StageBadge stage={o.stage} />
          {o.urgency && <UrgencyPill urgency={o.urgency} />}
        </div>
        <div className="px-small" style={{ marginTop: 2 }}>{o.role} · {o.location || '—'} · {o.comp || '—'}</div>
        {o.why && <div className="px-small" style={{ marginTop: 4, color: 'var(--proto-ink2)' }}>{o.why}</div>}
      </div>
      {o.fit && <Pill tone="accent">{o.fit}</Pill>}
    </div>
  )
}

export function Loading() {
  return <div className="px-box" style={{ padding: 40, textAlign: 'center', color: 'var(--proto-ink2)' }}>Loading live pipeline…</div>
}
export function ErrorBox({ error }) {
  return (
    <div className="px-box" style={{ padding: 24, borderColor: 'var(--proto-red)' }}>
      <div style={{ fontWeight: 600, color: 'var(--proto-red)' }}>Could not reach the service layer</div>
      <div className="px-small" style={{ marginTop: 6, fontFamily: 'monospace' }}>{error}</div>
    </div>
  )
}
export function Empty({ children }) {
  return <div className="px-box" style={{ padding: 20, textAlign: 'center', color: 'var(--proto-ink2)', fontSize: 13 }}>{children}</div>
}
