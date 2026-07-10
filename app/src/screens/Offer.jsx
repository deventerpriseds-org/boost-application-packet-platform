import React, { useEffect, useState, useCallback } from 'react'
import { useApp, go } from '../state.jsx'
import { api } from '../api.js'
import { Pill } from '../shell.jsx'
import { Loading, ErrorBox } from './Today.jsx'

const REC_TONE = { accept: 'green', counter: 'yellow', decline: 'red' }
const money = (n) => (n == null || n === '' ? '' : `$${Number(n).toLocaleString()}`)

export default function Offer({ id }) {
  const { toast } = useApp()
  const [meta, setMeta] = useState({ loading: true, error: null, company: '', role: '', compRange: '' })
  const [existing, setExisting] = useState(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ base: '', equityPerYear: '', signOn: '', floorBase: '', floorEquity: '' })
  const [result, setResult] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await api.getOffer(id)
      if (res.error) throw new Error(res.error)
      setMeta({ loading: false, error: null, company: res.company, role: res.role, compRange: res.compRange })
      if (res.offer) {
        setExisting(res.offer)
        const t = res.offer.their_offer || {}, f = res.offer.floor || {}, c = res.offer.counter || {}
        setForm({ base: t.base ?? '', equityPerYear: t.equityPerYear ?? '', signOn: t.signOn ?? '', floorBase: f.base ?? '', floorEquity: f.equityPerYear ?? '' })
        setResult({ counterDraft: c.draft, recommendation: c.recommendation, leverageSummary: c.leverageSummary, totalTheirs: c.totalTheirs, totalFloor: c.totalFloor, compBenchmarks: res.offer.benchmarks || [] })
      }
    } catch (err) { setMeta({ loading: false, error: String(err.message || err) }) }
  }, [id])
  useEffect(() => { load() }, [load])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const analyze = async () => {
    if (!form.base) { toast('Enter at least their base.'); return }
    setBusy(true)
    try {
      const res = await api.analyzeOffer(id, {
        theirOffer: { base: Number(form.base), equityPerYear: Number(form.equityPerYear) || 0, signOn: Number(form.signOn) || 0 },
        floor: { base: Number(form.floorBase) || 0, equityPerYear: Number(form.floorEquity) || 0 },
      })
      if (res.error) throw new Error(res.error)
      setResult(res)
      toast('Negotiation analysis ready')
    } catch (err) { toast(`Analysis failed: ${err.message || err}`) }
    finally { setBusy(false) }
  }

  if (meta.loading) return <Loading />
  if (meta.error) return <ErrorBox error={meta.error} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="px-small px-link" onClick={() => go(`/opp/${id}`)}>← {meta.company} · {meta.role}</div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Negotiation tracker</div>
        <div className="px-small">Target range {meta.compRange || '—'}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Inputs */}
        <div className="px-box" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Their offer</div>
          <Field label="Base ($)" value={form.base} onChange={set('base')} />
          <Field label="Equity / yr ($)" value={form.equityPerYear} onChange={set('equityPerYear')} />
          <Field label="Sign-on ($)" value={form.signOn} onChange={set('signOn')} />
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>Your walk-away floor</div>
          <Field label="Floor base ($)" value={form.floorBase} onChange={set('floorBase')} />
          <Field label="Floor equity / yr ($)" value={form.floorEquity} onChange={set('floorEquity')} />
          <button className="px-btn px-btn-accent" disabled={busy} onClick={analyze}>{busy ? 'Analyzing…' : result ? '↻ Re-analyze' : 'Analyze & draft counter'}</button>
        </div>

        {/* Results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!result ? (
            <div className="px-box" style={{ padding: 20, textAlign: 'center', color: 'var(--proto-ink2)', fontSize: 13 }}>Enter the numbers and generate total-comp math, market benchmarks, a leverage summary, and a counter draft.</div>
          ) : (
            <>
              <div className="px-box" style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Recommendation</div>
                  {result.recommendation && <Pill tone={REC_TONE[result.recommendation] || 'accent'}>{result.recommendation}</Pill>}
                </div>
                {(result.totalTheirs != null || result.totalFloor != null) && (
                  <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                    <div>Their total: <b>{money(result.totalTheirs)}</b></div>
                    <div>Your floor: <b>{money(result.totalFloor)}</b></div>
                  </div>
                )}
                {result.leverageSummary && <div className="px-small" style={{ marginTop: 8, lineHeight: 1.5 }}>{result.leverageSummary}</div>}
              </div>

              {Array.isArray(result.compBenchmarks) && result.compBenchmarks.length > 0 && (
                <div className="px-box" style={{ padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Market benchmarks</div>
                  {result.compBenchmarks.map((b, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--proto-rule-soft)' }}>
                      <span>{b.metric}</span><b>{b.market}</b>
                    </div>
                  ))}
                </div>
              )}

              {result.counterDraft && (
                <div className="px-box" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Counter draft</div>
                    <button className="px-btn" style={{ fontSize: 12 }} onClick={() => { try { navigator.clipboard?.writeText(result.counterDraft) } catch {} toast('Copied') }}>⧉ Copy</button>
                  </div>
                  <div className="px-small" style={{ lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{result.counterDraft}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="px-small">{label}</span>
      <input className="px-input" type="number" value={value} onChange={onChange} placeholder="0" />
    </label>
  )
}
