# IMPL — five prototype-parity rows on the QC rail / asset gate

**Branch:** `claude/incumbent-wins-swap` · **2026-08-30** · written incrementally.
**Owned files:** `app/src/screens/QcRail.jsx`, `app/src/qcRail.js`, `app/src/assetGate.js`,
`app/src/screens/AssetGateDrawer.jsx`, `app/test/qcRail.test.mjs`, `app/test/assetGate.test.mjs`.
**Not mine (handoff notes only):** `PostingAnalysis.jsx`, `PacketBuilder.jsx`, `AssetBlocks.jsx`,
`assetBlocks.js`, `AssistantPanel.jsx`, `assistantPanel.js`, anything under `api/`.
Nothing committed, nothing pushed — the tree is left for the parent session.

| row | what it asks | verdict |
|---|---|---|
| **4.8-20** | `Undo this` on a swap row | **BUILT** (§1) |
| **4.11-7** | Keep / Revert / Re-run QC on a reply | **PARTIAL** — 2 of 3 in my files, 1 refused with a reason, panel-side handed off (§2) |
| **4.8-11** | attention ordering fail → open → warn → fixed → soft | **BUILT** (§3) — the inversion was real |
| **4.6-8** | keyword panel `Put back "<original>"` | **HANDOFF** — the control is `AssetBlocks.jsx`'s (§4) |
| **4.4-14** | gate count deep-links `n to fix → <title>` | **BUILT** (§5) — and the root cause was not where the doc put it |

## Numbers

| | |
|---|---|
| baseline before any edit | `cd app && npm test` → **396 pass / 0 fail** (861ms) |
| after | **418 pass / 0 fail** — 22 new cases |
| build | `npm run build` → `✓ built in 3.14s`, no errors |
| smart-quote scan | Python codepoint scan over all 4 source files → **0 hits** (post-`sed`, post-build) |
| mutation proof | **17 mutations applied, 17 caught** — one needed the guard tightened first (§6) |
| files touched | only the six I own (`git diff --stat`); `assetBlocks.js` / `AssetBlocks.jsx` / `PacketBuilder.jsx` are a **parallel lane's** edits, not mine |

---

## Ownership findings that shaped the plan (measured, before any edit)

- **The assistant panel is `AssistantPanel.jsx` + `assistantPanel.js`** (`grep -rn "assistant-send"
  app/src/` → `assistantPanel.js:32`; mounted `PacketBuilder.jsx:1107`). Neither is mine → §2.
- **The keyword panel is `AssetBlocks.jsx` + `assetBlocks.js`** (`assetBlocks.js:68`
  `keywordDetail`, `:459 keywordActions`, `:632 restoreOptions`; rendered `AssetBlocks.jsx:982`).
  Not mine → §4, as the brief anticipated.
- **`PacketBuilder.jsx` ALREADY passes a navigation handler to `GateBadge`** —
  `PacketBuilder.jsx:191` `onClick={onOpenFirstFix || undefined}`, computed `:953` from
  `firstFixTarget(qcEntries, a.id)`, and again `:1010-1014` on the send step. So 4.4-14 needed **no**
  cross-lane edit; the reason the sweep measured `cursor: "default"` is a defect in a file I own (§5).

---

## §1 — 4.8-20 `Undo this` on a swap row · BUILT

**The mis-closure, named.** The recorded objection (`qcRail.js` `swapAskWhy` docblock;
`PROTOTYPE-COVERAGE.md:415-416`) is that **no swap-revert MUTATION exists**. Ground-truthed and
still true: `api/src/functions/tests/appSwaps.ts:234` registers exactly one route —
`app.http('swapsGet', { methods: ['GET','OPTIONS'], route: 'app/packet/{id}/swaps' })` — and
`app/src/api.js:190` has one matching read. That objection was then read as *"so the control must
not ship"*, which is a constraint on one implementation mistaken for the absence of the thing.
The prototype's own `Undo this` (`docs/qc-evidence/qc/evidence.jsx:232`) calls
`onAsk('Undo the swap of …')` — the **identical seeder** its `Ask why` sibling calls one line below
at `:233`. Owner: *"we decided to keep both per field and the assistant panel."*

**Built as a seeded request.** `swapUndo(swap, owners)` in `qcRail.js`, sibling to `swapAskWhy`,
rendered at `QcRail.jsx` `CompareTab` beside `Ask why` under `QC_HOOKS.undoSwap` (`qc-undo-swap`,
carrying `data-qc-artifact` and `data-qc-action`). It calls **no route** and asserts no revert.

