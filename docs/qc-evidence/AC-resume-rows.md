# AC — remaining resume-step rows (adversarial, independent)

**Written:** 2026-08-24 · by an independent AC-writing subagent. **Analysis only** — nothing under
`app/src` or `api/src` was touched, nothing was committed.

**Scope:** the rows the brief lists as still open — ROW 2, 6, 7, 9, 10, 11, 12 of the build-order
table in `docs/qc-evidence/COMPONENT-INVENTORY.md:666-679`.

**Ground truth used.** The inventory predates two merged PRs, so every row was re-verified against
`origin/main` (fetched this session; `git rev-parse origin/main` = `b579057`, and
`git diff origin/main -- app/src/screens/AssetBlocks.jsx app/src/screens/PacketBuilder.jsx
app/src/assetBlocks.js app/src/assetGate.js` is **empty**, so the working tree is byte-identical to
`main` for every file these ACs touch). Where a row's stated diagnosis no longer holds, that is
recorded before the ACs rather than after them.

---

## VERDICT FIRST — two of the seven rows are already closed on `main`

Read this before writing any code against the inventory's table.

| Row | Inventory says | Ground truth on `origin/main` | Verdict |
|---|---|---|---|
| **ROW 6** — asset-level "Ask for a change" | `ABSENT`; "`PacketBuilder.jsx:200-240` has `Approve`/`Regenerate`/`Reopen` but no asset-level ask" | **BUILT.** `git show origin/main:app/src/screens/PacketBuilder.jsx` lines 98-101, 224-227, 275-300: an `assetAskOpen` box, `List Tweaks` button on `PACKET_HOOKS.assetAsk`, and `await api.aiEditArtifact(a.id, { instruction: assetAsk.trim() })` — **same route, no `section`**, exactly as the brief demands. | **DROP — regression guard only** |
| **ROW 7** — `sameAsBefore` | `PARTIAL`; "the app always heads the panel `Original - before this posting`, so a block whose original is byte-identical makes a false claim" | **BUILT.** `git show origin/main:app/src/screens/AssetBlocks.jsx:533-535` reads `row.before_text === row.after_text ? 'Identical - template text is not merged per packet' : 'Original - before this posting'`. The false claim is already gone, and the comment at `:528-531` states the reason. | **DROP — regression guard only** |

Both are **verified by reading `origin/main`, not the working tree** — the single source that could
settle "is it shipped". Treat the inventory's rows 6 and 7 as stale, not as work.

That leaves **five** real rows: 2, 9, 10, 11, 12.

---

## TIER ASSIGNMENT (`CLAUDE.md` → "Match the process to the risk")

| Row | Tier | Reason |
|---|---|---|
| ROW 2 — focus ring + scroll-to-field on the asset card | **2** | Pure navigation/render. Touches no gate, no score, no coverage count, names no offender. |
| ROW 6 — asset-level ask | **2** (guard only) | Already built; only a regression test remains. |
| ROW 7 — `sameAsBefore` | **2** (guard only) | Already built; only a regression test remains. |
| **ROW 9 — per-kind stat split** | **TIER 1** | **This is the one the brief's "except anything touching coverage counts" carve-out catches.** The per-kind denominators come from `GET /app/opportunity/{id}/requirements`, the same requirement spine `must_have_coverage` is computed over, and the output is a **coverage count rendered as a claim** (`3 of 5 must-haves`). A wrong denominator is an accusation-grade error: it either flatters ("5 of 5") or falsely accuses ("2 of 9"). Full process: this AC set, independent `verifier` after, mutation-proof every guard, live verification via `api-test.yml` + `ui-verify.yml`. |
| ROW 10 — `rewording` state | **2**, **but its store is tier-1-adjacent** | The toggle is tier 2. If the persisted decision is ever read by a check, a gate, or a coverage count, that read is tier 1 and needs its own pass. AC-10.9 forbids the coupling by default. |
| ROW 11 — `KeyChip` / `KeyDetail` / "Claimed but not in the text" | **TIER 1 for the endpoint, 2 for the chips** | "Claimed but not in the text" **names an offender** (a term the field claims and does not contain). Per `CLAUDE.md`'s standing rule, an accusation must be exact/whole-phrase, never fuzzy. The chip rendering itself is tier 2. |
| ROW 12 — `PickList` | **2** | Portfolio-only; no gate path. See the scoping note in its section. |

