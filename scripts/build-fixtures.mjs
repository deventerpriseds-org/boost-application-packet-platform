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
const swaps = raw.swaps || []

/**
 * The checks-result payload, assembled per artifact from the FLAT `checks` + `gates` tables the
 * dump carries — the shape fixture-refresh.yml produces.
 *
 * `engines` is grouped HERE rather than left to the client, because that is what the real endpoint
 * does (P4.2 made engines.deterministic/reviewer a top-level part of the payload precisely so a
 * client stops re-partitioning a set the server already split). A fixture that omits it silently
 * exercises assetGate.js's PRE-P4 fallback branch instead of the path production actually takes.
 *
 * `gate` comes from the artifact_gate row and is `null` when there is none — never invented. An
 * artifact with no gate row has not been checked, and that is the absence of a verdict rather than
 * permission; a fixture that defaulted it to 'pass' would make every screen render the one state
 * the product exists to refuse.
 */
function checkResultFor(artifactId) {
  const rows = (raw.checks || []).filter((c) => c.artifact_id === artifactId)
  const gate = (raw.gates || []).find((g) => g.artifact_id === artifactId) || null
  return {
    gate: gate ? gate.gate : null,
    attention: gate ? gate.attention_count : 0,
    results: rows,
    engines: {
      deterministic: { results: rows.filter((r) => r.engine !== 'reviewer') },
      reviewer: { results: rows.filter((r) => r.engine === 'reviewer') },
    },
    override: gate && gate.override_by
      ? { by: gate.override_by, at: gate.override_at, reason: gate.override_reason }
      : null,
    corrections: (raw.corrections || []).filter((c) => c.artifact_id === artifactId),
  }
}
const checkResults = raw.checkResults ||
  Object.fromEntries((raw.artifacts || []).map((a) => [a.id, checkResultFor(a.id)]))

// TRAP 3, the same shape as trap 2 and found the same way - by rendering. The artifact rows were
// being passed through RAW (`doc_url`, `drive_url`, `template_id`, `updated_at`), but the real
// endpoint SHAPES them: `appPackets.ts:207` maps every artifact to
// `{ id, type, status, templateId, docUrl, driveUrl, content, updatedAt }`. `PacketBuilder.jsx:236`
// renders the `✓ Open Google Doc ↗` / `✓ Open Slides ↗` / `Copy tracked link` row behind
// `a.docUrl ? … : …`, so with the snake_case key that whole row is CONDITIONALLY HIDDEN and a
// measurement reports three built controls as missing. Measured 2026-08-30 during RENDER-SWEEP:
// SPEC 4.4-5/6/7/8 all read as not-rendered against a fixture whose artifacts carried a perfectly
// good `doc_url`. Mapping mechanically here, from the endpoint's own projection.
const artifactShape = (rows) => (rows || []).map((a) => ({
  id: a.id, type: a.type, status: a.status,
  templateId: a.templateId ?? a.template_id,
  docUrl: a.docUrl ?? a.doc_url,
  driveUrl: a.driveUrl ?? a.drive_url,
  content: a.content,
  updatedAt: a.updatedAt ?? a.updated_at,
}))

const f = {}
// FLAT - see trap 2.
f[`/opportunity/${OPP}/packet`] = {
  company: opp.company, role: opp.role, pkg: pk.pkg_json ?? null,
  id: pk.id, oppId: pk.opp_id, status: pk.status, round: pk.round,
  jdAnalyzed: pk.jd_analyzed, feedback: pk.feedback || [],
  coveredKw: pk.covered_kw || [], missingKw: opp.ats_gaps || [],
  atsScore: pk.ats_score, mustHaves: pk.must_haves || [], artifacts: artifactShape(artifacts),
}
// TRAP 4, same class as traps 2 and 3, found the same way. The real endpoint
// (`appRequirements.ts:704`) returns `{ ..., total: rows.length, located, requirements }`, and
// `total` is LOAD-BEARING on the client: `meterModel` (`assetBlocks.js:883`) gates the whole
// measured branch on `Number.isFinite(Number(requirements.total))`, so with `total` absent it
// takes the else branch and prints "This posting has no requirement rows yet ... unknown - not
// zero" — for a fixture carrying 21 perfectly good requirement rows. Everything in that branch
// disappears with it, INCLUDING the three per-kind stats `REQ_KIND_STATS` (`Must-haves answered`
// / `Responsibilities answered` / `Nice-to-haves answered`, SPEC 4.4-24/25/26). Measured
// 2026-08-30 during RENDER-SWEEP: those three read as not-built until `total` was supplied.
// Derived mechanically from the rows, exactly as the endpoint derives it.
f[`/opportunity/${OPP}/requirements`] = {
  oppId: OPP,
  requirements,
  total: requirements.length,
  located: requirements.filter((r) => r.char_start !== null && r.char_start !== undefined).length,
}
f[`/opportunity/${OPP}`] = { opportunity: { ...opp, id: OPP, stage: pk.status } }
f['/app/opportunities'] = { opportunities: [{ ...opp, id: OPP, stage: pk.status }] }
f['/app/packets'] = { packets: [{ id: pk.id, oppId: OPP, ...opp, status: pk.status }] }
// THE OWNER'S CHECK THRESHOLDS, and they are NOT optional decoration.
//
// This line used to read `{ prefs: {} }` with no `checks` key at all, and that single omission is
// why a session on 2026-08-29 told the owner the 24/20 skill character limits had been "removed
// from the app's code and/or pipeline" - a catastrophe report about a defect that did not exist.
// `AssetBlocks.jsx:1158` reads thresholds from `searchPrefsGet().checks`; with no `checks` the
// value is null, `targetFor()` (assetBlocks.js:1036) returns null for EVERY merge field, and all
// 24 thresholds silently render as unset. The rule label degrades from
// `longest 22 chars - <= 24 chars each` to `7 lines - 18 words`, which reads exactly like the
// product having lost its limits. Confirmed live the same day:
// `select chk_skill_max_chars, chk_relevant_max_chars from owner_search_prefs` -> 24, 20.
//
// So the fixture MUST carry them, and their absence is fatal below rather than cosmetic.
// NOTE the key: `raw.checkPrefs`/`raw.thresholds`, NEVER `raw.checks` — `raw.checks` is already
// the flat per-artifact check RESULT rows (see `checkResultFor` above). Reaching for it here would
// hand the UI a list of results where it expects a thresholds object, which is the same shape of
// silent-garbage bug this whole guard exists to stop. Caught while writing this fix.
//
// The dump carries the raw `owner_search_prefs` row (`chk_skill_max_chars`, …); the client wants
// the camelCase shape `checkPrefs.ts:175` builds (`skillMaxChars`, …). Mapped MECHANICALLY by the
// naming convention rather than by a hand-maintained key list, so a threshold added to the table
// tomorrow reaches the fixture without anyone remembering to edit this file.
//
// KNOWN LIMIT, stated rather than hidden: paired bands stored as two columns
// (`chk_about_me1_words_min`/`_max`) arrive as `aboutMe1WordsMin`/`Max`, not as the `[45, 48]`
// tuple the app reads. The single-value thresholds — every char limit, every count — are exact.
const camel = (s) => s.replace(/^chk_/, '').replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
const checkPrefs = raw.checkPrefs
  ? Object.fromEntries(Object.entries(raw.checkPrefs)
      .filter(([k]) => k.startsWith('chk_'))
      .map(([k, v]) => [camel(k), v]))
  : null
