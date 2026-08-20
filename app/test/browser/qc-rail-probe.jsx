// Harness page for the QC rail browser probe (test/browser/run-qc-rail.mjs).
// Dev-server only: `vite build` takes index.html as its single input, so nothing here ships.
//
// It mounts the REAL <QcRail> through the REAL useQcEntries hook, so the api.js call path (and its
// ?owner= parameter) is the product's. Only the HTTP responses are fixtures, fulfilled by the
// runner's playwright route - the rendering path under test is not simulated.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/theme.css'
import QcRail, { useQcEntries } from '../../src/screens/QcRail.jsx'

// One posting spine. nice_to_have has ZERO rows on purpose: its card must still appear, reading
// "none extracted", or a whole missing class looks like a complete screen.
const REQUIREMENTS = [
  { id: 'r0', seq: 0, kind: 'must_have', verbatim: 'Ten years of product leadership', item_text: 'ten years' },
  { id: 'r1', seq: 1, kind: 'must_have', verbatim: 'Lead a team of 60+ engineers', item_text: 'lead 60 engineers' },
  { id: 'r2', seq: 2, kind: 'responsibility', verbatim: null, item_text: 'Own the integrated roadmap' },
]

const ARTIFACTS = [
  // `approved` with findings on purpose: the QC step must not read this as done.
  { id: 'art-resume', type: 'resume', status: 'approved' },
  { id: 'art-cover', type: 'cover', status: 'review' },
  { id: 'art-portfolio', type: 'portfolio', status: 'todo' },
]

function Probe() {
  const { entries, setResult } = useQcEntries(ARTIFACTS, { withInsertions: true })
  return (
    <div className="px-root" style={{ padding: 20 }}>
      <QcRail packetId="pkt-1" company="Acme" role="VP Product"
        entries={entries} setResult={setResult}
        requirements={REQUIREMENTS} reqError={null} reqLoading={false} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Probe />)
