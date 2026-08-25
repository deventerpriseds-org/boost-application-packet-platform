# AC — Compact resume: one Core Skills block, with overspill flagged in the margin

Independent adversarial acceptance criteria. Written WITHOUT trusting the implementer's framing.
Branch `claude/render-interaction-states`. Started 2026-08-25.

Owner's words (the requirement of record):
> "the skills are broken into two columns in the regular resume but its a single block in the
> compact resume so i think you should be starting with taking the two and making them one as a
> part of generating the compact resume. if overspill of space becomes an issue, it should be
> flagged. the least relevent item could be removed to make it fit and i should be notified that
> happened in the right margin."

Four separable obligations are in that sentence. Numbering them, because the implementation so far
satisfies at most one and a half:

| # | Obligation | Status on this branch (evidence below) |
|---|---|---|
| O1 | Combine `SkillsBullets1` + `SkillsBullets2` into ONE `SkillsBullets` block **as part of generating the compact resume** | Pure function exists (`compactFit.ts`); **NOTHING CALLS IT** |
| O2 | Flag overspill "if it becomes an issue" | `overBudgetAfterDrops` exists in the return type; no producer, no surfacing |
| O3 | Drop the least relevant item to make it fit | Ranking implemented + unit-tested; unwired |
| O4 | **Notify the owner in the RIGHT MARGIN that it happened** | **Not started at all.** No Docs API comment/margin code exists anywhere in the repo |

## Status of the file — this section written first, on purpose
Appending as I go (per brief). Sections land in this order:
1. This header + obligation table
2. Evidence: what the code actually does (file:line)
3. Consumer / blast-radius sweep
4. Acceptance criteria (happy, edge, error, regression guard)
5. What could go WRONG that the implementation does not handle
6. Tier judgement
7. Unaddressed parts of the owner's request

---

## 2. What the code actually does — measured, with file:line

### 2.1 `fitCompactSkills` is DEAD CODE on this branch
`grep -rn "fitCompactSkills" api/src app/src` returns exactly three source hits:
- `api/src/functions/tests/compactFit.ts:109` — the definition
- `api/src/functions/tests/packetTemplates.ts:43` — a *comment* naming it
- `api/test/compactFit.test.mjs` — the unit test

**No production code path calls it.** There is no import of `./compactFit` anywhere in
`api/src/`. So O1 ("as a part of generating the compact resume") is NOT met: the combining
never happens during generation.

### 2.2 The consequence is a BLANK Core Skills line on a document sent to employers
- `packetTemplates.ts:47` — `compact_resume.placeholders = ['ResumeSummary','SkillsBullets']`
- `packetTemplates.ts:123-129` `varsForType` builds `{{SkillsBullets}} -> (pkg['SkillsBullets'] ?? '')`.
  Nothing computes `pkg.SkillsBullets` (grep: `SkillsBullets` with no digit appears only in
  `packetTemplates.ts` and `compactFit.ts` comments — never assigned in `packetBuild.ts`,
  `mt17.ts:148-149`, `pipeline.ts:652`, or `evidence.ts:190-191`, all of which produce only
  `SkillsBullets1`/`SkillsBullets2`).
- Therefore `injectValues` (`packetTemplates.ts:197`) replaces `{{SkillsBullets}}` with the
  **empty string**, before `stripLeftoverTokens` is even reached.

**This is worse than the bug the branch's own comment (`packetTemplates.ts:36-40`) says it is
fixing.** That comment claims the old 7-placeholder set would have caused a blank Core Skills
line via `stripLeftoverTokens`. The new 2-placeholder set causes the *same* blank line via
`varsForType` injecting `''`, with the same silence. The defect was moved, not closed.
Whether the token is blanked by injection or by stripping is invisible in the output document.

### 2.3 The new threshold `compactSkillsMaxChars: 320` is enforced by NOTHING
`grep -rn "compactSkillsMaxChars" api/src app/src` — total hits, all of them:
- `checks.ts:66` (type member) and `checks.ts:144` (default value)
- `checkPrefs.ts:46` (column default), `:161` (select), `:176` (map into thresholds)

No check in `runChecks` reads `t.compactSkillsMaxChars`. It is a fully-plumbed, per-owner
configurable setting that **decides nothing**. A threshold in the settings UI that changes no
behaviour is the "a setting read by nothing" class this repo names explicitly in
`packetTemplates.ts:74-81`.

### 2.4 The compact artifact SILENTLY LOSES most of its checks
`checks.ts:290-296`:
```
const fields = mergeFieldsFor(input.type)          // compact_resume -> ['ResumeSummary','SkillsBullets']
const has = (f: string) => fields.includes(f)
const skills = SKILL_FIELDS.filter(has).flatMap(...)   // SKILL_FIELDS = ['SkillsBullets1','SkillsBullets2'] (checks.ts:277)
```
For `compact_resume`, `has('SkillsBullets1')` and `has('SkillsBullets2')` are now **false**, so:
- `checks.ts:298` `if (SKILL_FIELDS.some(has))` is false ⇒ **`skill_char_limit` and
  `skill_list_count` are not emitted at all** for a compact resume.
