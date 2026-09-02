<!-- WHAT:       Independent AC pass for the ResumeSummary reword pass + paraphrase->requirement link,
               executed against BRIEF-ac-reword-carries-the-link.md.
     WHY:       TIER 1 (admits model output into a stored claim feeding keyword_coverage). Full
               independent AC pass required before any implementation.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   every row below cites the actual command run and its actual output. -->

# AC — the reword carries the link (loop 1)

Executed cold against `BRIEF-ac-reword-carries-the-link.md` on 2026-09-02, branch
`claude/incumbent-wins-swap`. Every claim below is grounded by reading the actual code
(`api/src/functions/tests/{schema,appPackets,appChecks,appCoverage,checks,atsKeywords,
appCorrections,figureEcho}.ts`, `app/src/screens/AssetBlocks.jsx`) and running the commands shown.
**Prompts table was not read or touched**, per the binding rule.

---

## 1. FEASIBILITY TABLE (first, per this repo's rule — before any AC)

| Dependency | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|
| `correction` table itself | `schema.ts:403` (`create table if not exists correction`) + `appCorrections.ts:63` `ensureCorrectionTable()` self-heals it on every route call | `appCorrections.ts` (`listCorrections`, revert route), `appSwaps.ts` | `grep -rn "insert into correction" api/src/functions/tests/` → 2 hits: `appCorrections.ts:140` (pipeline-planned rows) and `appCorrections.ts:375` (owner manual correction route). `grep -rln "from correction\b" api/src/functions/tests/ app/src/` → `appSwaps.ts`, `appCorrections.ts` | **EXISTS** |
| `correction.source` CHECK, and every DDL home | `schema.ts:414` (inline) + `schema.ts:454-456` (idempotent ALTER, H39/H39b-ordered after the `create table`) | `appCorrections.ts:75` (`ensureCorrectionTable`'s own copy), `api/test/sql/correction.sql:30` (test fixture) | `grep -n "source in (" api/src/functions/tests/schema.ts api/src/functions/tests/appCorrections.ts api/test/sql/correction.sql` → three hits, all `'profile_figure','generalized','owner_edit'`, byte-identical | **EXISTS-BUT-CONSTRAINED** — exactly 3 values today; a 4th needs an ALTER in schema.ts *and* the matching edit in `appCorrections.ts:75` *and* `test/sql/correction.sql:30`, or `H:correction-ddl-parity` / `H:correction-ddl-column-parity` (`api/test/correctionDdlParity.test.mjs:35,104`) fail by design |
| `Marked` / `phrases` in `AssetBlocks.jsx` | `AssetBlocks.jsx:669` (`function Marked({ text, phrases, active })`), fed by `markPhrases = [...wording, ...proposedKeywords.map(k => ({phrase: k, mark: 'keyword'}))]` (`:711`) | `BlockBody` (`:625-636`, list/pipe/prose shapes), `ListBody` | Read `AssetBlocks.jsx:669-711`. `wording` is populated at `:144` as `offendersByField(result, 'posting_wording_kept')` — the DETERMINISTIC verbatim-echo warning check, not a coverage claim. `HIGHLIGHT_CLASS`/`markRuns` imported from `../highlight.js` (`:45`) and index by `r.mark`, a free-form string key | **EXISTS-BUT-CONSTRAINED** — the rendering primitive (`Marked`, `markRuns`, `{phrase, mark}` array shape, identity-based `active` linking) is fully generic and reusable for a new mark type (e.g. `'reword'`); today it is wired ONLY to `posting_wording_kept` (a warning about copied wording) and to proposed-keyword chips — nothing today feeds it a positive "this paraphrase covers requirement N" claim |
| `requirement.verbatim` | `requirements.ts` (JD extraction), stored at `schema.ts:327-359` | `swap_decision.verbatim_quote`, P4 citation validator (per schema.ts:325 comment) | `grep -n "verbatim " api/src/functions/tests/schema.ts \| head -3` → `schema.ts:332`: `verbatim text, -- posting substring at the offsets below, or null`; comment at `:322-325`: "`item_text` is what the MODEL wrote... `verbatim` is the EMPLOYER'S own words at [char_start,char_end) in `opportunity.jd_posting_snapshot`" | **EXISTS** — this is the durable pointer to "the original employer phrase" a reword link needs; it does NOT need to be re-stored as a second copy on `correction` |
| `requirement.id` survives re-extraction? | `appRequirements.ts` `writeRequirements` | any FK referencing `requirement(id)` | `grep -n "delete from requirement where opp_id" api/src/functions/tests/appRequirements.ts` → `:506` and `:535`, both unconditional `delete from requirement where opp_id=$1` on every re-extraction, followed by fresh `uuid_generate_v4()` inserts | **ABSENT (as a durable key)** — `requirement.id` is destroyed and reissued on every JD re-parse. `schema.ts:553-555` (`requirement_coverage`) and `:518-520` (`evidence_confirmation`) both state this explicitly and use `requirement_text` instead of `requirement_id` for exactly this reason. `swap_decision.requirement_id` (`schema.ts:642`, `on delete set null`) is the one place that DOES use the FK and accepts silent loss on re-extraction — see §3 below, this is directly relevant to the brief's "one new column: `requirement_id`" claim |
| where a reword pass sits relative to `applyCorrectionPass` / `normalisePackage` | `appPackets.ts` `ensurePackage` | `evaluateArtifact` (reads `p.pkg_json` fresh from the DB) | `grep -n "applyCorrectionPass\|normalisePackage(pkg\|update packet set pkg_json" api/src/functions/tests/appPackets.ts` → `:565` `applyCorrectionPass`, `:588` `normalisePackage`, `:626` `update packet set pkg_json = $1 ...`, all in that order, all before the function returns. `grep -n "p.pkg_json" api/src/functions/tests/appChecks.ts` → `:47`, `evaluateArtifact`'s own `select ... p.pkg_json ... from packet p` — a fresh read, not a cached argument | **EXISTS-BUT-CONSTRAINED** — there is no reword step today, but the SLOT for one is well precedented: `applyCorrectionPass` then `normalisePackage` then the `pkg_json` write is exactly the "correct before the user sees it" pattern (`appPackets.ts:557-562` comment), and `evaluateArtifact` (called strictly after `buildTemplatedArtifact`/`ensurePackage`, see `appPackets.ts:1189` `try { await evaluateArtifact(...) }` inside the post-build loop) always re-reads `pkg_json` from the DB rather than a stale in-memory copy |
| should `ATS_SHIPPED_FIELDS` include `ResumeSummary`, and what does that do to the number | `atsKeywords.ts:212-215` | `appChecks.ts:240` (`atsCoverage(table?.body, ATS_SHIPPED_FIELDS.map(...))`) → `keyword_coverage` | `grep -n "ATS_SHIPPED_FIELDS = " -A6 api/src/functions/tests/atsKeywords.ts` → the array is `SkillsBullets1/2, ExpertiseBullets, RelevantBullets1/2/3` — **ResumeSummary is not in it**, and the doc comment at `:206-210` names why: "the remediation loop is already known to stuff posting wording into it... Counting a keyword because it appears in a summary the pipeline copied from the posting would let the document score itself on the employer's own words" | **EXISTS-BUT-CONSTRAINED** — deliberately excluded today, and the exclusion is a real guard against exactly the self-scoring failure the reword pass would otherwise reopen if `ResumeSummary` were added to `ATS_SHIPPED_FIELDS` *before* a reword pass exists. Adding it back is only safe if it is EITHER (a) gated on the reword having actually run (paraphrased text, not raw JD wording), or (b) counted only via the requirement_id LINK (a distinguishable, explained source), never via the raw `keywordPresent()` substring/word-boundary test against unreworded ResumeSummary text |
| deterministic detector for "prose that near-echoes the employer's own sentence" (not numeric, not exact 8-token run) | none exists yet | n/a | `scanEcho` (`figureEcho.ts:344`) is NUMERIC figures only (currency/count/percent/range/spelled/magnitude — `figureEcho.ts:17-37`). `scanWording` (`figureEcho.ts:498`, feeding `posting_wording_kept`) requires an EXACT, CONTIGUOUS 8-token run (`WORDING_RUN_TOKENS=8`, `figureEcho.ts:433-441,466`). The brief's own measured example — "establishing governance and risk management practices" vs requirement #10 "Establish governance, security, and risk management practices" — breaks contiguity at the dropped word "security," so neither existing detector catches it (verified by inspection: the shared run "risk management practices" is 3 tokens, "governance" alone is 1, neither reaches 8) | **ABSENT** — this is a genuinely new detection gap, not something already caught and merely unused |
| existing design stance on machine-rewritten prose | `figureEcho.ts:422-445` (comment block on `scanWording`) | `posting_wording_kept` check (`checks.ts`, advisory `warn`) | Read `figureEcho.ts:422-445` verbatim: *"Nothing here rewrites prose, and nothing downstream may: a phrase can be the employer's house style, the industry's standard term, or the candidate's own sentence that happens to read like the ad. Only the user can tell which, and a machine that rewrites prose on a guess produces a resume the candidate did not write and cannot defend."* | **EXISTS-BUT-CONSTRAINED, and it is a real tension with the brief, not a formality** — this is a standing, deliberate design refusal against auto-rewriting on a wording-similarity guess. It does not by itself forbid the brief's narrower proposal (rewording spans that echo a specific `requirement.verbatim`, in a MODEL-authored field, not the candidate's own accomplishment prose) but it means the reword pass must be scoped tightly and reviewably (see §2 finding under "the design tension" and AC-6) rather than treated as an uncontroversial extension of `posting_wording_kept` |
| `api-deploy.yml` code-before-migration window | `.github/workflows/api-deploy.yml` | any route reading/writing a new column | `grep -n "Deploy to Azure Functions\|Apply the database schema" .github/workflows/api-deploy.yml` → `:81` deploy step, `:109` "Apply the database schema" step — code ships first, migration second | **EXISTS (confirmed hazard, but already mitigated by precedent)** — see §5/AC-9. `ensureCorrectionTable()` (`appCorrections.ts:63-96`) already self-heals `correction`'s schema (including the `frame` column via `alter table correction add column if not exists frame text`, `:89`) on EVERY route entry, ahead of pg-migrate. A new `requirement_text`-keyed column following the same pattern closes the window the same way `frame` already does, provided every new read/write site also calls `ensureCorrectionTable()` first (as all four existing call sites already do) |

