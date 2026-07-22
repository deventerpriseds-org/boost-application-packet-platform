import React, { useEffect, useState, useCallback } from 'react'
import { go, useRoute } from '../state.jsx'
import { api } from '../api.js'
import { MatchScore, Pill } from '../shell.jsx'
import { Loading, ErrorBox, Empty } from './Today.jsx'

const TABS = [
  { key: 'assets', label: 'Assets' },
  { key: 'roles', label: 'Role Profiles' },
  { key: 'playbooks', label: 'Playbooks' },
]
const ASSET_LABEL = { resume: 'Resume', compact_resume: 'Compact resume', cover: 'Cover letter', portfolio: 'Portfolio', video: 'Intro video' }
const STATUS_TONE = { todo: 'panel', drafting: 'yellow', review: 'accent', changes: 'red', approved: 'green' }

export default function Library({ tab = 'assets' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--proto-rule-soft)' }}>
        {TABS.map((t) => (
          <div key={t.key} onClick={() => go(`/library/${t.key}`)}
            style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13,
              fontWeight: tab === t.key ? 600 : 500, color: tab === t.key ? 'var(--text-brand)' : 'var(--proto-ink2)',
              borderBottom: tab === t.key ? '2px solid var(--surface-brand-default)' : '2px solid transparent', marginBottom: -1 }}>
            {t.label}
          </div>
        ))}
      </div>
      {tab === 'assets' && <Assets />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'playbooks' && <Playbooks />}
    </div>
  )
}

function useFetch(fn, deps = []) {
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const load = useCallback(async () => {
    try { const r = await fn(); if (r.error) throw new Error(r.error); setState({ loading: false, error: null, data: r }) }
    catch (e) { setState({ loading: false, error: String(e.message || e), data: null }) }
  }, deps)
  useEffect(() => { load() }, [load])
  return state
}

