<!-- WHAT:       AC brief, part 2 of 2 -- a real score before the term library, and the reviewer that
                 has no caller.
     WHY:        Split from BRIEF-proposals-count-until-vetoed.md after that combined brief hit
                 max_tokens on the cross-container runner (run 33544936097, artifact TRUNCATED).
     SUPERSEDES: docs/qc-evidence/BRIEF-proposals-count-until-vetoed.md (workstreams C and D of it).
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   live DB reads against packet 85cee965 / opp 9f9c370a, quoted inline below. -->

# AC BRIEF (2 of 2) — a score before the library, and the reviewer nothing calls

Write ACCEPTANCE CRITERIA for work that has NOT started. Repo:
`/home/user/boost-application-packet-platform`, branch `claude/incumbent-wins-swap` at `79ceb12`.

**Write your artifact incrementally as you go.** A previous pass on this material died having
written nothing.

## THE OWNER'S INSTRUCTION, VERBATIM

> "…confirm a way to use what we gain to get the score until library is added to suppliment not
> drop it. why wouldn't the reviewer run when the packet is built?"

**The word "suppliment" is the constraint.** Whatever you design, the term library must later ADD to
the keyword component, never become a precondition for it again. Brief 1 of 2
(`BRIEF-proposal-counts-and-veto.md`) covers the must-have half of the score; do not duplicate it.

## THE SCORE, AND WHY IT IS NULL

`artifactScore.ts:25` — `DEFAULT_WEIGHTS = { mustHave: 0.5, keyword: 0.3, seniority: 0.2 }`, and
`computeArtifactScore` returns `composite: null` unless all three are non-null (`:148-150`). **Three
independent holes; any one of them nulls the whole score.**

- **must_have (0.5)** — brief 1. Out of scope here.
- **keyword (0.3)** — `appChecks.ts:209` counts published, scoreable `term_library_entry` rows and
  passes `keyword: scoreable > 0 ? { covered: null, scoreable } : null`. There are none, so
  `artifactScore.ts:137` yields *"no published term-library version has scoreable entries yet"*.
- **seniority (0.2)** — `appChecks.ts:220` hardcodes `seniority: null`.

## GROUND TRUTH — READ LIVE FROM THE PRODUCTION DATABASE, 2026-09-01

These are real reads against the owner's Trinnex packet `85cee965-f435-4b8e-910f-c806232092ce`
(opp `9f9c370a-4ac9-441e-b58e-02e3ffcf669e`, owner `von.ellis@enterpriseds.io`). They are the reason
this brief exists — the keyword source is not hypothetical, it is populated.

- `packet.covered_kw` — **11 terms**: Digital Technology Operations, Innovation, Director,
  Leadership, Technology Strategy, Process Improvement, Digital Transformation, Cross-Functional
  Collaboration, Stakeholder Management, Vendor Management, Budget Management.
- `packet.ats_score` — **85**.
- `packet.must_haves` — **NULL** on this packet, and `array_length = 0` on all eight of the owner's
  packets. Worth explaining; it may matter to brief 1.
- `packet.last_build->'analysis'` — **12 sections**, titles:
  `Job Description Summary`, `Missing ATS Skills`, `Missing ATS Swap Suggestions`, `Skills1`,
  `Skills2`, `Relevant Skills bullet list 1/2/3`, `Word and Character Requirements Check`,
  `Jobscan Extraction`, then `Job Description Summary` and `Word and Character Requirements Check`
  a second time.

**`Missing ATS Skills` is the denominator.** `covered_kw` is a numerator with no denominator stored;
that section names what is missing. Together they are a keyword-coverage ratio owing the term
library nothing.

## A LEDGER ROW THAT WAS STALE — corrected in commit 03393cc, verify the correction

`D:call3-returns-empty-and-14kb-is-discarded` said ~14 KB of ATS analysis is *discarded on every
build*. **That half stopped being true and nobody updated the row.** `collectAnalysis(c1, c2)`
(`packetBuild.ts:153`) captures every unmapped section, caps it (`ANALYSIS_SECTION_MAX` 4000,
`ANALYSIS_TOTAL_MAX` 24000, recording the FULL `chars` even when the body is truncated), and
`appPackets.ts:647` → `:1165` persists it to `packet.last_build.analysis` — which the DB read above
confirms is populated with 12 sections.

