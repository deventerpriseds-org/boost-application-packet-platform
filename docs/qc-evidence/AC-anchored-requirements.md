# AC — "anchored from the very beginning": no requirement may exist without a located proof quote

**Status: acceptance criteria only. NOTHING IS IMPLEMENTED. Do not read any line below as a
description of current behaviour unless it is in the "Ground truth" section and cites a file:line.**

Written by an independent adversarial reviewer, before any code. Every AC cites the file:line it
constrains. Tier 1 by `CLAUDE.md` § "Match the process to the risk": this change moves the
`must_have_coverage` denominator, which decides the artifact gate and the composite score.

---

## 0. The owner's directive, verbatim

> "you can't bury unlocatable you have to make it impossible systematically. it must be in the
> posting from the very very beginning, I don't know the impact but likely seperate so they can
> have there proof quote attached"

---

## 1. My reading of it — and the one place the code says the brief is wrong

The brief handed to me reads the directive as three claims. Two survive contact with the code. One
does not, and it is the most important one.

### 1.1 SURVIVES — "excluding unlocatable rows from the denominator is burying it"

Confirmed against the code, and worth stating precisely because it is *not* what the code does
today. `checks.ts:607`:

```ts
const coverable = mustHaves.filter(r => !eligibility.includes(r) && !resolvedByFact.has(r.seq) && !ownedByFacts.has(r.seq))
```

There is **no `match_method` filter here**. An `unlocatable` must-have is in `coverable` right now,
is judged by `ruleEvidenceOf` (`checks.ts:677`), and lands in the `unevidenced` offender list
(`checks.ts:697`). So "burying" is a change someone was *about to make* — adding
`&& r.match_method !== 'unlocatable'` to line 607 — not a defect already in the tree. The owner
vetoed it before it was written. **Observation**, from reading `checks.ts:598-741`.

### 1.2 SURVIVES — "split a compound into separate requirements, each with its own proof quote"

Consistent with the eMoney evidence. seq 30 is `"Experience in managing cloud-based applications
and APIs."` and the posting contains both "cloud" and "API" (measured, per the brief), but no
contiguous span carries ≥ `ANCHOR_THRESHOLD` (0.6, `requirements.ts:193`) of the phrase's content
tokens inside **one sentence** — `locate` clips to the sentence the best window starts in
(`requirements.ts:327-336`) and re-measures coverage after clipping, returning `miss` if clipping
cost the coverage. Two scattered mentions therefore cannot anchor as one row, by design. Splitting
is the only way both halves get spans.

### 1.3 **DOES NOT SURVIVE — "from EXTRACTION time onward" is the wrong 'beginning'**

This is my main challenge to the brief, and every AC in § 3 depends on which way the owner resolves
it.

`requirements.ts` **does not read the posting to find requirements.** It reads
`opportunity.jd_table` — a model-generated `<table>` of Category | Item | ATS Keyword produced by
`appJdParse`'s `JD_SYSTEM` prompt — and the Item column is a **paraphrase**. The file says so in its
own header (`requirements.ts:5-17`):

> "Reading real rows shows the Item column is a PARAPHRASE, not a quote... The backlog's acceptance
> ('each row's verbatim is a substring of jd_real at its offsets') is therefore NOT satisfiable by
> storing Items — a paraphrase has no offsets in the posting."

So `locate()` (`requirements.ts:264`) is **already the repair step**. It is a deterministic attempt
to walk a model's paraphrase back to the employer's words. `unlocatable` is not a bug in the
locator; it is the locator *correctly refusing to fabricate a quote* for a paraphrase whose source
it cannot find. `requirements.ts:253-256` states the current design intent explicitly:

> "the row is STILL returned by the caller: dropping it would shrink the requirement count silently,
> and an unlocatable requirement is exactly what a reviewer needs."

**Consequence the owner must decide on.** "Make it impossible" enforced *only* inside
`requirements.ts` converts `unlocatable` into one of exactly two other outcomes:

* **a silently dropped requirement** — which is the failure mode `requirements.ts:253-256` was
  written to prevent, and which `remediation.evidenceRemoved` (`remediation.ts:654-658`) treats as
  cheating: *"requirement rows changed during the loop... The loop may not add or remove the
  evidence it is judged against."*
* **a loosened locator** — the exact cheat catalogued in § 7.

The **only** place the directive's literal words ("it must be in the posting from the very very
beginning") can be satisfied without either of those is **upstream of `requirements.ts` entirely**:
the JD parser must be made to emit, per row, the employer's own contiguous span (or a quote that is
one), rather than a paraphrase to be re-located afterwards. That is `appJdParse.ts`'s `JD_SYSTEM`
prompt and its output contract — a different file, a different change, and a model-output change,
which by this repo's own house rule ("a model may PROPOSE, only an exact rule may ACCUSE",
`checks.ts:634-653`) still needs `locate()` behind it as the verifier.

**AC-0 (blocking, must be answered before any code):** Given the directive "in the posting from the
very very beginning", when the implementer chooses a layer, then the choice is recorded in writing
as one of (a) parser-emits-spans + locator-verifies, (b) extractor-splits-or-refuses, (c) both —
and if (b) alone is chosen, the owner has explicitly accepted that requirements the locator cannot
place are **destroyed rather than shown**, in contradiction of `requirements.ts:253-256`. An
implementation that picks silently fails this AC.

