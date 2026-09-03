// PER-TEMPLATE FIXED SLOT COUNTS — the setting, and the wire from the setting to the gate.
//
// THE DEFECT THIS SUITE EXISTS FOR. The owner could set six per-template slot counts in Settings;
// the route stored them on `AppConfig/templates/resume-<driveId>`; `runChecks` had a
// `fixed_slot_count` check that consumed them via `CheckInput.slots`. Nothing joined the two.
// `appPackets.ts` passed no `slots` and `appChecks.ts` passed no `slots`, so the check reported
// `not_applicable` for every packet ever built while the numbers sat filled in on the row.
//
// Measured in production 2026-08-30, and it is why this matters: the rebuilt Trinnex packet shipped
// `skills_1` with EIGHT items where the owner's template holds ELEVEN, and `skills_2` with TEN
// where it holds NINE. Both violations were recorded honestly as `dropped`/`added` swap rows — and
// the gate could not see any of it.
//
// The counts are ACCUSATION GRADE: `fixed_slot_count` names the offending list and the number of
// items added or dropped. So the invariant every case below circles is one sentence — **an unset
// count is `null`, NEVER `0`** — because a `0` says "this list has zero legal slots", which
// declares every item in it illegal on evidence nobody supplied.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SLOT_FIELDS, slotProp, readSlot, readSlots, hasAnySlot, EMPTY_SLOTS, emptySlots,
} from '../dist/functions/tests/slots.js'
import { runChecks } from '../dist/functions/tests/checks.js'
import { resolveTemplateSlots } from '../dist/functions/tests/roleFocus.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const SLOTS_SRC = read('../src/functions/tests/slots.ts')
const CONFIG = read('../src/functions/config.ts')
const ROLE_FOCUS = read('../src/functions/tests/roleFocus.ts')
const PIPELINE = read('../src/functions/tests/pipeline.ts')
const PACKETS = read('../src/functions/tests/appPackets.ts')
const APP_CHECKS = read('../src/functions/tests/appChecks.ts')

const find = (rs, k) => rs.find((r) => r.check_key === k)
/** An Azure Tables entity as `getEntity` returns one, carrying the given counts. */
const entity = (counts) => ({
  partitionKey: 'templates', rowKey: 'resume-1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw',
  roleFocus: 'engineering', label: 'Engineering resume',
  ...Object.fromEntries(Object.entries(counts).map(([f, v]) => [slotProp(f), v])),
})
const items = (n, stem = 'Item') => Array.from({ length: n }, (_, i) => `${stem} ${i + 1}`).join('\n')

// ── the value rule ───────────────────────────────────────────────────────────────────────────────

test('H:slot-unset-is-null-never-zero: only a positive integer is a slot count', () => {
  // EVERY one of these must read back as `null`. A `0` is in the list deliberately and is the whole
  // point: a stored zero is not "zero slots", it is a value no writer of this field should have
  // produced, and treating it as a count turns the check into an accusation against every item.
  // `true` is here because Azure Tables stores booleans natively and this row predates the field —
  // `Number(true)` is 1, so an unguarded read would declare every item past the first illegal.
  for (const raw of [undefined, null, '', '   ', 0, '0', -1, '-1', 1.5, '1.5', true, false, 'ten', '1e2', '1,1', NaN, [11], { n: 11 }]) {
    assert.equal(readSlot(entity({ SkillsBullets1: raw }), 'SkillsBullets1'), null,
      `a stored ${JSON.stringify(raw)} must read back as null, not as a count`)
  }
  // ...and a real count survives, in both shapes a writer can leave behind: a number, and the
  // digit string an HTML form input sends.
  assert.equal(readSlot(entity({ SkillsBullets1: 11 }), 'SkillsBullets1'), 11)
  assert.equal(readSlot(entity({ SkillsBullets2: '9' }), 'SkillsBullets2'), 9)
  // Surrounding whitespace is trimmed, matching the writer's own `/^[0-9]+$/.test(raw.trim())` gate
  // exactly — the two must agree or a value the route accepted would read back as unset.
  assert.equal(readSlot(entity({ ExpertiseBullets: ' 7 ' }), 'ExpertiseBullets'), 7)
  assert.equal(readSlot(entity({ RelevantBullets1: '11 ' }), 'RelevantBullets1'), 11)
  // No entity at all is the commonest case — the template row does not exist yet.
  assert.equal(readSlot(null, 'SkillsBullets1'), null)
  assert.equal(readSlot(undefined, 'SkillsBullets1'), null)
})

