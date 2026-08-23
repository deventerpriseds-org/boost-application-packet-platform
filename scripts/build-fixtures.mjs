#!/usr/bin/env node
// Build the ROUTE-KEYED fixture file that render-app.mjs / compare-ui.mjs need, from a raw
// data dump pulled out of the production DB via db-query.yml.
//
// WHY THIS EXISTS. The route-keyed file used to live only in the session scratchpad. A container
// restore took it, and the next measurement silently reported a WORSE gap number (193/26 vs the
// recorded 146/15) because every app-side panel was missing - the app was rendering
// "No packets yet." with a 612-char body. Nothing errored. A measurement instrument that degrades
// silently and reports the degradation as product regression is the worst failure mode available,
// so the builder is now in the repo and the fixture file is committed beside it.
//
// TWO TRAPS, both of which cost a measurement:
//
// 1. FIXTURE KEYS ARE MATCHED AS URL SUBSTRINGS, longest-match-wins. So a key "packet" matches
//    /api/app/packetS and serves a SINGLE packet object where the client expects a LIST - which
//    renders as "No packets yet.", i.e. exactly like real empty data. Keys must be route paths.
// 2. GET /app/opportunity/{id}/packet RETURNS THE PACKET FLAT, not wrapped: appPackets.ts:219 is
//    `{ company, role, pkg, ...packetShape(pkt, artifacts, opp) }`. Wrapping it in { packet: ... }
//    renders a header with a blank company and an empty body - again, indistinguishable from real
//    empty data. Verified by reading the handler, not by guessing from the client.
//
// USAGE
//   node scripts/build-fixtures.mjs --raw <dump.json> --opp <oppId> --out docs/qc-evidence/fixtures.json
//
// The raw dump is { packet, opp, artifacts[], insertions[], corrections[], requirements[],
// checkResults{artifactId: payload}, swaps[] }. The last three are what make the difference between
// a thin fixture set and one that exercises the real screens - see the WARNING printed below.

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d }
const RAW = arg('raw', ''), OPP = arg('opp', ''), OUT = arg('out', 'docs/qc-evidence/fixtures.json')
if (!RAW || !OPP) { console.error('need --raw <dump.json> --opp <oppId>'); process.exit(2) }

const raw = JSON.parse(await readFile(resolve(RAW), 'utf8'))
const { packet: pk, opp, artifacts = [], insertions = [], corrections = [] } = raw
const requirements = raw.requirements || []
const checkResults = raw.checkResults || {}
const swaps = raw.swaps || []

const f = {}
// FLAT - see trap 2.
f[`/opportunity/${OPP}/packet`] = {
  company: opp.company, role: opp.role, pkg: pk.pkg_json ?? null,
  id: pk.id, oppId: pk.opp_id, status: pk.status, round: pk.round,
  jdAnalyzed: pk.jd_analyzed, feedback: pk.feedback || [],
  coveredKw: pk.covered_kw || [], missingKw: opp.ats_gaps || [],
  atsScore: pk.ats_score, mustHaves: pk.must_haves || [], artifacts,
}
f[`/opportunity/${OPP}/requirements`] = { requirements }
f[`/opportunity/${OPP}`] = { opportunity: { ...opp, id: OPP, stage: pk.status } }
f['/app/opportunities'] = { opportunities: [{ ...opp, id: OPP, stage: pk.status }] }
f['/app/packets'] = { packets: [{ id: pk.id, oppId: OPP, ...opp, status: pk.status }] }
f['/search-prefs'] = { prefs: {} }
f['/swaps'] = { swaps }

for (const a of artifacts) {
  const mine = insertions.filter((i) => i.artifact_id === a.id)
  f[`/artifact/${a.id}/insertions`] = { insertions: mine, loop: Math.max(0, ...mine.map((i) => i.loop || 0)) }
  f[`/artifact/${a.id}/corrections`] = { corrections: corrections.filter((c) => c.artifact_id === a.id) }
  f[`/artifact/${a.id}/checks-result`] = checkResults[a.id] ||
    // An ABSENT gate, never a fabricated pass - the same rule the product itself follows.
    { gate: null, attention: 0, results: [], corrections: corrections.filter((c) => c.artifact_id === a.id) }
}

await writeFile(resolve(OUT), JSON.stringify(f, null, 1))
console.log(`wrote ${Object.keys(f).length} route keys -> ${OUT}`)
console.log(`  ${opp.company} · ${opp.role} | ${artifacts.length} artifacts, ${insertions.length} insertions`)

// A THIN FIXTURE SET INFLATES THE GAP AND READS AS PRODUCT REGRESSION. Say so loudly rather than
// letting the next comparison quietly measure the fixture instead of the app.
const thin = []
if (!requirements.length) thin.push('requirements (drives "Posting lines answered", coverage cards)')
if (!Object.keys(checkResults).length) thin.push('checkResults (drives the whole Checks tab and every gate word)')
if (!swaps.length) thin.push('swaps (drives the Swaps tab)')
if (thin.length) {
  console.log('\n!!! THIN FIXTURE SET - the next gap number will be INFLATED and NOT comparable:')
  for (const t of thin) console.log('    missing: ' + t)
  console.log('    Pull these from the live DB via db-query.yml before trusting a measurement.')
}
