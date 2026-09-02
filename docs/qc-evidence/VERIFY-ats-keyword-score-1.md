# WHAT:       Verification results for the interim keyword score (atsKeywords.ts -> appChecks.ts),
#             loop 1, per docs/qc-evidence/BRIEF-verify-ats-keyword-score.md.
# WHY:        TIER 1 change (produces a score component the composite depends on) that was deployed
#             on self-report alone.
# SUPERSEDES: nothing.
# SUPERSEDED-BY: nothing -- current.
# EVIDENCE:   this file. Repo /home/user/boost-application-packet-platform, branch
#             claude/incumbent-wins-swap. Verified at commit 956dee6 / 9cbf394 / 0c3721e / 9503799
#             (the commits named in the brief); the branch moved forward to f10663c during this pass
#             under a concurrent session -- noted below, does not change any verdict.

# VERIFY ats-keyword-score — loop 1

## Process note: this is a shared, actively-moving branch

`claude/incumbent-wins-swap` had a different session committing to it concurrently during this
verification. Mid-pass, `git status` showed uncommitted edits to `appPackets.ts`, `checkPrefs.ts`,
`checks.ts` that were not mine (a `reviewerAuto` threshold, unrelated to this brief); those later
landed as commit `f10663c` ("Give the reviewer a caller — the last thing between here and a
composite"), not part of what this brief asks to verify. None of the files this brief covers
(`atsKeywords.ts`, `appChecks.ts`'s interim-score block, `artifactScore.ts`, the composite formula in
`appReviewer.ts`) were touched by that commit — confirmed by diff — so no verdict below is affected.

**This DID cause one real methodological problem, caught and corrected.** `scripts/mutate.sh`'s
test-cmd shells out to the full `npm test` (~9-11s). Run against this shared checkout, that window is
long enough for the concurrent session's own build/test activity to race the mutation and produce a
false verdict. Measured directly: mutating the `<th>` header-skip in `atsKeywords.ts` and running it
through `mutate.sh` reported **INERT**. Immediately re-running the identical mutation with output
captured directly (`npm test > out.txt`, grep the TAP output myself, no other tool in between)
reported **`not ok 36 - H:ats-header-row-is-not-a-keyword`** — the guard fires correctly. The first
result was a race artifact, not a finding. Every mutation verdict below was obtained (or re-obtained)
with this direct, immediate-capture method, and the composite-formula finding (C9) was independently
reproduced this way from a clean start, so it is not the same artifact.

## Cheap suite re-run covering EVERYTHING (C1)

```
cd api && npm test   -> 1046 pass, 0 fail, 0 skip, 0 todo   (at 956dee6, the brief's HEAD)
cd app && npm test   -> 427 pass, 0 fail, 0 skip, 0 todo
```
Re-run again at current HEAD (`f10663c`, after the concurrent commit landed): `api` 1050 pass / 0
fail (4 new tests from the unrelated concurrent commit), `app` 427 pass / 0 fail. No regression
anywhere in either run.

**C1: CONFIRMED.** The implementer's 1046/427 figures are exact, and pass/fail/skip are reported
separately as asked — no skips anywhere, so there is no collapsed-skip risk here.

## Claims C2–C8: the pure keyword-scoring functions

All probed independently against the built `dist/functions/tests/atsKeywords.js` /
`artifactScore.js`, with adversarial inputs of my own in addition to the shipped fixture and
hardening tests.

**C2: CONFIRMED.** `parseAtsKeywords(LIVE_TABLE)` returns exactly the 9 real keywords (no header, no
duplicates); `atsCoverage(LIVE_TABLE, SHIPPED)` returns `covered: 6, total: 9`. Reproduced directly,
independent of the shipped test file.

**C3: CONFIRMED.** Every cell in column 2 of `LIVE_TABLE` reads `"Missing"`; the numerator (6) comes
only from matching column-1 keywords against `SHIPPED` text. Attempted to construct an input where
column 2 leaks in — `atsCoverage` never reads column 2 at all (`parseAtsKeywords` only ever captures
`first` = the first `<td>`, i.e. column 1); there is no code path for column 2 to reach the numerator.

**C4: CONFIRMED, as literally stated — with a residual risk found by attacking it further.** The
shipped `mixedHeader` case (`<th>` in one cell, `<td>` in the others of the same row) correctly drops
the whole row, reproduced independently. **But a header row with ZERO `<th>` tags — all `<td>`, e.g.
a model rendering the header as `<td><b>ATS Optimized Keywords</b></td>...` — is NOT excluded**: the
skip test is `/<th[\s>]/i.test(tr)`, and with no `<th>` present at all, `first` matches the header's
own first `<td>` and its label enters the keyword list, inflating the denominator by one entry that
can never be covered. This is outside the letter of C4 (which named the mixed case specifically) but
inside the spirit of the file's own invariant ("the header row IS REAL AND MUST BE DROPPED", stated
unconditionally). Not a synthetic worst case — LLM table output regularly omits `<th>` semantics
entirely. **Recommend**: also skip a row whose only column-1 candidate case-insensitively matches the
posting's own header wording, or drop the first row structurally when zero `<th>` appear anywhere in
the table (safe because a real all-`<td>` keyword table would then have no header to lose).

