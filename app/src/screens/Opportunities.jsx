import React, { useMemo, useState } from 'react'
import { MatchScore, StageBadge, UrgencyPill, Pill } from '../shell.jsx'
import { Loading, ErrorBox, Empty } from './Today.jsx'

const URGENCIES = ['All', 'Hot', 'Warm', 'Cool']

export default function Opportunities({ opps }) {
  const { loading, error, opportunities, stages } = opps
  const [query, setQuery] = useState('')
  const [urgency, setUrgency] = useState('All')
  const [stage, setStage] = useState('All')
  const [sort, setSort] = useState('match')

  const rows = useMemo(() => {
    let r = opportunities
    if (query.trim()) {
      const q = query.toLowerCase()
      r = r.filter((o) => (o.company || '').toLowerCase().includes(q) || (o.role || '').toLowerCase().includes(q))
    }
    if (urgency !== 'All') r = r.filter((o) => o.urgency === urgency)
    if (stage !== 'All') r = r.filter((o) => o.stage === stage)
    r = [...r].sort((a, b) => (sort === 'match' ? (b.match || 0) - (a.match || 0) : (a.company || '').localeCompare(b.company || '')))
    return r
  }, [opportunities, query, urgency, stage, sort])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input className="px-input" placeholder="Search company or role…" value={query} onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 220 }} />
        <select className="px-btn" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
          {URGENCIES.map((u) => <option key={u}>{u}</option>)}
        </select>
        <select className="px-btn" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option>All</option>
          {stages.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="px-btn" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="match">Sort: Match</option>
          <option value="company">Sort: Company</option>
        </select>
        <span className="px-small">{rows.length} of {opportunities.length}</span>
      </div>

      <div className="px-box" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--proto-ink2)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              <Th>Match</Th><Th>Company</Th><Th>Role</Th><Th>Comp</Th><Th>Stage</Th><Th>Urgency</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} style={{ borderTop: '1px solid var(--proto-rule-soft)' }}>
                <Td><MatchScore value={o.match} size={30} /></Td>
                <Td><span style={{ fontWeight: 600 }}>{o.company}</span><div className="px-small">{o.location || '—'}</div></Td>
                <Td>{o.role}</Td>
                <Td>{o.comp || '—'}</Td>
                <Td><StageBadge stage={o.stage} /></Td>
                <Td>{o.urgency ? <UrgencyPill urgency={o.urgency} /> : <span className="px-small">—</span>}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No opportunities match these filters.</Empty>}
      </div>
    </div>
  )
}

const Th = ({ children }) => <th style={{ padding: '10px 14px' }}>{children}</th>
const Td = ({ children }) => <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>{children}</td>
