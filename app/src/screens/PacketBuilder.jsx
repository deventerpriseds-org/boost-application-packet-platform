import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useApp, go } from '../state.jsx'
import { api } from '../api.js'
import { Pill } from '../shell.jsx'
import { Loading, ErrorBox } from './Today.jsx'

const TYPE_LABEL = {
  resume: 'Resume', compact_resume: 'Compact resume', cover: 'Cover letter',
  portfolio: 'Portfolio one-pager', video: 'Intro video script',
}
const TYPE_SUB = {
  resume: 'Keyword-tailored from your master resume',
  compact_resume: 'One-page · fits without overflow',
  cover: 'Specific to company & role',
  portfolio: '3 case studies mapped to pain points',
  video: '90-second tailored open',
}
const STATUS_TONE = { todo: 'panel', drafting: 'yellow', review: 'accent', changes: 'red', approved: 'green' }

export default function PacketBuilder({ id }) {
  const { toast } = useApp()
  const [state, setState] = useState({ loading: true, error: null, packet: null })
  const [busy, setBusy] = useState(null) // artifactId currently generating
  const [open, setOpen] = useState(null) // artifactId whose content is expanded
  const [video, setVideo] = useState({}) // {artifactId: {status:'processing'|'completed'|'error', url}}
  const [doc, setDoc] = useState({}) // {artifactId: {busy, error}}
  const pollers = useRef({})

  const load = useCallback(async () => {
    try {
      const p = await api.getPacket(id)
      if (p.error) throw new Error(p.error)
      setState({ loading: false, error: null, packet: p })
    } catch (err) {
      setState({ loading: false, error: String(err.message || err), packet: null })
    }
  }, [id])
  useEffect(() => { load() }, [load])

  const patchArtifact = (artifactId, fields) => setState((s) => ({
    ...s, packet: { ...s.packet, artifacts: s.packet.artifacts.map((a) => (a.id === artifactId ? { ...a, ...fields } : a)) },
  }))

  // Turn the approved/drafted text into a real, shareable Google Doc.
  const makeDoc = async (a) => {
    setDoc((d) => ({ ...d, [a.id]: { busy: true } }))
    try {
      const res = await api.generateArtifactDocument(a.id)
      if (res.error) throw new Error(res.error)
      patchArtifact(a.id, { docUrl: res.docUrl })
      setDoc((d) => ({ ...d, [a.id]: { busy: false } }))
      toast(`Google Doc created for ${TYPE_LABEL[a.type]}`)
    } catch (err) {
      setDoc((d) => ({ ...d, [a.id]: { busy: false, error: String(err.message || err) } }))
      toast(`Doc failed: ${err.message || err}`)
    }
  }

  // Portfolio → a real Google Slides deck.
  const makeSlides = async (a) => {
    setDoc((d) => ({ ...d, [a.id]: { busy: true } }))
    try {
      const res = await api.generateArtifactSlides(a.id)
      if (res.error) throw new Error(res.error)
      patchArtifact(a.id, { docUrl: res.deckUrl || res.docUrl })
      setDoc((d) => ({ ...d, [a.id]: { busy: false } }))
      toast('Slides deck created from template')
    } catch (err) {
      setDoc((d) => ({ ...d, [a.id]: { busy: false, error: String(err.message || err) } }))
      toast(`Deck failed: ${err.message || err}`)
    }
  }

  const generate = async (a) => {
    setBusy(a.id)
    try {
      const res = await api.generateArtifact(a.id)
      if (res.error) throw new Error(res.error)
      patchArtifact(a.id, { status: res.artifactStatus, content: res.content })
      setState((s) => ({ ...s, packet: { ...s.packet, status: res.packetStatus } }))
      setOpen(a.id)
      toast(`Drafted ${TYPE_LABEL[a.type]}`)
    } catch (err) { toast(`Generate failed: ${err.message || err}`) }
    finally { setBusy(null) }
  }

  // Clone intro-video: submit a HeyGen render, then poll until the MP4 is ready.
  const pollVideo = useCallback((artifactId) => {
    clearTimeout(pollers.current[artifactId])
    const tick = async () => {
      try {
        const s = await api.artifactVideoStatus(artifactId)
        if (s.error) { setVideo((v) => ({ ...v, [artifactId]: { status: 'error', error: s.error } })); return }
        if (s.status === 'completed' && s.videoUrl) {
          setVideo((v) => ({ ...v, [artifactId]: { status: 'completed', url: s.videoUrl } }))
          patchArtifact(artifactId, { docUrl: s.videoUrl })
          return
        }
        if (s.status === 'failed') { setVideo((v) => ({ ...v, [artifactId]: { status: 'error', error: 'render failed' } })); return }
        setVideo((v) => ({ ...v, [artifactId]: { status: 'processing' } }))
        pollers.current[artifactId] = setTimeout(tick, 9000)
      } catch { pollers.current[artifactId] = setTimeout(tick, 9000) }
    }
    tick()
  }, [])

  useEffect(() => () => Object.values(pollers.current).forEach(clearTimeout), [])

  const genVideo = async (a) => {
    setVideo((v) => ({ ...v, [a.id]: { status: 'processing' } }))
    try {
      const res = await api.generateArtifactVideo(a.id)
      if (res.error) throw new Error(res.error)
      toast('Rendering clone video — this takes a couple minutes')
      pollVideo(a.id)
    } catch (err) { setVideo((v) => ({ ...v, [a.id]: { status: 'error', error: String(err.message || err) } })); toast(`Video failed: ${err.message || err}`) }
  }

  const archiveVideo = async (a) => {
    setVideo((v) => ({ ...v, [a.id]: { ...v[a.id], archiving: true } }))
    try {
      const res = await api.archiveArtifactVideo(a.id)
      if (res.error) throw new Error(res.error)
      setVideo((v) => ({ ...v, [a.id]: { ...v[a.id], archiving: false, driveUrl: res.driveUrl } }))
      patchArtifact(a.id, { driveUrl: res.driveUrl })
      toast('Saved to Google Drive')
    } catch (err) { setVideo((v) => ({ ...v, [a.id]: { ...v[a.id], archiving: false } })); toast(`Archive failed: ${err.message || err}`) }
  }

  const setStatus = async (a, status) => {
    const prev = a.status
    patchArtifact(a.id, { status })
    try {
      const res = await api.setArtifactStatus(a.id, status)
      if (res.error) throw new Error(res.error)
      setState((s) => ({ ...s, packet: { ...s.packet, status: res.packetStatus } }))
      toast(status === 'approved' ? `Approved ${TYPE_LABEL[a.type]}` : `${TYPE_LABEL[a.type]} → ${status}`)
    } catch (err) { patchArtifact(a.id, { status: prev }); toast(`Update failed: ${err.message || err}`) }
  }

  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox error={state.error} />
  const p = state.packet
  const pct = p.total ? Math.round((p.approved / p.total) * 100) : 0
  const ready = p.status === 'ready'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="px-small px-link" onClick={() => go(`/opp/${id}/overview`)}>← Back to opportunity</div>

      {/* Header */}
      <div className="px-box" style={{ padding: 16, borderColor: ready ? 'var(--proto-green)' : 'var(--surface-brand-default)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-brand)' }}>Application packet</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{p.company} — {p.role}</div>
            <div className="px-small" style={{ marginTop: 2 }}>{p.approved}/{p.total} artifacts approved · packet {p.status}</div>
          </div>
          <div style={{ width: 160 }}>
            <div style={{ height: 8, background: 'var(--proto-panel-deep)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: ready ? 'var(--proto-green)' : 'var(--surface-brand-default)', transition: 'width 300ms ease' }} />
            </div>
          </div>
        </div>
        {ready && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Pill tone="green">Ready to ship ✓</Pill>
            <button className="px-btn px-btn-accent" onClick={() => toast('Sending is wired in the Outreach slice.')}>Ship packet →</button>
          </div>
        )}
      </div>

      {/* Artifact grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        {p.artifacts.map((a) => {
          const isOpen = open === a.id
          return (
            <div key={a.id} className="px-box" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{TYPE_LABEL[a.type]}</div>
                  <div className="px-small">{TYPE_SUB[a.type]}</div>
                </div>
                <Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>
              </div>

              {a.content && (
                <div>
                  <div onClick={() => setOpen(isOpen ? null : a.id)} className="px-link" style={{ fontSize: 12 }}>
                    {isOpen ? '▾ Hide draft' : '▸ View draft'}
                  </div>
                  {isOpen && (
                    <div className="px-box" style={{ padding: 10, marginTop: 6, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto', background: 'var(--proto-panel)' }}>
                      {a.content}
                    </div>
                  )}
                </div>
              )}

              {/* Clone intro-video */}
              {a.type === 'video' && (() => {
                const v = video[a.id] || {}
                const url = v.url || a.docUrl
                const driveUrl = v.driveUrl || a.driveUrl
                if (url) return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <video controls src={url} style={{ width: '100%', borderRadius: 8, background: '#000', maxHeight: 240 }} />
                    {driveUrl ? (
                      <a href={driveUrl} target="_blank" rel="noreferrer" className="px-link" style={{ fontSize: 12 }}>✓ Saved to Google Drive ↗</a>
                    ) : (
                      <button className="px-btn" style={{ fontSize: 12, alignSelf: 'flex-start' }} disabled={v.archiving} onClick={() => archiveVideo(a)}>
                        {v.archiving ? 'Saving to Drive…' : '⬇ Save to Drive (permanent copy)'}
                      </button>
                    )}
                  </div>
                )
                if (v.status === 'processing') return (
                  <div className="px-box" style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--proto-ink2)', background: 'var(--proto-panel)' }}>
                    🎬 Rendering your clone video… (a couple minutes — you can keep working)
                  </div>
                )
                return (
                  <button className="px-btn px-btn-accent" disabled={!a.content} title={a.content ? '' : 'Generate the script first'}
                    onClick={() => genVideo(a)} style={{ alignSelf: 'flex-start' }}>
                    🎥 Generate clone video
                  </button>
                )
              })()}

              {/* Real Google Doc/Slides by TEMPLATE FILL (copy template → fill placeholders). */}
              {a.type !== 'video' && (a.content || ['resume', 'compact_resume', 'cover', 'portfolio'].includes(a.type)) && (() => {
                const d = doc[a.id] || {}
                const isDeck = a.type === 'portfolio' || a.type === 'cover'
                if (a.docUrl) return (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <a href={a.docUrl} target="_blank" rel="noreferrer" className="px-link" style={{ fontSize: 12 }}>{(a.docUrl || '').includes('/presentation/') ? '✓ Open Slides deck ↗' : '✓ Open Google Doc ↗'}</a>
                    <span className="px-link" style={{ fontSize: 12, cursor: 'pointer' }}
                      onClick={() => { try { navigator.clipboard?.writeText(api.trackedLink(a.id)) } catch {} toast('Tracked link copied — opens are logged in Library ▸ Assets') }}>⎘ Copy tracked link</span>
                  </div>
                )
                return (
                  <button className="px-btn" style={{ fontSize: 12, alignSelf: 'flex-start' }} disabled={d.busy} onClick={() => (isDeck ? makeSlides(a) : makeDoc(a))}>
                    {d.busy ? (isDeck ? 'Creating deck…' : 'Creating Doc…') : (isDeck ? '▦ Create Slides deck' : '📄 Create Google Doc')}
                  </button>
                )
              })()}

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                {a.status === 'todo' && (
                  <button className="px-btn px-btn-accent" disabled={busy === a.id} onClick={() => generate(a)}>
                    {busy === a.id ? 'Generating…' : (a.type === 'video' ? 'Generate script' : 'Generate draft')}
                  </button>
                )}
                {(a.status === 'review' || a.status === 'changes') && (
                  <>
                    <button className="px-btn px-btn-green" onClick={() => setStatus(a, 'approved')}>Approve</button>
                    <button className="px-btn" disabled={busy === a.id} onClick={() => generate(a)}>{busy === a.id ? 'Regenerating…' : 'Regenerate'}</button>
                    {a.status !== 'changes' && <button className="px-btn" onClick={() => setStatus(a, 'changes')}>Request changes</button>}
                  </>
                )}
                {a.status === 'approved' && (
                  <button className="px-btn" onClick={() => setStatus(a, 'review')}>Reopen</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
