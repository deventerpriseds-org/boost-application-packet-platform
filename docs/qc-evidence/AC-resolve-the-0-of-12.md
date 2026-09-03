<!--
WHAT:       Independent, RETROSPECTIVE acceptance criteria for the work that resolves the owner's
            `must_have_coverage` reading 0/12 -- the profile-side `vetted` warrant, the A6 appeal,
            the stuffing lane, and the JD-panel display -- plus every place the shipped code and
            these criteria DISAGREE.
WHY:        The code was written BEFORE any AC pass. That is the process failure this document
            remediates, so it is written adversarially: criteria derived from the owner's problem
            statement and the diagnoses FIRST, compared to the implementation SECOND.
SUPERSEDES: nothing. Companion to AC-llm-coverage-judge.md (the document-side judge) and
            AC-llm-gate-and-stuffing.md. This one covers the PROFILE side and the gate numerator.
SUPERSEDED-BY: nothing -- current.
EVIDENCE:   docs/qc-evidence/DIAG-coverage-recognition.md (incl. A6),
            docs/qc-evidence/DIAG-summary-stuffing.md, .claude/actions.md
            (ACT:coverage-judge, ACT:resolve-the-0-of-12). Commits under review:
            fa6a9ca, 1557ead, 167d7e8, 8f21606, cee07a7, 155db07, 92c432d, ed7e453
            on `claude/incumbent-wins-swap`. All probe commands below were EXECUTED; their
            output is transcribed, not summarised.
-->

# AC — resolve the 0 of 12

## How this pass was run, and what it is allowed to conclude

**This is a retrospective, adversarial pass.** The order was: read the owner's words and the two
diagnoses; derive what the criteria SHOULD have been; only then read `supportJudge.ts`,
`evidenceProposal.ts`, `stuffingJudge.ts`, `checks.ts` and the settings surface; then report the
gaps in both directions — requirements the implementation missed, and scope it invented.

**The five sentences the criteria are derived from**, in the owner's words:

1. *"resolve the zero out of 12"*
2. *"it should certainly count paraphrasing and similar meaning not just exact quotes."*
3. *"a hack full of verbatim lines from the jd ... would get me accused of stuffing."*
4. *"what is done today by actors simply needs to be swapped by a model that can reason instead of
   word matching but only where it makes sense."*
5. *"dont ever ever ever weaken the refusal or any guard we have without pinging me."*

**Sentence 5 is the constraint on sentences 1-4, not a footnote to them.** Every criterion below is
written so that satisfying 1-4 cannot violate 5. Where the implementation had to choose between
them, that choice is examined in the DISAGREEMENTS section rather than accepted.

---

## FEASIBILITY TABLE — published FIRST, every row executed

Commands were run on `claude/incumbent-wins-swap` at `7fca865`. Output is transcribed.

