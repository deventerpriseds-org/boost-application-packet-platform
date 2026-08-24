// P1.4 — insertion rows. What text landed in which REAL merge field of which artifact, what it
// replaced, and which requirement justifies it.
//
// Each asset is modelled as ITS MERGE FIELDS, not as invented sections. The field names come from
// TEMPLATE_META, the same table `varsForType` injects from, so a row can never name a slot the
// document does not have. Measured against that table (not the backlog, which is wrong here):
//   resume 7 · compact_resume 7 · portfolio 7 · cover 3
// The backlog says the compact resume has 6 fields. It has 7, and it is a byte-identical duplicate
// of `resume` — same templateId, same placeholders. That is recorded, not silently reconciled.
//
// A merge field the package could not fill still produces a row, marked `generated: false`. That is
// the point: the UI lists what the pipeline CANNOT reach next to what it filled, so a static block
// in the template is visible as static rather than being mistaken for generated content.
import { TEMPLATE_META } from './packetTemplates'
import { attribute, splitItems, RequirementRef } from './swaps'

export type Method = 'model_rewrite' | 'template_fill' | 'manual'

/** The list-backed fields, whose text is traceable to skill_candidate rows. */
export const LIST_FIELD_TO_LIST: Record<string, string> = {
  SkillsBullets1: 'skills_1',
  SkillsBullets2: 'skills_2',
  RelevantBullets1: 'relevant_1',
  RelevantBullets2: 'relevant_2',
  RelevantBullets3: 'relevant_3',
}

export interface InsertionRow {
  merge_field: string
  generated: boolean          // false = no merge field value backs this block; it is static template text
  before_text: string | null
  after_text: string | null
  method: Method
  loop: number
  list: string | null          // the skill_candidate list this field renders, when it renders one
  item_count: number           // bullets in the field, so a UI block never invents a count
  requirement_seq: number | null
  verbatim_quote: string | null
  confidence: number
}

/** Merge fields for an artifact type, from the authoritative template table. */
export function mergeFieldsFor(type: string): string[] {
  return TEMPLATE_META[type]?.placeholders ?? []
}

export interface BuildInsertionsInput {
  type: string
  pkg: Record<string, any>
  prevPkg?: Record<string, any> | null
  requirements?: RequirementRef[]
  loop?: number
}

export interface BuildInsertionsResult {
  rows: InsertionRow[]
  filled: number
  unfilled: number
  attributed: number
}

/**
 * Build the insertion rows for one artifact.
 *
 * `method` is derived, not asserted:
 *  - `template_fill`  — what ships is what this slot was written FROM, unchanged.
 *  - `model_rewrite`  — what it was written from differs from what ships, so a model changed it.
 *  - `manual`         — reserved for a human edit; nothing in this pipeline produces it, and it is
 *                       never inferred, because guessing "a human did this" would launder a model
 *                       change as human judgement.
 *
 * "WRITTEN FROM" IS `prevPkg`, AND IT MEANS TWO DIFFERENT THINGS BY LOOP — deliberately, because
 * both are the honest answer to "what did this text replace?":
 *   loop 0     the owner's MasterContext block for this slot (`evidence.masterBaseline`)
 *   loop 1..n  pass n-1's output
 * Until 2026-08-24 loop 0 had no `prevPkg` at all, so `changed` could never be true there and every
 * generated baseline field was recorded `template_fill` — rendered "From profile"
 * (`assetGate.js:242`) even for a summary the model wrote from scratch for this posting. The
 * distinction the two labels exist to draw was unreachable on the one loop most artifacts never
 * leave.
 *
 * Attribution cites a requirement's VERBATIM — the employer's words — or nothing at all.
 */
export function buildInsertions(input: BuildInsertionsInput): BuildInsertionsResult {
  const { type, pkg = {}, prevPkg = null, requirements = [], loop = 0 } = input
  const rows: InsertionRow[] = mergeFieldsFor(type).map(field => {
    const after = pkg[field] == null || pkg[field] === '' ? null : String(pkg[field])
    const before = prevPkg?.[field] == null || prevPkg?.[field] === '' ? null : String(prevPkg[field])
    const generated = after !== null
    const changed = before !== null && after !== null && before !== after
    const att = generated ? attribute(after as string, requirements) : null
    return {
      merge_field: field,
      generated,
      before_text: before,
      after_text: after,
      method: changed ? 'model_rewrite' : 'template_fill',
      loop,
      list: LIST_FIELD_TO_LIST[field] ?? null,
      item_count: generated ? splitItems(after).length : 0,
      requirement_seq: att ? att.seq : null,
      verbatim_quote: att ? att.quote : null,
      confidence: att ? Math.round(att.confidence * 1000) / 1000 : 0,
    }
  })

  return {
    rows,
    filled: rows.filter(r => r.generated).length,
    unfilled: rows.filter(r => !r.generated).length,
    attributed: rows.filter(r => r.verbatim_quote !== null).length,
  }
}
