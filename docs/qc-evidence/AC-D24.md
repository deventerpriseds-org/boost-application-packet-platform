# Acceptance criteria — D24 / `D:appconfig-unreachable-in-product`

> **Provenance.** Written by an independent acceptance-criteria subagent on 2026-08-21, which
> was then KILLED by the container reclaim at 12:06:44 before it could report. No completion
> notification fired — see the org rule *"The same reclaim that rewinds your tree KILLS every
> in-flight subagent"*. This document was recovered verbatim from the orphaned transcript at
> `tasks/a296c8364180a5802.output`, which survives on disk precisely because the transcript is
> the one durable artifact a dead agent leaves. It is committed here so the next reclaim cannot
> take it, and so the criteria are reviewable before any code is written against them.
>
> Nothing below has been edited. The implementer has NOT yet acted on it.

---

I read the repo's `CLAUDE.md`, then traced the whole path from the live warning string back through `dimensions.ts` → `appDimensions.ts` → `appRequirements.ts` → `api.js` → `Settings.jsx`, plus `roleTaxonomy.ts`, `appSession.ts`, `.claude/DEFERRED.md`, `api/test/hardening.test.mjs` (H33, H42), `api/test/deferredLedger.test.mjs` and `docs/qc-evidence/AC-P8.4.md`. Everything below is grounded in that read.

---

# Acceptance criteria — D24: the "Comparison dimensions" settings control

**Scope.** Build the `app/` half of the per-role-family dimension set. These criteria discharge the two pre-existing criteria that were written cold before the code existed and are still open — `P8.4-AC3` (the store must be writable *by the deployed app*, not only by SQL) and `P8.4-AC6` (the surface must live in the existing Settings shell) — and add what neither covers.

## Findings established by reading, before any criterion

These are observations, not assumptions. They change what "done" means.

**F1 — The API half IS complete, and I confirmed it rather than taking the ledger's word.** `api/src/functions/tests/appDimensions.ts:280-330` registers `app.http('dimensionPrefs', …, route: 'app/dimension-prefs')` with `GET`/`POST`/`OPTIONS`. `GET` returns `{ ok, stored, seed, catalogue, defaultKey }`. `POST {family, keys[]}` is guarded by `requireWrite(req)`, calls the exported `setDimensionPrefs`, and returns `{ ok, family, keys, dropped, stored }`. `setDimensionPrefs` merges per-family (`cmp_dimensions || jsonb_build_object($2,$3)`) so saving one family never clobbers another, and drops keys not in `DIMENSION_BY_KEY`. `loadDimensionPrefs` returns `null` — not `{}` — for an owner who never chose. `api/test/dimensionsDb.test.mjs:233-256` round-trips all of this against a real cluster. **No API change is required to satisfy AC1-AC14 below.**

**F2 — but the GET does not return the family universe, and that is the trap this whole build will fall into.** `seed` is `DIMENSION_SETS` (`dimensions.ts:143-148`), which contains exactly four keys: `default`, `product`, `data`, `architecture`. The family in the live defect — `technology` — **is not in it**, by design ("only families whose seeded set DIFFERS from the default are listed"). A settings screen that enumerates families from `seed` renders four rows and **cannot configure the family that produced the live warning.** It would look finished and fix nothing.

**F3 — the family universe is already in the product, per-owner, and already called from `app/`.** `roleFamilyOf` (`appDimensions.ts:139-144`) is `resolveTitle(role).roleSlug` with any seniority prefix stripped. `resolveTitle` yields `roleSlug` = `f.slug` on the exact/alias/fuzzy path (`roleTaxonomy.ts:91`, `pushTitle(group, f.slug, …)`) and `${seniority}-${fam.slug}` on the keyword path (`roleTaxonomy.ts:261`) — the prefix strip makes both land on the same slug. That same `roleSlug` is what `seedUser` writes into `taxonomy_title.role_slug` (`appRoleTaxonomy.ts:54-57`) and what `taxonomyRead` serves as `groups[].roles[].slug` with a human label at `roles[].role` (`appRoleTaxonomy.ts:172`). `api.taxonomy()` already exists in `app/src/api.js:297` and is already called by `RolesTitles.jsx:48`. **The family list and its labels are one existing call away. Hand-typing them in `Settings.jsx` is the "extend, don't duplicate" failure this repo has already paid for once (the `taxonomy_title` parallel-role-brain incident, `CLAUDE.md`).**

