<!-- WHAT:       AC brief for SPEC 4.6-8 (swap attribution): exact containment PROPOSES, a new judge
     CONFIRMS every claim the keyword panel makes, the exact ones included.
     WHY:        Owner's decision (`.claude/actions.md` ACT-68f, 2026-09-02) after rejecting a
                 three-option menu (`SCOPE-swap-driving-keyword.md`, ACT-68e): "I want a hybrid ...
                 the keyword can try and land x% and the judge can cleanup and confirm/settle the
                 rest", sharpened to confirm the exact matches too, because containment proves
                 PRESENCE, never CAUSATION.
     SUPERSEDES: nothing. Generation (`buildSwaps`, `call3`, the prompt) is untouched.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   docs/qc-evidence/SCOPE-swap-driving-keyword.md,
                 docs/qc-evidence/PROTOTYPE-COVERAGE.md (row 4.6-8),
                 .claude/actions.md (ACT-68d, ACT-68e, ACT-68f),
                 .claude/accuracy-log.md (2026-09-02 "no join exists" correction). -->

# AC BRIEF — swap attribution: exact PROPOSES, judge CONFIRMS (SPEC 4.6-8)

TIER 1 — a stored verdict from this judge is a claim the keyword panel will show the owner next to a
button that rewrites their document. Full AC pass required before any implementation.

## Already settled — do not re-open, do not re-derive

This capability was already scoped (`SCOPE-swap-driving-keyword.md`) and decided by the owner
(`.claude/actions.md` ACT-68f). Read both before writing anything. The scope doc costed three
options (A: structured generation: TIER 1, no backfill; B: exact-only, no causation claim: TIER 2;
C: leave PARTIAL) and recommended B first. **The owner rejected that menu and chose a fourth path**:
extend the three existing judges (`coverageJudge.ts`, `supportJudge.ts`, `stuffingJudge.ts`) with a
fourth that judges swap attribution, on the same contract — cite, code verifies the citation
byte-exact, exact rule remains as the cheap/fallback half. This AC pass is for THAT capability, not
for re-litigating A vs B vs C.

Prior work you should build on, not repeat:
- `swap_decision.requirement_id` -> `requirement.model_keyword` join: EXISTS, populated on 17 of 30
  live `swapped` rows on packet `2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3` (verify against the current
  fixture; do not assume the count is unchanged).
- That join is FUZZY: `requirement_id` is written by `attribute()` (`swaps.ts:224`) =
  `similarity()` token-set containment at `ATTRIBUTION_THRESHOLD = 0.34`, matched against the
  requirement's VERBATIM POSTING LINE, never against the keyword. It must be treated as a shortlist
  input to the judge, never as a claim.
- Guard already in place: `H:keyword-never-reaches-a-count` (grep `app/src` and its test suite) —
  the new capability must not weaken or bypass it.

## The user-visible goal

The keyword detail panel (`app/src/screens/AssetBlocks.jsx`, hook `blocks-keyword-detail`,
`app/src/assetBlocks.js` `keywordDisplacement`/`keywordDisplacementText`) should be able to say
"Took the place of &lt;original&gt;" and offer a `Put back "&lt;original&gt;"` control — SPEC 4.6-8,
prototype `docs/qc-evidence/qc/assets.jsx:53-88`.

## The design (owner-decided, sharpen only where the brief is silent)

Two passes. They do not overlap in what they claim.

1. **Exact containment PROPOSES a candidate link** — free, deterministic, no model: where
   `requirement.model_keyword` appears verbatim in the swap row's `to_label`, that pair is a
   candidate. This is presence, not causation.
2. **The judge CONFIRMS every claim the panel will show, the exact ones included.** Containment
   proves the keyword is present in the replacement; it never proves the swap was made FOR that
   keyword. So nothing reaches the screen as "Took the place of X" without the judge's confirmation,
   and the judge must CITE (from `to_label`, from the posting line, or both — an AC below must
   settle which) with the citation verified byte-exact by code before the verdict is stored, exactly
   as `coverageJudge.ts:18-24`/`stuffingJudge.ts`/`supportJudge.ts` already do.
3. **The judge does NOT re-derive from nothing** — it is handed the exact-containment result (or its
   absence) plus the 0.34 fuzzy `requirement_id` link as a SHORTLIST, to narrow which requirement(s)
   to ask about per swap row. Neither is shown to the owner as a claim in its own right; only the
   judge's verified verdict is.

## The system to EXTEND (read all three before writing a single AC)

- `api/src/functions/tests/coverageJudge.ts` — does this document answer this posting line?
- `api/src/functions/tests/supportJudge.ts` — does this profile excerpt show what the line asks?
  (Note its own header: version 1 of this judge shipped WRONG — handed the excerpt the first pass
  had already selected — and was corrected after independent review. Read that correction; it is
  the closest precedent for a judge that risks re-confirming its own upstream selection instead of
  independently deriving.)
- `api/src/functions/tests/stuffingJudge.ts` — is this passage name-dropping the ad's topics?

Shared discipline the new judge MUST inherit, each already proven out three times:
- Header contract `WHAT / WHY / SUPERSEDES / SUPERSEDED-BY / EVIDENCE`.
- The exact rule REMAINS as the cheap half and the fallback/proposal input.
- NOTHING CALLS THE NETWORK from the pure module. Transport is injected (`H12`).
- The model must CITE; code VERIFIES the citation byte-exact (`text.indexOf(quote)` on the
  UN-normalised original text, exactly as `parseCoverageVerdicts`/`parseStuffing`/
  `parseSupportVerdict` do it). A verdict whose quote is not byte-present is REFUSED before anyone
  sees it.
