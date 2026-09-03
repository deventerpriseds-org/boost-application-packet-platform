import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useApp, go, useIsMobile, useIsWide } from '../state.jsx'
import { api } from '../api.js'
import { Pill, toneColor } from '../shell.jsx'
import { Loading, ErrorBox } from './Today.jsx'
import AssetBlocks, { useAssetProvenance } from './AssetBlocks.jsx'
import { registerListOwners, registerFieldOwners } from '../assetBlocks.js'
import {
  PostingAnalysisCard, AnalysisRunCard, KeywordTallyOverlay, MatchEstimateButton, ProfileLink,
  ProfileCompareCard,
} from './PostingAnalysis.jsx'
import { postingBody } from '../postingAnalysis.js'
import { PACKET_HOOKS, ASSET_BODY_DEFAULT_OPEN, regenerateWithNote } from '../packetBuilder.js'
import QcRail, { useQcEntries } from './QcRail.jsx'
import { GateBadge } from './AssetGateDrawer.jsx'
import AssistantPanel from './AssistantPanel.jsx'
import AnalysisPanel from './AnalysisPanel.jsx'
import { assistantMode, DOCK_MIN_VIEWPORT } from '../assistantPanel.js'
import { qcStepState, packetGate, railGateMeta, packetReadiness, packetFailList, qcSummaryModel, firstFixTarget, listOwnersFromArtifacts, requirementUsage, staleChecksNote } from '../qcRail.js'

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
// Which of the owner's resumes this packet is built on.
//
// The COLLECTION is AppConfig partition `templates` -- one `resume-<driveId>` row per resume, each
// carrying its own role focus and (since 2026-08-24) a name. This control stores the per-packet
// CHOICE. It is read-only about the collection: adding or naming a resume happens in Settings, and
// duplicating that here would be a second place to manage the same rows.
//
// "Owner default" is a REAL option, not an empty state -- it clears the choice back to
// `google.resumeTemplateId`, which is what every packet built before this existed uses.
function ResumeTemplatePicker({ packetId, value, onSaved }) {
  const [rows, setRows] = useState(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState(null)

  useEffect(() => {
    let live = true
    api.templateFocusGet()
      .then((r) => { if (live) setRows((r && r.templates) || []) })
      .catch(() => { if (live) setRows([]) })
    return () => { live = false }
  }, [])

  // One resume and no choice made is the state every owner starts in, and a picker with a single
  // option is noise. It appears as soon as there is something to choose between.
  if (!rows || (rows.length < 2 && !value)) return null

  const pick = async (templateId) => {
    setSaving(true); setNote(null)
    try {
      const r = await api.packetResumeTemplateSet(packetId, templateId)
      if (!r || r.error) throw new Error((r && r.error) || 'could not change the resume')
      setNote({ ok: true, msg: r.cleared ? 'Using your default resume.' : 'Resume changed - rebuild to apply it.' })
      if (onSaved) await onSaved()
    } catch (e) {
      setNote({ ok: false, msg: String(e.message || e) })
    } finally { setSaving(false) }
  }

  const nameOf = (t) => t.label || `Unnamed resume (${String(t.templateId).slice(0, 8)}...)`

  return (
    <div className="px-box" data-qc="packet-resume-template" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Resume this packet is built on</div>
        <div className="px-small" style={{ color: 'var(--proto-ink2)', marginTop: 2 }}>
          The resume you pick also sets the role focus every prompt is written for.
          Changing it takes effect on the next rebuild.
        </div>
      </div>
      <select className="px-input" value={value} disabled={saving} aria-label="Resume template"
        onChange={(e) => pick(e.target.value)} style={{ minWidth: 220 }}>
        <option value="">Your default resume</option>
        {rows.map((t) => (
          <option key={t.templateId} value={t.templateId}>
            {nameOf(t)}{t.roleFocus ? ` - ${t.roleFocus}` : ''}
          </option>
        ))}
      </select>
      {note ? (
        <div className="px-small" style={{ width: '100%', color: note.ok ? 'var(--text-ok)' : 'var(--text-bad)' }}>{note.msg}</div>
      ) : null}
    </div>
  )
}

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
export function ArtifactCard({ a, busy, setBusy, qcResult, qcStale = false, qcStaleError = null, onStaleSignal = null, onGenerate, onRegenerate, onSetStatus, onMakeDoc, onMakeSlides, onGenVideo, onArchiveVideo, doc, video, provenance, listOwners, onListsRendered, focusField = null, onOpenFirstFix = null, firstFix = null, onSeedAssistant = null, fieldOwners = null, onGoToField = null }) {
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
  const [open, setOpen] = useState(ASSET_BODY_DEFAULT_OPEN)
  const gateBlocks = !!qcResult && qcResult.gate === 'fail'
  const [assetAskOpen, setAssetAskOpen] = useState(false)
  const [assetAsk, setAssetAsk] = useState('')
  const [assetAskBusy, setAssetAskBusy] = useState(false)
  const [assetAskError, setAssetAskError] = useState(null)
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
        {/* THE GATE, on the card. Five well-built states already existed in GateBadge and were
            rendered only inside the drawer, so this step showed a status pill (`review`) with no
            word about whether the checks pass — and offered an Approve the server refuses. The
            badge is REUSED, not reimplemented: it reads the server's gate and the two counts
            through the same selectors, so the card and the drawer cannot disagree. */}
        {/* SPEC 4.4-14. `GateBadge` has always taken `onClick` and, when given one, already renders
            role="button", tabIndex and an Enter/Space handler - all three of its mount sites simply
            never passed one, so the badge was inert everywhere it appeared.
            NULL means NO CLICK, never a click that goes nowhere: an unchecked asset has no findings
            and therefore no field to open, and a badge that navigates nowhere is the dead UI the
            standing rule forbids. */}
        <GateBadge result={qcResult} compact onClick={onOpenFirstFix || undefined} firstFix={firstFix} />
        {/* Frontend checks-wiring gap: a write can save the text and still fail to recompute the
            gate above (checksStale). The full sentence - same wording as the QC step's own note,
            staleChecksNote - lives in the title so this short pill and that longer note cannot
            describe the same fact two different ways. */}
        {qcStale && (
          // Pill (shell.jsx) does not forward extra props - it renders only children/tone/style - so
          // `title` and `data-qc` sit on a wrapping span rather than being silently dropped on Pill
          // itself (the same drop a pre-existing `<Pill data-qc="packet-gate">` at :1288 already has).
          <span data-qc={PACKET_HOOKS.assetStale} data-qc-artifact={a.id}
            title={staleChecksNote({ stale: true, staleError: qcStaleError })}>
            <Pill tone="warn">checks may be stale</Pill>
          </span>
        )}
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
          label={TYPE_LABEL[a.type] || a.type} listOwners={listOwners} onListsRendered={onListsRendered}
          focusField={focusField} onSeedAssistant={onSeedAssistant}
          /* SPEC 4.4-29 - the SAME navigator the QC rail's deep links use (`goToField`), not a
             second one, so a finding opened from the asset header and the same finding opened from
             the rail land identically. */
          fieldOwners={fieldOwners} onGoToField={onGoToField} />
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
            {/* SPEC 4.4-8, the DEFENSIBLE HALF ONLY. The prototype renders these three as buttons;
                converting a real `<a href target="_blank">` into a button REMOVES middle-click,
                Cmd-click, open-in-new-tab and "Copy link address". The prototype uses a button
                because its link has no destination - ours does. So the button conversion is declined
                and recorded as a pull candidate; `nowrap` is the half that was genuinely missing,
                and it stops a two-word label breaking mid-phrase when the row wraps. */}
            <a href={a.docUrl} target="_blank" rel="noreferrer" className="px-link" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              {a.docUrl.includes('/presentation/') ? '✓ Open Slides ↗' : '✓ Open Google Doc ↗'}
            </a>
            {/* role + tabIndex + a key handler, not a bare span: a click target with no role has no
                keyboard path and is announced as text. Same treatment GateBadge and the meter toggle
                already use. It ALSO stops the UI-gap comparator reporting this control as missing -
                compare-ui.mjs collects `button, [role="button"], a`, so an unlabelled span was
                invisible to it and showed up as a prototype-only control that already existed. */}
            <span className="px-link" role="button" tabIndex={0} style={{ fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
              onClick={() => { try { navigator.clipboard?.writeText(api.trackedLink(a.id)) } catch {} }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                try { navigator.clipboard?.writeText(api.trackedLink(a.id)) } catch {}
              }}>
              ⎘ Copy tracked link
            </span>
            {/* Fixing `api.js` alone would have changed nothing a user can reach. This branch USED to
                end here: once the artifact had a docUrl the create button was replaced by a link, so
                on precisely the artifacts where a cache bypass matters there was no control to press
                — the dead-UI defect moved one layer up, where the api.js diff makes it look solved. */}
            <span data-qc={PACKET_HOOKS.assetRebuild} className="px-link"
              style={{ fontSize: 12, cursor: d.busy ? 'default' : 'pointer', opacity: d.busy ? 0.6 : 1, whiteSpace: 'nowrap' }}
              role="button" aria-disabled={d.busy ? 'true' : 'false'} tabIndex={d.busy ? -1 : 0}
              onClick={() => { if (!d.busy) ((a.type === 'portfolio' || a.type === 'cover') ? onMakeSlides : onMakeDoc)(a, { regen: true }) }}
              onKeyDown={(e) => {
                if (d.busy || (e.key !== 'Enter' && e.key !== ' ')) return
                e.preventDefault()
                ;((a.type === 'portfolio' || a.type === 'cover') ? onMakeSlides : onMakeDoc)(a, { regen: true })
              }}>
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
            {/* LIST TWEAKS for the WHOLE asset. The per-field control (AssetBlocks) is the one to
                reach for nearly always; this exists for the artifacts that have no merge fields to
                reach into — the intro video has none, so the per-field box never appears there and
                without this there is no way to ask for an edit at all.

                Same route, no `section`: `artifactAiEdit` writes `artifact.content` when section is
                absent and `packet.pkg_json[section]` when it is present (appPackets.ts:1299). Not a
                second edit path — the triage's own instruction was "do not build one". */}
            {!assetAskOpen && (
              <button className="px-btn" data-qc={PACKET_HOOKS.assetAsk}
                onClick={() => setAssetAskOpen(true)}>List Tweaks</button>
            )}

            {/* A BLOCKED GATE DISABLES APPROVE, and says why instead of letting the server refuse.
                approvalBlock() on the server is still the authority — this does not decide anything,
                it stops offering an action that is already known to fail. `unchecked` is NOT
                blocked here: the server refuses it too, but "run the checks" is a different
                sentence from "fix these findings" and the drawer is where that is said. */}
            <button className="px-btn px-btn-green" disabled={gateBlocks}
              title={gateBlocks ? 'The checks block this asset - open QC to see what must be fixed.' : undefined}
              onClick={() => onSetStatus(a, 'approved')}>Approve</button>
            {/* ONE BUTTON, because `Request changes` was never a sibling of this one - it was a
                PARAMETER of it, and shipping it as a separate control made it look like an action
                that does something on its own. It does not: it writes a note and returns, and the
                draft only moves when Regenerate is pressed afterwards. Two clicks and a modal for
                what is really "Regenerate, with a note".

                Nor did the `changes` status carry meaning. `recomputePacket` only ever tests
                `=== 'approved'` and `!== 'todo'`, so `changes` and `review` produce an IDENTICAL
                packet status; the single behavioural use of the value in the whole API is
                `appPackets.ts:341`, deciding whether to store the note. It gated nothing.

                So the note is now collected BY Regenerate. Blank re-rolls (today's behaviour);
                text is written to packet.feedback first and read back by the generate path as
                `revisionNotes` (appPackets.ts:503), exactly as before - same transport, one control.
                Cancel does nothing at all, which a separate button could not express.

                `changes` IS STILL WRITTEN, and an earlier version of this comment claimed it was
                not - corrected after an independent verifier caught the contradiction (C-3). The
                write moved rather than stopped: `regenerateWithNote`'s saveNote calls
                setArtifactStatus(a.id, 'changes', text) on every STEERED regenerate, because that
                is the only status the server accepts a note under (appPackets.ts:341). A blank
                regenerate writes nothing.

                So `STATUS_TONE.changes` is NOT dead - it is reachable from new writes, briefly,
                between the note landing and the rebuild finishing. Production has never held a
                `changes` row (measured: artifact statuses are `todo` 173 / `review` 22, nothing
                else), which is a statement about the OLD control never being used successfully -
                not a licence to delete the tone. */}
            <button className="px-btn" disabled={busy === a.id} onClick={() => onRegenerate(a)}>
              {busy === a.id ? 'Regenerating…' : 'Regenerate'}
            </button>
          </>
        )}
        {a.status === 'approved' && (
          <button className="px-btn" onClick={() => onSetStatus(a, 'review')}>Reopen</button>
        )}
      </div>

      {assetAskOpen && (
        <div data-qc={PACKET_HOOKS.assetAskBox} style={{ marginTop: 8 }}>
          <div className="px-small" style={{ textTransform: 'none' }}>
            This rewrites the whole {TYPE_LABEL[a.type].toLowerCase()}. For one field, use the
            field's own List Tweaks below - it changes that field only.
          </div>
          <textarea className="px-input" rows={2} value={assetAsk}
            placeholder={`List the tweaks for the ${TYPE_LABEL[a.type].toLowerCase()}`}
            onChange={(e) => setAssetAsk(e.target.value)} style={{ width: '100%', marginTop: 4, resize: 'vertical' }} />
          {assetAskError && <div className="px-note" style={{ marginTop: 6 }}>{assetAskError}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button type="button" className="px-btn" disabled={assetAskBusy}
              onClick={() => { setAssetAskOpen(false); setAssetAsk(''); setAssetAskError(null) }}>Cancel</button>
            <button type="button" className="px-btn px-btn-accent" data-qc={PACKET_HOOKS.assetAskSend}
              disabled={assetAskBusy || !assetAsk.trim()}
              onClick={async () => {
                setAssetAskBusy(true); setAssetAskError(null)
                try {
                  const res = await api.aiEditArtifact(a.id, { instruction: assetAsk.trim() })
                  if (onStaleSignal) onStaleSignal(!!res.checksStale, res.checksError)
                  setAssetAsk(''); setAssetAskOpen(false)
                } catch (e) { setAssetAskError(String((e && e.message) || e)) }
                finally { setAssetAskBusy(false) }
              }}>{assetAskBusy ? 'Sending...' : 'Send'}</button>
          </div>
        </div>
      )}
      </div>
      )}
    </div>
  )
}

