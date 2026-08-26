# AC — skill-pool breakdown: two-level `relevantProficiencies` + `expertise` rewording

**Author:** independent AC agent (NOT the implementing agent). **Date:** 2026-08-26.
**Target:** `api/src/functions/tests/skillPool.ts` (`buildSkillPool`, `splitSkillField`),
`api/test/skillPool.test.mjs`.
**Prior evidence read first:** `docs/qc-evidence/SKILL-POOL.md` (27 entries, 5 rejected,
api-test run 32997381200).

> Written incrementally as each check completed. Sections appear in the order they were proven.

## 0. HEADLINE — read before writing code

Three findings change the shape of this work. None of them is a reason not to do it; all three
are reasons the ACs below are not the obvious ones.

1. **`buildSkillPool` HAS NO PRODUCTION CONSUMER TODAY.** `grep -rn "from './skillPool'" api/src`
   returns **nothing**. The only importer in the entire repo is `api/test/skillPool.test.mjs`.
   `skillPool.ts`'s own header says *"The route that reads MasterContext and the seeder that writes
   rows both call THIS"* — **that sentence is aspirational, not true.** `diagSkillSources.ts`
   returns the five field strings verbatim and never calls the parser.
   → Consequence for AC-9/AC-10: "the category must reach the consumer" **cannot be satisfied by
   wiring a consumer**, because none exists. It is satisfied by the category being on the returned
   value and pinned by a test. The implementer must NOT claim consumer-reach it does not have.

2. **`skill_bank_entry` ALREADY EXISTS** (`api/src/functions/tests/schema.ts:741`, registered in
   `EXPECTED_TABLES` at :1346) — and it has **NO `category` column**. Its `origin` column is
   `check (origin in ('master_context','portfolio_slide'))`, a *different* origin concept from
   `SkillOrigin`'s six field names. This is the destination the category has to survive into.
   **ALREADY BUILT (partially):** do not create a second bank table. See AC-10.

3. **The live `relevantProficiencies` value is RECOVERABLE OFFLINE and I recovered it.** It is the
   Zapier-archived value (`docs/zap-289877647/zap-289877647.full.json:220`) with `&`→`and` and
   the bullet lines folded to `, `. Proof it is the same value: feeding my reconstruction to the
   CURRENT parser reproduces SKILL-POOL.md's five rejections **word-count for word-count**
   (15/16/23/23/27) and the whole pool reproduces **27 entries / 5 rejected /
   `bySource {skills1:11, skills2:9, softHardSkillsPool:0, expertise:7, relevantProficiencies:0}`** —
   identical to the live api-test run 32997381200. **So every AC below is testable offline with
   `node --test`. No workflow round-trip is needed to verify this change.**

---