- `checks.ts:338` `listed` is empty ⇒ **`cross_list_redundancy` is not emitted**.
- `checks.ts:358-366` gated on `listed.length` ⇒ **`omission_list` is not emitted** — the check
  that enforces "items the owner asked never to use". A compact resume can now ship an omitted
  item with no check row at all.

Before this branch `compact_resume` carried the resume's 7 placeholders, so all four of those
checks ran on it. **The change makes the compact artifact's gate strictly greener by removing
rows, not by passing them** — and the repo's own standing rule is *"absent evidence is
`not_applicable`, never `pass`"*. Removing the row entirely is worse than reporting `pass`:
it is not even visible as absent.

### 2.5 Insertion rows for the compact artifact lose their list traceability
`insertions.ts:20-26` `LIST_FIELD_TO_LIST` maps `SkillsBullets1 -> skills_1`,
`SkillsBullets2 -> skills_2`. There is **no `SkillsBullets` key**, so
`insertions.ts:99` sets `list: null` for the compact's one skills row — the row that renders the
combined list is recorded as *not backed by any `skill_candidate` list*, breaking the
provenance chain the compact drop decision itself depends on.

`insertions.ts:6-9` also now carries a **factually wrong comment**: *"resume 7 · compact_resume 7
· portfolio 7 · cover 3 … it is a byte-identical duplicate of `resume`"*. As of
`packetTemplates.ts:45-48` compact_resume is 2 and is not a duplicate. Stale by this branch's own edit.

---

## 3. Blast radius of `TEMPLATE_META.compact_resume.placeholders` 7 -> 2

`mergeFieldsFor(type)` (`insertions.ts:43-45`) is the ONE core source. Every consumer below reads it
(directly or via `metaFor`/`varsForType`) and therefore changed behaviour for `compact_resume` on
this branch. **None of them was updated.**

| # | Consumer | file:line | What changed for compact_resume |
|---|---|---|---|
| C1 | `varsForType` | `packetTemplates.ts:123-129` | Injects `{{SkillsBullets}} -> ''` (no producer) |
| C2 | doc preview / `artifact.content` | `appPackets.ts:695` | Preview now shows only `ResumeSummary`; the skills half of the record disappears |
| C3 | `buildInsertions` rows | `insertions.ts:86-105` | 2 rows instead of 7; the skills row gets `list: null` (`LIST_FIELD_TO_LIST` has no `SkillsBullets` key, `insertions.ts:20-26`) |
| C4 | `runChecks` skill checks | `checks.ts:277, 294, 298-317` | `skill_char_limit` + `skill_list_count` **no longer emitted** |
| C5 | `runChecks` cross-list | `checks.ts:338-352` | `cross_list_redundancy` **no longer emitted** |
| C6 | `runChecks` omission list | `checks.ts:357-366` | `omission_list` **no longer emitted** — owner's never-use list is unenforced on the compact |
| C7 | `runChecks` empty fields | `checks.ts:493-496` | `empty_merge_fields` will FAIL ("1 of 2 merge fields empty") every compact build, naming `SkillsBullets` |
| C8 | `scopeForRequirements` (remediation) | `remediation.ts:377` | The rewrite loop now offers the model `SkillsBullets` as a rewritable field |
| C9 | `buildReviewerPayload` | `reviewer.ts:123-127` | The reviewer's `asset` for a compact is `{ResumeSummary}` only (the empty `SkillsBullets` is dropped by the `.trim()` filter at `:126`) |
| C10 | `diagDocStructure` expectation | `diagDocStructure.ts:136-141` | Correctly now expects 2 — this is the one consumer the change fixes |
| C11 | frontend `MERGE_FIELDS` / deep links | `app/src/qcRail.js:340-346` | Does NOT contain `SkillsBullets`; `sectionIdForOffender` returns `null`, so the C7 failure renders as a **non-clickable** count |
| C12 | frontend `targetFor` / `observedFor` | `app/src/assetBlocks.js:606, 660` — `/^SkillsBullets\d$/` | Requires a DIGIT. `SkillsBullets` matches neither, so the compact skills card shows **no target and no measurement** |
| C13 | frontend `FIELD_ORDER` | `app/src/assetBlocks.js:232-242` | No `SkillsBullets` ⇒ it sorts to the END, after Expertise — wrong reading order for the document |
| C14 | frontend `FIELD_LABEL` | `app/src/assetGate.js:208-216` | No `SkillsBullets` ⇒ `fieldLabel()` degrades to the raw slug `SkillsBullets` in the gate drawer, the QC correction sentence and the tooltip |
| C15 | `OppDetail` skills editor | `app/src/screens/OppDetail.jsx:429` | Hardcodes `Column 1` / `Column 2` — there is no editor row for the compact's single block |
| C16 | loop-0 baseline map | `evidence.ts:190-191` | No `SkillsBullets` ⇒ `before_text` is null ⇒ `method` derives to `template_fill` ⇒ the UI labels a machine-combined, item-dropped line **"From profile"** (`assetGate.js` METHOD_LABEL) |
| C17 | stale comment (doc debt) | `insertions.ts:6-9`, `qcRail.js:336-338` | Both state "compact_resume — 7". Now 2. |

