# VERIFY — loop-zero-and-status-render (loop 1)

Independent verifier. Started 2026-08-29.

## Baseline (observed)
- `/home/user/boost-application-packet-platform` local HEAD = `12ddfb6` == `origin/main` = `12ddfb6`. CONFIRMED deployed SHA matches brief.
- `/workspace/eds-claude-skills` branch `claude/session-handoff-setup-ctozd3` HEAD = `308071b`; `origin/main` = `d7e760b` (NOT merged). CONFIRMED matches brief.

## Findings (appended as reached)

### C1 — `writeInsertions` loop-0 clear: CONFIRMED (source)
`api/src/functions/tests/appInsertions.ts` (grep of the live file @ 12ddfb6):
```
if (loop === 0) await client.query(`delete from insertion where artifact_id=$1`, [artifactId])
else await client.query(`delete from insertion where artifact_id=$1 and loop=$2`, [artifactId, loop])
```
Loop 0 → artifact-wide delete (every loop). Loops 1..n → own rows only. Matches the claim.

### C2 — `writeSwaps` loop-0 clear on BOTH tables: CONFIRMED (source)
`api/src/functions/tests/appSwaps.ts:64-70`:
```
if (loop === 0) {
  await client.query(`delete from swap_decision where packet_id=$1`, [packetId])
  await client.query(`delete from skill_candidate where packet_id=$1`, [packetId])
} else {
  await client.query(`delete from swap_decision where packet_id=$1 and loop=$2`, [packetId, loop])
  await client.query(`delete from skill_candidate where packet_id=$1 and loop=$2`, [packetId, loop])
}
```
Both tables covered. Matches the claim.

### ADVERSARIAL — the stated safety argument for C1/C2 is WRONG (the conclusion survives; the reason does not)
Implementer's claim: "`appRemediation.ts:179` (`firstPass === 1`) makes [a live-run loop-0 clear] unreachable."

Observed call graph (`grep -rn "writeSwaps\|writeInsertions\|ensurePackage" api/src`):
- `appRemediation.ts:180` `writeInsertions(loop: 0)` IS guarded by `firstPass === 1`. Correct for insertions.
- `writeSwaps` is **never called by `appRemediation.ts` at all**. Its only call site is
  `appPackets.ts:618`, which sits **inside `ensurePackage`** (fn spans 476-630, confirmed by brace count)
  on the NON-cached path.
- `appRemediation.ts:175` calls `ensurePackage(client, art, opp, false)` on **every** run, including run 2+,
  **before** the `firstPass` guard on line 179.

So `firstPass === 1` does not guard `writeSwaps` in any way. What actually prevents the loop-0 swap
clear during remediation is a different line — the cache early-return at `appPackets.ts:503`:
```
const staleUngrounded = grounded && pkt?.jd_grounded !== true
const cached = (!regen && !staleUngrounded && pkt?.pkg_json) ? pkt.pkg_json : null
if (cached) return { pkg: cached, generated: false, ... }
```
The reason matters because the guard has an escape hatch the `firstPass` story does not describe:
when `pkg_json` is null **or** `staleUngrounded` is true, `ensurePackage(regen=false)` regenerates
the whole package and reaches `writeSwaps(loop: 0)` — a packet-wide `swap_decision` +
`skill_candidate` delete — on a remediation run that may already have `firstPass > 1`.
(Reachability of `staleUngrounded` under remediation being investigated below.)

### Reachability of the `ensurePackage` escape hatch — traced, and it CLOSES (conclusion holds)
`grep -rn jd_grounded api/src`: the only writer inside `ensurePackage` is
`appPackets.ts:599  update packet set pkg_json = $1, jd_grounded = $2 ...`, run on the generation path.
Chain: remediation refuses when `!grounded` (`appRemediation.ts:148`). So any packet that has ever
completed a remediation pass went through `ensurePackage` with `grounded === true`; if `jd_grounded`
was not already `true`, `staleUngrounded` was true, it regenerated, and :599 set `jd_grounded = true`.
Therefore on run 2+ `staleUngrounded` is false and `pkg_json` is non-null → cache hit at :504 →
`writeSwaps` is never reached. **The loop-0 swap clear cannot destroy a prior run's passes.**

VERDICT: C1 CONFIRMED. C2 CONFIRMED. The implementer's *conclusion* (unreachable during a live run)
is CONFIRMED, but the *stated reason* (`firstPass === 1`) is REFUTED — the load-bearing line is
`appPackets.ts:499/504`, and **no test names that dependency**. A future change to the cache
predicate would silently re-open a packet-wide provenance delete with the suite green.

