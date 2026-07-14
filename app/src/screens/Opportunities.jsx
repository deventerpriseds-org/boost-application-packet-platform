import React, { useMemo, useState, useEffect } from 'react'
import { go } from '../state.jsx'
import { api } from '../api.js'
import { MatchScore, StageBadge, UrgencyPill, Pill } from '../shell.jsx'
import { Loading, ErrorBox, Empty, roleFamily } from './Today.jsx'

const URGENCIES = ['All', 'Hot', 'Warm', 'Cool']
const FRESH_STAGES = ['discovered', 'saved', 'enriched']
const ACTIVE_STAGES = ['applied', 'outreach', 'engaged', 'screen', 'r1', 'panel', 'final', 'offer']
const CUTOFF_24H = () => Date.now() - 24 * 60 * 60 * 1000

const FILTER_LABELS = { new: 'New today', backlog: 'Backlog', active: 'Active', hot: 'Hot' }
const filterLabel = (f) => {
  if (!f) return ''
  if (f.startsWith('role:')) return f.slice(5)
  return FILTER_LABELS[f] || f
}

export default function Opportunities({ opps, filter }) {
  const { loading, error, opportunities, stages } = opps
  const [query, setQuery] = useState('')
  const [urgency, setUrgency] = useState('All')
  const [stage, setStage] = useState('All')
  const [sort, setSort] = useState('match')
  const [roles, setRoles] = useState([])
  const [roleFilter, setRoleFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState(filter || null)

  useEffect(() => {
    api.listPersonas().then((r) => { if (!r.error) setRoles(r.personas || []) }).catch(() => {})
  }, [])

  // When navigating here with a new filter prop, apply it and reset manual filters
  useEffect(() => {
    if (filter) {
      setActiveFilter(filter)
      setStage('All')
      setUrgency('All')
      setQuery('')
    }
  }, [filter])

  const rows = useMemo(() => {
    let r = opportunities
    // Named filter from Today KPI — takes precedence over manual stage/urgency dropdowns
    if (activeFilter === 'new') {
      const cutoff = CUTOFF_24H()
      r = r.filter((o) => FRESH_STAGES.includes(o.stage) && o.createdAt && new Date(o.createdAt).getTime() > cutoff)
    } else if (activeFilter === 'backlog') {
      const cutoff = CUTOFF_24H()
      r = r.filter((o) => FRESH_STAGES.includes(o.stage) && (!o.createdAt || new Date(o.createdAt).getTime() <= cutoff))
    } else if (activeFilter === 'active') {
      r = r.filter((o) => ACTIVE_STAGES.includes(o.stage))
    } else if (activeFilter === 'hot') {
      r = r.filter((o) => o.urgency === 'Hot')
    } else if (activeFilter?.startsWith('role:')) {
      const fam = activeFilter.slice(5)
      r = r.filter((o) => roleFamily(o) === fam)
    } else {
      if (query.trim()) {
        const q = query.toLowerCase()
        r = r.filter((o) => (o.company || '').toLowerCase().includes(q) || (o.role || '').toLowerCase().includes(q))
      }
      if (urgency !== 'All') r = r.filter((o) => o.urgency === urgency)
      if (stage !== 'All') r = r.filter((o) => o.stage === stage)
    }
    if (roleFilter === 'other') r = r.filter((o) => !o.rolesFor || o.rolesFor.length === 0)
    else if (roleFilter !== 'all') r = r.filter((o) => (o.rolesFor || []).includes(roleFilter))
    r = [...r].sort((a, b) => (sort === 'match' ? (b.match || 0) - (a.match || 0) : (a.company || '').localeCompare(b.company || '')))
    return r
  }, [opportunities, query, urgency, stage, sort, roleFilter, activeFilter])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {roles.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[{ key: 'all', name: 'All' }, ...roles, { key: 'other', name: 'Other' }].map((r) => (
            <span key={r.key} className="px-pill" onClick={() => setRoleFilter(r.key)}
              style={{ cursor: 'pointer', background: roleFilter === r.key ? 'var(--surface-brand-default)' : undefined, color: roleFilter === r.key ? 'var(--text-on-brand)' : undefined }}>
              {r.name}
            </span>
          ))}
        </div>
      )}
      {activeFilter && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--proto-paper)', border: '1px solid var(--proto-rule-soft)', borderRadius: 8 }}>
          <span className="px-small">Filtered: <b>{filterLabel(activeFilter)}</b></span>
          <button className="px-btn" style={{ fontSize: 11 }} onClick={() => { setActiveFilter(null); go('/opportunities') }}>✕ Clear</button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input className="px-input" placeholder="Search company or role…" value={query} onChange={(e) => { setActiveFilter(null); setQuery(e.target.value) }}
          style={{ flex: 1, minWidth: 220 }} disabled={!!activeFilter} />
        <select className="px-btn" value={urgency} onChange={(e) => { setActiveFilter(null); setUrgency(e.target.value) }} disabled={!!activeFilter}>
          {URGENCIES.map((u) => <option key={u}>{u}</option>)}
        </select>
        <select className="px-btn" value={stage} onChange={(e) => { setActiveFilter(null); setStage(e.target.value) }} disabled={!!activeFilter}>
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
              <tr key={o.id} onClick={() => go(`/opp/${o.id}`)} style={{ borderTop: '1px solid var(--proto-rule-soft)', cursor: 'pointer' }}>
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
