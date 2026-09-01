import { TableClient } from '@azure/data-tables'
import { SlotCounts, readSlots, emptySlots } from './slots'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!

export type RoleFocusSource =
  | 'template'             // the RESUME TEMPLATE being built carried a roleFocus — the owner's ruling
  | 'appconfig'            // an AppConfig/templates row for this role carried a roleFocus
  | 'persona'              // the owner's own curated role, from persona.master_role
  | 'configured_default'   // the owner's fallback (AppConfig/auth `openai.defaultRoleFocus`)
  | 'inferred'             // the role text itself said "product"; code inferred the focus
  | 'seed'                 // nothing matched — the code seed was used, and that is a warning

export interface ResolvedRoleFocus {
  focus: string
  source: RoleFocusSource
  /** Present whenever the role did NOT resolve from configuration. Callers must surface it. */
  warning?: string
  /**
   * The template's FIXED SLOT COUNTS, read off the SAME `templates/<rowKey>` entity this function
   * already fetches for `roleFocus` — so they ride along without a sixth reader of that partition.
   * That was the whole point of the shape: one row read answers both "what is this resume for" and
   * "how many lines does each of its lists hold".
   *
   * ALWAYS PRESENT, and ALL-NULL when there is nothing to say — an absent row, an unreadable table,
   * or no resume template id at all. Never zeros: a `0` reaching `runChecks` would declare every
   * item in that list illegal, which is an accusation made from missing evidence. `null` yields
   * `fixed_slot_count: not_applicable`, which is the correct state for a count nobody supplied.
   *
   * Not optional on the interface on purpose. An optional field is one a return path can forget,
   * and a forgotten field here is silently `undefined` all the way to the check — which is exactly
   * how this setting reached nothing for the first day of its life. `decideRoleFocus` returns
   * `Omit<ResolvedRoleFocus, 'slots'>` so its six pure return paths cannot each be a place to
   * forget it; `resolveRoleFocus` attaches it once, in the only function that has read the row.
   */
  slots: SlotCounts
}

/** Code seed. Only the FIRST value: the owner changes it at Auth & Config → `openai.defaultRoleFocus`. */
export const SEED_ROLE_FOCUS = 'engineering'

/**
 * The resume TEMPLATE decides the focus. This is the owner's ruling, in their words: *"let the
 * resume chosen drive the persona, right now it's only engineering available"*.
 *
 * Why this had to change. The first source below used to be `templates/<roleRowKey(roleType)>`, and
 * `roleType` is the POSTING'S FREE-TEXT JOB TITLE — so the row it looked for was
 * `templates/director-of-digital-technology-operations-&-innovation`. No such row will ever exist,
 * for any real posting, so the first source was dead on arrival and every build fell through it. The
 * `persona` source below it is dead too: `opportunity.persona_key` is NULL on 1,676 of this owner's
 * 1,903 opportunities and the persona design was abandoned. The measured result was an executive
 * Director of Digital posting written by a prompt aimed at "a senior ENGINEERING executive", from a
 * code constant.
 *
 * A template, unlike a job title, is a closed set the owner controls: there is one resume template
 * today, and the day a second is added it brings its own focus with it and no code changes. The row
 * key is the template's Drive ID rather than a name, because that is already the identity the
 * per-owner override uses (`CONFIG_KEYS.resumeTemplateId`) and it cannot drift from the document
 * actually being copied.
 */
export function templateRowKey(resumeTemplateId: string): string {
  return `resume-${String(resumeTemplateId || '').trim()}`
}

/**
 * The first value for the one template that exists today.
 *
 * Seeded in code and overridable per template row, which is what the no-hardcoded-config rule
 * requires: the code may seed the FIRST value, the owner changes it. It is deliberately the same
 * word the old fallback produced, so this change alters WHERE the answer comes from — an explicit
 * statement about the resume being built — without silently changing what today's documents say.
 */
export const SEED_TEMPLATE_ROLE_FOCUS: Record<string, string> = {
  '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw': 'engineering',
}

/** AppConfig/templates RowKey for a role type. Exported so callers report the exact row they missed. */
export function roleRowKey(roleType: string): string {
  return (roleType || 'Engineering').toLowerCase().replace(/\s+/g, '-')
}

