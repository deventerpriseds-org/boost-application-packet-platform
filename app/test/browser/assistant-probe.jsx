// Harness page for the assistant-panel browser probe (test/browser/run-assistant.mjs). Dev-server
// only: `vite build` takes index.html as its single input, so nothing here reaches production.
//
// It mounts the REAL <AssistantPanel> from src/screens/AssistantPanel.jsx, over a pane carrying the
// same `ee-scrollpane` class DesktopShell uses — because the panel is a shared `Overlay` drawer and
// the scroll-lock it relies on keys off that class. A replica would prove only that the replica
// matched.
//
// The seed is driven from OUTSIDE the panel, exactly as PacketBuilder drives it: a parent holds the
// slot, hands it down, and clears it when the panel says it is spent. That is the contract worth
// exercising in a browser — the Node test proves the reducer, and only a render proves the effect
// actually clears the slot rather than looping.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/theme.css'
import AssistantPanel from '../../src/screens/AssistantPanel.jsx'

const ARTIFACT = { id: 'art-1', type: 'compact_resume' }

function Probe() {
  const [seed, setSeed] = useState(null)
  const [artifact, setArtifact] = useState(ARTIFACT)
  const [reloads, setReloads] = useState(0)

  return (
    <div className="ee-scrollpane" style={{ height: '100vh', overflow: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <h2 style={{ fontSize: 16 }}>Assistant panel probe</h2>

        {/* Stands in for a field-level control forwarding its sentence up. The sentence is the one
            `shortenAction` produces, so the probe exercises a REAL request rather than lorem. */}
        <button type="button" id="seed-it" className="px-btn"
          onClick={() => setSeed('Shorten this field to fit its rule. It measures 70 words against 55-60 words. Keep the meaning and drop the padding.')}>
          Forward a sentence
        </button>

        <button type="button" id="drop-artifact" className="px-btn" style={{ marginLeft: 8 }}
          onClick={() => setArtifact(null)}>
          Close the asset
        </button>

        {/* The parent's view of the seed slot, rendered so the probe can assert the CLEAR happened
            rather than inferring it. */}
        <div id="seed-state" style={{ marginTop: 10, fontSize: 12 }}>
          seed={seed === null ? 'null' : 'set'} reloads={reloads}
        </div>

        <AssistantPanel
          artifact={artifact}
          seed={seed}
          onSeedConsumed={() => setSeed(null)}
          onSent={() => setReloads((n) => n + 1)} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Probe />)
