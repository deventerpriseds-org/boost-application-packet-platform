import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { go } from '../state.jsx'
import { api, sessionValid } from '../api.js'
import { Loading, ErrorBox } from './Today.jsx'

// ── PRD §7 "Roles & Titles" — 3-pane taxonomy manager (prototype, ACT-39) ──────────────────────
// Additive: reads the EXISTING app/taxonomy read model (group -> role -> title variant + tiers) and
// links Pane-3's baseline card OUT to the ACT-30 Role Profiles page (/library/roles/<group:role>).
// Prototype scope: tier writes go straight through api.taxonomySetTier (no draft/publish layer yet).

const GROUP_LABEL = { csuite: 'C-suite', vp: 'VP & Head of', director: 'Director' }
const GROUP_RANK = { csuite: 0, vp: 1, director: 2 }
const roleLabel = (group, role) =>
  group === 'csuite' ? role : group === 'director' ? `Director · ${role}` : group === 'vp' ? `VP · ${role}` : role
const TIER_META = {
  fav: { label: '★ Favorite', color: '#c08a1e', dot: '#c08a1e' },
  watch: { label: 'Watching', color: 'var(--proto-ink2)', dot: 'var(--proto-ink3)' },
  off: { label: 'Off', color: 'var(--proto-ink3)', dot: 'var(--proto-ink4, #cbd2dc)' },
}
const NEXT_TIER = { fav: 'watch', watch: 'off', off: 'fav' }   // cycle fav -> watch -> off
const TIER_RANK = { fav: 0, watch: 1, off: 2 }

// The five promotion rules (PRD §5 tier gate) — shown in Pane 3.
const PROMO_RULES = [
  'Score +15 (capped 100) — one favorite outranks a higher-paying non-favorite',
  'Pinned above the rest of the role bin in Swipe',
  'Push notification immediately (bypasses the daily digest)',
  'Packet draft auto-starts from the role baseline',
  'Gold star on cards and pipeline rows (is_favorite)',
]

