// P5.4 — the JD step's posting analysis, and the keyword tally that used to be a right column.
//
// Two surfaces, deliberately different, and each says which it is:
//   • <PostingAnalysisCard> is the SOURCE. It shows the lines the parser pulled out of THIS posting
//     (with the employer's own words where they could be located) and the result of the last run.
//   • <KeywordTallyOverlay> is the TALLY. It is the modal behind the header score and holds every
//     keyword/ATS number. Per decision D4 the 280px right ATS panel is gone: the shell caps content
//     at 1280 minus 196 of nav, leaving ~664px at 1440, and P5.2's asset blocks need ~850px.
//
// NAMING RULE (P5.4): "ATS" belongs to the keyword library and its coverage. Requirements and
// responsibilities are POSTING ANALYSIS and are never called ATS anywhere in this file. The match
// number the analysis run produces is a MODEL ESTIMATE, not ATS coverage, and is labelled as one.
import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Pill, Overlay } from '../shell.jsx'

// Where the user's side of the comparison actually lives, so "the profile" always has a referent.
export const PROFILE_HREF = '#/settings/facts'
export const PROFILE_LABEL = 'your master profile (Settings > Facts)'

export function ProfileLink({ children }) {
  return <a className="px-link" href={PROFILE_HREF} style={{ fontWeight: 600 }}>{children || PROFILE_LABEL}</a>
}

// requirement.kind_source records WHY a line was filed where it was. A defaulted kind must look
// different from one the posting actually marked, or a guess reads as a fact.
const KIND_SOURCE_NOTE = {
  posting_required_marker: 'the posting marks this required',
  posting_optional_marker: 'the posting marks this preferred',
  posting_section_heading: 'it sits under a "preferred" heading in the posting',
  category: 'from the section the posting listed it under',
  category_default: 'defaulted - the posting did not say required or preferred',
  fallback: 'the parser could not classify this line',
}

// A row with one of these match_methods has NO employer quote. What we hold is the model's
// paraphrase, and it is labelled as such rather than dressed up as something the employer wrote.
const NO_QUOTE_REASON = {
  unlocatable: 'this wording could not be located in the posting text',
  beyond_model_window: 'the posting is longer than the parser ever read',
  no_posting: 'no posting text is stored for this opportunity',
}

const KIND_ABBR = { must_have: 'MH', nice_to_have: 'NTH', responsibility: 'RESP' }

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : n)

// ── one extracted line ──────────────────────────────────────────────────────────────────────────
function RequirementRow({ r }) {
  const quoted = !!r.verbatim
  const reason = NO_QUOTE_REASON[r.match_method] || 'the posting span for this line is unknown'
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--proto-rule-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
        <span className="px-chip" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10 }}>
          {KIND_ABBR[r.kind] || 'REQ'}&nbsp;#{r.seq}
        </span>
        <span className="px-small" style={{ color: 'var(--proto-ink3)' }}>
          {r.competency || 'competency unassigned'}
        </span>
      </div>

      {quoted ? (
        <>
          <blockquote style={{
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
          <div style={{ fontSize: 13, lineHeight: 1.6, fontStyle: 'italic' }}>{r.item_text}</div>
          <div className="px-small" style={{ marginTop: 4, color: 'var(--proto-ink3)' }}>
            Model paraphrase - not a quote from the employer, because {reason}.
          </div>
        </>
      )}

      <div className="px-small" style={{ marginTop: 3, color: 'var(--proto-ink3)' }}>
        Filed here because {KIND_SOURCE_NOTE[r.kind_source] || 'the parser defaulted it'}.
      </div>
    </div>
  )
}

function Group({ title, note, rows }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
        <span className="px-chip">{rows.length}</span>
      </div>
      {note && <div className="px-small" style={{ marginTop: 2, color: 'var(--proto-ink2)' }}>{note}</div>}
      {rows.length === 0
        ? <div className="px-small" style={{ marginTop: 8, color: 'var(--proto-ink3)' }}>None found in this posting.</div>
        : rows.map((r) => <RequirementRow key={r.id || `${r.kind}-${r.seq}`} r={r} />)}
    </div>
  )
}

// The keyword surface, shared by the card's third tab and the tally modal so the two can never
// print different words about the same (currently unscoreable) library.
function KeywordLibraryState({ keywordSource }) {
  return (
    <div className="px-note">
      <b>The ATS term library has no published version yet.</b>{' '}
      Keyword coverage cannot be scored against it, so no coverage number is shown here - an
      invented one is worse than none.
      {keywordSource && (
        <div style={{ marginTop: 4 }}>The checks engine reports: {keywordSource}</div>
      )}
    </div>
  )
}

