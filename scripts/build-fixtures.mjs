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
  // `score` and `history` are TWO DIFFERENT QUESTIONS and the route answers them differently, so
  // they are read from two different dump keys rather than sliced out of one.
  //
  // `score` is the gate's run and nothing else - `select * from artifact_score where artifact_id=$1
  // and run_id=$2`, null when there is no gate row. The dump's `scores` array is already scoped
  // that way by the join in fixture-refresh.yml, so `find` here can only match the right row.
  //
  // `history` is EVERY run, newest first, capped at ten - and it is returned even for an artifact
  // with no gate. `artifact_id` rides along on each history row only so this line can route it; the
  // real route projects four columns and it is stripped back to four here, because a fixture that
  // carries MORE than the route does is a parity defect in the other direction - it would let a
  // panel render locally off a field production never sends.
  //
  // WHY THIS MATTERS AT ALL: with `score` absent the drawer's Match tab renders "No score has been
  // computed for this asset yet - the checks have not been run" on an asset the gate simultaneously
  // calls Blocked with 86 findings (AssetGateDrawer.jsx MatchTab, `if (!s) return <Quiet>...`). Two
  // statements that cannot both be true, and the reader files it as a product defect. It is not
  // one - it was this file never setting the key. docs/qc-evidence/PROTOTYPE-COVERAGE.md 17f.
  const score = (raw.scores || []).find((s) => s.artifact_id === artifactId) || null
  const history = (raw.scoreHistory || [])
    .filter((h) => h.artifact_id === artifactId)
    .map(({ composite, band, must_have_coverage, computed_at }) =>
      ({ composite, band, must_have_coverage, computed_at }))
  return {
    gate: gate ? gate.gate : null,
    attention: gate ? gate.attention_count : 0,
    score,
    history,
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
//
// TRAP 5, and the one that cost the most: `comparison` CANNOT BE DERIVED HERE AT ALL.
// `comparisonPayload` (appDimensions.ts:254) returns `dimensions` from the `comparison_dimension`
// table PLUS `summary`, `set` and `stale`, each derived in TypeScript from DIMENSION_CATALOGUE,
// the owner's dimension prefs and DIMENSION_VERSION. Porting that here would be a second dimension
// brain in JS, and a re-derived fixture MEASURES ITSELF -- drift renders as app gaps, which is the
// canary's own failure mode pushed one level deeper where it cannot see, because a wrong `summary`
// is present and truthy. So when the refresh captured the real route, that body is passed through
// VERBATIM and nothing here reshapes it.
if (raw.apiRequirements) {
  f[`/opportunity/${OPP}/requirements`] = raw.apiRequirements
} else {
  // The derived shape is the FALLBACK, and it is loud, because its silent version is exactly how
  // ~19 of 27 "missing panels" on the jd step stayed phantom for weeks
  // (docs/qc-evidence/PROTOTYPE-COVERAGE.md 16a). A quiet degradation of the instrument is
  // indistinguishable from a product regression.
  console.error('!!! DERIVED /requirements - comparison will be MISSING from this fixture.')
  console.error('    The dump has no `apiRequirements`. Re-run fixture-refresh.yml, which captures')
  console.error('    the real route; a fixture built this way cannot see the compare surface and')
  console.error('    the canary in scripts/lib/fixture-canary.mjs will refuse it.')
  f[`/opportunity/${OPP}/requirements`] = {
    oppId: OPP,
    requirements,
    total: requirements.length,
    located: requirements.filter((r) => r.char_start !== null && r.char_start !== undefined).length,
  }
}
// 3. GET /app/opportunity/{id} RETURNS THE OPPORTUNITY FLAT AND camelCASED, not wrapped and not
//    the raw row: appOpportunities.ts:142 is `{ ...rowToOpp(opp), contacts }`. This line used to
//    emit `{ opportunity: { ...opp } }` -- the raw snake_case DB row inside an envelope the API
//    does not use -- so `opp?.jdSummary` was undefined in PacketBuilder.jsx:852 and the ENTIRE
//    "Extracted from this posting" panel fell back to "No posting text and no summary are stored
//    for this opportunity." Every render pass over the `jd` step was therefore judging a DEGRADED
//    page, and PROTOTYPE-COVERAGE row 4.1-12 claims it was "confirmed in both source and
//    screenshot" -- the screenshot could not have shown it. Same class as the missing `comparison`:
//    a fixture that does not match what the app consumes reports the app as missing things.
//    The field list below is rowToOpp's, read from the source rather than recalled.
const rowToOpp = (r) => ({
  id: r.id, company: r.company, logo: r.logo_url, role: r.role, location: r.location,
  comp: r.comp_range, match: r.match_score, atsScore: r.ats_score ?? null, fit: r.fit,
  urgency: r.urgency, source: r.source, why: r.why_surfaced, hm: r.hiring_manager,
  recruiter: r.recruiter, rolesFor: r.roles_for, stage: r.stage, personaKey: r.persona_key,
  dismissed: r.dismissed, isFavorite: !!r.is_favorite, tier: r.title_tier,
  matchedGroup: r.matched_group, matchedRole: r.matched_role,
  matchedVariation: r.matched_variation, baseScore: r.base_score, signals: r.company_signals,
  pain: r.pain_hypotheses, isDemo: r.is_demo, createdAt: r.created_at, sourceDate: r.source_date,
  jdTitle: r.jd_title, jdCompany: r.jd_company, jdSummary: r.jd_summary,
  jdRequirements: r.jd_requirements, jdTable: r.jd_table,
})
// THE ENDPOINTS ANOTHER LANE ADDED WHILE THIS FILE WAS NOT LOOKING. Measured 2026-09-03 by
// `compare-ui --all`: FOUR unmatched `/artifact/{id}/remediation` calls and one `/skill-bank`,
// with the qc step rendering 72,477 FEWER characters than its previous recorded run -- which
// reads as the APP having lost most of the QC surface. It had not; the instrument had.
// Captured, never derived, for the reason in the block below.
if (raw.apiRemediation) {
  for (const [aid, body] of Object.entries(raw.apiRemediation)) f[`/artifact/${aid}/remediation`] = body
}
if (raw.apiSkillBank) f['/skill-bank'] = raw.apiSkillBank
if (raw.apiPacketAnalysis && raw.apiPacketAnalysis.id) {
  f[`/packet/${raw.apiPacketAnalysis.id}/analysis`] = raw.apiPacketAnalysis.body
}
if (raw.apiConfigTemplates) f['/config/templates'] = raw.apiConfigTemplates

if (raw.apiOpportunity) {
  f[`/opportunity/${OPP}`] = raw.apiOpportunity
} else {
  console.error('!!! DERIVED /opportunity - rowToOpp is applied locally, not captured.')
  console.error('    Re-run fixture-refresh.yml to capture the real response. Derived is')
  console.error('    correct only while rowToOpp is unchanged; capture cannot go stale.')
  f[`/opportunity/${OPP}`] = { ...rowToOpp({ ...opp, id: OPP, stage: pk.status }), contacts: [] }
}
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
    // `score: null` / `history: []` for the same reason the route sends them: "no score" and "the
    // key was never populated" are different states and the UI can only tell them apart if they
    // differ on the wire.
    { gate: null, attention: 0, score: null, history: [], results: [], corrections: corrections.filter((c) => c.artifact_id === a.id) }
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

// ── THE SAME REFUSAL, EXTENDED TO THE TWO WAYS THE CHECKS PAYLOAD CAN LIE ────────────────────────
//
// This block is the instrument's "refuse to emit a number it cannot stand behind" gate, so both of
// these belong IN it rather than in a second guard beside it. Both are measured, not hypothetical -
// docs/qc-evidence/PROTOTYPE-COVERAGE.md 17d and 17f, and both are present in the fixtures.json
// committed beside this file (168 result rows carrying 19 findings; `score` absent on all five
// artifacts).
//
// 1. THE SCORE IS ABSENT. The live route returns `score` and `history` on every /checks-result
//    (appChecks.ts artifactChecksGet). Without them the drawer's Match tab says "No score has been
//    computed for this asset yet - the checks have not been run" about an asset the gate in the SAME
//    payload calls Blocked. That is a quiet, plausible, correct-looking lie, which is exactly the
//    class of fixture starvation this whole file exists to refuse.
//
//    AN ARTIFACT WITH NO GATE IS EXEMPT and always will be: the route itself returns
//    `const score = g ? (query) : null`, so no gate legitimately means no score. A packet of
//    un-checked artifacts must not trip this.
//
//    TIGHTENED 2026-09-02 from "not ONE gated artifact has a score" to "EVERY gated artifact has
//    one", after an independent verifier pointed out the partial case slipped through: 3 of 4 scored
//    and one silently starved would have passed. I nearly rejected that on the theory that a gated
//    artifact can legitimately lack a score row and tightening would cry wolf -- then checked
//    production instead of theorising. Packet 85cee965, read live: all FOUR gated artifacts carry a
//    score row (three with a null composite, one with 89), and only the un-gated `video` artifact
//    has none. So the strict form matches production exactly and the loose form was hiding a hole.
//    A gated artifact with no score row means the dump was taken mid-write, which is precisely the
//    starvation this file refuses.
const gated = artifacts.filter((a) => (f[`/artifact/${a.id}/checks-result`] || {}).gate)
const unscored = gated.filter((a) => !f[`/artifact/${a.id}/checks-result`].score)
if (gated.length && unscored.length) {
  thin.push(`artifact_score missing on ${unscored.length} of ${gated.length} GATED artifact(s) `
    + `(${unscored.map((a) => a.id.slice(0, 8)).join(', ')}) - it drives the drawer's whole Match `
    + 'tab, and without it a checked asset reads "No score has been computed for this asset yet" '
    + 'while the gate in the SAME payload calls it Blocked')
}
// 2. THE CHECKS ARE NOT SCOPED TO THE GATE'S RUN. A dump taken from a fixture-refresh.yml without
//    the run_id join carries the artifact's WHOLE history - measured live 2026-09-02: 271 rows
//    across 26 distinct check_key for artifact cfdd82e7, where the route sends 25. The signature is
//    unmistakable and needs no access to the DB: a check_key appearing TWICE for one artifact. The
//    route orders by check_key over a single run, so a duplicate is impossible in production.
//
//    This is an over-supply rather than an absence, so it is reported in its own words - but it is
//    refused by the same mechanism, because the consequence is identical: a count read off it is a
//    claim about the file. `screens/app-send.png` reads "112 items to fix" where live reads "14".
for (const a of artifacts) {
  const keys = (f[`/artifact/${a.id}/checks-result`].results || []).map((r) => r.check_key)
  const dup = keys.find((k, i) => keys.indexOf(k) !== i)
  if (dup === undefined) continue
  thin.push(`checks scoped to the gate's run - artifact ${a.id} carries ${keys.length} result rows `
    + `for ${new Set(keys).size} distinct check_key (e.g. "${dup}" more than once). The dump was `
    + `taken WITHOUT the run_id join in fixture-refresh.yml, so it is every historical run at once; `
    + `every rule repeats and the "items to fix" count is inflated`)
  break
}
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