---

## 2. Ground truth I verified myself (file:line, not inherited)

| Fact | Evidence |
|---|---|
| `unlocatable` is produced in exactly one place: the `miss` constant | `requirements.ts:267`, returned at :268, :305, :323, :330, :336 |
| `beyond_model_window` is a relabel of `unlocatable`, not a separate path | `requirements.ts:391` — `if (method === 'unlocatable' && truncated) method = 'beyond_model_window'` |
| `no_posting` is chosen before `locate` is ever called | `requirements.ts:386-388` |
| Unanchored rows are written with `coverage='escalated'` | `requirements.ts:410`; meaning fixed at `schema.ts:307-311` = "could not be located in the POSTING", a *different population* from P3's `escalation` table |
| `seq` is the array index of `jd_table` row order, assigned at insert | `appRequirements.ts:404-412` (`for (let i…)`, `i` passed as `seq`) |
| Re-extraction deletes the whole spine | `appRequirements.ts:403` `delete from requirement where opp_id=$1` |
| That delete **cascades** to evidence | `schema.ts:406` / `appRequirements.ts:42` — `requirement_id … references requirement(id) on delete cascade` |
| `evidence_confirmation` deliberately survives re-extraction by keying on TEXT, not id or seq | `schema.ts:439-457` — *"requirement.seq is no better: it is a reused positional index, so a confirmation keyed on it would silently transfer to whatever requirement later occupies that slot"* |
| …but the confirm ROUTE is addressed by `{seq}` | `appRequirements.ts:858`, `:889-890`, `:907`, route registered `:948` |
| The schema already enforces the *pairing* of null-ness, not its absence | `schema.ts:323-325` — `(char_start is null) = (char_end is null)`, `(char_start is null) = (verbatim is null)` |
| `match_method` CHECK currently admits all five values | `schema.ts:302` |
| Coverage denominator = `coverable`, no `match_method` filter | `checks.ts:607`, used at `:697`, `:733-741` |
| Zero requirement rows ⇒ `not_applicable`, never `pass` | `checks.ts:557-561` |
| Zero *coverable* rows ⇒ `not_applicable` | `checks.ts:734-735` |
| `not_applicable` ⇒ `must_have_coverage` score is `null`, and a null component nulls the composite | `artifactScore.ts:96-97`; `schema.ts:645` |
| An unanchored requirement already cannot be cited by the reviewer | `reviewer.ts:251-256` — `drop('requirement_has_no_anchor', …)` |
| The UI already labels an unanchored row as a non-quote | `app/src/postingAnalysis.js:177-190` (`NO_QUOTE_REASON`, `isQuoted`), rendered `app/src/screens/PostingAnalysis.jsx:238,246` |
| `match_method` is carried into the comparison engine | `appDimensions.ts:205` → `dimensions.ts:240` |
| Hand-written INSERTs of `'unlocatable'` rows already exist in the test suite | `api/test/shipPathDb.test.mjs:184`, `api/test/dimensionsDb.test.mjs:123` |

### 2.1 An arithmetic gap in the brief's own measurement — please resolve

The brief states eMoney `2cb56fb3` has **35 requirements, 21 `anchored`, 2 `unlocatable`**.
35 − 21 − 2 = **12 rows unaccounted for**. Presumably `exact` (`requirements.ts:288`), but that is
an *inference*, not something I measured. Any AC that asserts "N rows change" needs the full
`match_method` histogram for that opp, not three of five buckets. See open question Q1.

---

## 3. ACs — the invariant itself: can an unanchored requirement be written AT ALL?

Three layers can enforce this. They are not interchangeable.

### 3.1 Layer A — the database CHECK constraint. **AUTHORITATIVE.**

**AC-1.** Given a database with the migration applied, when any client — the extractor, a backfill,
a test fixture, a future route, or a human at `psql` — attempts
`insert into requirement (…) values (…, char_start => null, …)`, then Postgres rejects the statement
with a constraint violation, and no row is written.

**AC-2.** Given the same database, when any client attempts to insert a `requirement` row with
`match_method` in `('unlocatable','beyond_model_window','no_posting')`, then Postgres rejects it.
The CHECK at `schema.ts:302` is narrowed to `('exact','anchored')` — plus any new method minted by
this change, which must be named in the AC sign-off before it is added.

**AC-3.** Given the constraint at `schema.ts:302` and the new not-null constraint, when they are
delivered, then they are delivered by an **explicit `alter table requirement drop constraint if
exists … ; alter table requirement add constraint …`** in `SCHEMA_SQL`, **not** by editing the
inline `create table if not exists requirement (…)` body at `schema.ts:294-326`. Rationale, from the
repo's own measured trap at `schema.ts:961-968`: on the database production actually runs,
`create table if not exists` is **skipped entirely**, taking every inline constraint edit with it,
and the migration exits 0 reporting clean. The precedent to copy is
`requirement_kind_source_check` at `appRequirements.ts:119-124`, which documents exactly this.

**AC-4 (H39/H39b ordering).** Given `SCHEMA_SQL` is applied to a database carrying `origin/main`'s
schema **with rows in it**, when the file runs under `psql -v ON_ERROR_STOP=1`, then it exits 0.
Specifically: the statement that disposes of the 1,511 violating rows (§ 5) must appear **before**
the `add constraint`, and any statement naming a column added by an idempotent `ALTER` must appear
after that `ALTER`. Verified by the populated-database procedure in `CLAUDE.md` § "Run the schema
locally" — **fresh-database success does not satisfy this AC.**