| # | Dependency | Producer (who writes it) | Consumer today (who reads it) | Proof (command + result) | Verdict |
|---|---|---|---|---|---|
| F1 | `requirement_evidence.method` domain including `vetted` | `appRequirements.ts:375` `method = 'vetted'`; DDL `appRequirements.ts:55` + `schema.ts:1610` | `checks.ts:946` `isVetted`; `app/src/postingAnalysis.js:461` `vetted:` | `grep -rn "'vetted'" api/src app/src` → 6 hits: `evidence.ts:108` (type), `appRequirements.ts:55` (check constraint), `appRequirements.ts:375` (writer), `schema.ts:1610` (check constraint), `checks.ts:946` (reader), `postingAnalysis.js:461` (UI reader) | **EXISTS** |
| F2 | A `vetted` row entering the `must_have_coverage` NUMERATOR | `ruleEvidenceOf` — `checks.ts:947` | `must_have_coverage` (`checks.ts:1012`), `responsibilities_addressed` (`:1026`), `evidence_placed` (`:1043`) | `sed -n '947,948p' checks.ts` → `const ruleEvidenceOf = (r) => (isProposed(r) && !isConfirmed(r) ? null : evidenceOf(r))`. **`vetted` counts by NOT being `proposed`. No clause names it.** | **EXISTS-BUT-CONSTRAINED** — the warrant is implicit; see D-5 |
| F3 | The owner CONFIRM path (`confirmed_at`) that A5 called absent | `appRequirements.ts:982` `insert into evidence_confirmation`; withdraw at `:970` | `checks.ts:919` `isConfirmed`; UI buttons `PostingAnalysis.jsx:441-445` (`Yes, that is my evidence` / reject) | `grep -rn evidence_confirmation api/src` → table `appRequirements.ts:95`, join `:529`, **INSERT `:982`**, withdraw `:970`. `grep -n confirm app/src/screens/PostingAnalysis.jsx` → control at `:435-445` | **ALREADY BUILT** — **A5 ("read by two places, written by nothing") is STALE.** This materially changes the argument for `vetted`; see D-1 |
| F4 | `chk_coverage_judge` owner setting, with a default | `checkPrefs.ts:63` DDL default `${DEFAULT_THRESHOLDS.coverageJudge}` | `checkPrefs.ts:201` → `checks.ts` `CheckThresholds` | `grep -n "coverageJudge" checks.ts` → `:146` type, **`:203` `coverageJudge: false`** | **EXISTS, default OFF** |
| F5 | A Settings UI path to flip it (no-hardcoded-config rule) | `checkPrefs.ts` publishes `checkColumns`; screen renders from the API list | `app/src/screens/Settings.jsx:1588` copy for `chk_coverage_judge` (+ `_max`, `_min_quote`) | `grep -n chk_coverage_judge app/src/screens/Settings.jsx` → 3 hits, all label/help copy; field list itself comes from the API | **EXISTS** |
| F6 | ONE toggle driving THREE behaviours | `checkPrefs.ts:262-263` | `appRequirements.ts:330` (`appeal`), `:370` (`vetProposals`), `appChecks.ts:148` (coverage judge) | `sed -n '262,263p' checkPrefs.ts` → `appealOverclaims: t.coverageJudge === true,` / `vetProposals: t.coverageJudge === true,` | **EXISTS-BUT-CONSTRAINED** — one consent surface, three risk surfaces; see D-3 |
| F7 | `requirement_coverage` verdict cache table | `schema.ts:567`; registered `schema.ts:1652` | `appCoverage.ts` (cache/call/store) | `grep -n "create table if not exists requirement_coverage" schema.ts` → `:567` | **EXISTS** |
| F8 | The stuffing reader that sees non-contiguous lifting | `stuffingJudge.ts` (new, 128 lines); driven from `appCoverage.ts` | `checks.ts:641-648` folds `input.stuffingHits` into `posting_wording_kept` | `git show --stat ed7e453` → `stuffingJudge.ts` +128, `stuffingRead.test.mjs` +154, `checks.ts` +34 | **EXISTS** |
| F9 | `posting_wording_kept` remains non-blocking | `checks.ts:645-648` | the gate / `ready` | `sed -n '645,648p' checks.ts` → `bad('posting_wording_kept', ..., all, 'warn')` — severity literal `'warn'` | **EXISTS** (unchanged) |
| F10 | The JD panel surface that shows WHY a count moved | `postingAnalysis.js:461` `vetted` flag; `PostingAnalysis.jsx:504` render | the owner's screen | `git show --stat 92c432d` → `postingAnalysis.js +14`, `PostingAnalysis.jsx +21`, `postingAnalysis.test.mjs +46` | **EXISTS** |
| F11 | The A6 appeal over `verifyReasoning`'s withdrawal | `evidenceProposal.ts:262-283` | `appRequirements.ts:330` passes `appeal` | `grep -n "appeal" evidenceProposal.ts` → `:206` opt, `:257` "only reached when the exact rule ALREADY withdrew", `:263` `if (verdict.withdrawn && opts.appeal)`, `:273` `if (appeal?.overturned)` | **EXISTS** |
| F12 | `namedEntityTokens` — the population A6 says is wrong | `requirementSupport.ts:205` | `evidenceProposal.ts:497` `const named = [...namedEntityTokens(reqText)]` | `grep -n namedEntityTokens evidenceProposal.ts` → `:31` import, `:497` use. **Unchanged by this work** | **EXISTS-BUT-CONSTRAINED** — deliberately not narrowed; see D-2 |
| F13 | A green suite to regress against | `api/test/*.test.mjs` | CI / this pass | `cd api && npm test` → **`# pass 1011`, `# fail 0`**, duration 17.0s | **EXISTS** |
| F14 | The path that actually moves the owner's live number | `appRequirements.ts:211-216` deletes ALL evidence rows for the opp when `canEscalate`, then re-derives and may stamp `vetted` at `:375` | `must_have_coverage` | `sed -n '205,255p'` → `canEscalate ? delete ... where r.opp_id = $1 : delete ... and e.method <> 'proposed'`. So a re-resolve DOES re-derive and can upgrade. But it needs **BOTH** `escalate` (`chk_evidence_escalate`, default **ON**) **and** `vetProposals` (`chk_coverage_judge`, default **OFF**) — `checkPrefs.ts:258,263` | **EXISTS-BUT-CONSTRAINED** — the number moves only on a **re-resolve of that opportunity** with the judge toggle ON. It never moves passively; see D-4 |
| F15 | The safety rationale printed on the on-by-default escalation toggle | `checkPrefs.ts:252-258` comment | anyone reading why `escalate` may default ON | `sed -n '250,264p' checkPrefs.ts` → the comment justifying `escalate: t.evidenceEscalate !== false` reads: *"a proposed row ... can never count toward coverage ... It changes what the owner is told, never what they are scored."* **Five lines below it, `vetProposals: t.coverageJudge === true` makes that false.** | **EXISTS-BUT-CONSTRAINED — and STALE.** A live default is justified by an invariant the same function now breaks; see D-6 |

