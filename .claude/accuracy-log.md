# Accuracy log — wrong FIRST answers, and the guard each one earns

One row per wrong-first-answer. The columns that matter are **the single source that would have
settled it up front** and **the guard**, because a story without a guard is the failure this file
exists to stop repeating.

---

## 2026-08-25 — "the term library blocks Row 11" (SELF-BLOCK, owner caught it)

**Claim:** the keyword chips, the keyword-yellow highlight and the SPEC 4.6 detail panel could not be
built because `term_library_entry` has no published rows, so "a highlight with no source would be
invented" (`AssetBlocks.jsx:423`). Reported to the owner as *"Row 11 is unbuildable until the library
publishes."*

**Ground truth:** FALSE. `requirement.model_keyword` is jd_table's ATS Keyword, written by the JD
parse (`requirements.ts:408`), returned by the requirements endpoint (`appRequirements.ts:409,413`),
already reduced to a distinct list by the app (`postingAnalysis.js:258`) and **already rendered on
the JD step** (`PostingAnalysis.jsx:401`). Proposed ATS keywords have been flowing end to end for a
long time. The owner: *"the ai generates keywords from the promtps so you will have several it
suggests term library or not... no matter what the notes ssay its a self block unneccasarily."*

**The source that would have settled it:** `grep -rn model_keyword api/src app/src` — one command,
ten hits, four of them consumers. I never ran it.

**Root cause:** I read a CODE COMMENT as a constraint instead of tracing the DATA. The schema rule is
`never scoreable`, which governs SCORING; I applied it to DISPLAY. A model-proposed term with a label
is honest; a model-proposed term inside a coverage count is not. Those are different questions and
the comment answered only the second.

**Guard:** *A comment stating a limitation is a CLAIM about the code, not the code.* Before repeating
any "X is blocked because there is no Y", grep for Y's actual producers and consumers. If Y has a
writer and a reader, the block is about how Y may be USED, not about whether Y exists — say which.

---

## 2026-08-25 — "there is no Undo control in the field margin"

**Claim:** SPEC 4.5's `Changes made` is missing from the field margin; specifically "NO Undo control",
and the undo route is "consumed ONLY on the QC rail". Briefed to an AC subagent as fact.

**Ground truth:** FALSE, and ~90% of that gap was already built. `CorrectionRow` is imported into
`AssetBlocks.jsx:42` from `QcRail.jsx` and mounted IN THE FIELD MARGIN at `:645` with `inField`,
carrying the Undo button, the reason and the suggest box. One definition, two mounts. The client
export is `revertCorrection` (`api.js:205`); `revertOne` is the SERVER handler and appears in this
file only inside a comment — I had grepped the comment and taken it for the export.

**The source that would have settled it:** the import list at the top of the file I was grepping.

**Root cause:** I ran `grep -i undo` against ONE file, got two hits, and concluded absence — when the
control lives inside an IMPORTED component, so its strings are not in that file. **This repo already
had the guard written down** — *"Never claim a capability is ABSENT from a single-file / single-name
grep"* — and I quoted the rule to the owner in the same turn, then did the shallow check anyway.

**Guard (structural, since the prose version demonstrably failed):** an absence claim about a UI
capability must be preceded by BOTH (a) reading the file's import list, and (b) a repo-wide grep for
the capability, not a single-file one. A single-file grep may only support a claim about where
something is MOUNTED, never about whether it EXISTS.

---

## 2026-08-25 — listed the prototype's `Reword it` toggle as open owner-blocked work

**Claim:** ROW 10, the `rewording` state, is "blocked on your answer about where the decision is
stored". Owner: *"i dont know what a i chose to reword this toggle is? was that requested by me?"*

**Ground truth:** the owner never asked for it — it came from the PROTOTYPE
(`Packet QC Prototype.html:137`, a `Reword it`/`Undo` link flipping local `kept` state). And it had
already been DECIDED AGAINST with a substitute shipped: `actions.md:2947-2951` records that the app
ships "Ask for a reword", which seeds the field's own ask box, because the prototype's toggle "flips
local state and nothing else" and shipping it would be a control that forgets ("no dead UI").

**The source that would have settled it:** `grep -rniE reword .claude/actions.md` — the decision and
its reason were already written down.

