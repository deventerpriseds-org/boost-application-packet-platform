import React, { useEffect, useState, useCallback } from 'react'
import { go } from '../state.jsx'

import { api } from '../api.js'
import { MatchScore, Pill } from '../shell.jsx'
import { Loading, ErrorBox, Empty } from './Today.jsx'
import AssetGateDrawer, { GateBadge, assetLabel, STATUS_TONE } from './AssetGateDrawer.jsx'

const GROUPS = [
  { key: 'building', label: 'Building', tone: 'yellow' },
  { key: 'review', label: 'In review', tone: 'accent' },
  { key: 'ready', label: 'Ready to ship', tone: 'green' },
  { key: 'sent', label: 'Sent', tone: 'green' },
]

export default function Packets() {
  const [state, setState] = useState({ loading: true, error: null, packets: [] })
  // Which packet has its asset list open, the assets themselves, and ONE gate payload per artifact.
  //
  // `gates` is the single source for both the card badge and the drawer (P5.3): the badge shows
  // `attention` and the gate word from the same object the drawer's footer derives its action from,
  // so a green gate can never appear beside "1 to fix" because two different row sets were counted.
  const [openPacket, setOpenPacket] = useState(null)
  const [assets, setAssets] = useState({})   // packetId -> { loading, error, artifacts }
  const [gates, setGates] = useState({})     // artifactId -> { loading, error, result }
  const [drawer, setDrawer] = useState(null) // { packet, artifactId }

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

  const loadGate = useCallback(async (artifactId) => {
    setGates((g) => ({ ...g, [artifactId]: { ...(g[artifactId] || {}), loading: true, error: null } }))
    try {
      const result = await api.artifactChecksResult(artifactId)
      setGates((g) => ({ ...g, [artifactId]: { loading: false, error: null, result } }))
    } catch (e) {
      setGates((g) => ({ ...g, [artifactId]: { loading: false, error: String(e.message || e), result: null } }))
    }
  }, [])

  const toggleAssets = useCallback(async (p) => {
    if (openPacket === p.id) { setOpenPacket(null); return }
    setOpenPacket(p.id)
    if (assets[p.id] && assets[p.id].artifacts) return
    setAssets((a) => ({ ...a, [p.id]: { loading: true, error: null, artifacts: [] } }))
    try {
      const res = await api.getPacket(p.oppId)
      const list = res.artifacts || []
      setAssets((a) => ({ ...a, [p.id]: { loading: false, error: null, artifacts: list } }))
      list.forEach((art) => loadGate(art.id))
    } catch (e) {
      setAssets((a) => ({ ...a, [p.id]: { loading: false, error: String(e.message || e), artifacts: [] } }))
    }
  }, [openPacket, assets, loadGate])

  // The drawer hands back the payload it just re-read, plus (on an approval) the new artifact
  // status. Both land here so the card badge and the drawer stay one object, never two copies.
  const onDrawerResult = useCallback((artifactId, packetId, fresh, patch) => {
    if (fresh) setGates((g) => ({ ...g, [artifactId]: { loading: false, error: null, result: fresh } }))
    if (patch && patch.status) {
      setAssets((a) => {
        const entry = a[packetId]
        if (!entry || !entry.artifacts) return a
        return { ...a, [packetId]: { ...entry, artifacts: entry.artifacts.map((x) => (x.id === artifactId ? { ...x, status: patch.status } : x)) } }
      })
      load()   // approved/total on the packet card is server-computed; re-read rather than guess it
    }
  }, [load])

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

  const drawerPacket = drawer && packets.find((p) => p.id === drawer.packet)
  const drawerArtifact = drawer && ((assets[drawer.packet] || {}).artifacts || []).find((a) => a.id === drawer.artifactId)

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
              {rows.map((p) => {
                const entry = assets[p.id] || {}
                const open = openPacket === p.id
                return (
                  <div key={p.id} className="px-box" style={{ padding: 14 }}>
                    <div onClick={() => go(`/packet/${p.oppId}`)} style={{ display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }}>
                      <MatchScore value={p.match} size={34} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.company}</div>
                        <div className="px-small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.role}</div>
                        <div className="px-small" style={{ marginTop: 4 }}>{p.approved}/{p.total} approved</div>
                      </div>
                      <Pill tone={g.tone}>{p.status}</Pill>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <button type="button" className="px-btn px-btn-ghost" style={{ padding: '2px 6px' }}
                        aria-expanded={open} onClick={(e) => { e.stopPropagation(); toggleAssets(p) }}>
                        {open ? 'Hide assets' : 'Assets & gate'}
                      </button>
                    </div>
                    {open && (
                      <div style={{ marginTop: 8, borderTop: '1px solid var(--proto-rule-soft)', paddingTop: 8 }}>
                        {entry.loading && <div className="px-small">Loading assets...</div>}
                        {entry.error && <div className="px-small" style={{ color: 'var(--proto-red)' }}>{entry.error}</div>}
                        {!entry.loading && !entry.error && !(entry.artifacts || []).length && (
                          <div className="px-small">This packet has no assets yet.</div>
                        )}
                        {(entry.artifacts || []).map((art) => {
                          const gate = gates[art.id] || {}
                          return (
                            <div key={art.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 13, fontWeight: 500, flex: 1, minWidth: 110 }}>{assetLabel(art.type)}</span>
                              <Pill tone={STATUS_TONE[art.status] || 'panel'}>{art.status}</Pill>
                              <GateBadge result={gate.result} loading={gate.loading} error={gate.error}
                                onClick={() => setDrawer({ packet: p.id, artifactId: art.id })} />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {drawerArtifact && drawerPacket && (
        <AssetGateDrawer
          artifact={drawerArtifact}
          packetId={drawerPacket.id}
          company={drawerPacket.company}
          role={drawerPacket.role}
          result={(gates[drawerArtifact.id] || {}).result || null}
          resultLoading={!!(gates[drawerArtifact.id] || {}).loading}
          resultError={(gates[drawerArtifact.id] || {}).error || null}
          onResult={(fresh, patch) => onDrawerResult(drawerArtifact.id, drawerPacket.id, fresh, patch)}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  )
}
