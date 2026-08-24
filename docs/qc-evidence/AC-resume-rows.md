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
