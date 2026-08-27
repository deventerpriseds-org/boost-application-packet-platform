# AC pass — `D:swap-screen-reads-a-dead-pass` (swap provenance / rationale / count)

**Status:** COMPLETE (written incrementally; the file is the deliverable)

**VERDICT IN ONE LINE:** claim 1 **CONFIRMED and deeper than stated** (`call2` never reaches
`buildSwaps` at all); claim 2 **CONFIRMED as a defect, OVERSTATED as to its reason, UNDERSTATED as to
its scope** (five possible authors, not two); claim 3 **NOT ESTABLISHED** — its proof compares an
item count against a per-slot precedence label, so **the row's "blocking precondition" does not
block**. **TIER 1**, proven via four decision paths. One thing is **ALREADY BUILT** (`skillLineage`)
and one **previously-unnamed live defect** was found (`restoreOptions` offers a control the
cross-list deduper undoes).
**Author:** independent adversarial AC pass — no shared context with the implementing agent
**Repo:** `/home/user/boost-application-packet-platform`, branch `claude/three-small-ui-gaps`, head `00964a4`
**Date:** 2026-08-27
**Live Postgres connector:** DISCONNECTED / needs re-auth. No production query was run. Every claim
requiring live data is marked **UNVERIFIED** with the exact query that would settle it.

---

## 0. Method

Primary instruction: **falsify the ledger row before accepting it.** The row has been re-stated once
already after an earlier AC read corrected its mechanism, so its prose is treated as a *hypothesis*,
not as evidence. Where the ledger row, a code comment and the code disagree, **the code wins** and the
disagreement is stated explicitly.

(sections appended below as each is settled)

---

## B. FEASIBILITY TABLE — FIRST, per CLAUDE.md ("the table comes first")

One row per dependency a fix for this row would name. Every "Proof" is a command I actually ran in
this session against head `00964a4`; where a proof needs live data it is marked and NOT claimed.

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (command + result) | Verdict |
|---|---|---|---|---|
| **Per-pass attribution of a skill list** | `packetBuild.skillLineage(c1,c2,c3,pkg)` — `packetBuild.ts:128` | `appPackets.ts:627` → `packet.last_build.lineage` (`appPackets.ts:1144`); diagnostic only | `grep -rn "skillLineage" api/src app/src api/test` → 9 hits, incl. writer, persist site and `api/test/lineageCapture.test.mjs` | **ALREADY BUILT** (per-SLOT, diagnostic; deliberately not written to `swap_decision` — `packetBuild.ts:85-93`) |
| **`call2` payload at the swap call site** | `buildPackageForJD` returns `calls:{c1,c2,c3}` — `pipeline.ts:550` | `appPackets.ts:627` uses `built.calls.c2`; **`writeSwaps` at `:618` passes only `c1`+`c3`** | read `appPackets.ts:618-628`; `BuildSwapsInput` (`swaps.ts:139-151`) has **no `call2` field** | **EXISTS-BUT-CONSTRAINED** — in scope at the call site, not threaded into the function |
| **`skill_candidate.origin` accepting a Call-2 value** | `appSwaps.ts:61` insert | `swapsGet` returns `candidates` (`appSwaps.ts:100`) | `grep -rn "pass_b" …` → 6 hits total; `schema.ts:551` `check (origin in ('profile_original','pass_a','pass_b'))` | **EXISTS-BUT-CONSTRAINED** — a 3-value CHECK; `create table if not exists` is a no-op on an existing DB, so an explicit `ALTER` is required (precedent: `swap_decision_driver_check`, `schema.ts`) |
| **`swap_decision.rationale` (free text)** | `appSwaps.ts:69-78` | 6 render sites + 2 exact-match selectors (§5.2) | `grep -rn "rationale" api/src app/src` → 26 hits | **EXISTS** |
| **`swap_decision.driver` (4 values)** | `swaps.ts:279-280`, `:233` | **the gate**, compact-fit, 2 counts, 4 render sites (§5.1) | `schema.ts` + `grep -rn "\bdriver\b" api/src app/src` → 30 hits | **EXISTS** — and it is accusation-grade (§6) |
| **Record of what the CORRECTION pass changed** | `applyCorrectionPass` → `correction` rows (`appCorrections.ts:136-146`); mutates `pkg` at `:131` | `writeSwaps` already reads `correction … source='owner_edit'` for `ownerLabels` (`appSwaps.ts:45-49`) | read both; the join already exists | **EXISTS** — the hop from `correction` into swap attribution is already proven for owner edits |
| **Record of what the NORMALISER changed** | `normalisePackage` → `NormaliseChange{field, rule, before, after, note}` (`normalise.ts:37-43,232-242`) | **only `built.warnings` prose** (`appPackets.ts:571-575`) — nothing structured reads it | read `appPackets.ts:566-576`; `grep -n "pkg\[" normalise.ts` → in-place mutation at `:121`, `:214` | **EXISTS-BUT-CONSTRAINED** — the per-item before/after needed to attribute a reword/dedupe drop is produced and then flattened to a warning string |
| **The five lists the normaliser touches = the five `LIST_FIELDS[*].merge`** | `checks.ts:298-299` | `normalise.ts` plan; `swaps.ts:32-38` | `SKILL_FIELDS+RELEVANT_FIELDS` = `SkillsBullets1/2`, `RelevantBullets1/2/3` — byte-identical to `LIST_FIELDS.merge` | **EXISTS** (proven — this is why the mis-attribution reaches every list) |
| **A stored per-ITEM source for OLD builds (for a back-fill)** | nothing — `built.calls` is scope-local, discarded at the end of `buildTemplatedArtifact` | — | `grep -rn "last_build" api/src` → 4 hits; the only survivor is `lineage`, which is **per-slot** and only on the build-all path | **ABSENT** — this is what forces AC-11a (option C is a guess) |
| **The guards that pin the rationale/driver strings** | `app/test/assetBlocks.test.mjs:1233-1266` (`H:omit-caveat-rationale-parity`) | reads `api/src/functions/tests/swaps.ts` **as text** | read the test: asserts `sites === 1`, `ruleRows === 1`, and co-location on one `swaps.push({` | **EXISTS** — and a careless fix trips it (§5.3) |
| **Live Postgres, to settle the `9f9c370a` counts** | production | — | connector `boost-pg-mcp-write` reports *requires authentication* in this session | **ABSENT for this session** — owner must re-auth; queries given in §3.2 / §4.4, NOT run |