---

## ROW 2 (§16) — focus ring + scroll-to-field ON THE ASSET CARD

### Re-verification of the inventory's diagnosis — TWO CORRECTIONS

**Correction 2-A (the brief inherits this one).** *"a scroll exists at `PacketBuilder.jsx:730`"* is
**not evidence for this row.** Read in place, that line is inside `ProfileCompareCard`'s
`onOpenRequirements` on the **JD-analysis step**, scrolling to `document.querySelector('[data-qc=
"posting-analysis"]')`. It has nothing to do with an asset, a merge field, or a finding. Nothing on
the asset step scrolls anything today: `grep -rn "scrollIntoView" app/src/` returns exactly two
sites, that one and `AssetGateDrawer.jsx:140-141`.

**Correction 2-B — the behaviour is NOT "already written", only two-thirds of it is.** The
inventory says the drawer implements it at `AssetGateDrawer.jsx:136-175`. Reading that block: it
implements **scroll** (`scrollIntoView({ block: 'center' })`) and a **static ring**
(`boxShadow: 'inset 0 0 0 2px var(--border-brand)'`). It does **not** implement either of the two
timing behaviours SPEC 4.9 and the prototype name:
- **no `transition: box-shadow 200ms`** — the ring appears instantly;
- **no 2.2s clear** — the ring persists for as long as `focusSection` is non-null, i.e. until the
  drawer is closed. SPEC 4.9 says "outlines it for ~2s".
So "EXTEND, do not duplicate" is the right instruction, but the thing being extended is incomplete.
**A shared helper must be extracted and the drawer must be migrated onto it in the same commit** —
otherwise the repo gains a second, better focus implementation beside the first, which is precisely
the duplication `CLAUDE.md` forbids, and the drawer keeps a ring that never clears.

**Correction 2-C — the real defect is bigger than a ring.** There is no route from a QC-rail finding
to the asset step at all. `QcRail.jsx:668` — `openField = (artifactId, section) => setDrawer({
artifactId, section })` — is the *only* consumer of a resolved section, and it opens the drawer.
The ring is the last 10% of this row; the routing is the other 90%. Scope it as "land a finding on
the card", not "add a box-shadow".

### Preconditions / dependencies
- The anchor already exists: every field card renders `data-qc="blocks-field"` with
  `data-qc-field={row.merge_field}` (`AssetBlocks.jsx:748-750`). No new DOM contract is needed.
- **Two disclosures stand between a deep link and its target** and both can be closed:
  `ASSET_BODY_DEFAULT_OPEN` (the artifact card body, `packetBuilder.js:56`) and `AssetBlocks`'
  own `defaultOpen` blocks disclosure (`AssetBlocks.jsx:775`). Defaults are open today; a reader who
  collapsed either must still be able to receive a deep link.
- The step lives in the route (`#/packet/:id/:step`, `PacketBuilder.jsx:323-328`), so a QC-step
  finding pointing at a resume field is a **cross-step** navigation.

### Acceptance criteria

**AC-2.1 (happy path — the route).** Given the QC step is open and a finding resolves to
`{artifact_id, section_id}` for a resume artifact, when the reader activates that finding's
go-to-field control, then the route becomes the asset step that owns that artifact
(`#/packet/:id/resume`), the artifact's card body is open, its blocks disclosure is open, and the
field card carrying `[data-qc-field="<section_id>"]` is scrolled into view.
*Verify:* extend `app/test/browser/run-asset-blocks.mjs` (or a new `run-deep-link.mjs` alongside it,
same fixture-router pattern) — assert `location.hash` ends `/resume`, then
`await page.locator('[data-qc="blocks-field"][data-qc-field="ResumeSummary"]').isVisible()` and
`boundingBox()` intersects the viewport.

**AC-2.2 (the ring, exactly as specified).** Given a field has just been focused by a deep link,
when the DOM settles, then that field card's computed `box-shadow` contains `inset` and `2px`,
resolves the brand border token, and its computed `transition-property`/`transition-duration`
include `box-shadow` at `0.2s`.
*Verify:* `getComputedStyle` assertions in the browser probe on the exact element from AC-2.1. Read
the numbers off the DOM — a source grep for the literal string is not proof it renders.

