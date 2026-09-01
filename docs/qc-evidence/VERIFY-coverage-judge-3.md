# VERIFY-coverage-judge-3

WHAT:       Independent verification, loop 3, of the coverage-judge / support-vetting work.
WHY:        Loops 1 and 2 were killed before writing a single claim. No verdict has ever been
            recorded for this work, so every claim below is settled at FULL depth; nothing is
            inherited as previously established.
SUPERSEDES: nothing (loops 1 and 2 produced no artifact).
SUPERSEDED-BY: nothing — current.
EVIDENCE:   commands and their raw output are inline beneath each claim.

- Verifier: independent subagent, no shared context with the implementer.
- Branch under test: `claude/incumbent-wins-swap` @ `7fca865`.
- Base (pre-change) commit: `74b78b8` — parent of `ccdfd48`, the first commit that created
  `api/src/functions/tests/coverageJudge.ts`.
- **Deployed to `main` at `7fca865` BEFORE this verification ran.** Every REFUTED finding below is
  therefore already live, gated only by `chk_coverage_judge` being default-OFF. Confidence
  statement: the default-OFF gate is the only thing standing between a defect here and production,
  so C2 (the OFF path) carries more weight than it otherwise would.

---

## C1 — both suites pass at the stated counts and both builds are clean

**CONFIRMED.**

```
$ cd api && npm run build   -> BUILD_EXIT=0   (tsc, no output)
$ cd api && npm test
# tests 1011
# pass 1011
# fail 0
TEST_EXIT=0

$ cd app && npm run build   -> BUILD_EXIT=0
$ cd app && npm test
# tests 424
# pass 424
# fail 0
TEST_EXIT=0
```

Matches the stated 1011/1011 and 424/424 exactly. Note this only says the guards are green — C12
asks whether they are green because they work.

---

## C3 — `must_have_coverage` counts a `vetted` row and not an unconfirmed `proposed` one

**CONFIRMED for the stated claim; REFUTED as a safety property.** Harness:
`/tmp/.../scratchpad/v3-c3-c4-c5.mjs`, driving the built `runChecks` directly.

```
PASS  C3.1 a `proposed` row does NOT reach the numerator      -> fail, "0/1 must-haves evidenced"
PASS  C3.2 a `vetted` row DOES reach the numerator and is named
           observed: "1/1 must-haves evidenced (1 vetted: a model challenged the match and it held,
                      quoting your own words)"
PASS  C3.5 a CONFIRMED proposal counts and is not called "awaiting your confirmation"
PASS  C3.7 the vetted note counts only `coverable` rows (1, not 2, with a responsibility row present)
```

I could not find an input where `vetted` fails to reach the numerator, or where an unconfirmed
`proposed` row reaches it. Both halves hold.

**But the attack found two things the claim does not cover.**

### F-1 (C3) `checks.ts` counts ANY method that is not literally `'proposed'`

```
observed for method="hallucinated": "1/1 must-haves evidenced"  state=pass
```

`isVetted` is `method === 'vetted'` but the NUMERATOR is `ruleEvidenceOf`, which is
`isProposed(r) && !isConfirmed(r) ? null : evidenceOf(r)`. So the gate is decided by *not being
`proposed`*, not by being one of the four known warrants. A row stamped with any unrecognised
method passes. The source comment at `checks.ts:942` states this openly and points at
`H:a-judged-row-counts-and-a-proposed-one-does-not` as the pin — C12 tests whether that pin is real.
The only thing that keeps an arbitrary method out of production is the database CHECK (C8), which
is enforcement in a different layer from the one that makes the decision.

### F-2 (C3) `checks.ts` re-verifies nothing about a `vetted` row

```
method='vetted', quote='ZZZ nothing like the requirement ZZZ'  ->  state=pass, 1/1
```

The quote is never re-checked against the profile, the requirement, or anything else at check time;
the `method` stamp alone carries the gate. That is a defensible design (verification happens at
write time in `writeEvidence`), but it means **anything that can write `method='vetted'` owns
`must_have_coverage` outright.** Recorded here because it is the precondition that makes F-3 below
matter.

---

## C4 — the challenge cannot promote a row on anything but a positive cited answer

**REFUTED — one input promotes a row while the model has named a gap.**

Every failure mode the brief names does leave the row refused (raw output, `parseSupportVerdict`
against excerpt `"Led the SOC 2 Type II audit readiness programme for the payments platform."`):

```
null / undefined / a string / a number        -> supported=false refusal=unparseable
missing:['SOC 2 certification'] + supported   -> supported=false refusal=missing_named
supported:false                               -> supported=false refusal=model_declined
supported:'true'  (string)                    -> supported=false refusal=model_declined
supported:1                                   -> supported=false refusal=model_declined
why:'   '                                     -> supported=false refusal=no_reason
quote:null  /  quote:'   '                    -> supported=false refusal=no_quote
quote:'Led the SOC 3 audit'                   -> supported=false refusal=quote_not_in_excerpt
quote:'led the soc 2'   (case changed)        -> supported=false refusal=quote_not_in_excerpt
quote:'SOC 2 certification' (the requirement) -> supported=false refusal=quote_not_in_excerpt
```

DB-write refusal is covered separately: `writeEvidence` wraps the insert in `savepoint`/`rollback`,
so a rejected insert costs that row and leaves nothing stamped (verified by reading
`appRequirements.ts:388-410`; the savepoint predates this work).

### F-3 (C4/C5) a NON-ARRAY `missing` is silently read as "nothing missing", and the row is promoted

```
input : { missing: 'SOC 2 cert', supported: true, quote: 'Led the SOC 2', why: 'w' }
result: supported=TRUE  refusal=null  quote="Led the SOC 2"      <-- PROMOTED
```

`supportJudge.ts:107`:

```ts
const missing = (Array.isArray(raw.missing) ? raw.missing : [])
```