### The three headline verdicts, said first

1. **ALREADY BUILT:** per-pass attribution exists as `skillLineage`, per SLOT, deliberately kept out
   of `swap_decision`. **Extend it; do not build a second attributor.** AC-0 makes that a guard.
2. **NOT ALREADY FIXED:** all three defects the row names are present in the code at head `00964a4`
   (§2, §3, §4) — at line numbers ~9 lines below those the row cites.
3. **THE ROW'S STATED BLOCKER IS NOT A BLOCKER.** "Settle the 2-vs-4 count first" rests on comparing
   an item count against a per-slot precedence label (§4.2). The provenance work is not downstream
   of it.

---

## 1. First observation: the row's LINE NUMBERS are stale (fix the row, not just the code)

**OBSERVATION (proven — read the file at head `00964a4`).** Every line number the row cites is off by
9–10 lines against `api/src/functions/tests/swaps.ts` as it stands:

| Row cites | What is actually at that line today | Where the cited construct actually lives today |
|---|---|---|
| `swaps.ts:175` "after side from `pkg[f.merge]`" | `const omitted = omitEntries(omitList)` | **`swaps.ts:184`** — `const finals = splitItems(pkg[f.merge] ?? call3[f.passB])` |
| `swaps.ts:185` "`originOf(fin, 'pass_b')`" | `itemCount += finals.length` | **`swaps.ts:194`** |
| `swaps.ts:205` "'reworded by the ATS pass'" | `continue` (end of the `kept` branch) | **`swaps.ts:214`** |
| `swaps.ts:234` "'introduced by the ATS pass'" | `rationale: 'on the owner do-not-use list (MasterContext.itemsToOmit)'` | **`swaps.ts:243`** |

`swaps.ts:234` is the most dangerous of the four, because a line number that *resolves to a real
line with a real rationale string on it* reads as verified when it names the wrong string entirely.
The construct the row means exists; its address does not.

**INTERPRETATION.** This does not falsify any of the three claims — all four constructs are present,
verbatim, at the corrected addresses. It does mean **the row must be re-addressed by construct, not
by line**, and it is the second time this row's specifics have drifted from the code. Any AC that
cites a line number will rot the same way; ACs below cite constructs and strings.

---

## 2. CLAIM 1 — "`pass_b` means Call 3, so Call-2 insertions are credited to the ATS pass"

### 2.1 What `pass_b` actually is — traced to its definition and to every writer/reader

**OBSERVATION (proven — read every hit of `grep -rn "pass_b" api/src app/src api/test app/test`):**
there are exactly six occurrences in the whole repo.

| Site | What it is |
|---|---|
| `swaps.ts:8` (comment) | `Call 3 (ATS QC + merge) -> finalSkills1/2, finalRelevant1..3 = origin \`pass_b\`` |
| `swaps.ts:25` | `export type Origin = 'profile_original' \| 'pass_a' \| 'pass_b'` — the type, and its ONLY definition |
| `swaps.ts:194` | the only WRITE: `candidates.push({ list, label: fin, origin: originOf(fin, 'pass_b'), ... })` |
| `schema.ts:551` | `origin text not null check (origin in ('profile_original','pass_a','pass_b'))` on `skill_candidate` |
| `api/test/swaps.test.mjs:176,179` | a guard asserting exactly this behaviour (see 2.3) |

There is **no enum, no constant and no mapping table** that binds `pass_b` to "Call 3". The string is
a bare literal, and its meaning lives in **one comment** (`swaps.ts:8`) plus the field map at
`swaps.ts:32-38`, which pairs `passB` with `finalSkills1` / `finalRelevant1..3`.

**The field map is the load-bearing evidence, not the comment.** `LIST_FIELDS[*].passB` names
`finalSkills1/2` and `finalRelevant1/2/3`; `pipeline.ts:520` assembles the package with
`assemblePackage(c1, call2Draft(c2), c3)`, and `mt17.ts:148-157` reads `call3.finalSkills1`,
`call3.finalSkills2`, `call3.finalRelevant1..3` — i.e. **the `final*` field family belongs to `c3`,
which `pipeline.ts:511` sets from Call 3's parsed JSON (`const c3: any = p3.value || {}`).**

> **VERDICT on "what `pass_b` refers to": the row is CORRECT, and now proven from code rather than
> from its own prose.** `pass_b` is the Call-3 / ATS-QC pass, established by `LIST_FIELDS.passB`
> naming the `final*` family and `assemblePackage`/`pipeline` sourcing that family exclusively from
> `c3`. The comment at `swaps.ts:8` agrees with the code; here they do not disagree.

### 2.2 Is the label actually applied to Call-2 items? — the falsification attempt

The strongest available falsification would be that `pass_b` is a THREE-pass-agnostic label meaning
"not Call 1" rather than "Call 3". Two things kill that reading:

1. `Origin` has exactly three values and the other two are specific (`profile_original`, `pass_a`).
   A deliberately-vague third value beside two specific ones is not what the type says.
2. `swaps.ts:194` sets it on `fin`, and `fin` comes from `splitItems(pkg[f.merge] ?? call3[f.passB])`
   (`swaps.ts:184`) — the **SHIPPED** list. `assemblePackage` (`mt17.ts:148`) fills that list as
   `firstNonEmpty(call3.finalSkills1, call2.skills1, call1.skills1, splitS1)`. **So the shipped list
   is Call 2's whenever Call 3 produced nothing for that slot** — and `buildSwaps` labels every item
   in it `pass_b` regardless.

