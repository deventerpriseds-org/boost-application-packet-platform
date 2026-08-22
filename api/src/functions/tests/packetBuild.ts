// P7 item 6 — what a packet build may CLAIM, as pure logic.
//
// This exists because the guards written for it were inert. They asserted that the source contained
// the string `ok: !failed.length && !warned.length`; forcing `failed` and `warned` empty while
// leaving that literal in place passed all three, and so did emptying `built.warnings` at the
// source. They tested spelling. Renaming a variable failed them. That is precisely backwards, and
// it is the second time in this lane a grep-shaped guard was evaded by a rename.
//
// The logic is therefore lifted out of the HTTP handler — which needs Drive, Postgres and OpenAI to
// exercise — into a function a test can call with real inputs and assert on real outputs. Same split
// as `checks.ts` vs `appChecks.ts`: no @azure/functions, no pg, no network.

export interface BuiltArtifact {
  type: string
  url?: string
  error?: string
  warnings?: string[]
  qcApplied?: boolean | null
}

export interface BuildSummary {
  /** True only when every artifact built AND none of them built with a warning. */
  ok: boolean
  built: number
  failed: number
  warnings: string[]
  note: string
}

/**
 * `ok` means "every artifact built, and none with a warning" — not "the handler returned".
 *
 * The defect this replaces: `packetBuildAll` returned `ok: true, note: 'Packet built.'` EVEN WHEN
 * EVERY ARTIFACT THREW. The per-artifact error sat in the payload, but the one field a caller reads
 * said success. A build that produced nothing reported the same thing as a build that produced
 * everything.
 */
/**
 * How a QUEUED build ended — a different question from `summariseBuild().ok`, and conflating the two
 * mislabelled a real build.
 *
 * `summariseBuild().ok` means "clean": no failures AND no warnings. That is a QUALITY signal, and it
 * is false for almost every real packet — the first build to run through the queue produced four
 * documents, all four written, and 42 warnings, which is an ordinary good outcome. Mapping that
 * `ok:false` straight onto the job state recorded it as `failed`, so the owner would have been told
 * their build failed while looking at four finished documents. Exactly the lie the queue was built to
 * stop telling, reintroduced one layer up.
 *
 * A job FAILED when there is nothing to show for it or an artifact did not build: the owner has to
 * act. Warnings travel in the payload, where the screen can render them without calling the build a
 * failure.
 */
export function buildJobOutcome(status: number, body: any): { ok: boolean; error: string | null } {
  if (status !== 200) return { ok: false, error: (body && body.error) || `the build returned HTTP ${status}` }
  if (!body) return { ok: false, error: 'the build returned no result' }
  if (body.error) return { ok: false, error: String(body.error) }
  if ((body.failed || 0) > 0) return { ok: false, error: String(body.note || `${body.failed} artifact(s) failed to build`) }
  if ((body.built || 0) === 0) return { ok: false, error: String(body.note || 'the build produced no artifacts') }
  return { ok: true, error: null }
}

export function summariseBuild(results: BuiltArtifact[]): BuildSummary {
  const rows = results || []
  const failed = rows.filter(r => r.error)
  const warned = rows.filter(r => !r.error && (r.warnings || []).length)
  const warnings = warned.flatMap(r => (r.warnings || []).map(w => `${r.type}: ${w}`))
  const note = failed.length
    ? `${failed.length} of ${rows.length} artifact(s) FAILED to build: ${failed.map(r => r.type).join(', ')}. Nothing was sent.`
    : warned.length
      ? `Packet built with ${warnings.length} warning(s) across ${warned.length} artifact(s). Nothing was sent.`
      : 'Packet built. Nothing was sent.'
  return { ok: !failed.length && !warned.length, built: rows.length - failed.length, failed: failed.length, warnings, note }
}
