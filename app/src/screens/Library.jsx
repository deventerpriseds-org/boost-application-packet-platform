import React, { useEffect, useState, useCallback } from 'react'
import { useApp, go, useRoute } from '../state.jsx'
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
      {tab === 'roles' && <Roles />}
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
        <div className="px-small" style={{ marginTop: 10 }}>No opens yet. Share an asset with <b>“Copy tracked link”</b> (in the packet builder) instead of the raw Drive URL, and opens will show up here.</div>
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

function Roles() {
  const { personaKey, setPersonaKey } = useApp()
  const { loading, error, data } = useFetch(() => api.listPersonas())
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />
  const personas = data.personas || []
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
      {personas.map((p) => (
        <div key={p.key} className="px-box" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, borderColor: p.key === personaKey ? 'var(--surface-brand-default)' : undefined }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{p.masterRole}</div>
            {p.key === personaKey && <Pill tone="accent">active</Pill>}
          </div>
          <div className="px-small">{p.name} · {p.compTarget || '—'}</div>
          {p.positioning && <div style={{ fontSize: 13, lineHeight: 1.5 }}>{p.positioning}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <Pill>{p.opportunities} opportunities</Pill>
            {p.key !== personaKey && <button className="px-btn" style={{ fontSize: 12 }} onClick={() => setPersonaKey(p.key)}>Switch to this persona</button>}
          </div>
        </div>
      ))}
    </div>
  )
}

function Playbooks() {
  const { loading, error, data } = useFetch(() => api.listLibrary())
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />
  const entities = (data.entities || []).filter((e) => e.kind === 'playbook' || e.kind === 'template')
  if (!entities.length) return <Empty>No playbooks yet.</Empty>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
      {entities.map((e) => (
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
  )
}
