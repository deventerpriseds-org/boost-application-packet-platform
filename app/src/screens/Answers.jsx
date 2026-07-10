import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useApp, go } from '../state.jsx'
import { api } from '../api.js'
import { Loading, ErrorBox } from './Today.jsx'

// Reads a File as a base64 data URL.
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export default function Answers({ id }) {
  const { toast } = useApp()
  const [meta, setMeta] = useState({ loading: true, error: null, company: '', role: '' })
  const [preview, setPreview] = useState(null)   // data URL of the uploaded screenshot
  const [busy, setBusy] = useState(false)
  const [answers, setAnswers] = useState(null)     // [{question, answer}]
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const o = await api.getOpportunity(id)
      if (o.error) throw new Error(o.error)
      setMeta({ loading: false, error: null, company: o.company, role: o.role })
    } catch (err) { setMeta({ loading: false, error: String(err.message || err) }) }
  }, [id])
  useEffect(() => { load() }, [load])

  const handleFile = async (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { toast('Please drop an image (PNG/JPG screenshot).'); return }
    const dataUrl = await fileToDataUrl(file)
    setPreview(dataUrl); setAnswers(null)
    await run(dataUrl)
  }

  const run = async (dataUrl) => {
    setBusy(true)
    try {
      const res = await api.answersVision(id, dataUrl)
      if (res.error) throw new Error(res.error)
      setAnswers(res.answers || [])
      toast(`Detected ${res.count} question${res.count === 1 ? '' : 's'}`)
    } catch (err) { toast(`Autofill failed: ${err.message || err}`) }
    finally { setBusy(false) }
  }

  const onPaste = useCallback(async (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))
    if (item) { e.preventDefault(); handleFile(item.getAsFile()) }
  }, [id])
  useEffect(() => { window.addEventListener('paste', onPaste); return () => window.removeEventListener('paste', onPaste) }, [onPaste])

  const setAnswerText = (i, text) => setAnswers((a) => a.map((x, j) => (j === i ? { ...x, answer: text } : x)))
  const copyOne = (i, text) => { try { navigator.clipboard?.writeText(text) } catch {} toast(`Copied answer ${i + 1}`) }
  const copyAll = () => { try { navigator.clipboard?.writeText(answers.map((a) => `${a.question}\n${a.answer}`).join('\n\n')) } catch {} toast('All answers copied') }

  if (meta.loading) return <Loading />
  if (meta.error) return <ErrorBox error={meta.error} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="px-small px-link" onClick={() => go(`/opp/${id}`)}>← {meta.company} · {meta.role}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Application autofill</div>
          <div className="px-small">Drop a screenshot of the form → copy-paste-ready blocks for every field.</div>
        </div>
        {answers && answers.length > 0 && <button className="px-btn px-btn-dark" onClick={copyAll}>⧉ Copy all</button>}
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />

      {/* Dropzone */}
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]) }}
        className="px-box"
        style={{ padding: 28, textAlign: 'center', cursor: 'pointer', borderStyle: 'dashed', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        {preview ? (
          <img src={preview} alt="form" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, border: '1px solid var(--proto-rule-soft)' }} />
        ) : <div style={{ fontSize: 34 }}>⇪</div>}
        <div style={{ fontWeight: 600 }}>{busy ? 'Reading the form…' : preview ? 'Replace screenshot' : 'Drop a screenshot of the application form'}</div>
        <div className="px-small">…or click to choose, or paste from clipboard. gpt-4o reads the questions and drafts each answer.</div>
      </div>

      {busy && <Loading />}

      {answers && !busy && (
        answers.length === 0 ? (
          <div className="px-box" style={{ padding: 20, textAlign: 'center', color: 'var(--proto-ink2)' }}>No questions detected in that image. Try a clearer screenshot of the form fields.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--proto-ink2)' }}>Detected questions ({answers.length}) · edit before copying</div>
            {answers.map((a, i) => (
              <div key={i} className="px-box" style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{a.question}</div>
                  <button className="px-btn" style={{ fontSize: 12 }} onClick={() => copyOne(i, a.answer)}>⧉ Copy</button>
                </div>
                <textarea value={a.answer} onChange={(e) => setAnswerText(i, e.target.value)}
                  style={{ width: '100%', marginTop: 8, minHeight: 70, border: '1px solid var(--proto-rule-soft)', borderRadius: 6, background: 'var(--proto-paper)', color: 'var(--proto-ink)', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 13, padding: 10, resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box' }} />
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