**`buildSwaps` cannot tell the difference even in principle: `BuildSwapsInput` (`swaps.ts:139-151`)
has `call1`, `call3`, `pkg`, `requirements`, `profileText`, `omitList`, `ownerLabels` — and NO
`call2`.** `appSwaps.writeSwaps` (`appSwaps.ts:30-32`) takes the same set and passes it through
(`appSwaps.ts:51`). Call 2 is not merely mis-labelled; it is **not an input to the swap system at
all**. That is the mechanism, and it is stronger than the row states.

> **CLAIM 1: CONFIRMED, and the mechanism is one step deeper than the row says.** Not "the label is
> wrong"; **the discriminating input does not reach the function.** A fix that only renames the
> label cannot be correct.

### 2.3 The existing guard AGREES with the defect — so it will fight the fix

`api/test/swaps.test.mjs:176-180`:

```js
test('pass_b origin is recorded for items only the ATS pass produced', () => {
  const r = buildSwaps({ call1: { skills1: 'A one' }, call3: {}, pkg: { SkillsBullets1: 'A one\nZ nine' } })
  assert.equal(r.candidates.find(c => c.label === 'Z nine').origin, 'pass_b')
```

**OBSERVATION (proven — read the test).** The fixture passes **`call3: {}`** — Call 3 produced
NOTHING — and the guard asserts the new item is nevertheless recorded as `pass_b`, "the ATS pass".
This is the defect written down as an expectation. **Any correct fix makes this test fail**, and it
must be rewritten in the same commit, not deleted.


---

## 3. CLAIM 2 — "the stored rationale is a false statement"

The row says the strings are false *because Call 3 returned 0 characters and Call 2 did the work*.
I tried to falsify both halves. The strings are there; **the stated reason for their falsity is
narrower than the truth**, and the narrow version is UNVERIFIABLE from here.

### 3.1 The strings, at their real addresses (proven — read the file)

- `swaps.ts:214` — `swaps.push(row(list, 'swapped', o, finals[bestI], attribute(...), 'reworded by the ATS pass', ownerLabels))`
- `swaps.ts:243` — `swaps.push(row(list, 'added', null, finals[i], attribute(...), 'introduced by the ATS pass', ownerLabels))`
- `swaps.ts:237` — `'not carried into the final list'` on a `dropped` row (the row does not mention this one; see 3.4 — it is the same defect)
- `swaps.ts:228` — `'folded into an item that already covers it'` on `merged`
- `swaps.ts:203` — `'unchanged from the first pass'` on `kept`

Both strings are **unconditional literals**: they are passed positionally into `row()` at a single
call site each, with no branch, no interpolation, and nothing that could make them situational.
**Every `swapped` row in the database says "the ATS pass" reworded it, and every `added` row says
"the ATS pass" introduced it, whatever actually happened.** That much is proven from the code alone
and does not depend on any claim about what Call 3 returned.

### 3.2 Does Call 3 return 0 characters for the five `final*` fields? — UNVERIFIED, and CONDITIONAL

**OBSERVATION (proven from `pipeline.ts:505-517`).** Call 3's payload is
`const p3 = parseAgentJson(r3.choices?.[0]?.message?.content)` then `const c3: any = p3.value || {}`.
Three distinct outcomes are already distinguished IN CODE, each with its own warning:

| Condition | Code | Result for `finalSkills1..2` / `finalRelevant1..3` |
|---|---|---|
| no parseable JSON object | `if (!p3.value) warnings.push('Call 3 (ATS QC) returned no JSON object …')` | `c3 = {}` → all five fields absent |
| parsed but empty | `qcApplied = !!p3.value && !isEmptyResult(p3.value)` → `'…returned an empty object…'` | present-but-empty |
| parsed with content | `qcApplied: true` | **the five fields can be non-empty** |

> **So "Call 3 returns 0 characters for all five `final*` fields" is NOT a property of the code.
> It is a property of particular runs.** The code is explicitly built to handle both. The correct
> statement is *"…when the ATS pass returns no JSON / an empty object, which the pipeline already
> warns about"* — and the row states it as unconditional. **The row overstates here.**

**UNVERIFIED — the live Postgres connector is disconnected, so I did not query.** The query that
would settle it (packet-level, no guessing):

```sql
-- what each pass produced for the five slots on the builds in question
select p.id as packet_id, p.opp_id,
       jsonb_array_elements(p.last_build->'lineage') as slot
  from packet p
 where p.opp_id::text like '9f9c370a%'
 order by p.updated_at desc limit 5;
-- `winner` per slot is call1|call2|call3|none, and call3 = '' proves the 0-character claim per slot.
```
`packet.last_build.lineage` is written by `skillLineage` (`packetBuild.ts:128`) from the same three
payloads, at the same call site (`appPackets.ts:627`) — **it is the ground-truth source for this
exact question and it is already stored.** No new instrumentation is required to settle claim 2.

**Corroborating (INFERENCE, not proof).** `.claude/DEFERRED.md:149` (`D31`, CLOSED, deploy `4fb00e1`)
measures that when Call 2's output began being parsed, the SHIPPED lists changed:
`SkillsBullets1` 232 → 385, `SkillsBullets2` 153 → 239, `RelevantBullets1/2/3` 89/94/89 → 65/60/63.
`assemblePackage` (`mt17.ts:148-157`) is `firstNonEmpty(call3.finalX, call2.x, call1.x)` — **Call 3
outranks Call 2**, so the shipped value could only have moved to Call 2's if `call3.final*` was empty
for all five slots on that build. Confidence: high for that build; it says nothing about every build.

### 3.3 The falsification that FAILED, and made the claim WORSE

I looked for the reading that would make "the ATS pass" defensible: that `pkg[f.merge]` is a
Call-3-authored list by construction, so crediting Call 3 is right by definition. **It is not.**
Traced at the one call site that writes swap rows (`appPackets.ts:520-618`), the `pkg` object handed
to `writeSwaps` has been mutated in place by **two further producers after assembly**:

| Order | Producer | Site | What it does to the five lists |
|---|---|---|---|
| 1 | `assemblePackage(c1, call2Draft(c2), c3)` | `pipeline.ts:520` | picks Call 3, else Call 2, else Call 1 per slot |
| 2 | `applyCorrectionPass` | `appPackets.ts:533`; mutates at `appCorrections.ts:131` (`pkg[field] = applyCorrections(...)`) | rewrites echoed phrases; **re-applies the OWNER's own edits** |
| 3 | `dedupeAcrossLists` | `normalise.ts:100-123`; mutates at `:121` (`pkg[f] = joinItems(kept)`) | **DELETES items** that appear in another list |
| 4 | `enforceCharLimits` | `normalise.ts:139-214`; mutates at `:214` (`pkg[field] = joinItems(next)`) | **REWORDS items with a `gpt-4o-mini` call** (`feature: 'normalise:reword'`, `appPackets.ts:566`) |

`normalise.ts` operates on `SKILL_FIELDS` + `RELEVANT_FIELDS` = `['SkillsBullets1','SkillsBullets2',
'RelevantBullets1','RelevantBullets2','RelevantBullets3']` (`checks.ts:298-299`) — **byte-identical
to the five `LIST_FIELDS[*].merge` values `buildSwaps` compares.** This is proven, not inferred.

> **Consequence: there are FIVE possible authors of a change on a swap row, not two.** Call 2,
> Call 3, the correction pass, the cross-list deduper, and the `normalise:reword` model call. Today
> **all five are recorded as "the ATS pass"**, and two of them are not even generation passes:
> - a `dropped` row saying *"not carried into the final list"* may be the **deduper** removing a
>   duplicate that IS still in the document, one list over;
> - a `swapped` row saying *"reworded by the ATS pass"* may be the **character-limit rewriter**,
>   a different call with a different prompt and a different purpose.

> **CLAIM 2: CONFIRMED AS TO THE DEFECT, OVERSTATED AS TO ITS REASON, and UNDERSTATED AS TO ITS
> SCOPE.** The two strings are unconditional and therefore false whenever anything but Call 3 acted.
> "Call 3 returns 0 characters" is a run-property, not a code-property, and is UNVERIFIED here.
> The row names 2 candidate authors; the code has 5.

### 3.4 A defect the row does NOT name, found by the same trace

`swaps.ts:237` writes `'not carried into the final list'` on every unexplained `dropped` row. After
`dedupeAcrossLists`, that sentence can be **factually wrong about the document**: the item was
carried, into a different list, and deliberately de-duplicated. The `merged` branch exists precisely
to avoid telling a reviewer "its content is missing from the document when it is in fact present"
(`swaps.ts:217-219`) — the deduper reopens exactly that hole from outside `buildSwaps`' view. This
belongs in the same fix and is covered by AC-6 below.


---

## 4. CLAIM 3 — "an unreconciled count: kept 8, swapped 1, dropped 1, added 1 (2 of 10 finals)"

The row calls this **a blocking precondition**. It is the claim I was most able to attack, and it
does not survive in the form stated.

### 4.1 The arithmetic is internally consistent (proven from `buildSwaps`)

Per list, `buildSwaps` emits **exactly one row per original** (`kept` | `swapped` | `merged` |
`dropped`, `swaps.ts:199-239`) plus **one row per unclaimed final** (`added`, `swaps.ts:241-244`).
So for the quoted tally: originals = 8+1+1 = 10; finals = kept 8 + swapped 1 + added 1 = 10;
`itemCount` = 10; finals differing from Call 1 = swapped 1 + added 1 = 2. **The tally is
self-consistent and nothing is "missing" from it.** `merged` is 0 in the quote — note it is a
possible action the tally does not list, so a query that omitted it would be invisible.

### 4.2 The comparison itself is a CATEGORY ERROR — this is the falsification

**OBSERVATION (proven — `packetBuild.ts:128-142`).** `skillLineage`'s `winner` is:

```ts
!final ? 'none'
  : sameList(final, call3) ? 'call3'
  : sameList(final, call2) ? 'call2'
  : sameList(final, call1) ? 'call1'
  : 'none'
```

Three properties of that expression, each fatal to "the lineage shows Call 2 replaced 4":

1. **It is per-SLOT, not per-ITEM.** There are five slots. `winner: 'call2'` on 4 slots is a
   statement about four whole LISTS, and the swap tally counts individual ITEMS. 4 and 2 are not
   the same unit and were never comparable.
2. **`winner` is PRECEDENCE, not difference.** `sameList(final, call2)` is tested *before*
   `sameList(final, call1)`. **If Call 2 returned exactly Call 1's list, the slot still reports
   `call2`.** So `winner: 'call2'` is not evidence that Call 2 *replaced* anything — it means "the
   highest-precedence pass whose list matches what shipped". The source comment says as much:
   *"`winner` is derived from the values, never asserted alongside them"* — derived by matching,
   not by diffing.
3. **`final` is `pkg[slot]` AFTER the correction pass and the normaliser** (section 3.3), so a slot
   whose items were reworded for the character limit matches none of the three and reports `none`.
   `sameList` normalises bullet prefixes only (`packetBuild.ts:124`) — it does not normalise a
   reword.

> **CLAIM 3: NOT ESTABLISHED. The "2 vs 4" discrepancy is, on the evidence in the row itself, an
> artefact of comparing an item count against a slot-precedence label.** I did not find an
> accounting bug in `buildSwaps`; I found that the two numbers were never measuring the same thing.
> This does not prove the counts are right — it proves the stated proof of their being wrong is
> invalid.

### 4.3 Three further scoping artefacts that could produce the same appearance (each UNVERIFIED)

Any of these alone reproduces "the numbers don't add up" with no bug present. All are properties of
how the quoted query was scoped, and I cannot inspect that query:

