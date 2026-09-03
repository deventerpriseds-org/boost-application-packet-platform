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
**AC-0c:** `Given` a detected near-echo span and a candidate reword, `when` the pass runs,
`then` it writes the reword as a **pending** proposal (see §2's storage shape) that does not appear
in the shipped document until the owner accepts it, UNLESS the owner has set a settings-store
threshold `rewordAuto` (seeded `false`, following the `reviewerAuto`/`coverageJudge`/`gateAdvisory`
precedent in `CheckThresholds`, `checks.ts:132-179` — never a hardcoded constant, per this repo's
"no hardcoded config" rule) to `true`, in which case it auto-applies and logs exactly as a
`generalized` correction does today. **A fresh owner who has touched nothing sees no change in
behaviour** — the same safety argument `reviewerAuto`'s own comment makes for itself.

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
