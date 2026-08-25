# AC — #30 "an owner can edit a swapped value in place" (adversarial, independent)

**Written:** 2026-08-25 · by an independent AC-writing subagent that did **not** plan this work.
**Analysis only** — nothing under `app/src` or `api/src` was modified, nothing was committed.

**Ground truth:** every claim below is checked against `origin/main`, per `CLAUDE.md`
("Fetch-first before ANSWERING a status question… Answer from `origin/main`").

```
git fetch origin
git rev-parse HEAD         # fb885cfea39de6bebe1f093f0070b131110e5d71
git rev-parse origin/main  # fb885cfea39de6bebe1f093f0070b131110e5d71   -> identical, no drift
```

> **The prior pass is 3 commits stale.** `docs/qc-evidence/AC-resume-margin.md` GAP 3 was written at
> `b319943`. `main` has since moved to `fb885cf` (`f50a422` hover linkage, `89eb970` feasibility
> rule, `fb885cf` blank-asset fix). **I re-verified GAP 3's findings rather than inheriting them.**
> Result: GAP 3's two blocking findings still hold at `fb885cf` (proofs in the table below), and the
> owner's decision resolves its Q3.2. Its Q3.1, Q3.3, Q3.4 and Q3.5 are **still open** and are
> re-raised here with answers where the code settles them.

**The owner's decision is taken as given and is NOT re-opened:** the override extends the existing
`correction` table. My job is to specify that correctly and to find what breaks. **What follows
includes one finding that the owner must see before that decision is implemented** (Hard Question 1)
— reporting it is not re-opening the decision, it is the evidence the decision was made without.

---

## 1. FEASIBILITY TABLE (challenged) — read before writing any code

Required first by `CLAUDE.md` §"Feasibility BEFORE implementation" (line 632). Verdicts are
`EXISTS` / `ABSENT` / `EXISTS-BUT-CONSTRAINED`.

| # | Dependency | Brief's claim | My verdict | Proof (command + result) |
|---|---|---|---|---|
| F1 | `correction` has the right shape | EXISTS — `merge_field`, `phrase`, `replacement`, `char_start/end`, `before_sha256`, `applied_seq`, `reason`, `source`, `reverted_by/at` | **EXISTS — claim CONFIRMED, line refs exact** | `git show origin/main:api/src/functions/tests/schema.ts` → `create table if not exists correction (` at **:403**; `artifact_id` :405, `merge_field` :406, `phrase` :407, `replacement` :408, `char_start` :409, `char_end` :410, `before_sha256` :411, `applied_seq` :412, `reason` :413, `source` :414, `run_id` :415, `loop` :416, `reverted_by` :417, `reverted_at` :418. Brief said "403-425"; the table body actually runs **403-428**. Cosmetic. |
| F2 | `correction` survives a rebuild | EXISTS — zero `delete from correction` | **EXISTS-BUT-CONSTRAINED — the claim is true but its PROOF is insufficient, and one path can still destroy the row** | `grep -rn "delete from correction" api/src` → **exit 2, zero hits** (confirmed). **BUT** `schema.ts:405` is `artifact_id uuid not null references artifact(id) **on delete cascade**` — a correction dies with its artifact without any `delete from correction` ever being written. See F2a. |
| F2a | …so: is an `artifact` row ever deleted or replaced on rebuild? | (not in the brief) | **EXISTS — safe today, for a reason the brief did not state** | `grep -rn "delete from artifact" api/src` → **zero hits**. `insert into artifact` occurs at exactly one place, `appPackets.ts:82`, inside `loadPacket`, guarded by `const missing = ARTIFACT_TYPES.filter(t => !existing.includes(t))` (`:79-81`) — it inserts only artifact **types that do not yet exist**. Remediation does **not** create a new packet: `appRemediation.ts:488` is `update packet set round = round + 1 … where id = $1`. `insert into packet` exists only at `appPackets.ts:77`, guarded by `if (!pkt)`. **Conclusion: artifact ids are stable across rebuilds and remediation rounds, so the cascade never fires.** This is the real reason `correction` is durable — not the absence of a DELETE statement. It is a load-bearing invariant and it needs a guard (see `H:artifact-id-stable-across-rebuild`). |
| F3 | `correction.source` accepts an owner value | **CONSTRAINED** — `check (source in ('profile_figure','generalized'))` | **EXISTS-BUT-CONSTRAINED — claim CONFIRMED, and it is worse than one CHECK** | `schema.ts:414`: `source text not null check (source in ('profile_figure','generalized'))`. **The CHECK is only the first of three places** the two-value domain is written down: `correction.ts:32` `export type CorrectionSource = 'profile_figure' \| 'generalized'` — a **TypeScript union**, so a third value fails `tsc`, not just Postgres. A third home is named in F3a. **Altering the CHECK alone is insufficient and would not compile.** |
| F4 | the span constraint | CONSTRAINED — `correction_span_matches_phrase check (char_end - char_start = length(phrase))` | **EXISTS-BUT-CONSTRAINED — claim CONFIRMED, and it is one of FOUR constraints, all of which an override must satisfy** | `schema.ts:422` `correction_span_matches_phrase check (char_end - char_start = length(phrase))`; **:423** `correction_span_ordered check (char_start >= 0 and char_end > char_start)` — note `char_end > char_start` means **an empty `phrase` is rejected by the DATABASE**; **:424** `correction_sha_shaped check (before_sha256 ~ '^[0-9a-f]{64}$')` — a real 64-hex SHA of real text is mandatory; **:427** `correction_revert_paired check ((reverted_by is null) = (reverted_at is null))`. Plus the unique index `correction_unique_seq` (`:430-431`) on `(artifact_id, merge_field, applied_seq, coalesce(run_id, '000…'::uuid))` with the `coalesce` explicitly documented as load-bearing. |

### Nothing in the table is wrong. Two rows are **understated**, and that matters

- **F2's evidence proves the wrong thing.** "Zero `delete from correction`" is true and is *not* why
  the row survives. The row survives because `artifact.id` is stable (F2a). A future change that
  recreates artifacts on regenerate — entirely plausible, and nothing in the schema forbids it —
  silently cascade-deletes every owner override with no `delete from correction` anywhere in the
  diff. **A guard must pin F2a, not F2.**
- **F3 understates the blast radius by two-thirds** (TS union + F3a below).

### F3a — the source domain has **FIVE** homes, not one. Altering the CHECK is ~20% of the job

`grep -rn "profile_figure\|'generalized'" api/src app/src api/test` (exit 0, hits below):

| # | Home | Line | What breaks if only `schema.ts:414` is altered |
|---|---|---|---|
| 1 | `api/src/functions/tests/schema.ts:414` | the migration CHECK | — (this is the one the brief found) |
| 2 | **`api/src/functions/tests/appCorrections.ts:66`** | **a SECOND, byte-duplicated `create table if not exists correction (…)` inside `ensureCorrectionTable`**, carrying its own copy of all four constraints (`:74-77`) | **THE WORST ONE. See F3b — this can permanently lock a database out of the new value.** |
| 3 | `api/src/functions/tests/correction.ts:32` | `export type CorrectionSource = 'profile_figure' \| 'generalized'` | `tsc` fails. Loud, cheap, fine. |
| 4 | `app/src/assetGate.js:438-441` `CORRECTION_SOURCE` | the owner-facing copy map | **Does NOT crash — and that is the danger.** `correctionSourceText` (`:442`) is `CORRECTION_SOURCE[s] \|\| String(s \|\| 'no source was recorded')`, deliberately falling through **to the raw value** (docblock `:431-436`: "An unrecognised value falls through to ITSELF rather than to either known one"). So a new source ships as the literal database string in the UI — e.g. the user reads `owner_override` — honest, but unfinished copy that no test will catch. |
| 5 | `api/test/sql/correction.sql:26` | a test fixture DDL whose constraint is named **`correction_source_known`** — a name that **does not exist in production** (`schema.ts` names none of its CHECKs for `source`) — plus an extra `:31` `check (source <> 'profile_figure' or (reason is not null and length(reason) > 0))` that production also does not have | A fixture that diverges from production tests a schema nobody runs. |

Two existing tests also pin the two-value world and must be reconciled, not deleted:
`api/test/correction.test.mjs:22` `assert.ok(rows.every(r => r.source === 'generalized'))`, and
`api/test/hardening.test.mjs:2230` `assert.equal(r.source, 'generalized', 'generalization is the only
path P8.1 ships')`. **Both are correct today and both become false the moment an owner override
exists.** They assert *what `planCorrections` produces*, not *what the table admits* — so the right
reconciliation is to narrow their subject to the pipeline pass, never to relax them.

### F3b (BLOCKING, and it is NOT in the brief) — the duplicated DDL can permanently reject the new value

