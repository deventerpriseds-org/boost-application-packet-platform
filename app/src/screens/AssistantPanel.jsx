// SPEC 4.11 — the assistant, as a floating drawer.
//
// It REUSES `Overlay variant="drawer"` (shell.jsx) rather than positioning anything itself. That is
// not laziness: the drawer already clamps to `min(680px, 100vw)` so it survives a phone, already
// owns the overlay stack, the focus trap and close-on-navigation, and is already the pattern
// `AssetGateDrawer` uses on this same screen. A second hand-rolled panel would be the parallel
// system the extend-don't-duplicate rule forbids, and it would be the one without the focus trap.
//
// WHAT THIS PANEL IS NOT. It does not replace the per-field ask box. SPEC §2's ground rule R6 and
// §4.7 both require correction "in place, scoped to the field they are looking at", so the field
// boxes REMAIN and this is a second destination for the same sentences, never a substitute. Every
// quick action still seeds; nothing here sends on the reader's behalf.
import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { Overlay } from '../shell.jsx'
import { ASSISTANT_HOOKS, ASSISTANT_LIMITS, applySeed, assistantScopes, assistantSendBody, canSend, DOCK_WIDTH } from '../assistantPanel.js'

export default function AssistantPanel({ artifact = null, field = null, seed = null, onSeedConsumed, onSent, mode = 'float' }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // The confirmation OUTLIVES the box that produced it, for the same reason `askSent` does in
  // AssetBlocks: the success path closes the drawer, so anything rendered inside it would unmount at
  // the instant it became true and the reader could not tell "sent" from "the button did nothing".
  const [sent, setSent] = useState(null)
  const boxRef = useRef(null)

  // SPEC 4.11-4. The options are whatever ROUTES, never the prototype's three -- see
  // assistantScopes(). With no field in hand there is one option and the selector does not render:
  // a picker with a single choice is furniture.
  const { options: scopeOptions, artifactId: scopeArtifactId } = assistantScopes(artifact, field)
  const [scopeId, setScopeId] = useState(null)
  // The default follows the READER: opened from a field, the field is preselected, because that is
  // what they were looking at. `scopeId` is reset rather than remembered when the options change --
  // a stale 'field' selection on an artifact with no field would send a section that is not there.
  const chosen = scopeOptions.find((o) => o.id === scopeId) || scopeOptions[0] || null
  useEffect(() => { setScopeId(null) }, [artifact && artifact.id, field])
  const scope = { artifactId: scopeArtifactId, text: chosen ? chosen.text : 'Open an asset first - a request has to name the document it changes.' }

  // THE SEED CONTRACT, applied through the pure reducer so the clear cannot be forgotten: set the
  // text, open, and tell the parent the slot is spent. Without that last step the same sentence
  // re-applies on the next render and quietly overwrites what the reader had started typing.
  useEffect(() => {
    if (!seed) return
    const next = applySeed({ seed, text })
    setText(next.text)
    setOpen(next.open)
    setSent(null)
    setError(null)
    if (onSeedConsumed) onSeedConsumed()
    // The seeded sentence is the reader's to edit, so focus lands in the box with the caret at the
    // end rather than selecting it — selecting invites an accidental overwrite of the whole request.
    const t = setTimeout(() => {
      const el = boxRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  const sendable = canSend({ text, artifactId: scope.artifactId, busy })

  const send = async () => {
    if (!sendable) return
    setBusy(true)
    setError(null)
    const asked = text.trim()
    try {
      // THE SAME ROUTE THE FIELD BOX USES. This panel adds a destination for a request, never a
      // second way to change a document.
      // The chosen scope decides `section`, which is what the handler reads to pick between one
      // merge field (`pkg[section]`) and the whole asset (`art.content`). The body is built in
      // ../assistantPanel.js so this component cannot invent a shape.
      await api.aiEditArtifact(scope.artifactId, assistantSendBody({ instruction: asked, scopeId: chosen && chosen.id, field }))
      setText('')
      setOpen(false)
      if (onSent) await onSent()
      setSent(asked)
    } catch (e) {
      setError(String((e && e.message) || e))
    } finally {
      setBusy(false)
    }
  }

  // ONE BODY, THREE PLACEMENTS. Built once here and positioned by `mode` below, so a change to the
  // scope line, the limits or the send button reaches all three presentations. The alternative --
  // a docked column duplicating the drawer's contents -- is the driftable second surface the
  // pre-2026-09-02 comment in assistantPanel.js correctly warned against; docking without
  // extracting the body is what would have made that warning come true.
  //
  // `data-qc-mode` now carries the REAL mode. It used to be the literal "float" with a comment
  // calling it "the assertable record that this app made a layout decision the prototype did not";
  // that record is only worth anything if it can disagree with itself, so it is now derived.
  const body = (
    <div data-qc={ASSISTANT_HOOKS.panel} data-qc-mode={mode}>

      {/* SPEC 4.11-4. The selector renders only when there is a real choice; below it the same
          sentence states what the chosen scope will touch, so the scope is both selectable AND
          stated. The prototype's other two chips ("This packet", "My profile") are omitted rather
          than rendered inert: no packet-level write route exists, and the profile route takes a
          structured fact rather than an instruction. */}
      {scopeOptions.length > 1 && (
        <div data-qc={ASSISTANT_HOOKS.scopePick} style={{ display: 'flex', gap: 5, marginBottom: 7 }}>
          {scopeOptions.map((o) => {
            const on = chosen && chosen.id === o.id
            return (
              <span key={o.id} role="button" tabIndex={0}
                data-qc={ASSISTANT_HOOKS.scopeChip} data-qc-scope={o.id} data-qc-on={on ? '1' : '0'}
                onClick={() => setScopeId(o.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  setScopeId(o.id)
                }}
                style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
                  background: on ? 'var(--surface-brand-default)' : 'var(--proto-panel)',
                  color: on ? 'var(--text-on-brand)' : 'var(--proto-ink2)' }}>{o.label}</span>
            )
          })}
        </div>
      )}
      <div className="px-small" data-qc={ASSISTANT_HOOKS.scope} style={{ textTransform: 'none', marginBottom: 10 }}>
        {scope.text}
      </div>

      <textarea ref={boxRef} className="px-input" rows={5} value={text}
        data-qc={ASSISTANT_HOOKS.box}
        placeholder="Ask for a change to this asset"
        onChange={(e) => setText(e.target.value)}
        style={{ width: '100%', resize: 'vertical' }} />

      {error && <div className="px-note" data-qc={ASSISTANT_HOOKS.error} style={{ marginTop: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button type="button" className="px-btn" disabled={busy}
          onClick={() => { setText(''); setError(null) }}>Clear</button>
        <button type="button" className="px-btn px-btn-accent"
          data-qc={ASSISTANT_HOOKS.send} disabled={!sendable}
          onClick={send}>{busy ? 'Sending...' : 'Send'}</button>
      </div>

      {/* WHAT IT CANNOT DO, said rather than drawn as disabled controls. SPEC 4.11-7's `Keep`
          and `Revert` are absent because neither has anything to call - `aiEditArtifact` commits
          before it replies and writes no revertible row. A disabled button would still assert
          the capability exists; a sentence does not. */}
      <div className="px-small" data-qc={ASSISTANT_HOOKS.limits}
        style={{ textTransform: 'none', marginTop: 14, color: 'var(--proto-ink2)', lineHeight: 1.6 }}>
        {ASSISTANT_LIMITS.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  )

  // DOCK — a real column, in flow, no launcher and no overlay. It is always visible, so there is
  // nothing to open and the `sent` toast belongs inside the column rather than pinned to the
  // viewport corner where it would float free of the thing it is reporting on.
  if (mode === 'dock') {
    return (
      <aside
        data-qc={ASSISTANT_HOOKS.dock}
        aria-label="Assistant"
        style={{
          width: DOCK_WIDTH, flexShrink: 0, alignSelf: 'flex-start',
          position: 'sticky', top: 16, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
        }}>
        <div className="px-card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Assistant</div>
          <div className="px-small" style={{ textTransform: 'none', marginBottom: 10 }}>
            {scope.label ? `Working on your ${scope.label}` : 'No asset open'}
          </div>
          {sent && (
            <div className="px-note" data-qc={ASSISTANT_HOOKS.sent} style={{ marginBottom: 8 }}>
              <b>Sent.</b> {'\u201c'}{sent}{'\u201d'} - the change will appear in that field{"'"}s change log.
              <span className="px-link" role="button" tabIndex={0} style={{ marginLeft: 8, fontSize: 12 }}
                onClick={() => setSent(null)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSent(null) } }}>
                Dismiss
              </span>
            </div>
          )}
          {body}
        </div>
      </aside>
    )
  }

  // FLOAT and SHEET share the launcher + Overlay; only the drawer edge differs. `Overlay` already
  // owns the stack, the scrim and close-on-navigation, so neither mode positions anything itself.
  // The launcher sits bottom-RIGHT on desktop and spans the bottom edge on a phone, where a corner
  // button competes with the sticky step controls and sits under the scrolling thumb.
  const isSheet = mode === 'sheet'
  return (
    <>
      <button type="button" className="px-btn"
        data-qc={ASSISTANT_HOOKS.open} data-qc-seeded={seed ? '1' : '0'}
        onClick={() => { setSent(null); setOpen(true) }}
        style={isSheet ? {
          position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 'var(--zindex-overlay)',
          boxShadow: '0 6px 20px rgba(15,23,42,.22)',
        } : {
          position: 'fixed', right: 18, bottom: 18, zIndex: 'var(--zindex-overlay)',
          boxShadow: '0 6px 20px rgba(15,23,42,.22)',
        }}>
        Open assistant
      </button>

      {sent && !open && (
        <div className="px-note" data-qc={ASSISTANT_HOOKS.sent}
          style={isSheet
            ? { position: 'fixed', left: 12, right: 12, bottom: 60, zIndex: 'var(--zindex-overlay)' }
            : { position: 'fixed', right: 18, bottom: 64, zIndex: 'var(--zindex-overlay)', maxWidth: 320 }}>
          <b>Sent.</b> {'\u201c'}{sent}{'\u201d'} - the change will appear in that field{"'"}s change log.
          <span className="px-link" role="button" tabIndex={0} style={{ marginLeft: 8, fontSize: 12 }}
            onClick={() => setSent(null)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSent(null) } }}>
            Dismiss
          </span>
        </div>
      )}

      <Overlay
        open={open}
        variant={isSheet ? 'sheet' : 'drawer'}
        onClose={() => setOpen(false)}
        title="Assistant"
        subtitle={scope.label ? `Working on your ${scope.label}` : 'No asset open'}
      >
        {body}
      </Overlay>
    </>
  )
}
