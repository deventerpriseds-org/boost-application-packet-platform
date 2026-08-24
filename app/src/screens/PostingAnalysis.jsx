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
import { Pill, Overlay } from '../shell.jsx'
import {
  KIND_ABBR, reqChipLabel, kindSourceNote, noQuoteReason, isQuoted,
  groupRequirements, modelKeywords, summarizeKindSource, keywordLibraryState,
  keywordColumns, keywordGridTemplate, POSTING_HOOKS,
  fitLabel, FIT_COLOR, comparisonState, compareColumns, compareGridTemplate,
  COMPARE_COLUMNS, COMPARE_SCOPE_NOTE, comparisonStaleNote,
  keywordGroupMeaning,
} from '../postingAnalysis.js'
import { HIGHLIGHT_CLASS } from '../highlight.js'

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

export function ProfileCompareCard({ comparison, onOpenRequirements }) {
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
      </div>
    </div>
  )
}

// ── one extracted line ──────────────────────────────────────────────────────────────────────────
function RequirementRow({ r }) {
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
    </div>
  )
}

// The count beside a group title is SPLIT by kind_source. A single "3" for one line the posting
// marked required plus two the parser defaulted presents a guess as a fact — which is exactly what
// requirements.ts keeps kind_source to prevent. The prose note below is not a substitute: the
// NUMBER is what a reader takes away.
function Group({ title, note, rows, qc }) {
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
        : rows.map((r) => <RequirementRow key={r.id || `${r.kind}-${r.seq}`} r={r} />)}
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
export function PostingAnalysisCard({ req, reqError, reloadReq, coveredKw, missingKw, gapsScoredAt, onParse, parseBusy, hasSummary, keywordScore }) {
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
  const TABS = [
    { key: 'responsibilities', label: 'Responsibilities', count: responsibilities.length, hint: `${responsibilities.length} lines extracted from the posting` },
    { key: 'requirements', label: 'Requirements', count: requirements.length, hint: `${requirements.length} lines extracted from the posting` },
    { key: 'keywords', label: 'Keywords', count: parsedKeywords.length, hint: `${parsedKeywords.length} model-suggested words, excluded from ATS scoring` },
  ]

  const responsibilitiesPane = (
    <Group title="Responsibilities" rows={responsibilities} qc="responsibilities"
      note="What the job does day to day. A separate class from requirements, never mixed in with them." />
  )
  const requirementsPane = (
    <>
      <Group title="Must-have" rows={mustHaves} qc="must_have"
        note="Requirements the posting states as required, or that the parser defaulted to required. The count above splits the two." />
      <Group title="Nice-to-have" rows={niceToHaves} qc="nice_to_have"
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
        <span className="px-link" style={{ fontSize: 12, whiteSpace: 'nowrap' }}
          onClick={() => setColumnsPersisted(!columns)}>
          {columns ? 'Show as tabs' : 'Show as columns'}
        </span>
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
                {t.label} <span style={{ opacity: 0.75 }}>({t.count})</span>
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

// ── the TALLY: the modal that replaced the 280px right column (D4) ──────────────────────────────
export function KeywordTallyOverlay({ open, onClose, req, coveredKw, missingKw, gapsScoredAt, atsScore, keywordScore, onBuildAll, buildBusy, onGoResume }) {
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

        <ModelKeywords parsedKeywords={parsedKeywords} coveredKw={coveredKw} missingKw={missingKw} gapsScoredAt={gapsScoredAt} />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--proto-rule-soft)' }}>
          <button className="px-btn px-btn-accent" disabled={buildBusy} onClick={onBuildAll}>
            {buildBusy ? 'Building…' : 'Rebuild every asset from this posting'}
          </button>
          <button className="px-btn" onClick={onGoResume}>Go to the resume step</button>
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