`appCorrections.ts:53-79` `ensureCorrectionTable()` re-declares the whole table. Its own docblock
(`:47-52`) states why: *"`pgMigrate` is not guaranteed to have run when this executes, and a route
that 500s on a missing table is worse than one that creates it."* And `dimensionsDb.test.mjs:102-103`
records the same ordering as a measured fact: **"`api-deploy.yml` deploys the code BEFORE it runs
`pg-migrate`."**

Compose those two facts:

1. deploy lands code carrying the new `source` value; `pg-migrate` has **not** run yet;
2. any request hits `applyCorrectionPass` → `ensureCorrectionTable` → `create table if not exists`;
3. on a database where `correction` **already exists** (production), that is a NO-OP — harmless;
4. **but a `create table if not exists` is ALSO a no-op for `schema.ts`'s copy.** Neither statement
   can widen an existing CHECK. **A `create table if not exists` NEVER alters an existing table.**
   So on production the new `source` value is rejected by the *old* CHECK **until an explicit
   `alter table correction drop constraint … / add constraint …` is written** — and the brief's
   phrase "a third value needs the CHECK altered" understates this as an edit to line 414 when it is
   actually a **new idempotent ALTER**, which then drags in `H39`/`H39b` ordering.

This is the exact defect class `dimensionsDb.test.mjs:295-306` already guards for
`comparison_dimension` (`H:dimension-ddl-parity`): *"A CHECK added to one copy would be silently
absent from the other."* **There is no equivalent parity guard for `correction`.**
`grep -rn "appCorrections" api/test/*.mjs` → `correction.test.mjs:166,192`, `hardening.test.mjs:2168,2215,4015`
— every one is a source grep about provenance or imports; **none compares the two DDLs.** That
missing guard is the single highest-value new guard in this document (`H:correction-ddl-parity`).

---
## 2. THE FIVE HARD QUESTIONS

### HQ1 — Does a list-item override actually FIT `correction`'s shape, or are the offsets fiction?

> **ANSWER: IT FITS — but ONLY if the override targets the PACKAGE MERGE FIELD, never
> `swap_decision.to_label`. Written the obvious way (a correction "on the swap"), every offset IS
> fiction. Written the right way, the offsets are literal and already how the pipeline works.**

**The premise in the brief is half wrong.** "A swap's `to_label` is a LIST ITEM, not a substring of a
prose field" — the first half is right, the second is **false**. Proof:

1. `swaps.ts:32-37` — `LIST_FIELDS: Record<ListKey, {passA, passB, merge}>` maps each of the five
   lists to a **real merge field**: `skills_1 → 'SkillsBullets1'`, `skills_2 → 'SkillsBullets2'`,
   `relevant_1..3 → 'RelevantBullets1..3'`. **A canonical list→merge-field map already exists.**
2. `swaps.ts:175` — `const finals = splitItems(pkg[f.merge] ?? call3[f.passB])`. **`to_label` is
   DERIVED from `pkg[merge]`**, it is not an independent value.
3. `swaps.ts:45-51` — `splitItems` is `String(block).trim().split(/\r?\n|(?:\s*[|•·]\s*)/)` then
   `.replace(/^[-*•·\s]+/,'').trim()`. Every item it returns is a **contiguous substring of the
   block**. So `char_start = block.indexOf(item)`, `char_end = char_start + item.length` are
   **literal, checkable offsets** — and `correction_span_matches_phrase` (`char_end - char_start =
   length(phrase)`) is satisfied **by construction**, not by arithmetic dressed up to pass.
4. The pipeline **already writes corrections into these very fields.** `appCorrections.ts:28-29`,
   `CORRECTABLE = Object.keys(pkg).filter(k => typeof pkg[k] === 'string' && pkg[k].trim().length > 0)`
   — every string field, list fields included. `SkillsBullets1` is a string in `pkg`. **A correction
   on a list merge field is not a new idea; it is the existing behaviour.**

**So the "does it fit" question has a precise answer with a precise boundary:**

| Target the override could name | Offsets | Verdict |
|---|---|---|
| `pkg.SkillsBullets1` / `SkillsBullets2` / `RelevantBullets1..3` — the merge field | **real** — `indexOf` of a guaranteed contiguous substring | **FITS. This is the only shape that fits.** |
| `swap_decision.to_label` — the row | **fiction** — there is no text for the offsets to index into; `before_sha256` would have to hash a label rather than "the whole ORIGINAL field text" the column is documented (`schema.ts:395`) to mean | **DOES NOT FIT.** Do not build this. |
| `pkg.SkillsBullets` — the compact resume's single Core Skills line | **fiction, for a different reason.** See HQ1a. | **DOES NOT FIT.** |

#### HQ1a (BLOCKING, and it contradicts the brief's own framing) — `SkillsBullets` is EPHEMERAL

The brief says `to_label` feeds "the SHIPPED compact-resume `SkillsBullets` (`appPackets.ts:669`)".
**That is true, and it is exactly why `SkillsBullets` cannot host the override.** `appPackets.ts:674-693`:

```
if (art.type === 'compact_resume') {
  const rows = (await client.query(`select … from swap_decision where packet_id = $1 …`)).rows
  const fit = fitCompactSkills({ skills1: splitItems(pkg.SkillsBullets1), skills2: splitItems(pkg.SkillsBullets2), provenance, budget })
  pkg = { ...pkg, SkillsBullets: fit.text }        // :691  — LOCAL. Never persisted.
}
```

- It runs in **`renderArtifact`**, called from `buildTemplatedArtifact` (`:753-754`) — i.e. **after**
  `ensurePackage` has already written `pkg_json` (`:588`).
- `pkg = { ...pkg, SkillsBullets }` rebinds a **local** — `grep -n "pkg_json" appPackets.ts` shows the
  only writes are `:588` (in `ensurePackage`, before this runs), `:1377` and `:1435` (the ai-edit /
  content routes). **`SkillsBullets` never reaches `pkg_json`.**
- Therefore `applyCorrectionPass` (`:538`, inside `ensurePackage`) **can never scan it** — the key
  does not exist on `pkg` at that moment. A correction row with `merge_field='SkillsBullets'` would
  reference a field that exists nowhere durable and whose `before_sha256` could never be recomputed.

**The consequence is the good news, and it is the single most important design point in this
document:** because `SkillsBullets` is *derived* from `SkillsBullets1`/`2` **and** from
`swap_decision`, and `swap_decision.to_label` is itself *derived* from `pkg[merge]` (`swaps.ts:175`),
an override written to `pkg.SkillsBullets1` **propagates to every one of the four consumers with no
extra code at all** — gate, score, offender list and shipped document all re-derive from the one
field. That is `CLAUDE.md`'s "apply shared logic ONCE in the core data layer" satisfied by
construction rather than by discipline. **An override on `to_label` would have required teaching all
four; an override on the merge field teaches none of them.**

**Report to the owner:** the decision to extend `correction` is *sound*, and it is sound for a
reason the decision was probably not made on. It works because `correction` already addresses
`pkg[merge]`, which is upstream of `to_label`. If it is implemented as "a correction attached to a
swap row", it fails on all four constraints of F4 and none of the propagation above happens.

---

### HQ2 — `correction` rows are shown as "Corrected for you". How does the log tell an OWNER edit apart without lying about either?

> **ANSWER: the mechanism to distinguish them EXISTS and is already load-bearing — `source`. But the
> three renderers that consume it are wrong in three different ways, and one of them fails silently.**

**The owner-facing copy is worse than the brief states — there are THREE competing headings, already
divergent before this feature:**

| String | Location | Surface |
|---|---|---|
| `Corrected for you` | `app/src/screens/AssetBlocks.jsx:677` | the **field margin** |
| `Done for you` | `app/src/assetGate.js:445` `CHANGE_LOG_HEADLINE` | the **QC rail** |
| `Changes made` | `SPEC` 4.5 | neither |

*(This is `AC-resume-margin.md` Q1.1, still open at `fb885cf`.)* **All three are false for an owner
edit.** "Corrected **for you**" and "Done **for you**" both assert the engine acted. An owner's own
edit rendered under either is a **fabricated provenance claim** — precisely the class
`CORRECTION_SOURCE`'s docblock already refuses to make.

**The good news: the existing code refuses to lie by default.** `assetGate.js:442`:
```
export const correctionSourceText = (s) => CORRECTION_SOURCE[s] || String(s || 'no source was recorded')
```
with the docblock (`:431-436`): *"An unrecognised value falls through to ITSELF rather than to either
known one… Defaulting an unknown source to `generalized` would tell a reader a number was invented
when the server said it came from their profile, or the exact reverse; both are worse than showing
the raw word."* **A new `source` value therefore degrades to honest-but-raw, never to a lie.** That
is the correct existing behaviour and no AC should change it.

