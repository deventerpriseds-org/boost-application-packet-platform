import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { go, useApp } from '../state.jsx'
import { Pill } from '../shell.jsx'

// Intake — live monitoring of what's arriving in the watched mailbox and how
// each message was handled (new / duplicate / skipped). Configuration for WHICH
// mailbox/folder/sources to watch lives in Settings ▸ Intake.

const SOURCE_PRESETS = [
  { key: 'linkedin', label: 'LinkedIn' }, { key: 'indeed', label: 'Indeed' },
  { key: 'glassdoor', label: 'Glassdoor' }, { key: 'ziprecruiter', label: 'ZipRecruiter' },
  { key: 'greenhouse', label: 'Greenhouse' }, { key: 'lever', label: 'Lever' },
]

function timeAgo(iso, suffix = 'ago') {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  const abs = Math.abs(s)
  const dir = s >= 0 ? suffix : 'from now'
  if (abs < 60) return `${Math.round(abs)}s ${dir}`
  if (abs < 3600) return `${Math.round(abs / 60)}m ${dir}`
  if (abs < 86400) return `${Math.round(abs / 3600)}h ${dir}`
  return `${Math.round(abs / 86400)}d ${dir}`
}
function verdict(result) {
  if (!result) return { label: 'no result', tone: 'panel', detail: '' }
  if (result.error) return { label: 'error', tone: 'red', detail: String(result.error).slice(0, 140) }
  if (result.skipped) return { label: 'skipped', tone: 'panel', detail: result.skipped }
  const parsed = result.parsed || 0, inserted = result.inserted || 0
  if (inserted > 0) return { label: `+${inserted} new`, tone: 'green', detail: `${parsed} role${parsed === 1 ? '' : 's'} found, ${parsed - inserted} duplicate` }
  if (parsed > 0) return { label: 'all duplicate', tone: 'yellow', detail: `${parsed} role${parsed === 1 ? '' : 's'} found, already tracked` }
  return { label: 'nothing parsed', tone: 'panel', detail: '' }
}
function sourceOf(from = '') {
  const f = from.toLowerCase()
  const hit = SOURCE_PRESETS.find((s) => f.includes(s.key))
  return hit ? { label: hit.label, tone: 'accent' } : { label: 'Other', tone: 'panel' }
}
function alertBadge(state) {
  if (state === 'snoozed') return { label: 'Snoozed', tone: 'yellow' }
  if (state === 'dismissed') return { label: 'Dismissed', tone: 'panel' }
  return null
}
function Card({ children, style }) {
  return <div style={{ border: '1px solid var(--proto-rule-soft)', borderRadius: 12, background: 'var(--proto-paper)', padding: 16, ...style }}>{children}</div>
}
function RailItem({ active, onClick, label, sub }) {
  return (
    <div onClick={onClick} style={{ padding: '8px 12px', cursor: 'pointer', borderLeft: `2px solid ${active ? 'var(--text-brand)' : 'transparent'}`, background: active ? 'var(--proto-paper-2, rgba(127,127,127,0.08))' : 'transparent' }}>
      <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      {sub && <div className="px-small" style={{ color: 'var(--proto-ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
    </div>
  )
}

export default function Intake() {
  const { isDemo } = useApp()
  if (isDemo) return (
    <Card>
      <b style={{ fontSize: 15 }}>Intake monitor</b>
      <div className="px-small" style={{ marginTop: 8 }}>The intake monitor watches your Microsoft 365 mailbox for job alerts and automatically adds them to your pipeline. Sign in to activate it.</div>
      <button className="px-btn px-btn-accent" style={{ marginTop: 12 }} onClick={() => go('/settings/account')}>Connect Microsoft account</button>
    </Card>
  )
  const [sub, setSub] = useState({ loading: true, watches: [] })
  const [feed, setFeed] = useState({ loading: false, scanned: null, trace: [], error: null, at: null })
  const [minutes, setMinutes] = useState(120)
  const [hideSkipped, setHideSkipped] = useState(true)
  const [clearDays, setClearDays] = useState(7)
  const [clearing, setClearing] = useState(false)
  const [clearResult, setClearResult] = useState(null)

  // 3-pane inbox monitor state — all real: role bins (folder_role_map), messages
  // (GET /api/mail/messages), and a header-only preview.
  const [roles, setRoles] = useState({ loading: true, list: [], error: null })
  const [roleSel, setRoleSel] = useState(null) // folderId of selected role, or null = all mail
  const [msgs, setMsgs] = useState({ loading: false, list: [], error: null, at: null })
  const [msgSel, setMsgSel] = useState(null) // index into msgs.list
  const [body, setBody] = useState({ loading: false, id: null, bodyType: null, html: null, error: null }) // fetched message body
  const [alertBusy, setAlertBusy] = useState(false) // snooze/dismiss in flight

  const loadRoles = useCallback(async () => {
    setRoles((r) => ({ ...r, loading: true, error: null }))
    try {
      const res = await api.mailFolderMapGet()
      // Collapse many-to-many rows into one entry per folder (a folder can feed
      // several role bins). Each entry carries the real folderId/path and roleKeys.
      const byFolder = new Map()
      for (const m of (res.mappings || [])) {
        const e = byFolder.get(m.folderId) || { folderId: m.folderId, folderPath: m.folderPath, roleKeys: [] }
        if (m.roleKey && !e.roleKeys.includes(m.roleKey)) e.roleKeys.push(m.roleKey)
        byFolder.set(m.folderId, e)
      }
      setRoles({ loading: false, list: [...byFolder.values()], error: null })
    } catch (e) { setRoles({ loading: false, list: [], error: String(e.message || e) }) }
  }, [])

  const loadMessages = useCallback(async (folderId) => {
    setMsgSel(null)
    setMsgs((m) => ({ ...m, loading: true, error: null }))
    try {
      const res = await api.mailMessages({ folderId: folderId || undefined, top: 50 })
      if (res.ok === false) throw new Error(res.detail || res.error || 'failed')
      if (res.error) throw new Error(res.error)
      setMsgs({ loading: false, list: res.messages || [], error: null, at: new Date().toISOString() })
    } catch (e) { setMsgs({ loading: false, list: [], error: String(e.message || e), at: null }) }
  }, [])

  const selectRole = useCallback((folderId) => { setRoleSel(folderId); loadMessages(folderId) }, [loadMessages])

  // Update a single message's alert fields in place (after snooze/dismiss).
  const patchMsg = useCallback((id, patch) => {
    setMsgs((m) => ({ ...m, list: m.list.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  }, [])

  const snoozeAlert = useCallback(async (id) => {
    if (!id || alertBusy) return
    setAlertBusy(true)
    try {
      const res = await api.mailAlertSnooze(id, 24)
      if (res.ok === false) throw new Error(res.detail || res.error || 'failed')
      patchMsg(id, { alertState: 'snoozed', snoozeUntil: res.snoozeUntil || new Date(Date.now() + 24 * 3600e3).toISOString() })
    } catch (e) { setBody((b) => (b.id === id ? { ...b, error: String(e.message || e) } : b)) }
    finally { setAlertBusy(false) }
  }, [alertBusy, patchMsg])

  const dismissAlert = useCallback(async (id) => {
    if (!id || alertBusy) return
    setAlertBusy(true)
    try {
      const res = await api.mailAlertDismiss(id)
      if (res.ok === false) throw new Error(res.detail || res.error || 'failed')
      patchMsg(id, { alertState: 'dismissed', snoozeUntil: null })
    } catch (e) { setBody((b) => (b.id === id ? { ...b, error: String(e.message || e) } : b)) }
    finally { setAlertBusy(false) }
  }, [alertBusy, patchMsg])

  const loadSubs = useCallback(async () => {
    setSub((s) => ({ ...s, loading: true }))
    try {
      const res = await api.mailSubscriptions()
      const watches = (res.value || []).filter((w) => (w.notificationUrl || '').includes('/mail/notify'))
      setSub({ loading: false, watches })
    } catch { setSub({ loading: false, watches: [] }) }
  }, [])
  const pull = useCallback(async () => {
    setFeed((f) => ({ ...f, loading: true, error: null }))
    try {
      const res = await api.mailPollNow(minutes)
      if (res.error) throw new Error(res.error)
      setFeed({ loading: false, scanned: res.scanned ?? (res.trace || []).length, trace: res.trace || [], error: null, at: new Date().toISOString() })
    } catch (e) { setFeed((f) => ({ ...f, loading: false, error: String(e.message || e) })) }
  }, [minutes])

  const clearReload = useCallback(async () => {
    if (!window.confirm(`This will delete all your current opportunities and re-pull the last ${clearDays} day${clearDays === 1 ? '' : 's'} from your mailbox. Continue?`)) return
    setClearing(true); setClearResult(null)
    try {
      const res = await api.mailClearReload({ days: clearDays })
      if (res.error) throw new Error(res.error)
      setClearResult({ ok: true, msg: `Cleared ${res.cleared} opp${res.cleared === 1 ? '' : 's'}, re-ingested ${res.ingested?.inserted ?? 0} from ${res.scanned} messages.` })
    } catch (e) { setClearResult({ ok: false, msg: String(e.message || e) }) }
    finally { setClearing(false) }
  }, [clearDays])

  useEffect(() => { loadSubs(); loadRoles(); loadMessages(null) }, [loadSubs, loadRoles, loadMessages])

  const folderLabel = (path = '') => {
    const seg = String(path).split(/[\\/]/).filter(Boolean)
    return seg[seg.length - 1] || path || '(folder)'
  }
  const selectedRole = roles.list.find((r) => r.folderId === roleSel)
  const preview = msgSel != null ? msgs.list[msgSel] : null

  // Fetch the real sanitized body whenever a message is selected.
  useEffect(() => {
    const id = preview?.id
    if (!id) { setBody({ loading: false, id: null, bodyType: null, html: null, error: null }); return }
    let cancelled = false
    setBody({ loading: true, id, bodyType: null, html: null, error: null })
    api.mailMessage(id, watchMailbox || undefined)
      .then((res) => {
        if (cancelled) return
        if (res.ok === false) throw new Error(res.detail || res.error || 'failed')
        setBody({ loading: false, id, bodyType: res.bodyType || 'text', html: res.body || '', error: null })
      })
      .catch((e) => { if (!cancelled) setBody({ loading: false, id, bodyType: null, html: null, error: String(e.message || e) }) })
    return () => { cancelled = true }
    // watchMailbox is derived below; preview.id is the real trigger
  }, [preview?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const watch = sub.watches[0]
  const watchMailbox = watch ? (watch.resource || '').replace(/^users\//, '').replace(/\/mailFolders.*$/, '') : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: watch ? 'var(--surface-success-default)' : 'var(--proto-ink3)', boxShadow: watch ? '0 0 0 3px var(--surface-success-subtle)' : 'none' }} />
          <b style={{ fontSize: 15 }}>{watch ? `Watching ${watchMailbox}` : sub.loading ? 'Checking watcher…' : 'No active watch'}</b>
          {watch && <span className="px-small" style={{ color: 'var(--proto-ink2)' }}>renews {timeAgo(watch.expirationDateTime, 'from now')}</span>}
          <div style={{ flex: 1 }} />
          <button className="px-btn" onClick={loadSubs} disabled={sub.loading}>↻</button>
          <button className="px-btn" onClick={() => go('/settings/intake')}>⚙ Configure</button>
        </div>
        {!watch && !sub.loading && (
          <div className="px-small" style={{ marginTop: 10 }}>No mailbox is being watched yet — set one up in <a style={{ cursor: 'pointer', color: 'var(--text-brand)' }} onClick={() => go('/settings/intake')}>Settings ▸ Intake</a>.</div>
        )}
      </Card>

      {/* 3-pane inbox monitor — roles rail · alerts list · preview. All real. */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--proto-rule-soft)', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>Inbox monitor</b>
          <span className="px-small" style={{ color: 'var(--proto-ink2)' }}>live from watched mailbox</span>
          <div style={{ flex: 1 }} />
          <button className="px-btn" onClick={() => { loadRoles(); loadMessages(roleSel) }} disabled={msgs.loading || roles.loading}>↻ Refresh</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 220px) minmax(220px, 1fr) minmax(220px, 1.2fr)', minHeight: 320 }}>
          {/* Left rail — monitored role bins (folder_role_map) */}
          <div style={{ borderRight: '1px solid var(--proto-rule-soft)', overflowY: 'auto', maxHeight: 460 }}>
            <div className="px-small" style={{ padding: '10px 12px 6px', color: 'var(--proto-ink2)', textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 10 }}>Monitored roles</div>
            <RailItem active={roleSel === null} onClick={() => selectRole(null)} label="All mail" sub="entire mailbox" />
            {roles.loading && <div className="px-small" style={{ padding: '8px 12px', color: 'var(--proto-ink2)' }}>Loading roles…</div>}
            {roles.error && <div className="px-small" style={{ padding: '8px 12px', color: 'var(--proto-red)' }}>{roles.error}</div>}
            {!roles.loading && !roles.error && roles.list.length === 0 && (
              <div className="px-small" style={{ padding: '8px 12px', color: 'var(--proto-ink2)' }}>No role folders mapped yet. Map folders → roles in <a style={{ cursor: 'pointer', color: 'var(--text-brand)' }} onClick={() => go('/settings/intake')}>Settings ▸ Intake</a>.</div>
            )}
            {roles.list.map((r) => (
              <RailItem key={r.folderId} active={roleSel === r.folderId} onClick={() => selectRole(r.folderId)}
                label={folderLabel(r.folderPath)} sub={r.roleKeys.join(', ') || 'router decides'} />
            ))}
          </div>
          {/* Middle — alerts list (real messages) */}
          <div style={{ borderRight: '1px solid var(--proto-rule-soft)', overflowY: 'auto', maxHeight: 460 }}>
            <div className="px-small" style={{ padding: '10px 12px 6px', color: 'var(--proto-ink2)', textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>{selectedRole ? folderLabel(selectedRole.folderPath) : 'All mail'}</span>
              {msgs.at && !msgs.loading && <span style={{ textTransform: 'none', letterSpacing: 0 }}>· {msgs.list.length} message{msgs.list.length === 1 ? '' : 's'}</span>}
            </div>
            {msgs.loading && <div className="px-small" style={{ padding: '8px 12px', color: 'var(--proto-ink2)' }}>Loading messages…</div>}
            {msgs.error && <div className="px-small" style={{ padding: '8px 12px', color: 'var(--proto-red)' }}>{msgs.error}</div>}
            {!msgs.loading && !msgs.error && msgs.list.length === 0 && <div className="px-small" style={{ padding: '8px 12px', color: 'var(--proto-ink2)' }}>No messages in this view.</div>}
            {msgs.list.map((m, i) => {
              const src = sourceOf(m.from)
              const badge = alertBadge(m.alertState)
              return (
                <div key={m.id || i} onClick={() => setMsgSel(i)} style={{ padding: '10px 12px', borderBottom: '1px solid var(--proto-rule-soft)', cursor: 'pointer', background: msgSel === i ? 'var(--proto-paper-2, rgba(127,127,127,0.08))' : 'transparent', opacity: m.alertState === 'dismissed' ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <Pill tone={src.tone}>{src.label}</Pill>
                    <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.subject || '(no subject)'}</span>
                    {badge && <Pill tone={badge.tone}>{badge.label}</Pill>}
                  </div>
                  <div className="px-small" style={{ marginTop: 4, color: 'var(--proto-ink2)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ wordBreak: 'break-all' }}>{m.from || '(unknown)'}</span><span>·</span><span>{timeAgo(m.received)}</span>
                  </div>
                </div>
              )
            })}
          </div>
          {/* Right — preview (header-only; body not exposed by messages endpoint) */}
          <div style={{ overflowY: 'auto', maxHeight: 460, padding: 16 }}>
            {!preview && <div className="px-small" style={{ color: 'var(--proto-ink2)' }}>Select a message to preview.</div>}
            {preview && (
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <Pill tone={sourceOf(preview.from).tone}>{sourceOf(preview.from).label}</Pill>
                  <span className="px-small" style={{ color: 'var(--proto-ink2)' }}>{timeAgo(preview.received)}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{preview.subject || '(no subject)'}</div>
                <div className="px-small" style={{ color: 'var(--proto-ink2)', marginBottom: 4 }}><b>From:</b> <span style={{ wordBreak: 'break-all' }}>{preview.from || '(unknown)'}</span></div>
                <div className="px-small" style={{ color: 'var(--proto-ink2)', marginBottom: 12 }}><b>Received:</b> {preview.received ? new Date(preview.received).toLocaleString() : '—'}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  <button className="px-btn px-btn-accent" onClick={() => go('/swipe')}>Review in Swipe →</button>
                </div>
                <div className="px-small" style={{ color: 'var(--proto-ink2)', borderTop: '1px solid var(--proto-rule-soft)', paddingTop: 10, lineHeight: 1.5 }}>
                  Message body isn't exposed by the mailbox listing API (subject/sender/date only). Per-alert push-to-swipe, snooze, and dismiss need new backend routes — messages become swipeable opportunities only after ingestion (Pull now / Clear &amp; reload below).
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 14 }}>Ingestion trace</b>
        <span className="px-small">scan last</span>
        <select className="px-btn" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={{ fontSize: 12 }}>
          <option value={60}>1 hour</option>
          <option value={120}>2 hours</option>
          <option value={720}>12 hours</option>
          <option value={1440}>24 hours</option>
          <option value={4320}>3 days</option>
          <option value={10080}>7 days</option>
        </select>
        <button className="px-btn px-btn-accent" onClick={pull} disabled={feed.loading}>{feed.loading ? 'Scanning...' : 'Pull now'}</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--proto-ink2)', userSelect: 'none' }}>
          <input type="checkbox" checked={hideSkipped} onChange={(e) => setHideSkipped(e.target.checked)} style={{ cursor: 'pointer' }} />
          Hide non-alerts
        </label>
        <select className="px-btn" value={clearDays} onChange={(e) => setClearDays(Number(e.target.value))} style={{ fontSize: 12, color: 'var(--proto-red)' }}>
          <option value={1}>1 day</option>
          <option value={3}>3 days</option>
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
        </select>
        <button className="px-btn" onClick={clearReload} disabled={clearing} style={{ color: 'var(--proto-red)' }}>{clearing ? 'Clearing...' : 'Clear & reload'}</button>
        {feed.at && <span className="px-small" style={{ color: 'var(--proto-ink2)' }}>scanned {feed.scanned} message{feed.scanned === 1 ? '' : 's'} · {timeAgo(feed.at)}</span>}
        {feed.error && <span className="px-small" style={{ color: 'var(--proto-red)' }}>{feed.error}</span>}
        {clearResult && <span className="px-small" style={{ color: clearResult.ok ? 'var(--surface-success-default)' : 'var(--proto-red)' }}>{clearResult.msg}</span>}
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {feed.trace.length === 0 && !feed.loading && (
          <Card style={{ textAlign: 'center', color: 'var(--proto-ink2)' }}>
            {feed.at ? 'No messages in that window.' : 'Hit "Pull now" to see what has arrived.'}
          </Card>
        )}
        {feed.trace.filter((t) => !hideSkipped || !t.result?.skipped).map((t, i) => {
          const v = verdict(t.result), src = sourceOf(t.from)
          return (
            <Card key={i} style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <Pill tone={src.tone}>{src.label}</Pill>
                <span style={{ fontWeight: 600, flex: 1, minWidth: 180 }}>{t.subject || '(no subject)'}</span>
                <Pill tone={v.tone}>{v.label}</Pill>
              </div>
              <div className="px-small" style={{ marginTop: 6, color: 'var(--proto-ink2)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ wordBreak: 'break-all' }}>{t.from}</span><span>.</span><span>{timeAgo(t.received)}</span>
                {v.detail && <><span>.</span><span>{v.detail}</span></>}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
