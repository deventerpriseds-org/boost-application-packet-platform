import React, { useEffect, useState, useCallback } from 'react'
import { useApp, go } from '../state.jsx'
import { api } from '../api.js'
import { Pill } from '../shell.jsx'
import { Loading, ErrorBox } from './Today.jsx'

export default function Composer({ id }) {
  const { toast } = useApp()
  const [meta, setMeta] = useState({ loading: true, error: null })
  const [channels, setChannels] = useState([])
  const [tones, setTones] = useState(['Direct', 'Warm', 'POV-led'])
  const [contacts, setContacts] = useState([])
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')

  const [channel, setChannel] = useState('coldEmail')
  const [tone, setTone] = useState('Direct')
  const [contactId, setContactId] = useState(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [messageId, setMessageId] = useState(null)

  const load = useCallback(async () => {
    try {
      const [o, out] = await Promise.all([api.getOpportunity(id), api.listOutreach(id)])
      if (o.error) throw new Error(o.error)
      if (out.error) throw new Error(out.error)
      setCompany(out.company || o.company); setRole(out.role || o.role)
      setChannels(out.channels || [])
      setTones(out.tones || tones)
      setContacts(o.contacts || [])
      setMeta({ loading: false, error: null })
    } catch (err) { setMeta({ loading: false, error: String(err.message || err) }) }
  }, [id])
  useEffect(() => { load() }, [load])

  const generate = async (ch = channel, tn = tone, cid = contactId) => {
    setBusy(true)
    try {
      const res = await api.generateOutreach(id, { channel: ch, tone: tn, contactId: cid })
      if (res.error) throw new Error(res.error)
      setBody(res.message.body); setMessageId(res.message.id)
      toast(`Drafted ${res.message.channelLabel} · ${res.chars} chars`)
    } catch (err) { toast(`Generate failed: ${err.message || err}`) }
    finally { setBusy(false) }
  }

  const send = async () => {
    if (!messageId) { toast('Generate a draft first.'); return }
    const res = await api.setOutreachState(messageId, 'sent')
    if (res.error) toast(`Failed: ${res.error}`); else toast('Marked as sent ✓')
  }
  const copy = () => { try { navigator.clipboard?.writeText(body) } catch {} toast('Copied to clipboard') }

  if (meta.loading) return <Loading />
  if (meta.error) return <ErrorBox error={meta.error} />

  const ch = channels.find((c) => c.id === channel) || { label: channel, limit: 2000 }
  const over = body.length > ch.limit
  const contact = contacts.find((c) => c.id === contactId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="px-small">
        <span className="px-link" onClick={() => go('/outreach')}>← Outreach queue</span> · <span className="px-link" onClick={() => go(`/opp/${id}`)}>{company} detail</span>
      </div>

      {/* Channel tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {channels.map((c) => (
          <button key={c.id} className={`px-btn${channel === c.id ? ' px-btn-dark' : ''}`} onClick={() => { setChannel(c.id); setBody(''); setMessageId(null) }}>
            {c.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {/* Editor column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Recipient + tone */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>To</span>
            <button className={`px-chip`} onClick={() => setContactId(null)} style={{ cursor: 'pointer', background: contactId == null ? 'var(--surface-brand-default)' : 'var(--proto-panel)', color: contactId == null ? 'var(--text-on-brand)' : 'var(--proto-ink2)' }}>General</button>
            {contacts.map((c) => (
              <button key={c.id} className="px-chip" onClick={() => setContactId(c.id)} style={{ cursor: 'pointer', background: contactId === c.id ? 'var(--surface-brand-default)' : 'var(--proto-panel)', color: contactId === c.id ? 'var(--text-on-brand)' : 'var(--proto-ink2)' }}>{c.name}</button>
            ))}
            <div style={{ flex: 1 }} />
            <span className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Tone</span>
            {tones.map((t) => (
              <button key={t} className={`px-btn${tone === t ? ' px-btn-accent' : ''}`} style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setTone(t)}>{t}</button>
            ))}
          </div>

          {/* Editor */}
          <div className="px-box" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--proto-rule-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="px-small">{ch.label}{contact ? ` · to ${contact.name}` : ''}</span>
              <div style={{ flex: 1 }} />
              <span className="px-small" style={{ color: over ? 'var(--proto-red)' : 'var(--proto-ink3)', fontWeight: over ? 700 : 400 }}>{body.length} / {ch.limit}{over ? ' · over limit' : ''}</span>
            </div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={busy ? 'Generating…' : 'Generate a draft or write your own…'}
              style={{ minHeight: 260, border: 'none', outline: 'none', background: 'var(--proto-paper)', color: 'var(--proto-ink)', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 14, padding: 12, resize: 'vertical', lineHeight: 1.55 }} />
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="px-btn px-btn-accent" disabled={busy} onClick={() => generate()}>{busy ? 'Generating…' : (messageId ? '↻ Regenerate' : 'Generate draft')}</button>
            <button className="px-btn" onClick={copy}>⧉ Copy</button>
            <div style={{ flex: 1 }} />
            <button className="px-btn px-btn-green" onClick={send}>Send / queue</button>
          </div>
        </div>

        {/* Personalization rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--proto-ink2)', marginBottom: 6 }}>Personalization</div>
            <div className="px-box" style={{ padding: 12, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div><b>{role}</b> · {company}</div>
              {contact ? (
                <>
                  <div>To: <b>{contact.name}</b> — {contact.role}</div>
                  {contact.signal && <div>⚡ {contact.signal}</div>}
                  {contact.match != null && <div>Match: {contact.match}%</div>}
                </>
              ) : <div className="px-small">Pick a contact above to tailor to a specific stakeholder.</div>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--proto-ink2)', marginBottom: 6 }}>Channel</div>
            <div className="px-box" style={{ padding: 12, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Limit</span><b>{ch.limit} chars</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Status</span>{over ? <Pill tone="red">over limit</Pill> : <Pill tone="green">within limit</Pill>}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