**C8 is the most dangerous of these.** `scopeForRequirements` will hand `SkillsBullets` to the
remediation rewrite as an editable field. If a pass writes `pkg.SkillsBullets` directly, the compact
resume's skills stop being a DERIVATION of `SkillsBullets1/2` and become an independent third list.
That is the "two disconnected brains" failure the repo's `Extend, don't duplicate` rule names — and
it would be created by the remediation loop at runtime, not by anyone's edit.

### 3.1 The check set for a compact resume, before vs after

Observation (from reading `runChecks`, `checks.ts:287-360`), not from a run:

| check | before (7 fields) | after (2 fields) |
|---|---|---|
| `skill_char_limit` | emitted | **absent** |
| `skill_list_count` | emitted | **absent** |
| `cross_list_redundancy` | emitted | **absent** |
| `omission_list` | emitted | **absent** |
| `empty_merge_fields` | emitted | emitted, now **fails** |

`gateFor` (`checks.ts:838-849`) has no notion of "a check that should have run and didn't" — it
aggregates the rows it is given. Four checks vanishing is invisible to the gate, to
`attentionCount` (`checks.ts:856`), and to the UI. The repo's own rule is *"absent evidence is
`not_applicable`, never `pass`"*; an absent ROW is a state below `not_applicable` that this
codebase has no representation for.

### 3.2 `compactSkillsMaxChars` satisfies the configurability guard while enforcing nothing

`H:every-threshold-is-configurable` (`api/test/hardening.test.mjs:3829-3846`) asserts
declared ⊆ loadable. It does **not** assert declared ⊆ *used by a check*. So
`compactSkillsMaxChars` passes the guard, appears in settings, and decides nothing —
an inert setting that a guard reports as healthy. That is precisely the class the guard was
written to kill, one axis over.

---

## 4. Defects PROVEN by execution against `api/dist/functions/tests/compactFit.js`

Not read, not inferred — run. Each block below is the actual output.

### D-1 (SEVERITY: CRITICAL) A duplicate label can DELETE a posting-driven skill
`compactFit.ts:113-116` keeps the **first** provenance row per normalised label:
```ts
for (const p of (input.provenance || [])) {
  if (p && p.label && !byLabel.has(norm(p.label))) byLabel.set(norm(p.label), p)
}
```
The same skill legitimately appears in BOTH lists (the module's own dedupe at `:121-126` exists
because of that). If the `skills_1` row is `kept/unattributed` and the `skills_2` row is
`swapped/posting` with a `requirement_id`, the master row wins the lookup and the item is ranked 0 —
**droppable**.

Measured:
```
input : skills1=['Kubernetes'] skills2=['Kubernetes','Nginx'] budget=6
        prov: Kubernetes kept/unattributed (first), Kubernetes swapped/posting req-9, Nginx swapped/posting req-2
output: kept=["Nginx"]  dropped=["Kubernetes"]
```
`Kubernetes` carries `requirementId: 'req-9'` and was removed from a document sent to an employer.
This falsifies the module's own stated central safety property
(`api/test/compactFit.test.mjs:30-32`, *"the posting-driven skill must survive"*) — the existing test
passes only because it never gives a label two provenance rows.

### D-2 (SEVERITY: CRITICAL) A NaN / null budget silently blanks the whole Core Skills line and reports success
`compactFit.ts:111` `const budget = Math.max(0, Number(input.budget) || 0)`.
```
input : skills1=['A','B'] budget=NaN
output: {"text":"","kept":[],"dropped":[B,A],"fullLength":5,"budget":0,"fits":true}
```
`fits: true` on an EMPTY line. `chk_compact_skills_chars` arrives from Postgres via `pg` — a null
column, a driver returning a string, or a settings load that failed all land here. The function's
contract must be: a budget that is not a positive finite number is an ERROR, never `0`.
An empty skills block that says it fits is undetectable by every downstream check, because
`empty_merge_fields` sees a filled-then-emptied string only if the producer writes `''` — which it
would.

### D-3 (SEVERITY: HIGH) The position tie-break is wrong whenever both lists have provenance
`compactFit.ts:137,139` sorts on `seq` descending. `seq` is per-LIST (`swaps.ts:29-34`:
`skills_1` and `skills_2` are separate `ListKey`s, each with its own sequence starting at 0), but
the combined line is one document order.
```
input : skills1=['Alpha','Bravo','Charlie','Delta'] (seq 0-3), skills2=['Echo'] (seq 0)
output: dropped=["Delta"]      -- but the document-last item is Echo
```
The header comment (`compactFit.ts:37-38`) states the intent as *"the end of a skills line is where
the least load-bearing item sits"*. The code does not implement that intent across two lists.
Every existing test passes `skills2: []` (`compactFit.test.mjs:61, 73, 84, 95, 108`), so the whole
tie-break is untested in the only configuration the feature exists for.

### D-4 (SEVERITY: HIGH) `action: 'dropped'` is treated as PROTECTED
`compactFit.ts:94` — `if (p.driver === 'posting' || p.requirementId) return 2` — checks the driver
before the action. An item the swap engine already recorded as **dropped** is rank 2 and undroppable.
```
input : skills1=['Removed Thing','Keep A','Keep B'] budget=12
        prov: 'Removed Thing' action=dropped driver=posting req=r1
