import React, { useEffect, useState, useCallback } from 'react'
import { useApp, go, useRoute } from '../state.jsx'
import { api } from '../api.js'
import { Pill } from '../shell.jsx'
import { Loading, ErrorBox } from './Today.jsx'

const STRENGTH_TONE = { strong: 'green', medium: 'yellow', gap: 'red' }

export default function Interview({ id, tab = 'prep' }) {
  const { toast } = useApp()
  const [meta, setMeta] = useState({ loading: true, error: null, company: '', role: '' })
  const [interview, setInterview] = useState(null) // most recent interview row
  const [busy, setBusy] = useState(false)
  const [interviewers, setInterviewers] = useState('')
  const [transcript, setTranscript] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await api.listInterviews(id)
      if (res.error) throw new Error(res.error)
      setMeta({ loading: false, error: null, company: res.company, role: res.role })
      setInterview((res.interviews || [])[0] || null)
    } catch (err) { setMeta({ loading: false, error: String(err.message || err), company: '', role: '' }) }
  }, [id])
  useEffect(() => { load() }, [load])

  const runPrep = async () => {
    setBusy(true)
    try {
      const res = await api.interviewPrep(id, { stage: 'panel', interviewers })
      if (res.error) throw new Error(res.error)
      setInterview({ id: res.interviewId, stage: res.stage, questions: res.questions, coverageMap: res.coverageMap, debrief: null })
      toast(`Prepped ${res.questions.length} questions`)
    } catch (err) { toast(`Prep failed: ${err.message || err}`) }
    finally { setBusy(false) }
  }

  const runDebrief = async () => {
    if (!interview?.id) { toast('Generate a prep pack first.'); return }
    if (transcript.trim().length < 20) { toast('Paste a longer transcript.'); return }
    setBusy(true)
    try {
      const res = await api.interviewDebrief(interview.id, transcript)
      if (res.error) throw new Error(res.error)
      setInterview((iv) => ({ ...iv, debrief: res.debrief }))
      toast('Debrief ready')
    } catch (err) { toast(`Debrief failed: ${err.message || err}`) }
    finally { setBusy(false) }
  }

  if (meta.loading) return <Loading />
  if (meta.error) return <ErrorBox error={meta.error} />

  const questions = interview?.questions || []
  const coverage = interview?.coverageMap || []
  const debrief = interview?.debrief || null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="px-small px-link" onClick={() => go(`/opp/${id}`)}>← {meta.company} · {meta.role}</div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--proto-rule-soft)' }}>
        {['prep', 'debrief'].map((t) => (
          <div key={t} onClick={() => go(`/interview/${id}/${t}`)}
            style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13, textTransform: 'capitalize',
              fontWeight: tab === t ? 600 : 500, color: tab === t ? 'var(--text-brand)' : 'var(--proto-ink2)',
              borderBottom: tab === t ? '2px solid var(--surface-brand-default)' : '2px solid transparent', marginBottom: -1 }}>
            {t}
          </div>
        ))}
      </div>

      {tab === 'prep' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="px-box" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="px-input" style={{ flex: 1, minWidth: 200 }} placeholder="Interviewers (names/roles, optional)" value={interviewers} onChange={(e) => setInterviewers(e.target.value)} />
            <button className="px-btn px-btn-accent" disabled={busy} onClick={runPrep}>{busy ? 'Generating…' : questions.length ? '↻ Regenerate prep' : 'Generate prep pack'}</button>
          </div>

          {coverage.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--proto-ink2)', marginBottom: 6 }}>Coverage map</div>
              <div className="px-box" style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {coverage.map((c, i) => <Pill key={i} tone={c.covered ? 'green' : 'red'}>{c.covered ? '✓' : '△'} {c.theme}</Pill>)}
              </div>
            </div>
          )}

          {questions.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--proto-ink2)' }}>Likely questions ({questions.length})</div>
              {questions.map((q, i) => (
                <div key={i} className="px-box" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{q.question}</div>
                    {q.strength && <Pill tone={STRENGTH_TONE[q.strength] || 'accent'}>{q.strength}</Pill>}
                  </div>
                  {q.suggestedAnswer && <div className="px-small" style={{ marginTop: 8, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{q.suggestedAnswer}</div>}
                </div>
              ))}
            </div>
          ) : <div className="px-box" style={{ padding: 20, textAlign: 'center', color: 'var(--proto-ink2)', fontSize: 13 }}>No prep yet — generate a pack of likely questions with suggested answers and a coverage map.</div>}
        </div>
      )}

      {tab === 'debrief' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="px-box" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--proto-rule-soft)' }} className="px-small">Paste interview transcript / notes</div>
            <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Paste what was asked and how it went…"
              style={{ minHeight: 160, border: 'none', outline: 'none', background: 'var(--proto-paper)', color: 'var(--proto-ink)', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 13, padding: 12, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
          <div><button className="px-btn px-btn-accent" disabled={busy} onClick={runDebrief}>{busy ? 'Analyzing…' : 'Analyze debrief'}</button></div>

          {debrief && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="px-box" style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Summary</div>
                  {debrief.advanceLikelihood && <Pill tone={debrief.advanceLikelihood === 'high' ? 'green' : debrief.advanceLikelihood === 'low' ? 'red' : 'yellow'}>advance: {debrief.advanceLikelihood}</Pill>}
                </div>
                <div className="px-small" style={{ marginTop: 6, lineHeight: 1.5 }}>{debrief.summary}</div>
              </div>
              {Array.isArray(debrief.perQuestionScores) && debrief.perQuestionScores.length > 0 && (
                <div className="px-box" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Per-question scores</div>
                  {debrief.perQuestionScores.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingBottom: 8, borderBottom: '1px solid var(--proto-rule-soft)' }}>
                      <Pill tone={s.score >= 4 ? 'green' : s.score >= 3 ? 'yellow' : 'red'}>{s.score}/5</Pill>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13 }}>{s.question}</div>
                        {s.note && <div className="px-small" style={{ marginTop: 2 }}>{s.note}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {Array.isArray(debrief.followUps) && debrief.followUps.length > 0 && (
                <div className="px-box" style={{ padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Owed follow-ups</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                    {debrief.followUps.map((f, i) => <div key={i}>• {f}</div>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
