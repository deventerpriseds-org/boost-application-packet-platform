// Pure constants for the packet builder screen (the component lives in screens/PacketBuilder.jsx).
//
// No React import, no window/document, so `node --test` loads it and the two rules below are
// asserted rather than described. This is the same split assetGate.js / assetBlocks.js /
// qcRail.js already use, and it exists for the same recorded reason: logic that lived in a .jsx
// could not be loaded by the test runner at all, and a count bug shipped as the direct result.

/**
 * Every `data-qc` selector this screen renders. ui-verify.yml selects by CSS only, so a surface
 * with no hook can only be asserted by matching body text.
 *
 * `posting-body` / `posting-body-provenance` already existed as hand-typed strings; they are named
 * here so the screen has ONE hook vocabulary rather than a constant for the new surfaces and loose
 * strings for the old ones.
 */
export const PACKET_HOOKS = {
  assetAsk: 'packet-asset-ask',        // whole-asset List Tweaks (the video has no merge fields)
  assetAskBox: 'packet-asset-ask-box',
  assetAskSend: 'packet-asset-ask-send',
  assetRebuild: 'asset-rebuild',
  assetCard: 'asset-card',            // one artifact's card (carries data-qc-type)
  assetHeader: 'asset-header',        // its header - the disclosure (carries data-qc-open)
  assetToggle: 'asset-header-toggle',
  assetBody: 'asset-body',            // everything the header discloses
  postingBody: 'posting-body',
  postingBodyProvenance: 'posting-body-provenance',
  // Frontend checks-wiring gap: a write can save an artifact's text and still fail to recompute the
  // gate beside it in the same request (`checksStale`). This is the badge that says so on the card.
  assetStale: 'asset-stale',
}

/**
 * The artifact card's BODY - the draft itself - starts OPEN.
 *
 * RENAMED AND FLIPPED 2026-08-23. It was `ASSET_HEADER_DEFAULT_OPEN = false`, citing P8.7's "Asset
 * headers are collapsed by default". P8.7 is right; it was applied to the wrong object - which is
 * the exact mistake the old comment here said it was guarding against. The constant pinned the
 * VALUE and nothing pinned the MEANING.
 *
 * What "asset header" means in the design, established by reading the prototype rather than the
 * plan text (`scripts/render-spec.mjs`):
 *
 *   `qc/assets.jsx` -> `function AssetHeader()` is the "What this resume answers" COUNTERS PANEL -
 *   coverage cells, open items, "already corrected in this asset" - and it carries its own
 *   `React.useState(false)`. It sits INSIDE the artifact card, ABOVE the fields.
 *   `screens/INDEX.md` 09: "Artifact card header, gate badge, doc buttons, COLLAPSED ASSET HEADER"
 *   - the card is showing its fields, and only that panel is shut. 10 is it expanded.
 *
 * This app mapped "asset header" onto the disclosure around the WHOLE artifact card, so collapsing
 * it hid the entire body: every merge field, every provenance margin, every keyword chip. Measured
 * on production 2026-08-23 - `#/packet/2cb56fb3.../resume` rendered a body of 850 characters with
 * no blocks panel present at all, while the same packet's QC step rendered 6379. The draft, which
 * is the point of the screen, was behind a click nobody was told to make.
 *
 * The panel that SHOULD be collapsed does not exist yet - the app has no "What this X answers"
 * anywhere. Until it is built, P8.7 has nothing to apply to, and collapsing the body in its place
 * is strictly worse than leaving the draft visible.
 */
export const ASSET_BODY_DEFAULT_OPEN = true

/**
 * Regenerate an artifact, optionally steered by a note — the ONE sequencing rule, in one place.
 *
 * WHY THIS IS A FUNCTION AND NOT TWO INLINE HANDLERS. It is used by both artifact cards
 * (PacketBuilder and OppDetail). Written inline it was copied verbatim into the second screen, and
 * a copy of a rule about ORDERING is exactly the copy that drifts: the day one screen is changed to
 * fire the two calls concurrently, nothing catches it, and the symptom is silent — a rebuild that
 * ignored your note.
 *
 * THE ORDER IS THE WHOLE POINT. The generate path reads unresolved notes at its START
 * (`appPackets.ts:503`, into `revisionNotes`) and marks them resolved at its END (`:575`). So the
 * note must be durable in `packet.feedback` BEFORE generate runs. Fire them together, or generate
 * first, and the rebuild ignores the note and then resolves it — the note is consumed having
 * steered nothing, and `resolved` is precisely what stops it replaying, so it is gone.
 *
 * A FAILED NOTE ABORTS, it does not fall through to an unsteered rebuild. Three model passes that
 * the owner believes were steered and were not is the worse outcome, and it is the one that looks
 * like the model ignoring them rather than like a save that failed.
 *
 *   note      the raw prompt result: null/undefined = cancelled, '' = deliberate plain re-roll
 *   saveNote  async (text) -> the setArtifactStatus response; must report `feedbackAdded`
 *   generate  async () -> runs the rebuild
 *
 * Returns { ran, steered, reason, error } rather than throwing: every caller renders a toast, and
 * two of the three outcomes are not errors.
 */
export async function regenerateWithNote({ note, saveNote, generate }) {
  if (note === null || note === undefined) return { ran: false, steered: false, reason: 'cancelled' }
  const trimmed = String(note).trim()
  if (trimmed) {
    let res
    try {
      res = await saveNote(trimmed)
    } catch (e) {
      return { ran: false, steered: false, reason: 'note-failed', error: String((e && e.message) || e) }
    }
    // `feedbackAdded: false` is the server telling us the jsonb append failed while the status
    // change succeeded — it is NON-fatal there by design, and fatal HERE, because the note is the
    // only reason this rebuild differs from pressing the button with a blank prompt.
    if (!res || res.error) {
      return { ran: false, steered: false, reason: 'note-failed', error: String((res && res.error) || 'no response') }
    }
    if (!res.feedbackAdded) {
      return { ran: false, steered: false, reason: 'note-failed', error: 'the note was not stored' }
    }
  }
  await generate()
  return { ran: true, steered: !!trimmed, reason: trimmed ? 'steered' : 'plain' }
}
