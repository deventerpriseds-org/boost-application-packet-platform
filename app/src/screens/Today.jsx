import React, { useMemo, useState, useEffect } from 'react'
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
const NEW_STAGES = ['discovered', 'saved']
const SCRUB_STAGES = ['discovered', 'saved', 'enriched'] // "new overnight" awaiting triage
const ACTIVE_STAGES = ['enriched', 'applied', 'outreach', 'engaged', 'screen', 'r1', 'panel', 'final', 'offer']

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
function InboxScrubHero({ opportunities, toast }) {
  const fresh = opportunities.filter((o) => SCRUB_STAGES.includes(o.stage))
  const bins = useMemo(() => {
    const map = {}
    fresh.forEach((o) => { const f = roleFamily(o); map[f] = (map[f] || 0) + 1 })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [opportunities])
  const total = fresh.length
  const companies = [...new Set(fresh.slice(0, 6).map((o) => o.company))]

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
          <div className="px-small" style={{ marginTop: 2 }}>new roles found overnight</div>
        </div>

        {/* Middle: per-role breakdown */}
        <div style={{ flex: '2 1 280px', padding: '14px 18px', minWidth: 240 }}>
          <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Discovered by role</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '6px 20px' }}>
            {bins.length === 0 && <div className="px-small">Inbox is clear — no new roles overnight.</div>}
            {bins.map(([fam, n]) => (
              <div key={fam} onClick={() => go('/opportunities')} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '3px 0' }}>
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
          <div className="px-btn" style={{ justifyContent: 'center', fontSize: 12 }} onClick={() => toast('Inbox monitoring is on — scanning connected sources.')}>Inbox monitoring</div>
          <div className="px-btn" style={{ justifyContent: 'center', fontSize: 12 }} onClick={() => toast('Re-scanning inbox…')}>↻ Re-scan now</div>
        </div>
      </div>
    </div>
  )
}

export default function Today({ opps }) {
  const { persona, toast } = useApp()
  const { loading, error, opportunities } = opps

  const { fresh, active, hot, avgMatch } = useMemo(() => {
    const fresh = opportunities.filter((o) => NEW_STAGES.includes(o.stage))
    const active = opportunities.filter((o) => ACTIVE_STAGES.includes(o.stage))
    const hot = opportunities.filter((o) => o.urgency === 'Hot')
    const scored = opportunities.filter((o) => typeof o.match === 'number')
    const avgMatch = scored.length ? Math.round(scored.reduce((a, o) => a + o.match, 0) / scored.length) : 0
    return { fresh, active, hot, avgMatch }
  }, [opportunities])

  const priorities = useMemo(() => priorityActions(opportunities), [opportunities])

  // "This week" — real upcoming outreach touches (due/scheduled) across opps.
  const [week, setWeek] = useState([])
  useEffect(() => {
    let alive = true
    api.outreachQueue().then((r) => {
      if (!alive || r.error) return
      const up = (r.messages || []).filter((m) => m.state === 'due' || m.state === 'scheduled')
        .sort((a, b) => (a.dayOffset ?? 99) - (b.dayOffset ?? 99)).slice(0, 5)
      setWeek(up)
    }).catch(() => {})
    return () => { alive = false }
  }, [opportunities])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Greeting */}
      <div>
        <div style={{ fontSize: 'clamp(20px, 5.5vw, 26px)', fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.15 }}>
          Good morning, {persona.name.split(' ')[0]}.
        </div>
        <div className="px-small" style={{ marginTop: 4 }}>
          {fresh.length} new to scrub · {active.length} active opportunities · {hot.length} hot · avg match {avgMatch}%
        </div>
      </div>

      {/* Latest inbox scrub — most immediate attention */}
      <InboxScrubHero opportunities={opportunities} toast={toast} />

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <Kpi label="New" value={fresh.length} tone="accent" />
        <Kpi label="Active" value={active.length} tone="green" />
        <Kpi label="Hot" value={hot.length} tone="red" />
        <Kpi label="Avg match" value={`${avgMatch}%`} tone="yellow" />
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
      {week.length > 0 && (
        <Section title="This week">
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

      {/* Do next */}
      <Section title="Do next — inbox scrub">
        {fresh.length === 0 && <Empty>Nothing new. Inbox is clear. ✦</Empty>}
        {fresh.map((o) => <OppRow key={o.id} o={o} />)}
      </Section>

      <Section title="In flight">
        {active.length === 0 && <Empty>No active opportunities yet.</Empty>}
        {active.slice(0, 8).map((o) => <OppRow key={o.id} o={o} />)}
      </Section>
    </div>
  )
}

function Kpi({ label, value, tone }) {
  return (
    <div className="px-box" style={{ padding: 16 }}>
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
