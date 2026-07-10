import React, { useMemo, useState } from 'react'
import { useApp } from '../state.jsx'
import { MatchScore, UrgencyPill } from '../shell.jsx'
import { Loading, ErrorBox } from './Today.jsx'

const STAGE_LABELS = {
  discovered: 'Discovered', saved: 'Saved', enriched: 'Enriched', applied: 'Applied',
  outreach: 'Outreach', engaged: 'Engaged', screen: 'Screen', r1: 'Round 1',
  panel: 'Panel', final: 'Final', offer: 'Offer', accepted: 'Accepted',
}

export default function Pipeline({ opps }) {
  const { toast } = useApp()
  const { loading, error, opportunities, stages, optimisticMove } = opps
  const [dragId, setDragId] = useState(null)
  const [overStage, setOverStage] = useState(null)

  const columns = useMemo(() => {
    const by = {}
    for (const s of stages) by[s] = []
    for (const o of opportunities) (by[o.stage] || (by[o.stage] = [])).push(o)
    return by
  }, [opportunities, stages])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />

  const onDrop = (stage) => {
    setOverStage(null)
    if (!dragId) return
    const opp = opportunities.find((o) => o.id === dragId)
    setDragId(null)
    if (!opp || opp.stage === stage) return
    optimisticMove(opp.id, stage, (err) => toast(`Move failed: ${err.message || err}`))
    toast(`${opp.company} → ${STAGE_LABELS[stage] || stage}`)
  }

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
      <div style={{ display: 'flex', gap: 12, minWidth: 'min-content' }}>
        {stages.map((s) => {
          const items = columns[s] || []
          const on = overStage === s
          return (
            <div key={s}
              onDragOver={(e) => { e.preventDefault(); setOverStage(s) }}
              onDragLeave={() => setOverStage((cur) => (cur === s ? null : cur))}
              onDrop={() => onDrop(s)}
              style={{ width: 220, flexShrink: 0, background: on ? 'var(--proto-accent-soft)' : 'var(--proto-panel)',
                borderRadius: 10, padding: 8, border: on ? '1px solid var(--proto-accent)' : '1px solid var(--proto-rule-soft)', transition: 'background 120ms' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px 8px' }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{STAGE_LABELS[s] || s}</span>
                <span className="px-chip">{items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 40 }}>
                {items.map((o) => (
                  <div key={o.id} draggable
                    onDragStart={() => setDragId(o.id)}
                    onDragEnd={() => { setDragId(null); setOverStage(null) }}
                    className="px-box"
                    style={{ padding: 10, cursor: 'grab', opacity: dragId === o.id ? 0.5 : 1, display: 'flex', gap: 10, alignItems: 'center' }}>
                    <MatchScore value={o.match} size={28} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.company}</div>
                      <div className="px-small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.role}</div>
                      {o.urgency && <div style={{ marginTop: 4 }}><UrgencyPill urgency={o.urgency} /></div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
