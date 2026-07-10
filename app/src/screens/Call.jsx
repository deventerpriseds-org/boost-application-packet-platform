import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Conversation } from '@elevenlabs/client'
import { useApp } from '../state.jsx'
import { api } from '../api.js'

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

export default function Call() {
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
