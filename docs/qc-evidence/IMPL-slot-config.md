# IMPL — per-template fixed-slot counts (`config.ts`, `schema.ts`, `Settings.jsx`, `api.js`)

**Branch:** `claude/incumbent-wins-swap` (no commit, no push — tree left for the parent session)
**Slug:** `slot-config`
**Started:** 2026-08-30
**Status:** COMPLETE — ends with `## END OF IMPL PASS`. (Written incrementally; a copy ending
without that marker is truncated and must not be acted on.)
**Not committed, not pushed** — the tree is left for the parent session, per the brief.

Owner decision being implemented (settled, not re-litigated):
> *"fixed slot counts change per template"*, *"the 10 can't be increased to 12 or reduce to 8 etc so
> only swaps are allowed not adds or drops given the limited space in the resume template"*,
> *"also relevant and expertise counts"*.

**§1a of `AC-fixed-slot-swap-pairing.md` is SUPERSEDED.** That pass recommended `chk_*` threshold
columns on `owner_search_prefs` with a master-text fallback. The owner has since ruled the count is a
property **of the template**, so it lives on the `AppConfig` `templates` row alongside `roleFocus` /
`label`. AC-8 (`{n: null}`, **never** `{n: 0}`, for an unset count) survives intact and is the
load-bearing requirement carried forward.

---

## 0. Files I own (and only these)

| File | Change |
|---|---|
| `api/src/functions/config.ts` | read + write the six slot counts on the existing `templates` row |
| `api/src/functions/tests/schema.ts` | widen `swap_decision`'s `list` CHECK to admit `'expertise'` |
| `app/src/screens/Settings.jsx` | six owner-editable numbers per template in `TemplateFocusSettings` |
| `app/src/api.js` | carry `slots` on `templateFocusSet` |
| `docs/qc-evidence/IMPL-slot-config.md` | this file |

**Not touched** (owned by another agent / the parent session): `swaps.ts`, `appSwaps.ts`,
`checks.ts`, `api/test/hardening.test.mjs`.

---

## 1. Ground truth read before editing (OBSERVATION)

| Claim | Source read | Result |
|---|---|---|
| The store already exists — `AppConfig` partition `templates`, rowKey `resume-<driveId>` | `config.ts:115-117` `isTemplateRow`, `roleFocus.ts:41-43` `templateRowKey` | **EXISTS** — extend it, do not create a table |
| It already carries two properties | `config.ts:133` `{ roleFocus?, label? }` | **EXISTS** |
| `GET/POST /api/config/templates` already routed, one registration, method-dispatched | `config.ts:232-238` | **EXISTS** |
| Settings already renders the collection | `Settings.jsx:1969-2044` `TemplateFocusSettings`, mounted `:2136` | **EXISTS** |
| The write is `'Replace'`, and only re-writes `roleFocus`/`label` | `config.ts:207-210` | **THE TRAP** — a naive add means editing a focus WIPES the slots |
| The preserve-dance precedent for that trap already exists for `label` | `config.ts:180`, `:188-195`, `:199-202` | **EXISTS** — copy its shape |
| `swap_decision.list` rejects `'expertise'` on production | `schema.ts:567` inline CHECK; `schema.ts:594-596` states a `create table if not exists` is a no-op on an existing table | **EXISTS-BUT-CONSTRAINED** — needs an explicit ALTER |
| The ALTER precedent | `schema.ts:600-602` (`swap_decision_driver_check`) | **EXISTS** — follow it verbatim |
| The Google Doc holds no slot structure | `diagSkillSources.ts:16-22` — placeholders are exactly `{{ExpertiseBullets}} {{RelevantBullets1..3}} {{ResumeSummary}} {{SkillsBullets1}} {{SkillsBullets2}}` | count **cannot be derived**; it must be stored |

INTERPRETATION: this is one new group of properties on one existing row, one new ALTER, and one new
control group on an existing card. No new table, no new partition, no new route, no new screen.

---

## 2. Decisions taken (reversible, noted rather than blocking)

- **D-1 — no numeric seed.** `SEED_TEMPLATE_ROLE_FOCUS` seeds a *focus* word; I deliberately seed
  **no slot number**. A seeded count is an invented number and AC-8/AC-10 require an unset count to
  read `null` (unknown → `not_applicable` downstream), never `0` and never a guess that would name
  innocent items as illegal. The owner types the real count once, per template, in Settings.
  The no-hardcoded-config rule permits a seed; it does not require one where no honest first value
  exists.
