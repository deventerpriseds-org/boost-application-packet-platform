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

      {tab === 'overview' && <Overview o={o} toast={toast} id={id} reload={load} />}
      {tab === 'contacts' && <Contacts contacts={o.contacts || []} oppId={o.id} toast={toast} />}
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

function Overview({ o, toast, id, reload }) {
  const signals = o.signals || []
  const pain = o.pain || []
  const contacts = o.contacts || []
  const [enriching, setEnriching] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [match, setMatch] = useState(null)
  const [apply, setApply] = useState(null)
  const [preparing, setPreparing] = useState(false)
  const [packet, setPacket] = useState(null)
  useEffect(() => {
    api.getPacket(id || o.id).then((r) => { if (!r.error) setPacket(r) }).catch(() => {})
  }, [id, o.id])
  const enrich = async () => {
    setEnriching(true)
    try { const r = await api.enrichOpportunity(id || o.id); if (r.error) throw new Error(r.error); toast(`Enriched: ${(r.enrichment?.companySignals || []).length} signals, ${(r.enrichment?.painHypotheses || []).length} pains`); reload && reload() }
    catch (e) { toast(`Enrich failed: ${e.message || e}`) } finally { setEnriching(false) }
  }
  const runMatch = async () => {
    setScoring(true)
    try { const r = await api.matchScore(id || o.id); if (r.error) throw new Error(r.error); setMatch(r); toast(`Match ${r.matchRate} · ${(r.gaps || []).length} gaps`); reload && reload() }
    catch (e) { toast(`Match failed: ${e.message || e}`) } finally { setScoring(false) }
  }
  const prepareApply = async () => {
    setPreparing(true)
    try { const r = await api.applyPrepare(id || o.id, {}); if (r.error) throw new Error(r.error); setApply(r); toast(`Prepared ${r.answers?.length || 0} answers${r.ats ? ` (${r.ats.provider})` : ''}`) }
    catch (e) { toast(`Prepare failed: ${e.message || e}`) } finally { setPreparing(false) }
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Packet band */}
        <div className="px-box" style={{ padding: 14, borderColor: 'var(--surface-brand-default)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-brand)' }}>Application packet</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
                {packet == null ? 'Not started' : (() => {
                  const arts = packet.artifacts || []
                  const approved = arts.filter((a) => a.status === 'approved').length
                  if (arts.length === 0) return 'Not started'
                  if (approved >= 4) return 'Complete'
                  return 'In progress'
                })()}
              </div>
              <div className="px-small">
                {packet && (packet.artifacts || []).length > 0
                  ? `${(packet.artifacts || []).filter((a) => a.status === 'approved').length} / ${(packet.artifacts || []).length} approved`
                  : 'Keyword-tailored resume, portfolio & intro · approval rounds'}
              </div>
            </div>
            <button className="px-btn px-btn-accent" onClick={() => go(`/packet/${o.id}`)}>Build packet →</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="px-btn" style={{ fontSize: 12 }} onClick={() => go(`/answers/${o.id}`)}>⌸ Application answers</button>
            <button className="px-btn" style={{ fontSize: 12 }} onClick={() => go(`/interview/${o.id}`)}>◉ Interview prep</button>
            <button className="px-btn" style={{ fontSize: 12 }} onClick={() => go(`/compose/${o.id}`)}>✉ Compose outreach</button>
            <button className="px-btn" style={{ fontSize: 12 }} onClick={() => go(`/offer/${o.id}`)}>◆ Negotiation tracker</button>
          </div>
        </div>

        {o.why && (
          <Card title="Why surfaced">
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>{o.why}</div>
          </Card>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
          {(match?.matchRate != null || typeof o.match === 'number') && <Pill tone={(match?.matchRate ?? o.match) >= 75 ? 'green' : (match?.matchRate ?? o.match) >= 50 ? 'yellow' : 'red'}>match {match?.matchRate ?? o.match}</Pill>}
          <button className="px-btn" style={{ fontSize: 12 }} disabled={scoring} onClick={runMatch}>{scoring ? 'Scoring…' : '◈ ATS match score'}</button>
          <button className="px-btn" style={{ fontSize: 12 }} disabled={preparing} onClick={prepareApply}>{preparing ? 'Preparing…' : '⌸ Prepare application'}</button>
          <button className="px-btn" style={{ fontSize: 12 }} disabled={enriching} onClick={enrich}>{enriching ? 'Enriching…' : (signals.length || pain.length ? '↻ Re-enrich' : '✦ Enrich')}</button>
        </div>
        {match && (match.matched?.length || match.gaps?.length) && (
          <Card title={`ATS match — ${match.matchRate}`} sub={match.summary}>
            {match.matched?.length > 0 && <div style={{ fontSize: 12 }}><b>Strengths:</b> {match.matched.join(' · ')}</div>}
            {match.gaps?.length > 0 && <div style={{ fontSize: 12, marginTop: 6, color: 'var(--proto-red)' }}><b>Gaps:</b> {match.gaps.join(' · ')}</div>}
          </Card>
        )}
        {apply && (
          <Card title="Prepared application" sub={apply.mode}>
            {(apply.documents || []).length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {apply.documents.map((d, i) => <a key={i} href={d.url} target="_blank" rel="noreferrer" className="px-link" style={{ fontSize: 12 }}>{d.type} ↗</a>)}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(apply.answers || []).map((a, i) => (
                <div key={i} style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 600 }}>{a.question}</div>
                  <div style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{a.answer}</div>
                </div>
              ))}
            </div>
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
            <StatusRow k="Match" v={<b>{o.match != null ? `${o.match}%` : '—'}</b>} />
          </div>
        </Card>
        <Card title="Compensation target">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>Range</span><b>{o.comp || '—'}</b>
          </div>
          <div className="px-link" style={{ fontSize: 12, marginTop: 8 }} onClick={() => go(`/offer/${o.id}`)}>Open negotiation tracker →</div>
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

function Contacts({ contacts, oppId, toast }) {
  const [enriching, setEnriching] = useState(false)
  const enrich = async () => {
    setEnriching(true)
    try { const r = await api.enrichOpportunity(oppId); if (r.error) throw new Error(r.error); toast('Enriched — reload to see contacts') }
    catch (e) { toast(`Enrich failed: ${e.message || e}`) } finally { setEnriching(false) }
  }
  if (!contacts.length) return (
    <div className="px-box" style={{ padding: 24, textAlign: 'center', color: 'var(--proto-ink2)' }}>
      <div>No contacts enriched for this opportunity yet.</div>
      <button className="px-btn px-btn-accent" style={{ marginTop: 12, fontSize: 13 }} disabled={enriching} onClick={enrich}>{enriching ? 'Enriching...' : 'Enrich now'}</button>
    </div>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
      {contacts.map((p, i) => (
        <div key={i} className="px-box" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</div>
            <div className="px-small">{p.role}</div>
            {p.signal && <div className="px-small" style={{ marginTop: 6 }}>⚡ {p.signal}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button className="px-btn" style={{ fontSize: 12 }} onClick={() => window.open(p.linkedinUrl || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(p.name)}`, '_blank')}>Open LinkedIn</button>
              <button className="px-btn px-btn-dark" style={{ fontSize: 12 }} onClick={() => go(`/compose/${oppId}`)}>Draft outreach</button>
            </div>
          </div>
          {p.match != null && <Pill tone="accent">{p.match}</Pill>}
        </div>
      ))}
    </div>
  )
}

// Live cadence timeline — reads persisted outreach_message rows; can seed the
// standard 7-touch cadence on demand.
function Outreach({ o }) {
  const { toast } = useApp()
  const [state, setState] = useState({ loading: true, messages: [] })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await api.listOutreach(o.id)
    setState({ loading: false, messages: res.error ? [] : (res.messages || []) })
  }, [o.id])
  useEffect(() => { load() }, [load])

  const seed = async () => {
    setBusy(true)
    const res = await api.seedCadence(o.id)
    setBusy(false)
    if (res.error) { toast(`Failed: ${res.error}`); return }
    setState({ loading: false, messages: res.messages || [] })
    toast(res.seeded ? 'Cadence started' : 'Cadence already running')
  }

  const tone = { sent: 'green', due: 'red', scheduled: 'accent', draft: 'yellow' }
  const cadence = state.messages.filter((m) => m.dayOffset != null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--proto-ink2)', flex: 1 }}>Cadence timeline</div>
        <button className="px-btn" onClick={() => go(`/compose/${o.id}`)}>Compose →</button>
        {cadence.length === 0 && <button className="px-btn px-btn-accent" disabled={busy} onClick={seed}>{busy ? 'Starting…' : 'Start cadence'}</button>}
      </div>
      {state.loading ? (
        <div className="px-box" style={{ padding: 20, textAlign: 'center', color: 'var(--proto-ink2)' }}>Loading cadence…</div>
      ) : cadence.length === 0 ? (
        <div className="px-box" style={{ padding: 20, textAlign: 'center', color: 'var(--proto-ink2)', fontSize: 13 }}>No cadence yet. Start the standard 7-touch sequence, or compose a one-off message.</div>
      ) : (
        <div className="px-box" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {cadence.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < cadence.length - 1 ? '1px solid var(--proto-rule-soft)' : 'none' }}>
              <div className="px-small" style={{ width: 52, flexShrink: 0 }}>Day {c.dayOffset}</div>
              <div style={{ flex: 1, fontSize: 13 }}>{c.channelLabel}</div>
              <Pill tone={tone[c.state] || 'accent'}>{c.state}</Pill>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
