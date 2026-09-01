<!--
WHAT:       Why the current build's ResumeSummary reads as JD keyword-stuffing when the owner's
            JotForm flow, driving the SAME prompts, did not.
WHY:        Owner, 2026-09-01: "this one is a hack full of verbatim lines from the jd that isn't
            subtle at all and would get me accused of stuffing. investigate."
SUPERSEDES: nothing.
SUPERSEDED-BY: nothing -- current.
EVIDENCE:   executed probes /tmp/probe.mjs, /tmp/probe2.mjs, /tmp/probe3.mjs against
            api/dist at 1c43ea8; outputs transcribed verbatim below.
-->

# The summary is stuffed because the coverage predicate PAYS for stuffing

## Verdict up front

**This is not a prompt-quality problem and not a model failure.** The owner's prompts still drive
Call 1 and are untouched. The P3 remediation loop — which is OUR addition, absent from the JotForm
flow — scores a requirement as closed by **literal content-word overlap with the employer's own
sentence**, and rewrites `ResumeSummary` until that score is met. Copying is the only strategy that
satisfies the objective function. Paraphrase is scored as failure and triggers another pass.

## OBSERVATION 1 — the objective function requires literal copying

`api/src/functions/tests/checks.ts:263-282`:

```ts
export const COVERAGE_THRESHOLD = 0.7
export const MIN_JUDGEABLE_TOKENS = 3

export function coversIn(covText, r) {
  const toks = itemTokens(r.verbatim || r.item_text)   // content words; ~60 stopwords stripped
  if (toks.length < MIN_JUDGEABLE_TOKENS) return false
  const hit = toks.filter(tk => covText.includes(tk))  // LITERAL substring test
  if (hit.length / toks.length < COVERAGE_THRESHOLD) return false
  const distinctive = toks.filter(tk => tk.length >= 6)
  return distinctive.length === 0 || distinctive.some(tk => covText.includes(tk))
}
```

`itemTokens` (`swaps.ts:131`) keeps content words. So closing a requirement demands **70% of the
employer's content words appear verbatim in the candidate's text.**

### Executed — `/tmp/probe.mjs`, api/dist at `1c43ea8`

Requirement: *"Experience designing and operating cloud-native microservices on Kubernetes at
enterprise scale"* → tokens `[designing, operating, cloud-native, microservices, kubernetes,
enterprise, scale]` (7).

| Candidate `ResumeSummary` | overlap | `coversText` → requirement CLOSED? |
|---|---|---|
| A. subtle paraphrase — *"…scaled distributed platforms and container orchestration for large regulated enterprises."* | 2/7 = 0.29 | **false** |
| B. partial echo | 3/7 = 0.43 | **false** |
| C. near-verbatim lift of the JD sentence | 7/7 = 1.00 | **true** |

**There is no paraphrase that reaches 0.70.** A subtle summary leaves the requirement OPEN, so
`decidePass` runs another pass against the same predicate and pushes harder toward the JD's words.

## OBSERVATION 2 — `ResumeSummary` is in scope on EVERY pass, and subtlety guarantees it

- `remediation.ts:348` — `STRUCTURAL_FIELDS = ['@Company', '@CoverLetterDate']`. That is the entire
  exclusion list. `ResumeSummary` is a template placeholder (`packetTemplates.ts:25`), so a
  remediation pass may rewrite it.
- `remediation.ts:390-396` — `scopeForRequirements` **withholds** only a field that is the SOLE
  evidence for an already-closed requirement; everything else goes into `fields`. A generic,
  tasteful summary covers no requirement, so it is never withheld. **The more subtle the summary,
  the more certainly the loop rewrites it, every pass.**
- `appRemediation.ts:204,238` — `lastScope.fields` is passed straight to `regenerateFields`.

## OBSERVATION 3 — the prompt forbids INVENTING, never COPYING

`remediation.ts:506-526`, `buildScopedPrompt`. The system message:

```
NEVER invent an employer, a metric, a title, a date, a certification or a system the profile does not contain.
```

The user message hands the model the employer's exact sentences:

```ts
'REQUIREMENTS THE DOCUMENT DOES NOT YET EVIDENCE (the employer\'s own words where available):'
input.open.map(r => `- [#${r.seq} ${r.kind}] ${r.verbatim ? `"${r.verbatim}"` : r.item_text}`)
```

There is **no instruction anywhere in this prompt against reusing the employer's wording.** The
model is given the target sentences, told to make them evidenced, and scored on literal overlap.

## OBSERVATION 4 — the anti-stuffing guard is a warning, and short-phrase stuffing is invisible to it

`checks.ts:554` wires `scanWording`. Two properties defeat it here:

1. **`WORDING_RUN_TOKENS = 8`** (`figureEcho.ts:466`) — it needs **8 consecutive exactly-matching
   tokens** with ≥3 content words.
2. **severity `'warn'`** — it never blocks the gate, and the remediation loop does not read it as
   pressure to stop copying.

### Executed — `/tmp/probe3.mjs`

A summary stitched from SHORT JD phrases, never 8 in a row:

> *"Engineering executive: cloud-native microservices, Kubernetes at enterprise scale, platform
> reliability engineering, regulated financial services, event-driven architecture, observability
> tooling."*

```
posting_wording_kept fires?  false   | runs: 0
requirement 1 CLOSED by it?  true
```

**It closes a requirement and produces ZERO wording offenders.** This is exactly the shape the owner
described: obvious stuffing to a human reader, invisible to the guard.

### Correction to a first reading, recorded so it is not repeated

An earlier probe (`/tmp/probe.mjs`) reported `n/a` for the wording scan on all three candidates. That
was **the probe's fault** — it passed an empty `profileText`, and `scanWording` correctly returns
`notApplicable` with nothing to compare against. Re-run with a real posting AND profile
(`/tmp/probe2.mjs`), the detector DOES fire on a full-sentence lift:

```
A. paraphrase  -> notApplicable: false | kept runs: 0
C. heavy echo  -> notApplicable: false | kept runs: 1
   ['experience designing and operating cloud-native microservices on Kubernetes at enterprise scale']
