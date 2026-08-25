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