A model that names its gap as a bare string instead of a one-element array has its gap **discarded**,
and the row then satisfies all three promotion conditions and is stamped `vetted` — which, per F-2,
counts toward the gate with nothing else checked. The prompt asks for `"missing":[<string>]`, so this
is a JSON-shape slip, not an exotic input; and every other malformed shape in this module refuses
(`unparseable`). This one is the single case where malformed input resolves in the direction that
*admits* the claim. It is a direct violation of the file's own stated rule — "absent evidence is
`not_applicable`, never `pass`" — and of C4's claim as written.

A `missing` array containing only whitespace behaves the same way (`['   ']` -> filtered to empty ->
promoted). That one is arguably correct.

---

## C5 — the ORDER claim: is `missing`-before-`supported` a real safeguard or ceremony?

**CONFIRMED as code, with a bounded reading of what it buys.**

```
missing:['a named certification'] + supported:true + a REAL byte-present quote
  ->  supported=false, refusal='missing_named', missing=['a named certification']
```

The check genuinely precedes the `supported` read (`supportJudge.ts:114`, before the `raw.supported`
test at :115), and a non-empty `missing` refuses in code regardless of the model's own verdict.
So the mechanical half is real and I could not defeat it with a well-formed array.

**Judgement, stated plainly as the brief asks.** It is a *partial* safeguard, not the safeguard the
comments claim.

- What it actually catches: a model that is **internally inconsistent** — names a gap and then claims
  support anyway. That is a real and common LLM failure, and catching it in code rather than trusting
  the model's own consistency is worth having.
- What it cannot catch, and this is the larger population: a model that simply **returns
  `missing: []`**. Nothing in the code can tell an honest empty list from a lazy one. The prompt is
  the only thing asking for the gap analysis, so for the dominant failure mode this is prompt
  discipline, not a code guard.
- And F-3 above means even the inconsistent-model case escapes whenever the gap is not array-shaped.

So: a real safeguard against self-contradiction, ceremony against under-reporting. The code comments
("disconfirming evidence made mechanical rather than hoped for") over-state it — the mechanism is
mechanical only once the model has already chosen to report the gap, in the right container.

---

## C2 — with the judge OFF, behaviour is byte-identical to the pre-change commit

**CONFIRMED.** Proved against a real build of `74b78b8` (`git worktree add /tmp/base74 74b78b8`,
`cd /tmp/base74/api && npm run build` -> exit 0), not against the branch's own tests.

4,000 pseudo-random `runChecks` inputs (seeded PRNG, 4 artifact types, random packages, 0-7
requirements, evidence present / absent / unreadable / mixed methods / mixed `confirmed_at`),
`JSON.stringify` compared between the two builds:

```
C2 runChecks differential: 4000 random inputs, 0 differing
```

The explicit OFF shapes, against the same base build:

```
IDENTICAL  no judgeVerdicts key
IDENTICAL  judgeVerdicts: undefined
IDENTICAL  stuffingHits: undefined
IDENTICAL  stuffingHits: []
DIFFERS    judgeVerdicts: new Map()        <- correct, see below
```

The only difference is an **empty map**, which does not mean "off" — it means "the judge ran and
answered nothing", and the difference is `evidence_placed` going `warn`->`not_applicable` (silence
excluded rather than accused). `runCoverageJudge` returns the `OFF` object with **no `verdicts`
key** on every off path, and `appChecks` passes `coverage && judgeVerdictsFor(coverage)`, which
yields `undefined` — so an empty map is unreachable from a disabled judge.

No model call and no DB write on the off path: `runCoverageJudge` and `runStuffingRead` both return
before touching `fetchJson` or `client` (`if (input.thresholds?.coverageJudge !== true) return OFF`,
`appCoverage.ts:82` and `:262`).

Settings deltas, all inert when untouched:

```
DEFAULT_THRESHOLDS:  coverageJudge false | coverageJudgeMaxCalls 12 | coverageJudgeMinQuoteChars 20  (all new)
resolveOptionsFrom({}):  {"escalate":true,"appealOverclaims":false,"vetProposals":false}
```

`loadThresholds` reads `chk_coverage_judge === true`, so a row predating the column reads OFF.

---

## C6 — `evidence_placed`: verdict beats lexical, no map is untouched, silence is excluded

**CONFIRMED on all three, with one defect in how the exclusion is REPORTED.**

```
PASS C6.1 no map = the untouched lexical path            -> warn, "absent from this asset"
PASS C6.2 a covered verdict BEATS the lexical no         -> pass, "1/1 evidenced requirements appear"
PASS C6.3 an uncovered verdict accuses                   -> warn, 1 offender
PASS C6.4 SILENCE (asked, unanswered) is excluded        -> not_applicable, offenders []
PASS C6.5 ATTACK: a verdict for a DIFFERENT seq (99) does not leak seq 0 into an accusation
          -> not_applicable
PASS C6.8 a judge verdict does NOT move must_have_coverage (the two populations stay apart)
```

I tried three ways to make silence leak into an accusation — an empty map, a map keyed on a seq
that was never asked, and a mixed map where one requirement is answered and another is not. None
produced an offender for the unanswered requirement. That half of the claim holds.

### F-4 (C6) the exclusion is real but its REASON is reported falsely

```
requirements: #0 "Ability to align engineering strategy with business goals"   (judged, covered=false)
              #1 "Own the reliability of the payments platform end to end"     (SILENT — not answered)
observed:     "0/1 evidenced requirements appear in this document (1 too short to judge either way)"
```

`#1` is six content words. It is not short — it was excluded because the judge never answered. Both
exclusions collapse into one counter:

```ts
const placeable = evidenced.filter(...MIN_JUDGEABLE_TOKENS).filter(r => !judgeSilent(r))
const tooThin = evidenced.length - placeable.length
const thinNote = tooThin ? ` (${tooThin} too short to judge either way)` : ''
```

