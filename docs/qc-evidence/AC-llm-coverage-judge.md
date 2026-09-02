# AC — `llm-coverage-judge`

```
WHAT:          Acceptance criteria + feasibility table for replacing the lexical `coversIn`
               predicate with an LLM-derived, machine-verified coverage verdict.
               NOTE, and read S4 before planning from this line: the brief this pass was
               given asserts the change makes the GATE read the verdict via
               must_have_coverage / responsibilities_addressed / evidence_placed. MEASURED
               AND REFUTED -- `coversIn` feeds ONLY `evidence_placed`, which is a `warn`
               that cannot fail the gate. `must_have_coverage` (the gate-failing one) reads
               `ruleEvidenceOf`, the PROFILE side. The owner's "the gate should be included"
               therefore cannot be met by the work as scoped; OD-1 puts that choice to them.
WHY:           On the owner's live Trinnex packet the shipped ResumeSummary scores 0/19
               requirements covered while four are visibly paraphrased. Measured root cause:
               `coversIn` needs 70% LITERAL content-word overlap with no derivational
               morphology, so `strategy`!=`strategies`, `leadership`!=`leader`.
               See DIAG-coverage-recognition.md and FEASIBILITY-llm-judgement.md.
SUPERSEDES:    nothing. This is the AC pass for the work FEASIBILITY-llm-judgement.md §7 proposes.
SUPERSEDED-BY: nothing -- current.
EVIDENCE:      docs/qc-evidence/DIAG-coverage-recognition.md
               docs/qc-evidence/FEASIBILITY-llm-judgement.md
               branch claude/incumbent-wins-swap @ 44271bf
TIER:          1 (accusation grade). The tier holds even though S4 shows the scoped change
               does NOT reach the gate: it still admits model output into a STORED CLAIM
               shown to the owner, and asserts coverage of a named requirement. Either
               property alone is tier 1 under CLAUDE.md.
STATUS:        COMPLETE. Feasibility table (S1), design decisions (S2), ACs 1-21 (S3),
               SCOPE CONTRADICTION (S4 -- read this first), mutation register (S5),
               open decisions (S7). No code written; no commit; no branch change.
```

---
## 0. READ THIS FIRST — FOUR claims in the brief and the input docs are WRONG

I verified every load-bearing claim rather than repeating it. Four did not survive, and the fourth
is severe enough to have its own section.

> **THE BIG ONE IS IN S4, NOT HERE.** The brief states that replacing `coversIn` makes the GATE read
> the verdict. It does not: `coversIn` feeds only `evidence_placed`, a `warn` that cannot fail the
> gate, while `must_have_coverage` -- the gate-failing check -- reads `ruleEvidenceOf` (the PROFILE
> side) and never calls `covers()`. **Read S4 before planning any of this work.** The three below
> change the cost and the design; S4 changes what the work is.


### 0.1 REFUTED — "H12 stops you calling a model from `coversIn`"

The brief's constraint 1 and `FEASIBILITY-llm-judgement.md` §3 both treat H12 as the guard that
forces verdict injection. **It is not.** Read literally (`api/test/hardening.test.mjs:302-310`):

```js
test('H12: rule modules import neither @azure/functions nor pg', () => {
  for (const f of ['checks.ts','requirements.ts','swaps.ts','insertions.ts',
                   'artifactScore.ts','jdText.ts','termMatch.ts','evidence.ts']) {
    assert.ok(!/@azure\/functions/.test(body), `${f} must stay pure`)
    assert.ok(!/from '\.\/pgClient'/.test(body), `${f} must stay pure`)
```

It forbids **two import specifiers in eight named files**. It says nothing about `openaiJson`,
`fetch`, or network I/O of any kind. `import { openAiJson } from './openaiJson'` added to
`checks.ts` **passes H12 today**. Proof that the pattern is not hypothetical: `evidenceProposal.ts`
imports `contentJson` from `./openaiJson` (`:182`) and is **not in H12's list at all**.

**Consequence for the design — this is a real finding, not a nitpick.** The "inject, don't fetch"
discipline the whole plan rests on is currently **unguarded**. An implementer who reaches for the
convenient shape (call the model inside `coversIn`) gets a green suite. So the discipline has to be
*made* into a guard as part of this work (AC-10), not assumed to already be one.

Also note H12's list omits `requirementSupport.ts`, `figureEcho.ts`, `dimensions.ts` and
`remediation.ts` — all rule modules, none covered. The new guard should name the modules by role,
not extend a hand-written list that has already drifted.

### 0.2 REFUTED — A5, "`confirmed_at` is read by two places and written by nothing"

