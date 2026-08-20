// Harness page for the asset-blocks browser probe (test/browser/run-asset-blocks.mjs).
// Dev-server only: `vite build` takes index.html as its single input, so nothing here ships.
//
// It mounts the REAL <AssetBlocks> from src/screens/AssetBlocks.jsx twice — a resume and a compact
// resume, the two byte-identical templates of one packet — wired through the same list-owner
// registry PacketBuilder uses. The API responses are intercepted by the runner (playwright route),
// so the rows under test are fixtures but the rendering path is the product's.
import React, { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/theme.css'
import AssetBlocks from '../../src/screens/AssetBlocks.jsx'
import { registerListOwners } from '../../src/assetBlocks.js'

const TYPE_LABEL = { resume: 'Resume', compact_resume: 'Compact resume' }

// One packet's provenance: the requirements endpoint returned nothing (an opportunity with no
// requirement rows) and the packet swaps table holds ONE decision for skills_1.
const provenance = {
  loading: false,
  requirements: null,
  swaps: {
    swaps: [{
      list: 'skills_1', action: 'swapped', driver: 'posting', seq: 0,
      from_label: 'Led roadmap work', to_label: 'Owned the integrated product roadmap',
      rationale: 'the posting asks for roadmap ownership',
      verbatim_quote: 'own the integrated product roadmap',
    }],
  },
}

function Probe() {
  const [listOwners, setListOwners] = useState({})
  const register = useCallback((id, label, lists) => {
    setListOwners((prev) => registerListOwners(prev, id, label, lists))
    window.__registerCalls = (window.__registerCalls || 0) + 1
  }, [])
  return (
    <div className="px-root" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {['resume', 'compact_resume'].map((type) => (
        <div key={type} id={`card-${type}`} className="px-box" style={{ padding: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{TYPE_LABEL[type]}</div>
          <AssetBlocks
            artifact={{ id: `art-${type}`, type }}
            provenance={provenance}
            fallback={null}
            label={TYPE_LABEL[type]}
            listOwners={listOwners}
            onListsRendered={register}
          />
        </div>
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Probe />)
