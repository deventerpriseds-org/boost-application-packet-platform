import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useApp, go } from '../state.jsx'
import { Pill, UrgencyPill, MatchScore } from '../shell.jsx'
import { Loading, ErrorBox } from './Today.jsx'

const QUEUE_STAGES = ['discovered', 'saved', 'enriched']

// Tinder-style triage: keep (→saved), maybe (→enriched), pass (dismiss).
export default function Swipe({ opps }) {
  const { toast } = useApp()
  const { loading, error, opportunities, optimisticMove, optimisticDismiss } = opps
  const queue = useMemo(() => opportunities.filter((o) => QUEUE_STAGES.includes(o.stage)), [opportunities])
  const [idx, setIdx] = useState(0)
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false, decision: null })
  const cardRef = useRef(null)
  const busyRef = useRef(false)

  const current = queue[idx]
  const next = queue[idx + 1]

  const decide = (decision, { build = false } = {}) => {
    if (!current) return
    if (busyRef.current) return
    busyRef.current = true
    const oppId = current.id
    if (decision === 'keep') { optimisticMove(oppId, 'saved', (e) => toast(`Failed: ${e.message}`)); toast(build ? `Saved ${current.company} — building packet` : `Saved ${current.company}`) }
    else if (decision === 'maybe') { optimisticMove(oppId, 'enriched', (e) => toast(`Failed: ${e.message}`)); toast(`${current.company} → Maybe`) }
    else if (decision === 'pass') { optimisticDismiss(oppId, (e) => toast(`Failed: ${e.message}`)); toast(`Dismissed ${current.company}`) }
    setDrag({ x: 0, y: 0, active: false, decision: null })
    setIdx((i) => i + 1)
    // release the lock after the card transition so a held/repeated key can't double-act
    setTimeout(() => { busyRef.current = false }, 240)
    if (build && oppId) go(`/packet/${oppId}`)
  }

  // Keyboard triage: ← dismiss, → keep, ↓ maybe. Mirrors the action buttons.
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement
      const tag = el && el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (el && el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); decide('pass') }
      else if (e.key === 'ArrowRight') { e.preventDefault(); decide('keep') }
      else if (e.key === 'ArrowDown') { e.preventDefault(); decide('maybe') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />

  const onDown = (e) => { cardRef.current?.setPointerCapture?.(e.pointerId); setDrag({ x: 0, y: 0, active: true, decision: null, startX: e.clientX, startY: e.clientY }) }
  const onMove = (e) => {
    if (!drag.active) return
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY
    let decision = null
    if (dx > 60) decision = 'keep'; else if (dx < -60) decision = 'pass'; else if (dy > 60) decision = 'maybe'
    setDrag((d) => ({ ...d, x: dx, y: dy, decision }))
  }
  const onUp = () => {
    if (!drag.active) return
    const { x, y } = drag
    if (x > 100) return decide('keep')
    if (x < -100) return decide('pass')
    if (y > 100) return decide('maybe')
    setDrag({ x: 0, y: 0, active: false, decision: null })
  }

  if (!current) {
    return (
      <div style={{ maxWidth: 460, margin: '0 auto', textAlign: 'center', padding: '48px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div style={{ fontSize: 48 }}>✓</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Inbox zero</div>
        <div className="px-small">All new opportunities reviewed. Fresh ones arrive overnight.</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {idx > 0 && <button className="px-btn" onClick={() => setIdx(0)}>Re-run queue</button>}
          <button className="px-btn px-btn-accent" onClick={() => go('/pipeline')}>Open pipeline →</button>
        </div>
      </div>
    )
  }

  const rotation = drag.x / 14
  const total = queue.length
  const done = idx
  const left = total - idx
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div style={{ maxWidth: 460, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="px-small" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{done} of {total} reviewed</span>
          <span>{left} left</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--proto-line, rgba(0,0,0,.1))', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--proto-green)', transition: 'width 220ms ease-out' }} />
        </div>
      </div>
      <div style={{ position: 'relative', height: 420 }}>
        {next && <SwipeCard o={next} style={{ position: 'absolute', inset: 0, transform: 'scale(0.96) translateY(8px)', opacity: 0.5, pointerEvents: 'none', zIndex: 1 }} />}
        <SwipeCard o={current} cardRef={cardRef} decision={drag.decision}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          style={{ position: 'absolute', inset: 0, zIndex: 2, touchAction: 'none', cursor: 'grab',
            transform: drag.active ? `translate(${drag.x}px, ${drag.y}px) rotate(${rotation}deg)` : 'none',
            transition: drag.active ? 'none' : 'transform 220ms ease-out' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-around', padding: '8px 0' }}>
        <ActionBtn label="✕ Dismiss" tone="red" onClick={() => decide('pass')} />
        <ActionBtn label="↓ Maybe" tone="yellow" onClick={() => decide('maybe')} />
        <ActionBtn label="✓ Keep" tone="green" onClick={() => decide('keep')} />
      </div>
      {current.id && (
        <button className="px-btn px-btn-accent" onClick={() => decide('keep', { build: true })}
          style={{ justifyContent: 'center', fontWeight: 700 }}>
          ✓ Keep &amp; build packet now →
        </button>
      )}
      <div style={{ textAlign: 'center', paddingBottom: 8 }}>
        <span className="px-link" style={{ fontSize: 12 }} onClick={() => go(`/opp/${current.id}`)}>Open full detail →</span>
      </div>
    </div>
  )
}

function ActionBtn({ label, tone, onClick }) {
  return (
    <button onClick={onClick} className="px-btn"
      style={{ padding: '10px 18px', fontSize: 14, fontWeight: 700, minWidth: 92, justifyContent: 'center',
        color: `var(--proto-${tone})`, borderColor: `var(--proto-${tone})` }}>
      {label}
    </button>
  )
}

function SwipeCard({ o, decision, cardRef, style, ...handlers }) {
  return (
    <div ref={cardRef} {...handlers} className="px-box"
      style={{ display: 'flex', flexDirection: 'column', padding: 16, gap: 12, userSelect: 'none', boxShadow: '4px 6px 20px rgba(0,0,0,.08)', ...style }}>
      {decision === 'keep' && <Overlay tilt={-12} label="KEEP" tone="green" pos="left" />}
      {decision === 'pass' && <Overlay tilt={12} label="PASS" tone="red" pos="right" />}
      {decision === 'maybe' && <Overlay tilt={0} label="MAYBE" tone="yellow" pos="bottom" />}

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{o.company}</div>
          <div className="px-small">{o.location || '—'}</div>
        </div>
        <MatchScore value={o.match} size={44} />
      </div>
      <div className="px-divider" />
      <div style={{ fontSize: 15, fontWeight: 700 }}>{o.role}</div>
      <div className="px-small">{o.comp || '—'}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {o.urgency && <UrgencyPill urgency={o.urgency} />}
        {o.fit && <Pill tone="accent">{o.fit}</Pill>}
        {o.source && <Pill>{o.source}</Pill>}
      </div>
      <div className="px-divider" />
      {o.why && (
        <div>
          <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Why surfaced</div>
          <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.45 }}>{o.why}</div>
        </div>
      )}
      {o.hm && o.hm !== '—' && (
        <div className="px-box" style={{ padding: 8, fontSize: 12 }}>
          <span className="px-small">Hiring manager</span> · <b>{o.hm}</b>
        </div>
      )}
      <div style={{ marginTop: 'auto', textAlign: 'center' }}>
        <div className="px-small">⟵ swipe or use the buttons ⟶</div>
      </div>
    </div>
  )
}

function Overlay({ label, tone, tilt, pos }) {
  return (
    <div style={{ position: 'absolute',
      top: pos === 'bottom' ? 'auto' : 24, bottom: pos === 'bottom' ? 24 : 'auto',
      left: pos === 'left' ? 16 : (pos === 'bottom' ? 0 : 'auto'),
      right: pos === 'right' ? 16 : (pos === 'bottom' ? 0 : 'auto'),
      margin: pos === 'bottom' ? '0 auto' : 0, width: pos === 'bottom' ? 'fit-content' : 'auto',
      padding: '6px 16px', border: `3px solid var(--proto-${tone})`, color: `var(--proto-${tone})`,
      fontSize: 26, fontWeight: 900, transform: `rotate(${tilt}deg)`, background: 'var(--proto-paper)', borderRadius: 8, zIndex: 5 }}>
      {label}
    </div>
  )
}
