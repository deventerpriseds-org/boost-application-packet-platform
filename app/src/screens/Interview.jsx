import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useApp, go } from '../state.jsx'
import { api } from '../api.js'
import { Pill, StageBadge } from '../shell.jsx'
import { Loading, ErrorBox, Empty, roleFamily } from './Today.jsx'

const STRENGTH_TONE = { strong: 'green', medium: 'yellow', gap: 'red' }

// Canonical interview pipeline stages (opportunity.stage values). 'panel' is the
// R2 / panel round in the product's stage model. These four are the interview
// funnel; 'offer' is post-interview negotiation and lives on the Offer screen.
const STAGE_FLOW = [
  { key: 'screen', label: 'Screen', tone: 'accent' },
  { key: 'r1', label: 'R1', tone: 'yellow' },
  { key: 'panel', label: 'R2 / Panel', tone: 'orange' },
  { key: 'final', label: 'Final', tone: 'red' },
]
const INTERVIEW_STAGES = STAGE_FLOW.map((s) => s.key)

function fmtDate(d) {
  if (!d) return null
  const dt = typeof d === 'string' ? new Date(d) : d
  if (isNaN(dt)) return null
  return dt.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtClock(sec) {
  const m = Math.floor(sec / 60), s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen 12 — Interviews list. Real data only: opportunities currently in an
// interview stage, each enriched with its actual interview records (created_at
// = when the interview was worked). No scheduled-datetime exists in the data
// model (interview rows carry only created_at), so "When" shows that.
// ─────────────────────────────────────────────────────────────────────────────
function InterviewList() {
  const [state, setState] = useState({ loading: true, error: null, rows: [] })
  const [stageFilter, setStageFilter] = useState(null)
  const [roleFilter, setRoleFilter] = useState('all')

  const load = useCallback(async () => {
    setState({ loading: true, error: null, rows: [] })
    try {
      const res = await api.listOpportunities()
      if (res.error) throw new Error(res.error)
      const opps = (res.opportunities || []).filter((o) => INTERVIEW_STAGES.includes(o.stage))
      // Fetch real interview records for each interview-stage opp (small set).
      const rows = await Promise.all(opps.map(async (o) => {
        let interviews = []
        try {
          const iv = await api.listInterviews(o.id)
          if (!iv.error) interviews = iv.interviews || []
        } catch { /* opp with no reachable interviews — still list it for Prep */ }
        return { opp: o, interviews, latest: interviews[0] || null }
      }))
      setState({ loading: false, error: null, rows })
    } catch (err) { setState({ loading: false, error: String(err.message || err), rows: [] }) }
  }, [])
  useEffect(() => { load() }, [load])

  const stageCounts = useMemo(() => {
    const by = {}
    for (const r of state.rows) by[r.opp.stage] = (by[r.opp.stage] || 0) + 1
    return by
  }, [state.rows])

  const roleCounts = useMemo(() => {
    const c = { all: state.rows.length }
    for (const r of state.rows) { const f = roleFamily(r.opp); c[f] = (c[f] || 0) + 1 }
    return c
  }, [state.rows])
  const roleKeys = useMemo(() => Object.keys(roleCounts).filter((k) => k !== 'all'), [roleCounts])

  const visible = useMemo(() => state.rows.filter((r) =>
    (!stageFilter || r.opp.stage === stageFilter) &&
    (roleFilter === 'all' || roleFamily(r.opp) === roleFilter)
  ), [state.rows, stageFilter, roleFilter])

  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox error={state.error} />
  if (!state.rows.length) return (
    <Empty>
      No interviews in flight.{' '}
      <span className="px-link" style={{ cursor: 'pointer' }} onClick={() => go('/pipeline')}>Open the pipeline</span>
      {' '}— once an opportunity reaches the Screen, R1, Panel, or Final stage it shows up here.
    </Empty>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Stage flow — live counts of opportunities at each interview round.
          Click a node to filter the table to that stage; click again to clear. */}
      <div className="px-box" style={{ padding: '12px 14px', overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, minWidth: 'min-content' }}>
          {STAGE_FLOW.map((f, i) => {
            const n = stageCounts[f.key] || 0
            const on = stageFilter === f.key
            return (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center' }}>
                <div onClick={() => setStageFilter(on ? null : f.key)} title={`${f.label}: ${n}`}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <span style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 40, height: 40, borderRadius: '50%', fontSize: 14, fontWeight: 700,
                    background: n > 0 ? `var(--proto-${f.tone}-soft)` : 'var(--proto-panel)',
                    color: n > 0 ? `var(--proto-${f.tone})` : 'var(--proto-ink3)',
                    border: on ? '2px solid var(--surface-brand-default)' : '1px solid var(--proto-rule-soft)',
                  }}>{n}</span>
                  <span className="px-small" style={{ whiteSpace: 'nowrap', fontSize: 10 }}>{f.label}</span>
                </div>
                {i < STAGE_FLOW.length - 1 && (
                  <span style={{ width: 18, height: 2, background: 'var(--proto-rule-soft)', margin: '0 2px', marginBottom: 18, flexShrink: 0 }} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Role filter chips — families actually present, each with a real count. */}
      {roleKeys.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['all', ...roleKeys].map((k) => {
            const on = roleFilter === k
            return (
              <span key={k} className="px-pill" onClick={() => setRoleFilter(k)}
                style={{ cursor: 'pointer', background: on ? 'var(--surface-brand-default)' : undefined, color: on ? 'var(--text-on-brand)' : undefined }}>
                {k === 'all' ? 'All' : k} {roleCounts[k] || 0}
              </span>
            )
          })}
        </div>
      )}

      {(stageFilter || roleFilter !== 'all') && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--proto-paper)', border: '1px solid var(--proto-rule-soft)', borderRadius: 8 }}>
          <span className="px-small">
            Showing <b>{visible.length}</b> of {state.rows.length}
            {stageFilter ? <> · stage <b>{stageFilter}</b></> : null}
            {roleFilter !== 'all' ? <> · <b>{roleFilter}</b></> : null}
          </span>
          <button className="px-btn" style={{ fontSize: 11 }} onClick={() => { setStageFilter(null); setRoleFilter('all') }}>✕ Clear</button>
        </div>
      )}

      {/* Upcoming / in-flight interviews table */}
      <div className="px-box" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,2fr) 120px minmax(150px,1fr) minmax(220px,auto)', gap: 0, minWidth: 640 }}>
          {['Opportunity', 'Stage', 'When', 'Actions'].map((h) => (
            <div key={h} className="px-small" style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--proto-ink2)', borderBottom: '1px solid var(--proto-rule-soft)' }}>{h}</div>
          ))}
          {visible.map((r) => {
            const when = fmtDate(r.latest?.created_at)
            const hasDebrief = !!r.latest?.debrief
            return (
              <React.Fragment key={r.opp.id}>
                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--proto-rule-soft)', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, cursor: 'pointer' }} className="px-link" onClick={() => go(`/opp/${r.opp.id}`)}>{r.opp.company}</div>
                  <div className="px-small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.opp.role}</div>
                </div>
                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--proto-rule-soft)', display: 'flex', alignItems: 'center' }}>
                  <StageBadge stage={r.opp.stage} />
                </div>
                <div className="px-small" style={{ padding: '10px 12px', borderBottom: '1px solid var(--proto-rule-soft)', display: 'flex', alignItems: 'center' }}>
                  {when
                    ? <span title="Latest interview record created">{when}</span>
                    : <span style={{ color: 'var(--proto-ink3)' }}>No record yet</span>}
                </div>
                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--proto-rule-soft)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="px-btn" style={{ fontSize: 12 }} onClick={() => go(`/interview/${r.opp.id}/prep`)}>Prep</button>
                  <button className="px-btn" style={{ fontSize: 12 }} onClick={() => go(`/interview/${r.opp.id}/record`)}>Record</button>
                  <button className={`px-btn${hasDebrief ? ' px-btn-green' : ''}`} style={{ fontSize: 12 }} onClick={() => go(`/interview/${r.opp.id}/debrief`)}>Debrief</button>
                </div>
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Single interview — prep / record / debrief tabs for one opportunity.
// ─────────────────────────────────────────────────────────────────────────────
function InterviewDetail({ id, tab }) {
  const { toast } = useApp()
  const [meta, setMeta] = useState({ loading: true, error: null, company: '', role: '' })
  const [interview, setInterview] = useState(null) // most recent interview row
  const [busy, setBusy] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [stage, setStage] = useState(null) // opp pipeline stage
  const [interviewers, setInterviewers] = useState('')
  const [transcript, setTranscript] = useState('')
  const [rec, setRec] = useState({ recording: false, transcribing: false })
  const [elapsed, setElapsed] = useState(0)
  const recorder = useRef(null)
  const chunks = useRef([])
  const timerRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await api.listInterviews(id)
      if (res.error) throw new Error(res.error)
      setMeta({ loading: false, error: null, company: res.company, role: res.role })
      setInterview((res.interviews || [])[0] || null)
      try { const o = await api.getOpportunity(id); if (!o.error) setStage(o.stage || o.opportunity?.stage || null) } catch {}
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

  // Send an audio blob to Whisper and drop the transcript into the field.
  const transcribe = useCallback(async (blob, mimeType) => {
    if (!interview?.id) { toast('Generate a prep pack first — the transcript attaches to an interview record.'); return }
    setRec((r) => ({ ...r, transcribing: true }))
    try {
      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob) })
      const audioBase64 = String(dataUrl).split(',')[1]
      const out = await api.interviewTranscribe(interview.id, { audioBase64, mimeType })
      if (out.error) throw new Error(out.error)
      setTranscript((t) => (t ? t + '\n' : '') + (out.transcript || ''))
      toast(`Transcribed ${out.chars} chars`)
    } catch (err) { toast(`Transcribe failed: ${err.message || err}`) }
    finally { setRec((r) => ({ ...r, transcribing: false })) }
  }, [interview?.id, toast])

  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  const toggleRecord = async () => {
    if (rec.recording) { recorder.current?.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunks.current = []
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        stopTimer()
        const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' })
        setRec((r) => ({ ...r, recording: false }))
        transcribe(blob, mr.mimeType || 'audio/webm')
      }
      recorder.current = mr; mr.start()
      setElapsed(0)
      stopTimer(); timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
      setRec((r) => ({ ...r, recording: true }))
    } catch (err) { toast(`Mic error: ${err.message || err}`) }
  }
  useEffect(() => () => stopTimer(), [])

  const onUpload = (e) => {
    const f = e.target.files?.[0]; if (!f) return
    transcribe(f, f.type || 'audio/mpeg'); e.target.value = ''
  }

  const runDebrief = async () => {
    if (!interview?.id) { toast('Generate a prep pack first.'); return }
    if (transcript.trim().length < 20) { toast('Record, upload, or paste a longer transcript.'); return }
    setBusy(true)
    try {
      const res = await api.interviewDebrief(interview.id, transcript)
      if (res.error) throw new Error(res.error)
      setInterview((iv) => ({ ...iv, debrief: res.debrief }))
      toast('Debrief ready')
    } catch (err) { toast(`Debrief failed: ${err.message || err}`) }
    finally { setBusy(false) }
  }

  const advanceToFinal = async () => {
    setAdvancing(true)
    try {
      const res = await api.moveStage(id, 'final')
      if (res.error) throw new Error(res.error)
      setStage('final')
      toast('Advanced to Final ✓')
    } catch (err) { toast(`Advance failed: ${err.message || err}`) }
    finally { setAdvancing(false) }
  }

  if (meta.loading) return <Loading />
  if (meta.error) return <ErrorBox error={meta.error} />

  const questions = interview?.questions || []
  const coverage = interview?.coverageMap || []
  const debrief = interview?.debrief || null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="px-small px-link" style={{ cursor: 'pointer' }} onClick={() => go('/interview')}>← All interviews</div>
        <div className="px-small px-link" style={{ cursor: 'pointer' }} onClick={() => go(`/opp/${id}`)}>{meta.company} · {meta.role}</div>
        {stage && <StageBadge stage={stage} />}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--proto-rule-soft)' }}>
        {['prep', 'record', 'debrief'].map((t) => (
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

      {tab === 'record' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!interview?.id && (
            <div className="px-box" style={{ padding: 14, borderColor: 'var(--proto-yellow)' }}>
              <div className="px-small">A transcript attaches to an interview record. Generate a prep pack first on the{' '}
                <span className="px-link" style={{ cursor: 'pointer' }} onClick={() => go(`/interview/${id}/prep`)}>Prep tab</span>, then record here.</div>
            </div>
          )}

          {/* Live recorder — real MediaRecorder capture + timer, then Whisper transcribe. */}
          <div className="px-box" style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 40, fontVariantNumeric: 'tabular-nums', fontWeight: 700, letterSpacing: 1, color: rec.recording ? 'var(--proto-red)' : 'var(--proto-ink2)' }}>
              {fmtClock(elapsed)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: rec.recording ? 'var(--proto-red)' : 'var(--proto-ink3)' }} />
              <span className="px-small">{rec.recording ? 'Recording…' : rec.transcribing ? 'Transcribing…' : 'Idle'}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className={`px-btn${rec.recording ? ' px-btn-green' : ' px-btn-accent'}`} disabled={rec.transcribing || !interview?.id} onClick={toggleRecord}>
                {rec.recording ? '■ Stop & transcribe' : '● Start recording'}
              </button>
              <label className="px-btn" style={{ cursor: interview?.id ? 'pointer' : 'not-allowed', opacity: interview?.id ? 1 : 0.5 }}>
                ⬆ Upload audio
                <input type="file" accept="audio/*" disabled={!interview?.id} onChange={onUpload} style={{ display: 'none' }} />
              </label>
            </div>
            <div className="px-small" style={{ color: 'var(--proto-ink3)', textAlign: 'center' }}>Whisper speech-to-text · records mic audio in the browser</div>
          </div>

          {/* Live AI cues would require a streaming transcription backend, which
              this API does not expose (transcribe is a single post-recording call).
              Omitted rather than faked. */}
          <div className="px-small" style={{ color: 'var(--proto-ink3)' }}>
            Note: live in-interview AI cues are not available — transcription runs once after you stop, not as a live stream.
          </div>

          {transcript && (
            <div className="px-box" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--proto-rule-soft)' }} className="px-small">Transcript</div>
              <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)}
                style={{ minHeight: 140, border: 'none', outline: 'none', background: 'var(--proto-paper)', color: 'var(--proto-ink)', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 13, padding: 12, resize: 'vertical', lineHeight: 1.5 }} />
            </div>
          )}

          <div>
            <button className="px-btn px-btn-accent" disabled={rec.recording || transcript.trim().length < 20} onClick={() => go(`/interview/${id}/debrief`)}>
              Stop & debrief →
            </button>
          </div>
        </div>
      )}

      {tab === 'debrief' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className={`px-btn${rec.recording ? ' px-btn-green' : ''}`} disabled={rec.transcribing} onClick={toggleRecord}>
              {rec.recording ? `■ Stop & transcribe (${fmtClock(elapsed)})` : '● Record audio'}
            </button>
            <label className="px-btn" style={{ cursor: 'pointer' }}>
              ⬆ Upload audio
              <input type="file" accept="audio/*" onChange={onUpload} style={{ display: 'none' }} />
            </label>
            {rec.transcribing && <span className="px-small">Transcribing…</span>}
            <span className="px-small" style={{ color: 'var(--proto-ink3)' }}>Whisper speech-to-text</span>
          </div>
          <div className="px-box" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--proto-rule-soft)' }} className="px-small">Transcript (recorded, uploaded, or pasted)</div>
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

              {/* Advance to Final — real stage transition via moveStage. */}
              <div className="px-box" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Next step</div>
                  <div className="px-small" style={{ marginTop: 2 }}>{stage === 'final' ? 'This opportunity is at the Final stage.' : 'Move this opportunity to the Final round.'}</div>
                </div>
                <button className="px-btn px-btn-accent" disabled={advancing || stage === 'final'} onClick={advanceToFinal}>
                  {stage === 'final' ? 'At Final' : advancing ? 'Advancing…' : 'Advance to Final'}
                </button>
                <button className="px-btn" onClick={() => go(`/opp/${id}`)}>Open opportunity</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Interview({ id, tab = 'prep' }) {
  if (!id) return <InterviewList />
  return <InterviewDetail id={id} tab={tab} />
}
