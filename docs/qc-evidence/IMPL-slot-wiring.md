# IMPL — wire per-template fixed-slot counts through to `runChecks`

Branch: `claude/incumbent-wins-swap`. Agent-owned files only. **No commits, no push** — tree left
for the parent session.

## The defect, restated from the evidence

OBSERVATION. `runChecks` has a `fixed_slot_count` check reading `CheckInput.slots`
(`api/src/functions/tests/checks.ts:220`, logic at `:385-425`). Neither of the two call sites that
could supply it did: `appChecks.ts:108` (the ONLY `runChecks` call in the repo — `grep -rn
"runChecks("` returns `checks.ts:319` def + `appChecks.ts:108` call) passed no `slots`, and
`appPackets.ts:618` passed no `slots` to `writeSwaps`, whose input has accepted them since
`appSwaps.ts:76`. So `known.length === 0` at `checks.ts:399` for every packet ever built and the
check emitted `not_applicable` unconditionally.

INTERPRETATION. The owner's setting was write-only end to end: saveable at
`config.ts:saveTemplateConfig`, stored on `AppConfig/templates/resume-<driveId>`, read by nothing.

## Baseline, measured before any edit

| Command | Result |
|---|---|
| `cd api && npm run build` | clean, no output beyond the tsc banner |
| `cd api && node --test test/*.test.mjs` | `tests 920 / pass 896 / fail 0 / skipped 24` |

The brief quoted 891 pass; this tree measures **896 pass / 0 fail / 24 skipped**. The 24 skips are
the DB-backed files self-skipping with no Postgres. Reporting what I saw, not the brief's number.
NOTE `node --test api/test/` from the repo root fails with MODULE_NOT_FOUND — the suite must be run
from `api/` (`package.json:10` is `node --test test/*.test.mjs`).

## What was built

### 1. `api/src/functions/tests/slots.ts` — NEW, PURE

Owns `SLOT_FIELDS`, `SlotField`, `SlotCounts`, `slotProp`, `readSlot`, `readSlots`, `hasAnySlot`,
`EMPTY_SLOTS`, `emptySlots()`. **Zero imports** — `grep -nE "^import|require\(" ` returns nothing.
That is the whole reason it exists: `config.ts` calls `app.http(...)` at module scope
(`config.ts:375-376`), so importing the definitions from there would pull route registration into
the pipeline and into `node --test`.

`EMPTY_SLOTS` is now `Object.freeze`d (it was a bare mutable object literal in `config.ts`). It is a
module singleton every consumer spreads; one caller writing a number into it in place would
redefine "unset" process-wide.

`emptySlots()` added so a function returning "nothing set" cannot hand out the frozen singleton.

### 2. `config.ts` — definitions MOVED, not duplicated

Imports the eight names from `./tests/slots` and re-exports them, so any existing importer of
`config.ts` is unaffected. Route bodies are otherwise untouched: `getTemplateConfig` and
`saveTemplateConfig` still call `readSlots`, `hasAnySlot`, `readSlot`, `slotProp` and
`SLOT_FIELDS` at exactly the same places. All eight `templateConfig.test.mjs` guards over those
call sites still match unmodified (see verification below) — no guard regex needed changing,
because only the DEFINITIONS moved, not the usages the guards assert on.

### 3. `roleFocus.ts` — one row read, two answers

- new private `fetchTemplateEntity(tplId)`: the single reader of `templates/<rowKey>`. Absent row,
  404, bad connection string, unreachable table — all return `null`.
- `ResolvedRoleFocus.slots: SlotCounts` — **required, not optional**. An optional field is one a
  return path can forget, and a forgotten one is `undefined` all the way to the check.
- `decideRoleFocus` now returns `Omit<ResolvedRoleFocus,'slots'>`. Its body is untouched; runtime
  behaviour is identical, so `roleFocus.test.mjs`'s 20-odd `decideRoleFocus` cases are unaffected.