**AC-2.3 (the ring clears).** Given a field card is showing the focus ring, when 2.2s elapse without
further interaction, then the computed `box-shadow` no longer contains the focus ring, and the field
card is otherwise unchanged (no scroll jump, no re-render of its content, no loss of an open
`Show original`/ask box).
*Verify:* probe waits `2400ms`, re-reads `getComputedStyle().boxShadow`, asserts the focus value is
gone; asserts `[data-qc="blocks-ask-box"]` visibility is unchanged across the boundary.

**AC-2.4 (idempotence / re-fire).** Given a field was focused and its ring has already cleared, when
the same finding is activated a second time, then the ring re-appears and re-clears on a fresh 2.2s
timer.
*Verify:* probe activates twice with a `2400ms` gap; asserts ring present after each activation.
**This is the regression that a naive `useEffect([focusField])` fails** — the dependency does not
change, so nothing re-runs. The focus signal must therefore carry a monotonic nonce (a counter or
timestamp), not just the field name.

**AC-2.5 (interrupt).** Given a field is focused and its ring is live, when a *different* field is
focused before the 2.2s expires, then the first field's ring clears immediately and only the second
field carries a ring — never two rings at once.
*Verify:* probe fires two focuses 300ms apart; asserts exactly one element matches the ring
selector: `expect(await page.locator('[data-qc="blocks-field"]').evaluateAll(els => els.filter(e =>
getComputedStyle(e).boxShadow.includes('inset')).length)).toBe(1)`.

**AC-2.6 (collapsed disclosures — the edge case that makes this dead otherwise).** Given the reader
has collapsed the artifact card body **or** the blocks disclosure, when a deep link targets a field
inside it, then both disclosures are forced open before the scroll, and the field is visible and
ringed.
*Verify:* probe collapses via `[data-qc="packet-asset-toggle"]` and `[data-qc="blocks-toggle"]`,
then fires the deep link, then asserts `data-qc-open="1"` on both and the field visible.
**Negative form:** if this is not implemented, the deep link silently lands on a closed card — the
same class of dead control the "No dead UI" rule forbids.

**AC-2.7 (unresolvable field — never fail silently).** Given a finding names a merge field that this
artifact has no insertion row for, when the deep link fires, then the asset step still opens for the
right artifact, no ring is drawn on any field, and an explicit sentence names the mismatch —
reusing the drawer's existing wording (`AssetGateDrawer.jsx:154-156`: *"The finding you opened names
<field>, but this asset has no recorded block for that field."*), not a new string.
*Verify:* probe fires a deep link with `section_id: 'NoSuchField'`; asserts the sentence renders and
zero elements carry the ring.

**AC-2.8 (EXTEND, not duplicate — structural).** Given the focus behaviour now exists in two places,
when the change lands, then exactly **one** module exports the focus helper (scroll + ring + timer
constant), `AssetGateDrawer.jsx` imports it rather than keeping its own inline
`scrollIntoView`/`boxShadow`, and the 200ms/2200ms values are **named exported constants** (one
definition), not literals repeated per call site.
*Verify:* a source guard in `app/test/assetBlocks.test.mjs` — read both `.jsx` files as text and
assert `scrollIntoView` appears in neither (only in the shared helper), and that the numeric
literals `2200` and `200`/`0.2s` appear at exactly one site each.
**Mutation proof:** re-inline the drawer's `scrollIntoView` call; the suite must FAIL.

**AC-2.9 (regression guard — the drawer keeps working).** Given the drawer is opened from the QC
rail with a `focusSection`, when the Blocks tab renders, then it still scrolls to and rings the named
row, and the existing "no recorded block" sentence still renders for an unmatched field.
*Verify:* `app/test/browser/run-qc-rail.mjs` — existing drawer assertions must still pass unchanged
after the helper extraction.

**AC-2.10 (motion).** Given the viewer has `prefers-reduced-motion: reduce`, when a deep link fires,
then the scroll is instant (no `behavior: 'smooth'`) and the ring appears without a transition,
while the 2.2s clear still applies.
*Verify:* Playwright `page.emulateMedia({ reducedMotion: 'reduce' })`, assert
`getComputedStyle(el).transitionDuration` is `0s`.
*(Note: `grep -rn "prefers-reduced-motion" app/src/` currently returns **nothing** — this app has no
reduced-motion handling anywhere. If the owner would rather not open that seam here, AC-2.10 may be
deferred **explicitly**, but do not silently ship a smooth-scroll animation that no setting can
turn off.)*

