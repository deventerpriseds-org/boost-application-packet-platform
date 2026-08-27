// P5.2 — asset blocks with provenance.
//
// One card per MERGE FIELD of the asset, formatted the way the document formats it, with the
// provenance for that field in the margin beside it. This replaces the collapsed `content` string:
// a wall of text cannot say which part of it was written for this posting and which part is
// template boilerplate, and that distinction is the entire point of the screen.
//
// EVERYTHING RENDERED HERE IS SOURCED FROM AN API ROW. Nothing is computed from an assumption:
//   GET /app/artifact/{id}/insertions   -> one row per merge field: generated, before_text,
//                                          after_text, method, loop, list, item_count,
//                                          requirement_id, verbatim_quote, requirement_verbatim,
//                                          plus filled / unfilled / attributed for the whole asset.
//   GET /app/packet/{id}/swaps          -> skill_candidate + swap_decision: action, driver,
//                                          from_label, to_label, verbatim_quote, rationale.
//   GET /app/opportunity/{id}/requirements -> the posting's requirement rows (seq, kind, verbatim).
//
// EVERY COUNT PRINTED HERE COMES OFF THE ROW, not off a re-measurement of the row's text. The
// derivation lives in ../assetBlocks.js so `node --test` can hold it to that; this file is the
// rendering only. See that module's header for why the browser is not allowed to supply a count.
//
// A count with no source is NOT rendered as a zero. `term_library_entry` has no published scoreable
// rows (appChecks.ts leaves keyword_coverage null for exactly this reason) and there is no per-asset
// term-placement endpoint, so the meter STATES that library-term placement is unknown rather than
// omitting the stat — an omitted stat and a measured zero read the same to a reader.
//
// A merge field the pipeline could not fill still gets a card, dashed and marked
// "Template - same in every packet" (the design's wording; `generated: false` is the API's own
// word for the same state). A block that
// was not changed has to SAY so; looking generated is the failure this screen exists to prevent.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import {
  BLOCK_HOOKS, observedFor, KIND_ABBR, KIND_WORD, KIND_LEGEND, reqChipLabel, METHOD_LABEL,
  countMismatchNote, deriveItems, draftSizeText, expectationFor, latestRows, listBodyModel, listsOf,
  targetFor,
  ASSET_ANSWERS_DEFAULT_OPEN, correctionsForField,
  keywordActions, keywordSwapOptions, keywordPresence,
  meterModel, originalState, PLACEHOLDER_NOTE, placeholderToken, proposedKeywordDetail,
  proposedKeywordsForRow, reqsForRow, scopeSwaps,
  shapeOf, sharedSourceNote, statPct, wordCount,
} from '../assetBlocks.js'
import { HIGHLIGHT_CLASS, HIGHLIGHT_ACTIVE_CLASS, markRuns } from '../highlight.js'
import { SEV_COLOR, SEV_LABEL, checkLabel, fieldLabel, severityCounts } from '../assetGate.js'
import { arr, fieldSeverities, findingsByField, offendersByField, offendersForField, railChangeLog } from '../qcRail.js'
import { CorrectionRow } from './QcRail.jsx'
import { useScrollToFocus, focusRingStyle } from '../focusRing.js'

export { BLOCK_HOOKS }

// The reader-side noun for the panel title. SPEC 7: name things by what the reader recognises.
const ANSWERS_LABEL = { resume: 'resume', compact_resume: 'compact resume', cover: 'cover letter',
  portfolio: 'portfolio', video: 'intro video' }

// ── shared provenance loader ────────────────────────────────────────────────────────────────────

/**
 * Requirements and swaps belong to the OPPORTUNITY and the PACKET, not to one artifact. Loading
 * them once here — rather than inside each card — is what keeps the resume and the compact resume
 * (two artifacts, one packet, byte-identical merge fields) describing the same posting instead of
 * issuing the same two requests twice and drifting if one fails.
 */
export function useAssetProvenance(oppId, packetId) {
  const [state, setState] = useState({ loading: true, requirements: null, swaps: null })
  useEffect(() => {
    let live = true
    setState({ loading: true, requirements: null, swaps: null })
    Promise.all([
      oppId ? api.oppRequirements(oppId).catch(() => null) : Promise.resolve(null),
      packetId ? api.packetSwaps(packetId).catch(() => null) : Promise.resolve(null),
    ]).then(([requirements, swaps]) => {
      if (!live) return
      setState({
        loading: false,
        requirements: requirements && !requirements.error ? requirements : null,
        swaps: swaps && !swaps.error ? swaps : null,
      })
    })
    return () => { live = false }
  }, [oppId, packetId])
  return state
}

/**
 * The change log for ONE artifact, so a correction can be read BESIDE the sentence it changed.
 *
 * The design puts corrections in two places on purpose (rendered and confirmed from the prototype
 * 2026-08-23): inline in the field's margin while you are reading the draft, and rolled up in the
 * QC step's "Done for you" while you are auditing the packet. Same rows, two surfaces - which is
 * exactly why this must NOT grow its own notion of what a correction is.
 *
 * So it goes through `railChangeLog` like every other surface. `result.corrections` is never read
 * here; the moment a second `.jsx` touches that property there are two definitions of how many
 * corrections there are, which is the bug the QC counts strip already shipped twice.
 *
 * Fetched here rather than threaded down from PacketBuilder because the blocks panel is collapsible
 * and per-artifact - the resume and the compact resume are two artifacts with byte-identical merge
 * fields, and each needs its OWN change log or one would show the other's corrections.
 *
 * It also carries the FIELD-MARGIN findings out of the same payload rather than fetching it twice.
 * `posting_wording_kept` belongs beside the sentence for the same reason a correction does - the
 * prototype puts both in the margin - and it arrives on the response this hook already has. The
 * grouping is done here, through `offendersByField`, so no component ever holds the raw result and
 * grows its own idea of which field a finding names.
 */
/**
 * The owner's banked skills, for the 4.6-9 swap control.
 *
 * Loaded ONCE per card rather than per keyword panel: the bank belongs to the OWNER, not to a
 * keyword or a field, and fetching it when a chip opens would issue the same request every time a
 * reader browsed chips.
 *
 * A failure resolves to an EMPTY ARRAY, never a thrown error and never a retry loop. An empty bank
 * is already a first-class state the control handles - it renders the reason instead of a picker -
 * so an unreachable route degrades into "nothing of your own to swap in" rather than breaking the
 * keyword panel that was working a moment ago.
 */
export function useSkillBank() {
  const [rows, setRows] = useState([])
  useEffect(() => {
    let live = true
    api.skillBankGet()
      .then((r) => { if (live) setRows(Array.isArray(r?.entries) ? r.entries : []) })
      .catch(() => { if (live) setRows([]) })
    return () => { live = false }
  }, [])
  return rows
}

export function useArtifactCorrections(artifactId) {
  const [state, setState] = useState(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let live = true
    if (!artifactId) { setState(null); return undefined }
    setState(null)
    api.artifactChecksResult(artifactId)
      .then((result) => {
        if (!live) return
        setState({
          log: railChangeLog(result),
          wording: offendersByField(result, 'posting_wording_kept'),
          severity: severityCounts(result),
          fieldSev: fieldSeverities(result),
          findings: findingsByField(result),
        })
      })
      .catch(() => { if (live) setState(null) })
    return () => { live = false }
  }, [artifactId, reload])
  return {
    rows: state ? state.log.rows : null,
    // The SERVER'S measured number, not `rows.length`: `count` excludes rows the reader undid, and
    // is null for every payload that was never measured. meterModel refuses to print the null.
    correctedCount: state ? state.log.count : null,
    wording: state ? state.wording : null,
    severity: state ? state.severity : null,
    fieldSev: state ? state.fieldSev : null,
    findings: state ? state.findings : null,
    checked: !!state,
    refresh: () => setReload((n) => n + 1),
  }
}

