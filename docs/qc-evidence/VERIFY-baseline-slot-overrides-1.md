# VERIFY: baseline named per-slot overrides — loop 1

Independent adversarial verification, run against the ACTUAL repo (not reasoned about). Target repo
`/home/user/boost-application-packet-platform`, branch `claude/boost-app-setup-approach-ejv09v`, HEAD
`3151a3d` (confirmed via `git log --oneline -5` + `git status` = clean before starting, matching the
brief). Code change `09dd10f`.

Build: `cd api && npm run build` — clean, no tsc errors on HEAD.
Files exercised: `api/src/functions/tests/appBaseline.ts` (`slotOverrides`, `slotOverflow`,
`baselinePkg`, `relevantOverlay`, `shapeSlotFields`), `api/src/functions/tests/slots.ts`
(`SLOT_FIELDS`), `api/test/hardening.test.mjs` (`H:baseline-slot-override`,
`H:baseline-slot-overflow`).

All function-level claims (C1–C6, C8, C9) were verified by importing the **built** `dist/` module
from a throwaway script run inside `api/` (never guessed from reading source) and calling the real
functions with adversarial inputs — not by re-reading the existing hardening test's assertions.
The throwaway scripts were deleted after use; nothing was left in the tree except this artifact.

## C10 — suite green on a clean build

```
cd api && node --test test/hardening.test.mjs
```
Result (run twice, once before mutation testing and once after, both identical):
`# tests 125`, `# pass 125`, `# fail 0`, `# cancelled 0`, `# skipped 0`, `# todo 0`.

**C10: CONFIRMED.**

## C1 — `slotOverrides` writes ONLY `SLOT_FIELDS` keys

Called with `{ SkillsBullets1: ['a','b'], ResumeSummary: [...], NotARealField: [...], '@Company': [...], '@CoverLetterDate': [...] }`.
Result: `Object.keys(out)` = `["SkillsBullets1"]` only; value verbatim `"a\nb"`. Every non-`SLOT_FIELDS`
key (a prose field, an unknown key, and two `@`-placeholders) was silently dropped.

**C1: CONFIRMED.**

## C2 — only arrays and strings accepted; no `String()` coercion of a non-array/non-string input

Called `slotOverrides({ SkillsBullets1: X })` for `X` in `42, true, false, null, undefined, {}, {a:1},
NaN, Symbol('x')` — every one produced `{}` (key absent), none threw. A string input (`'x|y|z'`) WAS
accepted and split via `splitItems` into `'x\ny\nz'`, confirming the string path works as documented
rather than being dead code.

**C2: CONFIRMED** for top-level inputs. See "Also report" below for a related edge the claim does not
cover (element-level coercion inside an accepted array).

## C3 — empty/blank list ignored, never applied; cannot blank a MasterContext-filled slot

`slotOverrides({ ExpertiseBullets: X })` for `X` in `[], [''], ['   ','\t'], [null], [undefined]` all
produced `{}` (ignored). End-to-end: `baselinePkg({ ExpertiseBullets: 'Alpha|Beta' }, { fields: {
ExpertiseBullets: [] } })` → `ExpertiseBullets` = `"Alpha\nBeta"` — the master content survived the
empty override untouched, i.e. the override truly did nothing rather than merely not throwing.

**C3: CONFIRMED.**

## C4 — named field beats positional shorthand for the same slot; unnamed slots still resolve

`baselinePkg({}, { relevant: [['pos1','pos2','pos3'],['pos4'],['pos5']], fields: { RelevantBullets1:
['named1','named2'] } })`:
- `RelevantBullets1` = `"named1\nnamed2"` (named wins for the slot both named it)
- `RelevantBullets2` = `"pos4"`, `RelevantBullets3` = `"pos5"` (positional still applies to slots
  `fields` did not name)
- With `fields` naming only `RelevantBullets1` and no `relevant` at all, `RelevantBullets2` fell back
  to the seed (`"Tech Talent Strategy\nInnovation Frameworks\nData Insights"`) — the seed fallback is
  reached correctly through both empty-relevant and empty-fields paths simultaneously.

**C4: CONFIRMED.**

## C5 — override NOT trimmed to slot capacity

`baselinePkg({}, { slots: {...SkillsBullets2: 8...}, fields: { SkillsBullets2: [i0..i8] (9 items) } })`
→ `SkillsBullets2` = all 9 items joined, verbatim, capacity of 8 notwithstanding.