| # | Artefact | Proof it is possible (code) |
|---|---|---|
| A | **`swap_decision` has no `opp_id`.** Counting "for opportunity `9f9c370a`" requires joining `packet`, and **an opportunity may own several packets** — `loadPacket` selects `order by round desc, created_at desc limit 1` and its own comment says "the pick among several packets" (`appPackets.ts:69-75`). A count across packets mixes builds. | `schema.ts` `swap_decision(packet_id …)`; `appPackets.ts:75` |
| B | **`loop`.** Rows are keyed `unique (packet_id, list, seq, loop)` and `swapsGet` deliberately separates `swaps` (every pass) from `current` (`loop = max`), warning that "a caller reading the full array as if it were one pass double-counts". A count that ignores `loop` over-counts; one that assumes `loop=0` may miss remediation passes. | `appSwaps.ts:105-118`; `schema.ts` |
| C | **The five lists.** `itemCount` 10 across FIVE lists is low against `D31`'s measured build (`SkillsBullets1` 385 chars ≈ 10–11 items in ONE list). A tally of 10 finals is consistent with most lists being empty **or** with the count covering one list. | `.claude/DEFERRED.md:149`; `swaps.ts:181-185` |

### 4.4 What would actually settle it — UNVERIFIED, connector disconnected

**I did not run this.** One query, scoped explicitly, settles the count and the lineage together:

```sql
select p.id as packet_id, s.loop, s.list, s.action, count(*)
  from swap_decision s
  join packet p on p.id = s.packet_id
 where p.opp_id = '9f9c370a-....'::uuid          -- full uuid required
 group by 1,2,3,4
 order by 1,2,3,4;

select p.id, p.updated_at, p.last_build->'lineage'
  from packet p where p.opp_id = '9f9c370a-....'::uuid order by p.updated_at desc;
```
Reconcile **within one `(packet_id, loop)`**: `kept+swapped+merged+dropped` must equal the number of
Call-1 items across the five lists, and `kept+swapped+added` must equal `itemCount`. Only a
violation of *those* identities is an accounting bug. Comparing either against `lineage.winner` is
not a test of anything (4.2).

> **Consequence for sequencing: the row's stated BLOCKING PRECONDITION does not block.** "Settle the
> 2-vs-4 count first" rests on a comparison that is invalid by construction. The provenance fix
> (claims 1 and 2) is not downstream of it and can proceed. The count check should still be run —
> as a reconciliation of the identities above, which is a different and cheaper question.


---

## 5. BLAST RADIUS — every consumer of `driver` and `rationale`

Swept with `grep -rn "\bdriver\b" --include=*.ts --include=*.js --include=*.jsx api/src app/src` and
the same for `rationale`. **13 consumers, in two languages, four of which decide something.** The
row names none of them.

### 5.1 `driver`

| # | Consumer | Site | What it does with `driver` | Decides? |
|---|---|---|---|---|
| 1 | **`changes_cited` — THE GATE** | `checks.ts:921-929` | `changes = swaps.filter(s => (action swapped\|added) && driver !== 'owner')`; `uncited = changes.filter(s => s.driver !== 'posting')`; emits `bad(...)` which defaults to **`state: 'fail'`** (`checks.ts:192`) and **NAMES EACH OFFENDER** (`uncited.map(s => \`${s.action}: ${s.to_label \|\| s.from_label}\`)`) | **YES — blocks approval and names an offender** |
| 2 | **`compact_skills_fit` → `fitCompactSkills`** | `checks.ts:867-877` → `compactFit.ts:113` `if (p.driver === 'posting' \|\| p.requirementId) return 2 // answers the posting - never dropped` | `driver` sets a skill's **protection tier**, deciding which skills are cut from the compact resume to fit the budget | **YES — decides shipped document content** |
| 3 | `appChecks.runArtifactChecks` | `appChecks.ts:44` `select action, driver, to_label, from_label, requirement_id, seq, list from swap_decision` | the transport that feeds 1 and 2 | feeds a gate |
| 4 | `appPackets` compact-fit projection | `appPackets.ts:687-694` `select list, seq, action, driver, ...` → `{ action, driver, requirementId, seq }` | the second feed into `fitCompactSkills` | feeds a decision |
| 5 | `swapsGet.unattributed` | `appSwaps.ts:123` `changes.filter(s => s.driver !== 'owner' && s.driver !== 'posting').length` | the count printed beside the gate; its own comment says three places counted this and disagreeing is the bug | **YES — a published count** |
| 6 | `buildSwaps.unattributed` | `swaps.ts:251-252` | same predicate, returned from `writeSwaps` | a count |
| 7 | **`omitListCaveat`** | `assetBlocks.js:574` `s.action === 'dropped' && s.driver === 'rule' && s.rationale === OMIT_LIST_RATIONALE` | prints *"The last run took X out of this list because it is on your do-not-use list"* | **YES — an accusation shown to the owner** |
| 8 | `listBodyModel` status line | `assetBlocks.js:711-718` | interpolates the **raw enum** into `` `${swap.action} · ${swap.driver}` `` | renders |
| 9 | `meterModel.postingDriven` | `assetBlocks.js:825` `changed.filter(s => s.driver === 'posting')` | a coverage stat | a published count |
| 10 | `QcRail.jsx:346` / `AssetGateDrawer.jsx:300` | branches on `driver === 'owner'` / `'unattributed'`, else prints `s.rationale \|\| String(s.driver)` | renders **the rationale directly to the owner**, with the raw enum as fallback | renders |

### 5.2 `rationale`

