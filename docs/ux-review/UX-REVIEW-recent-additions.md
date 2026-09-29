# UX Review — recent additions (Add job, Unrecognized locations)

<!--
WHAT:       Independent adversarial UX review of three recent UI additions to Pipeline-Exec
            (Executive Engine): the "+ Add job" top-bar trigger + paste-a-URL panel, the
            Settings > Locations "Unrecognized locations" card, and how both sit inside the
            existing app shell.
WHY:        The product owner stated the recent UI additions "don't follow good practices in
            most cases". This review finds the specific defects rather than reassuring.
SUPERSEDES: nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:   Live screenshots (desktop 1440px Opportunities + Settings>Locations; owner's own
            phone screenshot of Opportunities), app/src/theme.css, app/src/tokens/fig-tokens.css,
            app/src/screens/Opportunities.jsx, app/src/screens/Settings.jsx, app/src/shell.jsx
REVIEWER:   Independent design review pass, 2026-09-29. No stake in the implementation.
-->

**Status:** COMPLETE — 19 findings (4 BLOCKER, 10 MAJOR, 5 MINOR). Ranked index and
"If you only fix three things" at the end of the file.

## Ground truth used

| Artifact | What it proves |
|---|---|
| Owner's phone screenshot of Opportunities (`8b3f034d-image.jpg`, 1029x2257 native) | Real device, real viewport, real data — the most important artifact here |
| Desktop Opportunities, 1440px | Where `+ Add job` now lives, and the filter stack above the table |
| Desktop Settings ▸ Locations, 1440px | The Unrecognized-locations card at real volume (416 jobs / 315 locations / 12 shown) |
| `app/src/theme.css` | `.px-*` utilities and `--proto-*` tokens, incl. the codebase's own measured contrast ratios |
| `app/src/tokens/fig-tokens.css` | Resolved Compass token values |
| `app/src/screens/Opportunities.jsx` | `AddJobByLink` + header/filter area |
| `app/src/screens/Settings.jsx` | `LocationSettings` |
| `app/src/shell.jsx` | `TopBar`, `TopBarActions`, `SideNav`, mobile bottom nav |

## Findings

_(appended below, most severe first — re-ranked at the end)_

---

## A. "Add a job you found yourself" — trigger + paste-a-URL panel

> **Note on the screenshots vs the code.** Both desktop and phone screenshots show `+ Add job`
> on its own row *below* the top bar — that is the state the owner photographed when they asked
> for the move. `Opportunities.jsx:68-73` shows the move has since landed: the trigger now
> portals into the top bar via `TopBarActions`. Findings below review the code (post-move); the
> screenshots are used for the shell it lands in and for viewport measurement.

### [BLOCKER] The three inputs have no labels at all — placeholder text is the only name
- **What the user is trying to do:** Paste a link; on a refusal, type the company and role.
- **What actually happens:** `Opportunities.jsx:90-98` renders three `<input>`s whose only
  identifying text is `placeholder="https://…"`, `placeholder="Company"`,
  `placeholder="Role title"`. There is no `<label>`, no `aria-label`, no `aria-labelledby`,
  and no `<form>`. A screen reader announces the URL field as "edit text, https colon slash
  slash ellipsis"; once any character is typed the visible name disappears from the screen for
  everyone.
- **Standard violated:** WCAG 2.2 **3.3.2 Labels or Instructions (A)** and **4.1.2 Name, Role,
  Value (A)**. Placeholder-as-label is the canonical failure of both. Nielsen **#6 Recognition
  rather than recall** — once typing starts, the user must remember which box was which.
- **Why it matters here:** The two-field recovery path is the *common* case, not the edge case —
  the component's own header comment (lines 14-18) says sites requiring login "LinkedIn included
  — are the common case". So the worst-labelled part of the form is the part most users reach.
  Two adjacent unlabelled boxes with vanishing placeholders is exactly where the owner types the
  role into the company field.
- **Fix:** `app/src/screens/Opportunities.jsx`, lines 90-98. Add a visible `.px-label` above each
  input (the class already exists: 11px uppercase at `--proto-ink3`, measured **4.76:1** on paper
  — passes 4.5:1), wired with `htmlFor`/`id`. At minimum add `aria-label` to all three. Wrap the
  panel in a `<form onSubmit={submit}>` so labels, the Enter key and `type="url"` validation all
  start working together.
- **Effort:** S
- **Confidence:** high — read directly from the markup; no label or aria attribute exists on any
  of the three inputs.

### [MAJOR] The error/refusal message is invisible as an error — `--text-bad` is not a real token
- **What the user is trying to do:** Understand why the job was not added.
- **What actually happens:** `Opportunities.jsx:107` sets
  `color: note.ok ? 'var(--text-ok)' : 'var(--text-bad)'`. **Neither token is defined anywhere in
  the app** — a sweep of every `.css`, `.html`, `.js` and `.jsx` under `app/` (excluding
  `node_modules`) finds 11 *uses* and **zero definitions**. A `var()` with no fallback and no
  definition is invalid at computed-value time, so per CSS spec the declaration computes to
  `unset`; `color` is inherited, so the span renders in the inherited `--proto-ink`
  (`neutral-900`, **17.85:1** on paper) — i.e. **identical to ordinary body text**.
- **Standard violated:** Nielsen **#9 Help users recognise, diagnose and recover from errors** —
  the error styling the code intends is simply absent. (Note: this is *not* a 1.4.1 Use of Colour
  failure, and not a contrast failure — the text itself carries the meaning and renders at high
  contrast. It is a dead design-token reference.)
