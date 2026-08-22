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
import {
  RESUME_TEMPLATE_ID, PORTFOLIO_TEMPLATE_ID, COVER_LETTER_TEMPLATE_ID, OUTPUT_FOLDER_ID,
} from './packetTemplates'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!

/**
 * RowKeys in AppConfig/auth. Keep in step with `web/src/App.jsx` AUTH_CONFIGS.
 *
 * P7 item 8. The six keys below the original four were NOT added here by this lane — the Auth &
 * Config screen has offered every one of them since it was written (`AUTH_CONFIGS`, `web/src/App.jsx`
 * :50-70, RowKey `${group.id}.${field.key}`), and `POST /api/config` has been storing whatever the
 * owner typed into them. Nothing read them. The pipeline used module constants instead, so the owner
 * could set `google.resumeTemplateId` and watch the run copy a different document.
 *
 * A setting that exists and is not read is worse than one that does not exist: it tells the owner
 * they are in control when they are not. The fix is this list, not a rename and not an env var —
 * the RowKeys were already being written and the reader was the missing half.
 */
/** The seeded generation model. The owner overrides it via `openai.generateModel` in AppConfig. */
export const SEED_GENERATE_MODEL = 'gpt-4o-mini'

export const CONFIG_KEYS = {
  generateTemperature: 'openai.generateTemperature',
  generateModel: 'openai.generateModel',
  qcTemperature: 'openai.qcTemperature',
  compactResumeTemplateId: 'google.compactResumeTemplateId',
  defaultRoleFocus: 'openai.defaultRoleFocus',
  resumeTemplateId: 'google.resumeTemplateId',
  portfolioTemplateId: 'google.portfolioTemplateId',
  coverLetterTemplateId: 'google.coverLetterTemplateId',
  outputFolderId: 'google.outputFolderId',
  senderEmail: 'microsoft.senderEmail',
  recipientEmail: 'microsoft.recipientEmail',
} as const

/**
 * Seeded first values for the six keys above — the FIRST value the owner gets, not a constant.
 *
 * The Drive ids are imported rather than retyped: `packetTemplates.ts` already declared them and
 * `pipeline.ts` had its own byte-identical copy of all four. Two copies of an id is how one of them
 * goes stale silently, which is the same shape of defect as the setting nobody read.
 */
export const SEED_DRIVE_IDS = {
  resumeTemplateId: RESUME_TEMPLATE_ID,
  portfolioTemplateId: PORTFOLIO_TEMPLATE_ID,
  coverLetterTemplateId: COVER_LETTER_TEMPLATE_ID,
  outputFolderId: OUTPUT_FOLDER_ID,
} as const

/**
 * Seeded mailboxes. `sender` is the Graph mailbox the delivery mail is sent AS; `recipient` is the
 * fallback used when the job row carries no `SendToEmail`. Both were bare literals on the send path,
 * which is what made the pipeline single-tenant: a second owner's packet was mailed from — and, with
 * no job-level address, TO — the first owner's mailbox.
 */
