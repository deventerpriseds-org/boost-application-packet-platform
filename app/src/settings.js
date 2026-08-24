// The pure logic behind the Settings screens, split out for the same reason assetBlocks.js and
// qcRail.js were: `node --test` can import a .js module with no DOM, and it cannot import a .jsx.
// Settings.jsx is ~1,700 lines and every decision inside it was unreachable by a test, which is how
// the defect below survived in the one screen built specifically to stop settings being unreachable.

/**
 * The value to show in a `chk_*` control, given the settings payload the API publishes.
 *
 * THE DEFECT THIS EXISTS FOR. Columns are per-END (`chk_cover_words_min`, `chk_cover_words_max`) but
 * `CheckThresholds` publishes them as PAIRS (`coverWords: [250, 400]`). The screen derived a camel
 * key from the column name and looked it up directly, so `coverWordsMin` missed, the value came back
 * undefined, and the control rendered EMPTY. That was true of every min/max knob on the screen —
 * both cover-letter bands, both about-me bands, the exec-profile and core-accomplishments bands and
 * the skills totals. A blank box reads as "this setting is unset", not as "this screen failed to
 * load it", so the owner had no way to tell. Found while adding the resume-summary band, which would
 * have rendered blank beside them.
 *
 * Direct hit first — a scalar setting (`skillMaxChars`, `evidenceEscalateMax`) must never be
 * reinterpreted as half of a pair, and `evidenceEscalateMax` ends in `Max` precisely to make that
 * trap concrete. Only when the direct lookup finds nothing is the `Min`/`Max` suffix treated as an
 * index into a published pair.
 *
 * Returns `undefined` when the payload genuinely does not carry the setting, so the caller can tell
 * "absent" from a real zero. A `0` is a legitimate threshold and must survive.
 */
export function chkValueFor(column, checks) {
  if (!column || !checks) return undefined
  const camel = String(column).replace(/^chk_/, '').replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())
  const direct = checks[camel]
  if (direct !== undefined && direct !== null) return direct

  const m = /^(.*)(Min|Max)$/.exec(camel)
  if (!m) return undefined
  const pair = checks[m[1]]
  if (!Array.isArray(pair) || pair.length !== 2) return undefined
  const v = pair[m[2] === 'Min' ? 0 : 1]
  return v === null ? undefined : v
}
