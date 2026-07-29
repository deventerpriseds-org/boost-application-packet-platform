import { getPgClient } from './pgClient'
import type { Outcome } from './scraperProxy'

// Volume/rate instrumentation for the LinkedIn guest-endpoint fetch (ACT-22a). Every fetch attempt
// (probe, backfill thread, daily grab) records one row here so we can EMPIRICALLY characterize
// LinkedIn's undocumented rate limits under residential-IP rotation: plot request-rate → block-rate,
// find the knee, and tell a LinkedIn-side wall (blocked/login_wall) from a proxy-side wall (proxy_error
// + usage headers). No docs exist for this; it has to be measured.

export interface JdFetchLogRow {
  jobId: string
  provider: string          // scraperapi | scrapedo | ... | 'direct'
  via: string               // proxy | direct
  httpStatus: number
  outcome: Outcome
  jdTextLen: number
  bytes: number
  latencyMs: number
  concurrency?: number       // how many threads were in flight (for the rate sweep)
  runTag?: string            // groups a single experiment/backfill batch
  usage?: Record<string, string>
  error?: string
}

let ensured = false
async function ensureTable(c: any): Promise<void> {
  if (ensured) return
  await c.query(`
    CREATE TABLE IF NOT EXISTS jd_fetch_log (
      id          BIGSERIAL PRIMARY KEY,
      ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
      job_id      TEXT,
      provider    TEXT,
      via         TEXT,
      http_status INT,
      outcome     TEXT,
      jd_text_len INT,
      bytes       INT,
      latency_ms  INT,
      concurrency INT,
      run_tag     TEXT,
      usage       JSONB,
      error       TEXT
    );
    CREATE INDEX IF NOT EXISTS jd_fetch_log_ts_idx  ON jd_fetch_log (ts);
    CREATE INDEX IF NOT EXISTS jd_fetch_log_tag_idx ON jd_fetch_log (run_tag);
  `)
  ensured = true
}

// Best-effort insert — never throws into the fetch path (instrumentation must not break the fetch).
export async function logJdFetch(row: JdFetchLogRow): Promise<void> {
  let c: any
  try {
    c = await getPgClient()
    await ensureTable(c)
    await c.query(
      `INSERT INTO jd_fetch_log
         (job_id, provider, via, http_status, outcome, jd_text_len, bytes, latency_ms, concurrency, run_tag, usage, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [row.jobId, row.provider, row.via, row.httpStatus, row.outcome, row.jdTextLen, row.bytes,
       row.latencyMs, row.concurrency ?? null, row.runTag ?? null,
       row.usage ? JSON.stringify(row.usage) : null, row.error ?? null],
    )
  } catch { /* swallow — logging is best-effort */ } finally {
    if (c) { try { await c.end() } catch { /* ignore */ } }
  }
}
