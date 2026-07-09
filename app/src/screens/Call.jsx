import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Conversation } from '@elevenlabs/client'
import { useApp } from '../state.jsx'
import { api } from '../api.js'

// Live 1:1 voice call with the Executive Engine coach. Uses ElevenLabs
// Conversational AI over WebSocket — mic streams up, agent voice streams down,
// and barge-in (talking over the agent) is handled natively by the SDK/agent.
export default function Call() {
  const { toast } = useApp()
  const [status, setStatus] = useState('idle') // idle | connecting | connected | error
  const [mode, setMode] = useState('listening') // listening | speaking
  const [turns, setTurns] = useState([]) // {source:'user'|'ai', text}
  const convRef = useRef(null)
  const scrollRef = useRef(null)

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [turns])
  useEffect(() => () => { convRef.current?.endSession?.().catch(() => {}) }, [])

  const start = useCallback(async () => {
    setStatus('connecting'); setTurns([])
    try {
      const s = await api.voiceSession()
      if (s.error || !s.signedUrl) throw new Error(s.error || 'no signed URL')
      // The SDK requests mic permission here.
      const conv = await Conversation.startSession({
        signedUrl: s.signedUrl,
        onConnect: () => { setStatus('connected'); toast('Connected — just start talking') },
        onDisconnect: () => { setStatus('idle'); setMode('listening') },
        onError: (e) => { setStatus('error'); toast(`Call error: ${e?.message || e}`) },
        onModeChange: (m) => setMode(m?.mode === 'speaking' ? 'speaking' : 'listening'),
        onMessage: (m) => {
          const text = m?.message ?? m?.text
          const source = m?.source === 'ai' || m?.source === 'agent' ? 'ai' : 'user'
          if (text) setTurns((t) => [...t, { source, text }])
        },
      })
      convRef.current = conv
    } catch (err) {
      setStatus('error')
      toast(`Could not start: ${err.message || err}`)
    }
  }, [toast])

  const end = useCallback(async () => {
    try { await convRef.current?.endSession() } catch {}
    convRef.current = null
    setStatus('idle'); setMode('listening')
  }, [])

  const live = status === 'connected'

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Voice coach</div>
        <div className="px-small">A live 1:1 call with your Executive Engine coach. Talk naturally — you can interrupt (barge-in) any time.</div>
      </div>

      {/* Call orb + controls */}
      <div className="px-box" style={{ padding: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 120, height: 120, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 40, transition: 'all 200ms',
          background: live ? (mode === 'speaking' ? 'var(--proto-accent-soft)' : 'var(--surface-success-subtle)') : 'var(--proto-panel)',
          boxShadow: live ? `0 0 0 ${mode === 'speaking' ? 14 : 6}px ${mode === 'speaking' ? 'var(--proto-accent-soft)' : 'var(--surface-success-subtle)'}` : 'none',
        }}>
          {live ? (mode === 'speaking' ? '🔊' : '🎙️') : '☎️'}
        </div>
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
          <button className="px-btn px-btn-red" onClick={end} style={{ padding: '10px 28px', fontSize: 15 }}>End call</button>
        )}
        <div className="px-small">Your browser will ask for microphone access on the first call.</div>
      </div>

      {/* Live transcript */}
      {turns.length > 0 && (
        <div ref={scrollRef} className="px-box" style={{ padding: 14, maxHeight: 340, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {turns.map((t, i) => (
            <div key={i} style={{ alignSelf: t.source === 'user' ? 'flex-end' : 'flex-start', maxWidth: '82%',
              background: t.source === 'user' ? 'var(--surface-brand-default)' : 'var(--proto-panel)',
              color: t.source === 'user' ? 'var(--text-on-brand)' : 'var(--proto-ink)',
              padding: '8px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.45 }}>
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
