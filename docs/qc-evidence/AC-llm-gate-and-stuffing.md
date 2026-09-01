<!--
WHAT:       Acceptance criteria + feasibility for the TWO lanes AC-llm-coverage-judge.md does NOT
            cover: (2) THE GATE -- does the PROFILE evidence the requirement (`supportIn`,
            `EVIDENCE_THRESHOLD`, `must_have_coverage`); and (3) stuffing -- is this the employer's
            wording (`scanWording`, `WORDING_RUN_TOKENS`).
WHY:        Owner, 2026-09-01: "what is done today by actors simply needs to be swapped by a model
            that can reason instead of word matching but only where it makes sense" and "when I said
            include the gate I meant fold this in with the rest of what you've been working on
            instead of deleting it". FEASIBILITY-llm-judgement.md section "CORRECTED SCOPE" is the
            owner's instruction; it names five decisions, of which lanes 2 and 3 are this file.
            Lane 2 is TIER 1: `must_have_coverage` is one of thirteen checks that can turn a
            packet's ship decision, and the only one of them decided by evidence. (The brief said
            "the only check" -- REFUTED in section 0.1 by parsing every bad() call.)
SUPERSEDES: nothing. Follows DIAG-coverage-recognition.md (the twelve measured defects),
            FEASIBILITY-llm-judgement.md (the corrected scope), and AC-llm-coverage-judge.md
            (lane 1 -- the DOCUMENT side, `coversIn`). This file deliberately does not repeat
            lane 1's ACs.
SUPERSEDED-BY: nothing -- current.
EVIDENCE:   every claim below is cited to a file:line read on branch claude/incumbent-wins-swap at
            5501839, or to a probe command whose output is quoted inline. Claims taken from the
            brief and NOT independently confirmed are labelled as such.
-->

# AC — lane 2 (THE GATE, `supportIn`) and lane 3 (stuffing, `scanWording`)

STATUS: **COMPLETE.** See §7.

---

## 0. READ THIS FIRST — what in the brief did not survive checking

I verified every load-bearing claim rather than repeating it. Four did not survive. **The first two
change the risk framing of the whole lane; the third changes what the lane IS** — and **§0.6 is a
late finding that changes the recommended ORDER of the work.**

### 0.1 REFUTED — "`must_have_coverage` is the ONLY check that takes `bad()`'s default fail"

The brief (LANE 2 IS THE DANGEROUS ONE) states this as the fact to verify. **It is false.** Measured
by parsing every `bad(` call in `checks.ts` and reading whether a severity argument is passed:

```
DEFAULT (=> state:'fail' + engine:'deterministic' => GATE FAIL at :1025):
  changes_cited, company_in_body, company_named, cross_list_redundancy, empty_merge_fields,
  fixed_slot_count, markup_residue, must_have_coverage, omission_list, relevant_char_limit,
  skill_char_limit, word_counts
EXPLICIT 'fail':  compact_skills_fit (:955)
EXPLICIT 'warn':  skill_list_count, posting_figure_echo, posting_wording_kept, ai_tells,
                  whitespace, expertise_phrase_length, fact_shortfall,
                  responsibilities_addressed, evidence_placed, compact_skills_fit (:959,962,967)
```

**Thirteen checks can fail the gate, not one.** What IS true, and is what the brief was reaching for:

- `bad()` at `checks.ts:192` does default to `state:'fail'`, `engine:'deterministic'`, and
  `:1025` `if (results.some(r => r.state === 'fail' && r.engine === 'deterministic')) return 'fail'`
  turns exactly that pair into a gate fail. **CONFIRMED.**
- `must_have_coverage` (`:867`) takes that default; `responsibilities_addressed` (`:882`) and
  `evidence_placed` (`:913`) explicitly pass `'warn'`. **CONFIRMED** — so of the three
  coverage/evidence checks, only `must_have_coverage` reaches the gate. That part of
  `AC-llm-coverage-judge.md` §4.2 stands.

**Why the correction matters rather than being pedantry.** The acceptance bar says lane 2 "must move
`0 of 12` and the must-have count off zero". Moving `must_have_coverage` to `pass` **does not make a
packet ship** — twelve other deterministic checks can independently hold the gate at `fail`. Any AC
claiming lane 2 "unblocks the packet" would be unfalsifiable-by-construction and wrong. AC-G1 below
is therefore written against the CHECK's state, not against the packet's gate.

### 0.2 REFUTED — "swap `supportIn`'s lexical body for a model" describes one threshold

The brief and `FEASIBILITY-llm-judgement.md` §1 both characterise `supportIn` as *"70% literal
overlap"* — a single tunable. **Read from source (`requirementSupport.ts:658-775`), the threshold is
the LAST of nine gates and the only owner-settable one.** In order:

| # | gate | line | owner-settable? |
|---|---|---|---|
| 1 | `requirementClass` — eligibility / numeric refused outright | `:665` | **NO** |
| 2 | `quote_too_short` (`minQuoteChars`, `minQuoteWords`) | `:697-698` | via `ResolveOptions` |
| 3 | `no_candidate` — zero token overlap | `:705` | NO |
| 4 | `missing_specific_token` — **every NAMED entity must be carried, at any setting** | `:729` | **NO** |
| 5 | `generic_overlap_only` — M10, overlap made only of CATEGORY words | `:734-742` | **NO** |
| 6 | `list_element_unsupported` — a conjunction is evidenced whole or not at all | `:745` | **NO** |
| 7 | `negated_or_attributed` | `:746` | **NO** |
| 8 | `no_distinctive_token` | `:747` | NO |
| 9 | **`support < input.threshold`** ← the 0.7 | `:750` | **YES** |

`SAFETY_FLOOR_RULES` (`:346`) names six of these as rules *"an owner setting can never reach"*, and
the file states the reason: *"it must hold at the loosest reachable configuration (M17) — a threshold
of 0 must not be able to turn `Strong understanding of software engineering practices` into evidence
just because the profile says 'software' and 'engineering' somewhere while never mentioning
`practices`."*

**Consequence for the design, and it is the main one:** "replace the lexical body with a model" as
literally scoped **deletes six safety-floor rules that were each written against a measured
false-positive.** That is not a threshold swap. Every AC in lane 2 below is written so the floor
survives the model — see AC-G4.

### 0.3 REFUTED, and this is the big one — the lane-2 producer is ALREADY BUILT, LIVE, AND ON BY DEFAULT

The brief frames lane 2 as *"replace `supportIn` with a model"*. **A model that judges "does the
profile evidence this requirement", with a byte-verified citation, already runs on the production
packet-build path, is already owner-settable, and is already ON unless the owner turns it off.**

| link in the chain | evidence |
|---|---|
| the model call | `evidenceProposal.ts:218` `escalateOne(requirement, records, opts)` |
| the prompt, banned sources excluded before the model sees them | `:105` `buildProposalUser` |
| the byte-exact citation check | `:122` `verifyProposal` → `:147` `rec.text.indexOf(quote)`, `-1` ⇒ `refuse('quote_not_in_record')` |
| the stored quote is the RECORD's bytes, not the model's string | `:259` `quote: rec.text.slice(a.char_start, a.char_end)` |
| the row it writes | `:274` `method: 'proposed'`, `ratio: null`, `proposal_version` |
| the caller | `appRequirements.ts:319` inside `if (canEscalate)` |
| the transport | `appPackets.ts:991` `openAiJson({ feature: 'evidence:escalate' })` |
| the owner settings | `checkPrefs.ts:58-59` `chk_evidence_escalate boolean`, `chk_evidence_escalate_max int` |
| **ON by default** | `checks.ts:171` `evidenceEscalate: true`; `checkPrefs.ts:246` `escalate: t.evidenceEscalate !== false` |
| a typed outage that is not a "no" | `:192` `EscalationOutcome` incl. `'transport_failed'`, *"a tier that stores them the same way records an outage as an absence of evidence"* |
| must-haves are escalated FIRST | `appRequirements.ts:309-311` `ESCALATION_RANK = { must_have: 0, nice_to_have: 1, responsibility: 2 }` |

**So lane 2 is not "build a reasoning judge for the profile side". It is exactly ONE line:**
`checks.ts:807`

```ts
const ruleEvidenceOf = (r) => (isProposed(r) && !isConfirmed(r) ? null : evidenceOf(r))
```

That line is the house rule *"a model may PROPOSE, only an exact rule may ACCUSE"* in executable
form, and it is the only thing standing between the existing model verdict and
`must_have_coverage`. The brief's item 4 calls this "the crux of the lane" — **that is correct, and
it is not merely the crux, it is the entire lane.** `supportIn` does not have to be touched at all.

> **`ALREADY BUILT` is a first-class outcome and this is one.** Under CLAUDE.md's feasibility rule
> the response is *"say it first, then write a regression guard, not a feature."* The feature to
> build is a **decision about admission**, plus the guards that make that decision safe.

### 0.4 REFUTED — the always-on default was granted on a premise lane 2 removes

`checkPrefs.ts:222-247`, the comment on `escalate: t.evidenceEscalate !== false`, records the owner's
instruction verbatim — *"I don't know why the escalation needs to be turned on or off vs always on …
make sure the toggle is automatically on by default"* — and then states what made saying yes safe:

> *"What makes that safe is not the toggle but `checks.ts`: **a proposed row is shown beside a
> requirement and can never count toward coverage**, so the tier only ever ADDS information where
> there was none. It changes what the owner is told, never what they are scored."*

**Lane 2 deletes that premise.** The moment a `proposed` row counts, an always-on model tier changes
what the owner is SCORED, on every packet, by default. The two settings are coupled and nothing in
the code says so. **This is an owner decision, not an implementation detail — OD-G2 below.**