- **Why it matters here:** The refusal message is the load-bearing element of this whole feature
  (per the component's own comment, the fallback "is not optional"). It currently appears as an
  unstyled grey-black sentence beside the button, visually indistinguishable from the helper copy
  above it. The same broken pair is used at **10 other sites** across `Settings.jsx` and
  `PacketBuilder.jsx`, so fixing the token fixes all of them at once.
- **Fix:** Define the pair once in `app/src/theme.css` `:root` alongside the other status inks —
  `--text-ok: var(--proto-green); --text-bad: var(--proto-red);` — and again under `.proto-dark`
  if the `--proto-*` values do not already carry it (they do: both flip in `.proto-dark`, so one
  definition in `:root` suffices). Those tokens were already darkened to clear 4.5:1 in the D28
  pass, so no new measurement is needed. No component changes.
- **Effort:** S
- **Confidence:** high — token absence verified by full-tree grep; the IACVT→`unset`→`inherit`
  chain is CSS spec behaviour. A browser computed-style read would make it airtight.

### [MAJOR] The refusal and success messages are never announced
- **What the user is trying to do:** Submit a link and find out what happened.
- **What actually happens:** `Opportunities.jsx:106-108` renders the `note` into a plain `<span>`.
  There is no `role="status"`, no `aria-live`, and the button gets no `aria-busy` while `busy` is
  true (line 102-105). The request is a network round-trip that reads a web page — seconds, not
  milliseconds — and its entire outcome (refusal, duplicate, failure) appears silently.
- **Standard violated:** WCAG 2.2 **4.1.3 Status Messages (AA)**. Nielsen **#1 Visibility of
  system status** for the non-visual case.
- **Why it matters here:** The visible label *does* change to "Reading the posting…", which is
  good, but that is only available to sighted users; and the result text never moves focus or
  announces. A screen-reader user gets no confirmation at all that the two extra fields have
  appeared.
- **Fix:** `Opportunities.jsx:106` — `<span role="status" aria-live="polite" …>`, and add
  `aria-busy={busy}` to the submit button at line 102. No visual change.
- **Effort:** S
- **Confidence:** high — read from markup.

### [MAJOR] Opening the panel silently throws away the user's place in a 1,378-row list
- **What the user is trying to do:** They are partway down the Opportunities list and want to add
  a job they just found.
- **What actually happens:** The trigger now lives in the top bar, which sits **outside** the
  scrolling pane (`shell.jsx:487` `<TopBar/>` is a sibling of the `flex:1; overflow:auto` pane at
  `shell.jsx:492`), so it stays visible at any scroll position. The panel it opens is the **first
  child inside that pane** (`Opportunities.jsx:339`, above the funnel). The URL input carries
  `autoFocus` (line 90), and `HTMLElement.focus()` runs the scroll-into-view steps, so the pane
  jumps to the very top. **Nothing restores the scroll position on Cancel** (`close()`, line 29,
  only resets form state) — and `1378 of 1378` rows is the owner's real volume.
- **Standard violated:** Nielsen **#3 User control and freedom** (no undo for a destructive
  navigational side-effect) and **#1 Visibility of system status** (the jump is unannounced).
- **Why it matters here:** This is a *new* defect created by the move. Before it, trigger and
  panel were adjacent, so opening the panel could not move the page. Now a mis-tap on a
  top-right button at row 600 of 1,378 costs the user their position permanently, with no way
  back short of scrolling again.
- **Fix:** Two options, both small, in `app/src/screens/Opportunities.jsx`:
  (a) render the panel as an **overlay** using the shell's existing `Overlay` primitive
  (`shell.jsx:313`, already portals to `document.body` with `--qc-scrim` and page-scroll freeze —
  the app's own established pattern for this exact problem); or
  (b) keep it inline but capture `ee-scrollpane`'s `scrollTop` in `setOpen` and restore it in
  `close()`. (a) is preferable because it reuses a primitive that already exists rather than
  adding a second mechanism.
- **Effort:** S (option b) / M (option a)
- **Confidence:** medium-high — the DOM relationship and the absence of scroll restoration are
  read from source; the *exact* scroll behaviour of `autoFocus` inside this pane would be settled
  by one `ui-verify.yml` run capturing `scrollTop` before and after the click.

### [MAJOR] "Already in your pipeline" is a dead end — it will not tell you where
- **What the user is trying to do:** Add a job; be told it is already saved; go look at it.
- **What actually happens:** `Opportunities.jsx:43-46` renders `'Already in your pipeline — not
  added again.'` The panel stays open with the URL still in the field. There is no link, no id,
  no company/role echo, and no way to reach the existing record.
- **Standard violated:** Nielsen **#9 Help users recognise, diagnose and recover from errors** —
  the message diagnoses but does not help recover.
- **Why it matters here:** With 1,378 opportunities and 1,364 of them sitting in "Discovered",
  "it's already in there somewhere" is not actionable information. The user's next move is to
  close the panel and search — and the search box only matches company or role, which is exactly
  what they do not have (they had a URL).
- **Fix:** The capture route already knows which row it collided with. Return its id and render
  the message as `.px-link` (`theme.css:263`) → `go('/opp/' + id)`. If the id is not currently in
  the response, that is a one-field API change in the duplicate branch; the client change is one
  line at `Opportunities.jsx:44-46`.
- **Effort:** S (client) / M (if the route must return the id)
- **Confidence:** high on the UI dead-end (read from source); medium on the API change size —
  reading the `POST /app/capture` duplicate branch would settle it.

### [MINOR] After a refusal, the keyboard can no longer submit the form
- **What the user is trying to do:** Type the company and role, press Enter.
- **What actually happens:** `Opportunities.jsx:92` — the URL field submits on Enter *only while*
  `!needsDetail`. Once the refusal opens the two extra fields, that handler stops firing, and
  neither new input (lines 95-98) has an `onKeyDown` at all. There is no `<form>`, so the browser's
  implicit submit does not apply either. The only way to submit is to Tab to the button.
- **Standard violated:** Nielsen **#7 Flexibility and efficiency of use**. (Not a 2.1.1 Keyboard
  failure — the button is still reachable by Tab.)