/**
 * Decide the role focus from what was actually found, and SAY which source won.
 *
 * Returns everything on `ResolvedRoleFocus` EXCEPT `slots`, which is not a decision — it is a
 * verbatim read of the template row and belongs to whoever fetched it. Six return paths here would
 * otherwise each be a place to forget it, and a forgotten `slots` is `undefined` all the way to the
 * check with no type error to catch it.
 *
 * Pure, so the decision is unit-testable without Azure. The previous version returned a bare string
 * from inside a `catch {}`, so "the AppConfig row says product management", "the row is missing",
 * and "Table Storage is down" were indistinguishable to every caller — an unmatched role silently
 * became `engineering` and the run reported success. That silent-fallback shape is exactly the P7
 * defect; the fix is that an unmatched role still produces content, but never quietly.
 */
export function decideRoleFocus(
  roleType: string,
  rowFocus?: string | null,
  configuredDefault?: string | null,
  lookupError?: string | null,
  personaRole?: string | null,
  templateFocus?: string | null,
): Omit<ResolvedRoleFocus, 'slots'> {
  // THE TEMPLATE FIRST. It is the most concrete statement available of what is being built — the
  // owner picked this resume — and unlike the job-title row below it, it is a key that can actually
  // be configured, because templates are a closed set and job titles are not.
  const tpl = String(templateFocus ?? '').trim()
  if (tpl) return { focus: tpl, source: 'template' }

  const row = String(rowFocus ?? '').trim()
  if (row) return { focus: row, source: 'appconfig' }

  const rowKey = roleRowKey(roleType)
  const why = lookupError
    ? `AppConfig lookup failed for templates/${rowKey} (${lookupError})`
    : `no roleFocus configured for templates/${rowKey}`

  // THE OWNER'S OWN ROLE, and it outranks every guess below.
  //
  // This resolver was looking in AppConfig/templates, missing, and falling to a hardcoded seed —
  // while the roles the owner actually curates in Settings > Roles sat unread in
  // `persona.master_role`. Measured on the live database: CTO -> "CTO", CDIGITAL -> "Chief Digital
  // Officer", VP-ENGINEERING -> "Engineering", VP-PRODUCT -> "Product", VP-TECHNOLOGY ->
  // "Technology". Those ARE role focuses; `roleDirective` renders "...for a senior {focus}
  // executive" and each drops straight in.
  //
  // That made this a SECOND role brain beside the persona system — the exact shape CLAUDE.md's
  // extend-don't-duplicate rule was written about. It is not a missing configuration the owner
  // forgot to fill in; the configuration exists and nothing read it.
  //
  // Ranked ABOVE `inferred` deliberately: a curated persona is the owner stating their target
  // role, while `inferred` is a regex on the job title. Evidence beats a guess. No warning is
  // attached, because resolving from the owner's own data is not a fallback.
  const persona = String(personaRole ?? '').trim()
  if (persona) return { focus: persona, source: 'persona' }

  if (roleType && /product/i.test(roleType)) {
    return { focus: 'product management', source: 'inferred', warning: `${why}; inferred "product management" from the role name` }
  }

  const fallback = String(configuredDefault ?? '').trim()
  if (fallback) {
    return { focus: fallback, source: 'configured_default', warning: `${why}; used the configured default "${fallback}"` }
  }

  return {
    focus: SEED_ROLE_FOCUS,
    source: 'seed',
    warning: `${why}; used the code seed "${SEED_ROLE_FOCUS}" — set openai.defaultRoleFocus in Auth & Config, or add a roleFocus to templates/${rowKey}`,
  }
}

/**
 * ONE read of `AppConfig/templates/resume-<driveId>` — the row that answers BOTH "what is this
 * resume for" (`roleFocus`) and "how many lines does each of its lists hold" (the six slot counts).
 *
 * Every caller that needs either goes through here, so the partition has one reader rather than one
 * per question. Absent row, 404, bad connection string, table unreachable — all of them return
 * `null`, and `readSlots(null)` is all-null. That collapse is deliberate: a slot count that CANNOT
 * BE READ must not become a `fail`, and it must not become a `0`. Absent evidence is
 * `not_applicable`.
 */
