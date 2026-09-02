<!--
WHAT:       Acceptance criteria + feasibility table for `prose-rewrite-on-demand` -- (A) coverage
            counts paraphrase, (B) prose sections report coverage but never auto-rewrite,
            (C) a per-section manual "Rewrite" button.
WHY:        The P3 remediation loop optimises `ResumeSummary` against a 70% LITERAL content-word
            overlap predicate (`coversIn`, api/src/functions/tests/checks.ts), so the only way for
            it to close a requirement is to copy the employer's sentence. Owner: "a hack full of
            verbatim lines from the jd... would get me accused of stuffing."
SUPERSEDES: nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:   docs/qc-evidence/DIAG-summary-stuffing.md (committed at 102c0c9); this file's
            feasibility table records every probe re-run independently by this AC pass.
TIER:       1 -- `coversIn` decides `must_have_coverage` and therefore the artifact gate.
            ACs before code; independent verifier after; every new guard mutation-proved.
BRANCH:     claude/incumbent-wins-swap @ 102c0c9
-->

# AC — `prose-rewrite-on-demand`

**STATUS: COMPLETE.** Written incrementally, section by section, as each was settled.

**Read §1 (CORRECTIONS TO THE BRIEF) first — the brief's central premise is refuted, and §5 OD-0
can cancel change (A) entirely.**

## 0. The owner's instruction (verbatim, the requirement)

> *"it should certainly count paraphrasing and similar meaning not just exact quotes. it should note
> what is covered by the resume summary on the right panel but not rewrite prose sections... there
> should be a button below to click along with the others we have for that and other prose sections
> this happens to for "Rewrite" that does the same thing it does today but bu trigger not
> automatically for that section (s)"*

Decomposed:

- **(A)** Coverage must count paraphrase / similar meaning, not only literal overlap.
- **(B)** Prose sections are **reported** as covering requirements in the right panel, but are
  **never rewritten automatically** by the remediation loop.
- **(C)** A per-section **"Rewrite"** button, mounted with the buttons that already exist for that
  section, doing what the automatic pass does today — on click only.

---

## 1. CORRECTIONS TO THE BRIEF — read these before the feasibility table

The brief and `DIAG-summary-stuffing.md` both rest on one claim that **this pass could not
reproduce**. It is stated in both as fact and it is the premise of the whole TIER-1 framing.

### C-1. `coversIn` does **NOT** decide `must_have_coverage`. **REFUTED.**