- **Why it matters here:** The refusal path is the common path, so the efficient keyboard route is
  disabled exactly when the form gets longer.
- **Fix:** Wrapping the panel in `<form onSubmit={e => { e.preventDefault(); submit() }}>` — the
  same change recommended for the labels finding — fixes this for free and removes the bespoke
  `onKeyDown` entirely.
- **Effort:** S
- **Confidence:** high — read from source.

### [MINOR] A malformed URL is only discovered by the server, seconds later
- **What the user is trying to do:** Paste a link that turns out not to be one.
- **What actually happens:** `type="url"` at `Opportunities.jsx:90` carries no behaviour outside a
  `<form>` — constraint validation runs on form submission, and there is no form. `submit()` guards
  only on `!url.trim() && !role.trim()` (line 32), so any string is sent to the API.
- **Standard violated:** Nielsen **#5 Error prevention** — prevent the error rather than report it.
- **Why it matters here:** Low frequency, and the failure is recoverable; listed for completeness
  because the `<form>` wrapper recommended twice above makes it disappear at zero extra cost.
- **Effort:** S
- **Confidence:** high.

### Checked and clean — no finding

These were tested against the standards and **pass**; recording them so the list above reads as
measured rather than padded.

| Checked | Result |
|---|---|
| `+ Add job` label contrast | `--text-on-brand` (`neutral-0`) on `--surface-brand-default` = **9.05:1** light, **5.94:1** dark. Passes 1.4.3 comfortably. |
| Panel helper copy contrast | `--proto-ink2` / `--proto-ink3` on paper = **4.76:1**. Passes (the D27 token fix already landed; `--proto-ink3` is no longer the 2.43:1 value its own comment describes). |
| Focus visibility on the trigger | `.px-btn` sets **no** `outline: none`, so the UA focus ring survives. `.px-input` does suppress it but replaces it with a `--proto-accent` border + 3px glow. **2.4.7 passes.** |
| Target size | `.px-btn` computes to ~30px tall (13px text + 12px padding + 2px border) — above the **2.5.8** 24×24 minimum. See the mobile section for the separate Apple HIG 44pt / Material 48dp question. |
| Trigger persistence while open | Rendered unconditionally in both states (line 78 returns `trigger`; line 82 re-renders it inside the open panel) with `aria-expanded`. This is **correctly** done and avoids the disappearing-trigger trap. |
| The refusal → two-fields recovery design | Genuinely good. It surfaces the route's own words rather than a generic failure, keeps the user's URL, and changes the button label to "Save this job". This is the strongest part of the feature. |

---

## B. Settings ▸ Locations — "Unrecognized locations"

Live data: **416 jobs affected, 315 distinct locations, 12 shown.**

### [BLOCKER] The queue can permanently stall — a location that cannot be mapped can never be cleared
- **What the user is trying to do:** Work through 315 unrecognized locations and recover 416 jobs.
- **What actually happens:** `Settings.jsx:1506` renders `state.unresolved.slice(0, 12)` — a hard
  12, with no "show more", no pagination and no search. Line 1523 promises *"…and 303 more, shown
  once these are assigned."* That promise is honoured mechanically (verified: `appOpportunities.ts:54`
  applies `ownerMetro(...)` from the saved aliases, so an assigned row really does leave the bucket
  on the next load). **But the only two choices per row are a metro or `"Leave unassigned"`**
  (`Settings.jsx:1515-1516`). There is no "ignore", "not a place", or "never ask again" option.
  A row the owner *cannot* map therefore occupies one of the twelve slots **forever**, and the 303
  behind it never surface.
- **Standard violated:** Nielsen **#3 User control and freedom** (no escape from a required step)
  and **#7 Flexibility and efficiency of use**. This is a dead end, not slowness.
- **Why it matters here:** Two of the twelve currently visible rows are *provably* unmappable.
  **"Remote · 26 jobs"** is not a place and has no correct metro. **"Charlotte, NC · 5 jobs"**,
  **"Scottsdale, AZ · 4 jobs"**, **"Minneapolis, MN · 3 jobs"** and **"Richmond, VA · 4 jobs"**
  have no corresponding metro in the dropdown either (see the next finding). Once those settle
  into the top twelve — and they already have — the queue is jammed and the other 303 locations
  are unreachable by any route in the UI.
- **Fix:** `app/src/screens/Settings.jsx:1515` — add a third option,
  `<option value="__ignore">Not a place / ignore</option>`, and treat that value as "resolved" in
  the `rawBy` loop at line 1427-1431 (skip when `aliases[key] === '__ignore'`). That single
  addition unjams the queue. If only one change is made in this card, make it this one.
- **Effort:** S
- **Confidence:** high — `slice(0, 12)`, the two-option `<select>` and the absence of any other
  control are read directly from lines 1506-1525.

### [BLOCKER] The twelve dropdowns have no accessible name — all twelve announce identically
- **What the user is trying to do:** Assign "Needham, MA" to Greater Boston using a screen reader
  or voice control.
- **What actually happens:** `Settings.jsx:1512` renders `<select className="px-input">` with no
  `<label>`, no `aria-label` and no `aria-labelledby`. The visible location name is a plain `<div>`
  in a *sibling* container (line 1509) with no programmatic association. Note also that the
  component named `Label` (`Settings.jsx:37`) renders a **`<div>`**, not a `<label>` element — so
  even the card heading cannot label anything.