**F4 — configuring the `default` family does NOT silence the live warning.** `dimensionsFor` (`dimensions.ts:172-197`) checks the owner's entry for the *specific* family first; failing that it falls to the owner's `default` and returns `source: 'owner'` **with a different warning** — `"…used your default set — change it in Settings ▸ Comparison dimensions"`. Only an explicit entry for `technology` returns `source: 'owner'` with `warning` absent.

**F5 — changing the set does not re-grade anything.** `comparison_dimension` rows carry `set_source` and `role_family` frozen at write time. `writeComparison` runs only from `rebuildComparison` (`appRequirements.ts:288`), which is called from the evidence resolve (`:502`) and the backfill (`:448`). The requirements `GET` deliberately does not re-resolve. So a preference change alters the `comparison.warning` in the evidence-POST response only on the **next resolve**, and in the meantime `comparisonPayload` reports the divergence via `stale`.

**F6 — `H42` (`hardening.test.mjs`) already passes for `cmp_dimensions`** because a route writes it. H42's invariant stops at the API boundary, so it is green on precisely the defect D24 records. The guard has a hole the size of this ticket.

---

## A. Happy path

**D24-AC1.** Given a signed-in owner on `#/settings`, when they look at the section rail, then a section whose label is the **exact string `Comparison dimensions`** is present in `SECTIONS` (`Settings.jsx:1570`) and renders its card when selected — reachable at a stable hash route the same way every other section is (`App.jsx:35`, `<Settings tab={parts[1]}/>`).

**D24-AC2.** Given that section, when it finishes loading, then it lists the dimensions **derived at runtime from the `catalogue` array in the `GET /api/app/dimension-prefs` response** (`key`, `label`, `help`), and no dimension key, label, or help string is typed literally anywhere in `app/src/`. A second literal list is a fail even while the two agree — this is `P8.4-AC1` applied to the new surface.

**D24-AC3.** Given the owner picks a role family and toggles dimensions on and off, when they save, then exactly one `POST /api/app/dimension-prefs` is issued with `{ family, keys }`, the response `ok` is `true`, and the control re-renders from the returned `stored` object rather than from local optimistic state.

**D24-AC4.** Given a save that returns a non-empty `dropped` array, when the response is rendered, then the control names the dropped keys on screen. Silently discarding them would leave the owner believing they configured axes that will never be graded (the API drops unknown keys deliberately — `appDimensions.ts:118`).

**D24-AC5.** Given the owner has saved family F and then edits family G, when G is saved, then re-reading `stored` still contains F's set unchanged — the per-family merge is preserved end-to-end through the UI, not just in `setDimensionPrefs`.

## B. The role-family list (where this build most likely goes wrong)

**D24-AC6.** Given the owner opens the section, when the selectable role families are enumerated, then the list covers **every slug `roleFamilyOf` can return** — the seventeen `taxonomy_title.role_slug` values (`cto, cio, cdigo, cdatao, cpo, caio, coo, software, engineering, product, technology, digital, data, architecture, delivery, solutions, transformation`) plus `default` — and specifically **includes `technology`**, the family in run 32451913037.

**D24-AC7.** Given that list, when its source is inspected, then it is obtained from an existing per-owner source — `api.taxonomy()` `groups[].roles[].slug` (deduplicated across the `vp` and `director` groups, which repeat the same ten slugs), or an extension of the `dimension-prefs` GET to return the same slugs — and **is not a literal array of family names in `Settings.jsx`**. If the implementer extends the API GET instead, that is acceptable *provided the decision is stated in the PR text and the ledger row's claim that "the API half is finished and needs no further change" is corrected in the same commit*; what is not acceptable is a hardcoded list, and what is not acceptable is enumerating from `seed`, which contains four families and omits `technology` (F2).

