# AC-h26-cross-file — should H26's uniqueness invariant reach beyond `hardening.test.mjs`?

<!--
WHAT:       Adversarial acceptance criteria for widening (or NOT widening) H26's ID-uniqueness scan
            beyond api/test/hardening.test.mjs.
WHY:        H26 asserts "one ID one case, across every form" but reads ONE file. ~549 H-cases live
            outside it and four slugs repeat. Either the check is blind or the invariant is overstated.
SUPERSEDES: nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:   this file; every number below carries the command that produced it
-->

**Status: COMPLETE.** Written incrementally; every section stands alone.

Branch `claude/boost-app-setup-approach-ejv09v`. AC author did not design this change.

## 0. Corrections to the brief before anything else

| Brief said | Ground truth | How settled |
|---|---|---|
| H26 reads `new URL('./hardename.test.mjs', import.meta.url)` | The literal is `./hardening.test.mjs` — spelled correctly | `sed -n '804,806p' api/test/hardening.test.mjs` |

(The brief invited this check explicitly. Recorded so no AC below encodes a typo that does not exist.)

## 1. FEASIBILITY TABLE (before any AC)

Every number below was produced by the command in its own row, run on this branch on 2026-09-02.
Scanner used for the "H26 regex" rows: `/tmp/.../scan.mjs`, which reproduces H26's `stripComments`
(`api/test/hardening.test.mjs:43-45`) and its exact regex
`/test\('(H(?:\d+b?|:[a-z0-9-]+)):/g` (`:806`) against `api/test` + `app/test`.

