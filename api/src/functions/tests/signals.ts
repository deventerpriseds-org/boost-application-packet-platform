// Shared opportunity SIGNALS — the ONE place two independent, derived indicators are computed so
// Today / Opportunities / Swipe / Pipeline can never disagree (per the "shared source" rule).
//
//  1. TEMPERATURE = recency of the POSTING (how fresh the job is). Hot ≤48h, Warm ≤14d, Cooling ≤21d,
//     else Cold. Purely a function of the posted date → MUST be derived at read time (a stored value
//     goes stale as the posting ages). Thresholds are owner-editable (seeded defaults below).
//  2. ACTION PRIORITY = how urgently the opp needs the OWNER to do something, from where it sits in the
//     journey (stage) + any time-sensitive pending event (a due outreach touch). Priority rises as an
//     opp advances toward an offer and the employer's clock starts running.
//
// Neither is stored; both are computed from columns already on the row (source_date/created_at, stage)
// plus a per-opp "has a due outreach touch" flag joined in by the caller.

export type Temperature = 'hot' | 'warm' | 'cooling' | 'cold'
export type ActionPriority = 'urgent' | 'active' | 'ready' | 'new' | 'done'

// Owner-editable band cut-points (seeded; changed in Settings ▸ Intake). Hot is the first HOT_MAX_HOURS
// after posting; Warm up to WARM_MAX_DAYS; Cooling up to COOL_MAX_DAYS; Cold beyond.
export interface TempThresholds { hotMaxHours: number; warmMaxDays: number; coolMaxDays: number }
export const DEFAULT_TEMP_THRESHOLDS: TempThresholds = { hotMaxHours: 48, warmMaxDays: 14, coolMaxDays: 21 }

export function normalizeTempThresholds(t: Partial<TempThresholds> | null | undefined): TempThresholds {
  const d = DEFAULT_TEMP_THRESHOLDS
  const hot = Number.isFinite(t?.hotMaxHours as number) ? Math.max(1, Math.min(720, Math.round(t!.hotMaxHours as number))) : d.hotMaxHours
  const warm = Number.isFinite(t?.warmMaxDays as number) ? Math.max(1, Math.min(120, Math.round(t!.warmMaxDays as number))) : d.warmMaxDays
  const cool = Number.isFinite(t?.coolMaxDays as number) ? Math.max(warm + 1, Math.min(180, Math.round(t!.coolMaxDays as number))) : Math.max(warm + 1, d.coolMaxDays)
  return { hotMaxHours: hot, warmMaxDays: warm, coolMaxDays: cool }
}

// Age of the posting in hours. Prefer the real posted date (source_date); fall back to created_at
// (when we ingested it) so a missing posted date never crashes — the caller can flag low confidence.
export function postedAgeHours(sourceDate: any, createdAt: any, nowMs: number): number | null {
  const raw = sourceDate || createdAt
  if (!raw) return null
  const ms = Date.parse(String(raw))
  if (!Number.isFinite(ms)) return null
  return Math.max(0, (nowMs - ms) / 3_600_000)
}

export function deriveTemperature(sourceDate: any, createdAt: any, nowMs: number, thr: TempThresholds): { temperature: Temperature | null; ageHours: number | null; ageDays: number | null } {
  const ageHours = postedAgeHours(sourceDate, createdAt, nowMs)
  if (ageHours == null) return { temperature: null, ageHours: null, ageDays: null }
  const ageDays = ageHours / 24
  let temperature: Temperature
  if (ageHours <= thr.hotMaxHours) temperature = 'hot'
  else if (ageDays <= thr.warmMaxDays) temperature = 'warm'
  else if (ageDays <= thr.coolMaxDays) temperature = 'cooling'
  else temperature = 'cold'
  return { temperature, ageHours, ageDays: Math.round(ageDays * 10) / 10 }
}

// Journey-phase → action priority. Deeper stages (employer engaged, offer on the table) outrank
// earlier ones. A DUE outreach touch is a hard "send today" event → bump to urgent regardless of stage.
const URGENT_STAGES = new Set(['screen', 'r1', 'panel', 'final', 'offer'])   // employer's clock is running
const ACTIVE_STAGES = new Set(['applied', 'outreach', 'engaged'])             // you reached out; keep momentum
const READY_STAGES = new Set(['saved', 'enriched'])                          // decided to pursue; launch it
// 'discovered' → new (triage);  'accepted' → done (won, no action)

export function deriveActionPriority(stage: string, hasDueTouch: boolean): ActionPriority {
  if (stage === 'accepted') return 'done'
  if (hasDueTouch) return 'urgent'
  if (URGENT_STAGES.has(stage)) return 'urgent'
  if (ACTIVE_STAGES.has(stage)) return 'active'
  if (READY_STAGES.has(stage)) return 'ready'
  return 'new'   // discovered / unknown
}
