// Posting-analysis browser probe — mounts the REAL <PostingAnalysisCard> with requirement rows in
// every evidence state, so SPEC 4.1's evidence expansion is asserted from the rendered DOM.
//
// WHY IT EXISTS. `df2c9db` shipped the expansion, the Node suite was green at 294/294, and
// `ui-verify.yml` then found the live route dead with a minified React error. A minified error
// names a number, not a cause. This probe runs the same component through Vite's DEV React, where
// the error spells itself out — the same reason `run-field-margin.mjs` was kept after PR #47.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/theme.css'
import { PostingAnalysisCard } from '../../src/screens/PostingAnalysis.jsx'

// One row per evidence state the endpoint can ship, plus a row from an OLDER payload that carries
// no verdict at all. The `unknown` row is the one that matters most here: it is what every
// requirement looks like on a deploy where the app is ahead of the API.
const requirements = [
  {
    id: 'r1', seq: 1, kind: 'must_have', kind_source: 'posting_required_marker',
    item_text: '10+ years leading platform teams', verbatim: '10+ years leading platform teams',
    char_start: 40, char_end: 72, match_method: 'exact', competency: 'leadership',
    model_keyword: 'platform leadership',
    evidenced: true, evidenceState: 'verified', evidenceNote: null, evidenceSearch: null,
    evidence: {
      quote: 'Led the platform organisation for eleven years', sourceKind: 'resume',
      sourceLabel: 'Resume 2024', sourceKey: 'resume-2024', charStart: 10, charEnd: 56,
      extra: null, ratio: 0.91, method: 'exact', recordChanged: false,
    },
  },
  {
    id: 'r2', seq: 2, kind: 'must_have', kind_source: 'category_default',
    item_text: 'Own the roadmap', verbatim: null, match_method: 'unlocatable',
    competency: 'product', model_keyword: 'roadmap',
    evidenced: false, evidenceState: 'none', evidence: null,
    evidenceNote: 'no evidence found in your profile',
    evidenceSearch: { reason: 'no_overlap', soughtWords: ['own', 'roadmap'], missingWords: ['roadmap'], closestExcerpt: null, closestSourceKey: null },
  },
  {
    id: 'r3', seq: 3, kind: 'must_have', kind_source: 'category_default',
    item_text: 'Run quarterly business reviews', verbatim: null, match_method: 'no_posting',
    competency: 'ops', model_keyword: null,
    evidenced: false, evidenceState: 'stale', evidence: null,
    evidenceNote: 'your profile changed after this excerpt was resolved, so it can no longer be shown as a verbatim quote — re-resolve the evidence for this opportunity',
    evidenceSearch: null,
  },
  {
    id: 'r4', seq: 4, kind: 'nice_to_have', kind_source: 'posting_optional_marker',
    item_text: 'MBA preferred', verbatim: 'MBA preferred', char_start: 200, char_end: 213,
    match_method: 'exact', competency: 'education', model_keyword: 'MBA',
    evidenced: false, evidenceState: 'source_missing', evidence: null,
    evidenceNote: 'the profile record this excerpt was taken from is no longer in your profile — re-resolve the evidence for this opportunity',
    evidenceSearch: null,
  },
  {
    id: 'r5', seq: 5, kind: 'responsibility', kind_source: 'category',
    item_text: 'Partner with sales', verbatim: null, match_method: 'beyond_model_window',
    competency: 'go-to-market', model_keyword: null,
    evidenced: false, evidenceState: 'unverified', evidence: null,
    evidenceNote: 'your profile could not be read, so this excerpt could not be re-verified and is not shown as a quote',
    evidenceSearch: null,
  },
  // THE OLD-PAYLOAD ROW. No evidenceState, no evidenceNote, no evidence — exactly what an API that
  // has not deployed yet returns. It must render as "not checked for evidence" and never crash.
  {
    id: 'r6', seq: 6, kind: 'responsibility', kind_source: 'category',
    item_text: 'Coach product managers', verbatim: null, match_method: 'unlocatable',
    competency: 'people', model_keyword: 'coaching',
  },
  // An evidenced row whose SOURCE RECORD has since been edited: the quote still holds, the ranking
  // does not, and the row must say so without withdrawing the quote.
  {
    id: 'r7', seq: 7, kind: 'must_have', kind_source: 'posting_required_marker',
    item_text: 'P&L ownership', verbatim: 'P&L ownership', char_start: 300, char_end: 313,
    match_method: 'exact', competency: 'finance', model_keyword: 'P&L',
    evidenced: true, evidenceState: 'verified', evidenceNote: null, evidenceSearch: null,
    evidence: {
      quote: 'Carried a 40M P&L', sourceKind: 'brag doc', sourceLabel: 'Brag doc',
      sourceKey: 'brag', charStart: 4, charEnd: 22,
      extra: 'proposed by the model from an adjacent line', ratio: 0.7, method: 'llm',
      recordChanged: true,
    },
  },
]

const req = {
  total: requirements.length,
  requirements,
  evidenced: requirements.filter((r) => r.evidenced).length,
  unevidenced: requirements.filter((r) => !r.evidenced).length,
  postingChars: 4200,
  stale: false,
}

function Probe() {
  return (
    <div style={{ padding: 16, maxWidth: 900 }}>
      <PostingAnalysisCard
        req={req} reqError={null} reloadReq={() => {}}
        coveredKw={[]} missingKw={[]} gapsScoredAt={null}
        onParse={() => {}} parseBusy={false} hasSummary
        keywordScore={null} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Probe />)