function KeywordChips({ items, tone }) {
  const bg = tone === 'green' ? 'var(--proto-green-soft)' : tone === 'red' ? 'var(--proto-red-soft)' : 'var(--proto-panel)'
  const fg = tone === 'green' ? 'var(--proto-green)' : tone === 'red' ? 'var(--proto-red)' : 'var(--proto-ink2)'
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
      {items.map((k) => (
        <span key={k} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: bg, color: fg, fontWeight: 600 }}>{k}</span>
      ))}
    </div>
  )
}

function ModelKeywords({ parsedKeywords, coveredKw, missingKw, gapsScoredAt }) {
  const nothing = !parsedKeywords.length && !coveredKw.length && !missingKw.length
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>Model-inferred words from this posting</div>
      <div className="px-small" style={{ marginTop: 2, color: 'var(--proto-ink2)' }}>
        A language model produced these, not the term library. They are <b>excluded from ATS
        scoring</b> and are shown only so you can see what the parser and the analysis run thought
        mattered.
      </div>
      {nothing && <div className="px-small" style={{ marginTop: 8, color: 'var(--proto-ink3)' }}>None yet - parse the posting and run the analysis.</div>}
      {parsedKeywords.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="px-small" style={{ fontWeight: 600 }}>From the posting parse, one per extracted line ({parsedKeywords.length})</div>
          <KeywordChips items={parsedKeywords} />
        </div>
      )}
      {coveredKw.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="px-small" style={{ fontWeight: 600 }}>The analysis run thinks your profile already shows these ({coveredKw.length})</div>
          <KeywordChips items={coveredKw} tone="green" />
        </div>
      )}
      {missingKw.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <div className="px-small" style={{ fontWeight: 600 }}>The analysis run flagged these as thin ({missingKw.length})</div>
          <KeywordChips items={missingKw} tone="red" />
        </div>
      ) : (
        // "Scored and found nothing" and "never scored" are different states. Printing an empty
        // list for both is how absent evidence gets read as a pass.
        <div className="px-small" style={{ marginTop: 10, color: 'var(--proto-ink3)' }}>
          {gapsScoredAt
            ? 'The gap scorer has run against this posting and flagged nothing as thin.'
            : 'This posting has not been gap-scored yet, so the thin list is unknown, not empty.'}
        </div>
      )}
    </div>
  )
}

