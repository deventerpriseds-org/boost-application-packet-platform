import React, { useState, useEffect } from 'react'
import { useApp } from '../state.jsx'
import { listDesignSystems } from '../api.js'

// Applies a design system's CSS tokens to a scoped container so we can preview
// it without affecting the app shell
function buildPreviewVars(result) {
  if (!result) return {}
  const vars = {}
  const prims = result?.variables?.collections?.Primitives
  if (Array.isArray(prims)) {
    prims.filter((v) => v.type === 'color' || v.resolvedType === 'COLOR').forEach((v) => {
      vars[`--preview-${v.name.replace(/[\s.]/g, '-')}`] = v.value
    })
  }
  const primary = result?.meta?.primaryColor
  if (primary) {
    vars['--preview-brand'] = primary
    vars['--preview-brand-soft'] = primary + '20'
    vars['--preview-text-on-brand'] = '#fff'
  }
  return vars
}

function ComponentShowcase({ result }) {
  const primary = result?.meta?.primaryColor || '#1B4F5C'
  const brandSoft = primary + '20'
  const fonts = [...new Set((result?.styles?.text || []).map((t) => t.fontFamily).filter(Boolean))]
  const bodyFont = fonts[0] || 'Inter, system-ui, sans-serif'
  const headFont = fonts[1] || fonts[0] || 'Inter, system-ui, sans-serif'

  const textStyles = result?.styles?.text || []
  const colors = (() => {
    const out = []
    const prims = result?.variables?.collections?.Primitives
    if (Array.isArray(prims)) prims.filter((v) => v.type === 'color' || v.resolvedType === 'COLOR').slice(0, 16).forEach((v) => out.push({ name: v.name, value: v.value }))
    const styleColors = result?.styles?.color || []
    if (!out.length) styleColors.slice(0, 16).forEach((s) => out.push({ name: s.name, value: s.color || s.value }))
    return out
  })()
  const components = result?.components || []

  const S = {
    // Scoped styles that use the extracted tokens
    brand: primary,
    brandSoft,
    surface: '#fff',
    bg: result?.meta?.bgColor || '#F8F9FA',
    border: result?.meta?.borderColor || '#E2E8F0',
    text: result?.meta?.textColor || '#0F172A',
    text2: '#64748B',
    radius: result?.meta?.buttonRadius || 8,
    cardRadius: result?.meta?.cardRadius || 12,
    bodyFont,
    headFont,
  }

  return (
    <div style={{ fontFamily: S.bodyFont, color: S.text }}>
      {/* Typography */}
      <Section title="Typography">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {textStyles.slice(0, 8).map((ts, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
              <div style={{ width: 100, fontSize: 11, color: S.text2, flexShrink: 0 }}>{ts.name}</div>
              <div style={{ fontFamily: ts.fontFamily || bodyFont, fontSize: Math.min(ts.fontSize || 14, 36), fontWeight: ts.fontWeight || 400, lineHeight: ts.lineHeight || 1.4 }}>
                {ts.name} — The quick brown fox
              </div>
            </div>
          ))}
          {!textStyles.length && (
            <>
              {[{l:'Display', s:36, w:700},{l:'Heading 1', s:28, w:700},{l:'Heading 2', s:22, w:600},{l:'Body', s:15, w:400},{l:'Caption', s:12, w:400}].map((t) => (
                <div key={t.l} style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                  <div style={{ width: 100, fontSize: 11, color: S.text2, flexShrink: 0 }}>{t.l}</div>
                  <div style={{ fontFamily: t.l.includes('Display') || t.l.includes('Head') ? S.headFont : S.bodyFont, fontSize: t.s, fontWeight: t.w }}>The quick brown fox jumps</div>
                </div>
              ))}
            </>
          )}
        </div>
      </Section>

      {/* Colors */}
      <Section title="Colors">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {colors.length ? colors.map((c, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 48, height: 48, borderRadius: 8, background: c.value, border: '1px solid rgba(0,0,0,0.08)' }} />
              <div style={{ fontSize: 10, color: S.text2, textAlign: 'center', maxWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
            </div>
          )) : (
            // Fallback: show mock palette using the primary
            ['50','100','200','300','400','500','600','700','800','900'].map((shade) => (
              <div key={shade} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 48, height: 48, borderRadius: 8, background: S.brand, opacity: parseInt(shade) / 1000, border: '1px solid rgba(0,0,0,0.08)' }} />
                <div style={{ fontSize: 10, color: S.text2 }}>{shade}</div>
              </div>
            ))
          )}
        </div>
      </Section>

      {/* Buttons */}
      <Section title="Buttons">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <Btn bg={S.brand} color="#fff" radius={S.radius} label="Primary" />
          <Btn bg="transparent" color={S.brand} border={S.brand} radius={S.radius} label="Secondary" />
          <Btn bg="transparent" color={S.text2} border={S.border} radius={S.radius} label="Default" />
          <Btn bg="#DC2626" color="#fff" radius={S.radius} label="Destructive" />
          <Btn bg={S.brand} color="#fff" radius={S.radius} label="Disabled" disabled />
          <Btn bg={S.brandSoft} color={S.brand} radius={S.radius} label="Soft" />
        </div>
      </Section>

      {/* Badges & Pills */}
      <Section title="Badges & Pills">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {[
            { bg: S.brandSoft, color: S.brand, label: 'Brand' },
            { bg: '#DCFCE7', color: '#16A34A', label: 'Success' },
            { bg: '#FEF9C3', color: '#D97706', label: 'Warning' },
            { bg: '#FEE2E2', color: '#DC2626', label: 'Error' },
            { bg: '#DBEAFE', color: '#2563EB', label: 'Info' },
            { bg: '#F1F5F9', color: '#64748B', label: 'Neutral' },
          ].map((b) => (
            <span key={b.label} style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 10px', borderRadius: 9999, background: b.bg, color: b.color, fontSize: 12, fontWeight: 500 }}>{b.label}</span>
          ))}
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: 9999, background: S.bg, color: S.text2, fontSize: 13, fontWeight: 500, border: `1px solid ${S.border}` }}>Pill</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: 9999, background: S.brandSoft, color: S.brand, fontSize: 13, fontWeight: 500 }}>Active Pill</span>
        </div>
      </Section>

      {/* Banners */}
      <Section title="Banners">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { bg: '#DBEAFE', color: '#2563EB', icon: 'ℹ', msg: 'This is an informational banner message.' },
            { bg: '#DCFCE7', color: '#16A34A', icon: '✓', msg: 'Action completed successfully.' },
            { bg: '#FEF9C3', color: '#D97706', icon: '⚠', msg: 'Please review before continuing.' },
            { bg: '#FEE2E2', color: '#DC2626', icon: '✕', msg: 'Something went wrong. Please try again.' },
          ].map((b) => (
            <div key={b.icon} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, background: b.bg, color: b.color, fontSize: 14 }}>
              <span style={{ fontSize: 16 }}>{b.icon}</span> {b.msg}
            </div>
          ))}
        </div>
      </Section>

      {/* Form inputs */}
      <Section title="Form Inputs">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: S.text2, marginBottom: 4 }}>Default</label>
            <input readOnly value="Input value" style={{ width: '100%', padding: '0 12px', height: 38, border: `1px solid ${S.border}`, borderRadius: S.radius, background: '#fff', fontSize: 14, outline: 'none', color: S.text }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: S.text2, marginBottom: 4 }}>Placeholder</label>
            <input readOnly placeholder="Placeholder text" style={{ width: '100%', padding: '0 12px', height: 38, border: `1px solid ${S.border}`, borderRadius: S.radius, background: '#fff', fontSize: 14, outline: 'none', color: S.text }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: S.text2, marginBottom: 4 }}>Focused</label>
            <input readOnly value="Active state" style={{ width: '100%', padding: '0 12px', height: 38, border: `2px solid ${S.brand}`, borderRadius: S.radius, background: '#fff', fontSize: 14, outline: 'none', color: S.text }} />
          </div>
        </div>
      </Section>

      {/* Cards */}
      <Section title="Cards">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          <div style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: S.cardRadius, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Basic Card</div>
            <div style={{ fontSize: 13, color: S.text2 }}>Card with subtle shadow and border.</div>
          </div>
          <div style={{ background: S.surface, border: `1px solid ${S.brand}`, borderRadius: S.cardRadius, padding: 18 }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: S.brand }}>Brand Card</div>
            <div style={{ fontSize: 13, color: S.text2 }}>Card with brand border accent.</div>
          </div>
          <div style={{ background: S.brand, borderRadius: S.cardRadius, padding: 18 }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: '#fff' }}>Filled Card</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>Brand filled card variant.</div>
          </div>
        </div>
      </Section>

      {/* Components extracted */}
      {components.length > 0 && (
        <Section title={`Components (${components.length} extracted)`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {components.map((c, i) => (
              <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: S.bg, border: `1px solid ${S.border}`, borderRadius: 8, fontSize: 13 }}>
                <span style={{ color: S.brand }}>▦</span> {c.name}
                {c.variants?.length > 0 && <span style={{ fontSize: 11, color: S.text2 }}>×{c.variants.length}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--dlg-text-2)' }}>{title}</div>
        <div style={{ flex: 1, height: 1, background: 'var(--dlg-border)' }} />
      </div>
      {children}
    </div>
  )
}

function Btn({ bg, color, border, radius, label, disabled }) {
  return (
    <button disabled={disabled}
      style={{ display: 'inline-flex', alignItems: 'center', padding: '0 16px', height: 38, borderRadius: radius, background: bg, color, border: border ? `1px solid ${border}` : '1px solid transparent', fontWeight: 500, fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, fontFamily: 'inherit' }}>
      {label}
    </button>
  )
}

export default function Showcase() {
  const { state, dispatch } = useApp()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (state.user && !state.savedSystems.length) {
      setLoading(true)
      listDesignSystems().then((systems) => {
        dispatch({ type: 'SET_SAVED', systems })
        if (systems.length && !state.activeSystemId) dispatch({ type: 'SET_ACTIVE', id: systems[0].id })
        setLoading(false)
      }).catch(() => setLoading(false))
    }
  }, [state.user])

  // Current session result + any saved systems
  const options = [
    ...(state.result ? [{ id: '__current', meta: { name: state.projectName || 'Current Session' }, ...state.result }] : []),
    ...state.savedSystems,
  ]

  const activeId = state.activeSystemId || (state.result ? '__current' : null)
  const activeSystem = options.find((s) => s.id === activeId) || options[0]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Showcase top bar */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--dlg-border)', background: 'var(--dlg-surface)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="t-h3">Design System Showcase</div>
        <div style={{ flex: 1 }} />
        {loading && <div className="dlg-spinner" />}
        {options.length > 0 ? (
          <select
            value={activeId || ''}
            onChange={(e) => dispatch({ type: 'SET_ACTIVE', id: e.target.value })}
            style={{ height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--dlg-border)', background: 'var(--dlg-surface)', color: 'var(--dlg-text)', fontSize: 14, cursor: 'pointer', minWidth: 180, fontFamily: 'inherit' }}>
            {options.map((s) => (
              <option key={s.id} value={s.id}>{s.meta?.name || s.projectName || s.id}</option>
            ))}
          </select>
        ) : (
          <span className="t-sm" style={{ color: 'var(--dlg-text-3)' }}>
            {state.user ? 'No saved libraries yet' : 'Extract a design system to preview it here'}
          </span>
        )}
      </div>

      {/* Preview area */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24, background: 'var(--dlg-bg)' }}>
        {activeSystem ? (
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
              {activeSystem.meta?.primaryColor && (
                <div style={{ width: 28, height: 28, borderRadius: 6, background: activeSystem.meta.primaryColor, flexShrink: 0, border: '2px solid rgba(0,0,0,0.1)' }} />
              )}
              <div>
                <div className="t-h2">{activeSystem.meta?.name || 'Untitled System'}</div>
                {activeSystem.meta?.extractedAt && (
                  <div className="t-xs" style={{ color: 'var(--dlg-text-3)' }}>
                    Generated {new Date(activeSystem.meta.extractedAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
            <ComponentShowcase result={activeSystem} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
            <div style={{ fontSize: 40 }}>▦</div>
            <div className="t-h2" style={{ color: 'var(--dlg-text-2)' }}>Nothing to preview yet</div>
            <p className="t-body" style={{ color: 'var(--dlg-text-3)', textAlign: 'center' }}>
              Extract a design system first, then come here to see all components live.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
