# AC — 4.6-9 `Swap for another skill…` (skill bank select + Swap), INCLUDING seeding the bank

**Status:** IN PROGRESS — written incrementally as investigation proceeds. Do not treat any
section as final until the `## DONE` marker at the bottom appears.

**Owner direction (verbatim, decisive, overrides the prior "not buildable" recommendation in
`docs/qc-evidence/AC-large-medium.md` Group C):**
> *"build 4.6-9 anyway and make the template skills in the template and the appropriate column
> from the portfolio slide into a skill bank to seed it."*

**Scope:** feasibility table → acceptance criteria → verification plan → size/sequence.
**NO implementation.** No file edited except this one.

---

## Investigation log (append-only, timestamps are session-relative)

- [t0] File created before any investigation (two prior attempts died within 1s and left nothing).

- [t1] Read `AC-large-medium.md` Group C (lines 188-260). Its 4.6-9 `ABSENT` verdict stands on
  `grep -rniE "skill_candidate|skill_bank|skillBank" api/src app/src` → 14 hits, all `skill_candidate`.
  Not re-derived. The question is now the owner's two named sources.
- [t2] **`templateText(token, id, isSlides)` EXISTS and is EXPORTED** — `api/src/functions/tests/packetTemplates.ts:222`.
  It reads a Google Doc **or a Google Slides presentation** and returns flattened plain text.
  Consumer today: `appFacts.ts:41`. So "nothing can read a Slides table" is **FALSE** — but it
  flattens, so *column* structure is lost. That is the real constraint.
- [t3] **`POST /api/app/qc/facts/derive` (`appFacts.ts:74`) is the precedent to EXTEND** — it reads
  the resume template through Google, derives rows, upserts owner-scoped with confirm-protection and
  surfaces conflicts. A skill bank seeder is the same shape.
- [t4] `profileRecords(mc, template)` (`evidence.ts`) reads MasterContext blocks including
  **`softHardSkillsPool`** — a skills-shaped source that already exists in the app. Investigating.
