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
 * The asset HEADER starts collapsed (P8.7: "Asset headers are collapsed by default").
 *
 * This is NOT in tension with AssetBlocks' `defaultOpen = true`, and the plan says so in as many
 * words: "Blocks default OPEN; asset headers default COLLAPSED (different objects - not a
 * conflict, but trivially misread as one)." The asset header is the disclosure around a whole
 * artifact; the block is the disclosure around the merge fields INSIDE it. Opening the header
 * therefore reveals the fields already open, which is the point - one click, not two.
 *
 * It is a constant rather than a literal `useState(false)` so a test can name the two defaults in
 * ONE assertion and fail if either flips. A fix that collapses the wrong object is the specific
 * mistake this guards.
 */
export const ASSET_HEADER_DEFAULT_OPEN = false
