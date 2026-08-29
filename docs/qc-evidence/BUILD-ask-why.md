# BUILD — SPEC 4.8-21 `Ask why` on a swap row

Branch: `claude/incumbent-wins-swap` (base `d1476ac`)
Tier: 2 (UI wiring — no gate/score/coverage path). Implement + test + mutation-prove the new guard.

## Log (append-only, written as I go)

- [start] Created this file before any other work. Git state: branch `claude/incumbent-wins-swap`, HEAD `d1476ac`, clean tree.

## Fact finding (all read, not inferred)

| Thing | Where | What it says |
|---|---|---|
| prototype control | `docs/qc-evidence/qc/evidence.jsx:233` | `onAsk(\`Why did you change ${r.orig} in ${r.list}?\`)` — seeds, sends nothing |
| SPEC placement | `docs/qc-evidence/SPEC.md:257` | QC step, **Swaps** tab, beside `Undo this` |
| the app's Swaps tab | `app/src/screens/QcRail.jsx:314 CompareTab`, mounted at `:901` under `tab === 'compare'` | 4-column table: Original / Final / What happened / Why |
| the seed primitive | `app/src/assistantPanel.js:81 applySeed` | set text -> open -> CLEAR the slot; nothing is sent |
| the seed slot | `app/src/screens/PacketBuilder.jsx:764-768 seedAssistant(text, artifactId)` | **returns early without an artifactId** ("never open a panel that cannot send") |
| existing callers | `PacketBuilder.jsx:961` binds the artifact at the call site; `AssetBlocks.jsx:556 seedAsk` | the pattern to EXTEND |
| panel mount | `PacketBuilder.jsx:1101-1104` | `seed` + `onSeedConsumed` |

### The two constraints that shape the build

1. **A swap row is packet-level and has NO artifact.** `swap_decision` (schema.ts:564) has
   `packet_id, list, seq, action, from_label, to_label, requirement_id, …` and **no `artifact_id`
   and no `merge_field`**. But `seedAssistant` refuses a seed with no artifact. So the row must be
   RESOLVED to an artifact before it can seed anything.
   **The resolver already exists**: `listOwnersFromArtifacts(entries)` (`app/src/qcRail.js:701`)
   builds `list -> [{id,label}]` from each entry's insertion rows, and `requirementUsage`
   (`:726`) already uses it to turn a swap's `list` into an artifact. EXTEND that, do not add a
   second map.