**AC-2.11 (no re-derivation in the child).** Given `PacketBuilder` already knows which artifact and
which field the deep link names, when `AssetBlocks` renders, then it receives the resolved
`{field, nonce}` as a **prop** and does not re-read the route, `location.hash`, or a global to work
it out again.
*Verify:* source assertion in `app/test/assetBlocks.test.mjs` that `AssetBlocks.jsx` contains no
`location.hash` / `window.location` read. (`CLAUDE.md`: "If a child component re-derives what the
parent already computed, pass the pre-computed value down.")

**AC-2.12 (tier + hygiene).** Given this is a tier-2 change, when it is committed, then no check,
gate, score or coverage count reads the focus state, and `cd app && npm run build` succeeds after
the mandatory smart-quote sweep on every edited `.jsx`.
*Verify:* `grep -n "focus" api/src/functions/**/checks.ts` returns nothing new; `npm run build` exit 0;
the Python codepoint scan from `CLAUDE.md` reports zero U+2018/2019/201C/201D in each edited file.

### Open question for the owner (do not guess)
SPEC 4.4 puts a *"`n to fix` — `<title>` →"* button on the artifact card when the gate blocks
approval, and the card today disables `Approve` (`PacketBuilder.jsx:234-236`) without offering that
route. **Is ROW 2's destination that button, the QC rail's `Review →`, or both?** The ACs above are
written against "a finding's go-to-field control" and are agnostic — but shipping the ring without
deciding which control fires it produces a focus mechanism nothing can reach, i.e. dead UI.

---

## ROW 6 (§15) — asset-level "Ask for a change" — **ALREADY BUILT. DROP.**

### The inventory is wrong here, and the brief inherited it

`COMPONENT-INVENTORY.md:508-511` and `:673` both say `ABSENT`. On `origin/main` it exists:

| Fact | Evidence on `origin/main` |
|---|---|
| The control | `PacketBuilder.jsx:224-227` — `<button className="px-btn" data-qc={PACKET_HOOKS.assetAsk} onClick={() => setAssetAskOpen(true)}>List Tweaks</button>` |
| The box | `:275-300`, hook `PACKET_HOOKS.assetAskBox`, textarea + Cancel + Send |
| The call | `:293` — `await api.aiEditArtifact(a.id, { instruction: assetAsk.trim() })` — **no `section`**, the same route the field-level control uses with one |
| Disabled-on-empty | `:289` — `disabled={assetAskBusy \|\| !assetAsk.trim()}` |
| Busy | `:297` — `Sending...` |
| Error | `:284` — `assetAskError` in a `px-note` |
| Hooks registered | `app/src/packetBuilder.js:17-19` — `assetAsk`, `assetAskBox`, `assetAskSend` |
| Scope warning | `:277-280` — *"This rewrites the whole `<asset>`. For one field, use the field's own List Tweaks below"* |
| Why it exists | `:216-223` — *"this exists for the artifacts that have no merge fields … Same route, no `section` … Not a second edit path"* |

It is even gated correctly: it renders only for `status === 'review' \|\| 'changes'` (`:214`), so
there is no ask on a `todo` artifact with nothing to edit.

**Do not build this.** The only work left is a guard so it cannot regress.

**AC-6.1 (regression — one edit path).** Given the codebase, when the test suite runs, then there is
exactly **one** function in `app/src/api.js` that posts to `ai-edit` (`aiEditArtifact`), and every
caller passes `section` or omits it — no second route, no second helper.
*Verify:* source assertion in `app/test/packetBuilder.test.mjs`: `grep` the `app/src` tree for
`ai-edit`, assert one definition site.
**Mutation proof:** add a second `aiEditArtifactWhole` helper; the suite must FAIL.

**AC-6.2 (regression — the control stays wired).** Given an artifact in `review`, when the asset card
renders, then `[data-qc="packet-asset-ask"]` is present; when it is activated and text is typed,
`[data-qc="packet-asset-ask-send"]` becomes enabled; and on Send exactly one request goes to
`/app/artifact/{id}/ai-edit` **with no `section` key in the body**.
*Verify:* `app/test/browser/run-asset-blocks.mjs` mounts the real `ArtifactCard` (exported at
`PacketBuilder.jsx:83` for exactly this reason). Assert with playwright's router by capturing the
request body: `JSON.parse(req.postData()).section === undefined`.

**AC-6.3 (regression — empty send stays impossible).** Given the asset ask box is open with only
whitespace typed, when the reader looks at Send, then it is `disabled`.
*Verify:* DOM assertion on `[data-qc="packet-asset-ask-send"][disabled]`.

**AC-6.4 (correct the record).** Given `COMPONENT-INVENTORY.md` states this row is `ABSENT`, when
this finding lands, then rows 6 and 7 of its build-order table are marked closed with the
`origin/main` line references above, so the next reader does not rebuild a shipped control.
*Verify:* the file diff. Tier 3 — prose, no ceremony.

---

## ROW 7 (§16) — `sameAsBefore` — **ALREADY BUILT. DROP.**

### The inventory is wrong here too, and the brief's strongest claim is stale

The brief says *"THIS IS CURRENTLY A FALSE CLAIM shown to the user."* **It is not, on `main`.**
`git show origin/main:app/src/screens/AssetBlocks.jsx` lines 526-539:

```jsx
{showBefore && row.before_text && (
  <div className="px-note" data-qc={BLOCK_HOOKS.before} ...>
    <div className="px-label" ...>
      {row.before_text === row.after_text
        ? 'Identical - template text is not merged per packet'
        : 'Original - before this posting'}
    </div>
```

The wording matches SPEC 4.5's *"identical, template text is not merged per packet"*, it is derived
from `before_text === after_text` exactly as the brief prescribes, and the comment at `:528-531`
records the reasoning (*"'before this posting' is a FALSE CLAIM on a field nothing changed"*).

**Do not build this.** Guard it instead. Note there **is** a real residual defect below, which the
inventory did not catch.

**AC-7.1 (regression — the identical case).** Given an insertion row where `before_text ===
after_text`, when `Show original` is activated, then the panel heading reads exactly
`Identical - template text is not merged per packet` and **never** contains the substring
`before this posting`.
*Verify:* `app/test/browser/run-asset-blocks.mjs` — add a fixture row with identical before/after,
click `[data-qc="blocks-compare-toggle"]`, read `[data-qc="blocks-before"] .px-label`.
**Mutation proof:** replace the ternary with the unconditional `'Original - before this posting'`;
the probe must FAIL.

**AC-7.2 (regression — the changed case).** Given a row where `before_text !== after_text`, when the
panel opens, then the heading reads `Original - before this posting`.
*Verify:* same probe, second fixture row.

**AC-7.3 — NEW DEFECT, not in the inventory: a null `before_text` has no disclosure at all.**
Given an insertion row where `before_text` is `null` (the common case for a freshly generated
field — see the probe fixtures at `app/test/browser/run-asset-blocks.mjs:36-52`, every one of which
has `before_text: null`), when the field card renders, then `Show original` is **not rendered**
(`AssetBlocks.jsx:553` gates on `row.before_text`), so the reader gets no signal at all — neither
"there was no original" nor "we did not record one". SPEC 4.5 says `Show original` is *"present on
every field, including static template blocks"*.
**AC:** Given `before_text` is null, when the field renders, then either the control is present and
opening it states plainly which of the two cases holds, **or** a one-line note says the original was
not recorded — but the field must not silently omit a control SPEC says is on every field.
*Verify:* probe asserts a control or a note exists for a `before_text: null` row.
**Decide with the owner before building:** null-because-nothing-preceded-it and
null-because-we-did-not-store-it are two different claims, and this repo's own standing rule is that
they must not print the same sentence. If the insertion payload cannot distinguish them, say so and
stop — do not invent the distinction. **This is the honest small win in ROW 7, and it is the part
nobody has done.**

---

## ROW 9 (§10) — per-kind stat split (must-have / responsibility / nice-to-have)

### ⚠ THE INVENTORY'S DIAGNOSIS IS WRONG — this is NOT blocked on an endpoint

The inventory (`:336-338`) and the brief both say: *"Blocked on `GET
/app/opportunity/{id}/requirements` returning `total` only — it needs per-kind denominators. This is
an endpoint extension."*

**It already returns every requirement row, each carrying its `kind`.** Ground truth, read in three
places:

1. **The endpoint.** `api/src/functions/tests/appRequirements.ts:700-716` returns
   `{ …, total: rows.length, requirements }` — `requirements` is the full array from
   `shapeRequirementsForApi`, spread from the DB rows (`:633` `...r`), and `kind` is selected
   (`:174`, `:408-413`) and constrained to `must_have` / `nice_to_have` / `responsibility`
   (`ESCALATION_RANK`, `:309`).
2. **The client already receives it.** `AssetBlocks.jsx:807` reads
   `provenance.requirements.requirements` and iterates the rows; `:873` passes the same
   `provenance.requirements` payload straight into `DistributionMeter`, which hands it to
   `meterModel` (`:262`).
3. **The client already splits by kind.** `app/src/postingAnalysis.js:261-273` —
   `groupRequirements(rows)` returns `{ mustHaves, niceToHaves, responsibilities, … }`, and
   `KIND_ABBR` / `KIND_WORD` / `KIND_LEGEND` (`:177-188`) are the one vocabulary for the three kinds.

So `meterModel` (`assetBlocks.js:380`) reads `requirements.total` **only because that is what it was
written to read** — the array beside it is untouched. This is a ~10-line derivation change inside
one existing function, reusing an existing splitter. **No endpoint change. No new system.**

**Consequence for sequencing:** ROW 9 is not "blocked". It is buildable today and should be
**resequenced above ROW 10, 11 and 12.** It is the only remaining row of the five with no external
dependency at all.

**Consequence for tier:** it stays **TIER 1** regardless. It renders coverage counts.

### The trap this row must not fall into

`meterModel`'s own header (`:360-368`) and the inventory (`:332-334`) both warn that the prototype's
four cells are computed against fabricated demo data. The numerator matters as much as the
denominator: `placedReqIds` (`:379`) is the set of `requirement_id`s the **insertion rows cite**, and
splitting the denominator by kind while leaving the numerator un-split would produce
`must-haves: 7 of 3`. Both halves must be filtered by the same kind, from the same row set.

### Acceptance criteria

**AC-9.1 (happy path — three stats, correctly split).** Given a requirements payload with 5
`must_have`, 4 `responsibility`, 3 `nice_to_have` rows, and an asset whose insertion rows cite
requirement ids belonging to 3 must-haves and 1 responsibility, when the meter is expanded, then it
renders three stats reading `3 of 5` must-haves, `1 of 4` responsibilities, `0 of 3` nice-to-haves,
each using `KIND_WORD` for its label — never a hand-typed string.
*Verify:* unit test in `app/test/assetBlocks.test.mjs` against `meterModel` directly (it is a pure
function, exported, and `node --test` can import it); **plus** a DOM assertion in
`run-asset-blocks.mjs` on `[data-qc="blocks-stat"]` text.

**AC-9.2 (numerator and denominator share one filter).** Given a requirement kind, when its stat is
computed, then `n` counts only cited requirements **of that kind** and `d` counts only rows of that
kind, and `n <= d` holds for every stat the meter emits.
*Verify:* unit test asserts `n <= d` for all stats across a randomised fixture of 200 kind
assignments. **This is the invariant, not the incident** — it catches the split-denominator bug in
any future refactor.
**Mutation proof:** leave the numerator as the un-split `placedReqIds.size`; the suite must FAIL.

**AC-9.3 (extend, do not duplicate).** Given `groupRequirements()` already splits rows by kind
(`postingAnalysis.js:261`), when this stat is built, then `assetBlocks.js` **imports and calls it**
rather than writing three new `.filter(r => r.kind === …)` lines.
*Verify:* source assertion — `app/src/assetBlocks.js` contains no literal `'must_have'` /
`'nice_to_have'` / `'responsibility'` string; the kinds come from the shared module.
**Mutation proof:** inline a `r.kind === 'must_have'` filter; the guard must FAIL.

**AC-9.4 (unknown is never zero — the rule this repo already enforces).** Given the requirements
payload is `null`, absent, or carries an empty `requirements` array, when the meter renders, then
**no** per-kind stat is drawn and `UNKNOWN_REQS_NOTE` is shown instead — never `0 of 0`, never an
empty bar, never a `0%` bar.
*Verify:* unit test asserts `meterModel({ requirements: null }).stats` contains no `must_have` key
and `.notes` includes `UNKNOWN_REQS_NOTE`; DOM assertion that no `[data-qc="blocks-stat"]` contains
`of 0`.

**AC-9.5 (a kind with zero rows is omitted, not printed as 0 of 0).** Given a posting with 5
must-haves and **no** nice-to-have rows at all, when the meter renders, then the nice-to-have stat is
**omitted entirely** and the must-have stat still renders. A posting genuinely having no
nice-to-haves is not a measurement failure, so `UNKNOWN_REQS_NOTE` must **not** fire for it.
*Verify:* unit test — `stats.map(s => s.key)` has no `nice_to_have`; `notes` does not gain a second
unknown-note. **This is the distinction the row is most likely to get wrong**: `total === 0`
(nothing parsed → unknown) and `kind count === 0` within a non-empty payload (measured absence) are
different facts.

**AC-9.6 (an unrecognised kind is surfaced, never silently dropped).** Given a requirement row whose
`kind` is `null` or a value outside the three, when the meter renders, then those rows are **not**
silently excluded from every denominator — either a fourth "unclassified" stat appears, or a note
names the count. The sum of all rendered denominators plus any unclassified count must equal
`requirements.total`.
*Verify:* unit test asserts `sum(d) + unclassified === total` for a fixture containing one
`kind: null` row. **Mutation proof:** drop the unclassified branch; the suite must FAIL.
*(Rationale: `requirement_kind_source_check` constrains `kind_source`, not `kind`; and `rank()` at
`appRequirements.ts:310` already defends against an out-of-set kind with `?? 3`, which is proof the
codebase treats this as reachable.)*

**AC-9.7 (`total` and the split must reconcile — the cross-surface rule).** Given the same
requirements payload, when both the JD step's `PostingAnalysisCard` and the asset step's meter render
counts of the same rows, then their per-kind totals are equal.
*Verify:* unit test that feeds one fixture through `groupRequirements()` and through the new stat
derivation and asserts the denominators match. (`CLAUDE.md` → "Counts on Today vs Swipe vs Pipeline
vs Opportunities must reconcile because they read the same funnel.")

**AC-9.8 (the existing `Posting lines placed` stat).** Given the three per-kind stats now render,
when the meter is read, then the rollup `Posting lines placed` is either **removed** or explicitly
labelled as the rollup of the three — it must not sit beside them as a fourth, apparently
independent number that a reader would add to the others.
*Verify:* DOM assertion; and a stated decision in the commit message. **Ask the owner which** — this
is a product call, not an engineering one, and shipping both without deciding recreates exactly the
"stale / mismatched numbers" failure `CLAUDE.md` describes.

**AC-9.9 (colour, per SPEC).** Given a stat where `n === d`, when it renders, then its number is
`var(--proto-green)`; otherwise the current non-complete colour. No new colour token is introduced.
*Verify:* `getComputedStyle` in the probe. (§10 of the inventory says the prototype uses
`--proto-yellow` for incomplete while the app uses `--text-brand`; **keep the app's** — the inventory
records `--proto-yellow` fails contrast in at least one theme at `QcRail.jsx:512-527`. Do not
"fix" this toward the prototype without re-running `npm run test:contrast`.)

**AC-9.10 (tier-1 live verification).** Given the change is merged to `main`, when it is verified,
then a real count is read from the live system, not from a fixture: `db-query.yml` returns
`select kind, count(*) from requirement where opp_id = '<real opp>' group by kind`, and
`ui-verify.yml` renders the resume step for `von.ellis@enterpriseds.io` with `expect` naming those
exact numbers.
*Verify:* the two run ids and the `UI_VERIFY_RESULT` line, quoted in the verification note.
**A fixture-only pass does not close a tier-1 row.**

**AC-9.11 (no fabrication).** Given any component of a per-kind stat has no source, when the stat is
computed, then it is `null` and not rendered — never a partial composite.
*Verify:* covered by AC-9.4/9.5; asserted explicitly so the reviewer sees the rule was applied.
