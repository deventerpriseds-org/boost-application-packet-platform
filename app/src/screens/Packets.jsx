import React, { useEffect, useState, useCallback } from 'react'
import { go } from '../state.jsx'
import { api } from '../api.js'
import { MatchScore, Pill } from '../shell.jsx'
import { Loading, ErrorBox, Empty } from './Today.jsx'

const GROUPS = [
  { key: 'building', label: 'Building', tone: 'yellow' },
  { key: 'review', label: 'In review', tone: 'accent' },
  { key: 'ready', label: 'Ready to ship', tone: 'green' },
  { key: 'sent', label: 'Sent', tone: 'green' },
]

export default function Packets() {
  const [state, setState] = useState({ loading: true, error: null, packets: [] })

  const load = useCallback(async () => {
    try {
      const res = await api.listPackets()
      if (res.error) throw new Error(res.error)
      setState({ loading: false, error: null, packets: res.packets || [] })
    } catch (err) {
      setState({ loading: false, error: String(err.message || err), packets: [] })
    }
  }, [])
  useEffect(() => { load() }, [load])

  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox error={state.error} />
  const { packets } = state

  if (!packets.length) {
    return (
      <Empty>
        No packets yet.{' '}
        <span className="px-link" style={{ cursor: 'pointer' }} onClick={() => go('/opportunities')}>Open an opportunity</span>
        {' '}and hit <b>Build packet</b> to start the production line.
      </Empty>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {GROUPS.map((g) => {
        const rows = packets.filter((p) => p.status === g.key)
        if (!rows.length) return null
        return (
          <div key={g.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--proto-ink2)' }}>{g.label}</span>
              <Pill tone={g.tone}>{rows.length}</Pill>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              {rows.map((p) => (
                <div key={p.id} className="px-box" onClick={() => go(`/packet/${p.oppId}`)} style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }}>
                  <MatchScore value={p.match} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.company}</div>
                    <div className="px-small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.role}</div>
                    <div className="px-small" style={{ marginTop: 4 }}>{p.approved}/{p.total} approved</div>
                  </div>
                  <Pill tone={g.tone}>{p.status}</Pill>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