function timeAgo(iso) {
  if (!iso) return '—'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

// Engagement: who's opened the shared assets (via tracked links).
function AssetAnalytics() {
  const { loading, error, data } = useFetch(() => api.assetsAnalytics())
  if (loading || error || !data) return null
  const assets = (data.assets || []).filter((a) => a.opens > 0)
  return (
    <div className="px-box" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <b style={{ fontSize: 14 }}>Engagement</b>
        <span className="px-small">tracked opens on shared assets</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 22, fontWeight: 700 }}>{data.totalOpens || 0}</span>
        <span className="px-small">total opens</span>
      </div>
      {assets.length === 0 ? (
        <div className="px-small" style={{ marginTop: 10 }}>No opens yet. Share an asset with <b>"Copy tracked link"</b> (in the packet builder) instead of the raw Drive URL, and opens will show up here.</div>
      ) : (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {assets.map((a) => (
            <div key={a.assetId} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 13 }}>
              <span style={{ fontWeight: 600, minWidth: 200 }}>{a.label}</span>
              <span className="px-small">👁 {a.opens}{a.uniqueViewers ? ` · ${a.uniqueViewers} viewer${a.uniqueViewers === 1 ? '' : 's'}` : ''}</span>
              <div style={{ flex: 1 }} />
              <span className="px-small">{timeAgo(a.lastEvent)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Assets() {
  const { loading, error, data } = useFetch(() => api.listAssets())
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />
  const assets = data.assets || []
  if (!assets.length) return (<div><AssetAnalytics /><Empty>No generated assets yet. Build a packet to create tailored resumes, cover letters, and intro videos.</Empty></div>)
  return (
    <div>
    <AssetAnalytics />
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
      {assets.map((a) => (
        <div key={a.id} className="px-box" onClick={() => go(`/packet/${a.oppId}`)} style={{ padding: 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{ASSET_LABEL[a.type] || a.type}</div>
            <Pill tone={STATUS_TONE[a.status] || 'panel'}>{a.status}</Pill>
          </div>
          <div className="px-small">{a.company} · {a.role}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
            {a.type === 'video' && a.driveUrl && <a href={a.driveUrl} target="_blank" rel="noreferrer" className="px-link" style={{ fontSize: 12 }} onClick={(e) => e.stopPropagation()}>Drive ↗</a>}
            {a.type === 'video' && a.docUrl && <span className="px-small">🎬 rendered</span>}
            {a.opens > 0 && <span className="px-small">👁 {a.opens} opens</span>}
          </div>
        </div>
      ))}
    </div>
    </div>
  )
}

// Roles tab: grid of role profiles, or a detail view at /library/roles/<key>.
function RolesTab() {
  const { parts } = useRoute()
  const roleKey = parts[2] // /library/roles/<key>
  if (roleKey) return <RoleDetail roleKey={roleKey} />
  return <RolesGrid />
}

function RolesGrid() {
  const { loading, error, data } = useFetch(() => api.listPersonas())
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />
  const personas = data.personas || []
  if (!personas.length) return (
    <Empty>No target roles configured yet. <span className="px-link" style={{ cursor: 'pointer' }} onClick={() => go('/settings/roles')}>Add one in Settings</span></Empty>
  )
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <span className="px-link" style={{ fontSize: 12, cursor: 'pointer' }} onClick={() => go('/settings/roles')}>Manage in Settings</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {personas.map((p) => (
          <div key={p.key} className="px-box" onClick={() => go(`/library/roles/${p.key}`)} style={{ padding: 16, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{p.masterRole || p.name}</div>
            <div className="px-small">{p.name} · {p.compTarget || '—'}</div>
            {p.positioning && <div style={{ fontSize: 13, lineHeight: 1.5 }}>{p.positioning}</div>}
            <Pill>{p.opportunities} opportunities</Pill>
          </div>
        ))}
      </div>
    </div>
  )
}

// Role detail — renders ONLY the real persona fields (master_role, name, comp
// target, positioning) plus the live linked opportunities (rolesFor tag match).
// Narrative / key wins / linked assets / linked playbooks are NOT backed by any
// field on the persona or library tables yet, so they are omitted (see note).
function RoleDetail({ roleKey }) {
  const personasState = useFetch(() => api.listPersonas(), [roleKey])
  const oppsState = useFetch(() => api.listOpportunities({ persona: roleKey }), [roleKey])
  if (personasState.loading) return <Loading />
  if (personasState.error) return <ErrorBox error={personasState.error} />
  const persona = (personasState.data.personas || []).find((p) => p.key === roleKey)
  if (!persona) return (
    <div>
      <BackToRoles />
      <Empty>Role profile not found.</Empty>
    </div>
  )
  const opps = oppsState.data?.opportunities || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <BackToRoles />
      <div className="px-box" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3, flex: 1 }}>{persona.masterRole || persona.name}</div>
          <Pill>{persona.opportunities} opportunities</Pill>
        </div>
        <div className="px-small">{persona.name} · <b>Comp target:</b> {persona.compTarget || '—'}</div>
        {persona.positioning
          ? <div style={{ fontSize: 14, lineHeight: 1.6, marginTop: 4 }}>{persona.positioning}</div>
          : <div className="px-small" style={{ marginTop: 4 }}>No positioning statement set. Add one in <span className="px-link" style={{ cursor: 'pointer' }} onClick={() => go('/settings/roles')}>Settings → Roles</span>.</div>}
      </div>

      <div className="px-box" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
          <b style={{ fontSize: 14 }}>Linked opportunities</b>
          <span className="px-small">tagged to this role</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 18, fontWeight: 700 }}>{opps.length}</span>
        </div>
        {oppsState.loading ? <Loading /> : opps.length === 0 ? (
          <div className="px-small">No opportunities are currently tagged to this role.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {opps.map((o) => (
              <div key={o.id} onClick={() => go(`/opp/${o.id}`)} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 13, cursor: 'pointer', padding: '4px 0', borderTop: '1px solid var(--proto-rule-soft)' }}>
                <span style={{ fontWeight: 600, minWidth: 180 }}>{o.company}</span>
                <span className="px-small">{o.role}</span>
                <div style={{ flex: 1 }} />
                {o.stage && <Pill tone="panel">{o.stage}</Pill>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-small" style={{ lineHeight: 1.5 }}>
        Narrative, key wins, linked assets, comp reference, and linked playbooks are not yet
        stored on the role profile — this view shows every real field the persona currently has.
        Those richer fields need backend support before they can be displayed.
      </div>
    </div>
  )
}

function BackToRoles() {
  return <span className="px-link" style={{ fontSize: 12, cursor: 'pointer' }} onClick={() => go('/library/roles')}>← All role profiles</span>
}

function Playbooks() {
  const { loading, error, data } = useFetch(() => api.listLibrary())
  const [cat, setCat] = useState('all')
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />
  const entities = (data.entities || []).filter((e) => e.kind === 'playbook' || e.kind === 'template')
  if (!entities.length) return <Empty>No playbooks yet.</Empty>
  // `category` is a real field on library_entity — build filter chips from it.
  // (There is no `role`, `pages`, or `usage` field on the entity, and no create
  //  endpoint, so those controls are intentionally not rendered.)
  const categories = Array.from(new Set(entities.map((e) => e.category).filter(Boolean))).sort()
  const shown = cat === 'all' ? entities : entities.filter((e) => e.category === cat)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {categories.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['all', ...categories].map((c) => (
            <div key={c} onClick={() => setCat(c)}
              style={{ padding: '4px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: cat === c ? 600 : 500,
                border: '1px solid var(--proto-rule-soft)',
                background: cat === c ? 'var(--surface-brand-default)' : 'transparent',
                color: cat === c ? '#fff' : 'var(--proto-ink2)' }}>
              {c === 'all' ? `All (${entities.length})` : `${c} (${entities.filter((e) => e.category === c).length})`}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {shown.map((e) => (
          <div key={e.id} className="px-box" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{e.name}</div>
              <Pill tone={e.kind === 'template' ? 'yellow' : 'accent'}>{e.kind}</Pill>
            </div>
            {e.category && <div className="px-small">{e.category}</div>}
            {e.content?.thesis && <div style={{ fontSize: 13, lineHeight: 1.5 }}>{e.content.thesis}</div>}
            {e.content?.est_reply && <div className="px-small">Est. reply rate: {e.content.est_reply}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