and the `!placeable.length` branch hard-codes the same false reason
(`"N evidenced requirement(s), none long enough to judge placement"` — printed above in C6.4, where
the actual cause was total judge silence).

This is precisely the class of defect the file's own comments spend three paragraphs on 40 lines
earlier: *"a reviewer who cannot trust the parenthetical cannot audit the number in front of it."*
Here the parenthetical tells the owner their requirement was too short when the truth is that a
model call failed, timed out, or hit the cap. It is the difference between "your posting line is
unmeasurable" and "our judge went down", and the owner is shown the first.

---

## C11 — the stuffing read can never fail a gate

**CONFIRMED, with a cost finding.**

```
WITH profileText, no hits  -> pass, "no passage of 8+ words matches the posting"
WITH profileText, 1 hit    -> warn, "1 passage(s) ... (1 raised by a model reading for name-dropping)"
                              offender: 'ResumeSummary: "engineering strategies" — names the topic...'
WITH profileText, 100 hits -> warn   (never fail, at any volume)
no postingText             -> runStuffingRead returns `off` before any call (appCoverage.ts:265)
transport throws           -> caught per field, `failures.push`, hits unchanged (appCoverage.ts:286)
```

`posting_wording_kept` is emitted with the literal `'warn'` severity in the only branch stuffing hits
can reach, so no volume of hits can produce a `fail`. Confirmed by driving 100 hits.

**Would it cry wolf on ordinary good resume writing?** Reading `STUFFING_SYSTEM` /
`buildStuffingUser` (`stuffingJudge.ts`) — my judgement, since only a live model call could settle it
empirically and that is unavailable here:

- The prompt's protection for legitimate vocabulary use is the instruction to distinguish *naming a
  topic* from *claiming to have done it*, and every hit must be a span **byte-present in the field**
  (`parseStuffing` applies the same `indexOf` refusal). So a fabricated accusation is impossible;
  a mis-read one is not.
- The real exposure is that using the employer's noun for something you genuinely did — "led the
  **engineering strategy**" — is lexically indistinguishable from name-dropping it, and the model is
  asked to judge exactly that. I expect a non-trivial false-positive rate on tightly-written,
  keyword-aligned resume prose, which is the writing style this product exists to produce.
- What makes that acceptable rather than a cry-wolf failure is the surface: it is a `warn` explicitly
  labelled *"your call"*, each hit carries the model's reason, and it merges into a check the writer
  already reads rather than adding a row. It never blocks and never edits. On the repo's own
  standard ("a guard people learn to ignore is worse than none") this sits on the right side —
  but only because it cannot gate anything.

### F-5 (C11) stuffing hits are silently DISCARDED when the deterministic scan is blocked

```
no profileText, 1 hit -> not_applicable, offenders []
   "no profile text — wording the candidate already uses cannot be told from wording taken from the ad"
```

`runStuffingRead` gates only on `postingText`; `runChecks` folds `stuffingHits` into the `else` of the
`wBlocked` branch. So when profile text is missing, up to `coverageJudgeMaxCalls` model calls are
made per artifact and every result is thrown away unread. Not a safety defect — a paid-for, silent
no-op. Worth a guard because nothing in the run's output says the calls were wasted.

---

## C10 — the appeal can only OVERTURN a withdrawal, never cause one

**CONFIRMED, non-vacuously.** My first run of this harness was VACUOUS — the proposal lacked
`supported: true`, so `verifyProposal` refused it with `model_declined` and the appeal branch was
never entered; all eleven "withdrawal stands" results were meaningless. Recorded because it is
exactly the failure mode this repo's rules name ("absent evidence is not a pass"). Fixed and re-run;
the baseline below really is `reasoningWithdrawn: true`.

Fixture is the A6 case from the source comment, verbatim.

```
verifyReasoning: withdrawn=true  overclaimed=["computer","software","engineering"]
OLD build identical: true

C10.1 appeal OFF vs a build of 74b78b8:  IDENTICAL
      baseline: kind=accepted, reasoningWithdrawn=TRUE   <- non-vacuous

C10.2 every appeal FAILURE leaves the withdrawal standing (byte-identical to the baseline):
      WITHDRAWAL STANDS  transport throws
      WITHDRAWAL STANDS  null answer
      WITHDRAWAL STANDS  a bare string
      WITHDRAWAL STANDS  empty upheld
      WITHDRAWAL STANDS  upheld not an array
      WITHDRAWAL STANDS  quote not in excerpt
      WITHDRAWAL STANDS  PARTIAL defence (1 of 3)
      WITHDRAWAL STANDS  a term nobody disputed
      WITHDRAWAL STANDS  duplicate term to fake the count
      WITHDRAWAL STANDS  no quote
      WITHDRAWAL STANDS  quote is the REQUIREMENT, not the excerpt

C10.3 the only overturning shape: reasoningWithdrawn=false, method='proposed' (NOT promoted)
C10.4 hostile appeals against a NON-withdrawn row: UNCHANGED on all four
C10.5 fetchJson calls = 1 when nothing was withdrawn (the appeal is not even reached)
```

**`verifyReasoning` itself is byte-identical.** Extracted from both refs and compared:

```
$ git show 74b78b8:...evidenceProposal.ts  vs  git show HEAD:...  (function body)
IDENTICAL   len old 2274  len new 2274
```

The only removed lines in the whole file diff are two occurrences of
`rec.text.slice(a.char_start, a.char_end)` replaced by the `excerpt` const holding the same
expression. **No guard was weakened.**

*Observation, not a defect:* `parseAppeal` accepts ONE span as the defence of every disputed term —
in the passing case `computer`, `software` and `engineering` are all defended by
`"Information Systems"`. "Defend EVERY disputed term" is therefore satisfiable by citing the same
span N times. Given the appeal cannot promote a method and only restores a sentence the model
already wrote, the exposure is bounded, but the code comment reads stronger than the mechanism.