// ── the SOURCE card on the JD step ──────────────────────────────────────────────────────────────
export function PostingAnalysisCard({ req, reqError, reloadReq, coveredKw, missingKw, gapsScoredAt, onParse, parseBusy, hasSummary }) {
  const [tab, setTab] = useState('responsibilities')
  // P8.7 makes tabs the layout and keeps the old three-column arrangement available behind a flag.
  // It is a stored preference rather than a code constant so it is the user's to change, per the
  // "no hardcoded config" rule; tabs remain the default.
  const [columns, setColumns] = useState(() => { try { return localStorage.getItem('ee_posting_columns') === '1' } catch { return false } })
  const setColumnsPersisted = (v) => { setColumns(v); try { localStorage.setItem('ee_posting_columns', v ? '1' : '0') } catch {} }

  const rows = req?.requirements || []
  const responsibilities = rows.filter((r) => r.kind === 'responsibility')
  const mustHaves = rows.filter((r) => r.kind === 'must_have')
  const niceToHaves = rows.filter((r) => r.kind === 'nice_to_have')
  const requirements = [...mustHaves, ...niceToHaves]
  const parsedKeywords = Array.from(new Set(rows.map((r) => r.model_keyword).filter(Boolean)))

  const TABS = [
    { key: 'responsibilities', label: 'Responsibilities', count: responsibilities.length },
    { key: 'requirements', label: 'Requirements', count: requirements.length },
    { key: 'keywords', label: 'ATS keywords', count: parsedKeywords.length },
  ]

  const responsibilitiesPane = (
    <Group title="Responsibilities" rows={responsibilities}
      note="What the job does day to day. A separate class from requirements, never mixed in with them." />
  )
  const requirementsPane = (
    <>
      <Group title="Must-have" rows={mustHaves}
        note="Requirements the posting states as required, or that the parser defaulted to required." />
      <Group title="Nice-to-have" rows={niceToHaves}
        note="Requirements the posting marks preferred or optional. Same class as must-have, lower bar." />
    </>
  )
  const keywordsPane = (
    <div style={{ marginTop: 14 }}>
      <KeywordLibraryState />
      <ModelKeywords parsedKeywords={parsedKeywords} coveredKw={coveredKw} missingKw={missingKw} gapsScoredAt={gapsScoredAt} />
    </div>
  )

  return (
    <div className="px-box" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Posting analysis - the source</div>
          <div className="px-small" style={{ marginTop: 3, color: 'var(--proto-ink2)', lineHeight: 1.6 }}>
            The lines this posting actually contains, compared against <ProfileLink />. This card is
            the <b>source</b>: what was extracted, and what the last run returned. The running tally
            of keywords and match is the separate <b>Keywords &amp; ATS terms</b> panel, opened from
            the match estimate at the top of this packet.
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
            {req.stale && <Pill tone="red">the posting changed since these offsets were measured</Pill>}
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
          <div>{responsibilitiesPane}</div>
          <div>{requirementsPane}</div>
          <div>{keywordsPane}</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 4, marginTop: 12, borderBottom: '1px solid var(--proto-rule-soft)', overflowX: 'auto' }}>
            {TABS.map((t) => (
              <div key={t.key} className={`px-tab ${tab === t.key ? 'px-tab-active' : 'px-tab-idle'}`} onClick={() => setTab(t.key)}>
                {t.label} <span style={{ opacity: 0.75 }}>({t.count})</span>
              </div>
            ))}
          </div>
          {tab === 'responsibilities' && responsibilitiesPane}
          {tab === 'requirements' && requirementsPane}
          {tab === 'keywords' && keywordsPane}
        </>
      )}

      {!columns && tab !== 'keywords' && rows.length > 0 && (
        <div className="px-small" style={{ marginTop: 12, color: 'var(--proto-ink3)' }}>
          Legend - MH must-have · NTH nice-to-have · RESP responsibility · #n the line's position in
          the posting. Competency stays unassigned until the ATS term library has a published version.
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
      {busy && <div className="px-note">Running the analysis against the stored posting text…</div>}
      {!busy && result && (
        <div className="px-note" style={result.error ? { background: 'var(--proto-red-soft)', borderColor: 'var(--proto-red)', color: 'var(--proto-red)' } : undefined}>
          {result.error
            ? <>Last run failed at {result.at}: {result.error}</>
            : (
              <>
                Ran at {result.at} - match estimate{' '}
                <b>{result.atsScore === null || result.atsScore === undefined ? 'not returned' : `${result.atsScore} (model estimate, not ATS coverage)`}</b>
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
export function KeywordTallyOverlay({ open, onClose, packet, req, coveredKw, missingKw, gapsScoredAt, atsScore, onBuildAll, buildBusy, onGoResume }) {
  const [checks, setChecks] = useState(null)
  // Read the checks engine's own words about the library rather than restating them here; two
  // sentences describing one fact is how two screens end up disagreeing.
  const resumeArtifactId = (packet?.artifacts || []).find((a) => a.type === 'resume')?.id
  useEffect(() => {
    let dead = false
    if (!open || !resumeArtifactId) { setChecks(null); return undefined }
    api.artifactChecksResult(resumeArtifactId)
      .then((r) => { if (!dead) setChecks(r) })
      .catch(() => { if (!dead) setChecks(null) })
    return () => { dead = true }
  }, [open, resumeArtifactId])

  if (!open) return null
  const parsedKeywords = Array.from(new Set((req?.requirements || []).map((r) => r.model_keyword).filter(Boolean)))
  const keywordSource = checks?.score?.keyword_source || null

  return (
    <Overlay open={open} onClose={onClose} variant="modal" title="Keywords & ATS terms"
      subtitle="The tally. The extracted lines themselves live on the Posting analysis card in step 1.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Match estimate</div>
          <div className="px-small" style={{ color: 'var(--proto-ink2)', marginTop: 2 }}>
            One model's read of how well <ProfileLink>your master profile</ProfileLink> answers this
            posting. It is not ATS keyword coverage, and no applicant tracking system produced it.
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, marginTop: 6, color: atsScore === null ? 'var(--proto-ink3)' : atsScore >= 80 ? 'var(--proto-green)' : atsScore >= 60 ? 'var(--proto-accent)' : 'var(--proto-red)' }}>
            {atsScore === null ? 'not run yet' : `${atsScore}`}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>ATS keyword coverage</div>
          <KeywordLibraryState keywordSource={keywordSource} />
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
// the modal behind the header score, and is not duplicated in a right column).
export function MatchEstimateButton({ atsScore, onClick, compact }) {
  const color = atsScore === null ? 'var(--proto-ink3)' : atsScore >= 80 ? 'var(--proto-green)' : atsScore >= 60 ? 'var(--proto-accent)' : 'var(--proto-red)'
  return (
    <button type="button" onClick={onClick} title="Open Keywords and ATS terms"
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
      <span className="px-small" style={{ color: 'var(--proto-ink3)' }}>model estimate · keywords &amp; ATS terms ↗</span>
    </button>
  )
}