### 0.5 CONFIRMED — everything else in the brief that I checked

| brief claim | verdict |
|---|---|
| `supportIn` at `requirementSupport.ts:658` | **CONFIRMED**, exact line |
| `EVIDENCE_THRESHOLD = 0.7` at `evidence.ts:287` | **CONFIRMED**, exact line |
| `scanWording` at `figureEcho.ts:498`; `WORDING_RUN_TOKENS = 8` | **CONFIRMED** (`:498`, `:466`) |
| `must_have_coverage` numerator is `coverable.filter(r => !ruleEvidenceOf(r))` at `:827` | **CONFIRMED** |
| `ruleEvidenceOf` at `:807` is a `requirement_evidence` row minus unconfirmed proposals | **CONFIRMED** (`:806` `isConfirmed`, `:807` `ruleEvidenceOf`) |
| `buildProposalUser` `:105` excludes banned sources before the prompt | **CONFIRMED** |
| `verifyProposal` `:122` checks the quote byte-exactly | **CONFIRMED** |
| the confirm ROUTE is live at `appRequirements.ts:957` | **CONFIRMED** — see F-G7 |
| `method='proposed'` and `confirmed_at` exist and work | **CONFIRMED** |

---


### 0.6 LATE FINDING — the confirm UI landed in the working tree WHILE this pass was running

**Observation, with timestamps.** Early in this pass, `grep -rn "evidence-confirm\|evidenceConfirm"
app/src/` returned **nothing** — the basis for F-G7's "API complete, no button". Re-run at the end of
the pass it returns **five matches**. The mtimes settle it: `app/src/api.js` 11:13:45,
`api/src/functions/tests/appRequirements.ts` 11:14:22, `app/src/screens/PostingAnalysis.jsx` 11:16:51,
against `date` 11:17:09. **A concurrent lane is building the human confirm path right now, and none
of it is committed** (`git status` shows all five files as `M`/untracked against `5501839`).

What is in that uncommitted tree, read from `git diff`:

| file | what was added |
|---|---|
| `app/src/api.js:228` | `evidenceConfirm: (seq, body) => postDetailed('/app/requirement/${seq}/evidence-confirm', body)` |
| `app/src/postingAnalysis.js:31-34` | test ids `evidence-confirm`, `-yes`, `-no`, `-confirmed`; `awaitingConfirmation = method === 'proposed' && !confirmedAt` |
| `app/src/screens/PostingAnalysis.jsx` | `RequirementRow` → `EvidenceLine` with the confirm control, `+87` lines |
| `api/src/functions/tests/appRequirements.ts:~653` | `confirmedAt` / `confirmedBy` added **inside** the evidence verdict object, with a comment citing `H:evidence-read-from-the-verdict-not-the-columns` |

**Three consequences for this file, and they are not cosmetic:**

1. **F-G7 is upgraded** from `EXISTS-BUT-CONSTRAINED (no button)` to **IN PROGRESS**. Anyone
   implementing lane 2 must read that lane's work before writing any confirm UI — building a second
   one is the "extend, don't duplicate" failure, and it would be committed against a tree that
   already has the first.
2. **OD-G1 changes shape.** Option (c) is not a proposal any more. If the human confirm path ships,
   `must_have_coverage` moves off zero **with the house rule intact and no model trusted**, which
   makes option (a) an optional second step decided against real verdicts rather than a leap. That is
   a strictly better sequence than the one this file was going to recommend.
3. **Line numbers below 650 in `appRequirements.ts` are HEAD numbers; those above are +9.** The
   uncommitted diff inserts nine lines at ~653. **Every `appRequirements.ts:NNN` citation in this
   file is a WORKING-TREE number** (route `:957`, insert `:943`, withdraw `:931`, 409 `:923`) — the
   brief's `:948` for the route is the same line at HEAD and is not wrong, it is a different frame.
   Everything below 650 shifts by 9 the moment that work commits or is discarded, so re-grep the
   construct rather than trusting the number.

> **Interpretation, separated:** I did not read that lane's intent, only its diff. It looks like the
> `OD-2` / confirm-button work both this file and `AC-llm-coverage-judge.md` independently recommend
> — but **that is an inference from four file diffs, not something I confirmed with whoever wrote
> them.** Reconcile before building.

## 1. FEASIBILITY TABLE — every dependency these two lanes name

Verdicts: `EXISTS` / `ABSENT` / `EXISTS-BUT-CONSTRAINED` / `ALREADY BUILT`.
All line numbers read on `claude/incumbent-wins-swap` @ `5501839`. Probes are named and their output
is quoted in §1.2.

### 1.1 LANE 2 — the gate (does the PROFILE evidence the requirement)

| # | Dependency | Producer (writes it) | Consumer today (reads it) | Proof (command + result) | Verdict |
|---|---|---|---|---|---|
| **F-G1** | **A model that judges "does the profile evidence this requirement"** | `evidenceProposal.ts:218` `escalateOne`, prompt `:105` `buildProposalUser` | `appRequirements.ts:319` inside `if (canEscalate)`; transport from `appPackets.ts:991` `openAiJson({feature:'evidence:escalate'})` | `grep -rn "escalateOne" api/src` → declared once, called once, on the packet-build path | **ALREADY BUILT — see §0.3.** This lane does not need a new judge |
| **F-G2** | **Byte-exact citation verification of the model's quote** | model returns `{quote, source_key, reasoning, supported}` | `evidenceProposal.ts:122` `verifyProposal` → `:147` `rec.text.indexOf(quote)`; `-1` ⇒ `refuse('quote_not_in_record')`. No lower-casing, no normalisation, no fuzzy fallback, no repair | read `:122-158` | **ALREADY BUILT** — brief item 3's "EXTEND that, do not write a second one" is right, and there is nothing to extend: it is already the only gate on the model's answer |
| **F-G3** | **The stored quote is the RECORD's bytes, not the model's string** | `evidenceProposal.ts:257` `quote: rec.text.slice(a.char_start, a.char_end)` | `requirement_evidence` row | read `:252-277`, comment: *"never the model's string … closes the gap if that ever stops being true"* | **ALREADY BUILT** |
| **F-G4** | **A typed outage that is NOT a negative verdict** | `escalateOne` | `appRequirements.ts:330-334` `note('transport_failed')` / `note('unparseable')` | `EscalationOutcome` (`:192`) = `accepted \| refused \| skipped \| transport_failed \| unparseable`, with the comment *"a tier that stores them the same way records an outage as an absence of evidence"* | **ALREADY BUILT at the tier** — but see F-G5, it does not reach `checks.ts` |
| **F-G5** | **A way for `checks.ts` to KNOW the model tier failed** | — | `CheckInput.evidence: EvidenceInput` (`checks.ts:235`) carries **`profileReadable` and `bySeq` only** (`appChecks.ts:102-103`) | `grep -n "escalation_refusals" api/src/functions/tests/checks.ts` → **no match**. The counts are computed in `appRequirements.ts:381` and never reach the checks | **ABSENT — and this is the single most important gap in lane 2.** Today an outage is invisible: the row is simply missing and the requirement reads as unevidenced. That is the SAFE direction now, and it stops being safe the moment a proposal can count. AC-G3 |
| **F-G6** | **The one line that bars the model's verdict from the gate** | — | `checks.ts:807-808` `ruleEvidenceOf = (r) => (isProposed(r) && !isConfirmed(r) ? null : evidenceOf(r))`; numerator `:827` | read `:784` `isProposed`, `:806` `isConfirmed`, `:807` `ruleEvidenceOf`, `:827` `unevidenced` | **EXISTS** — **this is the whole lane.** Two sibling bars: `dimensions.ts:455` `method !== 'proposed'`, `appRequirements.ts:212` `e.method <> 'proposed'` |
| **F-G7** | **A HUMAN confirm path (a person, not the model, as accuser)** | `appRequirements.ts:943` insert `evidence_confirmation`; `:931` withdraw on reject; route `:957` `POST app/requirement/{seq}/evidence-confirm`; `:923` refuses non-`proposed` with 409 | `appRequirements.ts:483` `c.confirmed_at`; `checks.ts:806` `isConfirmed` | route read. `grep -rn "evidence-confirm" app/src/` → **NO MATCH at 11:0x, FIVE MATCHES at 11:17** — the UI landed in the working tree DURING this pass. See §0.6 | **EXISTS-BUT-CONSTRAINED → NOW IN PROGRESS.** API complete and tested; the button is being built right now, uncommitted, by a concurrent lane. Confirms `AC-llm-coverage-judge.md` §0.2 and refutes `DIAG` A5 |
| **F-G8** | **`must_have_coverage` reaching a gate `fail`** | `checks.ts:867` `bad(...)` with no severity ⇒ default `'fail'`+`'deterministic'` | `:1025` turns that pair into gate `fail` | parsed every `bad(` call — see §0.1 | **EXISTS-BUT-CONSTRAINED** — it does reach the gate, but it is **one of thirteen** checks that can, not the only one |
| **F-G9** | **The safety floor a model swap would delete** | `requirementSupport.ts:346` `SAFETY_FLOOR_RULES` | `supportIn` `:729,738,745,746`; `H:safety-floor-not-configurable` | `/tmp/probe_support.mjs` — at **threshold 0.0, the loosest reachable setting**, `missing_specific_token` and `generic_overlap_only` still refuse (§1.2) | **EXISTS-BUT-CONSTRAINED — see §0.2.** Six rules an owner setting can never reach. AC-G4 |
| **F-G10** | **Owner settings for the model tier** | `checkPrefs.ts:58-59` `chk_evidence_escalate boolean`, `chk_evidence_escalate_max int`; whitelist DERIVED from the DDL (`:34 checkPrefColumns`) | `checkPrefs.ts:246-247`; Settings labels `Settings.jsx:1584,1586` | `grep -n chk_evidence Settings.jsx` → both labelled | **ALREADY BUILT** — an LLM on/off toggle + per-run cap with a UI control is the shipped precedent. Adding a column auto-exposes it to the API writer; only a label is needed |
| **F-G11** | **The always-on default, and the premise it rests on** | `checks.ts:171` `evidenceEscalate: true` | `checkPrefs.ts:246` `escalate: t.evidenceEscalate !== false` | read the comment at `:222-246`: *"a proposed row … can never count toward coverage … It changes what the owner is told, never what they are scored"* | **EXISTS-BUT-CONSTRAINED — see §0.4.** Lane 2 removes the stated justification for this default. **OD-G2** |
| **F-G12** | **Must-haves get the escalation budget first** | `appRequirements.ts:309-311` `ESCALATION_RANK = { must_have:0, nice_to_have:1, responsibility:2 }`, stable sort | `:314` `prioritised.slice(0, cap)` | read; comment records the measured defect (opp `2cb56fb3`, 2026-08-23: all 8 proposals landed on responsibilities, `must_have_coverage` read 0/12 regardless) | **ALREADY BUILT** — the "0 of 12" the acceptance bar names had a *budget* cause that is already fixed. Re-measure before attributing it to the matcher |
| **F-G13** | **`not_applicable` as the shape for absent evidence** | — | `checks.ts:194` `na(...)`; `:812-825` all three checks go `not_applicable` when `!ev \|\| !ev.profileReadable`; `:864` when `!coverable.length` | read; comment `:813`: *"Absent evidence is not_applicable, NEVER pass — and never `fail` either"* | **ALREADY BUILT** — reuse `na()`. Do not invent a state. AC-G3 |
| **F-G14** | **`method` values a new verdict could take** | `appRequirements.ts:52` `check (method in ('exact','anchored','proposed'))` | `checks.ts:784`, `dimensions.ts:455`, `appRequirements.ts:212` | read the DDL check constraint | **EXISTS-BUT-CONSTRAINED** — a NEW method value requires a DDL change **and** all three consumers updated, or it silently counts. AC-G5 |
| **F-G15** | **Live Trinnex rows, to evaluate the acceptance bar** | live Postgres | — | **NOT REACHABLE.** `ToolSearch "boost postgres query database"` returned no `boost-pg-mcp-write` tool; the session reminder lists `Boost_DB_Connector` / `Azure_pg_mcp` as requiring authentication | **EXISTS-BUT-CONSTRAINED — PRE-FLIGHT, §2** |
| **F-G16** | **The deterministic test bed** | — | `api/test/*.mjs` | `cd api && node --test test/*.mjs` → **`# tests 948  # pass 941  # fail 0  # skipped 7  # duration_ms 14737`** | **EXISTS** (note: `AC-llm-coverage-judge.md` measured 930/18 at `44271bf`; this branch is 941/7) |