- `resolveRoleFocus` reads `slots = readSlots(entity)` off the SAME fetch it already made for
  `roleFocus`, and attaches it once at the return.
- new exported `resolveTemplateSlots(resumeTemplateId)` for the checks path, going through the same
  `fetchTemplateEntity`. All-null for a blank id, an absent row, or an unreadable table.

### 4-6. The wire

| Hop | File:line | What was added |
|---|---|---|
| build result | `pipeline.ts:332` (return type), `:566` (return) | `slots: role.slots` |
| build log | `pipeline.ts:356-366` | a `steps` line naming the resolved counts, or saying none are set |
| swap pairing | `appPackets.ts:618-633` | `slots: built.slots` into `writeSwaps` |
| gate | `appChecks.ts:37` | `p.resume_template_id` added to the artifact SELECT |
| gate | `appChecks.ts:43-60` | `const slots = await resolveTemplateSlots(art.resume_template_id)` |
| gate | `appChecks.ts:~135` | `slots` passed into `runChecks` |

**Design decision, deliberate and stated:** `evaluateArtifact` resolves the counts itself from the
stored `packet.resume_template_id` rather than taking them as a parameter from `ensurePackage`. It
is also reached directly from the checks route, long after any build, from an artifact id alone — a
parameter would be present on one path and absent on the other, i.e. a gate that grades differently
depending on who asked. One derivation, from the stored row, for both callers. `appPackets.ts` uses
`built.slots` (not a re-derivation) for the same reason in reverse: the counts must describe the same
resume the focus and the Drive copy describe, and `packetResumeTemplateId || settings.resumeTemplateId`
is resolved inside `buildPackageForJD`.

## The invariant at every hop

`null`, never `0`:
- **store -> read**: `readSlot` rejects `0`, `'0'`, negatives, fractions, booleans, arrays, objects,
  `NaN`, `'ten'`, `'1e2'`. Only a positive integer, or a trimmed digit string, survives.
- **absent row**: `readSlots(null)` is all-null by construction, not a special case.
- **no template id**: `resolveTemplateSlots('')` returns `emptySlots()`.
- **unreadable table**: `fetchTemplateEntity` catches everything and returns `null` -> all-null. A
  count that cannot be read must not become a `fail`.
- **the singleton**: `EMPTY_SLOTS` is frozen and every consumer spreads it.

## Verification

### Guards written (`api/test/slots.test.mjs`, 8 cases) — 8/8 pass

`H:slot-unset-is-null-never-zero`, `H:empty-slots-is-all-null-and-cannot-be-mutated-into-a-count`,
`H:slots-module-is-pure`, `H:slot-fields-have-exactly-one-definition`,
`H:template-slots-are-carried-at-every-hop`, `H:template-slots-reach-the-gate`,
`H:zero-slot-count-never-accuses`, `H:unreadable-template-slots-are-unset-not-a-failure`.

### Three of my own first-draft assertions were WRONG — recorded, not quietly fixed

1. asserted `'11 '` must read as `null`. It reads as `11`, and correctly: `readSlot` trims, matching
   the writer's own `/^[0-9]+$/.test(raw.trim())`. The two MUST agree or a value the route accepted
   would read back as unset. Test corrected; `'1,1'` took its place as the malformed-string case.
2. `assert.ok(!/@azure\//.test(SLOTS_SRC))` fired on the module's own doc block, which says "no
   `@azure/functions`" while stating the rule — the cry-wolf shape CLAUDE.md bans. Now strips
   comments first and checks code only.
3. asserted the `not set:` list in alphabetical order; `checks.ts:385` builds it as
   `[...SKILL_FIELDS, ...RELEVANT_FIELDS, 'ExpertiseBullets']`. Test corrected to the real order.

### A guard I nearly broke, and did NOT weaken

