import { TableClient } from '@azure/data-tables'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!

export type RoleFocusSource =
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
}

/** Code seed. Only the FIRST value: the owner changes it at Auth & Config → `openai.defaultRoleFocus`. */
export const SEED_ROLE_FOCUS = 'engineering'

/** AppConfig/templates RowKey for a role type. Exported so callers report the exact row they missed. */
export function roleRowKey(roleType: string): string {
  return (roleType || 'Engineering').toLowerCase().replace(/\s+/g, '-')
}

/**
 * Decide the role focus from what was actually found, and SAY which source won.
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
): ResolvedRoleFocus {
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
 * Reads the role focus for a given role type from AppConfig (templates partition) and reports where
 * it came from. Engineering and Product Management currently share template files, but each row
 * carries a roleFocus so the AI content is tailored per role.
 */
export async function resolveRoleFocus(roleType: string, configuredDefault?: string, personaRole?: string | null): Promise<ResolvedRoleFocus> {
  let rowFocus: string | null = null
  let lookupError: string | null = null
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
  return decideRoleFocus(roleType, rowFocus, configuredDefault, lookupError, personaRole)
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