### 1.2 LANE 3 — stuffing (is this the employer's wording)

| # | Dependency | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|---|
| **F-S1** | **The wording detector** | `figureEcho.ts:498` `scanWording(generated, postingText, profileText, runTokens)` → `{kept[], notApplicable, reason}` | `checks.ts:554`, emitting `posting_wording_kept` at `:561` with severity **`'warn'`** | read; `WORDING_RUN_TOKENS = 8` at `:466`; `WORDING_MIN_CONTENT = 3` at `:468` | **EXISTS** |
| **F-S2** | **The claim "8 tokens is blind to phrase-level lifting"** | — | — | `/tmp/probe_wording.mjs`: a summary lifting three JD phrases verbatim → **`runTokens=8 → 0 offenders`**; `7,6,5 → 0`; **`4 → 2`**; **`3 → 3`** | **CONFIRMED — and the fix is a SETTING, not code.** See F-S4 |
| **F-S3** | **The claim "only a model can see it"** | — | — | `/tmp/probe_wording2.mjs` case A: *"aligning engineering strategies with business objectives"* against *"Align engineering strategy with business goals"* → **0 offenders at runTokens 2,3,4,6,8** | **CONFIRMED for the REWORDED half.** No run length reaches it, because the tokens differ. This is the real justification for lane 3 |
| **F-S4** | **`WORDING_RUN_TOKENS` being owner-settable** | `checkPrefs.ts:72` `chk_wording_run_tokens int`; threaded `checks.ts:143 → :554` | `checks.ts:554` `t.wordingRunTokens` | `grep -rn "chk_wording_run_tokens\|wordingRunTokens" app/src/` → **NO MATCH** | **EXISTS-BUT-CONSTRAINED** — the column exists and the API writer accepts it (derived whitelist), but **there is no Settings control**, so the owner cannot reach it. One label line. **This is the $1 test before the $100 change** |
| **F-S5** | **The three-way split that protects the owner's own words** | `figureEcho.ts:524` `if (contains(prof, words)) { i += len; continue }` | `scanWording` | `/tmp/probe_wording2.mjs` case C: a phrase present in BOTH posting and profile → **0 offenders at every run length** | **ALREADY BUILT** — a model judge MUST preserve this or it will name the owner's own writing back to them. AC-S3 |
| **F-S6** | **`notApplicable`, never a pass, when there is nothing to compare** | `figureEcho.ts:501,505` | `checks.ts:557` | probe case D → `{"kept":[],"notApplicable":true,"reason":"no employer posting text to compare against"}` and the profile equivalent | **ALREADY BUILT** — the precedent AC-S4 copies |
| **F-S7** | **`scanEcho` (figures) being out of scope** | `figureEcho.ts:344` | `checks.ts:534` `posting_figure_echo`, `'warn'` | probe: `scanEcho(stuffed, posting, profile)` → `{"echoes":[],"shared":[],"notApplicable":false}` on text with no figures | **CONFIRMED OUT — the brief is right.** A figure is an exact token (`$4.2M`, `30%`); exact match is the correct and complete tool for it, and a model would only add false positives. **Do not touch it** |
| **F-S8** | **The severity decision** | `checks.ts:561` `bad(..., 'warn')` | `:1026` ⇒ gate `warn`, never `fail` | read | **EXISTS** — whether it stays `warn` is **OD-G4**, an owner decision, not this pass's |

### 1.3 The probe output, quoted rather than summarised

```
$ node /tmp/probe_wording.mjs          # stuffed summary vs a Trinnex-shaped posting
runTokens=8  notApplicable=false  offenders=0
runTokens=7  notApplicable=false  offenders=0
runTokens=6  notApplicable=false  offenders=0
runTokens=5  notApplicable=false  offenders=0
runTokens=4  notApplicable=false  offenders=2  "modern software delivery practices"(4) | "engineering standards, governance, metrics"(4)
runTokens=3  notApplicable=false  offenders=3  ... | "machine learning operations"(3)
scanEcho (figures) on the same text: {"echoes":[],"shared":[],"notApplicable":false}

$ node /tmp/probe_wording2.mjs
A reworded           offenders by runTokens -> 2:0  3:0  4:0  6:0  8:0
B owner own words    offenders by runTokens -> 2:0  3:0  4:0  6:0  8:0
C also in profile    offenders by runTokens -> 2:0  3:0  4:0  6:0  8:0
D no posting  -> {"kept":[],"notApplicable":true,"reason":"no employer posting text to compare against"}
D no profile  -> {"kept":[],"notApplicable":true,"reason":"no profile text ..."}

$ node /tmp/probe_support.mjs           # supportIn, threshold 0.7 then 0.0
--- threshold = 0.7 ---                          --- threshold = 0 (LOOSEST reachable) ---
NAME must be carried  ok=false missing_specific_token   ok=false missing_specific_token
generic overlap only  ok=false generic_overlap_only     ok=false generic_overlap_only
list must be whole    ok=false below_threshold          ok=true  (threshold released it)
negated/attributed    ok=true  support=1                ok=true  support=1
ADVERSARIAL name-drop ok=true  support=0.714            ok=true  support=0.714
genuine claim         ok=true  support=1                ok=true  support=1
eligibility (pre-gate)ok=false eligibility              ok=false eligibility
```

### 1.4 TWO DEFECTS THE PROBES FOUND IN PRODUCTION CODE, and they reverse the case for lane 2

Neither is in `DIAG-coverage-recognition.md`. Both are OBSERVED, reproducible with the script above.

**(a) `supportIn` ACCEPTS a pure name-drop — the brief's own adversarial case fails TODAY.**

```
requirement: "Build and develop high-performing engineering managers and technical teams"
record:      "I am interested in engineering managers, technical teams, governance and
              high-performing delivery."
result:      ok=true  support=0.714  missing=["build","develop"]
```

5 of 7 contentful tokens carried ⇒ 0.714 ≥ 0.7. The two missing tokens are **exactly the two verbs
that carry the doing**. `generic_overlap_only` did not fire because `high-performing` and `managers`
are not CATEGORY words, so `got.every(isCategoryWord)` was false.

> **Interpretation, separated from the observation:** the standing story is that the lexical matcher
> is too STRICT (0 of 12). This measurement shows it is **also too LOOSE, in the fabrication
> direction**: *"I am interested in X"* is accepted as evidence of having done X. A reasoning model
> distinguishes those two sentences trivially and no token ratio can. **This is the strongest
> argument for lane 2 in this body of work, and it is the opposite of the argument the DIAG makes.**
> It also means the acceptance bar's adversarial requirement is a REGRESSION test the current code
> fails — so lane 2 can be measured as an improvement rather than argued for.

