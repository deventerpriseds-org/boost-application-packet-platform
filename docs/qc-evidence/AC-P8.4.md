# P8.4 - Posting-vs-profile comparison, graded: acceptance criteria

Written **COLD** by an independent AC agent against `main` at `c360e6e`, with no sight of any
implementation plan for P8.4 and no contact with whoever is building it. Every line reference below
was opened and read at that commit; nothing here is inferred from a summary. Where a claim could not
be settled from a primary source it is labelled **INFERENCE** and names what would confirm it.

These criteria are written to be used **adversarially**: each one is a thing a reviewer will try to
prove false. "It works" is not a pass. The pass is the observable outcome named in the criterion.

---

## 1. Scope, quoted verbatim

From `docs/qc-evidence/BACKLOG.md:401-408`:

> ### P8.4 Posting-vs-profile comparison, graded
> - [ ] Persist the comparison dimensions (tenure, org size, budget, compliance, modernization, cycle
>       time, domain, public sector - configurable per role family) with the posting requirement, the
>       profile value and a graded fit plus an optional qualifier note.
> - [ ] The JD step shows the comparison, not pipeline counters ("posting lines", "passes").
>
> **Acceptance:** the JD result reads as a two-sided comparison; every moderate/weak grade carries the
> reason.

Nothing below expands past that. Where a criterion touches a neighbouring item (P8.3's evidence
rows, P5.4's extraction strip, P8.5's severity selector) it does so only to state what P8.4 must
**not break**.

---

## 2. Ground truth: what exists, and what the spec actually says

### 2.1 The spec's own words

`docs/qc-evidence/SPEC.md:131-149` (SS4.2, "JD analysis - posting vs your profile"):

- It **replaces the old counter strip** `"6 of 12 posting lines * 3 passes"`, "which described the
  pipeline rather than the comparison" (`SPEC.md:134-135`).
- **Four fit cards**: Responsibilities, Must-have requirements, Nice-to-have requirements, ATS
  keywords - each `n of m`, a graded verdict, and "if incomplete, what is missing by name"
  (`SPEC.md:137-139`).
- **Comparison table, four columns**: `Dimension * The posting asks for * Your profile evidences *
  Fit` (`SPEC.md:140-141`), rows being the real dimensions, "each with the candidate's actual value
  and a note where the grade is qualified" (`SPEC.md:142-144`).
- **Grading** (`SPEC.md:146`): *"covered/total >= 0.99 strong, >= 0.7 moderate, else weak. Fit is
  graded against the stored profile only - nothing has been written into an asset at this point, and
  the copy says so."*
- Acceptance (`SPEC.md:148-149`): a first-time user can read it as a comparison without
  documentation; **every "moderate" carries the reason it is not strong**.

Ground rules that constrain every criterion below: R1 correct-then-report (`SPEC.md:34-37`),
R2 evidence-or-escalate (`:39-41`), R3 the posting's figures never appear as the candidate's
(`:43-47`), R4 one source per number (`:49-51`), R5 every count deep-links (`:53-54`),
R6 ad-hoc correction (`:56-58`), R7 identifiers spelled out (`:60-62`). Copy rules: say what a number
counts; **"posting lines", "passes" and "distribution" are internal terms, not labels**
(`SPEC.md:363-369`).

Conflict register row **C7** (`.claude/QC-EVIDENCE-PLAN.md:253`) states the same thing as a decision
against P5.4: *"Comparison replaces counters; 'posting lines'/'passes' banned as JD-step labels."*

### 2.2 The prototype is a hardcoded fixture, and it grades two different populations

`docs/qc-evidence/qc/data.js:586-594` - `PROFILE_COMPARE` is an **eight-element literal** for one
worked example (SafetyIQ / Head of Engineering). Every `fit` value on it is **hand-typed**:

```js
{ l: 'Cycle time, regulated', req: 'M4', posting: 'Track record reducing delivery cycle time',
  yours: '40% faster on one programme, controls intact', fit: 'moderate',
  note: 'One programme, not a record across roles.' },
```

`data.js:602-617` - `matchRows()` is the only thing that **computes** a grade, and it grades the four
**fit cards**, not the table rows: `data.js:606` is
`const fit = (n, d) => d === 0 ? 'strong' : n / d >= 0.99 ? 'strong' : n / d >= 0.7 ? 'moderate' : 'weak'`.

`docs/qc-evidence/qc/packet.jsx:169-217` - `ProfileCompare` renders `matchRows()` as the cards
(`:170-186`) and maps `PROFILE_COMPARE` straight to the table (`:195-207`). `FIT_LABEL`
(`data.js:583`) is `{ strong: 'Strong match', moderate: 'Moderate match', weak: 'No evidence' }`.

**Three consequences a builder must not read past:**

1. **The `>= 0.99 / >= 0.7` rule in `SPEC.md:146` has no defined input for a dimension row.** A
   dimension is not a set of requirements with a covered count; it is one comparison. The ratio rule
   grades the CARDS. Applying it to a dimension row requires inventing a `covered/total` for that
   dimension - which is a fabricated composite (SS4 below).
2. **`fit(0, 0)` returns `'strong'`** (`data.js:606`). A class the posting produced zero rows for
   renders "0 of 0 * Strong match". That is absent evidence printed as a pass - the exact failure
   `CLAUDE.md` names ("Absent evidence is `not_applicable`, never `pass`") and the one `checks.ts`
   spends four separate branches preventing (`checks.ts:425-429`, `:505-514`, `:532-533`,
   `:602-618`). **This is a prototype bug. Do not port it.**
3. **`FIT_LABEL.weak === 'No evidence'`** conflates two different states: "nothing in the profile
   speaks to this dimension" and "the profile speaks to it and falls short". `PROFILE_COMPARE`'s only
   weak row happens to be the first kind (`'Nothing found in three passes'`), so the fixture hides
   the second. Printing "No evidence" over a real, measured shortfall is a false statement about the
   candidate.

### 2.3 What already exists in the product, and must be EXTENDED (not duplicated)

`CLAUDE.md`'s "Extend, don't duplicate" rule is load-bearing here: a comparison engine is exactly the
kind of thing that gets built twice.

