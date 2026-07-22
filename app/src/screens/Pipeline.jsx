import React, { useMemo, useState, useEffect } from 'react'
import { useApp } from '../state.jsx'
import { api } from '../api.js'
import { MatchScore, UrgencyPill } from '../shell.jsx'
import { Loading, ErrorBox } from './Today.jsx'

const STAGE_LABELS = {
  discovered: 'Discovered', saved: 'Saved', enriched: 'Enriched', applied: 'Applied',
  outreach: 'Outreach', engaged: 'Engaged', screen: 'Screen', r1: 'Round 1',
  panel: 'Panel', final: 'Final', offer: 'Offer', accepted: 'Accepted',
}

// Date-window predicate on the opp's real createdAt field (same field Today uses).
const START_OF_TODAY = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
const START_OF_WEEK = () => { const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d.getTime() }
function matchesDate(o, mode) {
  if (mode === 'any') return true
  if (!o.createdAt) return false
  const t = new Date(o.createdAt).getTime()
  if (isNaN(t)) return false
  return mode === 'today' ? t >= START_OF_TODAY() : t >= START_OF_WEEK()
}

// Client-side CSV export of the currently-shown opps — real loaded data, no backend.
function toCsv(rows) {
  const cols = ['company', 'role', 'stage', 'match', 'urgency', 'location', 'comp', 'createdAt']
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = cols.join(',')
  const body = rows.map((o) => cols.map((c) => esc(o[c])).join(',')).join('\n')
  return head + '\n' + body
}
function downloadCsv(rows) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pipeline-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function Pipeline({ opps }) {
  const { toast } = useApp()
  const { loading, error, opportunities, stages, optimisticMove } = opps
  const [dragId, setDragId] = useState(null)
  const [overStage, setOverStage] = useState(null)
  const [roles, setRoles] = useState([])
  const [roleFilter, setRoleFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('any')
  const [rejected, setRejected] = useState([])

  // Same persona source Opportunities uses to build the role chips.
  useEffect(() => {
    api.listPersonas().then((r) => { if (!r.error) setRoles(r.personas || []) }).catch(() => {})
  }, [])

  // Rejected (dismissed) opps are excluded from the normal board load, so fetch
  // them separately for the read-only Rejected lane. Real data — empty is real.
  useEffect(() => {
    api.listOpportunities({ stage: 'rejected' }).then((r) => {
      if (!r.error) setRejected(r.opportunities || [])
    }).catch(() => {})
  }, [])

  // Apply role + date filters to the loaded opps (same rolesFor approach as Opportunities).
  const filtered = useMemo(() => {
    let r = opportunities
    if (roleFilter === 'other') r = r.filter((o) => !o.rolesFor || o.rolesFor.length === 0)
    else if (roleFilter !== 'all') r = r.filter((o) => (o.rolesFor || []).includes(roleFilter))
    if (dateFilter !== 'any') r = r.filter((o) => matchesDate(o, dateFilter))
    return r
  }, [opportunities, roleFilter, dateFilter])

  // Per-role counts for the chips — computed from the loaded opps (date filter applied
  // so the chip numbers agree with what the board shows).
  const roleCounts = useMemo(() => {
    const dated = dateFilter === 'any' ? opportunities : opportunities.filter((o) => matchesDate(o, dateFilter))
    const counts = { all: dated.length, other: 0 }
    for (const o of dated) {
      const fams = o.rolesFor || []
      if (fams.length === 0) counts.other += 1
      for (const k of fams) counts[k] = (counts[k] || 0) + 1
    }
    return counts
  }, [opportunities, dateFilter])

  const columns = useMemo(() => {
    const by = {}
    for (const s of stages) by[s] = []
    for (const o of filtered) (by[o.stage] || (by[o.stage] = [])).push(o)
    return by
  }, [filtered, stages])

  // Live per-stage counts for the funnel header, derived from the same filtered set.
  const stageCounts = useMemo(() => stages.map((s) => (columns[s] || []).length), [stages, columns])

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Stage funnel — connected circles with live counts per stage */}
      {stages.length > 0 && (
        <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 'min-content' }}>
            {stages.map((s, i) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 56 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700,
                    background: stageCounts[i] > 0 ? 'var(--surface-brand-subtle)' : 'var(--proto-panel)',
                    color: stageCounts[i] > 0 ? 'var(--text-brand)' : 'var(--proto-ink3)',
                    border: `1px solid ${stageCounts[i] > 0 ? 'var(--surface-brand-default)' : 'var(--proto-rule-soft)'}`,
                  }}>{stageCounts[i]}</div>
                  <span className="px-small" style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{STAGE_LABELS[s] || s}</span>
                </div>
                {i < stages.length - 1 && (
                  <div style={{ width: 20, height: 2, background: 'var(--proto-rule-soft)', marginBottom: 20, flexShrink: 0 }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Role filter chips (with per-role counts) + date filter + export */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {roles.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            {[{ key: 'all', name: 'All' }, ...roles, { key: 'other', name: 'Other' }].map((r) => (
              <span key={r.key} className="px-pill" onClick={() => setRoleFilter(r.key)}
                style={{ cursor: 'pointer', background: roleFilter === r.key ? 'var(--surface-brand-default)' : undefined, color: roleFilter === r.key ? 'var(--text-on-brand)' : undefined }}>
                {r.name} {roleCounts[r.key] || 0}
              </span>
            ))}
          </div>
        )}
        <select className="px-btn" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
          <option value="any">Any date</option>
          <option value="today">Sourced today</option>
          <option value="week">This week</option>
        </select>
        <button className="px-btn" onClick={() => downloadCsv(filtered)} disabled={filtered.length === 0}>Export CSV</button>
      </div>

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

          {/* Rejected lane — real dismissed opps, read-only (they are excluded
              from the normal board and have no drop target). Empty is real. */}
          <div style={{ width: 220, flexShrink: 0, background: 'var(--proto-panel)', borderRadius: 10, padding: 8, border: '1px solid var(--proto-rule-soft)', opacity: 0.9 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px 8px' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--proto-ink2)' }}>Rejected</span>
              <span className="px-chip">{rejected.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 40 }}>
              {rejected.map((o) => (
                <div key={o.id} className="px-box" style={{ padding: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <MatchScore value={o.match} size={28} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.company}</div>
                    <div className="px-small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