**Overall feasibility verdict: BUILDABLE, with the design corrected on one point.** Nothing is
`ABSENT` in the sense of blocking the work; the storage substrate (`correction`), the rendering
substrate (`Marked`/`markRuns`), the durable requirement identity (`requirement.verbatim`,
NOT `requirement.id`), and the deploy-safety pattern (self-healing `ensureCorrectionTable`) all
already exist and are reusable. What does NOT hold as stated is the implementer's specific column
choice (`requirement_id` as an FK) — see §3.

---

## 2. THE ORDERING ARGUMENT — verified, HOLDS

**Claim to test:** scoring must happen AFTER the final reword, not before, because a score
computed on pre-reword text describes a document that never ships.

**Verified against the actual pipeline, not the analogy alone.**

```
grep -n "applyCorrectionPass\|normalisePackage(pkg\|update packet set pkg_json" \
  api/src/functions/tests/appPackets.ts
```
Result: `:565 applyCorrectionPass(...)` → `:588 normalisePackage(pkg, ...)` → `:626 update packet
set pkg_json = $1 ... where id = $3`, strictly in that order, inside `ensurePackage`, and nothing
after `:626` mutates `pkg` before `ensurePackage` returns.

```
grep -n "p.pkg_json" api/src/functions/tests/appChecks.ts
```
Result: `:47`, inside `evaluateArtifact`'s own top query — `select ... p.pkg_json ... from packet
p join artifact a ... where a.id = $1`. This is a **fresh SELECT against the database**, not a
value threaded in from the caller. Whatever the last `update packet set pkg_json` wrote is what
`evaluateArtifact` scores.

```
grep -n "buildTemplatedArtifact\|evaluateArtifact(client" api/src/functions/tests/appPackets.ts
```
Result: `evaluateArtifact(client, art.id, owner)` is called at `:1189`, inside the post-build loop
that runs strictly after `buildTemplatedArtifact` (→ `ensurePackage`) has already returned and
already written `pkg_json` for every artifact of the packet (`:843`/`:922`/`:1106` are the three
call sites of `buildTemplatedArtifact`, all upstream of `:1189` in the same route handler).

**So the pipeline ALREADY enforces "score what shipped, not what was drafted"** — this is not a
new pattern the reword pass would be introducing, it is the existing pattern
`applyCorrectionPass`/`normalisePackage` already follow, stated explicitly in the `appPackets.ts:
557-562` comment: *"Everything below this line reads the corrected package... Run it in
appChecks instead and `pkg_json` ... [is] written from the ORIGINAL text while the user reads the
corrected document — and the remediation loop credits closures against text that never
shipped."* That is the exact failure shape the brief cites (Call 1's ATS table describing a
superseded draft, reporting 0% on a resume placing 67% — `atsKeywords.ts:26-37`).

**Verdict: the ordering argument HOLDS, and a reword pass that ran AFTER `evaluateArtifact` (or
in a place `evaluateArtifact`'s `pkg_json` read cannot see) would reproduce the exact defect this
repo already paid for once.** The correct location is inside `ensurePackage`, after
`applyCorrectionPass` and after (or interleaved with) `normalisePackage`, and strictly before the
`update packet set pkg_json` write at `:626` — the same slot the P8.1/R1 correction pass already
occupies, for the same stated reason.

One qualification found by reading rather than assumed: `normalisePackage` (`normalise.ts:232`)
only touches **list fields** (character-limit shortening of bullet items) — a targeted grep for
`ResumeSummary` inside `normalise.ts` returns no hits — so there is no existing interaction to
preserve between a ResumeSummary reword and the list-normaliser; they operate on disjoint fields
and their relative order to each other does not matter, only that BOTH complete before the
`pkg_json` write.

---

## 3. EXTEND-DON'T-DUPLICATE — `correction` is the right TABLE, `requirement_id` is the wrong COLUMN

**Claim to test:** the reword is "a new `source` value plus ONE new column (`requirement_id`)" on
`correction` — not a new table.

### 3a. The table itself: HOLDS

`correction` already carries exactly the shape a reword needs to be stored, undone, and
audited — verified by reading `schema.ts:403-432` column by column against what a reword record
requires:

| What a reword needs to record | `correction` column that already does it |
|---|---|
| which field, which span was replaced | `merge_field`, `char_start`, `char_end` |
| the text that was there before | `phrase` |
| the text that replaced it | `replacement` |
| the field cannot have moved under it since | `before_sha256` (recomputed on revert, `schema.ts:399-401`) |
| document order / undo replay order | `applied_seq` |
| why | `reason` |
| which kind of correction this is | `source` (needs a 4th value) |
| coordinate system (pre- vs post-pipeline text) | `frame` |
| which remediation loop pass produced it | `loop` |
| undo, without deleting the record | `reverted_by`/`reverted_at` |
| the row cannot lie about its own span | `correction_span_matches_phrase` CHECK (`:426`) |

Every one of those already exists. A second table would duplicate all eleven columns and the four
CHECK constraints, which is precisely the parallel-system shape "Extend, don't duplicate" (this
repo's `CLAUDE.md`) forbids. **Verdict: extending `correction` HOLDS** — with one column, not a
new table, matching the implementer's claim.

The revert/audit machinery is also semantically compatible, not merely structurally compatible: a
reword IS a phrase→replacement span swap with a before-hash guard, exactly like `profile_figure`
and `generalized` corrections already are. Undoing a reword (restore the original phrasing) is the
same replay-minus-one-row operation `revertOne` (`correction.ts`, called from
`appCorrections.ts:199`) already performs for the other two sources. Nothing about "meaning
preserved but reworded" requires new revert semantics.

### 3b. The `source` widening: HOLDS, and the guard rails are already built for it

```
grep -n "source in (" api/src/functions/tests/schema.ts api/src/functions/tests/appCorrections.ts \
  api/test/sql/correction.sql
