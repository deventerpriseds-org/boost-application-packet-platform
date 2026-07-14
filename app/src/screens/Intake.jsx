import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { go } from '../state.jsx'
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
function Card({ children, style }) {
  return <div style={{ border: '1px solid var(--proto-rule-soft)', borderRadius: 12, background: 'var(--proto-paper)', padding: 16, ...style }}>{children}</div>
}

export default function Intake() {
  const [sub, setSub] = useState({ loading: true, watches: [] })
  const [feed, setFeed] = useState({ loading: false, scanned: null, trace: [], error: null, at: null })
  const [minutes, setMinutes] = useState(120)
  const [clearing, setClearing] = useState(false)
  const [clearResult, setClearResult] = useState(null)

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
    if (!window.confirm('This will delete all your current opportunities and re-pull the last 7 days from your mailbox. Continue?')) return
    setClearing(true); setClearResult(null)
    try {
      const res = await api.mailClearReload({ days: 7 })
      if (res.error) throw new Error(res.error)
      setClearResult({ ok: true, msg: `Cleared ${res.cleared} opp${res.cleared === 1 ? '' : 's'}, re-ingested ${res.ingested?.inserted ?? 0} from ${res.scanned} messages.` })
    } catch (e) { setClearResult({ ok: false, msg: String(e.message || e) }) }
    finally { setClearing(false) }
  }, [])

  useEffect(() => { loadSubs() }, [loadSubs])

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

      <Card style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 14 }}>Incoming feed</b>
        <span className="px-small">scan last</span>
        <select className="px-btn" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={{ fontSize: 12 }}>
          <option value={60}>1 hour</option>
          <option value={120}>2 hours</option>
          <option value={720}>12 hours</option>
          <option value={1440}>24 hours</option>
          <option value={4320}>3 days</option>
          <option value={10080}>7 days</option>
        </select>
        <button className="px-btn px-btn-accent" onClick={pull} disabled={feed.loading}>{feed.loading ? 'Scanning…' : '⇊ Pull now'}</button>
        <button className="px-btn" onClick={clearReload} disabled={clearing} style={{ color: 'var(--proto-red)' }} title="Delete all opportunities and re-pull last 7 days">{clearing ? 'Clearing…' : '↺ Clear & reload 7d'}</button>
        {feed.at && <span className="px-small" style={{ color: 'var(--proto-ink2)' }}>scanned {feed.scanned} message{feed.scanned === 1 ? '' : 's'} · {timeAgo(feed.at)}</span>}
        {feed.error && <span className="px-small" style={{ color: 'var(--proto-red)' }}>{feed.error}</span>}
        {clearResult && <span className="px-small" style={{ color: clearResult.ok ? 'var(--surface-success-default)' : 'var(--proto-red)' }}>{clearResult.msg}</span>}
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {feed.trace.length === 0 && !feed.loading && (
          <Card style={{ textAlign: 'center', color: 'var(--proto-ink2)' }}>
            {feed.at ? 'No messages in that window.' : 'Hit “Pull now” to see what has arrived.'}
          </Card>
        )}
        {feed.trace.map((t, i) => {
          const v = verdict(t.result), src = sourceOf(t.from)
          return (
            <Card key={i} style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <Pill tone={src.tone}>{src.label}</Pill>
                <span style={{ fontWeight: 600, flex: 1, minWidth: 180 }}>{t.subject || '(no subject)'}</span>
                <Pill tone={v.tone}>{v.label}</Pill>
              </div>
              <div className="px-small" style={{ marginTop: 6, color: 'var(--proto-ink2)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ wordBreak: 'break-all' }}>{t.from}</span><span>·</span><span>{timeAgo(t.received)}</span>
                {v.detail && <><span>·</span><span>{v.detail}</span></>}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
