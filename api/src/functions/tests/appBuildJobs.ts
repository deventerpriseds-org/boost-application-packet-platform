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
// THE COST, STATED PLAINLY: a queued build waits up to 60 seconds for the next tick before it
// starts. That is the worst everyday property of this design, and it is the price of using the
// mechanism the repo already has (six `app.timer` triggers) instead of introducing a queue service.
// If that wait becomes the complaint, the upgrade path is Azure Storage Queues — the storage account
// and connection string already exist — whose visibility timeout, dequeue count and poison queue
// replace the lease, the attempt cap and `abandonExhausted` respectively.
import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from '@azure/functions'
import { resolveOwner, requireWrite, serverError } from './appSession'
import { getPgClient } from './pgClient'
import { runPacketBuild } from './appPackets'
import { enqueueBuild, claimNextBuild, finishBuild, abandonExhausted, getBuildJob } from './buildQueue'

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
 * The worker: sweep, claim one, build it, record how it ended.
 *
 * ONE JOB PER TICK, deliberately. A build costs three minutes and a real model bill; a tick that
 * drained the queue would run them back to back inside a single Function invocation and hit the host
 * timeout mid-build, which is the failure this whole file exists to stop having.
 *
 * `abandonExhausted` runs FIRST. It is what marks a job that has burned its attempts as `failed`, so
 * the owner sees an outcome instead of a row that says `running` forever — and so the partial unique
 * index stops blocking them from queueing a fresh build. `claimNextBuild` no longer depends on this
 * ordering for correctness (it skips exhausted rows in the scan), but the sweep still has to happen
 * somewhere, and this is the only thing that runs on a clock.
 *
 * A build that RAN and returned a failure is not retried. Only a worker that died without recording
 * anything is — its row stays `running` and goes stale, and the reclaim picks it up. Retrying a
 * build that genuinely failed would spend the model budget again to fail the same way.
 */
export async function buildQueueTick(_timer: Timer, context: InvocationContext): Promise<void> {
  let client
  try {
    client = await getPgClient()
    const swept = await abandonExhausted(client)
    if (swept) context.log(`buildQueueTick: abandoned ${swept} exhausted job(s)`)

    const job = await claimNextBuild(client)
    if (!job) return
    context.log(`buildQueueTick: claimed ${job.id} (opp ${job.opp_id}, attempt ${job.attempts}, regen ${job.regen})`)

    let ok = false, payload: any = null, error: unknown = null
    try {
      const out = await runPacketBuild(client, job.opp_id, job.owner_email, { regen: job.regen },
        (m: string) => context.log(`buildQueueTick[${job.id}] ${m}`))
      payload = out.body
      ok = out.status === 200 && out.body?.ok === true && !out.body?.error
      if (!ok) error = out.body?.error || out.body?.note || 'the build did not complete cleanly'
    } catch (e) {
      error = e
      context.log(`buildQueueTick: ${job.id} threw ${String(e)}`)
    }

    // The fence. If this returns false the job was reclaimed while we were building and another
    // worker owns it now — say so and stop. Retrying here is how a zombie overwrites a live run.
    const wrote = await finishBuild(client, job.id, job.attempts, ok, payload, error)
    if (!wrote) context.log(`buildQueueTick: fenced out of ${job.id} — it was reclaimed mid-build; result discarded`)
    else context.log(`buildQueueTick: ${job.id} -> ${ok ? 'done' : 'failed'}`)
  } catch (e) {
    context.log(`buildQueueTick failed: ${String(e)}`)
  } finally { try { await client?.end() } catch {} }
}

app.http('packetBuildAsync', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/packet/build-async', handler: packetBuildAsync })
app.http('packetBuildJobRead', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/packet/build-job/{jobId}', handler: packetBuildJobRead })
app.timer('buildQueueTick', { schedule: '0 */1 * * * *', handler: buildQueueTick })
