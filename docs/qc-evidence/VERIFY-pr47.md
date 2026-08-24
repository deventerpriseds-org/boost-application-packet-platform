# VERIFY — PR #47 (`claude/session-handoff-setup-ctozd3`)

Independent verifier. No shared context with the implementing session. Written incrementally.

- Repo: `deventerpriseds-org/boost-application-packet-platform`
- Scope: `git diff origin/main...HEAD`, origin/main = `06abee7`, HEAD = `02682c3`
- Commits in scope: `f619735`, `02682c3`
- Date of run: 2026-08-24

Diff stat (observed):

```
 .claude/actions.md                | 110 +++++++++++
 .claude/memory.md                 |  66 +++++++
 app/src/assetBlocks.js            |  30 ++--
 app/src/assetGate.js              |   4 +
 app/src/packetBuilder.js          |  50 ++++++
 app/src/postingAnalysis.js        |  29 ++-
 app/src/qcRail.js                 |  42 ++++++
 app/src/screens/AssetBlocks.jsx   | 158 +++++++++++++---
 app/src/screens/OppDetail.jsx     |  26 +++-
 app/src/screens/PacketBuilder.jsx |  73 ++++++---
 app/test/assetBlocks.test.mjs     |  39 ++++-
 app/test/packetBuilder.test.mjs   |  99 ++++++++++
 app/test/postingAnalysis.test.mjs |  61 +++++++-
 app/test/qcRail.test.mjs          | 111 ++++++++++++
 14 files changed, 848 insertions(+), 50 deletions(-)
```

---

## A. Suite + build (run by me, not reported by the implementer)

### `cd app && npm test`

Script is `node --test test/*.test.mjs` (app/package.json:10).

```
1..240
# tests 240
# suites 0
# pass 240
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 605.255741
```

**240 pass, 0 fail.** Cross-checked the total against per-file `test(` counts, which sum to 240:

```
apiForce 3 | assetBlocks 46 | assetGate 25 | corrections 25 | darkTheme 3 | highlight 7
overlay 11 | packetBuilder 5 | postingAnalysis 44 | postingCompare 25 | qcRail 46
```

### `cd app && npm run build`

```
vite v5.4.21 building for production...
✓ 243 modules transformed.
dist/index.html                     0.65 kB │ gzip:   0.42 kB
dist/assets/index-CGO9vNwe.css     36.32 kB │ gzip:   7.16 kB
dist/assets/index-Cjexy5K8.js   1,103.36 kB │ gzip: 297.46 kB
✓ built in 4.20s
```

**Build succeeds.** The only warning is the pre-existing >500 kB chunk-size advisory, not an error.

---

## CLAIM 1 — `offendersByField(result, checkKey)` — **CONFIRMED**

Source read: `app/src/qcRail.js:456–491`.

Each sub-assertion, against the code:

| Sub-claim | Evidence |
|---|---|
| Groups a check's offenders by merge field | `qcRail.js:474` `const field = sectionIdForOffender(checkKey, s)`, then `qcRail.js:481` `(byField[field] \|\| (byField[field] = [])).push(text)` |
| Uses the EXISTING `sectionIdForOffender` | Same line 474 — that function is defined once at `qcRail.js:378` and is the one `offenderLinks` already uses at `qcRail.js:425`. One parse, two consumers. |
| Does not define a second parse | The only string work after resolution is a *prefix strip* of the field already returned (`qcRail.js:476`: `s.startsWith(field + ':') ? s.slice(field.length + 1).trim() : s.trim()`) plus a whole-value quote strip (`:479`). Neither re-decides *which* field — they only remove a prefix the resolver already named. No `indexOf(':')`, no `split(':')`, no `MERGE_FIELDS` scan in this function. |
| Returns `null` for a missing check row | `qcRail.js:471` `if (!row) return null` |
| Returns a `{byField:{}}` object for present-but-clean | `byField` is initialised `{}` at `:472` and the loop body never runs when `offenders` is empty; the return at `:483` is `{ row, byField, state, expected }`. Distinguishable from `null`. |
| Drops offenders resolving to no field | `qcRail.js:475` `if (!field) continue` — no fallback bucket, no "unattributed" key. |

Runtime confirmation that the module actually loads and exports these (not just that they are typed in the file):

```
$ node --input-type=module -e "import * as q from './src/qcRail.js'; ..."
arr exported from qcRail: function
offendersByField: function
offendersForField: function
```

