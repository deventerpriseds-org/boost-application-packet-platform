# AC — `ResumeSummary` word band (55–60) + advisory gate OFF

**Status: ACCEPTANCE CRITERIA ONLY. Nothing implemented. Do not treat any line below as a design
sign-off — it is a set of tests the implementation has to survive.**

Written by an independent adversarial reviewer, 2026-08-23, before any code was written.
Every file:line below was read in this session, not recalled.

---

## 0. Ground truth established before writing these ACs

Read, in order. Separated into **Observation** (what the file says) and **Interpretation** (what I
conclude from it), per CLAUDE.md's ground-truth rule.

| # | Observation (file:line) | Interpretation |
|---|---|---|
| G1 | `api/src/functions/tests/checks.ts:478-486` — `WORD_RULES` holds exactly five entries: `@AboutMe1_50words`, `@AboutMe2_60words`, `@ExecutiveProfile_55words`, `@CoreAccomplishments_5blts_180words`, `@CoverLetterBody`. | `ResumeSummary` has no band. Confirmed, not inferred. |
| G2 | `checks.ts:54-128` `CheckThresholds` — no `resumeSummary*` key. `checks.ts:131-154` `DEFAULT_THRESHOLDS` — same. | The threshold type itself must gain a key; this is not just a `WORD_RULES` line. |
| G3 | `api/src/functions/tests/packetTemplates.ts:25,29` — `resume` and `compact_resume` placeholders are `ResumeSummary, SkillsBullets1, SkillsBullets2, ExpertiseBullets, RelevantBullets1..3`. `:33,37` — portfolio/cover carry the five `@` fields. | **None of the five current `WORD_RULES` fields exist on a resume artifact.** `checks.ts:485` filters `WORD_RULES` by `has(f)` and `:486` skips the block entirely when `applicable.length === 0`. So **today a resume artifact emits NO `word_counts` check row at all.** Adding `ResumeSummary` makes a brand-new `check_key` appear on `resume` AND `compact_resume`. This is a bigger blast radius than "one more entry in a list" and the ACs below treat it as such. |
| G4 | `checks.ts:493-495` — the offender string is `` `${f}: ${w} words (want ${lo}-${hi})` `` and `bad()` (`checks.ts:163`) defaults `state: 'fail'`. | An out-of-band summary is a **fail**, not a warn. |
| G5 | `api/src/functions/tests/checkPrefs.ts:44-79` — `ENSURE_CHECK_COLUMNS_SQL`, one `alter table owner_search_prefs` with 25 `add column if not exists chk_*` clauses. `checkPrefs.ts:33-40` `checkPrefColumns()` derives the writer whitelist **by regex over that same string**. `:110-119` `SEEDED_DEFAULT` parses the seeds from it too. | A new column added to that ONE string is automatically writable and automatically seeded. Adding it anywhere else is a defect. |
| G6 | `checkPrefs.ts:155-176` — `loadThresholds` uses an **explicit SELECT column list**, and `:177-207` maps each column into a `CheckThresholds` key. Guarded by `H:every-chk-column-is-selected` (`api/test/hardening.test.mjs:3950`) and `H:every-threshold-is-configurable` (`:3802`). | Three separate places must all learn the new column or an existing H-case fails the suite. That is the guard working, not an obstacle. |
| G7 | **`owner_search_prefs` does not exist in `api/src/functions/tests/schema.ts` at all** (`grep -n "search_prefs\|chk_" schema.ts` → no matches). It is created and altered at runtime by `ensureCheckPrefs` (`checkPrefs.ts:121-127`), and by `appSearchPrefs.ts:21-33`, `appDimensions.ts:97-98`, `appRemediation.ts:61-63`. | **The brief's pointer to `schema.ts` for `owner_search_prefs` is wrong.** The migration-safety ACs below target `ENSURE_CHECK_COLUMNS_SQL` and the real `SCHEMA_SQL` H39/H39b invariant separately. An implementer who "does what the brief said" and edits `schema.ts` will have added the column in a place nothing runs. |
| G8 | `app/src/assetBlocks.js:480-486` — `RANGE` maps five `@` merge fields to threshold keys. `:488-521` `targetFor()`, `:540-569` `observedFor()`; both return `null` for any field not in `RANGE` and not matching the skills/relevant/expertise patterns. | `ResumeSummary` returns `null` from **both** today. Correct behaviour under "no thresholds, no target" (`assetBlocks.js:468`), and the fix is the missing threshold, not a literal — memory.md:2766 already records this. |
| G9 | `app/src/assetBlocks.js:504-513` — the comment settles it explicitly: *"THE THRESHOLD WINS OVER THE FIELD NAME… The name's number is stale; the threshold is what the gate tests and what the design displays."* | The precedent is already decided for `@AboutMe1_50words` vs `[45,48]`. `ResumeSummary` carries no number in its name, so the rule is trivially satisfied — but the guard must still be stated, because it is the rule a new `RANGE` entry could quietly break for its neighbours. |
| G10 | `app/src/screens/Settings.jsx:1611-1625` — `ChecksSettings` renders one control **per column published by the API** (`checkColumns`), so a new column renders the day it is added. `:1581-1601` `CHK_LABELS` supplies copy; `:1614` falls back to the raw column name. | A new column will render — **labelled `chk_resume_summary_words_min`** unless `CHK_LABELS` is extended. See AC-8 and the lazy-implementation section; this is the single most likely way this ships "settable" and unusable. |
| G11 | `Settings.jsx:1617-1621` — the column→value mapping is `column.replace(/^chk_/,'').replace(/_([a-z])/g, upper)`, then `p.checks[camel]`. `appSearchPrefs.ts:59` publishes `checks` = `loadThresholds(...)` output, whose paired keys are **tuples**: `coverWords: [250,400]`, `aboutMe1Words: [45,48]` (`checkPrefs.ts:196-204`). | **`chk_cover_words_min` → `coverWordsMin` → `p.checks.coverWordsMin` is `undefined`.** Every existing min/max pair control therefore renders with an EMPTY value box. Interpretation, confidence high from source read; **must be confirmed by `ui-verify.yml` before it is asserted as fact** (AC-9). If true, a new `chk_resume_summary_words_min/max` pair inherits the same defect and the owner can never *see* the seeded 55/60 — only overwrite it blind. |
| G12 | `chk_gate_advisory` consumers, by grep over `api/src/`: `appChecks.ts:279` (the `advisory` flag on the checks-result payload), `appChecks.ts:343` (`artifactGateOverride`'s 409), `appPackets.ts:160` (packet `ready` recompute), `appPackets.ts:322` (`artifactStatus` → `approvalBlock`). Plus the reader `checkPrefs.ts:162,185` and the seed `checks.ts:152`. | **Four behavioural consumers, not one.** Turning it off changes all four at once — see AC-13. |
| G13 | `api/src/functions/tests/appChecks.ts:206-218` `approvalBlock`. With advisory OFF: `gate==='fail'` → blocked, *"a fail cannot be overridden"*, **no override path exists**. With advisory ON: a fail is blocked only until a human records an override. A `warn` blocks-until-overridden in **both** modes (`:218`). | Advisory OFF is strictly more blocking, and it removes the escape hatch entirely for fails. There is no "override with a reason" once it is off. |
| G14 | `.claude/memory.md:2683` — *"`chk_gate_advisory` is still ON. It was the bridge…"*. `checks.ts:152` seeds it `false`. | The **code seed** is already `false`; it is the **owner's stored row** that is `true`. So "turn it off" is a DATA change to `owner_search_prefs`, not (only) a code change. An implementer who edits `DEFAULT_THRESHOLDS.gateAdvisory` will change nothing for the owner, because `syncCheckPrefDefaults` (`checkPrefs.ts:96-105`) **deliberately never writes existing rows** (`H:seed-changes-reach-the-database`). This is the highest-probability silent no-op in the whole change. |
| G15 | `docs/qc-evidence/qc/data.js:9` — `Resume summary 55–60 words (hard)`, headed *"Field contracts, verbatim from prompt 16"*. | The 55/60 seed has a primary source. It is a **seed**, not a constant (CLAUDE.md "No hardcoded config"). |
| G16 | `app/src/qcRail.js:340-344` `MERGE_FIELDS` already lists `ResumeSummary`; `:371` documents the offender shape `` `ResumeSummary: double space` ``; `sectionIdForOffender` (`:377+`) parses `<field>: …`. | Deep-linking a new `word_counts` offender to the Resume-summary field should work **without change** — which must be *verified*, not assumed (AC-27). |
| G17 | `app/src/assetGate.js:155` — `FIELD_LABEL.ResumeSummary = 'Resume summary'`. | The user-facing name already exists and is shared by four surfaces (`assetGate.js:151-153`). No new label vocabulary should be minted. |

### Measured fact this change is built on (supplied, not re-measured by me)

Seven live `ResumeSummary` values measure **48, 49, 49, 61, 61, 70, 70** words. **All seven are
outside 55–60.** Zero currently-stored resume summaries pass the new band.

> **I did not verify this myself** — the live DB was not reachable from this session
> (`Azure_pg_mcp` reported *requires authentication*; no `Boost_DB_Connector` tool was loaded).
> AC-23 therefore requires the implementer to **re-measure it via `db-query.yml` before landing**,
> because the whole "existing packets become blocked" argument rests on it and a stale count would
> mis-size the owner-facing warning.

---

## 1. Acceptance criteria

Naming is not prescribed except where an existing derived guard forces it. Where I write
`resumeSummaryWords` / `chk_resume_summary_words_min` / `chk_resume_summary_words_max`, any names
may be used **provided** `H:every-threshold-is-configurable` and `H:every-chk-column-is-selected`
still pass, since both derive their expectations from source.

### A. The band exists and is enforced (happy path)

**AC-1 — 57 words passes.**
Given a `resume` artifact whose `pkg.ResumeSummary` contains exactly 57 words and whose other six
merge fields are unchanged, when `runChecks` runs with `DEFAULT_THRESHOLDS`, then the returned
results contain **exactly one** `check_key: 'word_counts'` row, its `state` is `'pass'`, and its
`offenders` array is empty.

**AC-2 — 48 words fails, and says why in the offender string.**
Given the same artifact with a 48-word `ResumeSummary`, when `runChecks` runs, then the
`word_counts` row has `state: 'fail'` and `offenders` contains the exact string
`ResumeSummary: 48 words (want 55-60)` — matching the format already emitted at `checks.ts:494`,
so that `qcRail.sectionIdForOffender` can resolve it (AC-27).

**AC-3 — 70 words fails on the upper bound.**
Given a 70-word `ResumeSummary`, when `runChecks` runs, then the `word_counts` row is `'fail'` with
offender `ResumeSummary: 70 words (want 55-60)`.

**AC-4 — the boundaries are INCLUSIVE, both ends.**
Given `ResumeSummary` values of exactly 54, 55, 60 and 61 words, when `runChecks` runs on each,
then 55 and 60 are `'pass'` and 54 and 61 are `'fail'`. (54 and 61 are not decorative: two of the
seven live rows measure 61, so an exclusive/inclusive slip changes the real answer for two packets.)

**AC-5 — an EMPTY summary is owned by `empty_merge_fields`, not by the band.**
Given a `resume` artifact whose `ResumeSummary` is `''` or null, when `runChecks` runs, then
`word_counts` does **not** list it as an offender (`checks.ts:490` skips empty values), and
`empty_merge_fields` reports it instead. Two checks must not accuse the same field for the same
absence.

**AC-6 — a resume artifact now emits a `word_counts` row where it previously emitted none.**
Given any `resume` or `compact_resume` artifact, when `evaluateArtifact` stores its results, then
`check_result` contains a `word_counts` row for that artifact — where before this change it
contained none (G3). And given a `cover` artifact (placeholders `@Company`, `@CoverLetterDate`,
`@CoverLetterBody` only, `packetTemplates.ts:37`), when checks run, then its `word_counts` row
still lists **only** `@CoverLetterBody 250-400` in `expected` — the resume rule must not leak into
an artifact type that has no such field.

**AC-7 — `compact_resume` is covered too.**
Given a `compact_resume` artifact (same seven placeholders, `packetTemplates.ts:29`) with a 70-word
`ResumeSummary`, when `runChecks` runs, then it fails identically to AC-3. An implementation that
only reasons about `type === 'resume'` fails this.

### B. It is a SETTING, not a constant

**AC-8 — the owner can READ the seeded value in Settings, as a number, with a human label.**
Given an owner with a `owner_search_prefs` row, when they open **Settings ▸ Quality checks**, then
two controls appear whose **visible labels are English** (e.g. "Resume summary, fewest words" /
"…most words") — **not** `chk_resume_summary_words_min` — and whose input boxes show **55** and
**60**, not blank. Evidence must be a `ui-verify.yml` screenshot plus an `expect` assertion on the
label text, per CLAUDE.md's Playwright-in-GHA section.

**AC-9 — the min/max display bug is fixed or proven absent, not inherited.**
Given `Settings.jsx:1617-1621` maps `chk_x_min` → `p.checks.xMin` while `loadThresholds` publishes
`x: [lo,hi]` (G11), when the implementer runs `ui-verify.yml` on `#/settings` **before** touching
anything, then either (a) the existing `chk_cover_words_min` / `chk_about_me1_words_min` boxes are
observed **empty**, in which case the mapping is fixed as part of this change and AC-8 is met for
the existing pairs too; or (b) they are observed **populated**, in which case G11 is recorded as a
wrong inference and AC-8 is satisfied by the existing mechanism. **Either way the observation is
recorded in this file with the run id.** Shipping a control that renders blank and calling it
"owner-settable" does not satisfy AC-8.

**AC-10 — the seeded 55/60 can be CHANGED, and the change reaches the gate.**
Given the owner sets the band to 40–80 via `POST /api/app/search-prefs` with
`{ checks: { chk_resume_summary_words_min: 40, chk_resume_summary_words_max: 80 } }`, when the
response returns, then `wroteChecks` contains both column names; and when the checks are re-run for
an artifact with a 70-word summary, then `word_counts` is `'pass'` and the `expected` string reads
`ResumeSummary 40-80`. When the owner sets it back to 55/60, the same artifact fails again.
Evidence: two `api-test.yml` runs with the artifact's real id, job logs quoted.

**AC-11 — the THRESHOLD is authoritative over any number in a field name.**
Given the precedent already settled at `assetBlocks.js:504-513` for `@AboutMe1_50words` (name says
50, threshold says 45–48, threshold wins), when the band for `ResumeSummary` is displayed anywhere
in the UI, then the numbers rendered come from `thresholds.resumeSummaryWords` and from no other
source. Binary form of the test: **`grep -rn "55" app/src/assetBlocks.js app/src/assetGate.js
app/src/qcRail.js` returns no literal 55 or 60 introduced by this change**, and setting the pref to
40–80 (AC-10) changes the rendered target string on screen. A hardcoded `'55–60 words'` in the UI
passes a screenshot and fails this.

### C. The UI states the contract beside the measurement, in the same unit

**AC-12 — `targetFor('ResumeSummary', thresholds)` returns `"55–60 words"`.**
Given thresholds carrying the new key, when `targetFor` is called with `'ResumeSummary'`, then it
returns the en-dash band string produced by the existing `RANGE` branch (`assetBlocks.js:513-519`),
i.e. `55–60 words`. Given `thresholds` is null/absent, then it returns **null**, never a default —
`assetBlocks.js:468`: *"a contract stated from a guess is a promise the gate has not agreed to."*

**AC-13 — `observedFor('ResumeSummary', row, thresholds)` returns a WORD count.**
Given the same thresholds and a row whose `after_text` is 70 words, when `observedFor` is called,
then it returns `"70 words"` — the same unit as the target. The pair must read
`70 words · 55–60 words`. An implementation that adds `ResumeSummary` to `RANGE` gets both halves
at once (`assetBlocks.js:563-567`); one that adds a bespoke branch to only `targetFor` re-creates
exactly the defect `observedFor` was written to close (memory.md:2769, register item 3) and fails
this AC.

**AC-14 — the two functions do not diverge.**
Given `assetBlocks.js:535-539` states the branches "MIRROR `targetFor()` EXACTLY", when the change
lands, then for **every** merge field in `qcRail.MERGE_FIELDS`, `targetFor(f, t) === null` if and
only if `observedFor(f, row, t) === null`. Stated as a unit test over the full field list, not as a
comment.

### D. Schema / migration safety

**AC-15 — the column is declared in the ONE string that the whitelist is derived from.**
Given `checkPrefColumns()` regexes `ENSURE_CHECK_COLUMNS_SQL` (`checkPrefs.ts:33-40`) and
`SEEDED_DEFAULT` regexes it again (`:110-119`), when the new columns are added, then they are added
**inside `ENSURE_CHECK_COLUMNS_SQL`** and nowhere else, and `checkPrefColumns()` returns 27 entries
including both new names with type `int`. Adding them via a separate `alter table` statement, or in
`appSearchPrefs.ts:30-32`, or in `schema.ts`, fails this — the writer whitelist would not see them
and the settings route would silently ignore the owner's edit.

**AC-16 — applied to a POPULATED database that already carries the previous schema.**
Given a local PostgreSQL 16 seeded by running `origin/main`'s `SCHEMA_SQL` **and then**
`ensureCheckPrefs` from `origin/main`, and then seeded with at least one real
`owner_search_prefs` row carrying non-default `chk_*` values and at least one `artifact` +
`artifact_gate` + `check_result` row, when the NEW `ensureCheckPrefs` runs against it under
`psql -v ON_ERROR_STOP=1`, then it exits **0**, `\d owner_search_prefs` shows the two new columns
with defaults 55 and 60, and **the pre-existing row's other `chk_*` values are byte-identical to
before** (`H:seed-changes-reach-the-database` — a "helpful" UPDATE is data loss).
Fresh-database success is explicitly NOT accepted as evidence: `add column if not exists` is a
no-op on the only database that matters.

**AC-17 — the H39/H39b ordering invariant still holds for `SCHEMA_SQL`.**
Given `api/test/hardening.test.mjs:1463` (`H39b`) walks `SCHEMA_SQL` for any statement naming a
column added by a later idempotent ALTER, when the suite runs after this change, then `H39b`,
`H39`, `H39c` and `H39d` all pass. If the implementer touches `schema.ts` at all (they should not
need to — G7), this is the guard that catches the ordering class that has already bitten this repo
twice.

**AC-18 — a NULL on a legacy row does not read as zero.**
Given a hypothetical `owner_search_prefs` row where the new columns are NULL (possible if a future
migration adds them nullable, or if a row is inserted by a path that bypasses the ensure), when
`loadThresholds` runs, then `resumeSummaryWords` must not resolve to `[null, null]` or `[0, 0]` —
either it falls back to the seeded `[55, 60]`, or the check reports `not_applicable`. A band of
`0-0` would fail every summary ever written with an offender string nobody can act on. Compare the
deliberate `=== true` / `!== false` reasoning at `checkPrefs.ts:185` and `:238` — the three-state
question (no row / set / unset) has already been thought about once in this file and must be
answered again here rather than copied blindly.

### E. Regression guard

**AC-19 — the other five bands do not change behaviour.**
Given the same portfolio and cover fixtures used before the change, when `runChecks` runs, then the
`word_counts` results for `@AboutMe1_50words` (45–48), `@AboutMe2_60words` (75–80),
`@ExecutiveProfile_55words` (50–55), `@CoreAccomplishments_5blts_180words` (98–125) and
`@CoverLetterBody` (250–400) are **byte-identical** to `origin/main`'s output — same states, same
offender strings, same `expected` string ordering. Evidence: run the existing suite on both
revisions against the same fixture and diff the JSON, not "the tests still pass".

**AC-20 — the `expected` string on a portfolio artifact does not grow a resume rule.**
Given a portfolio artifact, when `word_counts` is produced, then its `expected` string lists the
four portfolio bands and does **not** mention `ResumeSummary`. (`checks.ts:495-497` builds
`expected` from `applicable`, so this is free if `WORD_RULES` is extended correctly and broken if
someone hardcodes the string.)

**AC-21 — the derived guards still bind.**
Given the suite, when it runs, then `H:every-threshold-is-configurable`,
`H:every-chk-column-is-selected`, `H:seed-changes-reach-the-database` and
`H:char-limits-match-the-owners-prompt` all pass **and** the first two are shown to be
mutation-sensitive to this change specifically: removing the new `resumeSummaryWords` line from
`loadThresholds`'s return **must** fail `H:every-threshold-is-configurable`, and removing the new
column from the SELECT projection **must** fail `H:every-chk-column-is-selected`. Run both
mutations, observe both failures, restore. (CLAUDE.md: *"THE ONE STEP THAT IS NEVER SKIPPED, AT ANY
TIER: mutation-prove a NEW guard"* — and these are existing guards being asked to cover new
ground, which is the same obligation.)

**AC-22 — a NEW H-case is added for the thing no existing guard covers.**
Given that no current guard asserts *the resume summary has a band at all*, when this change lands,
then `api/test/hardening.test.mjs` gains a slug-named case (e.g.
`H:resume-summary-has-a-word-band`) asserting that the headline field of the headline asset is
covered by `WORD_RULES`, with the evidence recorded in its comment (memory.md:2766, `qc/data.js:9`,
the seven measured counts). Numeric IDs are banned (`H26`).

### F. Turning `chk_gate_advisory` OFF — a GLOBAL change, not a per-check one

**AC-23 — the seven existing summaries are RE-MEASURED before the switch, not assumed.**
Given the supplied counts 48/49/49/61/61/70/70, when the implementer runs `db-query.yml` with SQL
that measures the live word counts and the artifacts they belong to — e.g.

```sql
select a.id as artifact_id, a.type, a.packet_id, p.status,
       array_length(regexp_split_to_array(btrim(pk.pkg->>'ResumeSummary'), '\s+'), 1) as words
  from artifact a join packet p on p.id = a.packet_id ...
```

(the exact projection is the implementer's to write against the real package column) — then the
result is pasted into this file with the run id, **and it either reproduces 7 rows all outside
55–60, or the discrepancy is reported to the owner before anything is switched.** The owner
consented to a stated blast radius; a different blast radius is a different decision.

**AC-24 — turning it off is done to the OWNER'S ROW, and is proven to have taken effect.**
Given `checks.ts:152` already seeds `gateAdvisory: false` and `syncCheckPrefDefaults`
(`checkPrefs.ts:96-105`) deliberately never writes existing rows, when advisory is turned off, then
the change is made by **writing the owner's `owner_search_prefs` row** (via
`POST /api/app/search-prefs {checks:{chk_gate_advisory:false}}`, or a `db-query.yml` UPDATE), and
verified by a subsequent **`GET /api/app/artifact/{id}/checks-result` returning `advisory: false`**
(`appChecks.ts:279`). Editing `DEFAULT_THRESHOLDS` alone and reporting it done fails this AC — it
is a no-op on the only row that matters (G14). This is the single most likely silent failure of the
whole change and it must be evidenced by the API response, not by the diff.

**AC-25 — every one of the four consumers is named and its new behaviour stated.**
Given advisory OFF, when the implementer writes the change up, then all four sites from G12 are
named with their new behaviour, each backed by an observed response or test:

| Consumer | Advisory ON (today) | Advisory OFF (after) | How it is proven |
|---|---|---|---|
| `appChecks.approvalBlock` (`:206-218`) | a `fail` may be approved once a human records an override | a `fail` is **blocked outright**, reason *"a fail cannot be overridden"* | `POST /artifact/{id}/status {"status":"approved"}` → **409** with that reason |
| `appChecks.artifactGateOverride` (`:340-346`) | a `fail` can be overridden with a ≥8-char reason | **409** *"a fail cannot be overridden — fix the findings or re-run the checks"* | `POST /artifact/{id}/gate-override` → 409 |
| `appPackets.recompute…ready` (`:158-166`) | an **overridden** fail does not stop `ready` | **any** fail stops `ready`; the packet stays `review` | packet `status` observed via `GET /app/packet/{id}` |
| `appChecks` checks-result payload (`:279`) | `advisory: true` | `advisory: false` | the JSON field itself; and the client's footer/CTA derived from it (`assetGate.footerFor`) |

**AC-26 — the effect is NOT limited to the new resume-summary check.**
Given advisory OFF applies to `artifact_gate.gate`, which is derived from **all** deterministic
check rows (`appChecks.ts:122` `gateFor(results)`), when the switch is made, then the write-up
states explicitly that **every artifact of every type currently sitting on an overridden `fail`
loses that override's effect** — not only resumes. Binary test: before switching, run
`db-query.yml` for `select count(*) from artifact_gate where gate='fail' and override_by is not
null` and for `select count(*) from artifact_gate where gate='fail'`; both counts are recorded in
this file. If the first is > 0, those packets are **also** newly blocked and the owner is told the
number.

**AC-27 — a newly blocked packet says so IN WORDS, not only as a red chip.**
Given a packet whose resume artifact now fails the 55–60 band, when the owner opens it in the
production SPA, then the screen states in plain language that the packet cannot be sent, names the
field (**"Resume summary"** — the existing `FIELD_LABEL` at `assetGate.js:155`, no new vocabulary),
states the measurement and the contract in the same unit (`70 words · 55–60 words`), and the
finding is **click-through to that field** (`qcRail.sectionIdForOffender` resolving the
`ResumeSummary: 70 words (want 55-60)` offender to the Resume-summary section — G16). Evidence: a
`ui-verify.yml` run with `expect` covering the sentence, the field name and both numbers, plus the
uploaded screenshot. A red dot with no sentence fails this AC. So does a sentence containing the
words `fail`, `warn` or `gate` — SPEC 7 bans the engine's vocabulary as a user-facing label
(memory.md:2755-2760).

**AC-28 — the owner is told, in the product, what changed and what to do.**
Given seven previously-shippable packets become unshippable at the moment of the switch, when the
change is reported, then the owner receives (a) the count of newly blocked packets, measured not
estimated, (b) the reason in one sentence, and (c) the two ways out — edit the summary into band,
**or** change the band in Settings ▸ Quality checks (AC-8/AC-10), named with the path. CLAUDE.md:
*"When you set a 'first value' on the owner's behalf, tell them where to change it."*

**AC-29 — `warn` behaviour is untouched.**
Given an artifact whose gate is `warn`, when advisory is switched off, then its behaviour is
**identical** to before: still blocked until an override with a reason is recorded
(`appChecks.ts:218`, which reads no advisory flag at all). The existing guard
`H:advisory-never-touches-a-warn-or-a-pass` (memory.md:2620) must still pass, and must be shown to
still be mutation-sensitive.

**AC-30 — the switch is reversible and the reversal is proven.**
Given the owner may want the bridge back, when advisory is set to `true` again via Settings, then
`checks-result` returns `advisory: true` and a `fail` becomes overridable again — observed, not
assumed. A change to live behaviour that cannot be demonstrated to reverse is not a setting.

---

## 2. Ways a lazy implementation could pass these ACs anyway

This is the section to read twice. Each item satisfies the letter of something above while missing
the point; each has the specific counter-test that closes it.

1. **Add the `WORD_RULES` line and nothing else, and unit-test only `runChecks`.**
   `runChecks` takes `thresholds` as a parameter (`checks.ts:267`), so a test that passes
   `{resumeSummaryWords:[55,60]}` inline passes AC-1..AC-7 **while the column does not exist, the
   owner cannot change it, and `loadThresholds` never sends it.** Every band assertion would be
   green and production would grade against `DEFAULT_THRESHOLDS` forever.
   *Counter:* AC-10 requires the value to move **through the HTTP route into the check result**, and
   AC-21 requires the two derived H-cases to be mutation-proven against this specific key.

2. **Ship it as `chk_resume_summary_words_min/max` with no `CHK_LABELS` entry.**
   The control renders (G10), the API writes it, every AC about read/write passes — and the owner
   sees two boxes labelled `chk_resume_summary_words_min` and `chk_resume_summary_words_max` next to
   twelve other raw column names. Technically settable; practically a black box, which is exactly
   what the no-hardcoded-config rule exists to prevent.
   *Counter:* AC-8 demands English labels **observed in a screenshot**.

3. **Ship it into the *existing* blank-input bug and call the control "present".**
   If G11 is right, the box renders empty. An implementer who screenshots "two new controls appear"
   satisfies a careless reading of AC-8 while the owner cannot see that the seed is 55/60, cannot
   tell a set value from an unset one, and typing into one box saves a value they never saw.
   *Counter:* AC-8 says the boxes **show 55 and 60**; AC-9 forces the pre-change observation on
   record either way.

4. **Put the band in `targetFor()` only.**
   The card then reads `10 lines · 20 words · 55–60 words` or, worse, shows the target with no
   measurement. Defect register item 3 (memory.md:2771) is precisely this class — "the app states a
   char rule and measures in words" — and it was just fixed by `observedFor()`. Re-opening it one
   field later would be the "fix the one screen" failure CLAUDE.md's blast-radius rule names.
   *Counter:* AC-13 and AC-14 (the null-parity property over the whole `MERGE_FIELDS` list).

5. **Hardcode `'55–60 words'` in the JSX because "the threshold is right there in the design".**
   Passes every screenshot AC. Fails the moment the owner changes the band, and then the screen
   states a contract the gate does not enforce — the exact scenario `assetBlocks.js:463-467` says is
   *"worse than printing nothing"*.
   *Counter:* AC-11's grep + the change-the-pref-and-re-observe step in AC-10.

6. **Flip `DEFAULT_THRESHOLDS.gateAdvisory` and report advisory off.**
   The diff looks right, the tests pass, `H:advisory-off-still-blocks-a-fail` passes — and the
   owner's stored row still says `true`, so **nothing changes in production**. This is the same
   shape as the measured `skillMaxChars` 30→24 incident that `H:seed-changes-reach-the-database`
   exists to remember, and the same shape as `chk_gate_advisory` being declared, defaulted, written
   and mapped while never being SELECTed. The repo has now been bitten by this exact class twice.
   *Counter:* AC-24 — proof is `checks-result` returning `advisory:false` for the owner, nothing else.

7. **Turn advisory off and mention only the resume summary.**
   The switch is global (AC-26). Any artifact anywhere sitting on an overridden `fail` silently
   loses that override's effect, and any packet made `ready` that way falls back to `review`. A
   write-up scoped to "7 resume summaries" would be accurate about the new check and wrong about
   the change.
   *Counter:* AC-26's two before/after counts, on the record.

8. **Satisfy "stated in words" with a tooltip or an `aria-label`.**
   Nobody reads it, and it would pass a naive `expect` grep on the DOM text.
   *Counter:* AC-27 requires the sentence in the visible body plus the screenshot artifact — and
   `ui-verify.mjs` asserts on rendered text, so the evidence and the requirement are the same thing.

9. **Use the engine's words in that sentence** — "This artifact failed the word_counts gate."
   Passes AC-27's "in words" reading and violates SPEC 7's ban on engine vocabulary as a user-facing
   label, which memory.md:2757 records as a settled decision.
   *Counter:* the explicit exclusion in AC-27.

10. **Test the band on a fresh local database.**
    Every `add column if not exists` is skipped on the database that matters, so a fresh-DB pass
    proves nothing about production — the rule CLAUDE.md states in bold and that H39b/H39c were both
    born from.
    *Counter:* AC-16's seeded-from-`origin/main`, populated-row procedure.

11. **Write the ACs' happy path with word counts that avoid the boundary.**
    57/48/70 are all comfortably inside or outside. Two live rows measure exactly **61** — one off
    the boundary. An off-by-one in `w < lo || w > hi` would pass AC-1..AC-3 and mis-grade two real
    packets.
    *Counter:* AC-4's 54/55/60/61 quartet.

12. **Forget `compact_resume`.**
    It is a byte-identical duplicate of `resume` (`insertions.ts:8-9`, `packetTemplates.ts:27-30`),
    so it is easy to reason about "the resume" and ship a change that covers one of the two artifact
    types a packet actually contains. The packet would still be blocked, by a *different* artifact,
    with the implementer's tests all green.
    *Counter:* AC-7.

13. **Treat the new `word_counts` row on resumes as free.**
    Resume artifacts have never had one (G3). Anything that counts check rows, snapshots a
    checks-result payload, asserts an `attention_count`, or diffs a fixture will now see a new row.
    A test suite that "still passes" may simply not cover it; a UI list may now show a finding
    category on a screen that never had one.
    *Counter:* AC-6, plus AC-19's byte-level fixture diff rather than a green-suite claim.

14. **Report "fixed" after merging to `main` without the owner seeing it.**
    Both CLAUDE.md and the global rules forbid this, and this change is *specifically* one whose
    whole visible effect is in the owner's browser on their own data.
    *Counter:* the write-up must say **"implemented, verified by run <id>, NOT yet confirmed live by
    the owner"** until the owner reports back.

15. **Do the whole thing at tier 2 because "it's a threshold and a boolean".**
    `checks.ts` decides `artifact_gate`, which decides `approvalBlock`, which decides whether a
    packet ships. CLAUDE.md: *"Tier 1 is a property of the CODE PATH, not of the change's size. A
    one-line edit to `checks.ts` is tier 1."* This change is tier 1 twice over — it adds an
    accusation and it removes the override that softened accusations.
    *Counter:* item 8 of the checklist below.

---

## 3. Implementer's checklist

Tick each only with the named evidence attached. "Should work" is banned.

**Before writing code**
- [ ] 1. Re-measure the seven live `ResumeSummary` word counts via `db-query.yml`; paste the run id
      and the rows here. Report to the owner if they differ from 48/49/49/61/61/70/70. *(AC-23)*
- [ ] 2. Record the two before-counts: `artifact_gate` rows with `gate='fail'`, and of those, how
      many carry `override_by`. *(AC-26)*
- [ ] 3. Run `ui-verify.yml` on the Settings screen and record whether the existing
      `chk_cover_words_min` / `chk_about_me1_words_min` boxes render populated or empty. *(AC-9, G11)*
- [ ] 4. Confirm the owner's live `chk_gate_advisory` value via
      `GET /api/app/artifact/{id}/checks-result` → `advisory`. *(AC-24, G14)*

**Code — the band**
- [ ] 5. `CheckThresholds` + `DEFAULT_THRESHOLDS` gain the band, seeded `[55, 60]` from
      `docs/qc-evidence/qc/data.js:9`, with the prompt-16 provenance in the comment. *(G15)*
- [ ] 6. `WORD_RULES` (`checks.ts:478`) gains `ResumeSummary`. *(AC-1..AC-7)*
- [ ] 7. Two `int` columns added **inside `ENSURE_CHECK_COLUMNS_SQL`** (`checkPrefs.ts:44-79`) and
      nowhere else; added to `loadThresholds`'s **SELECT projection** and to its **return mapping**.
      *(AC-15, AC-18, AC-21)*
- [ ] 8. **Tier 1 process** — this touches `checks.ts` and the approval gate. Independent `verifier`
      subagent after implementation; every new guard mutation-proven; live verification.
- [ ] 9. `CHK_LABELS` (`Settings.jsx:1581`) gains English copy for both new columns. *(AC-8)*
- [ ] 10. `RANGE` (`assetBlocks.js:480`) gains `ResumeSummary`, so `targetFor` **and** `observedFor`
      both light up from the one map. *(AC-12, AC-13, AC-14)*
- [ ] 11. No literal `55` or `60` introduced anywhere in `app/src/`. *(AC-11)*

**Tests**
- [ ] 12. Band cases at 48, 54, 55, 57, 60, 61, 70 and empty. *(AC-1..AC-5)*
- [ ] 13. `compact_resume` covered. *(AC-7)*
- [ ] 14. `cover` and `portfolio` `expected` strings unchanged; the five existing bands byte-diffed
      against `origin/main`'s output on the same fixture. *(AC-19, AC-20)*
- [ ] 15. `targetFor`/`observedFor` null-parity over all of `qcRail.MERGE_FIELDS`. *(AC-14)*
- [ ] 16. New H-case `H:resume-summary-has-a-word-band`, slug-named, evidence in the comment.
      *(AC-22)*
- [ ] 17. Mutation-prove: drop the return-mapping line → `H:every-threshold-is-configurable` FAILS;
      drop it from the SELECT → `H:every-chk-column-is-selected` FAILS; restore both. *(AC-21)*

**Migration**
- [ ] 18. Local PG16: apply `origin/main` `SCHEMA_SQL` + `origin/main` `ensureCheckPrefs`, seed a row
      with **non-default** `chk_*` values and real artifact/gate/check rows, then run the NEW
      `ensureCheckPrefs` under `ON_ERROR_STOP=1`. Exit 0; new columns default 55/60; the seeded
      row's other values unchanged. *(AC-16)*
- [ ] 19. `H39`, `H39b`, `H39c`, `H39d` all pass. *(AC-17)*

**The switch**
- [ ] 20. Advisory turned off **on the owner's row**, proven by `checks-result` → `advisory:false`.
      *(AC-24)*
- [ ] 21. All four consumers exercised and their new behaviour observed — 409 on approve, 409 on
      override, packet held at `review`, payload flag false. *(AC-25)*
- [ ] 22. `warn` behaviour demonstrated unchanged. *(AC-29)*
- [ ] 23. Reversal demonstrated: advisory back on → a fail is overridable again. *(AC-30)*

**Owner-facing**
- [ ] 24. `ui-verify.yml` on a newly blocked packet: the sentence, the field name "Resume summary",
      `70 words · 55–60 words`, and the click-through — screenshot attached. No `fail`/`warn`/`gate`
      in the user-facing copy. *(AC-27)*
- [ ] 25. Owner told: how many packets are newly blocked (measured), why, and the two ways out
      including the Settings path. *(AC-28)*
- [ ] 26. Written up as **"implemented, verified by run <id>, NOT yet confirmed live by the owner"**
      until the owner confirms in their own browser. *(lazy-implementation item 14)*
- [ ] 27. `.claude/memory.md:2766` register item 1 ("NOT YET FIXED") and `:2683` ("`chk_gate_advisory`
      is still ON") updated to match reality; `.claude/actions.md` links the evidence.

---

## 4. Open questions for the owner — answer BEFORE implementing

1. **Which artifact types should the 55–60 band apply to?** `resume` and `compact_resume` both carry
   `ResumeSummary` and are byte-identical (`insertions.ts:8-9`). Assumed: both. If only one, say so —
   it changes AC-7.
2. **Do the seven out-of-band summaries get corrected, or the band widened?** The measured spread is
   48–70; 55–60 blocks all seven. Fixing them is content work on seven documents. The ACs assume the
   owner accepts the block, as stated in the brief.
3. **Should the existing overridden fails (AC-26 count) be re-examined before advisory goes off?**
   They were approved under a rule that is about to be withdrawn.
4. **G11 (blank min/max boxes in Settings) — in scope?** If confirmed, four existing threshold pairs
   are already unreadable in the UI. Fixing the mapping is a small change that makes AC-8 achievable
   for all of them; leaving it means shipping a fifth unreadable pair.

---

## Addendum — measurements taken AFTER these ACs were written (2026-08-23)

AC-23 made re-measuring the live word counts a pre-implementation gate rather than an assumption,
because the AC author could not reach the DB. Those measurements have now been taken, plus two the
ACs could not have asked for. Recorded here so the implementer does not have to re-derive them.

**The seven live `ResumeSummary` word counts** (via `Boost_DB_Connector`, before it expired):
48, 49, 49, 61, 61, 70, 70. **None is inside 55–60.** AC-4's boundary pins at 54/55/60/61 are
load-bearing: two rows sit at exactly 61, one word outside the band.

**`chk_gate_advisory` is `true` in the owner's stored row** — confirming the AC's highest-probability
silent no-op (§2). `DEFAULT_THRESHOLDS.gateAdvisory` is already `false` in code, so changing code
changes nothing. Only an UPDATE to `owner_search_prefs` moves it, and AC-24's "accept only
`checks-result → advisory:false` as proof" is the right bar.

**WHY ADVISORY WAS TURNED ON, measured rather than assumed** — this reframes the whole change and
the owner named it first ("it sounds like advisory mode is a patch instead of fixing the 35").
`POST /api/app/opportunity/{eMoney}/evidence` returns:

```
total 35 · evidenced 5 · unevidenced 30 · refused 0
profile_records 15 · escalated 9 · proposed 5
escalation_refusals { over_cap 1, not_worth_escalating 3, model_declined 4 }
sources [resume template …, MasterContext (14 blocks)] · profileReadable TRUE
```

The profile IS readable — the "profile unreadable" hypothesis is disproved. Coverage is starved by
two things instead:

1. **The profile is 15 records** matched against 35 requirements.
2. **Five model proposals are parked awaiting confirmation** and, by design, do not count toward the
   coverage gate. The API says so in its own `note`.

So the gate is not wrong; it is under-fed. **Confirming those five proposals and enriching the
profile both raise coverage without touching the gate at all** — which means turning advisory off is
neither necessary for, nor sufficient for, fixing the 35. Any implementer picking this up should
treat the advisory flip and the coverage problem as SEPARATE changes, and should expect the owner to
want the second one first.