| # | Consumer | Site | What it does |
|---|---|---|---|
| 11 | **`omitListCaveat`** | `assetBlocks.js:574` | **EXACT** match `s.rationale === OMIT_LIST_RATIONALE` |
| 12 | **`restoreOptions`** | `assetBlocks.js:613` | **EXACT** negative match `s.rationale !== OMIT_LIST_RATIONALE` — decides which "Put back X" controls exist |
| 13 | `AssetBlocks.jsx:585,1051-1058` | "Why it changed" | `[...new Set(swapsForList.filter(s => s.rationale && s.action !== 'kept').map(s => s.rationale))]` — **the rationale strings are printed verbatim to the owner** |
| 14 | `AssetBlocks.jsx:409` | "Taken out of this list" | `<s>{s.from_label}</s>{s.rationale ? \` - ${s.rationale}\` : ''}` — verbatim |
| 15 | `QcRail.jsx:346`, `AssetGateDrawer.jsx:300` | QC rail / gate drawer | verbatim |
| 16 | `reviewer.ts:52` | a BANNED-TERM list (`'rationale','swap','swap_decision','driver'`) | the reviewer must not see them — an exclusion, but a real dependency on the names |

### 5.3 The guards a fix WILL collide with — stated explicitly, as required

**(a) `H:omit-caveat-rationale-parity` (`app/test/assetBlocks.test.mjs:1233-1266`)** asserts three
structural facts **by reading `api/src/functions/tests/swaps.ts` as text**:
```js
assert.ok(swapsSrc.includes(`rationale: '${OMIT_LIST_RATIONALE}'`), ...)
const sites = swapsSrc.split(`rationale: '${OMIT_LIST_RATIONALE}'`).length - 1
assert.equal(sites, 1, 'a second producer of the omit rationale appeared; omitListCaveat assumes exactly one')
const ruleRows = (swapsSrc.match(/driver: 'rule'/g) || []).length
assert.equal(ruleRows, 1, "a second driver:'rule' drop exists; it produces no caveat and a restore control that the next pass undoes")
// ...and the omit rationale must sit on the same `swaps.push({` object as `driver: 'rule'`
```
Its own comment records the mutation result: **deleting the `driver === 'rule'` half left 372/372
green**, because exactly one site writes that rationale — so the driver check is *documentation, not
protection*, and **the load-bearing assumption is "the rationale implies the driver".**

**(b) Does the fix proposed below break them? — ANSWER: NO, IF AND ONLY IF it obeys three
constraints, and each is written as an AC.**
- It must **not** add a second `driver: 'rule'` write site. The deduper drop (§3.4) is the obvious
  temptation — it *is* a deterministic rule — and taking it would trip `ruleRows === 1`. **AC-6
  routes it as a distinct `driver` value or as a rationale on the existing driver, not as a second
  `'rule'` row**, and if a second rule row is ever wanted, `omitListCaveat` and `restoreOptions`
  must be extended in the SAME commit (which is precisely what that guard exists to force).
- It must **not** reword `OMIT_LIST_RATIONALE`. Changing it silently switches the caveat OFF and
  simultaneously switches a "Put back X" control ON for a phrase the next run removes again —
  self-undoing UI, the exact failure `restoreOptions` was built to prevent.
- **`restoreOptions` filters `rationale !== OMIT_LIST_RATIONALE`, so ANY new `dropped` rationale is
  automatically offered as restorable.** A fix that adds honest drop rationales must decide, per
  rationale, whether the drop is deterministically repeated. **This is where the fix can silently
  change what the UI accuses without touching a line of app code** — the risk the brief names.

**(c) A live defect this sweep found, which the row does not name.** `omitListCaveat`'s doc states
*"THE ONLY DETERMINISTIC REVERTER IN THE PIPELINE is the owner's do-not-use list"*
(`assetBlocks.js:523-527`). **That is false today.** `dedupeAcrossLists` (`normalise.ts:100-123`) is
pure code, runs on every build over the same five fields, and removes an item that appears in an
earlier list — deterministically, every run. Its removals surface as `dropped` rows with the generic
rationale, so **`restoreOptions` offers a "Put back X" control that the next build undoes**: the
self-undoing control that guard was written to prevent, arriving through a producer the guard cannot
see. **OBSERVATION** = the four cited code sites. **INTERPRETATION** = that the control is offered in
practice; it requires the deduper to have actually fired on that field (`roundTripSafe` must hold and
the item must appear in two lists), which I could not exercise here. Confidence: high, unproven.


---

## 6. TIER — **TIER 1 (accusation grade)**, and here is the proof rather than the assertion

CLAUDE.md: *"tier 1 is a property of the CODE PATH: anything that decides `must_have_coverage`, the
artifact gate, a score, a coverage count, or that names an offender."* Four independent paths from
`swap_decision.driver`/`rationale` satisfy that, all traced above:

1. **The artifact gate.** `checks.ts:921-929` → `bad('changes_cited', …)` defaults to `state: 'fail'`
   (`checks.ts:192`) → `gateFor(results)` → `artifact_gate` → `appChecks.ts:205-208` returns
   `{blocked}` for approval. **And it names the offender by label.**
2. **Shipped document content.** `compactFit.ts:113` gives a `driver === 'posting'` skill protection
   tier 2 — *"answers the posting - never dropped"* — so `driver` decides which skills are cut from
   the compact resume the owner sends.
3. **Published counts.** `swapsGet.unattributed` (`appSwaps.ts:123`) and `meterModel.postingDriven`
   (`assetBlocks.js:825`).
4. **A sentence shown to the owner as the reason their words changed.** `AssetBlocks.jsx:1051-1058`
   ("Why it changed"), `:409` ("Taken out of this list"), `QcRail.jsx:346`,
   `AssetGateDrawer.jsx:300`, and `omitListCaveat`'s *"The last run took X out of this list…"*.

`packetBuild.ts:85-93` states the same boundary from the other side — lineage is diagnostic and
*"must never be written into … `swap_decision` — those are accusation-grade"*. **That comment is a
claim about the code; the four paths above are the code, and they agree with it.**

> **Process required (CLAUDE.md tiering table): independent AC subagent BEFORE coding — this
> document — an independent `verifier` after, every new guard mutation-proven, and live
> verification. No step may be skipped on the ground that the change is small.**

---

## 7. ACCEPTANCE CRITERIA

Numbered, binary, and cited to constructs (never line numbers — §1). **AC-0 first, because part of
this is already built.**

### Already built — write a guard, not a feature

**AC-0 (regression guard, `skillLineage`).** Given the pipeline already captures per-slot pass
attribution in `packetBuild.skillLineage` and persists it at `packet.last_build.lineage`
(`appPackets.ts:1144`), when the swap-provenance fix is implemented, then it **extends that
existing attribution rather than standing up a second one**, and a guard asserts
`buildSwaps`' per-item origin and `skillLineage`'s per-slot `winner` **cannot disagree** for a slot
where all items share one origin. *(Extend-don't-duplicate. `skillLineage` is ALREADY BUILT and is
the only existing answer to "which pass wrote this".)*

**AC-0b (regression guard, `winner` semantics).** Given `skillLineage.winner` is precedence-ordered
(`sameList(final, call2)` is tested before `sameList(final, call1)`), when any code or document
compares a lineage `winner` count against a swap-row count, then a guard/comment records that
**`winner` is not a change count** — a slot where Call 2 returned Call 1's list still reports
`call2`. *(This is the misreading that produced claim 3; it must not recur.)*

### The provenance defect

**AC-1.** Given a build where a final list item came from **Call 2** (i.e. `assemblePackage` fell
through to `call2.skillsN`/`relevantN` because `call3.finalX` was empty), when `writeSwaps` records
its `skill_candidate`, then `origin` is **a value that denotes Call 2** and is **not** `pass_b`.

**AC-2.** Given `buildSwaps` today cannot distinguish Call 2 from Call 3 because
`BuildSwapsInput` has no `call2` (`swaps.ts:139-151`), when the fix lands, then **`call2` is
threaded from `built.calls.c2` through `writeSwaps` into `buildSwaps`**, and a guard fails if
`buildSwaps` is called from `appSwaps` without it. *(The discriminating input must reach the
function; a rename alone cannot be correct.)*

**AC-3 (schema).** Given `skill_candidate.origin` carries `check (origin in
('profile_original','pass_a','pass_b'))` and `create table if not exists` is a **no-op on an
existing database** (`schema.ts` says so in the `swap_decision.driver` note), when a new origin value
is introduced, then an **explicit `alter table … drop constraint … / add constraint …`** ships in the
same change — following the existing `swap_decision_driver_check` precedent — and applying the new
`SCHEMA_SQL` **on top of `origin/main`'s schema with rows already seeded** exits 0 (the populated-DB
rule in CLAUDE.md).

**AC-4.** Given the existing guard `api/test/swaps.test.mjs:176-180` asserts a Call-3-empty fixture
yields `origin: 'pass_b'` — **the defect written down as an expectation** — when the fix lands, then
that test is **rewritten in the same commit** to assert the honest origin, and the suite fails if it
is merely deleted.

### The false rationale

**AC-5.** Given `swaps.ts` writes the unconditional literals `'reworded by the ATS pass'` and
`'introduced by the ATS pass'`, when a swap row is written, then its `rationale` **names the producer
that actually changed the text**, chosen from the producers that exist at the call site: Call 1,
Call 2, Call 3 (ATS), the **correction pass** (`applyCorrectionPass`), the **cross-list deduper**
(`dedupeAcrossLists`), and the **character-limit rewriter** (`enforceCharLimits`,
`feature: 'normalise:reword'`). A guard asserts **no unconditional pass-naming literal survives** in
`swaps.ts` (grep for `'the ATS pass'` returning 0 hits on a change path).

**AC-6 (the deduper).** Given `dedupeAcrossLists` deletes an item that is still present in another
list, when that produces a `dropped` swap row, then its rationale **states the item was kept in the
other list and names that list**, and does **not** say *"not carried into the final list"* — which is
false about the document. **Constraint:** it must NOT be written as a second `driver: 'rule'` row
unless `omitListCaveat` and `restoreOptions` are extended in the same commit — `H:omit-caveat-
rationale-parity` asserts `ruleRows === 1` and will fail (§5.3).

**AC-7 (the self-undoing control).** Given `restoreOptions` offers "Put back X" for every `dropped`
row whose rationale is not `OMIT_LIST_RATIONALE` (`assetBlocks.js:613`), and given the deduper is a
**second deterministic reverter**, when a deduper-driven drop is recorded, then **no restore control
is offered for it** (or the caveat speaks instead), and a guard asserts it — the same invariant
`H:restore-never-offers-a-phrase-the-rule-will-remove-again` already encodes for the omit list.

### THE HONEST-ABSENCE CASE — required by "absent evidence is never a pass"

**AC-8.** Given a final item that matches **no** payload — not `call1`, not `call2`, not `call3`,
and not attributable to a recorded correction or normaliser change — when its row is written, then
`origin` and `rationale` **state that the producing pass could not be determined**, naming no pass.
A rationale that guesses (defaults to the last pass, to "the ATS pass", or to the highest-precedence
pass) **fails this AC** — it is the same defect in a new coat.

**AC-9.** Given `swap_decision.driver` already has the value `'unattributed'` meaning *"the MODEL
made a change it cannot explain"* (`swaps.ts:19-21`, `:247-252`), when the honest-absence case
arises, then it is expressed **without changing what `driver` means** — `driver` answers *"what
justifies this change"* and the new information answers *"which pass made it"*. A guard asserts the
`unattributed` count returned by `swapsGet` (`appSwaps.ts:123`), by `buildSwaps` (`swaps.ts:251`) and
by `changes_cited` (`checks.ts:921-922`) **still agree with each other** after the change — their own
comments record that these three disagreeing is a known past defect.

**AC-10 (no new accusation).** Given the fix changes strings that `omitListCaveat` and
`restoreOptions` match **exactly**, when the suite runs, then `OMIT_LIST_RATIONALE` is **byte-
identical** on both sides, `H:omit-caveat-rationale-parity` passes **unmodified**, and a guard
asserts the set of `(action, driver)` pairs that produce a restore control is **unchanged** unless
deliberately extended. *(This is the "silently change what they accuse" risk stated in the brief.)*

### MIGRATION — rows already in production carry the false rationale

**AC-11 (the decision, and it must be made explicitly).** Given `swap_decision` rows written before
this fix carry `'reworded by the ATS pass'` / `'introduced by the ATS pass'` and an `origin` of
`pass_b` that may be false, when the fix ships, then **one of these three is chosen and recorded in
`.claude/actions.md`** — with the UI consequence stated for each:

| Option | What happens to old rows | What the UI shows | Cost / risk |
|---|---|---|---|
| **A — leave** | untouched | old rows keep asserting "the ATS pass"; new rows are honest → **two contradictory vocabularies on the same screen**, and `AssetBlocks.jsx:585` de-duplicates rationales into one "Why it changed" list where they sit side by side | cheapest; **ships a known-false sentence** |
| **B — version** (recommended shape) | add a marker (e.g. a `provenance_version` column, default 0; new rows 1) | the UI prints old rationales with an explicit *"recorded before pass attribution was corrected"* qualifier, or suppresses the pass claim for v0 rows | one nullable column + one render branch; **no rewriting of history** |
| **C — correct in place** | `update swap_decision set rationale = …` | uniform | **rewrites a stored provenance record from a derivation the original payloads no longer exist to support** — `built.calls` are discarded at the end of `buildTemplatedArtifact`, so a back-fill would be a GUESS, which AC-8 forbids |

**AC-11a.** Given option **C** would require re-deriving attribution from payloads that no longer
exist (`pipeline.ts` returns `calls` only to the live scope; only `packet.last_build.lineage` — a
**per-slot** record, and only for the build-all path — survives), when the decision is made, then
**C is rejected unless a per-item source for the old builds is demonstrated to exist**. *(Otherwise
the migration commits the exact defect being fixed, at scale, with no way to detect it.)*

**AC-12 (the rebuild path is not a migration).** Given `writeSwaps` runs
`delete from swap_decision where packet_id=$1 and loop=$2` and re-inserts on every build
(`appSwaps.ts:55`), when a packet is rebuilt after the fix, then its rows are honest **for that loop
only**, and earlier loops' rows persist untouched — so *"it fixes itself on rebuild"* is **false for
the audit trail** and must not be offered as the migration answer.

### Regression / reconciliation

**AC-13 (the count identities, replacing the row's blocked precondition).** Given claim 3's "2 vs 4"
compares an item count with a slot label (§4.2), when the counts are checked, then it is done as
**two identities within a single `(packet_id, loop)`**: `kept + swapped + merged + dropped` = the
number of Call-1 items across the five lists, and `kept + swapped + added` = `itemCount`. A guard
asserts both hold for `buildSwaps` over generated fixtures. **Only a violation of these is an
accounting bug.**

**AC-14 (nothing downstream moves).** Given the 13 consumers listed in §5, when the fix lands, then
for a fixture built by the **real** `buildSwaps` (not a hand-written row): `changes_cited` reaches
the same state, `fitCompactSkills` drops the same skills, `swapsGet.unattributed` returns the same
number, and `omitListCaveat` / `restoreOptions` return the same output — **unless the change is
deliberate and named in the commit message.** *(`ownerGate.test.mjs:112` already records why the
fixture must be produced by the real function: guards that only see fixtures they built themselves
pass on rows the system never produces.)*

---

## 8. SEQUENCE BY COST — cheapest and unblocked first

| # | Item | Cost | Blocked by |
|---|---|---|---|
| 1 | **Re-address the ledger row by construct, not line number**, and correct claim 3's stated proof (§1, §4.2) | minutes, doc-only (tier 3) | nothing |
| 2 | **AC-0b** — record that `winner` is precedence, not difference | minutes | nothing |
| 3 | **AC-13** — the two count identities as a unit guard over `buildSwaps` fixtures | small, local, deterministic | nothing. **Note this REPLACES the row's "blocking precondition"** — no live data needed |
| 4 | **AC-2** — thread `call2` through `writeSwaps` → `buildSwaps` (signature only, no behaviour change yet) | small | nothing; `built.calls.c2` is already in scope at `appPackets.ts:627` |
| 5 | **AC-1 + AC-4** — per-item origin from `call2`, and rewrite the guard that encodes the defect | medium | 4 |
| 6 | **AC-3** — the `origin` CHECK migration, executed against a POPULATED copy of `origin/main`'s schema | medium | 5 (needs the final value name) |
| 7 | **AC-5 + AC-8 + AC-9** — honest rationales, honest absence, count parity | medium | 4, 5 |
| 8 | **AC-6 + AC-7 + AC-10** — deduper drops, no self-undoing control, guards unbroken | medium | 7, and the `H:omit-caveat-rationale-parity` constraints in §5.3 |
| 9 | **AC-11 / AC-11a** — the migration decision | **a DECISION, not work** | needs the owner; A/B/C are laid out above |
| 10 | **AC-14** — full downstream re-run | cheap suite, run on **every** loop per CLAUDE.md 0c | 5–8 |
| 11 | **Live confirmation** — the `9f9c370a` counts and the `last_build.lineage` read (§3.2, §4.4) | one query each | **BLOCKED: the `boost-pg-mcp-write` connector needs re-auth.** The owner must re-authorise it; a GitHub-Actions round-trip is the documented fallback and is explicitly NOT built here |

---

## 9. What I did NOT verify — stated plainly

- **No production query was run.** The `boost-pg-mcp-write` connector reports as requiring
  authentication in this session. Claim 3's stored counts, and whether Call 3 returned 0 characters
  on any specific build, are **UNVERIFIED**. §3.2 and §4.4 give the exact queries.
- **I did not run the test suites or a build.** Every code statement here is from reading the source
  at head `00964a4`; each is cited to a file and construct so it can be re-read.
- **The `restoreOptions`-offers-a-deduper-drop defect (§5.3c) is an INFERENCE**, high confidence,
  from four code sites. Exercising `dedupeAcrossLists` against a real package would prove it.