## 1. FEASIBILITY TABLE

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (command + result) | Verdict |
|---|---|---|---|---|
| `splitSkillField` / `buildSkillPool` | `api/src/functions/tests/skillPool.ts` | **NOBODY in `api/src`.** Only `api/test/skillPool.test.mjs` | `grep -rn "from './skillPool'" api/src` → **0 results**; `grep -rn skillPool api/src` → only its own file | **EXISTS-BUT-CONSTRAINED** — pure function, zero production callers |
| `relevantProficiencies` field content | owner, MasterContext Storage Table (global partition `context`) | `diagSkillSources.ts` (verbatim passthrough); `evidence.ts:193-195` maps it to `RelevantBullets1..3` | ran current `splitSkillField` on reconstruction → 5 chunks, rejected at 15/16/23/23/27 words, **exactly SKILL-POOL.md §3** | **EXISTS** |
| The 36 terms / 5 categories | same | none | `G1=6 G2=4 G3=8 G4=8 G5=10` → **36**; categories: Governance and Compliance · Technology Strategy and Transformation · Business and Financial Impact · Data Analytics and AI · Execution and Operations | **EXISTS** |
| "zero duplicates" claim for the 36 | — | — | ran `skillKey` for all 36 against the 27-entry baseline → **0 collisions** | **EXISTS — claim CONFIRMED** |
| `expertise` field, 7 statements | owner, MasterContext | `evidence.ts` → `{{ExpertiseBullets}}` | reproduced all 7 as pool entries, `bySource.expertise = 7` | **EXISTS** |
| **Collisions from an `expertise` mechanical split** | — | — | split the 7 on `" and "` / `" for "`, keyed each part vs the 27: **`"Strategic roadmaps"` ↔ `"Strategic Roadmaps"` (skills2)** and **`"M&A due diligence"` ↔ `"M&A Due Diligence"` (skills2)** | **EXISTS — 2 live instances.** This is AC-11's fixture; it is NOT hypothetical |
| `skill_bank_entry` table (the seeder's target) | `schema.ts:741` DDL | **nothing** — `grep -rn skill_bank_entry` outside `dist/` hits only `schema.ts` twice | `grep -rn "skill_bank_entry" --include=*.ts --include=*.jsx .` → `schema.ts:741`, `:767`, `:1346` only | **EXISTS-BUT-CONSTRAINED** — table exists, **has no `category` column**, has no reader or writer |
| A category column to persist into | — | — | read DDL `schema.ts:741-767`: columns are `id, owner_email, label, label_norm, origin, source_ref, source_sha256, fetched_at, updated_at`. **No `category`.** | **ABSENT** |
| `Swap for another skill…` UI (the stated category consumer) | prototype only — `docs/qc-evidence/qc/assets.jsx:77` in worktrees, `SPEC.md:228` | **not built in `app/src`** | `grep -rniE "swap for another" app/src` → 0 results | **ABSENT** — category has no UI consumer yet; AC-9 is written accordingly |
| An existing rewording/canonicalisation table to EXTEND | `api/src/functions/tests/normalise.ts` | artifact build path (`appPackets.ts`, `swaps.ts`) | read `normalise.ts:1-40`: it is a **runtime, per-artifact, char-limit** pass that asks the MODEL for rewrites (`skill_char_limit`, `relevant_char_limit`) | **EXISTS-BUT-CONSTRAINED** — wrong layer and model-driven; it is the thing the design constraint FORBIDS here, not a table to extend. Do **not** route pool rewordings through it |
| `LIST_NUMBER` / `EDGE_JUNK` regexes | `skillPool.ts:49-50` | `tidy()` :70, called by `splitSkillField` | read source; `H:skill-pool-strips-formatting-not-wording` covers `2)`/`•`/`-` | **EXISTS** |
| Offline test harness | `api/package.json` `"test": "npm run build && node --test test/*.test.mjs"` | CI + local | ran `node -e` against `api/dist/functions/tests/skillPool.js` — worked, reproduced live numbers | **EXISTS** |

---

## 2. THE ADVERSARIAL FINDINGS — what the implementer is most likely to get wrong

Each of these is a defect that **passes every test written against today's data**. They are the
reason ACs **4, 6, 7, 8, 9 and 19** exist. All five were reproduced by running the current parser.

| # | The trap | Measured proof | Why a test on live data misses it |
|---|---|---|---|
| **T1** | Reusing `looksLikeList` for the second-level split instead of splitting on `,` unconditionally | All 5 remainders have longest-part word counts **3, 4, 4, 3, 3** — all `<= 4`, so `looksLikeList` returns true and yields the correct 36 **today**. Adding one 5-word term to the 4-term group: `splitSkillField` drops from **5 terms to 1 chunk**, which is then rejected at >12 words — **the entire category silently vanishes from the bank** | `Technology Strategy and Transformation` sits **exactly on the `longest <= 4` boundary** (`Corporate AI Use Cases` = 4 words). Today's data passes; the owner's next edit deletes a category |
| **T2** | Stripping the category with `split(':')[1]` instead of `slice(indexOf(':')+1)` | `Data and AI: Analytics: Deep Dive, Predictive Analytics, Data Strategy` → naive gives `" Analytics"`, correct gives `" Analytics: Deep Dive, Predictive Analytics, Data Strategy"` — **two terms silently destroyed** | No live category contains a second colon, so it never fires on the fixture |
| **T3** | Splitting the group before stripping the category, so the category glues onto the first term | Current parser already demonstrates the shape: `Ops: Alpha,, Beta, Gamma` → `["Ops: Alpha","Beta","Gamma"]`. **`"Ops: Alpha"` is a fabricated term** — a string the owner never wrote | Looks like a plausible skill in a dropdown; the count is still right |
| **T4** | A `Category:` group with no terms emitting the **category itself** as a skill | `splitSkillField('Governance and Compliance:')` → `["Governance and Compliance"]` **today**. SKILL-POOL.md §3 explicitly says *"the category names themselves would NOT become terms"* | The live field has no empty group |
| **T5** | Exempting `relevantProficiencies` terms from `isRejected` to "make the 36 work" | The length guard still fires correctly on a stripped remainder — `Ops: <13-word prose>` → remainder 13 words → `too long to be a term (13 words)`. So **no exemption is needed**; adding one turns the category prefix into a bypass that laundeers any prose past the guard | Nothing in the live data is prose-shaped, so the exemption looks harmless |

---

## 3. ACCEPTANCE CRITERIA

Format: `Given <context>, when <action>, then <observable outcome>.`
Every AC is binary and every one is verifiable offline with `cd api && npm test`.

**Fixture requirement, applies to all ACs below.** A single checked-in fixture holding the **live**
`skills1`, `skills2`, `softHardSkillsPool`, `expertise` and `relevantProficiencies` strings must
exist and be the input to ACs 1, 10, 13 and 23. It is validated by AC-23 reproducing the measured
baseline. Hand-typed partial strings inside individual tests do not satisfy the fixture ACs — a
guard that passes on a fixture the real producer never emits is this repo's measured, repeated
defect (`VERIFY-30 F4`).

### Group A — `relevantProficiencies` becomes two-level

**AC-1.** Given the live `relevantProficiencies` string, when `buildSkillPool` is called with it as
the sole source, then `bySource.relevantProficiencies` is **exactly 36** (not "about 36", not
">30"), and the returned terms are **exactly** the 36-member set below, compared with
`assert.deepEqual` on a sorted array — not a length check, not a subset check:

| Category (exact string) | n | Terms (exact strings, in source order) |
|---|---:|---|
| `Governance and Compliance` | 6 | Standards and Compliance · AI/ML Strategy · Cybersecurity Leadership · Data Strategy · Policy Development · Customer-Centricity |
| `Technology Strategy and Transformation` | 4 | Digital Platform Maturity · SaaS Growth Strategy · Tech-Driven Innovation · Corporate AI Use Cases |
| `Business and Financial Impact` | 8 | P&L Optimization · Budget and Cost Control · Investment Strategy · Business Decision Modeling · M&A Integrations · Strategic Partnerships · Portfolio Management · Profitability Analysis |
| `Data Analytics and AI` | 8 | Enterprise Data Strategy · Data Insights Automation · AI/ML Advancements · Data-Driven Decisioning · Predictive Analytics · BI and Visualization · KPI-Driven Execution · Real-Time Intelligence |
| `Execution and Operations` | 10 | Scaled Agile Engineering · Business Process Re-Engineering · Strategic Roadmapping · Product Design · Innovation Frameworks · Cost Optimization · AI in Operations · Platform Scalability · Global Leadership · Tech Talent Strategy |

**AC-2.** Given any term produced from `relevantProficiencies`, when the resulting `SkillCandidate`
is inspected, then it carries a `category` field equal to the **verbatim** text before the first
colon of its group, whitespace-collapsed and with no trailing colon — and a term produced from any
other source field has `category` **absent or `null`**, never `''` and never a fabricated default.

**AC-3.** Given the live `relevantProficiencies` string, when the pool is built, then **none of the
five category names appears as a `term`** in `pool.entries`. Asserted explicitly by keying each of
the five category strings with `skillKey` and confirming no entry carries that key. *(This is
T4/AC-8's positive form and must be its own assertion — a count of 36 is satisfied by 35 real terms
plus one category name.)*

**AC-4.** Given a category group whose longest comma-part is **5 words or more** — fixture:
`Technology Strategy and Transformation: Digital Platform Maturity, SaaS Growth Strategy, Tech-Driven Innovation, Corporate AI Use Cases, Enterprise Cloud Cost Governance Programs` —
when the pool is built, then **5 terms** are produced, including `Enterprise Cloud Cost Governance Programs`.
*(Binary discriminator for T1. The current `looksLikeList` path yields **1** chunk on this input,
measured. An implementation that routes the second level through `looksLikeList` FAILS this AC while
passing AC-1. This AC must be present and must fail before the change.)*

**AC-5.** Given a `|`-group containing **no colon** — `Standards and Compliance, AI/ML Strategy, Data Strategy` —
when the pool is built, then its terms are still produced (3 terms) with `category` absent, and the
group is **not** rejected for lacking a category.

**AC-6.** Given a group with a **trailing comma**, a **doubled comma**, or a **whitespace-only
part** — `Ops: Alpha,, Beta, Gamma,` and `Ops: Alpha,   , Beta, Gamma` — when the pool is built,
then both yield exactly `['Alpha','Beta','Gamma']` each with `category === 'Ops'`, and
`pool.rejected` gains **no** entry for the empty parts *(they are punctuation, not lost data)*.

**AC-7.** Given a group whose **term contains a colon** — `Data and AI: Analytics: Deep Dive, Predictive Analytics, Data Strategy` —
when the pool is built, then `category === 'Data and AI'` and the terms are exactly
`['Analytics: Deep Dive', 'Predictive Analytics', 'Data Strategy']` — the inner colon is preserved
and **no term is lost**. *(Binary discriminator for T2: `split(':')[1]` yields 1 term and fails.)*

**AC-8.** Given a group that is a **category with no terms** — `Governance and Compliance:` — when
the pool is built, then **zero** entries are produced from it and `pool.rejected` contains one entry
naming the group with a reason such as `category with no terms`, origin `relevantProficiencies`.
The string `Governance and Compliance` must **not** appear as a term. *(Binary discriminator for T4:
current behaviour emits it as a term, measured.)*

### Group B — the length guard must still guard

The whole point of `isRejected` is that it refuses things. Before this change it refused **5** items.
After it, `relevantProficiencies` contributes 0 rejections — so if nothing else is pinned, the guard
has quietly become a no-op that nobody will notice until prose reaches the bank.

**AC-9.** Given a `Category:`-shaped group whose remainder contains **no comma and more than 12
words** — `Leadership: I led the modernization of our core safety platform across three separate business units this year` —
when the pool is built, then it produces **zero** entries and `pool.rejected` contains it with reason
matching `/too long/`. *(Measured: the stripped remainder is 16 words and `isRejected` already refuses
it. So no exemption is required to reach 36. An implementation that skips `isRejected` for
`relevantProficiencies` terms passes AC-1 and FAILS this AC — that is the point.)*

**AC-10.** Given the live fixture for **all five fields**, when the pool is built, then
`pool.rejected` is asserted with `assert.deepEqual` against an **exact, enumerated** expected array
— not `.length === 0` and not "no rejections". Every element still carries a non-null `why` and a
correct `origin`. *(`H:skill-pool-reports-its-composition-and-its-losses` already requires reason +
origin; this extends it to the post-change set so "the rejected list went empty" is a visible,
deliberate, reviewed fact rather than a silent side effect.)*

**AC-11.** Given the existing shape-only rejection rules, when the change is complete, then
`isRejected('')`, `isRejected('---')` and `isRejected('2024')` still return `rejected: true`, and
`isRejected('Enterprise architecture across multi-business-unit portfolios')` and `isRejected('P&L')`
still return `rejected: false`. *(The existing test `H:skill-pool-rejects-only-by-SHAPE-never-by-vocabulary`
must pass **unmodified**. If the implementer needs to edit it, that is a scope change requiring
sign-off, not a fix.)*

### Group C — the category must not ship write-only

**This repo's most-repeated defect.** `correction.frame` shipped write-only because the SELECT
mapping dropped it and the optional field kept `tsc` quiet (recorded in CLAUDE.md §0b). The
category is the same shape of risk, made worse by finding #1: **there is no production consumer of
`buildSkillPool` at all today**, so "it reaches the consumer" cannot be demonstrated by wiring.

**AC-12.** Given the change is complete, when `grep -rn "category" api/src/functions/tests/skillPool.ts`
is run, then `category` appears in **all four** of: the `SkillCandidate` interface, the write site
inside `buildSkillPool`, a **read site** that surfaces it on the returned `SkillPool` (see AC-13),
and the exported type used by callers. A field written into `SkillCandidate` and never read by
anything in the module or its tests fails this AC.

**AC-13.** Given the live fixture, when the pool is built, then `SkillPool` exposes a
**category-keyed grouping** — e.g. `byCategory: Record<string, number>` or equivalent — whose value
is exactly `{ 'Governance and Compliance': 6, 'Technology Strategy and Transformation': 4, 'Business and Financial Impact': 8, 'Data Analytics and AI': 8, 'Execution and Operations': 10 }`,
asserted with `assert.deepEqual`. *(This is what makes the category readable by the future swap UI
without that UI existing yet, and it is the read site AC-12 requires. `bySource` already sets this
precedent — the pool reports its own composition.)*

**AC-14.** Given `skill_bank_entry` (`schema.ts:741`) has **no `category` column** — proven by
reading the DDL — when this change lands, then **one** of the following is true and is stated
explicitly in the commit message:
 (a) a `category text` column is added to `skill_bank_entry` **and** `schema.ts`'s idempotent-ALTER
 ordering rule (`H39`/`H39b`) is respected and the schema is executed locally per CLAUDE.md; or
 (b) the schema is deliberately left unchanged, and the commit message records that the category is
 **in-memory only until the seeder is built**, so the next author does not discover it by finding a
 dropped column.
Silence on this point fails the AC. *(Do **not** create a second bank table — `skill_bank_entry`
already exists and is registered in `EXPECTED_TABLES`.)*

### Group D — dedup and `origins` behaviour must be preserved and asserted

**AC-15.** Given the live fixture with **all five fields**, when the pool is built, then the entry
for `M&A Due Diligence` has `origins` **exactly** `['skills2', 'softHardSkillsPool', 'expertise']`
and `term === 'M&A Due Diligence'` (the skills2 spelling — first seen wins), and there is **no**
separate entry keyed `m a due diligence`. *(Measured live: the `expertise` statement
`M&A due diligence and technology integration` splits on `" and "` to `M&A due diligence`, whose
`skillKey` is **identical** to skills2's `M&A Due Diligence`. This is a real collision in the
owner's real data, not a hypothetical.)*

**AC-16.** Given the same fixture, when the pool is built, then the entry for `Strategic Roadmaps`
has `origins` including both `'skills2'` and `'expertise'`, `term === 'Strategic Roadmaps'`, and
there is no second entry keyed `strategic roadmaps`. *(Second measured collision: the `expertise`
statement `Strategic roadmaps for customer-centric innovation` splits on `" for "` to
`Strategic roadmaps`. Note the **case difference** — this proves `skillKey` folding is what merges
them, so a change to casing behaviour would silently split them into two entries.)*

**AC-17.** Given a `relevantProficiencies` string in which the **same term appears in two different
categories** — `A: Alpha, Beta | B: Alpha, Gamma` — when the pool is built, then exactly **3**
entries exist, `Alpha` appears once, and its category handling is a **stated, asserted decision**:
either `category` is the first-seen (`'A'`) or the field is plural (`categories: ['A','B']`).
Whichever is chosen must be asserted. *(Today's data has **zero** such cases — I checked all 36
against each other. "Absent evidence is `not_applicable`, never `pass`": an unasserted design here
is a silent data loss the moment the owner adds one.)*

**AC-18.** Given the same fixture, when the pool is built, then `pool.duplicates` is asserted to an
**exact integer**, and the existing test
`H:skill-pool-dedupes-across-sources-and-keeps-both-origins` passes **unmodified**.

### Group E — `expertise` rewording via a checked-in mapping table

> **FINDING THAT CHANGES THE BRIEF'S PREMISE.** The brief states *"Some are mechanical splits on
> `" and "` / `" for "`; FOUR require actual rewording."* **Measured, that partition does not hold.**
> Splitting alone never fixes **case**, and every second half comes out lowercase:
>
> | Statement | Mechanical split gives | House style? |
> |---|---|---|
> | `Budget Development and P&L Management` | `Budget Development` + `P&L Management` | **YES — the only fully mechanical one** |
> | `Governance frameworks for compliance` | `Governance frameworks` + **`compliance`** | no — both lowercase-initial words |
> | `M&A due diligence and technology integration` | `M&A due diligence` + **`technology integration`** | no |
> | `Strategic roadmaps for customer-centric innovation` | `Strategic roadmaps` + **`customer-centric innovation`** | no |
> | `Enterprise alignment of strategy and execution` | `Enterprise alignment of strategy` + **`execution`** | no — and 4 words |
> | `KPI-driven performance management` | (no split point) | no |
> | `Optimizing scaled agile operations` | (no split point) | no |
>
> **So it is 1 mechanical, not 3.** `skills1`/`skills2` are uniformly Title Case; these are not.
> **Case-correction is rewording for the purposes of this design constraint**, because — see AC-19 —
> there is no code path permitted to perform it.

**AC-19.** Given the design constraint *"the parser must NEVER reword at runtime"*, when the change
is complete, then `api/src/functions/tests/skillPool.ts` contains **no function that alters the case
or wording of a `term`** — no title-caser, no `.replace(/\b\w/g, …)`, no synonym map, no truncation,
no model call, no network call. `skillKey`'s `toLowerCase()` is the sole permitted case operation and
its output is assigned to `key`, **never** to `term`. **Proof required:** the existing test
`H:skill-pool-strips-formatting-not-wording` passes **byte-unmodified**. *(Measured binary
discriminator: inserting a title-caser into `splitSkillField` turns
`['Platform modernization','Org design','P&L ownership']` into
`['Platform Modernization','Org Design','P&L Ownership']` and that test **FAILS**. If the implementer
edits that test, the design constraint has been abandoned and it needs owner sign-off, not a diff.)*

**AC-20.** Given the mapping table, when it is read, then **every entry records the exact source
statement it derives from**, verbatim, as the key — so the diff shows `<owner's words> → <short
term(s)>` on one line and the owner can audit the rewording without reading any code. An entry whose
key is a paraphrase, a lowercased form, a substring, or a regex fails this AC. *(Exact keys are also
what makes AC-22's drift detection possible: fuzzy keys would match a drifted statement and hide the
drift. `H4` — fuzzy matching is for RANKING, never for ACCUSING — applies directly.)*

**AC-21.** Given the live `expertise` field, when the pool is built, then every term originating from
it is **2-3 words** and Title Case, and the full produced set is asserted with `assert.deepEqual`
against an exact enumerated list. **No term from `expertise` may exceed 3 words**, and the seven
original long statements must **not** appear as terms. *(Today they do — `bySource.expertise === 7`
with entries like `Enterprise alignment of strategy and execution`. That is the current state being
replaced, so this AC must fail before the change.)*

**AC-22 — STALE MAPPING FAILS LOUDLY.** Given a mapping entry whose key matches **no** statement in
the `expertise` value it is applied to, when the pool is built, then `SkillPool` carries a non-empty
diagnostic (e.g. `staleMappings: string[]`) naming that key, and it is surfaced on the returned value
— not logged, not swallowed, not silently skipped. **Mutation-proof required:** change one character
in the live fixture's `expertise` string, re-run, and confirm the suite **FAILS** with the stale key
named. *(This is the AC that answers "what stops the table silently drifting from the source field."
A `Map.get()` miss that falls through to `undefined` and drops the term is precisely the silent-drop
failure `H:skill-pool-reports-its-composition-and-its-losses` was written to prevent.)*

**AC-23 — UNMAPPED STATEMENT FAILS LOUDLY.** Given an `expertise` statement that matches **no**
mapping entry and has no mechanical split point, when the pool is built, then it appears in a
non-empty diagnostic (e.g. `unmappedStatements: string[]`) **and** is either rejected with a reason
or passed through verbatim — the choice must be stated and asserted, and it must **never** be
silently dropped. **Mutation-proof required:** append a new statement to the fixture's `expertise`,
re-run, confirm the suite FAILS naming it. *(This is the owner-edits-MasterContext case: they add a
new area of expertise and it must not vanish from the bank without a word.)*

**AC-24.** Given the mapping table, when it is applied, then it is applied to the **`expertise`
source only**. A statement string appearing in `skills1`, `skills2`, `softHardSkillsPool` or
`relevantProficiencies` that happens to equal a mapping key is **not** reworded. Asserted with a
fixture placing a mapping key verbatim into `skills1` and confirming the term survives unchanged.
*(A table keyed on text alone silently reaches every field; the owner's `skills1` is fact and must
never be rewritten.)*

**AC-25 — the config rule.** Given CLAUDE.md's strict rule *"Never hardcode a configurable value in
code only … either wire it to a setting first, or get EXPLICIT owner approval to leave it code-only —
and record that approval"*, and given the mapping table is a checked-in code file the owner cannot
edit in the product, when this change lands, then the commit message (and `.claude/actions.md`)
records **either** the owner's explicit approval to leave it code-only **or** the plan to surface it
as an owner setting. *(Flagged because the design constraint as briefed — "visible in the diff and
editable by the owner" — treats *editing a TypeScript file* as owner-editable, and this repo's rule
explicitly does not. This is a sign-off item, not a coding decision.)*

### Group F — regressions that must not return

**AC-26.** Given the `3D modelling` → `D modelling` corruption class recorded at `skillPool.ts:41-47`,
when a category group contains digit-leading terms —
`Modelling and Networks: 3D modelling, 5G architecture, Data Strategy` — then the produced terms are
exactly `['3D modelling', '5G architecture', 'Data Strategy']` with `category === 'Modelling and Networks'`.
Additionally `2) Org design` and `3. P&L ownership` inside a group still yield `Org design` and
`P&L ownership`. *(`LIST_NUMBER = /^\s*\d+\s*[).:]\s+/` requires a delimiter **and** a space, which is
what makes `3D` safe. Any NEW stripping step added for the category must be asserted not to
reintroduce the class — note `LIST_NUMBER`'s delimiter set **already contains `:`**, so a numeric
category such as `1: Governance, Risk` is consumed by `tidy()` before any category logic sees it. The
ordering of `tidy()` vs. the category strip must be a stated, tested decision.)*

**AC-27.** Given the 7 existing tests in `api/test/skillPool.test.mjs`, when the change is complete,
then **all 7 pass unmodified** and `cd api && npm test` is green across the whole suite. Any test
requiring modification is a scope change needing sign-off. *(`H:skill-pool-never-splits-one-skill-into-fragments`
is the one at real risk: `Mergers, Acquisitions and Divestitures` must still be ONE term. An
unconditional comma split — AC-4's requirement — must therefore apply **only inside a
`Category:`-prefixed group**, never to a plain `|` chunk. These two ACs constrain each other and that
is deliberate.)*

**AC-28 — the end-to-end number.** Given the full live fixture of all five fields, when the pool is
built, then `bySource` is asserted with `assert.deepEqual` to exact integers and the total entry
count is an exact integer stated in the commit message and in an updated `docs/qc-evidence/SKILL-POOL.md`.
The current measured baseline, which this replaces, is
`{skills1: 11, skills2: 9, softHardSkillsPool: 0, expertise: 7, relevantProficiencies: 0}` = **27
entries, 5 rejected, 20 duplicates**. *(I reproduced that baseline exactly offline, so the fixture is
proven faithful. Note `relevantProficiencies` will **not** add a clean +36 to 27: the `expertise`
rewrite changes its own contribution, and two `expertise`-derived terms **merge** into existing
`skills2` entries rather than adding — see AC-15/AC-16. An implementer who reports "27 + 36 = 63"
has not run it.)*

---

## 4. DEFINITION OF DONE

All 28 ACs asserted in `api/test/skillPool.test.mjs` (or a sibling), `cd api && npm test` green, plus:

1. **Mutation-proof, individually, the four guards that are new** — CLAUDE.md: *"THE ONE STEP THAT IS
   NEVER SKIPPED, AT ANY TIER."* Each must be shown to FAIL when its defect is reinstated:
   - **AC-4** — route the second level through `looksLikeList`; the 5-word-term fixture must fail.
   - **AC-8** — emit the category as a term for an empty group; must fail.
   - **AC-22** — alter one character of the fixture's `expertise`; must fail naming the stale key.
   - **AC-23** — append a statement to the fixture's `expertise`; must fail naming it.
   If a mutation is behaviourally equivalent and correctly fails to fail, **say so** and do not claim
   the assertion is proven.
2. **`docs/qc-evidence/SKILL-POOL.md` updated.** Its §3 currently presents this as an **open owner
   decision** with options (a) and (b), and `.claude/memory.md:462` calls it *"THE ONE THING WAITING
   ON THE OWNER."* Landing (b) without updating both leaves the tracker claiming a decision is
   pending that has already been made — the exact `actions.md`-drift failure CLAUDE.md's feasibility
   rule names.
3. **`.claude/actions.md`** records the change with an evidence link, including the AC-25 sign-off.
4. **An H-case per defect found during implementation**, slug-named (never numeric — `H26` fails the
   suite on a new numeric ID), added in the **same commit** as its fix.

## 5. TIER, AND WHY

**Tier 2 (ordinary logic) — with one Tier-1 escalation.**

The parser is a pure function with **no production consumer** (feasibility finding #1), so today it
decides no gate, no score and no coverage count. That is Tier 2: implement, test, mutation-prove the
new guards; no independent `verifier` required.

**The escalation:** the moment the seeder lands, this pool becomes the option set for
`Swap for another skill…`, and a swap moves a gate — `schema.ts:745-748` says so in its own words:
*"a bank feeds a SELECT the owner picks from and a swap that moves a gate, so a near-match collapsing
two real skills into one is an accusation-grade error."* **AC-15/16/17 (dedup and `origins`) are
therefore accusation-grade already** and should get the independent verifier treatment even though
the rest of the change does not. Merging two of the owner's distinct skills into one entry is
unrecoverable once the bank is seeded.

## 6. NOTES, CAVEATS AND WHAT I DID NOT PROVE

- **Observation vs. interpretation.** *Observed:* every number in §1 and §2 came from running the
  built parser (`api/dist/functions/tests/skillPool.js`) in this sandbox; the reconstructed fixture
  reproduces SKILL-POOL.md's live measurements exactly (27/5/20 and `bySource` 11/9/0/7/0, plus the
  five rejection word-counts 15/16/23/23/27). *Interpreted:* that this byte-for-byte equals the live
  MasterContext value. It is **not proven byte-identical** — I did not call
  `GET /api/diag/skill-sources`. Given five independent derived quantities all match, confidence is
  high, but **the implementer should re-dispatch `api-test.yml` against `/api/diag/skill-sources`
  once** and diff the fixture against the returned `text` before trusting AC-1's exact 36-term list.
  That single call converts every "high confidence" here into proof.
- **`origins` array ORDER depends on the key order of the `sources` object** passed to
  `buildSkillPool` (`Object.keys(sources)` at `:145`). AC-15's exact
  `['skills2','softHardSkillsPool','expertise']` assumes the order
  `skills1, skills2, softHardSkillsPool, expertise, relevantProficiencies` — the order the fixture
  and SKILL-POOL.md use. If the implementer changes call order, that assertion changes meaning
  without failing loudly. Pin the order in the fixture.
- **`softHardSkillsPool` is the union of `skills1`+`skills2`** and contributes 0 new entries by
  design. If it stops being the exact union after an owner edit, `bySource.softHardSkillsPool` goes
  non-zero — a result to investigate, not a pass. Not AC'd, but worth a comment.
- **The `SkillOrigin` union already contains `'relevantProficiencies'`** (`skillPool.ts:17`), so no
  type change is needed to record the source. The **category** is a genuinely new concept and is
  distinct from `skill_bank_entry.origin`, whose CHECK constraint allows only
  `('master_context','portfolio_slide')` — three different "origin" vocabularies now exist. Do not
  conflate them.
- **`normalise.ts` is not the place for these rewordings** and must not be extended for them: it is
  a runtime, per-artifact, char-limit-driven pass that asks the **model** for rewrites. Routing pool
  rewording through it would violate the stated design constraint at the exact point the constraint
  exists to protect. Recorded here because "extend, don't duplicate" would otherwise point straight
  at it.
- **`buildSkillPool`'s own header comment is false today** (*"The route … and the seeder … both call
  THIS"*). Fix the comment in this change; a comment asserting a consumer that does not exist is how
  finding #1 stayed invisible.
- **Not proven:** that 36 + the reworked `expertise` set yields any particular grand total. AC-28
  deliberately requires the implementer to **run it and report the integer** rather than predicting
  one, because two `expertise` terms merge rather than add.
