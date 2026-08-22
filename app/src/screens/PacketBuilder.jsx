import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useApp, go, useIsMobile } from '../state.jsx'
import { api } from '../api.js'
import { Pill, toneColor } from '../shell.jsx'
import { Loading, ErrorBox } from './Today.jsx'
import AssetBlocks, { useAssetProvenance } from './AssetBlocks.jsx'
import { registerListOwners } from '../assetBlocks.js'
import {
  PostingAnalysisCard, AnalysisRunCard, KeywordTallyOverlay, MatchEstimateButton, ProfileLink,
  ProfileCompareCard,
} from './PostingAnalysis.jsx'
import { postingBody } from '../postingAnalysis.js'
import { PACKET_HOOKS, ASSET_HEADER_DEFAULT_OPEN } from '../packetBuilder.js'
import QcRail, { useQcEntries } from './QcRail.jsx'
import { qcStepState, packetGate, railGateMeta } from '../qcRail.js'

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
  // "ATS" is reserved for the keyword library and its coverage (P5.4). Step 1 extracts
  // responsibilities and requirements from the posting — that is posting analysis, not ATS.
  { key: 'jd',       num: 1, label: 'Posting analysis', sub: 'Requirements, responsibilities, keywords' },
  { key: 'resume',   num: 2, label: 'Resume',         sub: 'Keyword-tailored from master' },
  { key: 'cover',    num: 3, label: 'Cover letter',   sub: 'Tailored narrative' },
  { key: 'portfolio',num: 4, label: 'Portfolio',      sub: 'Assemble work samples' },
  { key: 'video',    num: 5, label: 'Intro video',    sub: 'Script + record 60s' },
  // P5.1 - QC sits between the assets and sending, because it is the step that decides whether the
  // packet may be sent at all. Its circle takes the PACKET GATE colour rather than the generic
  // green tick: a step that is complete and a step that is clear are different statements.
  { key: 'qc',       num: 6, label: 'QC & evidence',  sub: 'Coverage, checks, review' },
  { key: 'send',     num: 7, label: 'Review & send',  sub: 'Approval rounds' },
]

// Shared artifact step for compact_resume — rendered inside Resume step
const ARTIFACT_TYPES = ['resume', 'compact_resume', 'cover', 'portfolio', 'video']