| The comparison needs | It already exists as | Where |
|---|---|---|
| The posting side of a dimension | the requirement spine: `verbatim` at real offsets, `item_text` (model paraphrase), `kind`, `kind_source`, `match_method`, `weight` | `api/src/functions/tests/requirements.ts:51-65`, `schema.ts:294-332` |
| The profile side, as a quote | `requirement_evidence` rows: quote + `source_key` + `source_label` + offsets + `record_sha256` + `ratio` + `method` | `appRequirements.ts:27-49`, `evidence.ts:217-273`, `schema.ts:345-366` |
| Both together, in ONE read | `loadRequirementsWithEvidence()` - explicitly "The ONE place this join is written" | `appRequirements.ts:186-215` |
| The endpoint the JD step reads | `requirementsGet` -> `{ oppId, jdTextLen, jdTextTruncated, stale, located, total, evidenced, unevidenced, requirements[] }` | `appRequirements.ts:218-274` |
| Facts about the candidate (years, team size, budget) | `FACT_CATALOGUE` + `owner_fact` + `checkAgainstFacts()` | `ownerFacts.ts:30-66`, `:100-136`, `schema.ts:527-545` |
| Per-owner settings store | `owner_search_prefs` + `ensureCheckPrefs`/`loadThresholds` | `appChecks.ts:28-63` |
| Role / role-family resolution | `roleTaxonomy.FAMILIES` (10 families) + `SEED`; `roleFocus.decideRoleFocus` (AppConfig `templates/<rowKey>`, with a named source and a warning when it falls back) | `roleTaxonomy.ts:45-56`, `:100`; `roleFocus.ts:19-63` |
| The JD step as rendered today | `PostingAnalysisCard` + `AnalysisRunCard` | `app/src/screens/PostingAnalysis.jsx:236-407`, mounted at `PacketBuilder.jsx:517-536` |

Three gaps in that inventory decide several criteria below, and each was verified by reading:

- **`checkAgainstFacts` can only compare NUMBERS for years.** `ownerFacts.ts:116` computes
  `demanded` only when `def.unit === 'years'`. `scope.largest_team` (unit `people`) and
  `scope.largest_budget` (unit `usd`) therefore fall through to `ownerFacts.ts:133`, returning
  **`unknown`** with *"confirm this satisfies the requirement"*. **Org size and budget - two of the
  eight named dimensions - have no comparator today.**
- **The per-owner threshold store has no writer.** `owner_search_prefs.chk_*` columns exist
  (`appChecks.ts:28-42`) and are read (`:44-63`), but the only route that writes that table
  (`appSearchPrefs.ts:41-73`) sets `target_geo_ids`, `remote_only` and the three `temp_*` columns and
  **nothing else**; `grep -rn "chk_" app/src` returns nothing. So `chk_evidence_threshold` is
  changeable only by hand-written SQL. That is the "no hardcoded config" rule satisfied on paper and
  not in the product, and P8.4 must not repeat the shape.
- **`competency` is always null** (`requirements.ts:60`, "resolved by the term library (P1.2).
  Nothing here may fill it"), which is why the JD row prints `competency unassigned`
  (`PostingAnalysis.jsx:66`). R7 (`SPEC.md:60-62`) therefore forbids a bare requirement id anywhere
  in the comparison.

### 2.4 The JD step as it renders today - what the second bullet is actually asking for

`grep -rn "posting lines" app/src` returns **nothing**. `grep -rn "passes" app/src` returns three
hits, all on the QC rail (`qcRail.js:643`, `:661`, `screens/QcRail.jsx:332`) - step 6, not step 1.
**The strings P8.4 names as banned do not exist on the JD step.** So the second bullet cannot be
satisfied by deletion; it is satisfied by the comparison being present and being the answer the step
gives. What IS on the JD step, and what an implementer might delete by mistake:

- `PostingAnalysis.jsx:294-307` - the extraction-provenance strip:
  `"{req.total} lines extracted * {req.located} located in the posting text * {req.jdTextLen}
  characters of posting stored"`, plus the `posting truncated` and `the posting changed since these
  offsets were measured` pills. **P5.4 built this deliberately.** It is the only surface that says
  how much of the employer's text was located, and every number in it says what it counts (SS7 copy
  rule, `SPEC.md:363`). It is provenance, not a pipeline counter about fit.
- `PostingAnalysis.jsx:384-404` - the analysis run receipt: `"Ran at {at} - match estimate <n> - a
  model estimate, not a measured coverage score * {keywords} model-inferred keywords * {mustHaves}
  must-haves * read {sourceChars} characters of the real posting"`. This is a **run receipt**, and
  the wording that keeps the model estimate from reading as a measurement is load-bearing.
- `PostingAnalysis.jsx:251-255` - tab counts; `:105-124` + `postingAnalysis.js:135-161` - group counts
  carrying the `kind_source` split.

---

## 3. Definitions the acceptance sentence depends on (and does not supply)

**COMPARISON DIMENSION.** A named axis of comparison (`Leadership tenure`, `Budget owned`, ...) that
resolves, for one opportunity, to at most one persisted row carrying: what THIS posting asks on that
axis, what the candidate's stored profile evidences on it, and a grade. A dimension is **not** a
requirement, and a requirement is **not** a dimension: `requirement` rows are one-per-jd_table-line
(`schema.ts:294-332`), several of which may feed one dimension, and many of which feed none.

**ROLE FAMILY.** The unit the dimension set varies by. Two existing candidates, and the criteria do
not force a choice between them - only that the chosen one is named, stored, and owner-editable:
`roleTaxonomy.FAMILIES` (`roleTaxonomy.ts:45-56`: Software, Engineering, Product, Technology,
Digital, Data/Analytics & AI, Architecture, Delivery & Operations, Solutions & Automation,
Transformation & Strategy) as already used for title resolution, or the AppConfig `templates/<rowKey>`
row that already carries `roleFocus` per role type (`roleFocus.ts:70-84`). Inventing a third role
concept violates "Extend, don't duplicate".

**GRADED FIT.** One of a closed, stored enum. The criteria below require exactly:
`strong | moderate | weak | not_applicable`. `not_applicable` is a first-class member, not the
absence of a row - the same posture as `CheckState` (`checks.ts:28`).

