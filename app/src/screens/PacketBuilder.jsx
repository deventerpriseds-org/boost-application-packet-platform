import React, { useEffect, useState, useCallback } from 'react'
import { useApp, go } from '../state.jsx'
import { api } from '../api.js'
import { Pill } from '../shell.jsx'
import { Loading, ErrorBox } from './Today.jsx'

const TYPE_LABEL = {
  resume: 'Resume', compact_resume: 'Compact resume', cover: 'Cover letter',
  portfolio: 'Portfolio one-pager', video: 'Intro video script',
}
const TYPE_SUB = {
  resume: 'Keyword-tailored from your master resume',
  compact_resume: 'One-page · fits without overflow',
  cover: 'Specific to company & role',
  portfolio: '3 case studies mapped to pain points',
  video: '90-second tailored open',
}
const STATUS_TONE = { todo: 'panel', drafting: 'yellow', review: 'accent', changes: 'red', approved: 'green' }

export default function PacketBuilder({ id }) {
  const { toast } = useApp()
  const [state, setState] = useState({ loading: true, error: null, packet: null })
  const [busy, setBusy] = useState(null) // artifactId currently generating
  const [open, setOpen] = useState(null) // artifactId whose content is expanded

  const load = useCallback(async () => {
    try {
      const p = await api.getPacket(id)
      if (p.error) throw new Error(p.error)
      setState({ loading: false, error: null, packet: p })
    } catch (err) {
      setState({ loading: false, error: String(err.message || err), packet: null })
    }
  }, [id])
  useEffect(() => { load() }, [load])

  const patchArtifact = (artifactId, fields) => setState((s) => ({
    ...s, packet: { ...s.packet, artifacts: s.packet.artifacts.map((a) => (a.id === artifactId ? { ...a, ...fields } : a)) },
  }))

  const generate = async (a) => {
    setBusy(a.id)
    try {
      const res = await api.generateArtifact(a.id)
      if (res.error) throw new Error(res.error)
      patchArtifact(a.id, { status: res.artifactStatus, content: res.content })
      setState((s) => ({ ...s, packet: { ...s.packet, status: res.packetStatus } }))
      setOpen(a.id)
      toast(`Drafted ${TYPE_LABEL[a.type]}`)
    } catch (err) { toast(`Generate failed: ${err.message || err}`) }
    finally { setBusy(null) }
  }

  const setStatus = async (a, status) => {
    const prev = a.status
    patchArtifact(a.id, { status })
    try {
      const res = await api.setArtifactStatus(a.id, status)
      if (res.error) throw new Error(res.error)
      setState((s) => ({ ...s, packet: { ...s.packet, status: res.packetStatus } }))
      toast(status === 'approved' ? `Approved ${TYPE_LABEL[a.type]}` : `${TYPE_LABEL[a.type]} → ${status}`)
    } catch (err) { patchArtifact(a.id, { status: prev }); toast(`Update failed: ${err.message || err}`) }
  }

  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox error={state.error} />
  const p = state.packet
  const pct = p.total ? Math.round((p.approved / p.total) * 100) : 0
  const ready = p.status === 'ready'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="px-small px-link" onClick={() => go(`/opp/${id}/overview`)}>← Back to opportunity</div>

      {/* Header */}
      <div className="px-box" style={{ padding: 16, borderColor: ready ? 'var(--proto-green)' : 'var(--surface-brand-default)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-brand)' }}>Application packet</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{p.company} — {p.role}</div>
            <div className="px-small" style={{ marginTop: 2 }}>{p.approved}/{p.total} artifacts approved · packet {p.status}</div>
          </div>
          <div style={{ width: 160 }}>
            <div style={{ height: 8, background: 'var(--proto-panel-deep)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: ready ? 'var(--proto-green)' : 'var(--surface-brand-default)', transition: 'width 300ms ease' }} />
            </div>
          </div>
        </div>
        {ready && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Pill tone="green">Ready to ship ✓</Pill>
            <button className="px-btn px-btn-accent" onClick={() => toast('Sending is wired in the Outreach slice.')}>Ship packet →</button>
          </div>
        )}
      </div>

      {/* Artifact grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        {p.artifacts.map((a) => {
          const isOpen = open === a.id
          return (
            <div key={a.id} className="px-box" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{TYPE_LABEL[a.type]}</div>
                  <div className="px-small">{TYPE_SUB[a.type]}</div>
                </div>
                <Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>
              </div>

              {a.content && (
                <div>
                  <div onClick={() => setOpen(isOpen ? null : a.id)} className="px-link" style={{ fontSize: 12 }}>
                    {isOpen ? '▾ Hide draft' : '▸ View draft'}
                  </div>
                  {isOpen && (
                    <div className="px-box" style={{ padding: 10, marginTop: 6, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto', background: 'var(--proto-panel)' }}>
                      {a.content}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                {a.status === 'todo' && (
                  <button className="px-btn px-btn-accent" disabled={busy === a.id} onClick={() => generate(a)}>
                    {busy === a.id ? 'Generating…' : 'Generate draft'}
                  </button>
                )}
                {(a.status === 'review' || a.status === 'changes') && (
                  <>
                    <button className="px-btn px-btn-green" onClick={() => setStatus(a, 'approved')}>Approve</button>
                    <button className="px-btn" disabled={busy === a.id} onClick={() => generate(a)}>{busy === a.id ? 'Regenerating…' : 'Regenerate'}</button>
                    {a.status !== 'changes' && <button className="px-btn" onClick={() => setStatus(a, 'changes')}>Request changes</button>}
                  </>
                )}
                {a.status === 'approved' && (
                  <button className="px-btn" onClick={() => setStatus(a, 'review')}>Reopen</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
