// P5.4 — the JD step's posting analysis, and the keyword tally that used to be a right column.
//
// Two surfaces, deliberately different, and each says which it is:
//   • <PostingAnalysisCard> is the SOURCE. It shows the lines the parser pulled out of THIS posting
//     (with the employer's own words where they could be located) and the result of the last run.
//   • <KeywordTallyOverlay> is the TALLY. It is the modal behind the header score and holds every
//     keyword number. Per decision D4 the 280px right panel is gone: the shell caps content
//     at 1280 minus 196 of nav, leaving ~664px at 1440, and P5.2's asset blocks need ~850px.
//
// NAMING RULE (P5.4, tightened): "ATS" belongs to the keyword TERM LIBRARY and its COVERAGE, and to
// nothing else. It appears on no requirements surface, no responsibilities surface, no legend, no
// tab name, no link name, and never beside a model-produced count or estimate. The match number the
// analysis run produces is a MODEL ESTIMATE, and the model-inferred keywords are not library terms.
//
// All pure logic (grouping, counts, kind_source split, the library state, the posting-body
// provenance) lives in ../postingAnalysis.js so it can be tested without a DOM. This file is the
// rendering only. Stable `data-qc` hooks are on every surface the acceptance criteria name.
import React, { useEffect, useState } from 'react'
import { Pill, Overlay, toneColor } from '../shell.jsx'
import { requirementUsage, errText } from '../qcRail.js'
import { api } from '../api.js'
import {
  KIND_ABBR, reqChipLabel, kindSourceNote, noQuoteReason, isQuoted,
  groupRequirements, modelKeywords, summarizeKindSource, keywordLibraryState,
  keywordColumns, keywordGridTemplate, POSTING_HOOKS,
  fitLabel, FIT_COLOR, comparisonState, compareColumns, compareGridTemplate,
  COMPARE_COLUMNS, COMPARE_SCOPE_NOTE, comparisonStaleNote,
  keywordGroupMeaning,
  evidencePresentation,
  TALLY_SCORE_DEFER, tabEvidenceTone, tabEvidenced } from '../postingAnalysis.js'
import { HIGHLIGHT_CLASS } from '../highlight.js'
// 4.3-11 is a RELOCATION, not a new component: GateBadge is the badge the packet screen, the
// packets list and the drawer already render, and <ScoreParts> is the one score-bar renderer the
// drawer's Match tab and the QC rail render. Both are imported. A copy of either would be a second
// opinion about a gate, or a second set of bars, on a screen that cannot see the first.
import { GateBadge, ScoreParts } from './AssetGateDrawer.jsx'
import { bandTone } from '../assetGate.js'

/**
 * The viewport width, for the keyword list's 2-up / 1-up rule (P8.7).
 *
 * The RULE is not here - keywordColumns() owns it, in a module `node --test` can load. This hook
 * only reports the width, so the breakpoint itself stays provable without a DOM.
 */
function useViewportWidth() {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onResize = () => setW(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return w
}

// Where the user's side of the comparison actually lives, so "the profile" always has a referent.
export const PROFILE_HREF = '#/settings/facts'
export const PROFILE_LABEL = 'your master profile (Settings > Facts)'

export function ProfileLink({ children }) {
  return <a className="px-link" href={PROFILE_HREF} style={{ fontWeight: 600 }}>{children || PROFILE_LABEL}</a>
}

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : n)

// ── the comparison: posting on the left, profile on the right (SPEC 4.2, P8.4) ──────────────────
//
// This is what the JD step is FOR. The extraction card below it says what the parser pulled out of
// the ad; this says how those lines compare to what the candidate's stored profile can evidence.
//
// Every cell is a stored value. The posting cell is `requirement.verbatim` where the employer's
// words were located and `item_text` where they were not - and the row SAYS which, because
// requirements.ts is explicit that the paraphrase is "Never presented as a quote". The profile cell
// is a `requirement_evidence` excerpt or a confirmed `owner_fact`, named either way. Nothing here is
// model prose, and nothing here is computed in the browser: the grade and the reason are read off
// the row the API stored, so the number on screen and the number a reviewer can query with one SQL
// statement are the same number.
function CompareRow({ r, vw }) {
  const na = r.fit === 'not_applicable'
  const wide = compareColumns(vw) === 4
  return (
    <div data-qc={POSTING_HOOKS.compareRow} data-qc-dimension={r.key} data-qc-fit={r.fit}
      style={{ display: 'grid', gridTemplateColumns: compareGridTemplate(vw), gap: 10, padding: '11px 14px',
               borderBottom: '1px solid var(--proto-rule-soft)', alignItems: 'baseline' }}>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.label}</span>

      <span style={{ fontSize: 12, color: 'var(--proto-ink2)' }}>
        {r.posting ? r.posting.text : <em style={{ color: 'var(--proto-ink3)' }}>this posting does not ask</em>}
        {r.posting && !r.posting.quoted && (
          <span className="px-small" style={{ display: 'block', color: 'var(--proto-ink3)' }}>
            Model paraphrase - not the employer's wording.
          </span>
        )}
      </span>

      <span style={{ fontSize: 12 }}>
        {r.profile ? r.profile.value : <em style={{ color: 'var(--proto-ink3)' }}>nothing recorded on this axis</em>}
        {r.profile && (
          <span className="px-small" style={{ display: 'block', color: 'var(--proto-ink3)' }}>
            {r.profile.source === 'fact' ? 'From your profile facts: ' : 'From '}{r.profile.source_label}
          </span>
        )}
      </span>

      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: wide ? 'flex-end' : 'flex-start' }}>
        <span data-qc={POSTING_HOOKS.compareFit} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: FIT_COLOR[r.fit] }} />
          <span style={{ fontSize: 11.5, fontWeight: 700, color: FIT_COLOR[r.fit] }}>
            {fitLabel(r.fit, r.shortfall)}
          </span>
        </span>
        {!na && r.total ? (
          <span className="px-small" style={{ color: 'var(--proto-ink3)' }}>{r.covered} of {r.total} line(s)</span>
        ) : null}
      </span>

      {/* The reason. Mandatory for every moderate and weak grade, and for every ungraded row - a
          row that says "not measured" with no reason is indistinguishable on screen from one that
          says "measured and fine". It spans the whole row rather than sitting in the Fit column,
          because it is a sentence about both sides. */}
      {(r.note || r.reason) && (
        <span data-qc={POSTING_HOOKS.compareNote} className="px-small"
          style={{ gridColumn: '1 / -1', color: na ? 'var(--proto-ink3)' : 'var(--proto-ink2)',
                   textTransform: 'none', lineHeight: 1.55, marginTop: 2 }}>
          {r.note || r.reason}
        </span>
      )}
    </div>
  )
}