**What is still true and is now the whole row:**
- **Call 3 is never collected.** `pipeline.ts:536` reads `c3 = p3.value || {}` via `parseAgentJson`,
  so Call 3 is parsed as JSON and emits no `_unmapped` sections; `collectAnalysis` is called with
  `(c1, c2)` only. That is open task #19.
- **`last_build.analysis` has zero readers.** `grep -rn "last_build\|lastBuild" app/src/` returns
  nothing and `api.js` has no client for it. Captured, stored, and read by nobody.

## THE REVIEWER — confirm or refute this

`runReview` (`appReviewer.ts:91`) has exactly ONE caller: `artifactReviewRun` (`:369`), the handler
for `POST app/artifact/{artifactId}/review` (registered `:451`, with `artifactReviewGet` at `:452`).
`appPackets.ts` never calls it. `app/src/api.js` carries 26 `artifact/…` clients and none is
`/review` or `/review-result`. **Claim: the reviewer is built, deployed, LLM-backed and nothing in
the product calls it** — which alone nulls the composite regardless of the other two components.

## ANSWER THESE, WITH EVIDENCE

- **C1.** Is `covered_kw` + `Missing ATS Skills` a sound keyword-coverage source, or does it only
  look like one? Trace who WRITES `covered_kw` and `ats_score` (the jd-analysis path) and whether
  the two are computed over the same term set as each other. A ratio built from two different
  populations is the compare-two-proxies failure this repo forbids.
- **C2.** `Missing ATS Skills` is **free prose from a model**, not a list. What does parsing it into
  a countable set require, and what is the honest behaviour when the parse yields nothing? (The
  house rule: absent evidence is `not_applicable`, never `pass`; and a component with no source
  makes the composite null, never 0.)
- **C3.** `ats_score` is ALREADY a 0-100 number. Is the keyword component better served by using it
  directly, or by a `covered/(covered+missing)` ratio? These are different claims — one is a model's
  overall judgement, the other is a measured placement count. Say which the 0.3 weight is meant to
  represent, reading `artifactScore.ts`'s own comments.
- **C4. THE SUPPLEMENT RULE.** Design the shape so that when a term-library version IS published, it
  ADDS to this rather than replacing it, and say what happens to the number on the day that lands —
  the owner must not see the score jump for reasons that are not about their resume.
- **C5.** Should the source of the keyword component be visible to the owner (library vs ATS pass)?
  Note the repo rule that a partial or differently-sourced composite is the number a reviewer trusts
  most and the one most likely to be wrong.
- **D1.** Confirm or refute the no-caller claim above by reading the files.
- **D2.** If confirmed: WHERE should the reviewer be invoked — packet build, the checks run, or an
  explicit owner control? Justify by correctness, not convenience. **It costs a model call**, so an
  unconditional call on every build is a cost decision; per the repo's no-hardcoded-config rule, say
  whether it should be an owner-changeable setting and where that setting lives.
- **D3.** What does the score do between the reviewer being wired and its first run? Null is the
  honest answer; confirm nothing renders a 0 or a partial composite in that window.
- **D4.** `packet.must_haves` is NULL on all eight packets. Who was supposed to write it, and does
  anything read it? If nothing does, say so — that is an `ABSENT` verdict about a column, not a bug
  to fix here.

## REQUIRED OUTPUT, IN THIS ORDER

**1. FEASIBILITY TABLE FIRST** — `Dependency | Producer | Consumer today | Proof (command + result) |
Verdict`, verdict one of `EXISTS` / `ABSENT` / `EXISTS-BUT-CONSTRAINED` / `ALREADY BUILT`.
`ALREADY BUILT` is first-class: the `collectAnalysis` capture above is exactly that, and its AC is a
regression guard, not a feature.

**2. ACs** as `Given <context>, when <action>, then <observable outcome>` — numbered, binary, with
happy path, edge cases, error states, and a regression guard.

**3. Every guard that must be mutation-proved**, each with the exact defect to reinstate, using
`/workspace/eds-claude-skills/scripts/mutate.sh`.

**4. Anything in this brief that is WRONG.** The implementer wrote it and has been wrong about
shapes twice this session.

## BINDING RULES

- Absent evidence is `not_applicable`, never `pass`. A 200 with a zero count is a result to
  investigate, not a pass.
- Never fabricate a composite.
- "Should work" / "looks good" are banned.
- Hardening cases take a SLUG, never a number.
- **NEVER read or edit any prompt in the Prompts table** — the owner's own prompts drive the draft.

Suites: `cd api && npm test` (1022 passing), `cd app && npm test` (424 passing).
