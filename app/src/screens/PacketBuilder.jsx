import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useApp, go } from '../state.jsx'
import { api } from '../api.js'
import { Pill } from '../shell.jsx'
import { Loading, ErrorBox } from './Today.jsx'

const TYPE_LABEL = {
  resume: 'Resume', compact_resume: 'Compact resume', cover: 'Cover letter',
  portfolio: 'Portfolio one-pager', video: 'Intro video',
}
const TYPE_SUB = {
  resume: 'Keyword-tailored from your master resume',
  compact_resume: 'One-page version that fits without overflow',
  cover: 'Specific to company & role',
  portfolio: '3 case studies mapped to pain points',
  video: '90-second tailored open — Script + record',
}
const STATUS_TONE = { todo: 'panel', drafting: 'yellow', review: 'accent', changes: 'red', approved: 'green' }

// Steps in the packet workflow
const STEPS = [
  { key: 'jd',       num: 1, label: 'JD analysis',   sub: 'Extract keywords & ATS terms' },
  { key: 'resume',   num: 2, label: 'Resume',         sub: 'Keyword-tailored from master' },
  { key: 'cover',    num: 3, label: 'Cover letter',   sub: 'Tailored narrative' },
  { key: 'portfolio',num: 4, label: 'Portfolio',      sub: 'Assemble work samples' },
  { key: 'video',    num: 5, label: 'Intro video',    sub: 'Script + record 60s' },
  { key: 'send',     num: 6, label: 'Review & send',  sub: 'Approval rounds' },
]

// Shared artifact step for compact_resume — rendered inside Resume step
const ARTIFACT_TYPES = ['resume', 'compact_resume', 'cover', 'portfolio', 'video']

function StepCircle({ num, done, active }) {
  const bg = done ? 'var(--proto-green)' : active ? 'var(--surface-brand-default)' : 'var(--proto-panel-deep)'
  const color = done || active ? '#fff' : 'var(--proto-ink2)'
  return (
    <div style={{
      width: 28, height: 28, borderRadius: '50%', background: bg, color, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700,
    }}>
      {done ? '✓' : num}
    </div>
  )
}

function stepDone(key, p, artifacts) {
  if (key === 'jd') return !!p?.jdAnalyzed
  if (key === 'send') return p?.status === 'ready'
  const types = key === 'resume' ? ['resume', 'compact_resume'] : [key]
  return types.every((t) => {
    const a = artifacts.find((x) => x.type === t)
    return a && a.status === 'approved'
  })
}