**C5: CONFIRMED.** No table, empty body, unparseable body, and no shipped text all return
`covered: null, total: null` with a reason string, never `0`. `computeArtifactScore` with
`keyword: null` returns `composite: null`, never a partial number. Reproduced directly.

**C6: REFUTED as worded ("matching is whole-phrase") — the shipped hardening tests pass, but the
claim itself is false, and I found real false positives on request.** `keywordPresent` is
documented in its own header as "WHOLE-PHRASE... AND NOTHING CLEVERER," but the implementation is an
unguarded case/whitespace-normalised **substring** test (`norm(shipped).includes(k)`), with no word
boundary. The shipped tests only probe phrase-level near-misses between multi-word keywords sharing a
word (`Leadership Experience` vs `Engineering Leadership`) — never a short keyword that is a literal
prefix of a longer word in the shipped text. Constructed directly:
```
keywordPresent('Cloud',   'We use Cloudera for data warehousing')      -> true   (false positive)
keywordPresent('Program', 'Extensive Programming experience')          -> true   (false positive)
keywordPresent('Manage',  'Strong Management background')              -> true   (false positive)
keywordPresent('Lead',    'Leadership')                                -> true   (false positive)
keywordPresent('Test',    'Automated Testing pipeline')                -> true   (false positive)
```
Nothing in the current keyword table or the owner's prompt guarantees every ATS keyword is a
multi-word phrase — real ATS lists commonly include single terms ("Agile", "Python", "Cloud"). The
error direction is exactly the one the file's own rules forbid: it INFLATES the number a reviewer
trusts most. This does not require an unusual input; it is live risk on ordinary short keywords.
**Recommend**: match on a word boundary (`\b`) rather than raw substring, or split both sides into
tokens and require the full token sequence.

**C7: CONFIRMED.** Read directly in `appChecks.ts`: `keyword: scoreable > 0 ? {covered: null,
scoreable} : interimKw ? {...} : null` is a strict either/or — the library branch is taken whenever
`scoreable > 0`, and the interim branch is only ever reached in the `scoreable === 0` case. There is
no arithmetic anywhere that combines the two. `atsCoverageSource` never emits "library term" wording,
and `computeArtifactScore`'s own default wording only fires on the library-input shape (`scoreable`
without `source`), so a caller-supplied interim source (which always sets `source`) is never
overwritten. Confirmed with a source string round-trip: `s.keyword_coverage.source` equals the
interim `atsCoverageSource(cov)` string verbatim when the library path is not taken.

**C8: CONFIRMED.** `ATS_SHIPPED_FIELDS` is `['SkillsBullets1','SkillsBullets2','ExpertiseBullets',
'RelevantBullets1','RelevantBullets2','RelevantBullets3']` — `ResumeSummary` and `CoverLetterBody`
are absent, verified directly against the exported constant.

## C9 — the composite-formula duplicate: REFUTED, mutation-confirmed genuinely INERT

**This is the finding the brief predicted ("the one the implementer is most likely wrong about").**