**The four rows that should change how this work is read:** **F3** (the confirm path the design
argument says does not exist, and does), **F6** (one switch, three risk surfaces, one help string),
**F14** (the number moves only on a re-resolve, never passively), and **F15** (an on-by-default
toggle still carrying the safety argument this work invalidated).

---

# THE ACCEPTANCE CRITERIA

Derived from the owner's five sentences and the two diagnoses, before reading the implementation.
Each is binary and observable. `must_have_coverage` is accusation-grade (tier 1) throughout, so
every criterion that touches its numerator is written to fail closed.

## Group A — what may move `must_have_coverage`'s numerator, and on whose warrant

**A-1.** Given a `requirement_evidence` row whose only warrant is a model's answer to a
**confirming** question (`method = 'proposed'`), when `must_have_coverage` is computed, then that
row must **not** be in the numerator, and the row must still be shown beside its requirement.
*(This is today's behaviour and sentence 5 forbids weakening it.)*

**A-2.** Given the owner has confirmed a row, when coverage is computed, then it counts — because a
person took responsibility for the claim. The confirm path must be reachable from the screen where
the requirement is read, and must require a verified session to write.

**A-3.** Given a new warrant is introduced that lets a model's reading reach the numerator, when
that warrant is defined, then it must satisfy **all four** of:
  a. the question asked must be **falsifying** (what does this NOT show), not confirming;
  b. the falsifying answer must **refuse the row in code**, before the model's own verdict is read;
  c. the row must carry a quote that is **byte-present** in the source it names, verified by an
     exact `indexOf`/slice comparison, not by similarity;
  d. the row must be **stamped with a distinct method** so it can never be counted, displayed, or
     audited as either a rule match or an owner confirmation.

**A-4.** Given any failure anywhere in that warrant's path — no transport, a throw, an unparseable
answer, a missing field, an uncited claim, a quote absent from the source, a cap exhausted — when
the pass completes, then the row's state must be **exactly what it was before the pass ran**. The
new path may only ever ADD a way to count. It must never withdraw, demote, or downgrade a row.

**A-5.** Given the new warrant exists, when `ruleEvidenceOf` (or any successor) decides the
numerator, then the criterion must be **positively named** — an allow-list of methods that count —
rather than inferred from the absence of `'proposed'`. A warrant that counts by not being excluded
silently admits every future method someone adds.

**A-6.** Given a count changed because a model was consulted, when the check emits its observed
string, then that string must state **how many** rows a model put in the numerator, in the same
sentence as the number itself — so "coverage rose" is falsifiable by the person reading it.

**A-7.** Given the numerator and denominator, when either is emitted, then a row excluded as
`not_applicable`, eligibility-only, or fact-owned must **never** be laundered into the numerator,
and every excluded population must be named in the observed string.

## Group B — what a model must produce before its reading is allowed to count

**B-1.** Given a model is asked the falsifying question, when its answer is parsed, then `missing`
must be read **before** `supported`, and a non-empty `missing` must refuse the row regardless of
what `supported` says.

**B-2.** Given the model claims support, when the row is stored, then the stored quote must be the
**source's own bytes at the found offsets**, never the model's returned string.

**B-3.** Given every refusal mode, when one occurs, then it must be **counted under its own name**
(a named gap, a declined verdict, an uncited claim, a fabricated quote, an unparseable answer, a
transport failure are six different facts about a run), and never collapsed into one bucket. An
outage and a finding must be distinguishable in the counts.

**B-4.** Given the same requirement and the same excerpt, when the pass is re-run, then the verdict
must be **cache-keyed on the text and the model and a ruleset version**, so a verdict a gate reads
cannot flip between runs for no reason, and a row can be attributed to the ruleset that produced it.

**B-5.** Given the pass is capped, when the cap is exhausted, then the remaining requirements must
be reported as **unjudged**, never as uncovered. "The judge did not answer" and "the rule says no"
are different facts, and reporting the second for the first is absent evidence read as a finding.

**B-6.** Given the falsifying pass is meant to be independent of the proposing pass, when it is
run, then it must be given **a materially different view** — at minimum the requirement plus the
source record, not merely the span the first pass already chose. A second question asked of the
same model about the same self-selected span is a weaker independence claim than it appears.
*(See D-1: the implementation does not satisfy this.)*

## Group C — the owner toggle, its default, and why

**C-1.** Given the no-hardcoded-config rule, when any model-judgement behaviour ships, then it must
be an owner-changeable setting with a UI path, and code may only seed the first value.

**C-2.** Given a setting that admits model output into a **stored, gate-deciding claim**, when its
default is chosen, then the default must be **OFF**. Reason, and it is not caution for its own
sake: the owner's standing instruction (sentence 5) is that no guard is weakened without being
pinged. Shipping this ON would change a live gate's arithmetic on every existing packet with no
act of consent, which is the weakening happening by deployment rather than by decision.

**C-3.** Given the default is OFF, when the owner is told the work is done, then they must be told
**in the same message** that (a) their number does not move until they flip it, (b) exactly where,
and (c) that a re-resolve of the opportunity is also required. A feature that resolves the owner's
complaint only after two unstated actions has not resolved it.

**C-4.** Given a toggle governs more than one behaviour, when its help text is written, then that
text must name **every** behaviour it enables — specifically, if flipping a switch labelled about
*documents* also admits a model-vetted **profile** row into the gate numerator, the help text must
say so. A consent surface that understates its own scope is not consent.
*(See D-3: the implementation does not satisfy this.)*

**C-5.** Given two behaviours with different blast radii — one that changes a **displayed** verdict
and one that changes a **gate numerator** — when toggles are designed, then they must be
**separately switchable**. The owner must be able to take paraphrase-aware display without also
taking model-warranted gate arithmetic.
*(See D-3: the implementation does not satisfy this.)*

## Group D — what the owner must be able to see about a count a model changed

**D-1.** Given a row counts because a model vetted it, when the requirement is rendered, then the
row must show, **without the reader opening a disclosure**: that a model put it there, the quote it
pointed at, and the reason. An argument nobody opens is an argument nobody checked.

**D-2.** Given a vetted row, when it is displayed, then it must **not** be phrased as the owner's
agreement, and the confirm/reject control must remain available — overruling it is the point.

**D-3.** Given the owner asked *"it still needs to tell me what is being covered and from the jd by
such paraphrasing"*, when a requirement is covered by paraphrase rather than by literal overlap,
then the screen must show **which JD line** is answered and **what text answers it**, distinguished
from a line that was merely cited at authoring time.

**D-4.** Given the counts on different surfaces answer different questions (authoring intent vs
profile evidence vs document placement), when they are shown together, then each must be labelled
with the question it answers, so two different numbers on one card are legible rather than
contradictory.

## Group E — the stuffing surface

**E-1.** Given a passage that scatters the posting's vocabulary without claiming the candidate did
any of it, when the checks run, then this must be **caught** — the contiguous-run detector is
structurally blind to it (measured: 0 offenders on a summary scoring 0 of 19 on coverage).

**E-2.** Given a passage that uses the employer's own noun **inside a real claim** ("led the SOC 2
certification"), when the checks run, then it must **never** be flagged. Flagging this is telling
the owner to write worse, and a guard people learn to ignore is worse than none.

**E-3.** Given a stuffing finding, when it is emitted, then it must be severity `warn` and must
**never** block a gate. Only the writer can say whether a phrase is the employer's sentence, an
industry-standard term, or their own voice. A model may raise it; it may not decide it.

**E-4.** Given a stuffing finding, when it is shown, then the phrase must be **byte-present in the
field text** it accuses, and each hit must carry a reason. An accusation naming an offender is
accusation-grade and must be exact.

**E-5.** Given the model read fails, returns nothing, or is switched off, when the check emits,
then the check's output must be **byte-identical to what it produces today**. A failed read raises
nothing.

**E-6.** Given a model DID raise a stuffing hit, when the exact half of the same check is
`not_applicable` (nothing to compare against), then the model's hits must still reach the owner —
a hit found by the half that worked must not be discarded because the other half had no input.
*(See D-7 / E-6: the implementation does not satisfy this.)*

## Group F — the regression guard when the feature is OFF

**F-1.** Given `chk_coverage_judge` is OFF (the default), when a packet is built and checked, then
every check's state, observed string, offender list and score must be **byte-identical** to the
behaviour before this work — proven by a test that pins the judge-less output, not by inspection.

**F-2.** Given the guard in F-1, when it is written, then it must be **mutation-proved**: reinstate
the old behaviour and confirm the suite fails. A guard comparing `undefined` to an absent field is
inert, and an inert guard is worse than none because it is believed.

**F-3.** Given the requirement that no guard is weakened, when `verifyReasoning`'s overclaim rule
is touched, then the **accusation itself must be byte-identical**; anything added may only overturn
a withdrawal on positive cited evidence, never cause one, and never narrow the population the rule
accuses over.

**F-4.** Given the `method` domain is widened, when it is widened, then every existing guard that
enumerates that domain must be **made to fire** and updated deliberately — a widened domain that
silently passes an existing exhaustiveness guard means the guard was not watching.

---

# DISAGREEMENTS — the point of this pass

Each row: what the implementation does, what these criteria would have required, and which I think
is right. Where I think the implementation is right, I say so; where I think it is wrong, I say that
plainly rather than hedging.

---

## D-1 — `supportJudge.ts` / `vetted`: is a model-challenged proposal a legitimate warrant for a gate-deciding count?

**What the implementation does.** `appRequirements.ts:370-383`: after a proposal has been made and
its quote verified, a second call is made — `parseSupportVerdict(contentJson(await fetchJson(
SUPPORT_SYSTEM, buildSupportUser(requirement, e.quote))), e.quote)`. If the model names nothing
missing, claims support, and cites a span byte-present in the excerpt, the row is re-stamped
`method = 'vetted'` and **counts toward `must_have_coverage`**. Every failure leaves it `proposed`.

**What my criteria required.** A-3 (falsifying question, code-enforced refusal, byte-exact citation,
distinct stamp) and A-4 (fail-closed). **The implementation satisfies A-3 and A-4 completely.** The
ordering property in `parseSupportVerdict` — `missing` checked at line 117, before `supported` at
118 — is genuinely good design, and it is enforced by code rather than hoped for from the model.

**Where it fails my criteria: B-6, independence.** The excerpt handed to the challenge is `e.quote`
— **the span the first pass chose** — and the citation must be byte-present in that same span. So
the challenge can only ever ask *"does this span show it?"*. It structurally cannot ask *"was this
the right span to look at?"*, and a mis-selected excerpt is the failure mode most likely to be
present, because selecting the excerpt is exactly what the first pass was for. It is also the same
model over the same `fetchJson` transport. The module header argues at length that this is not
"asking the same model twice"; on the ordering it is right, on the **view** it is the same model
twice over a strictly narrower input.

**Now the honest answer to the question posed.** Is this the house rule — *"a model may PROPOSE,
only an exact rule may ACCUSE"* — being traded away with extra steps?

**Yes. It is a trade, and the code should say so.** The rule's real content is not about the word
"accuse"; it is that **no model-only claim enters a stored, gate-deciding fact**. A `vetted` row is
a model-only claim (two model calls, no human, no rule that can read meaning) entering
`must_have_coverage`. The steps make the trade **safer** — they do not make it **compliant**.

**But the trade is AUTHORISED, and that is decisive.** The owner chose option (b) — *"b, but it
still needs to tell me what is being covered"* — **after** the house-rule concern was put to them
(`DIAG-summary-stuffing.md`, "OWNER DECISION"). Sentence 5 says do not weaken a guard *without
pinging me*; the owner was pinged and decided. So the outcome is right.

**What is wrong is the framing, and it is not cosmetic.** `checks.ts:925-931` says *"WHY THIS IS NOT
THE HOUSE RULE BEING QUIETLY DROPPED"* and argues the rule survives. It does not survive; it was
consciously spent, once, with permission. Recording an authorised trade as a technical non-event is
how the next session extends `vetted` further believing no permission is needed — the precise shape
of the accuracy-log failure this repo keeps re-earning. **The comment should read: the house rule
was traded, here is the owner's instruction that authorised it, and the next widening needs its own
ping.**

**A second overstatement, and F3 proves it.** `supportJudge.ts:4-8` and `155db07`'s message both
say *"NOTHING in the product could move it except the owner clicking twelve times."* The confirm
path is **built and reachable** (`appRequirements.ts:982`, buttons at `PostingAnalysis.jsx:441-445`)
— so the honest sentence is *"nothing could move it except twelve clicks, and the owner does not
want to click twelve times"*, which is a usability argument, not an impossibility. `A5` in the
diagnosis ("read by two places, written by nothing") is **stale** and was not re-checked before
being used as the premise for a gate change.

**Verdict: the implementation's mechanism is right and better than I would have specified; its
stated justification is wrong in two places, and both overstate the necessity of the change.**

**What I would have required in addition:** hand the challenge the **source record**, not the
proposal's span, so a mis-selected excerpt is detectable (B-6); and — the cheaper alternative
nobody costed — a **bulk confirm/reject affordance** over the 15 proposed rows, which resolves the
same 0/12 with a human accuser, no house-rule trade, and no model spend. That option is not
mentioned anywhere in the diagnosis, the ACT entry, or the commit messages. **It should have been
put to the owner beside option (b).**

---

## D-2 — `evidenceProposal.ts`'s appeal: right call, or the same weakening with more machinery?

**What the implementation does.** `namedEntityTokens` is left byte-identical. When the exact rule
withdraws an explanation AND `opts.appeal` is on, a model may defend each disputed term by quoting
a span of the excerpt, verified with `text.indexOf(span)` and `disputed.length > 0 && seen.size ===
want.size` — **every** term or nothing (`parseAppeal`, `:466-489`).

**My criteria: F-3.** The accusation must stay byte-identical; anything added may only overturn on
positive cited evidence, never cause a withdrawal, never narrow the accused population.
**The implementation satisfies F-3 exactly.**

**Is the appeal just narrowing with extra steps? No — and the difference is real, not rhetorical.**

| | narrowing `namedEntityTokens` | the appeal as built |
|---|---|---|
| scope | every caller, every row, permanently | only rows the rule ALREADY withdrew |
| direction | removes accusations, including correct ones (`Java`, `Amazon`) | can only restore, never withdraw |
| on failure | silently permissive forever | withdrawal stands (no transport, unparseable, uncited, partial defence) |
| consent | none — it would ship ON | gated on a toggle that defaults OFF |
| auditability | the accusation simply stops happening | the dispute is stored with the row that survived it |

Those are five different properties, not one property dressed up. **The appeal is the right call
under sentence 5**, and I would have specified it the same way.

**But it is disproportionate to its own payoff, and that is the criticism.** `verifyReasoning`
withdraws the **explanation**, not the row — `evidenceProposal.ts:305` returns
`kind: 'accepted'` with `reasoningWithdrawn: verdict.withdrawn`, and `appRequirements.ts:346-348`
inserts the row regardless. So what the appeal buys back is **a sentence of prose in `extra`**, at
the cost of an extra model call per withdrawn row. On the measured population that is 2 rows in 10.
Worth having; not worth being the reason A6 was called addressed.

**And the cheapest correct action was skipped.** Sentence 5 is *"don't weaken a guard without
pinging me"* — it names pinging as the path. The implementer identified a known-wrong population,
correctly declined to narrow it, and then **built a second model pass instead of asking the
one-line question**: *"`namedEntityTokens` counts any non-first capitalised word, so a Title Case
degree list produces `computer`/`software`/`engineering` as named entities — narrow it to
acronym-shaped tokens, or add an appeal?"* That is a $1 question in front of a $100 change, and the
repo's own rule asks for it. **Verdict: right mechanism, wrong process — the owner should have been
given the choice the code itself says is "the owner's to make, not mine."**

---

## D-3 — one toggle, three risk surfaces, one help string. **The implementation is wrong here.**

**What the implementation does.** `checkPrefs.ts:262-263` — `appealOverclaims` and `vetProposals`
are BOTH `t.coverageJudge === true`. The Settings help text (`Settings.jsx:1588-1589`) reads:

> *"Let a model judge what your documents cover ... a model reads both and decides — and it must
> quote the words **in your document** that do the covering, or its answer is thrown away."*

**What my criteria required.** C-4 (the help text must name every behaviour the toggle enables) and
C-5 (a display-changing behaviour and a gate-numerator-changing behaviour must be separately
switchable).

**The implementation fails both, and this is the most serious finding in the pass.** The owner
flipping a switch whose description is entirely about **their documents** also, invisibly:

1. admits a model-vetted **profile** excerpt into `must_have_coverage`'s numerator (`vetProposals`),
   which is the gate arithmetic, not a display; and
2. enables a model to overturn an overclaim withdrawal (`appealOverclaims`).

Neither appears in the help text. The word "profile" does not occur in it. **A consent surface that
understates its own scope is not consent** — and consent is the entire basis on which D-1 concluded
the house-rule trade was legitimate. The trade was authorised in conversation; the *toggle* does not
carry that authorisation to anyone who reads it later.

**What I would have required:** two settings — `chk_coverage_judge` (document side, display and
`evidence_placed`) and a separate `chk_vet_proposals` (profile side, gate numerator) — each with
help text naming what it changes, and the second explicitly saying *"a model's reading can then
count toward your coverage score."* Failing that, at minimum a rewritten help string on the single
toggle. **The one-line fix is the help text; the right fix is two toggles.**

---

## D-4 — does defaulting OFF satisfy *"resolve the 0/12"* at all?

**What the implementation does.** `checks.ts:203` `coverageJudge: false`. `ACT:resolve-the-0-of-12`
states it plainly: *"Until it is turned on, the live number stays 0/12 — the code is on `main` and
does nothing observable."*

**My criteria say the default is right (C-2) and the delivery is wrong (C-3).** Both halves matter.

**The default must be OFF, and I would have required it independently of what the implementer
chose.** Shipping ON would change a live gate's arithmetic on every existing packet with no act of
consent — that is sentence 5 violated by deployment rather than by decision. The owner asking for
the number to move is not the same as the owner authorising it to move without them looking. So on
the narrow question — *is OFF defensible?* — **yes, and it is the only defensible choice for a
tier-1 numerator.**

**But "resolve the zero out of 12" is not resolved, and the answer to the question as posed is
NO.** Two things must happen that the owner has not been asked to do:

1. flip `chk_coverage_judge` in Settings ▸ Quality; **and**
2. **re-resolve the opportunity** — `vetted` is only ever written during an escalation pass
   (`appRequirements.ts:370`), and existing rows are re-derived only because the pass deletes them
   first (`:211-216`, `canEscalate` branch). Nothing re-stamps stored rows in place.

**Step 2 is documented nowhere.** `ACT:resolve-the-0-of-12` names only the toggle: *"Turning it on
is one toggle in Settings ▸ Quality, or one `db-query.yml` UPDATE."* An owner who follows that
sentence exactly will flip the switch, reload, **still see 0/12**, and reasonably conclude the work
did not do anything. That is the worst available outcome for this particular ticket, and it is a
one-sentence omission.

**Verdict: correct default, incomplete delivery.** C-3 is unmet. The work should not have been
reported without the two-step instruction and, ideally, without the owner's number having actually
been observed to move once on their real packet.

---

## D-5 — the numerator counts `vetted` by ABSENCE, not by name. **Wrong, and the code knows it.**

`checks.ts:947`:

```ts
const ruleEvidenceOf = (r) => (isProposed(r) && !isConfirmed(r) ? null : evidenceOf(r))
```

`isVetted` is defined at `:946` and is **not used here** — it is used only to build the display note
at `:1002`. A `vetted` row counts because it is *not* `'proposed'`. The comment at `:942` admits
exactly this: *"`judged` counts because it is not `proposed`, not because of a clause naming it.
That is easy to break by widening `isProposed` and easy to miss."*

**My A-5 required a positive allow-list.** The difference is not stylistic: with the current form,
**any future `method` value counts toward the gate the moment it is added to the CHECK constraint**,
with no edit to `checks.ts` and no test necessarily failing. The guard named in the comment
(`H:a-judged-row-counts-and-a-proposed-one-does-not`) pins the two methods that exist today; it
cannot pin a method nobody has written yet.

**Verdict: the implementation is wrong.** `ruleEvidenceOf` should read from an explicit
`COUNTS_TOWARD_COVERAGE = new Set(['exact','anchored','vetted'])` (plus `confirmed_at`), so a new
method defaults to **not counting** and someone must deliberately add it. Fail-closed is the whole
posture of this file everywhere else; this one line is fail-open.

---

## D-6 — a live default still carries the safety argument this work invalidated

`checkPrefs.ts:252-258`, justifying `escalate: t.evidenceEscalate !== false` (**ON by default**, at
the owner's explicit instruction):

> *"What makes that safe is not the toggle but `checks.ts`: a proposed row is shown beside a
> requirement and **can never count toward coverage** ... It changes what the owner is told, **never
> what they are scored**."*

**Five lines below it, in the same returned object, `vetProposals: t.coverageJudge === true`.** When
the judge is on, an escalated proposal **can** be promoted to `vetted` and **does** change what the
owner is scored. The sentence that justifies an on-by-default toggle is now false in exactly the
configuration this work introduced.

**My criteria (F-1/F-2 in spirit, and the repo's own "fix all consumers" rule) required that every
statement of the invariant be updated in the commit that breaks it.** This one was not.

**Verdict: the implementation is wrong**, and it is the cheapest fix in this document — a comment
edit. It matters because it is the *rationale a future session will read* when deciding whether
escalation may stay on by default. Left as-is, it argues for a safety property the system no longer
has.

---

## D-7 — the stuffing lane: what it must catch, must never flag, and may never block

**Against E-1 (catch scattered lifting): PASS.** `stuffingJudge.ts` exists precisely for the shape
`scanWording` cannot see, and the measurement that motivates it (0 offenders on a passage scoring
0 of 19) is recorded in the module header.

**Against E-2 (never flag a real claim): PASS, and well done.** `STUFFING_SYSTEM` carries the
contrast explicitly — *"led the SOC 2 certification" is a claim; "familiar with SOC 2, ISO 27001 and
NIST" is a list* — and states the cost of over-flagging. This is the harder half and the
implementation took it seriously.

**Against E-3 (never blocks a gate): PASS.** `checks.ts:648` emits with the literal severity
`'warn'`, unchanged.

**Against E-4 (byte-present, reasoned): PASS.** `phrase_not_in_field` is named as *"THE
accusation-grade check"*, with `no_reason` and `empty_phrase` beside it.

**Against E-5 (off/failed read is byte-identical): PASS**, and mutation-proved per the commit
message (five guards, including one re-run after the first mutation hit the wrong off-switch).

**Against E-6: FAIL, and it is a real defect.** `checks.ts:622-626`:

```ts
const wBlocked = wScans.find(x => x.r.notApplicable)
if (wBlocked) {
  out.push(na('posting_wording_kept', wBlocked.r.reason || 'nothing to compare against', WORDING_EXPECT))
} else { ... const sHits = (input.stuffingHits || []) ... }
```

`scanWording` returns `notApplicable` when there is **no posting text** *or* **no profile text**
(`figureEcho.ts:503,507`). The model's stuffing hits need the **field text and the posting** — they
never needed the profile. So when `profileText` is empty, the check goes `not_applicable` and
**every model-found stuffing hit is silently discarded**, for a reason that does not apply to them.

This is not hypothetical: `DIAG-summary-stuffing.md` records a probe hitting exactly this condition
(*"it passed an empty `profileText`, and `scanWording` correctly returns `notApplicable`"*), so an
empty profile is a state this system reaches.

**Verdict: fold the two halves after the applicability test, not before.** The exact half may be
`not_applicable` while the model half has findings; the check should then report the model's hits
and say the exact half could not run. As written, the owner's originally-reported symptom goes
unreported in precisely the degraded state where they are least likely to notice.

---

## D-8 — scope the implementer invented that nobody asked for

**Very little, and this deserves saying** — I went looking for it and mostly did not find it. Each
lane traces to an explicit instruction: the judge to *"swapped by a model that can reason"*; the
`verifyReasoning` appeal to *"add verifyReasoning to the judge scope"*; the stuffing lane and the JD
panel to *"continue dealing with the support in the stuffing Lane showing the verdict and reasoning
and the JD panel etc"*; the `judged`→`vetted` rename to the owner's own mid-build objection.

Two items are genuinely the implementer's own choice rather than a request:

1. **The `vetted` warrant itself, chosen over strengthening the existing confirm path.** Not
   invented scope exactly — it serves the owner's decision for option (b) — but it is a
   *mechanism* choice presented as the only available one, and the alternative (D-1) was never put
   up for comparison.
2. **`chk_coverage_judge_min_quote` and `chk_coverage_judge_max` as owner-facing settings.** These
   are correct under the no-hardcoded-config rule and I would not remove them; noted only because
   three new knobs on the Quality screen is a real cost to a screen the owner has to understand,
   and two of them exist to bound spend rather than to express a preference.

**Verdict: scope discipline was good.** The problems in this document are about *justification*,
*consent surface* and *delivery* — not about building things nobody asked for.

---

# SUMMARY — where the implementation and these criteria disagree

| # | Area | Criterion | Verdict | Who is right |
|---|---|---|---|---|
| D-1 | `vetted` as a gate warrant | A-3, A-4, B-6 | mechanism **PASSES** A-3/A-4; **FAILS B-6** (challenge sees only the first pass's span); justification overstates necessity twice (A5 stale, confirm path exists) | **Implementation on the mechanism. Me on the framing** — it IS a house-rule trade, authorised, and must be recorded as one |
| D-2 | A6 appeal vs narrowing | F-3 | **PASSES** — five properties separate it from narrowing | **Implementation** — but the owner should have been given the choice the code says is theirs |
| D-3 | One toggle, three behaviours, one help string | C-4, C-5 | **FAILS BOTH** | **Me.** Most serious finding: the consent surface does not disclose the gate change |
| D-4 | Default OFF | C-2, C-3 | default **PASSES**; delivery **FAILS** — the re-resolve step is documented nowhere | **Implementation on the default. Me on delivery** — "resolve the 0/12" is not resolved |
| D-5 | `ruleEvidenceOf` counts by absence | A-5 | **FAILS** — fail-open on any future `method` | **Me** |
| D-6 | Stale safety rationale on escalate-default-ON | F-1 | **FAILS** — comment argues an invariant the same function now breaks | **Me** (one-line fix) |
| D-7 | Stuffing lane | E-1…E-6 | **PASSES E-1 to E-5**; **FAILS E-6** — model hits dropped when the exact half is `not_applicable` | **Implementation on five of six. Me on E-6** |
| D-8 | Invented scope | — | essentially none | **Implementation** |

## The three things I would change before this is called done

1. **Split the toggle, or at minimum rewrite its help text** (D-3) — the owner cannot consent to a
   gate change described only as a document change.
2. **Make `ruleEvidenceOf` a positive allow-list** (D-5) — fail-closed, like everything else in that
   file.
3. **Tell the owner both steps** (D-4) — flip the switch AND re-resolve the opportunity — and
   observe the number move once on their real packet before reporting the 0/12 resolved.

Then the two cheap corrections: the stuffing `not_applicable` branch (D-7/E-6) and the stale
comment at `checkPrefs.ts:252` (D-6).

## What this pass could NOT establish

- **Nothing was verified against the owner's live data.** The `boost-pg-mcp-write` connector
  reports as requiring authentication in this session, so the 15-of-17-proposed measurement, the
  0/12 itself, and whether a re-resolve with the judge ON actually moves it are all **carried from
  the diagnosis, not re-measured here.**
- **No model was called.** Every judgement about `supportJudge`, the appeal and the stuffing read is
  from reading the code and running the suite (1011/1011), never from observing a real verdict.
- Therefore: **"implemented, mechanism verified locally, NOT yet confirmed live"** remains the
  correct status, and D-4's second step is the reason it cannot be upgraded yet.