---

## C7 — the cache key, and WRITE key == READ key against a real database

**CONFIRMED.** PostgreSQL 16.13, schema built from the module (never hand-copied), verdicts written
and read by the production `runCoverageJudge`/`readCached`/`writeVerdicts` path with an injected
transport.

```
PASS  key changes with FIELD TEXT (one character)
PASS  key changes with REQUIREMENT
PASS  key changes with FIELD NAME
PASS  key changes with MODEL
PASS  key is stable for identical input
PASS  NUL separator resists a straddle  (K('a','bc') != K('a text:bc',''))
PASS  the key really is judge+prompt+model+field+req+text  (reconstructed by hand, matched)
PASS  a PROMPT_VERSION bump invalidates every cached verdict  (manual(v+1) != base)
```

The second half, against the live database:

```
run 1: {"calls":1,"cacheHits":0,"refused":0,"silent":[],"failures":[]}
stored: {"field":"ResumeSummary","verdict_key":"034a5f95dbdf...83c1","covered":true,
         "basis":"synonym","quote":"aligning engineering strategies with business objectives",
         "char_start":17,"char_end":73,"lexical_covered":false,"model":"gpt-4o","prompt_version":1}
run 2: {"calls":0,"cacheHits":1}                       <- WRITE key == READ key
PASS  the cached verdict equals the freshly-judged one
PASS  one character of document edit MISSES the cache   (calls=1 hits=0)
PASS  a different model MISSES the cache                (calls=1 hits=0)
```

Note the stored row: `covered=true, lexical_covered=false` — the exact 0.60 near-miss the WHY
comment cites, now queryable rather than anecdotal. The feature does what its rationale claims.

---

## C8 — `requirement_coverage`'s constraints, EXECUTED

**CONFIRMED.** Every rejection the brief names fires, and the legitimate shapes are accepted (so the
rejections are not vacuous).

```
REJECTED  covered with NO quote                 requirement_coverage_check1
REJECTED  uncovered WITH a quote                requirement_coverage_check1
REJECTED  covered + basis='absent'              requirement_coverage_check2
REJECTED  empty reason (why = '')               requirement_coverage_why_check
REJECTED  offsets disagreeing with quote length requirement_coverage_check6
REJECTED  a basis outside the four              requirement_coverage_basis_check
REJECTED  negative char_start                   requirement_coverage_check5
REJECTED  char_end <= char_start                requirement_coverage_check5
REJECTED  quote set with char_start null        requirement_coverage_check3
REJECTED  char_start set with char_end null     requirement_coverage_check4
REJECTED  duplicate (opp_id, verdict_key)       requirement_coverage_opp_id_verdict_key_key
ACCEPTED  a valid covered verdict
ACCEPTED  a valid uncovered verdict
```

---

## C9 — `SCHEMA_SQL` applies cleanly ON TOP of the pre-change schema, on a POPULATED database

**CONFIRMED.** Both `SCHEMA_SQL` bodies dumped from their built modules (`74b78b8` and `HEAD`),
pgvector stubbed, `ON_ERROR_STOP=1` throughout.

```
1. apply 74b78b8's SCHEMA_SQL              OLD_SCHEMA_EXIT=0
   method_check BEFORE: CHECK (method = ANY (ARRAY['exact','anchored','proposed']))
   requirement_coverage BEFORE: 0 tables

2. seed REAL rows                          opp/packet/artifact/requirement/evidence = 1/1/1/2/3
   (methods present: anchored x1, proposed x2)
   PRE-migration UPDATE ... method='vetted'
     -> ERROR: violates check constraint "requirement_evidence_method_check"   <- the constraint is live

3. apply HEAD's SCHEMA_SQL ON TOP          NEW_ON_POPULATED_EXIT=0, zero ERROR lines
   AFTER opp/requirement/evidence = 1/2/3                       <- no data lost
   method_check AFTER: CHECK (method = ANY (ARRAY['exact','anchored','proposed','vetted']))
   requirement_coverage AFTER: present

4. POST-migration
   UPDATE ... method='vetted'        -> UPDATE 1                 <- widened
   UPDATE ... method='hallucinated'  -> ERROR: method_check      <- still bounded
   final: anchored x1, proposed x1, vetted x1

5. apply HEAD's SCHEMA_SQL a SECOND time   SECOND_APPLY_EXIT=0, evidence rows = 3   <- idempotent
6. fresh-database control                  FRESH_EXIT=0
```

The widened CHECK is done with `drop constraint if exists` + `add constraint`, which executes
correctly over a table that already holds rows. This is the one layer that keeps F-1 (checks.ts
counting any non-`proposed` method) from being reachable in production.

---

## C13 — the claims in `.claude/actions.md`, one by one