### C5 — suites green: CONFIRMED
`npm --prefix api test` → `# tests 893 / # pass 875 / # fail 0 / # skipped 18`
`npm --prefix app test` → `# tests 393 / # pass 393 / # fail 0 / # skipped 0`

### C3 — H34 amendment: **PARTLY REFUTED**
Mutations derived independently (each applied, tested, reverted; `git status` clean after).

**MUT-1 — restore the original incident** (unconditional packet-wide delete of both tables in
`appSwaps.ts`, replacing the whole if/else):
```
not ok 1 - H34: provenance deletes are scoped to a pass, except at ground zero (loop 0)
    a packet-wide provenance delete outside loop 0 erases every earlier pass
# pass 1  # fail 1
```
CONFIRMED — H34 still fails on the construct it was born from.

**MUT-2a — a COMMENT that merely mentions `loop === 0` before an unguarded packet-wide delete:**
```
// this is only safe when loop === 0, honest
await client.query(`delete from swap_decision where packet_id=$1`, [packetId])
```
```
not ok 1 - H34 ...   # pass 1  # fail 1
```
CONFIRMED caught (`stripComments` does its job).

**MUT-2b — REAL CODE mentioning `loop === 0` that does NOT guard the delete: THE GUARD IS EXPLOITED.**
```ts
const isGroundZero = loop === 0
if (isGroundZero) { console.log('ground zero') }
await client.query(`delete from swap_decision where packet_id=$1`, [packetId])   // runs on EVERY loop
```
```
ok 1 - H34: provenance deletes are scoped to a pass, except at ground zero (loop 0)
# pass 2  # fail 0
```
And the **whole api suite passes with the P3-21 incident live**:
```
npm --prefix api test  →  # tests 893  # pass 893  # fail 0
```
So the claim "its `loop === 0` carve-out cannot be exploited by a delete that merely sits near a
`loop === 0` mention" is **REFUTED for a code mention** (true only for a comment mention). H34's
`before = code.slice(m.index - 400, m.index)` tests *textual proximity*, not that the delete is
*inside* the `loop === 0` branch. Pass-2-destroys-pass-1 is reinstatable with the suite green.

**MUT-3 — delete the load-bearing loop-0 clear in `appInsertions.ts`:**
```
not ok 1 - H:rebuild-clears-superseded-loops ...
  error: 'appInsertions.ts: a loop-0 write must clear EVERY loop for the artifact...'
```
**MUT-4a — delete the `skill_candidate` packet-wide clear:** fails with
`'skill_candidate must be cleared with swap_decision or candidates outlive their swaps'`.
**MUT-4b — delete the `swap_decision` packet-wide clear:** fails with
`'a loop-0 write must clear EVERY swap loop...'`.
All three new load-bearing lines are mutation-proven.

### C4 — `listBodyModel` status: CONFIRMED, condition NOT backwards
Live line, `app/src/assetBlocks.js:780-782`:
```js
status: swap ? (swap.action === 'kept' ? 'unchanged'
  : swap.driver === 'owner' ? `${swap.action} · you changed this`
  : `${swap.action} · ${swap.driver}`) : (swaps.length ? 'unchanged' : ''),
```
Mutations (`node --test --test-name-pattern 'unswapped line' app/test/assetBlocks.test.mjs`):

| mutation | result |
|---|---|
| **MUT-C4a** condition INVERTED → `(swaps.length ? '' : 'unchanged')` | `# pass 0 # fail 2` — BOTH tests fail |
| **MUT-C4b** always `'unchanged'` (unbounded claim) | `# pass 1 # fail 1` — the no-attribution test fails |
| **MUT-C4c** always `''` (old blank behaviour) | `# pass 1 # fail 1` — the attribution test fails |

Both directions are independently pinned; the condition is the right way round. If it were backwards
MUT-C4a would be the shipped code and both tests would fail — they pass at HEAD.

