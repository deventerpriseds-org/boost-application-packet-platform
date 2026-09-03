<!-- WHAT:       The acceptance criteria for the ResumeSummary reword pass + paraphrase->requirement
               link. Continuation of AC-reword-carries-the-link.md, which delivered the feasibility
               table and settled the table/column/ordering/redundancy questions but stopped before
               writing a single criterion.
     WHY:       TIER 1 (admits model output into a stored claim feeding keyword_coverage).
                Implementation cannot start without binary, verifiable acceptance criteria.
     SUPERSEDES: nothing. Continues AC-reword-carries-the-link.md; does not replace it.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   every row cites the actual file/line read and, where a command was run, its output. -->

# AC — the reword criteria (continuation pass)

Executed against `BRIEF-ac-reword-criteria.md` on 2026-09-03, branch `claude/incumbent-wins-swap`.
No prompt in the Prompts table was read or touched.

## 0. What this pass inherits as SETTLED (not re-derived)

From `AC-reword-carries-the-link.md` §1-4, read in full before writing a single criterion below:

1. **`correction` is the right table.** It already carries `phrase`, `replacement`,
   `char_start`/`char_end`, `before_sha256`, `applied_seq`, `reason`, `source`, `frame`, `loop`,
   and the revert columns, plus `correction_span_matches_phrase`/`correction_span_ordered` CHECKs
   (`schema.ts:403-432`). Extend it; do not build a second table.
2. **The new column is `requirement_text`, not `requirement_id`.** `writeRequirements`
   (`appRequirements.ts:506,535`) runs an unconditional `delete from requirement where opp_id=$1`
   on every JD re-parse, and `requirement.id` is reissued (`default uuid_generate_v4()`) each time.
   `requirement_coverage` (`schema.ts:553-555`) and `evidence_confirmation` (`:518-520`) both key on
   TEXT for exactly this reason and say so in their own comments.
3. **The reword runs inside `ensurePackage`** (`appPackets.ts`), after `applyCorrectionPass` (`:565`)
   and before the `update packet set pkg_json` write (`:626`) — the same slot the P8.1/R1 correction
   pass already occupies, for the same reason: `evaluateArtifact` re-reads `pkg_json` fresh from the
   database (`appChecks.ts:47`), so anything scored is whatever was last written there.
   `normalisePackage` (`normalise.ts:232`) touches only list fields — a grep for `ResumeSummary`
   inside it returns no hits — so there is no ordering constraint against it specifically, only
   against the final `pkg_json` write.
4. **The reword link and the coverage judge (`chk_coverage_judge`) are two different producers**
   feeding two different score components — `keyword_coverage` (`atsKeywords.ts`) vs
   `must_have_coverage` (`checks.ts:804-827`) — not one system built twice.

**One inherited finding is a live, unresolved tension, and §1 below resolves it before any
criterion depends on the answer.**

## 1. Resolving the tension: `figureEcho.ts`'s refusal vs. the reword pass

`figureEcho.ts:422-445` is a standing design refusal, quoted in the brief:

> *"Nothing here rewrites prose, and nothing downstream may: a phrase can be the employer's house
> style, the industry's standard term, or the candidate's own sentence that happens to read like
> the ad. Only the user can tell which, and a machine that rewrites prose on a guess produces a
> resume the candidate did not write and cannot defend."*

**The reword pass is exactly the act that sentence forbids, narrowed.** The narrowing has to be
real — enforced by code, not by intent — or this AC pass would be rubber-stamping the thing the
refusal exists to block. Three narrowings, each verified against the actual code rather than
asserted:

**(a) Field scope: `ResumeSummary` only, as a closed allow-list, not a convention.**
`mergeFieldsFor('resume')` (`insertions.ts:61-63`, backed by `TEMPLATE_META.resume.placeholders`,
`packetTemplates.ts:23-25`) returns exactly seven fields: `ResumeSummary`, `SkillsBullets1`,
`SkillsBullets2`, `ExpertiseBullets`, `RelevantBullets1/2/3`. The other six are **keyword/skill
bullet lists whose entire purpose is literal keyword presence** — `atsCoverage`
(`atsKeywords.ts`) already scores `SkillsBullets1/2`, `ExpertiseBullets`, `RelevantBullets1/2/3` by
exact whole-phrase match (`keywordPresent`, `atsKeywords.ts:117`), and rewording a skill bullet to
avoid echoing the posting would make it fail the very test it exists to pass. `ResumeSummary` is
the only field in the type that is genuinely prose, which is why it alone is excluded from
`ATS_SHIPPED_FIELDS` for self-scoring reasons (`atsKeywords.ts:212-215`) rather than for skills-list
reasons. **This is a real, structural boundary, not an arbitrary starting point** — the six list
fields cannot be rewritten without defeating their own function, so "widen to more fields next
month" is not a plausible drift the way it would be for an arbitrary allow-list.
**AC-0a:** `Given` the reword pass's field allow-list, `when` it is read anywhere in the code,
`then` it is a single exported `const REWORD_FIELDS = ['ResumeSummary']` (or equivalent), never an
inline string literal repeated at each call site, and a guard (§9) fails if a second field is added
to it without a corresponding removal from `ATS_SHIPPED_FIELDS`'s self-scoring exclusion reasoning.