// Width of the card itself, not of the window: whether the margin sits beside the text or under it
// depends on this column, which changes with the layout around it.
function useWideRef(min = 700) {
  const ref = useRef(null)
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWide(e.contentRect.width >= min)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [min])
  return [ref, wide]
}

// ── small pieces ────────────────────────────────────────────────────────────────────────────────

function ReqChip({ req }) {
  if (!req) return null
  // Through the SHARED formatter, and the `+ 1` that used to be here is gone. It made this the only
  // 1-based surface in the app, so a finding citing `#0` pointed at a chip labelled `1`. See
  // reqChipLabel() for the seven api writers and the parser that fix the convention.
  return (
    <span className="px-chip" title={`${KIND_WORD[req.kind] || req.kind || 'requirement'} - ${req.item_text || ''}`}
      style={{ background: 'var(--proto-accent-soft)', color: 'var(--text-brand)', fontWeight: 600 }}>
      {reqChipLabel(req.kind, req.seq)}
    </span>
  )
}

/**
 * What the chip abbreviations mean, spelled out once per asset.
 *
 * The chips were opaque tokens on every asset step: `M3`, `N1`, `R2` with the expansion available
 * only in a `title` tooltip, which does not exist on touch and is invisible to anyone scanning. A
 * reader could not tell whether `R` was "required" or "responsibility" — and it was the latter,
 * while `M` was the former, so the obvious guess was wrong.
 *
 * ONLY the kinds actually present on this asset, so it stays a legend rather than a glossary of
 * things the reader cannot see. Rendered from KIND_LEGEND, which is built from the same two maps
 * the chips read, so a kind can never be chipped and un-legended.
 */
