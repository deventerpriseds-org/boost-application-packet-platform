// The build queue — D35.
//
// `packet/build-all` does about three minutes of real work and the gateway gives up at four. That is
// measured, not assumed: run 32546312184 returned 504 one second AFTER the last of four artifacts
// landed (02:29:02, 02:30:10, 02:30:53, 02:31:50, every one with a doc_url), and run 32548283352
// returned 502, with `/api/health` fine throughout. The work completes; only the answer is lost.
//
// It is not a cosmetic problem. The owner is shown a failure on a build that succeeded, and two open
// findings — D33's discarded sections and D31's unparseable Call 2 — are stuck because their only
// evidence ever existed in that response.
//
// So the request stops waiting for the work. The POST records a job and returns; a timer claims it
// and runs the SAME build code, unchanged. This is the pattern the repo already uses for background
// work — six `app.timer` triggers exist, `jdSweepTick` runs every minute — rather than a new one.
//
// SQL only. No route, no timer, no build logic in this file, so every rule below is exercisable by
// tests against a real Postgres without a Function host, Google Docs or OpenAI.
export type JobState = 'pending' | 'running' | 'done' | 'failed'

export interface BuildJob {
  id: string
  opp_id: string
  owner_email: string
  regen: boolean
  state: JobState
  attempts: number
  claimed_at: string | null
  finished_at: string | null
  result: any
  error: string | null
  created_at: string
}

/**
 * How long a claimed job may stay silent before another tick may take it.
 *
 * The build itself runs ~3 minutes, so this has to clear that with room, or a healthy build gets
 * stolen mid-flight and runs twice — the expensive failure, since each run spends the model budget
 * again. Ten minutes is deliberately generous: a job that is genuinely wedged costs one late retry,
 * while a job reclaimed too early costs a duplicate build every time.
 *
 * The lease is a HEURISTIC, not a guarantee — see the fence in `finishBuild`, which is what makes
 * the queue correct when the guess is wrong.
 *
 * CONFIG NOTE (CLAUDE.md, "No hardcoded config"): this and `MAX_ATTEMPTS` are code-only. They are
 * operational knobs — how long to wait for a dead worker, how many times to retry — not product
 * behaviour the owner would tune, so they are held here pending explicit approval to leave them
 * code-only rather than wired into owner settings. Flagged, not forgotten.
 */
export const STALE_CLAIM_MINUTES = 10

/**
 * Give up after this many attempts.
 *
 * A build that has died three times will die a fourth, and retrying forever turns one broken
 * opportunity into an unbounded model-spend loop on a timer nobody is watching.
 */
export const MAX_ATTEMPTS = 3

/**
 * What `enqueueBuild` answers with.
 *
 * `job` is nullable and the type says so. An earlier version declared a non-null job and could still
 * return `undefined` (the live row finishing between the failed insert and the read) — a type that
 * lies is worse than no type, because the caller is told it need not check.
 *
 * `regenPending` is the honest answer to "I asked for a rebuild and something else is already
 * running": the caller gets a real job id, and a flag saying the build it asked for is NOT the one
 * that is running. `promoted` says the opposite — the queued job was upgraded to a rebuild in place.
 */
export interface EnqueueResult {
  job: BuildJob | null
  created: boolean
  /** A queued (not yet started) job was upgraded to `regen: true` because this request asked for one. */
  promoted?: boolean
  /** A rebuild was requested while a non-regen build is already running; this job is not it. */
  regenPending?: boolean
  error?: string
}

/**
 * Queue a build, or return the one already in flight.
 *
 * The unique partial index (`pbj_one_live_per_opp`) is what makes this safe under a double-click:
 * two concurrent inserts cannot both create a live job for one opportunity. Rather than surfacing a
 * constraint violation, the loser returns the EXISTING job — the caller asked for a build of this
 * packet and there is one, so handing back its id is the honest answer and keeps the endpoint
 * idempotent.
 */