**(b) `ATTRIBUTION_RE` does not cover "my colleague".**

```
requirement: "Lead machine learning operations for the platform"
record:      "My colleague led machine learning operations for the platform while I focused on
              delivery work."
result:      ok=true  support=1   <- someone else's achievement, accepted as the owner's
```

`ATTRIBUTION_RE` (`requirementSupport.ts:289`) lists `my (manager|boss|director|lead|leader)`, not
`colleague`, `teammate`, `peer`, `partner`, `predecessor`.

> **Interpretation:** this is a deliberately narrow, marker-driven rule (the same design as
> `ELIGIBILITY_RE`), so a gap is expected rather than negligent — but it is a gap **on the gate
> path**, and it is precisely the class a reasoning judge closes without a list. Recorded here
> because a lane-2 verifier will otherwise "discover" it as a lane-2 regression.

---

## 2. PRE-FLIGHT — the live-DB queries this work needs, which THIS PASS COULD NOT RUN

Per `CLAUDE.md`'s `boost-pg-mcp-write` rule, this is named **before** the implementation step rather
than discovered three tool calls in.

**State, observed:** `ToolSearch "boost postgres query database"` surfaced no `mcp__boost-pg-mcp-write__*`
tool. The session's own reminder lists `Azure_pg_mcp`, `Boost_DB_Connector`, `huddle-pg-mcp-write`
and `nexus-pg-mcp-write` as *requiring authentication* — and of those, `Azure_pg_mcp` is the **wrong
database** (`RAG_AI_Agents`) and `Boost_DB_Connector` is the redundant one `CLAUDE.md` says not to
use. **So the preferred connector is not reachable from this pass**, and this section nudges rather
than routing around it.

The queries the implementation step needs, named up front:

```sql
-- P1. The acceptance bar's own number, and whether the cause is the matcher or the CAP (F-G12).
--     `escalation_refusals.over_cap` was the measured cause once already (opp 2cb56fb3).
select r.seq, r.kind, left(coalesce(r.verbatim, r.item_text), 90) as req,
       e.method, e.source_key, left(e.quote, 60) as quote, c.confirmed_at
  from requirement r
  left join requirement_evidence e on e.requirement_id = r.id
  left join evidence_confirmation c
         on c.opp_id = r.opp_id and c.requirement_text = coalesce(r.verbatim, r.item_text)
        and c.source_key = e.source_key and c.withdrawn_at is null
 where r.opp_id = '<trinnex opp_id>' order by r.kind, r.seq;

-- P2. How many proposals ALREADY exist and would start counting the day ruleEvidenceOf admits
--     them. This is the blast radius of lane 2, corpus-wide, and it must be a NUMBER before the
--     change, not after.
select method, count(*) from requirement_evidence group by method;
select count(*) from requirement_evidence e
  join requirement r on r.id = e.requirement_id
 where e.method = 'proposed' and r.kind = 'must_have';

-- P3. How many confirmations exist today (F-G7 predicts ZERO, because there is no button).
select count(*) from evidence_confirmation where withdrawn_at is null;

-- P4. The regression baseline the acceptance bar names (skills_1 11/11, skills_2 9/9, expertise 7/7).
--     UNVERIFIED BY THIS PASS -- taken from the brief, not measured.
select check_key, state, observed from artifact_check
 where artifact_id in (select id from artifact where packet_id = '<trinnex packet_id>');

-- P5. Lane 3's bar: the eMoney summary text, so the 0-offenders claim is measured on the real
--     document rather than on the reconstruction used in section 1.3.
select a.type, f.merge_field, f.text from artifact a join artifact_field f on f.artifact_id = a.id
 where a.packet_id = '<emoney packet_id>';
```

**Nudge:** please refresh `boost-pg-mcp-write` before the implementation step (~1s/query), or say to
use `db-query.yml`. That choice is the owner's, not the implementer's.

**What this pass could do WITHOUT the DB, and what it therefore proves.** Everything in §1.3 and §1.4
was executed locally against `api/dist` with synthetic, Trinnex-*shaped* text taken from the JD
fragments quoted in `DIAG-coverage-recognition.md`. That is enough to prove a **mechanism** — the
8-token blindness, the reworded-lift invisibility, the name-drop acceptance — and it is **not** enough
to state the owner's numbers. Every AC below that names a live number is marked `[LIVE]` and is
blocked on this pre-flight.

---

## 3. ACCEPTANCE CRITERIA

Binary, observable, and each names how it is checked. "Works correctly" is not an AC and does not
appear. Every AC creating a guard carries the **mutation** that proves the guard is not inert.

Naming: H-cases take **slugs, never numbers** (`H26` fails the suite on a new numeric id).
IDs are `AC-G*` for the gate lane and `AC-S*` for the stuffing lane, so they cannot collide with
`AC-llm-coverage-judge.md`'s `AC-1..AC-21`.

### 3.0 What lane 2 actually is, restated so the ACs are readable

Given §0.3, the implementation is **not** "put a model inside `supportIn`". It is:

> **Decide, and guard, what `ruleEvidenceOf` (`checks.ts:807`) admits** — and make the checks able to
> say when the model tier did not run.

`supportIn` is **NOT MODIFIED**. That is a design assertion with an AC on it (AC-G8), not an
omission: the existing lexical matcher is the deterministic floor the model tier sits *beside*, and
`escalateOne` is only reached for rows `supportIn` could not settle (`appRequirements.ts:292`
`const open = rows.filter(r => !bySeq.get(r.seq))`). Replacing its body would delete the floor
(§0.2) **and** remove the thing that decides which rows are worth a model call at all.

---

### Group A — the acceptance bar on the owner's real packets `[LIVE]`

> Blocked on §2. They cannot be satisfied against reconstructed text.

**AC-G1 `[LIVE]`.** Given the live Trinnex packet, when the packet is rebuilt after the change, then
the `must_have_coverage` check result has a numerator **greater than 0** and its `observed` string
names how many of the counted rows are model-proposed-and-admitted, in the form already used at
`checks.ts:860` (`" (N model-proposed, awaiting your confirmation, not counted either way)"` becomes
`" (N model-proposed and counted)"`).

> **Written against the CHECK, not the gate — see §0.1.** Twelve other deterministic checks can hold
> the gate at `fail` independently, so "the packet ships" is not a criterion this lane can own.
> **A number that rose without saying WHY is the failure mode this AC exists to prevent:** the
> comment at `checks.ts:841` already requires it — *"A count that changed because a model was
> consulted must say so on the surface a reviewer reads, or 'coverage rose' is not falsifiable — the
> reviewer cannot tell a better profile from a chattier model."*

**AC-G2 `[LIVE]` — FIRST establish whether the matcher is even the blocker.** Given the live Trinnex
opportunity, when query P1 and P2 (§2) are run **before any code is written**, then the artifact
records: how many must-have rows already carry a `method='proposed'` row, and whether
`escalation_refusals.over_cap` was non-zero on the run that produced `0 of 12`.

> **This AC can end the lane, and that is a legitimate outcome.** Three distinct causes produce
> `0 of 12` and they need different fixes:
> | if P1/P2 shows | the cause is | what fixes it |
> |---|---|---|
> | proposed rows EXIST on must-haves | the **admission rule** (`ruleEvidenceOf`) | lane 2 as scoped |
> | no proposed rows, `over_cap` non-zero | the **budget** (`chk_evidence_escalate_max`, default 12) | a setting change, no code — F-G12 |
> | no proposed rows, cap not hit, model declined | the **requirement rows** | `D:compound-requirements-unevidenceable` — see AC-G9 |
>
> The brief asks *"does a reasoning judge fix that, or is the extractor still the blocker?"* **This
> query answers it, it costs one round-trip, and it must be run before implementation** rather than
> after. `FEASIBILITY-llm-judgement.md` §7 already made this mistake in the other direction by
> costing work against an unmeasured premise.

**AC-G9 `[LIVE]` — the compound-requirement question, answered rather than assumed.** Given the
`0 of 38` measurement recorded in `D:compound-requirements-unevidenceable` (posting `c5671835`), when
the same rows are put through `escalateOne` with the live transport, then the artifact records the
count of rows the MODEL evidenced with a verified citation, and the outcome is stated as one of:

- **> 0** ⇒ a reasoning judge does move rows the lexical matcher cannot, and lane 2 is worth its cost;
- **= 0** ⇒ **the extractor is the blocker, lane 2 changes nothing on this posting, and that is the
  finding.** Say it plainly and stop; do not manufacture a pass.

> The brief calls this out and it is right to: *"if the rows are unevidenceable by construction, a
> better matcher changes nothing."* A compound row demanding ONE contiguous excerpt covering several
> separate requirements is refused by `list_element_unsupported` (`:745`) **and** would be refused by
> an honest model for the same reason. **This AC is the one that decides whether the lane moves the
> owner's number at all**, and it is cheap: it needs no new code, only `escalateOne` driven over
> those rows.

---

### Group B — the safety properties. These are what make TIER 1 defensible.

**AC-G3 — THE MOST IMPORTANT AC IN THIS FILE. The model tier being unavailable can never move the
gate in the permissive direction, and its failure is VISIBLE.** Given the escalation tier errors,
times out, returns unparseable JSON, is refused, is capped out, or is switched off, when
`runChecks` produces `must_have_coverage`, then:

