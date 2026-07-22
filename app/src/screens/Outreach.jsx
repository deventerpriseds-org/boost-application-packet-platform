import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useApp, go } from '../state.jsx'
import { api } from '../api.js'
import { Pill } from '../shell.jsx'
import { Loading, ErrorBox, Empty, roleFamily } from './Today.jsx'

// The full outreach state chain the backend recognizes (api appOutreach.ts:
// setOutreachState now accepts 'opened' and 'replied' in addition to
// draft/scheduled/due/sent, stamping opened_at/replied_at). The flow header
// and the advance button are built strictly from these six real states.
const FLOW = [
  { key: 'draft', label: 'Draft', tone: 'yellow' },
  { key: 'scheduled', label: 'Scheduled', tone: 'accent' },
  { key: 'due', label: 'Due', tone: 'red' },
  { key: 'sent', label: 'Sent', tone: 'green' },
  { key: 'opened', label: 'Opened', tone: 'accent' },
  { key: 'replied', label: 'Replied', tone: 'green' },
]

// Groups rendered as sections (queue order: act on due first, replied last).
const GROUPS = [
  { key: 'due', label: 'Due now', tone: 'red' },
  { key: 'scheduled', label: 'Scheduled', tone: 'accent' },
  { key: 'draft', label: 'Drafts', tone: 'yellow' },
  { key: 'sent', label: 'Sent', tone: 'green' },
  { key: 'opened', label: 'Opened', tone: 'accent' },
  { key: 'replied', label: 'Replied', tone: 'green' },
]

// Linear state machine — each state advances to the next real state, applied
// via setOutreachState (all six are accepted server-side). 'replied' is
// terminal (end of the outreach lifecycle).
const NEXT = {
  draft: { to: 'scheduled', label: 'Schedule', cls: 'px-btn' },
  scheduled: { to: 'due', label: 'Mark due', cls: 'px-btn' },
  due: { to: 'sent', label: 'Mark sent', cls: 'px-btn px-btn-green' },
  sent: { to: 'opened', label: 'Mark opened', cls: 'px-btn' },
  opened: { to: 'replied', label: 'Log reply', cls: 'px-btn px-btn-green' },
}

