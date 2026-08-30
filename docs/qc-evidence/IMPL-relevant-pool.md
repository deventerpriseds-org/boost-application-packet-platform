# IMPL — relevant-list baseline is a CATEGORY GROUP, not a TERM

Branch `claude/incumbent-wins-swap`. Files owned by this pass:
`api/src/functions/tests/swaps.ts`, `api/src/functions/tests/evidence.ts`,
`api/test/swaps.test.mjs`, this file.
NOT owned (handoff notes only): `checks.ts`, `config.ts`, `roleFocus.ts`, `pipeline.ts`,
`appPackets.ts`, `insertions.ts`, `schema.ts`, `hardening.test.mjs`, `app/**`.

---

## THE DEFAULT TAKEN — REVERSIBLE, the owner can overrule it

> **Each of the three relevant lists (`relevant_1`, `relevant_2`, `relevant_3`) pairs against the
> FULL pooled TERM set** — the ~40 terms parsed out of `MasterContext.relevantProficiencies`, not
> the 5 `Category: term, term, …` group lines, and not a per-slot slice of them.

**Why.** Nothing in the data says which pooled term belongs to `RelevantBullets1` vs `2` vs `3`.
`evidence.ts` maps all three merge fields to the ONE key `relevantProficiencies`
(`evidence.ts:193-195`). Inventing a 1/3-each split would be a fabricated composite — the failure
the repo's standing rule names explicitly.

**The alternative, named so it can be chosen:** a per-slot mapping, where the owner states how the
pool divides across the three lists (e.g. by category → list, or an explicit ordered assignment in
MasterContext). That needs an owner decision and a MasterContext shape change; it is NOT implied by
anything currently stored.

**Reversal cost:** low. It is the choice of what `master[mergeField]` contains for the three
relevant fields — one function in `evidence.ts` plus the split in `swaps.ts`.

---

## DECISION 2 — also REVERSIBLE, and it is MINE, not handed down

Requirement 3 asked for a rule that does not accuse twice. Working D1 through against the live
numbers forced a second decision, because D1 alone makes the table **much worse**, not better:

> **When a list's baseline is the POOL, Phase 2 (positional pairing) is DISABLED and unpaired
> baseline terms emit NO ROW AT ALL.** A relevant row therefore carries a pooled `from_label` only
> when the action is `kept`. Everything else in the list is an honest `added` (`from_label = null`).

**The arithmetic that forces it.** The pool has **36** terms (measured below). `relevant_1` ships
**3** items, `relevant_2` **2**, `relevant_3` **3** (measured below). Under the unmodified algorithm:

| | per list | × 3 lists |
|---|---:|---:|
| unpaired baseline leftovers after set-membership | ~33 | **~99** |
| each emitted as `dropped` "not carried into the final list" | ~33 | **~99 false accusations** |
| and the SAME term accused in all three lists | — | **triple-counted** |

`AssetBlocks.jsx:404-411` renders every `dropped` row under the heading **"Taken out of this
list"**. So D1 alone would print ~99 of the owner's own proficiencies as things the packet removed
from a list they were never in. That is strictly worse than the 15 category lines it replaces.

**Why position carries no information here.** Phase 2's own justification (`swaps.ts:408-412`) is
that the two lists are *the same fixed slots*: `skills1` has 11 master items for 11 slots, so
leftover *i* of the master genuinely occupied the slot leftover *i* of the final now occupies. A
pool has 36 terms and the list has 3 slots — pool term #k never occupied slot #k. Pairing them is
accusation-by-arbitrary-index, the same class of error as the accusation-by-similarity that Phase 2
was written to *replace*.

**Why the `merged` fallback is suppressed too.** It is `similarity() >= 0.5`. Measured on the live
data: `similarity('AI/ML Strategy', 'AI/ML & Data Plan')` = 2/3 = **0.67**, so the pooled term
`AI/ML Strategy` would be emitted as `merged` into `relevant_1`'s final — and again in any other
list whose final scores. That is fuzzy matching used to ACCUSE, which this repo forbids outright.

