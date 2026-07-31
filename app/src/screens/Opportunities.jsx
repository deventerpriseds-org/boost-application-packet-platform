import React, { useMemo, useState, useEffect, useCallback } from 'react'
import { go, useApp } from '../state.jsx'
import { api } from '../api.js'
import { MatchScore, UrgencyPill, Pill, FavStar } from '../shell.jsx'
import { Loading, ErrorBox, Empty, roleFamily, titleFamily } from './Today.jsx'

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
  const { toast } = useApp()
  const { loading, error, opportunities: activeOpps, stages, reload } = opps
  const [query, setQuery] = useState('')
  const [urgency, setUrgency] = useState('All')
  const [stage, setStage] = useState('All')
  const [sort, setSort] = useState('match')
  const [roleFilter, setRoleFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState(filter || null)
  const [showRejected, setShowRejected] = useState(false)
  const [withDismissed, setWithDismissed] = useState(null) // list incl. dismissed, fetched on demand
  const [busyId, setBusyId] = useState(null)

  // Fetch the dismissed-inclusive list when the toggle is on (and after any mutation).
  const loadWithDismissed = useCallback(() => {
    return api.listOpportunities({ includeDismissed: true })
      .then((r) => { if (!r.error) setWithDismissed(r.opportunities || []) })
      .catch(() => {})
  }, [])
  useEffect(() => { if (showRejected) loadWithDismissed() }, [showRejected, loadWithDismissed])

  // The table source: dismissed-inclusive list when the toggle is on, else the active set.
  const opportunities = showRejected && withDismissed ? withDismissed : activeOpps

  // Persist a status change, then refresh both the shared list and (if shown) the rejected list.
  const refreshAll = useCallback(() => { reload?.(); if (showRejected) loadWithDismissed() }, [reload, showRejected, loadWithDismissed])
  const changeStage = async (id, newStage) => {
    setBusyId(id)
    try {
      const r = await api.moveStage(id, newStage)
      if (r.error) throw new Error(r.error)
      toast(`Moved to ${STAGE_LABELS[newStage] || newStage}`)
      refreshAll()
    } catch (e) { toast(`Failed: ${e.message}`) } finally { setBusyId(null) }
  }
  const rejectOpp = async (id, company) => {
    setBusyId(id)
    try {
      const r = await api.dismiss(id)
      if (r.error) throw new Error(r.error)
      toast(`Rejected ${company || ''}`.trim())
      refreshAll()
    } catch (e) { toast(`Failed: ${e.message}`) } finally { setBusyId(null) }
  }
  const restoreOpp = async (id, company) => {
    setBusyId(id)
    try {
      const r = await api.undismiss(id)
      if (r.error) throw new Error(r.error)
      toast(`Restored ${company || ''}`.trim())
      refreshAll()
    } catch (e) { toast(`Failed: ${e.message}`) } finally { setBusyId(null) }
  }

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
    } else if (activeFilter?.startsWith('titlenew:')) {
      // New-today, favorite titles only (titleFamily); 'Other roles' bin = non-favorites.
      const t = activeFilter.slice(9)
      const cutoff = CUTOFF_TODAY()
      const isOther = t === 'Other roles'
      const isFavTitle = (o) => o.isFavorite && (o.matchedVariation || o.matchedRole)
      r = r.filter((o) => FRESH_STAGES.includes(o.stage) && o.createdAt && new Date(o.createdAt).getTime() >= cutoff &&
        (isOther ? !isFavTitle(o) : (isFavTitle(o) && titleFamily(o) === t)))
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
    // Taxonomy filter: by group (csuite/vp/director), by favorites, or all.
    if (roleFilter === 'fav') r = r.filter((o) => o.isFavorite)
    else if (roleFilter === 'other') r = r.filter((o) => !o.matchedGroup)
    else if (roleFilter !== 'all') r = r.filter((o) => o.matchedGroup === roleFilter)
    // Favorites first (priority), then by chosen sort.
    r = [...r].sort((a, b) =>
      (Number(!!b.isFavorite) - Number(!!a.isFavorite)) ||
      (sort === 'match' ? (b.match || 0) - (a.match || 0) : (a.company || '').localeCompare(b.company || '')))
    return r
  }, [opportunities, query, urgency, stage, sort, roleFilter, activeFilter])

  // Live stage counts for the funnel — group ALL loaded opps by stage (ignores filters).
  const stageCounts = useMemo(() => {
    const by = {}
    for (const o of opportunities) by[o.stage] = (by[o.stage] || 0) + 1
    return by
  }, [opportunities])

  // Taxonomy group counts for the chip bar (csuite/vp/director) + favorites + unclassified.
  const GROUP_PILLS = [
    { key: 'all', name: 'All' }, { key: 'fav', name: '★ Favorites' },
    { key: 'csuite', name: 'C Suite' }, { key: 'vp', name: 'VP & Head of' },
    { key: 'director', name: 'Director' }, { key: 'other', name: 'Unclassified' },
  ]
  const roleCounts = useMemo(() => {
    const c = { all: opportunities.length, fav: 0, csuite: 0, vp: 0, director: 0, other: 0 }
    for (const o of opportunities) {
      if (o.isFavorite) c.fav += 1
      if (o.matchedGroup && c[o.matchedGroup] != null) c[o.matchedGroup] += 1
      else if (!o.matchedGroup) c.other += 1
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

      {/* Taxonomy pills — filter by seniority group / favorites (supersede the old flat personas) */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {GROUP_PILLS.map((r) => {
          const n = roleCounts[r.key] || 0
          if ((r.key === 'other' || r.key === 'fav') && n === 0) return null
          const on = roleFilter === r.key
          return (
            <span key={r.key} className="px-pill" onClick={() => setRoleFilter(r.key)}
              style={{ cursor: 'pointer', background: on ? 'var(--surface-brand-default)' : undefined, color: on ? 'var(--text-on-brand)' : undefined }}>
              {r.name} {n}
            </span>
          )
        })}
      </div>
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
        <label className="px-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
          title="Include rejected opportunities in the list">
          <input type="checkbox" checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} />
          Show rejected
        </label>
        <span className="px-small">{rows.length} of {opportunities.length}</span>
      </div>

      <div className="px-box" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--proto-ink2)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              <Th>Match</Th><Th>Company</Th><Th>Role</Th><Th>Comp</Th><Th>Stage / status</Th><Th>Urgency</Th><Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} onClick={() => go(`/opp/${o.id}`)}
                style={{ borderTop: '1px solid var(--proto-rule-soft)', cursor: 'pointer', opacity: o.rejected ? 0.62 : 1 }}>
                <Td><MatchScore value={o.match} size={30} /></Td>
                <Td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <FavStar on={o.isFavorite} />
                    <span style={{ fontWeight: 600, textDecoration: o.rejected ? 'line-through' : 'none' }}>{o.company}</span>
                  </span>
                  {o.rejected && <Pill tone="red" style={{ marginLeft: 6 }}>Rejected</Pill>}
                  <div className="px-small">{o.matchedRole ? o.matchedRole : (o.location || '—')}</div>
                </Td>
                <Td>{o.role}</Td>
                <Td>{o.comp || '—'}</Td>
                <Td onClick={stopRow}>
                  <select className="px-btn" style={{ fontSize: 12, padding: '4px 6px' }}
                    value={o.stage} disabled={busyId === o.id}
                    onChange={(e) => changeStage(o.id, e.target.value)}>
                    {stages.map((s) => <option key={s} value={s}>{STAGE_LABELS[s] || s}</option>)}
                  </select>
                </Td>
                <Td>{o.urgency ? <UrgencyPill urgency={o.urgency} /> : <span className="px-small">—</span>}</Td>
                <Td onClick={stopRow}>
                  {o.rejected
                    ? <button className="px-btn" style={{ fontSize: 11 }} disabled={busyId === o.id} onClick={() => restoreOpp(o.id, o.company)}>↩ Restore</button>
                    : <button className="px-btn" style={{ fontSize: 11, color: 'var(--proto-red)', borderColor: 'var(--proto-red)' }} disabled={busyId === o.id} onClick={() => rejectOpp(o.id, o.company)}>✕ Reject</button>}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No opportunities match these filters.</Empty>}
      </div>
    </div>
  )
}

const stopRow = (e) => e.stopPropagation() // keep in-cell controls from triggering the row's navigate
const Th = ({ children }) => <th style={{ padding: '10px 14px' }}>{children}</th>
const Td = ({ children }) => <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>{children}</td>