- **Standard violated:** WCAG 2.2 **4.1.2 Name, Role, Value (A)** and **3.3.2 Labels or
  Instructions (A)**.
- **Why it matters here:** Twelve controls that all announce as *"combo box, Leave unassigned"* and
  all offer the same option list. There is no way to tell them apart, and a voice-control user has
  no phrase to say. The Add-job panel has the same defect on 3 inputs; here it is on 12 identical
  ones, which is why this is the more severe instance.
- **Fix:** `Settings.jsx:1509-1517` — give the name `<div>` an `id={'loc-' + key}` and add
  `aria-labelledby={'loc-' + key}` to the `<select>`. Zero visual change. Separately, change the
  `Label` primitive at line 37 to accept an optional `htmlFor` and render a real `<label>`.
- **Effort:** S
- **Confidence:** high — read from markup.

### [BLOCKER] The metro chips this card depends on cannot be operated by keyboard at all
- **What the user is trying to do:** Select which metros they target — the prerequisite for the
  whole Unrecognized card, and the source of the dropdown's options.
- **What actually happens:** `Settings.jsx:1477-1481` renders each metro as
  `<span onClick={...} className="px-pill">`. No `role`, no `tabIndex`, no `onKeyDown`, no
  `aria-pressed`. A `<span>` is not focusable, so **Tab never reaches these and Enter/Space do
  nothing.** The only state signal is background colour plus a `"✓ "` text prefix.
- **Standard violated:** WCAG 2.2 **2.1.1 Keyboard (A)** — an outright failure, not a degradation —
  and **4.1.2 Name, Role, Value (A)** (a toggle with no role and no pressed state). *(1.4.1 Use of
  Colour does pass: the `"✓ "` prefix is a non-colour indicator.)*
- **Why it matters here:** This predates the Unrecognized card, but it is in scope because the new
  card **is unusable without it** — the assign dropdown only lists metros selected here, and the
  new `<select>`s *are* keyboard-operable, so the card is now half reachable and half not. That
  inconsistency is exactly the "sits inside the existing app" question.
- **Fix:** `Settings.jsx:1477` — change `<span>` to `<button type="button" className="px-pill"
  aria-pressed={on}>` and drop the manual `✓`, letting `aria-pressed` carry state for AT while the
  existing background swap carries it visually. `.px-btn` is not needed; `.px-pill` already styles
  it, and a `<button>` inherits the UA focus ring (theme.css sets no `outline:none` on `.px-pill`).
- **Effort:** S
- **Confidence:** high — read from markup.

### [MAJOR] "416 jobs affected" is wrong, and the explanation under it is false for every remote row
- **What the user is trying to do:** Judge how much damage unrecognized locations are doing, and
  decide whether to spend an evening on this screen.
- **What actually happens:** Two different rules are in play and they disagree.
  - The card decides what to list using **metro alone**: `Settings.jsx:1427` skips a row only
    `if (o.dismissed || o.metroGeoId)`. It never consults work mode.
  - The actual filter is `matchesLocationPrefs` (`data.jsx:10-18`). With target metros selected
    **and "Remote plus" on** — which is the owner's current state, checkbox ticked in the
    screenshot — line 15 returns `inTarget || isRemote`, and `isRemote` is
    `o.workMode === 'remote'`. `workMode` is derived from the location string by `parseWorkMode`
    (`geoMaster.ts:67-72`): **`/\bremote\b/` ⇒ `'remote'`.**

  So any unrecognized location containing the word "remote" is **kept** by the filter while the
  card states, at line 1502-1503, that *"they are filtered out of Swipe & Opportunities."*
  Of the twelve rows on screen, **"Remote · 26 jobs"** and **"Charlotte, NC (Remote) · 3 jobs"**
  — **29 jobs** — are listed and counted despite not being filtered out at all.
- **Standard violated:** Nielsen **#1 Visibility of system status** (the system misreports its own
  state) and **#2 Match between system and the real world**. Not a WCAG issue.
- **Why it matters here:** "Remote" is the **single largest row in the list**, and it is both
  miscounted *and* unmappable (previous finding). The orange badge is the thing that decides
  whether the owner commits hours to this screen, and it is inflated by exactly the rows they can
  do nothing about. *(The other overstatement source — `applyLocationPrefs` only filtering
  `FRESH_STAGES`, `data.jsx:21` — is negligible here: 1,377 of 1,378 opportunities are in a fresh
  stage.)*
- **Fix:** `app/src/screens/Settings.jsx:1427` — exclude rows the live filter already keeps, by
  mirroring the one rule: skip when `o.dismissed || o.metroGeoId || (remoteOnly && o.workMode ===
  'remote')`. `workMode` is already on every opportunity object (`appOpportunities.ts:63`), so no
  new data is needed. The badge at line 1497-1499 then reports a true number.
  **Better still:** import the rule rather than re-deriving it — `matchesLocationPrefs` already
  exists in `data.jsx` as "the SINGLE location/remote rule" (its own comment, line 8). This card
  is a second, divergent copy of it, which is the defect.
- **Effort:** S
- **Confidence:** high — every step traced to source; no inference about the data was needed
  because `workMode` is computed from the location text, which is visible on screen.

