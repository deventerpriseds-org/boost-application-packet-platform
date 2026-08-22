// The wake signal for the build queue — D35, second half.
//
// The first version woke the worker on a one-minute timer, which meant every queued build waited up
// to sixty seconds before anything happened. That is a fixed-interval poll standing in for an event
// that we ourselves know the exact moment of: the instant a job row is written. The owner asked for
// the storage account to be used instead, and it is the right call — the platform already provides
// the delivery, the retry and the poison handling that a timer makes us invent.
//
// WHAT MOVES AND WHAT DOES NOT. `packet_build_job` stays the record of truth: the claim, the lease,
// the attempt cap, the fence, the owner scoping and the one-live-job-per-opportunity index are all
// database facts, tested against a real PostgreSQL, and none of them are delegated to the queue. The
// queue carries one thing — "job <id> exists, someone come and look" — and a message that is lost,
// duplicated or delivered twice costs nothing, because `claimNextBuild` is what actually decides who
// runs what. A duplicate delivery finds the job already claimed and does nothing.
//
// THE TIMER SURVIVES, DEMOTED. A worker that dies mid-build leaves a row in `running` and produces
// no new message, so nothing would ever wake it again — that is the gap a push signal genuinely
// cannot cover, and it is the only reason a clock is still involved.
import { QueueClient } from '@azure/storage-queue'

/** The queue this app sends build signals to. Created on first send if it does not exist. */
export const BUILD_QUEUE_NAME = 'packet-build-jobs'

export interface BuildSignal { jobId: string; oppId?: string }

/**
 * Encode a signal as the queue trigger expects to read it.
 *
 * Base64, and not as a style choice: the Functions queue extension defaults to base64 message
 * encoding for compatibility with the classic SDKs, while `@azure/storage-queue` sends plain text
 * by default. Sending raw JSON is the version of this that appears to work — the message is
 * accepted, sits in the queue, and is quietly dead-lettered by the host instead of triggering.
 */
export function encodeBuildSignal(sig: BuildSignal): string {
  return Buffer.from(JSON.stringify(sig), 'utf8').toString('base64')
}

/**
 * Read a signal off the wire, in either encoding.
 *
 * The host may hand the handler an already-decoded object, a JSON string, or a base64 string,
 * depending on the extension version and how the message was produced. All three are the same
 * message, and a worker that only understands the one we happen to send today is a worker that stops
 * working when the extension bundle moves. Returns null for anything unreadable — an unreadable
 * signal must not throw, or the host retries it five times and then poisons it.
 */
export function decodeBuildSignal(raw: unknown): BuildSignal | null {
  if (raw && typeof raw === 'object') {
    const o = raw as any
    return typeof o.jobId === 'string' ? { jobId: o.jobId, oppId: o.oppId } : null
  }
  if (typeof raw !== 'string' || !raw.trim()) return null
  const tryJson = (s: string): BuildSignal | null => {
    try { const o = JSON.parse(s); return o && typeof o.jobId === 'string' ? { jobId: o.jobId, oppId: o.oppId } : null }
    catch { return null }
  }
  return tryJson(raw) || tryJson(Buffer.from(raw, 'base64').toString('utf8'))
}

/**
 * Tell a worker a job is waiting. Returns false if no signal could be sent.
 *
 * FAILURE HERE IS NOT FATAL AND MUST NOT BE. The job row is already committed; the signal only
 * decides whether it starts in a second or on the next sweep. So a missing connection string, a
 * throttled storage account or a transient network error is logged and swallowed — the build still
 * happens, just later. Failing the owner's request because a notification could not be sent would
 * turn a latency problem into an outage.
 */
export async function sendBuildSignal(sig: BuildSignal, log: (m: string) => void): Promise<boolean> {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage || ''
  if (!conn) { log('build signal not sent: no storage connection string; the sweep will pick it up'); return false }
  try {
    const q = new QueueClient(conn, BUILD_QUEUE_NAME)
    await q.createIfNotExists()
    await q.sendMessage(encodeBuildSignal(sig))
    return true
  } catch (e) {
    log(`build signal not sent: ${String(e)}; the sweep will pick it up`)
    return false
  }
}
