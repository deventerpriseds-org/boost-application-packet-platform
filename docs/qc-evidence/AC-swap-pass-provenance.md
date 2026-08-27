# AC pass — `D:swap-screen-reads-a-dead-pass` (swap provenance / rationale / count)

**Status:** IN PROGRESS (written incrementally; whatever is here is the deliverable)
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

