import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Conversation } from '@elevenlabs/client'
import { useApp } from '../state.jsx'
import { api, getOwner } from '../api.js'

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
}

// Operator chat: the coach can read the whole app, take actions, search the web,
// and remember context across conversations.
function CoachChat() {
  const { toast } = useApp()
  const [msgs, setMsgs] = useState([]) // {role, content, tools?}
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
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `⚠️ ${e.message || e}`, tools: [] }])
      toast('Coach error')
    } finally { setBusy(false) }
  }, [input, busy, msgs, toast])

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Coach chat</div>
        <div className="px-small">Ask anything — or tell the coach to <b>do</b> it. It can read your whole pipeline, build packets, draft & send outreach, prep interviews, search the web, and remember what matters across chats.</div>
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
                  <span key={j} className="px-small" style={{ background: 'var(--proto-panel-deep)', borderRadius: 8, padding: '2px 8px', fontSize: 11 }}>
                    🔧 {TOOL_LABEL[t.name] || t.name}
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
  const [status, setStatus] = useState(null)
  const [mem, setMem] = useState(null)
  const [err, setErr] = useState(null)
  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([api.coachStatus({ owner: getOwner() }), api.coachMemoryList({ owner: getOwner() })])
      setStatus(s); setMem((m.memory || []).filter((x) => x.kind !== 'conversation'))
    } catch (e) { setErr(String(e.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Coach activity & memory</div>
        <div className="px-small">Everything the coach remembers lives in <b>your own Azure Postgres</b> (pgvector) — so it’s vendor-portable and survives swapping AI models.</div>
      </div>

      {status && (
        <div className="px-box" style={{ padding: 14, display: 'flex', flexWrap: 'wrap', gap: 18 }}>
          <Stat label="Model" value={status.model} />
          <Stat label="Memory DB" value={status.memoryReady ? 'connected' : 'unavailable'} ok={status.memoryReady} />
          <Stat label="Web search" value={status.tavily ? 'Tavily on' : 'off'} ok={status.tavily} />
          <Stat label="File store" value={status.vectorStoreId ? 'attached' : 'none'} ok={!!status.vectorStoreId} />
        </div>
      )}

      <div className="px-box" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <b style={{ fontSize: 14 }}>Saved memory</b>
          <span className="px-small">preferences, decisions & feedback the coach carries between chats</span>
          <div style={{ flex: 1 }} />
          <span className="px-link" style={{ fontSize: 12, cursor: 'pointer' }} onClick={load}>↻ Refresh</span>
        </div>
        {err && <div className="px-small" style={{ color: 'var(--proto-red)', marginTop: 8 }}>{err}</div>}
        {mem && mem.length === 0 && <div className="px-small" style={{ marginTop: 10 }}>Nothing saved yet. Tell the coach a preference or give feedback and it will remember it here.</div>}
        {mem && mem.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mem.map((m) => (
              <div key={m.id} style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5 }}>
                <span>{KIND_ICON[m.kind] || '📝'}</span>
                <div style={{ flex: 1 }}>{m.text}</div>
                <span className="px-small" style={{ whiteSpace: 'nowrap' }}>{timeAgoShort(m.createdAt)}</span>
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

export default function Call() {
  const [tab, setTab] = useState('chat') // chat | activity | call
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--proto-rule-soft)' }}>
        {[{ k: 'chat', l: '💬 Chat' }, { k: 'activity', l: '📋 Activity' }, { k: 'call', l: '☎️ Voice call' }].map((t) => (
          <div key={t.k} onClick={() => setTab(t.k)}
            style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13,
              fontWeight: tab === t.k ? 600 : 500, color: tab === t.k ? 'var(--text-brand)' : 'var(--proto-ink2)',
              borderBottom: tab === t.k ? '2px solid var(--surface-brand-default)' : '2px solid transparent', marginBottom: -1 }}>
            {t.l}
          </div>
        ))}
      </div>
      {tab === 'chat' && <CoachChat />}
      {tab === 'activity' && <CoachActivity />}
      {tab === 'call' && <VoiceCall />}
    </div>
  )
}