export async function enqueueBuild(
  client: any, oppId: string, owner: string, regen: boolean,
): Promise<EnqueueResult> {
  // OWNERSHIP IS CHECKED HERE, BEFORE A ROW EXISTS — not in the route, and not afterwards.
  //
  // `packet_build_job.owner_email` is whatever the caller resolved to, and `getBuildJob` scopes its
  // read to that recorded value. So without this predicate an unauthenticated caller (who resolves
  // to the demo workspace and therefore passes `requireWrite`) could file a job against a REAL
  // owner's opportunity, then read the whole build payload back through its own job id, because the
  // owner it is checked against is the one it chose. The queue's invariant is that a job's owner and
  // its opportunity's owner never disagree; this is where that is made true.
  const owned = (await client.query(
    `select id from opportunity where id=$1 and owner_email=$2`, [oppId, owner])).rows[0]
  if (!owned) return { job: null, created: false, error: 'opportunity not found' }

  for (let attempt = 0; attempt < 2; attempt++) {
    const ins = await client.query(
      `insert into packet_build_job (opp_id, owner_email, regen) values ($1,$2,$3)
         on conflict do nothing
       returning *`, [oppId, owner, !!regen])
    if (ins.rows[0]) return { job: ins.rows[0], created: true }

    // The insert lost to the partial unique index, so a live job exists — usually. It may also have
    // FINISHED in the moment between the two statements, in which case there is no live row to
    // return and the loop simply inserts again, now unblocked. Without the retry this function
    // returns an absent job while its type promises one, and the caller reads `.id` off undefined.
    const live = await client.query(
      `select * from packet_build_job
        where opp_id=$1 and state in ('pending','running')
        order by created_at desc limit 1`, [oppId])
    const job: BuildJob | undefined = live.rows[0]
    if (!job) continue

    // A REBUILD MUST NOT SILENTLY BECOME A CACHED BUILD. `regen:true` is the owner pressing
    // "Rebuild" after seeing something wrong in the document; handing back a live `regen:false` job
    // would give them a job id to poll, a success at the end of it, and the same stale artifacts.
    // A job that has not started yet can simply be promoted — free and exactly what was asked for.
    // One already running cannot be, so the caller is TOLD, rather than being left to assume.
    if (regen && !job.regen && job.state === 'pending') {
      const up = await client.query(
        `update packet_build_job set regen = true where id=$1 and state='pending' returning *`, [job.id])
      if (up.rows[0]) return { job: up.rows[0], created: false, promoted: true }
    }
    return { job, created: false, regenPending: !!(regen && !job.regen) }
  }
  return { job: null, created: false, error: 'could not queue a build for this packet' }
}

/**
 * Take exactly one job, or nothing.
 *
 * `for update skip locked` is the whole point. Two ticks firing at the same second must not both
 * take the same row — that is a duplicate build and a duplicate model bill — and `skip locked` makes
 * the second one step over the first's row instead of blocking on it. Without it, either two workers
 * run one job or one worker waits behind a three-minute transaction.
 *
 * The same statement also RECLAIMS a job whose worker died: a row stuck in `running` past
 * `STALE_CLAIM_MINUTES` is eligible again. Nothing else would ever free it, and a job wedged in
 * `running` forever is indistinguishable to the owner from one that is merely slow.
 *
 * `attempts < MAX_ATTEMPTS` belongs INSIDE the subquery, and the first version of this had it
 * outside. There it does not skip the exhausted job, it makes the whole UPDATE match nothing — so
 * one poisoned job at the head of the queue returns `null`, which reads as "queue empty", while
 * every newer pending build for every owner sits behind it untouched, with no error anywhere.
 * `abandonExhausted` clears such a row, but only if the tick calls it first; correctness must not
 * depend on the caller's ordering.
 */
