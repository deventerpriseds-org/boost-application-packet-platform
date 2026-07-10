import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
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
const Label = ({ children }) => <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{children}</div>

function IntakeSettings() {
  const [cfg, setCfg] = useState(null)
  const [cfgErr, setCfgErr] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [folders, setFolders] = useState({ loading: false, list: [], error: null })
  const [sub, setSub] = useState({ loading: true, watches: [] })
  const [subscribing, setSubscribing] = useState(false)
  const [test, setTest] = useState({ running: false, result: null })
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

  if (cfgErr) return <Card style={{ color: 'var(--proto-red)' }}>Couldn’t load intake config: {cfgErr}</Card>
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
          <button className="px-btn" onClick={() => go('/intake')}>View live feed →</button>
        </div>
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
  if (u.error) return <Card style={{ color: 'var(--proto-red)' }}>Couldn’t load usage: {u.error}</Card>
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
              <div className="px-small" style={{ color: 'var(--proto-yellow)' }}>Sign-in providers aren’t configured on this build yet (needs the Entra app + build-time client IDs).</div>
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
        <div className="px-small" style={{ marginTop: 2, marginBottom: 14 }}>The workspace ships with sample opportunities, packets, and outreach so the app isn’t empty. Turn this off to see only your real, ingested data.</div>
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

// Coach — the AI coach's system prompt, model, memory, and file store. This is
// the "see everything" surface: the exact prompt the agent runs on, editable.
function CoachSettings() {
  const [cfg, setCfg] = useState(null)
  const [status, setStatus] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([api.coachConfigGet(), api.coachStatus()])
      setCfg(c); setStatus(s); setPrompt(c.systemPrompt || ''); setModel(c.model || '')
    } catch (e) { setMsg(String(e.message || e)) }
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

  if (!cfg) return <Card style={{ color: 'var(--proto-ink2)' }}>Loading coach configuration…</Card>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <b style={{ fontSize: 15 }}>How the coach remembers you</b>
        <div className="px-small" style={{ marginTop: 6, lineHeight: 1.6 }}>
          Durable memory (preferences, decisions, feedback) is embedded and stored in <b>your own Azure Postgres</b> — pgvector tables <code>coach_memory</code> + <code>coach_triples</code>. Because it lives in your database and not an AI vendor’s account, it is <b>vendor-portable</b>: swap OpenAI for another model and every memory persists. The OpenAI file store below is a separate, rebuildable place for uploaded reference documents only.
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

const SECTIONS = [{ key: 'account', label: 'Account' }, { key: 'intake', label: 'Intake' }, { key: 'coach', label: 'Coach' }, { key: 'workspace', label: 'Workspace' }, { key: 'usage', label: 'Usage' }, { key: 'system', label: 'System' }]

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
      {active === 'intake' && <IntakeSettings />}
      {active === 'coach' && <CoachSettings />}
      {active === 'workspace' && <WorkspaceSettings />}
      {active === 'usage' && <UsageSettings />}
      {active === 'system' && <SystemSettings />}
    </div>
  )
}