test('H:empty-slots-is-all-null-and-cannot-be-mutated-into-a-count', () => {
  assert.deepEqual(readSlots(null), {
    SkillsBullets1: null, SkillsBullets2: null, ExpertiseBullets: null,
    RelevantBullets1: null, RelevantBullets2: null, RelevantBullets3: null,
  })
  assert.deepEqual(emptySlots(), readSlots(null))
  assert.deepEqual(readSlots({}), readSlots(null), 'a row with no slot properties is unset, not zero')
  assert.equal(hasAnySlot(emptySlots()), false)
  assert.equal(hasAnySlot(readSlots(entity({ RelevantBullets3: 4 }))), true)

  // `EMPTY_SLOTS` is a module singleton every consumer spreads. Frozen, because one caller writing a
  // number into it in place would silently redefine "unset" for every other caller in the process —
  // and the value it would most plausibly be written to is a count.
  assert.ok(Object.isFrozen(EMPTY_SLOTS), 'EMPTY_SLOTS must be frozen')
  assert.throws(() => { 'use strict'; EMPTY_SLOTS.SkillsBullets1 = 0 })
  assert.equal(EMPTY_SLOTS.SkillsBullets1, null)
  // ...and the factory must hand out a COPY, never the singleton itself.
  assert.notEqual(emptySlots(), EMPTY_SLOTS)
  assert.notEqual(readSlots(null), readSlots(null))
})

// ── one definition, and a module the pipeline can actually import ────────────────────────────────

test('H:slots-module-is-pure: it imports nothing, so the pipeline can use it', () => {
  // THIS IS THE REASON THE MODULE EXISTS. These definitions lived in `functions/config.ts`, which
  // calls `app.http(...)` at MODULE SCOPE — so importing them from the pipeline would have pulled
  // HTTP route registration into the build path and into `node --test`. That single fact is why the
  // owner's setting reached nothing: the only alternative was a SECOND copy of the field list.
  const imports = SLOTS_SRC.split('\n').filter((l) => /^\s*(import\b|export\s+\*\s+from|const\s+\w+\s*=\s*require\()/.test(l))
  assert.deepEqual(imports, [], `slots.ts must import nothing; found:\n${imports.join('\n')}`)
  // COMMENTS STRIPPED FIRST, and this is not fastidiousness — the first version of this assertion
  // failed on the module's own doc block, which says "no @azure/functions, no @azure/data-tables"
  // while stating the rule. A guard that fires on the sentence describing it is the cry-wolf shape
  // CLAUDE.md bans; the module-name check must look at code only.
  const code = SLOTS_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const banned of ['@azure/', "'pg'", '"pg"']) {
    assert.ok(!code.includes(banned),
      `slots.ts must never reference ${banned} in code — it reads a count off an object, it does not fetch one`)
  }
})

