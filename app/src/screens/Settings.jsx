import React, { useCallback, useEffect, useState } from 'react'
import { api, getSessionToken } from '../api.js'
import { go, useApp } from '../state.jsx'
import { Pill } from '../shell.jsx'

// Settings — app configuration. Currently the Intake watcher (which mailbox /
// folder / senders feed opportunities) lives here, plus a self-test to confirm
// the wiring. Structured as sections so future config (integrations, personas)
// can slot in alongside.

const SOURCE_PRESETS = [
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'indeed', label: 'Indeed' },
  { key: 'glassdoor', label: 'Glassdoor' },
  { key: 'ziprecruiter', label: 'ZipRecruiter' },
  { key: 'greenhouse', label: 'Greenhouse' },
  { key: 'lever', label: 'Lever' },
]

function Card({ children, style }) {
  return <div style={{ border: '1px solid var(--proto-rule-soft)', borderRadius: 12, background: 'var(--proto-paper)', padding: 16, ...style }}>{children}</div>
}

// Categorical colors for role bins (cycled by index).
const ROLE_COLORS = ['#5b4bd6', '#c2410c', '#0e7490', '#9d174d', '#4d7c0f', '#7c3aed', '#b45309', '#0f766e']

// Flat depth-ordered folder list → only rows whose ancestors are all expanded.
function visibleFolders(list, expanded) {
  const byId = Object.fromEntries(list.map((f) => [f.id, f]))
  return list.filter((f) => {
    let p = f.parentId
    while (p) { if (!expanded[p]) return false; p = byId[p]?.parentId }
    return true
  })
}
const Label = ({ children }) => <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{children}</div>

// Is the server-verified session token present AND unexpired? Writes (requireWrite) need it; it has a
// 12h TTL and does not silently refresh, so a stale token 401s every owner-scoped mutation while reads
// still work via ?owner=. Decode the JWT exp locally to warn BEFORE the user loses their edits to a 401.
function sessionValid() {
  const t = getSessionToken()
  if (!t) return false
  try {
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof p.exp === 'number' && p.exp > Math.floor(Date.now() / 1000)
  } catch { return false }
}