function ReqLegend({ reqs }) {
  const present = new Set(arr(reqs).map((r) => r && r.kind).filter(Boolean))
  const rows = KIND_LEGEND.filter((l) => present.has(l.kind))
  if (rows.length < 1) return null
  return (
    <div className="px-small" data-qc={BLOCK_HOOKS.reqLegend} style={{ textTransform: 'none', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {rows.map((l) => (
        <span key={l.kind}><b>{l.abbr}</b> {l.word}</span>
      ))}
    </div>
  )
}

// The posting's own words. Rendered as a quote and never paraphrased — an attribution the reader
// cannot check against the ad is not an attribution.
function Verbatim({ text }) {
  if (!text) return null
  // The POSTING ECHO highlight (D11): a pale wash under a rule, painted through the shared .qc-echo
  // class. It is deliberately a different KIND of treatment from the keyword highlight - a filled
  // highlighter - so the two cannot be confused by a reader who cannot separate the two hues.
  return (
    <div className="px-small" data-qc={BLOCK_HOOKS.quote}
      style={{ marginTop: 6, textTransform: 'none', fontStyle: 'italic', lineHeight: 1.5, color: 'var(--proto-ink2)' }}>
      Posting says: <span className={HIGHLIGHT_CLASS.postingEcho}>&quot;{text}&quot;</span>
    </div>
  )
}

// A statement the card makes about itself that its own source contradicts. Shown, never resolved
// in the browser's favour.
function CountMismatch({ note }) {
  if (!note) return null
  return (
    <div className="px-note" data-qc={BLOCK_HOOKS.mismatch} style={{ marginTop: 8, borderColor: 'var(--proto-yellow, var(--proto-rule-soft))' }}>
      <div className="px-small" style={{ textTransform: 'none', lineHeight: 1.5 }}>{note}</div>
    </div>
  )
}

function Stat({ label, n, d, sub }) {
  const pct = statPct(n, d)
  const all = d > 0 && n === d
  return (
    <div data-qc={BLOCK_HOOKS.stat} data-qc-stat={label} style={{ minWidth: 150, flex: '1 1 150px' }}>
      <div className="px-label">{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '2px 0 5px' }}>
        <b style={{ fontSize: 18, lineHeight: 1, color: all ? 'var(--proto-green)' : 'var(--text-brand)' }}>{n}</b>
        <span style={{ fontSize: 12, color: 'var(--proto-ink3)' }}>of {d}</span>
      </div>
      <div className="px-bar"><i style={{ width: `${pct}%`, background: all ? 'var(--proto-green)' : 'var(--surface-brand-default)' }} /></div>
      <div className="px-small" style={{ textTransform: 'none', marginTop: 4 }}>{sub}</div>
    </div>
  )
}

/**
 * The distribution meter. Every stat here has a denominator that came out of an API response; a
 * stat whose source is missing is not shown as 0 of 0 — it is stated as unknown in the notes
 * underneath, so "nothing was placed" and "nothing was measured" cannot be confused.
 */
/**
 * "What this resume answers" - the asset header, COLLAPSED by default.
 *
 * This is the panel P8.7 was always talking about ("asset headers are collapsed by default"). It was
 * previously applied to the whole artifact card, which hid the draft; see `ASSET_BODY_DEFAULT_OPEN`.
 * The card body now opens, and THIS is what closes - which is what the prototype does:
 * `screens/INDEX.md` 09 "Artifact card header … collapsed asset header", 10 the same expanded.
 *
 * Two things carry over from the prototype and one deliberately does not.
 *
 *   CARRIED: the reader-side name. "What this resume answers" is a question the reader has;
 *   "What is in this asset" is a description of a data structure. SPEC §7 copy rules.
 *   CARRIED: collapsed, with the numbers still readable on the closed row. A disclosure that hides
 *   its own summary makes you open it to find out whether opening it was worth it.
 *   NOT CARRIED: the prototype's stat NAMES. It shows "5/5 must-haves · 11/13 keywords" against
 *   fabricated demo data. Ours come from `meterModel`, which reports what is actually measured and
 *   says so when a denominator does not exist yet - "no published, scoreable library terms exist,
 *   so how many this asset places is unknown - not measured, not zero". Replacing a measured stat
 *   with the prototype's prettier one would be inventing a number, which is the one thing this
 *   screen exists to prevent.
 */
function DistributionMeter({ rows, filled, unfilled, requirements, scopedSwaps, terms, label, corrected, severity, checked }) {
  const { stats, notes, corrected: correctedCount } = meterModel({ rows, filled, unfilled, requirements, scopedSwaps, terms, corrected })
  const [open, setOpen] = useState(ASSET_ANSWERS_DEFAULT_OPEN)
  if (!stats.length && !notes.length && correctedCount == null) return null
  const toggle = () => setOpen((v) => !v)

  return (
    <div className="px-box" data-qc={BLOCK_HOOKS.meter} data-qc-open={open ? '1' : '0'}
      style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: open ? 10 : 0 }}>
      <div role="button" tabIndex={0} data-qc={BLOCK_HOOKS.meterToggle} aria-expanded={open}
        onClick={toggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
        style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', cursor: 'pointer' }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>What this {label || 'asset'} answers</div>
        {/* The summary stays on the collapsed row: the counts are the reason to open it. */}
        {!open && stats.map((s) => (
          <span key={s.key} className="px-small" data-qc={BLOCK_HOOKS.meterSummary} style={{ textTransform: 'none' }}>
            {s.n}{s.d == null ? '' : ` of ${s.d}`} {s.label.toLowerCase()}
          </span>
        ))}
        {/* "N corrected", green, on the collapsed row - the prototype's own summary token
            (qc/assets.jsx:218). It stays visible when the meter is OPEN too, because unlike the
            stats it has no expanded form to defer to: the corrections themselves are rendered in
            the field margins below, not inside this box. */}
        {correctedCount != null && (
          <span className="px-small" data-qc={BLOCK_HOOKS.meterCorrected}
            style={{ textTransform: 'none', fontWeight: 700, color: 'var(--proto-green)' }}>
            {correctedCount} corrected
          </span>
        )}
        {/* The rest of the prototype's collapsed-row summary (qc/assets.jsx:218-221). Same three
            buckets the rail uses, through the SAME `severityFor` split, so the header and the rail
            can never disagree about how many findings block this asset. A zero bucket is omitted
            rather than printed - "0 to fix" is not news, and the prototype omits it too. */}
        {severity && severity.fix > 0 && (
          <span className="px-small" data-qc={BLOCK_HOOKS.meterToFix}
            style={{ textTransform: 'none', fontWeight: 700, color: 'var(--proto-red)' }}>
            {severity.fix} to fix
          </span>
        )}
        {severity && severity.review > 0 && (
          <span className="px-small" data-qc={BLOCK_HOOKS.meterToReview}
            style={{ textTransform: 'none', fontWeight: 700, color: 'var(--proto-yellow)' }}>
            {severity.review} to review
          </span>
        )}
        {/* THE CHECKED-AND-CLEAR STATE. Without it, "clear" and "never checked" look identical on
            this row: both render no counts. Guarded on a LOADED result (`checked`) as well as the
            three zeros, because an empty payload is the UNCHECKED case and calling that "nothing to
            review" is the absence of a verdict laundered into a pass. */}
        {checked && severity && severity.fix === 0 && severity.review === 0 && severity.soft === 0 && (
          <span className="px-small" data-qc={BLOCK_HOOKS.meterClear}
            style={{ textTransform: 'none', fontWeight: 700, color: 'var(--proto-green)' }}>
            Nothing to review on this asset.
          </span>
        )}
        {severity && severity.soft > 0 && (
          <span className="px-small" data-qc={BLOCK_HOOKS.meterYourCall} style={{ textTransform: 'none' }}>
            {severity.soft} your call
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span className="px-link" style={{ fontSize: 11.5 }}>{open ? 'Hide' : 'Show'}</span>
      </div>
      {open && stats.length > 0 && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {stats.map((s) => <Stat key={s.key} label={s.label} n={s.n} d={s.d} sub={s.sub} />)}
        </div>
      )}
      {open && notes.map((n, i) => (
        <div key={i} className="px-small" data-qc={BLOCK_HOOKS.note} style={{ textTransform: 'none' }}>{n}</div>
      ))}
    </div>
  )
}

// ── one merge field ─────────────────────────────────────────────────────────────────────────────

function ListBody({ row, swapsForList, artifactId, listOwners, phrases, active = null }) {
  const model = listBodyModel(row, swapsForList, { artifactId, listOwners })
  return (
    <div>
      {model.lines.map((line, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'baseline',
          padding: '6px 0', borderBottom: '1px solid var(--proto-rule-soft)',
        }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, minWidth: 0 }}>
            {line.from && (
              <span style={{ color: 'var(--proto-ink3)' }}>
                {line.from} <span style={{ padding: '0 4px' }}>&rarr;</span>
              </span>
            )}
            <span style={{ fontWeight: line.from ? 600 : 400 }}><Marked text={line.text} phrases={phrases} active={active} /></span>
          </div>
          {/* The status and the packet-level marker stack rather than run on, so the column stays
              as narrow as its longest token on a phone. */}
          <span className="px-small" style={{ textAlign: 'right' }}
            title={line.sharedSource ? 'packet-level decision - recorded once for the whole packet' : undefined}>
            <span style={{ whiteSpace: 'nowrap' }}>{line.status}</span>
            {line.sharedSource && (
              <span style={{ display: 'block', whiteSpace: 'nowrap', color: 'var(--proto-ink3)' }}>packet-level</span>
            )}
          </span>
        </div>
      ))}

      {/* Decision 9: swap_decision is keyed by PACKET, so this same row renders on every asset that
          renders this list. Saying so is what stops two cards reading as two separate changes. */}
      {model.sharedNote && (
        <div className="px-small" data-qc={BLOCK_HOOKS.shared} style={{ textTransform: 'none', lineHeight: 1.5, marginTop: 8, color: 'var(--proto-ink2)' }}>
          {model.sharedNote}
        </div>
      )}

      {model.dropped.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="px-label" style={{ marginBottom: 3 }}>Taken out of this list</div>
          {model.dropped.map((s, i) => (
            <div key={i} className="px-small" style={{ textTransform: 'none', lineHeight: 1.5 }}>
              <s>{s.from_label}</s>{s.rationale ? ` - ${s.rationale}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BlockBody({ row, shape, swapsForList, artifactId, listOwners, phrases, active = null }) {
  if (shape === 'static') {
    // SPEC 4.5-40: show the {{token}} inline so the reader can see WHERE merged text lands.
    //
    // The sentence underneath used to read "The pipeline cannot see that text, so it is not shown
    // as a draft" - which is true of the template's surrounding WORDS and false of the field NAME,
    // printed in mono two lines above this and now printed again here. Shipping the token while
    // that sentence stood would put a contradiction on one screen, the class
    // `H:no-stale-not-built-claim` exists to catch (it greps only the QC rail, so it could not see
    // this file - that guard's file list is extended in the same commit).
    const token = placeholderToken(row)
    return (
      <div className="px-small" style={{ textTransform: 'none', lineHeight: 1.6 }}>
        No value reached this merge field, so the document keeps whatever the template already says
        here.{' '}
        {token ? (
          <>
            Merged text would land at{' '}
            <span data-qc={BLOCK_HOOKS.fieldPlaceholder}
              style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--proto-ink2)' }}>{token}</span>
            {' '}- {PLACEHOLDER_NOTE}. The app does not hold the template&apos;s surrounding words, so
            there is no draft to show.
          </>
        ) : (
          <>This block names no merge field, so there is nothing to point at.</>
        )}
      </div>
    )
  }
  if (shape === 'list') return <ListBody row={row} swapsForList={swapsForList} artifactId={artifactId} listOwners={listOwners} phrases={phrases} active={active} />
  if (shape === 'pipe') {
    return (
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.9, wordBreak: 'break-word', whiteSpace: 'pre-line' }}>
        <Marked text={row.after_text} phrases={phrases} active={active} />
      </div>
    )
  }
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.65, whiteSpace: 'pre-line' }}>
      <Marked text={row.after_text} phrases={phrases} active={active} />
    </div>
  )
}

/**
 * Draft text with the posting's own wording MARKED inside it — the treatment the prototype applies
 * (`Marked`, qc/assets.jsx:8) and the app painted only in margin quotes until now.
 *
 * Marks ONLY `posting_wording_kept` phrases. The other echo the app knows about is
 * `posting_figure_echo`, and it is deliberately NOT marked here: those offenders read
 * `$18M (your profile states ...)` rather than a bare phrase, and a figure taken from the ad is
 * already CORRECTED by R3 rather than left for the reader to judge — marking it would point at
 * text the pipeline has usually already rewritten.
 *
 * KEYWORD marking is absent, and the reason is narrower than an earlier version of this comment
 * said. It read "term_library_entry has zero published rows; a highlight with no source would be
 * invented", and that sentence caused a real false block: a session quoted it as proof the keyword
 * chips and the SPEC 4.6 detail panel could not be built at all, and reported the whole row to the
 * owner as gated on the library. The owner corrected it — *"the ai generates keywords from the
 * promtps so you will have several it suggests term library or not... no matter what the notes
 * ssay its a self block unneccasarily"* — and the data agrees:
 *   `requirement.model_keyword` IS jd_table's ATS Keyword. It is written by the JD parse
 *   (`requirements.ts:408`), returned by the requirements endpoint (`appRequirements.ts:409`),
 *   reduced to a distinct list by `postingAnalysis.js:258`, and ALREADY RENDERED on the JD step
 *   (`PostingAnalysis.jsx:401`).
 * So a source exists. What `term_library_entry` gates is SCORING — the schema's rule is
 * `never scoreable`, which is about coverage counts, not about display. A model-proposed keyword
 * shown WITH that label is honest; the same keyword inside a coverage number is not.
 *
 * It stays unmarked HERE only because nothing yet says which keywords a given FIELD places — that
 * is a per-asset placement question, not a library question. Do not repeat "blocked on the library"
 * without re-reading this paragraph.
 */
function Marked({ text, phrases, active = null }) {
  const runs = markRuns(text, phrases)
  if (!runs.some((r) => r.mark)) return text || null
  return runs.map((r, i) => {
    if (!r.mark) return <React.Fragment key={i}>{r.t}</React.Fragment>
    // IDENTITY, not a search. `r.phrase` is the caller's own array element, handed back by
    // markRuns; `active` is the element the margin row is rendering. `===` between them is the
    // whole linkage. Any `includes`/`indexOf`/lowercase comparison here would be a SECOND matcher
    // deciding what a highlight points at, which is the one thing highlight.js exists to own.
    const on = active != null && r.phrase === active
    return (
      <span key={i} className={on ? `${HIGHLIGHT_CLASS[r.mark]} ${HIGHLIGHT_ACTIVE_CLASS}` : HIGHLIGHT_CLASS[r.mark]}>
        {r.t}
      </span>
    )
  })
}

function AssetBlock({ row, reqs, swapsForList, wide, artifactId, listOwners, thresholds, focused = false, focusRef,
  corrections = [], wording = [], wordingExpected = '', fieldSev = null, findings = [],
  correctionBusy, setCorrectionBusy, onCorrectionsChanged }) {
  // Which `wording` entry the reader is pointing at, or null. Lifted to AssetBlock because the two
  // ends of the link — the draft text (via BlockBody) and the margin row — are both its children,
  // and this is the lowest node that owns both. The VALUE is an element of `wording` itself, never
  // a copy or a derived key: `Marked` compares it by identity against what markRuns reports, so a
  // second identifier here would be a second matcher deciding where a highlight points.
  const [activeWording, setActiveWording] = useState(null)
  // Which proposed-keyword chip has its panel open, or null. Local to the field: two fields may
  // legitimately propose the same keyword and opening one must not open the other's.
  const [openKeyword, setOpenKeyword] = useState(null)
  // Derived from the SAME `reqs` the requirement chips render, so a keyword and the posting line it
  // came from can never disagree about which requirements this field cites.
  const proposedKeywords = proposedKeywordsForRow(reqs)
  const openKeywordDetail = openKeyword ? proposedKeywordDetail(reqs, openKeyword) : null
  // ONE derivation of "does this draft contain this keyword", feeding the highlight, the chip state
  // AND the not-in-the-text line. Three separate computations of the same fact is how two of them
  // come to tell the reader different things about one field.
  const kwPresence = keywordPresence(row.after_text, proposedKeywords)
  const kwPresent = new Set(kwPresence.present)
  const skillBank = useSkillBank()
  // Both treatments go through markRuns in ONE pass, so a posting echo and a keyword can never
  // claim the same characters. `mark` rides per phrase; see highlight.js.
  const markPhrases = [...wording, ...proposedKeywords.map((k) => ({ phrase: k, mark: 'keyword' }))]
  const [showBefore, setShowBefore] = useState(false)
  // What the "Show original" panel says. Derived in ../assetBlocks.js, never inline: this file
  // renders, it does not decide. See `originalState` for why before_text may legitimately be null.
  const original = useMemo(() => originalState(row), [row])
  const [askOpen, setAskOpen] = useState(false)
  const [ask, setAsk] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [askError, setAskError] = useState(null)
  // SPEC 4.7-7 - the confirmation must OUTLIVE the box that sent it. The success path sets
  // askOpen(false), so anything rendered inside the box disappears at the moment it would be read;
  // this sits in the block, beside the change log the edit will show up in.
  const [askSent, setAskSent] = useState(null)
  // The prototype's "Ask assistant" beside a kept phrase seeds the assistant with a reword request
  // (qc/assets.jsx:139). Here it opens the field's OWN ask box with that sentence already typed -
  // the same box, the same `api.aiEditArtifact(..., { section })` route. Not a second edit path,
  // and nothing is sent until the reader presses Send, so the wording stays theirs to edit.
  //
  // ONE seed-then-open primitive, so a second surface that wants to phrase a request cannot grow a
  // second edit path to do it. `seedAskReword` keeps its own sentence and simply delegates; the
  // keyword panel's drop request (SPEC 4.6-10/4.6-11) is the second caller. Both set state and
  // return - neither sends, and `api.aiEditArtifact` still has exactly one call site on this screen
  // (guarded by H:wording-ask-reuses-the-field-edit-path).
  const seedAsk = (sentence) => {
    setAsk(sentence)
    setAskOpen(true)
  }
  const seedAskReword = (phrase) => seedAsk(`Reword "${phrase}" so it does not repeat the posting's wording.`)
  const shape = shapeOf(row)
  const isStatic = shape === 'static'
  const expect = expectationFor(row.merge_field)
  const target = targetFor(row.merge_field, thresholds)
  // Same inputs as `target`, deliberately: the two render side by side and must be about the
  // same rule, so they are computed from one field and one threshold set on one line apart.
  const observed = observedFor(row.merge_field, row, thresholds)
  // The ROW's count, not a re-split of its text. When the two disagree the card says so rather
  // than printing the browser's number over the one the checks were run against.
  const measured = deriveItems(row)
  const count = measured.count
  const countNote = countMismatchNote(measured.recorded, measured.splitCount)
  const words = wordCount(row.after_text)
  const sharedNote = swapsForList.length && shape !== 'list' ? sharedSourceNote(row.list, artifactId, listOwners) : null

  // The reason this block reads the way it does. For a list field the swap rows carry the pipeline's
  // own rationale; for every other field the reason is the attribution (or the honest absence of one).
  const rationales = [...new Set(swapsForList.filter((s) => s.rationale && s.action !== 'kept').map((s) => s.rationale))]
  const firstSwapQuote = (swapsForList.find((s) => s.verbatim_quote) || {}).verbatim_quote || null
  const reason = isStatic
    ? 'Nothing was generated for this field, so nothing changed it.'
    : rationales.length
      ? null
      : reqs.length
        ? 'Written against the posting line cited above.'
        : 'No posting line matched this block, so nothing in the ad drove its wording.'

  const content = (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{fieldLabel(row.merge_field)}</span>
        {/* The measurement, in the RULE'S unit whenever there is a rule - observedFor() mirrors
            targetFor() branch for branch. Without one this falls back to lines/words, which is all
            an unruled field has. The old line printed lines/words for EVERY field, so a skills list
            read "10 lines - 20 words - <= 24 chars each": a word count beside a character limit,
            two halves that do not answer each other. Seen on the live screen, not inferred. */}
        {/* STATE COLOUR ON THE MEASUREMENT, not just on the target. Both halves have been correct
            and unit-matched since the observedFor/targetFor pass, but they painted identically
            whether the field met its rule or not - a 70-word summary against a 55-60 band looked
            exactly like a 57-word one. The colour comes from the CHECK ROWS for this field, through
            the same `severityFor` split the rail and the header use, so a red measurement here and
            a green gate there cannot disagree. No finding for this field means no colour: an
            unmeasured field must not read as passing. */}
        {!isStatic && (
          <span className="px-small" data-qc={BLOCK_HOOKS.fieldObserved}
            data-qc-sev={fieldSev || ''}
            style={SEV_COLOR[fieldSev] ? { color: SEV_COLOR[fieldSev], fontWeight: 700 } : undefined}>
            {observed || `${count > 1 ? `${count} lines - ` : ''}${words} words`}
          </span>
        )}
        {/* The CONTRACT beside the measurement, in the words of the rule that enforces it - the
            prototype states both ("longest 22 chars - <= 24 chars each"), and a measurement with no
            target cannot tell the reader whether it is fine. The number is the OWNER'S threshold,
            carried from settings; `targetFor` returns null rather than guessing one. */}
        {!isStatic && target && (
          <span className="px-small" data-qc={BLOCK_HOOKS.fieldTarget} style={{ textTransform: 'none' }}>{target}</span>
        )}
        <span style={{ flex: 1 }} />
        <span className="px-small" data-qc={BLOCK_HOOKS.fieldSlot}
          style={{ textTransform: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{row.merge_field}</span>
        {expect && !target && (
          <span className="px-small" style={{ textTransform: 'none' }}>
            field name asks for {expect.bullets ? `${expect.bullets} bullets` : ''}{expect.bullets && expect.words ? ' - ' : ''}{expect.words ? `${expect.words} words` : ''}
            {isStatic ? '' : ` - this draft has ${draftSizeText(row, expect)}`}
          </span>
        )}
      </div>

      <BlockBody row={row} shape={shape} swapsForList={swapsForList} artifactId={artifactId} listOwners={listOwners} phrases={markPhrases} active={activeWording} />

      <CountMismatch note={countNote} />

      {sharedNote && (
        <div className="px-small" data-qc={BLOCK_HOOKS.shared} style={{ textTransform: 'none', lineHeight: 1.5, marginTop: 8, color: 'var(--proto-ink2)' }}>
          {sharedNote}
        </div>
      )}

      {showBefore && (
        <div className="px-note" data-qc={BLOCK_HOOKS.before} data-qc-state={original.kind} style={{ marginTop: 9 }}>
          {/* Three states, decided in ../assetBlocks.js so `node --test` can hold them:
                changed   - a real earlier version exists and differs
                identical - before and after are the same bytes. "before this posting" would be a
                            FALSE CLAIM on a field nothing changed: the template text was never
                            merged per packet, so there is no "before".
                none      - no earlier version exists. Disclosed, not hidden. Hiding it is what made
                            the control look like a dead link. */}
          <div className="px-label" style={{ color: 'var(--text-info)', marginBottom: 3 }}>{original.label}</div>
          {original.text !== null && (
            <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{original.text}</div>
          )}
          {original.body && (
            <div className="px-small" style={{ textTransform: 'none', lineHeight: 1.5, color: 'var(--proto-ink2)' }}>
              {original.body}
            </div>
          )}
        </div>
      )}

      {/* The field's own controls, in the prototype's place: under the text, same position on every
          field (screens/INDEX.md 11, "Show original  Ask for a change").
          "Compare with original" was the app's phrasing for the same act; the design says
          "Show original", and it pairs with "Hide original" which was already correct.

          "LIST TWEAKS", NOT the prototype's "Ask for a change" - the owner renamed it, and the
          new name is the more honest one. This control does not ASK anyone for anything: it sends
          the instruction plus the field's current text to the model and writes the revised text
          straight back (`appPackets.ts:1299` artifactAiEdit). It is an edit you make, phrased as a
          list of tweaks. The old name also collided with `Request changes` on the artifact card,
          which sounded like the same act and was not. */}
      <div style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* SPEC 4.5 puts this on EVERY field. It used to be gated on `row.before_text`, so a field
            with no earlier version showed nothing at all and the reader could not tell "unchanged"
            from "broken" from "first draft". It is unconditional now; `originalState` decides what
            the panel says, including the honest "there is none yet". */}
        <span className="px-link" role="button" tabIndex={0} aria-expanded={showBefore}
          data-qc={BLOCK_HOOKS.compareToggle} data-qc-open={showBefore ? '1' : '0'}
          style={{ fontSize: 11.5 }} onClick={() => setShowBefore((v) => !v)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowBefore((v) => !v) } }}>
          {showBefore ? 'Hide original' : 'Show original'}
        </span>
        {/* ASK FOR A CHANGE, scoped to THIS field. Not a second edit path - it posts to the same
            `ai-edit` route with `section`, which is what QcRail's correction row already uses. The
            reason it belongs here too is the whole argument of this screen: the request is made
            where the sentence is being read, not on a tab that lists sentences. */}
        {/* role + tabIndex + key handler for the same reason as PacketBuilder's copy control: a
            bare span has no keyboard path and is announced as text, and compare-ui.mjs (which
            collects `button, [role="button"], a`) could not see it either - so a control that
            has existed since P8.6 was being reported as missing from the app. */}
        {!isStatic && artifactId && (
          <span className="px-link" role="button" tabIndex={0} aria-expanded={askOpen}
            data-qc={BLOCK_HOOKS.askChange} data-qc-field={row.merge_field}
            style={{ fontSize: 11.5 }} onClick={() => setAskOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              // A stale confirmation must not sit above a NEW ask - it would read as confirming the
              // one being typed. Cleared on open, not on send, so it survives the box closing.
              setAskSent(null)
              setAskOpen((v) => !v)
            }}>
            {askOpen ? 'Cancel' : 'List Tweaks'}
          </span>
        )}
      </div>

      {askOpen && (
        <div data-qc={BLOCK_HOOKS.askBox} style={{ marginTop: 8 }}>
          <div className="px-small" style={{ textTransform: 'none' }}>
            This rewrites <b>{row.merge_field}</b> only. Anything auto-corrected in it can no longer be undone.
          </div>
          <textarea className="px-input" rows={2} value={ask} placeholder="List the tweaks for this field"
            onChange={(e) => setAsk(e.target.value)} style={{ width: '100%', marginTop: 4, resize: 'vertical' }} />
          {askError && <div className="px-note" style={{ marginTop: 6 }}>{askError}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button type="button" className="px-btn" disabled={askBusy}
              onClick={() => { setAskOpen(false); setAsk(''); setAskError(null) }}>Cancel</button>
            <button type="button" className="px-btn px-btn-accent" data-qc={BLOCK_HOOKS.askSend}
              disabled={askBusy || !ask.trim()}
              onClick={async () => {
                setAskBusy(true); setAskError(null)
                try {
                  await api.aiEditArtifact(artifactId, { instruction: ask.trim(), section: row.merge_field })
                  // Captured BEFORE the box is cleared: the sentence names what was asked, because
                  // "Sent" alone does not tell a reader which of several asks landed.
                  const sentText = ask.trim()
                  setAsk(''); setAskOpen(false)
                  if (onCorrectionsChanged) await onCorrectionsChanged()
                  setAskSent(sentText)
                } catch (e) { setAskError(String((e && e.message) || e)) }
                finally { setAskBusy(false) }
              }}>{askBusy ? 'Sending...' : 'Send'}</button>
          </div>
        </div>
      )}
      {/* SPEC 4.7-7 - success now speaks, in place, where failure already did.
          OUTSIDE the `askOpen &&` block on purpose: the success path closes the box, so a message
          rendered inside it would unmount at the instant it became true. The asymmetry was the whole
          finding - `askError` rendered in place while success was silent, leaving no way to tell
          "sent and applied" from "the button did nothing".
          It names what was asked, because "Sent" alone does not say WHICH ask landed, and it points
          at the change log rather than claiming the text is already different - the edit is applied
          by the server and shows up there, and promising more than that would be a claim this
          component cannot check. */}
      {askSent && !askOpen && (
        <div className="px-note" data-qc={BLOCK_HOOKS.askSent} style={{ marginTop: 6 }}>
          <b>Sent.</b> {'\u201c'}{askSent}{'\u201d'} - the change will appear in this field{"'"}s change log.
          <span className="px-link" role="button" tabIndex={0} style={{ marginLeft: 8, fontSize: 12 }}
            onClick={() => setAskSent(null)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAskSent(null) } }}>
            Dismiss
          </span>
        </div>
      )}
    </div>
  )

  const margin = (
    <div style={{
      minWidth: 0,
      borderLeft: wide ? '1px solid var(--proto-rule-soft)' : 'none',
      borderTop: wide ? 'none' : '1px solid var(--proto-rule-soft)',
      paddingLeft: wide ? 14 : 0, paddingTop: wide ? 0 : 10,
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {isStatic
          ? <span className="px-small" style={{ fontWeight: 700, color: 'var(--proto-ink2)' }}>Template · same in every packet</span>
          : <span className="px-small" style={{ fontWeight: 700, color: 'var(--text-brand)' }}>{METHOD_LABEL[row.method] || row.method}</span>}
        <span className="px-small">loop {row.loop}</span>
      </div>

      {/* "Corrected for you" - the design's own words, and the design's own position: the reason a
          figure was rewritten sits beside the sentence carrying it, not one tab away. Rendered with
          the SAME component the QC step uses, in `inField` mode so it does not restate the field
          name the reader is already inside. */}
      {corrections.length > 0 && (
        <div style={{ marginTop: 9 }} data-qc={BLOCK_HOOKS.fieldChangeLog} data-qc-n={corrections.length}>
          <div className="px-label" style={{ marginBottom: 4 }}>Corrected for you</div>
          {corrections.map((c) => (
            <CorrectionRow key={c.key} row={c} artifactId={artifactId} inField
              busy={correctionBusy} setBusy={setCorrectionBusy}
              onOpen={() => {}} onUndid={onCorrectionsChanged} />
          ))}
        </div>
      )}

      {/* THE FIELD'S OPEN FINDINGS — what the header's counts finally expand into.
          Only TWO of the five severities rendered anywhere in a margin before this (`fixed`, via
          the change log, and `posting_wording_kept`), so a deterministic `fail` on this asset was
          invisible on the step where the reader is reading the draft: "1 to fix" with nothing
          saying what. `posting_wording_kept` is excluded by the selector because it has its own
          richer block below - one finding in two places is one finding that can drift. */}
      {findings.length > 0 && (
        <div style={{ marginTop: 9 }} data-qc={BLOCK_HOOKS.fieldFindings} data-qc-n={findings.length}>
          <div className="px-label" style={{ marginBottom: 4 }}>Open on this field</div>
          {findings.map((f) => (
            <div key={f.check_key} data-qc={BLOCK_HOOKS.fieldFinding} data-qc-sev={f.sev}
              style={{ padding: '6px 0', borderTop: '1px solid var(--proto-rule-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, flex: 1, minWidth: 0 }}>{checkLabel(f.check_key)}</span>
                <span className="px-small" style={{ fontWeight: 700, color: SEV_COLOR[f.sev] }}>{SEV_LABEL[f.sev]}</span>
              </div>
              {f.offenders.map((o, i) => (
                <div key={i} className="px-small" style={{ textTransform: 'none', marginTop: 2, lineHeight: 1.45 }}>{o}</div>
              ))}
              {f.expected && (
                <div className="px-small" style={{ textTransform: 'none', marginTop: 2, fontStyle: 'italic' }}>{f.expected}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* WORDING KEPT FROM THE POSTING - a judgement, in the margin, beside the sentence carrying
          it. The prototype puts it here rather than on the QC tab for the reason the check's own
          comment gives: a figure the profile cannot evidence is corrected FOR you, but only the
          writer can say whether a phrase is the employer's sentence, the industry's standard term,
          or their own words. So this list never blocks anything and offers no auto-fix - it names
          the phrase, marks it `kept`, and hands over the one control that can change it.

          The status word is a literal `kept` and NOT one of the gate words: `posting_wording_kept`
          is a `warn`, and rendering "Needs a decision" here would put a phrase the writer may well
          want to keep into the same vocabulary as a blocking finding.

          The prototype also has a `Reword it` toggle. It is NOT built: in the prototype it flips
          local state and nothing else, and there is no store behind a "I chose to reword this"
          decision here. Shipping it would be a control that forgets - the "no dead UI" rule. */}
      {wording.length > 0 && (
        <div style={{ marginTop: 9 }} data-qc={BLOCK_HOOKS.fieldWordingKept} data-qc-n={wording.length}>
          <div className="px-label" style={{ marginBottom: 4 }}>{checkLabel('posting_wording_kept')}</div>
          {wording.map((phrase, i) => (
            <div key={`${phrase}-${i}`} style={{ padding: '6px 0', borderTop: '1px solid var(--proto-rule-soft)' }}
              data-qc-phrase={phrase}
              onMouseEnter={() => setActiveWording(phrase)}
              onMouseLeave={() => setActiveWording(null)}
              onFocus={() => setActiveWording(phrase)}
              onBlur={() => setActiveWording(null)}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, flex: 1, minWidth: 0 }}>{phrase}</span>
                <span className="px-small" style={{ fontWeight: 700, color: 'var(--proto-ink2)' }}>kept</span>
              </div>
              {artifactId && !isStatic && (
                <span className="px-link" role="button" tabIndex={0}
                  data-qc={BLOCK_HOOKS.wordingAsk} style={{ fontSize: 11, marginTop: 3, display: 'inline-block' }}
                  onClick={() => seedAskReword(phrase)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    seedAskReword(phrase)
                  }}>Tweak this</span>
              )}
            </div>
          ))}
          {/* The rule that put these here, in the checker's own words - so "why is this listed?"
              is answered where it is asked. `expected` is carried from the row, never retyped. */}
          {wordingExpected && (
            <div className="px-small" style={{ textTransform: 'none', marginTop: 4, fontStyle: 'italic' }}>
              {wordingExpected}
            </div>
          )}
        </div>
      )}

      {proposedKeywords.length > 0 && (
        <div style={{ marginTop: 9 }} data-qc={BLOCK_HOOKS.keywordChips} data-qc-n={proposedKeywords.length}>
          <div className="px-label" style={{ marginBottom: 4 }}>Keywords for this line</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {proposedKeywords.map((k) => (
              <span key={k} className="px-chip" role="button" tabIndex={0}
                data-qc={BLOCK_HOOKS.keywordChip} data-qc-keyword={k}
                data-qc-present={kwPresent.has(k) ? '1' : '0'}
                onClick={() => setOpenKeyword(openKeyword === k ? null : k)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  setOpenKeyword(openKeyword === k ? null : k)
                }}
                onMouseEnter={() => setActiveWording(k)}
                onMouseLeave={() => setActiveWording(null)}
                onFocus={() => setActiveWording(k)}
                onBlur={() => setActiveWording(null)}
                style={{ cursor: 'pointer', opacity: kwPresent.has(k) ? 1 : 0.72 }}>
                {/* The word rides on EVERY chip, not on the group heading. A reader who sees one
                    chip must still see that it is a proposal - the owner's constraint is that it
                    can never be mistaken for a validated placement, and a heading scrolls away. */}
                {k} <span className="px-small" style={{ fontWeight: 700 }}>proposed</span>
                {/* A statement about the TEXT, never about the writer. "not in this text" is what
                    can be checked; "reworded" cannot - absent text is equally consistent with a
                    rewording and with the term never having been placed, and nothing here can tell
                    those apart. */}
                {!kwPresent.has(k) && (
                  <span className="px-small" style={{ fontWeight: 700, color: 'var(--proto-ink2)' }}>
                    {' '}not in this text
                  </span>
                )}
              </span>
            ))}
          </div>
          {openKeywordDetail && (
            <div className="px-box" data-qc={BLOCK_HOOKS.keywordDetail}
              data-qc-keyword={openKeywordDetail.keyword}
              style={{ marginTop: 6, padding: 8, fontSize: 11.5, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>
                {openKeywordDetail.keyword} <span className="px-small">proposed</span>
              </div>
              {/* No match grade, no approximately-equal marker, no "took the place of". SPEC 4.6
                  asks for all three and NONE has a source: matchesEntry needs a published
                  term_library_entry (the library is off by owner decision), and "reworded" is not
                  merely unsourced but UNDECIDABLE - absent text is equally consistent with
                  reworded and with never placed. Rendering them would be invention. */}
              <div style={{ color: 'var(--proto-ink2)' }}>
                A model reading this posting proposed this keyword for the line below. Nothing has
                verified that this field contains it, and it counts toward nothing.
              </div>
              {openKeywordDetail.verbatim
                ? <div style={{ marginTop: 4 }}><Verbatim text={openKeywordDetail.verbatim} /></div>
                : <div className="px-small" style={{ textTransform: 'none', marginTop: 4 }}>
                    The posting line could not be located, so there is nothing to quote.
                  </div>}
              {/* SPEC 4.6-10 / 4.6-11 - the escape hatch, phrased as a REQUEST because that is all
                  it can honestly be. What may be offered is decided in ../assetBlocks.js
                  (`keywordActions`); this renders the answer. `kwPresent` is the SAME derivation
                  the highlight and the chip state read - the panel does not compute presence a
                  fourth time. No coverage claim rides on any of it: the keyword counts toward
                  nothing, as the sentence above already says. */}
              {(() => {
                const act = keywordActions({
                  keyword: openKeywordDetail.keyword,
                  present: kwPresent.has(openKeywordDetail.keyword),
                  canEdit: Boolean(artifactId) && !isStatic,
                })
                if (act.ask) {
                  return (
                    <div data-qc={BLOCK_HOOKS.keywordActions} style={{ marginTop: 8 }}>
                      <div className="px-small" style={{ fontWeight: 700 }}>Not comfortable claiming this?</div>
                      <span className="px-link" role="button" tabIndex={0}
                        data-qc={BLOCK_HOOKS.keywordDrop}
                        style={{ fontSize: 11, marginTop: 3, display: 'inline-block' }}
                        onClick={() => seedAsk(act.ask)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          seedAsk(act.ask)
                        }}>Ask to drop it from this field</span>
                      {/* SPEC 4.6-9 - swap it for one of the owner's OWN banked skills. Sits with
                          the drop because they are the same kind of thing: a request seeded into
                          this field's ask box, storing nothing. The list is `skill_bank_entry`,
                          seeded from the owner's own MasterContext fields - never a model's
                          suggestion, because an alternative the owner does not claim would be words
                          put in their mouth on the document that represents them.
                          No bank, NO CONTROL: keywordSwapOptions returns a reason instead, and the
                          reason is rendered. A disabled control or an empty picker would be the
                          dead UI the standing rule forbids. */}
                      {(() => {
                        const swap = keywordSwapOptions({
                          keyword: openKeywordDetail.keyword,
                          present: kwPresent.has(openKeywordDetail.keyword),
                          canEdit: Boolean(artifactId) && !isStatic,
                          bank: skillBank,
                          inField: [...kwPresent],
                        })
                        if (swap.candidates.length) {
                          return (
                            <div style={{ marginTop: 6 }}>
                              <select className="px-input" data-qc={BLOCK_HOOKS.keywordSwap}
                                defaultValue=""
                                style={{ fontSize: 11, maxWidth: 260 }}
                                onChange={(e) => { if (e.target.value) { seedAsk(swap.ask(e.target.value)); e.target.value = '' } }}>
                                <option value="">Swap for another skill…</option>
                                {swap.candidates.map((c) => (
                                  <option key={c.label} value={c.label}>
                                    {c.category ? `${c.label} — ${c.category}` : c.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )
                        }
                        if (swap.reason) {
                          return <div className="px-small" style={{ textTransform: 'none', marginTop: 6, color: 'var(--proto-ink2)' }}>{swap.reason}</div>
                        }
                        return null
                      })()}
                      {/* Says what it is, so nothing on screen implies a decision was stored. */}
                      <div className="px-small" style={{ textTransform: 'none', marginTop: 3 }}>
                        This asks for a rewrite and records no decision. Nothing is sent until you press Send.
                      </div>
                    </div>
                  )
                }
                if (act.reason) {
                  return (
                    <div className="px-small" data-qc={BLOCK_HOOKS.keywordNoAction}
                      style={{ textTransform: 'none', marginTop: 8 }}>{act.reason}</div>
                  )
                }
                return null
              })()}
            </div>
          )}
        </div>
      )}

      {reqs.length > 0 && (
        <div style={{ marginTop: 9 }}>
          <div className="px-label" style={{ marginBottom: 4 }}>
            {reqs.length === 1 ? 'Posting line answered' : 'Posting lines answered'}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {reqs.map((r) => <ReqChip key={r.id} req={r} />)}
          </div>
          {/* Directly under the chips it explains, and only for the kinds this field actually
              carries. A tooltip was the only expansion before, which no touch device shows. */}
          <div style={{ marginTop: 4 }}><ReqLegend reqs={reqs} /></div>
        </div>
      )}

      {rationales.length > 0 && (
        <div style={{ marginTop: 9 }}>
          <div className="px-label" style={{ marginBottom: 4 }}>Why it changed</div>
          {rationales.map((r, i) => (
            <div key={i} style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--proto-ink2)', marginTop: i ? 4 : 0 }}>{r}</div>
          ))}
          <div className="px-small" style={{ textTransform: 'none', marginTop: 4 }}>
            recorded against the packet, not this asset alone
          </div>
        </div>
      )}

      {reason && (
        <div style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 9, color: 'var(--proto-ink2)' }}>{reason}</div>
      )}

      {/* The posting's own line. `requirement_verbatim` is the joined requirement row;
          `verbatim_quote` is the quote the attribution stored at write time; a swap row carries its
          own. Whichever exists, it is text the employer wrote — never a paraphrase of it. */}
      <Verbatim text={row.requirement_verbatim || row.verbatim_quote || (reqs[0] && reqs[0].verbatim) || firstSwapQuote} />
    </div>
  )

  return (
    <div className={isStatic ? 'px-dashed' : 'px-box'} ref={focusRef}
      data-qc={BLOCK_HOOKS.field} data-qc-field={row.merge_field} data-qc-static={isStatic ? '1' : '0'}
      data-qc-focused={focused ? '1' : '0'}
      style={{
      padding: 14, display: 'grid', gridTemplateColumns: wide ? 'minmax(0,1fr) 250px' : '1fr', gap: 16,
      background: isStatic ? 'var(--proto-panel)' : 'var(--proto-paper)',
      boxShadow: focusRingStyle(focused),
    }}>
      {content}{margin}
    </div>
  )
}

// ── the asset ───────────────────────────────────────────────────────────────────────────────────

/**
 * Every merge field of one artifact, plus the meter above them.
 *
 * `fallback` is the artifact's stored content string. It is rendered only when the artifact has no
 * insertion rows at all — a draft written before P1.4, or a type with no template (the intro video
 * has no merge fields). Showing the old dump beats showing an empty screen, and it says which it is.
 *
 * `listOwners` / `onListsRendered` are how a card learns that another asset in the same packet
 * renders the same list, so a packet-level swap can name the assets it is shared with instead of
 * appearing twice as two separate changes. Both are optional: without them a shared swap still says
 * it is packet-level, it just cannot name the sibling.
 */
export default function AssetBlocks({ artifact, provenance, fallback, defaultOpen = true, label, listOwners, onListsRendered, focusField = null }) {
  const [open, setOpen] = useState(defaultOpen)
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const [ref, wide] = useWideRef(700)
  // A finding on the QC rail can name a field on THIS asset. The hook is shared with the gate
  // drawer so the two landings cannot drift; `state.data` is a dependency because the link can
  // resolve before the rows arrive, and scrolling to an element that does not exist is a no-op.
  const focusRef = useScrollToFocus(focusField, [state.data, open])

  // The change log, scoped per field into the margins below. One `busy` for the whole panel, not one
  // per row: two undos in flight against the same artifact would race the re-read that follows them.
  const { rows: correctionRows, correctedCount, wording, severity, fieldSev, findings, checked, refresh: refreshCorrections } = useArtifactCorrections(artifact.id)
  // The OWNER'S check thresholds, so every field can state the contract the gate actually holds it
  // to. `searchPrefsGet().checks` is the same row Settings writes - one source, so changing 24 to 30
  // there changes what this screen promises.
  const [thresholds, setThresholds] = useState(null)
  useEffect(() => {
    let live = true
    api.searchPrefsGet()
      .then((d) => { if (live) setThresholds((d && d.checks) || null) })
      .catch(() => { if (live) setThresholds(null) })
    return () => { live = false }
  }, [])
  const [correctionBusy, setCorrectionBusy] = useState(null)

  useEffect(() => {
    let live = true
    setState({ loading: true, error: null, data: null })
    api.artifactInsertions(artifact.id)
      .then((d) => { if (live) setState({ loading: false, error: d && d.error ? String(d.error) : null, data: d && d.error ? null : d }) })
      .catch((e) => { if (live) setState({ loading: false, error: String(e.message || e), data: null }) })
    return () => { live = false }
  }, [artifact.id])

  const reqById = useMemo(() => {
    const m = new Map()
    for (const r of (provenance && provenance.requirements && provenance.requirements.requirements) || []) m.set(r.id, r)
    return m
  }, [provenance])

  const allSwaps = (provenance && provenance.swaps && provenance.swaps.swaps) || []

  const rows = useMemo(() => latestRows(state.data), [state.data])

  const listsInAsset = useMemo(() => listsOf(rows), [rows])
  const scopedSwaps = useMemo(() => scopeSwaps(allSwaps, listsInAsset), [allSwaps, listsInAsset])

  // Report which lists this asset renders, so sibling cards can say a swap is shared with it. Keyed
  // on the sorted list names so an unchanged set never re-fires.
  const listsKey = useMemo(() => Array.from(listsInAsset).sort().join(','), [listsInAsset])
  useEffect(() => {
    if (!onListsRendered) return
    onListsRendered(artifact.id, label || artifact.type, listsKey ? listsKey.split(',') : [])
  }, [artifact.id, artifact.type, label, listsKey, onListsRendered])

  if (state.loading) return <div className="px-small">Loading blocks...</div>

  if (!rows.length) {
    if (!fallback) {
      return (
        <div className="px-small" data-qc={BLOCK_HOOKS.empty} style={{ textTransform: 'none' }}>
          {state.error
            ? `Block provenance could not be read for this asset (${state.error}).`
            : 'Nothing has been generated for this asset yet, so there are no blocks to show.'}
        </div>
      )
    }
    return (
      <div data-qc={BLOCK_HOOKS.fallback}>
        <div className="px-small" style={{ textTransform: 'none', marginBottom: 6 }}>
          {state.error
            ? `Block provenance could not be read (${state.error}) - showing the stored draft.`
            : 'This draft has no per-field record, so it is shown as it was stored.'}
        </div>
        <div className="px-box" style={{ padding: 10, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', background: 'var(--proto-panel)' }}>
          {fallback}
        </div>
      </div>
    )
  }

  return (
    <div ref={ref} data-qc={BLOCK_HOOKS.root} data-qc-open={open ? '1' : '0'}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>
          {rows.length} merge {rows.length === 1 ? 'field' : 'fields'}
        </div>
        <span className="px-link" role="button" tabIndex={0} aria-expanded={open}
          data-qc={BLOCK_HOOKS.toggle} data-qc-open={open ? '1' : '0'}
          style={{ fontSize: 11.5 }} onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v) } }}>
          {open ? 'Hide blocks' : 'Show blocks'}
        </span>
      </div>

      {open && (
        <>
          <DistributionMeter
            rows={rows}
            filled={Number(state.data.filled) || 0}
            unfilled={Number(state.data.unfilled) || 0}
            requirements={provenance && provenance.requirements}
            scopedSwaps={scopedSwaps}
            terms={null}
            corrected={correctedCount}
            severity={severity}
            checked={checked}
            label={ANSWERS_LABEL[artifact.type] || 'asset'}
          />
          {rows.map((r) => (
            <AssetBlock
              key={`${r.merge_field}-${r.loop}`}
              row={r}
              focused={!!focusField && r.merge_field === focusField}
              focusRef={r.merge_field === focusField ? focusRef : undefined}
              reqs={reqsForRow(r, scopedSwaps, reqById)}
              swapsForList={r.list ? scopedSwaps.filter((s) => s.list === r.list) : []}
              wide={wide}
              artifactId={artifact.id}
              listOwners={listOwners}
              thresholds={thresholds}
              corrections={correctionsForField(correctionRows, r.merge_field)}
              wording={offendersForField(wording, r.merge_field)}
              wordingExpected={(wording && wording.expected) || ''}
              fieldSev={fieldSev ? fieldSev[r.merge_field] || null : null}
              findings={findings ? findings[r.merge_field] || [] : []}
              correctionBusy={correctionBusy}
              setCorrectionBusy={setCorrectionBusy}
              onCorrectionsChanged={refreshCorrections}
            />
          ))}
        </>
      )}
    </div>
  )
}
