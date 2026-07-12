import React, { useRef, useState } from 'react'
import { useApp, go } from '../state.jsx'
import { signInMicrosoft, signInGoogle, providerReady } from '../auth.js'

export default function Upload() {
  const { state, dispatch } = useApp()
  const fileInput = useRef()
  const [drag, setDrag] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [authErr, setAuthErr] = useState('')
  const [signing, setSigning] = useState(false)

  function onFiles(files) {
    const toAdd = []
    Array.from(files).forEach((f) => {
      if (!f.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = (e) => {
        toAdd.push({ id: crypto.randomUUID(), name: f.name, dataUrl: e.target.result, type: f.type })
        if (toAdd.length === files.length) {
          dispatch({ type: 'SET_FILES', files: [...state.uploadedFiles, ...toAdd] })
        }
      }
      reader.readAsDataURL(f)
    })
  }

  function addUrl() {
    const v = urlInput.trim()
    if (!v || state.inputUrls.includes(v)) return
    dispatch({ type: 'SET_URLS', urls: [...state.inputUrls, v] })
    setUrlInput('')
  }

  function removeFile(id) {
    dispatch({ type: 'SET_FILES', files: state.uploadedFiles.filter((f) => f.id !== id) })
  }

  function removeUrl(u) {
    dispatch({ type: 'SET_URLS', urls: state.inputUrls.filter((x) => x !== u) })
  }

  const canContinue = state.uploadedFiles.length > 0 || state.inputUrls.length > 0 || state.description.trim()

  async function trySignIn(provider) {
    setSigning(true); setAuthErr('')
    try {
      const user = provider === 'microsoft' ? await signInMicrosoft() : await (async () => { signInGoogle(); return null })()
      if (user) dispatch({ type: 'SET_USER', user })
    } catch (e) { setAuthErr(e.message) }
    setSigning(false)
  }

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 className="t-h1" style={{ marginBottom: 6 }}>New Design Library</h1>
        <p className="t-body" style={{ color: 'var(--dlg-text-2)' }}>
          Upload screenshots, paste URLs, or describe your app. Claude will extract every component, token, and style.
        </p>
      </div>

      {/* Project name + color hint */}
      <div className="dlg-card" style={{ padding: 20, marginBottom: 20 }}>
        <div className="t-h3" style={{ marginBottom: 16 }}>Project Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="t-label" style={{ display: 'block', marginBottom: 6, color: 'var(--dlg-text-2)' }}>Project Name</label>
            <input className="dlg-input" placeholder="e.g. Compass, Executive Engine…"
              value={state.projectName}
              onChange={(e) => dispatch({ type: 'SET_NAME', name: e.target.value })} />
          </div>
          <div>
            <label className="t-label" style={{ display: 'block', marginBottom: 6, color: 'var(--dlg-text-2)' }}>Primary Brand Color (optional)</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={state.primaryColorHint || '#1B4F5C'}
                onChange={(e) => dispatch({ type: 'SET_COLOR_HINT', color: e.target.value })}
                style={{ width: 38, height: 38, border: '1px solid var(--dlg-border)', borderRadius: 6, cursor: 'pointer', padding: 2 }} />
              <input className="dlg-input" placeholder="#1B4F5C"
                value={state.primaryColorHint}
                onChange={(e) => dispatch({ type: 'SET_COLOR_HINT', color: e.target.value })}
                style={{ flex: 1 }} />
            </div>
          </div>
        </div>
      </div>

      {/* Drop zone */}
      <div className="dlg-card" style={{ padding: 20, marginBottom: 20 }}>
        <div className="t-h3" style={{ marginBottom: 4 }}>Screenshots & Images</div>
        <p className="t-sm" style={{ color: 'var(--dlg-text-2)', marginBottom: 14 }}>
          Drag in your app screens, mockups, or existing Figma exports.
        </p>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files) }}
          onClick={() => fileInput.current?.click()}
          style={{ border: `2px dashed ${drag ? 'var(--dlg-brand)' : 'var(--dlg-border)'}`,
            borderRadius: 'var(--dlg-radius-lg)', padding: 32, textAlign: 'center',
            cursor: 'pointer', background: drag ? 'var(--dlg-brand-soft)' : 'transparent',
            transition: 'all 0.15s', marginBottom: state.uploadedFiles.length ? 16 : 0 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⇑</div>
          <div className="t-body" style={{ color: 'var(--dlg-text-2)' }}>Drop images here or <span style={{ color: 'var(--dlg-brand)', fontWeight: 600 }}>browse</span></div>
          <div className="t-sm" style={{ color: 'var(--dlg-text-3)', marginTop: 4 }}>PNG, JPG, WebP, SVG — any size</div>
          <input ref={fileInput} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => onFiles(e.target.files)} />
        </div>

        {state.uploadedFiles.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
            {state.uploadedFiles.map((f) => (
              <div key={f.id} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--dlg-border)', background: 'var(--dlg-bg)' }}>
                <img src={f.dataUrl} alt={f.name} style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }} />
                <div style={{ padding: '4px 6px', fontSize: 11, color: 'var(--dlg-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                <button onClick={(e) => { e.stopPropagation(); removeFile(f.id) }}
                  style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* URLs */}
      <div className="dlg-card" style={{ padding: 20, marginBottom: 20 }}>
        <div className="t-h3" style={{ marginBottom: 4 }}>Web Links</div>
        <p className="t-sm" style={{ color: 'var(--dlg-text-2)', marginBottom: 14 }}>
          Add links to live apps, design references, or documentation.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input className="dlg-input" placeholder="https://…" value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addUrl()} style={{ flex: 1 }} />
          <button className="dlg-btn dlg-btn-primary" onClick={addUrl}>Add</button>
        </div>
        {state.inputUrls.map((u) => (
          <div key={u} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
            background: 'var(--dlg-bg)', borderRadius: 6, marginBottom: 6, fontSize: 13 }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dlg-brand)' }}>{u}</span>
            <button onClick={() => removeUrl(u)} className="dlg-btn-ghost dlg-btn" style={{ padding: '0 6px', height: 24, fontSize: 16 }}>×</button>
          </div>
        ))}
      </div>

      {/* Description */}
      <div className="dlg-card" style={{ padding: 20, marginBottom: 24 }}>
        <div className="t-h3" style={{ marginBottom: 4 }}>Description</div>
        <p className="t-sm" style={{ color: 'var(--dlg-text-2)', marginBottom: 12 }}>
          Describe the app, its audience, and any known brand guidelines.
        </p>
        <textarea className="dlg-textarea" style={{ minHeight: 100 }}
          placeholder="e.g. Enterprise SaaS for startup founders. Dark teal primary. Uses Inter and SF Mono. Cards with subtle elevation. Sidebar navigation."
          value={state.description}
          onChange={(e) => dispatch({ type: 'SET_DESC', description: e.target.value })} />
      </div>

      {/* Sign-in callout (if not signed in) */}
      {!state.user && (
        <div className="dlg-banner dlg-banner-info" style={{ marginBottom: 20, flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <div className="t-sm" style={{ fontWeight: 600, marginBottom: 2 }}>Sign in to save & revisit your libraries</div>
            <div className="t-sm">Works with any Microsoft or Google work account.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {providerReady.microsoft && (
              <button className="dlg-btn" disabled={signing} onClick={() => trySignIn('microsoft')} style={{ gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 23 23"><path fill="#f25022" d="M0 0h11v11H0z"/><path fill="#00a4ef" d="M0 12h11v11H0z"/><path fill="#7fba00" d="M12 0h11v11H12z"/><path fill="#ffb900" d="M12 12h11v11H12z"/></svg>
                Microsoft
              </button>
            )}
            {providerReady.google && (
              <button className="dlg-btn" disabled={signing} onClick={() => trySignIn('google')} style={{ gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Google
              </button>
            )}
          </div>
          {authErr && <div className="t-sm" style={{ color: 'var(--dlg-error)' }}>{authErr}</div>}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="dlg-btn dlg-btn-primary" disabled={!canContinue} onClick={() => go('/extract')}
          style={{ height: 42, padding: '0 28px', fontSize: 15, gap: 8 }}>
          Extract Design System →
        </button>
      </div>
    </div>
  )
}