export default function PacketBuilder({ id, step }) {
  const { toast } = useApp()
  const mobile = useIsMobile()
  const wide = useIsWide(DOCK_MIN_VIEWPORT)
  const assistantMode_ = assistantMode({ mobile, wide })
  const [pState, setPState] = useState({ loading: true, error: null, packet: null })
  const [opp, setOpp] = useState(null)
  const [applying, setApplying] = useState(false)
  const [busy, setBusy] = useState(null)
  const [video, setVideo] = useState({})
  const [doc, setDoc] = useState({})
  const [jdBusy, setJdBusy] = useState(false)
  const [parseBusy, setParseBusy] = useState(false)
  const [allBusy, setAllBusy] = useState(false)
  // The queued build (D35): { jobId, state }. Null when nothing is in flight. Its own timer ref,
  // because `pollers` is keyed by artifact id and a packet build is not one artifact.
  const [buildJob, setBuildJob] = useState(null)
  const buildPoller = useRef(null)
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
  // SPEC 4.4-29. `mergeField -> [{id,label}]`, from the SAME report. A finding on the compact resume
  // can name `RelevantBullets1`, a field only the RESUME renders (10 such rows on the production
  // fixture), and turning that into a navigation needs to know which asset owns the field. The
  // list-keyed map above cannot answer it - it is keyed by list because a swap_decision row is, and
  // no list backs `ResumeSummary` or `@CoverLetterBody`. Derived at render time rather than from
  // `listOwnersFromArtifacts` because `useQcEntries` fetches insertions only on the QC and JD steps,
  // so on the asset steps - where this list renders - that derivation would be `{}`.
  const [fieldOwners, setFieldOwners] = useState({})
  const registerLists = useCallback((artifactId, label, lists, fields) => {
    setListOwners((prev) => registerListOwners(prev, artifactId, label, lists))
    setFieldOwners((prev) => registerFieldOwners(prev, artifactId, label, fields))
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
  const { entries: qcEntries, setResult: setQcResult, markStale: markQcStale, clearStale: clearQcStale } = useQcEntries(artifactList, {
    // SPEC 4.1-20 needs insertions on the JD STEP as well: `list -> artifact` is derived from them,
    // and the whole reason that row never shipped is that the old map was built by asset cards
    // registering as they RENDER, so on this step it was empty - the link would have been absent
    // exactly where SPEC asks for it.
    withInsertions: activeStep === 'qc' || activeStep === 'jd',
    // D:remediation-never-ran — fetched on the same terms as insertions, so the Remediation loops
    // tab reads the real ledger instead of falling back to insertion.loop and reporting that as
    // "nothing has been remediated".
    withRemediation: activeStep === 'qc',
  })
  const qc = qcStepState(qcEntries)
  // ONE literal, named once. Which artifact carries the packet's headline score is a
  // behaviour-affecting choice the owner may one day want to make in Settings; it was already fixed
  // to the resume here before SPEC 4.3-9, and this change does not deepen it - the tally modal is
  // handed the type rather than looking for a second one of its own, and the screen SAYS which
  // artifact it is scoring rather than presenting it as the packet's.
  const SCORED_TYPE = 'resume'
  const resumeEntry = qcEntries.find((e) => e.artifact.type === SCORED_TYPE) || null
  const keywordScore = (resumeEntry && resumeEntry.result && resumeEntry.result.score) || null
  // SPEC 4.3-9/10/11. Derived ONCE, here, off the same useQcEntries() payload the rail, the step
  // circle, the asset badges and the ship gate read - so the modal cannot disagree with any of them.
  const qcSummary = qcSummaryModel(qcEntries, { scored: resumeEntry, scoredType: SCORED_TYPE })

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
  useEffect(() => () => clearTimeout(buildPoller.current), [])

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
      // The draft was saved either way - `checksStale` says the gate beside it may now describe the
      // PREVIOUS text, not that anything failed. markQcStale is the shared useQcEntries() signal the
      // rail's own writes use, so the QC step and this card's badge cannot disagree about it.
      if (res.checksStale) markQcStale(a.id, res.checksError)
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
  // D35. This used to await the whole build. It takes about three minutes and the gateway in front
  // of the Function gives up at roughly 230 seconds, so the browser was shown a failure on builds
  // that had already written every document — and the owner, reasonably, pressed the button again
  // and paid for it twice. The request now queues the build and polls it, which is the same shape
  // the video render already uses on this screen.
  const buildAll = async (opts = {}) => {
    setAllBusy(true)
    try {
      const r = await api.queueFullPacket(id, opts.regen ? { regen: true } : {})
      if (r.error) throw new Error(r.error)
      // `note` is the server's honest description of what happened, and the three cases are not the
      // same: queued, upgraded-to-a-rebuild, or "something else is already running and this is not
      // the build you asked for". Showing "Building…" for all three is how a rebuild button ends up
      // reporting success for a cached build.
      toast(r.note || 'Build queued.')
      setBuildJob({ jobId: r.jobId, state: r.state || 'pending' })
      pollBuild(r.jobId)
    } catch (e) { toast(`Build failed: ${e.message || e}`); setAllBusy(false); setBuildJob(null) }
  }

  const pollBuild = useCallback((jobId) => {
    clearTimeout(buildPoller.current)
    const tick = async () => {
      try {
        const s = await api.buildJob(jobId)
        if (s.error) { toast(`Build status unavailable: ${s.error}`); setAllBusy(false); setBuildJob(null); return }
        setBuildJob({ jobId, state: s.state })
        if (!s.done) { buildPoller.current = setTimeout(tick, 10000); return }
        setAllBusy(false)
        const built = (s.result?.artifacts || []).filter((x) => x.url).length
        const warned = (s.result?.warnings || []).length
        // A FAILED job still carries its payload, so a partial build reports what it did write
        // rather than only that it failed — three documents that exist are not nothing. And a build
        // with warnings is not a failure: 42 warnings across four finished documents is an ordinary
        // good outcome, so the count is surfaced beside the success rather than instead of it.
        if (s.state === 'done') toast(warned ? `Built ${built} documents — ${warned} warnings, nothing sent`
                                             : `Built ${built} documents — nothing sent`)
        else toast(built ? `Build failed after ${built} documents: ${s.error || 'unknown error'}`
                         : `Build failed: ${s.error || 'unknown error'}`)
        setBuildJob(null)
        load()
      } catch { buildPoller.current = setTimeout(tick, 10000) }
    }
    buildPoller.current = setTimeout(tick, 4000)
  }, [id])

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

  // Approve and Reopen only. The `note` parameter and its `feedbackAdded` toast branch went with
  // `Request changes`: this function is now reached only from controls that never pass a note, so
  // the branch was unreachable. `regenerateWithNote` owns note-carrying status writes.
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

  /**
   * Regenerate, optionally steered by a note — the two controls this screen used to have.
   *
   * ORDER MATTERS AND IS THE WHOLE FUNCTION. The note must be in `packet.feedback` BEFORE the
   * generate call runs, because the generate path reads unresolved notes at its start
   * (`appPackets.ts:503`) and marks them resolved at its end (`:575`). Firing both at once, or
   * generating first, produces a rebuild that ignores the note and then resolves it — the note is
   * consumed having steered nothing, and it is gone, because `resolved` is what stops a note
   * replaying. So the status write is awaited, and a failure to store the note ABORTS rather than
   * regenerating without it: an unsteered rebuild the owner believes was steered is the worse
   * outcome, and it costs three model passes to produce.
   *
   * Cancel (null) does nothing. Empty string is a deliberate plain re-roll and skips the note write
   * entirely — `status === 'changes' && note` on the server would ignore it anyway, and writing
   * `changes` for an empty note would set a status that means nothing (see the button's comment).
   */
  const onRegenerate = async (a) => {
    const r = await regenerateWithNote({
      note: window.prompt(
        `Regenerate the ${TYPE_LABEL[a.type]}.\n\nAnything to change? Leave blank to rebuild as-is.`, ''),
      saveNote: (text) => api.setArtifactStatus(a.id, 'changes', text),
      generate: () => generate(a),
    })
    if (r.reason === 'note-failed') toast(`Not regenerated - your note could not be saved: ${r.error}`)
  }

  // THE OWNER TELLS US THEY APPLIED. Deliberate, never inferred.
  //
  // Nothing in the packet flow could reach the `applied` stage, which is why only 2 of 1,924
  // opportunities carried it. The obvious automation - advance on outreach send - is WRONG: those
  // channels include linkedinConnect, coldCall and followUp, and a connect request is not an
  // application. A human pressing this button is the only signal that actually means it.
  //
  // Reuses the existing stage route; the server marks the packet sent when the stage is `applied`,
  // so one press writes both facts and they cannot disagree.
  const markApplied = async () => {
    if (!window.confirm('Mark this opportunity as applied?\n\nThis records that you submitted the application, and moves the packet to Sent.')) return
    setApplying(true)
    try {
      const res = await api.moveStage(id, 'applied')
      if (res.error) throw new Error(res.error)
      setOpp((o) => (o ? { ...o, stage: res.stage } : o))
      if (res.packetSent) setPState((s) => (s.packet ? { ...s, packet: { ...s.packet, status: 'sent' } } : s))
      toast(res.packetSent ? 'Marked applied - packet moved to Sent' : 'Marked applied')
    } catch (err) { toast(`Could not mark applied: ${err.message || err}`) }
    finally { setApplying(false) }
  }

  // ── EVERY HOOK MUST BE ABOVE THE TWO RETURNS BELOW ──────────────────────────────────────────────
  //
  // `fieldFocus` and `goToField` used to sit ~30 lines further down, BELOW `if (pState.loading)`.
  // That is a conditional hook, and it did not degrade gracefully: the first render bails out early
  // having run N hooks, the loaded render runs N+2, and React aborts the whole tree with
  // **error #310, "Rendered more hooks than during the previous render."**
  //
  // MEASURED, not reasoned about. `ui-verify.yml` run 32886100713 and run 32886610272 — two
  // different opportunities, one with five evidence rows and one with none — both returned the
  // error boundary's "Something went wrong" with an empty body and that identical minified error,
  // while `#/settings/roles` rendered fine in run 32886894759. So the packet builder, the core
  // screen of this product, was DEAD ON LOAD from `a0bf0d1` (2026-08-24) until this commit, and
  // every change shipped to it in between was invisible in production.
  //
  // `artifacts` is derived here rather than after the returns because `goToField` closes over it.
  // Reading it through `pState.packet?.` is what lets the hook live above the guard at all.
  const artifacts = pState.packet?.artifacts || []
  // Option B: a finding names a field, and this is the SECOND destination for it - the draft itself,
  // beside the drawer route that already existed. The inverse of getArtifactsByStep: an artifact id
  // resolves to the step that renders it, so `compact_resume` lands on the Resume step exactly as
  // getArtifactsByStep puts it there. Derived from the same rule rather than a second mapping, or
  // the two drift the first time a step gains an artifact type.
  const [fieldFocus, setFieldFocus] = useState(null)     // { artifactId, section }
  // SPEC 4.11-9 - "every field-level action seeds this panel". The seed lives HERE rather than in
  // the panel because the actions that produce it are scattered across the asset cards, and a
  // sentence travelling upward through a shared slot is the same shape `fieldFocus` already uses
  // for navigation. `{ text, artifactId }`: the artifact travels WITH the sentence, because the
  // request is artifact-scoped and inferring it later from the active step would be a guess.
  const [assistantSeed, setAssistantSeed] = useState(null)
  // THE BINDING OUTLIVES THE SEED, and that separation is the whole fix. `assistantSeed` is a
  // ONE-SHOT text slot: `applySeed` clears it the instant the panel reads it, which is correct for
  // the sentence and was catastrophic for the artifact, because the artifact was read off the same
  // slot. Measured live 2026-09-03 (ui-verify 33757880817): forwarding a field's sentence opened a
  // panel carrying the text, headed "No asset open", with Send DISABLED -- defeating the seeder's
  // own stated contract, "never open a panel that cannot send". Any step rendering two artifacts
  // (resume + compact_resume) hit it, which is the step readers forward from most.
  const [assistantBinding, setAssistantBinding] = useState(null)   // { artifactId, section }
  // SPEC 4.11-4's field scope is only offered when a field is in focus, and until now the most
  // NATURAL way into the assistant did not put one there: a reader clicking "Ask the assistant" ON A
  // FIELD landed on the asset scope, because only `goToField` ever wrote `fieldFocus`. The seed
  // carried the artifact and dropped the field, so the panel could not know what they were looking
  // at. Measured live 2026-09-03 (ui-verify 33756770327): go-to-field then open-assistant both
  // clicked `ok` and the picker still rendered 0 chips.
  //
  // `section` is OPTIONAL and the focus is only written when it is present -- a seeder with no field
  // (a whole-asset ask) must not fabricate a focus, or the panel would offer to change "one field"
  // the reader never chose.
  const seedAssistant = useCallback((text, artifactId, section) => {
    if (!text || !artifactId) return                       // never open a panel that cannot send
    const sec = typeof section === 'string' && section.trim() ? section.trim() : null
    setAssistantSeed({ text: String(text), artifactId })
    // Survives the seed being consumed. Cleared when the panel closes, never by reading the text.
    setAssistantBinding({ artifactId, section: sec })
    if (sec) setFieldFocus({ artifactId, section: sec })
  }, [])
  // LEAVING THE STEP DROPS THE BINDING. Without this it outlives the reader's context: forward from
  // a field on the resume step, walk to the cover step, open the assistant cold, and it would still
  // be bound to the resume artifact -- a panel silently pointed at a document the reader is not
  // looking at, which is worse than the "No asset open" it replaces. `goToField` sets the step
  // BEFORE any seeder runs, so the forward flow is unaffected.
  useEffect(() => { setAssistantBinding(null) }, [activeStep])

  const goToField = useCallback((artifactId, section) => {
    const a = artifacts.find((x) => x.id === artifactId)
    if (!a) return                                        // unknown artifact: do nothing, never guess a step
    const stepKey = (a.type === 'resume' || a.type === 'compact_resume') ? 'resume' : a.type
    if (!STEPS.some((st) => st.key === stepKey)) return   // an artifact type with no step of its own
    setFieldFocus({ artifactId, section })
    setActiveStep(stepKey)
  }, [artifacts, setActiveStep])

  if (pState.loading) return <Loading />
  if (pState.error) return <ErrorBox error={pState.error} />

  const p = pState.packet
  const ready = p.status === 'ready'
  // The stored status and the COMPUTED gate, compared in one place. useQcEntries is fetched
  // screen-wide (only withInsertions/withRemediation are gated on the QC step), so this is live on
  // every step, not just QC.
  const readiness = packetReadiness(p.status, qcEntries)
  // SPEC 4.10's send step, from the LIVE checks rather than from the stored status. `ready` below is
  // `p.status === 'ready'` - a stored claim - and packetReadiness already exists to compare the two.
  // The fail list is what makes the step able to say WHAT is blocking rather than only THAT
  // something is.
  const failList = packetFailList(qcEntries)
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
              passed off as what the employer wrote. The employer's own text is opportunity.jd_posting_snapshot,
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
            }}
            /* 4.2-13: the SAME prop and the SAME call as the extraction card below. One step API,
               two surfaces - not a second navigation path. */
            onOpenQc={() => setActiveStep('qc')}
            swaps={provenance.swaps}
            listOwners={listOwnersFromArtifacts(qcEntries)}
            onGoToField={goToField} />

          <PostingAnalysisCard
            req={req.data} reqError={req.error} reloadReq={loadReq}
            coveredKw={coveredKw} missingKw={missingKw} gapsScoredAt={p.atsGapsScoredAt}
            onParse={parseJd} parseBusy={parseBusy} hasSummary={!!opp?.jdSummary}
            keywordScore={keywordScore}
            /* The confirm control needs an opportunity to post against, and `reloadReq` above is
               already this card's refresh - so accepting an excerpt re-reads the same payload the
               row was rendered from rather than patching local state and letting the two drift. */
            oppId={id}
            /* 4.1-3: navigation arrives as a prop and calls the ONE existing step API. A second
               router inside the card would be the parallel system extend-don't-duplicate forbids. */
            onOpenQc={() => setActiveStep('qc')}
            swaps={provenance.swaps}
            listOwners={listOwnersFromArtifacts(qcEntries)}
            onGoToField={goToField} />

          {/* The model output that reached NO document. Mounted here rather than on a page of its
              own because the two biggest sections -- the JD summary (4,374 chars) and the Jobscan
              extraction (2,893) -- are about THIS posting, and the rule this app already follows for
              corrections is "in place, scoped to the thing they are looking at" (SPEC 2, R6).
              Sections belonging elsewhere are routed to their own homes by `homeOf`; nothing is
              dropped. Renders nothing when this packet has no unplaced analysis. */}
          <AnalysisPanel packetId={p.id} home="jd" />

          <AnalysisRunCard
            busy={jdBusy} onRun={runJd} hasRun={!!p.jdAnalyzed} result={runResult}
            /* `onClick={buildAll}` handed React's SyntheticEvent straight into `opts`, so
               `opts.regen` was a property read off an event object. It is undefined, so the
               behaviour was right by accident — but an event is not an options bag, and the next
               option added there would have been silently ungettable. Both call sites are now
               explicit that they send nothing. */
            extra={(
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <button className="px-btn" style={{ fontSize: 12 }} disabled={allBusy} onClick={() => buildAll()}>
                  {allBusy ? 'Building…' : 'Build entire packet'}
                </button>
                {/* The build now runs on the server after the request returns, so the screen says
                    which of the two states it is in. "Queued" is real — a job waits for the next
                    worker tick — and a spinner that claimed it was already building would be a
                    small lie the owner would notice the moment it sat there for a minute. */}
                {buildJob && (
                  <span style={{ fontSize: 11, color: 'var(--proto-ink2)' }}>
                    {buildJob.state === 'running' ? 'building on the server — this takes a few minutes'
                                                  : 'queued — starts within a minute'}
                  </span>
                )}
              </span>
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
                <span className="px-link" role="button" tabIndex={0} onClick={() => buildAll()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); buildAll() } }}>Build entire packet</span> to generate all at once.
              </div>
            )}
            {/* WHICH RESUME this packet is built on. Only on the resume step, because that is the
                only step whose template the owner has more than one of. Choosing here also chooses
                the persona: `resolveRoleFocus` reads the resume template id before any other
                source, which is the owner's ruling -- "let the resume chosen drive the persona". */}
            {activeStep === 'resume' && (
              <ResumeTemplatePicker packetId={p.id} value={p.resumeTemplateId || ''}
                onSaved={load} />
            )}
            {stepArtifacts.map((a) => (
              <ArtifactCard key={a.id} a={a} busy={busy} setBusy={setBusy}
                onGenerate={generate} onRegenerate={onRegenerate} onSetStatus={setStatus}
                onMakeDoc={makeDoc} onMakeSlides={makeSlides}
                onGenVideo={genVideo} onArchiveVideo={archiveVideo}
                doc={doc} video={video} provenance={provenance}
                qcResult={(qcEntries.find((e) => e.artifact.id === a.id) || {}).result || null}
                qcStale={(qcEntries.find((e) => e.artifact.id === a.id) || {}).stale || false}
                qcStaleError={(qcEntries.find((e) => e.artifact.id === a.id) || {}).staleError || null}
                onStaleSignal={(stale, error) => { if (stale) markQcStale(a.id, error) }}
                onOpenFirstFix={(() => {
                  // Computed at the CALL SITE because `goToField` and the full entry list live here.
                  // `firstFixTarget` returns null when the asset has no openable field - unchecked,
                  // or a failing rule that names no subject - and null must reach GateBadge as an
                  // absent handler rather than as a no-op click.
                  const t = firstFixTarget(qcEntries, a.id)
                  return t ? () => goToField(t.artifactId, t.mergeField) : null
                })()}
                /* The badge must NAME the finding this handler opens, not a different one it
                   selected for itself. See `firstFixTarget` for the measured mismatch. */
                firstFix={firstFixTarget(qcEntries, a.id)}
                listOwners={listOwners} onListsRendered={registerLists}
                fieldOwners={fieldOwners} onGoToField={goToField}
                focusField={fieldFocus && fieldFocus.artifactId === a.id ? fieldFocus.section : null}
                /* SPEC 4.7-8 - the artifact travels WITH the sentence. Binding it at the call site,
                   where `a.id` is unambiguous, is what stops the panel inferring which asset a
                   request meant from whatever step happens to be active. */
                onSeedAssistant={(text, section) => seedAssistant(text, a.id, section)} />
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
            entries={qcEntries} setResult={setQcResult} markStale={markQcStale} clearStale={clearQcStale}
            requirements={req.data ? req.data.requirements : null} reqError={req.error}
            reqLoading={!req.data && !req.error} onGoToField={goToField}
            /* SPEC 4.8-21 - the swaps table's `Ask why`. The artifact still travels WITH the
               sentence, exactly as the asset cards bind it at :961; the difference is only WHERE it
               is resolved. An asset card knows its own `a.id`; a swap row is packet-level and has
               none, so the rail resolves it from the list the swap names and hands it over here.
               Nothing is inferred from the active step in either case. */
            onSeedAssistant={seedAssistant} />
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
                  {/* The COMPUTED gate beside the STORED status, because they answer different
                      questions and can disagree - which is the whole reason packetReadiness exists.
                      GateBadge was already imported into this file and mounted on the asset step;
                      this step showed the stored pill alone. */}
                  <GateBadge result={(qcEntries.find((e) => e.artifactId === a.id) || {}).result} compact
                    onClick={(() => {
                      const t = firstFixTarget(qcEntries, a.id)
                      return t ? () => goToField(t.artifactId, t.mergeField) : undefined
                    })()} />
                  <Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>
                </div>
              )
            })}
          </div>
          {/* THE PACKET GATE CARD (SPEC 4.10). Counted from the live checks, not from the stored
              status - the two can disagree, and packetReadiness exists precisely because they do.
              DETERMINISTIC rows only: a reviewer flag cannot block an artifact (decision D6), so
              listing one here would tell the reader they are blocked by something that cannot
              block them.

              THE RAIL TONE IS `red`/`green`, NOT `bad`/`good`. TONE_SOLID defines no such keys, so
              toneColor fell through to ink3 and this rail was the SAME grey whether the packet was
              blocked or clear - a signal that silently carried no signal. Shipped that way in
              dd4f61c; caught by the tone guard written for the evidence line the same day. */}
          <div className="px-box-soft" data-qc="send-gate-card" data-qc-count={failList.count}
            data-qc-assets={failList.assets}
            style={{ padding: 12, borderLeft: '3px solid ' + toneColor(failList.count ? 'red' : 'green') }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {failList.count === 0
                ? 'Nothing blocks sending.'
                : `${failList.count} item${failList.count === 1 ? '' : 's'} to fix across ${failList.assets} asset${failList.assets === 1 ? '' : 's'}`}
            </div>
            {failList.count > 0 && (
              <div className="px-small" style={{ textTransform: 'none', marginTop: 3, color: 'var(--proto-ink2)' }}>
                Sending stays locked until each one is fixed or the decision is recorded.
              </div>
            )}
            {/* ONE ROW PER FAILING ITEM, each with a way to reach it. A count with no rows tells the
                reader they are blocked and leaves them hunting; the prototype pairs them for that
                reason. */}
            {failList.items.map((f, i) => (
              <div key={`${f.artifactId}-${f.check_key || 'unchecked'}-${i}`} data-qc="send-fail-row"
                data-qc-artifact={f.artifactId} data-qc-check={f.check_key || 'unchecked'}
                style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--proto-rule-soft)' }}>
                <span className="px-small" style={{ fontWeight: 700, minWidth: 92 }}>{TYPE_LABEL[f.type] || f.type || 'asset'}</span>
                <span style={{ fontSize: 12, flex: 1, minWidth: 160, color: 'var(--proto-ink)' }}>{f.observed}</span>
                {f.mergeField && (
                  <button type="button" className="px-btn" data-qc="send-open-field"
                    data-qc-artifact={f.artifactId} data-qc-section={f.mergeField}
                    onClick={() => goToField(f.artifactId, f.mergeField)}
                    style={{ fontSize: 12, padding: '1px 8px' }}>Open field →</button>
                )}
              </div>
            ))}
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
      req={req.data} keywordScore={keywordScore} qcSummary={qcSummary}
      coveredKw={coveredKw} missingKw={missingKw} gapsScoredAt={p.atsGapsScoredAt} atsScore={atsScore}
      onBuildAll={() => buildAll({ regen: true })} buildBusy={allBusy}
      onGoResume={() => { setAtsOpen(false); setActiveStep('resume') }}
      onGoQc={() => { setAtsOpen(false); setActiveStep('qc') }}
      /* CLOSE FIRST, THEN NAVIGATE - the same ordering as onGoResume and onGoQc above, and the
         prototype's `setPanelOpen(false)` before `setStep(...)`. Navigating with the modal still
         open leaves the reader on the field they asked for, behind an overlay. This is the third
         exit the modal was missing: 4.3-13's ordering was already right for the two exits that
         existed, and the residual was that the gate rows had no exit at all. */
      onGoToField={(artifactId, section) => { setAtsOpen(false); goToField(artifactId, section) }} />
  )

  // ONE panel element, rendered by BOTH layout branches below. Defined once on purpose: the mobile
  // and desktop branches of this screen have drifted before, and a second copy of this JSX is how a
  // fix lands on one size and not the other.
  //
  // The artifact is whichever one the SEED named. When the panel is opened cold from its button and
  // the active step renders exactly one artifact, that one is used; when the step renders two (the
  // resume step renders `resume` and `compact_resume`) there is no non-guessing answer, so it stays
  // null and the panel says to open an asset first rather than picking one.
  const stepArtifacts = getArtifactsByStep(activeStep)
  const assistantArtifact = assistantBinding
    ? artifacts.find((a) => a.id === assistantBinding.artifactId) || null
    : (stepArtifacts.length === 1 ? stepArtifacts[0] : null)
  const assistant = (
    <AssistantPanel
      artifact={assistantArtifact}
      /* 4.11-4: the field the reader is looking at, from the SAME `fieldFocus` the cards already
         read - not a second copy of "which field is current". Null unless it belongs to the
         artifact the assistant is bound to, or the panel would offer a field scope for a document
         it is not editing. */
      /* The BINDING's own section wins, because it records the field the reader forwarded FROM.
         `fieldFocus` is the fallback for a panel opened cold on a step it happens to match. */
      field={assistantBinding && assistantBinding.section && assistantArtifact && assistantBinding.artifactId === assistantArtifact.id
        ? assistantBinding.section
        : (fieldFocus && assistantArtifact && fieldFocus.artifactId === assistantArtifact.id ? fieldFocus.section : null)}
      seed={assistantSeed ? assistantSeed.text : null}
      onSeedConsumed={() => setAssistantSeed(null)}
      onSent={load}
      mode={assistantMode_} />
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
        {/* SPEC 4.11-3 - the panel floats here too. Same element as the desktop
            branch below, so a fix can never land on one size and miss the other. */}
        {assistant}
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
          {/* The COMPUTED gate, in words, on every step. It used to reach the screen only as
              railGateMeta().tone on the QC step circle (see StepCircle below) - a colour, on one
              step of seven, which a reader who cannot tell the hues apart could not read at all. */}
          <Pill tone={readiness.tone} data-qc="packet-gate">{readiness.word}</Pill>
          {ready ? <Pill tone="green">Ready to ship ✓</Pill> : allBusy ? <Pill tone="yellow">building</Pill> : null}
          {ready && <button className="px-btn px-btn-accent" onClick={() => go(`/compose/${id}`)}>Send packet →</button>}
          {opp?.stage === 'applied'
            ? <Pill tone="green">Applied ✓</Pill>
            : (ready || p.status === 'sent') && (
              <button className="px-btn" disabled={applying} onClick={markApplied}>
                {applying ? 'Marking…' : 'Mark as applied'}
              </button>
            )}
        </div>
        {/* p.status is STORED and packetGate() is COMPUTED from the checks on screen; neither is
            derived from the other, so they can disagree. Saying so is the same stance reconcile()
            takes in the drawer - never quietly render the friendlier of two numbers that should
            agree. This reports; the server still owns the verdict and still refuses approval. */}
        {readiness.contradiction && (
          <div className="px-note" data-qc="packet-gate-contradiction" style={{ marginTop: 8 }}>
            <b>These two do not agree.</b> {readiness.contradiction}
          </div>
        )}
      </div>

      {/* THREE COLUMNS WHEN DOCKED, two otherwise: nav rail + content [+ assistant].
          The keyword column D4 deleted is NOT what came back here -- that was a data panel; this is
          SPEC 4.11's assistant, and it only fits because the shell cap moved to the prototype's own
          1560 (owner decision 2026-09-02). The arithmetic lives in `assistantPanel.js`, not here:
          `dockedContentWidth(1560) = 968px` against blocks needing ~850, and `DOCK_MIN_VIEWPORT`
          is DERIVED from those parts so narrowing the column can never silently squeeze the packet.
          Below that width `assistantMode` returns 'float' and this row is two columns again. */}
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

        {/* Right: SPEC 4.11's assistant, DOCKED. Rendered here and nowhere else in this branch —
            the float render at the bottom of this component is gated on the same mode so the panel
            can never mount twice. `flexShrink: 0` and the fixed DOCK_WIDTH are what make the
            centre column's `flex: 1` resolve to the width the arithmetic promised; letting the
            column flex would hand the packet back the squeeze this design exists to avoid. */}
        {assistantMode_ === 'dock' && assistant}

      </div>

      {keywordTally}

      {/* SPEC 4.11 - float mode only. When `assistantMode` says 'dock' the panel has already been
          rendered as the third column above, and rendering it here too would mount it twice: two
          textareas holding two drafts, and a seed consumed by whichever instance reacted first.
          The mobile branch renders its own 'sheet' and never reaches this line. */}
      {assistantMode_ === 'float' && assistant}
    </div>
  )
}