**The bad news: `correctionSentence` DOES lie, and it lies silently.** `assetGate.js:569-575`:
```
return undone
  ? 'Undone: "' + replacement + '" is back to "' + phrase + '".'
  : 'Corrected: "' + phrase + '" rewritten as "' + replacement + '".'
```
**`correctionSentence` does not take `source` at all** — it has no parameter for it
(`{ phrase, replacement, fieldName, undone }`). So an owner override renders as **`Corrected: "X"
rewritten as "Y"`** — the engine claiming credit for the owner's own words — and **no test, type or
CHECK will catch it**, because the string is well-formed and the function never saw the fact that
would have made it wrong. This is the distinguishing mechanism failing at the last renderer.

**The honest distinction, stated as the requirement:** the log must say **who acted**. `source`
carries that; `correctionSentence` must start reading it. See AC-6.x. The owner still owes the
wording (Q-OWNER-2).

---

### HQ3 — What happens to an owner override when the packet is regenerated? Trace it.

> **ANSWER (BLOCKING): the ROW survives. The TEXT DOES NOT. There is NO code path that re-applies a
> stored correction to a regenerated package — so on `regen`, the owner's edit vanishes from the
> document while the change log keeps asserting it was made. The `correction` table solves the
> deletion problem the brief identified and DOES NOT solve the durability problem underneath it.**

This is the finding that most changes the shape of the work, so here is the full trace.

**Step 1 — `applyCorrections` has exactly two call sites.** `grep -rn "applyCorrections" api/src --include=*.ts`:

| Call site | What it does |
|---|---|
| `appCorrections.ts:115` — `pkg[field] = applyCorrections(original, rows)` | applies the rows **`planCorrections` just produced on line 114, in the same loop iteration** |
| `correction.ts:170` — inside `revertOne` | replays the applied list **minus one row**, for an undo |

**Neither reads a stored row back into a freshly generated package.** There is no
`reapplyCorrections`, no `select … from correction` in the build path. `listCorrections`
(`appCorrections.ts:137-145`) is `select`-only and its one consumer is the change-log route.

**Step 2 — what a rebuild actually does.** `ensurePackage` (`appPackets.ts:490-590`):
```
:499  const cached = (!regen && !staleUngrounded && pkt?.pkg_json) ? pkt.pkg_json : null
:502  if (cached) return { pkg: cached, generated: false, … }        // <- override survives HERE
:520  const built = await buildPackageForJD({…})                      // <- fresh text
:538  const corrections = await applyCorrectionPass(client, { artifactId: art.id, pkg, … })
:588  await client.query(`update packet set pkg_json = $1 …`)
```

So there are **two** rebuild paths and they behave oppositely:

| Path | Trigger | Override survives? |
|---|---|---|
| **cached** (`regen === false`) | ordinary rebuild / re-render / document create | **YES — but only because `pkg_json` is returned verbatim.** The override survives as *stored text*, not as a re-applied correction. |
| **regenerate** (`regen === true`, or `staleUngrounded`) | the owner clicks regenerate; `buildQueue` `regen` flag (`buildQueue.ts:107`) | **NO. Silently lost.** `buildPackageForJD` returns model-fresh text; `applyCorrectionPass` plans *new* rows from `scanEcho`; the owner's row is never consulted; `:588` overwrites `pkg_json`. |

**Step 3 — the log then lies.** The row is still in `correction` (nothing deletes it — F2 confirmed),
so `listCorrections` still returns it and the margin still renders **`Corrected: "X" rewritten as
"Y"`** for text that is no longer anywhere in the document. **The change log asserts a change the
document does not contain.**

**Step 4 — and Undo becomes unsafe-but-refusing.** `revertOne` (`correction.ts:158-170`) calls
`originalOf(current, applied)` and verifies against `before_sha256`. After a regen, `current` is
model-fresh text, so the recomputed hash will not match and the revert **refuses**. That is the
correct behaviour of a good guard (`schema.ts:398-401` documents exactly this intent) — but it means
the owner is left with a row they can neither see in their document nor undo.

**Step 5 — a second, quieter loss.** `appCorrections.ts:118-125` inserts `on conflict do nothing`
against `correction_unique_seq (artifact_id, merge_field, applied_seq, coalesce(run_id,'000…'))`.
**An owner override and a pipeline correction competing for the same `applied_seq` on the same
field with `run_id = null` — the COMMON case, per the index's own docblock (`schema.ts:427-429`) —
means one of them is dropped with no error.** Which one depends on insert order. An override written
with a naive `applied_seq` (`1`, or `rows.length + 1`) is a coin flip against the next pipeline pass.

**Step 6 — normalisation drifts the offsets even without a regen.** `appPackets.ts:558-580`:
`normalisePackage` runs **after** `applyCorrectionPass` and rewrites list items through a model
(`rewriteOne`). The comment at `:545-548` says this ordering is deliberate. The consequence for this
feature: `pkg_json` stores POST-normalisation text while every correction row's offsets and
`before_sha256` describe PRE-normalisation text. **A normalised field's corrections are already
un-revertable today.** An owner override written into that same window inherits the problem.

> **This is the "`writeSwaps` deletes it" problem again, wearing a different hat.** The brief is
> right that `correction` is not deleted. It is wrong to conclude the override is therefore durable.
> **Durability of the ROW is not durability of the EDIT.** The owner must decide (Q-OWNER-1) which
> of the three regen semantics they want; the ACs below specify all three so that whichever is
> chosen, "it silently disappeared" is not among the outcomes.

---

### HQ4 — Does an owner override change the GATE?

> **ANSWER: YES, and in the worst available direction — an owner's own edit can turn their passing
> packet RED, and the failure message names the owner's own words as the offender. This is not a
> risk to manage; it is what today's code does the moment `pkg[merge]` changes.**

Trace, `swaps.ts:188-231`, for one item the owner edits:

1. `const finals = splitItems(pkg[f.merge] ?? call3[f.passB])` (`:175`) — the edited text is a final.
2. `const exact = finals.findIndex(x => normItem(x) === normItem(o))` (`:190`) — the item was `kept`
   before the edit; after it, **`normItem` no longer matches**, so the `kept` branch is skipped.
3. `similarity(o, finals[i])` ≥ `SWAP_THRESHOLD` (`:79`, **`0.5`**) → the row becomes
   **`action: 'swapped'`** (`:204`), with `attribute(finals[bestI], requirements)` deciding the driver.
4. `attribute` (`:129-137`) returns non-null only if `similarity(text, r.verbatim) >=
   ATTRIBUTION_THRESHOLD` (`:128`, **`0.34`**). For an owner's own phrasing this will usually be
   **null** → `driver` is **not** `'posting'`.
5. `checks.ts:906-919`, `changes_cited`:
   ```
   const changes = swaps.filter(s => s.action === 'swapped' || s.action === 'added')
   const uncited = changes.filter(s => s.driver !== 'posting')
   … bad('changes_cited', `${uncited.length} of ${changes.length} changes cite nothing`, …,
         uncited.map(s => `${s.action}: ${s.to_label || s.from_label}`))
   ```
   → a **`bad`** result whose offender string **is the owner's edited text**.
6. `bad` feeds `gateFor` (`checks.ts:924+`) → the artifact gate; and `appChecks.ts` writes
   `artifact_gate` + `artifact_score`.

**And the reverse hazard is equally real:** if the owner's new wording happens to score ≥ `0.34`
containment against any requirement verbatim, `attribute` returns a hit and the row is written with
`driver = 'posting'` **and `verbatim_quote` set to the employer's words** — i.e. **the owner's own
edit silently acquires a citation it did not earn, and the gate goes green because of it.** Note
`similarity` is *containment* (`swaps.ts:70`, deliberately not Jaccard), which is **easy to score
high on with a short item** — a two-token skill contained in a long requirement scores 1.0.

**This is `CLAUDE.md`'s standing rule violated in both directions at once:** *"Fuzzy matching is for
RANKING, never for ACCUSING."* `similarity` currently decides (a) `kept` vs `swapped` vs `dropped`
and (b) whether a citation exists — and both feed `changes_cited`, which names offenders and blocks
a gate. Today that is tolerable because **only the pipeline's own output is ever matched**. The
moment owner text enters `pkg[merge]`, a fuzzy score starts adjudicating a human's words.

**Neither of the brief's two failure modes is acceptable, and the brief names them correctly:** the
override must not *silently fail* the packet, nor *silently pass* it. The resolution is a **third
`driver` value** — the domain is already an enumerated CHECK (`schema.ts:546`,
`check (driver in ('posting','rule','unattributed'))`) and `'rule'`'s own docblock (`schema.ts:530-532`)
records the precedent: the owner's omit list produces `driver: 'rule'` with the comment *"Never
presented as posting-driven: the owner's list removed it, not the employer's words."* **`swaps.ts:222-227`
already writes an owner-authored decision with a non-accusing driver.** That is the pattern to
extend. It is an owner decision which way `changes_cited` should then count it (Q-OWNER-3).