export default function RolesTitles() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [sel, setSel] = useState({ group: null, role: null })
  const [collapsed, setCollapsed] = useState({})
  const [filter, setFilter] = useState('all')       // all | fav | watch | off
  const [q, setQ] = useState('')
  const [favFirst, setFavFirst] = useState(true)
  const [busyTitle, setBusyTitle] = useState(null)
  const [dirty, setDirty] = useState(0)
  const [saving, setSaving] = useState(false)
  const canEdit = sessionValid()

  const load = useCallback(async () => {
    setErr(null)
    try {
      const res = await api.taxonomy()
      const groups = (res.groups || []).slice().sort((a, b) => (GROUP_RANK[a.slug] ?? 9) - (GROUP_RANK[b.slug] ?? 9))
      setDirty(res.dirty || 0)
      setData({ groups, counts: res.counts || {}, favoritedOpps: res.favoritedOpps || 0 })
      // preselect first role of first group (PRD R-1: C Suite -> CTO)
      setSel((s) => {
        if (s.role) return s
        const g = groups[0]; const r = g?.roles?.[0]
        return g && r ? { group: g.slug, role: r.slug } : s
      })
    } catch (e) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const selRole = useMemo(() => {
    if (!data) return null
    const g = data.groups.find((x) => x.slug === sel.group)
    return g?.roles.find((x) => x.slug === sel.role) ? { group: g, role: g.roles.find((x) => x.slug === sel.role) } : null
  }, [data, sel])

  // Clear search when the role changes (PRD R-8).
  useEffect(() => { setQ(''); setFilter('all') }, [sel.group, sel.role])

  const setTier = async (title, tier) => {
    if (!canEdit) return
    setBusyTitle(title.title)
    // optimistic local update + recompute role counts
    setData((d) => {
      const groups = d.groups.map((g) => ({
        ...g,
        roles: g.roles.map((r) => {
          if (r.slug !== sel.role || g.slug !== sel.group) return r
          const titles = r.titles.map((t) => (t.title === title.title ? { ...t, tier } : t))
          const counts = { fav: 0, watch: 0, off: 0 }
          titles.forEach((t) => { counts[t.tier] = (counts[t.tier] || 0) + 1 })
          return { ...r, titles, ...counts }
        }),
      }))
      const totals = { fav: 0, watch: 0, off: 0 }
      groups.forEach((g) => g.roles.forEach((r) => r.titles.forEach((t) => { totals[t.tier]++ })))
      return { groups, counts: { ...d.counts, ...totals } }
    })
    try { const r = await api.taxonomySetTier({ title: title.title, tier }); if (typeof r?.dirty === 'number') setDirty(r.dirty) }
    catch (e) { setErr(`Stage failed: ${String(e?.message || e)}`); await load() }
    finally { setBusyTitle(null) }
  }
  const cycleTier = (t) => setTier(t, NEXT_TIER[t.tier] || 'fav')
  const toggleStar = (t) => setTier(t, t.tier === 'fav' ? 'watch' : 'fav')
  const bulkTier = async (tier) => {
    if (!canEdit || !selRole) return
    setBusyTitle('__bulk__')
    // optimistic: set every title in the selected role to `tier`
    setData((d) => {
      const groups = d.groups.map((g) => g.slug !== sel.group ? g : ({
        ...g, roles: g.roles.map((r) => r.slug !== sel.role ? r : (() => {
          const titles = r.titles.map((t) => ({ ...t, tier }))
          const counts = { fav: 0, watch: 0, off: 0 }; titles.forEach((t) => counts[t.tier]++)
          return { ...r, titles, ...counts }
        })()),
      }))
      return { ...d, groups }
    })
    try { const r = await api.taxonomyBulkTier({ group: sel.group, roleSlug: sel.role, tier }); if (typeof r?.dirty === 'number') setDirty(r.dirty) }
    catch (e) { setErr(`Bulk failed: ${String(e?.message || e)}`); await load() }
    finally { setBusyTitle(null) }
  }
  const publish = async () => {
    if (!canEdit || saving) return
    setSaving(true)
    try { await api.taxonomyPublish(); await load() }
    catch (e) { setErr(`Save failed: ${String(e?.message || e)}`) }
    finally { setSaving(false) }
  }
  const revert = async () => {
    if (!canEdit || saving) return
    setSaving(true)
    try { await api.taxonomyRevert(); await load() }
    catch (e) { setErr(`Revert failed: ${String(e?.message || e)}`) }
    finally { setSaving(false) }
  }

  if (err) return <ErrorBox msg={err} onRetry={load} />
  if (!data) return <Loading />

  const c = data.counts
  const roleCount = data.groups.reduce((n, g) => n + g.roles.length, 0)

  // Pane 2 rows: filter + search + fav-first sort
  let rows = selRole ? selRole.role.titles.slice() : []
  if (filter !== 'all') rows = rows.filter((t) => t.tier === filter)
  if (q.trim()) { const s = q.trim().toLowerCase(); rows = rows.filter((t) => t.title.toLowerCase().includes(s)) }
  rows.sort((a, b) => (favFirst ? (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || a.title.localeCompare(b.title) : a.title.localeCompare(b.title)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3 }}>Roles &amp; Titles</div>
          <div className="px-small" style={{ marginTop: 2 }}>
            Browse the role taxonomy, mark favorite <b>titles</b>, and tune what the engine watches.
            {!canEdit && <span style={{ color: 'var(--proto-red, #ef4444)' }}> · Sign in to edit tiers</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          {[['Groups', c.groups ?? data.groups.length], ['Roles', roleCount], ['Titles', c.titles ?? 0]].map(([lbl, n]) => (
            <div key={lbl} style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{n}</div>
              <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 10 }}>{lbl}</div>
            </div>
          ))}
          {/* Priority opps = live opportunities matched to a favorite title — the meaningful signal,
              clickable straight to the filtered Opportunities view (extends the existing 'strategic' filter). */}
          <div data-priority-opps onClick={() => go('/opportunities?filter=strategic')} title="View these opportunities"
            style={{ textAlign: 'right', cursor: 'pointer', paddingLeft: 14, borderLeft: '1px solid var(--proto-rule-soft)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#c08a1e' }}>{data.favoritedOpps} ★</div>
            <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 10, color: 'var(--text-brand)' }}>Priority opps →</div>
          </div>
          {dirty > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: 14, borderLeft: '1px solid var(--proto-rule-soft)' }}>
              {canEdit && <button className="px-btn-ghost" style={{ fontSize: 12 }} disabled={saving} onClick={revert} data-action="revert">Revert {dirty}</button>}
              {canEdit && <button className="px-btn" style={{ fontSize: 12 }} disabled={saving} onClick={publish} data-action="save">{saving ? 'Saving…' : 'Save favorites'}</button>}
            </div>
          )}
        </div>
      </div>

      {/* 3-pane grid: >=1180 three panes, 720-1179 two + detail below, <720 stacked */}
      <div className="ee-roles-grid">
        {/* Pane 1 — tree */}
        <div className="px-box ee-pane" data-pane="tree">
          {data.groups.map((g) => {
            const open = !collapsed[g.slug]
            const gFav = g.roles.reduce((n, r) => n + (r.fav || 0), 0)
            return (
              <div key={g.slug} data-group={g.slug} data-open={String(open)}>
                <div onClick={() => setCollapsed((m) => ({ ...m, [g.slug]: open }))}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                  <span style={{ width: 12, color: 'var(--proto-ink3)' }}>{open ? '▾' : '▸'}</span>
                  <span style={{ flex: 1 }}>{g.label || GROUP_LABEL[g.slug] || g.slug}</span>
                  {gFav > 0 && <span style={{ color: '#c08a1e', fontSize: 11, fontWeight: 700 }}>★{gFav}</span>}
                </div>
                {open && g.roles.map((r) => {
                  const on = sel.group === g.slug && sel.role === r.slug
                  return (
                    <div key={r.slug} data-role={r.slug} data-selected={String(on)}
                      onClick={() => setSel({ group: g.slug, role: r.slug })}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px 5px 26px', cursor: 'pointer',
                        borderRadius: 6, fontSize: 12.5, background: on ? 'var(--surface-brand-default)' : 'transparent',
                        color: on ? '#fff' : 'var(--proto-ink2)' }}>
                      <span style={{ flex: 1 }}>{r.role}</span>
                      {r.fav > 0 && <span style={{ color: on ? '#ffe' : '#c08a1e', fontSize: 10.5 }}>★{r.fav}</span>}
                      <span style={{ fontSize: 10.5, opacity: 0.7 }}>{r.titles.length}</span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Pane 2 — title variants */}
        <div className="px-box ee-pane" data-pane="list">
          {!selRole ? <div className="px-small" style={{ padding: 12 }}>Select a role.</div> : (
            <>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {selRole.group.label || GROUP_LABEL[selRole.group.slug]} → {selRole.role.role}
              </div>
              <div className="px-small" style={{ marginTop: 2 }}>
                {selRole.role.titles.length} title variants · {selRole.role.fav} favorite · {selRole.role.watch} watching · {selRole.role.off} off
              </div>
              <input data-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles…"
                className="px-input" style={{ marginTop: 10, width: '100%' }} />
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {['all', 'fav', 'watch', 'off'].map((f) => (
                  <div key={f} data-filter={f} data-on={String(filter === f)} onClick={() => setFilter(f)}
                    className="px-chip" style={{ cursor: 'pointer', fontSize: 11,
                      background: filter === f ? 'var(--surface-brand-default)' : undefined, color: filter === f ? '#fff' : undefined }}>
                    {f === 'all' ? 'All' : f === 'fav' ? '★ Favorites' : f === 'watch' ? 'Watching' : 'Off'}
                  </div>
                ))}
                <div data-favfirst data-favfirst-on={String(favFirst)} onClick={() => setFavFirst((v) => !v)}
                  className="px-chip" style={{ cursor: 'pointer', fontSize: 11, marginLeft: 'auto',
                    background: favFirst ? 'var(--proto-accent-soft, #eef)' : undefined, color: favFirst ? 'var(--text-brand)' : undefined }}>
                  Favorites first {favFirst ? '✓' : ''}
                </div>
              </div>

              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column' }}>
                {rows.length === 0 && <div className="px-small" style={{ padding: 12, textAlign: 'center', border: '1px dashed var(--proto-rule-soft)', borderRadius: 8 }}>No titles match that filter.</div>}
                {rows.map((t) => (
                  <div key={t.title} data-title={t.title} data-tier={t.tier}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', borderBottom: '1px solid var(--proto-rule-soft)',
                      background: t.tier === 'fav' ? 'rgba(192,138,30,.06)' : undefined, opacity: t.tier === 'off' ? 0.5 : 1 }}>
                    <span data-star data-star-on={t.tier === 'fav' ? 'on' : 'off'} onClick={() => toggleStar(t)}
                      style={{ cursor: canEdit ? 'pointer' : 'default', color: t.tier === 'fav' ? '#c08a1e' : 'var(--proto-ink4, #cbd2dc)', fontSize: 15, width: 16 }}>★</span>
                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: t.tier === 'fav' ? 600 : 400,
                      textDecoration: t.tier === 'off' ? 'line-through' : 'none' }}>{t.title}</span>
                    {t.live > 0 && (
                      <span data-live title={`${t.live} open opportunit${t.live === 1 ? 'y' : 'ies'} matched — click to view`}
                        onClick={() => go('/opportunities?filter=strategic')}
                        style={{ cursor: 'pointer', fontSize: 10.5, fontWeight: 700, color: '#c08a1e', background: 'rgba(192,138,30,.10)', borderRadius: 10, padding: '1px 7px' }}>{t.live} live</span>
                    )}
                    <span data-tiercycle onClick={() => cycleTier(t)}
                      style={{ cursor: canEdit ? 'pointer' : 'default', fontSize: 11, fontWeight: 600, color: TIER_META[t.tier].color,
                        opacity: busyTitle === t.title ? 0.4 : 1, minWidth: 64, textAlign: 'right' }}>{TIER_META[t.tier].label}</span>
                  </div>
                ))}
              </div>

              {canEdit && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="px-small">Bulk:</span>
                  <button data-bulk="fav" className="px-btn-ghost" style={{ fontSize: 11 }} onClick={() => bulkTier('fav')}>★ Favorite all</button>
                  <button data-bulk="watch" className="px-btn-ghost" style={{ fontSize: 11 }} onClick={() => bulkTier('watch')}>Watch all</button>
                  <button data-bulk="off" className="px-btn-ghost" style={{ fontSize: 11 }} onClick={() => bulkTier('off')}>Turn role off</button>
                </div>
              )}
              <div className="px-small" style={{ marginTop: 8, color: 'var(--proto-ink3)' }}>
                Tier changes are staged as a draft — hit <b>Save favorites</b> to publish &amp; re-score your opportunities, or <b>Revert</b> to discard.
              </div>
            </>
          )}
        </div>

        {/* Pane 3 — role detail */}
        <div className="px-box ee-pane" data-pane="detail">
          {!selRole ? <div className="px-small" style={{ padding: 12 }}>Select a role.</div> : (
            <>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{roleLabel(selRole.group.slug, selRole.role.role)}</div>
              <div className="px-small">{selRole.group.label || GROUP_LABEL[selRole.group.slug]}</div>

              <div style={{ marginTop: 14 }}>
                <div className="px-small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 10 }}>Favorites in this role</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--proto-rule-soft)', overflow: 'hidden' }}>
                    <div style={{ width: `${selRole.role.titles.length ? (selRole.role.fav / selRole.role.titles.length) * 100 : 0}%`, height: '100%', background: '#c08a1e' }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{selRole.role.fav}/{selRole.role.titles.length}</span>
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <div className="px-small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 10 }}>How favorites get promoted</div>
                <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12, lineHeight: 1.6, color: 'var(--proto-ink2)' }}>
                  {PROMO_RULES.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>

              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--proto-rule-soft)' }}>
                <div className="px-small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 10 }}>Role baseline</div>
                <div className="px-small" style={{ margin: '4px 0 8px' }}>Narrative, key wins & comp reference the packet builder tailors from.</div>
                <button data-action="baseline" className="px-btn"
                  onClick={() => go(`/library/roles/${encodeURIComponent(`${selRole.group.slug}:${selRole.role.role}`)}`)}>
                  Open role baseline →
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
