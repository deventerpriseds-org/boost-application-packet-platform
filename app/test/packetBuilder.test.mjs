import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The load-bearing half of the regen fix, and it had no test at all.
//
// `api.js` forwarding `regen` is provable and was proven. But the branch's own reasoning is that
// fixing api.js alone "would have changed nothing a user can reach", because both screens replaced
// the create button with a link once `docUrl` was set — so on exactly the artifacts where a cache
// bypass matters there was no control to press. A verifier deleted the entire Rebuild block from
// PacketBuilder and the suite stayed green at 147/147. The half that makes the fix reachable was
// unguarded while the half that is merely plumbing was revert-proof.
test('both screens expose a Rebuild control in the branch where a doc already exists', () => {
  const read = (f) => readFileSync(new URL(`../src/screens/${f}`, import.meta.url), 'utf8')
  for (const file of ['PacketBuilder.jsx', 'OppDetail.jsx']) {
    const src = read(file)
    // The control exists...
    assert.match(src, /Rebuild from current draft/, `${file} has no Rebuild control`)
    assert.match(src, /data-qc="asset-rebuild"|PACKET_HOOKS\.assetRebuild/, `${file}'s Rebuild control has no selector to verify against`)
    // ...it asks for a regen...
    assert.match(src, /\{\s*regen:\s*true\s*\}/, `${file}'s Rebuild does not request a regen`)
    // ...and it lives in the docUrl-present branch, which is the whole point. Anchor on the region
    // between `a.docUrl ?` and its `) :` so a Rebuild control added somewhere else does not pass.
    const i = src.indexOf('a.docUrl ? (')
    assert.ok(i > 0, `${file} no longer branches on a.docUrl`)
    const region = src.slice(i, src.indexOf(') : ', i))
    assert.match(region, /Rebuild from current draft/,
      `${file}: the Rebuild control is not in the branch where the doc already exists — which is the only state it matters in`)
  }
})