**What survives, and it is the useful half.** `kept` (this final IS one of your terms — exact,
order-independent) and `added` (this final is NOT any of your 36 terms — true, actionable, and it
names no innocent original). **Duplicate accusation becomes structurally impossible**: the only
relevant rows carrying a pooled `from_label` are `kept` rows, where `from_label === to_label`, and a
`kept` row is not an accusation. For the same term to be `kept` in two lists the document would have
to print it twice, which `dedupeAcrossLists` (`normalise.ts:100-123`) removes before `buildSwaps`.

**The alternative, named:** emit the ~99 unpaired terms as `dropped` with a non-accusatory
`driver:'rule'` rationale ("in the master pool, not selected for this list"). Rejected — it is 99
rows of noise per packet under a heading that says the opposite, and it still triple-counts. Say the
word and it is a one-branch change.

**What is LOST by D2, stated plainly:** relevant lists no longer produce `swapped` rows, so the
`original → final` arrow disappears for them. That arrow was showing a fabricated original; removing
it is the point. If the owner wants arrows back for relevant, that needs D1's alternative (a
per-slot mapping), not D2's.

---

## GROUND TRUTH — the live master, read from production, not pasted from the brief

`boost-pg-mcp-write` (the preferred transport; it was live, no fallback needed).
`select distinct from_label from swap_decision where from_label like '%: %' and list like
'relevant%' and length(from_label) > 100` returned exactly five rows — these ARE the five
`from_label`s the defect is about, and concatenated with ` | ` they are the live
`MasterContext.relevantProficiencies`:

```
Governance and Compliance: Standards and Compliance, AI/ML Strategy, Cybersecurity Leadership, Data Strategy, Policy Development, Customer-Centricity
Technology Strategy and Transformation: Digital Platform Maturity, SaaS Growth Strategy, Tech-Driven Innovation, Corporate AI Use Cases
Business and Financial Impact: P&L Optimization, Budget and Cost Control, Investment Strategy, Business Decision Modeling, M&A Integrations, Strategic Partnerships, Portfolio Management, Profitability Analysis
Data Analytics and AI: Enterprise Data Strategy, Data Insights Automation, AI/ML Advancements, Data-Driven Decisioning, Predictive Analytics, BI and Visualization, KPI-Driven Execution, Real-Time Intelligence
Execution and Operations: Scaled Agile Engineering, Business Process Re-Engineering, Strategic Roadmapping, Product Design, Innovation Frameworks, Cost Optimization, AI in Operations, Platform Scalability, Global Leadership, Tech Talent Strategy
```

6 + 4 + 8 + 8 + 10 = **36 terms, 5 categories** — independently corroborated by
`docs/qc-evidence/AC-skill-breakdown.md:97-101`, which pins the same 36 as the live field.

**OBSERVATION.** The 15 live relevant rows for the newest affected packet (`from_len` 135–245):

| list | action | from_label (truncated) | to_label |
|---|---|---|---|
| relevant_1 | swapped | `Governance and Compliance: …` (149 ch) | AI/ML & Data Plan |
| relevant_1 | swapped | `Technology Strategy and Transformation: …` (135) | Enterprise Architecture Governance |
| relevant_1 | swapped | `Business and Financial Impact: …` (209) | **Platform Scalability** |
| relevant_1 | merged | `Data Analytics and AI: …` (208) | AI/ML & Data Plan |
| relevant_1 | merged | `Execution and Operations: …` (245) | **Platform Scalability** |
| relevant_2 | swapped | `Governance and Compliance: …` | Cloud Infrastructure Management |
| relevant_2 | swapped | `Technology Strategy and Transformation: …` | Dev Practices |
| relevant_2 | dropped | `Business and Financial Impact: …` | — |
| relevant_2 | dropped | `Data Analytics and AI: …` | — |
| relevant_2 | dropped | `Execution and Operations: …` | — |
| relevant_3 | swapped | `Governance and Compliance: …` | Secured Engineering |
| relevant_3 | swapped | `Technology Strategy and Transformation: …` | Agile Development |
| relevant_3 | swapped | `Business and Financial Impact: …` | Continuous Quality Engineering |
| relevant_3 | dropped | `Data Analytics and AI: …` | — |
| relevant_3 | merged | `Execution and Operations: …` | Secured Engineering |

