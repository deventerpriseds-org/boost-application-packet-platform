// D35 — the asynchronous face of `packet/build-all`.
//
// THE MEASUREMENT THIS EXISTS FOR. `build-all` does about three minutes of real work. Run
// 32546312184 returned 504 one second AFTER the last of its four artifacts landed (02:29:02,
// 02:30:10, 02:30:53, 02:31:50, every one with a doc_url), and run 32548283352 returned 502, with
// `/api/health` answering fine throughout. The work completes; only the answer dies, in front of the
// Function, at a load-balancer idle timeout the app cannot raise from `host.json`.
//
// It is not cosmetic. The owner is shown a failure on a build that succeeded, so they press the
// button again and pay for it again. And the response was the only home for the build's warnings —
// the discarded-section list and the second-call parse failures — so two open findings have been
// un-diagnosable for exactly as long.
//
// SO THE REQUEST STOPS WAITING FOR THE WORK. The POST files a job and returns 202 in milliseconds; a
// timer claims the job and runs THE SAME `runPacketBuild` the synchronous route runs — not a second
// copy of the build. A timer is not behind the gateway, so nothing there is racing a stopwatch.
//
// The synchronous route stays exactly as it was. `appBulk` and the coach tool call it and expect the
// full summary back, and this file is not a reason to break them.
//
// THE WAKE SIGNAL IS THE STORAGE QUEUE, not a clock. The first version ticked every minute, so a
// queued build waited up to sixty seconds for something we already knew the exact moment of. The
// POST now drops a message on `packet-build-jobs` and the host delivers it in about a second.
//
// The queue carries a wake-up, not the work. Every correctness rule stays in `packet_build_job`,
// where it is tested against a real PostgreSQL: the claim, the lease, the fence, the attempt cap,
// the owner scoping. A message that is lost, duplicated or redelivered is therefore harmless — the
// database decides who runs what, and a second delivery finds the job already claimed.
//
// The timer survives, demoted to a five-minute sweep, and only for the case a push signal cannot
// cover: a worker that dies mid-build leaves a row in `running` and sends no new message, so
// nothing else would ever wake it.
import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from '@azure/functions'
import { resolveOwner, requireWrite, serverError } from './appSession'
import { getPgClient } from './pgClient'
import { runPacketBuild } from './appPackets'
import { enqueueBuild, claimNextBuild, finishBuild, abandonExhausted, getBuildJob } from './buildQueue'
import { BUILD_QUEUE_NAME, decodeBuildSignal, sendBuildSignal } from './buildSignal'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// POST /api/app/opportunity/{id}/packet/build-async — file a build and return immediately.
//
// 202, not 200: the answer is "accepted", and the body carries no artifacts because none exist yet.
// Anything that reads a build result reads it from the job.
export async function packetBuildAsync(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  const { owner } = resolveOwner(req)
  let body: any = {}; try { body = await req.json() } catch {}
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    client = await getPgClient()
    const r = await enqueueBuild(client, oppId, owner, body?.regen === true)
    // `enqueueBuild` checks the opportunity belongs to this owner before writing a row, so a null
    // job here is either a foreign/unknown id or a lost race — both 404 to the caller, and neither
    // leaks which.
    if (!r.job) return { status: 404, headers: HEADERS, jsonBody: { error: r.error || 'opportunity not found' } }
    // Wake a worker now. Only for a job that is still waiting — signalling one that is already
    // running would deliver a message whose only outcome is a worker finding nothing to claim.
    // A failed send is logged and ignored: the row is committed, so the sweep still gets to it.
    if (r.job.state === 'pending') await sendBuildSignal({ jobId: r.job.id, oppId }, (m: string) => context.log(m))
    return { status: 202, headers: HEADERS, jsonBody: {
      jobId: r.job.id, oppId, state: r.job.state, regen: r.job.regen,
      created: r.created, promoted: !!r.promoted, regenPending: !!r.regenPending,
      // The note is what the UI shows, so it has to be true in all three cases rather than
      // cheerfully claiming a build started when an older one is what is actually running.
      note: r.created ? 'Build queued.'
          : r.promoted ? 'A build was already queued — upgraded it to a full rebuild.'
          : r.regenPending ? 'A build is already running. Rebuild will need to be requested again once it finishes.'
          : 'A build for this packet is already in progress.',
    } }
  } catch (err) {
    return serverError(err)
  } finally { try { await client?.end() } catch {} }
}

// GET /api/app/packet/build-job/{jobId} — poll one job.
//
// Owner-scoped in the query (`getBuildJob`), because a job id is otherwise a bearer token for
// whatever the job's `result` contains.
export async function packetBuildJobRead(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    const job = await getBuildJob(client, req.params.jobId, owner)
    if (!job) return { status: 404, headers: HEADERS, jsonBody: { error: 'build job not found' } }
    return { status: 200, headers: HEADERS, jsonBody: {
      jobId: job.id, oppId: job.opp_id, state: job.state, regen: job.regen,
      attempts: job.attempts, createdAt: job.created_at, claimedAt: job.claimed_at,
      finishedAt: job.finished_at, error: job.error,
      // The payload is returned on `failed` as well as `done`. A partial build — three artifacts
      // written, one thrown — is the case whose diagnosis was being lost, and it is a failure.
      result: job.result ?? null,
      done: job.state === 'done' || job.state === 'failed',
    } }
  } catch (err) {
    return serverError(err)
  } finally { try { await client?.end() } catch {} }
}