Brief: *"`coversIn` decides `must_have_coverage` and therefore the gate"* (also
`DIAG-summary-stuffing.md` OBSERVATION 1, and `CLAUDE.md`'s tier table).

**Ground truth — `api/src/functions/tests/checks.ts`, read at `102c0c9`:**

- `checks.ts:681` `const covers = (r) => coversIn(covText, r)` — defined, but see below where it is
  actually consumed.
- `checks.ts:761-762`: `const ev = input.evidence`; `const evidenceOf = (r) => ev?.bySeq?.[r.seq]`.
- `checks.ts:~825` **`const unevidenced = coverable.filter(r => !ruleEvidenceOf(r))`** — this, and
  only this, produces `must_have_coverage`'s numerator (`:868-874`).
- The code comment at `checks.ts:747-758` states the change explicitly:

  > *"P8.3 / R2, and conflict-register C6: 'coverage counts recomputed from evidence rows, not from
  > term placement.' … The old numerator was a statement about the document … `covers()` is kept
  > below, where it answers the different question it is actually good for: of the things the
  > profile DOES evidence, which ones reached this asset."*

- `covers()` today feeds **`evidence_placed`** (`checks.ts:~890+`), a *different* check.

**Consequence for this work, and it is large:**

| | brief's model | actual |
|---|---|---|
| what decides the gate's coverage | `coversIn` — literal overlap of the DOCUMENT with the JD | **evidence rows** — a verbatim excerpt of the **stored profile** resolved against the requirement (`evidence.ts`) |
| what `coversIn` decides | the gate | `evidence_placed`, plus the remediation loop's own three uses |

So **change (A) as the brief frames it — "loosen `coversIn` so paraphrase counts" — is not a change
to the gate's coverage numerator at all.** It is a change to (i) `evidence_placed` and (ii) the
remediation loop's stopping condition. That is still consequential (see AC-A group) but it is a
different, smaller blast radius than the brief assumes, and the TIER-1 justification has to be
restated on the real path.

### C-2. Paraphrase coverage is **PARTLY ALREADY BUILT** — as the proposal/confirmation tier

`checks.ts:763-806` documents a two-tier evidence model that already exists in production code:

- `method === 'proposed'` — a **model** chose the excerpt. `verifyProposal` requires the quote to be
  byte-exact in the record it names, but *"byte-exactness is not RELEVANCE"*, so a proposed row is
  **"evidence to SHOW, never evidence to PASS ON"** and does not enter the numerator.
- `confirmed_at` — **the owner** read the excerpt beside the requirement and said yes. That **does**
  promote the row into the numerator: *"A HUMAN IS AN ACCUSER … a stronger warrant than token
  overlap, not a weaker one."*

The house rule is written into the file verbatim: **"a model may PROPOSE, only an exact rule may
ACCUSE."**

The same comment records the measured gap that motivates the owner's request:

> *"the deterministic resolver evidences 0 of 35 requirements on a real posting, because lexical
> matching cannot bridge the employer's noun-phrase vocabulary to the candidate's prose."*

**So "count paraphrase and similar meaning" already has a mechanism and a governance rule.** The
open question is not *whether* to build one — it is whether the owner wants the confirmation step
kept (today's design) or wants a *deterministic* paraphrase rule that counts without a click. Those
are different products and the difference is exactly the R2 "fuzzy is for ranking, never accusing"
tension. This is Owner Decision **OD-1** below.

### C-3. Two EXISTING guards would fail the moment `coversIn` is loosened

Both are live in `api/test/`, and neither is mentioned in the brief:

- `api/test/hardening.test.mjs:216` (inside `H6`):
  `assert.ok(COVERAGE_THRESHOLD >= 0.7 && MIN_JUDGEABLE_TOKENS >= 3, 'coverage must stay accusation-grade')`
- `api/test/remediation.test.mjs:532`:
  `assert.equal(COVERAGE_THRESHOLD, 0.7, 'the gate threshold moved; these cases were chosen against 0.7')`
- `api/test/hardening.test.mjs:1511-1518` (`H38`) source-greps `remediation.ts` and **fails if the
  loop defines its own `COVERAGE_THRESHOLD =` or re-implements `hit.length / toks.length`.**

Standing owner instruction: *"dont ever ever ever weaken the refusal or any guard we have without
pinging me."* **Any design for (A) that lowers `COVERAGE_THRESHOLD` requires an explicit owner
decision, not an AC.** This is Owner Decision **OD-2**. A design that leaves 0.7 alone and *adds* a
second, separately-named, evidence-backed path does not trip these guards — which is one concrete
reason to prefer it.

### C-4. "Which fields are prose" — enumerated from the real table, and the boundary is NOT list-vs-prose

Ground truth: `api/src/functions/tests/packetTemplates.ts:22-56`, `TEMPLATE_META[type].placeholders`
(the table `mergeFieldsFor()` reads, `insertions.ts:61`).

| artifact type | placeholders | LIST fields (`insertions.ts:37 LIST_FIELD_TO_LIST`) | STRUCTURAL (`remediation.ts:348`) | **PROSE = the remainder** |
|---|---|---|---|---|
| `resume` | ResumeSummary, SkillsBullets1, SkillsBullets2, ExpertiseBullets, RelevantBullets1/2/3 | SkillsBullets1/2, RelevantBullets1/2/3, ExpertiseBullets | — | **ResumeSummary** |
| `compact_resume` | ResumeSummary, SkillsBullets | *(none — see below)* | — | **ResumeSummary**, and `SkillsBullets` is misclassified by a naive rule |
| `portfolio` | @Company, @CoverLetterDate, @CoverLetterBody, @AboutMe1_50words, @AboutMe2_60words, @ExecutiveProfile_55words, @CoreAccomplishments_5blts_180words | *(none)* | @Company, @CoverLetterDate | **@CoverLetterBody, @AboutMe1_50words, @AboutMe2_60words, @ExecutiveProfile_55words, @CoreAccomplishments_5blts_180words** |
| `cover` | @Company, @CoverLetterDate, @CoverLetterBody | *(none)* | @Company, @CoverLetterDate | **@CoverLetterBody** |

**Two traps a naive "prose = not in `LIST_FIELD_TO_LIST`" rule falls into, both confirmed by reading:**

1. **`compact_resume`'s `SkillsBullets` is NOT in `LIST_FIELD_TO_LIST`** — the map keys are
   `SkillsBullets1`/`SkillsBullets2`. It is a *combined* list slot (`checks.ts:306`
   `CHECK_FIELDS_FOR.compact_resume = [...mergeFieldsFor('resume'), 'SkillsBullets']`). A rule of the
   form "not a list field ⇒ prose" would exempt the compact resume's skills line from automatic
   remediation, which the owner did not ask for. **The prose set must be declared explicitly, the way
   `STRUCTURAL_FIELDS` is — not derived by negation.**
2. **`@CoreAccomplishments_5blts_180words` is bullets by name** ("5blts") but carries no
   `LIST_FIELD_TO_LIST` entry and no `skill_candidate` rows. Whether the owner counts it as a prose
   section is a judgement they should make, not one to infer from the name. → Owner Decision **OD-3**.

**Cold email is NOT a packet artifact — the brief's question about it is moot.** `coldEmail` is an
OUTREACH channel (`api/src/functions/tests/appOutreach.ts:45`), generated by a free-text model call
with no template, no merge fields, no requirement rows and no remediation loop. It never appears in
`TEMPLATE_META`. Nothing in (A)(B)(C) touches it.

**Stale comment noted, not silently fixed:** `insertions.ts:6-9` still says *"resume 7 ·
compact_resume 7 · portfolio 7 · cover 3"* and *"[compact_resume] is a byte-identical duplicate of
`resume`"*. `TEMPLATE_META` today gives `compact_resume` **2** placeholders, and `checks.ts:324-329`
documents the change and the six checks it silently dropped. The header comment is out of date.

### C-5. The diagnosis's causal story is **CONTRADICTED by a committed record** — the loop has never run

`DIAG-summary-stuffing.md` flagged this itself under "NOT ESTABLISHED" and called it one query short.
It is worse than not-established: there is a standing, committed row that says the opposite.

**`.claude/DEFERRED.md:133`, `D:remediation-never-ran`, status `OPEN`:**

> *"**What this row now measures is the ORIGINAL claim, unchanged: `remediation_loop` has 0 rows in
> production.** A caller that exists is not a pass that ran … it closes on the count, not on the
> wiring."*
> Its own close condition: `check: manual db-query.yml — select count(*) from remediation_loop must exceed 0`

Corroborating, `.claude/DEFERRED.md:160` (`D:every-build-is-destructive`) says the `insertion`
table — the one thing that keeps before/after per remediation loop — is *"empty in production"* for
the same reason. And `app/src/api.js:282` still carries the comment.

**Observation:** the wiring half was fixed 2026-08-22 (deploy `a02a85c`); the execution half is
recorded as never having happened.

**Interpretation (inference, not proof — see below):** if `remediation_loop` is still empty, then the
JD-stuffed `ResumeSummary` the owner is reading **was not written by the remediation loop**, and
`DIAG-summary-stuffing.md`'s entire causal chain ("the loop optimises against `coversIn` and drives
the summary toward verbatim JD text") did not happen on that document. The cause would be upstream —
Call 1 / Call 3 (`mt17.ts:137 updatedResumeSummary`), which are the **owner's own prompts** and which
this work is forbidden to touch.

**PRE-FLIGHT — THIS AC PASS NEEDS THE LIVE DB AND CANNOT REACH IT.** `boost-pg-mcp-write` is **not
in this pass's tool surface** (the only Postgres tools exposed here are `Azure_pg_mcp`, which needs
re-auth and is the *wrong* database — `RAG_AI_Agents` — and a Supabase server, which is unrelated).
Per `CLAUDE.md`'s pre-flight rule this is a NUDGE, not a detour, and the choice of transport is the
owner's. **These three queries settle whether this work is aimed at the right cause:**

```sql
-- Q1. Has the remediation loop EVER run?  If 0, DIAG's causal story is refuted outright.
select count(*) from remediation_loop;

-- Q2. Was the stuffed summary written by a pass, or by Call 1?
select loop, method, left(after_text,200) from insertion
 where merge_field='ResumeSummary' order by loop;

-- Q3. Does the deterministic evidence resolver actually evidence anything in production?
--     checks.ts:790 claims "0 of 35 requirements" on a real posting -- if that holds,
--     must_have_coverage is pinned near zero and (A) is aimed at the WRONG predicate.
select method, count(*), count(confirmed_at) from requirement_evidence group by method;
```

**AC-0 below makes answering Q1-Q3 a precondition of implementation**, because three of the ACs are
unwritable until the answers are known.

### C-6. The REFINED truth about what `coversIn` drives — the DIAG is right about the loop, wrong about the gate

`remediation.ts:225` **`export const CLOSE_CHECK_KEY = 'evidence_placed'`**, and `coverageView()`
(`:247-266`) reads the loop's work list from that check's offenders:

```ts
openSeqs: placed && state !== 'pass' && state !== 'not_applicable' ? offenderSeqs(placed.offenders) : []
```

The same interface carries `must_have_coverage` with an explicit prohibition (`:234-238`):

> *"`must_have_coverage`, carried for **REPORTING ONLY**. The loop **cannot move it and must never
> optimise against it**."*

So the corrected causal chain, which is what the ACs must be written against:

```
coversIn  ->  covers()  ->  evidence_placed (severity 'warn')  ->  coverageView.openSeqs
          ->  the remediation loop's objective function  ->  regenerateFields rewrites ResumeSummary
```

**Two things this changes, and both matter:**

1. **The DIAG's mechanism is CONFIRMED** — the loop really does optimise a literal-overlap predicate
   and really can only satisfy it by copying. `coversIn` is the loop's objective function.
2. **The DIAG's stakes are OVERSTATED** — `coversIn` does not decide `must_have_coverage`, and
   `evidence_placed` fails at `'warn'`, not `'fail'` (`checks.ts:912`). Loosening `coversIn` cannot
   turn `must_have_coverage` green on an unsupported claim, because that numerator comes from
   evidence rows.
3. **A mitigation the DIAG missed:** `evidence_placed`'s population is
   `[...coverable, ...resp].filter(r => ruleEvidenceOf(r))` — **only requirements the stored profile
   already evidences**. The loop can therefore only push the document toward JD wording for claims
   the profile genuinely supports. That is a real constraint, and it is why (A) is a *smaller* risk
   than the brief's framing implies — though `evidence_placed` still NAMES OFFENDERS ("evidenced by
   X, absent from this asset"), so it is accusation-grade under `CLAUDE.md`'s own definition and
   R2 still binds.

---

## 2. FEASIBILITY TABLE

Every row proved by reading the named file at `102c0c9` in this pass. `EXISTS-BUT-CONSTRAINED` means
the thing is there and one specific use of it is blocked — the constraint is named, not the thing.

| # | Dependency | Producer (writes it) | Consumer today (reads it) | Proof (command + result) | Verdict |
|---|---|---|---|---|---|
| F1 | `coversIn` / `coversText` literal-overlap predicate | `checks.ts:276-288` | `checks.ts:681` (`evidence_placed`); `remediation.ts:334` (`credited`), `:384` (`scopeForRequirements`), `:478` (`profileEvidenceFor`) | `grep -rn 'coversIn\|coversText' api/src` → exactly those 4 call sites + 2 defs | **EXISTS** |
| F2 | `coversIn` decides `must_have_coverage` | — | — | `sed -n '760,880p' checks.ts` → numerator is `coverable.filter(r => !ruleEvidenceOf(r))`; comment `:747` says coverage was moved OFF term placement in P8.3/R2/C6 | **ABSENT — the brief's premise is refuted** |
| F3 | Evidence-backed, citable, paraphrase-tolerant coverage | `evidence.ts` resolver + `verifyProposal` (model tier) | `checks.ts:761-806`, `must_have_coverage` numerator | `sed -n '250,330p' evidence.ts`; `checks.ts:763-806` | **ALREADY BUILT — but see F4** |
| F4 | Paraphrase counting **without** an owner click | model proposal (`method='proposed'`) | excluded from the numerator by `ruleEvidenceOf` until `confirmed_at` is set | `checks.ts:806-810` `const isConfirmed = (r) => !!evidenceOf(r)?.confirmed_at` | **EXISTS-BUT-CONSTRAINED** — deliberately: *"a model may PROPOSE, only an exact rule may ACCUSE"* |
| F5 | Owner-settable coverage/evidence thresholds | `checkPrefs.ts:44-83 ENSURE_CHECK_COLUMNS_SQL` | `DEFAULT_THRESHOLDS` → `CheckThresholds` → `writeEvidence` | `grep -n chk_ checkPrefs.ts` → `chk_evidence_threshold`, `chk_evidence_min_tokens`, `chk_evidence_max_sentences`, `chk_evidence_bullet_run`, `chk_wording_run_tokens`, +26 more | **EXISTS** — this is the home for any new setting; do not build a second one |
| F6 | Guards that BLOCK loosening `COVERAGE_THRESHOLD` | `hardening.test.mjs:216`, `remediation.test.mjs:532`, `hardening.test.mjs:1511` (`H38`) | `npm test` in `api/` | `grep -n COVERAGE_THRESHOLD api/test/*.mjs` | **EXISTS — and they will fail on (A) if (A) lowers 0.7** |
| F7 | Prose-field exclusion from remediation scope | `remediation.ts:348 STRUCTURAL_FIELDS = ['@Company','@CoverLetterDate']` | `scopeForRequirements:377` | `sed -n '340,400p' remediation.ts` — that array is the entire exclusion list | **EXISTS-BUT-CONSTRAINED** — the mechanism is there; it lists no prose field, so (B) is a **2-line data change plus a setting**, not a subsystem |
| F8 | `scopeForRequirements` withholds a generic summary | — | — | `remediation.ts:390-398`: a field is withheld only when it is the SOLE coverer of an already-closed requirement | **ABSENT — brief's claim CONFIRMED**: a tasteful summary covers nothing, so it is in scope on every pass |
| F9 | Authoritative prose-field enumeration | `packetTemplates.ts:22-56 TEMPLATE_META` | `insertions.ts:61 mergeFieldsFor` | `grep -n placeholders packetTemplates.ts` | **EXISTS** — see C-4 for the full table |
| F10 | Per-field manual rewrite control at the block mount point | `AssetBlocks.jsx:788-801` ("List Tweaks"), `:850-880` (box + send) | `api.aiEditArtifact` → `POST /app/artifact/{id}/ai-edit` (`appPackets.ts:1551`) | `sed -n '780,880p' AssetBlocks.jsx` | **EXISTS-BUT-CONSTRAINED** — see F11 |
| F11 | A manual trigger of *what the automatic pass does* | `appRemediation.ts:236 regenerateFields` ← `buildScopedPrompt` | `POST /app/artifact/{id}/remediate` (`appRemediation.ts:637`), exposed as `api.artifactRemediate` (`api.js:285`) | route + client both exist; **neither takes a `fields`/`section` argument** — scope is computed internally by `scopeForRequirements` | **EXISTS-BUT-CONSTRAINED** — the route runs the WHOLE loop over ALL in-scope fields. (C) needs a field filter on an existing route, not a new route |
| F12 | "List Tweaks" == what the automatic pass does | — | — | `AssetBlocks.jsx:867` calls `aiEditArtifact({instruction, section})` → `appPackets.ts:1415` `AI_EDIT_MODEL`, a free-text instruction edit. `buildScopedPrompt` is a *different* prompt with the open-requirement list and the profile | **ABSENT — the brief's lead #1 overstates it.** Same MOUNT POINT and same UI idiom, **different engine**. (C) is a sibling control on that row calling `artifactRemediate`, not a rename of List Tweaks |
| F13 | Right panel shows where a requirement landed | `qcRail.js:765 requirementUsage` → `:778 swapsForRequirement` | QC rail requirement rows | `sed -n '755,782p' qcRail.js` — resolves via `s.list`, and `swaps.ts:44 LISTS` is the six LIST keys only | **EXISTS-BUT-CONSTRAINED — brief's lead #2 CONFIRMED.** A prose field produces no swap row, so `requirementUsage` returns `null` and, by its own "NULL IS THE CONTRACT" rule, renders nothing. This is exactly the gap (B) must close |
| F14 | A per-field requirement→field map that already exists | `remediation.ts:382-386` `coverMap` inside `scopeForRequirements` | nothing — it is a local, and it is built for **closed** requirements only | `sed -n '380,398p' remediation.ts` | **EXISTS-BUT-CONSTRAINED** — the computation (B) needs is already written; it is local and closed-only. Extend it; do not write a second one |
| F15 | The remediation loop has ever executed in production | `appRemediation.ts` → `remediation_loop` | `api.artifactRemediationGet`, QC rail ledger | `.claude/DEFERRED.md:133` `D:remediation-never-ran` **OPEN**: *"`remediation_loop` has 0 rows in production"* | **RECORDED AS NEVER-RUN — UNVERIFIED THIS PASS.** Needs Q1 (C-5). **This is the row that could make (A) and (B) fixes to a problem that is not happening** |
| F16 | Undo for a manual rewrite | `swap_decision.override_value` / `override_state` | swap rows only | brief's own note; `AssetBlocks.jsx:853` warns *"Anything auto-corrected in it can no longer be undone"*; `DEFERRED.md:160` `D:every-build-is-destructive` — `artifact.version_history` stores `{"len":N}`, not the text | **ABSENT for prose.** (C) cannot offer undo without first fixing `D:every-build-is-destructive`. → **OD-5** |
| F17 | Cold email as a packet artifact | `appOutreach.ts:45` (free-text model call) | outreach cadence | absent from `TEMPLATE_META`; no merge fields, no requirements, no loop | **ABSENT — out of scope, question moot** |
| F18 | An anti-echo instruction in the scoped prompt | — | — | `remediation.ts:507-548` full `buildScopedPrompt` read; forbids INVENTING, says nothing about reusing the employer's wording | **ABSENT — DIAG OBSERVATION 3 CONFIRMED** |

### What the table says, in one paragraph

**Nothing here needs a new subsystem.** (B) is `STRUCTURAL_FIELDS` gaining a sibling list plus a
`chk_*` setting. (C) is a sibling control on an existing button row calling an existing route that
needs one new optional argument. (A) is the only genuinely hard one — and F3/F4 say a
paraphrase-tolerant, *citable* coverage path **already exists and is deliberately gated on an owner
click**, so (A) is really a question about that gate, not a request to build a matcher.

---

## 3. INDEPENDENT RE-RUN OF THE DIAGNOSIS PROBES

The brief asked for these to be re-run rather than trusted. Executed against `api/dist` at `102c0c9`
in this pass:

```
node -e "const {coversText,COVERAGE_THRESHOLD}=require('./api/dist/functions/tests/checks.js'); ..."
THRESHOLD 0.7
A false   Scaled distributed platforms and container orchestration for large regulated enterprises.   (paraphrase)
B false   Led microservices platform work at enterprise scale.                                        (partial echo)
C true    Experience designing and operating cloud-native microservices on Kubernetes at enterprise scale.  (verbatim lift)
D true    Engineering executive: cloud-native microservices, Kubernetes at enterprise scale, platform reliability engineering.  (phrase-stitched)
```

**CONFIRMED.** The DIAG's central measurement reproduces exactly: no paraphrase reaches 0.70, a
verbatim lift scores 1.00, and case **D** — the phrase-stitched stuffing shape the owner objects
to — **closes the requirement while producing no 8-token run for `posting_wording_kept` to catch**.

**One brief claim this pass could NOT verify:** the regression baseline *"skills_1 11/11, skills_2
9/9, expertise 7/7 exact master items, measured CORRECT in production today"*. `grep -rn '11/11\|9/9\|7/7'
docs/qc-evidence .claude` returns only unrelated test-assertion counts. **No committed record of that
measurement exists**, and this pass cannot reach production. AC-R1 is therefore written as a
*snapshot-and-compare* guard rather than against those literals — a guard asserting numbers nobody
can source is exactly the "fabricated composite" failure `CLAUDE.md` forbids.

---

## 4. ACCEPTANCE CRITERIA

Format: `Given <context>, when <action>, then <observable outcome>.` Every AC is binary. Each names
the file it is measured in. **AC-0 gates all of them.**

### AC-0 — the precondition (blocks implementation, not a nice-to-have)

**AC-0.1** Given `D:remediation-never-ran` is OPEN and asserts `remediation_loop` has 0 rows, when
implementation is about to begin, then `select count(*) from remediation_loop` has been run against
production and the result is recorded in this file. **If the count is 0, work on (A) STOPS and the
owner is told the stuffed summary was written by Call 1 / Call 3, not by the remediation loop** —
(B) and (C) remain valid as directed changes, (A) does not, because it would be tuning an objective
function that has never executed.

**AC-0.2** Given `checks.ts:790` records *"the deterministic resolver evidences 0 of 35 requirements
on a real posting"*, when implementation begins, then
`select method, count(*), count(confirmed_at) from requirement_evidence group by method` has been run
and recorded. If deterministic rows are ~0 in production, `evidence_placed`'s population is near-empty,
`coverageView.openSeqs` is empty, and **the loop has nothing to rewrite** — which independently
explains an un-stuffed loop and makes (A) aimed at the wrong layer.

**AC-0.3** Given `select loop, method, left(after_text,200) from insertion where merge_field='ResumeSummary' order by loop`,
when it is run, then the loop number of the offending summary is recorded here. `loop=0` ⇒ Call 1
wrote it ⇒ the DIAG is exonerating for the remediation loop.

---

### AC-A — (A) coverage counts paraphrase and similar meaning

The predicate under change is `coversIn`, which drives **`evidence_placed`** and the loop's objective
(C-6), **not** `must_have_coverage` (C-1).

**AC-A1 (error-mode direction, stated plainly as the brief requires).** Given a requirement and a
document, when the new paraphrase rule decides coverage, then a **false POSITIVE** (marking a
requirement covered that the document does not state) is a **silent green on an unsupported claim in
a live job application** and a **false NEGATIVE** (missing a genuine paraphrase) is **a requirement
surfaced to the owner that they can dismiss**. The rule MUST be biased toward the false negative.
Any implementation whose measured error profile is the other way round FAILS this AC regardless of
its aggregate accuracy.

**AC-A2 (the R2 tension, resolved not papered over).** Given `CLAUDE.md`'s *"fuzzy matching is for
RANKING, never for ACCUSING"* and given `evidence_placed` names offenders, when a requirement is
counted covered by paraphrase, then the system can **display a citable warrant** for that decision —
either (i) a verbatim excerpt of the stored profile whose stated claim the document restates, or
(ii) an owner confirmation (`requirement_evidence.confirmed_at`). **A bare similarity score is never
sufficient.** Concretely: no code path may mark a requirement covered on the basis of
`swaps.ts:143 similarity()` alone, which is documented at its definition as a containment RANKING
tool.

**AC-A3 (the guards stay up).** Given `hardening.test.mjs:216`, `remediation.test.mjs:532` and
`H38`, when (A) is implemented, then `COVERAGE_THRESHOLD` is still `0.7`, `MIN_JUDGEABLE_TOKENS` is
still `>= 3`, `remediation.ts` still contains no `COVERAGE_THRESHOLD =` and no `hit.length / toks.length`,
and `npm test` in `api/` passes with **no assertion edited or deleted**. A design that requires
editing any of those three assertions is a guard weakening and must be escalated to the owner (OD-2)
before a line is written.

**AC-A4 (extend, don't duplicate).** Given `evidence.ts` already resolves requirements to citable
profile excerpts with an owner-settable threshold, when (A) is implemented, then the paraphrase path
**extends that resolver** and does not introduce a second requirement-matching subsystem. Observable:
`grep -c 'export function .*[Mm]atch\|export function .*[Cc]overs' api/src/functions/tests/*.ts` does
not increase by a new top-level matcher; the new behaviour appears as options/records on the existing
evidence path.

**AC-A5 (blast radius — all four consumers reconcile).** Given `coversIn`/`coversText` has exactly
four consumers, when (A) changes what they see, then each is checked and the effect stated:

| consumer | what a looser predicate does | required outcome |
|---|---|---|
| `checks.ts:681` → `evidence_placed` | fewer `unplaced` offenders | count must still be auditable: the observed string names how many were counted by paraphrase |
| `remediation.ts:334` `credited` | a pass may claim a close it made by paraphrase | a credited close must carry the same citable warrant AC-A2 requires, or it is `phantom` |
| `remediation.ts:384` `scopeForRequirements` | **more fields withheld** — a looser predicate makes more fields look like sole coverers | must be measured, not assumed: a run where every field is withheld halts as `nothing_reachable` |
| `remediation.ts:478` `profileEvidenceFor` | more requirements reported as profile-evidenced | this feeds the escalation surface; over-reporting here tells the owner a gap is closed when it is not |

**AC-A6 (mutation proof).** Given each new guard for (A), when the behaviour it guards is reverted
(the paraphrase rule replaced by `return false`; the citable-warrant requirement removed; the
`similarity()`-alone ban removed), then `npm test` in `api/` **FAILS**, once per mutation, and the
failing assertion is named in the verification artifact. A mutation that is behaviourally equivalent
must be reported as such and not claimed as proof.

**AC-A7 (no hardcoded config).** Given any new threshold introduced by (A), when it is added, then it
is a `chk_*` column declared in the single `ENSURE_CHECK_COLUMNS_SQL` statement
(`checkPrefs.ts:44-83`) with a seeded default, reachable in Settings, and the owner is told where to
change it. Observable: the new name appears in `deriveCheckColumns()`'s regex output and in the
`select` at `checkPrefs.ts:161-166`. **A literal in code with no Settings path fails this AC.**

**AC-A8 (the anti-echo gap, since it is the owner's actual complaint).** Given `buildScopedPrompt`
contains no instruction against reusing the employer's wording (F18), and given probe case **D**
closes a requirement with zero wording offenders, when (A) ships, then EITHER the scoped prompt
carries an explicit anti-echo instruction (it is our code, `remediation.ts` — **not** the Prompts
table) OR the owner has explicitly declined it. Loosening the predicate without this leaves the
stuffing incentive in place at a lower price.

---

### AC-B — (B) prose is reported, never auto-rewritten

**AC-B1 (the exclusion, as data next to the one that exists).** Given `STRUCTURAL_FIELDS`
(`remediation.ts:348`) is the existing exclusion mechanism, when (B) ships, then a sibling
`PROSE_FIELDS` constant is declared in the same file and `scopeForRequirements:377` filters both.
The set is **explicit, enumerated from `TEMPLATE_META`**, and is exactly:
`ResumeSummary`, `@CoverLetterBody`, `@AboutMe1_50words`, `@AboutMe2_60words`, `@ExecutiveProfile_55words`
(+ `@CoreAccomplishments_5blts_180words` iff OD-3 says so). **It is NOT derived by negation from
`LIST_FIELD_TO_LIST`** — that would wrongly capture `compact_resume`'s combined `SkillsBullets` (C-4).

**AC-B2 (guard: the enumeration cannot silently drift).** Given a new placeholder is added to
`TEMPLATE_META`, when the suite runs, then a guard `H:prose-fields-enumerated` FAILS unless every
placeholder of every type is classified as exactly one of LIST / STRUCTURAL / PROSE. Mutation: add a
fake placeholder to a `TEMPLATE_META` entry → the suite fails.

**AC-B3 (the loop really stops touching prose).** Given a package whose only open requirement could
be closed by `ResumeSummary`, when a remediation pass runs, then `ResumeSummary` is absent from
`scope_fields` on the `remediation_loop` row, absent from `edited_fields`, and its `insertion` rows
gain no new `loop > 0` entry. Mutation: remove `ResumeSummary` from `PROSE_FIELDS` → the assertion
fails.

**AC-B4 (the requirement that now stays open must NOT go silently green).** Given a requirement whose
only possible closer was a prose field, and given `CLAUDE.md`'s *"absent evidence is `not_applicable`,
never `pass`"*, when the pass ends, then that requirement appears in `remaining`, `evidence_placed`
does **not** report `pass`, and the surfaced reason names the prose field and says a manual **Rewrite**
is the action. **It must never be dropped from the denominator** — the `must_have_coverage` denominator
defect (`checks.ts:836-847`, "3/4 covered" when one was measured) is the exact laundering to avoid.

**AC-B5 (halt, don't rewrite anyway).** Given every remaining candidate field is withheld or prose,
when `scopeForRequirements` returns an empty `fields`, then the controller halts with
`nothing_reachable` (existing behaviour, `remediation.ts:387-389`) and does not fall back to
rewriting a prose field.

**AC-B6 (owner-changeable, per the no-hardcoded-config rule).** Given the owner may later want the
old behaviour, when (B) ships, then a `chk_*` boolean (e.g. `chk_prose_auto_rewrite`, seeded `false`)
in `ENSURE_CHECK_COLUMNS_SQL` controls it, is reachable in Settings, and the owner is told where.

**AC-B7 (the right panel actually reports prose coverage — the half of (B) that is a FEATURE).**
Given `requirementUsage` (`qcRail.js:765`) resolves only through swap rows and returns `null` for a
prose field (F13), when a requirement is covered by text in `ResumeSummary`, then the right panel
shows that requirement as covered **by `ResumeSummary`**, naming the field, with the sentence that
covers it. Observable via `ui-verify.yml`: the requirement row renders the field label. **The
computation is the `coverMap` already inside `scopeForRequirements` (F14) generalised to open
requirements and returned — not a second matcher.**

**AC-B8 (no dead UI).** Given `requirementUsage`'s stated contract *"NULL IS THE CONTRACT … the
caller must render NO LINK"*, when (B) adds a prose usage source, then a prose usage entry renders
only where the field's real current text actually covers the requirement; a fabricated or optimistic
entry fails this AC.

---

### AC-C — (C) the per-section manual Rewrite button

**AC-C1 (mount point — the owner's "along with the others we have").** Given the control row at
`AssetBlocks.jsx:788-846` (`List Tweaks`, `Shorten to fit`, `Ask the assistant`, `Put back "…"`),
when (C) ships, then **Rewrite** renders in that same row for prose fields only, as a sibling
`px-link role="button" tabIndex={0}` carrying `data-qc={BLOCK_HOOKS.rewrite}` and
`data-qc-field={row.merge_field}` — the same idiom, so `compare-ui.mjs` (which collects
`button, [role="button"], a`) can see it. It renders on no LIST field and on no STATIC block.

**AC-C2 ("the same thing it does today" means the REMEDIATION path, not `ai-edit`).** Given F12 —
`List Tweaks` posts a free-text instruction to `POST /app/artifact/{id}/ai-edit` with `AI_EDIT_MODEL`,
whereas the automatic pass is `regenerateFields` ← `buildScopedPrompt` — when **Rewrite** is clicked,
then it invokes `regenerateFields`/`buildScopedPrompt` for that one field, with the same open
requirements, the same profile text and the same omit list the automatic pass would have used. **A
Rewrite wired to `ai-edit` fails this AC**: it would be a different engine wearing the automatic
pass's name.

**AC-C3 (extend the route, do not add one).** Given `POST /app/artifact/{artifactId}/remediate`
already exists (`appRemediation.ts:637`) and already runs the loop, when (C) ships, then it accepts
an optional `fields: string[]` (or `section`) in the body that **narrows** scope, and the client
`api.artifactRemediate` passes it. **No new route.** Observable: `grep -c "app.http('artifact"
api/src/functions/tests/appRemediation.ts` is unchanged.

**AC-C4 (a manual trigger may NOT widen scope, only narrow it).** Given `scopeForRequirements`
withholds fields that are the sole coverer of a closed requirement, when `fields` is supplied, then
the executed scope is `supplied ∩ scopeForRequirements(...).fields ∪ {the requested prose field}` —
i.e. the prose exclusion from (B) is lifted **only for the field the owner explicitly named**, and a
supplied field that is *withheld as a sole coverer* is refused with a stated reason, not silently
rewritten. Mutation: make the intersection a union over all supplied fields → an assertion that a
withheld field stays withheld fails.

**AC-C5 (it is recorded as a decision, and says who asked).** Given the automatic pass writes a
`remediation_loop` row, when Rewrite runs, then it writes a row of the same shape distinguishable as
owner-triggered (e.g. `note`/a trigger column), so the ledger cannot report a manual rewrite as an
automatic pass. `insertion` rows for the field are written with the same `(artifact_id, merge_field,
loop)` key so before/after is preserved.

**AC-C6 (second click — idempotency stated, not assumed).** Given the owner clicks Rewrite twice,
when the second click runs, then it produces a **new** loop `n` with its own before/after, does not
overwrite the first pass's `insertion` row, and the control is disabled while a pass is in flight.
"Nothing happens on the second click" and "it silently overwrites the first result" both FAIL.

**AC-C7 (undo — say what is true, do not imply more).** Given `AssetBlocks.jsx:853` already warns
*"Anything auto-corrected in it can no longer be undone"*, and given `artifact.version_history` stores
`{"len": N}` and not the text (`D:every-build-is-destructive`, F16), when Rewrite ships, then the
control carries an equivalent, accurate warning **before** the pass runs, and **no undo affordance is
rendered** unless one is genuinely built. A greyed or stub Undo fails the no-dead-UI rule. → **OD-5**.

**AC-C8 (in-flight, failure and success all speak).** Given the ask box already models this
(`askBusy` / `askError` / `askSent`, `BLOCK_HOOKS.askSent`), when Rewrite is pressed, then a busy
state, an in-place error on failure, and an in-place confirmation naming the field on success are all
observable. Silence on success — the exact defect `SPEC 4.7-7` was opened for — fails this AC.

**AC-C9 (authorisation).** Given `resolveOwner`/`requireWrite` (`appSession.ts`) and given Rewrite is
a MUTATION, when it is called without a verified session, then it is refused. An `?owner=` query
param alone must not be sufficient.

---

### AC-R — regression guards (things measured correct today that must not move)

**AC-R1 (skills / relevant / expertise coverage — snapshot, because the brief's literals are unsourced).**
Given the brief cites `skills_1 11/11, skills_2 9/9, expertise 7/7` but **no committed record of that
measurement exists** (§3), when (A)/(B)/(C) are implemented, then the per-list exact-match counts are
captured from production **BEFORE** the change and compared **AFTER**, and they are identical. The
guard asserts *"unchanged from the recorded pre-change snapshot"*, never a hardcoded literal.

**AC-R2 (list fields keep auto-rewriting).** Given (B) excludes prose only, when a pass runs on a
package whose list fields are in scope, then `SkillsBullets1/2`, `RelevantBullets1/2/3`,
`ExpertiseBullets` **and `compact_resume`'s `SkillsBullets`** are still in `scope_fields`.
Mutation: classify `SkillsBullets` as prose → this assertion fails. *(This is the C-4 trap made into a
test.)*

**AC-R3 (`must_have_coverage` does not move at all).** Given (A) changes `coversIn`, and given
`must_have_coverage`'s numerator comes from evidence rows and not from `coversIn` (C-1), when the
suite runs, then `must_have_coverage` results are **byte-identical** before and after (A) on a fixed
fixture. **Any movement means `coversIn` reached the gate's coverage numerator, which is the exact
accusation-grade regression this whole tier-1 framing exists to prevent.** Mutation: route
`must_have_coverage` through `covers()` → this assertion fails.

**AC-R4 (the check count does not silently drop).** Given `checks.ts:324-329` records **six checks
vanishing** when a type's field list changed — *"They did not degrade to `not_applicable`; they were
never emitted at all, and `gateFor` cannot see a check that never ran"* — when (B) adds a field
classification, then `runChecks` emits the **same set of `check_key`s** for every artifact type,
before and after, on an identical `pkg`. Mutation: remove a prose field from
`CHECK_FIELDS_FOR`/placeholders → a `check_key` disappears and the assertion fails.

> **The literals in that comment do not reproduce, so this AC deliberately does not use them.**
> `checks.ts:329` says *"resume 17 results, compact_resume 12"*. Executed in this pass against
> `api/dist` with one `pkg` covering every placeholder of both types:
> `resume 18 · compact_resume 19 · cover 9 · portfolio 9`. The count is a function of the input
> `pkg`, so the comment's numbers are only true of the fixture that produced them, which is not
> recorded. **Assert the `check_key` SET, never a count** — a count guard would either cry wolf on a
> different fixture or pass while a check silently vanished, both of which `CLAUDE.md`'s H-case rules
> forbid. *(This is also a live example of the rule that a code comment is a claim about the code,
> not the code.)*

**AC-R5 (the loop still cannot redefine coverage).** Given `H38`, when (A)/(C) are implemented, then
`remediation.ts` still imports `coversText` from `./checks` and defines no local threshold. Already
guarded; re-asserted here because (C) adds code to that file.

**AC-R6 (the Prompts table is untouched).** Given the standing instruction *"i still want my original
prompts to be driving what the resume draft is"*, when the work lands, then `git diff` touches no
Prompts-table read or write, and any prompt text changed is inside `remediation.ts`'s
`buildScopedPrompt` (our code). Observable: `grep -rn "Prompts" api/src` shows no new call site.

---

## 5. OPEN DESIGN DECISIONS — THE OWNER MUST MAKE THESE

Listed plainly, not buried. Each has a recommendation and what it costs. **OD-0 comes first because
it can cancel a third of the work.**

### OD-0 — Is the remediation loop actually the culprit? (BLOCKING)

**The question.** `.claude/DEFERRED.md` says `remediation_loop` has **0 rows in production**. If that
is still true, the stuffed `ResumeSummary` was written by Call 1 / Call 3 — the owner's own prompts —
and not by the loop the diagnosis blames.

**What settles it:** the three queries in C-5 / AC-0, about one second each on `boost-pg-mcp-write`.
**That connector is not in this AC pass's tool surface**, so this pass could not run them.

**Recommendation:** run Q1 before any code. **Cost of skipping it:** (A) is a redesign of an
objective function that may have never executed once — the most expensive possible way to be wrong,
and precisely the failure the "feasibility before implementation" rule exists to prevent.

**What it does NOT change:** (B) and (C) are direct owner instructions and stand either way. (B) is
also cheap insurance — if the loop ever *does* start running, it will do exactly what the DIAG
describes.

---

### OD-1 — Should paraphrase count automatically, or only after you confirm it?

**The question.** A paraphrase-tolerant, citable coverage path **already exists**: a model proposes an
excerpt, you read it beside the requirement, and confirming it promotes it into the coverage numerator
(`checks.ts:763-806`). The house rule is *"a model may PROPOSE, only an exact rule may ACCUSE"*, and
**a human is an accuser**. So the real question is not "build paraphrase matching" — it is **"do you
want to keep the click?"**

| option | what it means | cost |
|---|---|---|
| **(a) keep the click** *(recommended)* | Make the *proposal* surface unmissable — every unevidenced requirement shows its proposed excerpt with a one-press Confirm. Coverage rises as fast as you can read. | You must click. Nothing is claimed on your behalf. |
| (b) auto-count model paraphrase | Proposals enter the numerator with no confirmation. | **Directly voids the house rule.** Model judgement decides an accusation-grade number; `reasoning` is stored and never verified. A false positive is a green gate on a claim your profile does not support — in a real job application. |
| (c) a deterministic synonym/embedding rule | A non-model lexical/semantic expansion that counts without a click. | Real work, and it must still produce a citable warrant to satisfy AC-A2. This is the only option that both counts automatically and keeps the citation. |

**Recommendation: (a), plus (c) scoped narrowly to `evidence_placed` only** — where the error mode is
"a warning you can dismiss", not "a green gate". Explicitly **not (b)**.

---

### OD-2 — May `COVERAGE_THRESHOLD` be lowered? (a guard-weakening question, so it is yours)

Three live assertions pin it: `hardening.test.mjs:216` (`>= 0.7`), `remediation.test.mjs:532`
(`== 0.7`), and `H38`. Your standing instruction is *"dont ever ever ever weaken the refusal or any
guard we have without pinging me."* **This is that ping.**

**Recommendation: do NOT lower it.** Add a separately-named, evidence-backed path *beside* it, so the
literal-overlap floor stays exactly where it is and the new behaviour is auditable as its own number.
**Cost:** two predicates instead of one, and the observed strings must name which counted what.
**Cost of the alternative:** every requirement whose words merely resemble the JD's starts counting
as covered, which is the failure mode `COVERAGE_THRESHOLD` was raised from 0.5 to 0.7 to fix
(`checks.ts:668-673`, the Trinnex "digital water technology" case).

---

### OD-3 — Is `@CoreAccomplishments_5blts_180words` prose?

It is named for bullets ("5blts"), carries no `LIST_FIELD_TO_LIST` entry and no `skill_candidate`
rows. **Recommendation: treat it as PROSE** (it is written as sentences and has no swap ledger, so
the auto-rewrite has the same stuffing incentive there). **Cost of being wrong either way is one line
in `PROSE_FIELDS`** — genuinely reversible, so it should not hold anything up.

Same question, lower stakes, for the two `@AboutMe*` fields and `@ExecutiveProfile_55words` — this
pass classifies all three as prose. Say if you disagree.

### OD-4 — Should the portfolio and cover letter get the Rewrite button too?

Your words were *"that and other prose sections this happens to"*. The prose fields are
`ResumeSummary` (resume + compact) and five portfolio/cover fields (C-4).
**Recommendation: yes, all of them** — one control, one rule, no per-artifact exception to remember.
**Cost:** none beyond the button rendering in more places; it is the same code path.

### OD-5 — Undo for a manual Rewrite: accept "no undo", or fix versioning first?

There is **no undo for prose today**, and there cannot be one cheaply: `artifact.version_history`
stores `{"len": N}` — a character count, not the text (`D:every-build-is-destructive`, OPEN).

| option | cost |
|---|---|
| **(a) ship with an explicit warning, no undo** *(recommended)* | Matches what `List Tweaks` already tells you. Honest, and no dead UI. |
| (b) fix `D:every-build-is-destructive` first, then ship Rewrite with real undo | A separate piece of work on the artifact write path; it delays (C). |

**Recommendation: (a) now, and (b) tracked as its own item** — a stub or greyed Undo is the one thing
that must not ship (no-dead-UI rule).

### OD-6 — When a prose section is the ONLY thing that could close a requirement, what should you see?

(B) means that requirement stays open. **Recommendation:** it stays in `remaining`, `evidence_placed`
does **not** report `pass`, and the right panel says *"only <field> can close this — press Rewrite"*
with the button right there. **The one outcome that must never happen is it quietly disappearing from
the denominator**, which is the defect `checks.ts:836-847` already documents ("3/4 covered" when one
requirement was measured). **Cost:** your open-requirement count will look *worse* than it does today
for exactly as long as you leave a prose section un-rewritten. That is the honest number, and it is
the point of the change.

---

## 6. WHAT THIS PASS DID NOT ESTABLISH

Stated so nobody reads a gap as a finding.

1. **Whether the remediation loop has ever run in production.** Recorded as never-run in
   `.claude/DEFERRED.md`; not verified here — `boost-pg-mcp-write` is not in this pass's tool
   surface. **This is the single most load-bearing unknown** (OD-0).
2. **The production evidence-row population.** `checks.ts:790` claims the deterministic resolver
   evidences 0 of 35 on a real posting. Not re-measured here.
3. **The brief's `11/11 / 9/9 / 7/7` regression baseline.** No committed source found (§3). AC-R1 is
   written as snapshot-and-compare because of it.
4. **Whether the specific summary the owner objects to is `loop=0`.** Same query gap as (1).
5. **Anything about the rendered live UI.** The sandbox cannot see it; `ui-verify.yml` is the vehicle
   and was not run by this pass.

## 7. STATUS

**COMPLETE.** Written incrementally; every section above was appended as it was settled.

Verdict summary for the Stop gate's evidence contract:

| claim | verdict |
|---|---|
| brief: "`coversIn` decides `must_have_coverage` and therefore the gate" | **REFUTED** (C-1) |
| brief: "`coversIn` drives the remediation loop's objective" | **CONFIRMED** — via `evidence_placed` / `CLOSE_CHECK_KEY` (C-6) |
| DIAG: no paraphrase reaches 0.70; phrase-stitching closes a requirement invisibly | **CONFIRMED** by independent re-run (§3) |
| DIAG: `STRUCTURAL_FIELDS` is the entire exclusion list; a generic summary is never withheld | **CONFIRMED** (F7, F8) |
| DIAG: `buildScopedPrompt` has no anti-echo instruction | **CONFIRMED** (F18) |
| brief lead 1: "the per-field rewrite button already exists" (List Tweaks) | **PARTLY CONFIRMED** — same mount point, **different engine** (F10, F12) |
| brief lead 2: right panel resolves through swap rows, so prose shows nothing | **CONFIRMED** (F13) |
| brief lead 3: `STRUCTURAL_FIELDS` at `remediation.ts:348` is the exclusion point | **CONFIRMED** (F7) |
| brief: cold email is an artifact type needing a prose ruling | **REFUTED** — outreach channel, not a packet artifact (F17) |
| brief: regression baseline 11/11, 9/9, 7/7 | **NOT_APPLICABLE** — no committed source exists (§3) |
| brief: (A) points a fuzzy matcher at an accusation-grade predicate | **CONFIRMED but narrowed** — `evidence_placed` names offenders and is accusation-grade, though it warns rather than fails (C-6) |
| paraphrase coverage is unbuilt | **REFUTED** — the propose/confirm tier exists (F3, F4) |
| the loop has ever executed in production | **NOT_APPLICABLE — unverified, needs Q1** (F15, OD-0) |

---

## 8. OWNER DECISIONS RECORDED — 2026-09-01

Answers given by the owner in response to §5. **This section is the decision of record; §5 is the
question that produced it.**

### OD-2 — CLOSED: the threshold is NOT touched

Owner: *"I don't understand why the threshold needs to be bothered... is it exclusive to the resume
summary?"*

**It is not exclusive to anything — and that is the answer.** `coversIn` has five call sites and not
one of them is field-specific (verified by grep, 2026-09-01):

| call site | what the threshold decides there |
|---|---|
| `checks.ts:681` → `covers()` | `evidence_placed` AND `responsibilities_addressed`, for **every** merge field |
| `remediation.ts:334` | `credited` — whether a pass really closed what it claimed |
| `remediation.ts:384` | `scopeForRequirements` — which fields are WITHHELD from rewriting |
| `remediation.ts:478` | the seqs a text is treated as covering |

So lowering `COVERAGE_THRESHOLD` to help the summary would loosen **every field and four separate
decisions at once**, including the one that protects fields from being rewritten. `checks.ts:670-680`
records that it was raised 0.5 → 0.7 precisely to stop a resume passing on words that appear in it
naturally for the role.

**DECISION: `COVERAGE_THRESHOLD` stays at 0.7. It is out of scope.** Any paraphrase tolerance is a
separately-named path beside it, never a change to this number. The three guards that pin it
(`hardening.test.mjs:216`, `remediation.test.mjs:532`, `H38`) stay exactly as they are, and AC-A3 is
rewritten to assert that they still hold rather than to relax them.

*Note for the record: the owner's instinct here was correct and this pass's framing was not. §5's
OD-2 presented lowering the threshold as a live option because the parent session's diagnosis
described `coversIn` as "the gate"; §1 had already refuted that. Asking to widen a shared number to
fix one field is the "patch one screen" failure `CLAUDE.md` names.*

### OD-3 — CLOSED: `@CoreAccomplishments_5blts_180words` is PROSE
Owner: *"yes"*. It joins the prose set: no auto-rewrite, coverage reported in the right panel, and a
Rewrite button.

### OD-4 — portfolio and cover letter: **List Tweaks, not a second Rewrite button**
Owner: *"tweaks"*. **Reading of record:** those two artifacts keep the existing `List Tweaks`
control; the new `Rewrite` button is mounted on the resume's prose sections only. This is the
narrower and cheaper reading and is one line to extend later if it is wrong — flagged to the owner
rather than assumed silently.

### OD-5 — CLOSED: fix versioning FIRST, so a manual Rewrite is undoable
Owner: *"fix version"*. This pulls **`D:every-build-is-destructive`** into scope as a prerequisite:
`artifact.version_history` is appended at `appPackets.ts:218` with **`{"len": N}` — a character
count, not the text** — and nothing reads it. A Rewrite button shipped on top of that is an
irreversible overwrite of the owner's prose. **The version write must store the prior CONTENT before
`Rewrite` is wired.** ACs for this are additive to §4 group C and are the first implementation step.

### OD-6 — escalation vs a right-panel note, and the nudge

Owner: *"what is an escalation vs a right panel note? either way the nudge should be included"*.

**They are not two styles of the same thing — one is a tracked record, the other is display text.**

| | **Escalation** | **Right-panel note** |
|---|---|---|
| what it is | a row in the `escalation` table (`schema.ts:1036`) | text rendered in the QC rail |
| survives a rebuild | **yes** | no |
| has a state | `open` / `resolved` / `accepted`, `unique (artifact_id, requirement_id)` so it updates rather than stacking | none |
| you can act on it | **two ways: supply evidence → `resolved`, which REOPENS the loop; or accept the gap → `accepted`, and the score keeps reporting it** | nothing to act on |
| what it must say | `detail` is required to state **what was searched and why it could not be closed** — an escalation reading only "not covered" asks you to redo the search the system already did | whatever it says |
| deep-links | yes (P3-35) | no |

**RECOMMENDATION AND DECISION: escalation.** It already exists, it is durable, it forces the
"what was searched" discipline, and — the deciding property — it gives an **accept the gap** path, so
a requirement your profile genuinely cannot evidence stops nagging without anything pretending it was
covered. A note has none of that and vanishes on the next build.

**The nudge is included either way, per the owner.** The escalation's `ask` field carries it, and the
Rewrite button is mounted on the section itself so the nudge and the action are in the same place.

### STILL OPEN — the owner has not answered these

- **OD-0 (BLOCKING).** Whether the remediation loop is the culprit at all. `D:remediation-never-ran`
  measures `remediation_loop` at 0 rows in production; if that holds, the stuffed summary came from
  Call 1/Call 3 and this work is redesigning something that has never run. `boost-pg-mcp-write` was
  still unavailable at 02:5x UTC 2026-09-01 (re-probed). Needs a connector refresh or an explicit
  instruction to use `db-query.yml`.
- **OD-1.** Whether paraphrase counts automatically or only after an owner click. The owner asked
  *"A is using llm correct?"* and was answered — the proposal tier already exists and already uses a
  model, gated on a click — but has not yet said whether to keep the gate. **Nothing in group A is
  implementable until this is answered**, because it decides whether (A) is a UI surfacing job
  (option a), a rule-writing job (option c), or a guard removal (option b, not recommended).