**"No third state renders blank" — CONFIRMED.** I exercised the real exported function over every
reachable and several unreachable shapes (`/tmp/c4probe.mjs`):
```
no swaps at all            -> ""  |  ""            <- the deliberate, evidence-bounded blank
kept                       -> "unchanged"  |  "unchanged"
swapped/posting            -> "swapped · posting"  |  "unchanged"
swapped/owner              -> "swapped · you changed this"  |  "unchanged"
added/rule                 -> "added · rule"  |  "unchanged"
dropped (to_label null)    -> "unchanged"  |  "unchanged"
action null                -> "null · posting"     <- UNREACHABLE, see below
driver null                -> "swapped · null"     <- UNREACHABLE
action="" driver=""        -> " · "                <- UNREACHABLE
```
The three degenerate renders are unreachable from the database: `schema.ts` declares
`action text not null check (action in ('kept','swapped','merged','dropped','added'))` and
`driver text not null check (driver in ('posting','rule','unattributed','owner'))`.
So the ONLY blank status is the intended no-attribution case. Note the pre-existing raw-enum render
(`merged · unattributed`) is still reachable — already documented in the comment above the line, not
a regression, and not blank.

### C7 — eds-claude-skills: CONFIRMED (all three parts)
**Phase-tag hook uses the JSON form.** Read the INSTALLED command out of
`/home/user/.claude/settings.json` (PostToolUse, matcher `.*`, `_eds_version: 24`), executed it, and
parsed its stdout:
```
exit: 0
raw stdout: '{"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "PHASE TAG: ...'
PARSED OK. top-level keys = ['hookSpecificOutput']
hookSpecificOutput keys = ['hookEventName', 'additionalContext']
hookEventName = 'PostToolUse'
VERDICT: JSON hookSpecificOutput.additionalContext form -> CONFIRMED
```
Independently corroborated live: the injection
`PostToolUse:Bash hook additional context: PHASE TAG: ...` appears after every tool call in this
verification session, which is the runtime proof that the envelope is being honoured (a bare printf
would produce no such line).

**VL-43b.** Branch `setup.sh` = `CURRENT_VERSION = 24`; `origin/main` = `23`; file CHANGED.
```
BASELINE            ok   VL-43b CURRENT_VERSION outranks origin/main (24 vs 23, setup.sh CHANGED)
MUT CURRENT_VERSION=23  FAIL VL-43b ... (23 vs 23, setup.sh CHANGED)  -> 1 of 123 checks FAILED
MUT CURRENT_VERSION=22  FAIL VL-43b ... (22 vs 23, setup.sh CHANGED)  -> 1 of 123 checks FAILED
```
Fails on equal AND on lower when the file is changed — matches the documented conditional rule.

**`python3 test/test_verify_loop.py` → `123/123 checks passed`.** CONFIRMED.

### C6 — PRODUCTION, opp `9f9c370a-4ac9-441e-b58e-02e3ffcf669e` / artifact `cfdd82e7`: CONFIRMED
Queried live via `db-query.yml` on `main`, three dispatches, all `conclusion: success`.
Job logs read in full (not the queued 204).

**(a) only loop 0 remains on every artifact of the packet** — run `33267040381`, job `99138823037`:
```
             artifact_id              |      type      | loop_no | rows_at_loop |            newest
--------------------------------------+----------------+---------+--------------+-------------------------------
 25559c31-26d8-41a8-ae25-a127e57822ba | video          |         |            1 |
 4d5a6f1f-9e1c-447e-a941-28e220183c78 | compact_resume |       0 |            2 | 2026-08-29 15:47:07.590958+00
 57517fcf-d8ff-4268-b888-7483b12df4ee | portfolio      |       0 |            7 | 2026-08-29 15:47:18.302963+00
 77d5e147-bff6-4f20-9dd0-481aab6c8ebc | cover          |       0 |            3 | 2026-08-29 15:47:12.733872+00
 cfdd82e7-35e9-49e9-a492-c1bb7b46d861 | resume         |       0 |            7 | 2026-08-29 15:47:01.400654+00
(5 rows)
```
Loop 0 is the ONLY loop present on all four artifacts that have insertions. The `video` row's blank
`loop_no` is the LEFT JOIN's null (that artifact has no insertion rows at all), not a surviving loop.
The 08-20 loops 1-3 that caused the incident are gone. CONFIRMED.