**INTERPRETATION.** Three things this makes concrete beyond "the label is long":
1. **`Platform Scalability` IS one of the owner's 36 terms** (Execution and Operations, 8th). It is
   currently reported as *`swapped` FROM* `Business and Financial Impact: …` — a term the owner
   still has, reported as a replacement for a line they never wrote. Under D1+D2 it becomes `kept`.
2. `relevant_2`'s three `dropped` rows put three 200-character category lines on screen under
   **"Taken out of this list"**. The owner's whole `Business and Financial Impact` group reads as
   deleted. Nothing was deleted; the list has 2 slots and the pool has 36 terms.
3. The five category strings repeat identically across all three lists — the triple-count.

---

## STATUS LOG

- [x] Progress file created
- [x] `evidence.ts:188-204` — `RelevantBullets1/2/3` all map to `relevantProficiencies`. CONFIRMED root cause.
- [x] `skillPool.ts:130-185` `splitSkillFieldTagged(text, twoLevel)` — REUSED, no third splitter written.
- [x] Live master read from production (above)
- [x] Implemented — `swaps.ts` only (see "evidence.ts deliberately unchanged")
- [x] Build + tests + mutation proofs — all below

---

## WHAT CHANGED, file:line

`api/src/functions/tests/swaps.ts` — the only production file touched.

| site | change |
|---|---|
| `:36` | `import { splitSkillFieldTagged, TWO_LEVEL_FIELDS, SkillOrigin } from './skillPool'` — REUSE. `skillPool.ts` is a leaf (zero imports) so `swaps.ts` stays pure. |
| `:60-67` | `LIST_FIELDS` gains `masterKey` — the MasterContext block each list's master text comes from. |
| `:80-81` | `isPooledMasterField(list)` — reads `skillPool.TWO_LEVEL_FIELDS`, never re-lists it. |
| `:108-111` | `splitBaselineItems(list, block)` — the two-level parser for a pooled field, `splitItems` otherwise. |
| `buildSwaps` | `poolMode = fromMaster && isPooledMasterField(list)`; `categoryOf` map; `withCategory()`. |
| PHASE 2 | `nPos = poolMode ? 0 : Math.min(...)` — positional pairing OFF for a pool. |
| leftover loop | `if (poolMode) { unusedBaseline++; continue }` — no row for an unused pooled term. |
| `added` rationale | `'not present in the master pool'` under pool mode. |
| `ListCounts` | `+ baselineMode: 'list' \| 'pool'`, `+ unusedBaseline: number`. |

**`evidence.ts` deliberately unchanged, though I own it.** The obvious fix — flatten the pool inside
`masterBaseline()` — was rejected after tracing consumers: `appInsertions.loadMasterBaseline()`
(`appInsertions.ts:25-33`) feeds that same map to `insertions.ts` as the **loop-0 `before_text`**,
i.e. what `Show original` displays. There, the owner's pooled block *verbatim* IS the correct
original — the prompt was handed the whole block. Flattening it would have fixed the swap table by
corrupting a different, correct consumer, in a file this pass does not own. The split therefore
happens where the pairing happens.

**Requirement 2 — the category is carried, and it is READ, not write-only.** `swap_decision` has no
category column (DDL, `schema.ts:564-593`). Adding a `from_category` to `SwapRow` would have shipped
write-only — exactly the `correction.frame` defect. It rides on `rationale` instead: a persisted
column, returned by `GET /api/app/packet/{id}/swaps` (`appSwaps.ts` selects `s.*`). Live example:
`"unchanged from the master template (Execution and Operations)"`. Safe against both exact-match
consumers — `OMIT_LIST_RATIONALE` is `===` on `dropped`+`rule` (`assetBlocks.js:596`) and
`CROSS_LIST_RATIONALE_PREFIX` is `startsWith` at position 0 on `dropped` (`:566,:642`); the suffix
is appended only to `kept` rows, which `AssetBlocks.jsx:588` also excludes.

---

## MEASURED — the same production fixture through HEAD and through this branch

Both `buildSwaps` builds imported side by side (`/tmp/dist-head` vs the branch `dist`), same input.