**AC-5 (the lock).** Given `ensureRequirementCols` already performs `drop constraint` /
`add constraint` on `requirement` (`appRequirements.ts:122-124`), when the new constraint is added,
then it is added **in `SCHEMA_SQL` only** and is **not** added to `ensureRequirementCols` — because
`ensureRequirementCols` is reachable from `requirementsGet` (`appRequirements.ts:673`) and
`requirementsBackfill` (`:735`), and `drop constraint` takes an `ACCESS EXCLUSIVE` lock. The
reasoning is already written down at `appRequirements.ts:33-37` and `:62-70`; violating it surfaces
as intermittent 500s under concurrency, not as a migration bug.

**Why Layer A is authoritative:** it is the only layer with no bypass. Two hand-written INSERTs of
`'unlocatable'` rows already exist in this repo's own test suite (`shipPathDb.test.mjs:184`,
`dimensionsDb.test.mjs:123`) — proof by existence that `writeRequirements` is not the only writer.
"Impossible systematically" is a property of the store or it is a convention.

### 3.2 Layer B — the extractor refuses. NECESSARY, NOT SUFFICIENT.

**AC-6.** Given `buildRequirements(opp)` (`requirements.ts:379`), when any parsed `jd_table` row
cannot be resolved to a span, then `buildRequirements` never returns a `RequirementRow` with
`char_start === null`, and instead returns that row in a **new, separately-named return field**
(e.g. `BuildResult.unanchored: Array<{ item_text, source_category, reason }>`) alongside `rows`.

**AC-7.** Given AC-6, when `writeRequirements` (`appRequirements.ts:392`) persists the result, then
the count of unanchored-and-not-persisted rows is returned in its result object and propagated to
`requirementsBackfill`'s JSON body (`appRequirements.ts:778-790`), beside the existing
`located_rate`. A row that vanishes without appearing in a count fails this AC.

**Why B alone is insufficient:** it is one function. `writeRequirements` is called from
`appJdParse.ts:90` and `appRequirements.ts:744` today; nothing prevents a third caller, and nothing
prevents a route that builds rows itself. B gives a good error and a count; it gives no guarantee.

### 3.3 Layer C — the write path asserts before the INSERT. NECESSARY FOR THE ERROR MESSAGE.

**AC-8.** Given `writeRequirements` receives a row with `char_start === null` (i.e. Layer B has
been bypassed or has regressed), when the insert loop at `appRequirements.ts:404-416` reaches it,
then the transaction is rolled back with a message naming the opportunity id and the offending
`item_text`, rather than surfacing as a bare Postgres constraint error. Precedent: the
accusation-grade pre-store assertion at `appRequirements.ts:217-232`, which exists for exactly this
reason and is exercised through an injected seam.

**AC-9 (mutation-proof, NEVER SKIPPED).** Given each of AC-1, AC-2, AC-6 and AC-8 has a guard, when
the guarded behaviour is individually reverted, then the suite **fails** for each one, and is then
restored. A guard that passes with its defect reinstated fails this AC. Per `CLAUDE.md`: an inert
guard is worse than no guard because it is believed. If a mutation is behaviourally equivalent and
correctly fails to fail, that must be **said**, not counted as proof.

---

## 4. ACs — splitting a compound

**AC-10.** Given a `jd_table` Item whose content tokens are distributed across two or more
non-adjacent sentences of `jd_text` such that no single sentence-clipped window reaches
`ANCHOR_THRESHOLD` (`requirements.ts:193`, :327-336) — eMoney `2cb56fb3` seq 30, `"Experience in
managing cloud-based applications and APIs."` — when extraction runs, then **N ≥ 2 separate
`requirement` rows exist**, each with a non-null `verbatim`, non-null `char_start`/`char_end`, and
`match_method in ('exact','anchored')`, and **zero** rows for that Item are unanchored.

**AC-11 (the split must not manufacture a fake anchor — this is the load-bearing one).** Given a
candidate split part, when it is located, then it is accepted **only if** it independently satisfies
*both*:
  1. `locate()` returns `exact` or `anchored` for it against `jd_text` at the full unchanged
     `ANCHOR_THRESHOLD`; **and**
  2. the part carries at least `MIN_JUDGEABLE_TOKENS` (= 3, `checks.ts:228-229`) content words
     **and**, if it has any token of ≥ 6 chars, at least one such distinctive token — the same two
     floors `coversIn` already enforces for the coverage decision (`checks.ts:239-245`, exact body:
     `if (toks.length < MIN_JUDGEABLE_TOKENS) return false` … `return distinctive.length === 0 ||
     distinctive.some(...)`).

A part that fails either is **not** written as an anchored requirement. Without clause 2, splitting
`"…cloud-based applications and APIs"` on `and` yields the part `"APIs"`, which anchors trivially to
any occurrence of the token and produces a 4-character "proof quote". That is the § 7.3 cheat
wearing the split's clothes.

**AC-12 (no span double-counting across the split).** Given two parts of one split, when both are
located, then their `[char_start, char_end)` ranges do not overlap. `locate` already threads a
`taken: Span[]` list for precisely this reason (`requirements.ts:247`, :257-260, :287, :302, :321) —
the split must feed parts through the *same* `taken` accumulator (`requirements.ts:383`, :392), not
a fresh one per part.

