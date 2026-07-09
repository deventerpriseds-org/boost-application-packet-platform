import React, { useEffect, useState, useCallback } from 'react'
import { useApp, go, useRoute } from '../state.jsx'
import { api } from '../api.js'
import { Pill, UrgencyPill, MatchScore } from '../shell.jsx'
import { Loading, ErrorBox } from './Today.jsx'

const STAGES = [
  { id: 'discovered', label: 'Discovered' }, { id: 'saved', label: 'Saved' },
  { id: 'enriched', label: 'Enriched' }, { id: 'applied', label: 'Applied' },
  { id: 'outreach', label: 'Outreach' }, { id: 'engaged', label: 'Engaged' },
  { id: 'screen', label: 'Screen' }, { id: 'r1', label: 'Round 1' },
  { id: 'panel', label: 'Panel' }, { id: 'final', label: 'Final' },
  { id: 'offer', label: 'Offer' }, { id: 'accepted', label: 'Accepted' },
]
const TABS = ['overview', 'contacts', 'outreach']

export default function OppDetail({ id, tab = 'overview' }) {
  const { toast } = useApp()
  const [state, setState] = useState({ loading: true, error: null, opp: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const opp = await api.getOpportunity(id)
      if (opp.error) throw new Error(opp.error)
      setState({ loading: false, error: null, opp })
    } catch (err) {
      setState({ loading: false, error: String(err.message || err), opp: null })
    }
  }, [id])
  useEffect(() => { load() }, [load])

  const move = async (stage) => {
    setState((s) => ({ ...s, opp: { ...s.opp, stage } }))
    const res = await api.moveStage(id, stage)
    if (res.error) { toast(`Move failed: ${res.error}`); load() }
    else toast(`${state.opp?.company} → ${STAGES.find((x) => x.id === stage)?.label}`)
  }

  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox error={state.error} />
  const o = state.opp
  const stageIdx = STAGES.findIndex((s) => s.id === o.stage)
  const advance = () => { if (stageIdx < STAGES.length - 1) move(STAGES[stageIdx + 1].id) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="px-small px-link" onClick={() => go('/opportunities')}>← All opportunities</div>

      {/* Header */}
      <div className="px-box" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>{o.role}</div>
              {o.urgency && <UrgencyPill urgency={o.urgency} />}
              {o.fit && <Pill tone="accent">{o.fit} fit</Pill>}
            </div>
            <div className="px-small" style={{ marginTop: 4 }}>
              {o.company} · {o.location || '—'} · {o.comp || '—'}{o.source ? ` · sourced from ${o.source}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <MatchScore value={o.match} size={44} />
            <button className="px-btn px-btn-accent" onClick={advance} disabled={stageIdx >= STAGES.length - 1}>Advance stage ›</button>
          </div>
        </div>

        {/* Stage stepper */}
        <div style={{ display: 'flex', gap: 4, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          {STAGES.map((s, i) => (
            <div key={s.id} onClick={() => move(s.id)}
              style={{ padding: '3px 9px', fontSize: 10, fontWeight: 700, cursor: 'pointer', borderRadius: 5,
                background: i <= stageIdx ? 'var(--surface-brand-default)' : 'var(--proto-panel)',
                color: i <= stageIdx ? 'var(--text-on-brand)' : 'var(--proto-ink2)' }}>
              {s.label}
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--proto-rule-soft)' }}>
        {TABS.map((t) => (
          <div key={t} onClick={() => go(`/opp/${id}/${t}`)}
            style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13, textTransform: 'capitalize',
              fontWeight: tab === t ? 600 : 500, color: tab === t ? 'var(--text-brand)' : 'var(--proto-ink2)',
              borderBottom: tab === t ? '2px solid var(--surface-brand-default)' : '2px solid transparent', marginBottom: -1 }}>
            {t}
          </div>
        ))}
      </div>

      {tab === 'overview' && <Overview o={o} toast={toast} />}
      {tab === 'contacts' && <Contacts contacts={o.contacts || []} toast={toast} />}
      {tab === 'outreach' && <Outreach o={o} />}
    </div>
  )
}

function Card({ title, sub, children }) {
  return (
    <div>
      {title && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--proto-ink2)', marginBottom: 6 }}>{title}{sub && <span className="px-small" style={{ marginLeft: 8, fontWeight: 400 }}>{sub}</span>}</div>}
      <div className="px-box" style={{ padding: 12 }}>{children}</div>
    </div>
  )
}

function Overview({ o, toast }) {
  const signals = o.signals || []
  const pain = o.pain || []
  const contacts = o.contacts || []
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Packet band */}
        <div className="px-box" style={{ padding: 14, borderColor: 'var(--surface-brand-default)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-brand)' }}>Application packet</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>Not started</div>
              <div className="px-small">Keyword-tailored resume, portfolio & intro · approval rounds</div>
            </div>
            <button className="px-btn px-btn-accent" onClick={() => toast('Packet builder is a later slice — coming soon.')}>Build packet →</button>
          </div>
        </div>

        {o.why && (
          <Card title="Why surfaced">
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>{o.why}</div>
          </Card>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <Card title="Company signals">
            {signals.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                {signals.map((s, i) => <div key={i}>• {s}</div>)}
              </div>
            ) : <div className="px-small">No signals captured yet.</div>}
          </Card>
          <Card title="Pain hypotheses">
            {pain.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                {pain.map((p, i) => <div key={i}>{i + 1}. {p}</div>)}
              </div>
            ) : <div className="px-small">No hypotheses yet.</div>}
          </Card>
        </div>

        <Card title="Stakeholder map" sub="enrichment found likely stakeholders">
          {contacts.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              {contacts.map((p, i) => (
                <div key={i} className="px-box" style={{ padding: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{p.name}</div>
                    <div className="px-small">{p.role}</div>
                    {p.signal && <div className="px-small" style={{ marginTop: 3 }}>⚡ {p.signal}</div>}
                  </div>
                  {p.match != null && <Pill tone="accent">{p.match}</Pill>}
                </div>
              ))}
            </div>
          ) : <div className="px-small">No stakeholders enriched yet.</div>}
        </Card>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card title="Status">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <StatusRow k="Stage" v={<Pill tone="accent">{o.stage}</Pill>} />
            <StatusRow k="Fit" v={o.fit ? <Pill tone="accent">{o.fit}</Pill> : '—'} />
            <StatusRow k="Urgency" v={o.urgency ? <UrgencyPill urgency={o.urgency} /> : '—'} />
            <StatusRow k="Match" v={<b>{o.match}%</b>} />
          </div>
        </Card>
        <Card title="Compensation target">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>Range</span><b>{o.comp || '—'}</b>
          </div>
        </Card>
        {(o.hm || o.recruiter) && (
          <Card title="Key contacts">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              {o.hm && o.hm !== '—' && <div><span className="px-small">Hiring manager</span> · <b>{o.hm}</b></div>}
              {o.recruiter && o.recruiter !== '—' && <div><span className="px-small">Recruiter</span> · <b>{o.recruiter}</b></div>}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function StatusRow({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid var(--proto-rule-soft)' }}>
      <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{k}</div>
      <div style={{ textTransform: 'capitalize' }}>{v}</div>
    </div>
  )
}

function Contacts({ contacts, toast }) {
  if (!contacts.length) return <div className="px-box" style={{ padding: 20, textAlign: 'center', color: 'var(--proto-ink2)' }}>No contacts enriched for this opportunity yet.</div>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
      {contacts.map((p, i) => (
        <div key={i} className="px-box" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</div>
            <div className="px-small">{p.role}</div>
            {p.signal && <div className="px-small" style={{ marginTop: 6 }}>⚡ {p.signal}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button className="px-btn" style={{ fontSize: 12 }} onClick={() => toast('Opening LinkedIn…')}>Open LinkedIn</button>
              <button className="px-btn px-btn-dark" style={{ fontSize: 12 }} onClick={() => toast('Outreach composer is a later slice.')}>Draft outreach</button>
            </div>
          </div>
          {p.match != null && <Pill tone="accent">{p.match}</Pill>}
        </div>
      ))}
    </div>
  )
}

// Representative cadence timeline (structure ported from the handoff; live cadence
// data lands with the Outreach slice).
function Outreach({ o }) {
  const rows = [
    { d: 0, task: 'Apply + send recruiter outreach', state: 'sent' },
    { d: 1, task: 'View LinkedIn + connect', state: 'sent' },
    { d: 3, task: 'First follow-up (recruiter)', state: 'sent' },
    { d: 5, task: 'Hiring manager outreach', state: 'due' },
    { d: 8, task: 'Value-add / portfolio link', state: 'scheduled' },
    { d: 10, task: 'Second recruiter follow-up', state: 'scheduled' },
    { d: 14, task: 'Pause, recycle, or archive', state: 'pending' },
  ]
  const tone = { sent: 'green', due: 'red', scheduled: 'accent', pending: 'panel' }
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--proto-ink2)', marginBottom: 8 }}>Cadence timeline <span className="px-small" style={{ fontWeight: 400 }}>representative · live cadence lands with the Outreach slice</span></div>
      <div className="px-box" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < rows.length - 1 ? '1px solid var(--proto-rule-soft)' : 'none' }}>
            <div className="px-small" style={{ width: 52, flexShrink: 0 }}>Day {c.d}</div>
            <div style={{ flex: 1, fontSize: 13 }}>{c.task}</div>
            <Pill tone={tone[c.state]}>{c.state}</Pill>
          </div>
        ))}
      </div>
    </div>
  )
}