### [MAJOR] Two rows on screen are secretly the same control — setting one silently changes the other
- **What the user is trying to do:** Map "San Diego, CA" without touching anything else.
- **What actually happens:** The list is grouped by the **raw** location string
  (`Settings.jsx:1430`, `rawBy.set(loc, …)`), but each dropdown reads and writes
  `aliases[locationAliasKey(u.location)]` (lines 1513-1514). `locationAliasKey`
  (`app/src/settings.js:52-57`) **strips `(Remote|Hybrid|On-site)` and lowercases**. So
  `"San Diego, CA"` and `"San Diego, CA (On-site)"` — both visible on screen, 4 jobs each — resolve
  to the same key `san diego, ca`. Changing either dropdown changes both, with no indication why.
  Same for `"Charlotte, NC"` and `"Charlotte, NC (Remote)"`.
- **Standard violated:** Nielsen **#1 Visibility of system status** (an unexplained remote change)
  and **#4 Consistency and standards** (two identical-looking rows behave as one).
- **Why it matters here:** Beyond the confusion, this is *why the numbers look worse than they
  are*: the counts are split across suffix variants (San Diego reads as 4 + 4 rather than one row
  of 8), so genuinely high-value locations are pushed down the count-sorted list and out of the
  top 12 by their own duplicates — while each duplicate consumes one of the twelve slots.
- **Fix:** `app/src/screens/Settings.jsx:1430` (and the identical loop at line 1458) — key
  `rawBy` by `locationAliasKey(loc)` and keep the first raw string seen for display. One line in
  each of two places. This makes the display grouping match the storage key, removes the ghost
  updates, sums the counts correctly, and shrinks the 315 figure with no new UI.
- **Effort:** S
- **Confidence:** high — both key derivations read from source and confirmed to differ; the
  duplicate pairs are visible in the screenshot. A live `SELECT` grouped both ways would quantify
  how far below 315 the true figure falls.