| tier state | `must_have_coverage` | why |
|---|---|---|
| **disabled** (`chk_evidence_escalate = false`) | decided by deterministic rows ONLY, exactly as today, and `observed` says the model tier is off | the owner turned it off; the previous behaviour is the correct fallback and is stricter |
| **enabled, transport failed / unparseable, on ANY row** | **`not_applicable`** via the existing `na()` (`checks.ts:194`), reason naming the failure | `CLAUDE.md`: *absent evidence is `not_applicable`, never `pass`* — and never `fail` either |
| **enabled, capped out (`over_cap`)** | the count stands but `observed` **names the cap**, e.g. `"(N not attempted — model lookup cap reached)"` | a number silently depending on a budget is the F-G12 defect returning |
| **enabled, model declined / refused (`quote_not_in_record`, `banned_source`, …)** | that row counts as unevidenced ⇒ `fail`, as today | a real answer |

**F-G5 is ABSENT and this AC is what builds it.** `CheckInput.evidence` carries `profileReadable` and
`bySeq` only; `escalation_refusals` never reaches `checks.ts`. The implementation must thread a
`modelTier: { ran: boolean; failures: number; overCap: number; disabled: boolean }` (or equivalent)
onto `EvidenceInput` at `appChecks.ts:102`, and `checks.ts` must read it.

> **Do not invent a new state.** `na()` exists, and `:812-825` is the precedent — all three coverage
> checks already go `not_applicable` together when the profile is unreadable, with the comment
> *"'Your profile does not support this' and 'we could not read your profile' are different
> statements."* **"We could not ask the model" is a third such statement and takes the same shape.**
>
> **Mutations, four, and all four are required:**
> 1. make the injected `fetchJson` throw ⇒ `must_have_coverage` must be `not_applicable`; a test
>    asserting `pass` **or** `fail` must FAIL.
> 2. return unparseable JSON ⇒ same.
> 3. set the cap below the number of open must-haves ⇒ `observed` must contain the cap note; delete
>    the note and the suite must FAIL.
> 4. **delete the `modelTier` field from the `appChecks.ts` projection** ⇒ the suite must FAIL.
>    *(This is the mutation that matters most: `AC-llm-coverage-judge.md`'s own §0-analogue found a
>    field shipped write-only because the SELECT mapping dropped it and the optional interface kept
>    `tsc` quiet. The identical shape is available here.)*

**AC-G4 — the safety floor survives, and is proven to survive at the LOOSEST setting.** Given the
change is complete, when `requirementSupport.SAFETY_FLOOR_RULES` is read, then it is unchanged, every
rule it names still refuses at `threshold = 0`, and **no model verdict can produce a counted evidence
row for a requirement the floor refuses**.

> §0.2. Concretely: `escalateOne` already applies `requirementClass` twice (`worthEscalating` `:170`
> before the call, `verifyProposal` `:132` after) — so eligibility and numeric rows are already
> unreachable by the model. **The floor rules the model tier does NOT currently re-apply are
> `missing_specific_token`, `generic_overlap_only`, `list_element_unsupported` and
> `negated_or_attributed`.** Today that is harmless because a `proposed` row cannot count. **The day
> it counts, the model becomes a bypass around four safety-floor rules.**
>
> **This is the single largest NEW risk lane 2 creates, and it is not in the brief.**
>
> **Mutation:** hand `escalateOne` a proposal whose verified quote carries the requirement's object
> but not its named entity (`Snowflake`), let it be admitted, and confirm a guard FAILS. Restore.
> A test that only checks `verifyProposal` refuses a bad *quote* does not cover this — the quote here
> is genuine and byte-exact; what is missing is the *claim*.

**AC-G5 — the admission rule is explicit, singular, and guarded in all three places.** Given the
change is complete, when `grep -rn "'proposed'" api/src` is run, then every one of the three existing
bars (`checks.ts:784`, `dimensions.ts:455`, `appRequirements.ts:212`) either (a) is unchanged, or
(b) has been changed **deliberately and identically**, and a hardening case
`test('H:proposal-admission-single-rule: …')` asserts they agree.

> **This is the "fix all consumers" rule, and this repo has already paid for breaking it here:** the
> comment at `checks.ts:873` records that an independent verifier caught
> `responsibilities_addressed` and `evidence_placed` left on the unfiltered `evidenceOf` *"34 and 46
> lines under the helper written to prevent exactly this — the 'fix all consumers, not just the one
> you found' rule broken inside one else-branch."* Three files, three bars, one concept.
>
> Note the three are **not** equivalent and the implementer must decide each: `dimensions.ts:455`
> feeds a SCORE, `appRequirements.ts:212` decides what a re-resolve DELETES, `checks.ts` decides the
> gate. Changing the gate's bar while leaving the score's produces two numbers describing the same
> rows that disagree — the exact defect `CLAUDE.md`'s blast-radius rule names.
>
> **Mutation:** change one bar and not the others; the parity case must FAIL.

**AC-G6 — a NEW `method` value, if one is introduced, cannot silently count.** Given the design
introduces any `method` other than `exact` / `anchored` / `proposed`, when the change is complete,
then the DDL check constraint (`appRequirements.ts:52`) lists it, **and** all three consumers in
AC-G5 name it explicitly rather than falling through a `!== 'proposed'` default.

> **This is the crux the brief names in item 4, expressed as a guard.** The two designs are:
> | design | what changes | risk |
> |---|---|---|
> | **(a) keep `method='proposed'`, change what `ruleEvidenceOf` ADMITS** | one line, `checks.ts:807` | every existing `proposed` row in the corpus starts counting **retroactively and silently** the next time checks run. P2 in §2 measures how many that is — run it first |
> | **(b) a new `method` value, e.g. `'judged'`, written only by a new path** | DDL + 3 consumers + a writer | nothing retroactive; but `e.method <> 'proposed'` at `appRequirements.ts:212` would **admit it by accident**, because that predicate names what is excluded rather than what is included |
>
> **Recommendation: (a), because (b)'s failure mode is silent and (a)'s is measurable** — but (a)
> demands P2 be run before the merge, not after. **OD-G1.**
>
> **Mutation:** add a row with a novel `method` and confirm the DDL constraint rejects it; then
> confirm no consumer counts it.

**AC-G7 — determinism: the gate does not flicker on identical input.** Given an unchanged
(requirement text, profile record text, model id, `PROPOSAL_VERSION`), when the packet is built
twice, then `must_have_coverage` is **byte-identical across the two runs**, and the second run makes
**zero** model calls for rows already carrying a proposal.

> **Read the existing behaviour before designing this — it is nearly solved and the brief assumes it
> is not.** `appRequirements.ts:292` `const open = rows.filter(r => !bySeq.get(r.seq))` already means
> only rows with NO evidence are escalated, so a stored proposal is not re-judged. `record_sha256`
> (`evidenceProposal.ts:276`) already pins the record text the quote came from, and
> `proposal_version` and `resolver_version` are already stored. **The pieces of the content key the
> brief asks me to specify already exist as columns.**
>
> What is NOT covered: `appRequirements.ts:247` `delete from requirement_evidence where
> requirement_id = $1 and method = 'proposed'` — a re-resolve **deletes proposals and re-proposes**,
> so the gate CAN change on identical input across a re-resolve. Whether that is acceptable is a
> real decision (**OD-G3**), not a bug to paper over: it is also how a better model reaches old rows.
>
> **The storage key, stated exactly as the brief asks:** `(opp_id, requirement_text, source_key,
> char_start, char_end, record_sha256)` is **already the unique key of `evidence_confirmation`**
> (`appRequirements.ts:943` `on conflict`). Reuse it. Add `model_id` and `proposal_version` to the
> `requirement_evidence` row's identity **only if** a re-judge on a model change is wanted; today
> `proposal_version` is stored but not part of any key, so a prompt change does NOT invalidate a
> stored proposal. **State which of those two behaviours is intended — the brief assumes the
> invalidating one, and the code does the other.**
>
> **On a cache miss mid-run:** a row with no proposal is `not_applicable` for the model tier's
> contribution and falls back to its deterministic verdict. It must **never** be filled with a
> lexical answer that is then *presented* as a model verdict — two predicates inside one number.
>
> **Mutations:** (i) build twice unchanged ⇒ a second run making a model call must FAIL the suite;
> (ii) change one character of a profile record ⇒ `record_sha256` differs ⇒ a re-judge must occur, and
> a test asserting the stale row is reused must FAIL.

**AC-G8 — `supportIn` is not modified, and the deterministic floor still runs first.** Given the
change is complete, when `git diff origin/main -- api/src/functions/tests/requirementSupport.ts` is
run, then it is **empty**, and `appRequirements.ts:292`'s `open = rows.filter(r => !bySeq.get(r.seq))`
still restricts escalation to rows the deterministic pass could not settle.

> §3.0. If the implementer believes `supportIn` must change, that is a scope change requiring the
> owner, not a judgement call — because §0.2 shows what is inside it.
>
> **Mutation:** remove the `open` filter so every row is escalated; a guard must FAIL. (Without it
> the model is consulted on rows a rule already settled, which both costs money and lets a model
> verdict *contradict* a deterministic one with no rule for which wins.)

**AC-G10 — the counted claim is visible, per row, with its quote.** Given a `must_have_coverage`
result counting a model-proposed row, when the owner reads the requirement, then the excerpt, its
source label, and the fact that a MODEL proposed it are shown together — reusing the string
`checks.ts:869` already builds (*"a model proposes \"…\" from {source_label}; confirm it"*), reworded
for a counted row.

> **No dead UI.** If a confirm/reject control is rendered it is wired to the live route
> `POST app/requirement/{seq}/evidence-confirm` (F-G7), not to a stub. If it is not built, no control
> is rendered.