async function fetchTemplateEntity(tplId: string): Promise<any | null> {
  try {
    const client = TableClient.fromConnectionString(CONN, 'AppConfig')
    return await client.getEntity('templates', templateRowKey(tplId)) as any
  } catch { return null }
}

/**
 * The template's fixed slot counts, for a caller that needs ONLY those.
 *
 * `evaluateArtifact` is that caller: it runs long after the package was built, from an artifact id
 * alone, and re-deriving the role focus there would be a second answer to a question the build
 * already answered. It reads the SAME row through the SAME reader, so the counts the checks grade
 * against cannot differ from the ones the swap pairing used.
 *
 * All-null for a blank id, an absent row, or an unreadable table. NEVER zeros.
 */
export async function resolveTemplateSlots(resumeTemplateId?: string | null): Promise<SlotCounts> {
  const tplId = String(resumeTemplateId ?? '').trim()
  if (!tplId) return emptySlots()
  return readSlots(await fetchTemplateEntity(tplId))
}

/**
 * Reads the role focus for a given role type from AppConfig (templates partition) and reports where
 * it came from. Engineering and Product Management currently share template files, but each row
 * carries a roleFocus so the AI content is tailored per role.
 *
 * Also returns the template's fixed SLOT COUNTS off that same row — see `ResolvedRoleFocus.slots`.
 */
export async function resolveRoleFocus(
  roleType: string, configuredDefault?: string, personaRole?: string | null, resumeTemplateId?: string | null,
): Promise<ResolvedRoleFocus> {
  let rowFocus: string | null = null
  let templateFocus: string | null = null
  let lookupError: string | null = null
  // ALL-NULL until a row is actually read. Not `{}`, not zeros: this is the value that travels to
  // `runChecks` when there is no template, and it must mean "nobody has said how many lines this
  // template holds" rather than "this template holds none".
  let slots: SlotCounts = emptySlots()
  // The template's own row, then the code seed for it. A stored row always wins so the owner can
  // change it; the seed only answers for a template nobody has configured yet.
  const tplId = String(resumeTemplateId ?? '').trim()
  if (tplId) {
    // ONE fetch, TWO answers. The slot counts sit on the entity this lookup was already making —
    // reading them anywhere else would be a second reader of the same partition, free to disagree.
    // There is NO seed for a slot count and there must never be one: a seeded count is an invented
    // number, and an invented slot count accuses every item past it.
    const entity = await fetchTemplateEntity(tplId)
    templateFocus = entity?.roleFocus ? String(entity.roleFocus) : null   /* 404 = not configured yet; the seed below answers */
    slots = readSlots(entity)
    if (!templateFocus) templateFocus = SEED_TEMPLATE_ROLE_FOCUS[tplId] || null
  }
  try {
    const client = TableClient.fromConnectionString(CONN, 'AppConfig')
    const entity = await client.getEntity('templates', roleRowKey(roleType)) as any
    rowFocus = entity?.roleFocus ? String(entity.roleFocus) : null
  } catch (e) {
    // A 404 is "not configured"; anything else is a real storage fault. Both are reported, but only
    // the second is an error the owner can do nothing about at the config screen.
    const status = (e as any)?.statusCode
    lookupError = status === 404 ? null : String((e as any)?.message || e).slice(0, 160)
  }
  // `slots` is attached HERE, in the one function that read the row, rather than inside
  // `decideRoleFocus` — which is pure, has six return paths, and would give the field six places to
  // be forgotten.
  return { ...decideRoleFocus(roleType, rowFocus, configuredDefault, lookupError, personaRole, templateFocus), slots }
}

/** Back-compatible string form for callers that do not surface the provenance (mt14/mt18/mt19). */
export async function getRoleFocus(roleType: string): Promise<string> {
  return (await resolveRoleFocus(roleType)).focus
}

// Directive prepended to the resume/portfolio prompt so the generated content
// is slanted toward the target role's competencies (same template, different
// emphasis).
export function roleDirective(roleFocus: string): string {
  return `TARGET ROLE FOCUS: Tailor every section for a senior ${roleFocus} executive. Emphasize ${roleFocus} competencies, terminology, and accomplishments most relevant to a ${roleFocus} leadership role, and de-emphasize skills outside that focus.\n\n`
}
