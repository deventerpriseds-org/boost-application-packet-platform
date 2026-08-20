import React, { useEffect, useState, useCallback } from 'react'
import { useApp, go, useRoute } from '../state.jsx'
import { api } from '../api.js'
import { Pill, SignalIcon, MatchScore } from '../shell.jsx'
import { Loading, ErrorBox, Empty } from './Today.jsx'

const ART_STATUS_TONE = { todo: 'panel', drafting: 'yellow', review: 'accent', changes: 'red', approved: 'green' }

const STAGES = [
  { id: 'discovered', label: 'Discovered' }, { id: 'saved', label: 'Saved' },
  { id: 'enriched', label: 'Enriched' }, { id: 'applied', label: 'Applied' },
  { id: 'outreach', label: 'Outreach' }, { id: 'engaged', label: 'Engaged' },
  { id: 'screen', label: 'Screen' }, { id: 'r1', label: 'Round 1' },
  { id: 'panel', label: 'Panel' }, { id: 'final', label: 'Final' },
  { id: 'offer', label: 'Offer' }, { id: 'accepted', label: 'Accepted' },
]
const TABS = ['overview', 'jd', 'contacts', 'resume', 'outreach', 'playbooks', 'interview', 'analytics']
const TAB_LABELS = {
  overview: 'Overview', jd: 'Job Description', contacts: 'Contacts', resume: 'Resume',
  outreach: 'Outreach', playbooks: 'Playbooks', interview: 'Interview prep', analytics: 'Analytics',
}

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
  // 3-way triage (mirrors the Swipe deck): Keep → saved, Maybe → enriched, Dismiss → reject + back to list.
  const dismissOpp = async () => {
    const res = await api.dismiss(id)
    if (res?.error) toast(`Dismiss failed: ${res.error}`)
    else { toast(`Dismissed ${state.opp?.company}`); go('/opportunities') }
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
              {o.temperature && <SignalIcon kind="temperature" value={o.temperature} ageDays={o.postedAgeDays} />}
              {o.actionPriority && o.actionPriority !== 'new' && <SignalIcon kind="priority" value={o.actionPriority} />}
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

        {/* 3-way triage — the same decision as the Swipe deck, available on the detail page */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="px-btn" style={{ fontSize: 12, color: '#16794a', borderColor: '#16794a' }} onClick={() => move('saved')}>✓ Keep</button>
          <button className="px-btn" style={{ fontSize: 12, color: '#a8730a', borderColor: '#a8730a' }} onClick={() => move('enriched')}>↓ Maybe</button>
          <button className="px-btn" style={{ fontSize: 12, color: 'var(--proto-red)', borderColor: 'var(--proto-red)' }} onClick={dismissOpp}>✕ Dismiss</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--proto-rule-soft)' }}>
        {TABS.map((t) => (
          <div key={t} onClick={() => go(`/opp/${id}/${t}`)}
            style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13, textTransform: 'capitalize',
              fontWeight: tab === t ? 600 : 500, color: tab === t ? 'var(--text-brand)' : 'var(--proto-ink2)',
              borderBottom: tab === t ? '2px solid var(--surface-brand-default)' : '2px solid transparent', marginBottom: -1 }}>
            {TAB_LABELS[t] || t}
          </div>
        ))}
      </div>

      {tab === 'overview' && <Overview o={o} toast={toast} id={id} reload={load} />}
      {tab === 'jd' && <JdTab o={o} toast={toast} reload={load} />}
      {tab === 'contacts' && <Contacts contacts={o.contacts || []} oppId={o.id} toast={toast} />}
      {tab === 'resume' && <ResumeTab o={o} toast={toast} />}
      {tab === 'outreach' && <Outreach o={o} />}
      {tab === 'playbooks' && <PlaybooksTab />}
      {tab === 'interview' && <InterviewTab o={o} />}
      {tab === 'analytics' && <AnalyticsTab o={o} />}

      {/* Tabs from the reference spec that have no real per-opportunity data source
          are intentionally omitted rather than filled with placeholder content:
          · Templates — no template store/API is wired for opportunities today.
          · Activity — there is no per-opportunity activity/event feed (the coach
            activity log is owner-scoped, not scoped to a single opportunity). */}
      <div className="px-small" style={{ color: 'var(--proto-ink3)', lineHeight: 1.5 }}>
        Not shown: <b>Templates</b> (no template API) and <b>Activity</b> (no
        per-opportunity event feed exists yet). These are hidden rather than faked.
      </div>
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
  // Re-parse the JD (from the fetched real posting when present). Same action as the JD tab.
  const [parsing, setParsing] = useState(false)
  const parseJd = async () => {
    setParsing(true)
    try { const r = await api.parseJd(o.id); if (r.error) throw new Error(r.error); toast('JD parsed — reloading…'); reload && reload() }
    catch (e) { toast(`Parse failed: ${e.message || e}`) } finally { setParsing(false) }
  }
  // A JD not yet fetched carries the anchor-truth placeholder (jd_real still null). Distinguish it
  // from a real parsed summary so the placeholder is never shown as if it were the real description.
  const jdNotRetrieved = !o.jdSummary || String(o.jdSummary).startsWith('Full job description not yet retrieved')
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

        {/* Job description — surfaced ABOVE "Why surfaced" on the Overview tab. Reuses the same
            o.jd* fields as the Job Description tab; the standalone tab is unchanged. */}
        {jdNotRetrieved ? (
          <Card title="Job description">
            <div className="px-small" style={{ color: 'var(--proto-ink2)' }}>
              Full job description not retrieved yet — showing the role from the alert. Retrieve the posting to parse the real description.
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="px-btn px-btn-accent" style={{ fontSize: 12 }} disabled={parsing} onClick={parseJd}>{parsing ? 'Parsing…' : '↻ Re-parse JD'}</button>
            </div>
          </Card>
        ) : (
          <Card title="Job description">
            {o.jdTitle && <div className="px-small" style={{ marginBottom: 6 }}><b>{o.jdTitle}</b>{o.jdCompany ? ` · ${o.jdCompany}` : ''}</div>}
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>{o.jdSummary}</div>
            <div className="px-small" style={{ marginTop: 8 }}><span className="px-link" onClick={() => go(`/opp/${o.id}/jd`)}>Full job description →</span></div>
          </Card>
        )}

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
            <StatusRow k="Temperature" v={o.temperature ? <SignalIcon kind="temperature" value={o.temperature} ageDays={o.postedAgeDays} /> : '—'} />
            <StatusRow k="Priority" v={o.actionPriority ? <SignalIcon kind="priority" value={o.actionPriority} /> : '—'} />
            <StatusRow k="Match" v={<b>{o.match != null ? `${o.match}%` : '—'}</b>} />
            <StatusRow k="ATS score" v={o.atsScore != null ? <b>{o.atsScore}%</b> : <span className="px-small">not scored yet</span>} />
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