export function ProfileCompareCard({ comparison, onOpenRequirements, onOpenQc }) {
  const vw = useViewportWidth()
  const cols = compareColumns(vw)
  const st = comparisonState(comparison)
  const rows = st.rows || []
  const summary = comparison && comparison.summary ? comparison.summary : null
  const set = comparison && comparison.set ? comparison.set : null
  const stale = comparisonStaleNote(comparison)

  return (
    <div className="px-box" data-qc={POSTING_HOOKS.compare} data-qc-state={st.state} style={{ padding: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>This posting, against your profile</div>
      <div className="px-small" style={{ marginTop: 3, color: 'var(--proto-ink2)', lineHeight: 1.6 }}>
        {st.headline}{st.detail ? ' ' : ''}{st.detail}
      </div>

      {/* Where the dimension set came from. A silent fallback and a chosen configuration produce
          identical rows, and the difference is exactly what a reader needs to know. */}
      {set && (
        <div className="px-small" data-qc={POSTING_HOOKS.compareSetSource} data-qc-source={set.source}
          style={{ marginTop: 8, color: 'var(--proto-ink3)' }}>
          {set.source === 'owner'
            ? `Your dimension set for ${set.family}.`
            : `Seeded dimension set for ${set.family} - you have not changed it yet.`}
          {set.warning ? ` ${set.warning}` : ''}
        </div>
      )}

      {/* The stored rows are not always how the comparison would be built today: `set` above is read
          live from the owner's prefs while these rows were written when it was last resolved, and
          D23 changed the grading rules underneath every row already in the database. Saying so is
          the difference between a stale number and a stale number a reader believes. */}
      {stale && (
        <div className="px-note" data-qc={POSTING_HOOKS.compareStale} data-qc-stale={stale.kind}
          style={{ marginTop: 10 }}>
          {stale.text}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="px-note" data-qc={POSTING_HOOKS.compareEmpty} style={{ marginTop: 12 }}>
          {st.headline} {st.detail}
        </div>
      ) : (
        <>
          {/* The summary counts what it says it counts, and names what it excluded rather than
              absorbing it. `ratio` is null whenever any dimension went ungraded - a composite over
              a population with holes in it is the number a reviewer trusts most and the one most
              likely to be wrong. */}
          {summary && (
            <div className="px-small" data-qc={POSTING_HOOKS.compareSummary} style={{ marginTop: 10, color: 'var(--proto-ink2)' }}>
              {summary.strong} strong · {summary.moderate} moderate · {summary.weak} weak
              {summary.notApplicable > 0 && (
                <> · {summary.notApplicable} not compared ({summary.notApplicableLabels.join(', ')}), not counted either way</>
              )}
            </div>
          )}

          {/* SPEC 4.2-1/2/4 - the fit CARDS, on the axis this app actually grades.
              The prototype's four cards count requirement KINDS (responsibilities / must-have /
              nice-to-have / ATS keywords). This app grades role DIMENSIONS, and per-kind coverage is
              not a number the system produces - requirements.ts:61 makes `coverage` 'escalated' |
              null, never 'covered'. Building the prototype's four literally would mean minting a
              FOURTH coverage number that postingAnalysis.js:445 says could not agree with the other
              three. So the cards summarise the rows in the table directly below, which means every
              figure here reconciles with it BY CONSTRUCTION - they are the same rows.
              `covered`/`total` are the API's own (dimensions.ts), never recomputed here. */}
          {rows.length > 0 && (
            <div data-qc={POSTING_HOOKS.compareCards}
              /* `alignItems: start` is the fix for a MEASURED layout defect, not a preference. A
                 grid row stretches every cell to its tallest sibling by default, so one axis with a
                 long unevidenced note (1122 characters on a 12-line axis - an ordinary state, not an
                 edge case) inflated its four neighbours to ~740px of mostly white. The owner kept
                 the notes deliberately, so the note is not what changes: the STRETCH is. Cards now
                 size to their own content and the row is as tall as its tallest card only. */
              style={{ marginTop: 12, display: 'grid', gap: 10, alignItems: 'start',
                       gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
              {rows.map((r) => (
                <div key={r.key} className="px-box" data-qc={POSTING_HOOKS.compareCard}
                  data-qc-dimension={r.key} data-qc-fit={r.fit} style={{ padding: 11 }}>
                  <div className="px-label">{r.label}</div>
                  {/* The big number, and it is only printed when the API sent one. A card that
                      invents 0 of 0 for an ungraded dimension is the fabricated-composite failure. */}
                  {/* THE SAME GUARD THE ROW USES (`!na && r.total`, :105), not a second opinion.
                      They had diverged: the card asked `Number(r.total) > 0` while the row asked
                      `!na && r.total`, so a row with fit 'not_applicable' AND a total would print
                      "2 of 3" on the card and NO number in the table on the same screen. Not
                      producible from today's buildComparison - every na() site passes covered/total
                      null - but loadComparison is a straight column passthrough, so the divergence
                      is one stored row away, and AC A.2 is precisely about where this number comes
                      from. Two guards for one question is how two surfaces come to disagree. */}
                  {r.fit !== 'not_applicable' && r.total ? (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 3 }}>
                      <b style={{ fontSize: 22, lineHeight: 1, color: FIT_COLOR[r.fit] }}>{r.covered}</b>
                      <span style={{ fontSize: 13, color: 'var(--proto-ink3)' }}>of {r.total}</span>
                    </div>
                  ) : (
                    <div className="px-small" style={{ marginTop: 5, textTransform: 'none', color: 'var(--proto-ink3)' }}>
                      nothing to count on this dimension
                    </div>
                  )}
                  <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 4, color: FIT_COLOR[r.fit] }}>
                    {fitLabel(r.fit, r.shortfall)}
                  </div>
                  {/* 4.2-4 is ALREADY BUILT and this renders the API's OWN enumeration verbatim -
                      dimensions.ts:504 emits "no excerpt for: #12 <text>". Re-deriving a Missing:
                      list here would be a second, divergent enumeration of one fact. */}
                  {/* `r.note || r.reason`, exactly as CompareRow:117 does it. The card had only
                      `r.note`, and dimensions.ts sets note=null / reason=<why> on every
                      not_applicable row - so a stale comparison rendered EIGHT identical
                      "nothing to count on this dimension / Not compared" tiles with no explanation,
                      while the table directly beneath each one said why. An unexplained absence is
                      the same laundering as a fabricated number: the reader cannot tell "nobody
                      asked" from "asked and found nothing". */}
                  {(r.note || r.reason) && (
                    <div className="px-small" data-qc={POSTING_HOOKS.compareCardNote}
                      style={{ textTransform: 'none', marginTop: 3, color: 'var(--proto-ink2)', lineHeight: 1.45 }}>
                      {r.note || r.reason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div data-qc={POSTING_HOOKS.compareCols} data-qc-cols={cols}
            style={{ marginTop: 12, border: '1px solid var(--proto-rule-soft)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: compareGridTemplate(vw), gap: 10,
                          padding: '9px 14px', background: 'var(--proto-panel)',
                          borderBottom: '1px solid var(--proto-rule-soft)' }}>
              {(cols === 4 ? COMPARE_COLUMNS : [COMPARE_COLUMNS[0]]).map((c, i) => (
                <span key={c} className="px-label" style={{ textAlign: i === 3 ? 'right' : 'left' }}>{c}</span>
              ))}
            </div>
            {rows.map((r) => <CompareRow key={r.key} r={r} vw={vw} />)}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <span className="px-small" data-qc={POSTING_HOOKS.compareScope}
          style={{ textTransform: 'none', flex: 1, color: 'var(--proto-ink2)' }}>
          {COMPARE_SCOPE_NOTE}
        </span>
        {/* R5: a count that cannot be opened is a dead end, so the only control here lands
            somewhere real - the extracted lines the comparison was built from. */}
        {rows.length > 0 && (
          <button className="px-btn" style={{ fontSize: 12 }} onClick={onOpenRequirements}>
            See the lines this was built from
          </button>
        )}
        {/* 4.2-13, prototype `qc/packet.jsx:209`. The SAME `onOpenQc` the sibling card already
            takes - one prop threaded from PacketBuilder, calling the one `setActiveStep`, not a
            second navigation path.

            TWO QC controls now sit on this screen, and that is deliberate rather than an accident
            (AC A.10 requires the PR to say which). They are the two halves of the same question
            asked from different rows: this card grades DIMENSIONS and its control offers to show
            how the assets answer them; the extraction card lists LINES and its control offers to
            show where each one is answered. Distinct labels, distinct hooks - a duplicate label is
            the failure that rule exists to prevent.

            The sub-line carries the same disclosure the sibling does, for the same reason: QC's
            requirement filter is internal state with no prop and no route segment, so neither
            control can land on one row. */}
        {onOpenQc && rows.length > 0 && (
          <span style={{ textAlign: 'right' }}>
            <span className="px-link" role="button" tabIndex={0} data-qc={POSTING_HOOKS.compareOpenQc}
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
              onClick={onOpenQc}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenQc() } }}>
              See how the assets answer these &rarr;
            </span>
            <span className="px-small" style={{ display: 'block', textTransform: 'none', color: 'var(--proto-ink3)' }}>
              opens the coverage list in QC, line by line
            </span>
          </span>
        )}
      </div>
    </div>
  )
}

// ── one extracted line ──────────────────────────────────────────────────────────────────────────
function RequirementRow({ r, usage = null, onGoToFieldRef = null, oppId = null, onConfirmed = null }) {
  const quoted = isQuoted(r)
  return (
    <div data-qc={POSTING_HOOKS.row} data-qc-kind={r.kind} data-qc-quoted={quoted ? '1' : '0'}
      style={{ padding: '10px 0', borderBottom: '1px solid var(--proto-rule-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
        <span className="px-chip" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10 }}>
          {reqChipLabel(r.kind, r.seq)}
        </span>
        <span className="px-small" style={{ color: 'var(--proto-ink3)' }}>
          {r.competency || 'competency unassigned'}
        </span>
      </div>

      {quoted ? (
        <>
          <blockquote data-qc={POSTING_HOOKS.quote} style={{
            margin: 0, padding: '2px 0 2px 10px', borderLeft: '3px solid var(--border-brand)',
            fontSize: 13, lineHeight: 1.6,
          }}>
            {r.verbatim}
          </blockquote>
          <div className="px-small" style={{ marginTop: 4, color: 'var(--proto-ink3)' }}>
            The employer's words, characters {fmt(r.char_start)}-{fmt(r.char_end)} of the posting
            {r.match_method === 'anchored' ? ' (located by anchor, not an exact string match)' : ''}
            {r.item_text && r.item_text !== r.verbatim ? ` · parser read it as: ${r.item_text}` : ''}
          </div>
        </>
      ) : (
        <>
          <div data-qc={POSTING_HOOKS.paraphrase} style={{ fontSize: 13, lineHeight: 1.6, fontStyle: 'italic' }}>{r.item_text}</div>
          <div className="px-small" style={{ marginTop: 4, color: 'var(--proto-ink3)' }}>
            Model paraphrase - not a quote from the employer, because {noQuoteReason(r.match_method)}.
          </div>
        </>
      )}

      <div className="px-small" data-qc={POSTING_HOOKS.kindSource} data-qc-source={r.kind_source || 'unknown'}
        style={{ marginTop: 3, color: 'var(--proto-ink3)' }}>
        Filed here because {kindSourceNote(r.kind_source)}.
      </div>

      <EvidenceLine r={r} oppId={oppId} onConfirmed={onConfirmed} />

      {/* SPEC 4.1-20 - `Where it is used ->`. The last row of the evidence cluster, and the only one
          that did not ship, because a swap is keyed by LIST and turning one into a navigation needs
          to know which artifact renders that list.
          RENDERED ONLY WHEN A SWAP ACTUALLY NAMES THIS REQUIREMENT and that swap's list resolves to
          a real artifact - `requirementUsage` returns null for "no swap", "list nobody renders" and
          "insertions not loaded yet" alike, and every one of those must render NOTHING rather than a
          link that goes nowhere. The absence is the honest state: not every requirement was answered
          by a change to the draft. */}
      {usage && onGoToFieldRef && (
        <div style={{ marginTop: 4 }}>
          <span className="px-link" role="button" tabIndex={0} data-qc={POSTING_HOOKS.usedIn}
            data-qc-artifact={usage.artifactId} data-qc-section={usage.mergeField}
            style={{ fontSize: 12, cursor: 'pointer' }}
            onClick={() => onGoToFieldRef(usage.artifactId, usage.mergeField)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onGoToFieldRef(usage.artifactId, usage.mergeField)
            }}>
            Where it is used {'\u2192'}{usage.label ? ` (${usage.label})` : ''}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Whether the owner's profile backs THIS requirement, said on the line that states the requirement.
 *
 * SPEC 4.1 asks the extraction list to answer "can I back this up?" beside each line, and until now
 * it could not: the endpoint has shipped nine `evidence_*` columns plus a re-validated verdict for
 * months (`appRequirements.ts:455`), and `grep evidence_ app/src` returned nothing but Settings
 * LABELS. The whole spine was built and had no reader.
 *
 * WHAT IS AND IS NOT DECIDED HERE. Every word below comes off the payload: the state and its
 * sentence from `verifyEvidence`'s ONE map, the excerpt only when that verdict says it may be shown
 * as a quote. This component chooses layout and nothing else.
 *
 * NO NUMBER, DELIBERATELY, and the precedent is thirty lines up in this same file: the keyword
 * surface refuses a coverage percentage because it "made a suggestion look like a measurement". The
 * resolver's `ratio` is that same shape - a similarity score - and this repo's standing rule keeps
 * similarity for RANKING and out of anything a reader could take as a finding. So the reader gets
 * the excerpt and the record it came from, which they can judge, and never a score.
 */
/**
 * Accept or refuse a MODEL-PROPOSED excerpt.
 *
 * WHY THIS CONTROL IS THE WHOLE FEATURE. `checks.ts` states the engine's house rule: *"a model may
 * PROPOSE, only an exact rule may ACCUSE, and `must_have_coverage` is the accusation."* A
 * `method: 'proposed'` row is therefore SHOWN and does not count — and confirming it is the one
 * thing that promotes it, because a human IS an exact rule. Measured on production the day this
 * shipped: 15 proposed rows across 15 requirements, every one carrying a verified quote from the
 * owner's own profile, all uncounted, on screens reporting zero coverage.
 *
 * REFUSALS ARE RENDERED IN THE SERVER'S OWN WORDS. The route answers 403 (the session is not
 * verified — a confirmation whose actor is "whoever sent the request" is an audit row worth
 * nothing), 404 (not the owner's row, deliberately not 403, so a stranger cannot learn it exists)
 * and 409 (the excerpt is not a model proposal). Each is a fact the owner has to be able to act on,
 * so `postDetailed` carries the sentence up and it is printed rather than replaced.
 */
function ConfirmProposal({ seq, oppId, onConfirmed, missing = null }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const send = async (decision) => {
    setBusy(decision); setErr(null)
    try {
      await api.evidenceConfirm(seq, { oppId, decision })
      if (onConfirmed) await onConfirmed()
    } catch (e) {
      setErr(errText(e))
    } finally { setBusy(null) }
  }
  return (
    <div style={{ marginTop: 5 }} data-qc={POSTING_HOOKS.confirm}>
      <div className="px-small" style={{ color: 'var(--proto-ink3)', textTransform: 'none' }}>
        {/* THIS SENTENCE USED TO SAY THE OPPOSITE AND WAS TRUE WHEN WRITTEN. It read "It does not
            count toward coverage until you say it is right", which described the gate exactly until
            proposals began counting on creation. A screen that tells the owner a row is excluded
            while the gate counts it is worse than no explanation: it makes the number they are
            looking at unreconcilable with the rows in front of them. */}
        A model found this line in your profile, and it is counting toward your coverage now. Say so
        if it is right, or veto it and it stops counting.
      </div>
      {/* WHAT A SECOND READ SAID THIS EXCERPT FAILS TO SHOW. Until now this was computed on every
          escalation, counted into a request-scoped tally, and thrown away -- so the app asked the
          owner for a judgement while withholding the one thing it had learned that bears on it.
          Rendered ABOVE the buttons deliberately: it is the input to the decision, not a footnote
          about it. */}
      {missing && missing.length > 0 && (
        <div className="px-small" data-qc={POSTING_HOOKS.missing}
             style={{ marginTop: 4, color: 'var(--proto-ink3)', textTransform: 'none' }}>
          A second read could not find {missing.length === 1 ? 'this' : 'these'} in the excerpt:{' '}
          <span style={{ color: 'var(--proto-ink2)' }}>{missing.join('; ')}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        <button className="px-btn px-btn-sm" disabled={!!busy} data-qc={POSTING_HOOKS.confirmYes}
          onClick={() => send('confirm')}>
          {busy === 'confirm' ? 'Saving…' : 'Yes, that is my evidence'}
        </button>
        <button className="px-btn px-btn-sm" disabled={!!busy} data-qc={POSTING_HOOKS.confirmNo}
          onClick={() => send('reject')}>
          {busy === 'reject' ? 'Saving…' : 'Not this one'}
        </button>
      </div>
      {err && (
        <div className="px-small" style={{ marginTop: 4, color: 'var(--proto-red)', textTransform: 'none' }}>
          {err}
        </div>
      )}
    </div>
  )
}

function EvidenceLine({ r, oppId = null, onConfirmed = null }) {
  const ev = evidencePresentation(r)
  const [open, setOpen] = useState(false)
  // The excerpt is the only thing worth expanding. Every other state is one sentence, so hiding it
  // behind a disclosure would cost a click to reveal text that already fits on the line.
  const expandable = ev.provable
  const dot = (
    <span aria-hidden="true" style={{
      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
      background: toneColor(ev.tone),
    }} />
  )
  return (
    <div data-qc={POSTING_HOOKS.evidence} data-qc-evidence-state={ev.state} style={{ marginTop: 6 }}>
      <div className="px-small" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {dot}
        <span style={{ fontWeight: 600, color: ev.state === 'none' ? 'var(--proto-red)' : 'var(--proto-ink2)' }}>
          {ev.word}
        </span>
        {expandable && (
          <button className="px-link" style={{ fontSize: 12, background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
            aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen((v) => !v)}>
            {open ? 'hide the line' : 'show the line'}
          </button>
        )}
        {/* A provable excerpt whose record has since been edited. The quote still holds - it was
            re-checked against today's bytes - but it was RANKED against an older version, so the
            endpoint reports it as a reason to re-resolve rather than suppressing it. */}
        {ev.provable && ev.recordChanged && (
          <span style={{ color: 'var(--proto-ink3)' }}>· ranked against an earlier version of that record</span>
        )}
        {/* WHO STOOD BEHIND IT. Printed beside the state rather than replacing it, because "a model
            found this" and "you accepted it" are two different facts and the reader needs both — the
            second is what makes it count. */}
        {ev.confirmedAt && !ev.vetoed && (
          <span data-qc={POSTING_HOOKS.confirmed} style={{ color: 'var(--proto-green)', fontWeight: 600 }}>
            · you confirmed this{ev.confirmedBy ? ` (${ev.confirmedBy})` : ''}
          </span>
        )}
        {/* WHY THIS ROW IS IN THE COUNT. A vetted row is the only model row that moves
            must_have_coverage, so the reason it counts belongs beside the state word rather than
            behind a disclosure - "coverage rose" has to be checkable at a glance, or a reader
            cannot tell a better profile from a chattier model. It is deliberately NOT phrased as
            agreement: a model was challenged and held, which is not the same as the owner saying
            yes, and the confirm control below still offers them that. */}
        {ev.vetted && !ev.confirmedAt && !ev.vetoed && (
          <span data-qc={POSTING_HOOKS.vetted} style={{ color: 'var(--proto-ink2)', fontWeight: 600 }}>
            · vetted: challenged for what it misses, and it held
          </span>
        )}
        {/* COUNTING ON A MODEL'S SAY-SO ALONE — the weakest warrant that still moves the number,
            and therefore the one that most needs saying out loud. The gate's own observed string
            carries the same disclosure for the same reason: counting proposals inverts the house
            rule that only an exact rule may accuse, and an inversion nobody can see is
            indistinguishable from the rule having been dropped. Deliberately NOT green — it is
            true, not settled, and colouring it like a confirmation would overstate it. */}
        {ev.countsNow && ev.method === 'proposed' && !ev.confirmedAt && (
          <span data-qc={POSTING_HOOKS.countingNow} style={{ color: 'var(--proto-ink3)' }}>
            · counting on a model's word — veto it if it is wrong
          </span>
        )}
        {/* THE OWNER'S NO, and it wins the row. Placed last so it renders after every warrant
            badge, mirroring `ruleEvidenceOf`'s own order: the veto is checked first there and
            outranks every method, so on screen it must not appear as one more note beside
            "vetted" or "you confirmed this". Red, because a row that stopped counting is a
            reduction the owner needs to recognise as their own doing rather than a resolver
            regression. */}
        {ev.vetoed && (
          <span data-qc={POSTING_HOOKS.vetoed} style={{ color: 'var(--proto-red)', fontWeight: 600 }}>
            · you vetoed this — it is not counted
          </span>
        )}
      </div>

      {/* A model's proposal the owner has not ruled on. Rendered ONLY when there is somewhere to send
          the answer — without `oppId` the route cannot be called, and `CLAUDE.md`'s no-dead-UI rule
          says hide the control rather than show one that cannot work. */}
      {ev.decidable && oppId && (
        <ConfirmProposal seq={r.seq} oppId={oppId} onConfirmed={onConfirmed} missing={ev.missing} />
      )}

      {/* THE REASONING, OUT FROM BEHIND THE DISCLOSURE for a vetted row. Everywhere else `extra` is
          a supporting note on an excerpt the reader can already see; here it is the argument for a
          number that changed, and an argument nobody opens is an argument nobody checked. */}
      {ev.vetted && ev.extra && (
        <div className="px-small" data-qc={POSTING_HOOKS.vettedWhy}
             style={{ marginTop: 3, color: 'var(--proto-ink3)' }}>
          {ev.extra}
        </div>
      )}

      {/* The one sentence for a state that is not provable, from the API. `none` is the only one
          that reports a gap in the PROFILE; the other four report that evidence exists and cannot
          be stood behind right now, which is a pipeline problem and never an accusation. */}
      {!ev.provable && ev.note && (
        <div className="px-small" style={{ marginTop: 3, color: ev.state === 'none' ? 'var(--proto-red)' : 'var(--proto-ink3)' }}>
          {ev.note}
        </div>
      )}

      {/* WHAT WAS LOOKED FOR. `evidenceSearch` is computed by the endpoint for exactly this - its
          own comment says "no evidence found in your profile" is "true and useless: it does not say
          what was sought, so the owner cannot act on it". It had no reader until now. */}
      {!ev.provable && ev.search && ev.search.missingWords && ev.search.missingWords.length > 0 && (
        <div className="px-small" style={{ marginTop: 2, color: 'var(--proto-ink3)' }}>
          Looked for {ev.search.missingWords.slice(0, 6).join(', ')} and did not find
          {ev.search.missingWords.length > 6 ? ' them' : ev.search.missingWords.length > 1 ? ' them' : ' it'} in your profile.
        </div>
      )}

      {open && ev.provable && (
        <div data-qc={POSTING_HOOKS.evidenceBody} style={{ marginTop: 5 }}>
          <blockquote style={{
            margin: 0, padding: '2px 0 2px 10px', borderLeft: '3px solid var(--proto-green)',
            fontSize: 13, lineHeight: 1.6,
          }}>
            {ev.quote}
          </blockquote>
          <div className="px-small" style={{ marginTop: 4, color: 'var(--proto-ink3)' }}>
            {ev.source
              ? <>Your words, from {ev.source}{ev.kind ? ` (${ev.kind})` : ''}.</>
              : <>Your words, from a profile record this row does not name.</>}
          </div>
          {/* The resolver's own supporting note, verbatim and only when it exists. A model proposal
              carries its reasoning here; an exact match usually carries nothing. */}
          {ev.extra && (
            <div className="px-small" style={{ marginTop: 2, color: 'var(--proto-ink3)' }}>{ev.extra}</div>
          )}
        </div>
      )}
    </div>
  )
}

// The count beside a group title is SPLIT by kind_source. A single "3" for one line the posting
// marked required plus two the parser defaulted presents a guess as a fact — which is exactly what
// requirements.ts keeps kind_source to prevent. The prose note below is not a substitute: the
// NUMBER is what a reader takes away.
function Group({ title, note, rows, qc, usageOf = null, onGoToFieldRef = null, oppId = null, onConfirmed = null }) {
  const split = summarizeKindSource(rows)
  return (
    <div style={{ marginTop: 14 }} data-qc={POSTING_HOOKS.group} data-qc-group={qc}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
        <span className="px-chip" data-qc={POSTING_HOOKS.groupCount}>{split.total}</span>
        {split.total > 0 && (
          <span className="px-small" data-qc={POSTING_HOOKS.kindSourceSplit} style={{ color: 'var(--proto-ink3)' }}>
            ({split.text})
          </span>
        )}
      </div>
      {note && <div className="px-small" style={{ marginTop: 2, color: 'var(--proto-ink2)' }}>{note}</div>}
      {rows.length === 0
        ? <div className="px-small" style={{ marginTop: 8, color: 'var(--proto-ink3)' }}>None found in this posting.</div>
        : rows.map((r) => <RequirementRow key={r.id || `${r.kind}-${r.seq}`} r={r} usage={usageOf ? usageOf(r) : null}
            onGoToFieldRef={onGoToFieldRef} oppId={oppId} onConfirmed={onConfirmed} />)}
    </div>
  )
}

// The keyword surface, shared by the card's third tab and the tally modal so the two can never
// print different words about the same library. Every word here is DERIVED from the checks
// engine's artifact_score row — "no published version yet" used to be hardcoded, which is correct
// only for as long as the library stays unpublished and a lie the day it publishes.
function KeywordLibraryState({ score }) {
  const s = keywordLibraryState(score)
  return (
    <div className="px-note" data-qc={POSTING_HOOKS.libraryState} data-qc-state={s.state}>
      <b>{s.headline}</b>{' '}{s.detail}
      {s.source && <div style={{ marginTop: 4 }}>The checks engine reports: {s.source}</div>}
    </div>
  )
}

// A keyword with no tone gets the KEYWORD HIGHLIGHT (D11): highlighter yellow, through the shared
// .qc-kw class rather than a colour typed here. The class carries its own foreground, which is the
// whole point of the token pair - a background alone leaves the text inheriting --proto-ink, and
// --proto-ink in dark mode is near-white, on yellow.
//
// A TONED chip is a different statement ("flagged as thin"), so it keeps the semantic tokens: the
// highlight means "this is a keyword", never "this keyword is good or bad".
function KeywordChips({ items, tone }) {
  const bg = tone === 'green' ? 'var(--proto-green-soft)' : tone === 'red' ? 'var(--proto-red-soft)' : null
  const fg = tone === 'green' ? 'var(--proto-green)' : tone === 'red' ? 'var(--proto-red)' : null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
      {items.map((k) => (
        <span key={k} className={bg ? undefined : HIGHLIGHT_CLASS.keyword}
          style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, fontWeight: 600, background: bg || undefined, color: fg || undefined }}>{k}</span>
      ))}
    </div>
  )
}

// D14. Every keyword list on this screen renders through here, and every word it says about itself
// comes from `keywordGroupMeaning` - which derives label, tone and disclaimer from ONE fact: was the
// list ever compared to the candidate's profile? `packet.covered_kw` used to render green under the
// word "covered"; the call that fills it (appPackets.jdAnalysis) carries Role, Company, Comp and the
// job description and no candidate input at all, so nothing in it could establish coverage. The
// thin list IS candidate-compared (appApply.atsScoreOne sends a CANDIDATE MASTER BASELINE), and
// rendering the two as a green/red pair lent the unmeasured half the credibility of the measured one.
//
// The rule used to be a paragraph of comment here. It is a tested function now, because prose does
// not run: `H:keyword-claim-follows-provenance` flips the provenance and asserts the screen changes.
// `data-qc-claim` puts the same fact in the DOM, so ui-verify.yml can prove it on the live app.
function KeywordGroup({ groupKey, items }) {
  const m = keywordGroupMeaning(groupKey, items.length)
  if (!m) return null
  return (
    <div style={{ marginTop: 10 }} data-qc={POSTING_HOOKS.keywordGroup}
      data-qc-group={m.qcGroup} data-qc-claim={m.claim}>
      <div className="px-small" style={{ fontWeight: 600 }}>{m.label}</div>
      <KeywordChips items={items} tone={m.tone} />
      {m.note && (
        <div className="px-small" style={{ marginTop: 4, color: 'var(--proto-ink3)' }}>{m.note}</div>
      )}
    </div>
  )
}

// Every count in here is a count of MODEL output. Each one says so on the same line as the number,
// because a bare "(4)" next to anything keyword-shaped reads as a measurement.
function ModelKeywords({ parsedKeywords, coveredKw, missingKw, gapsScoredAt }) {
  const nothing = !parsedKeywords.length && !coveredKw.length && !missingKw.length
  // P8.7: the keyword list is 2-up at >= 1040px and 1-up below. The count comes from
  // keywordColumns() and is RENDERED as data-qc-cols, so the breakpoint is selectable by CSS - a
  // media query would leave ui-verify.yml, which cannot read a computed style, unable to prove it.
  const vw = useViewportWidth()
  const cols = keywordColumns(vw)
  return (
    <div style={{ marginTop: 14 }} data-qc={POSTING_HOOKS.modelKeywords}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>Model-inferred words from this posting</div>
      <div className="px-small" style={{ marginTop: 2, color: 'var(--proto-ink2)' }}>
        A language model produced these, not the term library. They are <b>excluded from ATS
        scoring</b> and are shown only so you can see what the parser and the analysis run thought
        mattered.
      </div>
      {nothing && <div className="px-small" style={{ marginTop: 8, color: 'var(--proto-ink3)' }}>None yet - parse the posting and run the analysis.</div>}
      <div data-qc={POSTING_HOOKS.keywordColumns} data-qc-cols={cols} style={{
        display: 'grid', gridTemplateColumns: keywordGridTemplate(vw), gap: 14, alignItems: 'start',
      }}>
      {parsedKeywords.length > 0 && <KeywordGroup groupKey="parsed" items={parsedKeywords} />}
      {coveredKw.length > 0 && <KeywordGroup groupKey="from_run" items={coveredKw} />}
      {missingKw.length > 0 ? (
        <KeywordGroup groupKey="thin" items={missingKw} />
      ) : (
        // "Scored and found nothing" and "never scored" are different states. Printing an empty
        // list for both is how absent evidence gets read as a pass. The claim attribute is the
        // SAME one a populated thin list carries, so a live check cannot tell them apart by
        // accident - the difference is the sentence, not the provenance.
        <div className="px-small" style={{ marginTop: 10, color: 'var(--proto-ink3)' }}
          data-qc={POSTING_HOOKS.keywordGroup} data-qc-group="thin"
          data-qc-claim={keywordGroupMeaning('thin', 0).claim}>
          {gapsScoredAt
            ? 'The gap scorer has run against this posting and flagged nothing as thin.'
            : 'This posting has not been gap-scored yet, so the thin list is unknown, not empty.'}
        </div>
      )}
      </div>
    </div>
  )
}

// ── the SOURCE card on the JD step ──────────────────────────────────────────────────────────────
export function PostingAnalysisCard({ req, reqError, reloadReq, coveredKw, missingKw, gapsScoredAt, onParse, parseBusy, hasSummary, keywordScore, onOpenQc, swaps = null, listOwners = null, onGoToField = null, oppId = null }) {
  const [tab, setTab] = useState('responsibilities')
  // P8.7 makes tabs the layout and keeps the old three-column arrangement available behind a flag.
  // It is a stored preference rather than a code constant so it is the user's to change, per the
  // "no hardcoded config" rule; tabs remain the default.
  const [columns, setColumns] = useState(() => { try { return localStorage.getItem('ee_posting_columns') === '1' } catch { return false } })
  const setColumnsPersisted = (v) => { setColumns(v); try { localStorage.setItem('ee_posting_columns', v ? '1' : '0') } catch {} }

  const g = groupRequirements(req?.requirements || [])
  const { all: rows, responsibilities, mustHaves, niceToHaves, requirements } = g
  const parsedKeywords = g.modelKeywords

  // The keywords tab is named for what it holds: words. Attaching a MODEL-GENERATED count to the
  // word "ATS" made a suggestion look like a measurement — model_keyword is explicitly "never
  // scoreable" in requirements.ts, so no ATS number can be derived from it at all.
  // SPEC 4.1-6. `tone` is worst-state-wins over the SAME EVIDENCE_TONE map the rows use, so a tab and
  // the rows inside it cannot disagree about what colour the evidence is. NULL renders uncoloured.
  // SPEC 4.1-20. ONE resolver for the card, so every group asks the same question the same way.
  // Returns null unless a swap names this requirement AND its list resolves to an artifact the
  // packet actually has - the link must not appear where it cannot go.
  const usageOf = (r) => (swaps && listOwners ? requirementUsage(swaps, r && r.id, listOwners) : null)

  // SPEC 4.1-10. `evidenced` rides beside `count` from the SAME rows tabEvidenceTone reads, so the
  // ratio and the colour cannot disagree about the same tab -- the divergence this file already
  // records for the card-vs-row "2 of 3" is exactly what two independent counts produce.
  const TABS = [
    { key: 'responsibilities', label: 'Responsibilities', count: responsibilities.length, evidenced: tabEvidenced(responsibilities), tone: tabEvidenceTone(responsibilities), hint: `${responsibilities.length} lines extracted from the posting` },
    { key: 'requirements', label: 'Requirements', count: requirements.length, evidenced: tabEvidenced(requirements), tone: tabEvidenceTone(requirements), hint: `${requirements.length} lines extracted from the posting` },
    // NO TONE ON THIS TAB, EVER, and it is a deliberate divergence from the prototype rather than an
    // omission. These are MODEL-SUGGESTED words: `model_keyword` is explicitly never scoreable, and
    // this file already records that attaching a count to them "made a suggestion look like a
    // measurement". A colour is a stronger claim than a count, so it would be a worse version of the
    // same mistake. The prototype's third tab is ATS keywords scored off a term library; ours is not
    // the same thing wearing the same label.
    { key: 'keywords', label: 'Keywords', count: parsedKeywords.length, tone: null, hint: `${parsedKeywords.length} model-suggested words, excluded from ATS scoring` },
  ]

  const responsibilitiesPane = (
    <Group title="Responsibilities" rows={responsibilities} qc="responsibilities" usageOf={usageOf} onGoToFieldRef={onGoToField}
      oppId={oppId} onConfirmed={reloadReq}
      note="What the job does day to day. A separate class from requirements, never mixed in with them." />
  )
  const requirementsPane = (
    <>
      <Group title="Must-have" rows={mustHaves} qc="must_have" usageOf={usageOf} onGoToFieldRef={onGoToField}
        oppId={oppId} onConfirmed={reloadReq}
        note="Requirements the posting states as required, or that the parser defaulted to required. The count above splits the two." />
      <Group title="Nice-to-have" rows={niceToHaves} qc="nice_to_have" usageOf={usageOf} onGoToFieldRef={onGoToField}
        oppId={oppId} onConfirmed={reloadReq}
        note="Requirements the posting marks preferred or optional. Same class as must-have, lower bar." />
    </>
  )
  const keywordsPane = (
    <div style={{ marginTop: 14 }} data-qc={POSTING_HOOKS.keywords}>
      <KeywordLibraryState score={keywordScore} />
      <ModelKeywords parsedKeywords={parsedKeywords} coveredKw={coveredKw} missingKw={missingKw} gapsScoredAt={gapsScoredAt} />
    </div>
  )

  return (
    <div className="px-box" data-qc={POSTING_HOOKS.card} style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Posting analysis - the source</div>
          <div className="px-small" style={{ marginTop: 3, color: 'var(--proto-ink2)', lineHeight: 1.6 }}>
            The lines this posting actually contains, compared against <ProfileLink />. This card is
            the <b>source</b>: what was extracted, and what the last run returned. The running tally
            of keywords and match is the separate <b>Keywords</b> panel, opened from the match
            estimate at the top of this packet.
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <span className="px-link" style={{ fontSize: 12, whiteSpace: 'nowrap' }}
            onClick={() => setColumnsPersisted(!columns)}>
            {columns ? 'Show as tabs' : 'Show as columns'}
          </span>
          {/* 4.1-3, the JD step's only route into QC. QC's requirement filter is internal state with
              no prop and no route segment, so this cannot land on ONE line - it opens the Coverage
              list, which is every line and how the assets answer it. The second sentence says so
              rather than letting the arrow imply a targeting the control does not have. Hidden, not
              inert, when the extraction produced nothing to point at. */}
          {onOpenQc && !reqError && rows.length > 0 && (
            <span style={{ textAlign: 'right' }}>
              <span className="px-link" role="button" tabIndex={0} data-qc={POSTING_HOOKS.openQc}
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                onClick={onOpenQc}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenQc() } }}>
                See where each one is answered &rarr;
              </span>
              <span className="px-small" style={{ display: 'block', textTransform: 'none', color: 'var(--proto-ink3)' }}>
                opens the coverage list in QC, line by line
              </span>
            </span>
          )}
        </div>
      </div>

      {/* what the extraction is standing on - stated, not implied */}
      <div className="px-small" style={{ marginTop: 10, color: 'var(--proto-ink3)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {req ? (
          <>
            <span>{fmt(req.total)} lines extracted</span>
            <span>·</span>
            <span>{fmt(req.located)} located in the posting text</span>
            <span>·</span>
            <span>{req.jdTextLen ? `${fmt(req.jdTextLen)} characters of posting stored` : 'no posting text stored'}</span>
            {req.jdTextTruncated && <Pill tone="yellow">posting truncated before the parser read it</Pill>}
            {req.stale && <span data-qc={POSTING_HOOKS.stale}><Pill tone="red">the posting changed since these offsets were measured</Pill></span>}
          </>
        ) : <span>Loading the extracted lines…</span>}
      </div>

      {reqError && (
        <div className="px-note" style={{ marginTop: 10 }}>
          Could not load the extracted lines: {reqError}.{' '}
          <span className="px-link" onClick={reloadReq}>Try again</span>
        </div>
      )}

      {req && req.total === 0 && (
        <div className="px-note" style={{ marginTop: 10 }}>
          Nothing has been extracted from this posting yet.{' '}
          <span className="px-link" onClick={onParse}>{parseBusy ? 'Parsing…' : (hasSummary ? 'Re-parse the posting' : 'Parse the posting')}</span>
          {' '}to pull out its responsibilities and requirements.
        </div>
      )}

      {columns ? (
        // Legacy three-column arrangement, kept behind the preference above.
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginTop: 6 }}>
          <div data-qc={POSTING_HOOKS.panel} data-qc-panel="responsibilities">{responsibilitiesPane}</div>
          <div data-qc={POSTING_HOOKS.panel} data-qc-panel="requirements">{requirementsPane}</div>
          <div data-qc={POSTING_HOOKS.panel} data-qc-panel="keywords">{keywordsPane}</div>
        </div>
      ) : (
        <>
          <div role="tablist" style={{ display: 'flex', gap: 4, marginTop: 12, borderBottom: '1px solid var(--proto-rule-soft)', overflowX: 'auto' }}>
            {TABS.map((t) => (
              <div key={t.key} role="tab" title={t.hint} aria-selected={tab === t.key}
                data-qc={POSTING_HOOKS.tab} data-qc-tab={t.key} data-qc-active={tab === t.key ? '1' : '0'}
                className={`px-tab ${tab === t.key ? 'px-tab-active' : 'px-tab-idle'}`} onClick={() => setTab(t.key)}>
                {t.label}{' '}
                {/* SPEC 4.1-10. `n of m evidenced` where the rows carry a state, the bare total
                    where they do not. The two forms are not interchangeable: `0 of 21` over
                    unmeasured rows would be a coverage claim the data cannot support, so
                    tabEvidenced returns null and this falls back to the count. */}
                <span data-qc-tone={t.tone || undefined}
                  data-qc-evidenced={t.evidenced ? `${t.evidenced.evidenced}/${t.evidenced.total}` : undefined}
                  style={t.tone ? { color: toneColor(t.tone), fontWeight: 700 } : { opacity: 0.75 }}>
                  {t.evidenced ? `${t.evidenced.evidenced} of ${t.evidenced.total} evidenced` : `(${t.count})`}
                </span>
              </div>
            ))}
          </div>
          <div data-qc={POSTING_HOOKS.panel} data-qc-panel={tab}>
            {tab === 'responsibilities' && responsibilitiesPane}
            {tab === 'requirements' && requirementsPane}
            {tab === 'keywords' && keywordsPane}
          </div>
        </>
      )}

      {!columns && tab !== 'keywords' && rows.length > 0 && (
        // The legend sits under the Requirements and Responsibilities panels. Those are posting
        // analysis, so "ATS" does not appear in it — the thing being waited on is the keyword
        // term library, which is what this now says.
        <div className="px-small" data-qc={POSTING_HOOKS.legend} style={{ marginTop: 12, color: 'var(--proto-ink3)' }}>
          Legend - MH must-have · NTH nice-to-have · RESP responsibility · #n the line's position in
          the posting. Competency stays unassigned until the keyword term library has a published
          version.
        </div>
      )}
    </div>
  )
}

// ── the run card: busy state plus a result strip that stays put ─────────────────────────────────
export function AnalysisRunCard({ busy, onRun, hasRun, result, extra }) {
  return (
    <div className="px-box" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Match &amp; keyword run</div>
          <div className="px-small" style={{ lineHeight: 1.6 }}>
            Compares this posting against <ProfileLink /> and returns a model match estimate plus
            model-inferred keywords. Those keywords are not the ATS term library.
          </div>
        </div>
        <button className="px-btn px-btn-accent" disabled={busy} onClick={onRun}>
          {busy ? 'Analyzing…' : (hasRun ? 'Re-run analysis' : 'Run analysis')}
        </button>
        {extra}
      </div>

      {/* The result strip persists. A toast that disappears in 2.2s is not evidence a run happened. */}
      {busy && <div className="px-note" data-qc={POSTING_HOOKS.analysisRunning}>Running the analysis against the stored posting text…</div>}
      {!busy && result && (
        <div className="px-note" data-qc={POSTING_HOOKS.analysisResult} data-qc-outcome={result.error ? 'error' : 'ok'}
          style={result.error ? { background: 'var(--proto-red-soft)', borderColor: 'var(--proto-red)', color: 'var(--proto-red)' } : undefined}>
          {result.error
            ? <>Last run failed at {result.at}: {result.error}</>
            : (
              <>
                Ran at {result.at} - match estimate{' '}
                <b>{result.atsScore === null || result.atsScore === undefined ? 'not returned' : `${result.atsScore}`}</b>
                {result.atsScore === null || result.atsScore === undefined ? '' : ' - a model estimate, not a measured coverage score'}
                {' · '}{result.keywords} model-inferred keywords
                {' · '}{result.mustHaves} must-haves
                {' · '}{result.cached
                  ? 'reused the stored analysis, nothing was re-computed'
                  : result.grounded
                    ? `read ${fmt(result.sourceChars)} characters of the real posting`
                    : 'the real posting text was not available, so the run had less to read'}
              </>
            )}
        </div>
      )}
    </div>
  )
}

// ── SPEC 4.3-9/10/11: the QC summary, inside the tally modal ────────────────────────────────────
//
// THIS COMPONENT DERIVES NOTHING. Every sentence, every row and the score itself come from
// qcSummaryModel() (qcRail.js), which reads the same useQcEntries() payload the QC rail, the step
// circle, the asset badges and the ship gate read. The modal opens from the JD step, where the
// reader cannot see the rail to check it against - so a number computed here would be a second
// opinion nobody could reconcile.
//
// What it must NOT say: that the packet is clear (there is no packet-level score, and no verdict is
// computed here), or a composite for anything but the ONE artifact it names.
function QcSummaryBlock({ model, onGoToField = null }) {
  if (!model) return null
  const scored = model.state === 'scored'
  return (
    <div data-qc={POSTING_HOOKS.qcSummary} data-qc-state={model.state}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>QC summary</div>
      <div className="px-note">
        <b>{model.sentence}</b>{' '}{model.detail}
        {/* Which artifact this score belongs to, always. artifact_score is per artifact; the packet
            has no composite of its own and averaging the assets would invent one. */}
        {model.scope && <div style={{ marginTop: 4 }}>{model.scope}.</div>}
      </div>

      {scored && (
        <div data-qc={POSTING_HOOKS.qcSummaryScore} style={{ marginTop: 8 }}>
          {/* Named, every time. A composite belongs to ONE artifact and the reader has to be able
              to see which, or a resume's score reads as the packet's. */}
          <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-brand)' }}>
            Match score - {model.subject}
          </div>
          {model.headline.hasNumber
            ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.05 }}>{model.headline.value}</span>
                {model.headline.band && <Pill tone={bandTone(model.headline.band)}>{String(model.headline.band).replace(/_/g, ' ')}</Pill>}
                {/* The other big number in this modal is a MODEL estimate. This one is measured, and
                    says so on the same line, because the two are inches apart. */}
                <span className="px-small" style={{ color: 'var(--proto-ink2)' }}>
                  measured by the checks engine and stored on the asset - not a model estimate
                </span>
              </div>
            )
            : <div className="px-small">{model.headline.why}</div>}
        </div>
      )}

      {scored && (
        <div style={{ marginTop: 8 }}>
          <ScoreParts parts={model.headline.parts} variant="drawer"
            hook={POSTING_HOOKS.qcSummaryPart} defer={TALLY_SCORE_DEFER} />
        </div>
      )}

      {model.rows.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div className="px-small" style={{ color: 'var(--proto-ink3)', marginBottom: 2 }}>
            Every asset this packet actually has, with the gate the checks engine last recorded for it.
          </div>
          {model.rows.map((r) => (
            <div key={r.artifactId || r.type} data-qc={POSTING_HOOKS.qcSummaryRow}
              data-qc-artifact={r.artifactId || undefined} data-qc-type={r.type || undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--proto-rule-soft)' }}>
              <span style={{ flex: 1, fontSize: 13 }}>{r.label}</span>
              {/* loading and error are GateBadge's own states. An asset whose checks could not be
                  read is named with "gate unavailable", never dropped from the list - a missing row
                  reads as "nothing wrong with it". */}
              {/* SPEC 4.4-14 in this surface. The target is carried ON THE ROW by qcSummaryModel -
                  this block derives nothing, so computing it here would be the second opinion the
                  reader cannot reconcile. Both halves must be present: a navigator from the mount
                  site AND a row that actually has an openable field. Either missing means NO click,
                  never a click that goes nowhere. */}
              <GateBadge result={r.result} loading={r.loading} error={r.error} compact
                onClick={onGoToField && r.fixTarget
                  ? () => onGoToField(r.fixTarget.artifactId, r.fixTarget.mergeField)
                  : undefined} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── the TALLY: the modal that replaced the 280px right column (D4) ──────────────────────────────
export function KeywordTallyOverlay({ open, onClose, req, coveredKw, missingKw, gapsScoredAt, atsScore, keywordScore, qcSummary, onBuildAll, buildBusy, onGoResume, onGoQc, onGoToField }) {
  if (!open) return null
  const parsedKeywords = modelKeywords(req?.requirements || [])

  return (
    <Overlay open={open} onClose={onClose} variant="modal" title="Keywords"
      subtitle="The tally. The extracted lines themselves live on the Posting analysis card in step 1.">
      <div data-qc={POSTING_HOOKS.tally} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Match estimate</div>
          <div className="px-small" style={{ color: 'var(--proto-ink2)', marginTop: 2 }}>
            One model's read of how well <ProfileLink>your master profile</ProfileLink> answers this
            posting. It is not keyword coverage, and no applicant tracking system produced it.
          </div>
          <div data-qc={POSTING_HOOKS.matchEstimate} style={{ fontSize: 30, fontWeight: 800, marginTop: 6, color: atsScore === null ? 'var(--proto-ink3)' : atsScore >= 80 ? 'var(--proto-green)' : atsScore >= 60 ? 'var(--proto-accent)' : 'var(--proto-red)' }}>
            {atsScore === null ? 'not run yet' : `${atsScore}`}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Coverage against the ATS term library</div>
          <KeywordLibraryState score={keywordScore} />
        </div>

        {/* The QC summary sits BELOW the library state on purpose: the score block defers its
            keyword part upward to it, so "shown once, above" has to be true of the layout too. */}
        <QcSummaryBlock model={qcSummary} onGoToField={onGoToField} />

        <ModelKeywords parsedKeywords={parsedKeywords} coveredKw={coveredKw} missingKw={missingKw} gapsScoredAt={gapsScoredAt} />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--proto-rule-soft)' }}>
          <button className="px-btn px-btn-accent" disabled={buildBusy} onClick={onBuildAll}>
            {buildBusy ? 'Building…' : 'Rebuild every asset from this posting'}
          </button>
          <button className="px-btn" onClick={onGoResume}>Go to the resume step</button>
          {/* SPEC 4.3-9. The SAME close-and-navigate shape as onGoResume, threaded as a prop: this
              file must not import navigation. Hidden rather than stubbed when no handler is given -
              a control that does nothing is the dead UI the standing rule forbids. */}
          {onGoQc && (
            <button className="px-btn" data-qc={POSTING_HOOKS.tallyOpenQc} onClick={onGoQc}
              title="Close this panel and open the QC step">Open QC - every finding, per asset</button>
          )}
        </div>
      </div>
    </Overlay>
  )
}

// The header score doubles as the button that opens the tally (P8.7: the keyword analysis lives in
// the modal behind the header score, and is not duplicated in a right column). The button names the
// panel it opens — "ATS" is not part of that name, because what it opens is a keyword tally and a
// model estimate, not an applicant-tracking measurement.
export function MatchEstimateButton({ atsScore, onClick, compact }) {
  const color = atsScore === null ? 'var(--proto-ink3)' : atsScore >= 80 ? 'var(--proto-green)' : atsScore >= 60 ? 'var(--proto-accent)' : 'var(--proto-red)'
  return (
    <button type="button" onClick={onClick} title="Open the Keywords panel" data-qc={POSTING_HOOKS.matchEstimateButton}
      style={{
        background: 'transparent', border: '1px solid var(--proto-rule-soft)', borderRadius: 8,
        padding: compact ? '6px 10px' : '6px 12px', cursor: 'pointer', textAlign: 'right',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1,
      }}>
      <span className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-brand)' }}>
        Match estimate
      </span>
      <span style={{ fontSize: compact ? 20 : 28, fontWeight: 800, lineHeight: 1, color }}>
        {atsScore === null ? '—' : atsScore}
      </span>
      <span className="px-small" style={{ color: 'var(--proto-ink3)' }}>model estimate · keywords ↗</span>
    </button>
  )
}