- **D-2 — property naming on the Storage row:** `slot_SkillsBullets1` … `slot_RelevantBullets3`.
  Prefixed so a slot property can never collide with `roleFocus` / `label` / a future field, and so
  the read side can enumerate slots without a second whitelist.
- **D-3 — the DELETE branch is widened.** `config.ts:199-202` deletes the row when focus and label
  are both blank. With slots on the row that would silently destroy the counts, so the delete now
  requires *all three* to be empty.
- **D-4 — one entity read per save.** The existing code read the row only when `label` was omitted.
  Slots are almost always partially omitted, so the read is now unconditional and serves both. Same
  cost in the common path (the UI always omits at least some slots), same semantics for `label`.

---

## 3. Work log

### 3.1 — CONTAINER REWIND MID-PASS (recorded because it cost real work, and nearly cost more)

**OBSERVATION.** At ~02:04Z, mid-verification, the working tree silently reverted to `HEAD`
(`82f1fbf`). `git diff --stat` returned EMPTY, all four edited files were back at HEAD, and
`docs/qc-evidence/IMPL-slot-config.md` did not exist on disk. The tell was a `system-reminder`
quoting `config.ts` back at me *without* my changes.

**Recovery, exactly as `CLAUDE.md` prescribes.** The `PostToolUse` autosave had the work:

```
git fetch origin '+refs/heads/eds-wip/*:refs/remotes/edswip/*'
git log --oneline -1 refs/remotes/edswip/claude/incumbent-wins-swap
  -> 23ee841 eds-autosave 2026-08-30T02:03:53Z
git checkout refs/remotes/edswip/claude/incumbent-wins-swap -- \
  api/src/functions/config.ts api/src/functions/tests/schema.ts \
  app/src/screens/Settings.jsx app/src/api.js docs/qc-evidence/IMPL-slot-config.md
```
All five restored intact (marker counts: `SLOT_FIELDS` 8, `SLOT_CONTROLS` 5,
`swap_decision_list_check` 3, `slots === undefined` 1, progress file present). **Every verification
below was then re-run from scratch on the restored tree** — nothing in this file is evidence
gathered before the rewind.

**The rewind hit the OTHER agent too** (`swaps.ts` / `appSwaps.ts` were also back at HEAD). I did
not restore their files — not mine to touch — and they have since re-landed their work; both builds
now pass with it present. If any of their work is still missing, it is in the same snapshot
`23ee841`.

---

## 4. EVIDENCE — every claim, with the command that produced it

### 4.1 Builds (the cheap total-coverage floor, re-run after every mutation)

```
cd api && npm run build     -> exit 0   (tsc, no output)
cd app && npm run build     -> exit 0   (vite, 247 modules, built in 4.6s)
```
JSX smart-quote discipline: the `sed` sweep was run on `Settings.jsx`, then the Python codepoint
scan over all four files -> **`smart-quote hits: 0`**, and the app build passed AFTER the sweep
(the sweep-breaks-a-single-quoted-string trap is caught only by the build, and the build is green).

### 4.2 The schema, EXECUTED against a POPULATED database carrying main's schema

Recipe exactly as `CLAUDE.md` "Run the schema locally" — PostgreSQL 16.13 on `/tmp/pgsock:55432`,
pgvector stubbed, `ON_ERROR_STOP=1`, my `SCHEMA_SQL` dumped from the **built module**
(`api/dist/functions/tests/schema.js`), main's extracted from
`git show origin/main:api/src/functions/tests/schema.ts`.

