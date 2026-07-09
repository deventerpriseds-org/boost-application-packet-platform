import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { Pill } from '../shell.jsx'

// Intake watcher — configure WHICH mailbox/folder to watch and WHICH senders
// count as job alerts (no hardcoding), run a self-test to confirm the wiring,
// and see a live feed of what's arriving and how each message was handled.

const SOURCE_PRESETS = [
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'indeed', label: 'Indeed' },
  { key: 'glassdoor', label: 'Glassdoor' },
  { key: 'ziprecruiter', label: 'ZipRecruiter' },
  { key: 'greenhouse', label: 'Greenhouse' },
  { key: 'lever', label: 'Lever' },
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
  const parsed = result.parsed || 0
  const inserted = result.inserted || 0
  if (inserted > 0) return { label: `+${inserted} new`, tone: 'green', detail: `${parsed} role${parsed === 1 ? '' : 's'} found, ${parsed - inserted} duplicate` }
  if (parsed > 0) return { label: 'all duplicate', tone: 'yellow', detail: `${parsed} role${parsed === 1 ? '' : 's'} found, already tracked` }
  return { label: 'nothing parsed', tone: 'panel', detail: '' }
}

function sourceOf(from = '') {
  const f = from.toLowerCase()
  const hit = SOURCE_PRESETS.find((s) => f.includes(s.key))
  return hit ? { label: hit.label, tone: 'accent' } : { label: 'Other', tone: 'panel' }
}

function Card({ children, style }) {
  return <div style={{ border: '1px solid var(--proto-rule-soft)', borderRadius: 12, background: 'var(--proto-paper)', padding: 16, ...style }}>{children}</div>
}
const Label = ({ children }) => <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{children}</div>