output: kept=["Removed Thing"]
```
Both real skills were deleted to preserve an item the pipeline had already removed. `SwapAction`
(`compactFit.ts:40`) declares `'dropped'` as a legal input, so this is reachable by contract, and
the caller that builds `provenance` from `swap_decision` has not been written yet — this must be
pinned BEFORE it is.

### D-5 (SEVERITY: HIGH) `DEFAULT_SEPARATOR = ' | '` collides with `splitItems`
`swaps.ts:26-31` splits on `/\r?\n|(?:\s*[|•·]\s*)/`. A skill label containing `|`, `•` or `·`
round-trips as two items:
```
input : ['P&L | Budget','AWS']
text  : "P&L | Budget | AWS"
splitItems(text) -> ["P&L","Budget","AWS"]     -- 3 items where 2 were written
```
Every downstream count is then wrong: `insertions.ts:100` `item_count`, `checks.ts:294` skill
counts, `checks.ts:339` redundancy, `assetBlocks.js` `deriveItems`. The combine step must either
reject/escape separator characters in labels or the separator must be one `splitItems` does not treat
as a delimiter.

### D-6 (SEVERITY: MEDIUM) No floor on how much may be removed
Nothing bounds `dropped.length`. A small budget strips the entire master list one item at a time and
reports `fits: true`. The owner said *"the least relevent **item** could be removed"* — there is no
point at which the function declines to keep cutting and instead flags. Compare D-2: the same code
path produces an empty line.

---

## 5. Acceptance criteria

Every AC is binary and names the observable. "Works correctly" appears nowhere.

### A. Happy path — the combine actually happens during generation (O1)

- **AC-1** — Given a packet whose `pkg` holds `SkillsBullets1` and `SkillsBullets2`, when
  `renderArtifact` runs for `art.type === 'compact_resume'` (`appPackets.ts:627`), then
  `varsForType('compact_resume', pkg)` returns a `{{SkillsBullets}}` value that is a **non-empty**
  string, and it equals `fitCompactSkills(...).text` for the same inputs.
  *Observable:* a unit test on the producer, plus the rendered Doc's Core Skills line read back via
  `diag/doc-structure` on a real build.

- **AC-2** — Given the same packet, when the compact resume Doc is opened, then its Core Skills
  block contains every item of `SkillsBullets1` followed by every item of `SkillsBullets2` in
  document order, with cross-list duplicates collapsed to their first occurrence.
  *Observable:* the Doc text, read via `templateText` / `diag/doc-structure` for a live artifact —
  not the value of `pkg`.

- **AC-3** — Given a compact resume build, when it completes, then no `{{SkillsBullets}}` token
  remains in the document AND the block is not empty. Both halves must be asserted: today
  `stripLeftoverTokens` guarantees the first while `varsForType` guarantees the second is violated
  (see §2.2).

- **AC-4** — Given `SkillsBullets1` and `SkillsBullets2` are BOTH empty or absent, when the compact
  builds, then the build records a warning naming `SkillsBullets` and `empty_merge_fields`
  (`checks.ts:493`) fails — it must not ship a silently blank block as a success.

### B. Fit / drop behaviour (O3)

- **AC-5** — Given a combined line whose rendered length exceeds the budget by N characters, when the
  fit runs, then exactly the fewest lowest-ranked items required to get under budget are removed
  (already asserted: `compactFit.test.mjs:66-77`), and `kept` preserves the relative order of the
  survivors.

- **AC-6** — Given ANY item whose provenance includes a row with `driver === 'posting'` OR a
  non-null `requirementId`, when the fit runs, then that item is in `kept`, **even when a second
  provenance row for the same normalised label says `kept/unattributed`**. *(Closes D-1. The
  existing test does not cover it — the rank must be the MAX over all rows for the label, not the
  first row found.)*

- **AC-7** — Given two droppable items of equal rank, when the fit runs, then the one later in
  **combined document order** is dropped first — regardless of which source list it came from and
  regardless of its per-list `seq`. *(Closes D-3. Test must use a non-empty `skills2`.)*

- **AC-8** — Given a provenance row with `action === 'dropped'`, when the fit runs, then that item
  is treated as **droppable** (rank 0), never protected. *(Closes D-4.)*

- **AC-9** — Given every remaining item answers the posting and the line still exceeds budget, when
  the fit runs, then `dropped` is empty, `fits` is false, `overBudgetAfterDrops` is true, and the
  full text still ships. *(Already asserted: `compactFit.test.mjs:89-99`. Keep it.)*

### C. Error states

- **AC-10** — Given `budget` is `NaN`, `null`, `undefined`, `<= 0`, or a non-numeric string, when
  `fitCompactSkills` is called, then it **throws** (or returns an explicit `error` discriminant that
  the caller must handle) — it must NOT coerce to 0, must NOT return `kept: []`, and must NOT report
  `fits: true`. *(Closes D-2.)*

- **AC-11** — Given a skill label containing `|`, `•` or `·`, when the combined line is built, then
  `splitItems(text).length === kept.length`. *(Closes D-5. Assert the round-trip, not the join.)*

- **AC-12** — Given the Google Drive call that writes the margin note fails (403/404/quota), when the
  compact build runs, then the DOCUMENT still ships, the failure is recorded as a build warning
  naming the dropped items, and the build does not report unqualified `ok: true`
  (`appPackets.ts:750` derives `ok` from `warnings.length`). A notification that silently failed is
  the same as no notification.

- **AC-13** — Given `chk_compact_skills_chars` cannot be loaded for the owner (no row, DB error),
  when the compact builds, then the build fails loudly or uses `DEFAULT_THRESHOLDS.compactSkillsMaxChars`
  **and says which** in the warning — it must not silently fall through to 0 (D-2's upstream).

### D. Margin notification (O4) — nothing exists yet, so these are specification, not verification

- **AC-14** — Given at least one skill was dropped to fit, when the compact resume Doc is produced,
  then a Google Drive comment exists on that file whose text names **every** dropped label and the
  reason string from `DroppedSkill.reason` (`compactFit.ts:64-68`).
  *Observable:* `GET https://www.googleapis.com/drive/v3/files/{id}/comments?fields=comments(content)`
  returns a comment containing each dropped label. **The OAuth scope already permits this** —
  `googleOAuth.ts:5-6` requests `auth/drive` and `auth/documents`, so "we cannot write comments" is
  not an available excuse.