/**
 * Claim one job and run it. Returns what happened, so a caller can log it honestly.
 *
 * ONE JOB PER INVOCATION, deliberately. A build costs three minutes and a real model bill; draining
 * the queue inside a single invocation would run them back to back and hit the host timeout
 * mid-build, which is the failure this whole file exists to stop having. The queue has a message per
 * job, so the next one wakes its own worker.
 *
 * A build that RAN and returned a failure is not retried. Only a worker that died without recording
 * anything is — its row stays `running`, goes stale, and the sweep reclaims it. Retrying a build
 * that genuinely failed would spend the model budget again to fail the same way.
 */
async function processOneBuild(client: any, context: InvocationContext): Promise<'idle' | 'done' | 'failed' | 'fenced'> {
  const job = await claimNextBuild(client)
  if (!job) return 'idle'
  context.log(`buildWorker: claimed ${job.id} (opp ${job.opp_id}, attempt ${job.attempts}, regen ${job.regen})`)

  let ok = false, payload: any = null, error: unknown = null
  try {
    const out = await runPacketBuild(client, job.opp_id, job.owner_email, { regen: job.regen },
      (m: string) => context.log(`buildWorker[${job.id}] ${m}`))
    payload = out.body
    ok = out.status === 200 && out.body?.ok === true && !out.body?.error
    if (!ok) error = out.body?.error || out.body?.note || 'the build did not complete cleanly'
  } catch (e) {
    error = e
    context.log(`buildWorker: ${job.id} threw ${String(e)}`)
  }

  // The fence. If this returns false the job was reclaimed while we were building and another worker
  // owns it now — say so and stop. Retrying here is how a zombie overwrites a live run.
  const wrote = await finishBuild(client, job.id, job.attempts, ok, payload, error)
  if (!wrote) {
    context.log(`buildWorker: fenced out of ${job.id} — it was reclaimed mid-build; result discarded`)
    return 'fenced'
  }
  context.log(`buildWorker: ${job.id} -> ${ok ? 'done' : 'failed'}`)
  return ok ? 'done' : 'failed'
}

/**
 * The primary worker: woken by the queue message the POST just sent.
 *
 * It claims the NEXT eligible job rather than the one the message names, and that is deliberate. The
 * message is a wake-up, not an assignment: if its job was already taken, there may still be another
 * one waiting, and picking it up here is free. It also means a lost message costs nothing more than
 * a later start, since any later signal — or the sweep — will find the orphan.
 *
 * Nothing thrown escapes. An exception here would make the host redeliver the message five times and
 * then poison it, and the job row already records the outcome; a retry loop on top of that would
 * spend the model budget again for no new information.
 */
export async function buildQueueWorker(message: unknown, context: InvocationContext): Promise<void> {
  const sig = decodeBuildSignal(message)
  context.log(`buildQueueWorker: signal ${sig ? sig.jobId : 'unreadable'}`)
  let client
  try {
    client = await getPgClient()
    const outcome = await processOneBuild(client, context)
    if (outcome === 'idle') context.log('buildQueueWorker: nothing to claim — already taken or finished')
  } catch (e) {
    context.log(`buildQueueWorker failed: ${String(e)}`)
  } finally { try { await client?.end() } catch {} }
}

/**
 * The sweep — the fallback, scoped to exactly what the queue cannot signal.
 *
 * Two jobs, neither of which any message will ever announce:
 *   `abandonExhausted` marks a job that burned its attempts as `failed`, so the owner sees an
 *      outcome instead of a row that says `running` for ever, and the partial unique index stops
 *      blocking them from queueing a fresh build.
 *   `processOneBuild` reclaims a job whose worker died mid-build — its lease has expired, and the
 *      message that started it was consumed long ago.
 *
 * Five minutes, not one. It is not the path a healthy build takes any more, and a sweep that runs
 * more often than the failure it recovers from is just a poll wearing a different name.
 */
export async function buildQueueSweep(_timer: Timer, context: InvocationContext): Promise<void> {
  let client
  try {
    client = await getPgClient()
    const swept = await abandonExhausted(client)
    if (swept) context.log(`buildQueueSweep: abandoned ${swept} exhausted job(s)`)
    const outcome = await processOneBuild(client, context)
    if (outcome !== 'idle') context.log(`buildQueueSweep: recovered a job the queue could not signal -> ${outcome}`)
  } catch (e) {
    context.log(`buildQueueSweep failed: ${String(e)}`)
  } finally { try { await client?.end() } catch {} }
}

app.http('packetBuildAsync', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/packet/build-async', handler: packetBuildAsync })
app.http('packetBuildJobRead', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/packet/build-job/{jobId}', handler: packetBuildJobRead })
app.storageQueue('buildQueueWorker', { queueName: BUILD_QUEUE_NAME, connection: 'AZURE_STORAGE_CONNECTION_STRING', handler: buildQueueWorker })
app.timer('buildQueueSweep', { schedule: '0 */5 * * * *', handler: buildQueueSweep })