`H:one-composite-formula` (`hardening.test.mjs:5145`) tries to keep `appReviewer.ts:309`'s inline
weighted sum in agreement with `computeArtifactScore`'s. It does so by (a) regex-extracting the three
`?? 0.x` weight literals from the reviewer's source text, in the order they appear, and asserting
that array equals `[DEFAULT_WEIGHTS.mustHave, DEFAULT_WEIGHTS.keyword, DEFAULT_WEIGHTS.seniority]`,
and (b) a worked-example call to `computeArtifactScore` alone (never to the reviewer's own code path).

**Attack: swap which score component receives which weight, leaving the three numeric literals in
the same textual order.**
```diff
-  ? Math.round(s.must_have_coverage * (s.weights?.mustHave ?? 0.5)
-             + s.keyword_coverage * (s.weights?.keyword ?? 0.3)
+  ? Math.round(s.must_have_coverage * (s.weights?.keyword ?? 0.5)
+             + s.keyword_coverage * (s.weights?.mustHave ?? 0.3)
               + recomputed.seniority_alignment.value! * (s.weights?.seniority ?? 0.2))
```
This is a real, non-equivalent defect: whenever `must_have_coverage != keyword_coverage` (the normal
case), it weights the wrong component 0.5 and the other 0.3, producing a materially different
composite than `computeArtifactScore` would for the same inputs — the exact drift the guard exists to
prevent, and the exact failure mode the brief asked me to attack ("is asserting agreement
sufficient?").

Reproduced twice, independently, both with full-suite output captured directly (no `mutate.sh`, to
rule out the race noted above):
```
cd api && npm test > out.txt 2>&1   # mutation applied, full 1050-test suite run
grep -n "H:one-composite-formula" out.txt
  -> ok 507 - H:one-composite-formula: the reviewer path and computeArtifactScore agree
```
**1050/1050 still pass with the defect live.** The regex only checks that the same three literal
numbers appear somewhere in the expression, in order — it never checks which variable each literal
multiplies, and the worked-example assertion never executes `appReviewer.ts`'s own formula, only
`computeArtifactScore`'s. Mutation restored and confirmed byte-identical to HEAD after each run.

**C9: REFUTED.** The guard is not equivalent to "the two formulas agree" — it is equivalent to "the
same three numbers are textually present." **Recommend, per the brief's own question**: this is a
case for removing the duplicate rather than asserting agreement — extract a single
`weightedComposite(mustHave, keyword, seniority, weights)` function that both call sites use, so
there is structurally one formula rather than two kept in sync by a source grep. Short of that, the
guard should assert on VALUES observed at each named position (e.g. match
`must_have_coverage \* \(s\.weights\?\.mustHave` specifically) rather than collect all `?? 0.x`
literals order-independently of which variable they attach to.

## C10 — non-resume artifacts: CONFIRMED by source read; no executable test exercises it

```
api/src/functions/tests/appChecks.ts:236   if (scoreable === 0 && art.type === 'resume') { ... }
```
`interimKw` is computed only when `art.type === 'resume'`; for every other type it stays `null`, so
`keyword` becomes `null` in the `scoreable === 0` case regardless of `last_build.analysis` content.
Unambiguous, single-condition code — confirmed by direct read.

**Flagging a real coverage gap, not a defect**: `grep -rn "evaluateArtifact(" api/test/` returns
zero matches — no test in the suite calls `evaluateArtifact()` at all; every reference is either a
comment or a source-grep assertion (e.g. `hardening.test.mjs:3806`, `.test(/evaluateArtifact\s*\(/)`,
checking that some OTHER file calls it, not exercising it). The entire interim-keyword wiring added
to `evaluateArtifact` — the resume-only gate, the `scoreable === 0` branch, reading
`last_build.analysis` for the `Missing ATS Skills` section, and mapping `ATS_SHIPPED_FIELDS` out of
`pkg_json` — is verified only by (a) unit tests of the pure helper functions in isolation and (b) my
own and the implementer's static reading of `appChecks.ts`. It has never been driven end-to-end by an
automated test, resume or otherwise, even though `test/shipPathDb.test.mjs` already has a local
Postgres harness (`HAVE_PG`) that inserts real artifact rows for exactly this purpose and could seed
one with a `last_build` and `pkg_json` to close this gap cheaply.

**C10: CONFIRMED** (the gate is real and correctly resume-only), **with a coverage gap noted**: no
executable test would catch a regression here (e.g., someone changing `'resume'` to `'cover'`, or
inlining the wrong field name for `last_build.analysis`).

## C11 — the veto lane: CONFIRMED, no regression

```
node --test test/checks.test.mjs test/proposalVet.test.mjs test/evidence.test.mjs test/evidenceConfirmDb.test.mjs
  -> 112 pass, 0 fail, 0 skip
```
`H:a-vetoed-row-cannot-pass-the-gate` and the surrounding veto/disclosure-string tests all pass at
current HEAD. **C11: CONFIRMED.**

## Summary

| Claim | Verdict |
|---|---|
| C1 (suites) | CONFIRMED |
| C2 (6/9 on live table) | CONFIRMED |
| C3 (numerator never from column 2) | CONFIRMED |
| C4 (header excluded, incl. mixed) | CONFIRMED (residual all-`<td>`-header risk noted) |
| C5 (absent is null, never 0) | CONFIRMED |
| C6 (whole-phrase matching) | **REFUTED** — real substring false positives found |
| C7 (library strictly overrides) | CONFIRMED |
| C8 (ResumeSummary excluded) | CONFIRMED |
| C9 (one composite formula) | **REFUTED** — guard is mutation-provably INERT to a weight-swap |
| C10 (non-resume gets null) | CONFIRMED (source read; no executable test covers it) |
| C11 (veto lane unaffected) | CONFIRMED |

**Two real, fixable defects are shipped and live**: the substring false-positive in `keywordPresent`
(C6) and the inert `H:one-composite-formula` guard (C9). Neither is a data-loss or gate-breaking
defect today — C6 inflates a component that (per C7) is currently only used when no term library is
published, and C9's exposed formula only executes once a reviewer verdict lands with a non-null
keyword component, which requires the interim score to have fired first — but both are exactly the
"inflates the number a reviewer trusts most" failure this repo's own rules exist to catch, and both
should be fixed before this component is treated as trustworthy input to an approval decision.