| | BEFORE (HEAD) | AFTER (this branch) |
|---|---:|---:|
| relevant rows | 15 | 8 |
| **distinct `from_label`s behind them** | **5** | 1 |
| **`from_label`s of "Category: a, b" shape** | **15 / 15** | **0** |
| longest relevant `from_label` | **245 chars** | **20 chars** |
| actions | 8 swapped, 3 merged, 4 dropped | 1 kept, 7 added |
| **rows NAMING an original (action ≠ kept)** | **15** | **0** |
| **labels accused in more than one list** | **5** | **0** |

**The BEFORE column reproduces the live rows exactly** — the DB has 8 `swapped`, 3 `merged`,
4 `dropped` across relevant_1/2/3 for that packet, and so does the HEAD build on this fixture. That
is the check that the fixture is one the system PRODUCES rather than one I assembled.

Concrete before/after strings, requirement 1:

| | `from_label` |
|---|---|
| BEFORE | `Business and Financial Impact: P&L Optimization, Budget and Cost Control, Investment Strategy, Business Decision Modeling, M&A Integrations, Strategic Partnerships, Portfolio Management, Profitability Analysis` (209 ch) → `Platform Scalability` |
| AFTER | `Platform Scalability` → `Platform Scalability`, `kept`, rationale `unchanged from the master template (Execution and Operations)` |

`ListCounts` after: `relevant_1 mode=pool orig=36 final=3 kept=1 added=2 unused=35 droppedLabels=0`;
`relevant_2 orig=36 final=2 added=2 unused=36`; `relevant_3 orig=36 final=3 added=3 unused=36`.

---

## REQUIREMENT 4 — skills and expertise are UNCHANGED, proven by differential run, not asserted

Same two builds, same input, on the **live** skills/expertise fixture reconstructed from that
packet's `swap_decision` rows (11 master items → 8 finals for `skills_1`; 9 → 10 for `skills_2`;
7 → 5 for `expertise`):

```
HEAD skills+expertise rows: 28   MINE: 28
BYTE-IDENTICAL: true
skills_1  8×swapped 2×dropped 1×merged   skills_2  9×swapped 1×added   expertise  5×swapped 2×dropped
```

`JSON.stringify` of the full 28-row array is equal between the two builds — every field, not just
the actions. And those 28 actions are exactly the 28 rows the live table holds for that packet.

---

## VERIFICATION RUN — real commands, real counts

```
cd api && npm run build          -> tsc, exit 0, no output
node --test test/swaps.test.mjs      # pass 45  # fail 0   (was 40; +5 new, 1 amended)
node --test test/insertions.test.mjs # pass 18  # fail 0
node --test test/normalise.test.mjs  # pass 14  # fail 0
node --test test/ownerGate.test.mjs  # pass  7  # fail 0
node --test test/skillPool.test.mjs  # pass 22  # fail 0
node --test test/hardening.test.mjs  # pass 115 # fail 0
```

The one amended test is `expertise is a real swap list…`, whose `assert.deepEqual(LIST_FIELDS.expertise, …)`
now includes `masterKey: 'expertise'`. It is a strengthening, not a loosening.

### MUTATION PROOFS — every new guard, defect reinstated, suite must FAIL

| # | mutation applied to `swaps.ts` | result | guards that caught it |
|---|---|---|---|
| M1 | `nPos = poolMode ? 0 : …` → `Math.min(…)` (Phase 2 back on) | **43 pass / 2 fail** | `H:pooled-baseline-accuses-nobody-and-never-twice`, + pre-existing `F-1 citation contract` |
| M2 | delete `if (poolMode) { unusedBaseline++; continue }` | **43 / 2** | `H:pooled-baseline-accuses-nobody…`, `H:pooled-term-in-the-final-is-kept…` |
| M3 | `splitBaselineItems` always `splitItems` (the original defect) | **43 / 2** | same two |
| M4 | `withCategory(o, …)` → plain `'unchanged from the master template'` | **44 / 1** | `H:pooled-term-in-the-final-is-kept-not-swapped-off-a-category` |
| M5 | `relevant_1.masterKey` → `'skills1'` | **41 / 4** | `H:master-key-parity` + 3 others |
| M6 | `isPooledMasterField` → `true \|\| …` (pool mode leaks everywhere) | **30 / 15** | `H:pooled-mode-is-relevant-only-and-only-off-the-master` + 14 |