export async function claimNextBuild(client: any, staleMinutes = STALE_CLAIM_MINUTES): Promise<BuildJob | null> {
  const r = await client.query(
    `update packet_build_job j
        set state = 'running', claimed_at = now(), attempts = j.attempts + 1
      where j.id = (
        select id from packet_build_job
         where attempts < $2
           and ((state = 'pending')
             or (state = 'running' and claimed_at < now() - ($1 || ' minutes')::interval))
         order by created_at
         for update skip locked
         limit 1
      )
    returning j.*`, [String(staleMinutes), MAX_ATTEMPTS])
  return r.rows[0] || null
}

/**
 * Record how a claimed job ended. Returns false if the write was FENCED OFF and did not apply.
 *
 * `failed` carries its error rather than a bare flag, because the owner is going to be shown this
 * and "it failed" is not something anyone can act on. A job that exhausted `MAX_ATTEMPTS` is failed
 * for good — see `abandonExhausted`.
 *
 * THE PAYLOAD IS KEPT ON FAILURE TOO, and that is the entire reason this queue exists. A partial
 * build — some artifacts written, one throwing — is exactly the case whose diagnosis has been
 * getting lost: two open findings (a discarded-section list of ~7,400 characters, and an
 * unparseable second model call) have only ever existed inside that payload, and 500 characters of
 * `String(e)` cannot carry either. Failure and evidence are not alternatives.
 *
 * THE FENCE (`attempts`, `state='running'`) is what makes correctness independent of the lease.
 * `STALE_CLAIM_MINUTES` is a heuristic: "silent for ten minutes" is not "dead", so a hung worker can
 * still be alive when its job is reclaimed, and then two workers are running one job. Without the
 * fence the LAST one to finish wins, which can be the zombie writing a stale `done` over the fresh
 * run's `failed` — or over a build that is still going. With it, a worker may only close the
 * attempt it was actually given, and a fenced-out worker must log and stop rather than retry.
 */
export async function finishBuild(
  client: any, jobId: string, attempt: number, ok: boolean, payload: any, error?: unknown,
): Promise<boolean> {
  const r = await client.query(
    `update packet_build_job
        set state = $2, finished_at = now(), result = $3, error = $4
      where id = $1 and attempts = $5 and state = 'running'`,
    [jobId, ok ? 'done' : 'failed',
     payload === undefined ? null : JSON.stringify(payload ?? null),
     ok ? null : String((error && (error as any).message) || error || 'build failed').slice(0, 500),
     attempt])
  return (r.rowCount || 0) > 0
}

/**
 * Fail any job that has burned its attempts, so it stops being re-claimed.
 *
 * Without this a job that crashes the worker every time is reclaimed forever: `claimNextBuild`
 * refuses it once `attempts >= MAX_ATTEMPTS`, which leaves it sitting in `running` looking active.
 * It is marked failed instead, and — because of the partial unique index — that also unblocks the
 * owner from queueing a fresh build of the same packet.
 */
export async function abandonExhausted(client: any, staleMinutes = STALE_CLAIM_MINUTES): Promise<number> {
  const r = await client.query(
    `update packet_build_job
        set state = 'failed', finished_at = now(),
            error = coalesce(error, 'the build did not finish after ' || attempts || ' attempt(s)')
      where state = 'running'
        and attempts >= $2
        and claimed_at < now() - ($1 || ' minutes')::interval
    returning id`, [String(staleMinutes), MAX_ATTEMPTS])
  return r.rowCount || 0
}

/**
 * One job, scoped to its owner.
 *
 * The owner predicate is not optional and is not decoration. `build-all` USED to load its
 * opportunity with no owner predicate at all — the same commit that wrote this comment closed that,
 * so read the present tense here as history, not as a live hole. An in-process evidence call had
 * shipped hours earlier without an ownership check because "the caller is past the auth gate" —
 * true of authentication, false of authorization. A job id is a bearer token for whatever the job
 * contains, so the read is scoped at the query.
 */
export async function getBuildJob(client: any, jobId: string, owner: string): Promise<BuildJob | null> {
  const r = await client.query(
    `select * from packet_build_job where id=$1 and owner_email=$2`, [jobId, owner])
  return r.rows[0] || null
}