| Dependency | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|
| H26 itself | `api/test/hardening.test.mjs:804-834` | `npm test` in `api/` | `sed -n '804,834p'` — reads `new URL('./hardening.test.mjs', …)`, one file | **EXISTS-BUT-CONSTRAINED** — invariant claims "across every form", scan covers one file |
| H-cases outside `hardening.test.mjs` | 45 test files in `api/test` + `app/test` | nothing global | `grep -rln "test('H[:0-9]" --include=*.mjs app/test api/test` → **46 files** (45 + hardening) | **EXISTS** |
| Raw count outside | — | — | `grep -rn "test('H[:0-9]" … \| grep -v hardening \| wc -l` → **549** | **EXISTS** (brief's 549 confirmed as a RAW grep) |
| Count under H26's OWN regex | — | — | scan.mjs → **429 total** (131 in `hardening`, **298 outside**), **423 distinct** | **EXISTS-BUT-CONSTRAINED** — see §2, the regex misses 259 real cases |
| Duplicate ids | — | H26's `dupes` assertion | scan.mjs → **exactly 4**, all **within one file each** | **EXISTS** — brief's four confirmed |
| Numeric ids (`H\d+`) outside `hardening.test.mjs` | — | H26's FROZEN check | scan.mjs → **0** | **ABSENT** (today) |
| 1-word slugs | — | H26's `badSlugs` assertion | scan.mjs → **none** across all 371 slugs | **ABSENT** |
| `>= 52` staleness floor | `:807` | H26 | true count in-file today is **131** — floor is 2.5x stale and cannot fire | **EXISTS-BUT-CONSTRAINED** |

Corrections to the brief's numbers, stated plainly because ACs must not encode a wrong count:

- **"~549 outside vs ~52 inside"** compares a RAW grep against H26's comment-stripped, regex-filtered
  count. Like-for-like under H26's own regex it is **298 outside vs 131 inside**; like-for-like raw it
  is 549 vs 137. The `52` is neither — it is the stale literal in the assertion, not a measurement.
- **"~680 distinct H ids"** → **423** under H26's regex; 678 under a loose `sort -u` of raw grep hits
  that also counts comment lines and prose fragments. Use 423.
- **The four duplicate slugs are confirmed**, and all four are **intra-file**. Cross-file duplication
  count today: **zero**.

## 2. THE FINDING THAT REFRAMES THE BRIEF — H26's regex, not its file scope, is the primary defect

The brief asks whether the SCAN should widen from one file to many. Measured, the more damaging
hole is one level lower: **H26's capture regex cannot see a large fraction of the H-cases that
already exist, including six in its own file.** Widening the file glob while keeping the regex
would reproduce, exactly, the failure H26's own comment block confesses to
(`api/test/hardening.test.mjs:790` — *"STRUCTURALLY BLIND to the actual failure… 44 of 52 cases
were scanned, and H4b/H5b/… were invisible"*). That is the same bug, the same cause, a third time.

The regex (`:806`) is `/test\('(H(?:\d+b?|:[a-z0-9-]+)):/g`. It requires **(i)** a literal `:`
immediately after the id and **(ii)** for numerics, a suffix of at most a single `b`, and
**(iii)** for slugs, characters drawn only from `[a-z0-9-]`.

Proof, run directly against the literal regex:

```
node -e "const re=/test\('(H(?:\d+b?|:[a-z0-9-]+)):/ ; …"
  NO MATCH    test('H45c: new case',            <- a NEW number can be minted as H45c
  NO MATCH    test('H5c: x',
  NO MATCH    test('H39d: x',
  MATCH H45b  test('H45b: x',
  NO MATCH    test('H:Upper-Case: x',
  NO MATCH    test('H:plain-slug-no-colon',     <- the dominant form outside hardening.test.mjs
```

### 2a. Six cases in H26's OWN file are invisible to it

| line | id | why invisible |
|---|---|---|
| `api/test/hardening.test.mjs:183` | `H5c` | suffix `c`, regex allows only `b` |
| `:1689` | `H39c` | suffix `c` |
| `:1731` | `H39d` | suffix `d` |
| `:4215` | `H:cross-list-drop-tells-the-truth-about-the-document` | no trailing `:` (slug is the whole title) |
| `:4721` | `H:every-evidence-count-has-a-reader` | no trailing `:` |
| `:4745` | `H:the-judge-reports-what-it-did` | no trailing `:` |

**Self-correction, recorded because an AC built on a wrong number is worthless:** my first extractor
reported ~80 invisible in-file cases. That was my regex capturing a bare `H` from lines that H26
*does* match. Re-measured with a line-preserving stripper and a correct extractor, the honest number
is **6 of 137** (H26 sees 131, 95.6% of its own file). Two separate scanner bugs of my own —
`stripComments` collapsing block comments and shifting every line number, and the bare-`H` capture —
are exactly the class of error these ACs must not bake in.

### 2b. The counter-retirement mechanism has a hole

H26's stated mechanism is *"a new numeric ID cannot be minted"*. It is enforced by
`ids.filter(id => /^H\d+b?$/.test(id) && Number(...) > FROZEN_MAX)`. Since `test('H45c: …')` is not
captured at all, **`H45c` mints a new number past the frozen range and H26 stays green.** This is
not hypothetical form-guessing: `H5c`, `H39c`, `H39d` are the same shape and are live in the file
today. The ban is one keystroke wide.

### 2c. Repo-wide scale

| measure | value | command |
|---|---|---|
| H-cases present (`api/test` + `app/test`, comments stripped) | **687** | scan with `/test\(\s*['"`](H(?::[A-Za-z0-9-]+\|\d+[a-z]?))/` |
| …of which H26's regex can see | **429** | H26's literal regex |
| **blind to** | **258** | difference |
| of the 258: no trailing colon | 220 | classifier |
| of the 258: uppercase in slug | 20 | e.g. `H:proposed-evidence-cannot-pass-ANY-evidence-check` (`api/test/checks.test.mjs:681`) |
| of the 258: both | 14 | |
| duplicates hidden inside those 258 | **0** | none — widening the regex adds no new firing today |

**Consequence for the ACs below:** any AC that widens scope MUST first fix the regex, and MUST be
proved against the forms above. A widened scan on the current regex would report "687 cases checked"
while checking 429 — a number a reviewer would trust, and the exact `H:no-vacuous-gate` failure mode.

### 2d. A fourth blind spot: the registration alias

`api/test/dimensionsDb.test.mjs:321` registers a case as **`t('H:dimension-ddl-parity: …')`**, where
`t = HAVE_PG ? test : test.skip` (`:153`). Every scanner keyed on `test('` — H26's included, and my
own until this point — misses it.

```
grep -rhoE "^\s*[A-Za-z_$][A-Za-z0-9_$]*\(\s*['\"\`]H[:0-9]" api/test app/test --include=*.mjs | …
  686 test
    2 t
```

This is not cosmetic. `H:dimension-ddl-parity` is **cited six times from committed source**
(`api/src/functions/tests/appDimensions.ts:25`, `api/src/functions/tests/schema.ts:1142`,
`api/test/correctionDdlParity.test.mjs:48`, …). Under any `test('`-keyed scan it is a case that
exists, is relied upon in comments as the thing that guards the DDL, and **is invisible**. The
"pointer resolves to nothing" harm H26 names is therefore already live — in the direction the brief
did not ask about.

Total population, stated once so no AC has to re-derive it: **687** `test('H…` registrations
(comments stripped) **+ 2** `t('H…` = **689**; H26 sees **429**.

---

## 3. ADJUDICATION — which invariant, argued from harm

### 3a. Is the harm premise true? Yes, and it is instantiated

H26's failure message is *"two cases share an ID — actions.md now points at both and resolves to
neither."* That presumes H-ids are cited from outside the suite. They are:

| Where | Count | Command |
|---|---|---|
| `.claude/*.md` — distinct H-ids cited | **166** (119 of them slugs) | `grep -rhoE "\bH(:[a-z0-9-]+\|[0-9]+b?)\b" .claude/*.md \| sort -u \| wc -l` |
| `.claude/actions.md` — citation lines | **128** | `grep -coE …` |
| committed **source** (`api/src`,`app/src`,`scripts`,`.github/workflows`) | **97 citations** across 207 files | scope scan |

And **three of the four duplicate slugs are cited from outside the suite**:

| Duplicate slug | Cited at | Why the ambiguity bites |
|---|---|---|
| `H:kind-abbr-single-definition` (×2) | `docs/qc-evidence/VERIFY-pr47.md:317` — *"M6 … 239 / **1 fail** … `H:kind-abbr-single-definition`"*; `.claude/actions.md:3087` | A **verification artifact** claims a mutation made this guard fire. The slug names two tests and exactly one failed. A reader auditing that claim cannot tell which, without re-running. This is accusation-grade evidence pointing at an ambiguous target. |
| `H:corrections-render-beside-the-field` (×2) | `.claude/actions.md:3031` — *"Also loosened one pre-existing guard, deliberately."*; `.claude/memory.md:3304` | The record says **one** guard was loosened. Two tests carry the name. Which one was weakened is unrecoverable from the record. |
| `H:keyword-claim-follows-provenance` (×4) | `app/src/screens/PostingAnalysis.jsx:679` — *"flips the provenance and asserts the screen changes"* | A source comment describes **one specific** behaviour; the pointer resolves to four tests, only one of which does that. |
| `H:no-fabricated-keyword-numerator` (×2) | no external citation found | Harmless today. |

**Observation vs interpretation.** Observed: the citations above exist and each names a slug carried
by 2-4 tests. Interpreted: this degrades auditability of an evidence artifact and of two deliberate
guard-weakening records. It is *not* a correctness defect — every one of the four still runs and
still fails on its own defect. The harm is to the AUDIT TRAIL, which is what H26 exists to protect.

### 3b. The options, each judged by what breaks in the real world

**Option (A) — a slug may appear once, full stop.**
- Fires on: all 4 today.
- What breaks if violated: the three citation harms in 3a.
- **Cost of adopting it:** the fix is to rename, e.g. `H:kind-abbr-single-definition` →
  `H:kind-abbr-no-second-map` + `H:kind-abbr-reexport-same-object`. That **invalidates the existing
  citations** in `VERIFY-pr47.md:317`, `actions.md:3031/3087`, `memory.md:3304` and
  `PostingAnalysis.jsx:679`, converting *resolves-to-two* into *resolves-to-nothing* — which the
  repo's own `D:ledger-citation-resolves` treats as the worse failure (*"re-keying a row without
  updating what points at it leaves a pointer resolving to nothing"*). Adopting (A) is therefore
  only safe **if the same change updates every citation**, and only if a guard then keeps them
  updated. Recommending (A) without that is recommending a regression.
- **Verdict: correct in principle, unsafe as a bare assertion.** Viable only as (A)+citation-guard.

**Option (B) — a slug may repeat within one file, never across two.**
- Fires on: **zero** cases today (all 4 duplicates are intra-file; cross-file duplication is 0).
- What breaks if violated: two files independently mint the same slug for different guards — the
  genuine uncoordinated-lane collision H26 was built for, and the one shape a reviewer cannot spot
  locally.
- **This is the only option that targets the ORIGINAL root cause** stated in H26's comment: *"the
  collision exists only in the union of branches that cannot see each other."* Two lanes editing the
  same file conflict in git; two lanes editing different files do not.
- Cost: none. No renames, no citation churn.
- Weakness: a guard that fires on nothing today. Per `CLAUDE.md` that is acceptable **only** if it
  is mutation-proved — an unfireable guard is the `H:no-vacuous-gate` failure. It is provable (see
  AC-9).
- **Verdict: the highest value-per-cost option, and it is not cry-wolf.**

**Option (C) — only numerics must be globally unique; slugs need only be file-unique.**
- This is (B) restated for slugs plus a numeric rule that is **vacuous**: there are **0** numeric
  ids outside `hardening.test.mjs` (measured). It adds a clause that cannot fire and cannot be
  mutation-proved against real data.
- **Verdict: rejected — (B) already contains everything in (C) that can fire.**

**Option (D) — do not widen; narrow H26's wording to match its file scope.**
- Argument for: honesty. A guard claiming "across every form" while reading one file with a regex
  blind to 258 cases is a **believed** guard that protects a third of what it names — worse than no
  guard by the repo's own rule.
- Argument against: it leaves the three instantiated citation harms in 3a unaddressed, leaves
  `H:dimension-ddl-parity` invisible, and leaves the mint-ban bypassable by `H45c`.
- **Verdict: (D) is right about the *wording* and wrong as the *whole* answer.** Its true content —
  *a guard must not claim more scope than it checks* — is adopted below as AC-2, applied to whatever
  scope is chosen. Rejected as a standalone outcome.

### 3c. RECOMMENDATION

**Adopt (B) as the uniqueness rule, but only after fixing the regex, and pair it with the
citation-resolution guard the repo already runs for D-ids.** Ordered by value:

1. **Fix the recogniser first** (AC-1/AC-3). Without it every count below is a lie, and widening the
   glob alone repeats H26's own documented third failure.
2. **(B): no slug spans two files** (AC-6). Targets the real uncoordinated-lane collision. Costs nothing.
3. **Intra-file repeats are LEGAL but must be DISCRIMINATED** (AC-7): all four current duplicates
   already carry a distinct clause after the slug (`H:kind-abbr-single-definition: no second
   abbreviation map…` vs `…: the re-export is the SAME OBJECT…`). Requiring the **full test title**
   to be unique keeps "one concept, one name" while making every test individually addressable as
   `slug: clause`. This is the option the brief called (C)-other and it is what the code already does
   — the ACs make it enforced rather than accidental.
4. **Citation resolution** (AC-8) — the higher-value guard, and the one with a live failure today
   (`H:dimension-ddl-parity`). Extend, don't duplicate: `D:ledger-citation-resolves`
   (`api/test/deferredLedger.test.mjs:207`) already implements exactly this for D-ids, including its
   own anti-blindness floor. **Scope it as that guard does** — source + `actions.md` + `DEFERRED.md`,
   **never** `docs/qc-evidence/**` or `.claude/ac/**`, because AC and BRIEF documents legitimately
   *propose* slugs before they exist. Measured: 208 dangling ids repo-wide including proposal docs,
   **43** under the D-guard's scope, **10** under source-only.

### 3d. A fifth blind spot that changes AC-8 — the template-literal registration

`app/test/prototypeCoverage.test.mjs:229-234`:

```js
for (const [name, fn] of Object.entries(T)) {
  test(`H:coverage-${name}`, () => { … })
}
```

The ids (`H:coverage-tally-matches-rows`, `H:coverage-rows-parse`, …) **exist only at runtime**. Every
static scanner — H26's, and mine — sees the literal prefix `H:coverage-`, which is a **one-segment
slug** and would FAIL H26's own `badSlugs` assertion (`< 2` segments) if the scan were widened
naively. That is a false positive on correct code: the cry-wolf failure `CLAUDE.md` names explicitly
and which this repo has already paid for once (the deleted smart-quote linter, `.github/workflows/test.yml`).

**Self-correction.** I classified `H:coverage-tally-matches-rows` (cited 16× in `.claude/actions.md`,
including `:7411` *"**GUARD: `H:coverage-tally-matches-rows`**"*) as a dangling pointer. **It is not.**
It is generated from `T`'s key `'tally-matches-rows'` (`:186`). The citation is correct and a static
citation guard would have accused it.

---

## 4. THE FOUR SUB-QUESTIONS

### 4a. Where should a cross-file check LIVE?

**In `api/test/hardening.test.mjs`, extending H26 in place. Do not create a new home.**

| Consideration | Evidence | Reading |
|---|---|---|
| Does one suite reliably run when the other's files change? | `.github/workflows/test.yml` — jobs `api` and `app` both trigger on `push:[main]` / `pull_request:[main]` with **no `paths:` filter** | **BOTH always run.** A guard in either suite is live for changes on either side. Placement is not a coverage question in CI. |
| Does `hardening.test.mjs` already read outside `api/`? | `:356` `../../scripts/wait-run.sh`; `:1105`,`:3645`,`:4118` `../../app/src/api.js`; `:1110` `../../web/`; `:2550`,`:4580` `../../.github/workflows/*.yml`; `:2953` `../../prompts/`; **`:4319-4339` walks the repo root across `api/src`,`app/src`,`scripts`,`.github/workflows`** | Repo-wide reads are an **established pattern in this exact file**. |
| Extend or duplicate? | H26 already owns id-uniqueness, the mint ban, the frozen-gap check and slug quality | Splitting the id rules across two files would leave two partial authorities on one concept — the `CLAUDE.md` "Extend, don't duplicate" violation, and the same shape as the `taxonomy_title` failure it cites. |
| Counter-argument from `prototypeCoverage.test.mjs:25` | *"It lives in `app/test` … because every path an ABSENT row names is under `app/src`, and this suite is the one that runs when those files change"* | That rationale is about the **local** `npm test` habit, not CI. It applies when a guard's subject is wholly in one tree. H26's subject spans **both** trees, so it cannot sit in the tree of its subject — it must read across, and `hardening.test.mjs` is the file already equipped to. |

**Caveat that must be in the implementation:** the api job runs `working-directory: api`, so paths must
be `new URL('../../app/test/', import.meta.url)`-relative, and the scan must **not** import from
`app/` (no `npm ci` runs there in the api job) — read the `.mjs` files as **text** only.

### 4b. The `>= 52` staleness floor

**Observed:** the literal is `assert.ok(ids.length >= 52, …)` (`:807`). The real in-file count is
**131** under H26's own regex, **137** in fact. The floor is 2.5× stale and cannot fire. If the scan
widens to ~689, a hardcoded floor rots faster still.

**Recommendation: do not floor on the CASE count at all. Floor on the FILE count, and make it
structural.** The repo already does exactly this, twice, for exactly this reason:

- `api/test/hardening.test.mjs:4347` — `assert.ok(files.length > 40, 'the JD rename scan … has gone blind')`
- `api/test/deferredLedger.test.mjs:233` — `assert.ok(files.length > 50, 'citation scan found only … has gone blind')`

A file count changes on the order of once a month; a case count changes several times a day. Better
still, and what AC-4 requires: assert the scanned set **equals** `readdirSync` of both test
directories filtered to `*.test.mjs`. Then it cannot silently shrink at all, there is no literal to
rot, and a new test file is covered the moment it lands.

Second, independent anti-blindness floor (AC-5): assert the recogniser finds **at least one id in
every file it opens**. A file that yields zero is either genuinely H-free or the regex has stopped
matching its style — and the second is precisely how this went wrong three times.

### 4c. Slug quality at scale — is an upper bound worth asserting?

**Measured distribution** (628 slugs, fixed recogniser, hyphen-segments):

```
1:1  2:1  3:42  4:94  5:105  6:119  7:71  8:65  9:48  10:45  11:20  12:9  13:8
```

Longest is **13**, not 11 — e.g. `H:parse-doc-id-handles-null-doc-url-as-a-state-not-an-error`,
`H:a-challenge-that-finds-a-gap-leaves-the-row-exactly-where-it-was`. 37 slugs exceed 10 segments.

**Recommendation: assert NO upper bound. It is ceremony.** Reasoning, from harm rather than taste:

1. **Name the harm and it does not exist.** The lower bound exists because a one-word slug *"is a
   counter with extra steps"* — it fails to identify what is guarded, which is the whole function of
   the id. A 13-word slug **over**-identifies. Nothing breaks: not a citation, not a grep, not a
   pointer. There is no measured incident, and I could not construct one.
2. **A cap fires on 37 correct cases on day one.** By `CLAUDE.md` hardening rule 2 that alone
   disqualifies it — *"a guard people learn to ignore is worse than none"* — and it is the same
   mistake as the smart-quote linter that fired on 8 correct lines and was deleted the same night.
3. **The 2-word minimum should stay and stays cheap.** It fires on 0 correct cases (the only
   sub-2-segment hit, `H:coverage-`, is the template-literal artifact of 3d, which the AC excludes).

If length ever needs attention it is a review comment, not an assertion.

### 4d. A FROZEN numeric id appearing in another file

**Observed: 0 numeric ids exist outside `hardening.test.mjs` today** (scan.mjs). So this is a
future-proofing rule with no current instance.

**Recommendation: it must FAIL, and with a message naming the frozen owner.** Argued from harm, and
the harm is the strongest in this document:

- The frozen ids are frozen *because* they are cited — **359 numeric-H citations** across source,
  `actions.md` and `DEFERRED.md`, with **0 dangling**. That is a fully-resolving pointer namespace,
  the only one in the repo, and it is worth exactly as much as its unambiguity.
- If `H30` appeared in `app/test/qcRail.test.mjs`, every one of the 5 `actions.md` references to
  `H30` would resolve to two unrelated tests in two trees. That is `H26`'s stated harm, at its worst,
  in the one namespace where the pointers currently all work.
- It is also **already forbidden in spirit and unenforced in fact**: H26 bans *minting* numbers
  above 44, but says nothing about *re-using* 1-44 elsewhere, because it never looks elsewhere.

So: any `H<digits>` id defined outside `hardening.test.mjs` fails, whether inside the frozen range
(a collision) or above it (a mint that evaded the ban by changing file). This is one assertion
covering both, and it is the cheapest high-value clause in the whole widening.

---

## 5. ACCEPTANCE CRITERIA

Scope note: these describe **extending `H26` in place** in `api/test/hardening.test.mjs`, keeping its
id `H26` (it is cited 3× from `.claude/actions.md`; re-keying it would be the exact
resolves-to-nothing regression argued in 3b).

All commands run from the repo root unless stated. `SCAN` denotes the widened recogniser.

### Group 1 — the recogniser (must land before any scope widening)

**AC-1.** *Given* the six registration forms proven to exist in this repo, *when* `SCAN` runs over
`api/test/*.test.mjs` and `app/test/*.test.mjs`, *then* it captures the id from **all** of them:

| # | form | live instance |
|---|---|---|
| a | `test('H12: …')` | `api/test/hardening.test.mjs:311` |
| b | `test('H4b: …')` | `:139` |
| c | `test('H39d: …')` — suffix beyond `b` | `:1731` |
| d | `test('H:slug-with-clause: …')` | `:1543` |
| e | `test('H:slug-is-the-whole-title')` — **no trailing colon** | `:4721` |
| f | `test('H:slug-with-UPPERCASE-words: …')` | `api/test/checks.test.mjs:681` |
| g | `t('H:dimension-ddl-parity: …')` — aliased registrar | `api/test/dimensionsDb.test.mjs:321` |

**Decides it:** a test asserting `SCAN` returns the exact id for each of those seven `file:line`
anchors. Binary.

**AC-2.** *Given* H26's failure messages and comment block, *when* the scope changes, *then* the
stated invariant matches the scope checked — no sentence claims "across every form" or "every
hardening case" while any live registration form is unmatched. **Decides it:** AC-1 passing is the
proof; the wording change is reviewed against AC-1's table. *(This is option (D)'s legitimate content,
retained.)*

**AC-3.** *Given* the current regex `/test\('(H(?:\d+b?|:[a-z0-9-]+)):/`, *when* `SCAN` replaces it,
*then* the count of ids found repo-wide is **≥ 685** (measured today: 687 `test(` + 2 `t(` = 689;
429 under the old regex). **Decides it:** `assert.ok(ids.length >= 685)`. Binary, but see AC-4 —
this literal is a transitional check only and AC-4 supersedes it.

### Group 2 — anti-blindness (the floor)

**AC-4.** *Given* that a hardcoded case-count floor rots (the live `>= 52` against a real 131),
*when* `SCAN` runs, *then* the set of files it opened **equals** `readdirSync` of `api/test` and
`app/test` filtered to `*.test.mjs`, asserted by `deepEqual` on sorted basenames — no numeric literal.
**Decides it:** `assert.deepEqual(scanned.sort(), expected.sort())`. Binary. Today both sides are
**46 files**.

**AC-5.** *Given* that a recogniser which stops matching a file's style reports zero and reads as
success, *when* `SCAN` runs, *then* every file that contains the substring `test('H` or `` test(`H ``
yields **at least one** captured id, and any file that does not is named in the failure.
**Decides it:** per-file assertion. Binary. Today: 0 such files after AC-1.

### Group 3 — the uniqueness rule (the adjudicated question)

**AC-6 — option (B), the cross-file ban.** *Given* two lanes on branches that cannot see each other,
*when* `SCAN` groups ids by file, *then* **no id is defined in two different files**, and the failure
names every id with each defining `file:line`. **Decides it:** `assert.deepEqual(crossFile, [])`.
Binary. Today: **0 offenders** — see AC-9 for why that is not vacuous.

**AC-7 — intra-file repeats are legal, but must be discriminated.** *Given* that a slug names one
guard and a guard may need several assertions, *when* an id is defined more than once **within one
file**, *then* every such definition carries a non-empty discriminator after `<id>: ` **and the full
test titles are pairwise distinct**. *Given* two definitions in one file with byte-identical titles,
*then* it fails. **Decides it:** `assert.deepEqual(sameTitle, [])` plus a discriminator-presence check.
Binary. Today the four known repeats all pass: e.g.
`app/test/postingAnalysis.test.mjs:528` `…: no second abbreviation map anywhere in app/src` vs `:550`
`…: the re-export is the SAME OBJECT, not a copy`.

**AC-7b — the exclusion that prevents cry-wolf.** *Given* `app/test/prototypeCoverage.test.mjs:230`
registers ids from a template literal (``test(`H:coverage-${name}`)``), *when* `SCAN` encounters a
title containing `${`, *then* it is **excluded from the slug-quality and uniqueness assertions** and
recorded in a named exclusion list in the source, with the reason. *Given* the exclusion list grows
beyond the interpolated forms, *then* review is required. **Decides it:** running the widened guard
produces **zero** findings against `prototypeCoverage.test.mjs`. Binary. Without this, the widened
guard fires on `H:coverage-` as a one-word slug — correct code, accused.

**AC-8 — the frozen numeric namespace.** *Given* the 55 numeric ids are cited 359× with 0 dangling,
*when* any id matching `/^H\d+[a-z]?$/` is defined **outside** `api/test/hardening.test.mjs`, *then*
it fails, naming the file and the frozen owner's `file:line`. **Decides it:**
`assert.deepEqual(numericsElsewhere, [])`. Binary. Today: **0**.

**AC-9 — the mint ban must survive the suffix.** *Given* `test('H45c: …')` is currently captured by
nothing and therefore mints a new number silently, *when* `SCAN` runs, *then* any id `H<n>` or
`H<n><letter>` with `n > 44` fails the mint assertion regardless of the suffix letter.
**Decides it:** the mutation in 6.4. Binary.

**AC-10 — slug quality unchanged in substance.** *Given* the measured distribution (min 2 segments
after AC-7b, max 13), *when* `SCAN` runs, *then* the `< 2` segment rule is retained and **no upper
bound is introduced**. **Decides it:** `assert.deepEqual(badSlugs, [])` still passes at 0, and no
new assertion references a maximum. Binary.

### Group 4 — the criterion I cannot make binary

**AC-11 — citation resolution. NOT BINARY TODAY. RECOMMEND DEFER to its own AC pass.**
*Given* an H-id cited from committed source or `.claude/actions.md`, *when* the citation names no
defined case, *then* it should fail. **I cannot state a threshold that is both non-vacuous and
non-crying-wolf, and here is the measurement rather than an opinion:**

| variant | citations | dangling | assessment |
|---|---|---|---|
| numeric ids only (exact `D:ledger-citation-resolves` mirror) | 359 | **0** | **vacuous** — and redundant: H26's frozen-gap check already catches a deleted `H1-44` |
| slugs, bare-token match, D-guard scope | 1021 | 43 | ~75% false positives — prefix citations, line-wrapped slugs, `H:owner-edit-*` wildcards |
| slugs, **fully backtick-delimited** only | 198 | **11** | best variant; still **~6 of 11 are false** |

The 11, adjudicated individually:
- **False (2):** `H:schema-parity`, `H:no-vacuous-gate` — illustrative examples in **H26's own comment
  prose** (`api/test/hardening.test.mjs:798`). The guard would accuse its own documentation.
- **False (1):** `H:coverage-tally-matches-rows` — **generated at runtime** (3d). Correct citation.
- **False (1):** `H:proposed-evidence-cannot-pass-the-gate` — `api/test/checks.test.mjs:597`, *"It
  **used to read** `…`"*. A deliberate historical reference.
- **False (1):** `H:pooled-mode-is-relevant-only` — an abbreviation of the real
  `H:pooled-mode-is-relevant-only-and-only-off-the-master` (`api/test/swaps.test.mjs:811`).
- **Probably real (4-5):** `H:refusal-guard-fires` (`api/src/functions/tests/appRequirements.ts:272`,
  *"Exercised by …"*), `H:a-judged-row-counts-and-a-proposed-one-does-not`
  (`api/src/functions/tests/checks.ts:981`, *"pins both halves"*),
  `H:a-vetted-row-counts-and-a-proposed-one-does-not` (`api/test/proposalVet.test.mjs:129` — note the
  judged/vetted pair, which looks like a rename that left both citations stranded),
  `H:safety-floor-not-configurable`, `H:offsets-from-original`.

**Why it is not binary:** the D-guard works because `D\d{1,2}[a-z]?` is a **closed lexical form** that
cannot be truncated, wrapped, abbreviated or interpolated. An H-slug is open-ended hyphenated prose
and does all four. The distinction is structural, not an implementation detail, so no amount of regex
care makes the slug variant clean.

**Recommendation:** ship AC-1..AC-10 without it. Then run a separate pass whose *first* deliverable
is deciding the citation grammar (e.g. mandating `` `H:…` `` backticks in comments, or a
`@guard H:…` marker), because the guard is only worth building once the citations have a form it can
trust. The 4-5 probable danglers should be fixed by hand in the meantime — that is a five-minute
grep, not a guard. **This is the single highest-value item in the whole area and it is being deferred
deliberately, not overlooked.**

---

## 6. REGRESSION GUARD — slugs, invariants, and the exact mutation that must make each FIRE

### 6.1 Naming — extend, do not mint a family

Keep **`H26`** as the case id. It is cited 3× from `.claude/actions.md`; re-keying it converts
working pointers into dangling ones, the regression argued in 3b. Its title should change to match
the widened scope (AC-2), its id must not.

Add exactly **one** new case, mirroring the two harnesses this repo already runs:

> **`H:id-guard-not-vacuous`** — *every assertion in `H26` fires on its own reinstated defect.*

Rationale: `api/test/deferredLedger.test.mjs:235` (`D:ledger-guard-not-vacuous`) and
`app/test/prototypeCoverage.test.mjs:236` (`H:coverage-tally-guard-not-vacuous`) are the same
construct for the D-ledger and the coverage doc. A third instance for the H-namespace is extension of
an established pattern, not a parallel system. Two words minimum satisfied; no upper bound (4c).

### 6.2 Which vehicle — both, for different assertions

| assertion | vehicle | why |
|---|---|---|
| every clause of `H26` (recogniser forms, cross-file, intra-file titles, numerics, mint ban, slug floor) | **in-suite fixture harness** (`H:id-guard-not-vacuous`) | The subject is a *list of ids*, so a defect is reinstated by feeding a synthetic id-list through **the same assertion function CI runs** — the `A[name](…)` shape at `api/test/deferredLedger.test.mjs:235-262`. Fast, deterministic, and it proves each clause independently. `mutate.sh` cannot isolate one clause of a multi-assert test. |
| the end-to-end claim that a **real** cross-file duplicate in a **real** file fails CI | **`scripts/mutate.sh`** | The fixture harness proves the assertion; only a real mutation proves the *wiring* — that the widened glob actually reaches `app/test` from a suite running in `api/`. This is the clause most likely to be silently mis-pathed. |

**Both traps measured on this repo are sidestepped here, and the reason is worth stating.** The
`mutate.sh` target is a **`.mjs` test file**, not a `.ts` source file. So:
- the `&&` vs `;` trap (tsc exits non-zero on a mutation's type error yet still emits JS → false
  `INERT`) does not arise, because no mutation touches TypeScript. **Use `;` regardless** — `npm test`
  in `api/` is `npm run build && node --test test/*.test.mjs`, so a build failure from any *unrelated*
  cause would otherwise be read as the guard firing.
- the "restores SOURCE but not `dist/`" trap does not arise, because `.mjs` test files are not
  compiled into `dist/`. **Do not** pick a `.ts` file for this mutation; the equivalence of the
  restore is only clean on the test tree.

Anchors must come from **files, not shell arguments** (backslashes and `$` are lost through bash),
and every fixture in the in-suite harness carries the two assertions that turn a stale fixture into a
loud failure rather than a false `INERT`:
`assert.notEqual(i, -1, 'fixture anchor … not found')` and
`assert.notEqual(out[i], LINES[i], 'fixture … applied no change')`
(`api/test/deferredLedger.test.mjs:238-241`).

### 6.3 The fixture matrix — one row per clause, each must FIRE

Each row reinstates exactly one defect and asserts the named clause returns a non-empty problem list.

| # | AC | defect reinstated in the fixture | clause that must FIRE |
|---|---|---|---|
| M1 | AC-1c | id list built from a source line `test('H39d: …')` with the recogniser reverted to `\d+b?` | the AC-1 form assertion reports `H39d` unseen |
| M2 | AC-1e | source line `test('H:every-evidence-count-has-a-reader', …)` with the recogniser reverted to require a trailing `:` | AC-1 reports the no-colon form unseen |
| M3 | AC-1f | `test('H:proposed-evidence-cannot-pass-ANY-evidence-check: …')` with the class reverted to `[a-z0-9-]` | AC-1 reports the uppercase form unseen |
| M4 | AC-1g | `t('H:dimension-ddl-parity: …')` with the registrar alternation reverted to `test` only | AC-1 reports the aliased form unseen |
| M5 | AC-4 | remove one entry from the scanned-file list | `deepEqual(scanned, expected)` fails naming the omitted file |
| M6 | AC-5 | a file whose every H-title is renamed to a non-matching form | the per-file floor names that file |
| M7 | **AC-6** | id list where `H:kind-abbr-single-definition` is also defined in `api/test/checks.test.mjs` | cross-file assertion fires, naming both `file:line` |
| M8 | AC-7 | two definitions in one file with **byte-identical** full titles | identical-title assertion fires |
| M9 | AC-7 | one definition of a repeated slug with the discriminator removed (`H:kind-abbr-single-definition` bare) | discriminator assertion fires |
| M10 | **AC-7b** | remove `prototypeCoverage.test.mjs` from the exclusion list | slug-quality assertion fires on `H:coverage-` — **proving the exclusion is what prevents a false accusation** |
| M11 | **AC-8** | id list with `H30` defined in `app/test/qcRail.test.mjs` | numerics-elsewhere assertion fires, naming `api/test/hardening.test.mjs:947` as the frozen owner |
| M12 | **AC-9** | id `H45c` in the list | mint-ban assertion fires (**today it does not — this is the live hole of 2b**) |
| M13 | AC-10 | id `H:single` in the list | `badSlugs` fires |
| M14 | AC-10 inverse | id `H:parse-doc-id-handles-null-doc-url-as-a-state-not-an-error` (13 segments) | **nothing fires** — the no-upper-bound decision of 4c, asserted rather than assumed |

M14 is a **negative** fixture and is the honest way to encode 4c: it fails if someone later adds a
length cap, which is the outcome that decision forbids.

### 6.4 The one real `mutate.sh` run — end-to-end wiring proof

```
# anchor.txt      -> test('H:kind-abbr-single-definition: no second abbreviation map anywhere in app/src', () => {
# replacement.txt -> test('H30: no second abbreviation map anywhere in app/src', () => {
/workspace/eds-claude-skills/scripts/mutate.sh \
  app/test/postingAnalysis.test.mjs anchor.txt replacement.txt \
  'cd api ; npm test' \
  'H30 is frozen to api/test/hardening.test.mjs'
```

Expected: **FIRED**. This single mutation exercises AC-8 *and* proves the api-suite guard genuinely
reads `app/test` across the `working-directory: api` boundary. `NOT-APPLIED` means the anchor is
stale — re-read the line, do not treat it as `INERT`.

**Do not run it against a `.ts` file, and do not chain with `&&`** (6.2).

### 6.5 What is NOT claimed

AC-6 and AC-8 fire on **zero** cases today. They are proved by M7/M11 fixtures, not by finding a live
offender. That is a mutation proof of the assertion, and it is stated as such rather than as evidence
that the widening found real defects. The clauses that **do** have live subjects today are AC-1
(258 invisible cases repo-wide, 6 in-file), AC-9 (`H45c` mints silently now), and AC-7b (which
prevents a false accusation the widening would otherwise create).

---

## 7. CRITERIA CONSIDERED AND REJECTED

| # | Rejected criterion | Reason |
|---|---|---|
| R1 | **Option (A): a slug may appear exactly once, repo-wide** | Fires on 4 cases whose full titles are already unique and which are genuinely sub-assertions of one guard. The remedy (renaming) strands 5 external citations (`VERIFY-pr47.md:317`, `actions.md:3031`/`:3087`, `memory.md:3304`, `PostingAnalysis.jsx:679`), converting *resolves-to-two* into *resolves-to-nothing* — which `D:ledger-citation-resolves` treats as the worse harm. Adopted only in the weakened form AC-7. |
| R2 | **Option (C): numerics globally unique, slugs file-unique** | The numeric half is vacuous (0 numerics outside `hardening.test.mjs`) and the slug half is AC-6 restated. Contains nothing AC-6 + AC-8 does not. |
| R3 | **Option (D) as the whole answer: narrow the wording, widen nothing** | Right that the wording overclaims (kept as AC-2), but leaves the `H45c` mint hole open, leaves `H:dimension-ddl-parity` invisible, and leaves 258 cases unscanned. |
| R4 | **Widen the file glob while keeping the existing regex** | Would report "689 cases checked" while checking 429. This is exactly the failure H26's own comment records at `:790`, for the third time. Explicitly forbidden by AC-1 landing first. |
| R5 | **An upper bound on slug length** | Fires on 37 correct slugs on day one; no harm can be named for a long slug. Cry-wolf (`CLAUDE.md` hardening rule 2); same shape as the deleted smart-quote linter. Encoded as the negative fixture M14. |
| R6 | **A hardcoded case-count floor (`>= 685`)** | Rots in days — the live `>= 52` is already 2.5× stale against 131. Replaced by the structural file-set equality of AC-4. Retained only as the transitional AC-3. |
| R7 | **A citation-resolution guard for H-slugs, in this change** | Measured ~6 of 11 false positives even in its cleanest variant, including accusing H26's own comment prose and a runtime-generated id. Deferred as AC-11 with the evidence, not dropped. |
| R8 | **A citation-resolution guard for numeric H-ids** | 359 citations, 0 dangling → vacuous, and redundant with H26's existing frozen-gap check. |
| R9 | **A new home for the check** (`prototypeCoverage.test.mjs`, or a new `hIds.test.mjs`) | H26 already owns id-uniqueness, the mint ban, the gap check and slug quality; splitting leaves two partial authorities on one concept. `hardening.test.mjs` already reads `app/src`, `scripts`, `.github/workflows` and walks the repo root (`:4319-4339`). "Extend, don't duplicate." |
| R10 | **Requiring every H-case to live in `hardening.test.mjs`** | 298-558 cases would have to move; the H-case convention is deliberately distributed so a guard sits beside the code it guards. Not a defect. |
| R11 | **Asserting a canonical registration form** (e.g. banning the `t(` alias and template literals) | Both have legitimate reasons — `t = HAVE_PG ? test : test.skip` skips DB tests without a database; the `H:coverage-${name}` loop keeps one assertion per named check. Making the *scanner* handle them (AC-1g, AC-7b) is cheaper and does not force a rewrite of correct code. |
| R12 | **Running the widened scan in the `app` suite as well** | Both CI jobs already run unconditionally on every PR (`.github/workflows/test.yml`, no `paths:` filter), so a second copy adds no coverage and creates the two-authorities problem of R9. |

---

## 8. FEASIBILITY VERDICT

**Buildable today, entirely within the existing suite, with no new infrastructure.** No dependency is
`ABSENT`. The two `EXISTS-BUT-CONSTRAINED` items — H26's regex and its staleness floor — are the work
itself, not blockers. The one genuinely valuable thing that is **not** buildable cleanly today is
AC-11 (citation resolution), and the reason is a property of the H-slug grammar rather than of the
tooling; it is deferred with its measurement attached so the next pass starts from evidence.

**Recommended order:** AC-1 → AC-4/AC-5 → AC-2 → AC-6/7/7b/8/9/10 → `H:id-guard-not-vacuous` with the
M1-M14 matrix → the single `mutate.sh` wiring proof of 6.4.

**Tier:** this is `CLAUDE.md` **Tier 1** — H26 decides a gate and its failure message *names an
offender* — so an independent verifier is required after implementation, and every new clause must be
mutation-proved before it is believed.
