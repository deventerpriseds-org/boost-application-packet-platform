import React, { useMemo, useState, useEffect } from 'react'
import { go } from '../state.jsx'
import { api } from '../api.js'
import { MatchScore, StageBadge, UrgencyPill, Pill } from '../shell.jsx'
import { Loading, ErrorBox, Empty, roleFamily } from './Today.jsx'

const URGENCIES = ['All', 'Hot', 'Warm', 'Cool']
const FRESH_STAGES = ['discovered', 'saved', 'enriched']
const ACTIVE_STAGES = ['applied', 'outreach', 'engaged', 'screen', 'r1', 'panel', 'final', 'offer']
const CUTOFF_TODAY = () => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0); return d.getTime() }

// Mirror of the canonical stage labels (shared with Pipeline.jsx). Order comes from
// the `stages` prop (server-provided canonical order), not this map.
const STAGE_LABELS = {
  discovered: 'Discovered', saved: 'Saved', enriched: 'Enriched', applied: 'Applied',
  outreach: 'Outreach', engaged: 'Engaged', screen: 'Screen', r1: 'Round 1',
  panel: 'Panel', final: 'Final', offer: 'Offer', accepted: 'Accepted',
}

// Quick filters per spec: All / To-clear / Hot / Strategic / Active.
// Each maps to an activeFilter token handled in the rows useMemo below.
const QUICK_FILTERS = [
  { key: null, label: 'All' },
  { key: 'toclear', label: 'To-clear' },
  { key: 'hot', label: 'Hot' },
  { key: 'strategic', label: 'Strategic' },
  { key: 'active', label: 'Active' },
]

const FILTER_LABELS = { new: 'New today', backlog: 'Backlog', active: 'Active', hot: 'Hot', toclear: 'To-clear', strategic: 'Strategic' }
const filterLabel = (f) => {
  if (!f) return ''
  if (f.startsWith('rolenew:')) return f.slice(8) + ' — new today'
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
      const cutoff = CUTOFF_TODAY()
      r = r.filter((o) => FRESH_STAGES.includes(o.stage) && o.createdAt && new Date(o.createdAt).getTime() >= cutoff)
    } else if (activeFilter === 'backlog') {
      const cutoff = CUTOFF_TODAY()
      r = r.filter((o) => FRESH_STAGES.includes(o.stage) && (!o.createdAt || new Date(o.createdAt).getTime() <= cutoff))
    } else if (activeFilter === 'active') {
      r = r.filter((o) => ACTIVE_STAGES.includes(o.stage))
    } else if (activeFilter === 'hot') {
      r = r.filter((o) => o.urgency === 'Hot')
    } else if (activeFilter === 'toclear') {
      r = r.filter((o) => FRESH_STAGES.includes(o.stage))
    } else if (activeFilter === 'strategic') {
      r = r.filter((o) => o.fit === 'Strategic')
    } else if (activeFilter?.startsWith('rolenew:')) {
      const fam = activeFilter.slice(8)
      const cutoff = CUTOFF_TODAY()
      r = r.filter((o) => roleFamily(o) === fam && FRESH_STAGES.includes(o.stage) && o.createdAt && new Date(o.createdAt).getTime() >= cutoff)
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

  // Live stage counts for the funnel — group ALL loaded opps by stage (ignores filters).
  const stageCounts = useMemo(() => {
    const by = {}
    for (const o of opportunities) by[o.stage] = (by[o.stage] || 0) + 1
    return by
  }, [opportunities])

  // Per-role counts for the chip bar — match each persona key against opp.rolesFor.
  const roleCounts = useMemo(() => {
    const c = { all: opportunities.length, other: 0 }
    for (const o of opportunities) {
      const rf = o.rolesFor || []
      if (rf.length === 0) c.other += 1
      for (const k of rf) c[k] = (c[k] || 0) + 1
    }
    return c
  }, [opportunities])

  // Live counts for the quick-filter chips.
  const quickCounts = useMemo(() => ({
    toclear: opportunities.filter((o) => FRESH_STAGES.includes(o.stage)).length,
    hot: opportunities.filter((o) => o.urgency === 'Hot').length,
    strategic: opportunities.filter((o) => o.fit === 'Strategic').length,
    active: opportunities.filter((o) => ACTIVE_STAGES.includes(o.stage)).length,
  }), [opportunities])

  // Single-result redirect: if a named filter yields exactly 1 opp, go directly to its detail
  useEffect(() => {
    if (activeFilter && rows.length === 1 && !loading) {
      go('/opp/' + rows[0].id)
    }
  }, [rows, activeFilter, loading])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Live stage funnel — one connected node per pipeline stage, showing the live count. */}
      {stages.length > 0 && (
        <div className="px-box" style={{ padding: '12px 14px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, minWidth: 'min-content' }}>
            {stages.map((s, i) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
                <div
                  onClick={() => { setActiveFilter(null); setUrgency('All'); setQuery(''); setStage(s) }}
                  title={STAGE_LABELS[s] || s}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <span style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 40, height: 40, borderRadius: '50%', fontSize: 14, fontWeight: 700,
                    background: (stageCounts[s] || 0) > 0 ? 'var(--surface-brand-default)' : 'var(--proto-panel)',
                    color: (stageCounts[s] || 0) > 0 ? 'var(--text-on-brand)' : 'var(--proto-ink3)',
                    border: '1px solid var(--proto-rule-soft)',
                  }}>{stageCounts[s] || 0}</span>
                  <span className="px-small" style={{ whiteSpace: 'nowrap', fontSize: 10 }}>{STAGE_LABELS[s] || s}</span>
                </div>
                {i < stages.length - 1 && (
                  <span style={{ width: 18, height: 2, background: 'var(--proto-rule-soft)', margin: '0 2px', marginBottom: 18, flexShrink: 0 }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick filters (spec: All / To-clear / Hot / Strategic / Active), each with live count. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {QUICK_FILTERS.map((f) => {
          const on = (activeFilter || null) === f.key
          const n = f.key ? quickCounts[f.key] : opportunities.length
          return (
            <span key={f.label} className="px-pill"
              onClick={() => { setActiveFilter(f.key); setStage('All'); setUrgency('All'); setQuery(''); if (!f.key) go('/opportunities') }}
              style={{ cursor: 'pointer', background: on ? 'var(--surface-brand-default)' : undefined, color: on ? 'var(--text-on-brand)' : undefined }}>
              {f.label}{typeof n === 'number' ? ` ${n}` : ''}
            </span>
          )
        })}
      </div>

      {roles.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[{ key: 'all', name: 'All' }, ...roles, { key: 'other', name: 'Other' }].map((r) => {
            const n = roleCounts[r.key] || 0
            return (
              <span key={r.key} className="px-pill" onClick={() => setRoleFilter(r.key)}
                style={{ cursor: 'pointer', background: roleFilter === r.key ? 'var(--surface-brand-default)' : undefined, color: roleFilter === r.key ? 'var(--text-on-brand)' : undefined }}>
                {r.name} {n}
              </span>
            )
          })}
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