| # | claim | verdict | evidence |
|---|---|---|---|
| 1 | `ACT:coverage-judge` — five commits `fa6a9ca`, `1557ead`, `167d7e8`, `8f21606`, `cee07a7` | CONFIRMED | all five in `git log`, in that order |
| 2 | `ACT:coverage-judge` — **"NOT ON `main`. NOT RUN LIVE."** | **REFUTED (stale)** | `git fetch origin` then `git merge-base --is-ancestor <c> origin/main` -> **all five ARE on `origin/main`** |
| 3 | `ACT:coverage-judge` — "api suite **988/988**" | CONFIRMED | worktree at `cee07a7`, `npm test`: `# tests 988 / # pass 988 / # fail 0`, EXIT=0 |
| 4 | `ACT:coverage-judge` — "**NOT DONE** … `supportIn` — the PROFILE side … the 0/12 does not move until that lane lands" | **REFUTED (stale)** | `155db07` landed exactly that lane; C3 shows a `vetted` row moving the numerator |
| 5 | `ACT:coverage-judge` — "Twenty guards mutation-proved" | NOT_APPLICABLE | a claim about a past action, not reproducible. My own independent sweep is C12 |
| 6 | `ACT:resolve-the-0-of-12` — commits `155db07`, `92c432d`, `ed7e453` | CONFIRMED | all three in `git log` and on `origin/main` |
| 7 | "api **1011/1011**, app **424/424**, both builds clean" | CONFIRMED | C1 |
| 8 | "the code is on `main`" | CONFIRMED | `7fca865` is an ancestor of `origin/main` |
| 9 | "Two existing guards FIRED on the widened `method` domain — one says … *'a fourth added without a thought here should fail'*" | CONFIRMED | `git diff` on `hardening.test.mjs`: `H11` gained `requirement_coverage`, and `H:model-evidence-is-labelled` moved from `'exact,anchored,proposed'` to `'exact,anchored,proposed,vetted'` **plus a new cross-home equality loop** — tightened, not relaxed |
| 10 | "`checks.ts` **already used `judged`** for an unrelated thing" | CONFIRMED | `CheckResult.judged?: string[]` (`checks.ts:52`), `judgedIds` |
| 11 | "Turning it on is one toggle in **Settings ▸ Quality**" | CONFIRMED | `checkPrefColumns()` returns 31 columns including `chk_coverage_judge` (boolean), `chk_coverage_judge_max`, `chk_coverage_judge_min_quote`; `Settings.jsx` renders `cols` from the API's `checkColumns` under the "Quality checks" card in the `quality` section, with labels present in `CHK_LABELS`. (Module-level proof; I cannot click the live SPA from this sandbox.) |
| 12 | "`/workspace/eds-claude-skills` present at `321ec3e`, 17 skills installed" | PARTIAL | the clone is at `321ec3e` as claimed; `ls /root/.claude/skills` counts **18**, not 17. Immaterial, but it is one of the two numbers in that row |
| 13 | "Seventeen guards mutation-proved in this pass" | NOT_APPLICABLE | same as #5 |

### F-6 the `judged` -> `vetted` rename is only half done

`actions.md` says *"Renamed to `vetted`"*. The identifiers were; the prose was not. Live in `main`
today:

```
checks.ts:926,927,939   "A `judged` row is not that answer given twice", "To be stamped `judged`",
                        "Nothing is stamped `judged` unless the owner turned the judge on"
evidence.ts:104         "See `supportJudge.ts` and `checks.ts`'s `isJudged`"   <- no isJudged exists
hardening.test.mjs      the H-case comment says `judged` five times and its own assertion message
                        reads "no method CHECK admits both a proposed and a judged row"
appRequirements.ts:361  "What survives is stamped `judged` and counts"
```

The reason this is worth a finding rather than a nit is the reason the owner gave for the rename in
the first place — *"our labeling and taxonomy is not intuitive to a human"* — and `judged` is
precisely the word that collides with `CheckResult.judged`. The half-rename leaves the collision in
the comments of the file where both meanings appear.

---

## C14 — adversarial: how does a MODEL's unverified assertion reach a stored claim, a check state, or the gate?

**Five paths found. Two are by design and declared; three are not.**

### F-7 (the significant one) the citation safeguard binds ONLY the model's "yes". Its "no" is uncited and ACCUSES.

The design statement, `coverageJudge.ts` header: *"the model must point at words the document
actually contains, and code checks that it did."* That is true of `covered: true`. It is not true of
`covered: false`, which is accepted with `quote: null` — and `covered: false` is the branch that
produces the offender line.

```
document : "Aligning engineering strategy with business goals is what I have done for a decade."
requirement: "Ability to align engineering strategy with business goals"   (verbatim in the document)

parseCoverageVerdicts({verdicts:[{seq:0,covered:false,basis:'absent',quote:null,why:'I do not think so'}]})
  -> ACCEPTED: [{"seq":0,"covered":false,"basis":"absent","quote":null,...,"why":"I do not think so"}]

evidence_placed, LEXICAL  : pass  "1/1 evidenced requirements appear in this document"   offenders []
evidence_placed, JUDGE NO : warn  "0/1 evidenced requirements appear in this document"
   offenders: ["#0 Ability to align engineering strategy with business goals
                — evidenced by Work history 1, absent from this asset"]
```

One uncited model sentence turns a passing check into a named accusation about a document that
contains the requirement **word for word**. The lexical rule it replaced could not do this. The
asymmetry is arguable — you cannot cite an absence — but then the honest handling of an uncitable
"no" is `unjudged`, which this module already has and already treats correctly for silence.
As written, the safeguard the whole tier rests on protects the owner in one direction only.

### F-8 every diagnostic the judge produces is discarded by its only caller

`runCoverageJudge` returns `{ calls, cacheHits, refused, silent, failures }`. `appChecks.ts:182`
reads `judgeVerdicts: coverage && judgeVerdictsFor(coverage)` and **nothing else**; `runStuffingRead`'s
`{ calls, refused, failures }` likewise (`stuffing?.hits` only). Confirmed by grep — no consumer of
`.failures` / `.cacheHits` / `.silent` anywhere in `api/src`.

Consequences, all live:

- **A judge outage is invisible.** Combined with F-4, the owner is told "N too short to judge either
  way" when the truth is that the model call failed.
- **`refused` is discarded** — the count of times a model claimed a quote the document does not
  contain. `coverageJudge.ts` names each refusal separately with the stated reason that
  *"only the second is a defect worth alerting on."* Nothing alerts.
- **Cost is unmeasurable.** `calls` is never recorded, so nobody can say what the judge spent.

### F-9 `writeEvidence`'s new `vetted` count is write-only

Added at `appRequirements.ts:174,277,377,420` with the explicit rationale *"Reported separately from
`proposed` because they are the ones that COUNT, and a caller must be able to see the number a model
moved."* The only place these counts surface is `appPackets.ts:1186-1189`:

```ts
evidence: { total, evidenced, proposed, escalated, refused }     // <- no `vetted`
```

`grep -rn '\bvetted\b' api/src` returns no reader of the count. TypeScript stayed quiet because the
caller destructures a subset. This is the exact self-attack check the repo's own rules prescribe
("Who READS what you wrote?") and the exact shape of the `correction.frame` write-only defect the
CLAUDE.md cites. The per-ROW `method='vetted'` **does** have consumers (`checks.ts`, the JD panel) —
it is the aggregate that is orphaned.

### Path 4 — DECLARED, but the "second read" is the SAME model on the SAME transport

`appRequirements.ts` passes one `fetchJson` — `openAiJson({ feature: 'evidence:escalate' })` — to
both `escalateOne` (which produces the excerpt) and the vet (which promotes it). So the chain that
ends at the gate is: **model picks the excerpt -> same model says it supports the requirement ->
`vetted` -> `must_have_coverage` -> score.** The byte-exact check proves those words exist in the
owner's profile; nothing checks that they are RELEVANT. `checks.ts` re-verifies nothing (F-2).
The source comment anticipates this and argues the FRAMING differs, which is fair — but
`supportJudge.ts`'s heading, *"WHY A SECOND READ IS NOT JUST 'ASKING THE SAME MODEL TWICE'"*, is
literally asking the same model twice, and only the prompt differs.

### Path 5 — DECLARED: model prose is stored verbatim into owner-facing claims

`requirement_coverage.why` and `requirement_evidence.extra` (via `vettedNote`) store the model's own
sentence. Both are labelled as model output on their face, which is the mitigation the design names,
and I found no path by which either becomes a machine-read value.

### What I could NOT break

- A quote stored from the model's string rather than the document's bytes — every accepted path
  re-slices (`text.slice(at, at + quote.length)`), proved by the whitespace-trim case in C4.
- A `covered: true` verdict admitted without a quote — refused (`covered_without_quote`).
- A method value counting when it should not, **in production** — `checks.ts` would count one
  (F-1), but the DB CHECK bounds the domain to four and no code path writes outside it (C9).
- Silence leaking into an accusation — three attempts, all excluded (C6).

---

### C11 addendum — the cry-wolf judgement, after reading the prompt in full

My first read of C11 (above) understated the prompt's protection. `stuffingJudge.ts` carries an
explicit, worked contrast in both the system message and the file header:

```
'Using the employer\'s own words inside a real claim is good writing and is NEVER a hit --'
'"led the SOC 2 certification" is a claim; "familiar with SOC 2, ISO 27001 and NIST" is a list.'
```

That is a concrete decision rule with a positive and a negative example on the same noun, which is
materially better than a bare instruction and lowers my expected false-positive rate. The residual
risk stands — the distinction is a meaning judgement and no code can check it — but the mitigation is
real, not nominal. Combined with the fact that no volume of hits can produce anything but a `warn`
the writer is explicitly told is "your call", I do not think this cries wolf in a way that would
teach the owner to ignore the check.

---

## C12 — ARE THE NEW GUARDS INERT?

**43 mutations applied, 38 CAUGHT, 5 survived.** Method: each mutation is applied to the COMPILED
`api/dist` (behaviourally identical to the source line, and avoids a 31s `tsc` per mutation), the
suite runs, the file is restored from a pristine snapshot. **Every mutation was verified to have
actually applied** — a `count(old) != 1` aborts as `SKIP-NOMATCH` rather than reporting a
no-op edit as proof. Three did that on the first pass and were re-run with correct anchors, not
reported as proven.

Suites run per mutation: `coverageJudge`, `coverageRun`, `coverageDb`, `proposalVet`, `stuffingRead`,
`reasoningCheck`, `matcher`, `checks`, `hardening` (api); `postingAnalysis` (app).

### CAUGHT — 38

```
M01 quote must be byte-present in the field      H:judge-quote-must-be-in-the-document
M02 a bad basis is refused                       H:judge-refuses-a-claim-it-cannot-support
M03 covered + basis=absent is refused            H:judge-refuses-a-claim-it-cannot-support
M04 a verdict with no reason is refused          H:judge-reason-is-required
M05 covered without a quote is refused           H:judge-refuses-a-claim-it-cannot-support
M06 an unasked seq is refused                    H:judge-refuses-a-claim-it-cannot-support
M08 unanswered lands in `unjudged`               H:judge-never-invents-an-answer-it-was-not-given
M09 cache key includes FIELD TEXT  (2 failing)   H:one-edited-character-is-a-different-document
M10 cache key includes MODEL                     H:verdict-key-changes-with-the-document
M12 no field answered => SILENT   (2 failing)    H:a-no-needs-every-field-to-have-answered
M13 a too-thin requirement is not asked          H:judge-skips-what-cannot-be-judged-either-way
M14 THE ORDER GUARD                (2 failing)   H:a-challenge-that-finds-a-gap-leaves-the-row-...
M16 support quote must be in the excerpt         H:a-vet-must-quote-the-excerpt
M17 support claim with no quote refused          H:every-other-way-of-answering-refuses-too
M18 support claim with no reason refused         H:every-other-way-of-answering-refuses-too
M21 proposed does not count         (4 failing)  H:proposed-evidence-cannot-pass-the-gate
M22 a vetted row is NAMED in the count           H:a-counted-vet-is-named-where-the-number-is-read
M23 judge-silent excluded from placement         H:judge-silence-is-not-a-no
M24 the verdict WINS over the lexical rule       H:judge-verdict-beats-the-word-match
M25 stuffing hits reach the check                H:a-model-raised-passage-lands-on-the-check-...
M26 THE OFF SWITCH                               H:judge-off-is-the-untouched-path
M27 the minimum-quote floor                      H:a-quote-too-short-to-mean-anything-is-refused
M28 the coverage call cap is silence             H:the-cap-stops-calls-without-accusing
M28b the stuffing call cap                       H:the-cap-bounds-what-one-run-can-spend
M29 transport failure => silence, not a no       H:transport-failure-is-silence-not-a-no
M30 stuffing raises nothing on failure           H:a-read-that-fails-raises-nothing-...
M31 the vet runs only when enabled   (2 failing) H:escalation-never-touches-a-settled-row
M32 `vetted` only on supported AND a quote       H:a-challenge-that-finds-a-gap-leaves-the-row-...
M33 the appeal needs EVERY term       (2 failing) H:a-partial-defence-leaves-the-withdrawal-standing
M34 appeal quote must be in the excerpt          H:appeal-must-quote-the-excerpt
M35 the appeal only runs on a withdrawal         H:an-undisputed-row-never-reaches-the-appeal
M38 an unreadable cache is a miss                H:an-unreadable-cache-is-a-miss-not-a-verdict
M39 a refused write is not a finding             H:a-verdict-the-database-refuses-never-becomes-a-finding
M36 the JD panel flags a vetted row (app)        H:a-vetted-row-is-marked-and-is-not-mistaken-for-agreement
M37 awaitingConfirmation keys on `proposed` (app) H:proposal-awaits-a-human
```