**C5: CONFIRMED.**

## C6 — `slotOverflow` reporting behavior

Exercised all eight sub-cases directly against `slotOverflow`:
- 9 items @ capacity 8 → reports `[{field:'SkillsBullets2', items:9, capacity:8}]`
- 8 items @ capacity 8 (at capacity) → `[]`
- under capacity → `[]`
- capacity `null` → `[]`
- `slots` argument `undefined` → `[]`
- capacity `0` → `[]`
- capacity `-1` → `[]`
- `'a\nb\n\n'` (trailing blank lines) → `[]` (blank lines not counted as items)

**C6: CONFIRMED**, all eight sub-behaviors.

## C7 — the guards are NOT inert (mutation-proven with `scripts/mutate.sh`)

Ran five mutations against a **clean HEAD** (`git diff --quiet` verified before and after every run),
each via `/home/user/eds-claude-skills/scripts/mutate.sh` with anchors read directly from the file
(never typed from memory) and a rebuild-then-test command. One methodology note below matters more
than any single result.

**Methodology correction found and fixed mid-run.** My first invocation used
`TEST_CMD="cd api && npm run build && node --test ..."` (`&&`-chained). M1 reported **INERT**. I did
not trust that at face value — I reproduced the mutation by hand outside `mutate.sh` and found `tsc`
raises `TS7053` on M1 (indexing `Partial<Record<SlotField,string>>` with a widened `any` key) but
**still emits JS** (this repo's `tsconfig.json` has no `noEmitOnError`), so `npm run build` exits
non-zero even though `dist/` was correctly updated. With `&&`, that non-zero exit **short-circuited
the whole chain and `node --test` never ran at all** — `mutate.sh` correctly reported "the named test
did not fail" (INERT) because grepping for `not ok...H:baseline-slot-override` in output that
contains no test run at all is honestly INERT, but the underlying cause was my test-cmd, not the
guard. I switched to `;` (`npm run build; node --test ...`) so the test step always runs regardless of
`tsc`'s exit code, and re-ran M1 from a freshly-restored clean file. **This is exactly the
NOT-APPLIED-shaped failure the org's mutation-testing rule warns about, manifesting one level up (in
the test-cmd rather than the anchor) — worth carrying forward into the next brief's TEST_CMD.**

| # | Mutation | Anchor (target) | Targets claim | Result |
|---|---|---|---|---|
| M1 | `slotOverrides` iterates `[...SLOT_FIELDS, 'ResumeSummary']` instead of `SLOT_FIELDS` — an unrecognised/prose field can be written through | `slotOverrides` field loop | C1 | **FIRED** — `H:baseline-slot-override` failed (`stray` picked up a `ResumeSummary` key) |
| M2 | Delete the `if (!items.length) continue` guard before `out[field] = items.join('\n')` — an empty list writes `''` instead of being ignored | `slotOverrides` empty-list branch | C3 | **FIRED** — `H:baseline-slot-override` failed (empty inputs no longer ignored) |
| M3 | `slotOverflow`'s `if (items > cap)` → `if (items >= cap)` — fires AT capacity, not just over | `slotOverflow` push condition | C6 (at-capacity silence) | **FIRED** — `H:baseline-slot-overflow` failed |
| M4 | Drop `\|\| cap <= 0` from `slotOverflow`'s cap-validity check, so `cap=0`/negative are treated as real | `slotOverflow` cap-validity check | C6 (capacity ≤0 silence) | **FIRED** — `H:baseline-slot-overflow` failed |
| M5 (own) | Swap spread order in `baselinePkg` so `slotOverrides` is applied BEFORE `relevantOverlay`, reversing the documented "named beats positional" precedence | `baselinePkg` return object | C4 (precedence) | **FIRED** — `H:baseline-slot-override` failed (the "named field beats positional shorthand" assertion) |