**(b) Trigger scope: a detected SPAN against a specific requirement, never a rewritten paragraph.**
The reword pass may only act where a new detector (§4 below) has matched a contiguous span of
`ResumeSummary` against one requirement's `verbatim`/`item_text` at a **near-echo** threshold
tighter than plain wording overlap. It replaces that SPAN with a substitute — the same
phrase→replacement shape every other `correction` row already has — never the whole field. This is
what keeps the automation narrow enough that "only the user can tell which" is honoured for
everything the detector does NOT flag: an unflagged sentence is never touched, by construction,
because there is no code path that rewrites text the detector did not name.

**(c) Confirmation: OWNER-CONFIRMED by default, not silently auto-applied.**
The precedent inside this same file cuts both ways and the AC pass must say which one wins, because
they disagree. `applyCorrectionPass`'s existing `generalized` corrections (figure generalisation)
auto-apply and log, with no confirmation step (`appCorrections.ts` — the pass runs, writes rows,
and returns; nothing asks the owner first). But a `generalized` row never rewrites prose — it turns
`$18M` into `8-figure` or a number into `multiple` (`figureEcho.ts:generalize`), which cannot alter
what the candidate is claiming to have done. A reword genuinely can (see AC-1's discussion of
meaning-preservation limits below), and that is precisely the harm `figureEcho.ts:422-445` names.
Two more facts push the same way: (i) the owner's own words — *"resolve the zero out of 12"* — led
this codebase to build exactly this kind of "model proposes, owner decides" gate for evidence rows
(`evidence_confirmation.decision`, `schema.ts`), including an explicit veto path, rather than
auto-crediting a model's excerpt; (ii) `checks.ts`'s `coverageJudge` and `reviewerAuto` both default
**off** specifically because they are model judgements that can move a number the owner reads,
with the owner switching them on once satisfied. A reword that changes what the resume *says* about
the candidate is at least as consequential as either.
**Where a PENDING proposal lives, since nothing in `correction` today can represent "not yet
applied."** Every row in `correction` today, of every existing `source`, is applied the instant it
is written — the revert path (`revertOne`) exists to undo an applied change, not to accept an
unapplied one, and its offset/hash invariants assume the phrase is CURRENTLY in the text. Rather
than bending that table to hold a state it was never designed for, a pending reword is **not a
`correction` row at all until accepted.** It is stored the same way `ensurePackage` already stores
other per-build-but-not-merge-field output — `packet.last_build` (jsonb), which already carries
`analysis` and `lineage` for exactly this reason (`appPackets.ts`'s `last_build` write, and the
`packetAnalysis` route that reads `last_build.analysis` back, `appPackets.ts:packetAnalysis`). A
new `last_build.pendingRewords` array (`{field, phrase, char_start, char_end, replacement,
requirement_text, reason}` per entry — the same shape a `correction` row would eventually take)
holds proposals nothing has accepted yet. **Accepting one is a new route**,
`POST /api/app/artifact/{artifactId}/reword/{index}/accept`, that does exactly what
`artifactOwnerEdit` already does for a manual edit (`appCorrections.ts:artifactOwnerEdit`): locate
the phrase in the CURRENT field text via `locateOwnerPhrase` (exact, unambiguous, or refuse — the
text may have moved since the proposal was computed), splice it, write ONE `correction` row with
`source='reworded'` and `frame='applied'`, update `packet.pkg_json`, and remove the entry from
`last_build.pendingRewords`. Rejecting one simply removes it from the pending array with no
`correction` row ever created — matching AC-3's "no substitute found" outcome exactly (nothing was
written, the text is untouched).