f['/search-prefs'] = { prefs: raw.prefs || {}, checks: checkPrefs }
f['/swaps'] = { swaps }

for (const a of artifacts) {
  const mine = insertions.filter((i) => i.artifact_id === a.id)
  f[`/artifact/${a.id}/insertions`] = { insertions: mine, loop: Math.max(0, ...mine.map((i) => i.loop || 0)) }
  f[`/artifact/${a.id}/corrections`] = { corrections: corrections.filter((c) => c.artifact_id === a.id) }
  f[`/artifact/${a.id}/checks-result`] = checkResults[a.id] ||
    // An ABSENT gate, never a fabricated pass - the same rule the product itself follows.
    { gate: null, attention: 0, results: [], corrections: corrections.filter((c) => c.artifact_id === a.id) }
}

// A THIN FIXTURE SET INFLATES THE GAP AND READS AS PRODUCT REGRESSION.
//
// THIS USED TO BE A WARNING AND THAT WAS NOT ENOUGH. On 2026-08-29 a session read
// `!!! THIN FIXTURE SET - the next gap number will be INFLATED` on its own terminal, proceeded
// anyway, and reported three separate "the app is missing X" findings to the owner. All three were
// the fixture. An advisory warning on a MEASURING INSTRUMENT is worth nothing, because the whole
// failure mode is an agent that already believes its number. So: an instrument that cannot measure
// now REFUSES TO EMIT A NUMBER.
//
// `--allow-thin` is the deliberate escape hatch (a quick smoke render where no gap will be
// counted). It must be typed on purpose, and it prints what is missing anyway.
const thin = []
if (!requirements.length) thin.push('requirements (drives "Posting lines answered", coverage cards)')
if (!(raw.checks || []).length && !raw.checkResults) thin.push('checkResults (drives the whole Checks tab and every gate word)')
if (!swaps.length) thin.push('swaps (drives the Swaps tab, and every `orig -> final` row)')
// The one that cost the most. See the `/search-prefs` comment above.
if (!f['/search-prefs'].checks) thin.push('checks thresholds (drives EVERY rule label: `<= 24 chars each`, word bands, the gate)')
if (thin.length) {
  const how = process.argv.includes('--allow-thin')
  console.error(`\n!!! THIN FIXTURE SET - a gap number measured against this file measures the FILE, not the app:`)
  for (const t of thin) console.error('    missing: ' + t)
  console.error('    Pull these from the live DB via fixture-refresh.yml (or db-query.yml) first.')
  if (!how) {
    console.error('\n    REFUSING TO WRITE A FIXTURE THAT WILL BE MISREAD AS A MEASUREMENT.')
    console.error('    Pass --allow-thin ONLY for a smoke render where you will count nothing.\n')
    process.exit(1)
  }
  console.error('\n    --allow-thin given: written anyway. DO NOT report a gap count from this file.\n')
}

await writeFile(resolve(OUT), JSON.stringify(f, null, 1))
console.log(`wrote ${Object.keys(f).length} route keys -> ${OUT}`)
console.log(`  ${opp.company} · ${opp.role} | ${artifacts.length} artifacts, ${insertions.length} insertions`)