```

So the detector is not blind to whole-sentence theft. It is blind to phrase-level stuffing, and it
only warns.

## OBSERVATION 5 — what JotForm did differently

JotForm ran **Call 1** (the owner's generator prompt) and **Call 3** (ATS QC → `updatedResumeSummary`,
`mt17.ts:137`) and stopped. Nothing in that flow measured "does this summary contain 70% of the JD's
words" and rewrote until it did. **The P3 remediation loop is ours.** It is the structural difference,
and it converted the summary from a piece of writing into a coverage-optimisation target.

## NOT ESTABLISHED — one query short

**INFERENCE, not proof:** that the specific summary the owner is reading was written by a remediation
pass rather than by Call 1. The falsification test is a single live read, and `boost-pg-mcp-write`
was lapsed at the time of writing:

```sql
-- Is that summary loop 0 (Call 1) or a later pass (remediation)?
select loop, method, left(after_text,200) from insertion
 where merge_field='ResumeSummary' order by loop;

-- The owner's DEFAULT engineering-resume summary from MasterContext.
-- insertions.ts:92 -- loop 0 before_text IS the MasterContext block for that slot.
select before_text from insertion where merge_field='ResumeSummary' and loop=0 limit 5;
```

If that summary is `loop=0`, everything above is exonerating for the remediation loop and the cause
is upstream in Call 1 instead. **Run the query before acting on this document.**

## Candidate remedies — NOT started, NOT approved, tier 1

Both touch a gate, so both need ACs before any code.

1. **Exempt prose fields from remediation scope.** Add `ResumeSummary` (and the other prose blocks) to
   a scope exclusion so the loop rewrites list fields only. Cheapest, most reversible; costs the
   summary's ability to close a requirement at all.
2. **Make `coversIn` accept profile-evidenced synonyms**, so a paraphrase can close a requirement. Far
   more invasive: `coversIn` decides `must_have_coverage` and therefore the gate, and any loosening
   is a direct weakening of an accusation-grade predicate — the owner's standing instruction is that
   no guard is weakened without being pinged first.
3. **Add an anti-echo instruction to `buildScopedPrompt`.** Our code, not the Prompts table. Cheap and
   additive, but a prompt instruction is not a guard — it would need `posting_wording_kept` tightened
   (a lower `wordingRunTokens`, or a phrase-density measure) to be enforceable rather than hopeful.

**Do not edit anything in the Prompts table.** Standing owner instruction: *"i still want my original
prompts to be driving what the resume draft is."*

---

# CORRECTION, 2026-09-01 — MEASURED LIVE. THE REMEDIATION LOOP IS NOT THE CAUSE.

Everything above describes a real mechanism. **It has never been applied to `ResumeSummary`.** The
falsification test this document itself named was run, via `db-query.yml` (the owner instructed the
workflow transport after `boost-pg-mcp-write` stayed lapsed), and it came back against the hypothesis.

## The measurement — run 33464643167

| probe | result |
|---|---|
| `select count(*) from remediation_loop` | **1** — not 0. `D:remediation-never-ran`'s stated claim is stale; a pass HAS executed. |
| `insertion` rows where `merge_field='ResumeSummary'` | **4** |
| those rows grouped by `loop`, `method` | **`loop 0` / `model_rewrite` → 4.** ZERO rows at `loop >= 1`. |

**A remediation pass writes `insertion` rows at `loop >= 1`. There are none for this field.** So the
loop has never rewritten a resume summary, and every summary in production was produced at loop 0 —
by Call 1 / Call 3. `mt17.ts:137` settles which one wins:

```ts
ResumeSummary: firstNonEmpty(call3.updatedResumeSummary, call1.resumeSummary, call2.resumeSummary)
```

**Call 3 is the ATS QC pass and it OUTRANKS Call 1.** If a summary is being optimised toward posting
keywords, that is the pass doing it — and it runs on the owner's own prompt, which is not ours to
edit.

## The owner's MasterContext default (question 1, answered) — run 33464691925

651 characters, first 300:

> *"Visionary executive leader with a track record of aligning top-level goals to technology strategy
> and execution to drive continuous value creation, operational efficiency, and enterprise
> transformations. Adept at leading high-impact initiatives, optimizing digital ecosystems, and
> strengthening gover…"*

## What actually shipped — and it does NOT look stuffed

Two distinct summaries across the four rows (556 and 437 chars):

> *"Visionary engineering executive with a proven ability to drive AI-first transformations and
> architectural evolution in the software development lifecycle. Expert in aligning technology
> strategy with business goals, fostering innovation, and building high-performing global teams…"*

> *"Visionary technology leader with a robust track record in driving enterprise transformations and
> aligning engineering strategies with business objectives. Adept at building high-performing teams
> and fostering a culture of collaboration and innovation…"*

Generic executive prose. No verbatim posting sentences visible.

## The deployed checks agree — and that agreement is WORTH ALMOST NOTHING

Run 33464754745, `check_result` for the stored artifacts:

| check | state | offenders |
|---|---|---|
| `posting_wording_kept` | **pass** ×3 | 0 — *"no passage of 8+ words matches the posting"* |
| `posting_figure_echo` | **pass** ×3 | 0 |
| `ai_tells` | `warn` ×2, `pass` ×1 | 1 — `landscape of` |

**Do not read those passes as exoneration.** §OBSERVATION 4 of this document PROVED, by execution,
that `posting_wording_kept` is structurally blind to phrase-level stuffing: it needs an
8-consecutive-token exact run, and a summary stitched from short JD phrases closes a requirement with
**zero** offenders. So a `pass` here is consistent both with "not stuffed" and with "stuffed in
exactly the shape this check cannot see". **The only detector we have cannot settle the question it
is being asked.**

## STATUS — the hypothesis is retired; the owner's complaint is NOT explained

- **RETIRED:** "the P3 remediation loop stuffed the summary." Refuted by measurement.
- **STILL TRUE:** the mechanism in §OBSERVATION 1-4. It remains a live hazard for any field the loop
  DOES rewrite, and the detector's blindness is real and unfixed.
- **UNEXPLAINED:** the document the owner is actually reading. The stored summaries do not show the
  symptom. Either they are looking at a newer build, a different field, or the rendered Google Doc —
  or the stuffing is in the shape our detector cannot see. **Asked; not yet answered.**

**The next step is NOT a fix.** It is identifying which artifact the owner is reading. Building
against the wrong one is the specific failure `CLAUDE.md`'s feasibility rule exists to prevent.

---

# THE OWNER IS RIGHT — MEASURED ON THE REAL PAIR, 2026-09-01

The section above said the shipped summaries "do not look stuffed". **That was eyeballing, and it
was wrong.** Measuring the real shipped summary against the real posting's requirement rows settles
it (`/tmp/real.mjs` against `api/dist`; requirements from db-query run 33464953337, summary from
run 33464691925).

## The summary harvests vocabulary from EIGHT OF EIGHT requirements

eMoney Advisor packet. Shipped `ResumeSummary` (556 chars) vs that opportunity's `requirement` rows:

| req | employer's line (abridged) | overlap | words lifted into the summary |
|---|---|---|---|
| #4 | *Foster a culture of innovation among engineering teams* | **0.67** | foster, innovation, engineering, teams |
| #11 | *Lead global engineering teams to deliver high-quality products* | **0.67** | global, engineering, teams, deliver |
| #9 | *Define and execute an AI-first engineering strategy* | **0.60** | **ai-first**, engineering, strategy |
| #7 | *Lead the transition to a platform engineering model* | 0.50 | platform, engineering |
| #6 | *…evolve the enterprise architecture vision across application, data, and AI…* | 0.36 | platform, strategy, vision, ai |
| #5 | *build and scale high-quality, intelligent platforms, systems* | 0.33 | build, platforms |
| #0 | *…into an AI-first, platform-driven, product-centric ecosystem* | 0.30 | evolution, engineering, **ai-first** |
| #1 | *…embedding AI, automation, and data intelligence* | 0.22 | software, ai |

**Not one requirement scores zero.** `AI-first` — the employer's signature term, hyphenated exactly
as they wrote it — appears in the summary. *"Foster a culture of innovation"* becomes *"fostering
innovation"*; *"global engineering teams"* becomes *"global teams"*; *"evolve the enterprise
architecture"* becomes *"architectural evolution"*. This is precisely what the owner described:
*"a hack full of verbatim lines from the jd that isn't subtle at all."*

## AND IT IS WORSE THAN THAT: the summary gets NOTHING for it

```
requirements CLOSED by the summary: 0 of 8
posting_wording_kept offenders:     0   (needs 8 consecutive exact tokens)
```

- **0 of 8 requirements count as covered.** 0.67 and 0.60 sit under `COVERAGE_THRESHOLD` 0.7, so the
  document takes every gram of the stuffing risk and earns **zero** coverage credit.
- **The anti-stuffing check reports zero offenders**, exactly as OBSERVATION 4 predicted: the lifting
  is phrase-level, never 8 consecutive tokens, so `posting_wording_kept` is structurally blind to it.

**Both of our safeguards are silent on a document that a human reader identifies as stuffed in one
look.** That is the finding.

## WHICH STAGE — Call 3, and WE CHANGED WHAT IT IS FED

The summary is written at loop 0, and `mt17.ts:137` gives `call3.updatedResumeSummary` precedence.
Call 3 is the owner's **`ats_user`** ATS QC prompt — untouched, and not ours to edit. But
`pipeline.ts:525-534`:

```ts
const base3 = resolveZapVars(prompts['ats_user'] || 'ATS QC.', mc, jd, undefined, atsExtra)
const { merged: call3Input, improvised } = mergeCallTwo(c1, c2)
const r3 = await openai(prompts['ats_system'] ..., `${base3}\n\nINPUTS:\n${JSON.stringify(call3Input)}`, ...)
```

**`mergeCallTwo(c1, c2)` is what Call 3 sees, and its contents changed on 2026-08-22.** `D31` records
that Call 2's output had been failing to parse and was **discarded on every build** — so Call 3 used
to receive Call 1 alone. Deploy `4fb00e1` fixed the parse, and Call 3 has received Call 2's refined
output ever since.

**HYPOTHESIS, dated and checkable — NOT yet proven:** the owner's ATS prompt behaves differently
because the input we hand it changed, not because the prompt changed. The test is to compare
`ResumeSummary` values on `insertion` rows created before and after 2026-08-22. `resolveZapVars` also
injects `jd` into the prompt text, so how much of the posting Call 3 sees is a second variable worth
measuring.

## WHAT THIS DOES AND DOES NOT CHANGE

- **STANDS:** the remediation loop is not the cause (0 rows at `loop >= 1`). That correction holds.
- **RETRACTED:** "the shipped summaries do not show the symptom." They do; I read them by eye instead
  of measuring, and the measurement disagrees with the eye. Recorded rather than quietly edited,
  because reading text and calling it clean is the same class of error as trusting a proxy.
- **NEW AND UNGUARDED:** phrase-level JD harvesting is invisible to `posting_wording_kept` AND earns
  no coverage. Whatever is built next, a guard for this shape is the part with evidence behind it.

---

# THE SUMMARY THE OWNER IS ACTUALLY LOOKING AT — TRINNEX, measured 2026-09-01

## First, my own error, named

There are **two** packets carrying a `ResumeSummary`, and I conflated them (db-query run 33465421502):

| company | role | summary | chars |
|---|---|---|---|
| eMoney Advisor | SVP, Development and Enterprise Architecture | *"Visionary **engineering executive**… **AI-first**…"* | 556 |
| **Trinnex** | Director of Digital Technology Operations & Innovation | *"Visionary **technology leader**… robust track record…"* | 437 |

The section above measured **eMoney's** summary against **eMoney's** JD — that pairing was right, and
that finding stands for that packet. But I reported it as the owner's problem, and **the owner's
screen shows TRINNEX**. I then compounded it by re-measuring the Trinnex text against eMoney's
requirements — a wrong pairing whose numbers are void. Root cause both times: I selected rows by
`created_at DESC` instead of joining each summary to its own opportunity. **Order is not identity.**

## The correct measurement — Trinnex summary vs Trinnex requirements

The 54-word summary on screen, against all 19 judgeable rows of that posting:

| req | kind | employer's line | overlap | counts? |
|---|---|---|---|---|
| #12 | must_have | *Engineering & Technology Leadership — proven experience leading software engineering organizations* | **0.67** | **no** |
| #15 | must_have | *Ability to align engineering strategy with business goals* | **0.60** | **no** |
| #9 | responsibility | *Build, lead, and develop high-performing engineering managers and technical teams* | **0.57** | **no** |
| #7 | responsibility | *opportunities to apply emerging technologies* | **0.50** | **no** |
| …15 others | | | 0.00–0.33 | no |

```
COUNTS as covered:              0 of 19
NEAR MISS (>= 0.40, uncounted): 4
posting_wording_kept offenders: 0
```

## Both of the owner's points are correct, and they are the SAME four rows

**1. It reads as JD restatement.** Put them side by side:

| the posting says | the summary says |
|---|---|
| *"align engineering strategy with business goals"* | *"aligning engineering strategies with business objectives"* |
| *"Build… high-performing engineering managers and technical teams"* | *"building high-performing teams"* |
| *"opportunities to apply emerging technologies"* | *"leverage emerging technologies"* |

Two words swapped on #15. This is smoother than eMoney's blunt `AI-first` lift, and it is still the
employer's sentence wearing a coat — exactly *"isn't subtle at all and would get me accused of
stuffing."*

**2. And it earns NOTHING.** `0 of 19`, which is the app's *"0 of 12 responsibilities answered"* seen
from the other side. **All of the stuffing exposure, none of the coverage credit** — and
`posting_wording_kept` reports zero, because none of it is an 8-token run.

**The four near-misses are simultaneously the evidence of stuffing AND the coverage the owner is not
being given credit for.** They are not two problems. A paraphrase-aware coverage path and an
anti-restatement guard are reading the same four rows and disagreeing about what to call them — which
is why the display, not the arithmetic, is what the owner asked for.

## AN INCONSISTENCY ALREADY ON SCREEN — verify before building on it

The screenshot shows **`POSTING LINE ANSWERED: RQ-MH #12`** on this field, while the header on the
same screen reads **`0 of 12 responsibilities answered`**. `coversText` scores #12 at 0.67 — under
threshold, so the coverage check does NOT count it. So the chip and the count are fed by **different
sources**: the chip by a requirement citation recorded when the field was written, the count by
`coversIn`. **OBSERVATION, not yet traced to source** — confirm where `reqs` reaches `AssetBlocks.jsx`
from before treating it as a defect. If it holds, the app is already telling the owner two different
things about the same field, and the display work has to reconcile them rather than add a third.

