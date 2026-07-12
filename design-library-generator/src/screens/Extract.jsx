import React, { useEffect, useRef } from 'react'
import { useApp, go } from '../state.jsx'
import { extractDesign } from '../api.js'

const CATEGORIES = ['colors', 'typography', 'spacing', 'tokens', 'components', 'effects', 'grids', 'finalizing']
const CAT_ICON = { colors: '🎨', typography: '✦', spacing: '⇔', tokens: '◈', components: '▦', effects: '◉', grids: '⊞', finalizing: '⇓' }

export default function Extract() {
  const { state, dispatch } = useApp()
  const hasStarted = useRef(false)

  useEffect(() => {
    if (hasStarted.current || state.extracting || state.result) return
    if (!state.uploadedFiles.length && !state.inputUrls.length && !state.description) {
      go('/upload'); return
    }
    hasStarted.current = true
    runExtraction()
  }, [])

  async function runExtraction() {
    dispatch({ type: 'START_EXTRACT' })
    try {
      const images = state.uploadedFiles.map((f) => ({ name: f.name, dataUrl: f.dataUrl }))
      const result = await extractDesign(
        {
          name: state.projectName,
          primaryColor: state.primaryColorHint,
          images,
          urls: state.inputUrls,
          description: state.description,
        },
        (event) => dispatch({ type: 'LOG_CHUNK', event }),
      )
      dispatch({ type: 'SET_RESULT', result })
      setTimeout(() => go('/review'), 800)
    } catch (e) {
      dispatch({ type: 'LOG_CHUNK', event: { type: 'progress', category: 'error', message: e.message, done: true } })
      dispatch({ type: 'EXTRACT_ERROR' })
    }
  }

  const log = state.extractionLog
  const done = log.filter((e) => e.done).map((e) => e.category)
  const currentEvent = log[log.length - 1]
  const progressPct = state.result ? 100 : Math.round((done.length / CATEGORIES.length) * 100)

  if (!state.extracting && !state.result && !log.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <div className="dlg-spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
        <div className="t-body" style={{ color: 'var(--dlg-text-2)' }}>Preparing extraction…</div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 className="t-h1" style={{ marginBottom: 6 }}>
          {state.result ? 'Extraction Complete ✓' : 'Extracting Design System'}
        </h1>
        <p className="t-body" style={{ color: 'var(--dlg-text-2)' }}>
          {state.result
            ? 'Claude analysed your inputs and proposed a full design library.'
            : 'Claude is analysing your inputs and generating the full design library structure.'}
        </p>
      </div>

      {/* Progress bar */}
      <div className="dlg-progress-bar" style={{ marginBottom: 24 }}>
        <div className="dlg-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      {/* Category grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 28 }}>
        {CATEGORIES.map((cat) => {
          const isDone = done.includes(cat)
          const isCurrent = !isDone && currentEvent?.category === cat
          return (
            <div key={cat} className="dlg-card" style={{ padding: '12px 14px',
              borderColor: isDone ? 'var(--dlg-success)' : isCurrent ? 'var(--dlg-brand)' : 'var(--dlg-border)',
              transition: 'border-color 0.3s' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>{CAT_ICON[cat]}</span>
                {isDone ? (
                  <span style={{ color: 'var(--dlg-success)', fontSize: 14, fontWeight: 600 }}>✓</span>
                ) : isCurrent ? (
                  <div className="dlg-spinner" />
                ) : (
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--dlg-border)' }} />
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, textTransform: 'capitalize', color: isDone ? 'var(--dlg-text)' : isCurrent ? 'var(--dlg-brand)' : 'var(--dlg-text-3)' }}>
                {cat}
              </div>
            </div>
          )
        })}
      </div>

      {/* Live log */}
      <div className="dlg-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--dlg-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="t-label" style={{ color: 'var(--dlg-text-2)' }}>Live Output</div>
          {state.extracting && <div className="dlg-spinner" />}
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {log.length === 0 && (
            <div className="t-sm" style={{ color: 'var(--dlg-text-3)' }}>Waiting for Claude…</div>
          )}
          {log.map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{CAT_ICON[e.category] || '·'}</span>
              <span className="t-sm" style={{ color: e.category === 'error' ? 'var(--dlg-error)' : 'var(--dlg-text-2)' }}>
                <span style={{ fontWeight: 600, textTransform: 'capitalize', color: 'var(--dlg-text)' }}>{e.category}: </span>
                {e.message}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Result summary */}
      {state.result && (
        <div className="dlg-banner dlg-banner-success" style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 20 }}>✦</span>
          <div>
            <div className="t-sm" style={{ fontWeight: 600 }}>Design system generated for <strong>{state.result?.meta?.name || state.projectName || 'your app'}</strong></div>
            <div className="t-sm">
              {Object.keys(state.result?.variables?.collections || {}).length} variable collections ·{' '}
              {state.result?.styles?.text?.length || 0} text styles ·{' '}
              {state.result?.components?.length || 0} components
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="dlg-btn" onClick={() => go('/upload')}>← Back</button>
        {(state.result || !state.extracting) && (
          <button className="dlg-btn dlg-btn-primary" onClick={() => go('/review')}>
            Review Results →
          </button>
        )}
        {!state.result && !state.extracting && (
          <button className="dlg-btn dlg-btn-primary" onClick={() => { hasStarted.current = false; runExtraction() }}>
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
