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