function StepCircle({ num, done, active, tone }) {
  // `tone` is resolved through toneColor() - never by interpolating the tone into a custom-property
  // name, which is the bug that made the `todo` pill invisible.
  const bg = tone ? toneColor(tone) : done ? 'var(--proto-green)' : active ? 'var(--surface-brand-default)' : 'var(--proto-panel-deep)'
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

// `qc` is deliberately NOT the rule the asset steps use. An asset step is done when the artifact is
// `approved`, and every historical approved artifact in this database has ZERO check rows - approval
// predates the checks engine. So the QC step is GATE-driven instead: qcStepState() restates
// approvalBlock() over the whole packet, and an unchecked asset keeps the step open.
function stepDone(key, p, artifacts, qc) {
  if (key === 'jd') return !!p?.jdAnalyzed
  if (key === 'qc') return !!(qc && qc.done)
  if (key === 'send') return p?.status === 'ready'
  const types = key === 'resume' ? ['resume', 'compact_resume'] : [key]
  return types.every((t) => {
    const a = artifacts.find((x) => x.type === t)
    return a && a.status === 'approved'
  })
}

// Exported so the browser probe can mount the REAL card (test/browser/run-asset-blocks.mjs). The
// header's collapsed default is a rendering fact; asserting it against a replica of this component
// would prove only that the replica was written to match.
export function ArtifactCard({ a, busy, setBusy, onGenerate, onSetStatus, onMakeDoc, onMakeSlides, onGenVideo, onArchiveVideo, doc, video, provenance, listOwners, onListsRendered }) {
  const v = video[a.id] || {}
  const d = doc[a.id] || {}
  const videoUrl = v.url || a.docUrl
  const driveUrl = v.driveUrl || a.driveUrl
  // P8.7: "Asset headers are collapsed by default." The default is a named constant in
  // ../packetBuilder.js, not a bare `false`, so one test can assert it beside AssetBlocks'
  // opposite default and fail if a fix flips the wrong one.
  //
  // This is NOT in tension with the block's `defaultOpen = true` below. They are two disclosures
  // around two different objects: this one wraps the whole ARTIFACT, that one wraps the merge
  // FIELDS inside it. Opening this header therefore reveals the fields already open - one click,
  // not two - which is exactly the arrangement the plan describes and warns is easy to misread.
  const [open, setOpen] = useState(ASSET_HEADER_DEFAULT_OPEN)
  const toggle = () => setOpen((o) => !o)

  return (
    <div className="px-box" data-qc={PACKET_HOOKS.assetCard} data-qc-type={a.type}
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div data-qc={PACKET_HOOKS.assetHeader} data-qc-open={open ? '1' : '0'} data-qc-type={a.type}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{TYPE_LABEL[a.type]}</div>
          <div className="px-small" style={{ marginTop: 2 }}>{TYPE_SUB[a.type]}</div>
        </div>
        <Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>
        <span className="px-link" role="button" tabIndex={0} onClick={toggle}
          data-qc={PACKET_HOOKS.assetToggle} data-qc-open={open ? '1' : '0'}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
          aria-expanded={open} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {open ? 'Hide' : 'Show'}
        </span>
      </div>

      {open && (
      <div data-qc={PACKET_HOOKS.assetBody} style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
      {/* P5.2 — the draft is the point of the screen, so it renders OPEN, one card per merge field,
          with the provenance for that field beside it. It replaced a collapsed `content` dump that
          could not distinguish generated text from static template text. */}
      {(a.status !== 'todo' || a.content) && (
        <AssetBlocks artifact={a} provenance={provenance} fallback={a.content}
          label={TYPE_LABEL[a.type] || a.type} listOwners={listOwners} onListsRendered={onListsRendered} />
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
            {/* Fixing `api.js` alone would have changed nothing a user can reach. This branch USED to
                end here: once the artifact had a docUrl the create button was replaced by a link, so
                on precisely the artifacts where a cache bypass matters there was no control to press
                — the dead-UI defect moved one layer up, where the api.js diff makes it look solved. */}
            <span data-qc={PACKET_HOOKS.assetRebuild} className="px-link"
              style={{ fontSize: 12, cursor: d.busy ? 'default' : 'pointer', opacity: d.busy ? 0.6 : 1 }}
              role="button" aria-disabled={d.busy ? 'true' : 'false'}
              onClick={() => { if (!d.busy) ((a.type === 'portfolio' || a.type === 'cover') ? onMakeSlides : onMakeDoc)(a, { regen: true }) }}>
              {d.busy && d.regen ? '↻ Rebuilding…' : '↻ Rebuild from current draft'}
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
      )}
    </div>
  )
}

export default function PacketBuilder({ id, step }) {
  const { toast } = useApp()
  const mobile = useIsMobile()
  const [pState, setPState] = useState({ loading: true, error: null, packet: null })
  const [opp, setOpp] = useState(null)
  const [busy, setBusy] = useState(null)
  const [video, setVideo] = useState({})
  const [doc, setDoc] = useState({})
  const [jdBusy, setJdBusy] = useState(false)
  const [parseBusy, setParseBusy] = useState(false)
  const [allBusy, setAllBusy] = useState(false)
  // The wizard step lives in the ROUTE (#/packet/:id/:step), matching every other multi-view screen
  // (OppDetail, Interview, Library, Settings). It was component state, which meant no deep-link, no
  // back-button, and nothing behind a step was reachable by the UI verifier.
  // `setActiveStep` is kept as the local API - including the functional form - so every existing
  // call site works unchanged; it now navigates instead of setting state.
  const explicitStep = STEPS.some((s) => s.key === step) ? step : null
  const activeStep = explicitStep || 'jd'
  const setActiveStep = (next) => {
    const key = typeof next === 'function' ? next(activeStep) : next
    if (STEPS.some((s) => s.key === key)) go(`/packet/${id}/${key}`)
  }
  // D4: the 280px right keyword panel is gone; its content is now the tally modal opened from the
  // header match estimate. `atsOpen` means "the tally is open", on desktop and mobile alike.
  const [atsOpen, setAtsOpen] = useState(false)
  // The posting's requirement spine — P5.4's source data for step 1.
  const [req, setReq] = useState({ data: null, error: null })
  // The run result strip. It persists; the toast it replaces vanished after 2.2s, which is why
  // "the re-run button visibly does something" kept reading as unmet.
  const [runResult, setRunResult] = useState(null)
  const pollers = useRef({})
  // Requirements and swaps are scoped to the OPPORTUNITY and the PACKET, not to one artifact, so
  // they are loaded once here and handed down. Loading them inside each card would issue the same
  // two requests for the resume and the compact resume (one packet, identical merge fields) and let
  // the two cards disagree if one call failed. Hooks run before the loading/error returns below.
  const provenance = useAssetProvenance(id, pState.packet ? pState.packet.id : null)
  // Which asset in this packet renders which skill_candidate list, reported by each card from its
  // OWN insertion rows. A swap_decision row is keyed by packet, never by artifact, so the resume and
  // the compact resume render the SAME change; this registry is what lets each card name the other
  // instead of the one decision reading as two (decision 9, sharedSource).
  const [listOwners, setListOwners] = useState({})
  const registerLists = useCallback((artifactId, label, lists) => {
    setListOwners((prev) => registerListOwners(prev, artifactId, label, lists))
  }, [])
  // ONE source for every asset's QC payload (P5.1). The step circle, the QC rail, the per-asset
  // drawer and the keyword surfaces all read this same map, so no two of them can show different
  // gates for the same artifact. Insertions are only fetched while the QC step is open - the loops
  // and compare tabs are the only readers.
  //
  // It REPLACES the resume-only checks-result fetch this screen used to run for the keyword tally:
  // that was a second copy of the same payload, and the tally now reads the resume's entry out of
  // this one map. `null` still means no run has been read yet - a state of its own, not zero.
  const artifactList = pState.packet ? pState.packet.artifacts : null
  const { entries: qcEntries, setResult: setQcResult } = useQcEntries(artifactList, {
    withInsertions: activeStep === 'qc',
    // D:remediation-never-ran — fetched on the same terms as insertions, so the Remediation loops
    // tab reads the real ledger instead of falling back to insertion.loop and reporting that as
    // "nothing has been remediated".
    withRemediation: activeStep === 'qc',
  })
  const qc = qcStepState(qcEntries)
  const resumeEntry = qcEntries.find((e) => e.artifact.type === 'resume') || null
  const keywordScore = (resumeEntry && resumeEntry.result && resumeEntry.result.score) || null

  const load = useCallback(async () => {
    try {
      const [p, o] = await Promise.all([api.getPacket(id), api.getOpportunity(id)])
      if (p.error) throw new Error(p.error)
      setPState({ loading: false, error: null, packet: p })
      if (!o.error) setOpp(o)
      // NO auto-advance. It used to jump an already-analysed packet straight to the resume step,
      // which meant the single most common case - opening a packet analysed in an earlier session -
      // never saw the posting-analysis card at all. Step 1 is a destination, not a toll gate; the
      // route (#/packet/:id/:step) is what decides which step is shown, and only the reader writes it.
    } catch (err) {
      setPState({ loading: false, error: String(err.message || err), packet: null })
    }
  }, [id])

  const loadReq = useCallback(async () => {
    try {
      const r = await api.requirements(id)
      if (r.error) throw new Error(r.error)
      setReq({ data: r, error: null })
    } catch (err) { setReq({ data: null, error: String(err.message || err) }) }
  }, [id])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadReq() }, [loadReq])
  useEffect(() => () => Object.values(pollers.current).forEach(clearTimeout), [])

  const patchArtifact = (artifactId, fields) => setPState((s) => ({
    ...s,
    packet: { ...s.packet, artifacts: s.packet.artifacts.map((a) => (a.id === artifactId ? { ...a, ...fields } : a)) },
  }))

  const makeDoc = async (a, opts = {}) => {
    setDoc((d) => ({ ...d, [a.id]: { busy: true, regen: opts.regen === true } }))
    try {
      const res = await api.generateArtifactDocument(a.id, opts)
      if (res.error) throw new Error(res.error)
      patchArtifact(a.id, { docUrl: res.docUrl })
      setDoc((d) => ({ ...d, [a.id]: { busy: false } }))
      toast(opts.regen ? `Google Doc rebuilt for ${TYPE_LABEL[a.type]}` : `Google Doc created for ${TYPE_LABEL[a.type]}`)
    } catch (err) {
      setDoc((d) => ({ ...d, [a.id]: { busy: false, error: String(err.message || err) } }))
      toast(`Doc failed: ${err.message || err}`)
    }
  }

  const makeSlides = async (a, opts = {}) => {
    setDoc((d) => ({ ...d, [a.id]: { busy: true, regen: opts.regen === true } }))
    try {
      const res = await api.generateArtifactSlides(a.id, opts)
      if (res.error) throw new Error(res.error)
      patchArtifact(a.id, { docUrl: res.deckUrl || res.docUrl })
      setDoc((d) => ({ ...d, [a.id]: { busy: false } }))
      toast(opts.regen ? 'Slides deck rebuilt' : 'Slides deck created')
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

  // The run result is recorded in state, not only announced in a toast, so the strip on the card
  // still says what happened long after the toast has gone. `cached`/`grounded`/`sourceChars` come
  // straight off the endpoint — they are what distinguishes a real re-read of the posting from a
  // replay of the stored analysis.
  const runJd = async () => {
    setJdBusy(true)
    const at = new Date().toLocaleTimeString()
    try {
      // force:true, always. This function is reached only from the analysis button, and that button
      // exists to run the analysis on demand — so a click must re-read the posting rather than
      // replay the stored result. The idempotency guard still protects every automatic path.
      const r = await api.analyzeJd(id, { force: true })
      if (r.error) throw new Error(r.error)
      const a = r.analysis || {}
      setRunResult({
        at,
        atsScore: typeof a.atsScore === 'number' ? a.atsScore : null,
        keywords: (a.keywords || []).length,
        mustHaves: (a.mustHaves || []).length,
        cached: !!r.cached, grounded: !!r.grounded, sourceChars: r.sourceChars ?? null,
      })
      toast(`Analysis run — match estimate ${a.atsScore ?? '—'}`)
      load()
    } catch (e) {
      setRunResult({ at, error: String(e.message || e) })
      toast(`Analysis failed: ${e.message || e}`)
    }
    finally { setJdBusy(false) }
  }

  const parseJd = async () => {
    setParseBusy(true)
    try {
      const r = await api.parseJd(id)
      if (r.error) throw new Error(r.error)
      toast('Posting parsed — summary and extracted lines updated')
      const o2 = await api.getOpportunity(id)
      if (!o2.error) setOpp(o2)
      // Re-parsing rewrites the requirement spine, so the source card has to re-read it or it
      // keeps showing offsets measured against the previous posting text.
      loadReq()
    } catch (e) { toast(`Parse failed: ${e.message || e}`) }
    finally { setParseBusy(false) }
  }

  // X2's remaining half. `api.buildFullPacket` has always forwarded its options and the API has
  // always read `regen` — the UI simply never set it, so a control labelled "Rebuild" replayed the
  // cached package. Same shape as the Re-run button: a server capability with no consumer.
  const buildAll = async (opts = {}) => {
    setAllBusy(true)
    try {
      const r = await api.buildFullPacket(id, opts.regen ? { regen: true } : {})
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

  const stepContent = (
    <>
      {/* JD Analysis step */}
      {activeStep === 'jd' && (
        <>
          <div className="px-box" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Extracted from triggering email</div>
              {opp?.source && <Pill tone="accent">{opp.source === 'LinkedIn' ? 'from email' : opp.source}</Pill>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px 0', fontSize: 13 }}>
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

          {/* AC31 - this box is MODEL OUTPUT and says so.
              `opp.jdSummary` is opportunity.jd_summary and `opp.why` is opportunity.why_surfaced;
              both are written by a model. Printing either under a heading reading "The posting"
              attributed the model's words to the employer, and for the ~116 opportunities with no
              stored posting text it was why_surfaced - a note about why WE surfaced the row - being
              passed off as what the employer wrote. The employer's own text is opportunity.jd_text,
              and the only place it is ever shown is a located line in the card below. */}
          {(() => {
            const pb = postingBody({ jdSummary: opp?.jdSummary, why: opp?.why, jdTextLen: req.data?.jdTextLen })
            return (
              <div className="px-box" data-qc={PACKET_HOOKS.postingBody} data-qc-body={pb.kind} style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{pb.heading}</div>
                    {pb.badge && <Pill tone="yellow">{pb.badge}</Pill>}
                  </div>
                  <button className="px-btn" style={{ fontSize: 12 }} disabled={parseBusy} onClick={parseJd}>
                    {parseBusy ? 'Parsing…' : (opp?.jdSummary ? '↻ Re-parse posting' : 'Parse posting')}
                  </button>
                </div>
                <div className="px-small" data-qc={PACKET_HOOKS.postingBodyProvenance} style={{ marginBottom: 10, color: 'var(--proto-ink2)', lineHeight: 1.6 }}>
                  {pb.provenance}
                </div>
                {pb.body
                  ? <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{pb.body}</div>
                  : <div className="px-small" style={{ color: 'var(--proto-ink3)' }}>Use "Parse posting" to fetch it from the source URL.</div>}
              </div>
            )
          })()}

          {/* P8.4 / SPEC 4.2 - the two-sided comparison. It sits ABOVE the extraction card
              deliberately: this is the ANSWER the JD step gives, and the card below it is the
              source the answer was built from. Nothing below is deleted - the extraction
              provenance strip ("N lines extracted / N located / N characters stored") is the only
              surface reporting how much of the employer's text was located, and P5.4 built it on
              purpose. The comparison replaces the counter strip the SPEC names ("6 of 12 posting
              lines / 3 passes"), which never existed on this screen. */}
          <ProfileCompareCard
            comparison={req.data?.comparison}
            onOpenRequirements={() => {
              const el = document.querySelector('[data-qc="posting-analysis"]')
              if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }} />

          <PostingAnalysisCard
            req={req.data} reqError={req.error} reloadReq={loadReq}
            coveredKw={coveredKw} missingKw={missingKw} gapsScoredAt={p.atsGapsScoredAt}
            onParse={parseJd} parseBusy={parseBusy} hasSummary={!!opp?.jdSummary}
            keywordScore={keywordScore} />

          <AnalysisRunCard
            busy={jdBusy} onRun={runJd} hasRun={!!p.jdAnalyzed} result={runResult}
            /* `onClick={buildAll}` handed React's SyntheticEvent straight into `opts`, so
               `opts.regen` was a property read off an event object. It is undefined, so the
               behaviour was right by accident — but an event is not an options bag, and the next
               option added there would have been silently ungettable. Both call sites are now
               explicit that they send nothing. */
            extra={(
              <button className="px-btn" style={{ fontSize: 12 }} disabled={allBusy} onClick={() => buildAll()}>
                {allBusy ? 'Building…' : 'Build entire packet'}
              </button>
            )} />

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="px-btn px-btn-accent" onClick={() => setActiveStep('resume')}>Next: Resume →</button>
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
                No artifact yet for this step.{' '}
                <span className="px-link" onClick={() => buildAll()}>Build entire packet</span> to generate all at once.
              </div>
            )}
            {stepArtifacts.map((a) => (
              <ArtifactCard key={a.id} a={a} busy={busy} setBusy={setBusy}
                onGenerate={generate} onSetStatus={setStatus}
                onMakeDoc={makeDoc} onMakeSlides={makeSlides}
                onGenVideo={genVideo} onArchiveVideo={archiveVideo}
                doc={doc} video={video} provenance={provenance}
                listOwners={listOwners} onListsRendered={registerLists} />
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

      {/* P5.1 - the QC & evidence rail. It reads the SAME qcEntries the step circle does, so the
          circle's colour and the rail's gate can never be two different opinions. */}
      {activeStep === 'qc' && (
        <>
          <QcRail
            packetId={p.id} company={p.company} role={p.role}
            entries={qcEntries} setResult={setQcResult}
            requirements={req.data ? req.data.requirements : null} reqError={req.error}
            reqLoading={!req.data && !req.error} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="px-btn px-btn-accent" onClick={() => setActiveStep('send')}>Next: Review &amp; send →</button>
          </div>
        </>
      )}

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
          <div style={{ marginTop: 4 }}>
            {ready
              ? <button className="px-btn px-btn-accent" onClick={() => go(`/compose/${id}`)}>Go to outreach →</button>
              : <div className="px-small" style={{ color: 'var(--proto-ink2)' }}>Approve all artifacts above to unlock sending.</div>
            }
          </div>
        </div>
      )}
    </>
  )

  // D4 — the 280px right column is GONE and this modal is where its content lives, rendered once
  // for the whole screen (mobile and desktop share it), which is what "the panel appears exactly
  // once per screen" means now. The step-progress list the old panel carried is not reproduced:
  // the desktop left rail and the mobile step scroller already render it, and a third copy is the
  // duplicate-surface problem P5.4 is trying to end.
  const keywordTally = (
    <KeywordTallyOverlay
      open={atsOpen} onClose={() => setAtsOpen(false)}
      req={req.data} keywordScore={keywordScore}
      coveredKw={coveredKw} missingKw={missingKw} gapsScoredAt={p.atsGapsScoredAt} atsScore={atsScore}
      onBuildAll={() => buildAll({ regen: true })} buildBusy={allBusy}
      onGoResume={() => { setAtsOpen(false); setActiveStep('resume') }} />
  )

  if (mobile) {
    // ── MOBILE LAYOUT ──────────────────────────────────────────────────────
    const activeIdx = STEPS.findIndex((s) => s.key === activeStep)
    const prevStep = activeIdx > 0 ? STEPS[activeIdx - 1] : null
    const nextStep = activeIdx < STEPS.length - 1 ? STEPS[activeIdx + 1] : null
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Header — the match estimate is the one entry point to the keyword tally on mobile too */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="px-small px-link" style={{ marginBottom: 6 }} onClick={() => go('/packets')}>← Packets</div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{p.company} · {p.role}</div>
            {ready && <Pill tone="green">Ready to ship ✓</Pill>}
          </div>
          <MatchEstimateButton atsScore={atsScore} compact onClick={() => setAtsOpen(true)} />
        </div>

        {/* Horizontal step scroller */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
          {STEPS.map((step) => {
            const done = stepDone(step.key, p, artifacts, qc)
            const active = activeStep === step.key
            return (
              <div key={step.key} onClick={() => setActiveStep(step.key)}
                style={{
                  flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 12px', borderRadius: 99, cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 500,
                  background: active ? 'var(--surface-brand-default)' : done ? 'var(--proto-green-soft)' : 'var(--proto-panel)',
                  color: active ? '#fff' : done ? 'var(--proto-green)' : 'var(--proto-ink2)',
                  border: active ? 'none' : '1px solid var(--proto-rule-soft)',
                }}>
                <span>{done ? '✓' : step.num}</span>
                <span>{step.label}</span>
              </div>
            )
          })}
        </div>

        {/* Step content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {stepContent}
        </div>

        {keywordTally}

        {/* Prev / Next nav */}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          {prevStep && (
            <button className="px-btn" style={{ flex: 1 }} onClick={() => setActiveStep(prevStep.key)}>
              ← {prevStep.label}
            </button>
          )}
          {nextStep && (
            <button className="px-btn px-btn-accent" style={{ flex: 1 }} onClick={() => setActiveStep(nextStep.key)}>
              {nextStep.label} →
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── DESKTOP LAYOUT ──────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div className="px-small px-link" style={{ marginBottom: 8 }} onClick={() => go('/packets')}>← Packets</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-brand)' }}>
              Packet — {p.company}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{p.company} · {p.role}</div>
            <div className="px-small" style={{ marginTop: 2, color: 'var(--proto-ink2)' }}>
              Posting analysis against <ProfileLink />, then tailored assets
            </div>
          </div>
          {/* Not "ATS Match": nothing here came from an applicant tracking system, and the number is
              a model estimate, not keyword coverage. It is also the door to the keyword tally. */}
          <MatchEstimateButton atsScore={atsScore} onClick={() => setAtsOpen(true)} />
          {ready ? <Pill tone="green">Ready to ship ✓</Pill> : allBusy ? <Pill tone="yellow">building</Pill> : null}
          {ready && <button className="px-btn px-btn-accent" onClick={() => go(`/compose/${id}`)}>Send packet →</button>}
        </div>
      </div>

      {/* Two columns since D4: nav rail + content. The old 280px right keyword column is gone, which is
          what gives the centre its width back (1280 shell cap - 196 nav leaves ~664px at 1440). */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Left: step list */}
        <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {STEPS.map((step) => {
            const done = stepDone(step.key, p, artifacts, qc)
            const active = activeStep === step.key
            return (
              <div key={step.key} onClick={() => setActiveStep(step.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8,
                  cursor: 'pointer', background: active ? 'var(--proto-accent-soft)' : 'transparent',
                  border: active ? '1px solid var(--surface-brand-default)' : '1px solid transparent',
                }}>
                <StepCircle num={step.num} done={done} active={active}
                  tone={step.key === 'qc' ? railGateMeta({ gate: packetGate(qcEntries) }).tone : null} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: active ? 'var(--text-brand)' : 'var(--proto-ink)' }}>
                    {step.label}
                  </div>
                  <div className="px-small" style={{ marginTop: 1, color: 'var(--proto-ink2)', fontSize: 11 }}>{step.sub}</div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Center: content */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {stepContent}
        </div>

      </div>

      {keywordTally}
    </div>
  )
}