- **AC-15** — Given nothing was dropped, when the compact builds, then **no** comment is written.
  A margin note on every build is noise the owner learns to ignore.

- **AC-16** — Given `overBudgetAfterDrops` is true, when the compact builds, then the comment says
  the line is over budget AND that nothing further was removed because the remainder answers the
  posting — the two states must be distinguishable in the margin, not merged into one message.

- **AC-17** — Given the compact resume is rebuilt (regen), when the build completes, then the file
  does not accumulate duplicate margin comments for the same drop set — either the file is a fresh
  copy (it is: `copyTemplate`, `packetTemplates.ts:134`) or prior Claude-authored comments are
  resolved first.

### E. Blast radius / consumer reconciliation (the `Trace every dependent` rule)

- **AC-18** — Given `compact_resume` now exposes `SkillsBullets`, when `runChecks` runs on a compact
  artifact, then the emitted check keys include a per-item character check and a count check for the
  compact's skills — i.e. `SKILL_FIELDS` (`checks.ts:277`) or an equivalent compact-aware branch
  covers `SkillsBullets`. **`skill_char_limit`, `skill_list_count`, `cross_list_redundancy` and
  `omission_list` must not be absent from a compact artifact's result set.**
  *Observable:* `runChecks({type:'compact_resume', pkg})` and assert the key set, compared against
  `runChecks({type:'resume', ...})`.

- **AC-19** — Given `compactSkillsMaxChars` is declared in `DEFAULT_THRESHOLDS` (`checks.ts:144`),
  when `runChecks` runs on a compact artifact, then some check reads `t.compactSkillsMaxChars` and
  its offender/expectation string contains that number. A configurable threshold that no check reads
  is a setting that lies.

- **AC-20** — Given a compact artifact's check fails naming `SkillsBullets`, when the QC rail renders
  it, then `sectionIdForOffender('empty_merge_fields','SkillsBullets')` returns `'SkillsBullets'`
  (not `null`), `fieldLabel('SkillsBullets')` returns human copy (not the slug), and
  `targetFor`/`observedFor` return non-null for it. *(C11, C12, C14 — `qcRail.js:340`,
  `assetGate.js:208`, `assetBlocks.js:606,660`.)*

- **AC-21** — Given the compact's skills row is written by `buildInsertions`, when the row is read,
  then `list` is not null — `LIST_FIELD_TO_LIST` (`insertions.ts:20-26`) resolves `SkillsBullets` to
  the skill_candidate lists it was derived from, or the schema gains an explicit representation for
  "derived from two lists". A provenance row that claims no source for a line built BY dropping
  items is the worst of both.

- **AC-22** — Given the remediation loop computes its rewrite scope, when `scopeForRequirements`
  runs for `compact_resume` (`remediation.ts:377`), then `SkillsBullets` is **not** in `fields` —
  it is a derived field, and a pass that rewrites it forks the compact away from
  `SkillsBullets1/2`. Either add it to `STRUCTURAL_FIELDS` (`remediation.ts:348`) or introduce an
  explicit DERIVED_FIELDS exclusion. *(This is the `Extend, don't duplicate` violation waiting to
  happen at runtime.)*