**(b) SkillsBullets1/2 = 10 items, longest <= 24, zero over** — run `33267051540`, job `99138853174`:
```
  merge_field   | loop_no | items | longest | over_limit
----------------+---------+-------+---------+------------
 SkillsBullets1 |       0 |    10 |      22 |          0
 SkillsBullets2 |       0 |    10 |      22 |          0
```
CONFIRMED. (Measured on `trim()`-ed lines from `string_to_array(after_text, chr(10))`, empty lines
excluded. Longest is 22, not "exactly 24" as an in-code comment says — the CLAIM `<= 24, zero over`
holds; the comment's "at exactly 24" is looser than the data.)

**(c) every swapped/kept/added `swap_decision` row for `skills_1` has a `to_label` matching a shipped
line** — run `33267055846`, job `99138864446`:
```
 loop_no | action  | rows | to_label_matches_shipped | null_to_label
---------+---------+------+--------------------------+---------------
       0 | added   |    4 |                        4 |             0
       0 | dropped |    4 |                        0 |             4
       0 | kept    |    5 |                        5 |             0
       0 | swapped |    1 |                        1 |             0
```
4 + 5 + 1 = **10 of 10** matched; dropped = 4 rows, 0 matched, all four `to_label IS NULL`.
Exactly the implementer's figure, independently derived. CONFIRMED — and note 10 attributed labels
against 10 shipped items means every rendered line on that list gets a REAL status; none falls
through to the C4 `unchanged` fallback. Also: `swap_decision` for this packet exists at loop 0 only,
so swaps and insertions now describe the SAME pass — the condition whose absence made the arrows
disappear.

### Regression / gap sweep
- `grep -rn "delete from (swap_decision|skill_candidate|insertion)" api/src` — the only executable
  deletes are the six lines in `appSwaps.ts:65-69` and `appInsertions.ts:115-116`. No other writer
  clears provenance. No unscoped delete lurking elsewhere.
- **Checked for the same desync in a THIRD table:** `correction` also carries `loop int not null
  default 0` and is NOT cleared at loop 0. It is not the same defect — `grep -rn "from correction"`
  shows every read is `where artifact_id = $1 ... order by merge_field, applied_seq` filtered on
  `reverted_at is null`; nothing selects by `max(loop)`, so no stale higher-numbered pass can
  outrank a rebuild there. (`appCorrections.ts:303` states the design: "Nothing deletes from
  `correction`.") No action needed; recorded so it is not re-litigated.
- api suite at clean HEAD is deterministic: two consecutive runs both `# tests 893 / # pass 893 /
  # fail 0 / # skipped 0`. The `18 skipped` in my very first invocation did not reproduce.
- Working tree returned clean after every mutation: `git status --porcelain` shows only this
  evidence file; `git log --oneline -1` = `12ddfb6`.

## VERDICT
| Claim | Result |
|---|---|
| C1 `writeInsertions` loop-0 clears every loop, 1..n own rows only | **CONFIRMED** |
| C2 `writeSwaps` same, for `swap_decision` AND `skill_candidate` | **CONFIRMED** |
| C3 H34 still fails on the original incident | **CONFIRMED** (MUT-1) |
| C3 the `loop === 0` carve-out cannot be exploited by proximity | **REFUTED** (MUT-2b: real-code proximity exploits it; whole api suite green with the P3-21 incident live) |
| C4 `unchanged` when the list has swaps, empty when it has none | **CONFIRMED**, condition not backwards, both directions mutation-proven |
| C4 no third state renders blank | **CONFIRMED** (degenerate renders unreachable: NOT NULL + CHECK) |
| C5 both suites green | **CONFIRMED** (api 893/893, app 393/393) |
| C6 (a)(b)(c) production | **CONFIRMED**, all three, from live db-query job logs |
| C7 JSON hook form / VL-43b / 123 checks | **CONFIRMED**, all three |
| *Implementer's stated reason* that `firstPass === 1` makes the loop-0 clear unreachable | **REFUTED** — conclusion holds, but via `appPackets.ts:499/504` (the `ensurePackage` cache), which no test names |

### Required before done
1. **H34's carve-out is proximity-based, not scope-based.** `before = code.slice(m.index - 400, m.index)`
   exempts any packet-wide delete with a real-code `loop === 0` anywhere in the preceding 400 chars.
   Reinstating the exact P3-21 incident this way leaves all 893 api tests green. Tighten it to require
   the delete be inside the `loop === 0` BRANCH (e.g. require `if (loop === 0)` immediately preceding,
   or brace-match the branch) — the MUT-2b snippet in this file is the regression case.
2. **Nothing pins `appPackets.ts:499/504`.** The real guarantee that a loop-0 provenance wipe cannot
   run mid-remediation is the `ensurePackage` cache early-return, not `firstPass === 1`. Correct the
   comments in `appInsertions.ts`, `appSwaps.ts` and the H34 header that assert otherwise, and add a
   guard naming the cache predicate as load-bearing.