## OWNER DECISION — option (b), WITH the display

*"b, but it still needs to tell me what is being covered and from the jd by such paraphrasing similar
experience to what we've done elsewhere"*

Paraphrase **counts automatically**; no confirm click. The house-rule concern was raised and the owner
decided after it, so it is the plan. **Recorded honestly: (b) plus a mandatory display is materially
safer than bare (b).** The hazard in (b) was a SILENT count; if every auto-counted paraphrase must
show which JD line it answers and what backs it, nothing is claimed invisibly — which is most of what
the click was buying.

**EXTEND, do not duplicate:** `AssetBlocks.jsx:1150` already renders *"Posting lines answered"* with
`ReqChip` + `ReqLegend`. That is the surface — it gains paraphrase-matched lines alongside cited ones,
visibly distinguished, with the backing evidence in the detail panel like the keyword chips already do.
That is the *"similar experience to what we've done elsewhere"* the owner named.

---

# THE CHIP-VS-COUNT TRACE — and my "inconsistency" call was WRONG

I flagged `POSTING LINE ANSWERED: RQ-MH #12` sitting beside `0 of 12 responsibilities answered` as an
inconsistency, guessing the count came from `coversIn`. **Traced to source, it does not.** They answer
two different questions and both are internally correct.

## The three populations, each traced