### [MAJOR] Most rows have no correct answer available — the dropdown only offers metros already in the pipeline
- **What the user is trying to do:** Assign "Scottsdale, AZ" to the Phoenix metro.
- **What actually happens:** The options at `Settings.jsx:1516` come from `state.metros`, which is
  built at line 1418 from the owner's **existing opportunities** (`[...by.values()].filter(m =>
  m.geoId)`). It is therefore only the metros that already have at least one *recognised* job — 13
  of them, per the screenshot. The seeded `METROS` table (`geoMaster.ts`) is never offered.
- **Standard violated:** Nielsen **#5 Error prevention** and **#9 recover from errors** — the UI
  presents a task with no valid input for most rows.
- **Why it matters here:** **Observation:** the 13 available options are Washington DC-Baltimore,
  US nationwide, NYC, SF Bay, Boston, Austin, Atlanta, Dallas-Fort Worth, Seattle, LA, Chicago,
  Houston, Miami. **Interpretation:** of the twelve rows on screen, only Needham MA (→ Boston),
  Stamford CT and Bridgewater NJ (→ NYC) have a defensible target. Philadelphia, Charlotte,
  Richmond, Scottsdale, San Diego, Minneapolis and Remote do not — **roughly 3 of 12**. Combined
  with the stall above, that is the mechanism by which the queue jams.
- **Fix:** `Settings.jsx:1516` — source the options from the full seeded `METROS` table rather than
  from `state.metros`, marking the ones already in the pipeline (e.g. append the count only where
  there is one). The import already exists server-side; exposing the list is a small API addition
  or a shared constant.
- **Effort:** M
- **Confidence:** high on the mechanism (read from line 1418); medium on "3 of 12", which is my
  geographic judgement — the 13-option list is the ground truth and is stated above so the owner
  can check it.

### [MINOR] Twelve dropdown changes are lost without warning if you navigate away
- **What the user is trying to do:** Set several assignments, get distracted, come back.
- **What actually happens:** `setAliases` (line 1514) mutates local state only. Nothing marks the
  form dirty — the Save button (line 1529) looks identical whether there are 0 or 12 pending
  changes — and there is no `beforeunload` guard or in-app navigation block. Switching to another
  Settings tab discards everything silently.
- **Standard violated:** Nielsen **#5 Error prevention**.
- **Why it matters here:** This is a long, repetitive, multi-cycle task by design; losing a full
  batch of twelve is a meaningful setback and there is no signal that anything was lost.
- **Fix:** `Settings.jsx:1529` — track a `dirty` flag and reflect it on the button
  (`Save target locations · 5 changes`), which is both the affordance and the warning. A full
  navigation guard is not warranted for the effort.
- **Effort:** S
- **Confidence:** high — read from source.

### Checked and clean — no finding

| Checked | Result |
|---|---|
| Card text contrast | Location name **16.94:1**; `N jobs` and helper copy **4.51:1**; `Label` on paper **4.76:1**. All pass 1.4.3. |
| The orange "416 jobs affected" badge | `--proto-yellow` on `--proto-yellow-soft` = **4.84:1** light, **6.79:1** dark, at 11px. Passes. The badge's *styling* is fine; only its *number* is wrong. |
| Metro chip target size | `.px-pill` computes to ~20.5px tall (11px × 1.5 + 2px + 2px), under the **2.5.8** 24px minimum — **but the spacing exception is met**: `gap: 8` gives a 28.5px row pitch, so 24px-diameter circles centred on adjacent chips do not intersect. **2.5.8 passes.** |
| `<select>` target size | `.px-input` computes to ~32px tall. Passes 2.5.8. |
| Does assigning actually work? | **Yes** — verified end-to-end: `appSearchPrefs.ts:104` merges the aliases, `appOpportunities.ts:113-118` loads them, `ownerMetro()` (line 43) applies them in the one funnel every screen reads. The "shown once these are assigned" promise is mechanically honest. The defect is the queue around it, not the plumbing. |
| The card's existence | Correct and valuable. Before it, 416 jobs were invisible with nothing on screen to explain why. Surfacing them with a count and a per-owner mapping is the right call. |

---

## C. How both sit inside the app — mobile and consistency

> **Measurement method.** All CSS-pixel figures in this section are derived from the owner's own
> phone screenshot by calibrating against a known constant: `TopBar` is `height: 54`
> (`shell.jsx:374`) and measures 124px in the displayed image, giving **2.296 image px per CSS px**.
> On that scale the viewport is **≈397 × 781 CSS px** — consistent with a Pixel-class device at
> ~393pt. Figures are ±2-3 CSS px.

### [MAJOR] The primary creation action is now in the hardest place on the phone to reach
- **What the user is trying to do:** One-handed, on a phone, tap "+ Add job" after spotting a role.
- **What actually happens:** `Opportunities.jsx:68-73` portals the trigger into `TopBarActions`,
  which renders at `shell.jsx:386` — the top-right of a **781 CSS px tall** viewport. That corner
  is the classic out-of-reach zone for a right-handed one-handed grip. Meanwhile the app already
  has a persistent `BottomNav` (`shell.jsx:460-479`) occupying the natural thumb zone, and the
  button is ~30px tall (`.px-btn`: 13px text + 12px padding + 2px border) against Apple HIG's 44pt
  and Material's 48dp recommendation — it clears WCAG **2.5.8**'s 24px floor but not the mobile
  platform guidance.
- **Standard violated:** Apple HIG *"controls people use frequently should be within easy reach"*;
  Material bottom-app-bar/FAB placement guidance; thumb-zone reachability. Not a WCAG failure.
- **Why it matters here:** **The move itself was right** — the owner's instruction identified a
  real cost (a whole page row spent on one button) and the measurement below confirms it. The
  residual problem is only the *destination*: the same reclaimed space is available without
  putting the app's primary creation action in the worst corner.
- **Fix:** Keep the `TopBarActions` slot for desktop; on mobile render the same trigger as a small
  floating action anchored above `BottomNav` (`shell.jsx:496`), or as a sixth compact item in the
  bottom nav itself. The slot abstraction already exists, so this is a placement branch on
  `useIsMobile()` (`state.jsx:35`), not a new mechanism. Costs zero vertical space either way.
- **Effort:** M
- **Confidence:** high on the geometry and the button size (both computed from source + calibrated
  screenshot); the reach claim is standard platform guidance, not a measurement.

### [MAJOR] The move reclaimed 56px of a 487px problem — the filter stack is what buries the content
- **What the user is trying to do:** See their jobs.
- **What actually happens:** Measured from the owner's screenshot (pre-move state), **487 CSS px**
  of chrome sits above the table header on a **781 CSS px** viewport — **62%** of the screen
  before any content. The breakdown:

  | Band | CSS px |
  |---|---|
  | Top bar | 54 |
  | `+ Add job` row *(this is what the move removed)* | ~56 |
  | Stage funnel card | 84 |
  | Quick filters (wraps to 2 rows) | 44 |
  | Group pills (wraps to 2 rows) | 46 |
  | Search input | 25 |
  | Temperature chips + stage select | 23 |
  | Sort + Show rejected | 24 |
  | "1378 of 1378" | 9 |
  | `gap: 16` between 7 blocks | ~112 |
  | **Total above the table header** | **~487** |

  After the move: **~431 px**, still **55%** of the viewport. The first job row's text begins
  ~560 CSS px down, leaving room for roughly **one and a half rows**.
- **Standard violated:** Nielsen **#8 Aesthetic and minimalist design** — six always-expanded
  filter mechanisms compete with the content they filter. The brief's progressive-disclosure
  question answers itself here: **disclosure is used in the wrong place.** The Add-job panel (used
  occasionally) is progressively disclosed; the six filter bands (used occasionally) are always
  open; the job list (the reason for the screen) is what gets collapsed.
- **Why it matters here:** This is the honest verdict on the owner's instruction — it was correct
  and it bought back 7% of the viewport, but it is a **12% dent** in the real problem. Reporting
  the move as "mobile density fixed" would be wrong.
- **Fix:** On `useIsMobile()`, collapse the four secondary filter bands (group pills, temperature
  chips, sort, show-rejected) behind one `.px-btn` "Filters" toggle, leaving the funnel, search and
  the active-filter summary visible. Keep them expanded on desktop where there is room. That is
  ~140 CSS px returned — two and a half times what the Add-job move recovered — in
  `app/src/screens/Opportunities.jsx` around lines 395-435, with no change to the filter logic.
- **Effort:** M
- **Confidence:** high — every band measured from the owner's screenshot against a calibrated
  scale; a `ui-verify.yml` run at 393px capturing `getBoundingClientRect()` would make the numbers
  exact rather than ±3px.

### [MAJOR] On the phone, the triage actions the screen exists for are off-screen to the right
- **What the user is trying to do:** Keep / Maybe / Dismiss a job from their phone.
- **What actually happens:** `Opportunities.jsx:437-438` wraps the table in
  `overflowX: 'auto'` and forces `minWidth: 680` on the `<table>`. The pane gives 397 − 28
  (`padding: 14` each side, `shell.jsx:492`) = **369 CSS px**. So the table is **311 px wider than
  the screen**, and the `ACTIONS` column — the `✓ Keep`, `↓ Maybe`, `× Dismiss` buttons visible in
  the desktop screenshot — sits entirely beyond the right edge. The phone screenshot confirms it:
  `ROLE` is the last visible column and "Vice President of Digital / Engineering" is the rightmost
  content, with `COMP`, `STAGE / STATUS`, `URGENCY` and `ACTIONS` all unreachable without a
  horizontal swipe inside a vertically-scrolling list.
- **Standard violated:** WCAG 2.2 **1.4.10 Reflow (AA)** in spirit — *with the honest caveat that
  data tables are an explicit exception in the Understanding document, so this is not a clean SC
  failure.* The unambiguous violation is Nielsen **#7 Flexibility and efficiency of use** and
  **#6 Recognition rather than recall**: nothing on screen indicates the columns exist.
- **Why it matters here:** The owner states they use this on a phone, and with 1,364 jobs in
  "Discovered" the whole job of this screen is triage. Triage is exactly what is off-screen. This
  predates the additions under review, but it is in scope because it is the *same* mobile budget
  the `+ Add job` move was made to protect — and it is the larger half of that problem.
- **Fix:** Below `useIsMobile()`, render each row as a stacked `.px-box-soft` card (match score +
  company + role + a single row of the three triage `.px-btn`s) instead of a table row. The data
  is already per-row; this is a presentation branch in `Opportunities.jsx` around line 437, and it
  removes the horizontal scroll entirely.
- **Effort:** L
- **Confidence:** high — `minWidth: 680` read from source; the clipping is visible in the owner's
  screenshot.

### [MINOR] At 320px the top-bar action label wraps — no `nowrap`, no `flex-shrink: 0`
- **What the user is trying to do:** Use the app on a small phone.
- **What actually happens:** Measured occupancy of the top bar **with** `+ Add job` present:
  28 (padding) + 94 (logo) + 79 (`+ Add job`) + 31 (account) + 37 (⚙) + 38 (☀) + 50 (5 × `gap:10`)
  = **~357 CSS px**. At the owner's ~397px there is ~40px of slack, so **it fits on their device.**
  At 320px — the WCAG reflow reference width — it does not. `.px-btn` (`theme.css:201`) declares
  **no `white-space`** (unlike `.px-tab`, which does) and no `flex-shrink: 0`, and `TopBar`
  (`shell.jsx:374`) sets no `flexWrap`. So the label wraps to two lines inside a fixed
  `height: 54` bar rather than the row scrolling or the label truncating.
- **Standard violated:** None strictly — flex shrinking means no horizontal scrollbar appears, so
  **1.4.10 is not failed.** This is robustness, not compliance.
- **Why it matters here:** Low, for this owner, today. Listed because the `TopBarActions` slot is
  explicitly designed for *other screens' actions* (`shell.jsx:384-385`), and the next label to use
  it may be longer than "+ Add job". The guard is one declaration.
- **Fix:** `app/src/theme.css:201` — add `white-space: nowrap;` to `.px-btn`, and
  `flex-shrink: 0` on the slot at `shell.jsx:386`.
- **Effort:** S
- **Confidence:** medium — the CSS absences are certain; the exact width at which wrapping starts
  is estimated from a calibrated screenshot. A `ui-verify.yml` run at 320px settles it.

### [MINOR] A page-scoped action sits in the app-scoped chrome with nothing to distinguish them
- **What the user is trying to do:** Understand what applies where.
- **What actually happens:** `+ Add job` renders at `shell.jsx:386` immediately left of the
  account, settings and theme buttons — three controls that are global to the app. There is no
  divider, no spacing break, and all four are `.px-btn`. The only distinction is that `+ Add job`
  is `.px-btn-accent` (filled) while the others are outline.
- **Standard violated:** Nielsen **#4 Consistency and standards**.
- **Why it matters here:** Today there is exactly one screen using the slot, so the ambiguity is
  mild. `TopBarActions` exists specifically so other screens can add theirs (its own comment,
  `shell.jsx:384-385`) — at which point a row of mixed page-scoped and app-scoped controls with no
  grouping becomes a real problem. Cheap to prevent, expensive to retrofit.
- **Fix:** `shell.jsx:386` — give the slot a trailing `borderRight: '1px solid
  var(--proto-rule-soft)'` and `paddingRight: 10` when it has children, matching the divider
  already used between the logo and the page title at `shell.jsx:378`. Reuses an existing pattern.