- Stored verdicts carry `judge_version` AND `prompt_version` separately (see `coverageJudge.ts`'s own
  comment on why two versions, not one), plus a cache key containing every input that can change the
  answer.
- Table shape to mirror: `requirement_coverage` (`api/src/functions/tests/schema.ts`, search
  `create table if not exists requirement_coverage`) — `quote`, `char_start`, `char_end`, `why`,
  `judge_version`, `prompt_version`, `model`, with DB CHECKs enforcing no-quote-no-claim and offset
  integrity (`check (covered = (quote is not null))`-shaped). A new table follows the same
  discipline: registered in `EXPECTED_TABLES`, added via idempotent DDL respecting H39/H39b ordering
  (a statement naming a column an idempotent ALTER adds must come after that ALTER).

## Hard constraints (binding; an AC that violates one is wrong, not a design choice)

- **Generation is NOT touched.** `buildSwaps` / `call3` / the prompt stay exactly as they are. The
  judge runs AFTER THE FACT on stored `swap_decision` rows, exactly like the other three judges run
  on stored artifact/profile text.
- **It must be re-runnable over EXISTING packets.** This is the stated advantage over Option A
  (structured generation) from the scope doc — pin it as an AC, with an observable proof (e.g. run
  it twice over the same unchanged rows and the cache key means the second run is free/no-op, or run
  it over a packet built before this feature existed and it produces verdicts with no backfill
  needed).
- **The 0.34 fuzzy link is DEMOTED to a shortlist input.** It may narrow which posting
  lines/keywords the judge is asked about. It must NEVER reach the screen as a claim on its own —
  pin this with a guard, not a comment.
- **No gate, no score, no coverage count may read the new verdict.** `must_have_coverage` and
  `evidence_placed` populations must not be merged, widened, or otherwise affected by this table or
  its verdicts. State how this is enforced (a guard, a grep, or both).
- **The keyword remains declared NEVER SCOREABLE** (`schema.ts` — `term_library_entry.scoreable`,
  `requirement.model_keyword`'s own comment). This judge's verdict is about PLACEMENT/DISPLACEMENT,
  never about coverage credit. State how the panel keeps saying "counts toward nothing" beside a
  confirmed displacement claim, so the two do not read as contradicting each other.

## Questions the ACs must settle (do not leave any unanswered)

1. Exactly what does the judge assert, and what must it quote — a span of `to_label` (the shipped
   replacement), of the posting line, or both? Which one(s) does code verify byte-exact, and against
   which stored field (must match a real column, not a synthetic concatenation — the same trap
   `requirement_evidence.source_key`/`verdictMap` exist to avoid)?
2. What is stored when the judge REFUSES, or when exact containment found nothing to propose and the
   judge is never asked? ("Absent evidence is not_applicable, never pass" — but this is a display
   feature with no gate; state the UI-facing equivalent.)
3. What does the panel render for each of: exact-containment-only (no judge yet), judge-confirmed,
   judge-declined/absent, judge-refused-on-citation? No dead UI; silence must look deliberate, not
   broken — reuse the existing "not comfortable claiming this?" / "counts toward nothing" idiom
   where it fits.
4. The two passes make DIFFERENT statements (owner's own framing): containment is a PLACEMENT claim
   ("X is in Y"), the judge's confirmation is a STRONGER claim ("Y replaced X because of the
   keyword"/"Took the place of X"). Should the panel word these two verdicts differently, or does
   the judge's confirmation simply unlock the stronger wording for cases containment alone proposed?
5. What is the cache key? `to_label` and `from_label` can each change on a re-run (a new packet
   build, loop N), and the requirement text and the prompt can each change independently — pin every
   input, following `coverageJudge.verdictKey`'s worked example (NUL-separated, sha256).
6. Which existing guards does this touch (the swap-count guards, `H:keyword-never-reaches-a-count`,
   any DDL-parity guard for `swap_decision`/the new table)? What NEW guard must be written and
   mutation-proven (`/workspace/eds-claude-skills/scripts/mutate.sh`) before this ships — at minimum,
   a guard that a citation failing byte-exact verification is refused, and a guard that no gate/score
   consumer imports the new module or table.
7. What is the cost shape? How many judge calls per packet (bounded by how many swap rows carry a
   `requirement_id`, or by exact-containment candidates only, or by something narrower)? Is it
   batched per-artifact/per-packet the way `coverageJudge`'s "ALL requirements in ONE call, per
   field" batching is, and why?
8. (Not in the original brief, but implied by "re-runnable over existing packets": ) Does this
   require a new API route to trigger a re-judge pass, a tick/cron, or is it invoked inline on
   packet build going forward and backfilled on demand? State which, and why — this determines
   whether Tier-1 review must also cover a route/auth surface.

## Feasibility table — publish this FIRST, above the ACs

One row per dependency this brief names, with the command you ran and its actual result. Verdict
EXISTS / ABSENT / EXISTS-BUT-CONSTRAINED. At minimum: the keyword/swap join, the three existing
judge modules and their shared contract, the `requirement_coverage` table as a DDL template, the
`H:keyword-never-reaches-a-count` guard, and the measured 17/30 and 2/17/8/17 figures from
`.claude/actions.md` ACT-68f — re-run the underlying query/count yourself against the current
fixture rather than citing the old numbers unchecked, and say plainly if they have drifted.

## Deliverable

Feasibility table, then numbered ACs in `Given <context>, when <action>, then <observable outcome>`
form. Each AC must be binary and checkable, and must not require reading the implementer's mind.
Flag anything that contradicts this brief, the scope doc, or the owner's decision in ACT-68f —
especially if part of this capability already exists and this pass would just be re-describing it.
Write to your artifact file incrementally as you go; do not hold everything for the final answer.
