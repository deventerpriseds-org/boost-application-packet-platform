// Keyword-tally browser probe (SPEC 4.3-9/10/11) — mounts the REAL <KeywordTallyOverlay> with the
// QC summary in each of the states the packet can actually be in, so the claims that only exist
// once React has rendered are asserted from the DOM rather than from a source grep.
//
// WHY A PROBE AND NOT A NODE TEST. The node suite proves qcSummaryModel() — the sentences, the row
// list, the six states. It cannot see the two things that matter most here, because both are facts
// about the rendered tree:
//   • that a DEFERRED score part prints no number and no bar (AC B.4/B.7 — a 0%-wide bar and "not
//     measured" are different claims, and the same column under two labels is one measurement
//     pretending to be two);
//   • that <ScoreParts> renders byte-identically to the two hand-written loops it replaced.
// The second is the golden master: `?case=parity` renders the PRE-EXTRACTION markup beside the
// component and the runner compares outerHTML. Without it "MatchTab's output is unchanged" is a
// claim about a diff nobody executed.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/theme.css'
import { KeywordTallyOverlay } from '../../src/screens/PostingAnalysis.jsx'
import { ScoreParts } from '../../src/screens/AssetGateDrawer.jsx'
import { Pill } from '../../src/shell.jsx'
import { qcSummaryModel, QC_HOOKS } from '../../src/qcRail.js'
import { pctWidth } from '../../src/assetGate.js'

const entry = (id, type, label, result, extra = {}) => ({
  artifact: { id, type }, artifactId: id, type, label, result,
  resultLoading: false, resultError: null, ...extra,
})
const checked = (gate) => ({ gate, attention: 0, results: [], engines: {}, computedAt: '2026-08-26T10:00:00Z' })
const unchecked = () => ({ gate: null, attention: 0, results: [], engines: {} })

// Distinct digits per part, so "does this number appear twice on the screen" is answerable by
// counting one string. 62 must-haves, 71 keywords, 55 seniority, 78 composite.
const FULL_SCORE = {
  composite: 78, band: 'acceptable',
  must_have_coverage: 62, must_have_source: 'measured over 13 must-have lines',
  keyword_coverage: 71, keyword_source: 'measured against term library v4',
  seniority_alignment: 55, seniority_source: 'graded by the independent reviewer',
}
// TODAY'S REAL SHAPE. Every artifact in docs/qc-evidence/fixtures.json (pulled from production)
// has `score: null`; when a score row does exist, two of its three parts are null because the term
// library has no published scoreable entries and the reviewer has not graded.
const PARTIAL_SCORE = {
  composite: null, band: null,
  must_have_coverage: 62, must_have_source: 'measured over 13 must-have lines',
  keyword_coverage: null, keyword_source: 'no published term-library version has scoreable entries yet',
  seniority_alignment: null, seniority_source: 'the independent reviewer has not graded this asset',
}

const RESUME = 'resume'
const CASES = {
  // AC B.9 — an empty packet.
  no_assets: () => ({ entries: [], scored: null }),
  // AC B.10 — assets exist, but none of them is the one that carries the score.
  no_resume: () => {
    const e = [entry('c1', 'cover', 'Cover letter', checked('warn')), entry('p1', 'portfolio', 'Portfolio', checked('pass'))]
    return { entries: e, scored: null }
  },
  // AC B.11 — nothing has ever been checked. Absent evidence is not a pass.
  unchecked: () => {
    const e = [
      entry('r1', RESUME, 'Resume', unchecked()),
      entry('c1', 'cover', 'Cover letter', unchecked()),
      entry('v1', 'video', 'Intro video', unchecked()),
    ]
    return { entries: e, scored: e[0] }
  },
  // AC B.6/B.7 — a stored score row whose composite is null because two parts have no source.
  null_composite: () => {
    const e = [
      entry('r1', RESUME, 'Resume', { ...checked('fail'), score: PARTIAL_SCORE }),
      entry('c1', 'cover', 'Cover letter', checked('warn')),
    ]
    return { entries: e, scored: e[0] }
  },
  // AC B.4/B.5 — every part measured. The keyword number exists, so this is the case that proves
  // it is printed ONCE.
  scored: () => {
    const e = [
      entry('r1', RESUME, 'Resume', { ...checked('pass'), score: FULL_SCORE }),
      entry('c1', 'cover', 'Cover letter', checked('pass')),
    ]
    return { entries: e, scored: e[0] }
  },
  // AC B.12 — one asset's checks could not be read, one is still in flight. Both are NAMED.
  errors: () => {
    const e = [
      entry('r1', RESUME, 'Resume', null, { resultError: 'HTTP 500 from checks-result' }),
      entry('c1', 'cover', 'Cover letter', null, { resultLoading: true }),
    ]
    return { entries: e, scored: e[0] }
  },
}