`H:no-verdict-map-changes-nothing` — which `actions.md` says was found INERT and strengthened — is
live: M26 (the OFF switch) and M23 fail through it and its siblings, and reading it confirms it now
pins the produced outcome (`warn`, one offender, requirement named) rather than comparing two
spellings of "no map".

### SURVIVED — 5, of which 2 are behaviourally equivalent and 3 are real gaps

**Behaviourally equivalent — correctly failed to fail. These are NOT proof the assertion works, and
NOT a defect either. Stating this explicitly per the repo's own rule.**

| # | mutation | why no test can catch it |
|---|---|---|
| M07 | `quote: text.slice(at, at + quote.length)` -> `quote: quote` (coverageJudge) | `at = text.indexOf(quote)`, so `text.slice(at, at+quote.length) === quote` for every input by the definition of `indexOf`. The source comment says exactly this ("Equal by construction here"). The re-slice is defensive against a future change, not observable today. |
| M19 | the same line in `supportJudge` | identical argument |

**REAL GAPS — the suite stayed green with the defect reinstated.**

### F-11 (C12) nothing proves `PROMPT_VERSION` participates in the cache key

```
M11  `prompt:${PROMPT_VERSION}` -> 'prompt:CONSTANT'    SURVIVED — 0 failing tests
```

`verdictKey`'s own comment says the prompt version is in the key *"for exactly that reason"* — so a
prompt edit invalidates cached verdicts rather than "the gate reporting a state no current code
would produce". Delete that component and the suite does not notice, because a runtime test cannot
vary a module constant. The field-text and model components ARE guarded (M09, M10 both caught),
because those vary per call.

My C7 hand-reconstruction proves the component is present *today* (`manual(PROMPT_VERSION) === base`
and `manual(PROMPT_VERSION + 1) !== base`). Nothing holds it there. A source-shape assertion, which
this repo uses elsewhere for exactly this class, would close it.

### F-12 (C12) nothing pins `supported !== true` — a truthy-non-true value would promote

```
M15  `if (raw.supported !== true)` -> `if (raw.supported === false)`   SURVIVED — 0 failing tests
```

Under the mutation, `supported: "true"`, `supported: 1`, and **`supported` absent altogether** all
fall through to the quote check and can be stamped `vetted` — a row that counts toward the gate.
`grep supported api/test/proposalVet.test.mjs` shows the suite drives only the literals `true` and
`false`; there is no truthy-non-true case and no missing-key case.

The current code is correct (I proved it in C4: `'true'` and `1` both refuse as `model_declined`).
The guard protecting that correctness does not exist, on the one boolean that decides whether a
model's row reaches `must_have_coverage`. A model returning `"supported": "true"` is an ordinary
JSON-shape slip — the same class as F-3.

### F-10 (C12) `supportKey` is DEAD CODE, and the vetted lane has NO cache at all

```
M20  `excerpt:${excerpt}` -> 'excerpt:CONSTANT' in supportKey   SURVIVED — 0 failing tests
```

It survived because **`supportKey` is never called.**

```
$ grep -rn supportKey api/src api/dist api/test app/test
  src/functions/tests/supportJudge.ts:151:export function supportKey(...)   <- the definition
  dist/... (the compiled definition)
  (no callers, no tests)
```

`appRequirements.ts` imports `SUPPORT_SYSTEM, buildSupportUser, parseSupportVerdict, vettedNote` —
not `supportKey`. Its own doc comment claims *"Identity of what was judged, so a re-run over
unchanged text need not re-ask."* Nothing re-uses anything.

**And the consequence is larger than an unused export, because of what runs beside it.** When
escalation is on, `writeEvidence` starts with:

```sql
delete from requirement_evidence e using requirement r
 where e.requirement_id = r.id and r.opp_id = $1        -- ALL rows, including every `vetted` one
```

So on every resolve: every `vetted` row is destroyed, every proposal is re-asked, and every vet is
re-asked — at full cost, with no stored answer. The coverage judge next door builds an entire
content-addressed cache table on the stated principle that *"a gate that flipped between two runs of
unchanged code would be worse than one that is wrong consistently."* **The lane that actually moves
`must_have_coverage` has none of that.**

Calibration, honestly: `openAiJson` defaults `temperature` to 0 (`openaiJson.ts:39`), which makes
run-to-run drift unlikely rather than impossible — OpenAI does not guarantee determinism at
temperature 0. So this is a real stability and cost exposure, not a proven flapping gate. What is
certain is the cost: N model calls per resolve, every resolve, forever, for answers a cache was
written to hold.

---

# VERDICT