**QUALIFIER NOTE / REASON.** The `note` on `PROFILE_COMPARE` rows ("One programme, not a record
across roles."). Its acceptance-grade definition is AC30-AC34 below. The backlog calls it "optional";
the **Acceptance** sentence makes it mandatory for every moderate and weak grade. Where those two
disagree, the Acceptance sentence wins - it is the thing being tested.

**TWO-SIDED.** Every graded row shows, at the same time and in the same row, a POSTING-derived value
and a PROFILE-derived value, each attributed to its own source. A row that shows only one side, or
that shows a model's prose about both, is not a comparison.

---

## 4. Acceptance criteria

Format: **Given** context, **when** action, **then** observable outcome. Each is binary.

### A. Where the dimension set lives (configurable per role family)

**P8.4-AC1.** Given the dimension set, when the source is inspected, then the eight seeded dimensions
exist in exactly ONE module as a seed (the shape of `FACT_CATALOGUE`, `ownerFacts.ts:30-66`, or
`DEFAULT_THRESHOLDS`, `checks.ts:65-79`), and no dimension label, threshold, or role-family mapping is
re-typed anywhere in `app/src/` or in a second `api/src/` module. A second literal list is a fail even
if the two currently agree.

**P8.4-AC2.** Given an owner who has never touched the settings, when the comparison is built for an
opportunity, then the seeded default set is used and the persisted rows record that the set came from
the seed (a `source` value, in the shape of `RoleFocusSource`, `roleFocus.ts:5-9`) - so a defaulted
configuration is visible in the data and not indistinguishable from a chosen one.

**P8.4-AC3.** Given the owner, when they change the dimension set for a role family, then the change
is made through a **route the deployed app can call**, and reading the set back through the API
returns what was written. A store that is only writable by hand-written SQL fails this criterion.
Precedent for the failure: `owner_search_prefs.chk_evidence_threshold` (`appChecks.ts:40`) is read by
production code and has no writer in any route (`appSearchPrefs.ts:57-67` writes five columns, none of
them `chk_*`) and no control in `app/src` (`grep -rn "chk_" app/src` is empty).

**P8.4-AC4.** Given the owner's edited dimension set for role family F, when a comparison is built for
an opportunity whose role resolves to F, then the persisted rows are the owner's set - not the seed -
and a dimension the owner removed produces **no row at all** (not a row graded weak, and not a hidden
row that still counts in a denominator).

**P8.4-AC5.** Given an opportunity whose role matches no configured family, when the comparison is
built, then the fallback set is used AND a warning naming the missed lookup is returned to the caller
and rendered, in the shape `decideRoleFocus` already uses (`roleFocus.ts:44-62`: "no roleFocus
configured for templates/<rowKey>; used the code seed ... - set openai.defaultRoleFocus in Auth &
Config"). A silent fallback fails, even though the output looks identical.

**P8.4-AC6.** Given the settings surface where the dimension set is edited, when the owner opens it,
then it is reachable from the existing Settings shell (`app/src/screens/Settings.jsx:1570` `SECTIONS`)
and states which role family is being edited. No new top-level settings concept parallel to
Settings > Roles / Facts (`Settings.jsx:1570`, `RolesTitles.jsx`) may be created for this.

### B. What a persisted dimension row carries - and what it must not

**P8.4-AC7.** Given a persisted comparison row, when it is selected from the database, then it carries
at least: `opp_id`; the dimension key and the version/source of the dimension set; the POSTING side
(a `requirement.id` reference, or an explicit "the posting does not ask this" marker) ; the PROFILE
side (a `requirement_evidence.id` reference, or an `owner_fact.key`, or an explicit "no profile value"
marker); `grade`; `note`; how the grade was derived; and a resolver/extractor version, in the shape
`RequirementRow.extractor_version` (`requirements.ts:47`, `:64`) and
`EvidenceRow.resolver_version` (`evidence.ts:35`, `:70`) already use.

**P8.4-AC8.** Given a persisted row, when its POSTING side is read, then it references a stored
`requirement` row and does **not** contain a re-typed copy of the posting's text. If a displayed
posting string is denormalised onto the row for rendering, it is byte-identical to
`requirement.verbatim` (or to `requirement.item_text` when unlocated) and the row records which of
those two it is - `verbatim` is the employer's words, `item_text` is the model's paraphrase, and
`requirements.ts:52-53` is explicit that the second is "Never presented as a quote."

**P8.4-AC9.** Given a persisted row whose PROFILE side came from the evidence store, when the stored
profile value is compared to the record it names, then it is a literal substring of that record at the
recorded offsets - the same assertion `writeEvidence` makes before storing (`appRequirements.ts:114-115`)
and `resolveEvidence` makes before returning (`evidence.ts:241`). A profile value that is a model's
summary of the profile is a fail, however accurate.

**P8.4-AC10.** Given a persisted row, when the PROFILE side is read, then it contains no figure that
came from the posting (R3, `SPEC.md:43-47`). A row whose "Your profile evidences" cell repeats the
employer's `$18M` / `60+` is the exact defect R3 exists to prevent, moved to a new surface.

**P8.4-AC11.** Given the comparison writer, when its SQL is inspected, then it never writes
`requirement.coverage`. That column already means "the quote could not be located in the POSTING"
(`requirements.ts:61`, `:410`) and `appRequirements.ts:70-77` states in as many words that merging a
second population into it makes both unreadable.

**P8.4-AC12.** Given the new store, when `schema.ts` is read, then the table is declared in
`SCHEMA_SQL` and its name is added to `EXPECTED_TABLES` (`schema.ts:616-622`) **and** to the table
list inside `H11` (`api/test/hardening.test.mjs:233-243`) - which is hand-maintained, so a table added
to the schema but not to that array is unguarded while looking guarded.

**P8.4-AC13.** Given a dimension row, when it is written, then it carries no model-generated prose in
any field a reader would take as measurement. Anything a model wrote is either absent or labelled at
the point of render, in the shape `postingBody()` already enforces (`app/src/postingAnalysis.js:227-261`,
badge `model-written`).

### C. The grading rule and its exact boundaries

**P8.4-AC14.** Given the four fit cards (Responsibilities / Must-have / Nice-to-have / ATS keywords),
when the grade is computed from `covered/total`, then the boundaries are exactly:
`ratio >= 0.99` -> `strong`; `0.7 <= ratio < 0.99` -> `moderate`; `ratio < 0.7` -> `weak`
(`SPEC.md:146`). Pinned cases, each of which must be asserted: `1.0 -> strong`; `0.99 -> strong`
(inclusive); `0.98999 -> moderate`; `0.7 -> moderate` (inclusive); `0.69999 -> weak`; `0.0 -> weak`.

**P8.4-AC15.** Given a card whose class produced **zero rows** (`total === 0`), when the grade is
computed, then it is `not_applicable` and the card says so - **never `strong`**. The prototype returns
`'strong'` for `d === 0` (`data.js:606`); porting that line is a fail. This is the same rule as
`checks.ts:532-533` (`na('must_have_coverage', 'the posting produced no must-have requirements to
judge', ...)`) and `qcRail.js` (a kind with zero rows returns a card labelled "none extracted", not a
score).

**P8.4-AC16.** Given a dimension ROW (not a card), when it is graded, then the grade is derived by a
rule that is stated in code and recorded on the row, and that rule is **not** the `covered/total`
ratio unless the dimension genuinely has a covered count over a stated denominator. Inventing a ratio
for a single dimension in order to reuse `SPEC.md:146` is a fabricated composite (AC26).

**P8.4-AC17.** Given a dimension whose posting side states a comparable NUMBER and whose profile side
holds a comparable number (`owner_fact.value_num`), when the dimension is graded, then the grade is
derived from the arithmetic and the row records both numbers - the shape `checkAgainstFacts` already
produces for years (`ownerFacts.ts:116-121`, detail `"${fact.value_num} years recorded, ${demanded}
required"`).

**P8.4-AC18.** Given the `Organization size` and `Budget owned` dimensions, when they are graded, then
either (a) a numeric comparator for `unit: 'people'` and `unit: 'usd'` has been added to the
**existing** fact matcher and the grade is derived from it, or (b) the grade is `not_applicable` with
a reason naming the missing comparator. **A grade of `weak`, `moderate` or `strong` produced without a
comparator is a fail**: today `checkAgainstFacts` returns `unknown` for both
(`ownerFacts.ts:116` gates the numeric branch on `def.unit === 'years'`; `:133` is the fall-through).

**P8.4-AC19.** Given an owner fact that exists but is **unconfirmed** (`confirmed_at is null`), when a
dimension resting on it is graded, then the grade is `not_applicable`, never `satisfied`-equivalent
and never `weak`. `ownerFacts.ts:92-99` states the rule: "an unconfirmed fact is a guess the system
made about the owner, and a guess must not settle a gate".

**P8.4-AC20.** Given a dimension graded from evidence rows, when the evidence threshold is read, then
it is the **same** value the coverage numerator uses (`EVIDENCE_THRESHOLD`, `evidence.ts:187`, carried
per owner as `chk_evidence_threshold`, `appChecks.ts:40`, `:60`) - not a second constant. Two
thresholds for "does the profile support this" is two answers to one question.

### D. The `not_applicable` cases - every state that must NOT be graded weak

**P8.4-AC21.** Given each state below, when the comparison is built, then that dimension's grade is
`not_applicable` with a reason naming the state, and it is excluded from every numerator and
denominator that the comparison prints. **None of these may render as `weak`, and none may render as
`strong` or `moderate` either.**

| # | State | How it is detected today |
|---|---|---|
| a | The posting is silent on the dimension - no requirement matched it | no `requirement` row satisfies the dimension's matcher |
| b | The stored profile could not be read at all | `EvidenceInput.profileReadable === false` (`evidence.ts:310-318`); the endpoint already refuses to write on this (`appRequirements.ts:344-353`) |
| c | The opportunity has no requirement rows | `requirementsGet` returns `total: 0` (`appRequirements.ts:261`); `checks.ts:425-429` returns three `na` rows for it |
| d | No employer text is stored, so no posting side can be quoted | `match_method === 'no_posting'` (`requirements.ts:388`), `jdTextLen === 0` |
| e | The posting line could not be located, so the "posting asks for" is a model paraphrase | `match_method` in `unlocatable` / `beyond_model_window` (`requirements.ts:24-29`) |
| f | The matched requirement is too short to judge | fewer than `MIN_JUDGEABLE_TOKENS` content words (`evidence.ts:189`, `:229`; `checks.ts:154`) |
| g | The dimension rests on a fact that is missing or unconfirmed | `checkAgainstFacts -> 'unknown'` (`ownerFacts.ts:108-113`) |
| h | The dimension rests on a fact with no comparator for its unit | `ownerFacts.ts:116` / `:133` (see AC18) |
| i | The stored offsets no longer match the posting | `requirementsGet`'s `stale` flag (`appRequirements.ts:230-232`) |

**P8.4-AC22.** Given `stale === true` for an opportunity, when the comparison renders, then no grade
derived from posting offsets is presented as measured; the surface says the posting changed since the
offsets were measured, reusing the existing pill (`PostingAnalysis.jsx:304`). Serving grades over
offsets known to be stale is a measurement nobody made.

**P8.4-AC23.** Given a readable profile that genuinely does not support a dimension the posting DOES
ask for, when the dimension is graded, then the grade is `weak` (a determinate finding), **not**
`not_applicable`. This is the mirror of AC21 and it is the half that gets lost: filing a real gap as
`not_applicable` drops it from the denominator and the comparison reads complete. Same rule as
`checks.ts:505-514` vs `:534-536`, and the same distinction H30 guards
(`api/test/hardening.test.mjs:838-880`).

**P8.4-AC24.** Given a `not_applicable` dimension, when the row renders, then the reason is shown in
the row - not only in a payload field. "Not measured" with no reason is indistinguishable on screen
from "measured and fine", which is the defect `qcRail.js:498-516` records having shipped once
(`"3 of 4 closed" - 75%, from three rows nothing measured`).

**P8.4-AC25.** Given any dimension whose grade is `not_applicable`, when any count over dimensions is
printed anywhere, then that dimension is counted **by name in an exclusion note**, never absorbed -
the shape `checks.ts:526-531` uses (`" (3 not reachable by any generated field, not counted either
way)"`) and `qcRail.js:566-577` mirrors (`unjudgedSeqs`, `classTotal`).

### E. Never fabricate a composite

**P8.4-AC26.** Given a dimension with no derivable posting side or no derivable profile side, when the
row is written, then the grade is `not_applicable` and any numeric fit value on the row is **null**.
No partial score, no default of 0, no "we assumed the middle".

**P8.4-AC27.** Given an overall comparison summary (if one is built at all), when any dimension is
`not_applicable`, then the summary is either **null** or explicitly scoped to the graded population
with the excluded dimensions named. `CLAUDE.md`: "If a component of a score has no source, the score
is null - a partial composite is the number a reviewer trusts most and the one most likely to be
wrong."

**P8.4-AC28.** Given the comparison, when it is persisted, then it does not write
`artifact_score.keyword_coverage` or `artifact_score.seniority_alignment`, and does not cause
`artifact_score.composite` to become non-null when a component is missing. The DB CHECK at
`schema.ts:508` enforces the last part; the criterion is that P8.4 does not route around it.

**P8.4-AC29.** Given the four fit cards, when a card's `total` is zero, then the card prints
`not applicable` / `none extracted` and **no percentage or verdict is derived** (this is AC15 stated
as a render obligation, and it is the one a screenshot can falsify).

### F. "Every moderate/weak grade carries the reason"

**P8.4-AC30.** Given any persisted row with `grade in ('moderate','weak')`, when the row is read, then
`note` is non-null and non-empty after trimming. **This must be a database CHECK constraint**, in the
shape `owner_fact`'s already is (`schema.ts:541-542`: "A confirmed fact must have a value; confirming
an empty field asserts nothing") - `check (grade not in ('moderate','weak') or note is not null)`. A
constraint cannot be defeated by a rename or by a second writer.

**P8.4-AC31.** Given a `moderate` or `weak` note, when it is inspected, then it names the **specific
shortfall in terms of the two sides** - what the posting asked and what the profile has - and is not
any of: a restatement of the grade ("Moderate match"), the dimension label, a verbatim copy of the
posting cell, a verbatim copy of the profile cell, or a fixed string used for every row of that grade.
A reviewer proves this mechanically: assert `note !== label`, `note !== gradeLabel`,
`note !== postingCell`, `note !== profileCell`, and that the set of distinct notes across a fixture
with three differing shortfalls has size 3.

**P8.4-AC32.** Given a `weak` grade on a dimension where evidence WAS found but falls short, when the
row renders, then it does not read "No evidence" and does not carry `NO_EVIDENCE_NOTE`
(`evidence.ts:282`, "no evidence found in your profile"). The prototype's `FIT_LABEL.weak` is
`'No evidence'` (`data.js:583`) and its single weak fixture row happens to be a true absence, so the
fixture cannot expose this. Two labels are needed: nothing found, and found-and-short.

**P8.4-AC33.** Given a note, when it is generated, then it is **derived from stored values**, not
free-form model prose - the shape `evidence.ts:265` uses
(`extra: 'the excerpt does not mention: <tokens>'`) and `ownerFacts.ts:119-120` uses
(`'<n> years recorded, <m> required'`). If a model writes any part of a note, the row records that and
the render labels it, per AC13.

**P8.4-AC34.** Given the full set of persisted rows for an opportunity, when a reviewer runs one
query, then they can prove the acceptance sentence for that opportunity:
`select count(*) from <table> where grade in ('moderate','weak') and (note is null or btrim(note) = '')`
returns **0**. The criterion is that this query is possible - i.e. grade and note are columns on one
row, not values assembled at render time. A comparison assembled only in the frontend cannot be
audited and fails this.

### G. The UI half: what "shows the comparison, not pipeline counters" means concretely

**P8.4-AC35.** Given the JD step at `#/packet/<id>/jd` (`PacketBuilder.jsx:463-540`), when it renders
for an opportunity with requirements and evidence, then a comparison surface is present carrying all
four column headings verbatim: `Dimension`, `The posting asks for`, `Your profile evidences`, `Fit`
(`SPEC.md:140-141`, `packet.jsx:192-193`).

**P8.4-AC36.** Given that surface, when a dimension row renders, then the posting cell and the profile
cell are **both populated from stored data and visually distinct**, and the profile cell names its
source (the `source_label` shape: `Work history * VP Engineering, Resideo 2021-2025`,
`evidence.ts:164-166`) or the owner fact's label (`ownerFacts.ts:31-65`). A row showing one side, or
showing a sentence about both, fails.

**P8.4-AC37.** Given the comparison surface, when it renders, then it carries the SS4.2 scoping
sentence - fit is graded against the stored profile only, nothing has been written into an asset yet
(`SPEC.md:145-146`, rendered at `packet.jsx:213`). Without it, a strong grade reads as a claim about
the packet.

**P8.4-AC38.** Given the JD step after P8.4, when the page text is captured, then the
extraction-provenance strip is **still present and unchanged in content**: "lines extracted",
"located in the posting text", "characters of posting stored", plus the truncated and stale pills
(`PostingAnalysis.jsx:294-307`). P5.4 built it deliberately; it is the only surface reporting how much
of the employer's text was located, and deleting it to satisfy "not pipeline counters" removes
provenance and satisfies nothing (see SS2.4 - the banned strings are not on this step at all).

**P8.4-AC39.** Given the JD step after P8.4, when the page text is captured, then the analysis run
receipt (`PostingAnalysis.jsx:384-404`) is still present, including the qualifier "a model estimate,
not a measured coverage score" (`:393`). The comparison must not be positioned so that the model
estimate reads as its outcome.

**P8.4-AC40.** Given the JD step after P8.4, when the page text is captured, then the strings
`posting lines` and `passes` do not appear anywhere on it (`SPEC.md:368`, C7 at
`QC-EVIDENCE-PLAN.md:253`). Note this is currently true and must **stay** true - the criterion is a
regression guard, not a change.

**P8.4-AC41.** Given a dimension row that references a requirement, when it renders, then no bare
requirement identifier appears without its kind and competency (R7, `SPEC.md:60-62`). Since
`competency` is null for every row today (`requirements.ts:60`), the row must either omit the id or
render it the way `PostingAnalysis.jsx:62-67` does (kind abbreviation + `#seq` + `competency
unassigned`).

**P8.4-AC42.** Given any count printed on the comparison surface, when it is clicked, then it opens
the rows it counts (R5, `SPEC.md:53-54`). A count with no target is a dead end and fails R5. If a
deep-link target does not exist for a given count, that count is not printed.

**P8.4-AC43.** Given every new `data-qc` selector on the comparison surface, when the component source
is scanned, then each is declared in a hooks constant (`POSTING_HOOKS`, `postingAnalysis.js:26-49`, or
a new `*_HOOKS` added to the cross-screen union), none is hand-typed, and no value collides with
`QC_HOOKS` / `GATE_HOOKS` / `BLOCK_HOOKS` / `PACKET_HOOKS` / `POSTING_HOOKS`. Both guards already
exist and will catch it only if the constant is used: `app/test/postingAnalysis.test.mjs:353-366`
(declared-and-rendered, no hand-typed hooks) and `app/test/assetGate.test.mjs:326-341` (cross-screen
collision).

**P8.4-AC44.** Given a narrow viewport, when the comparison renders, then it degrades to one column
per row rather than a horizontally scrolling table (`SPEC.md:88-95` responsive rules;
`packet.jsx:171` uses `useWide(900)`), and the column count is derived from an exported rule rather
than a CSS media query, so `ui-verify` can select it - the precedent, and the reasoning, are at
`postingAnalysis.js:196-213` and `app/test/postingAnalysis.test.mjs:368-380`.

**P8.4-AC45.** Given an opportunity with no requirements or an unreadable profile, when the JD step
renders, then the comparison surface is present and says which state it is in - it does not vanish,
and it does not render eight weak rows. A surface that disappears when there is nothing to say makes
the step look complete (`qcRail.js:441-445` records exactly this reasoning for coverage cards).

### H. Consumer reconciliation - the numbers that must agree

Every surface that today prints a count over the same population, all verified by reading:

| # | Surface | Number | File |
|---|---|---|---|
| 1 | requirements endpoint | `total`, `located`, `evidenced`, `unevidenced` | `appRequirements.ts:260-267` |
| 2 | JD extraction strip | `req.total`, `req.located`, `req.jdTextLen` | `PostingAnalysis.jsx:298-302` |
| 3 | JD tabs | responsibilities / requirements / model-keyword counts | `PostingAnalysis.jsx:251-255` |
| 4 | JD group headers | per-kind totals + `kind_source` split | `PostingAnalysis.jsx:111-116`, `postingAnalysis.js:135-161` |
| 5 | checks engine | `must_have_coverage` observed `"<n>/<coverable> must-haves evidenced<tail>"` | `checks.ts:534-537` |
| 6 | checks engine | `responsibilities_addressed` `"<n>/<resp> responsibilities evidenced"` | `checks.ts:540-545` |
| 7 | score card | "Must-haves evidenced" | `assetGate.js:91`, `:240` |
| 8 | QC rail coverage cards | `closed of judged` + `classTotal` + unjudged | `qcRail.js:530-577` |
| 9 | gate drawer | `must-haves <n>` | `screens/AssetGateDrawer.jsx:331` |
| 10 | run receipt | `result.mustHaves` | `PostingAnalysis.jsx:396` |
| 11 | reviewer re-aggregation | `must_have_coverage` read back from `artifact_score` | `appReviewer.ts:175-183` |

**P8.4-AC46.** Given the comparison's must-have fit card and the `must_have_coverage` check for the
same opportunity and run, when both are rendered, then either their numerator AND denominator are
equal, or the card's label states its different population and names the excluded rows by count. The
judged population is `coverable` - must-haves minus eligibility rows minus fact-owned rows
(`checks.ts:474-475`) - while the prototype's card counts every row of the kind
(`data.js:603-613`). Shipping the prototype's denominator beside the check's is a guaranteed
disagreement, and it is the same arithmetic H28 removed from the server
(`hardening.test.mjs:751-800`) and `qcRail.js:498-516` removed from the screen (measured: "3 of 4
closed" - 75% - beside a check saying 0/1).

**P8.4-AC47.** Given the comparison's evidenced count over requirements, when it is compared to
`requirementsGet`'s `evidenced` (`appRequirements.ts:256`, `:265`), then the two are equal. Both must
be derived from the presence of an evidence row and from nothing else - `appRequirements.ts:234-236`
is explicit: "a row is evidenced when it HAS an excerpt, and there is no other way to be".

**P8.4-AC48.** Given the comparison, when its inputs are traced, then every requirement-derived number
comes from `loadRequirementsWithEvidence` (`appRequirements.ts:186-215`) and every fact-derived number
from `owner_fact` via `checkAgainstFacts` (`ownerFacts.ts:100-136`). A second query answering "is this
requirement evidenced" is a second answer, which R4 (`SPEC.md:49-51`) forbids and which that function's
own docstring forbids by name.

**P8.4-AC49.** Given a dimension whose requirement is also reported by `fact_shortfall` or
`facts_settled` (`checks.ts:451-462`), when both surfaces render, then they do not contradict: a
requirement the facts SETTLED may not appear as a weak dimension, and a requirement the facts fall
short of may not appear as strong.

**P8.4-AC50.** Given the comparison and the ATS keyword card, when the keyword card renders, then it
reads its state from `keywordLibraryState()` (`postingAnalysis.js:166-194`) and prints no coverage
number while the library is unpublished. The prototype's fourth card is `n of m` over
`libTerms()` (`data.js:613`), which does not exist in the product; inventing one here would
re-open D14 (`.claude/DEFERRED.md:48`, "covered_kw does not mean covered").

**P8.4-AC51.** Given every count the comparison prints, when it is read, then its label says what it
counts (`SPEC.md:363`) and fixes/reviews are never merged into one number (R4, `SPEC.md:49-51`).

### I. Determinism and re-run

**P8.4-AC52.** Given identical inputs (same requirement rows, same evidence rows, same facts, same
dimension configuration), when the comparison is built twice, then the persisted rows are identical,
including grades, notes and ordering. Every engine in this layer holds this property and says so
(`requirements.ts:19`, `evidence.ts:27`, `appRequirements.ts:277`); a model call inside the grader
breaks it and makes every criterion above unfalsifiable.

**P8.4-AC53.** Given an opportunity that already has comparison rows, when the comparison is rebuilt,
then the previous rows are **replaced, not appended** - the shape `writeRequirements`
(`appRequirements.ts:147-167`) and `writeEvidence` (`:96-99`) both use, in one transaction, so a
failure mid-write cannot leave a half-comparison.

**P8.4-AC54.** Given a re-extraction that deletes and rewrites `requirement` rows
(`appRequirements.ts:153`), when it completes, then the comparison rows for that opportunity are
rebuilt in the same call or are deleted. Leaving them behind serves grades keyed to requirement rows
that no longer exist - the same trap `requirementsBackfill` documents for evidence
(`appRequirements.ts:298-302`).

**P8.4-AC55.** Given a mistake found while building P8.4, when it is fixed, then the fix commit adds
an H-case to `api/test/hardening.test.mjs` asserting the invariant (not the incident), numbered
contiguously from the current maximum - **H34 at `c360e6e`** (H1-H33, plus lettered sub-cases H4b,
H5b, H5c). Numbers are claimed at merge time, never reserved (`.claude/DEFERRED.md:44`, D10: "PRE-
ALLOCATION HAS NOW FAILED THREE TIMES"), and `H26` (`hardening.test.mjs:726-748`) fails on both
duplicates and gaps.

---

## 5. What a guard for each criterion must exercise

The house rule (`CLAUDE.md`, hardening): prefer a test that exercises behaviour; use a source grep
only for structural rules a runtime test cannot express. **A source-regex guard is weak wherever a
rename or a reworded string defeats it, and that is called out per row below.**

| Criteria | Guard that a rename cannot defeat | Why the obvious guard is weak |
|---|---|---|
| AC1, AC12 | import the seed module in the test and assert the dimension list is derived from it; for the table, H11's structural grep is the correct tool (it IS a structural rule) | grepping `app/src` for the eight labels misses a re-typed list that reworded one label |
| AC2-AC6 | a round-trip test: POST a changed set through the route handler, GET it back, assert the built comparison uses it. For "no writer exists", assert the route's own body-key list, in the shape of H33 (`hardening.test.mjs:971-1050`, "every server-side body toggle has a caller that can send it") | asserting the column exists proves storage, not configurability - exactly how `chk_evidence_threshold` passed review |
| AC7-AC11, AC13 | build a row from a fixture and assert field-by-field; for AC9, assert `record.text.slice(start,end) === quote` on a record deliberately edited after resolution | a grep for `insert into` proves nothing about the values |
| AC14 | call the exported grading function at `1.0, 0.99, 0.98999, 0.7, 0.69999, 0.0` | asserting the rendered word "Strong" tests the label map, not the boundary |
| AC15, AC29 | call the grader with `total = 0` and assert the result is not `strong`; plus a `ui-verify` run on an opportunity with an empty class asserting the card text | reading the source for `d === 0` breaks the day the expression is refactored |
| AC16-AC20 | table-driven: one fixture per derivation path, asserting grade AND the recorded derivation. For AC18, assert `checkAgainstFacts('budget of $10M+', [<$2M fact>])` does not return a satisfied/not_satisfied verdict unless a comparator was added | a screenshot cannot distinguish a derived grade from a guessed one |
| AC21 (a-i) | nine fixtures, one per state, each asserting `not_applicable` and a non-empty reason. This is the single highest-value test in the set | any grep; these are runtime states |
| AC22 | fixture with `stale: true` -> assert no grade renders as measured | - |
| AC23 | fixture: readable profile, requirement present, no evidence row -> assert `weak`, and assert the row is still in the denominator | this is the inverse of AC21 and a guard for one direction only will pass while the other direction is broken |
| AC24, AC25 | assert the rendered row text contains the reason; assert the exclusion note names the count | - |
| AC26-AC28 | assert `null` (not `0`) on a fixture missing one side; assert `artifact_score` untouched by running the comparison writer and diffing the row | the DB CHECK at `schema.ts:508` catches only the composite, not the two components |
| AC30 | the **DB CHECK constraint** is the guard; a migration test that inserts a moderate row with a null note and asserts the insert fails | a unit test on the builder is bypassed by any second writer |
| AC31-AC33 | a fixture with three different shortfalls -> assert three distinct notes, and assert each note differs from label / grade label / both cells | asserting `note.length > 0` is defeated by `"-"` |
| AC34 | run the query in the test against the fixture-built rows | - |
| AC35-AC42, AC45 | `ui-verify.yml` (D3 has landed: `EXPECT`, `EXPECT_ABSENT`, `CLICK_SEL`, `COUNT_SEL`/min/max, `VIEWPORT_W/H`, `MEASURE_SEL` - `scripts/ui-verify.mjs:11-19`). AC38/AC39/AC40 are `EXPECT` + `EXPECT_ABSENT` runs; AC42 is `CLICK_SEL` then `EXPECT` | a jsdom-free unit test cannot prove the live SPA rendered it; conversely `EXPECT` on prose is defeated by a copy edit, so anchor on `data-qc` selectors and counts wherever possible |
| AC43 | the two existing tests (`postingAnalysis.test.mjs:353-366`, `assetGate.test.mjs:326-341`) already do this **iff** the new hooks are in a constant that the union imports - so the guard is: add the constant to the union | a grep for `data-qc=` in the new file, alone, misses the collision half |
| AC44 | assert the exported column rule at the breakpoint and one pixel either side, plus a `VIEWPORT_W` `ui-verify` run reading `data-qc-cols` | a CSS media query is invisible to `ui-verify` - stated at `postingAnalysis.js:196-206` |
| AC46-AC51 | ONE fixture, both numbers computed in the same test, asserted equal - the only shape that catches divergence. Where populations differ deliberately, assert the label text names the difference | two separate tests each asserting its own number will both pass while the screens disagree |
| AC52-AC54 | build twice, deep-equal; then mutate a requirement row and assert rebuild/deletion | - |
| AC55 | `H26` already enforces it (`hardening.test.mjs:726-748`) | - |

---

## 6. The criteria most likely to be quietly skipped, and the cheapest test for each

Ordered by (likelihood x damage). "Cheapest test" means the smallest thing a reviewer can run that
turns a silent skip into a red line.

1. **AC15 - `fit(0,0)` graded `strong`.** The prototype line ports in one copy-paste and the fixture
   never has an empty class. Damage: a card reading "0 of 0 * Strong match".
   *Cheapest test:* `assert.notEqual(grade(0, 0), 'strong')`.
2. **AC18 - budget and org size graded without a comparator.** Two of the eight named dimensions have
   no numeric comparison in the product today; the easy path is to eyeball `$18M` vs `$10M+` in a
   model call or a regex and call it strong. Damage: an accusation-grade number derived from nothing.
   *Cheapest test:* one fixture, `$2M` fact against a `$10M+` posting line; assert the dimension is
   `not_applicable` unless the comparator exists, and that it is never `strong`.
3. **AC46 - two denominators for must-haves.** The card counts all must-haves; the check counts
   `coverable`. Both look right in isolation. Damage: the JD step and the QC rail print different
   coverage for one packet - the exact bug `qcRail.js:498-516` records shipping once.
   *Cheapest test:* one fixture with one eligibility must-have; compute both; assert equal or assert
   the label differs.
4. **AC30/AC34 - the reason enforced only in the builder.** A CHECK constraint is more work than an
   `if`, so the `if` ships. Damage: the acceptance sentence becomes unauditable the first time a
   second writer appears.
   *Cheapest test:* insert a `moderate` row with `note = null` in the migration test and assert the
   insert throws.
5. **AC3 - configuration with no writer.** The precedent is live in this repo
   (`chk_evidence_threshold`), so the pattern reads as accepted. Damage: "configurable per role
   family" becomes SQL-only, i.e. a black box, violating `CLAUDE.md`'s no-hardcoded-config rule.
   *Cheapest test:* POST the route handler with a changed set, GET it back, assert equality.
6. **AC32 - "No evidence" printed over a measured shortfall.** `FIT_LABEL` maps `weak` to
   `'No evidence'` and it is one word to copy. Damage: a false statement about the candidate on the
   screen the whole feature exists to produce.
   *Cheapest test:* fixture where the profile evidences 0.5 of the requirement; assert the rendered
   label is not "No evidence" and the note is not `NO_EVIDENCE_NOTE`.
7. **AC38 - the extraction strip deleted to satisfy "not pipeline counters".** The bullet reads like
   a deletion instruction and the strip is the nearest thing to a counter on that step. Damage: P5.4's
   provenance is destroyed and the banned strings were never there.
   *Cheapest test:* a `ui-verify` run with `EXPECT="lines extracted;located in the posting text"`.
8. **AC21(b,c) - `not_applicable` collapsed into weak.** Rendering eight weak rows for an opportunity
   with no requirements is visually plausible and completely wrong. Damage: the comparison accuses the
   candidate of failing a posting nobody parsed.
   *Cheapest test:* build the comparison with `requirements: []` and assert no row is graded.
9. **AC23 - real gaps filed as `not_applicable`.** The over-correction of #8, and it makes the
   comparison read complete. Damage: a 100%-looking comparison over an unsupported posting.
   *Cheapest test:* readable profile, no evidence row, requirement present -> assert `weak` and assert
   it stayed in the denominator.
10. **AC52 - a model call inside the grader.** A "qualifier note" is the most tempting place in this
    whole layer to call a model. Damage: every criterion above becomes unfalsifiable, and re-running
    changes the grades.
    *Cheapest test:* build twice from one fixture, `assert.deepEqual`.
11. **AC43 - hand-typed `data-qc` selectors.** The two existing guards only see hooks that are in a
    constant, so a new hand-typed surface is invisible to them.
    *Cheapest test:* the existing `postingAnalysis.test.mjs:353-366` assertion, extended to the new
    component's source.
12. **AC12 - table in `SCHEMA_SQL` but not in `EXPECTED_TABLES` or in H11's array.** H11's list is
    hand-maintained, so the guard looks green while not covering the new table.
    *Cheapest test:* add the table name to the array in `hardening.test.mjs:235-237`.

---

## 7. `.claude/DEFERRED.md` - what P8.4 may close and what it must not pretend to close

**May be closed by P8.4, if and only if the work is actually done:**

- **D14** (`DEFERRED.md:48`) - *"`covered_kw` does not mean covered."* P8.4 owns the ATS-keywords fit
  card. If the card is built on `keywordLibraryState()` (`postingAnalysis.js:166-194`) and refuses to
  print a coverage number while the library is unpublished, and the green "N covered" chips stop
  reading as a coverage measurement, D14 closes. **If the card prints `n of m` over `covered_kw`, P8.4
  makes D14 worse and must say so** (see AC50).

**Must NOT be claimed closed by P8.4:**

- **D16** (`DEFERRED.md:50`) - `appReviewer.ts:183` still maps every `kind === 'must_have'` row while
  the check judges only `coverable`. This is the server-side twin of AC46. P8.4 touching the same
  numbers on the JD step does **not** fix `appReviewer`; if P8.4 leaves it, the row stays open and
  AC46 must state which population the JD card uses.
- **D19** (`DEFERRED.md:59`) - stored evidence is never re-validated on read; `record_sha256` is
  written and served but never recomputed. The comparison's profile column will serve those same
  quotes, so **P8.4 inherits D19 and must not present a profile value as freshly verified.** If AC9 is
  implemented as a read-time re-check, D19 closes; a build-time-only check leaves it open.
- **D1-D6** (R3 figure rewrite, `DEFERRED.md:24-29`) - the rewrite half of R3 does not exist. AC10
  requires only that the comparison never puts the posting's figures in the profile column; it does
  not require the rewrite, and P8.4 may not be reported as closing any D1-D6 row.
- **D10** (`DEFERRED.md:44`) - H-case numbering. P8.4 adds to this hazard rather than resolving it; see
  AC55.

**New rows P8.4 must ADD to `DEFERRED.md` if it ships without them** (per that file's rule 2 -
"Adding a row is part of the commit that defers the work"): any dimension shipped without a
comparator (AC18); the dimension set shipped without a writable route (AC3); the comparison shipped
without deep-links (AC42).

---

## 8. Harness notes - what is and is not verifiable today

- **Verifiable.** `scripts/ui-verify.mjs` now supports `EXPECT`, `EXPECT_ABSENT`, `CLICK_SEL` /
  `CLICK_WAIT`, `COUNT_SEL` with min/max, `MEASURE_SEL`, and `VIEWPORT_W/H`
  (`scripts/ui-verify.mjs:11-19`; workflow inputs at `.github/workflows/ui-verify.yml:9-40`). The
  harness gap recorded at `.claude/QC-EVIDENCE-PLAN.md:154-157` - which named **P8.4-AC5** as blocked -
  has been closed by D3. Every UI criterion in section G is therefore signable **on the live app**,
  and none may be signed on a local build alone.
- **Not verifiable from this sandbox.** The Function App and the SPA are unreachable here
  (`CLAUDE.md`, "Live Database Access"); AC46-AC51 must be reconciled on the deployed app via
  `api-test.yml` / `db-query.yml` / `ui-verify.yml`, not asserted from a local run.
- **INFERENCE, flagged as such.** I have not run the live JD step for a real opportunity, so I cannot
  state what the comparison surface currently looks like in production - only what the source at
  `c360e6e` renders. This would be confirmed by a `ui-verify.yml` run against
  `#/packet/<id>/jd` for a real owner.

---

## 9. Count

**55 acceptance criteria** (P8.4-AC1 - P8.4-AC55), across nine groups: configuration (6),
persistence (7), grading (7), `not_applicable` (5), no-fabricated-composite (4), reasons (5), UI
(11), consumer reconciliation (6), determinism (4). Twelve are called out in section 6 as the ones
most likely to be quietly skipped, each with the cheapest test that catches it.