export const SEED_MAILBOXES = {
  sender: 'dev@enterpriseds.io',
  recipient: 'von.ellis@enterpriseds.io',
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
 * The string equivalent, for the settings that carry an id or an address rather than a number.
 *
 * `source` is not decoration. The whole P7-8 defect was invisible precisely because the run never
 * said WHICH value it used, so an owner who had set `google.resumeTemplateId` and got the seeded
 * document back had nothing to look at. Every resolved id now reports `config` or `default`, and
 * the run's `steps` print it.
 */
export interface ResolvedText {
  value: string
  source: 'config' | 'default'
  /** Why a configured value was refused. Absent when the value was accepted. */
  reason?: string
}

/**
 * Shape check for a mailbox address. Deliberately loose — this refuses a placeholder, a Drive id
 * pasted into the wrong field, or an empty row; it does not try to decide whether a real mailbox
 * exists, which only Graph can answer. Same job as `isDriveId`: report a config gap as a config gap
 * at the point it was introduced, instead of letting it become a Graph 404 on a URL path segment.
 */
export function isEmailish(v: unknown): boolean {
  if (typeof v !== 'string') return false
  const s = v.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return false
  return !/^(unknown|undefined|null|none|todo|changeme|placeholder)@/i.test(s)
}

/**
 * A configured string, or the seed when the row is absent or fails `accept`. Never throws and never
 * returns empty: an unusable setting must not take the pipeline down, but it must be REPORTED, which
 * is the half that was missing. Mirrors `parseTemperature` deliberately — one resolution shape.
 */
export function resolveText(raw: unknown, fallback: string, accept: (v: unknown) => boolean, label: string): ResolvedText {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return { value: fallback, source: 'default' }
  if (!accept(s)) return { value: fallback, source: 'default', reason: `${label} rejected: ${JSON.stringify(s)}` }
  return { value: s, source: 'config' }
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
  /**
   * The model the three generation calls use. Was the literal `'gpt-4o-mini'` at `pipeline.ts:329`
   * — a hardcoded behaviour-affecting value with no UI path, which the no-hardcoded-config rule
   * forbids, and the reason a model comparison needed a code change instead of a settings change.
   * Code SEEDS `gpt-4o-mini`; the owner changes it from there.
   */
  generateModel: string
  /** Owner-configured fallback template for a role with no AppConfig/templates row. '' when unset. */
  compactResumeTemplateId: string
  /** Owner-configured role focus for a role type the templates partition does not know. '' when unset. */
  defaultRoleFocus: string
  /**
   * P7 item 8 — the four Drive ids and the two mailboxes the console already offered and nothing
   * read. Always populated: a seed when the owner has set nothing, the owner's value when they have.
   * Never '' — an empty id reaching Drive is the `files//copy` 404 `requireDriveId` exists to stop.
   */
  resumeTemplateId: ResolvedText
  portfolioTemplateId: ResolvedText
  coverLetterTemplateId: ResolvedText
  outputFolderId: ResolvedText
  senderEmail: ResolvedText
  recipientEmail: ResolvedText
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

  const driveId = (key: keyof typeof SEED_DRIVE_IDS): ResolvedText => {
    const r = resolveText(cfg[CONFIG_KEYS[key]], SEED_DRIVE_IDS[key], isDriveId, 'not a Drive id')
    if (r.reason) warnings.push(`${CONFIG_KEYS[key]} ignored (${r.reason}); using the seeded id`)
    return r
  }
  const mailbox = (key: 'senderEmail' | 'recipientEmail', seed: string): ResolvedText => {
    const r = resolveText(cfg[CONFIG_KEYS[key]], seed, isEmailish, 'not an email address')
    if (r.reason) warnings.push(`${CONFIG_KEYS[key]} ignored (${r.reason}); using ${seed}`)
    return r
  }

  return {
    generateTemperature: gen,
    qcTemperature: qc,
    generateModel: (cfg[CONFIG_KEYS.generateModel] || '').trim() || SEED_GENERATE_MODEL,
    compactResumeTemplateId: isDriveId(compact) ? compact : '',
    defaultRoleFocus: (cfg[CONFIG_KEYS.defaultRoleFocus] || '').trim(),
    resumeTemplateId: driveId('resumeTemplateId'),
    portfolioTemplateId: driveId('portfolioTemplateId'),
    coverLetterTemplateId: driveId('coverLetterTemplateId'),
    outputFolderId: driveId('outputFolderId'),
    senderEmail: mailbox('senderEmail', SEED_MAILBOXES.sender),
    recipientEmail: mailbox('recipientEmail', SEED_MAILBOXES.recipient),
    warnings,
  }
}

export async function loadPipelineSettings(): Promise<PipelineSettings> {
  return settingsFromConfig(await readAppConfigAuth())
}
