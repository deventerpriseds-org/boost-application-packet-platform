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

function Probe() {
  const [drawer, setDrawer] = useState(false)
  const [modal, setModal] = useState(false)
  const [dark, setDark] = useState(false)
  React.useEffect(() => { document.documentElement.classList.toggle('proto-dark', dark) }, [dark])
  return (
    <div className="px-root">
      <div className="px-fade ee-scrollpane" id="pane" style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <button id="open-drawer" className="px-btn" onClick={() => setDrawer(true)}>Open drawer</button>
        <button id="open-modal" className="px-btn" onClick={() => setModal(true)}>Open modal</button>
        <button id="toggle-dark" className="px-btn" onClick={() => setDark((d) => !d)}>Dark</button>
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