Every mutation was reverted and the suite returned to **45 pass / 0 fail** (verified after each).

**M1 found a hole in MY OWN guard and it was fixed rather than explained away.** On the first run M1
failed only the pre-existing `F-1` test — my new guards passed. Reason: the leftover loop's
`poolMode` continue sits *above* the `swapped` branch, so re-enabling Phase 2 emits no `swapped`
row; it instead **CLAIMS** the final, and that final silently stops being `added` and vanishes from
the table entirely. Suppressing a false accusation must never suppress a true row. I added an
accounting assertion — every shipped item is covered by exactly one row, and no final is
double-claimed — and re-ran M1: it now fails `H:pooled-baseline-accuses-nobody-and-never-twice`.

---

## HANDOFF — I did not touch these; the parallel agent and the parent own them

1. **`appSwaps.ts` (not mine) — `skill_candidate` volume.** Pooled candidates go from 5 to 36 per
   relevant list: measured **115** candidate rows for the three relevant lists (was 15), so ~108
   extra sequential `INSERT`s per build in `writeSwaps`. I kept the full pool because under D1 the
   pool genuinely IS each list's candidate set, and `skill_candidate` has **no UI consumer** —
   `app/src/assetBlocks.js:492 keywordSwapOptions` reads `skill_bank_entry`, not these rows. If the
   insert cost matters, batch the insert; do not truncate the candidate set.
2. **`checks.ts` (parallel agent).** `ListCounts.expected/observed/mismatch` are untouched — they
   compare the template slot count to `finalCount`, so `fixed_slot_count` behaves as before. But
   `originalCount` for a relevant list is now **36**, not 5: any check that compares `originalCount`
   to a slot count would now be wrong for relevant. Two new fields are available if useful:
   `baselineMode: 'list' | 'pool'` and `unusedBaseline`.
3. **`app/` (nobody in this pass).** Relevant lists now emit **zero** `dropped` rows, so the
   "Taken out of this list" block (`AssetBlocks.jsx:404-411`) disappears for them and
   `restoreOptions` offers nothing there. That is correct — you cannot "put back" a pooled term the
   list never held — but it is a visible change.
4. **A FINDING, not a defect in this code.** On the live fixture only **1 of 8** shipped relevant
   items (`Platform Scalability`) is one of the owner's 36 proficiencies; the other seven are
   `added` — the model wrote them and they are not the owner's terms. The old table hid this behind
   fabricated `swapped` rows. Whether that is acceptable is a pipeline/prompt question for the
   parent, not a swaps question.

## LIMITATIONS — stated rather than papered over

- **The relevant `original → final` arrow is gone.** D2 removes `swapped` for pooled lists. It was
  showing a fabricated original; the honest replacement is `kept` / `added`. Restoring arrows needs
  D1's alternative (an owner-supplied per-slot mapping), not a change here.
- **Inherited comma behaviour.** Inside a two-level group the comma split is unconditional
  (`skillPool.ts:156`), so a proficiency containing a comma would split. Documented at
  `splitBaselineItems`, not re-decided — re-deciding it here is the second splitter the reuse
  exists to avoid. The live field has no such term (36 terms verified).
- **One transient build failure, NOT mine.** A final `npm run build` briefly reported
  `src/functions/config.ts(12,3): error TS2440: Import declaration conflicts with local declaration
  of 'SLOT_FIELDS'` — `config.ts` is the parallel agent's file (untracked siblings `slots.ts` /
  `slots.test.mjs` appeared alongside it) and it was mid-edit. It cleared on the next run: `tsc`
  exit 0, no output, `swaps.test.mjs` 45/0. Recorded so nobody attributes it to this pass. No file
  outside my three was edited — `git status` shows `swaps.ts`, `swaps.test.mjs` and this file as
  mine; `config.ts`, `appChecks.ts`, `appPackets.ts`, `pipeline.ts`, `roleFocus.ts`, `slots.ts` are
  the other lanes'.
- **Not verified live.** Everything above is local: the build, six suites, six mutations and two
  differential runs against production-derived fixtures. Nothing is merged or deployed, so the
  production `swap_decision` table still holds the 15 category-line rows. This is
  "implemented, mechanism verified locally, NOT yet confirmed live."