| Step | Command | Result |
|---|---|---|
| 1 | `psql -v ON_ERROR_STOP=1 -d upg -f /tmp/schema_main_nv.sql` | **exit 0** (1510 lines, main's schema) |
| 2 | seed `opportunity` + `packet` + **five real `swap_decision` rows**, one per legal list, covering all five `action` values (`kept/swapped/dropped/added/merged`) | **exit 0** |
| 3 | PRE-state constraint | `CHECK (list = ANY (ARRAY['skills_1','skills_2','relevant_1','relevant_2','relevant_3']))` |
| 3 | `insert ... list='expertise'` | `ERROR: violates check constraint "swap_decision_list_check"` — **the production defect reproduced exactly, constraint name included** |
| 4 | `psql -v ON_ERROR_STOP=1 -d upg -f /tmp/schema_nv.sql` (MINE, on the populated DB) | **exit 0** |
| 5 | POST-state constraint | `CHECK (list = ANY (ARRAY[...,'expertise']))` |
| 5 | `insert ... list='expertise'` | **`INSERT 0 1`** |
| 6 | `insert ... list='not_a_list'` | `ERROR: violates check constraint` — the widening did **not** become a free-for-all |
| 7 | `select list, action, count(*) ...` | all five seeded rows survived, every `action` value intact, plus the new `expertise/swapped` row |

**Ordering (H39/H39b) — OBSERVATION:** my ALTER pair sits immediately after the
`swap_decision_driver_check` ALTER (`schema.ts:600-602`), i.e. after `create table if not exists
swap_decision` and before the `loop` ALTER block. It names only the `list` column, which is in the
original create and present on production since P1. Step 4's exit 0 on a database where the table
already existed is the execution proof, not a reading of the file.

### 4.3 MUTATION PROOFS — the step never skipped

Each mutation reverts the behaviour a guard protects; the guard must FAIL. Baseline first, restore
after, baseline re-confirmed at the end (`ALL PROBES PASSED`).

| Mutation | What was reverted | Result |
|---|---|---|
| **M1** | slot preserve-dance dropped (`keepSlots[f] = … : null` instead of `: readSlot(existing, f)`) | **FIRED** — `ALL SIX SLOT COUNTS SURVIVED the focus edit` FAILED, all six read `null`. This is THE TRAP, proved live. |
| **M2** | `readSlot` returns `0` instead of `null` | **FIRED** — `stored 0 -> null`, `stored -2 -> null`, `stored 3.5 -> null` all FAILED, returning `0`. AC-8 proved non-vacuous. |
| **M3** | type gate removed (bare `Number(raw)`) | **FIRED** — `rejects true`, `rejects ["5"]`, `rejects "1e3"`, `rejects "0x10"` all FAILED with `status 200`. |
| **M4** | delete branch loses `&& !hasAnySlot(keepSlots)` | **FIRED** — `row NOT deleted when only slots remain` FAILED; the row was destroyed. |
| **M5** | the explicit `ALTER` removed from `SCHEMA_SQL` (inline CHECK left widened) | **FIRED** — the migration still ran **exit 0** on the populated DB, the constraint stayed at the five old values, and `insert list='expertise'` was still `ERROR: violates check constraint`. This is precisely the "a fresh-DB pass proves almost nothing" failure, demonstrated rather than asserted. |

### 4.4 BEHAVIOURAL PROBE — the real handlers, against a faithful in-memory Table client

`saveTemplateConfig` / `getTemplateConfig` executed from the **built** `api/dist/functions/config.js`
with `@azure/data-tables` stubbed by an in-memory store whose `upsertEntity` implements **Replace
semantics faithfully** (the stored row becomes exactly what was sent). 44 assertions, all passing:

| Group | Proves |
|---|---|
| **A** | an unconfigured template reads all six as `null`, and **none is `0`** (AC-8) |
| **B** | **THE TRAP:** set six counts + a label, then POST `{templateId, roleFocus}` only — focus changes, label survives (pre-existing behaviour intact), **all six counts survive**, and the response echoes them |
| **C** | a PARTIAL `slots` object updates only the keys it names; omitted keys untouched |
| **D** | an explicit `null` clears one count; it reads back `null` not `0`; neighbours untouched; and the cleared slot is **absent from the stored row**, not stored as `0` |
| **E** | `0`, `-3`, `1.5`, `"ten"`, `true`, `false`, `["5"]`, `[]`, `{}`, `"5x"`, `" "`, `"1e3"`, `"0x10"` are all **400**, and a rejected write changes nothing |
| **F** | `"9"` from a form input is accepted as `9` |
| **G** | junk already in storage (`0`, `-2`, `"x"`, `3.5`, `true`, `"1e3"`) reads back `null`; a good `5` still reads `5`; `"  8  "` reads `8`; and junk is **not resurrected** through the preserve path |
| **H** | a slots-only row is not deleted by a blank focus and IS listed as configured; a fully-empty row IS deleted |
| **I** | an unknown slot key is ignored, never written |

**A DEFECT MY OWN PROBE FOUND, AND I FIXED BEFORE ANY VERIFIER RAN (§0b).**
`Number(true) === 1`, and `1` passes `Number.isInteger(n) && n > 0` — so a stray boolean was being
**stored as a slot count of ONE**, which declares every item past the first illegal. That is the
accusation class this whole change exists to avoid. Fixed by checking the TYPE before the value on
**both** sides (`config.ts` writer and `readSlot`): only a real `number`, or a string matching
`/^[0-9]+$/`, is a count. M3 is the mutation that proves the fix is load-bearing.

### 4.5 Consumer sweep — who READS what I wrote (§0b check 1)

`grep -rn "templateFocusGet\|templateFocusSet\|config/templates" app/src api/src web/ scripts/`:

| Consumer | file:line | Effect of the change |
|---|---|---|
| `templateFocusGet` | `app/src/api.js:302` | unchanged signature; response gains `slots` |
| `templateFocusSet` | `app/src/api.js:312` | 4th arg `slots`, omitted when `undefined` |
| Settings | `Settings.jsx:2032`, `:2053` | reads and writes the six counts |
| **PacketBuilder** | `PacketBuilder.jsx:49` | reads only `r.templates` and then `rows.length` / `value`; `slots` is **additive and inert** here — checked, not assumed |
| `appPackets.ts:1486` | lists the `templates` partition for the seed table | unaffected: it reads row keys, not properties |
| **`swaps.ts:366`** | `const slot = slotsFor(f.merge, input.slots)` | **the intended downstream consumer** |

**Cross-agent contract, verified rather than assumed.** `swaps.ts:194` declares
`slots?: Record<string, number | null>` keyed by MERGE FIELD, and `:216` states *"`null` ⇒ the
caller's check must be `not_applicable`, never `pass` and never `fail`"*. My `SlotCounts` is
`Record<SlotField, number | null>` whose keys are exactly `SkillsBullets1`, `SkillsBullets2`,
`ExpertiseBullets`, `RelevantBullets1..3` — i.e. exactly `f.merge`. `swaps.ts:189` says the store
owns the numbers and *"This file never reads config"*, which is the split this change implements.
Both builds pass with their files present.

---

## 5. HANDOFF — things I found that are NOT mine to fix

### H-1 (BLOCKING THE FEATURE, and it will fail SILENTLY) — nothing passes `slots` into `writeSwaps`

`appPackets.ts:618-621` is the only caller:
```
await writeSwaps(client, art.packet_id, opp.id, {
  call1: built.calls.c1, call3: built.calls.c3, pkg,
  profileText: built.profileText, omitList: built.omitList, loop: 0,
})
```
There is **no `slots:` argument**, so `input.slots` is `undefined`, `slotsFor` returns
`{n: null, source: 'unknown'}` for every list, and every slot check is `not_applicable`. That is the
**correct and safe** default — it accuses nobody — but it means the owner can type six numbers into
Settings and **nothing downstream will ever use them**. The gap is one line plus a loader.

**Extend, don't duplicate — the loader already exists.** `resolveRoleFocus`
(`roleFocus.ts:134-148`) already does `client.getEntity('templates', templateRowKey(tplId))` for
this exact row, using the packet's `resume_template_id`. The slot counts are on the **same entity it
already fetches**. Read them there (or in a small sibling in `roleFocus.ts` that returns the whole
row) and thread the result into the `writeSwaps` call. Do **not** add a second reader of the
`templates` partition — `config.ts` and `roleFocus.ts` are already two, and `pipeline.ts:629`,
`mt12.ts:39`, `mt19.ts:60` are three more.

`config.ts` exports `SLOT_FIELDS`, `SlotField` and `SlotCounts` so the server side can share the
field list rather than re-typing it. Re-listing those six names anywhere is the whitelist-typed-twice
drift `config.ts:4-6` already warns about.

### H-2 — `skill_candidate.list` and `insertion.list` still REJECT `'expertise'`

`schema.ts:549` (`skill_candidate`) and `schema.ts:629` (`insertion`) carry the same five-value
CHECK that `swap_decision` had. My brief scoped me to `swap_decision`, so I widened **only** that
one. This matters concretely: `appSwaps.ts:43` records that `writeSwaps` inserts a `skill_candidate`
row for **every** item and that `swap_decision.from_candidate_id`/`to_candidate_id` reference
`skill_candidate(id)` — so the moment expertise swaps carry candidate ids, `skill_candidate` rejects
the insert **before** `swap_decision` is ever reached, and `appPackets.ts:617-622` swallows it into
a `console.warn`. Verdict: **EXISTS-BUT-CONSTRAINED**, not absent — the ALTER is three lines and the
precedent is now in the file twice. Ready to paste:
```sql
alter table skill_candidate drop constraint if exists skill_candidate_list_check;
alter table skill_candidate add constraint skill_candidate_list_check
  check (list in ('skills_1','skills_2','relevant_1','relevant_2','relevant_3','expertise'));
```
`insertion.list` is nullable and used for item counts; whether it needs the same widening depends on
whether expertise gets an `insertion` row. **Not assumed — flagged.**

### H-3 — the H-cases this change earns (I cannot write them; `hardening.test.mjs` is not mine)

Slugs, never numbers (`H26`). Each is mutation-proved above, so none would ship inert:

| Slug | Invariant | Mutation that proves it |
|---|---|---|
| `H:template-slot-edit-preserves-siblings` | a POST that omits `slots` (or omits a key within it) leaves the stored counts untouched — `'Replace'` makes every unwritten property vanish | M1 |
| `H:slot-count-unset-is-null-never-zero` | an unset or junk slot count reads back `null`; `0` is never returned by `readSlot` and never stored | M2 |
| `H:slot-count-rejects-non-integers` | `0`, negatives, fractions, booleans, arrays and non-decimal strings are **400**, not coerced — `Number(true) === 1` was a live defect | M3 |
| `H:slots-only-template-row-survives` | a template configured only with slot counts is listed as configured and is not deleted by a blank focus | M4 |
| `H:swap-list-check-admits-expertise` | `SCHEMA_SQL` contains an explicit `alter table swap_decision ... add constraint swap_decision_list_check` naming `'expertise'`; a widened inline CHECK alone is a no-op on production | M5 |

`H:swap-list-check-admits-expertise` is best written as the populated-DB execution in §4.2 rather
than a source grep — the grep passes on the mutant if the inline CHECK is widened, which is exactly
the failure mode.

### H-4 — no slot count is SEEDED, deliberately

`SEED_TEMPLATE_ROLE_FOCUS` seeds a focus word; I seed no number. A seeded count is an invented
number, and an invented slot count is an accusation — every item past it becomes illegal. The
no-hardcoded-config rule *permits* a seed; it does not require one where no honest first value
exists. The owner types the real count once per template at **Settings ▸ Quality ▸ Resume
templates**, and until they do, every list is `not_applicable`. **Tell the owner where to set it** —
that is the half of the rule that still applies.

### H-5 — tree state left for the parent

My five files are **staged** (`git checkout <ref> -- <path>` stages what it restores). Nothing is
committed and nothing is pushed, per the brief. The other agent's `swaps.ts`, `appSwaps.ts`,
`appInsertions.ts`, `api/test/swaps.test.mjs` and `docs/qc-evidence/IMPL-swap-pairing.md` are
present and unstaged — untouched by me.

---

## 6. WHAT I DID NOT PROVE (stated plainly)

- **Nothing was verified against the LIVE system.** No `api-test.yml`, no `db-query.yml`, no
  `ui-verify.yml` run — the brief said do not commit or push, and these workflows dispatch from
  `main`, so the code under test is not there. The live-DB `ALTER` therefore has **not** been
  applied to production; it will run with the next `api-deploy` from `main`. Until then production's
  `swap_decision_list_check` still rejects `'expertise'`. **INFERENCE (high confidence, from
  `schema.ts:594-596` and the reproduction in §4.2), not a live observation.**
- **The Settings UI was not rendered.** The sandbox cannot execute the SPA against the live API. The
  app build passes and every control is wired to real state and a real API call (no `toast()` stubs,
  no fake data — the "No dead UI" rule), and `sameSlots` gates the Save button so it enables on a
  slot change. What is **unproven** is how it LOOKS and that a real round-trip persists. The one
  command that would settle it, once this is on `main`:
  `ui-verify.yml` with `route: "#/settings"`, `owner: von.ellis@enterpriseds.io`,
  `expect: "Resume templates;Skills 1;Expertise;Relevant 3"`.
- **The live template's real slot counts are unknown to me** (the owner's "10"). I stored no number;
  I only built the place to put one.

## END OF IMPL PASS
