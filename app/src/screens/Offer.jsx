import React, { useEffect, useState, useCallback } from 'react'
import { useApp, go } from '../state.jsx'
import { api } from '../api.js'
import { Pill } from '../shell.jsx'
import { Loading, ErrorBox } from './Today.jsx'

const REC_TONE = { accept: 'green', counter: 'yellow', decline: 'red' }
const money = (n) => (n == null || n === '' ? '—' : `$${Number(n).toLocaleString()}`)
// TCY1 = total comp, year 1 = base + sign-on + equity (annual). equityPerYear is
// already stored as an annual dollar figure by the offer data, so it is a real
// dollar term — no equity valuation is invented here.
const num = (v) => (Number(v) || 0)
const tcy1 = (base, signOn, equity) => num(base) + num(signOn) + num(equity)

export default function Offer({ id }) {
  const { toast } = useApp()
  const [meta, setMeta] = useState({ loading: true, error: null, company: '', role: '', compRange: '' })
  const [busy, setBusy] = useState(false)
  // Three editable sets: their offer (the received offer), your counter (client-side
  // planning w/ live TCY1), and your walk-away floor.
  const [form, setForm] = useState({
    theirBase: '', theirEquity: '', theirSignOn: '',
    counterBase: '', counterEquity: '', counterSignOn: '',
    floorBase: '', floorEquity: '',
  })
  const [result, setResult] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await api.getOffer(id)
      if (res.error) throw new Error(res.error)
      setMeta({ loading: false, error: null, company: res.company, role: res.role, compRange: res.compRange })
      if (res.offer) {
        const t = res.offer.their_offer || {}, f = res.offer.floor || {}, c = res.offer.counter || {}
        // Seed the counter column from their offer as the negotiation starting point.
        setForm({
          theirBase: t.base ?? '', theirEquity: t.equityPerYear ?? '', theirSignOn: t.signOn ?? '',
          counterBase: t.base ?? '', counterEquity: t.equityPerYear ?? '', counterSignOn: t.signOn ?? '',
          floorBase: f.base ?? '', floorEquity: f.equityPerYear ?? '',
        })
        setResult({
          counterDraft: c.draft, recommendation: c.recommendation, leverageSummary: c.leverageSummary,
          totalTheirs: c.totalTheirs, totalFloor: c.totalFloor, compBenchmarks: res.offer.benchmarks || [],
        })
      }
    } catch (err) { setMeta({ loading: false, error: String(err.message || err) }) }
  }, [id])
  useEffect(() => { load() }, [load])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const seedCounter = () => setForm((f) => ({ ...f, counterBase: f.theirBase, counterEquity: f.theirEquity, counterSignOn: f.theirSignOn }))

  const analyze = async () => {
    if (!form.theirBase) { toast('Enter their base first.'); return }
    setBusy(true)
    try {
      const res = await api.analyzeOffer(id, {
        theirOffer: { base: Number(form.theirBase), equityPerYear: Number(form.theirEquity) || 0, signOn: Number(form.theirSignOn) || 0 },
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

  const theirTCY1 = tcy1(form.theirBase, form.theirSignOn, form.theirEquity)
  const counterTCY1 = tcy1(form.counterBase, form.counterSignOn, form.counterEquity)
  const floorTCY1 = tcy1(form.floorBase, 0, form.floorEquity)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="px-small px-link" onClick={() => go(`/opp/${id}`)}>← {meta.company} · {meta.role}</div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Negotiation tracker</div>
        <div className="px-small">Target range {meta.compRange || '—'}</div>
      </div>

      {/* 3-column comp layout: their offer · your counter · walk-away floor */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <Column title="Their offer" subtitle="The received offer" tcy1={theirTCY1}>
          <Field label="Base ($)" value={form.theirBase} onChange={set('theirBase')} />
          <Field label="Equity / yr ($)" value={form.theirEquity} onChange={set('theirEquity')} />
          <Field label="Sign-on ($)" value={form.theirSignOn} onChange={set('theirSignOn')} />
        </Column>

        <Column title="Your counter" subtitle="Live TCY1 as you type" tcy1={counterTCY1} accent>
          <Field label="Base ($)" value={form.counterBase} onChange={set('counterBase')} />
          <Field label="Equity / yr ($)" value={form.counterEquity} onChange={set('counterEquity')} />
          <Field label="Sign-on ($)" value={form.counterSignOn} onChange={set('counterSignOn')} />
          <button className="px-btn" style={{ fontSize: 12 }} onClick={seedCounter}>↺ Seed from their offer</button>
        </Column>

        <Column title="Walk-away" subtitle="Your floor" tcy1={floorTCY1}>
          <Field label="Floor base ($)" value={form.floorBase} onChange={set('floorBase')} />
          <Field label="Floor equity / yr ($)" value={form.floorEquity} onChange={set('floorEquity')} />
          <div className="px-small" style={{ color: 'var(--proto-ink2)' }}>No sign-on at floor.</div>
        </Column>
      </div>

      <div>
        <button className="px-btn px-btn-accent" disabled={busy} onClick={analyze}>
          {busy ? 'Analyzing…' : result ? '↻ Re-analyze & redraft counter' : 'Analyze & draft counter'}
        </button>
      </div>

      {/* Results: recommendation + benchmarks + counter draft (all real from analyzeOffer) */}
      {!result ? (
        <div className="px-box" style={{ padding: 20, textAlign: 'center', color: 'var(--proto-ink2)', fontSize: 13 }}>
          Fill the columns above, then generate total-comp math, market benchmarks, a leverage summary, and a counter draft.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="px-box" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Recommendation &amp; leverage</div>
              {result.recommendation && <Pill tone={REC_TONE[result.recommendation] || 'accent'}>{result.recommendation}</Pill>}
            </div>
            {(result.totalTheirs != null || result.totalFloor != null) && (
              <div style={{ display: 'flex', gap: 16, fontSize: 13, flexWrap: 'wrap' }}>
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
        </div>
      )}
    </div>
  )
}

function Column({ title, subtitle, tcy1, accent, children }) {
  return (
    <div className="px-box" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, ...(accent ? { outline: '1px solid var(--proto-accent)' } : {}) }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div className="px-small" style={{ color: 'var(--proto-ink2)' }}>{subtitle}</div>
      </div>
      {children}
      <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--proto-rule-soft)' }}>
        <div className="px-small" style={{ color: 'var(--proto-ink2)' }}>Total comp · yr 1</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{money(tcy1)}</div>
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