**AC-34's actual condition still holds, and is now guarded harder than before.** The old guard
clause read `assert.ok(!/>Undo this</)` — it forbade the *control*. It is replaced with three
assertions that forbid the *mutation*: no `api.` call within the undo cell, the click must be
`onAsk(undo.text, undo.artifactId)`, and a new sweep of `api.js` fails if any line matching `swap`
ever gains a `post(`/`put(`/`patch(`/`del(`.

**Null contract inherited exactly** — no owning artifact (`seedAssistant`, `PacketBuilder.jsx:765`,
"never open a panel that cannot send"), nothing named on either side, no list, no owner id → **no
button**. **`fieldLabel` resolution inherited** — `skills_1` reaches the reader as "Skills 1"; the
raw `CHECK`-constrained enum (`schema.ts:567`) never appears, and the asset label is the fallback,
never the enum.

**One refusal `Ask why` does NOT share: `action: 'kept'`.** A kept row is the pass deciding to change
nothing, so an undo there sends a request about an event that never happened. `Ask why` survives on
that row — why something was left alone is a real question. That divergence is why the two need
separate hooks: a sweep that cannot tell them apart cannot tell a correct absence from a gap.

**Three sentences, not one** (`swapped` / `dropped` / `added`) — a drop has no replacement to name,
an add has no original to restore. This is where a mutation initially survived; see §6.

Guards: `H:swap-undo-is-null-unless-it-has-an-artifact-to-be-about`,
`H:swap-undo-refuses-a-kept-row-where-ask-why-does-not`, `H:swap-undo-never-names-the-raw-list-enum`,
`H:swap-undo-says-what-actually-happened-on-each-action`, plus the rewritten clauses 4/4b of
`H:ask-why-seeds-the-panel-and-sends-nothing`.

---

## §2 — 4.11-7 Keep / Revert / Re-run QC · PARTIAL

The prototype hangs three controls on a reply that made changes
(`docs/qc-evidence/qc/assist.jsx:95-97`), under a block rendering `field | from → to` (`:84-89`).
The sweep found *"there is no reply object in the DOM to hang controls on"* and named where the two
existing capabilities live: `qc-correction-undo` and `gate-run-checks` — **both in files I own**.

The app's rendering of *a change that was made*, with its field and its from→to, is the
**correction row** (`CorrectionRow`, `QcRail.jsx`). That is where the three were built. This is a
**relocation**, stated as one — it does not close the panel-side row.

| control | state | evidence |
|---|---|---|
| **Revert** | already there | `QC_HOOKS.correctionUndo` → `POST /app/correction/{id}/revert`, gated by `undoAvailability`. Re-confirmed, not rebuilt. |
| **Re-run QC** | **BUILT** | new `QC_HOOKS.correctionRerun`. Calls `api.runArtifactChecks(artifactId)` — the **same route** the drawer footer's `GATE_HOOKS.runChecks` calls — then `await onUndid()` to re-read, so the gate, the counts and the log describe one moment. Gated on `artifactId`: no artifact, no button. |
| **Keep** | **REFUSED, with the reason rendered** | `keepAvailability(row)` (`assetGate.js`) always returns `{can:false, reason}`, in two branches (applied vs undone). A correction is applied **before** the reader sees it (R1), so there is no pending state for an acceptance to move — the button would send nothing and record nothing. `PROTOTYPE-COVERAGE.md:723` reached the same conclusion independently: *"`Keep` is worse than vacuous (the route commits before it replies)"*. The reason renders at `QC_HOOKS.correctionKeepNote`, per the no-dead-UI rule. |

Guards: `H:correction-keep-renders-a-reason-not-a-vacuous-button` (which also fails if a `Keep`
button ever appears), `H:correction-rerun-calls-the-real-route-and-re-reads-after-it`.

### HANDOFF — 4.11-7, panel side (not closed)
Mounting the trio **on an assistant reply** needs `AssistantPanel.jsx` / `assistantPanel.js`, which
this lane does not own. Note before anyone builds it: the panel today renders no reply object at
all, and its own copy states the design — *"Changes are saved as soon as they are made — there is
nothing to approve afterwards"* and *"Undo is per field, in the field itself, not from here."*
`Keep` should stay refused there for the same reason it is refused here; `Revert` and `Re-run QC`
would be relocations of controls that already exist.