**AC-13 (splitting is not a licence to invent requirements).** Given a `jd_table` Item that the
current extractor produces exactly one row for and that row anchors today, when the split logic
runs, then that Item still produces exactly one row. Splitting fires only on Items that would
otherwise be unanchored. Rationale: `remediation.evidenceRemoved` (`remediation.ts:654-658`) fails a
run whose `reqCount` moved at all; a split that fires broadly moves every count on every surface for
reasons unrelated to the defect.

### 4.1 The seq consequence — and why it is worse than the brief suggests

**Observation.** `seq` is a positional index (`appRequirements.ts:404`, `i`). Splitting one row into
two renumbers **every subsequent row of that opportunity**. `schema.ts:322` is `unique (opp_id,
seq)`, so the numbering is dense and re-used.

**Observation.** `requirement_evidence` joins on `requirement_id` (`schema.ts:406`) and cascades on
delete, so re-extraction *destroys* it — which the code already handles by re-resolving in the same
call (`appRequirements.ts:745-766`).

**Observation.** `evidence_confirmation` was deliberately keyed on `requirement_text` **because**
seq is unstable — `schema.ts:439-457` says so in as many words. So the owner's confirmations
*survive* a re-seq. Good.

**Interpretation, and the actual exposure:** the *route* is `{seq}`-addressed
(`appRequirements.ts:889-890`, `:907`, `:948`). A client that read the requirements list, then
triggers a re-extraction (or races another session's), then POSTs `confirm` for `seq: 30`, confirms
**whatever requirement now occupies slot 30** — which after a split is a different sentence. The
route's own ownership check (`appRequirements.ts:898-907`) does not detect this, because the row it
loads is a real row of a real opportunity owned by the caller.

**AC-14.** Given a client holds requirement `seq: N` for opp X, when a re-extraction changes which
requirement occupies slot N, and the client then POSTs `/api/app/requirement/N/evidence-confirm`
with `{oppId: X}`, then the confirmation is **refused** (409) rather than applied to the new
occupant. Satisfied by the request carrying a claim-identity token the server re-checks — the
natural one is the requirement TEXT the client displayed, matched the same way
`evidence_confirmation`'s unique key already matches (`schema.ts:475`) — not by a new id column.

**AC-15.** Given AC-14 is implemented, when an owner confirms an excerpt and a *later* re-extraction
produces a requirement with identical text at a different seq, then the existing confirmation still
joins and still counts (`appRequirements.ts:490-497`). The fix for AC-14 must not break the
text-keyed survival that `schema.ts:439-457` deliberately bought.

---

## 5. ACs — THE 1,511 EXISTING ROWS (~16% of 9,518)

### 5.1 What I judge correct: **delete and re-extract, bounded and reported.**

Reasoning, and the disconfirming check I ran on it: I first assumed these rows carry information
worth keeping. They do not carry any *quotable* information. By `schema.ts:324` their `verbatim` is
null. `reviewer.ts:251-256` already refuses to accept any citation resolved against them.
`postingAnalysis.js:177-190` already prints them as "not a quote from the employer". The only thing
they carry that anything reads is `item_text` — a model paraphrase — and their **presence in the
denominator**. So deletion loses no evidence. It loses a count, and the count is the thing that must
be reported rather than hidden.

**AC-16.** Given the 1,511 rows, when the migration runs, then each affected opportunity is
**re-extracted through the new extractor** (Layer B), not merely stripped — so an Item that the new
splitter *can* anchor comes back as anchored rows rather than disappearing.

**AC-17.** Given AC-16, when the migration completes, then it emits a per-opportunity and
system-wide report containing, at minimum: rows before, rows after, `located_rate` before,
`located_rate` after, count split, count dropped-as-unanchorable, and the count of opportunities
whose must-have set became **empty**. This report is durable (a table row or a workflow artifact),
not a log line. Without it AC-19's "explained, not silent" cannot be met.

**AC-18 (the deletes that are not obvious).** Given the migration deletes `requirement` rows, when
it runs, then the following are enumerated in the report **before** the delete, because each is a
different FK behaviour and three of them are silent:

| Table | FK | Effect | Evidence |
|---|---|---|---|
| `requirement_evidence` | `on delete cascade` | evidence rows destroyed | `schema.ts:406` |
| `escalation` | `on delete cascade` | escalation rows destroyed | `schema.ts:877` |
| `swap_decision` | `on delete set null` | `requirement_id` **silently nulled**, beside a `verbatim_quote` that then has no requirement | `schema.ts:502-512` |
| `insertion` | `on delete set null` | `requirement_id` **silently nulled** | `schema.ts:545-554` |
| `artifact_score.uncovered_requirement_ids` / `judged_requirement_ids` | `uuid[]`, **no FK at all** | **dangling ids, no error, no cascade** | `schema.ts:633,639` |
| `evidence_confirmation` | no FK to `requirement` | survives, by design | `schema.ts:439-457` |

The `uuid[]` columns are the sharp edge: nothing in Postgres will tell you they broke.

**AC-19 (bounded, reversible, owner-visible).** Given the migration affects ~1,511 rows across an
unknown number of opportunities, when it is run, then it is run **first in dry-run mode** reporting
the AC-17 numbers with zero writes, the owner sees those numbers, and only then is the destructive
pass run. Per `CLAUDE.md` § "Prefer reversible over destructive; confirm scope first": ground-truth
the affected row count before any bulk mutation.

### 5.2 What breaks under each option I rejected — stated, as required

**Option: quarantine into a new table.** Rejected. `CLAUDE.md` § "Extend, don't duplicate" forbids
standing up a parallel store, and `schema.ts:338-347` already argues the same point for this exact
spine. Note the owner's word "seperate" refers to **separate requirements** ("so they can have there
proof quote attached") — separate *rows*, not a separate *table*. Reading it as a table would
reproduce the taxonomy-vs-persona failure recorded in `CLAUDE.md`. **If the implementer disagrees,
AC-0 applies: state it and get sign-off first.**

**Option: grandfather via `extractor_version`.** Rejected, and this is the one that most looks like
compliance. `EXTRACTOR_VERSION` exists precisely to make old-rule rows identifiable
(`requirements.ts:38-47`), so `check (char_start is not null or extractor_version < 3)` is a legal,
passing, one-line constraint. It makes every *new* row anchored while leaving 1,511 unanchored rows
in the denominator forever, un-surfaced. **This is literally the burying the owner vetoed, wearing a
version number.** Any implementation that ships a version-conditional constraint fails AC-1.

**Option: leave them, add the constraint `NOT VALID`.** Rejected for the same reason: Postgres will
accept `alter table … add constraint … not valid`, the migration exits 0, new writes are guarded,
and 1,511 violating rows persist. Fails AC-1's "no row is written" only in the future tense.

**Option: delete without re-extracting.** Rejected. It maximises the count drop and guarantees that
every Item the new splitter could have anchored is lost. Fails AC-16.

---

## 6. ACs — denominator honesty, regression, and the poor-scrape JD

### 6.1 Denominator movement

**AC-20 (direction, measured not assumed).** Given a specific opportunity, when the change lands,
then the before/after `must_have_coverage` `observed` string is recorded for it from the **live**
system, not predicted. Expected direction is *up* (a smaller `coverable`, `checks.ts:607`, over an
unchanged numerator) — but that is an inference, and § 2.1 shows the brief's own histogram is
incomplete. An implementation that reports a direction without a measured before/after pair fails
this AC.

**AC-21 (the movement is explained on the surface a reviewer reads).** Given coverage rises because
requirements were removed rather than because the profile improved, when `must_have_coverage` is
rendered, then the reason appears in the `observed` string via the **existing** `excluded[]`/`tail`
mechanism (`checks.ts:709-730`), not in a new parallel field. That mechanism exists for exactly this
— its comment says a count that changed for a non-profile reason "must say so on the surface a
reviewer reads, or 'coverage rose' is not falsifiable". **Extend it; do not add a second one.**

**AC-22 (the fail→not_applicable slide — the regression the brief did not ask for).** Given an
opportunity whose must-haves were *all* unanchored, when they are removed, then `coverable.length`
becomes 0 and `must_have_coverage` moves from `fail` at `0/N` to **`not_applicable`**
(`checks.ts:734-735`), which nulls the score component (`artifactScore.ts:96-97`) and nulls the
composite (`schema.ts:645`). `remediation.ts:648-652` names this exact transition as *"not a pass
but colours like one in any UI that treats 'no findings' as fine"*. So: when this occurs, then the
opportunity appears in the AC-17 report as a named case, and the UI must not present it as an
improvement. An implementation where a gate silently goes from red to grey fails this AC.

**AC-23 (the loop cannot benefit).** Given `remediation.evidenceRemoved` (`remediation.ts:654-658`)
fails any run whose `reqCount` changed, when the migration changes `reqCount` for an opportunity
with an in-flight remediation loop, then the loop is not credited with convergence. Either the
migration refuses to touch opportunities with open loops, or the loop's snapshot is re-baselined
explicitly — silently is not an option.

### 6.2 Regression guard

**AC-24 (byte-exactness — the invariant the whole feature rests on).** Given every surviving
`requirement` row, when its `verbatim` is compared to `jd_text` for its opportunity, then
`jd_text.slice(char_start, char_end) === verbatim`, **byte for byte**, for 100% of rows, and
`requirement.jd_text_sha256` equals `opportunity.jd_text_sha256`. This is asserted over the **whole
live corpus** after migration, not over a sample. Precedent for why byte-exact and not
"substring-of": `requirements.ts:270-280` records a measured defect where a stored quote was a true
substring of the record *at the wrong offsets* (`toLowerCase()` is not length-preserving), which no
substring guard could catch.

**AC-25 (`exact` and `anchored` are untouched).** Given the set of rows with
`match_method in ('exact','anchored')` before the change, when the change lands, then for every one
of them `(item_text, verbatim, char_start, char_end, match_method, kind, kind_source, weight)` is
unchanged — with the sole permitted exception of `seq`, which the split necessarily renumbers.
`seq` changes must be reported as a count (AC-17).

**AC-26 (determinism preserved).** Given the same `opportunity` row, when `buildRequirements` runs
twice, then it produces identical output. `requirements.ts:19` and `:378` both assert this today; a
splitter that consults a model breaks it, and would additionally drag the spine under
`checks.ts:634-653`'s "a model may PROPOSE, only an exact rule may ACCUSE" rule.

**AC-27 (`EXTRACTOR_VERSION` bumped).** Given the extraction rules change, when the change lands,
then `EXTRACTOR_VERSION` (`requirements.ts:47`) is incremented and the reason recorded in its
doc-comment, in the same commit. That comment block is the file's own convention (see its version-2
entry) and it is what makes pre-change rows findable afterwards.

