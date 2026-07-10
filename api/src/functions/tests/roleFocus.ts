import { TableClient } from '@azure/data-tables'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!

// Reads the role focus for a given role type from AppConfig (templates
// partition). Engineering and Product Management currently share template
// files, but each row carries a roleFocus so the AI content is tailored
// per role. Returns a sensible default if the row/field is absent.
export async function getRoleFocus(roleType: string): Promise<string> {
  const rowKey = (roleType || 'Engineering').toLowerCase().replace(/\s+/g, '-')
  try {
    const client = TableClient.fromConnectionString(CONN, 'AppConfig')
    const entity = await client.getEntity('templates', rowKey) as any
    if (entity.roleFocus) return String(entity.roleFocus)
  } catch { /* fall through to default */ }
  return roleType && /product/i.test(roleType) ? 'product management' : 'engineering'
}

// Directive prepended to the resume/portfolio prompt so the generated content
// is slanted toward the target role's competencies (same template, different
// emphasis).
export function roleDirective(roleFocus: string): string {
  return `TARGET ROLE FOCUS: Tailor every section for a senior ${roleFocus} executive. Emphasize ${roleFocus} competencies, terminology, and accomplishments most relevant to a ${roleFocus} leadership role, and de-emphasize skills outside that focus.\n\n`
}
