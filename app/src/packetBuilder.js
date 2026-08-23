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
  assetRebuild: 'asset-rebuild',
  assetCard: 'asset-card',            // one artifact's card (carries data-qc-type)
  assetHeader: 'asset-header',        // its header - the disclosure (carries data-qc-open)
  assetToggle: 'asset-header-toggle',
  assetBody: 'asset-body',            // everything the header discloses
  postingBody: 'posting-body',
  postingBodyProvenance: 'posting-body-provenance',
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
