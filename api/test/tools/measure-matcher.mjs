// OFFLINE REPRODUCTION of the live evidence resolver, for calibrating the matcher without a
// database. Verified 2026-08-23: reproduces ALL 12 refusal reasons that production reported for
// eMoney 2cb56fb3 (job 97137243552) exactly — numeric, list_element_unsupported, below_threshold,
// missing_specific_token, no_candidate. The sandbox cannot reach Postgres or the Function App, so
// this is the only fast loop available; use it before proposing any threshold or fold change.
//
//   node api/test/tools/measure-matcher.mjs
//
// Fixtures are the REAL requirement verbatims and the REAL `closestExcerpt` the live resolver
// picked from the owner's profile — not invented text.
import fs from 'node:fs'
import { supportIn, claimTokens, tokensOf, sameWord } from '../../dist/functions/tests/requirementSupport.js'
import { DEFAULT_THRESHOLDS as T } from '../../dist/functions/tests/checks.js'

const pairs = JSON.parse(fs.readFileSync(new URL('./emoney-musthave-pairs.json', import.meta.url), 'utf8'))
console.log(`threshold=${T.evidenceThreshold} minTokens=${T.evidenceMinTokens}\n`)
let agree = 0
for (const p of pairs) {
  const r = supportIn({
    requirement: p.req, recordText: p.excerpt, threshold: T.evidenceThreshold,
    maxSentences: T.evidenceMaxSentences, bulletRunMax: T.evidenceBulletRun,
    minQuoteChars: 8, minQuoteWords: 3, distinctiveLen: 6,
  })
  const want = claimTokens(p.req)
  const have = new Set(tokensOf(p.excerpt).map(x => x.t))
  const carried = want.filter(t => have.has(t) || [...have].some(h => sameWord(t, h)))
  const local = r.reason || 'MATCH'
  if (local === p.liveReason) agree++
  console.log(`seq ${p.seq}  live=${p.liveReason}  local=${local}  ratio=${carried.length}/${want.length}`)
  console.log(`   missing: ${want.filter(t => !carried.includes(t)).join(', ')}`)
}
console.log(`\nlocal matches live for ${agree}/${pairs.length} requirements`)