| # | what the owner sees | fed by | the question it actually answers |
|---|---|---|---|
| 1 | **chip** `POSTING LINE ANSWERED: RQ-MH #12` | `reqsForRow` (`assetBlocks.js:344-346`) reads `row.requirement_id`, written by `appInsertions.ts:126-132` as `idBySeq.get(r.requirement_seq)` | **"Which posting line was this field WRITTEN AGAINST?"** — authoring intent, recorded at write time |
| 2 | **count** `0 of 12 responsibilities answered` | `responsibilities_addressed` = `resp.filter(r => !ruleEvidenceOf(r))` (`checks.ts:877`) | **"Which responsibilities does the owner's stored PROFILE evidence with a rule-found verbatim excerpt?"** — says nothing about the summary |
| 3 | *(not on this card)* | `coversIn` → `covers()` (`checks.ts:681`) → `evidence_placed` | **"Of the things the profile evidences, which ones reached this document?"** |

`ruleEvidenceOf` (`checks.ts:807`) is `evidenceOf` minus unconfirmed model proposals — a
`requirement_evidence` row, i.e. an excerpt from the PROFILE. So #2 is a profile↔posting measurement
that never looks at the summary text at all.

**Correction on the record:** the app is NOT telling the owner two different things about one field.
It is telling them one thing about *authoring intent* and one thing about *profile evidence*. I
inferred a shared source from two numbers appearing on one card — the same proxy-instead-of-source
error this file has now made twice. Traced, not guessed, this time: `assetBlocks.js:344`,
`appInsertions.ts:131`, `checks.ts:877`, `checks.ts:807`.