`DIAG-coverage-recognition.md` A5 says the confirm path does not exist, and
`FEASIBILITY-llm-judgement.md` §2 repeats it ("its only promotion path, `confirmed_at`, written by
nothing (A5)"). **The writer exists and is a registered route:**

| | evidence |
|---|---|
| writer | `appRequirements.ts:934` `insert into evidence_confirmation … on conflict … do update set withdrawn_at = null` |
| withdrawal | `appRequirements.ts:922` `update evidence_confirmation set withdrawn_at = now(), withdrawn_reason = $1` |
| route | `appRequirements.ts:948` `app.http('evidenceConfirm', { methods:['POST'], route:'app/requirement/{seq}/evidence-confirm' })` |
| reader | `appRequirements.ts:483` `c.confirmed_at as evidence_confirmed_at`; `checks.ts:806` `isConfirmed` |
| guard rail | `:913` refuses `method !== 'proposed'` with 409 — only a MODEL proposal is confirmable |
| tests | `test/evidenceConfirmDb.test.mjs`, 6 test blocks |

**What IS still absent is the FRONT END.** `grep -rn "evidence-confirm\|evidenceConfirm" app/src/`
returns **nothing**. So the accurate statement is `EXISTS-BUT-CONSTRAINED`: a human accuser is
wired end-to-end through the API and has no button. That is a materially different, and much
cheaper, situation than "written by nothing", and it changes what the owner's alternatives cost
(see Open Decision **OD-2**).

### 0.3 REFUTED — "the 948-test suite is the bulk of the work"

`FEASIBILITY-llm-judgement.md` §6.1 says *"948 api tests; every one exercising these functions needs
a fixture verdict map… it is not small."* Measured:

```
$ cd api && node --test test/*.mjs
# tests 948   # pass 930   # fail 0   # skipped 18   # duration_ms 16792
```

948 is exactly right. But the affected set is not:

| measure | count |
|---|---|
| test **files** naming `coversIn`/`coversText` | **2** (`remediation`, `hardening`) |
| test **blocks** touching `coversIn`/`coversText`/`must_have_coverage`/`evidence_placed`/`responsibilities_addressed` | **70 of 948 (7.4%)** |
| test blocks that must change **if the verdict input is optional and its absence keeps the lexical body** | **0** |

The last row is the design consequence and it is the whole cost argument. `runChecks` already takes
one `input` object; a new optional `input.coverageVerdicts` is `undefined` in every existing test,
so every existing test keeps exercising the lexical predicate unchanged. **The migration cost is
zero, and it is zero *by construction* — which is exactly why the ACs below forbid the alternative
shape (a required parameter, or a module-level default that fetches).**

---
## 1. FEASIBILITY TABLE — every dependency this work names

Verdicts: `EXISTS` / `ABSENT` / `EXISTS-BUT-CONSTRAINED` / `ALREADY BUILT`.

| # | Dependency | Producer (writes it) | Consumer today (reads it) | Proof (command + result) | Verdict |
|---|---|---|---|---|---|
| F1 | **The lexical predicate to replace** | `checks.ts:276` `coversIn`, `:286` `coversText` | `checks.ts:681` `covers()`, called at **`:905` only**, feeding **`evidence_placed` and nothing else** (NOT `must_have_coverage` -- see S4); `remediation.ts:334, 384, 478` | `grep -rn "coversIn\|coversText" api/src app/src` → **exactly 4 consumer sites, all in 2 files**. `app/src` has **zero**. | **EXISTS** — blast radius is genuinely small |
| F2 | **Transport-injected LLM module pattern** (keeps rule modules network-free) | `openaiJson.ts:37` `openAiJson(opts): FetchJson` (impure factory) | `evidenceProposal.ts:182` imports only `contentJson` + `type FetchJson`; the runner takes `fetchJson: FetchJson` as an option | `grep -n "export" api/src/functions/tests/openaiJson.ts` → `type FetchJson = (system,user)=>Promise<any>`; `evidenceProposal.ts` "still transport-injected, so the whole tier is exercisable without a network" | **ALREADY BUILT** — copy this exactly; do not invent a second shape |
| F3 | **Byte-exact citation verification** | model returns `{quote, source_key}` | `evidenceProposal.ts:122` `verifyProposal` → `rec.text.indexOf(quote)`, `-1` ⇒ `refuse('quote_not_in_record')`; no lower-casing, no normalisation, no fuzzy fallback | read `:140-150`. Also `:105` `buildProposalUser` filters `neverEvidence` **before** the prompt is built | **ALREADY BUILT** — the safety property the owner's word "evidenced" refers to already ships |
| F4 | **A typed refusal taxonomy incl. an outage that is not a "no"** | `evidenceProposal.ts` `EscalationOutcome` | the escalation runner | `grep -n "EscalationOutcome" -A 8` → `'accepted' \| 'refused' \| 'skipped' \| 'transport_failed' \| 'unparseable'`, with the comment *"'transport_failed' is deliberately its OWN outcome and never collapses into 'model_declined'"* | **ALREADY BUILT** — AC-7's "judge unavailable" case has a precedent to copy verbatim |
| F5 | **H12 as the purity guard the design leans on** | — | `hardening.test.mjs:302` | forbids only `@azure/functions` and `from './pgClient'` in 8 files. `evidenceProposal.ts` imports `./openaiJson` and **is not in the list** | **EXISTS-BUT-CONSTRAINED — see §0.1.** It does NOT block an LLM import in `checks.ts`. A new guard is required work, not a given |
| F6 | **Owner-settable `chk_*` prefs (no hardcoded config)** | `checkPrefs.ts:45+` `ENSURE_CHECK_COLUMNS_SQL`; `checkPrefColumns()` (`:34`) derives the writer whitelist **from the DDL itself** | `writeCheckPrefs` `:135`, `loadThresholds` `:158`, `resolveOptionsFor` `:210`; UI label map `app/src/screens/Settings.jsx:1584` | `grep -n "chk_evidence_escalate" api/src/.../checkPrefs.ts app/src/screens/Settings.jsx` → `chk_evidence_escalate boolean`, `chk_evidence_escalate_max int`, both with Settings labels | **ALREADY BUILT** — an LLM **on/off toggle + per-run cap** is a shipped precedent. Adding a column auto-exposes it to the API writer; only the Settings label needs adding |
| F7 | **A human confirm path for model output** | `appRequirements.ts:934` insert / `:922` withdraw | `:483` `evidence_confirmed_at`; `checks.ts:806` `isConfirmed`; `appChecks.ts:125` | route registered `:948` `app/requirement/{seq}/evidence-confirm`; refuses non-`proposed` with 409 (`:913`); tested in `test/evidenceConfirmDb.test.mjs` | **EXISTS-BUT-CONSTRAINED — see §0.2.** API complete; `grep -rn "evidence-confirm" app/src/` → **no UI caller**. A5 as written is stale |
| F8 | **Somewhere to store an artifact×requirement verdict** | `artifact_score` | `schema.ts:768` `uncovered_requirement_ids uuid[]`, `:774` `judged_requirement_ids uuid[]` | both are bare `uuid[]` — **no column can hold a basis, a quote, a reason, a model id or a prompt version** | **EXISTS-BUT-CONSTRAINED** — cannot carry the payload, so a new `requirement_coverage` row is justified rather than duplicative. State that reasoning in the commit (Extend-don't-duplicate) |
| F9 | **The display surface** | — | `app/src/screens/AssetBlocks.jsx:1147-1158` — the *"Posting line(s) answered"* block, `reqs.map(r => <ReqChip …/>)` at `:1152`, `<ReqLegend reqs={reqs}/>` at `:1157` | read the region | **EXISTS** — extend `ReqChip`/`ReqLegend`; a new panel would be a parallel surface |
| F10 | **The requirement-kind partition the judge must respect** | `buildRequirements` | `checks.ts:736` `eligibility` (via `ELIGIBILITY_RE` `:261`), `:737` `coverable = mustHaves − eligibility − resolvedByFact − ownedByFacts` | read `:728-737` | **EXISTS** — the judge must be handed `coverable` and `resp`, never raw `mustHaves` (AC-4) |
| F11 | **The `not_applicable` discipline the judge must not break** | — | `checks.ts:687-691` `na(...)` when `!reqs.length`; `:820-821`; `:909-911` | read; comment at `:687` *"AC 2.1.9 — a coverage check with nothing to check against is unknown, not OK"* | **ALREADY BUILT** — reuse `na()`, do not invent a new state |
| F12 | **The deterministic test bed** | — | `api/test/*.mjs` | `node --test test/*.mjs` → **948 tests, 930 pass, 0 fail, 18 skipped, 16.8s**; 70 blocks touch the concept; **0 must change** if the verdict input is optional | **EXISTS** — and §0.3 refutes the "bulk of the work" costing |
| F13 | **Live Trinnex rows, to prove the acceptance bar** | live Postgres `requirement` / `artifact` | — | **NOT REACHABLE from this pass.** No `mcp__boost-pg-mcp-write__*` tool is loaded in this context; the only Postgres MCP surfaced is `Azure_pg_mcp`, which is the **wrong database** (`RAG_AI_Agents`) and unauthenticated | **EXISTS-BUT-CONSTRAINED — PRE-FLIGHT, see §2** |

### 1.1 PRE-FLIGHT the implementer must clear BEFORE writing code (CLAUDE.md, boost-pg-mcp-write rule)

**The acceptance bar in §4 cannot be evaluated without live Postgres.** The exact `verbatim` /
`item_text` of Trinnex requirements #7, #9, #12, #15 and the exact shipped `ResumeSummary` are DB
rows. This AC pass could not read them, and says so rather than routing around it.

Queries the implementation step needs, named up front:

```sql
-- 1. the four rows, as the gate actually sees them
select seq, kind, verbatim, item_text from requirement
 where opp_id = '<trinnex opp_id>' and seq in (7,9,12,15) order by seq;
-- 2. the document the judge is asked about
select type, merge_field, text from artifact_field  -- or the artifact row carrying ResumeSummary
 where packet_id = '<trinnex packet_id>';
-- 3. the corpus baseline for the regression guard
select count(*) from requirement where kind='must_have';
```

**Nudge, not a detour:** ask the owner to refresh `boost-pg-mcp-write` (~1s/query) before the
implementation step starts. `db-query.yml` is the fallback and is the owner's call, not the
implementer's.

### 1.2 What I could reproduce WITHOUT the DB, and what it proves

Probe `/tmp/trinnex_probe.mjs` against `api/dist`, requirement text taken from
`DIAG-coverage-recognition.md` (a derived source — stated, not hidden):

```
COVERAGE_THRESHOLD = 0.7   MIN_JUDGEABLE_TOKENS = 3
#15  3/5 = 0.60  covers=false   HIT: align, engineering, business   MISS: strategy, goals
#9   4/7 = 0.57  covers=false   HIT: build, high-performing, engineering, teams
                                MISS: develop, managers, technical
sameWord('strategy','strategies') = true      sameWord('leadership','leader')  = false
sameWord('management','manager')  = false     sameWord('governance','govern')  = false
sameWord('delivery','deliver')    = false     sameWord('operations','operate') = false
sameWord('engineering','engineer')= true      sameWord('goals','objectives')   = false
```

**#15 (0.60) and #9 (0.57) reproduce the DIAG's numbers exactly**, and all five derivational
failures reproduce exactly. **#12 and #7 did NOT reproduce** — I got 0.50 and 0.40 against the
DIAG's 0.67 and 0.50, because my reconstructed requirement text is not the stored row. That is a
limit of this pass, not a contradiction of the DIAG: the *direction* (fails) is identical and the
*mechanism* (derivational miss) is confirmed. **AC-1 therefore states the required verdicts, not
the ratios**, and the implementer re-measures the ratios against the real rows.

**A new observation the input docs do not record:** `itemTokens` does **not de-duplicate**. On my
#12 text it returned `engineering` twice, counted in both numerator and denominator. A requirement
that repeats a word therefore gets that word double-weighted in the coverage ratio. Not load-bearing
for this change, but it is a second latent defect in the same predicate, and the judge replacing that
predicate must not silently inherit it — captured as AC-13.

---
## 2. THE DESIGN QUESTIONS THE BRIEF ASKS — answered from source, before the ACs

These are not preferences. Each is settled by reading the code, and each one constrains an AC.

### 2.1 What exactly is the judged text? — per artifact today; judge per FIELD and reconcile upward

`checks.ts:478` `const allText = present.map(f => String(pkg[f])).join('\n')` then `:662`
`const covText = normalizePostingText(allText).toLowerCase()`. **Coverage today is decided over the
whole artifact's present fields joined with newlines.** The owner's display (`ReqChip`, F9) is
per-field. They are reconciled like this and only like this:

- **Judge per (requirement, FIELD)**, in one call per artifact that carries every field labelled and
  every requirement. This is the finest granularity, so the artifact answer is derivable from it
  (`covered_at_artifact = OR over fields`) while a per-field answer is *not* derivable from an
  artifact-level one. Judging at artifact level and attributing afterwards is the shape that
  produces a chip with no field to hang on.
- **The citation must be byte-exact inside exactly ONE named field**, because that is what makes it
  verifiable (F3) and what makes the chip point somewhere.

**The one honest cost of this choice, stated because it is a real semantic change:** the joined
string can cover a requirement whose support is split across two fields; per-field + OR cannot.
The narrowing is in the SAFE direction (fewer coverage claims, never more), but it must be
**measured, not assumed** — AC-12.

### 2.2 Which requirement kinds does the judge see? — `coverable` and `responsibility` ONLY

Measured, `checks.ts`:

| kind | judged by `coversIn` today? | evidence |
|---|---|---|
| `must_have` minus eligibility minus fact-resolved = **`coverable`** | **yes** | `:737` `coverable = mustHaves.filter(r => !eligibility.includes(r) && !resolvedByFact.has(r.seq) && !ownedByFacts.has(r.seq))` |
| `responsibility` (**`resp`**) | **yes** | `:748` `const resp = reqs.filter(r => r.kind === 'responsibility')` |
| eligibility rows (`ELIGIBILITY_RE`, `:261`) | **no — split out at `:736` BEFORE coverage** | comment at `:728`: "Split preconditions out BEFORE judging coverage" |
| rows the owner's FACTS settle | **no** | `:737`, and the `checkAgainstFacts` block above it |
| **`nice_to_have`** | **NO — `grep -n "nice_to_have" checks.ts` returns nothing** | it is in no coverage set |

**So the judge is handed `coverable` and `resp`, and nothing else.** Two traps this closes:

- Sending eligibility rows to a model is the exact thing `verifyProposal` refuses first
  (`:132` `if (requirementClass(requirement)) return refuse('requirement_class')`, where
  `requirementClass` returns `'eligibility'` or `'numeric'`). A model must never settle residence,
  work authorisation or a clearance from prose.
- **Adding `nice_to_have` to the judged set would be a scope expansion disguised as a bug fix**, and
  it would move a count the owner reads. If it is wanted, it is a separate owner decision (OD-C).

### 2.3 Does the judge see the PROFILE? — NO. Document only.

This is the single most important boundary in the design, and the codebase already keeps it:

| check | the question it asks | source |
|---|---|---|
| `must_have_coverage` / `evidence_placed` | *does this DOCUMENT say it* | `covText` is built from `pkg` (the artifact), never from profile records |
| `responsibilities_addressed` / `supportIn` | *does the PROFILE evidence it* | `evidence.ts`, `requirementSupport.supportIn` |

Show the judge the profile and it will answer *"the candidate has this"* while being asked
*"the document says this"* — collapsing two checks that exist in order to be able to disagree.
**The judge's prompt contains the requirement and the artifact's field texts. Nothing else.** AC-5
makes that structurally enforced, not merely instructed, because a prompt instruction is not a guard.

### 2.4 Determinism at the gate — the storage key, exactly

A threshold answers identically twice; a model may not. The verdict is stored and keyed on a
**content hash over everything that could change the answer**:

```
verdict_key = sha256([
  requirement_text,        // verbatim ?? item_text -- the exact string judged
  field_name,              // per 2.1
  field_text,              // the exact document text judged
  model_id,                // from chk_coverage_judge_model
  prompt_version,          // a constant bumped BY HAND when the prompt changes
  judge_contract_version,  // bumped when the parsed shape or the verification rule changes
].join(' '))
```

Omitting `model_id` or `prompt_version` is the classic version of this bug: the prompt is improved,
every cached verdict silently keeps the old answer, and the gate reports a state no current code
would produce. `sha256` already exists in `evidence.ts` (imported by `evidenceProposal.ts:181`) —
reuse it, do not add a second hashing utility.

**On a cache miss mid-run:** the run either judges the miss or it does not. It must never fill the
hole with the lexical answer *and present the result as a judge verdict* — that is two predicates
inside one number. See AC-7.

### 2.5 What does the owner see when the judge and the lexical rule DISAGREE?

They disagree on all four Trinnex rows **by construction** — that is the point of the change. The
old answer must be **retained and shown**, not overwritten:

- store `lexical_covered boolean` alongside `covered boolean` on the same verdict row;
- where they differ, the chip says so, and the reason is the judge's `basis` value.

This costs one column, and it is what makes the first production run an experiment rather than a
leap. Without it there is no way to tell a judge that is working from a judge that says yes to
everything — which is exactly what AC-2 and AC-3 exist to catch.

---
## 3. ACCEPTANCE CRITERIA

Binary, observable, and each one names how it is checked. "Works correctly" is not an AC and does
not appear below. Every AC that creates a guard carries the **mutation** that proves the guard is
not inert — per CLAUDE.md, *the one step never skipped at any tier*.

Naming: H-cases take **slugs, never numbers** (`H26` fails the suite on a new numeric id).

### Group A — the acceptance bar on the owner's real packet

> **These four are evaluated on the LIVE Trinnex rows.** They cannot be satisfied against
> reconstructed text (see §1.2, where two of the four ratios did not reproduce). Clear the §1.1
> pre-flight first.

**AC-1.** Given the live Trinnex packet's `ResumeSummary` and requirement **#15**
(*align engineering strategy with business goals*), when the coverage judge runs, then the stored
verdict for (#15, `ResumeSummary`) has `covered = true`, `basis` in
`{direct, synonym, near_phrasing}`, and a `quote` that `fieldText.indexOf(quote) !== -1` — verified
by the code, not by reading the model's answer.

**AC-2.** Given the same packet and requirement **#12**
(*Engineering & Technology Leadership - proven experience leading software engineering
organizations*), when the judge runs, then `covered = true` with a verified `quote` drawn from the
summary's *"Visionary technology leader…"* clause.

**AC-3 — THE MOST IMPORTANT AC IN THE SET.** Given the same packet and requirement **#9**
(*Build and develop high-performing engineering managers and technical teams*), when the judge runs,
then the stored verdict is **`covered = false`**, and no verdict anywhere in the run claims coverage
of #9 for any field of any artifact.

> Rationale, and why this outranks AC-1/AC-2: the summary genuinely does not say *managers* or
> *technical*. **A judge that passes #9 fabricates coverage in a document a person sends to an
> employer**, and is strictly worse than the 0-of-19 threshold it replaces. If AC-3 fails, the work
> does not ship regardless of how many other rows improved.
>
> **Mutation proof required:** hand the judge a summary edited to add *"…and technical managers"*
> and confirm the same requirement then returns `covered = true`. A guard that reports `false` for
> #9 because the judge always returns `false` is inert, and this mutation is the only thing that
> distinguishes the two.

**AC-4.** Given requirement **#7** (*Identify opportunities to apply emerging technologies*), when
the judge runs, then **either verdict is accepted**, but the stored row carries a non-empty `basis`
and, when `covered = true`, a verified `quote`; and the rendered chip shows both the basis and the
quote. (`apply`/`leverage` and `goals`/`objectives` are defensible either way; what is not
defensible is a verdict with no shown reason.)

**AC-5 — adversarial, name-drop.** Given a synthetic artifact field whose text is
*"I am interested in engineering managers, technical teams, governance, machine learning operations
and modern software delivery practices."* — every distinctive noun of the Trinnex posting, with no
claim of having done any of it — when the judge runs against the Trinnex requirements, then
**at most 0 requirements are returned `covered = true`**, and this case is a permanent fixture in
`api/test/`.

> This is the case the lexical predicate would have PASSED (it is pure vocabulary overlap, which is
> all `coversIn` measures) and the case a naive judge also passes. It is the sharpest available
> discriminator between "recognises meaning" and "recognises words", and it must be in the suite,
> not run once by hand.
>
> **Mutation:** rewrite the same fixture as a genuine claim (*"I built and developed high-performing
> engineering managers and technical teams…"*) and confirm coverage is then returned. Without this
> the fixture passes for a judge that always says no.

### Group B — the safety properties (these are what make TIER 1 defensible)

**AC-6 — the citation is machine-verified, never trusted.** Given a model verdict claiming
`covered = true` with a `quote`, when the verdict is parsed, then the quote is checked with
`fieldText.indexOf(quote)` against the **original, un-normalised** field text, and a quote not
found is **REFUSED** (`covered` forced to a refusal outcome, never to `true`), with the refusal
reason stored.

- **Extend, don't duplicate:** this is `evidenceProposal.verifyProposal` (`:122`) — *"`indexOf` on
  the ORIGINAL record text — no lower-casing, no normalization, no fuzzy fallback"*. Reuse that
  discipline and its refusal vocabulary. A second verification implementation drifts, and the day it
  drifts one of them accepts a quote the other would refuse.
- **Never repair a near-miss quote.** No trimming whitespace until it matches, no nearest-span
  search. `evidenceProposal`'s own comment states the reason: repairing *"would be the module
  inventing provenance on the model's behalf"*.
- **Mutation:** feed a verdict whose `quote` has one character changed; the suite must fail if that
  verdict is accepted.

**AC-7 — the judge being unavailable can never turn a gate green.** Given the judge errors, times
out, returns unparseable JSON, returns fewer verdicts than requirements, or is switched off by
`chk_coverage_judge_enabled = false`, when `runChecks` produces `must_have_coverage`,
`responsibilities_addressed` and `evidence_placed`, then **no requirement lacking a verdict is
counted as covered**, and the three checks resolve as follows:

| judge state | result | why |
|---|---|---|
| **disabled** by the owner's setting | the **lexical** predicate decides, exactly as today, and the check's `detail` says the judge is off | the owner turned it off; the previous behaviour is the correct fallback and is stricter, not looser |
| **enabled, transport failed / unparseable / partial** | the affected checks are **`not_applicable`** via the existing `na(...)` helper, with the reason naming the failure | CLAUDE.md: *"Absent evidence is `not_applicable`, never `pass`"*. A gate green because the judge was unreachable is the worst outcome available here |
| **enabled, verdict says not covered** | `fail`, as today | a real answer |

- The judge's outcome type **must** distinguish transport failure from a negative verdict, copying
  `EscalationOutcome`'s `'transport_failed'` (F4) which exists precisely because *"a tier that
  stores them the same way records an outage as an absence of evidence"*.
- **A partial batch is a failure of the batch, not a set of absences.** 21 requirements in, 19 out,
  means 2 requirements have no answer — and no answer is `not_applicable`, never `false` and never
  `true`.
- **Mutation, two of them:** (i) make the transport throw and confirm the check is `not_applicable`
  and NOT `pass`; (ii) return a verdict array missing one requirement and confirm the same.

**AC-8 — the gate does not flicker.** Given the same (requirement, field, field text, model,
prompt version, contract version), when a build is run twice, then the second run reads the stored
verdict rather than re-judging, and `must_have_coverage` is byte-identical across the two runs.

- Key exactly as §2.4. **Mutation:** change `prompt_version` alone and confirm the verdict is
  re-judged rather than served from cache. A key that omits the prompt version is the specific bug
  this proves absent.
- **Mutation 2:** change one character of the field text and confirm a re-judge.

**AC-9 — the judge sees the document and nothing else.** Given the judge prompt is built, when its
full text is inspected, then it contains the requirement text and the artifact's field texts, and
contains **no profile record, no owner fact, and no `neverEvidence` source** — asserted by a test
that builds a prompt with a poisoned profile in scope and greps the produced string for it.

> §2.3 is the reason. Also: eligibility and numeric rows are excluded **before the prompt is built**,
> mirroring `buildProposalUser`'s rule that a banned record *"is not shown at all, rather than shown
> and rejected afterwards"* — a model cannot decline to judge what it was never given.
>
> **Mutation:** add a profile record to the builder's inputs and confirm the assertion fails.

**AC-10 — the rule modules still cannot reach the network, and this is now GUARDED.** Given the
implementation is complete, when the hardening suite runs, then a new case
`test('H:coverage-judge-injected: …')` asserts that `checks.ts` imports **no LLM transport**
(`./openaiJson`, `./mailWatch`, a bare `fetch(`) and that the judge module takes its transport as an
injected `FetchJson` parameter rather than constructing one.

> **This is required work, not an existing guarantee — see §0.1.** H12 as written would let
> `import { openAiJson } from './openaiJson'` into `checks.ts` pass. Write the new case to name the
> transport modules by role and to cover `checks.ts`, `remediation.ts`, `requirementSupport.ts`,
> `evidence.ts` and `figureEcho.ts` — H12's hand-written list has already drifted and must not be
> the model for a new one.
>
> **Mutation:** add the import to `checks.ts` and confirm the suite fails. This mutation is the
> whole value of the AC; without running it the case is a comment.

### Group C — no regression on what is correct today

**AC-11 — the existing suite is unchanged and still green.** Given the implementation is complete,
when `cd api && node --test test/*.mjs` runs, then the result is **`# tests` ≥ 948, `# fail 0`**,
and the number of *pre-existing* test blocks that had to be MODIFIED is **0**.

> Baseline measured this pass: `# tests 948 # pass 930 # fail 0 # skipped 18`. §0.3 shows zero
> modifications are achievable, and this AC is what holds the design to the shape that achieves it:
> the verdict arrives as an **optional** field on the existing `runChecks` input, and its absence
> keeps the lexical body. A design requiring a mandatory parameter, or a module-level default that
> fetches, fails this AC — which is the point.

**AC-12 — the lexical predicate itself is not weakened.** Given the change is complete, when
`checks.ts` is read, then `COVERAGE_THRESHOLD` is still `0.7`, `MIN_JUDGEABLE_TOKENS` is still `3`,
the distinctive-token rule (`toks.filter(tk => tk.length >= 6)`) is still present, and the three
existing assertions on them still pass unmodified.

> The judge **replaces the predicate for this decision**; it does not lower the bar of the old one.
> The 0.5→0.7 raise fixed a real false positive (the *"digital water technology"* case, documented at
> `checks.ts:665-673`), and that case must still fail. **Re-run it explicitly** — it is the closest
> thing this repo has to a known over-matching example, and the new judge must also reject it.

**AC-13 — the checks that are correct today do not move.** Given a build of the Trinnex packet
before and after the change, when the check results are compared, then
`skill_char_limit`, `skill_list_count`, `expertise_phrase_length` and `compact_skills_fit` have
**identical state, detail and offenders**.

> These are the surfaces the owner has measured as correct in production. The change touches
> `covers()` only; this AC is the evidence that it did, rather than the claim that it did.

**AC-14 — the per-field narrowing is measured, not assumed.** Given the corpus of existing packets,
when artifact-level coverage computed as `OR over per-field verdicts` is compared against coverage
computed over the joined `allText`, then the count of requirements where they differ is **reported
as a number**, and any difference is in the direction of **fewer** coverage claims.

> §2.1 states this narrowing is real. An AC that says "it should be fine" is the banned kind. If the
> number is large, that is an owner decision (OD-D), not something to absorb silently.

**AC-15 — the lexical answer is retained and shown beside the judge's.** Given any stored verdict,
when it is read, then it carries both `covered` (the judge) and `lexical_covered` (what `coversIn`
would have said), and the UI renders the disagreement where they differ.

> §2.5. This is what makes the first production run an experiment. **No dead UI:** if the
> disagreement indicator is rendered it is wired to the stored column, not to a placeholder.

### Group D — configuration, storage, display

**AC-16 — nothing tunable is hardcoded.** Given the judge ships, when the owner opens Settings, then
**every** behaviour-affecting value is a `chk_*` column with a Settings control:

| setting | type | what it does |
|---|---|---|
| `chk_coverage_judge_enabled` | boolean | off ⇒ pure lexical, exactly as today (AC-7 row 1) |
| `chk_coverage_judge_model` | text | model id; participates in `verdict_key` (§2.4) |
| `chk_coverage_judge_max_calls` | int | per-run cap, the `chk_evidence_escalate_max` precedent |
| `chk_coverage_judge_min_quote_chars` | int | the `minQuoteChars` that `verifyProposal` already takes |

> **Extend, don't duplicate:** `checkPrefColumns()` (`checkPrefs.ts:34`) derives the writer's
> whitelist **from the DDL statement itself**, so adding the column is sufficient on the API side;
> only the `Settings.jsx:1584` label map needs a line. `chk_evidence_escalate` /
> `chk_evidence_escalate_max` are the shipped precedent for exactly "an LLM feature toggle plus a
> cap" (F6). Do **not** create a parallel settings store.
>
> Temperature and max-tokens: **if the implementation pins them, they are `chk_*` columns too**; if
> the transport's existing defaults are used unchanged, say so and record the owner's approval
> rather than burying a literal.

**AC-17 — the verdict has a home that can hold it.** Given a verdict is stored, when the row is
read, then it carries at minimum `artifact_id`, `run_id`, `requirement_id`, `field_name`, `covered`,
`lexical_covered`, `basis`, `quote`, `char_start`, `char_end`, `why`, `verdict_key`, `model_id`,
`prompt_version`, `refusal_reason`.

> **The "extend" check was done and is recorded here so it is not re-litigated:** the existing home
> for artifact×requirement coverage is `artifact_score.uncovered_requirement_ids` (`schema.ts:768`)
> and `judged_requirement_ids` (`:774`). Both are bare `uuid[]` with **nowhere to put a basis, a
> quote, a reason or a version**. They cannot carry this payload, so a new `requirement_coverage`
> table is justified rather than duplicative — and that justification belongs in the commit message.
>
> **Schema rule (CLAUDE.md, strict):** the DDL is not verified until it has been executed against a
> POPULATED database with `main`'s schema already applied — `psql -v ON_ERROR_STOP=1`, exit 0. A
> fresh-database success proves almost nothing because every `create table if not exists` is
> skipped on the database that matters. Register the new table in `EXPECTED_TABLES` -- **H11**
> (`hardening.test.mjs:279`) fails a table missing from either list, in both directions.

**AC-18 — the display is wired and per-line.** Given an artifact field with judged requirements,
when its block renders, then the existing *"Posting line(s) answered"* region
(`AssetBlocks.jsx:1147-1158`) shows, per requirement: covered/absent, the `basis`, and the verified
`quote` from that field — sourced from the stored verdict, with **no hardcoded counts, names or
statuses**, and no control that is not wired.

> Extend `ReqChip` (`:1152`) and `ReqLegend` (`:1157`). A new panel beside them would be the
> parallel-surface failure this repo's `CLAUDE.md` names twice.

**AC-19 — the owner's prompts are untouched.** Given the change is complete, when the diff is read,
then it contains **no read of and no write to the Azure Storage `Prompts` table**, and the judge's
prompt is a new constant in this repo carrying an explicit `prompt_version`.

**AC-20 — cost and latency are measured, not estimated.** Given one full Trinnex packet build, when
it completes, then the recorded numbers are: judge calls made, requirements judged, tokens in/out,
wall-clock added, and cache hits on a second identical build (which must be **calls = 0**, per
AC-8).

> The brief's figures — 21 judgeable requirements, 4 artifacts, 4 calls per packet — are
> **unverified by this pass** (F13: no live DB access). Batching per artifact gives
> `calls = artifacts` rather than `artifacts × requirements`; with per-field judging inside one call
> per artifact (§2.1) that stays 4, but the prompt is larger. Measure it; do not repeat the estimate.

---
## 4. THE SCOPE IS INTERNALLY CONTRADICTORY — the owner's "the gate should be included" CANNOT be met by the work as scoped

This is the most consequential finding of this pass, it refutes the brief directly, and it must be
settled **before** any code is written. It is exactly the failure the *"Feasibility BEFORE
implementation"* rule exists to catch: work that is scoped, agreed, started, and parked hours later
when a premise turns out to be false.

### 4.1 The claim

The brief, SCOPE item 2:

> *"`coversIn` / `covers()` consume that verdict and **the gate reads it** — `must_have_coverage`,
> `responsibilities_addressed` and `evidence_placed` all change behaviour."*

**Two of those three do not call `coversIn`, and the one that does cannot fail the gate.**

### 4.2 The measurement

`grep -n "covers(" api/src/functions/tests/checks.ts` returns **three lines, and only one is a call**:

```
758:     * coverage. `covers()` is kept below, where it answers the different question it is actually
896:      // `covers()` cannot judge a requirement with fewer than MIN_JUDGEABLE_TOKENS content words
905:      const unplaced = placeable.filter(r => !covers(r))     <-- the ONLY call
```

What each of the three checks is actually computed from:

| check | its numerator, read from source | severity passed | reaches gate `fail`? |
|---|---|---|---|
| **`must_have_coverage`** | `:827` `const unevidenced = coverable.filter(r => !ruleEvidenceOf(r))` — **PROFILE evidence rows** | `:867` `bad(...)` with **no severity arg** ⇒ default | **YES** |
| **`responsibilities_addressed`** | `:878` `const unaddressed = resp.filter(r => !ruleEvidenceOf(r))` — **PROFILE evidence rows** | `:882` `'warn'` | no |
| **`evidence_placed`** | `:905` `const unplaced = placeable.filter(r => !covers(r))` — **the only `coversIn` consumer** | `:913` `'warn'` | no |

The two supporting facts, both read from source:

```
:192  const bad = (key, observed, expected, offenders, state: CheckState = 'fail') =>
        ({ check_key: key, engine: 'deterministic', state, observed, expected, offenders })
:1025 if (results.some(r => r.state === 'fail' && r.engine === 'deterministic')) return 'fail'
:1026 if (results.some(r => r.state === 'warn' || (r.state === 'fail' && r.engine === 'reviewer'))) return 'warn'
```

So: `bad()` defaults to `'fail'` + `engine:'deterministic'`, which is precisely the pair `:1025`
turns into a gate `fail`. `must_have_coverage` takes that default. The other two explicitly pass
`'warn'` and can only ever produce a gate `warn`.

### 4.3 What this means, stated as plainly as I can

> **Replacing `coversIn`'s body changes exactly ONE check — `evidence_placed` — and that check is a
> `warn` that cannot fail the gate. The work as scoped does not touch the gate at all.**

It also removes the last support for a claim already flagged in `DIAG-coverage-recognition.md`:
`coversIn`'s own docstring (`checks.ts:271-274`) says it is *"the SAME predicate that decides
`must_have_coverage` and therefore the gate"*, and the comment at `:666` repeats it. **Both are
stale.** The DIAG spotted this ("which it is not"); the brief did not carry it forward, and built a
scope on the stale docstring instead. Fixing those two comments is part of this work regardless of
what the owner decides below.

### 4.4 Why `covers()` was taken OFF the gate — this was deliberate and it is documented

`checks.ts:752-760`, verbatim:

> *"A requirement is covered when a VERBATIM excerpt of the candidate's stored profile can be shown
> beside it — not when the generated document happens to repeat enough of its words. The old
> numerator was a statement about the document, and **a document can be made to contain any words at
> all; that is precisely how a claim the profile cannot support got counted as coverage.** `covers()`
> is kept below, where it answers the different question it is actually good for: of the things the
> profile DOES evidence, which ones reached this asset."*

This is not an accident to be corrected. Somebody moved `must_have_coverage` off the document and
onto the profile **because the document is the thing the system itself writes**, and a generator
optimising against a document-only gate closes requirements by copying — which is `DIAG` group C
(`C1`: *"copying is the only strategy that terminates the loop"*) arriving from the other direction.

### 4.5 The consequence: there are only three ways to satisfy "the gate should be included"

None of them is the scoped work, and they are not equivalent. **This is the owner's call (OD-1).**

| option | what changes | what it costs | my read |
|---|---|---|---|
| **(i) Judge the DOCUMENT, and re-point `must_have_coverage` at it** | `:827` numerator moves from `ruleEvidenceOf` back to `covers()`, now judge-backed | **Reverts the documented decision in §4.4 and re-opens the copy-to-pass hole**, now with a model that accepts paraphrase — so the generator can close a requirement by *rephrasing the JD*, which no longer even requires copying to be detectable by `figureEcho` (`B1`, 8-token runs) | **Do not do this.** It is the one change that makes the measured failure mode worse rather than better |
| **(ii) Judge the PROFILE side (`supportIn` / `ruleEvidenceOf`)** | the judge decides *does the profile evidence this*, which is what `must_have_coverage` already reads | This is defect **A2** and the brief's OUT-of-scope "next lane". The citation machinery (`buildProposalUser` / `verifyProposal`) is **already built for exactly this shape** (F2, F3) — it is arguably *less* new code than the scoped work | **This is the option that actually reaches the gate**, and it is the one the existing machinery was written for |
| **(iii) Ship the scoped work with the gate untouched, look at real verdicts, then decide** | `evidence_placed` improves; the count and the display the owner asked for appear; `must_have_coverage` unchanged | Nothing irreversible. Costs one extra decision point | **Recommended.** It is `FEASIBILITY-llm-judgement.md`'s own §"what deliberately comes LATER" — and that section was written *before* anyone knew `coversIn` was not on the gate, which makes it more right than its author knew |

**The owner has already been asked a version of this and answered "the gate should be included."**
That answer was given against a description in which replacing `coversIn` *was* changing the gate.
It is not. **This is new information that post-dates the instruction, so it is a question to re-ask,
not a decision to re-litigate** — and the honest framing is: *"including the gate" means option (ii),
the profile side, which is the lane you were told was next.*

### 4.6 What this does to the ACs above

Nothing is withdrawn, but two are re-scoped and one caveat is added:

- **AC-1 / AC-2 / AC-3 / AC-4 / AC-5 stand unchanged.** They are about the judge's verdicts, which
  exist and are stored and displayed regardless of which check reads them.
- **AC-7's table is correct as written but currently applies to `evidence_placed` only.** If the
  owner picks (i) or (ii), the same table applies to `must_have_coverage`, and its stakes rise from
  "a warn" to "a packet cannot ship" — which is why AC-7's mutations are mandatory either way.
- **A new AC applies immediately, under any option:**

**AC-21.** Given the change is complete, when `checks.ts:271-274` and `:666` are read, then neither
claims that `coversIn` / `covers()` decides `must_have_coverage`, and a hardening case
`test('H:covers-is-not-the-gate: …')` asserts that the `must_have_coverage` numerator does not call
`covers(` — so the docstring cannot go stale again in the same direction.

> **Mutation:** re-point the `must_have_coverage` numerator at `covers()` and confirm the suite
> fails. This guard is worth having under every option: under (iii) it holds the boundary, and under
> (i) or (ii) it must be deliberately and visibly amended rather than silently drifted past.

---
## 5. MUTATION REGISTER — every new guard, and the exact mutation that proves it is not inert

CLAUDE.md: *"THE ONE STEP THAT IS NEVER SKIPPED, AT ANY TIER."* Write the guard, revert the
behaviour it guards, confirm the suite **FAILS**, restore. An inert guard is worse than no guard
because it is believed. Where a mutation is behaviourally equivalent and correctly fails to fail,
say so and do not claim the assertion is proven.

| AC | Guard | Mutation that must make the suite FAIL |
|---|---|---|
| AC-3 | #9 stays absent | Edit the fixture summary to add *"and technical managers"*; the judge must then return `covered = true`. Without this, a judge that always says `false` passes AC-3 |
| AC-5 | name-drop is not coverage | Rewrite the same fixture as a genuine claim; coverage must then be returned |
| AC-6 | citation verified byte-exact | Alter one character of a `quote`; an accepted verdict must fail the suite |
| AC-7a | transport failure is not a pass | Make the injected `fetchJson` throw; the check must be `not_applicable`, and asserting `pass` must fail |
| AC-7b | a partial batch is not a set of absences | Return N-1 verdicts for N requirements; the missing one must be `not_applicable`, not `false` |
| AC-8a | cache key includes the prompt version | Bump `prompt_version` only; a cache HIT must fail the suite |
| AC-8b | cache key includes the field text | Change one character of field text; a cache HIT must fail the suite |
| AC-9 | the judge never sees the profile | Add a profile record to the prompt builder's inputs; the prompt-content assertion must fail |
| AC-10 | rule modules stay transport-free | Add `import { openAiJson } from './openaiJson'` to `checks.ts`; the suite must fail. **This is the mutation that matters most, because §0.1 proves the suite passes today with that import present** |
| AC-12 | the lexical bar is not lowered | Set `COVERAGE_THRESHOLD = 0.5`; the existing assertions must fail |
| AC-21 | `covers()` is not the gate | Re-point the `must_have_coverage` numerator at `covers()`; the suite must fail |

---

## 6. SCOPE — where I agree with the brief, and where I do not

### Agreed OUT, and the brief's reasoning is sound

- **`locate()` / `ANCHOR_THRESHOLD`.** It returns `char_start` / `char_end` and the evidence spine
  depends on those offsets being exact. Models are unreliable at character offsets. Hybrid at most:
  the model picks the sentence, **code finds the offsets**. Agreed without reservation.
- **`similarity()` / `SWAP_THRESHOLD` / `ATTRIBUTION_THRESHOLD`.** This is RANKING, which CLAUDE.md
  explicitly permits to be fuzzy (*"Fuzzy matching is for RANKING, never for ACCUSING"*). Agreed.

### DISAGREED — `supportIn` / `EVIDENCE_THRESHOLD` cannot stay out if the gate is in

The brief scopes out the profile side as *"the NEXT lane, not this one"*, while simultaneously
requiring that **the gate reads the judge**. §4 shows those two statements cannot both hold:
`must_have_coverage` — the only gate-failing check of the three — reads `ruleEvidenceOf`, i.e. the
profile side, and nothing else.

**So the OUT list and the owner's instruction are in direct conflict, and one of them has to move.**
I am not asserting which; §4.5 lays out the three options and OD-1 puts the choice to the owner. What
I will not do is write ACs that quietly satisfy the letter of the scope while missing what the owner
actually asked for.

### Noted, not disputed — `scanWording` (B1)

Genuinely a later lane, and I agree it is out. One dependency worth recording now, because it bites
under option (i) in §4.5: if a judge-backed document predicate ever returns to the gate, the
anti-copying detector becomes load-bearing, and `figureEcho.ts:466`'s **8-consecutive-exact-token**
rule provably cannot see phrase-level lifting (`DIAG` B1: *"a summary stitched from short JD phrases
closes a requirement with 0 offenders"*). **B1 is a prerequisite of option (i), not a successor to
it.** Under options (ii) and (iii) it stays an independent lane.

---

## 7. OPEN DECISIONS FOR THE OWNER

Each row: the decision, my recommendation, and what it costs. Numbered so they can be answered by id.

### OD-1 — "the gate should be included": which gate, given `coversIn` is not on it?

**This is the blocking one. Nothing should be built until it is answered.**

Replacing `coversIn` changes only `evidence_placed`, a `warn` that cannot fail the gate (§4.2). The
gate-failing check, `must_have_coverage`, is decided by whether your **profile** evidences the
requirement — not by what the document says.

| option | recommendation | cost |
|---|---|---|
| (i) put the judged **document** predicate back on `must_have_coverage` | **Recommend against.** It reverts a documented safety decision (§4.4) and lets the generator close requirements by rephrasing the JD | Would additionally require `scanWording`/B1 first, so it is the most expensive option, not the cheapest |
| (ii) point the judge at the **profile** side (`supportIn` / A2) | **This is what "include the gate" means in practice** | It is the "next lane" — but the citation machinery (`buildProposalUser`, `verifyProposal`) was built for exactly this shape, so it may be *less* new code than the scoped work |
| (iii) ship the document judge with the gate untouched, look at real verdicts, then choose | **My recommendation for the first step** | One extra decision point. Nothing irreversible. Gets you the count and the display now |

**My recommendation: (iii) now, (ii) next, never (i).** That ordering gives you the number you asked
for on your real packets this week, and puts the gate change behind a page of evidence about whether
the judge is any good — which is the cheap test before the expensive change.

### OD-2 — the confirm button (this is cheaper than anyone thought)

`DIAG` A5 says the confirm path is unbuilt. **It is built** — route, writer, withdrawal,
idempotency, a 409 refusing anything that is not a model proposal, and DB tests (F7, §0.2). What is
missing is **a button in `app/src`**.

**Recommendation: build the button, whatever you decide on OD-1.** It is a small, purely additive UI
change against a finished API, and it makes the *existing* model proposals countable by a human
accuser — which raises `must_have_coverage` off zero **without any model being trusted**. On the
DIAG's own numbers this is the cheapest available movement on the number you are actually looking at.
Cost: one screen's work. Risk: none to the gate's semantics — a person is the accuser.

### OD-3 — does the judge also see `nice_to_have` requirements?

Today `nice_to_have` is judged by nothing (§2.2). Showing coverage for them is a genuine improvement
to the display, but it **adds rows to a count you read**, so it is your call, not an implementation
detail. **Recommendation: judge them and display them, but keep them out of every check's
numerator and denominator.** Cost: a slightly larger prompt. Risk: none, if the numerator boundary
holds — AC-12's denominators must be re-asserted if this is taken.

### OD-4 — the per-field narrowing

Judging per field (needed for your chip display) is very slightly stricter than judging the joined
text, because support split across two fields no longer counts (§2.1). **Recommendation: accept it,
and require AC-14 to report the number** so you see the size rather than being told it is small.
Cost: possibly a handful of requirements flipping to absent. It errs toward surfacing, which is the
direction every other tightening in this file chose.

### OD-5 — model, and whether `temperature` is yours to set

AC-16 makes model, cap, and min-quote-length owner-settable. **Temperature and max-tokens are the
open question**: pin them as `chk_*` columns (more knobs, fully self-serve), or inherit the existing
transport defaults (fewer knobs, one fewer thing to get wrong). **Recommendation: inherit the
defaults for now and record your approval**, since a wrong temperature is a much less likely problem
than an unnoticed one. Cost of the alternative: two more Settings rows.

### OD-6 — the pre-flight (§1.1) is a real blocker on the acceptance bar

The Trinnex acceptance bar (AC-1..AC-4) cannot be evaluated without live Postgres, and this pass had
no `boost-pg-mcp-write` tool available. **Please refresh the connector before implementation
starts** (~1s per query), or say to use `db-query.yml` instead. That choice is yours; the
implementer should not make it silently.

---

## 8. WHAT THIS PASS DID NOT DO — the honest limits

Separating observation from interpretation, so a wrong inference is catchable:

| | |
|---|---|
| **OBSERVED** (executed, reproducible) | 948 tests / 930 pass / 0 fail / 18 skipped; 70 of 948 test blocks touch the concept; `covers(` has exactly one call site, at `:905`; `bad()` defaults to `'fail'`+`deterministic` and `:1025` turns that pair into a gate fail; H12 forbids only two import specifiers in eight files; the `evidenceConfirm` route exists and writes, with no `app/src` caller; #15 = 0.60 and #9 = 0.57 reproduce exactly; all five derivational `sameWord` failures reproduce exactly; `itemTokens` does not de-duplicate |
| **INFERRED** (reasoned, not executed) | that a judge-backed document predicate on the gate would let the generator close requirements by rephrasing — this follows from `DIAG` C1 plus §4.4's comment, but no run has demonstrated it; that per-field + OR is strictly narrower than joined-text (true by construction, but the SIZE is unmeasured, hence AC-14) |
| **NOT DONE** | #12 and #7 did not reproduce the DIAG's ratios, because the real requirement rows were unreachable (§1.2, F13). No cost or latency figure was verified — the 21-requirements / 4-artifacts / 4-calls numbers in the brief and in `FEASIBILITY-llm-judgement.md` §4 are **repeated estimates and remain unverified**, which is why AC-20 requires measuring rather than citing them |
| **NOT ATTEMPTED** | no code was written, nothing was committed, no branch was changed. This pass produced this file only |

---

## 9. STATUS

**COMPLETE.** Feasibility table, ACs, mutation register and open decisions are all present.

**The single thing to read if nothing else: §4.** The scoped work does not touch the gate, so the
owner's "the gate should be included" cannot be satisfied by it. That must be answered (OD-1) before
implementation begins.