`H:loop-zero-clear-rests-on-the-cache-hit` (`hardening.test.mjs:4683`) pins `writeSwaps` as being
called with a LITERAL `loop: 0` **as the last property**:
`/writeSwaps\([^)]*\{[\s\S]{0,400}?loop:\s*0\s*,?\s*\}/`. Appending `slots:` after `loop: 0` broke
it. The invariant is real — the ground-zero provenance clear inside `writeSwaps` is only safe while
this caller passes a literal 0 — so **`slots` moved above `loop: 0`** and the assertion was left
untouched. `hardening.test.mjs` is not mine to edit and did not need to be.

OBSERVATION worth flagging to the parent: that regex will break again for the next person who adds
a field to this call. Widening it to `loop:\s*0\s*[,}]` would keep the same invariant without the
positional coupling — but it is a cross-agent file, so I have only noted it, not changed it.

### Mutation proofs — 10 mutations, all detected

Method: apply the mutation, `npm run build`, `node --test test/slots.test.mjs`, restore, `diff` to
confirm restoration. Every file verified byte-identical to its backup afterwards.

| # | Mutation | Detected by |
|---|---|---|
| M1 | **an UNSET count arrives as `0`** (`readSlot` returns `0` instead of `null`) — *the reason this is Tier 1* | 5 cases fail: `slot-unset-is-null-never-zero`, `empty-slots-…`, `template-slots-reach-the-gate`, `zero-slot-count-never-accuses`, `unreadable-…` |
| M2 | `runChecks` stops receiving `slots` (the exact shipped defect) | `H:template-slots-are-carried-at-every-hop` |
| M3 | `writeSwaps` stops receiving `slots` | `H:template-slots-are-carried-at-every-hop` |
| M4 | build result carries `{}` instead of the resolved counts | `H:template-slots-are-carried-at-every-hop` |
| M5 | `resolveRoleFocus` stops reading counts off the entity it fetched | `H:template-slots-are-carried-at-every-hop` |
| M6 | an unreadable row **throws** instead of collapsing to all-null | `H:unreadable-template-slots-are-unset-not-a-failure` |
| M7 | `EMPTY_SLOTS` unfrozen | `H:empty-slots-is-all-null-and-cannot-be-mutated-into-a-count` |
| M8 | `slots.ts` gains an `@azure/data-tables` import | `H:slots-module-is-pure` |
| M9 | `config.ts` grows a second copy of `SLOT_FIELDS` | `H:slot-fields-have-exactly-one-definition` (**and** `tsc` exits 2 — the compiler catches this one too) |
| M10 | `p.resume_template_id` dropped from the SELECT | `H:template-slots-are-carried-at-every-hop` |

### THE END-TO-END PROOF — a real call, not a reading

Two runs of the **real `evaluateArtifact`** from `dist/`, with a stub pg client supplying the real
Trinnex package shape (`SkillsBullets1` 8 items, `SkillsBullets2` 10) and
`resume_template_id = 1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw`.

**Run A — no storage credentials (the unreadable branch).** The new line executes, does not throw,
and the check reaches the `check_result` insert:

```
RESULT fixed_slot_count = {"state":"not_applicable",
  "observed":"no per-template slot count is set for SkillsBullets1, SkillsBullets2, …"}
STORED rows include fixed_slot_count: [ 'fixed_slot_count=not_applicable' ]
```

**Run B — a REAL Azure Tables GET.** A local HTTPS stub served the owner's row
(`slot_SkillsBullets1: 11, slot_SkillsBullets2: 9`) and the real `@azure/data-tables` client
fetched it. Verbatim output:

```
AZURE TABLE GET : ["/devstoreaccount1/AppConfig(PartitionKey='templates',RowKey='resume-1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw')",
                   "/devstoreaccount1/MasterContext()?$filter=PartitionKey eq 'context'"]
STATE           : fail
OBSERVED        : SkillsBullets1 8/11, SkillsBullets2 10/9; not set: RelevantBullets1, RelevantBullets2, RelevantBullets3, ExpertiseBullets
OFFENDERS       : ["SkillsBullets1: template holds 11, document ships 8 (3 dropped)",
                   "SkillsBullets2: template holds 9, document ships 10 (1 added)"]
STORED check_result row: [["fixed_slot_count","fail","SkillsBullets1 8/11, SkillsBullets2 10/9; …",[…]]]
```

OBSERVATION. The exact production violation now reaches the gate as a stored `fail` naming both
lists. It previously could not be seen at all. Also note the request list: **exactly ONE** GET to
the `templates` partition — the "no sixth reader" requirement, measured rather than asserted.

The harness lived in `api/e2e-proof.mjs` and `/tmp`, was run, and was **deleted** (`git status`
shows no stray file). `NODE_TLS_REJECT_UNAUTHORIZED=0` was scoped to that one throwaway process.

INTERPRETATION / LIMIT. What this does NOT prove is that the owner's LIVE row actually holds 11 and
9 — the stub supplied those numbers because production measured them. The single call that settles
it against the live table:

```
mcp__github__actions_run_trigger(workflow_id="api-test.yml", ref="main",
  inputs={ "method": "GET", "path": "/api/config/templates?owner=von.ellis@enterpriseds.io" })
```
and after this lands on `main` and deploys, the verdict itself:
```
db-query.yml  sql: select check_key, state, observed, offenders from check_result
                   where check_key = 'fixed_slot_count' order by created_at desc limit 10
```

### Final state

| Command (from `api/`) | Result |
|---|---|
| `npm run build` | exit 0, no diagnostics |
| `node --test test/*.test.mjs` | **933 tests / 933 pass / 0 fail / 0 skipped** |
| `grep -nE "^import|require\(" src/functions/tests/slots.ts` | no output — zero imports |

The 0 skipped (baseline: 24) is not my doing: a local Postgres is now running in the container
(12 `postgres` processes), so the `HAVE_PG`-gated DB files execute instead of self-skipping. They
pass. Test count 920 -> 933 = my 8 new cases + 5 from the parallel agent's `swaps.test.mjs`.

`git status`: no commit, no push, branch unchanged (`claude/incumbent-wins-swap`). Files touched are
only the ones I own; `swaps.ts` / `swaps.test.mjs` in the working tree are the parallel agent's.

## HANDOFF NOTES (files I do not own)

1. **`swaps.ts` — `slots` now actually ARRIVES.** `buildSwaps` has accepted `input.slots` and
   `slotsFor(mergeField, slots)` all along (`swaps.ts:184-194, 256, 366, 508`) and has been
   receiving `undefined` in production. As of this change `writeSwaps` is given real counts, so
   `slot.n` / `slot.source` on emitted rows go live for the first time. Worth a look at whatever
   `swaps.ts:366-409` does when `slot.n` is a real number — that branch has never run against
   production data.
2. **`hardening.test.mjs:4683`** — `H:loop-zero-clear-rests-on-the-cache-hit`'s regex requires
   `loop: 0` to be the LAST property of the `writeSwaps(...)` object. I complied rather than edit
   it. Consider `loop:\s*0\s*[,}]`.
3. **A 4x Table read per packet.** `evaluateArtifact` runs once per artifact, and a packet has four,
   so a build now issues four `getEntity('templates', …)` calls where it issued none. Cheap, and
   the alternative (a parameter from `ensurePackage`) makes the checks route grade differently from
   the build path — see the design note above. Flagging it as a deliberate, reversible cost.
4. **`checks.ts` is untouched.** `fixed_slot_count` already did the right thing with `> 0` filtering
   and its `not_applicable` branches; the defect was entirely upstream of it.
5. **`pipeline.ts:616`** (the legacy MT batch `buildPackageForJD` caller) destructures only
   `{ pkg, steps, roleFocus }` and never runs swaps or checks — nothing to carry there.