**AC-0c:** `Given` a detected near-echo span and a candidate reword, `when` the pass runs,
`then` it is appended to `packet.last_build.pendingRewords` and does NOT appear in the shipped
document or in `correction` until the owner accepts it through the route above, UNLESS the owner
has set a settings-store threshold `rewordAuto` (seeded `false`, following the
`reviewerAuto`/`coverageJudge`/`gateAdvisory` precedent in `CheckThresholds`, `checks.ts:132-179` —
never a hardcoded constant, per this repo's "no hardcoded config" rule) to `true`, in which case the
pass calls the accept logic itself at generation time and the reword ships applied and logged
exactly as a `generalized` correction does today. **A fresh owner who has touched nothing sees no
change in behaviour** — the same safety argument `reviewerAuto`'s own comment makes for itself.

## 2. AC-1 — the reword does not change meaning

**No fully deterministic test of semantic equivalence exists, and this AC pass says so rather than
hand-waving it, per the brief's explicit instruction.** Testing that two English sentences mean the
same thing is not a solved problem a `node --test` assertion can decide, and no function in this
codebase (or reasonably added to it) can either. **This is a NOT_APPLICABLE for a full semantic
proof.** What the ACs require instead is a set of deterministic PROXY controls, each independently
testable, that bound the failure without claiming to eliminate it — the same posture this codebase
already takes for `posting_wording_kept` (a judgement call surfaced to a human, never resolved by
the machine) and for the coverage judge (additive-only, never allowed to worsen a verdict on its
own say-so, `checks.ts`'s own comment on `covers()`).

- **AC-1a (content-word floor).** `Given` an original span and its candidate reword, `when` the
  reword is evaluated, `then` it is rejected (no correction written; falls through to AC-3) unless
  the reword retains at least a floor share of the ORIGINAL span's distinctive content words —
  reusing `itemTokens` (`swaps.ts`, already used by `coversIn`'s own distinctiveness rule,
  `checks.ts:200-207`) rather than inventing a second tokenizer. This does not prove meaning is
  preserved; it catches the coarse failure of a reword that drops the substance of the sentence
  along with its wording (e.g. "led the team" losing every noun).
- **AC-1b (no new figures).** `Given` a candidate reword, `when` it is scanned with `scanEcho`
  (`figureEcho.ts:344`) against the same posting and profile text already available at this point
  in `ensurePackage`, `then` it introduces no figure that `scanEcho` would flag as an echo. A reword
  is a wording change, never a channel for a fabricated or borrowed number — reusing the EXISTING
  detector rather than writing a second one keeps this from becoming a second, divergent figure
  rule.
- **AC-1c (revertible, exactly like every other correction).** `Given` an applied reword, `when` the
  owner reads the change log, `then` they can undo it through the EXISTING `correctionRevert` route
  (`appCorrections.ts`) with no special-cased code path — the reword row is a `correction` row like
  any other, so `revertOne`'s existing frame-aware unwind (`correction.ts:327-417`) is the safety
  net for a reword that reads wrong to the one person who can actually judge it. This is the
  **primary control**, not a backstop: per §1(c), an un-auto-applied reword is *shown before it
  ships*, so the owner's own read is the real meaning check, and revert is what makes a wrong call
  costless.
- **AC-1d (determinism / no re-roll drift).** `Given` an unchanged package (no `regen`), `when`
  `ensurePackage` is called again, `then` the cached `pkg_json` is returned unchanged (existing
  behaviour, `appPackets.ts:ensurePackage`) and the reword pass does not run a second time against
  already-reworded text — it must not compound (reword a reword), which the cache already prevents
  structurally as long as the reword pass sits where §0.3 places it (before the `pkg_json` write,
  inside the same generation that writes the cache).

## 3. AC-2 — every link points at real text

Two separate claims are bundled in "the link points at real text" and they need separate proofs,
because one is enforceable by a database CHECK and the other is not.

- **AC-2a (the SPAN is real — DB-enforceable).** `Given` a `correction` row with the new source
  value (§4 names it `'reworded'`), `when` it is inserted, `then` the EXISTING
  `correction_span_matches_phrase` / `correction_span_ordered` CHECKs (`schema.ts:426-427`) apply
  unchanged — they are generic over every `source` value already, so no new CHECK is needed for the
  span half of the claim. Verified by reading the CHECK definitions: neither references `source`.
- **AC-2b (the LINK is real — application-enforced, not DB-enforceable).** `Given` a reword linked
  to `requirement_text`, `when` the row is written, `then` the exact string stored must equal the
  `item_text` (or `verbatim`, whichever the detector matched against) of a `requirement` row that
  was loaded for this `opp_id` in the SAME generation call — verified by a unit test that feeds a
  fixture requirement set and asserts the stored `requirement_text` is byte-identical to one of the
  fixture's `item_text`/`verbatim` values, never a truncation, paraphrase, or concatenation of two
  requirements. This CANNOT be a DB constraint (there is no FK target stable enough to reference —
  see finding 2 in §0), so it is a property the writer enforces and a test proves by exercising the
  writer, not something `psql` can check.
- **AC-2c (a stale link after re-extraction is shown, not silently dropped or falsely re-verified).**
  `Given` a JD re-parse has deleted and re-inserted `requirement` rows, `when` the owner later views
  a resume built before the re-parse, `then` the reword's `requirement_text` is still displayed
  (matching `evidence_confirmation`/`requirement_coverage`'s existing behaviour of surviving on
  text rather than on `requirement.id`), and the display does NOT claim it corresponds to a
  currently-live requirement row unless one with matching text still exists — i.e., the UI's
  "covers requirement N" affordance degrades to "covered a requirement stated when this was built:
  `<text>`" rather than silently re-binding to whatever unrelated requirement now occupies a
  similar position.

## 4. AC-3 — no substitute found leaves the text alone, and says so

This mirrors `planCorrections`' own existing rule for figures with no honest generalisation
(`correction.ts:112-115,127-128`: `generalize()` returns null → no row is written, the span stays
in the document, and it remains a candidate for `posting_wording_kept` to list as an open item).

- **AC-3a.** `Given` a detected near-echo span for which no candidate reword clears the AC-1 floor
  controls (content-word retention, no new figures), `when` the pass runs, `then` NO `correction`
  row is written for that span, the field text is byte-identical to what it was before the reword
  pass ran, and the span remains visible to the existing `posting_wording_kept`/new-detector
  surfacing (§9) as an open item — never silently swallowed. This is the same shape as "absent
  evidence is `not_applicable`, never a pass": a span the pass looked at and could not fix must not
  disappear from every surface a human could catch it on.
- **AC-3b.** `Given` the field-level scan found no near-echo spans at all, `when` the pass runs,
  `then` `ensurePackage`'s warnings array (`built.warnings`, the same channel `applyCorrectionPass`
  already uses for owner-edit lapses) is NOT populated with a reword entry — a pass with nothing to
  do is silent, not falsely reassuring ("0 rewords needed" reads as a measurement only if something
  was actually scanned; §9's detector must be provably invoked, not merely provably absent of
  output).

## 5. AC-4 — coverage from a LINK is distinguishable from coverage from a PHRASE MATCH

Two mechanisms can make `keywordPresent()` (`atsKeywords.ts:117-149`) or a future consumer say a
keyword is "covered": the keyword literally appears as a substring of shipped text (today's only
path), or a `correction` row with `source='reworded'` links `ResumeSummary` to the requirement that
keyword came from, having deliberately AVOIDED the literal words. These are different strengths of
claim — one is "the document says it," the other is "the document says it differently, and we can
show why we believe that counts" — and collapsing them loses exactly the information the owner
asked for: *"link what the paraphrase/synonym covers... both need to connect to the requirement in
the UI regardless."*

- **AC-4a (storage distinguishes them).** `Given` a keyword counted via a reword link, `when` it is
  stored or reported, `then` its provenance is `'reword-link'`, distinct from `'phrase'` for a
  literal substring hit — extending `AtsKeywordRow` (`atsKeywords.ts`) with a `via` field rather than
  overloading `covered: boolean`, so a consumer cannot accidentally treat the two as
  interchangeable by construction (there is no boolean to collapse them into).
- **AC-4b (UI distinguishes them, reusing the existing mark primitive).** `Given` the resume screen
  renders `ResumeSummary` with `Marked`/`markRuns` (`AssetBlocks.jsx:670-686`, `highlight.js:28-31`),
  `when` a reword-linked span is displayed, `then` it uses a THIRD mark value (e.g. `mark: 'reword'`)
  distinct from the existing `'keyword'` and `'postingEcho'` — the primitive is already generic over
  `mark` as a free-form string key into `HIGHLIGHT_CLASS` (confirmed: `HIGHLIGHT_CLASS` has exactly
  two entries today, `highlight.js:28-31`), so this is additive, not a rewrite of the highlighting
  system. **This is a real, tested boundary, not a free extension** — `app/test/highlight.test.mjs`
  has guards that currently assume exactly two treatments (`'within a theme the two highlights are
  different colours AND different treatments'`, line 163) and that every swatch lives only in
  `theme.css` (`'no module contains a highlight swatch'`, line 193); both must be updated to admit a
  third treatment rather than bypassed. Clicking the reword mark opens the SAME margin-linkage
  pattern the keyword chips already use (`activeWording`/`openKeyword` state, `AssetBlocks.jsx:696-
  712`), pointed at the requirement text instead of a posting excerpt.
- **AC-4c (a vetoed/reverted reword removes both the text change and the coverage credit
  together).** `Given` an owner reverts a reword via `correctionRevert`, `when` the revert succeeds,
  `then` any keyword coverage credited via that link is recomputed on the next `evaluateArtifact`
  run against the reverted (original) text — no special-case code, because `keyword_coverage` is
  already recomputed from `pkg_json` fresh on every run (`appChecks.ts:236-244`) and a reverted
  field's `ATS_SHIPPED_FIELDS`/reword-link scan will simply no longer find the substitute text.

## 6. AC-5 — `ATS_SHIPPED_FIELDS` and `ResumeSummary`

The inherited feasibility table (§0, finding on `ATS_SHIPPED_FIELDS`) states the exclusion of
`ResumeSummary` (`atsKeywords.ts:212-215`) is a real, deliberate guard against self-scoring — the
comment there says counting a keyword because it appears in a summary the pipeline "copied from the
posting" would let the document score itself on the employer's own words — and that re-including it
is safe only if gated on the reword having run, or counted only via the link, never via the raw
substring test against un-reworded text.

- **AC-5a (the plain substring path over `ResumeSummary` is NOT reopened).** `Given`
  `ATS_SHIPPED_FIELDS` (`atsKeywords.ts:212-215`), `when` the keyword-coverage pass runs,
  `then` `ResumeSummary` is NEVER added to `ATS_SHIPPED_FIELDS` itself — `keywordPresent()`'s plain
  whole-phrase substring test continues to exclude it exactly as today. Any un-reworded but
  literally-present keyword in `ResumeSummary` (an accident, or a phrase the candidate wrote
  independently) is NOT credited by this path. This is the guard the inherited table calls "a real
  guard against exactly the self-scoring failure the reword pass would otherwise reopen" — reopening
  it silently would undo work this repo already paid for once.
- **AC-5b (a SEPARATE, additively-reported count for reword-linked coverage).** `Given` one or more
  `correction` rows with `source='reworded'` on `ResumeSummary` for the current artifact, `when`
  keyword coverage is computed, `then` a second, clearly-labelled count is added — following
  `atsCoverageSource`'s own discipline of naming its source in the sentence that travels with the
  number (`atsKeywords.ts:atsCoverageSource`) — e.g. `"N/M ATS keywords covered by a reworded
  ResumeSummary phrase, linked to the requirement it addresses"`. It is NEVER silently summed into
  the existing `covered`/`total` from `ATS_SHIPPED_FIELDS` without saying so: the owner must be able
  to tell "this rose because of the six list fields" from "this rose because a reword linked
  ResumeSummary to something," for the same reason `checks.ts`'s `must_have_coverage` names every
  model-warranted row rather than folding it silently into the numerator (`checks.ts`'s own
  `includedNote`/`excluded` pattern, e.g. `"2 on a model's proposal alone — counted until you veto"`
  — this AC reuses that PATTERN, not that code).
- **AC-5c (an un-reworded, un-linked `ResumeSummary` changes nothing).** `Given` a packet built
  before this feature exists, or one for which the reword pass found nothing to do (AC-3), `when`
  keyword coverage is computed, `then` the number is byte-identical to today's — no `correction` row
  with `source='reworded'` exists, so AC-5b's separate count is absent (not zero — `atsCoverage`'s
  own `NOT_PARSED`/null discipline applies: nothing to report is `reason: null` component simply not
  shown, never a `0` that reads as "measured and found none").