---

### HQ5 — Where does the owner perform this edit, and is any threshold settable?

> **ANSWER: the UI surface EXISTS and must be extended, not added to. The two thresholds this
> feature newly makes behaviour-affecting are BOTH hardcoded, and per `CLAUDE.md` "No hardcoded
> config" that is a violation the feature creates.**

**Where (surface):** `CorrectionRow` is defined once (`QcRail.jsx:489`) and mounted twice —
`QcRail.jsx:635` (the QC rail, `inField` false) and `AssetBlocks.jsx:679` (the field margin,
`inField` true, imported at `AssetBlocks.jsx:42`). It **already renders a "Change it" button**
(`QcRail.jsx:583`) with a suggest panel (`:586-607`) and `suggestScope()` copy
(`assetGate.js:649`). *(`AC-resume-margin.md` verified this at `b319943`. **Its AssetBlocks line numbers are now STALE** —
`fb885cf` shifted that file by ~34 lines. Re-measured at `fb885cf`: `import { CorrectionRow } from
'./QcRail.jsx'` :42; `data-qc={BLOCK_HOOKS.fieldChangeLog}` :676; `Corrected for you` :677;
`<CorrectionRow … inField>` :679. `QcRail.jsx` is unchanged at :489 / :635; the `Change it` button
moved to :583. `grep -rn "export function CorrectionRow" app/src/ | wc -l` → **1**.)* **This is the extend point. Any new correction-editing JSX written
into `AssetBlocks.jsx` is the parallel system `CLAUDE.md` forbids** — and `AC-resume-margin.md`
records this exact mistake already being made once in this file.

**Thresholds — the honest answer is that the settable system exists and these two are not in it:**

| Threshold | Value | Settable? | Proof |
|---|---|---|---|
| `SWAP_THRESHOLD` | `0.5` | **NO — code-only literal** | `swaps.ts:79` `export const SWAP_THRESHOLD = 0.5`; `grep -rn "SWAP_THRESHOLD" api/src` → only `swaps.ts:79,203,217`. Absent from `checkPrefs.ts`. |
| `ATTRIBUTION_THRESHOLD` | `0.34` | **NO — code-only literal** | `swaps.ts:128`, used only at `:134`. Absent from `checkPrefs.ts`. |
| `compactSkillsMaxChars` | default + per-owner | **YES** | `checkPrefs.ts:158-170` `loadThresholds(client, owner)` selects `chk_compact_skills_chars` and ~24 sibling `chk_*` columns; consumed at `appPackets.ts:687-688`. |

**So the EXTEND target for HQ5 is `check_prefs` / `loadThresholds`, which already carries two dozen
owner-settable `chk_*` thresholds.** A new threshold belongs there as a `chk_*` column, never as a
literal. **However** — and this must be said rather than assumed — `SWAP_THRESHOLD` and
`ATTRIBUTION_THRESHOLD` are hardcoded **today** and this feature does not create them. What it
creates is their *new* jurisdiction over owner-authored text (HQ4). Whether the owner wants to tune
them, or wants owner-authored rows exempted from fuzzy adjudication entirely (my reading of the
standing rule, but not my call), is **Q-OWNER-4**. **Making a swap-classification threshold
owner-tunable is itself a tier-1 change** — it moves a number that decides a gate — so it must not
be slipped in as a convenience.

---
## 3. INTEGRATION TRACE

### The ONE core system

**`pkg[LIST_FIELDS[list].merge]` — the package merge field — is the single funnel, and `correction`
is the existing, correct way to edit it.** Everything this feature touches is either upstream of that
field or derived from it. Named precisely: `api/src/functions/tests/appCorrections.ts`
(`applyCorrectionPass` / `ensureCorrectionTable` / `listCorrections` / `correctionRevert`) operating
on the field that `swaps.ts:32-37 LIST_FIELDS` names.

**Do NOT name `swap_decision` as the core system.** It is a *derivation* of the funnel
(`swaps.ts:175`, `finals = splitItems(pkg[f.merge] ?? …)`), not the funnel. Treating it as the core
is the mistake that produces an override the pipeline is licensed to delete.

### Upstream producers of `pkg[merge]` — in execution order

| # | Producer | Where | Note for this feature |
|---|---|---|---|
| 1 | `buildPackageForJD` (model) | `appPackets.ts:520` | replaces the field wholesale on `regen` — **HQ3 step 2** |
| 2 | `applyCorrectionPass` | `appPackets.ts:538` | the **insertion point** for an owner override to be re-applied |
| 3 | `normalisePackage` (model) | `appPackets.ts:558` | rewrites items **after** corrections — **HQ3 step 6, offset drift** |
| 4 | `update packet set pkg_json` | `appPackets.ts:588` | the durable store |
| 5 | `artifactAiEdit` / `saveArtifactContent` | `appPackets.ts:1377`, `:1435` | **two OTHER writers of `pkg_json`** that bypass 1-4 entirely and write no `correction` row. An override must not assume it is the only editor. |
| 6 | the cached path | `appPackets.ts:499-502` | returns `pkg_json` verbatim — why non-regen rebuilds preserve the edit today |

### Downstream consumers — every one must reconcile

| # | Consumer | Where | Reads the override automatically? |
|---|---|---|---|
| 1 | `writeSwaps` → `buildSwaps` → `swap_decision.to_label` | `appPackets.ts:607` → `appSwaps.ts:30-77` → `swaps.ts:175` | **YES** — derived from `pkg[merge]` |
| 2 | `changes_cited` — **gate + named offenders** | `checks.ts:906-919` | **YES**, via 1 — and this is the hazard, HQ4 |
| 3 | `compact_skills_fit` — warn state + dropped labels | `checks.ts:867-903` | **YES**, via 1 |
| 4 | compact resume `SkillsBullets` — **the shipped document** | `appPackets.ts:674-693` | **YES**, via 1 + `splitItems(pkg.SkillsBullets1/2)` directly |
| 5 | `evaluateArtifact` → `gate`, `score`; `artifact_gate` / `artifact_score` rows | `appChecks.ts:43-44`, `:113`, `:160`, `:168` | **YES**, via 2/3 |
| 6 | every `pkg`-reading check (`splitItems(pkg[f])`) | `checks.ts:331-332, 344, 376, 559-560, 877` | **YES** — directly |
| 7 | `swapsGet` → `{swaps, current, changed, unattributed}` | `appSwaps.ts:79-100` | **YES**, via 1 |
| 8 | the rendered documents | `renderArtifact` → `injectValues` | **YES** |
| 9 | the change log UI | `api.js:187 artifactChecksResult` → `AssetBlocks.jsx:102-113` → `qcRail.js:193 railChangeLog` → `assetGate.js correctionRow/correctionSentence` → `QcRail.jsx:489 CorrectionRow` mounted at `QcRail.jsx:635` **and** `AssetBlocks.jsx:679` | **PARTIALLY — this is the gap.** `correctionSentence` never receives `source` (HQ2). |

**This is the strongest argument for the owner's decision and it should be stated in the PR:**
consumers 1-8 need **zero** code changes, because the override is applied upstream of all of them.
Only consumer 9 — the *display* of provenance — needs work. Compare the `swap_decision` design,
where all eight would have needed teaching individually.

### EXTEND vs NEW — extend, on every axis. Nothing here is new.

