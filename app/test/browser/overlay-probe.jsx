// Harness page for the Overlay browser probe (test/browser/run.mjs). Dev-server only: `vite build`
// takes index.html as its single input, so nothing here reaches the production bundle.
//
// It mounts the REAL <Overlay> from src/shell.jsx over a scroll pane that carries the same
// `ee-scrollpane` class DesktopShell uses, so the scroll-lock and close-on-navigation behaviour
// under test is the behaviour the app gets.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/theme.css'
import { Overlay } from '../../src/shell.jsx'
import { HIGHLIGHT_CLASS } from '../../src/highlight.js'
import { PostingAnalysisCard } from '../../src/screens/PostingAnalysis.jsx'

// One extracted line with a model keyword, so the Keywords tab has something to lay out. The
// breakpoint under test is about the LAYOUT, so the content only has to be non-empty and real.
const REQ = {
  total: 1, located: 1, jdTextLen: 4200, requirements: [{
    id: 'r1', seq: 1, kind: 'must_have', kind_source: 'posting_required_marker',
    item_text: '10+ years leading platform teams', verbatim: '10+ years leading platform teams',
    char_start: 40, char_end: 72, match_method: 'exact', model_keyword: 'platform leadership',
  }],
}

function Probe() {
  const [drawer, setDrawer] = useState(false)
  const [modal, setModal] = useState(false)
  const [dark, setDark] = useState(false)
  // Mirrors state.jsx exactly: the class AND the attribute. `.proto-dark` alone leaves the
  // 104-token Compass dark palette unapplied, so a probe that toggled only the class would be
  // testing a theme the app never renders.
  React.useEffect(() => {
    document.documentElement.classList.toggle('proto-dark', dark)
    if (dark) document.documentElement.setAttribute('data-theme', 'dark')
    else document.documentElement.removeAttribute('data-theme')
  }, [dark])
  return (
    <div className="px-root">
      <div className="px-fade ee-scrollpane" id="pane" style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <button id="open-drawer" className="px-btn" onClick={() => setDrawer(true)}>Open drawer</button>
        <button id="open-modal" className="px-btn" onClick={() => setModal(true)}>Open modal</button>
        <button id="toggle-dark" className="px-btn" onClick={() => setDark((d) => !d)}>Dark</button>
        {/* D11: the two in-text highlights, painted through the shared classes so the probe reads
            the SAME declarations the product does. */}
        <div style={{ marginTop: 12 }}>
          <span id="kw-highlight" className={HIGHLIGHT_CLASS.keyword}>roadmap ownership</span>{' '}
          <span id="echo-highlight" className={HIGHLIGHT_CLASS.postingEcho}>own the integrated product roadmap</span>
        </div>
        {/* P8.7: the real posting-analysis card, for the keyword list's 2-up / 1-up breakpoint. */}
        <div id="posting-card" style={{ marginTop: 12 }}>
          <PostingAnalysisCard req={REQ} reqError={null} reloadReq={() => {}}
            coveredKw={['roadmap', 'intake', 'scorecard']} missingKw={['governance']} gapsScoredAt={null}
            onParse={() => {}} parseBusy={false} hasSummary keywordScore={null} />
        </div>
        <div style={{ height: 4000 }}>tall content</div>
      </div>
      {drawer && (
        <Overlay variant="drawer" title="Resume" subtitle="Acme - VP Product" onClose={() => setDrawer(false)}
          footer={<button id="drawer-approve" className="px-btn">Approve</button>}>
          <div id="drawer-body">drawer body</div>
          <button id="drawer-inner" className="px-btn">Inner</button>
          <button id="drawer-open-modal" className="px-btn" onClick={() => setModal(true)}>Nested modal</button>
        </Overlay>
      )}
      {modal && (
        <Overlay variant="modal" title="ATS analysis" onClose={() => setModal(false)}>
          <div id="modal-body">modal body</div>
        </Overlay>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Probe />)