## 7. AC-6 — the `figureEcho.ts:422-445` refusal is honoured

§1 already resolved the substantive question (field scope, span scope, confirmation default). This
section states the criteria that make that resolution checkable rather than aspirational.

- **AC-6a.** `Given` the reword pass's field allow-list, `when` it is exercised against every merge
  field of every artifact type (not only `resume`), `then` it never fires on `compact_resume`,
  `cover`, or `portfolio` — none of their merge fields (`packetTemplates.ts:45-56`) is
  `ResumeSummary` except `compact_resume`'s own copy, and AC-6b below settles that case explicitly
  rather than by omission.
- **AC-6b (the compact resume shares the resume's `ResumeSummary` text, and shares its reword).**
  `compact_resume`'s template also declares `{{ResumeSummary}}` (`packetTemplates.ts:47`). `Given` a
  reword was applied to the resume's `ResumeSummary`, `when` the compact resume is rendered from the
  SAME `pkg`, `then` it renders the reworded text — there is one `pkg.ResumeSummary` value shared by
  both artifacts' templates (confirmed: both are filled from the same `pkg` object in
  `ensurePackage`/`renderArtifact`), so this requires no special-casing as long as the reword pass
  runs before BOTH artifacts are rendered from the shared package, which it already does per §0.3.
