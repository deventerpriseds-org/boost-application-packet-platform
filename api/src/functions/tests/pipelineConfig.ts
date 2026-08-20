// The pipeline's runtime knobs, resolved from the EXISTING config store rather than baked into code.
//
// Incumbent store (do not add a parallel one): `AppConfig`, PartitionKey `auth`, RowKey `<group>.<key>`,
// written by `POST /api/config` and read by `GET /api/config` — the same rows the Auth & Config screen
// edits (`web/src/App.jsx` builds each RowKey as `${group.id}.${field.key}`). The constants below are
// SEED values only: the first value the owner gets, changeable in that screen without a deploy.
//
// Two defects this module exists to close (P7):
//   * temperature was never sent on ANY of the three agent calls, so the OpenAI Chat Completions
//     default applied to all of them — including the QC/reconciliation call, which should be the
//     LEAST creative one in the run;
//   * a template/folder id that had gone missing was passed to Google Drive unvalidated, so a
//     config gap surfaced as a 404 from Drive (or, worse, as a silently skipped document) instead
//     of as a named configuration error.

import { TableClient } from '@azure/data-tables'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!

/** RowKeys in AppConfig/auth. Keep in step with `web/src/App.jsx` AUTH_CONFIGS. */
export const CONFIG_KEYS = {
  generateTemperature: 'openai.generateTemperature',
  qcTemperature: 'openai.qcTemperature',
  compactResumeTemplateId: 'google.compactResumeTemplateId',
  defaultRoleFocus: 'openai.defaultRoleFocus',
} as const

/**
 * Seeded first values. Generation stays warm enough to write; the QC pass is a reconciliation step —
 * it compares two lists against a posting and picks — so it runs near-deterministic.
 */
export const SEED_TEMPERATURES = { generate: 0.7, qc: 0.15 } as const

/** OpenAI rejects anything outside this range. */
const TEMP_MIN = 0
const TEMP_MAX = 2

export interface ResolvedNumber {
  value: number
  source: 'config' | 'default'
  /** Why a configured value was refused. Absent when the value was accepted. */
  reason?: string
}

/**
 * A configured temperature, or the seed when the row is absent or unusable. Never throws and never
 * returns NaN: an unparseable setting must not take the pipeline down, but it must be reported.
 */
export function parseTemperature(raw: unknown, fallback: number): ResolvedNumber {
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) {
    return { value: fallback, source: 'default' }
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n)) return { value: fallback, source: 'default', reason: `not a number: ${JSON.stringify(raw)}` }
  if (n < TEMP_MIN || n > TEMP_MAX) return { value: fallback, source: 'default', reason: `out of range ${TEMP_MIN}-${TEMP_MAX}: ${n}` }
  return { value: n, source: 'config' }
}

/**
 * Shape check for a Google Drive file/folder id. Drive ids are long, unpadded base64url-ish strings;
 * every id this repo uses is 33-44 chars of [A-Za-z0-9_-]. Anything shorter, or carrying a space or
 * punctuation, is not an id — it is a placeholder, a title, or a fallback literal such as `Unknown`.
 */
export function isDriveId(id: unknown): boolean {
  if (typeof id !== 'string') return false
  const s = id.trim()
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(s)) return false
  // Long-but-meaningless sentinels that would otherwise pass the charset test.
  return !/^(unknown|undefined|null|none|todo|changeme|placeholder)$/i.test(s)
}

/**
 * Returns the id, or throws naming the setting that is wrong. Use this immediately before any Drive
 * call so a config gap is reported as a config gap, at the point it was introduced.
 */
export function requireDriveId(id: unknown, what: string, configKey?: string): string {
  if (isDriveId(id)) return String(id).trim()
  const shown = id === undefined ? '(unset)' : JSON.stringify(id)
  const fix = configKey ? ` Set ${configKey} in Auth & Config.` : ''
  throw new Error(`${what} is not a valid Google Drive id: ${shown}.${fix}`)
}

export interface PipelineSettings {
  generateTemperature: ResolvedNumber
  qcTemperature: ResolvedNumber
  /** Owner-configured fallback template for a role with no AppConfig/templates row. '' when unset. */
  compactResumeTemplateId: string
  /** Owner-configured role focus for a role type the templates partition does not know. '' when unset. */
  defaultRoleFocus: string
  /** Human-readable notes about anything refused or missing — surfaced in the run's `steps`. */
  warnings: string[]
}

/** All RowKeys under AppConfig/auth as a flat map. Empty map (not a throw) when storage is unreachable. */
export async function readAppConfigAuth(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    const client = TableClient.fromConnectionString(CONN, 'AppConfig')
    for await (const e of client.listEntities({ queryOptions: { filter: "PartitionKey eq 'auth'" } })) {
      const k = (e as any).rowKey as string
      const v = (e as any).value
      if (k && v != null) out[k] = String(v)
    }
  } catch { /* caller degrades to seeds and records a warning */ }
  return out
}

/** Turn a raw AppConfig/auth map into the settings the pipeline uses. Pure — unit-testable. */
export function settingsFromConfig(cfg: Record<string, string>): PipelineSettings {
  const warnings: string[] = []
  const gen = parseTemperature(cfg[CONFIG_KEYS.generateTemperature], SEED_TEMPERATURES.generate)
  const qc = parseTemperature(cfg[CONFIG_KEYS.qcTemperature], SEED_TEMPERATURES.qc)
  if (gen.reason) warnings.push(`${CONFIG_KEYS.generateTemperature} ignored (${gen.reason}); using ${gen.value}`)
  if (qc.reason) warnings.push(`${CONFIG_KEYS.qcTemperature} ignored (${qc.reason}); using ${qc.value}`)

  const compact = (cfg[CONFIG_KEYS.compactResumeTemplateId] || '').trim()
  if (compact && !isDriveId(compact)) {
    warnings.push(`${CONFIG_KEYS.compactResumeTemplateId} is not a Drive id (${JSON.stringify(compact)}) — ignored`)
  }

  return {
    generateTemperature: gen,
    qcTemperature: qc,
    compactResumeTemplateId: isDriveId(compact) ? compact : '',
    defaultRoleFocus: (cfg[CONFIG_KEYS.defaultRoleFocus] || '').trim(),
    warnings,
  }
}

export async function loadPipelineSettings(): Promise<PipelineSettings> {
  return settingsFromConfig(await readAppConfigAuth())
}
