// FIXED SLOT COUNTS PER TEMPLATE — the one definition of "which merge fields have a slot count,
// and what a stored value means".
//
// WHY THIS FILE EXISTS AT ALL. These definitions lived in `functions/config.ts`, which calls
// `app.http(...)` at MODULE SCOPE. Importing them from the pipeline would pull HTTP route
// registration into the build path and into `node --test`, so the readers that actually need them
// — `roleFocus.ts` (which already fetches the exact `templates/<rowKey>` entity), and through it
// the packet build and the checks — could not have them. The alternative was a SECOND copy of the
// field list beside the first, which is precisely the drift this repo keeps paying for: two
// answers to "how many lines does SkillsBullets1 hold" is one answer more than the question has.
//
// So this module is PURE and must stay pure: no `@azure/functions`, no `@azure/data-tables`, no
// `pg`. It knows how to read a slot count off *an object*; it does not know where that object came
// from. `H:slots-module-is-pure` fails the suite if an import appears.
//
// WHY THE COUNTS ARE STORED AND NOT DERIVED (kept here with the definitions rather than in the
// route that happens to write them). The Google Doc holds no slot structure to read: its
// placeholders are exactly `{{ExpertiseBullets}} {{RelevantBullets1..3}} {{ResumeSummary}}
// {{SkillsBullets1}} {{SkillsBullets2}}` and nothing else (proven live, `diagSkillSources.ts:16-22`,
// api-test run 32973162995). One token per list expands to whatever text is injected, so "ten fit
// on the page" is a fact about the RENDERED page that no code can read off the template. It is a
// property OF THE TEMPLATE, so it lives on the template's row — beside `roleFocus` and `label`,
// which are the two properties that already answer "what is this resume".
//
// It is NOT a `chk_*` threshold on `owner_search_prefs`: that store is per-OWNER, and one owner
// with two resumes has two different slot counts. The row keyed by the template's Drive id is the
// only key that cannot drift from the document being copied.
//
// Owner, 2026-08-29: *"fixed slot counts change per template"*, *"the 10 can't be increased to 12
// or reduce to 8 etc so only swaps are allowed not adds or drops given the limited space in the
// resume template"*, and *"also relevant and expertise counts"*.

export const SLOT_FIELDS = [
  'SkillsBullets1', 'SkillsBullets2', 'ExpertiseBullets',
  'RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3',
] as const
export type SlotField = typeof SLOT_FIELDS[number]
export type SlotCounts = Record<SlotField, number | null>

/** Storage property name for a slot count. Prefixed so it can never collide with `roleFocus`,
 *  `label`, or any field added later, and so the read side can enumerate slots from `SLOT_FIELDS`
 *  alone rather than from a second whitelist that would drift from it. */
export function slotProp(field: SlotField): string { return `slot_${field}` }

/**
 * A stored slot count, or `null`.
 *
 * **`null`, NEVER `0` — this is AC-8 and it is load-bearing.** An unset count means "unknown", and
 * the downstream slot check must read that as `not_applicable`. A `0` would mean "this list has zero
 * legal slots", which declares every item in the list illegal and names innocent items as offenders.
 * The repo's standing rule is *"absent evidence is `not_applicable`, never `pass`"* — and equally
 * never an accusation. So anything that is not a positive integer reads back as `null`, including a
 * stored `0`, a negative, a fraction, or a value some other writer left as a string.
 */
export function readSlot(entity: any, field: SlotField): number | null {
  const raw = entity ? (entity as any)[slotProp(field)] : undefined
  if (raw === undefined || raw === null || raw === '') return null
  // Same type gate as the writer, and for the same reason: `Number(true)` is 1, so a boolean sitting
  // in this property — Azure Tables stores booleans natively, and this row is older than this field —
  // would read as a slot count of ONE and declare every item past the first illegal.
  if (typeof raw !== 'number' && !(typeof raw === 'string' && /^[0-9]+$/.test(raw.trim()))) return null
  const n = Number(typeof raw === 'string' ? raw.trim() : raw)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

/**
 * Every slot count on one stored entity. A FRESH object every call, and all-null for a missing or
 * unreadable entity — `readSlot` already treats `null`/`undefined` as unset, so `readSlots(null)`
 * is the correct answer to "the row is not there", not a special case anyone has to remember.
 */
export function readSlots(entity: any): SlotCounts {
  const out = {} as SlotCounts
  for (const f of SLOT_FIELDS) out[f] = readSlot(entity, f)
  return out
}

/** True when the row carries at least one slot count. Used by BOTH the membership test on the read
 *  and the delete test on the write — a template that has only slot counts is still a configured
 *  template, and must neither vanish from the list nor be deleted by a blank focus. */
export function hasAnySlot(slots: SlotCounts): boolean {
  return SLOT_FIELDS.some((f) => slots[f] !== null)
}

/**
 * "No count is set for any list" — the SAFE state, and the state every path must degrade to when
 * the template row is absent or Table Storage cannot be read.
 *
 * FROZEN, and every consumer spreads it (`{ ...EMPTY_SLOTS }`). It is a module-level singleton: one
 * caller mutating it in place would silently change what "unset" means for every other caller in
 * the process, and the value it could most easily be mutated to is a number.
 */
export const EMPTY_SLOTS: SlotCounts = Object.freeze({
  SkillsBullets1: null, SkillsBullets2: null, ExpertiseBullets: null,
  RelevantBullets1: null, RelevantBullets2: null, RelevantBullets3: null,
}) as SlotCounts

/** A fresh all-null `SlotCounts`. Identical to `{ ...EMPTY_SLOTS }`, named so a caller returning it
 *  cannot accidentally hand out the frozen singleton itself. */
export function emptySlots(): SlotCounts { return { ...EMPTY_SLOTS } }