**D24-AC8.** Given a family in the list, when its name is displayed, then the human label comes from the taxonomy response (`roles[].role`, e.g. `Data, Analytics & AI` for slug `data`, `Chief Digital Officer` for `cdigo`) and not from a slug printed raw or a hand-written label map.

**D24-AC9.** Given each family row, when it is rendered before the owner has touched it, then it visibly distinguishes the three states `dimensionsFor` can be in — configured by the owner (`stored[family]` present), inheriting the owner's `default`, and unconfigured (seeded) — because `stored === null` and `stored === {}` and `stored[family] === []` are three different facts and `loadDimensionPrefs` preserves all three.

**D24-AC10.** Given the owner turns every dimension off for a family and saves, when the set is read back, then it persists as an empty array and is presented as a deliberate "nothing graded for this family", not as "unconfigured". `dimensionsFor:177-180` honours `[]` as a real answer; a UI that re-renders it as "not configured yet" makes a chosen state indistinguishable from a defaulted one, which is the exact class of failure `set_source` exists to prevent.

## C. The multi-tenant owner trap

**D24-AC11.** Given `app/src/api.js` gains `dimensionPrefsGet` and `dimensionPrefsSet`, when their source lines are read, then **both** append `?owner=${encodeURIComponent(_owner)}`, matching `searchPrefsGet`/`searchPrefsSet` (`api.js:263-264`) and the comment on `listPersonas` (`api.js:285-287`) recording where this last bit.

**D24-AC12.** Given `dimensionPrefsSet` were to omit `?owner=`, when a real signed-in owner saves, then the failure must be impossible-by-test rather than caught by eye — because it does **not** surface as an error. `resolveOwner` (`appSession.ts:63`) falls back to `DEMO_EMAIL`, and `requireWrite` (`appSession.ts:74`) *allows* writes to the demo owner. The owner would receive `200 ok:true`, see the UI say "Saved", and have written `cmp_dimensions` into `demo@executive-engine.local` while their own comparisons went on using the seed forever. Therefore: a test asserts the `?owner=` parameter on both helpers, added to the **existing** helper list in `app/test/qcRail.test.mjs:578` (`'every owner-scoped GET the rail uses appends ?owner='`) rather than in a new parallel test.

**D24-AC13.** Given the Settings card, when its source is inspected, then it contains no `fetch(` — every call goes through `api.js`, which is where the owner rule lives (the rule already asserted for `QcRail.jsx` at `qcRail.test.mjs:587`).

**D24-AC14.** Given an owner whose session token has expired, when they press Save, then the control checks `sessionValid()` **before** issuing the request and shows the same class of message `TemperatureSettings` uses (`Settings.jsx:396`), and given a 401 arrives anyway, then the error is surfaced verbatim and the control does not display "Saved".

## D. Loading and failure states

**D24-AC15.** Given the `GET` has not yet returned, when the section renders, then it shows an explicit loading state and no dimension controls — matching `Settings.jsx:392` (`Loading temperature bands…`) and `Settings.jsx:1179` (`Loading roles…`).