export default function Outreach() {
  const { toast } = useApp()
  const [state, setState] = useState({ loading: true, error: null, messages: [] })
  const [stateFilter, setStateFilter] = useState(null)
  const [roleFilter, setRoleFilter] = useState('all')

  const load = useCallback(async () => {
    try {
      const res = await api.outreachQueue()
      if (res.error) throw new Error(res.error)
      setState({ loading: false, error: null, messages: res.messages || [] })
    } catch (err) { setState({ loading: false, error: String(err.message || err), messages: [] }) }
  }, [])
  useEffect(() => { load() }, [load])

  // Advance a message to its next real state
  // (draft→scheduled→due→sent→opened→replied).
  const advance = async (m) => {
    const step = NEXT[m.state]
    if (!step) return
    setState((s) => ({ ...s, messages: s.messages.map((x) => (x.id === m.id ? { ...x, state: step.to } : x)) }))
    const res = await api.setOutreachState(m.id, step.to)
    if (res.error) { toast(`Failed: ${res.error}`); load() } else toast(`Moved to ${step.to} ✓`)
  }

  // Live counts per real state (from the actual queue, ignores filters).
  const stateCounts = useMemo(() => {
    const by = {}
    for (const m of state.messages) by[m.state] = (by[m.state] || 0) + 1
    return by
  }, [state.messages])

  // Per-role-family counts, derived from each message's real role string (the
  // queue does not return persona rolesFor, so we bin by role like the rest of
  // the app does via roleFamily). Only families that actually appear are shown.
  const roleCounts = useMemo(() => {
    const c = { all: state.messages.length }
    for (const m of state.messages) { const f = roleFamily(m); c[f] = (c[f] || 0) + 1 }
    return c
  }, [state.messages])
  const roleKeys = useMemo(() => Object.keys(roleCounts).filter((k) => k !== 'all'), [roleCounts])

  const visible = useMemo(() => state.messages.filter((m) =>
    (!stateFilter || m.state === stateFilter) &&
    (roleFilter === 'all' || roleFamily(m) === roleFilter)
  ), [state.messages, stateFilter, roleFilter])

  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox error={state.error} />
  const { messages } = state
  if (!messages.length) return (
    <Empty>
      No outreach yet.{' '}
      <span className="px-link" style={{ cursor: 'pointer' }} onClick={() => go('/opportunities')}>Open an opportunity</span>
      {' '}then go to the Outreach tab and start a cadence.
    </Empty>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Status flow — connected circles with live counts per real state.
          Click a node to filter the queue to that state; click again to clear. */}
      <div className="px-box" style={{ padding: '12px 14px', overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, minWidth: 'min-content' }}>
          {FLOW.map((f, i) => {
            const n = stateCounts[f.key] || 0
            const on = stateFilter === f.key
            return (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center' }}>
                <div
                  onClick={() => setStateFilter(on ? null : f.key)}
                  title={`${f.label}: ${n}`}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <span style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 40, height: 40, borderRadius: '50%', fontSize: 14, fontWeight: 700,
                    background: n > 0 ? `var(--proto-${f.tone}-soft)` : 'var(--proto-panel)',
                    color: n > 0 ? `var(--proto-${f.tone})` : 'var(--proto-ink3)',
                    border: on ? '2px solid var(--surface-brand-default)' : '1px solid var(--proto-rule-soft)',
                  }}>{n}</span>
                  <span className="px-small" style={{ whiteSpace: 'nowrap', fontSize: 10 }}>{f.label}</span>
                </div>
                {i < FLOW.length - 1 && (
                  <span style={{ width: 18, height: 2, background: 'var(--proto-rule-soft)', margin: '0 2px', marginBottom: 18, flexShrink: 0 }} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Role filter chips — All + role families actually present in the queue,
          each with a real count. Derived from message role via roleFamily. */}
      {roleKeys.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['all', ...roleKeys].map((k) => {
            const on = roleFilter === k
            return (
              <span key={k} className="px-pill" onClick={() => setRoleFilter(k)}
                style={{ cursor: 'pointer', background: on ? 'var(--surface-brand-default)' : undefined, color: on ? 'var(--text-on-brand)' : undefined }}>
                {k === 'all' ? 'All' : k} {roleCounts[k] || 0}
              </span>
            )
          })}
        </div>
      )}

      {(stateFilter || roleFilter !== 'all') && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--proto-paper)', border: '1px solid var(--proto-rule-soft)', borderRadius: 8 }}>
          <span className="px-small">
            Showing <b>{visible.length}</b> of {messages.length}
            {stateFilter ? <> · state <b>{stateFilter}</b></> : null}
            {roleFilter !== 'all' ? <> · <b>{roleFilter}</b></> : null}
          </span>
          <button className="px-btn" style={{ fontSize: 11 }} onClick={() => { setStateFilter(null); setRoleFilter('all') }}>✕ Clear</button>
        </div>
      )}

      {GROUPS.map((g) => {
        const rows = visible.filter((m) => m.state === g.key)
        if (!rows.length) return null
        return (
          <div key={g.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--proto-ink2)' }}>{g.label}</span>
              <Pill tone={g.tone}>{rows.length}</Pill>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rows.map((m) => {
                const step = NEXT[m.state]
                return (
                  <div key={m.id} className="px-box" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{m.company}</span>
                        <Pill tone={g.tone}>{m.channelLabel}</Pill>
                        {m.dayOffset != null && <span className="px-small">Day {m.dayOffset}</span>}
                      </div>
                      <div className="px-small" style={{ marginTop: 2 }}>{m.role}</div>
                      {m.body && <div className="px-small" style={{ marginTop: 4, color: 'var(--proto-ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.body.replace(/\s+/g, ' ').slice(0, 90)}…</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button className="px-btn" style={{ fontSize: 12 }} onClick={() => go(`/compose/${m.oppId}`)}>Open</button>
                      {step && <button className={step.cls} style={{ fontSize: 12 }} onClick={() => advance(m)}>{step.label}</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Templates-in-rotation + cadence health intentionally omitted: the API
          exposes no template-usage or cadence-health endpoint, and outreach
          bodies are uniquely AI-generated per opportunity (not reusable
          templates), so there is no real data to populate a right rail without
          fabricating names/percentages. Hidden per the no-fake-data rule. */}
    </div>
  )
}