## THE ACTUAL GAP — and it is cleaner than an inconsistency

**None of the three answers the question the owner asked.** *"Tell me what is being covered from the
JD by such paraphrasing"* needs a fourth measurement:

> **which JD lines does THIS TEXT address, including by paraphrase, and what backs each one.**

- #1 knows what the writer *aimed* at, not what the text achieved.
- #2 is about the profile, not the text.
- #3 requires 0.70 literal overlap, so every paraphrase is invisible to it — which is exactly why the
  four Trinnex near-misses (0.67, 0.60, 0.57, 0.50) appear nowhere on the owner's screen.

So this is genuinely **ABSENT**, not `EXISTS-BUT-CONSTRAINED`, and the owner's request is a real
build rather than a surfacing job. It EXTENDS `ReqChip` (`AssetBlocks.jsx:1150`) — the chip row gains
paraphrase-matched lines beside the cited one, visibly distinguished, with the backing evidence in the
detail panel the keyword chips already use.

## A SEPARATE FINDING, worth its own row

`0 of 12 responsibilities answered` means **the owner's stored profile has no rule-found evidence for
ANY of the twelve Trinnex responsibilities.** That is not a display bug and not about the summary — it
is the profile↔posting matcher returning nothing on a real posting, which is the shape
`D:compound-requirements-unevidenceable` describes. It should not be folded into the paraphrase work,
and it is a large part of why the screen reads as broken to the owner.