---

### Group C — no regression on what is correct today

**AC-G11 — the existing suite is unchanged and still green.** Given the implementation is complete,
when `cd api && node --test test/*.mjs` runs, then `# tests` ≥ 948 and `# fail 0`.

> Baseline measured this pass on `5501839`: **`# tests 948  # pass 941  # fail 0  # skipped 7`**.
> (`AC-llm-coverage-judge.md` measured `930/18` at `44271bf`; the difference is 11 previously-skipped
> tests now running, not a regression. Use **941/7** as this lane's baseline.)

**AC-G12 `[LIVE]` — the checks measured correct in production do not move.** Given a Trinnex build
before and after, when results are compared, then `skill_char_limit`, `skill_list_count`,
`expertise_phrase_length` and `compact_skills_fit` have **identical state, detail and offenders**.

> The brief cites `skills_1 11/11`, `skills_2 9/9`, `expertise 7/7`. **Those exact figures are
> UNVERIFIED by this pass** (§2, P4) — they are repeated from the brief, not measured. The AC is
> written as *"identical to the pre-change run"*, which is checkable without trusting the figures.

**AC-G13 — no threshold is weakened to make anything pass.** Given the change is complete, when
`checks.ts` and `evidence.ts` are read, then `COVERAGE_THRESHOLD = 0.7`, `EVIDENCE_THRESHOLD = 0.7`,
`MIN_JUDGEABLE_TOKENS = 3` and `WORDING_RUN_TOKENS = 8` are **unchanged in code**, and their existing
assertions pass unmodified.

> A `chk_*` SETTING change by the owner is a different thing and is allowed — that is the whole point
> of F-S4. **The literal in code is the seed and stays.**
> **Mutation:** set `COVERAGE_THRESHOLD = 0.5`; the existing assertions must FAIL.

---

### Group D — LANE 3, stuffing

**AC-S0 — DO THE FREE HALF FIRST. `chk_wording_run_tokens` gets a Settings control, and the
verbatim-lifting number is measured before any model is built.** Given the change begins, when a
Settings control for `chk_wording_run_tokens` is added at `Settings.jsx:1584`'s label map and the
owner's real packets are re-checked at run lengths 8, 6, 4 and 3, then the offender counts at each
setting are recorded in this artifact.

> **This is the `$1 test before the $100 change`, and it is measured, not proposed.** F-S4: the
> column already exists (`checkPrefs.ts:72`), the API writer already accepts it (whitelist derived
> from the DDL), the value is already threaded to `scanWording` (`checks.ts:143 → :554`) — **the only
> missing piece is one line in the Settings label map.** Measured this pass (§1.3):
>
> | runTokens | offenders on a stuffed summary |
> |---|---|
> | 8 (shipped) | **0** |
> | 7, 6, 5 | 0 |
> | **4** | **2** — *"modern software delivery practices"*, *"engineering standards, governance, metrics"* |
> | 3 | 3 — adds *"machine learning operations"* |
>
> **The VERBATIM half of the owner's complaint is a setting change with no code.** It is also the
> honest baseline the model must beat: a model judge that finds only what `runTokens = 4` finds has
> not earned its cost. **AC-S1 is written to require beating it.**
>
> This AC also satisfies **no hardcoded config** for lane 3 on its own — the value is currently
> unreachable by the owner (`grep -rn "chk_wording_run_tokens" app/src/` → no match).

**AC-S1 `[LIVE]` — the model must find what NO run length can.** Given the eMoney summary (the
acceptance bar's document), when the wording judge runs, then it flags **at least one passage that
`scanWording` reports zero offenders on at EVERY run length from 2 to 8** — i.e. a REWORDED lift, not
a verbatim one — with both citations verified per AC-S2.

> **Measured justification (§1.3, probe case A):** *"aligning engineering strategies with business
> objectives"* against the posting's *"Align engineering strategy with business goals"* returns
> **0 offenders at runTokens 2, 3, 4, 6 and 8**. The tokens differ (`strategies`/`strategy`,
> `objectives`/`goals`), so no contiguous-run rule reaches it at any setting. **This class is the
> entire justification for a model on this decision** — and the brief's claim that the check is blind
> to *"phrase-level lifting"* is only half right: it is blind to **reworded** lifting at every
> setting, and blind to **verbatim** lifting only because the default is 8 (AC-S0).
>
> **A correction I had to make to my own first answer here, recorded rather than quietly fixed.** I
> initially wrote that the brief's `AI-first` example is out of reach because it is "two tokens"
> below `WORDING_MIN_CONTENT = 3`. **That was wrong, and the probe disproved it.** `WORD_RE`
> (`figureEcho.ts:478`) is `/[A-Za-z0-9][A-Za-z0-9'-]*/g` — the hyphen is **inside** the class, so
> `AI-first` is **one** token. Measured (`/tmp/probe_ai.mjs`):
>
> ```
> gen: "A proven leader of an AI-first engineering organization delivering measurable outcomes."
> n=2 offenders=1  "an AI-first engineering organization"(4)
> n=3 offenders=1  "an AI-first engineering organization"(4)
> n=4 offenders=1  "an AI-first engineering organization"(4)
> n=8 offenders=0
> "AI-first" ALONE, n=2 -> []            # a 1-token run can never reach n, which is clamped to >= 2
> ```
>
> **The accurate statement:** `AI-first` **on its own** can never be an offender (one token; `n` is
> clamped to `Math.max(2, …)` at `:509`). Lifted **with its surrounding words** it is caught at
> `runTokens` 2-4 and missed at the shipped 8. So it is **not** a second independent rule — it is
> AC-S0 again, and lowering the setting reaches it. Anyone planning against my first answer would
> have concluded the setting change was pointless for this phrase. It is not.

**AC-S2 — BOTH citations are machine-verified, and the check REFUSES rather than shows an unverified
one.** Given the model returns a flagged passage, when the verdict is parsed, then:

1. `generatedText.indexOf(passage) !== -1` on the **original, un-normalised** generated field text;
2. `normalizePostingText(postingText).indexOf(postingLine) !== -1` — the model must name the posting
   line it echoes, and it must be there;
3. the offset pair for the passage is computed **by code** from `indexOf`, never taken from the model;
4. any verdict failing 1 or 2 is **REFUSED** — dropped, counted in a refusal tally, never shown and
   never an offender.

> **Extend, don't duplicate:** this is `verifyProposal`'s discipline (`evidenceProposal.ts:144-150`)
> — *"`indexOf` on the ORIGINAL record text — no lower-casing, no normalization, no fuzzy fallback"*
> — applied to two strings instead of one. **Reuse the refusal vocabulary (`ProposalRefusal`) rather
> than minting a second one.** Point 3 is the brief's own `locate()` reasoning applied here: choosing
> the passage is reasoning, counting characters is not.
>
> **Never repair a near-miss.** No trimming, no nearest-span search. `evidenceProposal`'s comment
> gives the reason and it holds identically: repairing *"would be the module inventing provenance on
> the model's behalf"* — and here the provenance being invented would be an **accusation against the
> owner's own writing**.
>
> **Mutations, two:** (i) alter one character of the returned `passage` ⇒ an accepted verdict must
> FAIL the suite; (ii) return a `postingLine` that is not in the posting ⇒ same.

**AC-S3 — the three-way split survives: the owner's own wording is never named as the employer's.**
Given a passage that appears in BOTH the posting and the owner's profile text, when the wording judge
runs, then it is **not** an offender — the same rule `scanWording` applies at `figureEcho.ts:524`
(`if (contains(prof, words)) { i += len; continue }`).

> **Measured (§1.3, probe case C):** a phrase present in both returns 0 offenders at every run length
> today. The file states why: *"stripping a person's own sentence because the employer wrote something
> similar is the harm, not the fix."*
>
> **A model will not do this on its own** — asked *"is this the employer's wording?"* it will say yes
> to a sentence the owner has written for years. **The profile text must be in the prompt as an
> explicit exclusion, AND the exclusion must be re-applied deterministically after the verdict**, in
> the `buildProposalUser` pattern: two independent guards, in that order (`evidenceProposal.ts:99-104`
> — *"a model cannot decline to quote what it was never given"*, and the post-check stays anyway).
>
> **Mutation:** feed a passage present in the profile and confirm a verdict flagging it is dropped;
> delete the post-verdict profile check and the suite must FAIL. *(Prompt-only exclusion is not a
> guard — this mutation is what distinguishes the two.)*

**AC-S4 — nothing to compare against is `not_applicable`, never `pass`.** Given no posting text, no
profile text, the judge disabled, a transport failure, or unparseable JSON, when
`posting_wording_kept` is produced, then it is **`not_applicable`** with a reason naming the cause —
**never `pass` with 0 offenders**.

> **Precedent already shipped, measured (§1.3, probe case D):** `scanWording` returns
> `{notApplicable: true, reason: "no employer posting text to compare against"}`, and `checks.ts:557`
> already maps that to `na(...)`. **The judge takes the same shape; do not invent a new one.**
> `EscalationOutcome`'s `transport_failed` (F-G4) is the precedent for keeping an outage distinct
> from *"the model found nothing"*.
>
> **Mutation:** make the judge's transport throw ⇒ the check must be `not_applicable`; a test
> asserting `pass` must FAIL.

**AC-S5 — the false-positive bias is stated as a number, on the owner's own writing.** Given the
judge ships, when it is run over the owner's existing artifacts, then the artifact records: passages
flagged, of which how many the owner accepts as lifted, and the **false-positive rate on their own
prose** — and the judge is tuned to err toward **silence**, not toward surfacing.

> **This check is different from every other one in this repo and the direction of its bias must be
> INVERTED relative to the house rule.** Elsewhere `CLAUDE.md` says err toward surfacing. Here the
> check **names the owner's own writing back to them as plagiarism**, and *"a guard people learn to
> ignore is worse than none."* `checks.ts:561`'s own observed string already concedes the point —
> *"N passage(s) read as the posting's wording — **your call**"*.
>
> **The threshold this implies must be a `chk_*` setting** (AC-S6), so the owner moves it themselves
> rather than living with a developer's guess.
>
> **This AC is measurement, not a guard, and it cannot be mutation-proved.** Stated explicitly rather
> than dressed as a test.

**AC-S6 — nothing tunable is hardcoded, in either lane.** Given either lane ships, when the owner
opens Settings, then every behaviour-affecting value has a `chk_*` column **and a control**:

| setting | lane | status today |
|---|---|---|
| `chk_wording_run_tokens` | 3 | **column EXISTS (`checkPrefs.ts:72`), NO Settings control** — AC-S0 |
| `chk_evidence_escalate` | 2 | **ALREADY BUILT**, labelled `Settings.jsx:1584` |
| `chk_evidence_escalate_max` | 2 | **ALREADY BUILT**, labelled `Settings.jsx:1586` |
| `chk_wording_judge_enabled` | 3 | NEW — off ⇒ pure `scanWording`, exactly as today |
| `chk_wording_judge_max_calls` | 3 | NEW — the `chk_evidence_escalate_max` precedent |
| `chk_wording_judge_min_confidence` | 3 | NEW — AC-S5's bias knob |
| `chk_proposal_counts_toward_coverage` | 2 | NEW **if and only if** OD-G1 resolves to admitting proposals — the owner's own switch on the §0.4 coupling |

> **Extend, don't duplicate:** `checkPrefColumns()` (`checkPrefs.ts:34`) derives the writer whitelist
> **from the ensure-DDL itself**, so adding a column makes it writable the same day; only the
> `Settings.jsx:1584` label map needs a line. **Do not create a parallel settings store.**
> Model id / temperature / max-tokens: if the implementation pins any of them, they are `chk_*`
> columns too; if it inherits `openaiJson`'s defaults, say so and record the owner's approval rather
> than burying a literal.
>
> **Mutation:** add a `chk_*` column and confirm `checkPrefColumns()` returns it without any other
> edit — this proves the derivation is live rather than assumed.

**AC-S7 — `scanEcho` (figures) is untouched, and this is asserted.** Given either lane ships, when
`git diff` is read, then `figureEcho.ts:344` `scanEcho` and the `posting_figure_echo` check
(`checks.ts:534`) are **unchanged**.

> **The brief asks me to confirm this and I do, with a reason rather than agreement.** A figure is an
> exact token — `$4.2M`, `30%`, `2,400` — and exact match is both necessary and sufficient for it: a
> model cannot be more right about whether a document contains `$4.2M`, and can be wrong. Probe
> (§1.3): `scanEcho` returned `{"echoes":[],"shared":[],"notApplicable":false}` on the stuffed text,
> which is correct — that text contains no figures. **Replacing an exact rule that is already right
> with a model is the change-for-its-own-sake the owner's "only where it makes sense" excludes** —
> the same reasoning that keeps `similarity()` lexical.

**AC-S8 — the owner's Prompts are untouched.** Given either lane ships, when the diff is read, then
it contains **no read of and no write to** the Azure Storage `Prompts` table, and every new prompt is
a constant in this repo carrying an explicit version, in the `PROPOSAL_SYSTEM` /`PROPOSAL_VERSION`
shape (`evidenceProposal.ts`).

**AC-S9 — cost and latency are measured, not estimated.** Given one full Trinnex packet build, when
it completes, then the recorded numbers are: judge calls made, passages judged, tokens in/out,
wall-clock added, and calls on an identical second build.

> Every call-count figure in the brief and in `FEASIBILITY-llm-judgement.md` §4 (21 requirements, 4
> artifacts, 4 calls) is **unverified by this pass** — F-G15. Measure; do not repeat the estimate.
> Note lane 2 adds **zero** new calls if OD-G1 resolves to (a): `escalateOne` already runs today.

---

## 4. MUTATION REGISTER — every new guard, and the exact mutation that proves it is not inert

`CLAUDE.md`: *"THE ONE STEP THAT IS NEVER SKIPPED, AT ANY TIER."* Write the guard, revert the
behaviour it guards, confirm the suite **FAILS**, restore. An inert guard is worse than no guard
because it is believed. Where a mutation is behaviourally equivalent and correctly fails to fail, say
so and do not claim the assertion is proven.

| AC | Guard | Mutation that must make the suite FAIL |
|---|---|---|
| AC-G3a | transport failure is not a pass **or** a fail | Make the escalation `fetchJson` throw ⇒ `must_have_coverage` must be `not_applicable`; asserting `pass` or `fail` must FAIL |
| AC-G3b | unparseable JSON is not a verdict | Return non-JSON ⇒ same |
| AC-G3c | the cap is named in `observed` | Set `chk_evidence_escalate_max` below the open must-have count; delete the cap note ⇒ FAIL |
| AC-G3d | **the `modelTier` signal is actually READ** | Delete the `modelTier` field from the `appChecks.ts:102` projection ⇒ FAIL. *(The write-only-field shape that has already shipped once in this repo.)* |
| AC-G4 | the safety floor is not bypassed by the model | Admit a proposal whose verified quote omits a NAMED entity (`Snowflake`) ⇒ a guard must FAIL. **The quote is byte-exact here, so a quote-verification test does NOT cover this** |
| AC-G5 | the three `proposed` bars agree | Change `checks.ts:784`'s bar and not `dimensions.ts:455` ⇒ the parity case must FAIL |
| AC-G6 | a novel `method` cannot count | Insert a row with `method='judged'` ⇒ the DDL constraint must reject it; then confirm no consumer counts it |
| AC-G7a | no re-judge on identical input | Build twice unchanged ⇒ a second model call must FAIL the suite |
| AC-G7b | a changed record DOES re-judge | Change one character of a profile record ⇒ `record_sha256` differs ⇒ asserting the stale row is reused must FAIL |
| AC-G8 | the deterministic floor still runs first | Remove `open = rows.filter(r => !bySeq.get(r.seq))` (`appRequirements.ts:292`) ⇒ FAIL |
| AC-G13 | no threshold weakened | Set `COVERAGE_THRESHOLD = 0.5` ⇒ the existing assertions must FAIL |
| AC-S2a | the flagged passage is verified against the document | Alter one character of the returned `passage` ⇒ an accepted verdict must FAIL |
| AC-S2b | the cited posting line is verified against the posting | Return a `postingLine` absent from the posting ⇒ FAIL |
| AC-S3 | the owner's own wording is never accused | Feed a passage present in the profile; delete the **post-verdict** profile check ⇒ FAIL. *(Prompt-only exclusion is not a guard.)* |
| AC-S4 | no posting/profile/transport is `not_applicable` | Make the judge transport throw ⇒ asserting `pass` must FAIL |
| AC-S6 | the settings whitelist is derived, not typed | Add a `chk_*` column and confirm `checkPrefColumns()` returns it with no other edit |
| AC-S7 | `scanEcho` is untouched | — **no mutation: this is a diff assertion, not a behavioural guard.** Stated so it is not claimed as proven |
| AC-S5 | — | **NOT MUTATION-PROVABLE. It is a measurement of false-positive rate, not a guard.** Said plainly rather than dressed as a test |

**Two entries deliberately record that they cannot be proven** (AC-S5, AC-S7). Per `CLAUDE.md`:
*"when a mutation is behaviourally equivalent and correctly fails to fail, say so and do not claim
the assertion is proven."*

---

## 5. OPEN DECISIONS FOR THE OWNER

Each row: the decision, a recommendation, and what it costs. Numbered so they can be answered by id.
**OD-G1 and OD-G2 are blocking — nothing in lane 2 should be built until they are answered.**

### OD-G1 — BLOCKING. Does a model proposal COUNT, and does it count retroactively?

This is the whole of lane 2 (§0.3). The line is `checks.ts:807`, and it implements the house rule
*"a model may PROPOSE, only an exact rule may ACCUSE"* (`checks.ts:781,790`) — the rule the corrected
scope chooses to replace.

| option | what changes | cost / risk | recommendation |
|---|---|---|---|
| **(a) admit `proposed` rows into `ruleEvidenceOf`** | one line | **Every `proposed` row already in the corpus starts counting the next time checks run, silently and retroactively.** §2 query P2 is the number. Also removes four safety-floor rules from the gate path for those rows (AC-G4) | **Recommended, but ONLY after P2 is run.** Its failure mode is measurable; (b)'s is silent |
| **(b) a new `method` value written by a new path** | DDL + 3 consumers + writer | Nothing retroactive — but `appRequirements.ts:212` `e.method <> 'proposed'` would **admit the new value by accident**, because it names what is excluded, not what is included | Against, unless P2 returns a number you are unwilling to accept retroactively |
| **(c) the CONFIRM BUTTON — a HUMAN accuser** | **ALREADY IN PROGRESS, uncommitted — §0.6** | Raises `must_have_coverage` off zero **with no model trusted at all**. Keeps the house rule intact | **It is already being built. Do not duplicate it** — check that lane before writing any confirm UI |

> **(c) is not an alternative to (a) — it is the thing to do first**, and `AC-llm-coverage-judge.md`
> OD-2 says the same on independent evidence. **It is also no longer hypothetical: it appeared in
> this working tree while this pass was running (§0.6).** That materially changes OD-G1: if the human
> confirm path ships, `must_have_coverage` moves off zero with the house rule intact, and (a) becomes
> a second, optional step you can decide with real verdicts in front of you rather than a leap.

### OD-G2 — BLOCKING. The always-on escalation default was granted on a premise lane 2 removes

You instructed (`checkPrefs.ts:222-246`): *"I don't know why the escalation needs to be turned on or
off vs always on … make sure the toggle is automatically on by default."* The code records what made
that safe:

> *"a proposed row is shown beside a requirement and **can never count toward coverage** … It changes
> what the owner is told, never what they are scored."*

**OD-G1(a) or (b) deletes that sentence.** An always-on model tier would then change what you are
**scored**, on every packet, by default.

| option | cost |
|---|---|
| keep escalation ON and let proposals count | maximum movement on the number; a model's judgement is in your gate on every build, by default |
| keep escalation ON, add `chk_proposal_counts_toward_coverage` **defaulting OFF** | one column + one label; you turn the gate change on per-owner when you have seen a page of verdicts |
| turn escalation OFF by default again | reverses your own instruction; not recommended |

> **Recommendation: the middle row.** It honours both of your instructions at once — escalation stays
> on so you keep seeing proposals, and the *scoring* change is a separate switch you flip. It is also
> the cheap-test-before-the-expensive-change shape, and it costs one `chk_*` column.

### OD-G3 — a re-resolve deletes and re-proposes. Is that acceptable?

`appRequirements.ts:247` `delete from requirement_evidence where requirement_id = $1 and
method = 'proposed'` — so a re-resolve discards stored proposals and asks again. **Once proposals
count, this means `must_have_coverage` can change on unchanged input across a re-resolve** (AC-G7).

> **Recommendation: accept it, and make it visible** — it is also how a better model reaches old
> rows, so pinning proposals forever would freeze the tier at whatever it first said. The mitigation
> is AC-G1's `observed` string naming how many counted rows are model-proposed, so a number that
> moved is explainable. Cost of the alternative (content-keyed permanence): a real caching layer, and
> stale verdicts.

### OD-G4 — does `posting_wording_kept` stay a WARNING, or become blocking?

**Surfacing this, not deciding it, as the brief instructs.** Today it is `'warn'` (`checks.ts:561`)
and can only produce a gate `warn` (`:1026`).

| option | consequence |
|---|---|
| stays `warn` | the packet ships with lifted wording; you are told and decide |
| becomes a gate `fail` | a packet cannot ship until the wording is changed |

> **The code has already taken a position and it is worth reading before you decide:** the check's own
> observed string is *"N passage(s) read as the posting's wording — **your call**"*, and `CLAUDE.md`
> calls a wording judgement *"a user judgement call"* whose remedy differs from a figure echo (a
> figure echo is a factual error; reworded wording is a style choice). **A blocking check built on a
> model's opinion of your prose, which AC-S5 cannot prove has a low false-positive rate, is the
> "guard people learn to ignore" shape.**
>
> **Recommendation: stays `warn`.** If you want pressure, the higher-value change is
> `remediation.ts:506-526` — `DIAG` B3 measured that the rewrite prompt forbids INVENTING and never
> forbids COPYING. **Telling the generator not to lift is cheaper and earlier than failing a gate
> after it did.**

### OD-G5 — model, temperature, max tokens

AC-S6 makes enable/cap/confidence owner-settable. **Whether model id and temperature become `chk_*`
columns or inherit `openaiJson`'s defaults is open.**

> **Recommendation: inherit the defaults and record your approval**, per `CLAUDE.md`'s rule that a
> code-only value needs explicit approval. Note `appRequirements.ts:144` already records that
> `temperature: 0` is **not** a determinism guarantee — so exposing it would not buy determinism, and
> AC-G7 gets determinism from storage instead. Cost of the alternative: two more Settings rows.

### OD-G6 — the pre-flight (§2) is a real blocker on the acceptance bar

`AC-G1`, `AC-G2`, `AC-G9`, `AC-G12` and `AC-S1` cannot be evaluated without live Postgres, and no
`boost-pg-mcp-write` tool was available to this pass. **Please refresh the connector before
implementation starts** (~1s/query), or say to use `db-query.yml`. That choice is yours; the
implementer should not make it silently.

> **AC-G2 is the one that matters most here**, and it is cheap: it decides whether `0 of 12` is the
> matcher, the **cap**, or the requirement rows — three different causes with three different fixes,
> and only one of them is this lane.

---

## 6. WHAT THIS PASS DID NOT DO — the honest limits

Observation separated from interpretation, so a wrong inference is catchable.

| | |
|---|---|
| **OBSERVED** (executed, reproducible) | `# tests 948 # pass 941 # fail 0 # skipped 7` on `5501839`; **thirteen** checks take a gate-failing state, not one; `supportIn` applies nine gates of which one is owner-settable, and `missing_specific_token` / `generic_overlap_only` still refuse at `threshold = 0`; **`supportIn` ACCEPTS the adversarial name-drop at support 0.714, missing exactly `build` and `develop`**; `ATTRIBUTION_RE` does not cover *"my colleague"*; `scanWording` on a stuffed summary = **0 offenders at runTokens 8,7,6,5** and **2 at 4, 3 at 3**; a REWORDED lift = **0 offenders at every run length 2-8**; a phrase also in the profile = 0 at every run length; absent posting/profile ⇒ `notApplicable`; `AI-first` is ONE token and is caught in context at n≤4, missed at n=8; `grep -rn "evidence-confirm" app/src/` → no match; `grep -rn "chk_wording_run_tokens" app/src/` → no match; `escalation_refusals` never appears in `checks.ts` |
| **INFERRED** (reasoned, not executed) | that admitting `proposed` rows makes the model a bypass around four safety-floor rules — this follows from reading `escalateOne` (which re-applies only `requirementClass`) against `SAFETY_FLOOR_RULES`, but **no run has demonstrated a floor-violating proposal being accepted**, which is exactly why AC-G4's mutation is mandatory; that lane 2 adds zero new model calls under OD-G1(a) — true by construction since `escalateOne` already runs, but the call volume is unmeasured (AC-S9) |
| **NOT DONE** | **No live data was read.** Every Trinnex/eMoney figure in the brief — `0 of 12`, `0 of 38`, `skills_1 11/11`, `skills_2 9/9`, `expertise 7/7`, *"reuses vocabulary from 8 of 8 requirements"*, *"lifts `AI-first` verbatim"* — is **repeated from the brief and UNVERIFIED by this pass** (F-G15, §2). The probes in §1.3 use Trinnex-*shaped* synthetic text from the JD fragments quoted in `DIAG-coverage-recognition.md`; they prove a MECHANISM, not the owner's numbers |
| **MOVED UNDER ME** | The working tree changed DURING the pass: `app/src/api.js`, `app/src/postingAnalysis.js`, `app/src/screens/PostingAnalysis.jsx` and `api/src/functions/tests/appRequirements.ts` were modified at 11:13-11:16 by a concurrent lane (§0.6). One grep in this file therefore has two honest answers depending on when it ran, and it is recorded both ways rather than as the later one |
| **NOT ATTEMPTED** | No code was written. Nothing was committed or pushed. No branch was changed. This pass produced this file only |

### 6.1 Where I disagree with the brief, stated rather than absorbed

- **"Lane 2 = swap `supportIn` for a model" is the wrong description of the work** (§0.3). The judge
  exists, runs, and is on. The work is an **admission decision plus the guards that make it safe**,
  and `supportIn` should not be touched (AC-G8). If the implementer inherits the brief's framing they
  will rewrite a nine-gate safety-floor matcher that nobody asked to be rewritten.
- **The "0 of 12" may not be the matcher's fault at all.** `appRequirements.ts:311` records a measured
  case where the escalation **cap** consumed its budget on responsibilities and `must_have_coverage`
  read `0/12` regardless. That was fixed by the ranking, but the same *shape* — a budget, not a
  matcher — must be excluded by measurement before this lane is justified (AC-G2).
- **The lexical matcher's problem is not only that it is too strict.** §1.4(a) measures it accepting
  *"I am interested in engineering managers, technical teams…"* as evidence of having **built** them.
  The whole existing narrative is "0 of 12 because it is too strict"; it is **also too loose in the
  fabrication direction**, and that is a stronger and more honest argument for lane 2 than the one
  the brief makes.
- **Lane 3's verbatim half is free and should ship first** (AC-S0). The brief presents `scanWording`
  as needing a model. Measured: at `runTokens = 4` it finds the lifted phrases today. Only the
  **reworded** half needs a model, and building the model without first exposing the setting means
  the model's value can never be measured against the honest baseline.

---

## 7. STATUS

**COMPLETE.** Feasibility table (§1), pre-flight (§2), ACs (§3 — `AC-G1..G13`, `AC-S0..S9`),
mutation register (§4), open decisions (§5), honest limits (§6).

**If you read one thing: §0.3.** The lane-2 judge is already built, live and on by default; the lane
is a decision about what `checks.ts:807` admits, and OD-G1 + OD-G2 must be answered before any code
is written.

**If you read a second thing: §0.6.** The human confirm button — the option that moves
`must_have_coverage` off zero with NO model trusted — appeared in this working tree while this pass
was running. It is uncommitted. Reconcile with that lane before writing any confirm UI, and re-grep
any `appRequirements.ts` line number below 650 rather than trusting it.

**Nothing was built, committed, pushed, or branched. This pass produced this file only.**