2. **`swap.list` IS A RAW ENUM.** `api/src/functions/tests/swaps.ts:24` —
   `'skills_1'|'skills_2'|'relevant_1'|'relevant_2'|'relevant_3'`, enforced by a CHECK constraint
   (`schema.ts:567`). Interpolating the prototype's `${r.list}` verbatim would put `skills_1` on
   screen — exactly the defect recorded at `app/src/assetBlocks.js:765` ("THE THIRD RENDER SITE …
   it interpolates the raw enum"). Note `sharedSourceNote` (`assetBlocks.js:726`) takes `list` and
   uses it ONLY as a map key, never in its sentence — the same discipline.
   **The human name already exists**: insertion rows carry `merge_field`, and
   `FIELD_LABEL`/`fieldLabel` (`app/src/assetGate.js:208-226`) is the ONE table mapping
   `SkillsBullets1 -> "Skills 1"`. `skills_1` -> insertion `merge_field` -> `fieldLabel`.

### Prior ACs on this row, reconciled (CLAUDE.md "Feasibility BEFORE implementation")

`docs/qc-evidence/AC-packet-ui-final.md` §2f + AC 34 said "no `Ask why` is built" — written while the
assistant panel did not exist. `.claude/DEFERRED.md:195` records the panel SHIPPED 2026-08-27 and
says in its own words: *"`4.8-21 Ask why` and `4.7-8 Forwards to the assistant` are no longer
blocked … 4.8-21's target now exists."* AC 34's surviving conditions are honoured here:
- the shape is the proven one — **seed the panel, write nothing, send nothing**;
- **no swap-revert mutation** is built (there is none; `appSwaps.ts` is GET-only), so `Undo this`
  does NOT ship beside it and this button stands alone;
- the `Why` column keeps printing the answer; `Ask why` is a conversational follow-up, not a claim
  that the why was missing.

### A guard that will fire on its own

`docs/qc-evidence/PROTOTYPE-COVERAGE.md:416` carries
`check: absent app/src/screens/QcRail.jsx Ask why`, enforced by
`H:coverage-stale-absent-fails` (`app/test/prototypeCoverage.test.mjs:97`). Adding the button MUST
turn that row from ABSENT to BUILT or the suite fails. That is a free confirmation the control
really landed in that file.

## Plan

1. `app/src/qcRail.js` — add `mergeField` to each `listOwnersFromArtifacts` owner entry (additive;
   existing consumers read `.id`/`.label` only). Add pure `swapAskWhy(swap, owners)` ->
   `{ artifactId, text }` or **null**.
2. `app/src/screens/QcRail.jsx` — `CompareTab` renders the button only where `swapAskWhy` is
   non-null (no dead UI); `QcRail` takes `onSeedAssistant` and computes owners from `entries`.
3. `app/src/screens/PacketBuilder.jsx` — pass `seedAssistant` to `QcRail`.
4. `app/test/qcRail.test.mjs` — the guard `H:ask-why-seeds-the-panel-and-never-names-the-raw-list`.
5. Re-verdict `PROTOTYPE-COVERAGE.md` 4.8-21.


## What was changed

| File:line | Change |
|---|---|
| `app/src/qcRail.js:726` | `listOwnersFromArtifacts` owner entries now carry `mergeField: row.merge_field \|\| null` (additive; every existing consumer reads `.id`/`.label` only) |
| `app/src/qcRail.js:790` | **new** `swapAskWhy(swap, owners)` -> `{ artifactId, where, text }` or `null` |
| `app/src/qcRail.js:89` | **new** `QC_HOOKS.askWhy = 'qc-ask-why'` |
| `app/src/screens/QcRail.jsx:345,364` | `CompareTab` fifth column: the button, rendered only behind `ask &&`, `onClick={() => onAsk(ask.text, ask.artifactId)}` |
| `app/src/screens/QcRail.jsx:752,798,929` | `QcRail` takes `onSeedAssistant`, derives `listOwners` from `entries`, passes both to `CompareTab` |
| `app/src/screens/PacketBuilder.jsx:988` | `<QcRail onSeedAssistant={seedAssistant} />` — the SAME slot the asset cards use at `:961` |
| `app/test/qcRail.test.mjs` | three guards (below) |
| `docs/qc-evidence/PROTOTYPE-COVERAGE.md:416` | 4.8-21 re-verdicted ABSENT -> BUILT |

## Guards and their mutation proofs

Baseline before every mutation: **396 pass / 0 fail**.

| Guard | Mutation | Result |
|---|---|---|
| `H:ask-why-never-names-the-raw-list-enum` | sentence interpolates `${list}` instead of `${where}` — i.e. the prototype's own line, copied verbatim | **FAILED** `not ok 390` |
| `H:ask-why-never-names-the-raw-list-enum` (producer-parity half) | delete `RelevantBullets3` from `FIELD_LABEL` | **FAILED** `not ok 390` |
| `H:ask-why-is-null-unless-it-has-an-artifact-to-be-about` | `holder` falls back to `{ id: null, label: 'Asset' }` instead of returning null | **FAILED** `not ok 391` |
| `H:ask-why-seeds-the-panel-and-sends-nothing` | JSX `{ask && (` -> `{true && (` | **FAILED** `not ok 392` |

Every mutation restored; suite back to 396/396 after each.

**A fourth confirmation came for free and was not written by me.** The ledger guard
`H:coverage-stale-absent-fails` (`prototypeCoverage.test.mjs:97`) fired the moment the button
landed — *"L416 4.8-21: /Ask why/ NOW MATCHES app/src/screens/QcRail.jsx - it was built, re-verdict
the row"* — independently proving the control is in that file, and it only went green again after
the row was re-verdicted.

## Self-attack (CLAUDE.md step 0b), before reporting

1. **Who READS `mergeField`?** Only `swapAskWhy`. `sharedSourceNote` and `requirementUsage` read
   `.id`/`.label`; `PacketBuilder`'s separate render-time `listOwners` (`:431 registerLists`) has no
   `mergeField` and never reaches `swapAskWhy`, which falls back to `holder.label` anyway. Not
   write-only, and nothing else is disturbed.
2. **Can the system PRODUCE the fixture?** Yes, checked against the writer, not assumed.
   `api/.../insertions.ts:20 LIST_FIELD_TO_LIST` is the ONLY thing that writes `insertion.list`, and
   it writes it from exactly `SkillsBullets1/2` and `RelevantBullets1/2/3` — all five of which
   `FIELD_LABEL` names. So in production `where` is always a real label and the slot-name fallback is
   defensive only. That parity is now asserted, and mutation-proven, rather than stated here.
   Insertions ARE fetched on the QC step (`PacketBuilder.jsx:449`
   `withInsertions: activeStep === 'qc' || activeStep === 'jd'`), so the map is populated where the
   button renders.
3. **How many homes does the concept have?** Two components are named `CompareTab`:
   `QcRail.jsx:314` (the QC step's Swaps tab — SPEC 4.8, **this build**) and
   `AssetGateDrawer.jsx:269` (the per-asset drawer — SPEC 4.9, deliberately NOT touched: it is an
   `Overlay`, and seeding a floating panel from inside an overlay is a different design question
   nobody has asked). Said out loud rather than left as an accident of where the edit landed.
4. **Delete each new load-bearing line — does a test fail?** Four mutations, four failures, above.

## Results

- `npm --prefix app test` -> **396 pass, 0 fail**
- `cd app && npm run build` -> `✓ 247 modules transformed`, `✓ built in 4.08s`
- Python codepoint scan of every changed file -> **CLEAN** (no U+2018/2019/201C/201D). No `sed`
  sweep was needed, so the sweep's string-terminating trap was never risked.

## Deliberately NOT built, and why (this is the brief's "refuted premise" section)

- **`Undo this` does not ship beside it**, though SPEC 4.8-21 places `Ask why` next to it. There is
  no swap-revert route in either sense: `appSwaps.ts` is GET-only and `correctionRevert` needs a
  `correction` row with char offsets that no swap has. `AC-packet-ui-final.md` AC 34 forbids
  building one. So the button stands alone in its column — a control with no target is worse than a
  missing one. `4.8-20` stays PARTIAL.
- **The `Why` column is unchanged.** It already prints the answer on every row. `Ask why` is a
  conversational follow-up, and nothing in this change claims the reason was previously missing.
- **Nothing is sent.** The button seeds the panel unsent, per `applySeed`'s contract; the reader
  presses send.
