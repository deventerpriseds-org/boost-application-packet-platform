import React, { useMemo } from 'react'
import { useApp } from '../state.jsx'
import { useOpportunities } from '../data.jsx'
import { Pill, UrgencyPill, MatchScore, StageBadge } from '../shell.jsx'

// Stage groupings for the "Today" hero: what's fresh to triage vs. in-flight.
const NEW_STAGES = ['discovered', 'saved']
const ACTIVE_STAGES = ['enriched', 'applied', 'outreach', 'engaged', 'screen', 'r1', 'panel', 'final', 'offer']

export default function Today({ opps }) {
  const { persona } = useApp()
  const { loading, error, opportunities } = opps

  const { fresh, active, hot, avgMatch } = useMemo(() => {
    const fresh = opportunities.filter((o) => NEW_STAGES.includes(o.stage))
    const active = opportunities.filter((o) => ACTIVE_STAGES.includes(o.stage))
    const hot = opportunities.filter((o) => o.urgency === 'Hot')
    const scored = opportunities.filter((o) => typeof o.match === 'number')
    const avgMatch = scored.length ? Math.round(scored.reduce((a, o) => a + o.match, 0) / scored.length) : 0
    return { fresh, active, hot, avgMatch }
  }, [opportunities])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Hero */}
      <div className="px-box" style={{ padding: 24 }}>
        <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Good morning, {persona.name.split(' ')[0]}</div>
        <div style={{ fontSize: 'clamp(20px, 5.5vw, 26px)', fontWeight: 700, letterSpacing: -0.5, margin: '4px 0 6px', lineHeight: 1.15 }}>
          {fresh.length} new to scrub · {active.length} in flight
        </div>
        <div className="px-small">
          {hot.length} hot {hot.length === 1 ? 'opportunity' : 'opportunities'} need attention today. Average match across your pipeline is {avgMatch}%.
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <Kpi label="New" value={fresh.length} tone="accent" />
        <Kpi label="Active" value={active.length} tone="green" />
        <Kpi label="Hot" value={hot.length} tone="red" />
        <Kpi label="Avg match" value={`${avgMatch}%`} tone="yellow" />
      </div>

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
    <div className="px-box" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
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
