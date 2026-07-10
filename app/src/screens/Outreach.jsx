import React, { useEffect, useState, useCallback } from 'react'
import { useApp, go } from '../state.jsx'
import { api } from '../api.js'
import { Pill } from '../shell.jsx'
import { Loading, ErrorBox, Empty } from './Today.jsx'

const GROUPS = [
  { key: 'due', label: 'Due now', tone: 'red' },
  { key: 'scheduled', label: 'Scheduled', tone: 'accent' },
  { key: 'draft', label: 'Drafts', tone: 'yellow' },
  { key: 'sent', label: 'Sent', tone: 'green' },
]

export default function Outreach() {
  const { toast } = useApp()
  const [state, setState] = useState({ loading: true, error: null, messages: [] })

  const load = useCallback(async () => {
    try {
      const res = await api.outreachQueue()
      if (res.error) throw new Error(res.error)
      setState({ loading: false, error: null, messages: res.messages || [] })
    } catch (err) { setState({ loading: false, error: String(err.message || err), messages: [] }) }
  }, [])
  useEffect(() => { load() }, [load])

  const markSent = async (m) => {
    setState((s) => ({ ...s, messages: s.messages.map((x) => (x.id === m.id ? { ...x, state: 'sent' } : x)) }))
    const res = await api.setOutreachState(m.id, 'sent')
    if (res.error) { toast(`Failed: ${res.error}`); load() } else toast('Marked sent ✓')
  }

  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox error={state.error} />
  const { messages } = state
  if (!messages.length) return <Empty>No outreach yet. Open an opportunity → Outreach tab → <b>Start cadence</b>, or use the Composer.</Empty>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {GROUPS.map((g) => {
        const rows = messages.filter((m) => m.state === g.key)
        if (!rows.length) return null
        return (
          <div key={g.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--proto-ink2)' }}>{g.label}</span>
              <Pill tone={g.tone}>{rows.length}</Pill>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rows.map((m) => (
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
                    {m.state !== 'sent' && <button className="px-btn px-btn-green" style={{ fontSize: 12 }} onClick={() => markSent(m)}>Sent</button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
