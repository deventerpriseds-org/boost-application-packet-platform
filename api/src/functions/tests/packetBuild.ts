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