Note on the doc-comment's stated rationale ("SPLIT ON THE FIELD NAME, never on the first colon…
a kept phrase can itself contain a colon"): I checked this is real rather than decorative. Because
the strip is `s.slice(field.length + 1)`, a phrase containing a colon survives whole. This is
exercised by `H:wording-phrase-survives-whole` (observed passing, test #237), and I mutation-proved
that guard — see section B, mutation M1.

---

## My own browser probe — rendered-DOM evidence, not a source grep

The implementer's new guards for the UI claims are **source greps** (`assert.match(src, ...)` over
`AssetBlocks.jsx`). A grep proves the markup is typed; it does not prove it renders. So I wrote my
own probe against the REAL `<AssetBlocks>` in headless Chromium, with the API fulfilled from
fixtures I chose, and asserted the DOM. Files (temporary, deleted after the run — see "tree clean"
at the end):

- `app/test/browser/zzverify-probe.jsx` / `.html` — mounts the real component with requirement rows
- `app/test/browser/zzverify.mjs` — the runner

Two of my first-pass fixture assumptions were wrong and I corrected them (both were my error, not
the product's), and I record them because they are load-bearing facts about the payload shape:

1. `engineRows` (assetGate.js:269-276) **prefers** `result.engines[engine].results` when the key is
   present. My first fixture supplied `engines: { deterministic: { results: [] } }` alongside a flat
   `results`, which hid the flat rows entirely and made the margin correctly not render.
2. `correctionRow` derives undone from `reverted_at || reverted_by` (assetGate.js:472) — **not**
   from a boolean called `undone`.

Final result:

```
PASS  the wording margin renders at all :: ["ResumeSummary","SkillsBullets1"]
PASS  it renders in exactly the TWO fields the offenders name, not the third :: saw 2 margins: ["ResumeSummary=1","SkillsBullets1=1"]
PASS  the heading is CHECK_LABEL's wording, not a literal :: "WORDING KEPT FROM THE POSTING"
PASS  a phrase containing a COLON survives whole :: "Note: we ship weekly"
PASS  the wrapping quotes are stripped
PASS  every listed phrase carries its own `kept` status :: [["1",1],["1",1]]
PASS  the offender naming no merge field is DROPPED, not attached anywhere
PASS  the checker's own rule travels with it (expected, not retyped)
PASS  no gate word leaks into the kept list
PASS  the reword link renders beside a kept phrase :: 2
PASS  the ask box was closed before the reword link was clicked :: 0
PASS  clicking "Tweak this" OPENS the field's own ask box :: 1
PASS  and seeds it with the reword sentence, unsent :: "Reword \"Note: we ship weekly\" so it does not repeat the posting's wording."
PASS  the per-field control reads "List Tweaks" (not "Ask for a change") :: ["Cancel","List Tweaks","List Tweaks"]
PASS  the chip legend renders :: ["RQ-MH must-have","RESP responsibility","RQ-NTH nice-to-have"]
PASS  it spells out RQ-MH / RQ-NTH / RESP across the asset
PASS  a field legend lists ONLY the kinds that field carries
PASS  the chips themselves read RQ-MH / RQ-NTH / RESP, not M / N / R :: ["RQ-MH 2","RESP 4","RQ-NTH 3"]
PASS  "N corrected" renders on the meter row :: ["2 corrected"]
PASS  it prints the SERVER count (2 = 3 rows minus 1 undone), NOT rows.length (3) :: ["2 corrected"]
PASS  an UNMEASURED change log renders NO corrected token at all :: []
PASS  and does not print "0 corrected" anywhere
PASS  the wording margin still renders when the change log is unmeasured (independent paths)

23/23 checks passed
```

The fixture behind the "2 corrected" assertion is the discriminating one: **three** correction rows,
**one** carrying `reverted_at`. `rows.length` is 3; the server-measured `count` is 2. The screen
printed **2**.

---

## CLAIM 2 — "Wording kept from the posting" renders in the field margin — **CONFIRMED**

| Sub-claim | Evidence |
|---|---|
| Actually RENDERS in the field margin | My probe: two `[data-qc="blocks-wording-kept"]` blocks in the DOM, one inside each of the two field blocks the offenders named (`ResumeSummary`, `SkillsBullets1`). Not a grep — the rendered element list. |
| Gated on the phrases passed in, not on a constant | `AssetBlocks.jsx:561` `{wording.length > 0 && (`; `wording` is the prop fed at `:783` from `offendersForField(wording, r.merge_field)`. Probe proof: the **third** field (`SkillsBullets2`), which no offender names, rendered **no** margin — 2 blocks, not 3. A constant gate would have produced 3. |
| Per-phrase `kept` status | `AssetBlocks.jsx:568` renders `<span …>kept</span>` **inside** the `wording.map(...)`. Probe: each block's `kept` count ≥ its `data-qc-n`. |
| Heading from CHECK_LABEL, not a literal | `AssetBlocks.jsx:563` `{checkLabel('posting_wording_kept')}`; `checkLabel` = `CHECK_LABEL[k] \|\| …` (assetGate.js:145); the entry added at assetGate.js:137. Probe: the rendered heading is `WORDING KEPT FROM THE POSTING` (uppercased by `.px-label`'s `text-transform`, which is why a case-sensitive wait failed on my first pass). |

Two behaviours beyond the claim that I checked and that hold: the offender naming no merge field
(`'"quarterly business review"'`) is **absent from the rendered page entirely** rather than parked in
some field, and the `expected` sentence is carried from the row rather than retyped.

---

## CLAIM 3 — "N corrected" comes from `correctionsState().count`, not `rows.length` — **CONFIRMED**

Chain read end to end, then exercised:

1. `correctionsShape` (assetGate.js:424-434) — `count: measured ? rows.filter((r) => !r.undone).length : null`.
   **Undone rows are excluded**, and `count` is `null` for `unchecked` / `absent` / `malformed`
   (`measured` is true only for kinds `ok` and `empty`).
2. `railChangeLog` (qcRail.js:192-194) is `correctionsState` verbatim — no second derivation.
3. `useArtifactCorrections` (AssetBlocks.jsx:118) returns `correctedCount: state ? state.log.count : null`
   — the server figure, **not** `state.log.rows.length`.
4. `meterModel` (assetBlocks.js:411-412) `const n = Number(corrected); const correctedCount = corrected != null && Number.isFinite(n) && n > 0 ? n : null`.
5. `AssetBlocks.jsx:274` renders the token only under `{correctedCount != null && (`.

Live discrimination (my probe, fixture of 3 corrections with 1 `reverted_at`):

- measured payload → rendered exactly **`2 corrected`**. `rows.length` would have been `3`.
- payload with `corrections` **absent** → **zero** `[data-qc="blocks-answers-corrected"]` elements,
  and the string `0 corrected` appears nowhere on the card.

Both halves of the claim hold, and the null-vs-zero distinction is real in the DOM, not only in the
unit test.

---

## CLAIM 4 — `regenerateWithNote` sequencing — **CONFIRMED**

Source: `app/src/packetBuilder.js:79-100`.

| Sub-claim | Evidence |
|---|---|
| Saves the note BEFORE calling generate | `res = await saveNote(trimmed)` at `:84` inside the `if (trimmed)` block; `await generate()` is at `:98`, after the block. Sequential `await`, not `Promise.all`. |
| Aborts on a thrown error | `:85-87` `catch (e) { return { ran: false, … reason: 'note-failed', error: … } }` — returns, never reaches `generate()`. |
| Aborts on `{error}` response | `:91-93` `if (!res \|\| res.error) return { ran: false, … }`. Also covers a null/undefined response (`'no response'`). |
| Aborts on `feedbackAdded: false` | `:94-96` `if (!res.feedbackAdded) return { ran: false, … error: 'the note was not stored' }`. |
| Blank/whitespace = plain re-roll, writes no status | `const trimmed = String(note).trim()` at `:81`; `if (trimmed)` is false for `''` and `'   '`, so `saveNote` is never called, `generate()` runs, and the return is `{ ran: true, steered: false, reason: 'plain' }`. |
| Cancel (null) does nothing at all | `:80` `if (note === null \|\| note === undefined) return { ran: false, steered: false, reason: 'cancelled' }` — before any await. |

I exercised all six branches directly rather than trusting the read:

```
$ node --input-type=module -e "<see below>"
cancelled(null)      { ran: false, steered: false, reason: 'cancelled' }  saves=0 gens=0
cancelled(undefined) { ran: false, steered: false, reason: 'cancelled' }  saves=0 gens=0
blank('')            { ran: true,  steered: false, reason: 'plain' }      saves=0 gens=1
whitespace('   ')    { ran: true,  steered: false, reason: 'plain' }      saves=0 gens=1
throw                { ran: false, reason: 'note-failed', error: 'boom' } saves=1 gens=0
{error}              { ran: false, reason: 'note-failed', error: 'nope' } saves=1 gens=0
feedbackAdded:false  { ran: false, reason: 'note-failed', error: 'the note was not stored' } saves=1 gens=0
happy path           { ran: true,  steered: true,  reason: 'steered' }    saves=1 gens=1  order=[save,gen]
```

The `order=[save,gen]` line is the one that matters for the ordering claim: I recorded a push into a
shared array from both stubs, with `saveNote` resolving on a later macrotask than `generate` would
have, and the save still landed first.

---

## CLAIM 5 — no `Request changes` control remains; both screens route through `regenerateWithNote` — **CONFIRMED**

`grep -rn "Request changes" app/src app/test` returns **7 hits, none of them a control**:

```
app/src/screens/AssetBlocks.jsx:470     prose in a comment
app/src/screens/PacketBuilder.jsx:205   prose in a comment
app/src/screens/PacketBuilder.jsx:514   prose in a comment
app/src/screens/OppDetail.jsx:550       prose in a comment
app/test/packetBuilder.test.mjs:32,34   prose in a comment
app/test/packetBuilder.test.mjs:120     the GUARD asserting it is gone
```

No `<button>` or clickable span carries the string in either screen.

Neither screen re-implements the sequencing:

- `PacketBuilder.jsx:544-551` — `onRegenerate` is a 6-line wrapper whose whole body is one
  `regenerateWithNote({ note, saveNote, generate })` call plus a toast on `reason === 'note-failed'`.
- `OppDetail.jsx:558-565` — the same shape, same three arguments.
- Neither contains an `await api.setArtifactStatus(...)` followed by an `await generate(...)`; the
  only `setArtifactStatus(a.id, 'changes', …)` in either file is *inside* the `saveNote` lambda
  handed to `regenerateWithNote`.
- Both import it: `PacketBuilder.jsx:13`, `OppDetail.jsx:4`.

`PacketBuilder`'s `setStatus` lost its `note` parameter and its `res.feedbackAdded` toast branch
(`:513-522`), which is correct — it is now reached only from Approve and Reopen. See finding **C-2**
for the one unreachable path this left behind in the *other* screen.

---

## CLAIM 6 — `KIND_ABBR` defined once; values RQ-MH / RQ-NTH / RESP; legend renders — **CONFIRMED**

Definition count across all of `app/src` — exactly one:

```
app/src/postingAnalysis.js:177  export const KIND_ABBR = { must_have: 'RQ-MH', nice_to_have: 'RQ-NTH', responsibility: 'RESP' }
app/src/assetBlocks.js:165      export { KIND_ABBR, KIND_WORD, KIND_LEGEND } from './postingAnalysis.js'   <- re-export
app/src/screens/AssetBlocks.jsx:33     import
app/src/screens/PostingAnalysis.jsx:21 import
```

The `M`/`N`/`R` pair that used to live at `assetBlocks.js:158` is gone (confirmed against
`git show origin/main:app/src/assetBlocks.js`).

Values and legend rendering are **rendered-DOM** confirmed, not read: the chips came out as
`["RQ-MH 2","RESP 4","RQ-NTH 3"]` and three `[data-qc="blocks-req-legend"]` elements rendered
`RQ-MH must-have`, `RESP responsibility`, `RQ-NTH nice-to-have`, each directly under the chip it
explains, each listing only the kind its own field carries.

**But see finding C-1 below** — the abbreviation was unified and the *number* beside it was not.

---

## CLAIM 7 — "List Tweaks", and exactly one `api.aiEditArtifact` in AssetBlocks.jsx — **CONFIRMED**

- `grep -c 'api\.aiEditArtifact(' app/src/screens/AssetBlocks.jsx` → **1**, at `:519`. (The only other
  mention in the file is inside a comment at `:379`.) No second edit route was added; the reword link
  calls `seedAskReword`, which sets local state (`setAsk`, `setAskOpen`) and sends nothing.
- Rendered DOM: the `[data-qc="blocks-ask-change"]` controls read `["Cancel","List Tweaks","List Tweaks"]`
  — "Cancel" because my probe had already opened one field's box by clicking "Tweak this", which is
  the correct toggle label. No control reads "Ask for a change".
- The reword link is live, not decorative: clicking it took the ask boxes from 0 to 1 and the textarea
  contained `Reword "Note: we ship weekly" so it does not repeat the posting's wording.` — seeded,
  unsent, editable.

*(The `null response` branch was also exercised: `{ran:false, reason:'note-failed', error:'no response'}`,
saves=1 gens=0.)*

---

# B. Mutation proofs

Method: apply the mutation, run `cd app && npm test` (240 tests), record which tests fail,
`git checkout --` the file. My own mutations, not the implementer's. Twelve applied.

## B.1 — Guards that HELD (9 of 12)

| # | Mutation | Result | Killed by |
|---|---|---|---|
| M1 | `offendersByField`: strip at the FIRST COLON instead of by field name | 239 pass / **1 fail** | `H:wording-phrase-survives-whole` |
| M2 | `meterModel`: `n > 0` → `n >= 0`, so a measured zero prints "0 corrected" | 239 / **1 fail** | `H:corrected-count-never-invents-zero` |
| M3 | `correctionsShape`: `count` includes rows the reader undid | 239 / **1 fail** | `an undone correction STAYS in the log and leaves the corrected count` |
| M4 | `offendersByField`: a MISSING check row returns `{byField:{}}` instead of `null` | 239 / **1 fail** | `H:wording-absent-row-is-not-an-empty-one` |
| M5 | `offendersByField`: an offender naming no field is bucketed, not dropped | 239 / **1 fail** | `H:wording-absent-row-is-not-an-empty-one` |
| M6 | `assetBlocks.js`: reinstate a second `KIND_ABBR` with the old `M`/`N`/`R` | 239 / **1 fail** | `H:kind-abbr-single-definition` |
| M7 | `regenerateWithNote`: call `generate()` BEFORE saving the note | 238 / **2 fail** | `H:regen-note-lands-before-the-rebuild`, `H:regen-note-failure-aborts` |
| M8 | `regenerateWithNote`: drop the `feedbackAdded` abort, fall through to an unsteered rebuild | 239 / **1 fail** | `H:regen-note-failure-aborts` |
| M9 | `AssetBlocks.jsx`: keep the margin markup but make it unreachable (`{false && …}`) | 239 / **1 fail** | `H:wording-kept-is-rendered-in-the-margin` |

M3 is the one worth calling out as genuinely load-bearing: it reinstates the exact behaviour claim 3
denies (a count that keeps undone rows) in the **shared selector**, and the existing corrections
suite kills it. That guard is real.

M7/M8 also kill against the **api** suite's retargeted guard — see B.3.

## B.2 — THREE guards that are INERT (this is the finding that matters)

Each mutation below reinstates a real defect, **the full 240-test app suite still passes**, and I
then ran my own browser probe under the mutation to confirm the product visibly regresses.

### M10 — the "N corrected" guard misses any re-derivation not spelled its exact way

Mutation (in `app/src/screens/AssetBlocks.jsx:675`): stop taking `correctedCount` from the hook and
re-derive it in the component from the rows.

```js
// before
const { rows: correctionRows, correctedCount, wording, refresh: refreshCorrections } = useArtifactCorrections(artifact.id)
// after (the defect)
const { rows: correctionRows, wording, refresh: refreshCorrections } = useArtifactCorrections(artifact.id)
const correctedCount = correctionRows ? correctionRows.length : null
```

- `npm test` → **`# pass 240  # fail 0`. Nothing fires.**
- My browser probe under the mutation → the meter renders **`3 corrected`** where the correct
  value is `2 corrected`. An undone correction is counted again, in the rendered product.

Why it slips through: `H:corrected-count-comes-from-the-server` (assetBlocks.test.mjs) is a source
grep with four assertions, and all four still match. Its only negative is pinned to one exact
spelling — `assert.ok(!/corrected=\{correctionRows\.length\}/.test(code))` — and the mutation above
never writes that string. Its positive assertions (`correctedCount: state ? state.log.count : null`,
`corrected={correctedCount}`, `data-qc={BLOCK_HOOKS.meterCorrected}`) all remain literally true while
the value flowing through `correctedCount` has been swapped.

**This is exactly the "an inert guard is worse than no guard, because it is believed" case in
CLAUDE.md.** A behavioural assertion — `meterModel` fed the hook's output, or a DOM probe — would
catch it; the grep cannot.

### M11 — the "one KIND_ABBR" guard misses a second map defined under an alias

Mutation (`app/src/assetBlocks.js:165`):

```js
export { KIND_WORD, KIND_LEGEND } from './postingAnalysis.js'
const ABBR_MAP = { must_have: 'M', nice_to_have: 'N', responsibility: 'R' }
export { ABBR_MAP as KIND_ABBR }
```

- `npm test` → **`# pass 240  # fail 0`.**
- Browser probe under the mutation → the chips render as `M`/`N`/`R` again (my
  `^(RQ-MH|RQ-NTH|RESP) \d+$` assertion matched nothing) **while the legend directly underneath
  still reads `RQ-MH must-have` / `RQ-NTH nice-to-have` / `RESP responsibility`.**

That is *worse* than the drift the PR set out to close: before, the two spellings were on two
different screens; here they contradict each other two lines apart on the same screen.

Why it slips through: the guard tests `/(?:export\s+)?const\s+KIND_ABBR\s*=/` per file. A map
defined under any other identifier and exported `as KIND_ABBR` is invisible to it — and the guard's
own docstring permits exactly that shape ("every other file re-exports or imports it"), so the
evasion is the sanctioned spelling.

### M12 — the "margin is wired" guard misses the phrases never arriving

Mutation (`app/src/screens/AssetBlocks.jsx:783`):

```js
wording={r.merge_field === '__never__' ? offendersForField(wording, r.merge_field) : []}
```

- `npm test` → **`# pass 240  # fail 0`.**
- Browser probe → **zero** `[data-qc="blocks-wording-kept"]` elements. The whole feature is gone
  from the page; my probe drops from 23/23 to 15/24.

Why it slips through: `H:wording-kept-is-rendered-in-the-margin` asserts the *presence* of
`offendersForField(wording, r.merge_field)` and of `{wording.length > 0 && (`. Both survive; the
call is simply never reached. The guard proves the markup and the call are typed, not that the data
reaches them. Note the guard's own comment claims it tests "REACHABILITY, not just presence" — it
tests reachability of the *markup*, not of the *data*, and M12 is on the data side.

## B.3 — the retargeted api-side guard (commit `f90c32c`), mutation-proved

`api/test/hardening.test.mjs` `H:changes-carries-a-reason` reads `app/src/**`. Two mutations:

| Mutation | api suite | Killed |
|---|---|---|
| MA — `regenerateWithNote` calls `generate()` before saving | 761 pass / **1 fail** | yes |
| MB — `PacketBuilder`'s `saveNote` stops carrying the note text | 761 / **1 fail** | yes |

Both hold. The new `saveAt < genAt` ordering assertion is real, not decorative.

## B.4 — tree state after mutation work

```
$ git status --short
 M docs/qc-evidence/VERIFY-pr47.md
```

Every mutated file was restored. The only modification is this report. (See finding **C-10** — the
parent session committed some of my in-flight files while I was running.)

---

# C. What the implementer missed

## C-1 — REFUTED IN PART: the cross-screen drift the PR set out to close is only HALF closed

**`app/src/screens/PostingAnalysis.jsx:221` vs `app/src/screens/AssetBlocks.jsx:147`.**

The PR's own rationale (`postingAnalysis.js:162-166`) is:

> "there WERE two, and they disagreed … so one requirement row rendered as `MH #3` on the posting
> analysis screen and `M3` on every asset step."

The **abbreviation** is now unified. The **number beside it is not.**

```
app/src/screens/AssetBlocks.jsx:147      const n = Number.isFinite(Number(req.seq)) ? Number(req.seq) + 1 : null
app/src/screens/PostingAnalysis.jsx:221  {KIND_ABBR[r.kind] || 'REQ'}&nbsp;#{r.seq}
```

Ground truth for which is right — the primary source, the INSERT that assigns `seq`:

```
api/src/functions/tests/appRequirements.ts:404-412
    for (let i = 0; i < built.rows.length; i++) {
      ... insert into requirement (opp_id, seq, ...) values ($1,$2,...)
      [opp.id, i, ...]
```

**`seq` is a 0-based loop index.** Both screens read the same endpoint (`/app/opportunity/{id}/requirements`,
projected at `appRequirements.ts:174`), so they see identical `seq` values. Therefore the *first*
requirement of a posting renders as:

- **`RQ-MH 1`** on the asset-blocks screen (`+1`), and
- **`RQ-MH #0`** on the posting-analysis screen (raw).

Live half of the evidence: my probe fed `seq: 1` and the chip came out **`RQ-MH 2`**, confirming the
`+1` is live. The other side is a one-line read of `:221`. The API agrees with PostingAnalysis and
prints `Requirement #${seq}` raw (`api/src/functions/tests/appRemediation.ts:417, 442`), so
AssetBlocks is the only 1-based renderer of the three.

**Observation vs interpretation, kept separate:**
- *Observation:* `seq` is stored 0-based; one screen adds 1, the other and the API do not. Confirmed
  from the INSERT and from a rendered chip.
- *Interpretation:* this is **pre-existing** — `Number(req.seq) + 1` is already on `origin/main`
  (`git show origin/main:app/src/screens/AssetBlocks.jsx:132`), so the PR did not introduce it. But
  it is squarely inside the defect class the PR claims to have closed, and unifying the abbreviation
  arguably makes it *more* misleading, not less: a reader who previously saw `MH #3` and `M3` knew
  they were looking at two different notations, whereas `RQ-MH #0` and `RQ-MH 1` look like the same
  notation naming two different requirements. Which side should change is a product call.
- Neither the new `H:kind-abbr-values` nor `H:kind-legend-covers-every-chip` guard touches the number.

## C-2 — CI WAS RED at `02682c3`, one of the two commits I was briefed to verify

I was told the branch was 2 commits ahead of `origin/main`. At the tip of those two commits the
**api** suite fails. Confirmed by my own run in a clean worktree at that exact commit:

```
$ git worktree add /tmp/pr47-02682c3 02682c3 && cd /tmp/pr47-02682c3/api && npm run build && npm test
not ok 366 - H:changes-carries-a-reason: the note is stored, sent, applied, and retired only on success
# tests 762
# pass 761
# fail 1
```

The failing assertion was `onSetStatus(a, 'changes', note` — pinned to the button this PR removed.

Two consequences worth stating plainly:

1. **`cd app && npm test` — the command in my brief, and the one the implementer used — is not
   sufficient for this repo.** `api/test/hardening.test.mjs` reads `app/src/**` for cross-cutting
   guards, so an app-only change can break the api suite. The implementer diagnosed this themselves
   in `f90c32c`: `./scripts/check.sh app` skips the api suite.
2. It was fixed in **`f90c32c`**, which landed *during* this verification, after my scope was fixed.
   I verified it anyway: at current HEAD the api suite is **762 pass / 0 fail** (my run), and the
   retargeted guard is mutation-proved in B.3.

## C-3 — REFUTED: a comment claims the `changes` status is no longer written; it still is

`app/src/screens/PacketBuilder.jsx:219`:

> "`changes` stays in the enum and the schema CHECK - we simply stop writing it."

Contradicted by line **547 of the same file**, and by `OppDetail.jsx:562`:

```
app/src/screens/PacketBuilder.jsx:547   saveNote: (text) => api.setArtifactStatus(a.id, 'changes', text),
app/src/screens/OppDetail.jsx:562       saveNote: (text) => api.setArtifactStatus(a.id, 'changes', text),
```

Every **steered** regenerate writes `changes` before generating. What stopped is writing it from a
dedicated button; the status itself is written more or less as often as before.

**Answering the STATUS_TONE question directly: the `changes` entry is NOT dead.** It is reachable
both from existing DB rows and from new writes on this very branch, so `STATUS_TONE` /
`ART_STATUS_TONE` mapping `changes: 'red'` is correct to keep. Also note `PacketBuilder.jsx:202` and
`OppDetail.jsx:627` still gate the Approve/Regenerate row on `status === 'review' || status === 'changes'`,
which is still reachable. No dead rendering path was left behind.

(Unrelated but adjacent: that map is duplicated four times — `assetGate.js:49`, `PacketBuilder.jsx:28`,
`Library.jsx:13`, `OppDetail.jsx:8`. Pre-existing, not this PR's doing, but it is the same
one-definition discipline the PR just applied to `KIND_ABBR`.)

## C-4 — a new test's comment contradicts itself, and the half that is wrong is the assertive half

`app/test/qcRail.test.mjs`, `H:wording-phrase-survives-whole`:

> "Replacing the by-name strip with `slice(indexOf(':') + 1)` is BEHAVIOURALLY EQUIVALENT … **This
> test does not fail on that mutation and is not claimed to.**"

…then, fifteen lines later:

> "This half DOES discriminate."

I applied exactly that mutation (**M1**) and the test **failed**. The first sentence is wrong about
the test as a whole; only the *first assertion* is non-discriminating. Worth correcting, because
CLAUDE.md's hardening rule 3 says the comment must let the next reader "tell a real rule from a
guess", and this one tells them the guard is weaker than it is.

## C-5 — CLEAN: no unused `note` path or unreachable branch left in `setStatus`

- `OppDetail.jsx:540` `const setStatus = async (a, status)` — two parameters, no `note`, and it never
  had one on `origin/main` either. Its only callers are `:629` (`'approved'`) and `:633` (`'review'`).
  Nothing unreachable.
- `PacketBuilder.jsx:513` correctly dropped both the `note` parameter and the `res.feedbackAdded`
  toast branch; its remaining callers are Approve and Reopen only. The `feedbackAdded` logic now
  lives solely in `regenerateWithNote`, and `H:no-request-changes-control` asserts `feedbackAdded`
  appears in neither screen.

## C-6 — CLEAN: `arr` is correctly available where newly used

`AssetBlocks.jsx:41` imports `arr` from `../qcRail.js` (new usage, in `ReqLegend` at `:170`).
`qcRail.js` does re-export it (`export { arr }`), verified at runtime, not by reading:

```
$ node --input-type=module -e "import * as q from './src/qcRail.js'; console.log(typeof q.arr)"
function
```

## C-7 — a test harness was not updated for a now-required prop (latent, not yet failing)

`ArtifactCard` gained a required `onRegenerate` prop (`PacketBuilder.jsx:82`) and its Regenerate
button now calls `onClick={() => onRegenerate(a)}` (`:220`). The existing browser harness
`app/test/browser/asset-blocks-probe.jsx:60-65` mounts `ArtifactCard` with `onGenerate={noop}` and
**no `onRegenerate`**, so clicking Regenerate there would throw `onRegenerate is not a function`.
The probe never clicks it, so nothing fails today — but the harness is now wrong.

(`onGenerate` itself is **not** a dead prop: still used at `PacketBuilder.jsx:198` for the initial
generate button.)

## C-8 — the asset-blocks browser probe is 14/20 — but that is PRE-EXISTING, not a regression

`npm run test:blocks` on this branch: **14/20**. Same command in a clean worktree at `origin/main`
(`06abee7`): **14/20, byte-identical failures**:

```
FAIL  library-term placement is stated as unknown
FAIL  the posting-lines stat is stated as unknown too (no requirement rows in this fixture)
FAIL  the stats that ARE measured still render
FAIL  an ungenerated merge field is still shown as static template text
FAIL  the asset HEADER is collapsed by default
FAIL  and collapsing it actually hides the body, not just the label
```

**No regression from this PR.** But the reason nobody noticed: `.github/workflows/test.yml:56` runs
`npm run test:browser` (which is `test/browser/run.mjs`) with `continue-on-error: true`, and
`run-asset-blocks.mjs` is **not run by CI at all**. Six red assertions in a real render probe are
invisible to the pipeline. Out of scope for this PR; flagged because it is the kind of thing that
stays broken forever once it is out of CI.

## C-9 — stale prose referencing the removed labels (tier 3, no assertions affected)

Only comments and docs; no test asserts an old string.

- `app/test/assetBlocks.test.mjs:614` — the **test's own name** still reads
  `H:the-field-carries-its-own-controls: Show original and a field-scoped Ask for a change`. Its
  assertions are correct (they pin `aiEditArtifact` and the hooks, not the label), but the title now
  names a control that no longer exists.
- `docs/qc-evidence/UI-GAP-REGISTER.md:106` and `docs/qc-evidence/triage/resume.md:7` describe the
  **app's** control as "Ask for a change".
- Everything else that mentions "Ask for a change" / "Request changes" is describing the
  **prototype** (`docs/design_handoff/**`, `docs/qc-evidence/qc/*.jsx`, `SPEC.md`), where those are
  still the correct words. Those are fine.

No `M`/`N`/`R` chip literal survives anywhere in `app/src` outside explanatory comments.

## C-10 — the parent session committed my in-flight work mid-run

My brief said "Do NOT commit or push; leave it uncommitted." That was overridden from outside this
agent: commit **`197ab06`** ("WIP: independent verifier's in-flight findings and DOM probe for PR
#47") committed and **pushed** `docs/qc-evidence/VERIFY-pr47.md` in a half-finished state, plus my
three temporary probe files, while I was still running.

Consequences for whoever picks this up:

- The branch on the remote is now **4 commits** ahead of `origin/main`, not 2: `f619735`, `02682c3`,
  `f90c32c`, `197ab06`.
- `app/test/browser/zzverify.mjs`, `zzverify-probe.jsx` and `zzverify-probe.html` are **tracked and
  pushed**. They are my scaffolding, not product code, and must be removed before merge — or, if
  anyone wants to keep them, the "N corrected" and wording-margin assertions in them are precisely
  the behavioural coverage that B.2 shows is missing (see the recommendation below).
- The version of `VERIFY-pr47.md` in `197ab06` stops mid-analysis and contains none of sections B or
  C. Do not read that commit's copy as the review.

---

# Verdict

| Claim | Result |
|---|---|
| 1 — `offendersByField` grouping, null vs clean, drops unattributed | **CONFIRMED** |
| 2 — "Wording kept from the posting" renders in the field margin, CHECK_LABEL heading, per-phrase `kept` | **CONFIRMED** (rendered DOM) |
| 3 — "N corrected" from server `count`, unmeasured renders nothing | **CONFIRMED** (rendered DOM) |
| 4 — `regenerateWithNote` ordering, abort paths, blank re-roll, cancel | **CONFIRMED** (all 8 branches exercised) |
| 5 — no `Request changes` control, no inline re-implementation, both via the sequencer | **CONFIRMED** |
| 6 — `KIND_ABBR` defined once, RQ-MH/RQ-NTH/RESP, legend renders | **CONFIRMED** (rendered DOM) |
| 7 — "List Tweaks", exactly one `api.aiEditArtifact` in AssetBlocks.jsx | **CONFIRMED** |

**All seven claims hold.** app 240/240, api 762/762, `vite build` clean at current HEAD.

What I would not merge without addressing, in priority order:

1. **Three inert guards (B.2).** M10, M11 and M12 each reinstate a defect that visibly breaks the
   product and leave the suite at 240/240. M10 is the worst — it silently re-counts undone
   corrections and prints a wrong number to the owner. The fix is not more greps: these three
   properties are behavioural and want a behavioural test. The probe files that were accidentally
   committed already assert all three.
2. **C-1, the half-closed drift.** `RQ-MH 1` vs `RQ-MH #0` for the same requirement, from a 0-based
   `seq` that one screen offsets and two other consumers do not.
3. **C-3 and C-4, two comments that contradict the code they document.** Tier-3 fixes, but this repo
   treats comments as the record of why a rule exists, and both currently mislead.
4. **C-10**, remove the accidentally-committed `zzverify*` probe files before merge.
5. **C-2's process lesson** is already captured in `f90c32c`; worth making `./scripts/check.sh` with
   no argument the documented pre-push command, since the `app` argument cannot see the api guards
   that read `app/src`.
