/**
 * ONE implementation of "text was written to an artifact, so its checks are now stale — re-run them".
 *
 * WHY A MODULE OF ITS OWN, and it is not a style choice. The AC pass proposed putting this helper in
 * `appChecks.ts` (next to `evaluateArtifact`) or in `appPackets.ts`. Both create a STATIC IMPORT
 * CYCLE for the second caller, `appCorrections.ts`:
 *
 *   appChecks.ts:19   imports `listCorrections` from './appCorrections'
 *   appPackets.ts:16  imports `applyCorrectionPass` from './appCorrections'
 *
 * so either home gives `appCorrections -> (appChecks|appPackets) -> appCorrections`. This repo has
 * already paid for one of these once — `checkPrefs.ts` exists solely because
 * `appChecks <-> appRequirements` cycled (see the note at `appChecks.ts:26`). Rather than add a
 * second, `evaluateArtifact` is resolved here through a DYNAMIC import inside the function body, so
 * this module carries no static edge to `appChecks` at all and every caller can import it plainly.
 *
 * WHY IT EXISTS AT ALL — the render-path bypass, from `docs/qc-evidence/AC-judge-trigger-points.md`
 * (REVISION 2). `POST /artifact/{id}/document` and `POST /artifact/{id}/slides` both go through
 * `buildTemplatedArtifact`, whose write at `appPackets.ts:802` flips `status` from `todo` to
 * `review` — and NOTHING on that path called `evaluateArtifact`. Live proof, read from production
 * Postgres: packet `487cb017-2f3f-4f70-a573-0983b780ea75` holds a resume (4347 chars) and a
 * portfolio (2954 chars), both at status `review`, both with a real Google `doc_url`, and ZERO
 * `check_result` rows. Corpus-wide at the same moment: 8 of 200 artifacts had ever been checked.
 * The owner is shown a finished document marked ready to review with no gate, no check results and
 * no verdicts behind it. The same hole exists on four text writers that never re-check either
 * (`artifactContent`, `artifactAiEdit`, `artifactOwnerEdit`, `correctionRevert`).
 */

/** The one thing this helper needs from `appChecks`. Injectable so the invariant below is testable. */
export type ArtifactEvaluator = (client: any, artifactId: string, owner: string) => Promise<unknown>

/** Resolved lazily — see the module header. No static edge, so no cycle. */
const defaultEvaluator: ArtifactEvaluator = async (client, artifactId, owner) => {
  const { evaluateArtifact } = await import('./appChecks')
  return evaluateArtifact(client, artifactId, owner)
}

export interface RecheckOutcome {
  /** true when the evaluation ran. false when it threw — the caller's write still stands. */
  ok: boolean
  /** Present only when `ok` is false. Truncated, and safe to put in a response body. */
  error?: string
}

/**
 * Re-evaluate one artifact after its text changed. NEVER THROWS.
 *
 * THE NON-FATAL PROPERTY IS THE POINT, and it is inherited rather than invented: `runPacketBuild`
 * already wraps its own `evaluateArtifact` call in a per-artifact try/catch
 * (`appPackets.ts:1189`) precisely so "a build that produced four documents must not be reported as
 * failed because one gate could not be computed". The same reasoning applies harder to an owner's
 * save: a person's edit is persisted before this runs and must not be reported as having failed
 * because a gate could not be recomputed. So a failure is RETURNED, never raised, and the caller
 * surfaces it as a warning next to a successful write.
 *
 * CALL IT ONLY AFTER THE CALLER'S OWN TRANSACTION HAS COMMITTED. `evaluateArtifact` runs its own
 * `begin`/`commit` on the client it is handed (`appChecks.ts:264`), so calling this from inside an
 * open transaction nests them on one connection — the same hazard `appRemediation.ts:349-350`
 * records. `artifactOwnerEdit` and `correctionRevert` both `begin`/`commit` their write; both call
 * this after the `commit`, never inside it.
 */
export async function recheckAfterTextWrite(
  client: any,
  artifactId: string,
  owner: string,
  opts?: { evaluate?: ArtifactEvaluator; label?: string }
): Promise<RecheckOutcome> {
  try {
    await (opts?.evaluate || defaultEvaluator)(client, artifactId, owner)
    return { ok: true }
  } catch (e) {
    const error = String(e).slice(0, 200)
    console.warn(`[recheck] ${opts?.label || 'text write'} saved, but checks did not re-run for artifact ${artifactId}: ${error}`)
    return { ok: false, error }
  }
}