- **AC-23** — Given the reviewer payload for a compact artifact (`reviewer.ts:123-127`), when it is
  built, then `asset.SkillsBullets` is present and non-empty for a normal build. Today the reviewer
  grades a compact resume from `ResumeSummary` alone.

### F. Regression guard (H-case, per `CLAUDE.md` "a mistake becomes a TEST")

- **AC-24 — `H:compact-placeholder-has-a-producer`.** A source guard asserting: for every
  `type` in `TEMPLATE_META`, every name in `placeholders` is assigned somewhere in the package
  producer (`packetBuild.ts` / `mt17.ts` / the compact combiner). This is the invariant, not the
  incident: it fails the day anyone adds a placeholder with no producer, in any template.
  Evidence to record in the comment: on `claude/render-interaction-states`,
  `TEMPLATE_META.compact_resume.placeholders` contained `SkillsBullets` while
  `grep -rn "SkillsBullets\b" api/src` found **no assignment** — so `varsForType` would have injected
  `''` and shipped a blank Core Skills line to an employer.

- **AC-25 — `H:compact-checks-are-not-fewer-than-the-resume-s`.** Assert that the check-key set
  `runChecks` emits for `compact_resume` is a **superset of the skill-related keys** it emits for
  `resume`. Evidence: this branch's placeholder narrowing removed four checks
  (`skill_char_limit`, `skill_list_count`, `cross_list_redundancy`, `omission_list`) from every
  compact artifact with no gate signal, because `gateFor` (`checks.ts:838`) cannot see a check that
  was never emitted.

- **AC-26 — `H:every-threshold-is-ENFORCED`.** Extend the existing
  `H:every-threshold-is-configurable` (`hardening.test.mjs:3829`) with its missing converse: every
  key in `DEFAULT_THRESHOLDS` must appear as `t.<key>` somewhere in `runChecks`. Evidence:
  `compactSkillsMaxChars` was added to the type (`checks.ts:66`), the default (`:144`) and the
  settings column (`checkPrefs.ts:46`), passed the existing guard, and was read by **no check** —
  an inert setting the guard reported as healthy.