- **Effort:** S
- **Confidence:** high — read from markup; the mirror-image divider already exists one line up.

### Checked and clean — no finding

| Checked | Result |
|---|---|
| Visual hierarchy of the new trigger | `.px-btn-accent` (filled brand) against three outline `.px-btn`s correctly reads as the primary action. Right call. |
| The slot abstraction | `TopBarActions` (`shell.jsx:364-368`) resolves the node in an effect rather than during render, with a documented reason, and self-cleans on unmount. This is well built and is the right shape for the problem. |
| Trigger visible at all scroll positions | Yes — `TopBar` is outside the scroll pane. A genuine improvement over the page row it replaced. |
| Bottom nav target size | `padding: '9px 4px 11px'` around an 18px icon + 11px label ≈ 52px tall, full-width fifths. Comfortably clears 2.5.8 **and** the 44pt/48dp guidance. |
| Dark mode | Every new element uses `--proto-*` / Compass tokens that flip under `.proto-dark`. No hardcoded literals were introduced in either addition. |

---

## Full ranked list — most severe first

| # | Sev | Finding | Where | Effort |
|---|---|---|---|---|
| 1 | BLOCKER | Metro chips are `<span onClick>` — keyboard cannot operate them at all (**2.1.1 A**) | `Settings.jsx:1477` | S |
| 2 | BLOCKER | Unrecognized queue permanently stalls — an unmappable row can never be cleared | `Settings.jsx:1506-1525` | S |
| 3 | BLOCKER | 12 assign dropdowns have no accessible name — all announce identically | `Settings.jsx:1512` | S |
| 4 | BLOCKER | Add-job's 3 inputs have no labels — placeholder is the only name | `Opportunities.jsx:90-98` | S |
| 5 | MAJOR | "416 jobs affected" is wrong; the copy under it is false for every remote row | `Settings.jsx:1427` vs `data.jsx:10-18` | S |
| 6 | MAJOR | Two visible rows are secretly one control — raw-string grouping vs normalised alias key | `Settings.jsx:1430` vs `settings.js:52` | S |
| 7 | MAJOR | Most rows have no valid answer — dropdown only offers metros already in the pipeline | `Settings.jsx:1418,1516` | M |
| 8 | MAJOR | Primary creation action moved to the hardest-to-reach corner of the phone | `shell.jsx:386` | M |
| 9 | MAJOR | The move reclaimed 56px of a 487px problem — the filter stack is the real cost | `Opportunities.jsx:395-435` | M |
| 10 | MAJOR | Triage actions are off-screen to the right on the phone (`minWidth: 680`) | `Opportunities.jsx:437-438` | L |
| 11 | MAJOR | Opening the Add-job panel discards the user's place in a 1,378-row list | `Opportunities.jsx:339` + `shell.jsx:492` | S–M |
| 12 | MAJOR | "Already in your pipeline" is a dead end — no link to the existing record | `Opportunities.jsx:43-46` | S–M |
| 13 | MAJOR | Error/refusal styling is dead — `--text-ok` / `--text-bad` are undefined (11 sites) | `theme.css` (missing) | S |
| 14 | MAJOR | Refusal and success messages are never announced (**4.1.3 AA**) | `Opportunities.jsx:106` | S |
| 15 | MINOR | 12 pending dropdown changes lost silently on navigation | `Settings.jsx:1529` | S |
| 16 | MINOR | After a refusal, the keyboard can no longer submit | `Opportunities.jsx:92` | S |
| 17 | MINOR | `type="url"` does nothing — there is no `<form>` | `Opportunities.jsx:90` | S |
| 18 | MINOR | Top-bar label wraps at 320px — no `nowrap`, no `flex-shrink: 0` | `theme.css:201` | S |
| 19 | MINOR | Page-scoped action sits in app-scoped chrome with no divider | `shell.jsx:386` | S |