function ArtifactCard({ a, busy, setBusy, onGenerate, onSetStatus, onMakeDoc, onMakeSlides, onGenVideo, onArchiveVideo, doc, video }) {
  const [open, setOpen] = useState(false)
  const v = video[a.id] || {}
  const d = doc[a.id] || {}
  const videoUrl = v.url || a.docUrl
  const driveUrl = v.driveUrl || a.driveUrl

  return (
    <div className="px-box" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{TYPE_LABEL[a.type]}</div>
          <div className="px-small" style={{ marginTop: 2 }}>{TYPE_SUB[a.type]}</div>
        </div>
        <Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>
      </div>

      {a.content && (
        <div>
          <span className="px-link" style={{ fontSize: 12 }} onClick={() => setOpen((x) => !x)}>
            {open ? '▾ Hide draft' : '▸ View draft'}
          </span>
          {open && (
            <div className="px-box" style={{ padding: 10, marginTop: 6, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', background: 'var(--proto-panel)' }}>
              {a.content}
            </div>
          )}
        </div>
      )}

      {/* Video */}
      {a.type === 'video' && (
        videoUrl ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <video controls src={videoUrl} style={{ width: '100%', borderRadius: 8, background: '#000', maxHeight: 220 }} />
            {driveUrl
              ? <a href={driveUrl} target="_blank" rel="noreferrer" className="px-link" style={{ fontSize: 12 }}>✓ Saved to Google Drive ↗</a>
              : <button className="px-btn" style={{ fontSize: 12, alignSelf: 'flex-start' }} disabled={v.archiving} onClick={() => onArchiveVideo(a)}>
                  {v.archiving ? 'Saving…' : '⬇ Save to Drive'}
                </button>
            }
          </div>
        ) : v.status === 'processing' ? (
          <div className="px-box" style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--proto-ink2)' }}>
            🎬 Rendering your clone video… (a couple minutes)
          </div>
        ) : (
          <button className="px-btn px-btn-accent" disabled={!a.content} onClick={() => onGenVideo(a)} style={{ alignSelf: 'flex-start' }}>
            🎥 Generate clone video
          </button>
        )
      )}

      {/* Doc / Slides */}
      {a.type !== 'video' && (
        a.docUrl ? (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <a href={a.docUrl} target="_blank" rel="noreferrer" className="px-link" style={{ fontSize: 12 }}>
              {a.docUrl.includes('/presentation/') ? '✓ Open Slides ↗' : '✓ Open Google Doc ↗'}
            </a>
            <span className="px-link" style={{ fontSize: 12, cursor: 'pointer' }}
              onClick={() => { try { navigator.clipboard?.writeText(api.trackedLink(a.id)) } catch {} }}>
              ⎘ Copy tracked link
            </span>
          </div>
        ) : (
          <button className="px-btn" style={{ fontSize: 12, alignSelf: 'flex-start' }} disabled={d.busy}
            onClick={() => (a.type === 'portfolio' || a.type === 'cover') ? onMakeSlides(a) : onMakeDoc(a)}>
            {d.busy
              ? ((a.type === 'portfolio' || a.type === 'cover') ? 'Creating deck…' : 'Creating Doc…')
              : ((a.type === 'portfolio' || a.type === 'cover') ? '▦ Create Slides deck' : '📄 Create Google Doc')}
          </button>
        )
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
        {a.status === 'todo' && (
          <button className="px-btn px-btn-accent" disabled={busy === a.id} onClick={() => onGenerate(a)}>
            {busy === a.id ? 'Generating…' : (a.type === 'video' ? 'Generate script' : 'Generate draft')}
          </button>
        )}
        {(a.status === 'review' || a.status === 'changes') && (
          <>
            <button className="px-btn px-btn-green" onClick={() => onSetStatus(a, 'approved')}>Approve</button>
            <button className="px-btn" disabled={busy === a.id} onClick={() => onGenerate(a)}>
              {busy === a.id ? 'Regenerating…' : 'Regenerate'}
            </button>
            {a.status !== 'changes' && (
              <button className="px-btn" onClick={() => onSetStatus(a, 'changes')}>Request changes</button>
            )}
          </>
        )}
        {a.status === 'approved' && (
          <button className="px-btn" onClick={() => onSetStatus(a, 'review')}>Reopen</button>
        )}
      </div>
    </div>
  )
}

export default function PacketBuilder({ id }) {
  const { toast } = useApp()
  const [pState, setPState] = useState({ loading: true, error: null, packet: null })
  const [opp, setOpp] = useState(null)
  const [busy, setBusy] = useState(null)
  const [video, setVideo] = useState({})
  const [doc, setDoc] = useState({})
  const [jdBusy, setJdBusy] = useState(false)
  const [parseBusy, setParseBusy] = useState(false)
  const [allBusy, setAllBusy] = useState(false)
  const [activeStep, setActiveStep] = useState('jd')
  const pollers = useRef({})

  const load = useCallback(async () => {
    try {
      const [p, o] = await Promise.all([api.getPacket(id), api.getOpportunity(id)])
      if (p.error) throw new Error(p.error)
      setPState({ loading: false, error: null, packet: p })
      if (!o.error) setOpp(o)
      // Auto-advance past JD step if already analyzed
      if (p.jdAnalyzed) setActiveStep((s) => s === 'jd' ? 'resume' : s)
    } catch (err) {
      setPState({ loading: false, error: String(err.message || err), packet: null })
    }
  }, [id])

  useEffect(() => { load() }, [load])
  useEffect(() => () => Object.values(pollers.current).forEach(clearTimeout), [])

  const patchArtifact = (artifactId, fields) => setPState((s) => ({
    ...s,
    packet: { ...s.packet, artifacts: s.packet.artifacts.map((a) => (a.id === artifactId ? { ...a, ...fields } : a)) },
  }))

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

  const makeSlides = async (a) => {
    setDoc((d) => ({ ...d, [a.id]: { busy: true } }))
    try {
      const res = await api.generateArtifactSlides(a.id)
      if (res.error) throw new Error(res.error)
      patchArtifact(a.id, { docUrl: res.deckUrl || res.docUrl })
      setDoc((d) => ({ ...d, [a.id]: { busy: false } }))
      toast('Slides deck created')
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
      setPState((s) => ({ ...s, packet: { ...s.packet, status: res.packetStatus } }))
      toast(`Drafted ${TYPE_LABEL[a.type]}`)
    } catch (err) { toast(`Generate failed: ${err.message || err}`) }
    finally { setBusy(null) }
  }

  const runJd = async () => {
    setJdBusy(true)
    try {
      const r = await api.analyzeJd(id)
      if (r.error) throw new Error(r.error)
      toast(`ATS ${r.analysis?.atsScore ?? '—'} · ${(r.analysis?.keywords || []).length} keywords`)
      load()
      setActiveStep('resume')
    } catch (e) { toast(`JD analysis failed: ${e.message || e}`) }
    finally { setJdBusy(false) }
  }

  const parseJd = async () => {
    setParseBusy(true)
    try {
      const r = await api.parseJd(id)
      if (r.error) throw new Error(r.error)
      toast('JD parsed — summary and requirements updated')
      const o2 = await api.getOpportunity(id)
      if (!o2.error) setOpp(o2)
    } catch (e) { toast(`Parse failed: ${e.message || e}`) }
    finally { setParseBusy(false) }
  }

  const buildAll = async () => {
    setAllBusy(true)
    try {
      const r = await api.buildFullPacket(id, {})
      if (r.error) throw new Error(r.error)
      toast(`Built ${(r.artifacts || []).filter((x) => x.url).length} documents — nothing sent`)
      load()
    } catch (e) { toast(`Build failed: ${e.message || e}`) }
    finally { setAllBusy(false) }
  }

  const pollVideo = useCallback((artifactId) => {
    clearTimeout(pollers.current[artifactId])
    const tick = async () => {
      try {
        const s = await api.artifactVideoStatus(artifactId)
        if (s.error) { setVideo((v) => ({ ...v, [artifactId]: { status: 'error', error: s.error } })); return }
        if (s.status === 'completed' && s.videoUrl) {
          setVideo((v) => ({ ...v, [artifactId]: { status: 'completed', url: s.videoUrl } }))
          patchArtifact(artifactId, { docUrl: s.videoUrl }); return
        }
        if (s.status === 'failed') { setVideo((v) => ({ ...v, [artifactId]: { status: 'error', error: 'render failed' } })); return }
        setVideo((v) => ({ ...v, [artifactId]: { status: 'processing' } }))
        pollers.current[artifactId] = setTimeout(tick, 9000)
      } catch { pollers.current[artifactId] = setTimeout(tick, 9000) }
    }
    tick()
  }, [])

  const genVideo = async (a) => {
    setVideo((v) => ({ ...v, [a.id]: { status: 'processing' } }))
    try {
      const res = await api.generateArtifactVideo(a.id)
      if (res.error) throw new Error(res.error)
      toast('Rendering clone video — a couple minutes')
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
      setPState((s) => ({ ...s, packet: { ...s.packet, status: res.packetStatus } }))
      toast(status === 'approved' ? `Approved ${TYPE_LABEL[a.type]}` : `${TYPE_LABEL[a.type]} → ${status}`)
    } catch (err) { patchArtifact(a.id, { status: prev }); toast(`Update failed: ${err.message || err}`) }
  }

  if (pState.loading) return <Loading />
  if (pState.error) return <ErrorBox error={pState.error} />

  const p = pState.packet
  const artifacts = p.artifacts || []
  const ready = p.status === 'ready'
  const coveredKw = p.coveredKw || []
  const missingKw = p.missingKw || []
  const atsScore = typeof p.atsScore === 'number' ? p.atsScore : null

  const getArtifactsByStep = (stepKey) => {
    if (stepKey === 'resume') return artifacts.filter((a) => a.type === 'resume' || a.type === 'compact_resume')
    return artifacts.filter((a) => a.type === stepKey)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%' }}>
      {/* Top breadcrumb + header */}
      <div style={{ marginBottom: 16 }}>
        <div className="px-small px-link" style={{ marginBottom: 8 }} onClick={() => go('/packets')}>
          ← Packets
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-brand)' }}>
              Packet — {p.company}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>
              {p.company} · {p.role}
            </div>
            <div className="px-small" style={{ marginTop: 2, color: 'var(--proto-ink2)' }}>
              ATS keyword optimization + tailored assets
            </div>
          </div>
          {atsScore !== null && (
            <div style={{ textAlign: 'right' }}>
              <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-brand)', marginBottom: 2 }}>ATS Match</div>
              <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, color: atsScore >= 80 ? 'var(--proto-green)' : atsScore >= 60 ? 'var(--proto-accent)' : 'var(--proto-red)' }}>
                {atsScore}%
              </div>
            </div>
          )}
          {ready
            ? <Pill tone="green">Ready to ship ✓</Pill>
            : allBusy
              ? <Pill tone="yellow">building</Pill>
              : null
          }
          {ready && (
            <button className="px-btn px-btn-accent" onClick={() => go(`/compose/${id}`)}>Send packet →</button>
          )}
        </div>
      </div>

      {/* 3-column layout */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

        {/* Left: step list */}
        <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {STEPS.map((step) => {
            const done = stepDone(step.key, p, artifacts)
            const active = activeStep === step.key
            return (
              <div key={step.key} onClick={() => setActiveStep(step.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8,
                  cursor: 'pointer', background: active ? 'var(--proto-accent-soft)' : 'transparent',
                  border: active ? '1px solid var(--surface-brand-default)' : '1px solid transparent',
                }}>
                <StepCircle num={step.num} done={done} active={active} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: active ? 'var(--text-brand)' : 'var(--proto-ink1)' }}>
                    {step.label}
                  </div>
                  <div className="px-small" style={{ marginTop: 1, color: 'var(--proto-ink2)', fontSize: 11 }}>
                    {step.sub}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Center: step content */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* JD Analysis step */}
          {activeStep === 'jd' && (
            <>
              {/* Opportunity metadata card */}
              <div className="px-box" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Extracted from triggering email</div>
                  {opp?.source && (
                    <Pill tone="accent">{opp.source === 'LinkedIn' ? 'from email' : opp.source}</Pill>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px 0', fontSize: 13 }}>
                  {[
                    ['Source', opp?.source || p.source || '—'],
                    ['Role', opp?.role || p.role || '—'],
                    ['Comp', opp?.comp || '—'],
                    ['Location', opp?.location || '—'],
                    ['Hiring manager', opp?.hm || '—'],
                  ].map(([k, v]) => (
                    <React.Fragment key={k}>
                      <div style={{ color: 'var(--proto-ink2)', fontWeight: 500 }}>{k}</div>
                      <div style={{ fontWeight: 500 }}>{v}</div>
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* JD text */}
              <div className="px-box" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    Job description
                    <span className="px-small" style={{ marginLeft: 8, fontWeight: 400, color: 'var(--proto-ink2)' }}>
                      {opp?.jdTitle ? 'parsed' : 'from email'}
                    </span>
                  </div>
                  <button className="px-btn" style={{ fontSize: 12 }} disabled={parseBusy} onClick={parseJd}>
                    {parseBusy ? 'Parsing…' : (opp?.jdSummary ? '↻ Re-parse JD' : 'Parse JD')}
                  </button>
                </div>
                {opp?.jdSummary ? (
                  <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--proto-ink1)' }}>{opp.jdSummary}</div>
                ) : (
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--proto-ink2)', whiteSpace: 'pre-wrap' }}>
                    {opp?.why || 'No job description text available. Use "Parse JD" to extract it from the source URL.'}
                  </div>
                )}
              </div>

              {/* Run JD / ATS analysis */}
              <div className="px-box" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>ATS keyword analysis</div>
                  <div className="px-small">Match your master baseline against this JD to find coverage gaps</div>
                </div>
                <button className="px-btn px-btn-accent" disabled={jdBusy} onClick={runJd}>
                  {jdBusy ? 'Analyzing…' : (p.jdAnalyzed ? '↻ Re-run ATS analysis' : '⚡ Run ATS analysis')}
                </button>
                <button className="px-btn" style={{ fontSize: 12 }} disabled={allBusy} onClick={buildAll}>
                  {allBusy ? 'Building…' : 'Build entire packet'}
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="px-btn px-btn-accent" onClick={() => setActiveStep('resume')}>
                  Next: Resume →
                </button>
              </div>
            </>
          )}

          {/* Artifact steps */}
          {['resume', 'cover', 'portfolio', 'video'].includes(activeStep) && (() => {
            const stepArtifacts = getArtifactsByStep(activeStep)
            const nextStep = STEPS[STEPS.findIndex((s) => s.key === activeStep) + 1]
            return (
              <>
                {stepArtifacts.length === 0 && (
                  <div className="px-box" style={{ padding: 20, textAlign: 'center', color: 'var(--proto-ink2)', fontSize: 13 }}>
                    No artifact created yet for this step. Use Build entire packet to generate all at once.
                  </div>
                )}
                {stepArtifacts.map((a) => (
                  <ArtifactCard key={a.id} a={a} busy={busy} setBusy={setBusy}
                    onGenerate={generate} onSetStatus={setStatus}
                    onMakeDoc={makeDoc} onMakeSlides={makeSlides}
                    onGenVideo={genVideo} onArchiveVideo={archiveVideo}
                    doc={doc} video={video} />
                ))}
                {nextStep && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="px-btn px-btn-accent" onClick={() => setActiveStep(nextStep.key)}>
                      Next: {nextStep.label} →
                    </button>
                  </div>
                )}
              </>
            )
          })()}

          {/* Review & send step */}
          {activeStep === 'send' && (
            <div className="px-box" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Review & send</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ARTIFACT_TYPES.map((t) => {
                  const a = artifacts.find((x) => x.type === t)
                  if (!a) return null
                  return (
                    <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--proto-rule-soft)' }}>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{TYPE_LABEL[t]}</div>
                      <Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                {ready
                  ? <button className="px-btn px-btn-accent" onClick={() => go(`/compose/${id}`)}>Go to outreach →</button>
                  : <div className="px-small" style={{ color: 'var(--proto-ink2)' }}>Approve all artifacts above to unlock sending.</div>
                }
              </div>
            </div>
          )}
        </div>

        {/* Right: Keywords & ATS panel */}
        <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="px-box" style={{ padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--proto-ink2)', marginBottom: 12 }}>
              Keywords &amp; ATS terms
            </div>

            {atsScore !== null && (
              <div style={{ textAlign: 'center', marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--proto-rule-soft)' }}>
                <div style={{ fontSize: 11, color: 'var(--proto-ink2)', marginBottom: 4 }}>ATS MATCH</div>
                <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, color: atsScore >= 80 ? 'var(--proto-green)' : atsScore >= 60 ? 'var(--proto-accent)' : 'var(--proto-red)' }}>
                  {atsScore}%
                </div>
              </div>
            )}

            {coveredKw.length > 0 || missingKw.length > 0 ? (
              <>
                <div className="px-small" style={{ marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--proto-ink3)' }}>
                  Auto-matched against your master baseline
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {coveredKw.map((kw) => (
                    <span key={kw} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: 'var(--proto-green-soft)', color: 'var(--proto-green)', fontWeight: 600 }}>
                      ✓ {kw}
                    </span>
                  ))}
                  {missingKw.map((kw) => (
                    <span key={kw} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: 'var(--proto-red-soft)', color: 'var(--proto-red)', fontWeight: 600 }}>
                      ! {kw}
                    </span>
                  ))}
                </div>
                <div className="px-small" style={{ color: 'var(--proto-ink3)', marginBottom: 12 }}>
                  ! = must-have still missing · ✓ = already covered · {coveredKw.length}/{coveredKw.length + missingKw.length} terms
                </div>
              </>
            ) : (
              <div className="px-small" style={{ color: 'var(--proto-ink2)', marginBottom: 12 }}>
                {p.jdAnalyzed ? 'No keyword gaps found.' : 'Run ATS analysis to see keyword coverage.'}
              </div>
            )}

            <button className="px-btn px-btn-accent" style={{ width: '100%', marginBottom: 8 }} disabled={allBusy} onClick={buildAll}>
              {allBusy ? 'Building…' : '⚡ Auto-optimize resume'}
            </button>

            {!ready && STEPS.filter((s) => s.key !== 'jd' && s.key !== 'send').map((step) => {
              const sa = getArtifactsByStep(step.key)
              const allApproved = sa.length > 0 && sa.every((a) => a.status === 'approved')
              return (
                <div key={step.key} onClick={() => setActiveStep(step.key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer', borderTop: '1px solid var(--proto-rule-soft)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: allApproved ? 'var(--proto-green)' : sa.some((a) => a.status !== 'todo') ? 'var(--proto-accent)' : 'var(--proto-ink3)' }} />
                  <span style={{ fontSize: 12, flex: 1, color: 'var(--proto-ink1)' }}>{step.label}</span>
                  <span className="px-small">{allApproved ? '✓' : sa.length === 0 ? '—' : sa.find((a) => a.status !== 'todo')?.status || 'todo'}</span>
                </div>
              )
            })}
          </div>

          {atsScore !== null && missingKw.length > 0 && (
            <div className="px-box" style={{ padding: 14 }}>
              <div className="px-small" style={{ fontWeight: 600, marginBottom: 6 }}>
                Your baseline already covers most terms — fill {missingKw.length} gap{missingKw.length !== 1 ? 's' : ''} to top out.
              </div>
              <button className="px-btn" style={{ width: '100%', fontSize: 12 }} onClick={() => setActiveStep('resume')}>
                Next: Resume →
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
