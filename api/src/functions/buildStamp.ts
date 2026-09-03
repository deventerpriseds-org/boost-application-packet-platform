// WHAT:       Which commit the CODE THAT IS ANSWERING was built from, read out of the deployed
//             bundle rather than out of an app setting.
// WHY:        `api-deploy.yml` refuses to run pg-migrate until the worker reports the sha it just
//             deployed -- the guard that stops a migration running against the PREVIOUS bundle. It
//             read `process.env.DEPLOYED_SHA`, an APP SETTING the workflow writes in a step BEFORE
//             the code deploy, so the value flipped to the new sha while the old bundle was still
//             serving and the poll cleared on attempt 1 every time. A gate that checks a label the
//             gate itself wrote cannot fail.
// SUPERSEDES: nothing -- `DEPLOYED_SHA` remains as the fallback, see below.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   Measured twice, the same way, five months apart:
//               2026-08-28  "pg-migrate ran the PREVIOUS bundle's SCHEMA_SQL, answered ok:true,
//                           '31/31 tables present', and the JD column rename had not happened"
//                           (api-deploy.yml's own comment).
//               2026-09-03  run 33731929584 and again 33732790777: both reported
//                           "worker is serving <sha> after 1 attempt(s)" and both ran the old
//                           bundle. The second is the proof, because that deploy CONTAINED a
//                           33-entry EXPECTED_TABLES and the running code still answered
//                           "32/32 tables present". `owner_master_block` was never created.
//
// THE DISTINCTION THAT MATTERS. An app setting and a code bundle are two different things that both
// change during a deploy, and only one of them is what pg-migrate executes. Polling the setting is
// the proxy; polling something compiled INTO the bundle is the ground truth. This file is that
// something: it ships inside the zip, so its value cannot change until the new bundle is serving.
//
// The committed value is a placeholder. `api-deploy.yml` rewrites this file with the real commit
// BEFORE `npm run build`, so the sha is compiled into `dist/` and travels with the code.

/**
 * The commit this bundle was built from, or `null` in a local/unstamped build.
 *
 * NOT a literal `'dev'` string: a caller comparing this against a real sha must be able to tell
 * "this build is unstamped" from "this build is stamped with something else", and a sentinel that
 * looks like a value invites the first to be read as the second.
 */
export const BUILD_SHA: string | null = null

/**
 * What `/api/health` reports as `deployedSha`.
 *
 * The BUNDLE wins. `DEPLOYED_SHA` stays as a fallback so an unstamped build (a local run, or a
 * deploy from a path that has not adopted the stamp) keeps the behaviour it had rather than
 * reporting nothing -- but it can no longer mask a stale bundle, because a stamped bundle never
 * consults it.
 */
export function servingSha(): string | null {
  return BUILD_SHA || process.env.DEPLOYED_SHA || null
}