| Axis | Extend what already exists | The parallel system to refuse |
|---|---|---|
| store | `correction` (owner's decision) | a new `override` table; `swap_decision.override_value` |
| source domain | `correction.source` CHECK + `CorrectionSource` union + `CORRECTION_SOURCE` copy map | a separate `is_owner` boolean beside `source` |
| driver domain | `swap_decision.driver` CHECK — **`'rule'` already encodes an owner-authored, non-accusing decision** (`swaps.ts:222-227`) | a new `owner_edited` column on `swap_decision` |
| list→field map | `swaps.ts:32-37 LIST_FIELDS` | a second mapping in the route or the client |
| UI | `CorrectionRow` (`QcRail.jsx:489`), one definition, two mounts, existing "Change it" panel | new correction JSX in `AssetBlocks.jsx` |
| write route | `appCorrections.ts` — `HEADERS` already declares `'GET,POST,OPTIONS'` (`:151`) and `correctionRevert` already POSTs through `requireWrite` | a route on `appSwaps.ts`, whose `HEADERS` is `'GET,OPTIONS'` (`appSwaps.ts:8`) |
| thresholds | `check_prefs` `chk_*` + `loadThresholds` (`checkPrefs.ts:158`) | a literal in `swaps.ts` |
| offsets/undo | `planCorrections`/`applyCorrections`/`originalOf`/`revertOne` (`correction.ts`) | a bespoke splice in the route |

### TIER: **1 — accusation grade.** Confirmed independently, not inherited.

`CLAUDE.md`: tier 1 covers anything that decides the artifact gate, a score, a coverage count, or
that **names an offender**, and anything that **admits model or user output into a stored claim**.
Verified at `fb885cf`: consumer 2 names offenders (`checks.ts:919`) and produces `bad` → the gate;
consumer 5 writes `artifact_score`; and the feature's whole purpose is to admit **owner text** into
`pkg[merge]`, from which `swap_decision.to_label` — a stored provenance claim — is derived. All four
triggers. Full process: this AC set first, an independent `verifier` after, every guard
mutation-proven, live verification.

---

## 4. ACCEPTANCE CRITERIA

Every AC is `Given <context>, when <action>, then <observable outcome>`, binary and observable.
**AC-0 through AC-3 are blocked on the owner questions in §6** and are written so that each possible
answer has a defined, non-silent outcome.

### Group A — the store and the migration

**AC-A1 (the ALTER is an ALTER, not an edited CHECK).**
Given `correction` already exists on the target database, when the migration runs, then the widened
`source` domain is applied by an **idempotent `alter table correction drop constraint … ; add
constraint …`** (or an equivalent `add constraint if not exists`) — **not** by editing the inline
`check (source in (…))` at `schema.ts:414` alone.
*Binary:* apply the migration to a database built from `git show origin/main:api/src/functions/tests/schema.ts`;
then `insert` a row with the new `source` → **succeeds**. Editing line 414 alone makes this insert
fail, because `create table if not exists` is a no-op on an existing table (F3b).

**AC-A2 (H39/H39b ordering).**
Given the migration file, when any statement names a column, constraint or index added by an
idempotent `ALTER`, then that statement appears **after** that `ALTER` in `SCHEMA_SQL`.
*Binary:* `psql -v ON_ERROR_STOP=1` exits **0** on the populated database (AC-A3). Without the
ordering it aborts with `ERROR: column "…" does not exist` / `there is no unique constraint matching
given keys` — the two defects `CLAUDE.md` records finding this exact way, and the reason
`schema.ts:558-566` carries its `-- ORDER IS LOAD-BEARING` comment.

**AC-A3 (executed against a POPULATED database with the PREVIOUS schema — not a fresh one).**
Given `origin/main`'s `SCHEMA_SQL` applied to a local PostgreSQL 16 instance **and seeded with real
rows in `opportunity`, `packet`, `artifact`, `skill_candidate`, `swap_decision` and at least two
`correction` rows** (one live, one with `reverted_by`/`reverted_at` set), when this branch's
`SCHEMA_SQL` is applied on top, then `psql -v ON_ERROR_STOP=1` exits **0** and every seeded row is
still present and unchanged.
*Binary:* exit code 0 **and** a post-migration `select count(*)` per seeded table equal to the
pre-migration count.
*Method — exactly `CLAUDE.md`'s recipe, no substitutions:* `initdb` as the `postgres` user into
`/tmp/pgd`; dump `SCHEMA_SQL` from the **built module** (`node -e "import('./dist/functions/tests/schema.js')…"`),
never hand-copied; extract main's copy from `git show origin/main:api/src/functions/tests/schema.ts`
by string-slicing the template literal; stub `pgvector` (`create extension` → comment,
`vector(1536)` → `text`, drop the `hnsw` index) since it is not installed here.
*Why a fresh database is `not_applicable`, never `pass`:* `create table if not exists correction` is
**skipped** on the database that matters, taking the inline CHECK with it — a fresh-DB run proves
nothing about F3b.

**AC-A4 (the duplicated DDL is migrated in lockstep).**
Given `ensureCorrectionTable` (`appCorrections.ts:53-79`) carries a second copy of the table
declaration, when the `source` domain changes, then **both** copies carry the identical constraint
set, and the ensure-path also performs the idempotent widening `ALTER` — because
`api-deploy.yml` deploys code **before** `pg-migrate` runs (`dimensionsDb.test.mjs:102-103`), so the
ensure-path runs first on a database that has not been migrated.
*Binary:* build a database using **only** `ensureCorrectionTable`, and a second using **only**
`SCHEMA_SQL`; `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='correction'::regclass order by conname` → **identical output**. This is `H:dimension-ddl-parity`
(`dimensionsDb.test.mjs:295-353`) applied to `correction`, which currently has no such guard.

**AC-A5 (`applied_seq` cannot silently swallow an override).**
Given an owner override and a pipeline correction on the same `artifact_id` + `merge_field` with
`run_id = null`, when both are written, then **both rows exist**.
*Binary:* insert an override, run `applyCorrectionPass` on the same field, `select count(*)` → 2.
*Why:* `appCorrections.ts:123` is `on conflict do nothing` against `correction_unique_seq`
(`schema.ts:430-431`), whose `coalesce(run_id,'000…')` docblock states NULL `run_id` is the **common**
case. Today one of the two is dropped **with no error** (HQ3 step 5). "It appeared to work in
testing" is the expected symptom, so this AC must be tested with an explicit count, never by eye.

**AC-A6 (an override is not deleted by anything).**
Given an owner override row, when `writeSwaps` runs again for the same `(packet_id, loop)` **and**
for a new loop, then the row is still present with the same `id` and the same `replacement`.
*Binary:* `select id, replacement from correction where id = $1` before and after → identical.
*Why:* this is the AC the `swap_decision` design fails (`appSwaps.ts:45`). `correction` passes it —
but it must be **asserted**, not assumed, because it is the entire justification for the owner's
decision.

**AC-A7 (the cascade is pinned, since it is the real durability mechanism).**
Given the override's durability rests on `artifact.id` being stable (F2a), when the build/regenerate/
remediate paths are exercised, then no `artifact` row is deleted or replaced and the override's
`artifact_id` still resolves.
*Binary:* capture `select id from artifact where packet_id=$1 order by type` before and after a
`regen: true` build → identical id set.
*Why:* `schema.ts:405` is `on delete cascade`. A future change that recreates artifacts destroys
every override with **no `delete from correction` anywhere in the diff** — invisible to the grep that
the feasibility table relied on.

### Group B — the shape of the override row

**AC-B1 (offsets are literal, never fabricated).**
Given an owner overrides the list item `phrase` in merge field `F` of package text `T`, when the row
is written, then `T.slice(char_start, char_end) === phrase` **exactly**, and
`before_sha256 === sha256(T)` where `T` is the **whole original field text**.
*Binary:* re-read the row and assert both equalities against `pkg_json[F]`.
*Why:* `correction_span_matches_phrase` (`schema.ts:422`) only checks the *arithmetic*
(`char_end - char_start = length(phrase)`) — it **cannot** tell whether the offsets address the
phrase they claim to. Offsets that satisfy the CHECK while pointing at the wrong text are exactly the
"offsets that are fiction" the brief asks about, and the database will accept them.

**AC-B2 (the override targets a merge field, never a swap row).**
Given the implementation, when reviewed, then `merge_field` is one of
`SkillsBullets1|SkillsBullets2|RelevantBullets1|RelevantBullets2|RelevantBullets3`, resolved through
`LIST_FIELDS` (`swaps.ts:32-37`), and **no** override row carries `merge_field = 'SkillsBullets'`.
*Binary:* `select distinct merge_field from correction where source = '<owner value>'` → subset of
the five; zero rows with `'SkillsBullets'`.
*Why:* HQ1a — `SkillsBullets` is computed in `renderArtifact` and never persisted to `pkg_json`, so
its `before_sha256` can never be recomputed and its correction can never be reverted.

**AC-B3 (an ambiguous target is refused, not guessed).**
Given the same item text appears **twice** in one merge field, when the owner overrides one of them,
then the write is **refused with a message naming the ambiguity** — it does not silently take
`indexOf`'s first hit.
*Binary:* seed `SkillsBullets1` with a duplicated item; attempt an override; assert non-2xx and that
zero rows were written.
*Why:* `CLAUDE.md` — a guess here writes a `char_start` that addresses the wrong occurrence, and the
resulting undo splices into the wrong place months later. `checks.ts:376` already treats duplicate
items as a condition worth detecting.

**AC-B4 (an empty override is refused by the database AND by the route).**
Given the owner clears an override to `''`, when it is submitted, then the route refuses it with a
message, and **no** row reaches the database.
*Binary:* submit `replacement: ''` → non-2xx, `select count(*)` unchanged. Separately assert the DB
would also refuse a zero-length `phrase`: `correction_span_ordered` (`schema.ts:423`) is
`char_start >= 0 and char_end > char_start`, so `char_end = char_start` is rejected.
*Why:* `checks.ts:883-886` records a real defect of this exact shape — a blank Core Skills line
reported as a **green pass**. Two layers, and the AC must observe both, because a route-only refusal
leaves the DB open to a direct writer and a DB-only refusal surfaces to the owner as a 500.

**AC-B5 (`source` is widened everywhere, or the build fails).**
Given the new `source` value, when the repo is built and the suite runs, then all five homes agree:
`schema.ts:414`, `appCorrections.ts:66`, `correction.ts:32` (`CorrectionSource`),
`app/src/assetGate.js:438-441` (`CORRECTION_SOURCE`), `api/test/sql/correction.sql:26`.
*Binary:* `cd api && npm run build` exits 0 (catches the TS union); `correctionSourceText('<new>')`
returns owner-facing copy, **not** the raw database token; the DDL-parity assertion of AC-A4 passes.
*Absent evidence is `not_applicable`:* `correctionSourceText` falling through to the raw value
(`assetGate.js:442`) means a missing copy entry **renders without error**. Only an explicit assertion
that the returned string differs from the input catches it.

**AC-B6 (the two pipeline-only assertions are narrowed, not deleted).**
Given `correction.test.mjs:22` (`rows.every(r => r.source === 'generalized')`) and
`hardening.test.mjs:2230` (`assert.equal(r.source, 'generalized', 'generalization is the only path
P8.1 ships')`), when an owner source exists, then both still assert that **`planCorrections`**
produces only `'generalized'`, scoped to the pipeline pass.
*Binary:* both tests still present, still passing, and their subject is a `planCorrections` return
value — not a `select * from correction`.
*Why:* they are true statements about the pipeline. Relaxing them to accommodate a value
`planCorrections` never emits would delete a real guard to make room for a feature it does not
constrain.

### Group C — regeneration (blocked on Q-OWNER-1; all three answers specified)

**AC-C1 (an override is NEVER silently lost — the invariant that holds under every answer).**
Given an override on merge field `F`, when the packet is regenerated (`regen: true`), then **exactly
one** of the following is observably true, and never "the text is gone and nothing says so":
 (a) the override is **re-applied** to the regenerated `F` and the document contains it; or
 (b) the override is **marked superseded** — a persisted marker naming the build that superseded it —
     and the change log shows it as superseded rather than as `Corrected`; or
 (c) the regenerate is **refused or warned** before it runs, naming the overrides it would discard.
*Binary:* after a `regen: true` build, assert the document contains the override text (a), **or** the
row carries a superseded marker and the rendered log says so (b), **or** the regenerate returned a
warning naming the row (c). **A regen that leaves the row un-marked while the text is gone FAILS.**
*Why:* HQ3. Today outcome (a) is impossible — there is no code path that re-applies a stored
correction — so **(a) is a build, not a default.**

**AC-C2 (the change log never asserts a change the document does not contain).**
Given an override whose text is no longer present in `pkg_json[F]`, when the change log renders,
then the row does **not** read `Corrected: "X" rewritten as "Y"`.
*Binary:* regenerate; render the log; assert the row's sentence does not contain `Corrected:`.
*Why:* `correctionSentence` (`assetGate.js:569-575`) states the change in the perfect tense
unconditionally. That is honest today only because the cached path preserves the text.

**AC-C3 (a refused undo says why, and is not mistaken for a broken button).**
Given an override whose field has since been regenerated or normalised, when the owner clicks `Undo`,
then `revertOne` refuses (its `before_sha256` recompute fails) and the UI shows the refusal reason.
*Binary:* assert non-2xx or `{ok:false, reason}` and that the reason string reaches the DOM.
*Why:* `correction.ts:158-170` + `schema.ts:398-401` — the refusal is correct and designed; an
unexplained refusal is `CLAUDE.md`'s dead UI.

### Group D — the gate (blocked on Q-OWNER-3)

**AC-D1 (an owner edit never silently manufactures a citation).**
Given the owner overrides an item to text that scores ≥ `ATTRIBUTION_THRESHOLD` (`0.34`,
`swaps.ts:128`) against some requirement verbatim, when `writeSwaps` next runs, then the resulting
row **does not** acquire `driver = 'posting'` with `verbatim_quote` set **on the strength of the
owner's own wording**.
*Binary:* seed a requirement verbatim and an override deliberately chosen to score ≥ 0.34; run
`writeSwaps`; assert `driver <> 'posting'` for that row.
*Why:* HQ4. `similarity` is containment (`swaps.ts:70`), so a short owner-written skill contained in
a long requirement scores **1.0**. This is the single most dangerous outcome of the feature: the gate
going **green** because the owner rephrased something.

**AC-D2 (an owner edit never silently fails the packet either).**
Given the owner overrides a previously `kept` item, when checks re-run, then `changes_cited`
(`checks.ts:906-919`) does **not** report the owner's own text in its `uncited` offender list
(`uncited.map(s => \`${s.action}: ${s.to_label || s.from_label}\`)`) without the packet's owner-facing
result distinguishing it from a pipeline change.
*Binary:* override a `kept` item; re-run checks; assert either the row is excluded from `uncited`, or
the check's `detail` marks it owner-authored. **A plain `bad` naming the owner's words FAILS.**
*Why:* HQ4 steps 2-5. Today the edit breaks `normItem` exact-match (`swaps.ts:190`), falls to
`similarity >= SWAP_THRESHOLD` (`0.5`), becomes `swapped` with a non-`posting` driver, and is
accused.

**AC-D3 (the owner-authored decision uses the EXISTING enumerated driver mechanism).**
Given an owner-authored row, when it is written, then its provenance is carried by the **`driver`
CHECK domain** (`schema.ts:546`, `check (driver in ('posting','rule','unattributed'))`) — extended if
the owner chooses a new value — and **not** by a new boolean column beside it.
*Binary:* `git diff` shows no new provenance column on `swap_decision`; the domain is an enumerated
DB `check`.
*Why:* `swaps.ts:222-227` already writes an owner-authored, deliberately non-accusing decision
(`driver: 'rule'`, *"Never presented as posting-driven: the owner's list removed it"*). That is the
precedent to extend. Also `artifact_gate` (`schema.ts:631-636`) already encodes "an override needs
all its parts or none".

**AC-D4 (the gate result is never fabricated when the answer is unknown).**
Given an artifact with owner overrides but no swap rows, when `changes_cited` runs, then it reports
`not_applicable`, never `pass`.
*Binary:* `checks.ts:908` already does this (`na('changes_cited', 'no swap rows recorded…')`) —
assert it still does after the change. *Absent evidence is `not_applicable`, never `pass`.*

### Group E — the write route

**AC-E1 (the route extends `appCorrections.ts` and is session-authenticated).**
Given the new override write route, when it is called without a verified session, then `requireWrite`
refuses it; and the `api.js` client helper sends **no** `?owner=` parameter.
*Binary:* unauthenticated call → non-2xx; `grep '?owner=' ` on the new helper → absent.
*Why:* `CLAUDE.md` owner model — mutations take their owner from the verified session.
`correctionRevert` (`appCorrections.ts:248`) is the pattern; `appCorrections.ts:151` `HEADERS`
already declares `'GET,POST,OPTIONS'` while `appSwaps.ts:8` declares only `'GET,OPTIONS'`.

**AC-E2 (the new client helper is not shadowed by a duplicate key).**
Given the new helper is added to the `api.js` object literal, when the module is parsed, then that
key is defined **exactly once**.
*Binary:* the duplicate-key scan below reports no new duplicate.
*Why — and this CORRECTS the prior AC pass:* `app/src/api.js` has **three** duplicate keys today, not
two. `AC-resume-margin.md` FINDING 3-D named `artifactInsertions` (171/**191**) and `packetSwaps`
(172/193). Measured at `fb885cf`:
```
artifactInsertions  171,192      (the prior pass's line number was off by one)
packetSwaps         172,193
artifactChecksResult 142,187     <-- MISSED by the prior pass
```
**`artifactChecksResult` is the one that matters here**: `api.js:194`'s own comment says *"the change
log itself rides on `artifactChecksResult`"*, and `AssetBlocks.jsx:102-113` consumes it. The later
definition silently wins, so **an edit to `api.js:142` would be a silent no-op** — the exact trap the
prior pass warned about, sitting on the exact helper this feature reads.

### Group F — the owner-facing surface

**AC-F1 (one renderer, extended — no new correction JSX).**
Given this feature ships, when the diff is reviewed, then `grep -rn "export function CorrectionRow" app/src/ | wc -l` → **1**, and `AssetBlocks.jsx` contains no new correction-rendering JSX.
*Why:* `CorrectionRow` is defined at `QcRail.jsx:489` and mounted at `QcRail.jsx:635` and
`AssetBlocks.jsx:679`. `AC-resume-margin.md` records a previous pass nearly building a second
renderer in this same file.

**AC-F2 (`correctionSentence` states WHO acted).**
Given a row whose `source` is the owner value, when the sentence renders, then it does **not** read
`Corrected: …` and does not attribute the change to the engine.
*Binary:* `correctionSentence({phrase, replacement, source:'<owner value>'})` → assert the returned
string does not contain `Corrected:`; and the same row rendered under `source: 'generalized'` does.
*Why:* HQ2 — `correctionSentence` (`assetGate.js:569`) takes `{phrase, replacement, fieldName,
undone}` and **has no `source` parameter at all**, so today it would render an owner's own words as
an engine correction, with no error anywhere.

**AC-F3 (both mount points change together).**
Given AC-F2, when the QC rail renders the same row (`inField` false), then the same assertion holds
there.
*Binary:* assert on both `QcRail.jsx:635` and `AssetBlocks.jsx:679` renders.
*Why:* one definition, two surfaces; a fix that lands on one is two definitions in disguise.

**AC-F4 (undone orientation is not inverted for an override).**
Given an owner override that has been undone, when it renders, then the text shown as *no longer in
the document* is the `replacement`, not the `phrase`.
*Binary:* assert per `assetGate.js:571-573`'s existing `undone` branch.

**AC-F5 (no dead UI).**
Given the override control is rendered, when the owner uses it, then it calls a real route and the
result is persisted and visible on reload.
*Binary:* submit; hard-reload; the override is still shown. *Why:* `CLAUDE.md` "No dead UI"; and
`AssetBlocks.jsx:724-726` records a control deliberately **not** shipped because it would forget.

**AC-F6 (JSX build hygiene).**
Given any `.jsx` edit, when it is committed, then the smart-quote `sed` sweep has been run, the
**Python** codepoint scan reports clean (`grep -P` fails silently in this container's locale), and
`cd app && npm run build` exits 0 **after** the sweep.
*Binary:* build exit code 0. **Do not add a repo-wide smart-quote linter** — one was written and
deleted the same night for 8 false positives; `esbuild` is the guard.

---
## 5. GUARDS AND THEIR EXACT MUTATION PROOFS

Per `CLAUDE.md`: **"THE ONE STEP THAT IS NEVER SKIPPED, AT ANY TIER: mutation-prove a NEW guard.
Write the guard, revert the behaviour it guards, confirm the suite FAILS, restore."** H-cases take a
**slug**, never a number (`H26` fails the suite on a new numeric id). Guards live in
`api/test/hardening.test.mjs` unless a DB is required, in which case they follow
`dimensionsDb.test.mjs`'s populated-database pattern.

| # | Guard (slug) | Asserts (AC) | **EXACT mutation that must make the suite FAIL** | Layer that catches it |
|---|---|---|---|---|
| G1 | `H:correction-ddl-parity` | AC-A4 — `schema.ts` and `ensureCorrectionTable` declare an identical constraint set | In `appCorrections.ts:66`, delete `check (source in (…))` from the inline DDL, leaving `schema.ts:414` intact. Build both databases, diff `pg_get_constraintdef` → **must fail**. | populated DB test |
| G2 | `H:correction-source-widened-everywhere` | AC-B5 — all five homes agree | Delete the new key from `CORRECTION_SOURCE` (`assetGate.js:438-441`) only. Suite **must fail** on `correctionSourceText('<new>') !== '<new>'`. *(Deleting it from `correction.ts:32` instead is caught by `tsc`, not this guard — state which layer caught it.)* | unit + build |
| G3 | `H:override-offsets-address-the-phrase` | AC-B1 — `T.slice(char_start,char_end) === phrase` | In the override writer, add `+1` to both `char_start` and `char_end`. **The DB CHECK still passes** (`char_end - char_start` is unchanged) — so if the suite goes green, the guard is inert and only the arithmetic was ever being tested. **This mutation is the whole point of G3.** | unit |
| G4 | `H:override-not-on-ephemeral-field` | AC-B2 — no override on `SkillsBullets` | Change the writer's field resolution to `'SkillsBullets'`. Suite **must fail**. | unit |
| G5 | `H:override-ambiguous-target-refused` | AC-B3 — duplicate item text is refused | Replace the ambiguity check with `const i = text.indexOf(phrase)`. Suite **must fail** on the duplicate-item fixture. | unit |
| G6 | `H:override-seq-not-swallowed` | AC-A5 — override + pipeline row coexist | Restore a naive `applied_seq = 1` in the override writer and keep `on conflict do nothing`. Suite **must fail** with `count = 1` where 2 is required. | populated DB test |
| G7 | `H:override-survives-writeswaps` | AC-A6 — `writeSwaps` cannot destroy it | Point the override writer at `swap_decision` (add `override_value`, write there). Re-run `writeSwaps` for the same `(packet_id, loop)`. Suite **must fail** — this reinstates the exact live behaviour of `appSwaps.ts:45` the owner's decision exists to escape. | populated DB test |
| G8 | `H:artifact-id-stable-across-rebuild` | AC-A7 — the cascade never fires | Insert `delete from artifact where packet_id = $1` before the artifact-ensure loop in `loadPacket` (`appPackets.ts:79-82`). Suite **must fail** on both the artifact-id-set assertion and the surviving-override assertion. | populated DB test |
| G9 | `H:override-never-cites` | AC-D1 — an owner edit cannot buy `driver='posting'` | Remove the owner-authored exemption so `attribute()` runs unfiltered over the overridden final. Fixture: requirement verbatim `"experience with enterprise product roadmap planning"`, override `"product roadmap"` → containment **1.0** ≥ `0.34`. Suite **must fail**. **Caveat, stated in advance:** if the mutation sets `driver` without a quote, `schema.ts:546`'s `check ((driver='posting') = (verbatim_quote is not null))` rejects the row at the **database**, not at the assertion. That is a pass for safety but does **not** prove the application guard — mutate the pair together and report which layer caught it. | unit + DB |
| G10 | `H:override-not-accused` | AC-D2 — the owner's words are not named as an offender | Remove the owner-authored branch from `changes_cited` (`checks.ts:913`) so `uncited` includes the override row. Suite **must fail**, and the failure must name the offender string. **If it passes, the fixture contains no overridden row and the guard is VACUOUS — say so and fix the fixture** (`H:no-vacuous-gate` is the existing precedent). | unit |
| G11 | `H:correction-sentence-reads-source` | AC-F2 — the sentence states who acted | Delete the `source` parameter from `correctionSentence` (`assetGate.js:569`), restoring today's signature. Suite **must fail** on the owner-source render. | unit |
| G12 | `H:one-correction-renderer` | AC-F1 — exactly one `CorrectionRow` | Add `export function CorrectionRow(){}` to `AssetBlocks.jsx`. Suite **must fail**. *(Source grep — the right tool for a structural rule a runtime test cannot express, per `CLAUDE.md`.)* | source grep |
| G13 | `H:override-log-not-stale` | AC-C2 — the log never claims a change the document lacks | Make the log render unconditionally (drop the presence/superseded check). Regenerate the fixture packet. Suite **must fail** on `Corrected:` still being present. | unit |
| G14 | `H:api-js-no-duplicate-keys` | AC-E2 — no shadowed client helper | Add a second `overrideCorrection:` key to the `api.js` object literal. Suite **must fail**, naming the key and both line numbers. **Note this guard fails on `main` TODAY** (`artifactChecksResult` 142/187, `artifactInsertions` 171/192, `packetSwaps` 172/193) — so it must either fix those three first or be scoped to newly-added keys. **Do not land it green by weakening it to ignore existing duplicates without saying so.** | source parse |

### Mutations that will CORRECTLY fail to fail — declared in advance, per `CLAUDE.md`

State these when reporting, and do **not** present their passing as evidence a guard is inert:

1. **Renaming the new `source` value** (e.g. `owner_override` → `owner_edit`) while updating all five
   homes together is behaviourally equivalent. No guard here catches it; none should.
2. **Changing the heading copy** `Corrected for you` → `Changes made` (`AssetBlocks.jsx:677`) is
   behaviourally equivalent. A guard pinning that string pins **copy**, not behaviour — label it so.
3. **Reordering two independent idempotent `ALTER`s** that name no shared column is equivalent;
   `AC-A2` is about `ALTER`-before-**use**, not about `ALTER` order among themselves.

### The pre-flight command every guard run must start from

```bash
cd api && npm run build && node --test test/            # unit + source-grep guards
# then the populated-database guards, per CLAUDE.md's recipe verbatim:
#   initdb as postgres -> apply origin/main SCHEMA_SQL -> seed rows -> apply THIS branch's SCHEMA_SQL
#   psql -v ON_ERROR_STOP=1   (without it, psql skips every statement after the first error
#                              and reports success)
```

---

## 6. QUESTIONS THE OWNER MUST ANSWER — I have not guessed any of these

**Q-OWNER-1 (BLOCKING — HQ3). What should a regenerate do to an owner override?** There is **no**
code path that re-applies a stored correction (`applyCorrections` has two call sites, `appCorrections.ts:115`
and `correction.ts:170`, neither of which reads a stored row into fresh text). So today, `regen: true`
silently discards the edit while leaving the row asserting it. Three coherent answers, different builds:
 **(a) re-apply** — the override is spliced back into the regenerated field. Closest to what "edit in
 place" means to a user, and the most expensive: it needs a stable identity for "the same item" across
 a regeneration, which the model's fresh text does not provide, and it re-opens the `originalOf` /
 `before_sha256` contract that makes undo exact.
 **(b) supersede** — the override is marked superseded by the build that replaced it, and the log
 says so. Cheapest, fully honest, and the owner loses their edit.
 **(c) refuse/warn** — regenerate names the overrides it would discard before running.
*AC-C1 holds under all three; only "it vanished and nothing said so" is excluded.*

**Q-OWNER-2 (HQ2). What does the change log CALL an owner's own edit?** There are already three
competing strings for one concept and **all three are false for an owner edit**: `Corrected for you`
(`AssetBlocks.jsx:677`), `Done for you` (`assetGate.js:445` `CHANGE_LOG_HEADLINE`), `Changes made`
(SPEC 4.5). *(This is `AC-resume-margin.md` Q1.1, unanswered across two AC passes.)* I need: the
heading for a mixed log, the per-row wording for an owner row, and the `CORRECTION_SOURCE` copy for
the new `source` value. **Also confirm the new `source` token itself** — I have used `owner_override`
as a placeholder throughout and have **not** chosen it.

**Q-OWNER-3 (BLOCKING — HQ4). May an owner override change the GATE, and in which direction?**
Today an owner edit to a `kept` item becomes `swapped` + `unattributed` and `changes_cited`
(`checks.ts:906-919`) **fails the packet naming the owner's own words**; and an edit that happens to
score ≥ `0.34` containment against a requirement **silently acquires a citation** and turns the gate
green. Options: exempt owner rows from `changes_cited`; count them in a separate owner-authored
tally; or a new `driver` value (extending `check (driver in ('posting','rule','unattributed'))`,
following the `'rule'` precedent at `swaps.ts:222-227`). **This is a product decision about what the
gate is for**, and it decides AC-D2.

**Q-OWNER-4 (HQ5). `SWAP_THRESHOLD` (0.5) and `ATTRIBUTION_THRESHOLD` (0.34) are hardcoded literals
(`swaps.ts:79`, `:128`), absent from the owner-settable `chk_*` set (`checkPrefs.ts:158-170`).** This
feature does not create them, but it puts them in charge of adjudicating **owner-authored text**. Do
you want them (i) surfaced as `chk_*` settings, (ii) left as-is with owner rows exempted from fuzzy
adjudication entirely, or (iii) left as-is and owner rows adjudicated like any other? My reading of
`CLAUDE.md`'s "Fuzzy matching is for RANKING, never for ACCUSING" favours (ii), **but this is
explicitly not my call** and (i) is itself a tier-1 change.

**Q-OWNER-5 (HQ1 scope). WHICH fields are overridable?** `LIST_FIELDS` (`swaps.ts:32-37`) names five
merge fields (`SkillsBullets1/2`, `RelevantBullets1/2/3`). Is #30 all five, or skills only? And is it
the **item text** only, or also `rationale`? *(`rationale` is not derived from `pkg` — it is written
by `writeSwaps` from `buildSwaps`, so overriding it does **not** fit the `correction` shape and would
be a genuinely different feature.)* `AC-resume-margin.md` Q3.4 asked this and it is still open.

**Q-OWNER-6 (found en route, needs a ruling but is NOT in this feature's scope).** `normalisePackage`
runs **after** `applyCorrectionPass` (`appPackets.ts:538` then `:558`) and rewrites list items through
a model, so `pkg_json` holds post-normalisation text while every correction row's offsets and
`before_sha256` describe pre-normalisation text. **Corrections on a normalised field appear to be
un-revertable today, before this feature exists.** I did not verify this against a live packet — it
is an inference from the ordering plus `revertOne`'s hash recompute (`correction.ts:158-170`),
**confidence moderate; it would be confirmed by** clicking Undo on a real correction in a field the
normaliser touched, or by a `db-query.yml` count of corrections whose `before_sha256` no longer
matches `sha256(pkg_json[merge_field])`. Flagged, not fixed.

---

## 7. ADVERSARIAL SUMMARY

### What the brief got right
The four feasibility rows are all **substantively correct** — right table, right columns, right line
numbers (F1 off by three lines at the closing paren only), right constraint, right conclusion that
`correction` is not deleted. The tier-1 call and all four of its triggers are confirmed independently
at `fb885cf`.

### What the brief got wrong or understated

| # | Brief | Ground truth at `fb885cf` | Cost if believed |
|---|---|---|---|
| 1 | "`to_label` is a LIST ITEM, **not a substring of a prose field**" | `swaps.ts:175` — `to_label` is **derived from `pkg[LIST_FIELDS[list].merge]`**, and `splitItems` guarantees each item is a **contiguous substring** of it. The pipeline **already** writes corrections into these fields (`appCorrections.ts:28-29`) | The feature gets built on `swap_decision` after all, or with fabricated offsets — when the correct target makes 8 of 9 consumers update for free |
| 2 | "`correction` survives a rebuild — zero `delete from correction`" | **True but proves the wrong thing.** `schema.ts:405` is `on delete cascade` on `artifact_id`; durability actually rests on artifact ids being stable (`appPackets.ts:79-82`, `appRemediation.ts:488`) | A future artifact-recreating change silently destroys every override with no `delete` in the diff |
| 3 | "a third value needs the CHECK altered" (one line) | **Five homes**, incl. a **byte-duplicated DDL** in `ensureCorrectionTable` (`appCorrections.ts:53-79`) that runs **before** `pg-migrate` on deploy. And `create table if not exists` can **never** widen an existing CHECK — an idempotent `ALTER` is required | The value is rejected in production while every local test passes |
| 4 | implied: storing in `correction` solves durability | **It does not.** No code path re-applies a stored correction; `regen: true` discards the edit and leaves the row asserting it | The headline problem is declared solved when only half of it is |
| 5 | "an owner-authored change must not silently fail the packet, nor silently pass it" (posed as a question) | **Both already happen** by default the moment `pkg[merge]` changes — `swaps.ts:190→204` then `checks.ts:913`, and `attribute` at containment ≥ 0.34 | Shipping either is a gate defect, and one of them turns the gate **green** |
| 6 | *(inherited)* `AC-resume-margin.md`: two duplicate keys in `api.js` | **Three** — and the missed one, `artifactChecksResult` (142/187), is the helper the change log itself rides on | An edit to `api.js:142` is a silent no-op |

### Verdict

| | |
|---|---|
| **Is the owner's decision sound?** | **YES — and for a stronger reason than it was made on.** `correction` is right because it already addresses `pkg[merge]`, which is **upstream** of `to_label`, so gate, score, offender list and shipped document all re-derive with no code. |
| **Does the list-item override fit `correction`'s shape?** | **YES, with a hard boundary.** Target `SkillsBullets1/2` + `RelevantBullets1/2/3`. Targeting `swap_decision.to_label` or the ephemeral `SkillsBullets` requires fabricated offsets — **do not build either.** |
| **Is it buildable today?** | **NO — blocked on Q-OWNER-1 and Q-OWNER-3.** Both are product decisions with no defensible default: one decides whether the edit survives a regenerate at all, the other whether the owner's own words can fail or silently pass their own gate. |
| **Biggest single risk** | **Not data loss — a green gate.** An owner rephrases a skill, `attribute()` scores ≥ 0.34 containment against a requirement, the row is written `driver='posting'` with the **employer's** quote attached, and `changes_cited` passes a packet on a citation nobody earned. |
| **Highest-value guard** | `H:correction-ddl-parity` (G1) — the only defect here that passes every local test and fails only in production. |

---

*Analysis only. Nothing under `app/src` or `api/src` was modified; nothing was committed. Every
verdict is sourced from `origin/main` at `fb885cfea39de6bebe1f093f0070b131110e5d71`. Where a claim is
an inference rather than a read of ground truth, it says so and names what would confirm it
(Q-OWNER-6 is the only such claim).*