test('H:slot-fields-have-exactly-one-definition: config.ts imports, it does not re-list', () => {
  // Two answers to "which merge fields have a slot count" is one more than the question has, and is
  // the drift this repo keeps paying for. The list is declared in slots.ts and NOWHERE else.
  assert.match(SLOTS_SRC, /export const SLOT_FIELDS = \[/, 'slots.ts must own the declaration')
  for (const [name, src] of [['config.ts', CONFIG], ['roleFocus.ts', ROLE_FOCUS], ['pipeline.ts', PIPELINE], ['appPackets.ts', PACKETS], ['appChecks.ts', APP_CHECKS]]) {
    assert.ok(!/const SLOT_FIELDS = \[/.test(src), `${name} re-declares SLOT_FIELDS instead of importing it`)
  }
  assert.match(CONFIG, /import \{[\s\S]{0,200}?\} from '\.\/tests\/slots'/,
    'config.ts must import the slot definitions rather than hold its own copy')
  assert.match(ROLE_FOCUS, /from '\.\/slots'/, 'roleFocus.ts must read slots through the shared module')
  // ...and nobody may route around it by importing the definitions back out of `config.ts`. That
  // import is the one that pulls `app.http` into the pipeline — the defect this change removes.
  for (const [name, src] of [['roleFocus.ts', ROLE_FOCUS], ['pipeline.ts', PIPELINE], ['appPackets.ts', PACKETS], ['appChecks.ts', APP_CHECKS]]) {
    assert.ok(!/from '\.\.\/config'|from '\.\/config'/.test(src),
      `${name} imports from config.ts, which registers HTTP routes at module scope`)
  }
  // The six fields themselves, pinned: this is what the settings screen writes and what the check
  // grades, and a silent rename on one side would be invisible without it.
  assert.deepEqual([...SLOT_FIELDS], [
    'SkillsBullets1', 'SkillsBullets2', 'ExpertiseBullets',
    'RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3',
  ])
  assert.equal(slotProp('SkillsBullets1'), 'slot_SkillsBullets1',
    'the storage property name is what the live rows already hold — changing it orphans them')
})

// ── the wire, hop by hop ─────────────────────────────────────────────────────────────────────────

test('H:template-slots-are-carried-at-every-hop: no hop may drop them', () => {
  // A source guard rather than a runtime one, because every hop between the table and the check
  // needs Azure Tables, Postgres and OpenAI to exercise end to end. What a runtime test CAN prove is
  // the two ends, and the case below does exactly that; this one proves the middle is joined up.
  //
  // 1. the read: ONE fetch of `templates/<rowKey>` answers both the focus and the counts
  assert.match(ROLE_FOCUS, /const entity = await fetchTemplateEntity\(tplId\)[\s\S]{0,400}?slots = readSlots\(entity\)/,
    'resolveRoleFocus must read the slot counts off the same entity it already fetched for roleFocus')
  assert.match(ROLE_FOCUS, /\.\.\.decideRoleFocus\([^)]*\), slots \}/,
    'resolveRoleFocus must attach slots to what decideRoleFocus decided')
  // 2. the build carries them out
  assert.match(PIPELINE, /return \{ pkg, steps, roleFocus, roleFocusSource: role\.source, slots: role\.slots,/,
    'buildPackageForJD must return the resolved slot counts')
  // 3. the swap pairing gets them
  assert.match(PACKETS, /await writeSwaps\(client, art\.packet_id, opp\.id, \{[\s\S]{0,1400}?slots: built\.slots,/,
    'writeSwaps must be given the build\'s slot counts, not left to default')
  // 4. the gate gets them, resolved from the packet's OWN resume
  assert.match(APP_CHECKS, /p\.resume_template_id/,
    'evaluateArtifact must select the packet\'s chosen resume, or it cannot resolve that resume\'s slots')
  assert.match(APP_CHECKS, /const slots = await resolveTemplateSlots\(art\.resume_template_id\)/,
    'evaluateArtifact must resolve the slot counts for the packet\'s chosen resume')
  assert.match(APP_CHECKS, /const results = runChecks\(\{[\s\S]{0,600}?\bslots,/,
    'runChecks must be given the slot counts — without this the check is not_applicable forever')
})

test('H:template-slots-reach-the-gate: an unset count is not_applicable, a real one is graded', () => {
  // THE END-TO-END PROOF, over the segment that can be executed here: a stored Azure Tables entity
  // -> `readSlots` (the reader `resolveRoleFocus` and `resolveTemplateSlots` both call) -> the exact
  // `CheckInput` shape `appChecks.ts` now assembles -> `runChecks`.
  //
  // The numbers are the REAL ones measured on the rebuilt Trinnex packet, 2026-08-30.
  const pkg = { SkillsBullets1: items(8, 'Skill A'), SkillsBullets2: items(10, 'Skill B') }

  // BEFORE — what production did for every packet ever built: no slots supplied.
  const before = find(runChecks({ type: 'resume', pkg }), 'fixed_slot_count')
  assert.equal(before.state, 'not_applicable',
    'with no counts supplied the check must abstain — this was production for every packet')

  // AFTER — the owner's row, read the way the wire now reads it.
  const slots = readSlots(entity({ SkillsBullets1: 11, SkillsBullets2: 9 }))
  assert.deepEqual(slots, {
    SkillsBullets1: 11, SkillsBullets2: 9, ExpertiseBullets: null,
    RelevantBullets1: null, RelevantBullets2: null, RelevantBullets3: null,
  })
  const after = find(runChecks({ type: 'resume', pkg, slots }), 'fixed_slot_count')
  assert.equal(after.state, 'fail', 'the same package, with the counts wired through, must be graded')
  // The offenders must name BOTH lists, in the owner's terms.
  const offenders = after.offenders.join(' | ')
  assert.match(offenders, /SkillsBullets1: template holds 11, document ships 8 \(3 dropped\)/)
  assert.match(offenders, /SkillsBullets2: template holds 9, document ships 10 \(1 added\)/)
  // ...and the lists nobody set a count for are NAMED as unmeasured rather than silently omitted,
  // so a partial measurement can never read as a whole one.
  // (the order is `checks.ts`'s own `[...SKILL_FIELDS, ...RELEVANT_FIELDS, 'ExpertiseBullets']`)
  assert.match(after.observed, /not set: RelevantBullets1, RelevantBullets2, RelevantBullets3, ExpertiseBullets/)

  // A conforming package on the same counts passes — the check is not simply always red.
  const good = find(runChecks({
    type: 'resume', pkg: { SkillsBullets1: items(11, 'Skill A'), SkillsBullets2: items(9, 'Skill B') }, slots,
  }), 'fixed_slot_count')
  assert.equal(good.state, 'pass')
})

test('H:zero-slot-count-never-accuses: a stored 0 abstains, it does not condemn the list', () => {
  // The mutation this whole task is Tier 1 for. If a `0` survived the read, `known` in checks.ts
  // filters on `> 0` and would drop it — but a `0` that arrived through any OTHER path (a caller
  // coercing `null ?? 0`, an `Object.fromEntries` with a numeric default) would be graded, and
  // "template holds 0, document ships 8 (8 added)" names eight innocent items as offenders.
  const zeroed = readSlots(entity({ SkillsBullets1: 0, SkillsBullets2: 0 }))
  assert.deepEqual(zeroed, emptySlots(), 'a stored 0 must read back as unset, all the way through')
  const r = find(runChecks({ type: 'resume', pkg: { SkillsBullets1: items(8), SkillsBullets2: items(10) }, slots: zeroed }), 'fixed_slot_count')
  assert.equal(r.state, 'not_applicable', 'a zero count must never produce a verdict about the document')
  assert.deepEqual(r.offenders ?? [], [], 'and it must never name an offender')
})

test('H:unreadable-template-slots-are-unset-not-a-failure', async () => {
  // ABSENT EVIDENCE IS `not_applicable`, NEVER `pass` AND NEVER `fail`. This container has no
  // AZURE_STORAGE_CONNECTION_STRING, so `resolveTemplateSlots` here exercises the real unreadable
  // path — `TableClient.fromConnectionString(undefined)` throws inside the reader — and it must
  // come back all-null rather than throwing out to the caller or inventing zeros. That is the same
  // collapse a 404, a network fault or an expired key produces in production.
  assert.equal(process.env.AZURE_STORAGE_CONNECTION_STRING, undefined,
    'this case is only meaningful without a connection string')
  assert.deepEqual(await resolveTemplateSlots('1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw'), emptySlots())
  // A packet that never chose a resume (NULL `resume_template_id` — every packet before 2026-08-24)
  // must take the same quiet path rather than being a special case anyone has to remember.
  for (const id of [null, undefined, '', '   ']) {
    assert.deepEqual(await resolveTemplateSlots(id), emptySlots(), `id=${JSON.stringify(id)}`)
  }
  // ...and the resulting check abstains rather than failing the packet.
  const r = find(runChecks({ type: 'resume', pkg: { SkillsBullets1: items(8) }, slots: await resolveTemplateSlots(null) }), 'fixed_slot_count')
  assert.equal(r.state, 'not_applicable')
})