---

## §3 — 4.8-11 attention ordering · BUILT (a real inversion, fixed)

**The order is a claim about severity, so it has ONE home**: `ATTENTION_ORDER = ['fix','open',
'review','fixed','soft']` in `assetGate.js`, with `attentionRank(sev)`. Expressed in the severity
keys `severityFor` already returns, never in raw state+engine — re-deriving that mapping is D6's
job and a second derivation is exactly what went wrong.

**The measured defect.** `severityWeight` sorted on `state` first and used `engine` only as a
tie-break: reviewer `fail` = 50, reviewer `warn` = 40. Through `severityFor` those are `soft`
("Your call") and `review` ("Review") — **opposite ends** of the design's order. So an opinion the
gate may never act on (D6) sorted **above** a finding actually asking for a decision. `railDecisions`
had the same inversion baked in differently, as a hand-rolled `engine → ['fail','warn']` nest.

**Four homes became one.** `severityWeight`/`bySeverity` **moved** to `assetGate.js` beside the order
they read (re-exported from `qcRail.js`, so every existing import is unchanged) — the same move
`pctWidth` made. That mattered: the drawer may not import `qcRail.js`, so `ChecksTab` carried its own
`{ fail:0, warn:1, not_applicable:2, pass:3 }`. It *happened* to agree because it only ever sorted
deterministic rows; it would have stopped agreeing on the first reviewer row, silently.

**Unknown states sort somewhere explicit and are never dropped.** `attentionRank` returns **-1** for
an unrecognised severity — i.e. it sorts to the **top**, following `bandTone`'s stance in the same
file (*"an unrecognised verdict is not permission"*). The trap this avoids is real: a raw
`indexOf` also returns -1, and a caller reading that miss as "no severity" **deletes** the row.
`null` (pass / not_applicable) is the **absence** of a severity, not an unknown one, and sorts after
everything rather than to the top — those two keep their own separate weights.

