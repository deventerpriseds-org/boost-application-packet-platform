# AC — Fixed-slot swap pairing (`original` must be the master template, not Call 1)

**Status:** COMPLETE — ends with `## END OF AC PASS`. (Written incrementally; a copy ending without
that marker is truncated and must not be acted on.)
**Nothing was implemented.** This pass is read-only on the repo apart from this file.
**Slug:** `fixed-slot-swap-pairing`
**Tier:** 1 — accusation grade. `swap_decision` rows name what was dropped/added/kept and feed
`changes_cited` / the QC rail. Full process applies.
**Date:** 2026-08-29

---

## 0. Research log (raw observations, appended as found)

### O-1 — the defect line, read at source
`api/src/functions/tests/swaps.ts:222` — `const originals = splitItems(call1[f.passA])`.
`LIST_FIELDS` (`swaps.ts:32-38`) maps `passA` to `skills1 / skills2 / relevant1 / relevant2 /
relevant3`, and the header comment `swaps.ts:6-8` states those are **Call 1 (resume writer)** model
output. So "original" today = the model's first draft, **not** the owner's master text. OBSERVATION.

### O-2 — the master text per merge field ALREADY EXISTS and is already loaded
- `evidence.ts:190-207` `MASTER_BASELINE_FIELD` maps merge field -> MasterContext key:
  `SkillsBullets1:'skills1'`, `SkillsBullets2:'skills2'`, `ExpertiseBullets:'expertise'`,
  `RelevantBullets1/2/3:'relevantProficiencies'` (all three share the pooled block — deliberate,
  documented at `evidence.ts:181-186`).
- `evidence.ts:211-217` `masterBaseline(mc)` — pure, returns only non-empty blocks.
- `appInsertions.ts:25-34` `loadMasterBaseline()` reads the `MasterContext` Azure Storage table
  (`PartitionKey eq 'context'`) and returns `masterBaseline(mc)`.
- `appInsertions.ts:84` — `const prevPkg = loop === 0 ? await loadMasterBaseline() : {}`.
INTERPRETATION: the exact text the fix needs is already produced and already consumed at loop 0 —
by `writeInsertions`, but **not** by `writeSwaps`. This is a plumbing gap, not a missing capability.

### O-3 — `writeSwaps` is never handed the master text
`appSwaps.ts:30-51` `writeSwaps(client, packetId, oppId, {call1, call3, pkg, profileText, omitList,
loop})` — there is no `masterPkg` argument and no `loadMasterBaseline()` call anywhere in the file
(`grep -n masterBaseline api/src/functions/tests/appSwaps.ts` -> no match). OBSERVATION.

### O-4 — `expertise` is NOT one of the swap `LISTS`
`swaps.ts:24` `export type ListKey = 'skills_1' | 'skills_2' | 'relevant_1' | 'relevant_2' |
'relevant_3'` and `swaps.ts:29` `LISTS` holds exactly those five. `ExpertiseBullets` appears in
`MASTER_BASELINE_FIELD` but has **no** `ListKey`, no `LIST_FIELDS` row, and therefore produces no
`swap_decision` rows today. OBSERVATION. INTERPRETATION: the owner's "also relevant and expertise
counts" therefore splits into two different jobs — relevant is a *count limit on an existing list*,
expertise is *a new list in the swap machinery* plus a count limit.

### O-5 — what count limits actually exist today
`checks.ts:146-151` `DEFAULT_THRESHOLDS`: `skillsTotalMin: 20`, `skillsTotalMax: 22`,
`expertiseWords: 5`. `checks.ts:347-353` `skill_list_count` compares **`total`** (skills1 + skills2
combined) against `skillsTotalMin..Max` plus an even-split tolerance, severity **`'warn'`**.
`checks.ts:560-564` `expertise_phrase_length` counts **words per phrase**, not items per list.
OBSERVATION: there is **no per-list item-count limit anywhere** — not for skills_1, not for
skills_2, not for relevant_1..3, not for expertise. The only count-shaped rule is a combined
skills total.

### O-6 — the owner's "24 and 20" are confirmed, by name
`checks.ts:143` `skillMaxChars: 24`, `checks.ts:150` `relevantMaxChars: 20`; columns
`chk_skill_max_chars` / `chk_relevant_max_chars` at `checkPrefs.ts:45` / `:49`. Guarded by
`H:char-limits-match-the-owners-prompt` (`api/test/hardening.test.mjs:3927-3931`), whose comment
records the owner's own words: *"stick to 24/20 to start"*. So "the limits config that has 24 and
20" is unambiguously `owner_search_prefs`'s `chk_*` columns. OBSERVATION.

### O-7 — a new `chk_*` setting is ALREADY end-to-end automatic
The whole settings path is DERIVED, not hand-listed:
- declare once at `checkPrefs.ts:43-82` (`ENSURE_CHECK_COLUMNS_SQL`);
- `checkPrefColumns()` (`checkPrefs.ts:34-40`) parses that same SQL into the writer whitelist;
- `writeCheckPrefs` (`checkPrefs.ts:135-156`) writes only whitelisted, type-coerced columns;
- `appSearchPrefs.ts:59` and `:82` publish `checkColumns` on `GET/POST /api/app/search-prefs`;
- `Settings.jsx:1619` `ChecksSettings` builds its control list from `p.checkColumns` — the file
  comment at `:1577-1580` says so explicitly: *"a knob added later renders here the day it is
  added"*.
Two guards already FORCE this shape for any new threshold:
`H:every-threshold-is-configurable` (`hardening.test.mjs:3901`) fails if a `DEFAULT_THRESHOLDS`
key has no `loadThresholds` mapping, and `H:every-chk-column-is-selected` (`:4049`) fails if a
declared column is never selected. OBSERVATION.
INTERPRETATION: option (b) — a typed owner-settable slot count — costs roughly five lines and
**no new UI at all**. It is not a build, it is a column.