// LinkedIn role sweep — the ACTIVE counterpart to mailbox alert intake. Instead of waiting for
// LinkedIn alert emails to land, a per-minute timer walks a DB cursor through OR-batches of the
// owner's target roles and files matches automatically. This is the on/off + pacing control for it,
// backed by owner_search_prefs via GET/POST /api/app/search-sweep. Left OFF by default; nothing
// searches until the owner enables it here. Sits in Settings ▸ Intake, below Folder → role routing.
function SweepSettings() {
  const [st, setSt] = useState({ loading: true, err: null })
  const [enabled, setEnabled] = useState(false)
  const [tpq, setTpq] = useState(8)
  const [startH, setStartH] = useState(6)
  const [endH, setEndH] = useState(16)
  const [jdMode, setJdMode] = useState('direct')      // 'direct' | 'proxy' — Job description source
  const [jdFallback, setJdFallback] = useState(true)   // in direct mode, retry a blocked fetch via proxy
  const [totals, setTotals] = useState({ queries: null, titles: null, previewTpq: 8 })
  const [cursor, setCursor] = useState(null)
  const [queries, setQueries] = useState([])
  const [savedCfg, setSavedCfg] = useState(null)   // last persisted {enabled,tpq,start,end}
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState(null)
  const [showQ, setShowQ] = useState(false)

  // active_hours_et is an int[] of ET hours; represent it as a contiguous [start..end] window.
  const hoursToRange = (hrs) => {
    if (!Array.isArray(hrs) || !hrs.length) return [6, 16]
    return [Math.min(...hrs), Math.max(...hrs)]
  }
  const rangeToHours = (s, e) => { const out = []; for (let h = Math.min(s, e); h <= Math.max(s, e); h++) out.push(h); return out }

  const applyResp = useCallback((r) => {
    const cfg = r.config || {}
    const [s, e] = hoursToRange(cfg.activeHoursEt)
    setEnabled(!!cfg.enabled); setTpq(cfg.titlesPerQuery ?? 8); setStartH(s); setEndH(e)
    const mode = cfg.jdFetchMode === 'proxy' ? 'proxy' : 'direct'
    const fb = cfg.jdFetchFallback !== false
    setJdMode(mode); setJdFallback(fb)
    setTotals({ queries: r.totalQueries ?? null, titles: r.totalTitles ?? null, previewTpq: r.previewTitlesPerQuery ?? cfg.titlesPerQuery ?? 8 })
    setCursor(r.cursor || null); setQueries(r.queries || [])
    setSavedCfg({ enabled: !!cfg.enabled, tpq: cfg.titlesPerQuery ?? 8, start: s, end: e, jdMode: mode, jdFallback: fb })
  }, [])

  const load = useCallback(async () => {
    setSt({ loading: true, err: null })
    try {
      const r = await api.searchSweepGet()
      if (r.ok === false) throw new Error(r.error || 'failed')
      applyResp(r)
      setSt({ loading: false, err: null })
    } catch (e) { setSt({ loading: false, err: String(e.message || e) }) }
  }, [applyResp])

  useEffect(() => { load() }, [load])

  // Live preview: recompute the real query count for the chosen bundle size (server-side, no persist).
  useEffect(() => {
    if (st.loading || st.err) return
    if (tpq === totals.previewTpq) return
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const r = await api.searchSweepGet(tpq)
        if (cancelled || r.ok === false) return
        setTotals({ queries: r.totalQueries ?? null, titles: r.totalTitles ?? null, previewTpq: r.previewTitlesPerQuery ?? tpq })
        setQueries(r.queries || [])
      } catch { /* keep last-known totals */ }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [tpq, st.loading, st.err, totals.previewTpq])

  const save = useCallback(async () => {
    // Catch a stale/absent session before the POST so edits aren't lost to a raw 401.
    if (!sessionValid()) {
      setNote({ ok: false, msg: 'Your sign-in session expired. Sign out and back in (top-right menu), then Save again — your changes here are still filled in.' })
      return
    }
    setSaving(true); setNote(null)
    try {
      const r = await api.searchSweepSet({ enabled, titlesPerQuery: tpq, activeHoursEt: rangeToHours(startH, endH), jdFetchMode: jdMode, jdFetchFallback: jdFallback })
      if (r.ok === false) throw new Error(r.error || 'save failed')
      setNote({ ok: true, msg: enabled ? 'Saved — sweep is ON.' : 'Saved — sweep is OFF.' })
      await load()   // re-pull authoritative cursor/totals from server
    } catch (e) {
      const msg = String(e.message || e)
      setNote({ ok: false, msg: /401/.test(msg)
        ? 'Your sign-in session expired. Sign out and back in (top-right menu), then Save again.'
        : msg })
    }
    finally { setSaving(false) }
  }, [enabled, tpq, startH, endH, jdMode, jdFallback, load])

  const dirty = savedCfg && (savedCfg.enabled !== enabled || savedCfg.tpq !== tpq || savedCfg.start !== startH || savedCfg.end !== endH || savedCfg.jdMode !== jdMode || savedCfg.jdFallback !== jdFallback)

  // Coverage/quota math — one query per minute over the active window.
  const activeHrs = Math.max(1, Math.abs(endH - startH) + 1)
  const capacityPerDay = activeHrs * 60                 // max queries/day at 1/min
  const q = totals.queries                              // authoritative from server (saved or preview)
  const sweepMin = q || 0
  const coverPct = q ? Math.min(100, Math.round((Math.min(sweepMin, capacityPerDay) / sweepMin) * 100)) : null
  const cyclesPerDay = q ? capacityPerDay / sweepMin : null
  // LinkedIn quota risk scales with total requests/day vs the active-window capacity.
  const risk = q == null ? 'none' : q > capacityPerDay ? 'high' : q > capacityPerDay * 0.7 ? 'warn' : 'ok'
  const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`

  if (st.loading) return <Card style={{ color: 'var(--proto-ink2)' }}>Loading LinkedIn sweep…</Card>
  if (st.err) return <Card style={{ color: 'var(--proto-red)' }}>Couldn't load sweep config: {st.err}</Card>

  const riskColor = risk === 'high' ? 'var(--proto-red)' : 'var(--proto-yellow)'
  return (
    <Card style={{ border: '1px solid var(--text-brand)', boxShadow: '0 0 0 1px var(--text-brand)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 15 }}>Active search — LinkedIn role sweep</b>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#0a66c2', background: 'rgba(10,102,194,0.14)', padding: '2px 8px', borderRadius: 5 }}>in LinkedIn</span>
          </div>
          <div className="px-small" style={{ marginTop: 3, color: 'var(--proto-ink2)', maxWidth: 460 }}>
            The active counterpart to mailbox intake: instead of waiting for LinkedIn alert emails, this searches <b>LinkedIn</b> directly for your target roles and files matches automatically.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
          <Pill tone={enabled ? 'green' : 'panel'}>{enabled ? 'On · sweeping' : 'Off'}</Pill>
          <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 25, cursor: 'pointer' }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
            <span style={{ position: 'absolute', inset: 0, borderRadius: 999, transition: 'background .18s',
              background: enabled ? 'var(--surface-success-default)' : 'var(--proto-rule)' }} />
            <span style={{ position: 'absolute', top: 3, left: enabled ? 22 : 3, width: 19, height: 19, borderRadius: '50%',
              background: '#fff', transition: 'left .18s', boxShadow: '0 1px 3px rgba(0,0,0,.35)' }} />
          </label>
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--proto-rule-soft)', margin: '14px 0' }} />

      {/* roles source (read-only link to the list it uses) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Searching your target roles</div>
          <div className="px-small" style={{ color: 'var(--proto-ink2)', marginTop: 2 }}>
            Uses the same role list as folder routing{totals.titles != null ? ` — ${totals.titles} target titles` : ''}. Edit it in <span className="px-link" style={{ cursor: 'pointer' }} onClick={() => go('/settings/roles')}>Settings ▸ Roles →</span>
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--proto-rule-soft)', margin: '14px 0' }} />

      {/* roles bundled per search */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 380 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Roles bundled per search</div>
          <div className="px-small" style={{ color: 'var(--proto-ink2)', marginTop: 2 }}>How many titles share one query. Fewer = more precise matches, but more searches per full sweep.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
          <button className="px-btn" style={{ width: 30, height: 30, padding: 0, fontSize: 17 }} disabled={tpq <= 1} onClick={() => setTpq((v) => Math.max(1, v - 1))}>−</button>
          <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 15, fontWeight: 600, minWidth: 22, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{tpq}</span>
          <button className="px-btn" style={{ width: 30, height: 30, padding: 0, fontSize: 17 }} disabled={tpq >= 12} onClick={() => setTpq((v) => Math.min(12, v + 1))}>+</button>
        </div>
      </div>

      {/* LinkedIn quota warning — always present, escalates with request volume */}
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 12, padding: '10px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.45,
        background: risk === 'high' ? 'color-mix(in srgb, var(--proto-red) 18%, transparent)' : 'color-mix(in srgb, var(--proto-red) 10%, transparent)',
        border: `1px solid color-mix(in srgb, ${riskColor} 40%, transparent)`, borderLeft: `3px solid ${riskColor}` }}>
        <span style={{ color: riskColor, fontSize: 14, flex: 'none' }}>⚠</span>
        <span>
          <b style={{ color: riskColor }}>LinkedIn quota risk.</b>{' '}
          {q == null ? (
            'Fewer roles per search means more separate LinkedIn requests per sweep — bundling too few titles raises the chance of tripping LinkedIn rate limits or anti-scraping guardrails.'
          ) : risk === 'high' ? (
            <>At <b>{q}</b> LinkedIn searches per sweep, this bundle is <b>too low</b> — that exceeds what your {activeHrs}h active window can run at one query/min ({capacityPerDay}/day), so a full sweep won't finish daily <i>and</i> the extra request volume raises throttling / anti-scraping risk. Raise "roles bundled per search".</>
          ) : risk === 'warn' ? (
            <>At <b>{q}</b> LinkedIn searches per sweep you're approaching your {activeHrs}h window's capacity ({capacityPerDay}/day at 1/min). Bundling fewer titles means more separate LinkedIn requests — consider a higher bundle unless you need this precision.</>
          ) : (
            <>At <b>{q}</b> LinkedIn searches per sweep you're within a safe rate for your {activeHrs}h window ({capacityPerDay}/day at 1/min). The per-minute pacing spreads the load; bundling too few titles would raise LinkedIn throttling risk.</>
          )}
        </span>
      </div>

      <div style={{ height: 1, background: 'var(--proto-rule-soft)', margin: '14px 0' }} />

      {/* active hours */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 380 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Active hours <span style={{ color: 'var(--proto-ink3)', fontWeight: 500 }}>(Eastern)</span></div>
          <div className="px-small" style={{ color: 'var(--proto-ink2)', marginTop: 2 }}>Only search during these hours. Outside the window it pauses and resumes where it left off — no roles skipped.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
          <select className="px-btn" value={startH} onChange={(e) => setStartH(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
          <span className="px-small" style={{ color: 'var(--proto-ink2)' }}>to</span>
          <select className="px-btn" value={endH} onChange={(e) => setEndH(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </div>
      </div>

      {/* live readout */}
      <div style={{ marginTop: 14, border: '1px solid var(--proto-rule-soft)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1, background: 'var(--proto-rule-soft)' }}>
          {[
            { k: 'LINKEDIN SEARCHES / SWEEP', v: q == null ? '—' : q, s: `≈ ${tpq} roles each` },
            { k: 'CADENCE', v: '1 / min', s: 'timer fires every minute' },
            { k: 'FULL SWEEP TAKES', v: q == null ? '—' : `${(sweepMin / 60).toFixed(1)} hrs`, s: cyclesPerDay ? `≈ ${cyclesPerDay.toFixed(0)}× through all roles / day` : 'within the active window' },
            { k: 'DAILY COVERAGE', v: coverPct == null ? '—' : `${coverPct}%`, s: `${activeHrs}h window · ${capacityPerDay}/day capacity` },
          ].map((c) => (
            <div key={c.k} style={{ background: 'var(--proto-paper)', padding: '12px 14px' }}>
              <div className="px-small" style={{ color: 'var(--proto-ink3)', fontWeight: 650, letterSpacing: 0.2, fontSize: 10.5 }}>{c.k}</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{c.v}</div>
              <div className="px-small" style={{ color: 'var(--proto-ink2)', marginTop: 2 }}>{c.s}</div>
            </div>
          ))}
        </div>
      </div>

      {/* query preview */}
      {queries.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="px-link" style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }} onClick={() => setShowQ((v) => !v)}>
            {showQ ? '▾' : '▸'} Preview the generated queries ({queries.length})
          </div>
          {showQ && (
            <div style={{ marginTop: 8, border: '1px solid var(--proto-rule-soft)', borderRadius: 8, maxHeight: 240, overflowY: 'auto' }}>
              {queries.slice(0, 100).map((qq) => (
                <div key={qq.index} style={{ display: 'flex', gap: 10, padding: '6px 12px', fontSize: 12, alignItems: 'baseline', borderTop: qq.index ? '1px solid var(--proto-rule-soft)' : 'none' }}>
                  <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--proto-ink3)', minWidth: 30, fontVariantNumeric: 'tabular-nums' }}>{String(qq.index).padStart(2, '0')}</span>
                  <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--proto-ink)', wordBreak: 'break-word', flex: 1 }}>{qq.keywords}</span>
                  <span className="px-small" style={{ color: 'var(--proto-ink3)', whiteSpace: 'nowrap' }}>{qq.titles} title{qq.titles === 1 ? '' : 's'}</span>
                </div>
              ))}
              {queries.length > 100 && <div className="px-small" style={{ padding: '6px 12px', color: 'var(--proto-ink3)', borderTop: '1px solid var(--proto-rule-soft)' }}>+ {queries.length - 100} more…</div>}
            </div>
          )}
        </div>
      )}

      <div style={{ height: 1, background: 'var(--proto-rule-soft)', margin: '14px 0' }} />

      {/* Job description source — direct (no credits) vs scraping proxy. Seeds owner_search_prefs.jd_fetch_mode. */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Job description source</div>
        <div className="px-small" style={{ color: 'var(--proto-ink2)', marginTop: 2, maxWidth: 460 }}>
          Where the full job description comes from when a role is ingested or backfilled — what fills each opportunity's JD before a packet is built.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 12 }}>
          {[
            { m: 'direct', name: 'Direct from LinkedIn', sub: 'Fetches the posting straight from LinkedIn. No credits, no third party.', rec: true },
            { m: 'proxy', name: 'Scraping proxy', sub: 'Routes through scrape.do. Use only if direct fetches get blocked.', rec: false },
          ].map((o) => {
            const on = jdMode === o.m
            return (
              <button key={o.m} onClick={() => setJdMode(o.m)} style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--proto-ink)',
                background: on ? 'var(--proto-paper)' : 'transparent', padding: '12px 13px', borderRadius: 9,
                border: `1px solid ${on ? 'var(--text-brand)' : 'var(--proto-rule-soft)'}`, boxShadow: on ? '0 0 0 3px color-mix(in srgb, var(--text-brand) 18%, transparent)' : 'none', transition: 'border-color .12s, box-shadow .12s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 650 }}>{o.name}</span>
                  {o.rec && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 5, background: 'color-mix(in srgb, var(--surface-success-default) 16%, transparent)', color: 'var(--surface-success-default)' }}>Recommended</span>}
                  <span style={{ marginLeft: 'auto', width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${on ? 'var(--text-brand)' : 'var(--proto-rule)'}`, display: 'grid', placeItems: 'center', flex: 'none' }}>
                    {on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-brand)' }} />}
                  </span>
                </div>
                <div className="px-small" style={{ color: 'var(--proto-ink2)', marginTop: 4 }}>{o.sub}</div>
              </button>
            )
          })}
        </div>

        {/* what-happens explainer + qualitative status */}
        <div style={{ marginTop: 12, border: '1px solid var(--proto-rule-soft)', borderLeft: '3px solid var(--text-brand)', borderRadius: 9, padding: '11px 13px', background: 'color-mix(in srgb, var(--text-brand) 5%, var(--proto-paper))' }}>
          <div className="px-small" style={{ color: 'var(--proto-ink3)', fontWeight: 650, letterSpacing: 0.4, fontSize: 10 }}>WHAT HAPPENS</div>
          <div className="px-small" style={{ color: 'var(--proto-ink)', marginTop: 5 }}>
            {jdMode === 'direct'
              ? "Each job description is pulled directly from LinkedIn's public posting. No scraping credits are spent and nothing leaves for a third party. This is how the pipeline runs today."
              : "Job descriptions are fetched through scrape.do, a paid scraping proxy — each fetch spends one credit. Keep this in reserve for the rare posting a direct fetch can't reach."}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 9 }}>
            {(jdMode === 'direct'
              ? [{ t: 'No credits used', tone: 'ok' }, { t: 'No third-party service', tone: 'ok' }]
              : [{ t: 'Spends a credit per JD', tone: 'warn' }, { t: 'Held in reserve', tone: 'warn' }]
            ).map((p) => (
              <span key={p.t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, padding: '4px 9px', borderRadius: 999,
                background: p.tone === 'ok' ? 'color-mix(in srgb, var(--surface-success-default) 14%, transparent)' : 'color-mix(in srgb, var(--proto-yellow) 16%, transparent)',
                color: p.tone === 'ok' ? 'var(--surface-success-default)' : 'var(--proto-yellow)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />{p.t}
              </span>
            ))}
          </div>
        </div>

        {/* fallback — only meaningful in direct mode */}
        {jdMode === 'direct' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <label style={{ position: 'relative', display: 'inline-block', width: 38, height: 22, cursor: 'pointer', flex: 'none' }}>
              <input type="checkbox" checked={jdFallback} onChange={(e) => setJdFallback(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
              <span style={{ position: 'absolute', inset: 0, borderRadius: 999, transition: 'background .18s', background: jdFallback ? 'var(--text-brand)' : 'var(--proto-rule)' }} />
              <span style={{ position: 'absolute', top: 2, left: jdFallback ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .18s', boxShadow: '0 1px 2px rgba(0,0,0,.3)' }} />
            </label>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>Fall back to the proxy if a direct fetch is blocked</div>
              <div className="px-small" style={{ color: 'var(--proto-ink2)', marginTop: 1 }}>A blocked posting quietly retries through scrape.do instead of being left blank.</div>
            </div>
          </div>
        )}
      </div>

      {/* stale-session warning — writes need a live session token (12h TTL, no silent refresh) */}
      {!sessionValid() && (
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 14, padding: '10px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.45,
          background: 'var(--proto-yellow-soft, color-mix(in srgb, var(--proto-yellow) 12%, transparent))',
          border: '1px solid color-mix(in srgb, var(--proto-yellow) 45%, transparent)', borderLeft: '3px solid var(--proto-yellow)' }}>
          <span style={{ color: 'var(--proto-yellow)', fontSize: 14, flex: 'none' }}>🔒</span>
          <span>Your sign-in session has expired, so changes can't be saved yet. <b>Sign out and back in</b> (top-right menu), then Save — your selections here stay filled in.</span>
        </div>
      )}

      {/* footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginTop: 16, flexWrap: 'wrap' }}>
        <span className="px-small" style={{ color: 'var(--proto-ink3)' }}>
          {cursor?.lastFiredAt ? `Last fired ${new Date(cursor.lastFiredAt).toLocaleString()}` : 'Never fired yet'}
          {cursor?.backoffUntil ? ` · backing off until ${new Date(cursor.backoffUntil).toLocaleTimeString()}` : ''}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {note && <span className="px-small" style={{ color: note.ok ? 'var(--surface-success-default)' : 'var(--proto-red)' }}>{note.msg}</span>}
          {dirty && !note && <span className="px-small" style={{ color: 'var(--proto-yellow)' }}>Unsaved changes</span>}
          <button className="px-btn px-btn-accent" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </Card>
  )
}

// Owner-editable TEMPERATURE bands (recency of the posting). Seeds the defaults; the owner retunes
// the cut-points here. Saved to owner_search_prefs via search-prefs (partial update — never clobbers metros).
function TemperatureSettings() {
  const [thr, setThr] = useState(null)
  const [saved, setSaved] = useState(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState(null)
  useEffect(() => {
    api.searchPrefsGet().then((p) => {
      if (p && p.ok !== false && p.tempThresholds) { setThr(p.tempThresholds); setSaved(p.tempThresholds) }
      else { const d = { hotMaxHours: 48, warmMaxDays: 14, coolMaxDays: 21 }; setThr(d); setSaved(d) }
    }).catch(() => { const d = { hotMaxHours: 48, warmMaxDays: 14, coolMaxDays: 21 }; setThr(d); setSaved(d) })
  }, [])
  if (!thr) return <Card style={{ color: 'var(--proto-ink2)' }}>Loading temperature bands…</Card>
  const dirty = saved && (saved.hotMaxHours !== thr.hotMaxHours || saved.warmMaxDays !== thr.warmMaxDays || saved.coolMaxDays !== thr.coolMaxDays)
  const save = async () => {
    if (!sessionValid()) { setNote({ ok: false, msg: 'Sign-in expired — sign out and back in, then Save.' }); return }
    setSaving(true); setNote(null)
    try {
      const r = await api.searchPrefsSet({ tempThresholds: thr })
      if (r.ok === false) throw new Error(r.error || 'save failed')
      setSaved(r.tempThresholds || thr); setNote({ ok: true, msg: 'Saved.' })
    } catch (e) { setNote({ ok: false, msg: String(e.message || e) }) } finally { setSaving(false) }
  }
  const Num = ({ label, unit, val, min, max, onChange }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input className="px-input" type="number" min={min} max={max} value={val}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Math.round(Number(e.target.value) || min))))}
          style={{ width: 74, textAlign: 'right' }} />
        <span className="px-small" style={{ color: 'var(--proto-ink2)', minWidth: 40 }}>{unit}</span>
      </div>
    </div>
  )
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 17 }}>🌡️</span>
        <b style={{ fontSize: 15 }}>Freshness bands (temperature)</b>
      </div>
      <div className="px-small" style={{ marginTop: 3, color: 'var(--proto-ink2)', maxWidth: 470 }}>
        How recently a role was posted decides its temperature — Hot roles are freshest and worth acting on first. Retune the cut-points to fit your search.
      </div>
      <div style={{ height: 1, background: 'var(--proto-rule-soft)', margin: '14px 0' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Num label="🔴 Hot — posted within" unit="hours" min={1} max={720} val={thr.hotMaxHours} onChange={(v) => setThr({ ...thr, hotMaxHours: v })} />
        <Num label="🟠 Warm — up to" unit="days" min={1} max={120} val={thr.warmMaxDays} onChange={(v) => setThr({ ...thr, warmMaxDays: v })} />
        <Num label="🟡 Cooling — up to" unit="days" min={thr.warmMaxDays + 1} max={180} val={thr.coolMaxDays} onChange={(v) => setThr({ ...thr, coolMaxDays: v })} />
        <div className="px-small" style={{ color: 'var(--proto-ink3)' }}>⚪ Cold — anything older than {thr.coolMaxDays} days.</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        {note && <span className="px-small" style={{ color: note.ok ? 'var(--surface-success-default)' : 'var(--proto-red)' }}>{note.msg}</span>}
        {dirty && !note && <span className="px-small" style={{ color: 'var(--proto-yellow)' }}>Unsaved changes</span>}
        <button className="px-btn px-btn-accent" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save bands'}</button>
      </div>
    </Card>
  )
}

function IntakeSettings() {
  const { isDemo } = useApp()
  const [cfg, setCfg] = useState(null)
  const [cfgErr, setCfgErr] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [folders, setFolders] = useState({ loading: false, list: [], error: null })
  const [sub, setSub] = useState({ loading: true, watches: [] })
  const [subscribing, setSubscribing] = useState(false)
  const [test, setTest] = useState({ running: false, result: null })
  const [note, setNote] = useState(null)
  // Folder → role routing (role-centric: each role has a drillable folder picker)
  const [tree, setTree] = useState({ loading: false, list: [], error: null })
  const [assign, setAssign] = useState({})        // roleKey -> [folderId, ...]
  const [roles, setRoles] = useState([])          // persona role bins
  const [openPicker, setOpenPicker] = useState(null) // roleKey whose dropdown is open
  const [expanded, setExpanded] = useState({})    // folderId -> expanded in picker
  const [foldersOpen, setFoldersOpen] = useState(false)  // Folder → role routing section collapsed by default

  const loadTree = useCallback(async (mailbox) => {
    if (!mailbox) return
    setTree({ loading: true, list: [], error: null })
    // Load the three feeds independently — a failure in one (e.g. roles) must not
    // blank the folder tree.
    const [t, m, p] = await Promise.allSettled([api.mailFolderTree(mailbox), api.mailFolderMapGet(), api.listPersonas()])
    if (m.status === 'fulfilled') {
      const a = {}
      for (const row of (m.value.mappings || [])) (a[row.roleKey] ||= []).push(row.folderId)
      setAssign(a)
    }
    if (p.status === 'fulfilled') setRoles(p.value.personas || p.value.roles || [])
    else setRoles([])
    if (t.status === 'fulfilled' && t.value?.ok) setTree({ loading: false, list: t.value.folders || [], error: null })
    else setTree({ loading: false, list: [], error: String(t.status === 'fulfilled' ? (t.value?.detail || t.value?.error || 'could not list folders') : (t.reason?.message || t.reason)) })
  }, [])

  // Toggle a folder's assignment to a role (add or remove one folder↔role link).
  const toggleAssign = useCallback(async (roleKey, folder) => {
    const has = (assign[roleKey] || []).includes(folder.id)
    // optimistic
    setAssign((a) => {
      const cur = a[roleKey] || []
      return { ...a, [roleKey]: has ? cur.filter((x) => x !== folder.id) : [...cur, folder.id] }
    })
    try {
      if (has) await api.mailFolderMapDelete({ folderId: folder.id, roleKey })
      else await api.mailFolderMapSet({ folderId: folder.id, folderPath: folder.path, roleKey })
    } catch (e) {
      setNote(`Mapping failed: ${e.message || e}`)
      loadTree(cfg?.mailbox) // resync on failure
    }
  }, [assign, cfg?.mailbox, loadTree])

  const loadCfg = useCallback(async () => {
    try { const r = await api.mailConfigGet(); setCfg(r.config); setDirty(false) }
    catch (e) { setCfgErr(String(e.message || e)) }
  }, [])
  const loadSubs = useCallback(async () => {
    setSub((s) => ({ ...s, loading: true }))
    try {
      const res = await api.mailSubscriptions()
      const watches = (res.value || []).filter((w) => (w.notificationUrl || '').includes('/mail/notify'))
      setSub({ loading: false, watches })
    } catch { setSub({ loading: false, watches: [] }) }
  }, [])
  const loadFolders = useCallback(async (mailbox) => {
    if (!mailbox) return
    setFolders({ loading: true, list: [], error: null })
    try {
      const r = await api.mailFolders(mailbox)
      if (!r.ok) throw new Error(r.detail || 'could not list folders')
      setFolders({ loading: false, list: r.folders || [], error: null })
    } catch (e) { setFolders({ loading: false, list: [], error: String(e.message || e) }) }
  }, [])

  useEffect(() => { loadCfg(); loadSubs() }, [loadCfg, loadSubs])
  useEffect(() => { if (cfg?.mailbox) { loadFolders(cfg.mailbox); loadTree(cfg.mailbox) } }, [cfg?.mailbox, loadFolders, loadTree])
  useEffect(() => {
    if (!openPicker) return
    const close = () => setOpenPicker(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openPicker])

  const patch = (p) => { setCfg((c) => ({ ...c, ...p })); setDirty(true) }
  const toggleSender = (key) => {
    const has = (cfg.senders || []).some((s) => s.toLowerCase() === key)
    patch({ senders: has ? cfg.senders.filter((s) => s.toLowerCase() !== key) : [...(cfg.senders || []), key] })
  }
  const save = async () => {
    setSaving(true); setNote(null)
    try {
      const r = await api.mailConfigSet({ mailbox: cfg.mailbox, folder: cfg.folder, folderName: cfg.folderName, senders: cfg.senders, subjectPatterns: cfg.subjectPatterns, enabled: cfg.enabled })
      setCfg(r.config); setDirty(false); setNote('Configuration saved.')
    } catch (e) { setNote(`Save failed: ${e.message || e}`) } finally { setSaving(false) }
  }
  const subscribe = async () => {
    setSubscribing(true); setNote(null)
    try {
      if (dirty) await save()
      const r = await api.mailSubscribe()
      if (r.ok) { setNote(`Now watching ${r.mailbox} · ${r.folder}.`); await loadSubs() }
      else setNote(r.detail || r.hint || 'Subscribe failed.')
    } catch (e) { setNote(`Subscribe failed: ${e.message || e}`) } finally { setSubscribing(false) }
  }
  const runTest = async () => {
    setTest({ running: true, result: null })
    try { if (dirty) await save(); const r = await api.mailSelfTest(); setTest({ running: false, result: r }) }
    catch (e) { setTest({ running: false, result: { error: String(e.message || e), checks: [] } }) }
  }
  const [realTest, setRealTest] = useState({ running: false, result: null })
  const [testSource, setTestSource] = useState('linkedin')
  const sendRealJob = async () => {
    setRealTest({ running: true, result: null })
    try {
      const r = await api.mailSendTestReal({ source: testSource })
      if (r.error) throw new Error(r.error)
      setRealTest({ running: false, result: r })
      // Give the mailbox a moment, then pull it in so the opportunity appears.
      setTimeout(() => { api.mailPollNow(10).catch(() => {}) }, 6000)
    } catch (e) { setRealTest({ running: false, result: { error: String(e.message || e) } }) }
  }

  if (isDemo) return (
    <Card>Sign in with Microsoft to configure your mailbox and intake settings.{' '}
      <span className="px-link" style={{ cursor: 'pointer' }} onClick={() => go('/settings/account')}>Connect account →</span>
    </Card>
  )
  if (cfgErr) return <Card style={{ color: 'var(--proto-red)' }}>Could not load intake config: {cfgErr}</Card>
  if (!cfg) return <Card style={{ color: 'var(--proto-ink2)' }}>Loading intake configuration…</Card>

  const watch = sub.watches[0]
  const watchMailbox = watch ? (watch.resource || '').replace(/^users\//, '').replace(/\/mailFolders.*$/, '') : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: watch ? 'var(--surface-success-default)' : 'var(--proto-ink3)', boxShadow: watch ? '0 0 0 3px var(--surface-success-subtle)' : 'none' }} />
          <b style={{ fontSize: 15 }}>{watch ? `Watching ${watchMailbox}` : sub.loading ? 'Checking watcher…' : 'No active watch'}</b>
          <div style={{ flex: 1 }} />
          <select className="px-btn" value={testSource} onChange={(e) => setTestSource(e.target.value)} style={{ fontFamily: 'inherit' }}>
            <option value="linkedin">LinkedIn style</option>
            <option value="indeed">Indeed style</option>
            <option value="greenhouse">Greenhouse (single)</option>
          </select>
          <button className="px-btn" disabled={realTest.running} onClick={sendRealJob}>{realTest.running ? 'Sending…' : '✉ Send me a test alert'}</button>
          <button className="px-btn" onClick={() => go('/intake')}>View live feed →</button>
        </div>
        <div className="px-small" style={{ marginTop: 8 }}>Emails your watched mailbox a realistic <b>LinkedIn</b> or <b>Indeed</b> job alert (in their typical format) populated with real executive postings — so you can confirm the full intake → parse → opportunity flow on the kind of email you actually get.</div>
        {realTest.result && !realTest.result.error && (
          <div className="px-small" style={{ marginTop: 8, color: 'var(--text-brand)' }}>
            Sent a <b>{realTest.result.source}</b> alert to {realTest.result.to} with {realTest.result.count} role{realTest.result.count === 1 ? '' : 's'} ({(realTest.result.jobs || []).map((j) => j.role).slice(0, 2).join(', ')}…). It'll appear in your pipeline shortly — <span className="px-link" style={{ cursor: 'pointer' }} onClick={() => go('/intake')}>open the live feed</span>.
          </div>
        )}
        {realTest.result?.error && <div className="px-small" style={{ marginTop: 8, color: 'var(--proto-red)' }}>{realTest.result.error}</div>}
        {note && <div className="px-small" style={{ marginTop: 10, color: 'var(--text-brand)' }}>{note}</div>}
      </Card>

      <Card>
        <b style={{ fontSize: 15 }}>Intake — alert source</b>
        <div className="px-small" style={{ marginTop: 2, marginBottom: 14 }}>Choose which mailbox and folder to watch, and which senders count as job alerts.</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <div>
            <Label>Mailbox (M365 address)</Label>
            <input className="px-btn" style={{ width: '100%', fontFamily: 'inherit' }} value={cfg.mailbox}
              onChange={(e) => patch({ mailbox: e.target.value })} onBlur={(e) => loadFolders(e.target.value)} placeholder="name@company.com" />
          </div>
          <div>
            <Label>Folder</Label>
            <select className="px-btn" style={{ width: '100%' }} value={cfg.folder}
              onChange={(e) => { const f = folders.list.find((x) => x.id === e.target.value); patch({ folder: e.target.value, folderName: e.target.value === 'inbox' ? 'Inbox' : (f?.name || e.target.value) }) }}>
              <option value="inbox">Inbox (all incoming)</option>
              {folders.list.filter((f) => (f.name || '').toLowerCase() !== 'inbox').map((f) => (
                <option key={f.id} value={f.id}>{f.name}{typeof f.count === 'number' ? ` (${f.count})` : ''}</option>
              ))}
            </select>
            {folders.loading && <div className="px-small" style={{ marginTop: 4 }}>Loading folders…</div>}
            {folders.error && <div className="px-small" style={{ marginTop: 4, color: 'var(--proto-yellow)' }}>Can't list folders: {folders.error}</div>}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <Label>Alert sources — which senders count as job alerts</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {SOURCE_PRESETS.map((s) => {
              const on = (cfg.senders || []).some((x) => x.toLowerCase() === s.key)
              return (
                <div key={s.key} onClick={() => toggleSender(s.key)}
                  style={{ cursor: 'pointer', padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: on ? 600 : 500,
                    border: `1px solid ${on ? 'var(--surface-brand-default)' : 'var(--proto-rule-soft)'}`,
                    background: on ? 'var(--proto-accent-soft)' : 'transparent', color: on ? 'var(--text-brand)' : 'var(--proto-ink2)' }}>
                  {on ? '✓ ' : ''}{s.label}
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <Label>Subject / body keywords (comma-separated)</Label>
          <input className="px-btn" style={{ width: '100%', fontFamily: 'inherit' }}
            value={(cfg.subjectPatterns || []).join(', ')}
            onChange={(e) => patch({ subjectPatterns: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            placeholder="job alert, is hiring, new jobs" />
          <div className="px-small" style={{ marginTop: 4 }}>A message counts as an alert if the sender matches above <b>or</b> the subject/body contains one of these.</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => patch({ enabled: e.target.checked })} /> Watch enabled
          </label>
          <div style={{ flex: 1 }} />
          <button className="px-btn" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}</button>
          <button className="px-btn px-btn-accent" onClick={subscribe} disabled={subscribing}>{subscribing ? 'Applying…' : 'Save & subscribe'}</button>
        </div>
      </Card>

      <Card>
        <div onClick={() => setFoldersOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <span style={{ color: 'var(--proto-ink3)', transform: foldersOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', display: 'inline-block', width: 12 }}>▸</span>
          <b style={{ fontSize: 15 }}>Folder → role routing</b>
          {!foldersOpen && <span className="px-small" style={{ color: 'var(--proto-ink3)' }}>{roles.length ? `${roles.length} role${roles.length === 1 ? '' : 's'} · tap to configure` : 'tap to configure'}</span>}
        </div>
        {!foldersOpen ? null : (<>
        <div className="px-small" style={{ marginTop: 10, marginBottom: 12 }}>
          Give each role a folder picker. Open it, drill through your Outlook folders, and tick the
          ones whose mail should feed that role — imported <b>even if it fails the keyword filters
          above</b>. Folders you don't assign stay on <b>router decides</b> (imported, AI picks the role).
        </div>
        {tree.loading && <div className="px-small">Loading folders…</div>}
        {tree.error && <div className="px-small" style={{ color: 'var(--proto-yellow)' }}>Can't list folders: {tree.error}</div>}
        {roles.length === 0 && !tree.loading && (
          <div className="px-small" style={{ color: 'var(--proto-ink2)' }}>
            No role bins yet — <span className="px-link" style={{ cursor: 'pointer' }} onClick={() => go('/settings/roles')}>create roles</span> first, then assign folders to them here.
          </div>
        )}
        {roles.length > 0 && (() => {
          const byId = Object.fromEntries(tree.list.map((f) => [f.id, f]))
          const pickable = tree.list.filter((f) => (f.name || '').toLowerCase() !== 'inbox')
          const visible = visibleFolders(pickable, expanded)
          return (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {roles.map((role, i) => {
                const color = ROLE_COLORS[i % ROLE_COLORS.length]
                const fids = assign[role.key] || []
                const label = role.name || role.master_role || role.key
                return (
                  <div key={role.key} style={{ padding: '12px 2px', borderTop: i ? '1px solid var(--proto-rule-soft)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 11, height: 11, borderRadius: '50%', background: color, flex: 'none' }} />
                      <b style={{ fontSize: 14.5 }}>{label}</b>
                      <div style={{ marginLeft: 'auto', position: 'relative' }}>
                        <button className="px-btn" onClick={(e) => { e.stopPropagation(); setOpenPicker(openPicker === role.key ? null : role.key) }}>
                          📁 Assign folders <span style={{ opacity: 0.6 }}>({fids.length})</span> ▾
                        </button>
                        {openPicker === role.key && (
                          <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 300, maxWidth: '80vw', background: 'var(--proto-paper)', border: '1px solid var(--proto-rule-soft)', borderRadius: 12, boxShadow: '0 10px 30px -12px rgba(0,0,0,.35)', zIndex: 30, maxHeight: 320, overflow: 'auto', padding: 6 }}>
                            <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--proto-ink3)', padding: '6px 8px 4px' }}>Pick folders for {label}</div>
                            {visible.length === 0 && <div className="px-small" style={{ padding: '6px 8px', color: 'var(--proto-ink2)' }}>No folders found. Create folders in Outlook, then reload.</div>}
                            {visible.map((f) => {
                              const kids = (f.childCount || 0) > 0
                              const on = fids.includes(f.id)
                              return (
                                <div key={f.id} onClick={() => toggleAssign(role.key, f)}
                                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', paddingLeft: 8 + (f.level || 0) * 16, borderRadius: 8, cursor: 'pointer' }}>
                                  <span onClick={(e) => { if (kids) { e.stopPropagation(); setExpanded((x) => ({ ...x, [f.id]: !x[f.id] })) } }}
                                    style={{ width: 16, textAlign: 'center', color: 'var(--proto-ink3)', fontSize: 10, flex: 'none' }}>
                                    {kids ? (expanded[f.id] ? '▾' : '▶') : ''}
                                  </span>
                                  <span style={{ flex: 'none' }}>{kids ? '📁' : '📄'}</span>
                                  <span style={{ fontSize: 13, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                                  {typeof f.count === 'number' && <span className="px-small" style={{ color: 'var(--proto-ink3)' }}>{f.count}</span>}
                                  <span style={{ width: 17, height: 17, borderRadius: 5, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', border: `1.5px solid ${on ? color : 'var(--proto-rule-soft)'}`, background: on ? color : 'transparent' }}>{on ? '✓' : ''}</span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    {fids.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9, marginLeft: 21 }}>
                        {fids.map((fid) => {
                          const f = byId[fid]
                          if (!f) return null
                          const parentPath = (f.path || '').includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) + ' / ' : ''
                          return (
                            <span key={fid} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 999, color, background: `${color}18`, border: `1px solid ${color}` }}>
                              <span style={{ opacity: 0.6, fontWeight: 500 }}>{parentPath}</span>{f.name}
                              <span style={{ cursor: 'pointer', opacity: 0.6, fontWeight: 800 }} onClick={() => toggleAssign(role.key, f)}>×</span>
                            </span>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="px-small" style={{ marginTop: 8, marginLeft: 21, color: 'var(--proto-ink3)' }}>No folders yet — <b style={{ color: 'var(--proto-ink2)' }}>router decides</b> handles this role.</div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}
        <div className="px-small" style={{ marginTop: 12, color: 'var(--proto-ink3)' }}>
          Saved as you change them. A role can pull from several folders; a folder can feed more than
          one role. Routing takes effect once the mailbox-wide watch is live.
        </div>
        </>)}
      </Card>

      <SweepSettings />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 15 }}>Self-test</b>
          <span className="px-small">confirm the watch is wired correctly</span>
          <div style={{ flex: 1 }} />
          {test.result && !test.result.error && <Pill tone={test.result.ok ? 'green' : 'yellow'}>{test.result.passed}/{test.result.total} passing</Pill>}
          <button className="px-btn px-btn-accent" onClick={runTest} disabled={test.running}>{test.running ? 'Running…' : 'Run tests'}</button>
        </div>
        {test.result?.error && <div className="px-small" style={{ marginTop: 10, color: 'var(--proto-red)' }}>{test.result.error}</div>}
        {test.result?.checks?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            {test.result.checks.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 10px', borderRadius: 8 }}>
                <span style={{ color: c.pass ? 'var(--surface-success-default)' : 'var(--surface-error-default)', fontWeight: 700, width: 16 }}>{c.pass ? '✓' : '✕'}</span>
                <span style={{ fontWeight: 600, minWidth: 170 }}>{c.name}</span>
                <span className="px-small" style={{ color: 'var(--proto-ink2)', wordBreak: 'break-word' }}>{c.detail}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

const money = (n) => `$${Number(n || 0).toFixed(Number(n) < 1 ? 4 : 2)}`

function UsageSettings() {
  const [u, setU] = useState({ loading: true, data: null, error: null })
  const load = useCallback(async () => {
    setU((s) => ({ ...s, loading: true }))
    try { const d = await api.usageSummary(); if (d.error) throw new Error(d.error); setU({ loading: false, data: d, error: null }) }
    catch (e) { setU({ loading: false, data: null, error: String(e.message || e) }) }
  }, [])
  useEffect(() => { load() }, [load])

  if (u.loading) return <Card style={{ color: 'var(--proto-ink2)' }}>Loading usage…</Card>
  if (u.error) return <Card style={{ color: 'var(--proto-red)' }}>Couldn't load usage: {u.error}</Card>
  const d = u.data
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <b style={{ fontSize: 15 }}>AI spend</b>
          <div style={{ flex: 1 }} />
          <button className="px-btn" onClick={load}>↻ Refresh</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 14 }}>
          <div><div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Total cost</div><div style={{ fontSize: 30, fontWeight: 700 }}>{money(d.total.costUsd)}</div></div>
          <div><div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Calls</div><div style={{ fontSize: 30, fontWeight: 700 }}>{d.total.calls}</div></div>
          <div><div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Tokens</div><div style={{ fontSize: 30, fontWeight: 700 }}>{d.total.tokens.toLocaleString()}</div></div>
        </div>
      </Card>

      <Card>
        <b style={{ fontSize: 14 }}>By feature</b>
        {d.byFeature.length === 0 && <div className="px-small" style={{ marginTop: 8 }}>No metered calls yet.</div>}
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {d.byFeature.map((f) => (
            <div key={f.feature} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 13 }}>
              <span style={{ fontWeight: 600, minWidth: 160 }}>{f.feature}</span>
              <span className="px-small">{f.calls} call{f.calls === 1 ? '' : 's'}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(f.costUsd)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <b style={{ fontSize: 14 }}>By model</b>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {d.byModel.map((m) => (
            <div key={m.model} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 13 }}>
              <span style={{ fontWeight: 600, minWidth: 200 }}>{m.model}</span>
              <span className="px-small">{m.calls}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(m.costUsd)}</span>
            </div>
          ))}
        </div>
      </Card>

      {d.recent.length > 0 && (
        <Card>
          <b style={{ fontSize: 14 }}>Recent calls</b>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {d.recent.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12, color: 'var(--proto-ink2)' }}>
                <span style={{ fontWeight: 600, minWidth: 150, color: 'var(--proto-ink)' }}>{r.feature || '—'}</span>
                <span>{r.model}</span>
                <span>{(r.promptTokens || 0) + (r.completionTokens || 0)} tok</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.costUsd)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function AccountSettings() {
  const { auth, owner, signIn, signOut, providerReady } = useApp()
  const user = auth?.user
  const [err, setErr] = useState(null)
  const doSignIn = async (p) => { setErr(null); try { await signIn(p) } catch (e) { setErr(String(e.message || e)) } }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <b style={{ fontSize: 15 }}>Account</b>
        {auth?.loading ? (
          <div className="px-small" style={{ marginTop: 10 }}>Checking sign-in…</div>
        ) : user ? (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Pill tone="green">Signed in</Pill>
              <span style={{ fontWeight: 600 }}>{user.email}</span>
              <span className="px-small">via {user.provider}</span>
            </div>
            <div className="px-small">Your opportunities, packets and outreach are scoped to this account.</div>
            <button className="px-btn" style={{ alignSelf: 'flex-start' }} onClick={signOut}>Sign out</button>
          </div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Pill tone="yellow">Shared demo mode</Pill>
              <span className="px-small">workspace: {owner}</span>
            </div>
            <div className="px-small">Connect the email account you get job alerts on — the same identity that powers your inbox watcher and gives you a private workspace.</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="px-btn px-btn-accent" disabled={!providerReady?.microsoft} onClick={() => doSignIn('microsoft')}
                title={providerReady?.microsoft ? '' : 'VITE_MS_CLIENT_ID not configured on this deploy'}>Connect Microsoft</button>
              <button className="px-btn" disabled={!providerReady?.google} onClick={() => doSignIn('google')}
                title={providerReady?.google ? '' : 'VITE_GOOGLE_CLIENT_ID not configured on this deploy'}>Connect Google</button>
            </div>
            {!providerReady?.microsoft && !providerReady?.google && (
              <div className="px-small" style={{ color: 'var(--proto-yellow)' }}>Sign-in providers aren't configured on this build yet (needs the Entra app + build-time client IDs).</div>
            )}
            {err && <div className="px-small" style={{ color: 'var(--proto-red)' }}>{err}</div>}
          </div>
        )}
      </Card>
    </div>
  )
}

function WorkspaceSettings() {
  const { showDemo, setShowDemo } = useApp()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <b style={{ fontSize: 15 }}>Sample data</b>
        <div className="px-small" style={{ marginTop: 2, marginBottom: 14 }}>The workspace ships with sample opportunities, packets, and outreach so the app isn't empty. Turn this off to see only your real, ingested data.</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
          <input type="checkbox" checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} />
          Show sample / demo data
        </label>
        <div className="px-small" style={{ marginTop: 10, color: 'var(--proto-ink2)' }}>
          {showDemo ? 'Sample data is visible across Today, Opportunities, Pipeline, Packets, and Outreach.' : 'Only your real data is shown. Sample rows are hidden (not deleted) — turn this back on any time.'}
        </div>
      </Card>
    </div>
  )
}

// ATS job-board sources (Greenhouse / Lever / Ashby) — configurable, like the
// mail watcher. Adds a broader discovery layer beyond email alerts.
function AtsSources() {
  const [sources, setSources] = useState(null)
  const [provider, setProvider] = useState('greenhouse')
  const [board, setBoard] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => { try { const r = await api.atsSources(); setSources(r.sources || []) } catch (e) { setMsg(String(e.message || e)) } }, [])
  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!board.trim()) return
    setBusy(true); setMsg('')
    try { const p = await api.atsPreview(provider, board.trim()); if (p.error) throw new Error(p.error)
      const r = await api.atsSourceAdd(provider, board.trim()); if (r.error) throw new Error(r.error)
      setMsg(`Added — ${p.execRoles} exec roles of ${p.total} on this board`); setBoard(''); load() }
    catch (e) { setMsg(`Couldn't add: ${e.message || e}`) } finally { setBusy(false) }
  }
  const del = async (id) => { try { await api.atsSourceDelete(id); load() } catch {} }
  const ingest = async (s) => {
    setBusy(true); setMsg('')
    try { const r = s ? await api.atsIngest({ provider: s.provider, board: s.board }) : await api.atsIngest({})
      if (r.error) throw new Error(r.error); setMsg(`Ingested: ${r.inserted} new, ${r.duplicates} duplicates (${r.scanned} scanned)`) }
    catch (e) { setMsg(`Ingest failed: ${e.message || e}`) } finally { setBusy(false) }
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <b style={{ fontSize: 15 }}>ATS job boards</b>
        <span className="px-small">Greenhouse · Lever · Ashby — pull exec roles beyond email alerts</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="px-input" value={provider} onChange={(e) => setProvider(e.target.value)} style={{ fontSize: 13 }}>
          {['greenhouse', 'lever', 'ashby'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input className="px-input" value={board} onChange={(e) => setBoard(e.target.value)} placeholder="board token (e.g. stripe, netflix)" style={{ flex: 1, minWidth: 160, fontSize: 13 }} />
        <button className="px-btn px-btn-accent" disabled={busy || !board.trim()} onClick={add} style={{ fontSize: 12 }}>{busy ? '…' : 'Add + preview'}</button>
      </div>
      {sources && sources.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sources.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <Pill tone="panel">{s.provider}</Pill>
              <span style={{ flex: 1 }}>{s.board}</span>
              {s.last_run && <span className="px-small">ran {new Date(s.last_run).toLocaleDateString()}</span>}
              <button className="px-btn" style={{ fontSize: 11 }} disabled={busy} onClick={() => ingest(s)}>Ingest</button>
              <span className="px-link" style={{ fontSize: 12, cursor: 'pointer', color: 'var(--proto-red)' }} onClick={() => del(s.id)}>✕</span>
            </div>
          ))}
          <button className="px-btn px-btn-accent" style={{ fontSize: 12, alignSelf: 'flex-start', marginTop: 6 }} disabled={busy} onClick={() => ingest(null)}>Ingest all sources now</button>
        </div>
      )}
      {msg && <div className="px-small" style={{ marginTop: 10 }}>{msg}</div>}
    </Card>
  )
}

// Coach — the AI coach's system prompt, model, memory, and file store. This is
// the "see everything" surface: the exact prompt the agent runs on, editable.
function CoachSettings() {
  const { isDemo } = useApp()
  const [cfg, setCfg] = useState(null)
  const [cfgErr, setCfgErr] = useState(null)
  const [status, setStatus] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([api.coachConfigGet(), api.coachStatus()])
      setCfg(c); setStatus(s); setPrompt(c.systemPrompt || ''); setModel(c.model || '')
    } catch (e) { setCfgErr(String(e.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setBusy(true); setMsg('')
    try { const r = await api.coachConfigSet({ systemPrompt: prompt, model }); if (r.error) throw new Error(r.error); setCfg(r); setMsg('Saved — the coach now runs on this prompt.') }
    catch (e) { setMsg(String(e.message || e)) } finally { setBusy(false) }
  }
  const reset = async () => {
    setBusy(true); setMsg('')
    try { const r = await api.coachConfigSet({ reset: true }); if (r.error) throw new Error(r.error); setCfg(r); setPrompt(r.systemPrompt || ''); setModel(r.model || ''); setMsg('Reset to the built-in default prompt.') }
    catch (e) { setMsg(String(e.message || e)) } finally { setBusy(false) }
  }
  const provision = async () => {
    setBusy(true); setMsg('')
    try { const r = await api.coachProvision(); if (r.error) throw new Error(r.error); setMsg(r.created ? `File store created (${r.vectorStoreId}).` : `File store already attached (${r.vectorStoreId}).`); load() }
    catch (e) { setMsg(String(e.message || e)) } finally { setBusy(false) }
  }

  if (isDemo) return (
    <Card>Sign in to configure the AI coach.{' '}
      <span className="px-link" style={{ cursor: 'pointer' }} onClick={() => go('/settings/account')}>Connect account →</span>
    </Card>
  )
  if (cfgErr) return <Card style={{ color: 'var(--proto-red)' }}>Couldn't load coach config: {cfgErr}</Card>
  if (!cfg) return <Card style={{ color: 'var(--proto-ink2)' }}>Loading coach configuration…</Card>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <b style={{ fontSize: 15 }}>How the coach remembers you</b>
        <div className="px-small" style={{ marginTop: 6, lineHeight: 1.6 }}>
          Durable memory (preferences, decisions, feedback) is embedded and stored in <b>your own Azure Postgres</b> — pgvector tables <code>coach_memory</code> + <code>coach_triples</code>. Because it lives in your database and not an AI vendor's account, it is <b>vendor-portable</b>: swap OpenAI for another model and every memory persists. The OpenAI file store below is a separate, rebuildable place for uploaded reference documents only.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 12 }}>
          {status && <>
            <S label="Model" v={status.model} />
            <S label="Memory DB" v={status.memoryReady ? 'connected' : 'unavailable'} ok={status.memoryReady} />
            <S label="Web search" v={status.tavily ? 'Tavily on' : 'off'} ok={status.tavily} />
            <S label="File store" v={status.vectorStoreId || 'none'} ok={!!status.vectorStoreId} />
          </>}
        </div>
        {!status?.vectorStoreId && <button className="px-btn" disabled={busy} style={{ marginTop: 12, fontSize: 12 }} onClick={provision}>Create file store</button>}
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <b style={{ fontSize: 15 }}>System prompt</b>
          <span className="px-small">{cfg.custom ? 'customized' : 'built-in default'}</span>
        </div>
        <div className="px-small" style={{ marginTop: 4, marginBottom: 8 }}>This is the exact instruction set the coach runs on (including its 12-stage playbook). At send time it also appends any of your saved memory relevant to that message. Edit to change its behavior, knowledge, or tone.</div>
        <textarea className="px-input" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={16}
          style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.5, resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <Label>Model</Label>
          <input className="px-input" value={model} onChange={(e) => setModel(e.target.value)} style={{ width: 180, fontSize: 13 }} placeholder="gpt-4o" />
          <div style={{ flex: 1 }} />
          <button className="px-btn" disabled={busy} onClick={reset} style={{ fontSize: 12 }}>Reset to default</button>
          <button className="px-btn px-btn-accent" disabled={busy || !prompt.trim()} onClick={save}>{busy ? 'Saving…' : 'Save prompt'}</button>
        </div>
        {msg && <div className="px-small" style={{ marginTop: 10 }}>{msg}</div>}
      </Card>
    </div>
  )
}
const S = ({ label, v, ok }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>{label}</span>
    <span style={{ fontSize: 13, fontWeight: 600, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', color: ok === false ? 'var(--proto-red)' : ok === true ? 'var(--proto-green)' : 'var(--proto-ink)' }}>{v}</span>
  </div>
)

// System — live health + one-click smoke test (reliability/ops surface).
function SystemSettings() {
  const [h, setH] = useState(null)
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.appHealth().then(setH).catch((e) => setH({ error: String(e) })) }, [])
  const runSelftest = async () => { setBusy(true); try { setSt(await api.appSelftest()) } catch (e) { setSt({ error: String(e) }) } finally { setBusy(false) } }
  const row = (k, v, ok) => (
    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
      <span>{k}</span><span style={{ fontWeight: 600, color: ok === false ? 'var(--proto-red)' : ok ? 'var(--proto-green)' : 'var(--proto-ink)' }}>{v}</span>
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <b style={{ fontSize: 15 }}>Health</b>
        <div className="px-small" style={{ marginTop: 2, marginBottom: 10 }}>Live readiness of the API and its integrations.</div>
        {!h ? <div className="px-small">Checking…</div> : h.error ? <div className="px-small" style={{ color: 'var(--proto-red)' }}>{h.error}</div> : (
          <div>
            {row('Database', h.checks?.db?.ok ? `connected (${h.checks.db.ms}ms)` : 'unavailable', h.checks?.db?.ok)}
            {row('OpenAI', h.checks?.openai?.ok ? 'configured' : 'missing', h.checks?.openai?.ok)}
            {row('Microsoft Graph', h.checks?.graph?.ok ? 'configured' : 'missing', h.checks?.graph?.ok)}
            {row('Google (Drive)', h.checks?.google?.ok ? 'configured' : 'missing', h.checks?.google?.ok)}
            {row('Storage', h.checks?.storage?.ok ? 'configured' : 'missing', h.checks?.storage?.ok)}
            {row('Web search', h.checks?.tavily?.ok ? 'configured' : 'off', h.checks?.tavily?.ok)}
            {row('Session signing', h.checks?.session?.ok ? 'configured' : 'insecure default', h.checks?.session?.ok)}
          </div>
        )}
      </Card>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <b style={{ fontSize: 15, flex: 1 }}>Smoke test</b>
          <button className="px-btn px-btn-accent" disabled={busy} onClick={runSelftest} style={{ fontSize: 12 }}>{busy ? 'Running…' : 'Run self-test'}</button>
        </div>
        <div className="px-small" style={{ marginTop: 2 }}>Hits the key endpoints and reports pass/fail.</div>
        {st && !st.error && (
          <div style={{ marginTop: 10 }}>
            <div className="px-small" style={{ marginBottom: 6 }}>{st.passed}/{st.total} passed</div>
            {(st.checks || []).map((c) => row(c.name, `${c.ok ? '✓' : '✕'} ${c.ms}ms`, c.ok))}
          </div>
        )}
        {st?.error && <div className="px-small" style={{ color: 'var(--proto-red)', marginTop: 8 }}>{st.error}</div>}
      </Card>
    </div>
  )
}

// Roles — target role groups for AI tagging of ingested opportunities.
// Each role becomes a tag (roles_for[]) on every opportunity; all opps remain
// visible — this is grouping/filtering aid, not a hard filter.
function RolesSettings() {
  const [roles, setRoles] = useState(null)
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newName, setNewName] = useState('')
  const [msg, setMsg] = useState('')
  const [editKey, setEditKey] = useState(null)
  const [editName, setEditName] = useState('')
  const [tagging, setTagging] = useState(false)

  const load = useCallback(async () => {
    try { const r = await api.listPersonas(); setRoles(r.personas || []) }
    catch { setRoles([]) }
  }, [])
  useEffect(() => { load() }, [load])

  const create = useCallback(async () => {
    if (!newKey || !newName) return
    try {
      await api.createPersona({ key: newKey.toUpperCase(), name: newName })
      setNewKey(''); setNewName(''); setAdding(false); setMsg('Role added.')
      load()
    } catch (e) { setMsg(String(e.message || e)) }
  }, [newKey, newName, load])

  const save = useCallback(async (key) => {
    try { await api.updatePersona(key, { name: editName }); setEditKey(null); setMsg('Role updated.'); load() }
    catch (e) { setMsg(String(e.message || e)) }
  }, [editName, load])

  const remove = useCallback(async (key, name) => {
    if (!window.confirm(`Remove "${name}"? Opportunities tagged with this role will lose the tag.`)) return
    try { await api.deletePersona(key); setMsg('Role removed.'); load() }
    catch (e) { setMsg(String(e.message || e)) }
  }, [load])

  const tagAll = useCallback(async () => {
    setTagging(true); setMsg('')
    try {
      const r = await api.tagAllRoles()
      if (r.error) throw new Error(r.error)
      setMsg(r.message || `Tagged ${r.tagged} opportunities.`)
      load()
    } catch (e) { setMsg(String(e.message || e)) }
    finally { setTagging(false) }
  }, [load])

  if (!roles) return <Card style={{ color: 'var(--proto-ink2)' }}>Loading roles…</Card>
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <b style={{ fontSize: 15, flex: 1 }}>Target roles</b>
        <button className="px-btn" onClick={tagAll} disabled={tagging} title="Re-classify all untagged opportunities against these roles using AI">{tagging ? 'Tagging...' : 'Re-tag all'}</button>
        <button className="px-btn px-btn-accent" onClick={() => { setAdding(true); setMsg('') }}>+ Add role</button>
      </div>
      <div className="px-small" style={{ color: 'var(--proto-ink2)', marginBottom: 12 }}>
        When a new opportunity is ingested, the AI classifies it against these roles and tags it accordingly.
        Opportunities with no match are tagged "Other" — all remain visible everywhere.
      </div>
      {msg && <div className="px-small" style={{ marginBottom: 8, color: 'var(--proto-ink2)' }}>{msg}</div>}
      {adding && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input className="px-input" placeholder="Key (e.g. CTO)" value={newKey} onChange={(e) => setNewKey(e.target.value.toUpperCase())} style={{ width: 90 }} />
          <input className="px-input" placeholder="Label (e.g. Chief Technology Officer)" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <button className="px-btn px-btn-accent" onClick={create}>Save</button>
          <button className="px-btn" onClick={() => { setAdding(false); setNewKey(''); setNewName('') }}>Cancel</button>
        </div>
      )}
      {roles.length === 0 && !adding && (
        <div className="px-small" style={{ color: 'var(--proto-ink2)' }}>No target roles yet. Add one to start grouping your opportunities.</div>
      )}
      {roles.map((r) => (
        <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--proto-rule-soft)' }}>
          <span style={{ fontWeight: 600, fontSize: 12, background: 'var(--proto-accent-soft)', color: 'var(--text-brand)', padding: '2px 8px', borderRadius: 999 }}>{r.key}</span>
          {editKey === r.key
            ? <input className="px-input" value={editName} onChange={(e) => setEditName(e.target.value)} style={{ flex: 1 }} />
            : <span style={{ flex: 1 }}>{r.name}</span>}
          {r.opportunities > 0 && <span className="px-small" style={{ color: 'var(--proto-ink2)' }}>{r.opportunities} opp{r.opportunities === 1 ? '' : 's'}</span>}
          {editKey === r.key
            ? <><button className="px-btn px-btn-accent" onClick={() => save(r.key)}>Save</button><button className="px-btn" onClick={() => setEditKey(null)}>Cancel</button></>
            : <><button className="px-btn" onClick={() => { setEditKey(r.key); setEditName(r.name) }}>Edit</button><button className="px-btn" style={{ color: 'var(--proto-red)' }} onClick={() => remove(r.key, r.name)}>Remove</button></>}
        </div>
      ))}
    </Card>
  )
}

// Templates — reusable text/creative assets grouped into 8 fixed categories.
// Category rail + template cards for the selected category. Real data only:
// an owner with no templates sees empty categories (no fake cards).
const TEMPLATE_CATEGORIES = {
  resume: 'Resume',
  cover: 'Cover letter',
  recruiter: 'Recruiter outreach',
  hm: 'Hiring manager',
  linkedin: 'LinkedIn',
  thankyou: 'Thank-you',
  portfolio: 'Portfolio',
  video: 'Video script',
}
const CATEGORY_ORDER = ['resume', 'cover', 'recruiter', 'hm', 'linkedin', 'thankyou', 'portfolio', 'video']
const catLabel = (k) => TEMPLATE_CATEGORIES[k] || k

function TemplatesSettings() {
  const { isDemo } = useApp()
  const [state, setState] = useState({ loading: true, templates: [], categories: [], error: null })
  const [cat, setCat] = useState('resume')
  const [editing, setEditing] = useState(null) // null = list; {} = new; template = edit
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const r = await api.templatesList()
      if (r.error) throw new Error(r.error)
      setState({ loading: false, templates: r.templates || [], categories: r.categories || [], error: null })
    } catch (e) { setState({ loading: false, templates: [], categories: [], error: String(e.message || e) }) }
  }, [])
  useEffect(() => { load() }, [load])

  const countFor = useCallback((key) => {
    const c = (state.categories || []).find((x) => x.key === key)
    if (c && typeof c.count === 'number') return c.count
    return state.templates.filter((t) => t.category === key).length
  }, [state])

  const save = async (form) => {
    setBusy(true); setMsg('')
    try {
      const r = await api.templateSave(form)
      if (r.error) throw new Error(r.error)
      setEditing(null); setMsg('Template saved.'); await load()
    } catch (e) { setMsg(String(e.message || e)) } finally { setBusy(false) }
  }
  const del = async (t) => {
    if (!window.confirm(`Delete "${t.name}"?`)) return
    setBusy(true); setMsg('')
    try { await api.templateDelete(t.id); if (editing?.id === t.id) setEditing(null); setMsg('Template deleted.'); await load() }
    catch (e) { setMsg(String(e.message || e)) } finally { setBusy(false) }
  }
  const setPrimary = async (t) => {
    setBusy(true); setMsg('')
    try { const r = await api.templateSave({ id: t.id, category: t.category, name: t.name, body: t.body, isPrimary: true }); if (r.error) throw new Error(r.error); await load() }
    catch (e) { setMsg(String(e.message || e)) } finally { setBusy(false) }
  }

  if (isDemo) return (
    <Card>Sign in to manage your templates.{' '}
      <span className="px-link" style={{ cursor: 'pointer' }} onClick={() => go('/settings/account')}>Connect account →</span>
    </Card>
  )
  if (state.loading) return <Card style={{ color: 'var(--proto-ink2)' }}>Loading templates…</Card>
  if (state.error) return <Card style={{ color: 'var(--proto-red)' }}>Couldn't load templates: {state.error}</Card>

  const cards = state.templates.filter((t) => t.category === cat)

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* Category rail */}
      <Card style={{ width: 220, flex: 'none', padding: 8 }}>
        <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--proto-ink3)', padding: '8px 10px 6px' }}>Categories</div>
        {CATEGORY_ORDER.map((key) => {
          const on = cat === key
          const n = countFor(key)
          return (
            <div key={key} onClick={() => { setCat(key); setEditing(null) }}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 8, fontSize: 13.5, fontWeight: on ? 600 : 500,
                background: on ? 'var(--proto-accent-soft)' : 'transparent', color: on ? 'var(--text-brand)' : 'var(--proto-ink)' }}>
              <span style={{ flex: 1 }}>{catLabel(key)}</span>
              <span className="px-small" style={{ color: on ? 'var(--text-brand)' : 'var(--proto-ink3)', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
            </div>
          )
        })}
      </Card>

      {/* Templates for the selected category */}
      <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 16 }}>{catLabel(cat)}</b>
          <span className="px-small">{cards.length} template{cards.length === 1 ? '' : 's'}</span>
          <div style={{ flex: 1 }} />
          {!editing && <button className="px-btn px-btn-accent" onClick={() => setEditing({ category: cat })}>+ New</button>}
        </div>
        {msg && <div className="px-small" style={{ color: 'var(--proto-ink2)' }}>{msg}</div>}

        {editing ? (
          <TemplateForm key={editing.id || 'new'} initial={editing} busy={busy} onCancel={() => setEditing(null)} onSave={save} />
        ) : cards.length === 0 ? (
          <Card style={{ color: 'var(--proto-ink2)', textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--proto-ink)' }}>No {catLabel(cat).toLowerCase()} templates yet</div>
            <div className="px-small" style={{ marginTop: 6 }}>Create one to reuse it across your applications.</div>
            <button className="px-btn px-btn-accent" style={{ marginTop: 14 }} onClick={() => setEditing({ category: cat })}>+ New template</button>
          </Card>
        ) : (
          cards.map((t) => (
            <Card key={t.id} style={{ cursor: 'pointer', padding: 14 }} onClick={() => setEditing(t)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 14.5 }}>{t.name}</b>
                <Pill tone={t.isPrimary ? 'green' : 'panel'}>{t.isPrimary ? 'Primary' : 'Variant'}</Pill>
                <div style={{ flex: 1 }} />
                <span className="px-small" style={{ color: 'var(--proto-ink3)' }}>used {t.usageCount || 0}×</span>
                {t.replyRate != null && <span className="px-small" style={{ color: 'var(--proto-ink3)' }}>· {Math.round(t.replyRate * 100)}% reply</span>}
              </div>
              {t.body && <div className="px-small" style={{ marginTop: 8, color: 'var(--proto-ink2)', whiteSpace: 'pre-wrap', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{t.body}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                {!t.isPrimary && <button className="px-btn" style={{ fontSize: 12 }} disabled={busy} onClick={() => setPrimary(t)}>Set primary</button>}
                <button className="px-btn" style={{ fontSize: 12 }} onClick={() => setEditing(t)}>Edit</button>
                <button className="px-btn" style={{ fontSize: 12, color: 'var(--proto-red)' }} disabled={busy} onClick={() => del(t)}>Delete</button>
                {t.updatedAt && <span className="px-small" style={{ marginLeft: 'auto', alignSelf: 'center', color: 'var(--proto-ink3)' }}>{new Date(t.updatedAt).toLocaleDateString()}</span>}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}

function TemplateForm({ initial, busy, onCancel, onSave }) {
  const [category, setCategory] = useState(initial.category || 'resume')
  const [name, setName] = useState(initial.name || '')
  const [body, setBody] = useState(initial.body || '')
  const [isPrimary, setIsPrimary] = useState(!!initial.isPrimary)
  const submit = () => {
    if (!name.trim() || !body.trim()) return
    onSave({ id: initial.id, category, name: name.trim(), body, isPrimary })
  }
  return (
    <Card>
      <b style={{ fontSize: 15 }}>{initial.id ? 'Edit template' : 'New template'}</b>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 12 }}>
        <div>
          <Label>Category</Label>
          <select className="px-btn" style={{ width: '100%' }} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORY_ORDER.map((k) => <option key={k} value={k}>{catLabel(k)}</option>)}
          </select>
        </div>
        <div>
          <Label>Name</Label>
          <input className="px-btn" style={{ width: '100%', fontFamily: 'inherit' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VP Eng — warm intro" />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <Label>Body</Label>
        <textarea className="px-input" value={body} onChange={(e) => setBody(e.target.value)} rows={12}
          style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12.5, lineHeight: 1.5, resize: 'vertical' }} placeholder="Template text…" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} /> Primary for this category
        </label>
        <div style={{ flex: 1 }} />
        <button className="px-btn" onClick={onCancel}>Cancel</button>
        <button className="px-btn px-btn-accent" disabled={busy || !name.trim() || !body.trim()} onClick={submit}>{busy ? 'Saving…' : 'Save template'}</button>
      </div>
    </Card>
  )
}

// ACT-32/33 — target locations (metros) + remote-optional preference. The metro list + counts are
// derived from the owner's real opportunities (each opp carries metroName/metroGeoId from the geo
// master); the selection persists via /app/search-prefs and filters Swipe/Opportunities and (ACT-34)
// the scheduled search. No fabricated location list — only metros actually present in the pipeline.
function LocationSettings() {
  const { toast } = useApp()
  const [state, setState] = useState({ loading: true, metros: [], error: null })
  const [selected, setSelected] = useState(() => new Set())
  const [remoteOnly, setRemoteOnly] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([api.listOpportunities(), api.searchPrefsGet()])
      .then(([opps, prefs]) => {
        if (!alive) return
        const list = Array.isArray(opps) ? opps : (opps?.opportunities || [])
        const by = new Map()
        for (const o of list) {
          if (o.dismissed) continue
          const gid = o.metroGeoId || `name:${o.metroName || 'Unrecognized'}`
          const cur = by.get(gid) || { geoId: o.metroGeoId || null, name: o.metroName || 'Unrecognized location', count: 0 }
          cur.count += 1; by.set(gid, cur)
        }
        const metros = [...by.values()].filter((m) => m.geoId).sort((a, b) => b.count - a.count)
        setState({ loading: false, metros, error: null })
        setSelected(new Set(prefs?.targetGeoIds || []))
        setRemoteOnly(!!prefs?.remoteOnly)
      })
      .catch((e) => { if (alive) setState({ loading: false, metros: [], error: String(e.message || e) }) })
    return () => { alive = false }
  }, [])

  const toggle = (geoId) => setSelected((s) => { const n = new Set(s); n.has(geoId) ? n.delete(geoId) : n.add(geoId); return n })
  const save = useCallback(async () => {
    setSaving(true)
    try {
      const res = await api.searchPrefsSet({ targetGeoIds: [...selected], remoteOnly })
      if (res.ok === false) throw new Error(res.detail || res.error || 'failed')
      toast('Target locations saved')
    } catch (e) { toast(`Save failed: ${e.message || e}`) } finally { setSaving(false) }
  }, [selected, remoteOnly, toast])

  return (
    <Card>
      <Label>Target locations</Label>
      <div className="px-small" style={{ marginBottom: 10 }}>Pick the metros you'll consider. Selected metros filter Swipe & Opportunities and steer the daily search. Counts are your current opportunities per metro.</div>
      {state.loading && <div className="px-small">Loading locations…</div>}
      {state.error && <div className="px-small" style={{ color: 'var(--proto-red)' }}>{state.error}</div>}
      {!state.loading && !state.error && state.metros.length === 0 && <div className="px-small">No recognized metros in your pipeline yet.</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {state.metros.map((m) => {
          const on = selected.has(m.geoId)
          return (
            <span key={m.geoId} onClick={() => toggle(m.geoId)} className="px-pill"
              style={{ cursor: 'pointer', background: on ? 'var(--surface-brand-default)' : undefined, color: on ? 'var(--text-on-brand)' : undefined }}>
              {on ? '✓ ' : ''}{m.name} · {m.count}
            </span>
          )
        })}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, cursor: 'pointer', fontSize: 13 }}>
        <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} />
        Remote plus: also keep remote-anywhere roles, on top of my selected metros (uncheck to show only the metros above)
      </label>
      <div style={{ marginTop: 14 }}>
        <button className="px-btn px-btn-accent" onClick={save} disabled={saving || state.loading}>{saving ? 'Saving…' : 'Save target locations'}</button>
        {selected.size === 0 && <span className="px-small" style={{ marginLeft: 10 }}>None selected = no location filter (all metros shown).</span>}
      </div>
    </Card>
  )
}

