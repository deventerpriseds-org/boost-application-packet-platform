// TEMPORARY verifier harness (PR #47 independent verification). Deleted after the run.
// Mounts the REAL <AssetBlocks> with provenance that carries requirement rows, so the chips,
// the legend, the "N corrected" token and the "Wording kept from the posting" margin can all be
// asserted from the rendered DOM rather than from a source grep.
import React, { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/theme.css'
import AssetBlocks from '../../src/screens/AssetBlocks.jsx'
import { registerListOwners } from '../../src/assetBlocks.js'

const provenance = {
  loading: false,
  requirements: {
    total: 3,
    requirements: [
      // model_keyword is jd_table's ATS Keyword. THREE deliberately different shapes:
      // req-1 has a keyword AND a locatable posting line; req-3 has a keyword but verbatim is null
      // (unlocatable); req-2 has NO keyword, so its field must render no chip group at all rather
      // than an empty one or "0 keywords".
      { id: 'req-1', seq: 1, kind: 'must_have', item_text: 'roadmap ownership', competency: 'product',
        model_keyword: 'roadmap ownership', verbatim: 'own the product roadmap end to end' },
      { id: 'req-2', seq: 2, kind: 'nice_to_have', item_text: 'vendor selection', competency: 'ops',
        model_keyword: null, verbatim: null },
      { id: 'req-3', seq: 3, kind: 'responsibility', item_text: 'coach PMs', competency: 'people',
        model_keyword: 'coaching', verbatim: null },
    ],
  },
  swaps: { swaps: [] },
}

function Probe() {
  const [listOwners, setListOwners] = useState({})
  const register = useCallback((id, label, lists) => {
    setListOwners((prev) => registerListOwners(prev, id, label, lists))
  }, [])
  return (
    <div className="px-root" style={{ padding: 20 }}>
      <div id="card-resume" className="px-box" style={{ padding: 14 }}>
        <AssetBlocks
          artifact={{ id: 'art-resume', type: 'resume' }}
          provenance={provenance}
          fallback={null}
          label="Resume"
          listOwners={listOwners}
          onListsRendered={register}
        />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Probe />)