### 6.3 The poor-scrape JD (headings only, no bullets — Trinnex is real)

**AC-28.** Given a posting whose stored text is headings only, such that no `jd_table` Item can be
anchored, when extraction runs, then **zero `requirement` rows** are written for that opportunity —
not unanchored rows, and not a partial spine.

**AC-29 (zero is an acceptable outcome — and this is provable, not a judgement call).**
`checks.ts:557-561` already handles the empty case correctly today:

```ts
out.push(na('must_have_coverage', 'no requirement rows for this opportunity', COVERAGE_EXPECT))
```

`not_applicable` ⇒ `must_have_coverage` value `null` (`artifactScore.ts:96-97`) ⇒ composite `null`
(`schema.ts:645`). So a zero-requirement posting produces **no score and no green gate**, which is
the codebase's standing rule ("absent evidence is `not_applicable`, never `pass`") already doing its
job. Given a poor-scrape posting, when it is evaluated, then `must_have_coverage` is
`not_applicable`, the composite is `null`, and the artifact is not `ready`.

**AC-30 (the owner is told *why*, in the posting's own terms).** Given zero requirements, when the
owner opens the posting, then the screen states that no requirement could be located in the stored
posting text and names the cause — distinguishing "no posting text is stored" from "the posting text
is present but no line could be located". The vocabulary already exists: `NO_QUOTE_REASON`
(`app/src/postingAnalysis.js:179-186`) has a distinct sentence for `no_posting` versus
`unlocatable` versus `beyond_model_window`. **Those three constants must not be deleted as dead code
just because no `requirement` row can carry those `match_method` values any more** — they become the
vocabulary for the *opportunity-level* explanation. An implementation that removes them and leaves
the owner with a blank screen fails this AC.

**AC-31 (an empty spine is not silent at the API).** Given zero requirements, when
`GET /api/app/opportunity/{id}/requirements` is called (`appRequirements.ts:667`), then the response
carries a non-null reason field explaining the emptiness. Today the body would report
`total: 0, located: 0` (`appRequirements.ts:705`) with no cause, which is indistinguishable from
"never extracted".

**AC-32 (`beyond_model_window` must not become a hidden truncation).** Given a posting longer than
`MODEL_WINDOW` (12,000 chars, `requirements.ts:355`), when Items derived from beyond that window
cannot be anchored and are therefore dropped, then `opportunity.jd_text_truncated` is set
(`appRequirements.ts:400-401`) **and** the count of Items dropped for this reason is reported
separately from Items dropped for any other reason. Otherwise "make it impossible" converts a known,
labelled, fixable condition (the parser never read that part of the posting) into a silent absence
— which is the same burying in a different place.

---

## 7. Ways a lazy implementation could pass these ACs anyway

Written adversarially. Each has a named counter-AC; where a counter-AC does not already exist above,
it is stated here and is part of the sign-off.

### 7.1 Relabel, don't fix — mint a sixth `match_method`

Add `'unanchored_ok'` to the CHECK, write the same rows under the new name, and every query for
`match_method = 'unlocatable'` returns zero. "No unlocatable rows" is now literally true and nothing
changed. **Counter:** AC-2 pins the permitted set to `('exact','anchored')` and requires any addition
to be named at sign-off; AC-1 is written against `char_start is null`, which is a property of the
data, not of a label. **Detection:** `select match_method, count(*), count(char_start) from
requirement group by 1` — any bucket whose `count(char_start) < count(*)` is this cheat.

### 7.2 Lower the threshold until everything anchors

`ANCHOR_THRESHOLD = 0.6` (`requirements.ts:193`) is one number in one file. Set it to 0.3 and the
1,511 mostly vanish. This is the highest-probability cheat because it is a one-character diff, it
makes every metric move the right way, and the resulting rows are *structurally* valid — non-null
verbatim, real offsets, byte-exact slices. AC-24 **passes** on them. **Counter, stated here as
AC-33:** given the change, when it lands, then `ANCHOR_THRESHOLD` is unchanged at 0.6, or its change
is a separately-justified, separately-signed-off item with its own before/after false-anchor
measurement. A guard asserting the literal value is legitimate here precisely *because* no
behavioural test can distinguish a correct anchor from a loose one — the loose one is a real
substring too. Related prior art in this repo: `COVERAGE_THRESHOLD` (`checks.ts:226-227`) was raised
from 0.5 to 0.7 *because* the lower value marked a garbage requirement as covered — the reasoning is
recorded at `checks.ts:533-549`. The same argument applies here in the same direction.

**The subtler variant:** leave `ANCHOR_THRESHOLD` alone and weaken `LOC_STOP`
(`requirements.ts:172-176`). Adding common words to the stop-list shrinks `want`, so the *same*
window covers a larger *fraction* of it. Coverage is `counts.size / want.size`
(`requirements.ts:319`) — shrinking the denominator is arithmetically identical to lowering the
threshold, and it does not touch the constant a guard is watching. **AC-33 covers `LOC_STOP` too.**

**A third variant:** widen the sweep window at `requirements.ts:308`
(`tokenize(paraphrase).length * 1.8`). A bigger window catches more scattered tokens in one span.
Same arithmetic, third constant. **AC-33 names all three: `ANCHOR_THRESHOLD`, `LOC_STOP`, and the
1.8 window multiplier.**

### 7.3 Anchor to a trivially short span

Split on `and`/`,` until every fragment is one word, then anchor `"APIs"` to the first occurrence of
`API`. Every row has a verbatim. Every row is byte-exact. Every AC about anchoring passes. The
"proof quotes" are four characters long and prove nothing — and worse, they will then *evidence*
easily (a resume containing "API" matches), so `must_have_coverage` goes green on shredded
requirements. **Counter:** AC-11 clause 2 (`MIN_JUDGEABLE_TOKENS` + a ≥6-char distinctive token,
mirroring `checks.ts:543-549`). **Additional counter, AC-34:** given the corpus after migration,
when `verbatim` lengths are measured, then the p5 length is not materially below the p5 length
before migration; a distribution that collapses toward the minimum is this cheat regardless of any
per-row test passing. Note this cheat is *invisible* to every per-row assertion — it is only
detectable in aggregate, which is why AC-34 is a corpus AC and not a unit test.

### 7.4 Delete the hard cases and call it extraction

Layer B "refuses" by dropping any Item it cannot anchor, no split attempted, no count reported.
`unlocatable` hits zero, `located_rate` hits 1.000, and the system looks perfect because it stopped
looking. **Counter:** AC-7 (count reported), AC-16 (re-extract, don't strip), AC-17 (before/after
row counts), AC-13 (splitting fires only where needed). **Detection:** total `requirement` rows
before vs after. If the drop is ≈1,511 with ≈0 splits, nothing was fixed — the rows were removed.

### 7.5 Bury it one level up instead

Leave the extractor alone and add the filter at `checks.ts:607` after all — the very line the owner
vetoed. Reads as "coverage now measures only anchored requirements", sounds principled.
**Counter:** AC-1 (rows cannot exist, so there is nothing to filter). **Detection, AC-35:**
`checks.ts` contains no reference to `match_method` after the change. If a `match_method` filter
appears in `checks.ts`, `artifactScore.ts`, `remediation.ts`, or `appDimensions.ts`, the fix was
made at the wrong altitude.

### 7.6 Constraint theatre

`add constraint … not valid`; or add it inside `create table if not exists` (skipped on prod,
`schema.ts:961-968`); or add it in `ensureRequirementCols` where it locks the hot path
(`appRequirements.ts:33-37`); or gate it on `extractor_version` (§ 5.2). All four produce a green
migration and an unguarded production table. **Counter:** AC-3, AC-4, AC-5, and the § 5.2 rejection
of version-conditional constraints. **Detection:** apply `SCHEMA_SQL` to a database built from
`origin/main` **with the 1,511-row shape seeded**, then attempt `insert … char_start => null` and
require the insert to fail. Per `CLAUDE.md`, a fresh-database run proves nothing here.

### 7.7 Test the split with a fixture that cannot fail

Write one unit test with a hand-made compound whose two halves both sit in the same paragraph and
both contain a distinctive token. It passes on any splitter, including one that splits on every
comma. **Counter, AC-36:** the split must be exercised against the **real** eMoney `2cb56fb3` seq 30
and seq 4 rows and the real `jd_text` (8,803 chars), pulled live, not paraphrased into a fixture.
seq 4 (`"Foster a culture of innovation among engineering teams."`, a `responsibility`) is the
harder case and the more informative one: it may have **no** second mention to split toward, in
which case the honest outcome is that it is dropped and counted — and the AC-17 report must show it.

### 7.8 Report the numbers only in aggregate

"1,511 rows resolved" with no per-opportunity breakdown, so the opportunity whose must-have set went
to zero (AC-22) is averaged away. **Counter:** AC-17 requires per-opportunity rows and an explicit
named list of opportunities whose must-have set became empty.

### 7.9 Claim it done from a passing test suite

The suite runs against fixtures. The 1,511 rows are in production. **Counter:** AC-24 and AC-34 are
corpus ACs over the live database, and per `CLAUDE.md` § "Confirm in the user's environment", the
words "fixed"/"resolved" may not be written until the migration has run against production and the
owner has seen the AC-17 report.

---

## 8. Numbered checklist (sign-off)

**Decide before writing code**

1. [ ] AC-0 — layer chosen and recorded: parser-emits-spans, extractor-splits-or-refuses, or both.
2. [ ] Q1-Q6 (§ 9) answered by the owner.

**The invariant**

3. [ ] AC-1 — null `char_start` rejected by the database.
4. [ ] AC-2 — `match_method` CHECK narrowed to `('exact','anchored')`.
5. [ ] AC-3 — delivered by explicit `drop constraint`/`add constraint`, not an inline edit.
6. [ ] AC-4 — `SCHEMA_SQL` exits 0 on a **populated** `origin/main` database, disposal before constraint.
7. [ ] AC-5 — constraint in `SCHEMA_SQL` only; `ensureRequirementCols` untouched (lock).
8. [ ] AC-6 — `buildRequirements` never returns a null-offset row; unanchored returned separately.
9. [ ] AC-7 — dropped/split counts surfaced in `writeRequirements` and the backfill response.
10. [ ] AC-8 — write path fails loudly, naming opp id and `item_text`.
11. [ ] AC-9 — **every new guard mutation-proved.**

**The split**

12. [ ] AC-10 — compound yields N ≥ 2 anchored rows, zero unanchored.
13. [ ] AC-11 — each part clears the unchanged anchor threshold **and** the token/distinctiveness floors.
14. [ ] AC-12 — split parts share one `taken` accumulator; no overlapping spans.
15. [ ] AC-13 — splitting fires only on Items that would otherwise be unanchored.
16. [ ] AC-14 — `{seq}`-addressed confirm refuses a re-seq'd slot (409).
17. [ ] AC-15 — text-keyed confirmation survival preserved.

**The 1,511**

18. [ ] AC-16 — re-extracted, not stripped.
19. [ ] AC-17 — durable before/after report, per-opportunity + system-wide.
20. [ ] AC-18 — all six FK/array dependents enumerated before the delete.
21. [ ] AC-19 — dry-run first; owner sees the numbers before the destructive pass.

**Honesty and regression**

22. [ ] AC-20 — direction of coverage movement **measured** live, not predicted.
23. [ ] AC-21 — movement explained via the existing `excluded[]`/`tail`, not a new field.
24. [ ] AC-22 — `fail → not_applicable` slides named, never rendered as improvement.
25. [ ] AC-23 — in-flight remediation loops not silently re-baselined.
26. [ ] AC-24 — byte-exact slice + sha match, **whole corpus**.
27. [ ] AC-25 — `exact`/`anchored` rows unchanged except `seq`.
28. [ ] AC-26 — extraction still deterministic and model-free.
29. [ ] AC-27 — `EXTRACTOR_VERSION` bumped with a reason.

**Poor scrape**

30. [ ] AC-28 — headings-only posting ⇒ zero rows.
31. [ ] AC-29 — zero rows ⇒ `not_applicable` ⇒ null composite ⇒ not `ready`.
32. [ ] AC-30 — owner told why; `NO_QUOTE_REASON` repurposed, not deleted.
33. [ ] AC-31 — API response carries a reason for an empty spine.
34. [ ] AC-32 — truncation-caused drops counted separately.

**Anti-cheat**

35. [ ] AC-33 — `ANCHOR_THRESHOLD`, `LOC_STOP` and the 1.8 window multiplier all unchanged (or separately signed off).
36. [ ] AC-34 — corpus `verbatim`-length p5 does not collapse.
37. [ ] AC-35 — no `match_method` filter appears in `checks.ts` / `artifactScore.ts` / `remediation.ts` / `appDimensions.ts`.
38. [ ] AC-36 — split exercised against the real eMoney seq 30 **and** seq 4 rows and the real 8,803-char `jd_text`.

---

## 9. Open questions for the owner

**Q1 — the missing 12.** eMoney `2cb56fb3` is reported as 35 requirements / 21 `anchored` /
2 `unlocatable`. That leaves 12 unaccounted. Please supply the full `select match_method, count(*)
from requirement where opp_id='2cb56fb3-…' group by 1`. Several ACs size their expected impact on
this histogram and I will not infer it.

**Q2 — AC-0, the layer.** Does "in the posting from the very very beginning" mean the JD *parser*
must emit spans (a change to `appJdParse`'s prompt and output contract, and a model-output change),
or is "the extractor never writes an unanchored row" sufficient? These are different projects. My
reading of the words is the former; the brief assumes the latter. § 1.3.

**Q3 — the acceptable loss.** If an Item genuinely cannot be anchored even after splitting — seq 4,
`"Foster a culture of innovation among engineering teams."`, may be exactly this — is the correct
outcome (a) drop it and report the count, or (b) keep it visibly as a *non-requirement* observation
that no gate ever counts? (b) contradicts "impossible systematically"; (a) contradicts
`requirements.ts:253-256`. I lean (a) **only** because AC-17's report makes the loss visible, but
this is your call, not mine.

**Q4 — the `fail → not_applicable` slide (AC-22).** For an opportunity whose must-haves are *all*
unanchorable, the gate stops being red and becomes grey with a null score. Is that acceptable, or
should such an opportunity be flagged as un-assessable in a way that is visually distinct from
"nothing wrong"? `remediation.ts:648-652` already warns that grey "colours like" green.

**Q5 — thresholds as user settings.** `ANCHOR_THRESHOLD` (0.6), `MODEL_WINDOW` (12,000) and the 1.8
window multiplier are code literals. `CLAUDE.md` § "No hardcoded config" says a behaviour-affecting
value must be user-changeable or explicitly approved as code-only. AC-33 asks for them to be
*frozen*, which is the opposite pull. My recommendation is to keep them code-only and **record your
approval**, because these are anti-cheat constants rather than preferences — but that needs your
explicit sign-off either way.

**Q6 — migration blast radius.** Do you want the 1,511 handled in one sweep, or per-owner /
per-opportunity in batches so you can watch the coverage numbers move? AC-19 requires a dry-run
regardless; this is about the shape of the real pass.

---

## 10. What this document is not

It is not an implementation plan, and no code, schema, or application source was edited to produce
it. Every claim is either cited to a file:line I read in this session, marked as an inference, or
listed as an open question. Where the brief and the code disagreed — § 1.3 and § 2.1 — I have said
so rather than writing ACs on top of the brief's reading.
