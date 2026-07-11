import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Conversation } from '@elevenlabs/client'
import { useApp, go } from '../state.jsx'
import { api, getOwner, getSessionToken } from '../api.js'

// Screens the coach can deep-link to. id-bearing screens take a second segment.
const NAV_PATH = { today: 'today', opportunities: 'opportunities', pipeline: 'pipeline', packets: 'packets', outreach: 'outreach', library: 'library', settings: 'settings', intake: 'intake', opp: 'opp', packet: 'packet', interview: 'interview', offer: 'offer', answers: 'answers' }

// Execute the browser-side directives the coach returns (things the server can't do).
function runUiActions(actions, toast) {
  for (const a of actions || []) {
    if (!a || !a.action) continue
    if (a.action === 'navigate') {
      const seg = NAV_PATH[a.screen] || 'today'
      go(a.id ? `/${seg}/${a.id}` : `/${seg}`)
      toast?.(`Opening ${a.screen || 'app'}…`)
    } else if (a.action === 'start_debrief_recording') {
      const oid = a.opportunityId || a.id
      if (oid) { try { sessionStorage.setItem('ee_coach_autorecord', oid) } catch {} ; go(`/interview/${oid}/debrief`); toast?.('Opening the debrief recorder — starting your mic…') }
    } else if (a.action === 'copy_link') {
      if (a.artifactId) { try { navigator.clipboard?.writeText(api.trackedLink(a.artifactId)) } catch {} ; toast?.('Tracked link copied') }
    }
  }
}