All five: reinstating the defect made the suite fail with the exact named test, restore verified
(`git diff --quiet` after every run — `mutate.sh`'s own trap confirms this and I re-checked it too).
None were behaviourally-equivalent no-ops; all five are real, load-bearing guards.

**C7: CONFIRMED** — the guards for C1, C3, C4 (precedence), and C6 (both the at-capacity and the
≤0-capacity sub-rules) are real, not inert. (C2 and C5 were not separately mutation-tested — they are
covered by direct behavioral exercise above, and M1/M2's anchors are the same code paths C2's
type-gate and C5's absence-of-trim sit next to; a dedicated mutation for "coerce via String()" or "add
a `.slice(0,cap)` to the override path" would strengthen this further but was not run this loop.)

## C8 — the change is additive

`git diff 3207af4 -- api/src/functions/tests/appBaseline.ts`: the diff touches only `baselinePkg`'s
type signature (+`fields?: unknown`) and body (+one spread line + comment), adds `slotOverrides`,
`SlotOverflow`, `slotOverflow` as new functions, and wires `body.fields` / the `slotOverflow` report
into the route handler. **`relevantOverlay` and `shapeSlotFields` are untouched by this diff** — no
lines in either function appear in the diff.

Direct behavioral check: `baselinePkg(master)` called with **no `opts` argument at all**, and
`baselinePkg(master, { company: 'Acme' })` called **without a `fields` key**, both succeed without
throwing and produce identical slot-field output to each other (`slotOverrides(undefined)` returns
`{}` via its `!fields` guard, so spreading it is a no-op). This is exactly the pre-change behavior
shape already exercised by the pre-existing `H:baseline-standing-fields`, `H:baseline-shape`, and
`H:baseline-relevant-seed` tests, all 125/125 green.

**C8: CONFIRMED.**

## C9 — no model call introduced on the baseline path

`H:baseline-no-model` is present in the suite and passed (part of the 125/125 green run). Independently
re-checked: stripped comments from `appBaseline.ts` and grepped for `api.openai.com`,
`buildPackageForJD`, `ensurePackage`, `assemblePackage`, `artifactAiEdit`, `from 'openai'`,
`require('openai')` — all absent. Full import list of the file: `@azure/functions`, `./pgClient`,
`./appSession`, `./appPackets`, `./appInsertions`, `./packetTemplates`, `./pipelineConfig`, `./swaps`,
`./roleFocus`, `./slots` — no OpenAI transport anywhere in it, directly or transitively via an obvious
generation entry point.

**C9: CONFIRMED.**

## Also report — findings beyond the claims

1. **Minor, not a defect against any claim: element-level `String()` coercion inside an accepted
   array is not guarded.** `slotOverrides({ SkillsBullets1: [['a','b'], 'c', {x:1}] })` →
   `"a,b\nc\n[object Object]"`. The top-level type gate (C2) correctly rejects a bare object/number/
   boolean, but once an array is accepted, each *element* still goes through `String(x ?? '').trim()`
   with no per-element type check, so a caller sending a malformed nested array/object inside an
   otherwise-valid array gets junk text (`[object Object]`, a comma-joined sub-array) silently written
   into a merge field rather than being ignored or flagged. Low severity (the route is
   owner-only/internal, not third-party input), but it is the same class of defect C2 exists to
   prevent, one level down. Not a claim violation — C2 as worded is about the top-level value type —
   but worth a follow-up guard if `fields` is ever exposed to less-trusted callers.
2. **The `TS7053` compile error under mutation M1 is itself informative.** Because `slotOverrides`'
   return type is `Partial<Record<SlotField,string>>` and the loop variable is typed via `SLOT_FIELDS`
   (a `SlotField[]`), *any* attempt to widen the iterated key set (the exact shape of a future
   accidental regression, e.g. someone doing `for (const field in src)`) would be caught by `tsc` at
   build time in addition to the runtime guard — a second, independent line of defense C1 already
   benefits from structurally, not just via the test.
3. No dishonesty or fragility found in `slotOverflow`, `relevantOverlay`, `shapeSlotFields`, or the
   route handler's use of `body.fields` / `body.relevant` beyond what is already covered above.

## Summary

| Claim | Verdict |
|---|---|
| C1 | CONFIRMED |
| C2 | CONFIRMED |
| C3 | CONFIRMED |
| C4 | CONFIRMED |
| C5 | CONFIRMED |
| C6 | CONFIRMED |
| C7 | CONFIRMED |
| C8 | CONFIRMED |
| C9 | CONFIRMED |
| C10 | CONFIRMED |

**10/10 CONFIRMED.** No REFUTED claims this loop. One low-severity, out-of-scope finding (element-
level coercion inside an accepted array) recorded above for awareness, not a regression against any
stated claim.