export default function Intake() {
  const [cfg, setCfg] = useState(null)
  const [cfgErr, setCfgErr] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [folders, setFolders] = useState({ loading: false, list: [], error: null })
  const [sub, setSub] = useState({ loading: true, watches: [] })
  const [subscribing, setSubscribing] = useState(false)
  const [test, setTest] = useState({ running: false, result: null })
  const [feed, setFeed] = useState({ loading: false, scanned: null, trace: [], error: null, at: null })
  const [minutes, setMinutes] = useState(120)
  const [note, setNote] = useState(null)

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
  useEffect(() => { if (cfg?.mailbox) loadFolders(cfg.mailbox) }, [cfg?.mailbox, loadFolders])

  const patch = (p) => { setCfg((c) => ({ ...c, ...p })); setDirty(true) }
  const toggleSender = (key) => {
    const has = (cfg.senders || []).some((s) => s.toLowerCase() === key)
    patch({ senders: has ? cfg.senders.filter((s) => s.toLowerCase() !== key) : [...(cfg.senders || []), key] })
  }

  const save = async () => {
    setSaving(true); setNote(null)
    try {
      const r = await api.mailConfigSet({
        mailbox: cfg.mailbox, folder: cfg.folder, folderName: cfg.folderName,
        senders: cfg.senders, subjectPatterns: cfg.subjectPatterns, enabled: cfg.enabled,
      })
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
  const pull = async () => {
    setFeed((f) => ({ ...f, loading: true, error: null }))
    try {
      const res = await api.mailPollNow(minutes)
      if (res.error) throw new Error(res.error)
      setFeed({ loading: false, scanned: res.scanned ?? (res.trace || []).length, trace: res.trace || [], error: null, at: new Date().toISOString() })
    } catch (e) { setFeed((f) => ({ ...f, loading: false, error: String(e.message || e) })) }
  }

  if (cfgErr) return <Card style={{ color: 'var(--proto-red)' }}>Couldn’t load intake config: {cfgErr}</Card>
  if (!cfg) return <Card style={{ color: 'var(--proto-ink2)' }}>Loading intake configuration…</Card>

  const watch = sub.watches[0]
  const watchMailbox = watch ? (watch.resource || '').replace(/^users\//, '').replace(/\/mailFolders.*$/, '') : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Status banner */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: watch ? 'var(--surface-success-default)' : 'var(--proto-ink3)', boxShadow: watch ? '0 0 0 3px var(--surface-success-subtle)' : 'none' }} />
          <b style={{ fontSize: 15 }}>{watch ? `Watching ${watchMailbox}` : sub.loading ? 'Checking watcher…' : 'No active watch'}</b>
          {watch && <span className="px-small" style={{ color: 'var(--proto-ink2)' }}>renews {timeAgo(watch.expirationDateTime, 'from now')}</span>}
          <div style={{ flex: 1 }} />
          <button className="px-btn" onClick={loadSubs} disabled={sub.loading}>↻</button>
        </div>
        {note && <div className="px-small" style={{ marginTop: 10, color: 'var(--text-brand)' }}>{note}</div>}
      </Card>

      {/* Configuration panel */}
      <Card>
        <b style={{ fontSize: 15 }}>Configuration</b>
        <div className="px-small" style={{ marginTop: 2, marginBottom: 14 }}>Choose which mailbox and folder to watch, and which senders count as job alerts.</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <div>
            <Label>Mailbox (M365 address)</Label>
            <input className="px-btn" style={{ width: '100%', fontFamily: 'inherit' }} value={cfg.mailbox}
              onChange={(e) => patch({ mailbox: e.target.value })}
              onBlur={(e) => loadFolders(e.target.value)} placeholder="name@company.com" />
          </div>
          <div>
            <Label>Folder</Label>
            <select className="px-btn" style={{ width: '100%' }} value={cfg.folder}
              onChange={(e) => {
                const f = folders.list.find((x) => x.id === e.target.value)
                patch({ folder: e.target.value, folderName: e.target.value === 'inbox' ? 'Inbox' : (f?.name || e.target.value) })
              }}>
              <option value="inbox">Inbox (all incoming)</option>
              {folders.list.filter((f) => (f.name || '').toLowerCase() !== 'inbox').map((f) => (
                <option key={f.id} value={f.id}>{f.name}{typeof f.count === 'number' ? ` (${f.count})` : ''}</option>
              ))}
            </select>
            {folders.loading && <div className="px-small" style={{ marginTop: 4 }}>Loading folders…</div>}
            {folders.error && <div className="px-small" style={{ marginTop: 4, color: 'var(--proto-yellow)' }}>Can’t list folders: {folders.error}</div>}
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
          {(cfg.senders || []).some((s) => !SOURCE_PRESETS.find((p) => p.key === s.toLowerCase())) && (
            <div className="px-small" style={{ marginTop: 8 }}>Also matching: {cfg.senders.filter((s) => !SOURCE_PRESETS.find((p) => p.key === s.toLowerCase())).join(', ')}</div>
          )}
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

      {/* Self-test */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 15 }}>Self-test</b>
          <span className="px-small">confirm the watch is wired correctly</span>
          <div style={{ flex: 1 }} />
          {test.result && !test.result.error && (
            <Pill tone={test.result.ok ? 'green' : 'yellow'}>{test.result.passed}/{test.result.total} passing</Pill>
          )}
          <button className="px-btn px-btn-accent" onClick={runTest} disabled={test.running}>{test.running ? 'Running…' : 'Run tests'}</button>
        </div>
        {test.result?.error && <div className="px-small" style={{ marginTop: 10, color: 'var(--proto-red)' }}>{test.result.error}</div>}
        {test.result?.checks?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            {test.result.checks.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 10px', borderRadius: 8, background: 'var(--proto-panel-soft, transparent)' }}>
                <span style={{ color: c.pass ? 'var(--surface-success-default)' : 'var(--surface-error-default)', fontWeight: 700, width: 16 }}>{c.pass ? '✓' : '✕'}</span>
                <span style={{ fontWeight: 600, minWidth: 170 }}>{c.name}</span>
                <span className="px-small" style={{ color: 'var(--proto-ink2)', wordBreak: 'break-word' }}>{c.detail}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Live feed via on-demand pull */}
      <Card style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 14 }}>Incoming feed</b>
        <span className="px-small">scan last</span>
        <select className="px-btn" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={{ fontSize: 12 }}>
          <option value={60}>1 hour</option>
          <option value={120}>2 hours</option>
          <option value={720}>12 hours</option>
          <option value={1440}>24 hours</option>
          <option value={4320}>3 days</option>
        </select>
        <button className="px-btn px-btn-accent" onClick={pull} disabled={feed.loading}>{feed.loading ? 'Scanning…' : '⇊ Pull now'}</button>
        {feed.at && <span className="px-small" style={{ color: 'var(--proto-ink2)' }}>scanned {feed.scanned} message{feed.scanned === 1 ? '' : 's'} · {timeAgo(feed.at)}</span>}
        {feed.error && <span className="px-small" style={{ color: 'var(--proto-red)' }}>{feed.error}</span>}
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {feed.trace.length === 0 && !feed.loading && (
          <Card style={{ textAlign: 'center', color: 'var(--proto-ink2)' }}>
            {feed.at ? 'No messages in that window.' : 'Hit “Pull now” to see what has arrived.'}
          </Card>
        )}
        {feed.trace.map((t, i) => {
          const v = verdict(t.result)
          const src = sourceOf(t.from)
          return (
            <Card key={i} style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <Pill tone={src.tone}>{src.label}</Pill>
                <span style={{ fontWeight: 600, flex: 1, minWidth: 180 }}>{t.subject || '(no subject)'}</span>
                <Pill tone={v.tone}>{v.label}</Pill>
              </div>
              <div className="px-small" style={{ marginTop: 6, color: 'var(--proto-ink2)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ wordBreak: 'break-all' }}>{t.from}</span>
                <span>·</span>
                <span>{timeAgo(t.received)}</span>
                {v.detail && <><span>·</span><span>{v.detail}</span></>}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