**D24-AC16.** Given the `GET` rejects (network failure, 500 from `dimensionPrefs`'s catch at `appDimensions.ts:325`), when the section renders, then it shows the error and **does not fall back to rendering a default set as though it were the owner's stored configuration.** `TemperatureSettings` is the named analogue and **on this point it must not be copied**: its `.catch()` at `Settings.jsx:391` substitutes hardcoded defaults, so a failed read is indistinguishable on screen from a successful read of an unconfigured owner. That is "absent evidence rendered as a pass", which `CLAUDE.md`'s standing rules and `.claude/DEFERRED.md`'s preamble both forbid.

**D24-AC17.** Given a `POST` fails, when the control settles, then the previously-saved set is still displayed (no optimistic state left standing), an error is shown, and no success wording appears.

## E. The warning is a contract — what must become true downstream

**D24-AC18.** Given the section label chosen in D24-AC1, when it is compared to the two strings in `api/src/functions/tests/dimensions.ts:186` and `:196`, then it matches the destination they name — `Settings ▸ Comparison dimensions` — **verified by a test that reads the warning template out of `dimensions.ts` and asserts the `SECTIONS` label in `Settings.jsx` appears in it**, not by two humans agreeing. Either the label matches the string, or the string changes; if the string changes, that is an `api/` edit that contradicts the ledger's "the API half is finished" and must be stated. A section named "Comparison" or "Dimensions" leaves the live product still directing the owner to a screen that does not exist, only less obviously.

**D24-AC19.** Given the owner explicitly saves a set for family `technology`, when `POST /api/app/opportunity/9f9c370a-4ac9-441e-b58e-02e3ffcf669e/evidence` is re-run via `api-test.yml` with `?owner=von.ellis@enterpriseds.io`, then the `comparison` block of the response has `"setSource": "owner"` and **`"warning": null`**, and `"rows"` equals the number of dimensions the owner selected. This is the single observation that closes D24; run 32451913037 is the before-value to cite against it.

**D24-AC20.** Given the owner instead configures only the `default` family, when the same call is re-run, then `warning` is **still non-null** and reads `…used your default set…` (`dimensions.ts:186`). This criterion exists to fail an implementation that offers only a single global set: `dimensionsFor` matches the specific family first and the fallback keeps warning (F4). A UI that cannot address `technology` by name cannot discharge D24-AC19.

**D24-AC21.** Given the owner changes a set for a family whose opportunities were compared **before** the change, when the JD step is loaded for one of them, then the card still shows the stored rows and additionally renders the staleness note (`comparisonStaleNote`, `postingAnalysis.js:463`; `PostingAnalysis.jsx:159-166`) — and the settings control **states in its own copy that a change applies to the next resolve, not retroactively**. `writeComparison` is reached only through `rebuildComparison` (F5); a control that implies otherwise makes a true claim about the setting and a false one about the data.

**D24-AC22.** Given the comparison card renders `set.warning` (`PostingAnalysis.jsx:150`), when the owner reads a warning that names a settings destination, then that destination is reachable **by clicking**, not only by prose. The same file already holds this rule for itself — "R5: a count that cannot be opened is a dead end" (`PostingAnalysis.jsx:198-199`) — and `CLAUDE.md`'s "No dead UI" makes a named-but-unreachable destination the same defect in text form. Navigation uses the existing `go()` from `state.jsx`, as `shell.jsx:357` does.

## F. Regression guards

**D24-AC23.** Given the build lands, when `node --test api/test/*.test.mjs` runs, then `deferredLedger.test.mjs` **fails against the unmodified ledger** — D24's directive is `check: absent app/src/screens/Settings.jsx dimensionPrefs` (`.claude/DEFERRED.md:103`), and it goes false the moment the control exists. Therefore the same commit moves D24 to `CLOSED` per that file's rules (a row is `OPEN` while any part is outstanding, including "not verified live"), and D24 may only be marked `CLOSED` once D24-AC19 has been observed on the deployed app — not on a local build.

**D24-AC24.** Given a future session deletes the Settings card while leaving the route and `api.js` helper in place, when the suite runs, then a named H-case fails. The invariant to assert is the one `H42` stops one step short of (F6): **a per-owner settings column production reads must have a writer in the API *and* a caller in `app/src` that a user-reachable surface invokes.** This must **extend `H42`** in `api/test/hardening.test.mjs` — it is the same invariant with the boundary moved — not stand up a second scan beside it. Per `CLAUDE.md`'s naming rule the extension takes a slug (`H:settings-column-has-a-control`), never a number, and its comment records this run id and the measured before-value (`grep -ic dimension app/src/screens/Settings.jsx` → `0`).

**D24-AC25.** Given the new guard, when it is proved, then it is proved **by reinstating the defect** — delete the card, watch the named assertion fail, restore it — in the manner `postingCompare.test.mjs:4-6` records for every guard in the P8.4 set. A guard that has never been seen to fail is not known to be a guard.

**D24-AC26.** Given the new UI logic (which family is selected, which state a family row is in, how `stored`/`seed`/`catalogue` compose into rows), when tests are written, then the pure logic is exported from a module testable without a DOM and asserted in the **existing** `app/test/postingCompare.test.mjs` or a sibling under `app/test/`, following the file-layout rule the P8.4 surface already follows (`postingAnalysis.js` holds the logic, `PostingAnalysis.jsx` holds the rendering).

**D24-AC27.** Given the section is live, when it is verified, then verification is a `ui-verify.yml` run against `#/settings/<the new key>` with `owner=von.ellis@enterpriseds.io` and `expect` naming the section label plus at least two dimension labels **and the string `technology`** — because the sandbox cannot render the SPA (`CLAUDE.md`, "Verify the LIVE UI"), and because a local build proves the component compiles, not that the owner can reach it.

---

## CONCERNS

1. **The most likely failure of this build is a screen that ships, looks correct, and still cannot fix the live defect.** `GET /api/app/dimension-prefs` hands the client `seed` — four families, `technology` absent — and nothing else that enumerates families. An implementer working only from that payload will produce a four-row screen, will demo it successfully, and run 32451913037 will keep returning the same warning. D24-AC6/AC7/AC19/AC20 exist solely to make that outcome fail. **If only one criterion survives review, keep D24-AC19.**

2. **The ledger's claim that "the API half is finished and needs no further change" is true for read/write of prefs and false for discoverability.** I am not asserting the ledger is wrong about its own lane — the route round-trips, and `dimensionsDb.test.mjs` proves it. I am saying the `app/` half cannot be built correctly from that route's response alone without reaching into `api.taxonomy()`. Someone should decide deliberately which of the two shapes is wanted rather than discovering the gap mid-build.

3. **`TemperatureSettings` is the wrong analogue for error handling and the ledger names it as *the* analogue.** Its `.catch()` substitutes hardcoded defaults, so a failed GET renders as a successfully-loaded unconfigured owner. Copying "the closest analogue" wholesale reproduces that. D24-AC16 exists for this. It is also worth someone deciding whether `TemperatureSettings` itself should be fixed — but not in this commit, and if it is left, it is a new ledger row, not a silent decision.

4. **The warning string is duplicated in two places in `dimensions.ts` (`:186` and `:196`) with different bodies and the same destination clause.** A test that pins the label against only one of them will pass while the other drifts. D24-AC18 should read the destination clause out of both.

5. **`H42` being green on exactly this defect is the more serious finding than the missing screen.** A guard written to catch "a stored setting production reads and nothing writes" passed a stored setting the product gives the owner no way to change. The screen is a day's work; the guard hole will keep producing D24s. If the schedule forces a cut, cut a UI polish criterion, not D24-AC24.

6. **Likely to rot:** the family list. `FAMILIES` in `roleTaxonomy.ts:47-58` and `CSUITE:18-40` are edited by other lanes. Any list derived at runtime from the taxonomy survives that; any list snapshotted into `app/` decays silently, and its decay mode is "a family the owner can no longer configure" — which is D24 again, with a smaller blast radius and no ledger row.

7. **Deliberately not specified, and someone should decide:** whether saving a set should offer to re-resolve affected opportunities. `rebuildComparison` exists and the backfill route already loops it over many opportunities (`appRequirements.ts:444-450`), so the capability is there. I have not required it, because it is a write triggered from a settings screen with a blast radius across every opportunity in a family, and that is a scope decision the owner should make explicitly. D24-AC21 requires only that the control not *imply* retroactivity. If the implementer wants the re-resolve, that needs its own ACs and its own sign-off.

8. **What I could not verify from this sandbox, stated as such:** I have not observed the live Settings screen, the live `dimension-prefs` route, or the production `owner_search_prefs.cmp_dimensions` value for `von.ellis@enterpriseds.io`. Everything above is from reading `origin/main` at `3153f1a` (fetched during this task; the worktree branch `claude/qc-d14-relabel` differs from it only in `api/src/functions/tests/resumeParser.ts` and its test, neither of which touches this path). The one production fact I am relying on is the response body quoted in the task, from run 32451913037. D24-AC19 and D24-AC27 are the observations that would convert the rest from inference to confirmation.