| claim | verdict |
|---|---|
| C1 both suites pass at the stated counts, both builds clean | **CONFIRMED** |
| C2 judge OFF is byte-identical to `74b78b8` | **CONFIRMED** (4000/4000 differential against a real build of the base commit) |
| C3 `vetted` counts, unconfirmed `proposed` does not | **CONFIRMED** as stated; F-1, F-2 qualify it |
| C4 the challenge promotes only on a positive cited answer | **REFUTED** — F-3, a non-array `missing` |
| C5 the ORDER guard is real, not ceremony | **CONFIRMED as code**, partial as a safeguard (judgement given) |
| C6 `evidence_placed`: verdict beats lexical, no map untouched, silence excluded | **CONFIRMED**; F-4 on the reported reason |
| C7 cache key sensitivity; WRITE key == READ key | **CONFIRMED** against a real PostgreSQL |
| C8 `requirement_coverage` constraints reject the eleven bad shapes | **CONFIRMED**, executed |
| C9 `SCHEMA_SQL` applies on a POPULATED pre-change database | **CONFIRMED**, executed, non-vacuous |
| C10 the appeal only overturns; `verifyReasoning` unchanged | **CONFIRMED**, byte-identical, non-vacuous |
| C11 the stuffing read can never fail a gate | **CONFIRMED**; F-5 on discarded hits |
| C12 are the new guards inert? | **38 of 43 caught.** 2 equivalent, **3 real gaps** (F-10, F-11, F-12) |
| C13 the `actions.md` claims | **2 REFUTED as stale**, 9 confirmed, 2 not reproducible, 1 partial |
| C14 can a model's unverified assertion reach a stored claim / check state / gate? | **YES — F-7 is the significant one**, plus F-8, F-9 and two declared paths |

## Findings, by what they cost

**Would change a number the owner reads, or an accusation made against them:**

- **F-7** the citation safeguard binds only the model's "yes". An **uncited** `covered:false` turns a
  passing `evidence_placed` into a named accusation against a document that contains the requirement
  verbatim. The lexical rule it replaced could not do this.
- **F-3** a non-array `missing` is discarded, and the row is then **promoted to `vetted`** — which
  counts toward `must_have_coverage`. The one malformed input in this module that resolves toward
  admitting the claim.
- **F-4** the exclusion of a judge-silent requirement is correct, but the owner is told it was
  "too short to judge either way". A model outage is reported as a property of their posting.
- **F-12** nothing pins `supported !== true`; a truthy-non-true value would promote, and no guard
  would notice.

**Correctness is fine, the guard or the record is not:**

- **F-10** `supportKey` is dead code; the vetted lane has no cache, and every resolve deletes and
  re-asks every vetted row. Cost is certain; stability rests on `temperature: 0`.
- **F-11** nothing proves `PROMPT_VERSION` is in the cache key.
- **F-1** `checks.ts` counts any method that is not literally `'proposed'`; only the DB CHECK bounds
  the domain.
- **F-2** `checks.ts` re-verifies nothing about a `vetted` row — the `method` stamp alone carries
  the gate.

**Bookkeeping, but on a Tier-1 surface:**

- **F-8** every diagnostic the judge produces (`calls`, `cacheHits`, `refused`, `silent`, `failures`)
  is discarded by its only caller. Outages and fabricated-quote refusals are unobservable; cost is
  unmeasurable.
- **F-9** `writeEvidence`'s new `vetted` count is write-only — `appPackets` surfaces
  `proposed`/`escalated`/`refused` and not it.
- **F-5** stuffing hits are silently discarded when the wording scan is blocked, after the calls are
  paid for.
- **F-6** the `judged` -> `vetted` rename is half done; the prose still says `judged`, including a
  reference to a non-existent `isJudged`.
- **C13** `ACT:coverage-judge` still says "NOT ON `main`" and "supportIn NOT DONE". Both are stale —
  all eight commits are on `origin/main` and the profile lane shipped in `155db07`.

## What I did not verify, and what would settle it

- **Live behaviour.** The sandbox cannot reach `job-platform-api.azurewebsites.net` or the SPA.
  Everything above is against the built modules, a local PostgreSQL 16.13, and a build of the base
  commit. `api-test.yml` / `ui-verify.yml` would settle the live half.
- **Real model behaviour.** Every transport is injected. Whether the challenge prompt actually
  elicits honest `missing` lists, and whether the stuffing read false-positives on good writing, are
  empirical questions no injected fixture answers. C5 and C11 give my reasoned judgement and label it
  as such.
- **"Twenty / seventeen guards mutation-proved"** (`actions.md`) — claims about past actions, not
  reproducible. C12 is my own independent count: 43 attempted, 38 caught.

## Housekeeping

`git status` is clean apart from this file. `api/dist` was diffed against the pristine snapshot taken
before the sweep and is identical — every mutation was restored.

## Note on concurrent commits during this verification

Three commits landed on the branch while this pass ran (`8f2ce81`, `26f4ac1`, `2c26fce`). They are
doc-only and do not touch anything verified here:

```
$ git diff --stat 7fca865..HEAD -- api/src app/src api/test app/test
(empty)

$ git diff 7fca865..HEAD --stat
 .claude/actions.md                         |  64 ++++
 docs/qc-evidence/AC-resolve-the-0-of-12.md | 573 +++++++++++++++++++++++++++++
```

Every code finding above stands unchanged. **C13's two stale claims are still present at HEAD** and
were re-checked after those commits landed:

```
$ grep -n "NOT ON \`main\`|NOT DONE, and it is the one that moves" .claude/actions.md
5907: **BUILT on `claude/incumbent-wins-swap`, five commits, all pushed. NOT ON `main`. NOT RUN LIVE.**
5933: **NOT DONE, and it is the one that moves the owner's number:** `supportIn` — the PROFILE side.
```

Both remain REFUTED.