### O-8 — the "master template" is MasterContext, NOT the Google Doc. This constrains option (a).
`diagSkillSources.ts:16-22`, verbatim: *"the resume template contains NO skills text - proven live,
api-test run 32973162995 (HTTP 200): its placeholders are exactly `{{ExpertiseBullets}}
{{RelevantBullets1..3}} {{ResumeSummary}} {{SkillsBullets1}} {{SkillsBullets2}}` and nothing
else."* `evidence.ts:174-176` says the same.
INTERPRETATION: the Google Doc does **not** structurally hold N slots — it holds one token per list
that expands to whatever text is injected. So "the 10 can't be increased to 12" is a constraint on
the RENDERED PAGE's space, not something any code can read off the template. **A slot count must be
a stored number (derived from the MasterContext block, or typed by the owner). It cannot be read
from the template.** This is the single most load-bearing finding for the open question.

### O-9 — the Relevant lists structurally CANNOT derive three counts
`evidence.ts:193-195` maps `RelevantBullets1`, `RelevantBullets2` **and** `RelevantBullets3` all to
the one MasterContext key `relevantProficiencies`, and `evidence.ts:181-186` states this is
deliberate — *"a single pooled block and the packet splits it into three slots"*.
INTERPRETATION: deriving a per-list slot count from the master gives the SAME number (the whole
pool's item count) to all three Relevant lists, which is wrong for every one of them. Pure
derivation is feasible for `SkillsBullets1`, `SkillsBullets2` and `ExpertiseBullets` (1:1 mappings)
and **infeasible for the three Relevant lists** without a product decision about how the pool
splits.

### O-10 — the master read SWALLOWS its errors, so "no master" must not read as "zero slots"
`appInsertions.ts:33` — `} catch { return {} }`, documented at `:19-23` as deliberate ("losing it
must never cost the owner their packet"). So an unreachable Storage table yields `{}`, and a naive
`splitItems(master[field]).length` yields `0`. OBSERVATION.
INTERPRETATION: a derived slot count of 0 would declare every item in the list illegal. The repo's
own standing rule applies — *"Absent evidence is `not_applicable`, never `pass`"* (CLAUDE.md), and
equally never `fail`.

### O-11 — the fixed-slot invariant is ALREADY violated by a deterministic producer
`normalise.ts:100-123` `dedupeAcrossLists` deletes any item that appears in more than one list,
keeping the first. `normalise.ts:236` runs it inside `normalisePackage`, called at
`appPackets.ts:561` — **before** `writeSwaps` at `appPackets.ts:618` — and it mutates the same
`pkg` (`normalise.ts:122`, `pkg[f] = joinItems(kept)`). It removes an item and puts nothing back.
`H:cross-list-drop-tells-the-truth-about-the-document` (`hardening.test.mjs:4194-4240`) is a live
test asserting exactly that shape produces a `dropped` row.
INTERPRETATION: "final count == master slot count" is **not** an invariant the system currently
holds, and a real, shipped, deterministic code path breaks it. Any AC that says "`dropped` is never
produced" would contradict a passing hardening test and a real document behaviour.

### O-12 — `writeSwaps` is wrapped in a SWALLOWING try/catch, so "throw" cannot mean "fail loud"
`appPackets.ts:617-622`:
```
  try {
    await writeSwaps(client, art.packet_id, opp.id, { ... loop: 0 })
  } catch (e) { console.warn('[packets] swap provenance not recorded:', String(e)) }
```
And `checks.ts:906-908`: no swap rows -> `na('changes_cited', 'no swap rows recorded for this
packet', ...)`.
INTERPRETATION: if `buildSwaps` threw on a slot-count violation, the packet would build, the swap
table would be EMPTY, and the gate would show `changes_cited: not_applicable` with no mention of
the violation. Throwing is therefore the *quietest* possible failure here — the opposite of loud.

### O-13 — every downstream consumer of `swap.action` (the full sweep)
`grep -rn "action ===" app/src api/src` + `grep -rn "swap_decision" api/src`, both excluding
`dist/`:

| # | Consumer | file:line | What it does with `added` / `dropped` today |
|---|---|---|---|
| 1 | `omitListCaveat` | `app/src/assetBlocks.js:596` | `action==='dropped' && driver==='rule' && rationale===OMIT_LIST_RATIONALE` -> renders the do-not-use-list explanation. Silent if no `dropped` rows. |
| 2 | `restoreOptions` | `app/src/assetBlocks.js:638-641` | `action==='dropped'`, minus omit-driven and cross-list -> one "Put back X" control per dropped label. **No `dropped` rows => no controls at all.** |
| 3 | `listBodyModel` status pill | `app/src/assetBlocks.js:780-782` | interpolates the raw enum: `` `${swap.action} · ${swap.driver}` ``. A new action value ships as bare machine wording (this exact class already bit the repo — see the comment at `:765-771`). |
| 4 | `listBodyModel.dropped` | `app/src/assetBlocks.js:789` | the "Taken out of this list" block. |
| 5 | `meterModel` | `app/src/assetBlocks.js:888` | `changed = action==='swapped' \|\| 'added'` -> the "posting lines placed" denominator. |
| 6 | `AssetBlocks.jsx` rationales | `app/src/screens/AssetBlocks.jsx:588` | dedupes rationales for every `action !== 'kept'` row. |
| 7 | QC rail table pill | `app/src/screens/QcRail.jsx:351` | `dropped` -> red, `kept` -> panel, everything else -> accent. |
| 8 | Asset gate drawer pill | `app/src/screens/AssetGateDrawer.jsx:296` | identical ternary, second copy. |
| 9 | **`changes_cited` GATE** | `api/src/functions/tests/checks.ts:921-929` | `changes = swapped\|added && driver!=='owner'`; `uncited = driver!=='posting'` -> **`fail`**. Accusation-grade. |
| 10 | **`compactFit.rankOf`** | `api/src/functions/tests/compactFit.ts:110-116` | `action==='dropped'` -> rank 0 (droppable); `swapped\|added` -> rank 1 (protected over plain keeps). **Decides which skills are DELETED from the compact resume.** Accusation-grade. |
| 11 | compact provenance query | `api/src/functions/tests/appPackets.ts:686-693` | selects `action, driver` for `skills_1/skills_2` and feeds #10. |
| 12 | `appChecks` swap load | `api/src/functions/tests/appChecks.ts:43-44`, `:113` | selects `action, driver, to_label, from_label, requirement_id, seq, list` and feeds #9. |
| 13 | `swapsGet` counters | `api/src/functions/tests/appSwaps.ts:124`, `:137` | `changed` and `unattributed` published to the UI. |
| 14 | `buildSwaps.unattributed` | `api/src/functions/tests/swaps.ts:295-296` | must agree with #9 or the packet contradicts itself (its own comment says so). |
| 15 | `H:cross-list-drop-…` | `api/test/hardening.test.mjs:4194-4240` | asserts a `dropped` row with a cross-list rationale IS produced. |

INTERPRETATION: **#10 is the one that changes behaviour silently.** `rankOf` puts `swapped` at rank
1 and plain `kept` at rank 0, and the module's own measured distribution (`compactFit.ts:26-30`)
was `kept+unattributed: 27` rows forming the entire drop pool. Re-pairing against the master turns
many of those keeps into `swapped`, which promotes them to rank 1 and **shrinks the compact
resume's drop pool**. `compactFit.ts:180-190` then has fewer droppable items for the same character
budget, so `overBudgetAfterDrops` becomes reachable where it was not. This is a real, unrequested
side effect of the pairing fix and must be an AC, not a surprise.

### O-14 — `swap_decision` DDL: what a migration would and would not need
`schema.ts:564-588`:
- `list text not null check (list in ('skills_1','skills_2','relevant_1','relevant_2','relevant_3'))`
  — **`expertise` is NOT admitted.** Adding the Expertise list needs an explicit `ALTER`, and
  `schema.ts:594-596` states the reason in the file's own words: *"the inline CHECK above only
  decides what a FRESH database is born with. A create-table-if-not-exists is a no-op on a table
  that already exists, so production keeps the old CHECK until an explicit ALTER runs."*
  The precedent for the ALTER is right there at `schema.ts:600-601` (the `driver` CHECK).
- `action text not null check (action in ('kept','swapped','merged','dropped','added'))` — all five
  remain legal at the DB level. **No migration is required to keep old `added`/`dropped` rows**, and
  removing values from this CHECK would make historical rows unwritable on a rebuild while leaving
  them readable — a mixed state.
- `check ((driver = 'posting') = (verbatim_quote is not null))` — a row's citation contract. A
  `swapped` row minted by positional pairing with no requirement match carries `driver` of
  `unattributed` and no quote, which satisfies this. OBSERVATION.
- `unique (packet_id, list, seq, loop)` — `seq` restarts per list (noted at `compactFit.ts:187-190`
  as defect D-3).

### O-15 — the only caller writes loop 0
`grep -rn writeSwaps api/src` (excluding `dist/`): the sole call site is `appPackets.ts:618` with
`loop: 0`. `appRemediation.ts` does not call it. OBSERVATION: so every swap row in production is a
loop-0 row today, and `writeSwaps`'s `loop===0` branch (`appSwaps.ts:64-66`) deletes the whole
packet's rows before rewriting.

### O-16 — the trackers, reconciled (required before any "absent" claim)
- **`.claude/DEFERRED.md:153` `D:swap-screen-reads-a-dead-pass` — OPEN, and it is THIS defect's
  neighbourhood.** It records three problems, corrected by an earlier independent AC read: (1)
  provenance mislabels Call-2 insertions as `pass_b`; (2) the stored rationales *'reworded by the
  ATS pass'* / *'introduced by the ATS pass'* are false because Call 3 returns 0 characters for all
  five `final*` fields and Call 2 did the work; (3) an unreconciled count — stored `swap_decision`
  for opportunity `9f9c370a` reads kept 8 / swapped 1 / dropped 1 / added 1 while the recorded
  lineage shows Call 2 replaced **4**. Its stated next step: *"Settle the 2-vs-4 count first, then
  extend `buildSwaps`."*
  **INTERPRETATION, and it matters for scope:** the row explicitly says the *after* side is already
  correct (`pkg[f.merge]`) and blames the *before*/provenance side — which is precisely
  `swaps.ts:222`. This work is the fix that row has been waiting for, and its "settle the count
  first" precondition is arguably discharged by the live 9-of-14 measurement in this brief. It is
  **not** a separate parallel effort, and the "Extend, don't duplicate" rule says this should update
  `D:swap-screen-reads-a-dead-pass` rather than open a new row.
- `.claude/DEFERRED.md:158` `D:call3-compares-against-an-empty-list` — CLOSED. Confirms the 24/20
  numbers come from the live `ats_user` prompt.
- No row anywhere in `.claude/actions.md`, `.claude/DEFERRED.md` or `.claude/memory.md` matches
  `fixed.slot|slot count|per-list count|items per list` (grep run, 0 hits outside this file). So
  the fixed-slot constraint is **new owner input**, with no prior decision to reconcile against.

### O-17 — the 11-vs-10 question is NOT answerable from this sandbox
`skills1` lives in the `MasterContext` **Azure Storage table**, which no Postgres connector reaches
(CLAUDE.md states this) and which the sandbox egress blocks. The one route that returns it verbatim
is `GET /api/diag/skill-sources` (`diagSkillSources.ts:82-98`), which returns
`fields.skills1.text` unmodified (`:74-76`, "Verbatim").
**The single command that settles it:** `api-test.yml` with
`{"method":"GET","path":"/api/diag/skill-sources"}`, then count
`splitItems(fields.skills1.text).length` and `fields.skills2.text` the same way.
**What I CAN establish without it, from source:** `skill_list_count` (`checks.ts:344-353`) compares
only `n1 + n2` against `skillsTotalMin..Max` (20..22) plus a split tolerance of 1, at severity
**`'warn'`**. A master of 11+11 = 22 passes; a packet of 10+10 = 20 also passes. **There is no
per-list rule for a template-11/packet-10 gap to violate today** — so it is not a "silent
violation" of an existing rule, it is a case no existing rule covers. Labelled INFERENCE where it
concerns the actual live counts, because I have not read `skills1`.

---

## 1. FEASIBILITY TABLE

Every "Proof" below is a command I actually ran in this sandbox, or a file:line I read. Nothing here
is inferred from a comment alone. Where a claim needs the live system, the row says so and names the
command instead of guessing.

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (command + result) | Verdict |
|---|---|---|---|---|
| **Master template text per merge field** | Owner, in the `MasterContext` Azure Storage table (`PartitionKey eq 'context'`), keys `skills1`, `skills2`, `expertise`, `relevantProficiencies` | `masterBaseline()` `evidence.ts:211-217`; `loadMasterBaseline()` `appInsertions.ts:25-34`; **consumed** at `appInsertions.ts:84` as loop-0 `prevPkg`; also `readSkillFields()` `diagSkillSources.ts:52-80` | `grep -rn masterBaseline api/src` -> 4 src hits + `api/test/insertions.test.mjs:149,161,165,183` (a real unit test exercises it) | **ALREADY BUILT** |
| **Master text reaching `buildSwaps`** | nothing | nothing | `grep -n "masterBaseline\|master" api/src/functions/tests/appSwaps.ts` -> **0 hits**; `writeSwaps` signature `appSwaps.ts:30-32` takes `{call1, call3, pkg, profileText, omitList, loop}` — no master argument | **ABSENT** (swept both the producer file and every `writeSwaps` caller — `appPackets.ts:618` is the only one) |
| **`call1[f.passA]` as "original"** | Call 1, the resume writer (`swaps.ts:6-8`); fields `skills1/skills2/relevant1..3` (`swaps.ts:32-38`) | `swaps.ts:222` `const originals = splitItems(call1[f.passA])` — the ONLY producer of `from_label`, `candidates[].origin='pass_a'`, and every `kept`/`swapped`/`dropped` pairing | read `swaps.ts:220-289` in full | **EXISTS — and is the defect** |
| **The final side of the pairing** | `assemblePackage` -> `pkg[f.merge]`, `call3[f.passB]` fallback | `swaps.ts:223` | read; matches `DEFERRED.md:153`'s correction that the after side is already right | **EXISTS, correct, do not touch** |
| **Limits config holding 24 / 20** | `writeCheckPrefs` `checkPrefs.ts:135-156`, via `POST /api/app/search-prefs` `appSearchPrefs.ts:79`, from `ChecksSettings` `Settings.jsx:1640-1648` | `loadThresholds` `checkPrefs.ts:158-199` -> `runChecks` `checks.ts:308` | `checks.ts:143` `skillMaxChars: 24`; `checks.ts:150` `relevantMaxChars: 20`; columns `checkPrefs.ts:45,49`; guard `hardening.test.mjs:3927` | **EXISTS** |
| **Adding a NEW `chk_*` column (i.e. a typed slot count)** | one line in `ENSURE_CHECK_COLUMNS_SQL` `checkPrefs.ts:43-82` | writer whitelist auto-derives (`checkPrefColumns()` `:34-40`); UI auto-renders (`Settings.jsx:1619` reads `p.checkColumns`, published `appSearchPrefs.ts:59`) | read all four files; `Settings.jsx:1577-1580` states the property explicitly; guards `hardening.test.mjs:3901` + `:4049` FORCE the column+select for any new threshold | **EXISTS** — ~5 lines, zero new UI |
| **`skill_list_count` per-list count rule** | — | `checks.ts:344-353`: compares `n1+n2` only, severity `'warn'` | read `checks.ts:344-353`; `checks.ts:146-147` `skillsTotalMin:20 / Max:22` | **EXISTS-BUT-CONSTRAINED** — total-only, warn-only, no per-list count exists |
| **Live master item count (the 11-vs-10 claim)** | owner's `MasterContext.skills1` | `masterBaseline`, `readSkillFields` | **NOT ESTABLISHED FROM HERE.** Storage table, sandbox egress blocked, no Postgres connector reaches it (CLAUDE.md). Settled by `api-test.yml {"method":"GET","path":"/api/diag/skill-sources"}` then counting `splitItems(fields.skills1.text)` | **EXISTS-BUT-CONSTRAINED** (reachable only via the Function) |
| **Relevant list per-list count limit** | — | — | `grep -n "RELEVANT_FIELDS" checks.ts` -> `:299`, `:332`, `:375`; the only relevant rule is `relevant_char_limit` (chars + a 1-item over-limit allowance, `checks.ts:356-372`) | **ABSENT** (swept the whole `runChecks` body and both `chk_relevant_*` columns) |
| **Expertise list per-list count limit** | — | — | `checks.ts:560-564` `expertise_phrase_length` = **words per phrase**; `chk_expertise_words` `checkPrefs.ts:51` | **ABSENT** (same sweep) |
| **Expertise in the swap machinery at all** | — | — | `swaps.ts:24` `ListKey` has 5 values; `swaps.ts:29` `LISTS`; `schema.ts:567` `check (list in ('skills_1',…,'relevant_3'))` — `expertise` rejected by the DB | **ABSENT** — needs `ListKey` + `LIST_FIELDS` + a schema `ALTER` |
| **`swap_decision.action` accepting `added`/`dropped`** | `writeSwaps` `appSwaps.ts:82-92` | 15 consumers, table at **O-13** | `schema.ts:569` `check (action in ('kept','swapped','merged','dropped','added'))` | **EXISTS** — historical rows are safe; no migration needed to KEEP them |
| **`swap_decision.list` accepting `expertise`** | — | — | `schema.ts:567`; and `schema.ts:594-596` states a `create table if not exists` is a no-op so production keeps the old CHECK until an explicit `ALTER` runs (precedent: `schema.ts:600-601`) | **EXISTS-BUT-CONSTRAINED** — one `ALTER`, pattern already in the file |
| **A place to report a slot-count violation on the gate** | `runChecks` `checks.ts:307` | `gateFor` `checks.ts:943-958`; `appChecks.ts:113` | read; `bad(...)`/`ok(...)`/`na(...)` helpers already carry `offenders` lists and a `'warn'`/`'fail'` severity | **EXISTS** — extend `runChecks`, do not build a parallel reporter |
| **The invariant "final count == master count" holding today** | `dedupeAcrossLists` `normalise.ts:100-123` removes items and replaces nothing; runs `appPackets.ts:561`, before `writeSwaps` `:618`, on the same `pkg` | `H:cross-list-drop-tells-the-truth-about-the-document` `hardening.test.mjs:4194-4240` asserts the resulting `dropped` row | read both | **ABSENT** — a live deterministic path breaks it |
| **`compactFit` behaviour under re-pairing** | `appPackets.ts:686-693` feeds `action`/`driver` | `rankOf` `compactFit.ts:110-116`: `dropped`->0, `posting\|requirementId`->2, `swapped\|added`->1, else 0 | read; measured distribution in its own header `compactFit.ts:24-30` (`kept+unattributed: 27` = the whole drop pool) | **EXISTS-BUT-CONSTRAINED** — the fix silently changes which skills get deleted |
| **A throw as "fail loud"** | — | `appPackets.ts:617-622` swallows into `console.warn`; `checks.ts:906-908` then reports `changes_cited: not_applicable` | read both | **ABSENT** — throwing is the QUIETEST outcome available, not the loudest |
| **Prior owner decision on fixed slots** | — | — | `grep -rniE "fixed.slot\|slot count\|per-list count\|items per list" .claude/` -> 0 hits outside this file | **ABSENT** — new owner input, nothing to reconcile |
| **The open ledger row this belongs to** | — | — | `.claude/DEFERRED.md:153` `D:swap-screen-reads-a-dead-pass`, OPEN, explicitly *"then extend `buildSwaps`"* | **EXISTS** — extend that row, do not open a parallel one |

### 1a. RESOLVING THE ONE OPEN QUESTION — derived count vs typed setting

**OBSERVATION (what the code and data can support today):**

1. **Derivation is free where the mapping is 1:1.** The fix must load the master text anyway to do
   the pairing, and `splitItems` (`swaps.ts:45-51`) already mirrors the pipeline's separators
   exactly. `splitItems(master['SkillsBullets1']).length` costs one expression. True for
   `SkillsBullets1`, `SkillsBullets2` and `ExpertiseBullets`.
2. **Derivation is structurally impossible for the three Relevant lists.** `evidence.ts:193-195`
   maps all three to one pooled key; `evidence.ts:181-186` says this is deliberate. One pool count
   cannot be three slot counts without a rule for how the pool splits — and that rule is a product
   decision, not something in the data.
3. **A typed setting is already fully built.** Per **O-7**, a new `chk_*` column self-publishes to
   the API and self-renders in Settings, and two existing hardening guards make that the *required*
   shape for any new number in `DEFAULT_THRESHOLDS`.
4. **A static seed cannot track the master.** `syncCheckPrefDefaults` (`checkPrefs.ts:101-108`)
   changes only the column DEFAULT and `checkPrefs.ts:96-99` states existing rows are never touched
   — *"a stored value is the owner's"*. So a hand-typed number goes stale silently the day the owner
   edits their master, and a stale number on an accusation-grade check names innocent items.
5. **Derivation can be absent.** `appInsertions.ts:33` returns `{}` on any Storage failure (**O-10**),
   so derivation must be able to say "unknown".
6. **`MasterContext` is a single global partition**, flagged as a known data-separation defect at
   `diagSkillSources.ts:23-25`. So a derived count is not per-owner today; a `chk_*` column is
   (`owner_search_prefs.owner_email`).

**INTERPRETATION / RECOMMENDATION (clearly separated, per the ground-truth rule):**

They coexist, and the composition that survives all six observations is **setting-wins, master as
the fallback, unknown as a first-class third state** — not "derive as the default, setting as an
override", because the seed mechanism cannot follow a changing master (obs. 4):

```
slotsFor(field) =
  ownerSetting > 0            -> { n: ownerSetting, source: 'setting' }
  master[field] is non-empty  -> { n: splitItems(master[field]).length, source: 'master' }
  otherwise                   -> { n: null, source: 'unknown' }   // never 0
```

- `n: null` => the slot check is `not_applicable`, never `fail`. Absent evidence is not an
  accusation (CLAUDE.md standing rule).
- Skills and Expertise get a usable master fallback for free.
- The three Relevant lists have **no honest master fallback** and would sit at
  `source: 'setting'`-or-`unknown`. That is the truthful state and it should be visible, not papered
  over by dividing the pool by three — a fabricated composite is exactly what the repo forbids.
- Cost of the setting half: 3 columns (`chk_skills_slots_1`, `chk_skills_slots_2`,
  `chk_expertise_slots`) or 6 (adding `chk_relevant_slots_1..3`), each ~1 line in the ensure SQL,
  1 in `CheckThresholds`, 1 in `DEFAULT_THRESHOLDS`, 1 in the `loadThresholds` select, 1 in its
  mapping, plus a `CHK_LABELS` entry for the copy. No route change, no UI change.
- Cost of the derivation half: it is already paid — the same `master` object the pairing fix must
  load.

**The one thing I am NOT deciding, and the owner must:** whether the three Relevant lists get three
typed settings, or whether the pooled `relevantProficiencies` block should be split per-slot in
`MASTER_BASELINE_FIELD` (a change with its own blast radius through `Show original`). A default is
available and reversible: ship three typed settings now, leave the mapping alone.

---

## 2. ACCEPTANCE CRITERIA

### 2a. The decision the ACs encode, stated before they are read

The owner said *"only swaps are allowed not adds or drops"*. That sentence has two possible
readings and they produce opposite systems:

- **Reading A — "the code must never EMIT `added`/`dropped`."** To honour it the pairing would have
  to force every leftover into a swap pair (fabrication) or drop the row (hiding). It also
  contradicts a real, deterministic producer: `dedupeAcrossLists` removes an item and replaces
  nothing (**O-11**), and `H:cross-list-drop-tells-the-truth-about-the-document` is a passing test
  asserting the resulting `dropped` row exists.
- **Reading B — "the shipped DOCUMENT must never gain or lose a slot; an `added` or `dropped` row
  is therefore a REPORTED VIOLATION, not a normal outcome."**

**The ACs below encode Reading B**, on three grounds, and the owner should reject this if it is not
what they meant:
1. The owner is on record: *"i am 100% against hiding issues or patching to hide warnings instead of
   fixing"*. Reading A can only be implemented by hiding or fabricating.
2. Reading A would require deleting `added`/`dropped` from a DB CHECK that historical rows already
   satisfy (`schema.ts:569`), and from 15 live consumers (**O-13**).
3. Reading B makes the constraint *enforceable and visible*: an `added`/`dropped` row becomes the
   evidence that a fixed slot was broken, surfaced on the gate the owner already reads.

**Scope note (from `checks.ts:294-295`):** the fixed-slot invariant applies to `resume`. The
`compact_resume` deliberately DROPS skills to fit a character budget (`fitCompactSkills`,
`compactFit.ts:180-200`), so it is explicitly out of scope and must be excluded, not silently
"passed".

---

### AC-1 — the "original" is the master template text, not Call 1
Given a package whose MasterContext `skills1` block contains items the Call-1 draft does not
contain, when `buildSwaps` runs, then every `from_label` it emits for `skills_1` appears verbatim
(after `normItem` normalisation) in `splitItems(master['SkillsBullets1'])`, and **no** `from_label`
originates from `call1.skills1` alone.

### AC-2 — `writeSwaps` is handed the master text, from the existing loader
Given `writeSwaps` is called, when it builds its input, then it obtains the master text by calling
the **existing** `loadMasterBaseline()` / `masterBaseline()` path (`appInsertions.ts:25-34`,
`evidence.ts:211`) — not a second MasterContext reader — and passes it to `buildSwaps` as a named
input. (Extend, don't duplicate: a second copy of "which MasterContext key backs which merge field"
is the drift `evidence.ts:167-170` already warns about.)

### AC-3 — set membership first: a label in BOTH master and final is `kept`
Given master `['A','B','C']` and final `['C','A','D']`, when `buildSwaps` runs, then `A` and `C`
each produce exactly one `kept` row, and neither appears in any `swapped`, `added` or `dropped`
row. Order must not matter: the same input in any permutation yields the same two `kept` rows.

### AC-4 — leftovers pair POSITIONALLY, in relative order
Given master `['A','B','C','D']` and final `['A','X','Y','Z']`, when `buildSwaps` runs, then it
emits `kept A`, and three `swapped` rows pairing the leftovers by relative position:
`B->X`, `C->Y`, `D->Z` — not by similarity, and not `B->Z`. Positional pairing is applied to the
leftover sequences only, each in its original list order, after set matching has removed the
common members.

### AC-5 — positional pairing does NOT fabricate a citation
Given a `swapped` row minted by positional pairing whose final label scores below
`ATTRIBUTION_THRESHOLD` (0.34, `swaps.ts:128`) against every requirement, when the row is written,
then `driver='unattributed'`, `verbatim_quote IS NULL`, `requirement_seq IS NULL` and
`confidence=0` — satisfying the DB contract `check ((driver = 'posting') = (verbatim_quote is not
null))` (`schema.ts:587`). A positional pair is an observation about position, never a claim that
the employer asked for it.

### AC-6 — the owner-edit exemption survives
Given a final label present in `ownerLabels` (`appSwaps.ts:45-49`), when the row is emitted by the
new pairing, then `driver='owner'` and it is excluded from `unattributed` — i.e. `swaps.ts:323` is
still reached before attribution. (Decision B; its comment at `swaps.ts:311-322` records that the
exemption once had nothing to exempt.)

### AC-7 — the fixed-slot invariant, when the slot count is KNOWN
Given a list whose slot count resolves to `n` (per §1a: setting, else master, else unknown), when
the final list contains exactly `n` items, then `buildSwaps` emits exactly `n` rows for that list,
every one of them `kept` or `swapped`, and zero `added`, `dropped` or `merged` rows.

### AC-8 — the slot count is resolved by the documented precedence, and `unknown` is a real state
Given the three cases, when `slotsFor(field)` is called, then:
(a) an owner `chk_*` slot setting `> 0` returns `{n: setting, source:'setting'}`;
(b) no setting but a non-empty master block returns
`{n: splitItems(master[field]).length, source:'master'}`;
(c) neither returns `{n: null, source:'unknown'}` — **never `{n: 0}`**.
A MasterContext read failure (`appInsertions.ts:33` returns `{}`) must land in (c), not (b).

### AC-9 — a violation is REPORTED, never thrown, clamped or hidden
Given a final list whose item count differs from a KNOWN slot count `n` — the real case being a
cross-list dedupe (**O-11**) — when the packet is built, then all three hold:
(a) `buildSwaps` **does not throw** (a throw is swallowed at `appPackets.ts:619` and the packet
ships with an EMPTY swap table and `changes_cited: not_applicable` — the quietest possible
outcome, **O-12**);
(b) the honest rows are still emitted — the unpaired master leftover is `dropped` with its existing
truthful rationale, the unpaired final leftover is `added`;
(c) a **new deterministic check** in `runChecks` (`checks.ts`) reports it: `state:'fail'`,
`engine:'deterministic'`, naming the list, the expected `n`, the observed count, and the offending
labels — so `gateFor` (`checks.ts:954`) turns the packet's gate `fail`.
Nothing is clamped and nothing is padded. Fabricating a pair to satisfy the count would be the
"never fabricate a composite" failure in its purest form.

### AC-10 — the violation check is `not_applicable` when the slot count is unknown
Given `slotsFor` returns `{n: null}` for a list, when `runChecks` runs, then the slot check emits
`not_applicable` for that list with a reason naming *why* it is unknown (no setting and no master
block), and it never emits `pass` and never emits `fail`. (Standing rule: *"Absent evidence is
`not_applicable`, never `pass`"* — and equally never an accusation.)

### AC-11 — `compact_resume` is excluded explicitly, not accidentally
Given `input.type === 'compact_resume'`, when the slot check runs, then it emits `not_applicable`
with a reason naming the character-budget fit (`fitCompactSkills`), rather than being silently
absent from the results array. (`checks.ts:311-325` records the exact failure of a check silently
never being emitted: six checks vanished and `gateFor` could not see them.)

### AC-12 — existing `added`/`dropped` rows in the database keep working (back-compat)
Given `swap_decision` rows already stored with `action='added'` or `'dropped'` (legal per
`schema.ts:569`), when the app reads them after this change, then:
(a) no migration is required and none is run against `action`;
(b) `restoreOptions` (`assetBlocks.js:638`), `omitListCaveat` (`:596`), `listBodyModel.dropped`
(`:789`), and both pill ternaries (`QcRail.jsx:351`, `AssetGateDrawer.jsx:296`) render exactly as
they do today;
(c) `changes_cited` (`checks.ts:921`) counts them exactly as it does today.

### AC-13 — the compact-resume drop pool change is measured, not discovered later
Given the same packet before and after this change, when `fitCompactSkills` runs on both, then the
set of skills it deletes is recorded for both and any difference is stated with its cause.
Specifically: `rankOf` (`compactFit.ts:110-116`) ranks `swapped` at 1 and plain `kept` at 0, so
converting keeps into swaps SHRINKS the droppable pool
(`compactFit.ts:183` `.filter((x) => x.rank < 2)`) and makes `overBudgetAfterDrops` reachable where
it was not. This AC is met by a recorded before/after comparison, not by an assertion that nothing
changed.

### AC-14 — Relevant and Expertise are in scope, and Expertise needs its list to exist
Given the owner's *"also relevant and expertise counts"*, when the work is complete, then:
(a) `relevant_1`, `relevant_2`, `relevant_3` are covered by AC-7..AC-10 using the same
`slotsFor` precedence;
(b) **Expertise** either (i) gains `ListKey 'expertise'`, a `LIST_FIELDS` row
(`passA/passB/merge: 'ExpertiseBullets'`), AND an explicit
`alter table swap_decision drop constraint if exists swap_decision_list_check; alter table ...
add constraint ...` following the precedent at `schema.ts:600-601` — because
`create table if not exists` is a no-op on production (`schema.ts:594-596`) and the current CHECK
(`schema.ts:567`) REJECTS the row; or (ii) is covered by the slot check alone (which reads `pkg`,
not `swap_decision`) with its absence from the swap table stated explicitly. **(i) vs (ii) is an
owner/scope decision, not something to assume** — (ii) is the smaller, reversible option.

### AC-15 — the regression guard: the live 9-of-14 case flips
Given the live packet measured on 2026-08-29 (14 swap rows, 9 naming an "original" absent from the
master; true sets kept 2 / dropped 9 / added 8 versus recorded 5 / 4 / 4), when it is rebuilt after
this change, then **0** of its `from_label` values are absent from the master template blocks, and
the recorded kept/swapped/dropped/added counts reconcile with a direct set comparison of master
versus final. Verified live, via `api-test.yml` (rebuild) + `db-query.yml` (read
`swap_decision.from_label`) + `api-test.yml GET /api/diag/skill-sources` (the master text) — the
three transports CLAUDE.md already names.

### AC-16 — the H-cases this earns (SLUGS, never numbers — `H26` fails a numeric ID)
Given the change lands, when `api/test/hardening.test.mjs` runs, then these exist and each is
mutation-proved (revert the behaviour, confirm the suite FAILS, restore):

| Slug | Invariant it asserts |
|---|---|
| `H:swap-original-is-master-not-call1` | No `from_label` may originate from `call1[passA]` when a master block exists for that merge field. Asserts the invariant, not the incident: fixture where call1 and master differ on every item. |
| `H:swap-pairs-by-set-then-position` | Set members pair as `kept` regardless of order; leftovers pair by relative position, not by `similarity()`. Fixture must include a case where similarity and position disagree, or the assertion is vacuous. |
| `H:fixed-slot-violation-is-reported-not-thrown` | `buildSwaps` never throws on a count mismatch (because `appPackets.ts:619` swallows it), AND a deterministic `fail` check row is produced. Both halves, or the guard passes on the hidden failure. |
| `H:slot-count-unknown-is-not-applicable` | `{n: null}` and an empty `master` (`{}`, the Storage-failure shape) both yield `not_applicable`, never `pass` and never `fail`, and never a slot count of 0. |
| `H:slot-check-is-emitted-for-every-list` | The slot check appears in the `runChecks` output for every in-scope list including `compact_resume` (as `not_applicable`) — the `checks.ts:311-325` failure mode where a check silently stops being emitted and `gateFor` cannot see it. |
| `H:swap-actions-stay-readable` | The `action` CHECK at `schema.ts:569` still admits all five values, and no consumer in **O-13** was left keyed on a value the writer no longer produces. Source-grep guard (structural, per H-rule 4). |

---

## 3. WHAT WOULD FALSIFY EACH AC

One cheapest observation per AC. Each is a single command or a single read — if it comes back the
way the "Falsified when" column describes, the AC is NOT met, regardless of what any summary says.

| AC | Cheapest falsifying observation |
|---|---|
| **AC-1** | `grep -n "call1\[f.passA\]" api/src/functions/tests/swaps.ts` still returns a hit on the `originals` assignment. One line, one command. |
| **AC-2** | `grep -n "MasterContext\|listEntities" api/src/functions/tests/appSwaps.ts` returns a hit — a second reader was written instead of reusing `loadMasterBaseline`. |
| **AC-3** | Run `buildSwaps` with master `['A','B','C']`, final `['C','A','D']`; falsified if `A` or `C` appears in any row whose `action !== 'kept'`, or if reversing the final array changes the `kept` set. |
| **AC-4** | Run master `['A','B','C','D']` / final `['A','X','Y','Z']`; falsified if any pair is not `B->X, C->Y, D->Z` — in particular if `similarity()` reordered them. |
| **AC-5** | Query one positionally-paired row: falsified if `verbatim_quote IS NOT NULL` while `driver <> 'posting'`, or if the DB rejects the INSERT on `swap_decision`'s paired CHECK. |
| **AC-6** | Run `buildSwaps` with `ownerLabels: ['X']` and `X` as a final leftover; falsified if the row's `driver !== 'owner'` or if it appears in `unattributed`. |
| **AC-7** | Run with master and final both of length `n` differing in `k` items; falsified if `out.swaps.filter(s => s.list === L).length !== n`, or if any row's action is `added`, `dropped` or `merged`. |
| **AC-8** | Call `slotsFor` with `master = {}` (the exact Storage-failure shape from `appInsertions.ts:33`); falsified if it returns `n: 0` rather than `n: null`. |
| **AC-9** | Reproduce the cross-list dedupe fixture from `hardening.test.mjs:4209-4212`; falsified if `buildSwaps` throws, **or** if `runChecks` on that package emits no `fail` row for the slot check, **or** if a pair was fabricated to make the counts match. |
| **AC-10** | `runChecks` on a package with no slot setting and no master block; falsified if the slot check's state is `pass` or `fail` rather than `not_applicable`. |
| **AC-11** | `runChecks({type:'compact_resume', ...})`; falsified if the slot check is **absent from the results array** (not merely if it is `not_applicable`) — absence is the `checks.ts:311-325` failure. |
| **AC-12** | `db-query.yml`: `select action, count(*) from swap_decision group by action`; falsified if any pre-existing `added`/`dropped` row fails to read back, or if `ui-verify.yml` on the QC rail no longer renders a `dropped` pill for a packet that had one. |
| **AC-13** | Run `fitCompactSkills` on one real packet's provenance before and after; falsified if no before/after record exists (the AC is about having measured it), or if a skill that was kept is now deleted with no stated cause. |
| **AC-14** | `psql`-execute the schema on a database that already has `swap_decision` (per CLAUDE.md's populated-DB rule), then `insert ... list='expertise'`; falsified if it is rejected — i.e. the `ALTER` was never written and `create table if not exists` was relied on. |
| **AC-15** | `db-query.yml` after a rebuild: `select from_label from swap_decision where packet_id=...`; falsified if ANY value is absent from the master blocks returned by `GET /api/diag/skill-sources`. This is the single measurement that proves or disproves the whole change. |
| **AC-16** | For each slug: revert the production line it guards, run `node --test api/test/hardening.test.mjs`; falsified if the suite still passes. A guard that passes with its defect reinstated is worse than no guard. Note honestly where a mutation is behaviourally equivalent and correctly fails to fail. |

---

## 4. NOTES FOR THE IMPLEMENTER (not ACs)

- **Ledger:** update `.claude/DEFERRED.md:153` `D:swap-screen-reads-a-dead-pass` rather than opening
  a new row. That row's stated precondition — *"settle the 2-vs-4 count first"* — is plausibly
  discharged by the 9-of-14 live measurement, but say so explicitly rather than assuming it.
- **Two false rationales are in scope for free:** `swaps.ts:253` writes *'reworded by the ATS
  pass'* and `:287` *'introduced by the ATS pass'* on every swap/add. `DEFERRED.md:153` records
  those as **false statements** — Call 3 returns 0 characters for all five `final*` fields and
  Call 2 did the work. Once "original" means the master, the correct sentence changes anyway.
- **Do not touch the after side.** `swaps.ts:223` `pkg[f.merge] ?? call3[f.passB]` is already
  correct and `DEFERRED.md:153` says so in its own correction.
- **Tier 1 process applies:** independent `verifier` immediately (not batched to a phase boundary),
  mutation-proof every new guard, live verification via `api-test.yml` / `db-query.yml` /
  `ui-verify.yml`.

## END OF AC PASS