const SECTIONS = [{ key: 'account', label: 'Account' }, { key: 'intake', label: 'Intake' }, { key: 'roles', label: 'Roles' }, { key: 'locations', label: 'Locations' }, { key: 'templates', label: 'Templates' }, { key: 'coach', label: 'Coach' }, { key: 'workspace', label: 'Workspace' }, { key: 'usage', label: 'Usage' }, { key: 'system', label: 'System' }]

export default function Settings({ tab = 'account' }) {
  const active = SECTIONS.find((s) => s.key === tab) ? tab : 'account'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SECTIONS.map((s) => (
          <div key={s.key} onClick={() => go(`/settings/${s.key}`)}
            style={{ cursor: 'pointer', padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: active === s.key ? 600 : 500,
              background: active === s.key ? 'var(--proto-accent-soft)' : 'transparent', color: active === s.key ? 'var(--text-brand)' : 'var(--proto-ink2)',
              border: '1px solid var(--proto-rule-soft)' }}>{s.label}</div>
        ))}
      </div>
      {active === 'account' && <AccountSettings />}
      {active === 'intake' && <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><IntakeSettings /><TemperatureSettings /><AtsSources /></div>}
      {active === 'roles' && <RolesSettings />}
      {active === 'locations' && <LocationSettings />}
      {active === 'templates' && <TemplatesSettings />}
      {active === 'coach' && <CoachSettings />}
      {active === 'workspace' && <WorkspaceSettings />}
      {active === 'usage' && <UsageSettings />}
      {active === 'system' && <SystemSettings />}
    </div>
  )
}