const PARTS = [
  { key: 'must', label: 'Must-haves evidenced', value: 62, source: 'measured over 13 must-have lines' },
  { key: 'kw', label: 'Keywords present', value: null, source: 'no published term-library version has scoreable entries yet' },
  { key: 'sen', label: 'Seniority fit', value: 55, source: 'graded by the independent reviewer' },
]

// The markup as it stood BEFORE the extraction, copied verbatim from
// AssetGateDrawer.jsx MatchTab (`git show HEAD:app/src/screens/AssetGateDrawer.jsx`, the
// `parts.map` at :306-318) and QcRail.jsx (the `headline.parts.map` at :861-874). This is a golden
// master and nothing but the probe may render it.
function LegacyDrawerParts({ parts }) {
  return parts.map((p) => (
    <div key={p.key} className="px-box-soft" style={{ padding: 10, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{p.label}</span>
        {p.value == null ? <Pill tone="panel">not measured</Pill> : <span style={{ fontSize: 15, fontWeight: 700 }}>{p.value}</span>}
      </div>
      {p.value != null && (
        <div className="px-bar" style={{ marginTop: 6 }}><i style={{ width: Math.max(0, Math.min(100, Number(p.value))) + '%' }} /></div>
      )}
      <div className="px-small" style={{ marginTop: 6 }}>{p.source || 'no source was recorded for this part'}</div>
    </div>
  ))
}

function LegacyRailParts({ parts }) {
  return parts.map((p) => (
    <div key={p.key} data-qc={QC_HOOKS.component} data-qc-part={p.key} data-qc-measured={p.value == null ? '0' : '1'}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 12, flex: 1 }}>{p.label}</span>
        {p.value == null
          ? <Pill tone="panel">not measured</Pill>
          : <span style={{ fontSize: 13, fontWeight: 700 }}>{p.value}</span>}
      </div>
      {p.value != null && (
        <div className="px-bar" style={{ marginTop: 4 }}><i style={{ width: pctWidth(p.value) }} /></div>
      )}
      <div className="px-small" style={{ marginTop: 2 }}>{p.source || 'no source was recorded for this part'}</div>
    </div>
  ))
}

function Parity() {
  return (
    <div style={{ padding: 16 }}>
      <div id="legacy-drawer"><LegacyDrawerParts parts={PARTS} /></div>
      <div id="new-drawer"><ScoreParts parts={PARTS} variant="drawer" /></div>
      <div id="legacy-rail"><LegacyRailParts parts={PARTS} /></div>
      <div id="new-rail"><ScoreParts parts={PARTS} variant="rail" hook={QC_HOOKS.component} /></div>
    </div>
  )
}

function Tally({ name }) {
  const { entries, scored } = CASES[name]()
  const model = qcSummaryModel(entries, { scored, scoredType: RESUME })
  return (
    <KeywordTallyOverlay
      open onClose={() => {}}
      req={{ requirements: [] }}
      keywordScore={(scored && scored.result && scored.result.score) || null}
      qcSummary={model}
      coveredKw={[]} missingKw={[]} gapsScoredAt={null} atsScore={64}
      onBuildAll={() => {}} buildBusy={false}
      onGoResume={() => {}}
      onGoQc={() => { window.__wentToQc = (window.__wentToQc || 0) + 1 }} />
  )
}

const name = new URLSearchParams(window.location.search).get('case') || 'null_composite'
createRoot(document.getElementById('root')).render(name === 'parity' ? <Parity /> : <Tally name={name} />)