**`open` and `fixed` are ORDERED-BUT-UNPRODUCED**, deliberately and on the record: `open` keeps its
position (a gap in the design's order would be invisible) but gets no `SEV_LABEL` entry, because
minting a label would invent a bucket the app has no source for — the existing note at
`assetGate.js` `SEV_LABEL` says exactly this. `fixed` is corrections, which live in their own region
and are counted separately.

**Selectable in the DOM:** `CheckRow` now emits `data-qc-sev`, read from the module. Without it the
rendered order can only be checked against state+engine — the very derivation that was wrong — so a
sweep could read `fail, fail, warn` as correct.

Guards: `H:attention-order-has-one-home-and-severityWeight-reads-it`,
`H:reviewer-warn-outranks-reviewer-fail`, `H:unknown-severity-is-surfaced-never-dropped`,
`H:decisions-are-ordered-by-severity-not-by-engine`, `H:one-severity-ordering` (drawer).

---

## §4 — 4.6-8 keyword panel `Put back "<original>"` · HANDOFF, not edited

**The control belongs to another lane's files and I did not touch them.** The keyword panel is
`[data-qc="blocks-keyword-detail"]` (`assetBlocks.js:68`), its action block is
`keywordActions` (`:459`) rendered at `AssetBlocks.jsx:982-989`, and the wording already exists as
`restoreOptions` (`assetBlocks.js:632`), rendered 17× at `blocks-restore-original` as
`Put back "Digital Transformation"`.

### What the next lane needs (read `restoreOptions` — do not invent a second wording)

- **The prototype's own seed** (`docs/qc-evidence/qc/assets.jsx:70-74`) is:
  `I am not comfortable claiming ${t.term}. Put ${swap.orig} back in ${swap.list} and record the
  keyword as uncovered rather than met.` Note it asks for **two** things — the restore *and* the
  coverage being recorded as uncovered — which the existing margin control does not say.
- **`restoreOptions` already produces this shape for the field body**, so the panel control should be
  a third render of that one selector, not a new one. `assetBlocks.js:530` records that it already
  excludes deterministic reverters, which a fresh implementation would miss.
- **The enum trap applies here too.** `${swap.list}` is a `CHECK`-constrained enum
  (`schema.ts:567`); it must go through `merge_field` → `FIELD_LABEL` exactly as `swapUndo` and
  `swapAskWhy` do, or `skills_1` reaches the reader raw.
- **The sweep already closed the "maybe it was suppressed" caveat**: on the portfolio step, chip #4
  renders `blocks-keyword-actions` and `blocks-keyword-drop`, and `/put back|restore/i` against that
  panel is *still* false. So `Put back` is absent even where the panel **does** offer actions
  (`RENDER-SWEEP.md:97-101`). PARTIAL stands unconditionally — it is a real gap, not a suppression.

### Inbound handoff I received (routing note for the parent)
The parallel lane's `IMPL-blocks-rows.md` lists **`AssetGateDrawer.jsx` as not-owned by them** while
its row **4.9-12** (`Ask for a change` in the gate drawer **footer**) lands in that file — mine. It
was not in my brief so I have not built it. If it is wanted, the footer is
`AssetGateDrawer.jsx` `const footer = (…)`, and the mechanism already exists twice
(`blocks-ask-change` ×9, `packet-asset-ask` ×2) — it should be a third mount, not a third mechanism.

---

## §5 — 4.4-14 gate count deep-links `n to fix → <title>` · BUILT

**The doc put the root cause in the wrong place, and the sweep half-corrected it.**
`PROTOTYPE-COVERAGE.md:253` says the badge is *"mounted without `onClick` (`PacketBuilder.jsx:184`)"*.
It is not: `PacketBuilder.jsx:191` passes `onClick={onOpenFirstFix || undefined}` and `:953` computes
it from `firstFixTarget`. The handler was wired the whole time. What the sweep measured —
`role: null`, `tabindex: null`, `cursor: "default"`, a click moving neither `location.hash` nor
`body.innerText.length` — is the handler resolving to **null**.

**Root cause, in a file I own.** `packetFailList` (`qcRail.js`) set
`mergeField: CHECK_SUBJECT_FIELD[check_key] || null`, and that map holds **exactly two** keys
(`company_named`, `company_in_body`). So every ordinary resume finding produced `mergeField: null`,
`firstFixTarget` returned null for the whole asset, and `PacketBuilder` passed `undefined`. A badge
saying `Blocked | 70 to fix` had no target the module could ever produce for it.

**Fix:** resolve through `firstOffenderField(row)` → `sectionIdForOffender`, the module's **one**
parse, already used by `offenderLinks`, `findingsByField` and `fieldSeverities`. Its refusals are
inherited, not re-decided: an offender naming two fields is a finding about the *relationship*
between them (`cross_list_redundancy`), and one naming none stays null. `CHECK_SUBJECT_FIELD`
remains the explicit fallback for a failing row that sent **no offenders at all**.

**Ground-truthed against the producer** (`api/src/functions/tests/checks.ts`) rather than assumed —
and this caught my own bad fixture:

| check | offender shape | resolves? |
|---|---|---|
| `relevant_char_limit` `:435` | `` `${f}: ${i} (${i.length})` `` | **yes** |
| `word_counts` `:621` | `` `${f}: ${w} words (want ${lo}-${hi})` `` | **yes** |
| `empty_merge_fields` `:600` | the bare field name | **yes** |
| list slot count `:411` | `` `${f}: template holds …` `` | **yes** |
| **`skill_char_limit` `:350`** | `` `${s} (${s.length})` `` — **no field prefix** | **no, correctly** |

My first test fixture used `skill_char_limit` **with** a `SkillsBullets1:` prefix. That shape does
not exist: `skills` is flattened across `SkillsBullets1` and `2` (`:343`), so the check genuinely
cannot say which field an over-long item came from. The fixture was rewritten onto the three shapes
the engine really emits, and the `skill_char_limit` case is now asserted to resolve to **null** —
resolving it would be a guess.

**The `<title>` half.** `firstFixFinding(result)` (`assetGate.js`) returns the first `fix`-severity
row's `checkLabel` — the prototype's `it.title` (`packet.jsx:266`), the finding's name, not the
field's. `fix` severity **only**, so a badge can never read "3 to fix — <a reviewer's opinion>": D6
says only a deterministic row can block. Ordered by the same `attentionRank` the lists it links into
use, so the finding the badge names is the one that sorts first when the reader arrives.

**The count is now the control**, not just the badge around it: `GATE_HOOKS.toFixLink`
(`gate-to-fix-link`) wraps `gate-to-fix` with `role="button"`, `tabIndex`, an Enter/Space handler and
`stopPropagation` (so the nested click does not double-fire the badge's). **No handler → no link, and
the plain count still renders** — the number is a fact about the asset whether or not it can be
clicked.

Guards: `H:fail-list-field-is-resolved-from-the-offenders-not-a-two-key-map`,
`H:first-fix-finding-names-a-blocker-never-a-reviewer-opinion`,
`H:gate-count-is-the-deep-link-and-names-the-finding`, `H:first-fix-finding-orders-by-the-shared-rank`.

**Not yet confirmed live.** The mechanism is proven by suite + build here. Whether the live Trinnex
resume badge becomes clickable depends on at least one deterministic **fail** row whose offenders
name a field — four such checks exist (table above), but I could not render the app to observe it.
Re-running `RENDER-SWEEP.md`'s 4.4-14 probe is what would confirm it.

---

## §6 — Mutation proof (17 applied, 17 caught)

Every new guard was written, the behaviour it guards reverted, the suite confirmed **failing**, then
restored. No guard shipped inert.

| mutation | guard that caught it |
|---|---|
| drop `swapUndo`'s `kept` refusal | `H:swap-undo-refuses-a-kept-row-where-ask-why-does-not` |
| drop `swapUndo`'s null contract | `H:swap-undo-is-null-unless-it-has-an-artifact-to-be-about` |
| `where = list` (raw enum) | `H:swap-undo-never-names-the-raw-list-enum` |
| collapse the three sentences to one | `H:swap-undo-says-what-actually-happened-on-each-action` — **see below** |
| restore the old `severityWeight` table | `H:reviewer-warn-outranks-reviewer-fail` |
| unknown severity sorts last instead of -1 | `H:unknown-severity-is-surfaced-never-dropped` |
| restore `railDecisions`' engine nest | `H:decisions-are-ordered-by-severity-not-by-engine` |
| restore the two-key `mergeField` map | `H:fail-list-field-is-resolved-from-the-offenders-not-a-two-key-map` |
| `firstFixFinding` accepts any severity | `H:first-fix-finding-names-a-blocker-never-a-reviewer-opinion` |
| remove the badge deep link | `H:gate-count-is-the-deep-link…` + `every GATE_HOOKS selector is rendered` |
| remove the Keep note | `H:correction-keep-renders-a-reason…` + `every QC_HOOKS selector is rendered` |
| drop `await onUndid()` after re-run | `H:correction-rerun-calls-the-real-route-and-re-reads-after-it` |
| shorten `ATTENTION_ORDER` | `H:attention-order-has-one-home-and-severityWeight-reads-it` |
| drop the badge's `to review` label | the pre-existing badge-labelling guard (repaired, below) |
| restore the drawer's local order table | `H:one-severity-ordering` |
| `bySeverity` filters out settled rows | `H:one-severity-ordering` (+3 others) |
| `severityWeight` moved-home variant | `H:reviewer-warn-outranks-reviewer-fail` |

**One mutation SURVIVED on the first pass and the guard was tightened until it did not.** Collapsing
`swapUndo`'s three sentences to the swap wording alone still passed: with `to_label` absent the
template renders `Undo the swap of "A" for "" in Skills 1` — contains `"A"`, does not contain `"B"`,
and is still distinct from its siblings. Three assertions satisfied by a sentence with a hole in it
that misnames a drop as a swap. Added: no empty quoted pair `""`, and a drop/add may not use the word
"swap". Re-run → caught (`fail count: 1`, that test alone).

## Two pre-existing guards were REPAIRED, not weakened

1. **`the badge labels fixes and reviews separately`** (`assetGate.test.mjs`) sliced
   `GateBadge` + **1600 characters**. The deep link grew the function past that, so the
   `split.review` assertion failed against code that renders `split.review` perfectly well three
   lines below the cut — a guard firing on correct code. Worse, the same cut would have **silently
   stopped covering** the review half had the growth been elsewhere. It now slices to the next
   top-level declaration, covering the whole function however long it gets, and asserts the
   delimiter was found. Mutation-proved (dropping the `to review` label still fails it).
2. **`H:ask-why-seeds-the-panel-and-sends-nothing` clause 4** forbade the *control* (`!/>Undo this</`)
   in AC-34's name. AC-34 forbids the *mutation*. Replaced with four assertions on the mutation and
   the seed, plus a new clause 4b sweeping `api.js` for any swap-shaped `post/put/patch/del`. See §1.
