# BUILD — GROUP C (4.6-10 "Drop it, leave the line open" + 4.6-11 assistant-request phrasing)

Branch: `claude/three-small-ui-gaps` (base 115b10a). Agent build log — appended as work proceeds.
DO NOT commit/push from this agent; parent commits.

## Status
- [ ] Read contracts (CLAUDE.md, AC-large-medium.md, AC-skill-bank.md)
- [ ] Trace existing write path (owner-edit / seedAskReword / BLOCK_HOOKS)
- [ ] Implement
- [ ] Guards + mutation proofs
- [ ] 0b defect hunt
- [ ] Local render evidence

## Log

### t1 — contracts read (2026-08-26)
- `docs/qc-evidence/AC-large-medium.md:618-731` — GROUP C ACs C.0-C.12 + REGRESSION GUARD C. Tier 2
  with ONE tier-1 AC (C.4, the copy).
- `docs/qc-evidence/AC-skill-bank.md:25` — REFUTES "there is no writer" **for 4.6-9 only**, and
  `:430` states verbatim: *"Not in scope, and deliberately: 4.6-10 … Group C's `ABSENT` writer
  verdict stands for that one, because a keyword decline has no store."*
- Prototype ground truth, read not inferred — `docs/qc-evidence/qc/assets.jsx:82-83`:
  the drop button is `onClick={() => onAsk('Drop … and leave the line it covers open. I would
  rather show a gap than overstate.')}`. **All three prototype actions are `onAsk` — requests, not
  writes.** So 4.6-10 is a REQUEST in the prototype too; only its sentence claims coverage.

### t2 — TIER-1 QUESTION SETTLED: what a drop WRITES, and why not `owner-edit`
The brief asked me to prove the drop goes through `owner-edit` rather than `ai-edit`. Ground-truthed
against the primary source rather than the summary, the premise does not hold for a DROP:

`api/src/functions/tests/appSwaps.ts:44-49` —
```
select distinct c.replacement from correction c … where … c.source = 'owner_edit' …
  .map(r => r.replacement).filter(Boolean)
```
`ownerLabels` is a set of **replacement strings**, and `swaps.ts:279` sets
`driver: (to && ownerLabels.has(to)) ? 'owner'` — it matches a correction's **replacement** against
a swap row's **`to` label**. A drop's replacement is the empty string, which `.filter(Boolean)`
removes from `ownerLabels` before it is ever consulted. **An `owner-edit` DELETION therefore
produces no `ownerLabels` entry, sets no `driver='owner'`, and changes no `unattributed` count.**
The attribution benefit that would justify routing a drop through `owner-edit` does not exist.

Second reason: `owner-edit` splices `replacement` in at the phrase's exact offsets
(`appCorrections.ts:359`). Deleting a bare keyword out of prose yields `Led  initiatives across
teams` — a double space and a mangled sentence, written into `pkg_json`. Only a rewrite can remove
a term grammatically, and the rewrite path is the ask box.

**Conclusion (Observation vs Interpretation):**
- OBSERVED: `ownerLabels` filters empty replacements; `driver='owner'` keys off `to`-label identity;
  the prototype's drop is an `onAsk`; `AC-skill-bank.md:430` puts 4.6-10 outside the owner-edit
  refutation; `AC C.2` forbids a second POST and `AC C.6` forbids a UI write to the audit tables.
- INTERPRETATION: **a drop writes NOTHING at activation.** It seeds an editable sentence into the
  field's own ask box. If the reader presses Send, the write is whatever that existing box already
  writes (`ai-edit`), unchanged by this lane. The UI says so on screen rather than implying a
  recorded decision.

### t3 — build plan
- `assetBlocks.js`: new pure `keywordActions({ keyword, present, canEdit })` → `{ ask, reason }`.
  Logic lives there; the JSX renders and does not decide (the file's own stated split).
- `AssetBlocks.jsx`: extract `seedAsk(sentence)` as the ONE seed-then-open primitive and make the
  existing `seedAskReword` delegate to it (EXTEND, not a second mechanism). Wire the keyword panel's
  drop control to `seedAsk`.
- Hooks: `keywordActions`, `keywordDrop`, `keywordNoAction` — all from `BLOCK_HOOKS`.
- NOT built: the prototype's `Put back "<orig>"` action — it names a displacement
  (`AssetBlocks.jsx:843-847` records "took the place of" as having no source). NOT built: 4.6-9.