**Root cause:** I built a status list from a prototype-derived inventory without reconciling it
against the decisions ledger, so a CLOSED row was re-reported as OPEN and attributed to the owner.

**Guard:** every row on a "what is left" list must name its ORIGIN (owner request / SPEC / prototype
inventory) and be checked against `.claude/actions.md` + `.claude/DEFERRED.md` before it is shown to
the owner. A row whose origin is "the prototype" is a PROPOSAL, and must never be presented as
something the owner is blocking.

---

## 2026-08-29 — FOUR wrong answers in one session, all ONE class: an absence I created, reported as an absence in the product

The individual mistakes matter less than the shape, which repeated four times in a day despite the
"Ground-truth before answering" rule already being written in `CLAUDE.md` twice over. **Prose did
not prevent it. Two exits now do.**

| # | Claimed to the owner | Ground truth | The input error | Single source that would have settled it |
|---|---|---|---|---|
| 1 | `supportIn` protects **0 of 20** template skill items; "option C ruled out by data" | the measurement answered a question nobody asked | fed `recordText` a **two-word label**; production feeds **profile records** | `evidence.ts:406` — read the only two production callers |
| 2 | **5 of 7 packet steps** are missing their UI (app bodies 615-628 chars) | app was fine | used a **raw dump** as a route-keyed fixture; key `packet` matched `/packets` | `build-fixtures.mjs` header — it documents this exact trap |
| 3 | **"the 24/20 character limits have been removed from the app's code and/or pipeline"** | **live at 24 and 20** | fixture `/search-prefs` carried no `checks`, so all 24 thresholds rendered unset | `select chk_skill_max_chars, chk_relevant_max_chars from owner_search_prefs` |
| 4 | "the app has no `original -> final` swap row" | shipped `3a577b6`, 2026-08-20, never reverted | grepped for a literal `->`; the source emits `&rarr;` | `git log -S'line.from' -- app/src/screens/AssetBlocks.jsx` |

**#3 is the expensive one.** It was delivered as a catastrophe report. The owner's reply names the
real cost: *"that is a catastrophe because it means I have no clue when you randomly knew that up."*
A false alarm about a core safety property does not just waste a turn — it makes every future report
less believable.

### Root cause, stated structurally

Every guard in this repo asserts things about **the product**. H-cases assert product invariants; the
Stop gate asserts process steps. **Nothing asserted that the measuring instrument was correctly
configured before its output was believed.** `build-fixtures.mjs` *did* print
`!!! THIN FIXTURE SET - the next gap number will be INFLATED and NOT comparable`. I read it and
proceeded. It was advisory. **An advisory warning on an instrument is worth nothing, because the
failure mode is an agent that already believes its number.**

Second root cause, on #4: **a failed search is not an absent feature.** Three of the four are
"absent" claims, which `CLAUDE.md` already calls the heaviest claim available.

### Guards this earned (all mutation-proved the same day)

1. **`build-fixtures.mjs` exits 1 and writes NOTHING** on a thin set — now including a missing
   `checks` thresholds object. `--allow-thin` must be typed on purpose. *Proved: thin dump ->
   `exit=1`, no file; with the flag -> `exit=0`, file written.*
2. **`compare-ui.mjs` runs a CANARY before any comparison** and exits 1 when the fixture cannot
   carry a finding (`/search-prefs` without `checks`, or no `/swaps` key). *Proved against the exact
   fixture that produced #3: `real exit code = 1`, no report written.*
3. **`fixture-refresh.yml` now dumps `owner_search_prefs`** so a fixture can carry the thresholds at
   all — they were never dumped, so NO fixture in this repo's history had them.
4. **`docs/qc-evidence/LOCAL-RENDER-UAT.md`** — the method, its two instruments, and every one of
   these four failures, so the next session inherits the ways the harness lies.

**The standing rule, and it is about instruments rather than products:**

> **An instrument that cannot see has no standing to report an absence.** Before reporting that the
> app is missing X, prove the harness can see a known-present X. If it cannot, the finding is about
> the harness.

**And the second, from #4:** never conclude "absent" from one grep pattern. Search for the rendered
entity (`&rarr;`, not `->`), read the import list, and check `git log -S` before saying a feature
was never built or has regressed.