- **AC-27 — mutation proof (never skipped, any tier).** For each of AC-24/25/26: write the guard,
  reinstate the exact defect it guards (delete the producer; narrow `placeholders`; remove the
  threshold's use), confirm `node --test` FAILS, restore. A guard that passes with its defect
  reinstated is worse than no guard.

---

## 6. What could go WRONG that the current implementation does not handle

Ordered by the brief's priority: (a) silent blanking/corruption of a document sent to employers,
(b) broken consumers of `TEMPLATE_META.compact_resume.placeholders`, (c) changed check/gate behaviour.

### (a) Silent blanking or corruption of an employer-facing document

| Risk | Mechanism | Where |
|---|---|---|
| **R1 — Blank Core Skills line, no error, TODAY** | `varsForType` injects `pkg['SkillsBullets'] ?? ''`; nothing computes it | `packetTemplates.ts:127` + no producer |
| **R2 — Blank line reported as `fits: true`** | `Number(budget) \|\| 0` on a null/NaN owner setting drops every item | `compactFit.ts:111` (D-2, proven) |
| **R3 — A posting-driven skill deleted** | duplicate-label provenance shadowing | `compactFit.ts:113-116` (D-1, proven) |
| **R4 — The wrong skill deleted** | per-list `seq` used as combined document position | `compactFit.ts:137,139` (D-3, proven) |
| **R5 — A skill the pipeline already dropped is preserved over live ones** | `driver` checked before `action` | `compactFit.ts:94` (D-4, proven) |
| **R6 — Item counts wrong everywhere downstream** | `' \| '` is a `splitItems` delimiter | `compactFit.ts:89` vs `swaps.ts:29` (D-5, proven) |
| **R7 — Compact and full resume disagree about the skills** | remediation may rewrite `SkillsBullets` independently | `remediation.ts:377` |
| **R8 — The drop happens and the owner is never told** | no margin note exists at all | nothing in repo |
| **R9 — A margin note fails silently** | no error path specified; `ok` derives from `warnings` only | `appPackets.ts:750` |
| **R10 — Truncation measured in the wrong unit** | `320` is a CHARACTER count; the owner said "space". No measurement of the actual Doc's Core Skills box is cited anywhere — `320` appears with no evidence comment, unlike every other threshold in `checks.ts` | `checks.ts:144` |
| **R11 — Owner edits the compact Doc, a rebuild silently supersedes it** | `renderArtifact` copies a fresh file each build; the prior file is orphaned (`supersededDocUrl`) | `appPackets.ts:669, 705` — pre-existing, but a margin note makes it newly visible |

**R10 deserves its own line.** Every other threshold in this repo carries a measured justification
(`H:char-limits-match-the-owners-prompt`, `hardening.test.mjs:3848` — 24/20 come from the live
`ats_user` prompt). `compactSkillsMaxChars: 320` carries none. Nobody has measured how many
characters the compact template's Core Skills block actually holds before it overspills, and the
owner's word was "space", not "characters". **The single source that would settle it is the compact
Doc itself** (`diag/doc-structure?type=compact_resume` already exists and was used for the
placeholder finding). Until that measurement exists, the fit logic is exact arithmetic on a
number nobody has grounded — it will either clip skills that would have fitted, or let the document
overspill while reporting `fits: true`.

### (b) Consumers of `TEMPLATE_META.compact_resume.placeholders` broken by 7 -> 2

All 17 are tabulated in §3 with file:line. The ones that produce **visibly wrong UI** rather than
just missing data:
- `assetBlocks.js:606,660` — `/^SkillsBullets\d$/` needs a digit ⇒ the compact skills card renders
  with **no target and no measurement**. Per the "No dead UI" rule, that card is dead.
- `assetGate.js:208` — no label ⇒ the gate drawer prints the raw slug `SkillsBullets`.
- `qcRail.js:340` — not in `MERGE_FIELDS` ⇒ the failing-check count is **inert**, not clickable.
- `assetBlocks.js:232` — not in `FIELD_ORDER` ⇒ skills sort AFTER Expertise, wrong reading order.
- `OppDetail.jsx:429` — the skills editor offers only "Column 1"/"Column 2"; there is no row for the
  compact's single block, so the owner cannot see or edit what actually ships.
- `evidence.ts:190` — no loop-0 baseline ⇒ the combined, item-dropped line is labelled
  **"From profile"**, which is false in the flattering direction — the exact defect
  `assetGate.js`'s METHOD_LABEL comment says must never come back.

### (c) Does the gate behave differently with 2 merge fields instead of 7? YES

1. **Four checks stop being emitted** (§3.1). `gateFor` cannot distinguish "check passed" from
   "check never ran" — it takes the rows it is handed (`checks.ts:838-849`). The compact artifact's
   gate is now computed from a strictly smaller evidence set, and nothing reports that.
   The repo's own rule — *absent evidence is `not_applicable`, never `pass`* — has no defence here
   because the row is not `pass`, it is **gone**.
2. **`omission_list` disappearing is the sharpest one.** It is the check that stops a skill the owner
   explicitly asked never to use from reaching an employer. On a compact resume it now cannot fire,
   because `listed` (`checks.ts:338`) is empty.
3. **`empty_merge_fields` now fails on every compact build** (1 of 2 empty), so in practice the
   compact gate is red today for the wrong reason — masking (1) and (2) behind a failure everyone
   will read as "the producer isn't written yet".
4. **`attentionCount`** (`checks.ts:856`) drops correspondingly: fewer rows, fewer possible
   warns. The badge under-reports.
5. **The reviewer grades a different document.** `buildReviewerPayload` (`reviewer.ts:123-127`)
   sends `asset` built from `mergeFieldsFor`, filtered to non-empty — so for a compact it sends
   `{ResumeSummary}` and asks a model whether the requirements are covered. Any coverage opinion it
   returns is about half a document.

---

## 7. Tier judgement — **TIER 1 (accusation grade)**, not tier 2

`CLAUDE.md` defines tier 1 as *"Anything that decides `must_have_coverage`, the artifact gate, a
score, a coverage count, or that names an offender"*, and states *"Tier 1 is a property of the CODE
PATH, not of the change's size."*

This change is tier 1 on **four independent counts**, any one of which would suffice:

1. **It names an offender.** `DroppedSkill.reason` (`compactFit.ts:64-68`) produces the words that
   go in the owner's margin, naming a specific skill and asserting it "answers nothing in this
   posting". That is an accusation about the owner's own content, written into a document. The
   module's own header says so: *"naming an item to delete from a resume is accusing"*
   (`compactFit.ts:33-35`).
2. **It changes the artifact gate.** The placeholder narrowing removes four checks from every
   compact artifact and flips `empty_merge_fields` to fail (§3.1, §6c). `checks.ts` is named in
   `CLAUDE.md` as the canonical tier-1 file — *"A one-line edit to `checks.ts` is tier 1"* — and
   this branch edits `checks.ts:66,144` **and** `checkPrefs.ts:46`.
3. **It deletes evidence a coverage claim rests on.** D-1 (proven) removes an item carrying a
   `requirementId` — i.e. content `must_have_coverage` may have counted — from the shipped document.
   The document and its own coverage claim then disagree.
4. **It decides what a human sends to an employer.** Irreversible in the sense that matters: the
   employer read it.

Process this therefore requires, per the tier-1 row: independent AC subagent **before** coding
(this document), an independent `verifier` **after**, mutation-proof of every new guard, and live
verification. The "batched per phase" allowance in `CLAUDE.md` explicitly does **not** apply.

**A dissent worth recording:** the author could argue that `compactFit.ts` is a pure function with no
DB and no gate import, so it is tier 2. That argument fails on point 2 — the branch does not consist
of `compactFit.ts` alone. `packetTemplates.ts:45-48` is the change with the blast radius, and it is
the one with no tests at all.

---

## 8. What the owner asked for that is NOT addressed at all

Mapped back to the four obligations in §1.

| Obligation | Addressed? | Gap |
|---|---|---|
| **O1** "taking the two and making them one **as a part of generating the compact resume**" | **NO** | The function exists and is never called. The owner's phrase "as a part of generating" is the whole requirement — a pure function in isolation satisfies none of it. `renderArtifact` (`appPackets.ts:627-684`) has no combine step. |
| **O2** "if overspill of space becomes an issue, **it should be flagged**" | **NO** | `overBudgetAfterDrops` is a field on a return value nothing reads. No check, no warning, no gate row, no UI. There is no `compact_skills_overflow` check key anywhere. |
| **O3** "the least relevant item **could be removed** to make it fit" | **PARTIALLY** | Ranking is implemented and unit-tested, and the ranking rationale (action+driver over confidence) is well-grounded. But D-1/D-3/D-4 (all proven by execution) mean it removes the wrong item in three reachable configurations, and it is never invoked. |
| **O4** "I should be **notified that happened in the right margin**" | **NOT STARTED** | Zero code. `grep -rn "comments" api/src --include=*.ts` finds no Drive comments API call anywhere in the repo. The scope is already granted (`googleOAuth.ts:5-6` requests `auth/drive`), so this is unbuilt, not blocked. |

### Three things the owner said that nobody has interpreted at all

1. **"overspill of *space*"** — not characters. Nobody has measured the compact template's Core
   Skills box. `320` (`checks.ts:144`) is an unevidenced constant in a file where every other
   threshold cites its source. Ground truth exists and is one call away:
   `diag/doc-structure?type=compact_resume` (the same route that produced the placeholder finding).

2. **"the right margin"** — Google Docs' right margin is the **comment sidebar**, reachable only via
   the **Drive** API (`files/{id}/comments`), not the Docs API this codebase already uses
   (`packetTemplates.ts:194` `apiBase`). That is a new API surface, new error paths (AC-12), and a
   new idempotency question on rebuild (AC-17). None of it is designed.

3. **"could be removed"** — conditional. The owner asked to be *notified*, which implies a decision
   they can reverse. Nothing preserves the dropped items anywhere the owner can act on:
   `DroppedSkill[]` is returned and discarded. Per the repo's `Prefer reversible over destructive`
   rule, the drop set should be persisted (an insertion row, an artifact warning, or a
   `compact_drop` record) so the owner can put a skill back — not only be told it went.

### One process gap
Per `CLAUDE.md`, a mistake becomes an **H-case in the same commit that fixes it**. The four defects
proven in §4 are live on this branch with no H-case. `api/test/compactFit.test.mjs` uses correct
slug naming (`H:compact-*`) — good — but every one of its 9 tests passes `skills2: []` or omits
`provenance` collisions, so the suite is green while D-1, D-3 and D-4 are all reachable.
**A test suite that is green on a proven defect is the inert-guard failure this repo names
explicitly.**

---

## 9. Appendix — claims re-verified against ground truth (not proxies)

| Claim | Source consulted | Result |
|---|---|---|
| `seq` restarts per list, so it is not combined document order (D-3) | `api/src/functions/tests/schema.ts:555` — `unique (packet_id, list, seq, loop)` on `swap_decision` | **CONFIRMED by the schema**, not inferred from naming. `skills_2` seq starts again at 0. |
| `empty_merge_fields` is a hard `fail`, not a warn | `checks.ts:191` — `bad(..., state: CheckState = 'fail')`, and `:493` passes no 5th arg | **CONFIRMED.** Every compact build is gate-red today. |
| No Drive comments API call exists anywhere | `grep -rn "/comments" api/src --include=*.ts` | **CONFIRMED — zero hits.** O4 is unstarted. |
| The scope needed for margin comments is already granted | `googleOAuth.ts:5-6` — `auth/drive`, `auth/documents` | **CONFIRMED.** `auth/drive` covers `files/{id}/comments`. |
| `fitCompactSkills` has no production caller | `grep -rn "fitCompactSkills\|from './compactFit'" api/src` | **CONFIRMED** — definition + one comment only. |
| `compactSkillsMaxChars` is read by no check | `grep -rn "compactSkillsMaxChars" api/src app/src` — 5 hits, all type/default/column/select/map | **CONFIRMED.** |
| D-1, D-2, D-3, D-4, D-5 | executed against `api/dist/functions/tests/compactFit.js` | **CONFIRMED by execution**, outputs quoted verbatim in §4. |

**Observation vs interpretation.** Everything in §4 and §9 is *observed*. §3's consumer table is
observed (each row is a file:line read). §6's severity ordering and §7's tier judgement are
*interpretation* — argue with those; the file:line facts underneath them are not in dispute.