```
Result (already shown in §1): three homes, one value set, byte-identical. `H:correction-ddl-parity`
(`api/test/correctionDdlParity.test.mjs:35`), `H:correction-source-widened-by-alter` (`:63`), and
`H:correction-ddl-column-parity` (`:104`) already assert (a) the three homes agree, (b) the inline
CHECK and the ALTER admit the same values, (c) the ALTER runs textually after the `create table`
(H39/H39b ordering), and (d) all three homes declare the same column SET. **A 4th `source` value
(e.g. `'reworded'`) and a new `requirement_text` column would be caught by name if any home were
missed — the guard infrastructure for exactly this change already exists and does not need to be
built.** This is a second, independent point of feasibility beyond "the table shape fits": the
*safety net* for widening it is also already in place.

### 3c. The specific column, `requirement_id` (FK): REFUTED — must be `requirement_text` instead

This is the one place the implementer's claim does not survive contact with the code.

```
grep -n "delete from requirement where opp_id" api/src/functions/tests/appRequirements.ts
```
Result: `:506` and `:535` — `writeRequirements` runs an unconditional `delete from requirement
where opp_id=$1` **on every re-extraction of the posting**, then re-inserts fresh rows with
`default uuid_generate_v4()`. `requirement.id` is not stable across a JD re-parse.

This is not a theoretical risk this AC pass is inventing — it is a lesson the schema already
encodes, twice, in the immediate neighbourhood of where the brief wants to add a third FK:

- `requirement_coverage` (`schema.ts:567-599`, written by the very coverage judge this brief asks
  about in §4): *"KEYED ON THE TEXT, NOT ON THE ROW... `writeRequirements` runs `delete from
  requirement where opp_id=$1` on every re-extraction, so an id or a seq is destroyed or silently
  reused. `requirement_text` survives it."* (`:553-555`)
- `evidence_confirmation` (`schema.ts:515-539`): *"The requirement as EXTRACTED TEXT, never its id
  or seq — both are destroyed or reused by re-extraction. This is what survives `delete from
  requirement`."* (`:518-520`)

Both of the two existing tables that need to survive a JD re-parse and point at "this
requirement" made the SAME choice, for the SAME stated reason, and both explicitly reject
`requirement_id` as the key. A `correction.requirement_id uuid references requirement(id)` column
would behave exactly like `swap_decision.requirement_id` (`schema.ts:642`, `on delete set null`)
— the one place in this schema that DOES use the FK — which silently orphans to `null` the moment
the posting is re-extracted. For `swap_decision` that is a tolerated provenance loss (it is a
record of what one build's remediation did, not a live coverage claim). For a reword link that
feeds `keyword_coverage` — a component of the composite artifact score, i.e. a *currently live*
number the owner reads — silently losing the link on the next JD re-parse would make the score's
sourcing flicker for a reason invisible in the UI: exactly the kind of drift `H:correction-ddl-*`
and the "never fabricate a composite" rule exist to prevent.

**Verdict: extend `correction` — HOLDS. The specific column proposed, `requirement_id` as an FK —
REFUTED.** The new column should be `requirement_text` (or the same `verdict_key`-style composite
identity `requirement_coverage` already uses: requirement text + field + field text + model), not
an id. `requirement.verbatim` (the employer's original phrase, already stored and offset-anchored
at extraction time — §1) remains available for display by joining on `requirement_text` against
whichever `requirement` row currently exists for that opportunity; if none currently exists (a
re-parse dropped or reworded the requirement), the correct behaviour is the same one
`evidence_confirmation`/`requirement_coverage` already have for a stale key: the link is still
shown as "this paraphrase covered a requirement stated at the time" with the requirement's own
text quoted from the stored `requirement_text` column, not silently nulled.

---

## 4. THE REDUNDANCY QUESTION — genuinely two producers, not a distinction without a difference

**Claim to test:** does `chk_coverage_judge` (`requirement_coverage`, `appCoverage.ts`) already
make the reword link redundant?

**What the judge actually does, read from `appCoverage.ts` and `schema.ts:542-600`:**
`runCoverageJudge` asks a model, for each judgeable field of an artifact (`checkFieldsFor(type)` —
confirmed by grep below to include `ResumeSummary` for a resume), whether the CURRENT shipped
text of that field covers a given requirement, and if so stores `basis` (`direct` / `synonym` /
`near_phrasing` / `absent`), a `quote` + `char_start`/`char_end` **into the field text as it
currently reads**, and `why`. This verdict feeds `must_have_coverage` (`checks.ts:804-827`,
`judgeVerdicts` → `covers()`), one of the THREE components of the composite artifact score
(`artifact_score.must_have_coverage`, `schema.ts:825`).

```
grep -n "export function checkFieldsFor" -A3 api/src/functions/tests/checks.ts
```
Result: `checkFieldsFor(type)` returns `CHECK_FIELDS_FOR[type] || mergeFieldsFor(type)` (`:390-392`)
— for `resume`, `mergeFieldsFor('resume')` includes `ResumeSummary` (confirmed by the P1.5 comment
at `checks.ts:320`: *"The resume's seven merge fields are ResumeSummary, SkillsBullets1/2,
ExpertiseBullets and RelevantBullets1-3"*). **So the judge already runs on ResumeSummary today,
whatever it currently says, verbatim or reworded.**

**Where they genuinely differ — three separate axes, not one:**

1. **Which score component they feed.** The judge feeds `must_have_coverage`
   (`checks.ts:804-827`, `artifact_score.must_have_coverage`). The reword link, as scoped by the
   brief, feeds `keyword_coverage` (`atsKeywords.ts`, `artifact_score.keyword_coverage`) — a
   DIFFERENT, currently-interim, DIFFERENTLY-COMPUTED number (whole-phrase lexical presence against
   the resume's own ATS keyword list, `atsKeywords.ts:121-149`, deliberately NOT the judge's
   semantic verdict). These are two of the three named components of one composite
   (`artifactScore.ts:37,90`), and today `keyword_coverage` is null for every resume whose
   `ResumeSummary` is the ONLY field carrying a given keyword, because `ATS_SHIPPED_FIELDS`
   excludes it (§1). The judge cannot substitute for the reword link here because **it does not
   write to `keyword_coverage` at all** — it is structurally a different pipe.
2. **What each is a claim ABOUT.** The judge's `basis='direct'` on a `ResumeSummary` span that is
   the employer's own sentence with two words deleted is an HONEST verdict: the text really does
   cover the requirement, because it IS (nearly) the requirement's own words. That is not wrong,
   but it does not help the owner's stated goal — *"it needs a final step to... make sure the
   resume summary means verbatim but doesn't read verbatim"* — because the judge only reports
   whether coverage exists, never whether the WORDING is safe to ship. A `basis='direct'` verdict
   on a near-verbatim span is, if anything, the closest thing today to an automated detector for
   the exact rows the brief's evidence table shows (`opp 2cb56fb3`), and per finding in §1 it is a
   MODEL judgment (still no deterministic detector exists for this pattern).
3. **When each runs relative to the reword.** The judge is called from `evaluateArtifact`
   (`appChecks.ts:168-179`), which — per §2 — runs strictly AFTER the reword's natural placement
   (inside `ensurePackage`, before the `pkg_json` write). So once a reword pass exists, the judge
   will automatically re-run on the REWORDED text on every subsequent `evaluateArtifact` call —
   it does not need to be told the reword happened. But the reword pass, when it runs, does NOT
   have `requirement_coverage` rows to consult yet (they are written by the check route that runs
   afterward), so it cannot simply read the judge's prior verdict to decide what to reword — it
   needs its own detection of "this span is too close to the employer's wording" (§1's ABSENT
   row), which is a different, EARLIER-arriving fact than the judge's LATER coverage verdict.

**Verdict: genuinely two producers feeding two different score components, not a distinction
without a difference.** Building the reword link is not building a second `chk_coverage_judge`;
it is building the ONE MISSING piece — a deterministic-enough near-echo detector plus a stored
requirement link — that neither the judge (semantic coverage, doesn't touch `keyword_coverage`,
runs after the fact) nor `scanWording`/`posting_wording_kept` (contiguous 8-token exact match,
advisory-only, explicitly refuses to rewrite anything — §1) currently provide. The one place they
SHOULD interact, and do not yet: a future implementation could use `requirement_coverage.basis =
'direct'` verdicts as an additional signal for which ResumeSummary spans are reword candidates,
which would be extending the judge's existing output rather than duplicating it — noted here as a
design opportunity, not asserted as required.