function JdTab({ o, toast, reload }) {
  const [parsing, setParsing] = useState(false)
  const parse = async () => {
    setParsing(true)
    try {
      const r = await api.parseJd(o.id)
      if (r.error) throw new Error(r.error)
      toast('JD parsed — reloading...')
      await reload()
    } catch (e) { toast(`Parse failed: ${e.message || e}`) } finally { setParsing(false) }
  }
  const hasJd = o.jdSummary || o.jdRequirements || o.jdTable
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="px-btn px-btn-accent" onClick={parse} disabled={parsing}>
          {parsing ? 'Parsing...' : hasJd ? 'Re-parse JD' : 'Parse Job Description'}
        </button>
      </div>
      {!hasJd && !parsing && (
        <div className="px-box" style={{ padding: 24, textAlign: 'center', color: 'var(--proto-ink2)' }}>
          No job description parsed yet. Click Parse Job Description to extract structured data.
        </div>
      )}
      {o.jdSummary && (
        <div className="px-box" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>Summary</div>
          {o.jdTitle && <div className="px-small" style={{ marginBottom: 6 }}><b>Title:</b> {o.jdTitle} {o.jdCompany ? `· ${o.jdCompany}` : ''}</div>}
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>{o.jdSummary}</div>
        </div>
      )}
      {o.jdRequirements && (
        <div className="px-box" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>Requirements & Responsibilities</div>
          <div style={{ fontSize: 13, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: o.jdRequirements }} />
        </div>
      )}
      {o.jdTable && (
        <div className="px-box" style={{ padding: 16, overflowX: 'auto' }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>ATS Keyword Table</div>
          <div style={{ fontSize: 12 }} dangerouslySetInnerHTML={{ __html: o.jdTable }} />
        </div>
      )}
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

// Ordered, labeled resume sections — covers the FULL resume so no section is
// ever silently dropped. Each field is a key on the structured packet (pkg).
const RESUME_SECTIONS = [
  { label: 'Summary', fields: [{ key: 'ResumeSummary', name: '' }] },
  { label: 'Skills', fields: [{ key: 'SkillsBullets1', name: 'Column 1' }, { key: 'SkillsBullets2', name: 'Column 2' }] },
  { label: 'Areas of Expertise', fields: [{ key: 'ExpertiseBullets', name: '' }] },
  { label: 'Relevant Experience', fields: [{ key: 'RelevantBullets1', name: 'Bullet 1' }, { key: 'RelevantBullets2', name: 'Bullet 2' }, { key: 'RelevantBullets3', name: 'Bullet 3' }] },
  { label: 'Work History', fields: [{ key: 'WorkHistoryBullets1', name: 'Role 1' }, { key: 'WorkHistoryBullets2', name: 'Role 2' }, { key: 'WorkHistoryBullets3', name: 'Role 3' }, { key: 'WorkHistoryBullets4', name: 'Role 4' }] },
]
const EDUCATION_KEYS = ['Education', 'EducationBullets', 'education']
const AI_EFFORTS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['max', 'Max']]

// One editable resume field: shows the text (or an explicit "no content" note so
// missing sections are visible), an Edit textarea (Save → saveArtifactContent),
// and an AI-edit row (instruction + effort → aiEditArtifact).
function ResumeField({ artifactId, fieldKey, name, value, onPatch, toast }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const [instruction, setInstruction] = useState('')
  const [effort, setEffort] = useState('medium')
  const [saving, setSaving] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  useEffect(() => { setDraft(value || '') }, [value])
  const empty = !value || !String(value).trim()

  const save = async () => {
    setSaving(true)
    try { const r = await api.saveArtifactContent(artifactId, { pkg: { [fieldKey]: draft } }); if (r.error) throw new Error(r.error); onPatch(fieldKey, draft); setEditing(false); toast('Section saved') }
    catch (e) { toast(`Save failed: ${e.message || e}`) } finally { setSaving(false) }
  }
  const aiEdit = async () => {
    if (!instruction.trim()) { toast('Enter an instruction for the AI'); return }
    setAiBusy(true)
    try {
      const r = await api.aiEditArtifact(artifactId, { instruction, effort, section: fieldKey })
      if (r.error) throw new Error(r.error)
      onPatch(fieldKey, r.revised); setDraft(r.revised); setInstruction(''); toast('AI edit applied')
    } catch (e) { toast(`AI edit failed: ${e.message || e}`) } finally { setAiBusy(false) }
  }

  return (
    <div style={{ marginTop: name ? 12 : 0 }}>
      {name && <div className="px-small" style={{ color: 'var(--proto-ink3)', marginBottom: 4, fontWeight: 600 }}>{name}</div>}
      {editing ? (
        <>
          <textarea className="px-input" style={{ width: '100%', minHeight: 110, lineHeight: 1.5, resize: 'vertical' }} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button className="px-btn px-btn-accent" style={{ fontSize: 12 }} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="px-btn px-btn-ghost" style={{ fontSize: 12 }} onClick={() => { setDraft(value || ''); setEditing(false) }}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          {empty
            ? <div className="px-small" style={{ color: 'var(--proto-ink3)', fontStyle: 'italic' }}>No content generated — Regenerate or edit</div>
            : <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{value}</div>}
          <button className="px-btn px-btn-ghost" style={{ fontSize: 12, marginTop: 6 }} onClick={() => setEditing(true)}>✎ Edit</button>
        </>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="px-input" style={{ flex: 1, minWidth: 160, fontSize: 12 }} placeholder="Tell AI how to revise this section…" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        <select className="px-input" style={{ fontSize: 12 }} value={effort} onChange={(e) => setEffort(e.target.value)}>
          {AI_EFFORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="px-btn" style={{ fontSize: 12 }} disabled={aiBusy} onClick={aiEdit}>{aiBusy ? '✦ Editing…' : '✦ AI edit'}</button>
      </div>
    </div>
  )
}

// Resume tab — the opportunity's resume artifact(s) from the packet. Real data
// via getPacket; actions (generate / approve / request changes / create Google
// Doc) reuse the same endpoints the packet builder uses. Renders every labeled
// resume section from the structured pkg (Feature B) with per-section edit + AI
// edit (Feature C) and auto-refreshes while generation is in flight (Feature A).
function ResumeTab({ o, toast }) {
  const [state, setState] = useState({ loading: true, error: null, arts: [], pkg: null })
  const [busy, setBusy] = useState(null)
  const [open, setOpen] = useState({})

  const load = useCallback(async (opts = {}) => {
    try {
      const p = await api.getPacket(o.id)
      if (p.error) throw new Error(p.error)
      const arts = (p.artifacts || []).filter((a) => a.type === 'resume' || a.type === 'compact_resume')
      setState((s) => ({ loading: false, error: null, arts, pkg: p.pkg || s.pkg || null }))
    } catch (e) { if (!opts.silent) setState({ loading: false, error: String(e.message || e), arts: [], pkg: null }) }
  }, [o.id])
  useEffect(() => { load() }, [load])

  // Feature A — poll while any artifact is mid-generation (drafting) or an action
  // is in flight; stop as soon as nothing is generating.
  const anyGenerating = busy !== null || state.arts.some((a) => a.status === 'drafting')
  useEffect(() => {
    if (!anyGenerating) return
    const t = setInterval(() => load({ silent: true }), 8000)
    return () => clearInterval(t)
  }, [anyGenerating, load])
  // Feature A — refresh when the tab regains focus / visibility.
  useEffect(() => {
    const onVis = () => { if (!document.hidden) load({ silent: true }) }
    const onFocus = () => load({ silent: true })
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onFocus) }
  }, [load])

  const patch = (id, fields) => setState((s) => ({ ...s, arts: s.arts.map((a) => (a.id === id ? { ...a, ...fields } : a)) }))
  const patchPkg = (key, val) => setState((s) => ({ ...s, pkg: { ...(s.pkg || {}), [key]: val } }))

  const generate = async (a) => {
    setBusy(a.id)
    try { const r = await api.generateArtifact(a.id); if (r.error) throw new Error(r.error); patch(a.id, { status: r.artifactStatus, content: r.content }); toast('Resume drafted'); load({ silent: true }) }
    catch (e) { toast(`Generate failed: ${e.message || e}`) } finally { setBusy(null) }
  }
  const setStatus = async (a, status) => {
    const prev = a.status; patch(a.id, { status })
    try { const r = await api.setArtifactStatus(a.id, status); if (r.error) throw new Error(r.error); toast(`Resume → ${status}`) }
    catch (e) { patch(a.id, { status: prev }); toast(`Update failed: ${e.message || e}`) }
  }
  // The SECOND consumer of generateArtifactDocument. A reachability fix present in PacketBuilder and
  // absent here is the "fix all consumers" failure, so it takes the same options argument.
  const makeDoc = async (a, opts = {}) => {
    setBusy(a.id)
    try { const r = await api.generateArtifactDocument(a.id, opts); if (r.error) throw new Error(r.error); patch(a.id, { docUrl: r.docUrl }); toast(opts.regen ? 'Google Doc rebuilt' : 'Google Doc created'); load({ silent: true }) }
    catch (e) { toast(`Doc failed: ${e.message || e}`) } finally { setBusy(null) }
  }

  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox error={state.error} />
  if (!state.arts.length) return (
    <div className="px-box" style={{ padding: 24, textAlign: 'center', color: 'var(--proto-ink2)' }}>
      <div>No resume artifact exists for this opportunity yet.</div>
      <button className="px-btn px-btn-accent" style={{ marginTop: 12, fontSize: 13 }} onClick={() => go(`/packet/${o.id}`)}>Open packet builder →</button>
    </div>
  )
  const label = { resume: 'Resume', compact_resume: 'Compact resume' }
  const pkg = state.pkg
  const anchor = state.arts.find((a) => a.type === 'resume') || state.arts[0]
  const eduKey = pkg ? EDUCATION_KEYS.find((k) => pkg[k] != null) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {state.arts.map((a) => (
        <div key={a.id} className="px-box" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{label[a.type] || a.type}</div>
              <div className="px-small" style={{ marginTop: 2 }}>Keyword-tailored from your master resume</div>
            </div>
            <Pill tone={ART_STATUS_TONE[a.status] || 'panel'}>{a.status}</Pill>
          </div>
          {/* Fallback raw-content view only when there is no structured pkg. */}
          {!pkg && a.content && (
            <div>
              <span className="px-link" style={{ fontSize: 12 }} onClick={() => setOpen((x) => ({ ...x, [a.id]: !x[a.id] }))}>
                {open[a.id] ? '▾ Hide draft' : '▸ View draft'}
              </span>
              {open[a.id] && (
                <div className="px-box" style={{ padding: 10, marginTop: 6, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', background: 'var(--proto-panel)' }}>{a.content}</div>
              )}
            </div>
          )}
          {a.docUrl ? (
            <a href={a.docUrl} target="_blank" rel="noreferrer" className="px-link" style={{ fontSize: 12 }}>✓ Open Google Doc ↗</a>
          ) : a.content ? (
            <button className="px-btn" style={{ fontSize: 12, alignSelf: 'flex-start' }} disabled={busy === a.id} onClick={() => makeDoc(a)}>{busy === a.id ? 'Creating Doc…' : '📄 Create Google Doc'}</button>
          ) : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {a.status === 'todo' && <button className="px-btn px-btn-accent" disabled={busy === a.id} onClick={() => generate(a)}>{busy === a.id ? 'Generating…' : 'Generate draft'}</button>}
            {(a.status === 'review' || a.status === 'changes') && (
              <>
                <button className="px-btn px-btn-green" onClick={() => setStatus(a, 'approved')}>Approve</button>
                <button className="px-btn" disabled={busy === a.id} onClick={() => generate(a)}>{busy === a.id ? 'Regenerating…' : 'Regenerate'}</button>
                {a.status !== 'changes' && <button className="px-btn" onClick={() => setStatus(a, 'changes')}>Request changes</button>}
              </>
            )}
            {a.status === 'approved' && <button className="px-btn" onClick={() => setStatus(a, 'review')}>Reopen</button>}
            <button className="px-btn" style={{ fontSize: 12 }} onClick={() => go(`/packet/${o.id}`)}>Open in packet builder →</button>
          </div>
        </div>
      ))}

      {/* Feature B — modern, all-sections-labeled preview from the structured pkg. */}
      {pkg && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="px-small" style={{ color: 'var(--proto-ink3)', textTransform: 'uppercase', letterSpacing: 1 }}>Resume sections</div>
          {RESUME_SECTIONS.map((sec) => (
            <div key={sec.label} className="px-box" style={{ padding: 14 }}>
              <div className="px-label">{sec.label}</div>
              {sec.fields.map((f) => (
                <ResumeField key={f.key} artifactId={anchor.id} fieldKey={f.key} name={sec.fields.length > 1 ? f.name : ''} value={pkg[f.key]} onPatch={patchPkg} toast={toast} />
              ))}
            </div>
          ))}
          {/* Education is not generated per-opportunity — surface it so it is not silently absent. */}
          <div className="px-box" style={{ padding: 14 }}>
            <div className="px-label">Education</div>
            {eduKey
              ? <ResumeField artifactId={anchor.id} fieldKey={eduKey} name="" value={pkg[eduKey]} onPatch={patchPkg} toast={toast} />
              : <div className="px-small" style={{ color: 'var(--proto-ink3)', marginTop: 6 }}>Education — from template (not generated per-opportunity).</div>}
          </div>
        </div>
      )}
    </div>
  )
}

// Playbooks tab — real playbook entities from the shared library (listLibrary).
// There is no per-opportunity or per-role linkage field on library_entity, so
// these are surfaced as the owner's playbook library with an explicit note that
// they are not yet linked to this specific opportunity (no fabricated linkage).
function PlaybooksTab() {
  const [state, setState] = useState({ loading: true, error: null, entities: [] })
  useEffect(() => {
    api.listLibrary('playbook')
      .then((r) => { if (r.error) throw new Error(r.error); setState({ loading: false, error: null, entities: r.entities || [] }) })
      .catch((e) => setState({ loading: false, error: String(e.message || e), entities: [] }))
  }, [])
  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox error={state.error} />
  if (!state.entities.length) return <Empty>No playbooks in your library yet. <span className="px-link" style={{ cursor: 'pointer' }} onClick={() => go('/library/playbooks')}>Open the library →</span></Empty>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="px-small" style={{ color: 'var(--proto-ink3)', lineHeight: 1.5 }}>
        Your playbook library. Playbooks are not yet linked to individual opportunities,
        so every real playbook is shown here — pick the narrative that fits this role.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {state.entities.map((e) => (
          <div key={e.id} className="px-box" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{e.name}</div>
              <Pill tone="accent">{e.kind}</Pill>
            </div>
            {e.category && <div className="px-small">{e.category}</div>}
            {e.content?.thesis && <div style={{ fontSize: 13, lineHeight: 1.5 }}>{e.content.thesis}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// Interview prep tab — real interviews for this opportunity (listInterviews).
// Summarizes the most recent prep pack and links into the full /interview flow.
function InterviewTab({ o }) {
  const [state, setState] = useState({ loading: true, error: null, interviews: [] })
  useEffect(() => {
    api.listInterviews(o.id)
      .then((r) => { if (r.error) throw new Error(r.error); setState({ loading: false, error: null, interviews: r.interviews || [] }) })
      .catch((e) => setState({ loading: false, error: String(e.message || e), interviews: [] }))
  }, [o.id])
  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox error={state.error} />
  const iv = state.interviews[0]
  if (!iv) return (
    <div className="px-box" style={{ padding: 24, textAlign: 'center', color: 'var(--proto-ink2)' }}>
      <div>No interview prep generated for this opportunity yet.</div>
      <button className="px-btn px-btn-accent" style={{ marginTop: 12, fontSize: 13 }} onClick={() => go(`/interview/${o.id}/prep`)}>Generate prep pack →</button>
    </div>
  )
  const questions = iv.questions || []
  const coverage = iv.coverageMap || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Interview prep{iv.stage ? ` · ${iv.stage}` : ''}</div>
          <div className="px-small">{questions.length} likely question{questions.length === 1 ? '' : 's'}{state.interviews.length > 1 ? ` · ${state.interviews.length} sessions` : ''}</div>
        </div>
        <button className="px-btn px-btn-accent" onClick={() => go(`/interview/${o.id}/prep`)}>Open full prep →</button>
        <button className="px-btn" onClick={() => go(`/interview/${o.id}/debrief`)}>Debrief</button>
      </div>
      {coverage.length > 0 && (
        <div className="px-box" style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {coverage.map((c, i) => <Pill key={i} tone={c.covered ? 'green' : 'red'}>{c.covered ? '✓' : '△'} {c.theme}</Pill>)}
        </div>
      )}
      {questions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {questions.slice(0, 5).map((q, i) => (
            <div key={i} className="px-box" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{q.question}</div>
                {q.strength && <Pill tone={q.strength === 'strong' ? 'green' : q.strength === 'gap' ? 'red' : 'yellow'}>{q.strength}</Pill>}
              </div>
              {q.suggestedAnswer && <div className="px-small" style={{ marginTop: 8, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{q.suggestedAnswer}</div>}
            </div>
          ))}
          {questions.length > 5 && <div className="px-small px-link" onClick={() => go(`/interview/${o.id}/prep`)}>View all {questions.length} questions →</div>}
        </div>
      )}
    </div>
  )
}

// Analytics tab — asset engagement for THIS opportunity. assetsAnalytics is
// owner-scoped and returns company/role per asset, so we filter down to assets
// belonging to this opportunity's company+role (the only per-opp key available).
function AnalyticsTab({ o }) {
  const [state, setState] = useState({ loading: true, error: null, assets: [] })
  useEffect(() => {
    api.assetsAnalytics()
      .then((r) => {
        if (r.error) throw new Error(r.error)
        const mine = (r.assets || []).filter((a) => a.company === o.company && (!a.role || a.role === o.role))
        setState({ loading: false, error: null, assets: mine })
      })
      .catch((e) => setState({ loading: false, error: String(e.message || e), assets: [] }))
  }, [o.company, o.role])
  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox error={state.error} />
  const totalOpens = state.assets.reduce((s, a) => s + (a.opens || 0), 0)
  if (!state.assets.length) return (
    <div className="px-box" style={{ padding: 20, color: 'var(--proto-ink2)', fontSize: 13, lineHeight: 1.5 }}>
      No tracked engagement for this opportunity yet. Share an asset from the packet
      builder using <b>"Copy tracked link"</b> (not the raw Drive URL) and opens will appear here.
    </div>
  )
  return (
    <div className="px-box" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <b style={{ fontSize: 14 }}>Engagement</b>
        <span className="px-small">tracked opens on this opportunity's assets</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 22, fontWeight: 700 }}>{totalOpens}</span>
        <span className="px-small">total opens</span>
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {state.assets.map((a) => (
          <div key={a.assetId} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 13, padding: '4px 0', borderTop: '1px solid var(--proto-rule-soft)' }}>
            <span style={{ fontWeight: 600, minWidth: 140 }}>{a.type || 'asset'}</span>
            <span className="px-small">👁 {a.opens}{a.uniqueViewers ? ` · ${a.uniqueViewers} viewer${a.uniqueViewers === 1 ? '' : 's'}` : ''}</span>
          </div>
        ))}
      </div>
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