**Ten of the nineteen are S.** Findings 2, 5, 6 and 13 are each one to two lines of code.

## The honest overall verdict

The owner's read — *"don't follow good practices in most cases"* — is **right about the details
and wrong about the intent.** Both additions solve real, well-identified problems, and the
reasoning recorded in the code comments is unusually good: the Add-job fallback path correctly
treats a login-walled posting as the common case rather than the edge case, and the Unrecognized
card exists because 416 jobs were silently vanishing with nothing on screen to explain it. Those
are the right calls.

What is missing is uniformly the **last mile**: accessible names, a real `<form>`, an escape hatch,
and one shared rule instead of two divergent copies of it. None of these are design decisions that
need revisiting. Fourteen of the nineteen findings are S-effort, and four of them are single lines.

Two things in particular are *better* than the surrounding app and should not be touched: the
`TopBarActions` slot abstraction, and the refusal→two-fields recovery flow.

Worth stating explicitly, because it cuts against the expectation: **contrast is not a problem
anywhere in either addition.** Every text pairing was computed from resolved tokens and passes
1.4.3 — the `--proto-ink3` fix described in `theme.css:15-41` has landed, so the 2.43:1 figure that
comment describes is historical, not current.

## If you only fix three things

**1. Add a third option to the assign dropdown: "Not a place / ignore".** `Settings.jsx:1515`, one
line, plus a skip in the `rawBy` loop at line 1427.
*Why first:* it is the only finding where the **feature currently cannot be completed by anyone**,
including a fully-abled user with a mouse. "Remote · 26 jobs" — the single largest row — has no
correct metro, so it occupies one of the twelve slots permanently, and the 303 rows behind it are
unreachable by any route in the UI. Every other fix improves something that works; this one makes a
broken thing work. Smallest change in the review, largest change in outcome.

**2. Make the card use the app's one location rule instead of its own.** `Settings.jsx:1427` —
import `matchesLocationPrefs` from `data.jsx` (its own comment calls it *"the SINGLE
location/remote rule"*) rather than re-deriving a metro-only test.
*Why second:* the orange "416 jobs affected" badge is the number that decides whether the owner
commits an evening to this screen, and it is **provably inflated** — any location matching
`/\bremote\b/` is kept by the live filter while the card claims it is filtered out. Fixing the
number is worth more than fixing a dozen smaller things, because it governs whether the work in
#1 is worth doing at all. It also removes a duplicated rule, which is the class of defect that
produced findings 5 **and** 6 from one root cause.

**3. Give every new control an accessible name, and make the metro chips real buttons.**
`Settings.jsx:1477` (`<span>` → `<button aria-pressed>`), `Settings.jsx:1512`
(`aria-labelledby`), `Opportunities.jsx:90-98` (wrap in `<form>`, add `<label>`s).
*Why third and not first:* this is the widest standards gap in the review — one outright WCAG A
keyboard failure plus three name/role violations — and on a product sold to executives it is the
finding most likely to matter to someone other than the owner. It is ranked third only because the
owner, as the current sole user, is not personally blocked by it, and because #1 and #2 are each
smaller and unblock the feature's core purpose. **If this product will ever have a second user, or
be shown to an employer, move this to #1.** All three changes together are under an hour and
require no visual redesign.

---

*Reviewed against Nielsen's 10 usability heuristics, WCAG 2.2 AA, and Apple HIG / Material mobile
target and reach guidance. Every contrast ratio quoted was computed from the resolved values in*
`app/src/tokens/fig-tokens.css` *using the WCAG relative-luminance formula, not estimated. Every
CSS-pixel measurement of the phone was calibrated against* `TopBar`*'s known 54px height. No code
was changed.*
