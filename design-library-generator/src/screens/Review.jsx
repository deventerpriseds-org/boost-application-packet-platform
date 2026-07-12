import React, { useState } from 'react'
import { useApp, go } from '../state.jsx'

const TABS = ['Colors', 'Typography', 'Tokens', 'Components', 'Effects']

function ColorGrid({ colors }) {
  if (!colors?.length) return <Empty label="No colors extracted" />
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
      {colors.map((c, i) => (
        <div key={i} className="dlg-card" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="dlg-swatch" style={{ background: c.value || c.hex || c.color }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
            <div className="t-mono" style={{ color: 'var(--dlg-text-2)', fontSize: 11 }}>{c.value || c.hex || c.color}</div>
            {c.usage && <div className="t-xs" style={{ color: 'var(--dlg-text-3)' }}>{c.usage}</div>}
          </div>
          {c.confidence && (
            <span className={`dlg-badge dlg-badge-${c.confidence === 'extracted' ? 'success' : 'warning'}`} style={{ fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>
              {c.confidence}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function TypographyList({ styles }) {
  if (!styles?.length) return <Empty label="No text styles extracted" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {styles.map((s, i) => (
        <div key={i} className="dlg-card" style={{ padding: '14px 16px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 120, flex: '0 0 auto' }}>
            <div style={{ fontSize: 12, color: 'var(--dlg-text-3)', marginBottom: 2 }}>{s.name}</div>
            <div style={{ fontFamily: s.fontFamily || 'inherit', fontSize: Math.min(s.fontSize || 16, 32), fontWeight: s.fontWeight || 400, lineHeight: s.lineHeight || 1.5 }}>
              {s.name}
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {s.fontFamily && <Chip label="Font" value={s.fontFamily} />}
            {s.fontSize && <Chip label="Size" value={`${s.fontSize}px`} />}
            {s.fontWeight && <Chip label="Weight" value={String(s.fontWeight)} />}
            {s.lineHeight && <Chip label="Line" value={String(s.lineHeight)} />}
            {s.letterSpacing != null && <Chip label="Tracking" value={`${s.letterSpacing}em`} />}
          </div>
        </div>
      ))}
    </div>
  )
}

function TokenTable({ tokens }) {
  if (!tokens?.length) return <Empty label="No semantic tokens extracted" />
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--dlg-border)' }}>
            {['Name', 'Light', 'Dark', 'Type'].map((h) => (
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--dlg-text-2)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tokens.map((t, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--dlg-border-soft)' }}>
              <td style={{ padding: '8px 12px' }}>
                <span className="t-mono" style={{ color: 'var(--dlg-brand)', fontSize: 12 }}>{t.name}</span>
              </td>
              <td style={{ padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t.lightValue && isColor(t.lightValue) && <div className="dlg-swatch" style={{ width: 20, height: 20, background: t.lightValue }} />}
                  <span className="t-mono" style={{ fontSize: 12 }}>{t.lightValue || t.value || '—'}</span>
                </div>
              </td>
              <td style={{ padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t.darkValue && isColor(t.darkValue) && <div className="dlg-swatch" style={{ width: 20, height: 20, background: t.darkValue }} />}
                  <span className="t-mono" style={{ fontSize: 12 }}>{t.darkValue || '—'}</span>
                </div>
              </td>
              <td style={{ padding: '8px 12px' }}>
                <span className="dlg-badge dlg-badge-brand">{t.type || 'color'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ComponentGrid({ components }) {
  if (!components?.length) return <Empty label="No components extracted" />
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
      {components.map((c, i) => (
        <div key={i} className="dlg-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--dlg-brand-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>▦</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
              <div style={{ fontSize: 11, color: 'var(--dlg-text-3)' }}>{c.category || 'Component'}</div>
            </div>
          </div>
          {c.variants?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div className="t-xs" style={{ color: 'var(--dlg-text-3)', marginBottom: 4 }}>VARIANTS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {c.variants.map((v, j) => <span key={j} className="dlg-pill" style={{ fontSize: 11, padding: '2px 7px' }}>{v}</span>)}
              </div>
            </div>
          )}
          {c.tokenBindings?.length > 0 && (
            <div>
              <div className="t-xs" style={{ color: 'var(--dlg-text-3)', marginBottom: 4 }}>TOKEN BINDINGS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {c.tokenBindings.slice(0, 3).map((b, j) => (
                  <div key={j} className="t-mono" style={{ fontSize: 11, color: 'var(--dlg-text-2)' }}>{b}</div>
                ))}
                {c.tokenBindings.length > 3 && <div className="t-xs" style={{ color: 'var(--dlg-text-3)' }}>+{c.tokenBindings.length - 3} more</div>}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function EffectList({ effects }) {
  if (!effects?.length) return <Empty label="No effects extracted" />
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
      {effects.map((e, i) => (
        <div key={i} className="dlg-card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{e.name}</div>
          <div className="t-mono" style={{ fontSize: 11, color: 'var(--dlg-text-2)' }}>{e.value || e.css || 'see token'}</div>
          {e.type && <span className="dlg-badge dlg-badge-info" style={{ marginTop: 8, fontSize: 10 }}>{e.type}</span>}
        </div>
      ))}
    </div>
  )
}

function Chip({ label, value }) {
  return (
    <div style={{ fontSize: 12 }}>
      <span style={{ color: 'var(--dlg-text-3)' }}>{label}: </span>
      <span className="t-mono">{value}</span>
    </div>
  )
}

function Empty({ label }) {
  return <div style={{ padding: 32, textAlign: 'center', color: 'var(--dlg-text-3)' }}>{label}</div>
}

function isColor(v) {
  return v && (v.startsWith('#') || v.startsWith('rgb') || v.startsWith('hsl'))
}

function flattenColors(result) {
  const out = []
  const prims = result?.variables?.collections?.Primitives
  if (Array.isArray(prims)) {
    prims.filter((v) => v.type === 'color' || v.resolvedType === 'COLOR').forEach((v) => out.push({ name: v.name, value: v.value, confidence: 'extracted' }))
  } else if (prims && typeof prims === 'object') {
    Object.entries(prims).forEach(([n, v]) => {
      if (typeof v === 'string' && (v.startsWith('#') || v.startsWith('rgb'))) out.push({ name: n, value: v, confidence: 'extracted' })
    })
  }
  const styles = result?.styles?.color
  if (Array.isArray(styles)) styles.forEach((s) => out.push({ name: s.name, value: s.color || s.value, usage: s.usage, confidence: 'style' }))
  return out
}

function flattenTokens(result) {
  const out = []
  const tok = result?.variables?.collections?.Tokens
  if (Array.isArray(tok)) return tok.map((t) => ({ name: t.name, lightValue: t.lightValue || t.value, darkValue: t.darkValue, type: t.resolvedType || t.type || 'color' }))
  if (tok && typeof tok === 'object') {
    Object.entries(tok).forEach(([n, v]) => out.push({ name: n, lightValue: typeof v === 'string' ? v : v?.light, darkValue: v?.dark, type: 'color' }))
  }
  return out
}

export default function Review() {
  const { state, dispatch } = useApp()
  const [tab, setTab] = useState('Colors')

  if (!state.result) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: 32 }}>
        <div className="t-h2">No design system loaded</div>
        <p className="t-body" style={{ color: 'var(--dlg-text-2)' }}>Go through Upload → Extract first.</p>
        <button className="dlg-btn dlg-btn-primary" onClick={() => go('/upload')}>Start Over</button>
      </div>
    )
  }

  const r = state.result
  const colors = flattenColors(r)
  const textStyles = r?.styles?.text || []
  const tokens = flattenTokens(r)
  const components = r?.components || []
  const effects = r?.styles?.effects || []

  const counts = { Colors: colors.length, Typography: textStyles.length, Tokens: tokens.length, Components: components.length, Effects: effects.length }

  return (
    <div style={{ padding: '28px 24px' }}>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="t-h1" style={{ marginBottom: 4 }}>{r.meta?.name || state.projectName || 'Design System'}</h1>
          <p className="t-sm" style={{ color: 'var(--dlg-text-2)' }}>
            Review and edit the extracted design tokens, then export.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="dlg-btn" onClick={() => go('/extract')}>← Re-extract</button>
          <button className="dlg-btn dlg-btn-primary" onClick={() => go('/export')}>Export →</button>
        </div>
      </div>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.entries(counts).map(([k, v]) => (
          <span key={k} className="dlg-badge dlg-badge-brand">{v} {k}</span>
        ))}
        {r.meta?.primaryColor && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} className="dlg-badge dlg-badge-info">
            <div className="dlg-swatch" style={{ width: 14, height: 14, background: r.meta.primaryColor, border: 'none', borderRadius: 3 }} />
            {r.meta.primaryColor}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t} className={`dlg-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t} {counts[t] > 0 && <span style={{ fontSize: 11, opacity: 0.7 }}>({counts[t]})</span>}
          </button>
        ))}
      </div>

      {tab === 'Colors' && <ColorGrid colors={colors} />}
      {tab === 'Typography' && <TypographyList styles={textStyles} />}
      {tab === 'Tokens' && <TokenTable tokens={tokens} />}
      {tab === 'Components' && <ComponentGrid components={components} />}
      {tab === 'Effects' && <EffectList effects={effects} />}
    </div>
  )
}