// Token-overlap similarity (Jaccard) for self-echo detection: if a "user"
// transcript closely matches what the agent just said, it's the mic hearing the
// agent, not the user.
function similarity(a, b) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const A = new Set(norm(a)), B = new Set(norm(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / Math.min(A.size, B.size)
}

function VoiceCall() {
  const { toast } = useApp()
  const [status, setStatus] = useState('idle') // idle | connecting | connected | error
  const [mode, setMode] = useState('listening') // listening | speaking
  const [turns, setTurns] = useState([])
  const [level, setLevel] = useState(0) // mic level 0..1
  const [echoGuard, setEchoGuard] = useState(false) // hard-mute mic while agent speaks
  const [echoCount, setEchoCount] = useState(0)

  const convRef = useRef(null)
  const rafRef = useRef(0)
  const modeRef = useRef('listening')
  const recentAgentText = useRef('') // last agent utterance, for self-echo compare
  const agentSpokeAt = useRef(0)
  const scrollRef = useRef(null)

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [turns])
  useEffect(() => () => stop(), []) // cleanup on unmount

  // Pause the call if the tab is backgrounded (mobile suspends mic/audio anyway).
  useEffect(() => {
    const onVis = () => { if (document.hidden && convRef.current) { stop(); toast('Call paused — tab was backgrounded') } }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const meterLoop = useCallback(() => {
    const c = convRef.current
    if (c) {
      try {
        const inV = c.getInputVolume?.() ?? 0
        const outV = c.getOutputVolume?.() ?? 0
        setLevel(Math.min(1, inV * 1.6))
        const speaking = outV > 0.04
        if (speaking) agentSpokeAt.current = Date.now()
        // Echo guard: while the agent is speaking, optionally mute the mic so its
        // own voice can't self-trigger. Trade-off: no barge-in while enabled.
        if (echoGuard) c.setMicMuted?.(speaking)
      } catch {}
    }
    rafRef.current = requestAnimationFrame(meterLoop)
  }, [echoGuard])

  const start = useCallback(async () => {
    setStatus('connecting'); setTurns([]); setEchoCount(0)
    try {
      const s = await api.voiceSession()
      if (s.error || !s.signedUrl) throw new Error(s.error || 'no signed URL')
      const conv = await Conversation.startSession({
        signedUrl: s.signedUrl,
        onConnect: () => { setStatus('connected'); toast('Connected — just start talking'); rafRef.current = requestAnimationFrame(meterLoop) },
        onDisconnect: () => { setStatus('idle'); setMode('listening'); modeRef.current = 'listening' },
        onError: (e) => { setStatus('error'); toast(`Call error: ${e?.message || e}`) },
        onModeChange: (m) => { const md = m?.mode === 'speaking' ? 'speaking' : 'listening'; setMode(md); modeRef.current = md },
        onMessage: (m) => {
          const text = m?.message ?? m?.text
          if (!text) return
          const source = m?.source === 'ai' || m?.source === 'agent' ? 'ai' : 'user'
          if (source === 'ai') {
            recentAgentText.current = text
            setTurns((t) => [...t, { source, text }])
            return
          }
          // Self-echo detection: user transcript arriving while (or just after) the
          // agent spoke AND closely matching its words = echo, not the user.
          const sinceAgent = Date.now() - agentSpokeAt.current
          const sim = similarity(text, recentAgentText.current)
          const echo = (modeRef.current === 'speaking' || sinceAgent < 1200) && sim >= 0.5
          if (echo) { setEchoCount((n) => n + 1); return }
          setTurns((t) => [...t, { source, text }])
        },
      })
      convRef.current = conv
    } catch (err) {
      setStatus('error'); toast(`Could not start: ${err.message || err}`)
    }
  }, [meterLoop, toast])

  function stop() {
    cancelAnimationFrame(rafRef.current)
    try { convRef.current?.endSession() } catch {}
    convRef.current = null
    setStatus('idle'); setMode('listening'); modeRef.current = 'listening'; setLevel(0)
  }

  const live = status === 'connected'

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Voice coach</div>
        <div className="px-small">A live 1:1 call with your Executive Engine coach. Talk naturally — you can interrupt (barge-in) any time.</div>
      </div>

      <div className="px-box" style={{ padding: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 120, height: 120, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, transition: 'all 160ms',
          background: live ? (mode === 'speaking' ? 'var(--proto-accent-soft)' : 'var(--surface-success-subtle)') : 'var(--proto-panel)',
          boxShadow: live ? `0 0 0 ${mode === 'speaking' ? 14 : 6 + Math.round(level * 22)}px ${mode === 'speaking' ? 'var(--proto-accent-soft)' : 'var(--surface-success-subtle)'}` : 'none',
        }}>{live ? (mode === 'speaking' ? '🔊' : '🎙️') : '☎️'}</div>

        {/* Mic level meter */}
        {live && (
          <div style={{ width: 160, height: 6, background: 'var(--proto-panel-deep)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(level * 100)}%`, height: '100%', background: mode === 'speaking' ? 'var(--proto-accent)' : 'var(--proto-green)', transition: 'width 80ms linear' }} />
          </div>
        )}

        <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
          {status === 'idle' && 'Ready'}
          {status === 'connecting' && 'Connecting…'}
          {status === 'connected' && (mode === 'speaking' ? 'Coach speaking — talk to interrupt' : 'Listening…')}
          {status === 'error' && 'Error'}
        </div>

        {!live ? (
          <button className="px-btn px-btn-accent" disabled={status === 'connecting'} onClick={start} style={{ padding: '10px 28px', fontSize: 15 }}>
            {status === 'connecting' ? 'Connecting…' : 'Start call'}
          </button>
        ) : (
          <button className="px-btn px-btn-red" onClick={stop} style={{ padding: '10px 28px', fontSize: 15 }}>End call</button>
        )}

        {/* Echo guard toggle — for speakerphone users */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--proto-ink2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={echoGuard} onChange={(e) => setEchoGuard(e.target.checked)} />
          Speakerphone mode — mute mic while coach speaks (prevents echo; disables interrupting)
        </label>
        {echoCount > 0 && <div className="px-small">Filtered {echoCount} echo{echoCount === 1 ? '' : 's'} of the coach’s own voice.</div>}
        <div className="px-small">Your browser will ask for microphone access on the first call.</div>
      </div>

      {turns.length > 0 && (
        <div ref={scrollRef} className="px-box" style={{ padding: 14, maxHeight: 340, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {turns.map((t, i) => (
            <div key={i} style={{ alignSelf: t.source === 'user' ? 'flex-end' : 'flex-start', maxWidth: '82%',
              background: t.source === 'user' ? 'var(--surface-brand-default)' : 'var(--proto-panel)',
              color: t.source === 'user' ? 'var(--text-on-brand)' : 'var(--proto-ink)',
              padding: '8px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.45 }}>{t.text}</div>
          ))}
        </div>
      )}
    </div>
  )
}

const TOOL_LABEL = {
  list_opportunities: 'Reading pipeline', get_opportunity: 'Reading opportunity', advance_stage: 'Moving stage',
  dismiss_opportunity: 'Dismissing', get_packet: 'Reading packet', list_packets: 'Reading packets',
  generate_artifact: 'Drafting artifact', create_document: 'Creating Google Doc', create_slides: 'Creating Slides deck',
  list_outreach: 'Reading outreach', opportunity_outreach: 'Reading outreach', generate_outreach: 'Drafting outreach',
  send_outreach: 'Sending email', interview_prep: 'Prepping interview', offer_analysis: 'Analyzing offer',
  get_usage: 'Reading usage', assets_analytics: 'Reading analytics', config_status: 'Checking config',
  mail_config: 'Reading intake config', mail_subscriptions: 'Checking subscriptions',
  remember: 'Saving to memory', recall: 'Recalling memory', tavily_web_search: 'Searching the web',
  seed_cadence: 'Seeding cadence', outreach_tick: 'Running scheduler', set_outreach_state: 'Updating outreach',
  mail_poll_now: 'Re-scanning inbox', analyze_jd: 'Analyzing JD/ATS', enrich_opportunity: 'Enriching opportunity',
  build_full_packet: 'Building full packet', bulk_run: 'Bulk building', bulk_status: 'Checking bulk job',
  list_interviews: 'Reading interviews', interview_debrief: 'Debriefing interview', generate_video: 'Rendering video',
  video_status: 'Checking video', set_artifact_status: 'Updating artifact', list_personas: 'Reading personas',
  answers_vision: 'Drafting form answers', ui_action: 'Doing it in the app',
}

// Operator chat: the coach can read the whole app, take actions, search the web,
// and remember context across conversations. State (msgs) is OWNED BY THE PARENT
// so it survives tab switches; persistence lives in the parent too.
function CoachChat({ msgs, setMsgs, clearThread }) {
  const { toast } = useApp()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)
  const taRef = useRef(null)

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [msgs, busy])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    const next = [...msgs, { role: 'user', content: text }]
    setMsgs(next); setInput(''); setBusy(true)
    try {
      const payload = next.map((m) => ({ role: m.role, content: m.content }))
      const r = await api.coachChat(payload, { owner: getOwner() })
      if (r.error) throw new Error(r.error)
      setMsgs((m) => [...m, { role: 'assistant', content: r.reply || '(no reply)', tools: r.toolCalls || [] }])
      if (r.uiActions && r.uiActions.length) runUiActions(r.uiActions, toast)
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `⚠️ ${e.message || e}`, tools: [] }])
      toast('Coach error')
    } finally { setBusy(false) }
  }, [input, busy, msgs, toast])

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Coach chat</div>
          <div className="px-small">Ask anything, or tell the coach to <b>do</b> it — a single step or the whole chain. It builds packets, seeds cadences, drafts outreach (never sends), preps interviews, runs bulk, searches the web, and remembers across chats. This thread persists across tabs and reloads (in your Azure Postgres when signed in).</div>
        </div>
        {msgs.length > 0 && <span className="px-link" style={{ fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={clearThread}>Clear</span>}
      </div>

      <div ref={scrollRef} className="px-box" style={{ padding: 14, height: 440, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {msgs.length === 0 && (
          <div className="px-small" style={{ margin: 'auto', textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}>
            Try: <i>“Show me my top opportunities and build a packet for the best fit.”</i><br />
            <i>“Research the hiring manager at Acme and draft a cold email.”</i><br />
            <i>“What have I spent on AI so far this week?”</i>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {m.tools && m.tools.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {m.tools.map((t, j) => (
                  <span key={j} className="px-small" style={{ background: 'var(--proto-panel-deep)', borderRadius: 8, padding: '2px 8px', fontSize: 11, fontFamily: 'ui-monospace, monospace' }} title={TOOL_LABEL[t.name] || t.name}>
                    🔧 {t.name}{TOOL_LABEL[t.name] ? <span style={{ opacity: 0.55, fontFamily: 'inherit' }}> · {TOOL_LABEL[t.name]}</span> : null}
                  </span>
                ))}
              </div>
            )}
            <div style={{
              background: m.role === 'user' ? 'var(--surface-brand-default)' : 'var(--proto-panel)',
              color: m.role === 'user' ? 'var(--text-on-brand)' : 'var(--proto-ink)',
              padding: '9px 13px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.content}</div>
          </div>
        ))}
        {busy && <div className="px-small" style={{ alignSelf: 'flex-start' }}>Coach is working…</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea ref={taRef} className="px-input" rows={2} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
          placeholder="Message your coach — or ask it to take an action…" style={{ flex: 1, resize: 'none', fontFamily: 'inherit' }} />
        <button className="px-btn px-btn-accent" disabled={busy || !input.trim()} onClick={send} style={{ padding: '10px 20px' }}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

const KIND_ICON = { feedback: '📣', preference: '⭐', decision: '✅', fact: '📌', conversation: '💬', note: '📝' }

// Activity: what the coach knows and remembers about you (huddle-style), plus
// live system status — proof the memory is real and vendor-portable.
function CoachActivity() {
  const { toast } = useApp()
  const [status, setStatus] = useState(null)
  const [mem, setMem] = useState(null)
  const [acts, setActs] = useState(null)
  const [err, setErr] = useState(null)
  const [ctx, setCtx] = useState('')
  const [ctxKind, setCtxKind] = useState('preference')
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    try {
      const [s, m, a] = await Promise.all([api.coachStatus({ owner: getOwner() }), api.coachMemoryList({ owner: getOwner() }), api.coachActivity({ owner: getOwner() })])
      setStatus(s); setMem((m.memory || []).filter((x) => x.kind !== 'conversation')); setActs(a.activity || [])
    } catch (e) { setErr(String(e.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const addContext = async () => {
    const text = ctx.trim(); if (!text) return
    setSaving(true)
    try { const r = await api.coachMemoryAdd({ text, kind: ctxKind, owner: getOwner() }); if (r.error) throw new Error(r.error); setCtx(''); toast('Context added to memory'); load() }
    catch (e) { toast(`Add failed: ${e.message || e}`) } finally { setSaving(false) }
  }
  const delMem = async (id) => { try { await api.coachMemoryDelete(id); setMem((m) => m.filter((x) => x.id !== id)) } catch {} }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Coach activity & memory</div>
        <div className="px-small">The coach’s actions and everything it remembers live in <b>your own Azure Postgres</b> (pgvector) — vendor-portable, and it survives swapping AI models.</div>
      </div>

      {status && (
        <div className="px-box" style={{ padding: 14, display: 'flex', flexWrap: 'wrap', gap: 18 }}>
          <Stat label="Model" value={status.model} />
          <Stat label="Memory DB" value={status.memoryReady ? 'connected' : 'unavailable'} ok={status.memoryReady} />
          <Stat label="Web search" value={status.tavily ? 'Tavily on' : 'off'} ok={status.tavily} />
          <Stat label="File store" value={status.vectorStoreId ? 'attached' : 'none'} ok={!!status.vectorStoreId} />
        </div>
      )}

      {/* Proof: June 2023 cutoff + today's date injected at the top of every prompt channel */}
      <details className="px-box" style={{ padding: '10px 14px' }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, userSelect: 'none' }}>
          🔒 Knowledge cutoff — proof it's at the top of every prompt channel
        </summary>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, lineHeight: 1.6 }}>
          <div><b>Channel A — instructions (system-level):</b> <span className="px-small">The very first line of every request's <code>instructions</code> field. Stored verbatim in <code>coach_activity.instructions</code> in your Azure Postgres — query any row to verify.</span></div>
          <div style={{ fontFamily: 'ui-monospace, monospace', background: 'var(--proto-panel-deep)', padding: '6px 10px', borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap' }}>{"KNOWLEDGE CUTOFF RULE (HARD): This application's database was last\nupdated in June 2023. You have NO reliable knowledge of any event,\nperson's role or team, price, news, or fact that could have changed\nafter June 2023. For ANY such question you MUST call tavily_web_search\nand answer ONLY from its results. Today is <today's date>."}</div>
          <div><b>Channel B — input (conversation channel):</b> <span className="px-small">A <code>role: system</code> message is the FIRST entry in the conversation array sent to the model on every hop — it sees the rule in the message stream, not only in the background instructions.</span></div>
          <div style={{ fontFamily: 'ui-monospace, monospace', background: 'var(--proto-panel-deep)', padding: '6px 10px', borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap' }}>{'{"role":"system","content":"HARD RULE: Your knowledge cutoff is June 2023.\nAny question about events, roles, prices, news, or facts that may have\nchanged after June 2023 MUST be answered via tavily_web_search only.\nToday is <today\'s date>."}'}</div>
          <div><b>Channel C — tool result:</b> <span className="px-small">Every Tavily response is wrapped with <code>retrieved_at</code> (today's date) and <code>knowledge_cutoff: "June 2023"</code> so the model sees the rule next to the live data it just retrieved.</span></div>
          <div style={{ fontFamily: 'ui-monospace, monospace', background: 'var(--proto-panel-deep)', padding: '6px 10px', borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap' }}>{'{"retrieved_at":"2026-07-11","knowledge_cutoff":"June 2023","results":[...]}'}</div>
        </div>
      </details>

      {/* Action log — the agent's actual step-by-step actions per turn */}
      <div className="px-box" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <b style={{ fontSize: 14 }}>Activity</b>
          <span className="px-small">what the coach did — each turn, the tools it ran</span>
          <div style={{ flex: 1 }} />
          <span className="px-link" style={{ fontSize: 12, cursor: 'pointer' }} onClick={load}>↻ Refresh</span>
        </div>
        {err && <div className="px-small" style={{ color: 'var(--proto-red)', marginTop: 8 }}>{err}</div>}
        {acts && acts.length === 0 && <div className="px-small" style={{ marginTop: 10 }}>No activity yet. Ask the coach to do something in the Chat tab.</div>}
        {acts && acts.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {acts.map((a) => (
              <div key={a.id} style={{ borderLeft: '2px solid var(--proto-rule-soft)', paddingLeft: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <div className="px-small" style={{ flex: 1, fontStyle: 'italic' }}>“{(a.userMsg || '').slice(0, 90)}”</div>
                  <span className="px-small" style={{ whiteSpace: 'nowrap' }}>{timeAgoShort(a.createdAt)}</span>
                </div>
                {a.tools && a.tools.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {a.tools.map((t, j) => <span key={j} className="px-small" style={{ background: 'var(--proto-panel-deep)', borderRadius: 8, padding: '1px 7px', fontSize: 11, fontFamily: 'ui-monospace, monospace' }} title={TOOL_LABEL[t.name] || ''}>🔧 {t.name}{TOOL_LABEL[t.name] ? <span style={{ opacity: 0.55 }}> · {TOOL_LABEL[t.name]}</span> : null}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Saved memory + manual add-context */}
      <div className="px-box" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <b style={{ fontSize: 14 }}>Saved memory</b>
          <span className="px-small">preferences, decisions & feedback carried between chats</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-start' }}>
          <textarea className="px-input" rows={2} value={ctx} onChange={(e) => setCtx(e.target.value)} placeholder="Add a context row the coach should remember…" style={{ flex: 1, resize: 'none', fontSize: 13 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <select className="px-input" value={ctxKind} onChange={(e) => setCtxKind(e.target.value)} style={{ fontSize: 12 }}>
              {['preference', 'fact', 'decision', 'feedback', 'note'].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button className="px-btn px-btn-accent" disabled={saving || !ctx.trim()} onClick={addContext} style={{ fontSize: 12 }}>{saving ? '…' : 'Add'}</button>
          </div>
        </div>
        {mem && mem.length === 0 && <div className="px-small" style={{ marginTop: 10 }}>Nothing saved yet. Add a context row above, or tell the coach a preference in chat.</div>}
        {mem && mem.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mem.map((m) => (
              <div key={m.id} style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5, alignItems: 'flex-start' }}>
                <span>{KIND_ICON[m.kind] || '📝'}</span>
                <div style={{ flex: 1 }}>{m.text}</div>
                <span className="px-small" style={{ whiteSpace: 'nowrap' }}>{timeAgoShort(m.createdAt)}</span>
                <span className="px-link" style={{ fontSize: 12, cursor: 'pointer', color: 'var(--proto-red)' }} onClick={() => delMem(m.id)}>✕</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="px-small">Manage the coach’s system prompt and configuration in <b>Settings ▸ Coach</b>.</div>
    </div>
  )
}
function Stat({ label, value, ok }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: ok === false ? 'var(--proto-red)' : ok === true ? 'var(--proto-green)' : 'var(--proto-ink)' }}>{value}</span>
    </div>
  )
}
function timeAgoShort(iso) {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

const threadKey = () => `ee_coach_thread_${getOwner()}`
function loadLocalThread() {
  try { const raw = localStorage.getItem(threadKey()); const a = raw ? JSON.parse(raw) : null; return Array.isArray(a) ? a : [] } catch { return [] }
}

export default function Call() {
  const [tab, setTab] = useState('chat') // chat | call | activity
  // Thread state is OWNED HERE so it survives switching tabs (CoachChat unmounts
  // on tab change). Seeded from localStorage so it also survives navigating away
  // from this screen and full page reloads — for everyone, signed in or not.
  const [msgs, setMsgs] = useState(loadLocalThread)

  // Persist every change locally so the conversation is durable client-side.
  useEffect(() => {
    try { localStorage.setItem(threadKey(), JSON.stringify(msgs.slice(-40))) } catch {}
  }, [msgs])

  // When signed in, hydrate from the server thread (Azure PG) once on mount if it
  // has MORE than what's local (e.g. continued from another device). Never clobber
  // a longer in-progress local thread.
  useEffect(() => {
    if (!getSessionToken()) return
    let live = true
    api.coachThreadGet({ owner: getOwner() }).then((r) => {
      const server = Array.isArray(r?.messages) ? r.messages.map((m) => ({ role: m.role, content: m.content })) : []
      if (live && server.length > msgs.length) setMsgs(server)
    }).catch(() => {})
    return () => { live = false }
  }, [])

  const clearThread = useCallback(async () => {
    setMsgs([]); try { localStorage.removeItem(threadKey()) } catch {}
    if (getSessionToken()) { try { await api.coachThreadClear({ owner: getOwner() }) } catch {} }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--proto-rule-soft)' }}>
        {[{ k: 'chat', l: '💬 Chat' }, { k: 'call', l: '☎️ Voice call' }, { k: 'activity', l: '📋 Activity' }].map((t) => (
          <div key={t.k} onClick={() => setTab(t.k)}
            style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13,
              fontWeight: tab === t.k ? 600 : 500, color: tab === t.k ? 'var(--text-brand)' : 'var(--proto-ink2)',
              borderBottom: tab === t.k ? '2px solid var(--surface-brand-default)' : '2px solid transparent', marginBottom: -1 }}>
            {t.l}
          </div>
        ))}
      </div>
      {tab === 'chat' && <CoachChat msgs={msgs} setMsgs={setMsgs} clearThread={clearThread} />}
      {tab === 'call' && <VoiceCall />}
      {tab === 'activity' && <CoachActivity />}
    </div>
  )
}