- **AC-6c (owner primacy: a reword never touches a span the owner has already edited).** This is a
  criterion the brief's minimum list does not name explicitly, and it is added here because it is a
  direct, foreseeable consequence of extending `correction`: `artifactOwnerEdit`
  (`appCorrections.ts`) lets the owner rewrite ANY span of ANY merge field, including
  `ResumeSummary`, and `applyCorrectionPass` already re-applies those owner edits (via
  `reapplyOwnerEdits`, `correction.ts:220-238`) BEFORE the point in `ensurePackage` where the reword
  pass would run (§0.3's ordering). If the reword pass's own near-echo scan is run against the
  post-owner-edit text with no exclusion, it could detect and rewrite the very words the owner just
  chose — silently undoing DECISION A (`schema.ts`'s own comment: *"an owner's own edit SURVIVES A
  REBUILD"*) one step further down the same function. `Given` the owner has an unrevoked
  `source='owner_edit'` correction on `ResumeSummary` for this artifact, `when` the reword pass
  scans the field, `then` it excludes the exact character range that owner-edit row currently
  occupies (located via `locateOwnerPhrase`, the SAME exact-and-unambiguous rule
  `reapplyOwnerEdits` already uses, `correction.ts:206-218`) from candidate spans, and reports
  nothing for that range even if it would otherwise match a requirement near-echo.

## 8. AC-7 — ordering and migration safety across the deploy window

`api-deploy.yml` deploys code at `:81` and runs the migration at `:109` (grep confirms these line
numbers point at "Deploy to Azure Functions" and "Apply the database schema" respectively). Code
ships first. `ensureCorrectionTable()` (`appCorrections.ts:63-96`) already self-heals `correction`'s
schema on every route entry — but reading it line by line surfaces a gap this feature would
otherwise walk straight into.

**Finding, not assumed:** `ensureCorrectionTable()` widens `frame` with its own
`alter table ... add column if not exists` + `drop constraint if exists` / `add constraint` pair
(`appCorrections.ts`, the `frame`-column lines), but it does **NOT** have any equivalent ALTER for
`correction_source_check` — only the inline `create table if not exists` declares the `source`
domain, which is a no-op on a table that already exists (every production database, since P8.1
shipped). Today this is latent and harmless, because the three currently-shipped `source` values
(`profile_figure`, `generalized`, `owner_edit`) reached production through `schema.ts`'s own ALTER
(`schema.ts`, the widening comment above `correction_source_check`), which DOES run — just later,
at migration time, not at `ensureCorrectionTable()` time. **Widening `source` to include a 4th value
for reword walks back into the exact deploy-window hazard `schema.ts`'s own comment already
describes for itself** ("between those two steps a route can run against a database whose CHECK has
not yet been widened, and an owner's edit is rejected by the database with the code already live"),
UNLESS `ensureCorrectionTable()` gets the same treatment `frame` already has.

- **AC-7a.** `Given` `schema.ts`'s `correction_source_check` is widened to admit the 4th value (§9
  names it), `when` `ensureCorrectionTable()` is next edited for this feature, `then` it ALSO gets a
  `drop constraint if exists correction_source_check` / `add constraint ... check (source in (...))`
  pair widened to the SAME value set, mirroring the `frame` column's existing precedent exactly —
  closing the deploy-window gap the same way `frame` already closes it, per the inherited
  feasibility table's own "confirmed hazard, but already mitigated by precedent" line, which this AC
  makes true by actually extending that precedent rather than citing it.
- **AC-7b.** `Given` the new `requirement_text` column, `when` it is added, `then` it is added via
  `alter table correction add column if not exists requirement_text text` in BOTH `schema.ts` and
  `ensureCorrectionTable()`, nullable (a row with no link, i.e. the four EXISTING sources, has none)
  — following the exact pattern `frame` set for itself (`schema.ts`'s own comment: "Nullable and
  unbackfilled by design... which is what makes every already-stored row undoable without touching a
  single one of them"). No backfill is required or attempted.
- **AC-7c (H39/H39b ordering).** `Given` any statement that names `requirement_text` or the widened
  `source` domain, `when` it appears in `schema.ts`, `then` it appears strictly AFTER the
  `create table if not exists correction` statement — the general rule this file already states for
  itself and already has two measured failures on record (a composite FK and a `create index` each
  naming a column an idempotent ALTER added later in the file).

## 9. AC-8 — do the three DDL-parity guards actually catch this change?

`H:correction-ddl-parity`, `H:correction-source-widened-by-alter`, and
`H:correction-ddl-column-parity` (`api/test/correctionDdlParity.test.mjs:35,63,104`) already exist.
Read literally against what they actually compare (not what their names suggest), rather than
assumed to "just work":

- **`H:correction-ddl-parity` (line 35) DOES catch a missed 4th `source` value in one of the three
  inline `create table` blocks.** It extracts the domain from each home's `correctionBlock` (the
  text between `create table if not exists correction (` and the first `);`) and asserts all three
  are textually identical. If `schema.ts`'s inline CREATE, `appCorrections.ts`'s inline CREATE, and
  `test/sql/correction.sql`'s CREATE do not all list the SAME four values, this test fails. **This
  guard is sufficient for the inline-CREATE half of the change, and needs no modification** — it is
  generic over the domain's contents, not hardcoded to three values (confirmed by reading
  `sourceDomains()`, which is a bare regex over `check (source in (...))` with no value list of its
  own).
- **`H:correction-source-widened-by-alter` (line 63) DOES catch a missed or mismatched ALTER — but
  ONLY for `schema.ts`.** It re-parses `schema.ts` specifically (`read('../src/functions/tests/
  schema.ts')` is hardcoded in this test) and asserts its ALTER matches its own inline CHECK. It has
  **no equivalent assertion for `appCorrections.ts`**, which is exactly the gap AC-7a names — this
  test would stay green even if `ensureCorrectionTable()` never got its own ALTER for `source` at
  all, because it never reads that file.
  **AC-8a (new guard required, not merely inherited).** `Given` AC-7a's requirement that
  `ensureCorrectionTable()` gets its own `source`-widening ALTER, `when` a test is written for it,
  `then` it extends `correctionDdlParity.test.mjs` with a new case,
  `H:correction-ensure-table-widens-source-too`, that parses `appCorrections.ts` for a
  `drop constraint if exists correction_source_check` / `add constraint ... check (source in (...))`
  pair and asserts its value set equals `schema.ts`'s ALTER's value set (the same shape
  `H:correction-source-widened-by-alter` already uses, pointed at the second home). Without this,
  the second file could ship the deploy-window gap AC-7a exists to close and no test would notice.
- **`H:correction-ddl-column-parity` (line 104) DOES catch `requirement_text` missing from one of
  the three homes' INLINE CREATE statements — but is structurally BLIND to it being added correctly
  via ALTER in only one or two homes.** `columnsOf()` only parses inside `correctionBlock` (the
  inline CREATE), exactly as the parity test does; a column delivered entirely by `alter table ...
  add column if not exists` (which is where `requirement_text` MUST live, per AC-7b and H39/H39b)
  never appears inside that block in ANY of the three files, so this guard would report all three
  homes agreeing (on a column none of them declares inline) even if only one of the three files'
  ALTER actually ran. **This mirrors exactly the blind spot `frame` already has in this same test**
  — `frame` is also ALTER-only and the existing test's `assert.ok(byHome[firstName].includes('frame'))`
  line only works because `frame` ALSO happens to appear in the test/sql fixture's inline CREATE
  (`test/sql/correction.sql`'s `frame text,` line), not because the guard parses ALTERs. The SAME
  trick keeps `H:correction-ddl-column-parity` honest for `requirement_text`: the fixture
  (`test/sql/correction.sql`) is a standalone file with no deploy-window constraint of its own (it
  is not applied through `ensureCorrectionTable`'s ALTER dance), so it can and must declare
  `requirement_text text` inline, giving the existing column-parity test real teeth for it exactly
  as it does for `frame` — no new test is required here, only remembering to update the fixture
  (§9's guard table makes this an explicit, mutation-proved line item rather than an implicit
  expectation).

## 10. AC-9 — every new guard, each mutation-provable with `scripts/mutate.sh`

Per this repo's rule, every guard below must be run through
`/workspace/eds-claude-skills/scripts/mutate.sh <file> <anchor-file> <replacement-file> <test-cmd>
<must-fail-pattern>` at implementation time, with an ABSOLUTE `cd` in the test command and a test
command that emits raw TAP (never piped through `grep -q`, which the harness cannot parse for a
verdict). This table names, for each guard, the file it lives in, the exact mutation that must make
it fire, and which prior AC it proves.

| Guard | Lives in | Proves | Mutation that must make it FIRE |
|---|---|---|---|
| `H:correction-ensure-table-widens-source-too` | `api/test/correctionDdlParity.test.mjs` | AC-7a/AC-8a | Delete the `drop constraint if exists correction_source_check` / `add constraint` pair from `ensureCorrectionTable()` in `appCorrections.ts`, leaving only the inline CREATE. Guard must fail. |
| `H:correction-source-widened-by-alter` (extended) | `api/test/correctionDdlParity.test.mjs` (existing test, new value set) | AC-7a | In `schema.ts`, widen the inline CREATE's `source` CHECK to include the 4th value but leave the ALTER at 3 values. Guard must fail (inline/ALTER mismatch). |
| `H:correction-ddl-parity` (existing, unchanged) | `api/test/correctionDdlParity.test.mjs` | AC-7a/AC-8 | Add the 4th `source` value to `schema.ts`'s inline CREATE only, leave `appCorrections.ts`'s inline CREATE at 3 values. Guard must fail. |
| `H:correction-ddl-column-parity` (existing, unchanged) | `api/test/correctionDdlParity.test.mjs` | AC-7b | Add `requirement_text text` to `test/sql/correction.sql`'s CREATE but omit it from `schema.ts`'s and `appCorrections.ts`'s inline CREATEs (which per AC-7b never declare it inline — they add it by ALTER). Guard must fail on the asymmetry. |
| `H:reword-span-matches-phrase` | reuses existing `correction_span_matches_phrase`/`correction_span_ordered` (no new test — AC-2a) | AC-2a | Insert a `source='reworded'` row with `char_end - char_start <> length(phrase)` directly against a live/local Postgres. Insert must be REJECTED by the existing CHECK (no application code involved). |
| `H:reword-requirement-text-required` | new DB CHECK in `schema.ts` + `ensureCorrectionTable()`: `check (source <> 'reworded' or requirement_text is not null)` | AC-2b | Attempt to insert a `source='reworded'` row with `requirement_text` NULL. Insert must be REJECTED. |
| `H:reword-fields-are-resumesummary-only` | new test, likely `api/test/reword.test.mjs` | AC-0a / §1(a) | In the reword module, add `'SkillsBullets1'` to `REWORD_FIELDS`. Guard must fail. |
| `H:reword-never-touches-owner-edit-span` | new test, `api/test/reword.test.mjs` | AC-6c | Remove the owner-edit-span exclusion filter from the candidate-span scan. Feed a fixture with an owner-edit row overlapping a detectable near-echo span; guard must fail (the reword touches the owner's span). |
| `H:reword-pending-until-accepted` | new test, `api/test/reword.test.mjs` | AC-0c | With `rewordAuto` at its seeded `false` default, make the pass write a `correction` row directly instead of appending to `last_build.pendingRewords`. Guard must fail (a `correction` row exists before acceptance). |
| `H:reword-introduces-no-new-figure` | new test, `api/test/reword.test.mjs` | AC-1b | Feed a candidate reword containing a fabricated figure not in the original span or the profile. Remove (or don't call) the `scanEcho` gate on the candidate; guard must fail (the reword is accepted despite the new figure). |
| `H:ats-shipped-fields-excludes-resume-summary` | new test or extension of `api/test/atsKeywords.test.mjs` | AC-5a | Add `'ResumeSummary'` to `ATS_SHIPPED_FIELDS` in `atsKeywords.ts`. Guard must fail. |
| `H:reword-link-count-separate-from-phrase-count` | new test, `api/test/atsKeywords.test.mjs` or `appChecks.test.mjs` | AC-4a/AC-5b | Merge the reword-link count into the same `covered`/`total` pair `ATS_SHIPPED_FIELDS` already produces instead of reporting it as a separate, labelled component. Guard must fail (the two provenances become indistinguishable in the output). |
| `H:mark-reword-is-a-third-treatment` | extends `app/test/highlight.test.mjs`'s existing "two highlights" assertions (line 163) | AC-4b | Reuse `'keyword'`'s `HIGHLIGHT_CLASS`/theme swatch for the reword mark instead of a distinct one. Existing "different colours AND different treatments" guard, extended to three, must fail. |

**Every guard above that touches `correction` reuses the SAME three-home parity machinery
(`correctionDdlParity.test.mjs`) rather than inventing a second — this is the "extend, don't
duplicate" rule applied to the guard suite itself, not only to the schema.**

## 11. The smallest first commit

**Contains, and proves something on its own:**
1. The schema half only — `source` widened to include the 4th value (name it `'reworded'`) in all
   three homes (`schema.ts` inline + ALTER, `appCorrections.ts` inline + NEW ALTER per AC-7a,
   `test/sql/correction.sql` inline), the new `requirement_text` column (nullable, ALTER-only per
   AC-7b, declared inline ONLY in the test fixture per §9's column-parity note), and the new DB
   CHECK from `H:reword-requirement-text-required`.
2. All THREE existing DDL-parity tests re-run and pass unchanged (proving the widening did not
   desync the three homes), plus the ONE new test, `H:correction-ensure-table-widens-source-too`.
3. The local-Postgres schema-execution discipline this repo requires for every schema change: apply
   `main`'s schema to a populated database, seed a few `correction` rows under the OLD 3-value
   domain, then apply this branch's schema on top and confirm exit 0 — proving the ALTER widens a
   database that already has rows, not only a fresh one.

**Deliberately does NOT contain:** the detector, the reword pass itself, the pending-storage
mechanism, the accept/reject routes, the `ATS_SHIPPED_FIELDS` change, or any UI mark. A schema
change with no reader is inert and safe to revert independently if the design in §0-9 above turns
out to need revision once real detector output is in hand — which is exactly the property "smallest
first commit, independently revertable" is asking for. It also means the highest-risk, most
speculative part of this feature (the detector's precision, and whether `rewordAuto`'s default is
right) is decided AFTER the boring, mechanically-verifiable part has already landed and been proven
correct against a populated database.
