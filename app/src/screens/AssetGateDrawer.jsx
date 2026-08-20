import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { Overlay, Pill } from '../shell.jsx'
import {
  ASSET_LABEL, assetLabel, STATUS_TONE, GATE_META, gateMeta, STATE_META, stateMeta,
  CHECK_LABEL, checkLabel, FIELD_LABEL, fieldLabel, METHOD_LABEL,
  footerFor, reconcile, attentionSplit, engineRows, scoreParts, fmtWhen, arr, errText,
  GATE_HOOKS,
} from '../assetGate.js'
import { HIGHLIGHT_CLASS } from '../highlight.js'

// P5.3 - the per-asset gate drawer.
//
// ONE RULE GOVERNS THIS FILE: the badge, the gate word and the footer all read the SAME server
// payload. GET /artifact/{id}/checks-result returns gate, attention and results computed in one run
// over one row set; nothing here recomputes any of them. The reference prototype derives its badge
// from a WIDER set than its gate (qc/data.js:641 vs :548), which is how it renders a green gate
// beside "1 to fix" - a contradiction the reader has no way to resolve. The parent screen holds
// exactly one payload per artifact and hands it to both the badge and this drawer, so the two cannot
// drift; reconcile() makes any residual server-side disagreement VISIBLE rather than silently
// picking a winner.
//
// SECOND RULE: the SERVER owns the verdict. The footer is a projection of result.gate, an approval
// refusal is rendered in the server's own words, and a 409 re-syncs our copy instead of being
// reported as a generic failure.
//
// Everything decidable without a DOM lives in ../assetGate.js so app/test/assetGate.test.mjs can
// prove it (same split as overlay.js / shell.jsx). Both are re-exported here so a caller has one
// import to reach for.
export {
  ASSET_LABEL, assetLabel, STATUS_TONE, GATE_META, gateMeta, STATE_META, stateMeta,
  CHECK_LABEL, checkLabel, FIELD_LABEL, fieldLabel, footerFor, reconcile, attentionSplit, engineRows,
  GATE_HOOKS,
}

// Small presentational pieces -------------------------------------------------------------------

/**
 * The gate badge. result is the WHOLE checks-result payload, deliberately: passing gate and
 * attention as two separate props is exactly how a caller ends up sourcing them from two places.
 */
export function GateBadge({ result, loading, error, onClick, compact = false }) {
  if (error) return <span data-qc={GATE_HOOKS.badge} data-qc-gate="unavailable" title={String(error)}><Pill tone="panel">gate unavailable</Pill></span>
  if (!result) return <span data-qc={GATE_HOOKS.badge} data-qc-gate="unloaded"><Pill tone="panel">{loading ? 'checking...' : 'not loaded'}</Pill></span>
  const m = gateMeta(result.gate)
  // The badge shows the SERVER's own count, read through the one selector rather than re-derived
  // here. Where that number and the rows it sent disagree, reconcile() reports the disagreement in
  // the drawer; the badge never quietly substitutes a number of its own.
  // `fix` and `review` SEPARATELY, never the total under one label.
  //
  // This read `.counted` — the server's total across both engines — and rendered it as "N to fix".
  // With 1 deterministic finding and 3 reviewer ones it said "4 to fix", telling the reader to fix
  // three things the reviewer merely raised and that can never fail an artifact (D6). R4's second
  // sentence is that fixes and reviews are always counted separately AND LABELLED; the badge that
  // rule exists to protect was the surface breaking it.
  //
  // `counted` is still the server's own number and still worth showing where it DISAGREES with the
  // rows — that is what reconcile() reports in the drawer. It is just not a count of things to fix.
  const split = attentionSplit(result)
  const title = m.word + ' - ' + m.blurb + (result.computedAt ? ' (checked ' + fmtWhen(result.computedAt) + ')' : '')
  return (
    <span onClick={onClick} title={title} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      data-qc={GATE_HOOKS.badge} data-qc-gate={result.gate == null ? 'unchecked' : String(result.gate)}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e) } } : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: onClick ? 'pointer' : 'default' }}>
      <span data-qc={GATE_HOOKS.gate}><Pill tone={m.tone}>{m.word}</Pill></span>
      {split.fix > 0 && <span data-qc={GATE_HOOKS.toFix} data-qc-n={split.fix}><Pill tone={result.gate === 'fail' ? 'red' : 'yellow'}>{split.fix} to fix</Pill></span>}
      {split.review > 0 && <span data-qc={GATE_HOOKS.toReview} data-qc-n={split.review}><Pill tone="yellow">{split.review} to review</Pill></span>}
      {!compact && result.override && <span data-qc={GATE_HOOKS.exception}><Pill tone="accent">exception</Pill></span>}
    </span>
  )
}

const Section = ({ title, note, children }) => (
  <div style={{ marginBottom: 16 }}>
    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{title}</div>
    {note && <div className="px-small" style={{ marginBottom: 6 }}>{note}</div>}
    {children}
  </div>
)

const Quiet = ({ children }) => (
  <div className="px-dashed" style={{ padding: 12, fontSize: 12, color: 'var(--proto-ink2)' }}>{children}</div>
)

const Offenders = ({ items }) => {
  const list = arr(items)
  if (!list.length) return null
  return (
    <ul style={{ margin: '6px 0 0 0', paddingLeft: 18 }}>
      {list.map((o, i) => <li key={i} style={{ fontSize: 12, color: 'var(--proto-ink)', marginBottom: 2 }}>{String(o)}</li>)}
    </ul>
  )
}

// One check row. The state pill is the only colour signal, and not_applicable carries its own grey
// and its own words so it can never be read as a pass.
function CheckRow({ row }) {
  const m = stateMeta(row.state)
  return (
    <div className="px-box-soft" data-qc={GATE_HOOKS.check} data-qc-state={row.state || 'unknown'}
      data-qc-engine={row.engine || 'unrecorded'} style={{ padding: 10, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 140 }}>{checkLabel(row.check_key)}</span>
        <Pill tone={m.tone}>{m.label}</Pill>
      </div>
      <div className="px-small" style={{ marginTop: 4 }}>
        {row.state === 'not_applicable' ? 'why it could not be checked: ' : 'what we saw: '}{row.observed || '(nothing recorded)'}
      </div>
      {row.expected && <div className="px-small">what it should be: {row.expected}</div>}
      <Offenders items={row.offenders} />
    </div>
  )
}

// Tabs -------------------------------------------------------------------------------------------

// D5: prototype order, SPEC 7 plain-language labels, Blocks first by default.
export const TABS = [
  { key: 'blocks', label: 'Blocks & provenance' },
  { key: 'checks', label: 'Checks' },
  { key: 'compare', label: 'Original vs final' },
  { key: 'review', label: 'Independent review' },
  { key: 'match', label: 'Match' },
]

// Blocks default OPEN (P5 note) - nothing here is behind a disclosure.
//
// `focusField` is the landing point for a P8.5 deep link: a count on the QC rail resolves to a
// merge field, and the click has to arrive AT that field rather than merely at the asset. The row
// scrolls itself into view and is outlined; nothing else about the tab changes, and a null
// focusField leaves the tab exactly as it was.
function BlocksTab({ data, loading, error, focusField }) {
  const focusRef = useRef(null)
  useEffect(() => {
    const el = focusRef.current
    if (focusField && el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center' })
    }
  }, [focusField, data])
  if (loading) return <Quiet>Loading the blocks...</Quiet>
  if (error) return <Quiet>Could not load the blocks: {error}</Quiet>
  if (!data) return <Quiet>No block record for this asset.</Quiet>
  const rows = arr(data.insertions).filter((r) => Number(r.loop) === Number(data.loop))
  if (!rows.length) return <Quiet>This asset has no recorded blocks yet - nothing has been generated into its merge fields.</Quiet>
  const missing = focusField && !rows.some((r) => r.merge_field === focusField)
  return (
    <div>
      <Section title={'Pass ' + Number(data.loop)}
        note={data.filled + ' filled, ' + data.unfilled + ' left to the static template, ' + data.attributed + ' quoting the posting'} />
      {missing && (
        <Quiet>The finding you opened names {fieldLabel(focusField)}, but this asset has no recorded block for that field.</Quiet>
      )}
      {rows.map((r) => (
        <div key={r.merge_field} className="px-box-soft" data-qc={GATE_HOOKS.block} data-qc-section={r.merge_field}
          data-qc-field={r.merge_field} data-qc-generated={r.generated ? '1' : '0'}
          ref={r.merge_field === focusField ? focusRef : undefined}
          style={{ padding: 10, marginBottom: 8, boxShadow: r.merge_field === focusField ? 'inset 0 0 0 2px var(--border-brand)' : undefined }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 140 }}>{fieldLabel(r.merge_field)}</span>
            <Pill tone={r.generated ? 'green' : 'panel'}>{r.generated ? 'generated' : 'static template text'}</Pill>
            {r.item_count > 0 && <Pill tone="panel">{r.item_count} item(s)</Pill>}
          </div>
          {r.generated
            ? <div style={{ fontSize: 12, marginTop: 6, whiteSpace: 'pre-wrap' }}>{r.after_text}</div>
            : <div className="px-small" style={{ marginTop: 6 }}>Nothing was written here; whatever the template already says stands.</div>}
          <div className="px-small" style={{ marginTop: 6 }}>
            how it got here: {METHOD_LABEL[r.method] || String(r.method || 'unrecorded')}
          </div>
          {r.verbatim_quote
            ? <div className="px-small" data-qc={GATE_HOOKS.quote}>because the posting says: <span className={HIGHLIGHT_CLASS.postingEcho}>&quot;{r.verbatim_quote}&quot;</span>{r.requirement_kind ? ' (' + String(r.requirement_kind).replace(/_/g, ' ') + ')' : ''}{r.confidence != null ? ' - match strength ' + r.confidence : ''}</div>
            : r.generated ? <div className="px-small">no line of the posting could be tied to this block.</div> : null}
        </div>
      ))}
    </div>
  )
}

// The deterministic half. The reviewer's rows live on their own tab (engine is the top-level
// grouping, per the P4.2 correction), and the note below keeps the two counts reconciled with the
// badge so a reader is never left wondering where the missing findings went.
function ChecksTab({ result }) {
  if (!result) return <Quiet>Loading the checks...</Quiet>
  if (result.gate == null) return <Quiet>The checks have not been run for this asset. Run them from the footer.</Quiet>
  const rows = engineRows(result, 'deterministic')
  const order = { fail: 0, warn: 1, not_applicable: 2, pass: 3 }
  const sorted = [...rows].sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9))
  const split = attentionSplit(result)
  const na = rows.filter((r) => r.state === 'not_applicable').length
  if (!sorted.length) return <Quiet>No deterministic checks were recorded for this asset.</Quiet>
  return (
    <div>
      <Section title="Rules measured against the text"
        note={split.fix + ' of the ' + split.listed + ' listed finding(s) are here'
          + (split.review ? '; the other ' + split.review + ' are on Independent review' : '')
          + (na ? '. ' + na + ' check(s) had nothing to test against and are marked not checked - that is not a pass' : '')} />
      {sorted.map((r, i) => <CheckRow key={r.check_key + ':' + i} row={r} />)}
    </div>
  )
}

// Original vs final. Two sources, both already stored: the packet-level swap table (what the ATS
// pass did to the skill lists) and this artifact's own before/after text once a second pass exists.
function CompareTab({ swaps, swapsLoading, swapsError, insertions }) {
  const rewritten = arr(insertions && insertions.insertions)
    .filter((r) => r.before_text != null && r.after_text != null && r.before_text !== r.after_text)
    .sort((a, b) => Number(b.loop) - Number(a.loop))
  const rows = arr(swaps && swaps.swaps)
  return (
    <div>
      <Section title="What the tailoring pass changed"
        note="This table is packet-level: it covers every asset built from this packet, not this one alone.">
        {swapsLoading ? <Quiet>Loading...</Quiet>
          : swapsError ? <Quiet>Could not load the comparison: {swapsError}</Quiet>
          : !rows.length ? <Quiet>Nothing was swapped, added or dropped for this packet.</Quiet>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
                <thead>
                  <tr>
                    {['Original', 'Final', 'What happened', 'Why'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', fontSize: 11, color: 'var(--proto-ink2)', padding: '6px 8px', borderBottom: '1px solid var(--proto-rule-soft)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id || (s.list + ':' + s.seq)}>
                      <td style={{ fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--proto-rule-soft)' }}>{s.from_label || '-'}</td>
                      <td style={{ fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--proto-rule-soft)' }}>{s.to_label || '-'}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--proto-rule-soft)' }}><Pill tone={s.action === 'dropped' ? 'red' : s.action === 'kept' ? 'panel' : 'accent'}>{s.action}</Pill></td>
                      <td style={{ fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--proto-rule-soft)' }}>
                        {s.verbatim_quote
                          ? <span data-qc={GATE_HOOKS.quote}>the posting says <span className={HIGHLIGHT_CLASS.postingEcho}>&quot;{s.verbatim_quote}&quot;</span></span>
                          : <span className="px-small">{s.driver === 'unattributed' ? 'no line of the posting backs this change' : s.rationale || String(s.driver || '')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {swaps && swaps.unattributed > 0 && (
                <div className="px-small" style={{ marginTop: 6 }}>{swaps.unattributed} change(s) cite no line of the posting.</div>
              )}
            </div>
          )}
      </Section>
      <Section title="This asset, pass over pass">
        {rewritten.length
          ? rewritten.map((r, i) => (
            <div key={r.merge_field + ':' + r.loop + ':' + i} className="px-box-soft" style={{ padding: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{fieldLabel(r.merge_field)} <span className="px-small">(pass {Number(r.loop)})</span></div>
              <div className="px-small" style={{ marginTop: 6 }}>before</div>
              <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--proto-ink2)' }}>{r.before_text}</div>
              <div className="px-small" style={{ marginTop: 6 }}>after</div>
              <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{r.after_text}</div>
            </div>
          ))
          : <Quiet>This asset has only been generated once, so there is no earlier version of its text to compare.</Quiet>}
      </Section>
    </div>
  )
}

// The reviewer's own rows. D6 is stated on the screen, not just enforced in the engine: a reader who
// sees a red reviewer row must be able to tell why the asset is not blocked.
function ReviewTab({ result }) {
  if (!result) return <Quiet>Loading...</Quiet>
  const rows = engineRows(result, 'reviewer')
  return (
    <div>
      <Section title="Independent review"
        note="A reviewer disagreement can ask for a decision, but it can never block an asset on its own - only the measured rules do that." />
      {rows.length
        ? rows.map((r, i) => <CheckRow key={r.check_key + ':' + i} row={r} />)
        : <Quiet>The independent reviewer has not run for this asset. Nothing here has been second-guessed.</Quiet>}
    </div>
  )
}

// Match. A component with no source shows the server's prose for WHY it is missing, never a 0 and
// never a blank; the composite stays absent unless all three exist.
function MatchTab({ result }) {
  if (!result) return <Quiet>Loading...</Quiet>
  const s = result.score
  if (!s) return <Quiet>No score has been computed for this asset yet - the checks have not been run.</Quiet>
  const parts = scoreParts(s)
  const missing = parts.filter((p) => p.value == null)
  let weights = s.weights
  if (typeof weights === 'string') { try { weights = JSON.parse(weights) } catch { weights = null } }
  const history = arr(result.history)
  return (
    <div>
      <Section title="Overall">
        {s.composite == null
          ? <Quiet>
              No overall number. A composite is only computed when all three parts below exist, and{' '}
              {missing.length} of them {missing.length === 1 ? 'does' : 'do'} not:{' '}
              {missing.map((m) => m.label.toLowerCase()).join(', ')}. A number built from part of the
              evidence is the one a reader trusts most and the one most likely to be wrong.
            </Quiet>
          : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{s.composite}</div>
              <Pill tone={s.band === 'strong' ? 'green' : s.band === 'acceptable' ? 'yellow' : 'red'}>{String(s.band || '').replace(/_/g, ' ')}</Pill>
            </div>
          )}
      </Section>
      <Section title="What it is made of">
        {parts.map((p) => (
          <div key={p.key} className="px-box-soft" style={{ padding: 10, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{p.label}</span>
              {p.value == null ? <Pill tone="panel">not measured</Pill> : <span style={{ fontSize: 15, fontWeight: 700 }}>{p.value}</span>}
            </div>
            {p.value != null && (
              <div className="px-bar" style={{ marginTop: 6 }}><i style={{ width: Math.max(0, Math.min(100, Number(p.value))) + '%' }} /></div>
            )}
            <div className="px-small" style={{ marginTop: 6 }}>{p.source || 'no source was recorded for this part'}</div>
          </div>
        ))}
        {weights && (
          <div className="px-small">weights: must-haves {weights.mustHave}, keywords {weights.keyword}, seniority {weights.seniority} (engine v{s.engine_version})</div>
        )}
      </Section>
      {history.length > 1 && (
        <Section title="Earlier runs">
          {history.map((h, i) => (
            <div key={i} className="px-small" style={{ display: 'flex', gap: 8 }}>
              <span style={{ minWidth: 150 }}>{fmtWhen(h.computed_at)}</span>
              <span>overall {h.composite == null ? 'not computed' : h.composite}</span>
              <span>must-haves {h.must_have_coverage == null ? 'not measured' : h.must_have_coverage}</span>
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}

// The drawer ------------------------------------------------------------------------------------

/**
 * Opens OVER the current step - no navigation, which is exactly what Overlay variant="drawer"
 * exists for (D10). Escape, focus trap, backdrop click, scroll lock and close-on-navigation are all
 * its job, not this component's.
 *
 * `result` is owned by the PARENT and shared with the badge on the card. Every action here ends by
 * re-reading checks-result and handing the fresh payload back through onResult, so there is only
 * ever one gate object in play.
 */
export default function AssetGateDrawer({
  open = true, artifact, packetId, company, role, focusSection = null,
  result, resultLoading, resultError, onResult, onClose,
}) {
  const [tab, setTab] = useState('blocks')
  const [insertions, setInsertions] = useState({ loading: false, error: null, data: null })
  const [swaps, setSwaps] = useState({ loading: false, error: null, data: null })
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [reason, setReason] = useState('')

  const artifactId = artifact && artifact.id

  // What the two lazy tabs have already asked for. A REF, not state, and deliberately not an
  // effect-scoped `live` flag: switching tabs re-runs the effect, whose cleanup would cancel the
  // in-flight request from the previous run and leave the panel loading forever. The ref keys on the
  // id instead, so only pointing the drawer at a different asset invalidates a response.
  const fetchedRef = useRef({ insertions: null, swaps: null })

  // Reset per-asset state when the drawer is pointed at a different artifact.
  useEffect(() => {
    fetchedRef.current = { insertions: null, swaps: null }
    setTab('blocks'); setInsertions({ loading: false, error: null, data: null })
    setSwaps({ loading: false, error: null, data: null })
    setActionError(null); setNotice(null); setReasonOpen(false); setReason('')
  }, [artifactId])

  // A deep link names a field, and fields live on the Blocks tab - so arriving with a section
  // returns there even if the reader had switched tabs.
  useEffect(() => { if (focusSection) setTab('blocks') }, [focusSection])

  useEffect(() => {
    if (!open || !artifactId) return
    if (tab !== 'blocks' && tab !== 'compare') return
    if (fetchedRef.current.insertions === artifactId) return
    fetchedRef.current.insertions = artifactId
    const mine = () => fetchedRef.current.insertions === artifactId
    setInsertions({ loading: true, error: null, data: null })
    api.artifactInsertions(artifactId)
      .then((d) => { if (mine()) setInsertions({ loading: false, error: null, data: d }) })
      .catch((e) => { if (mine()) setInsertions({ loading: false, error: errText(e), data: null }) })
  }, [open, artifactId, tab])

  useEffect(() => {
    if (!open || tab !== 'compare' || !packetId) return
    if (fetchedRef.current.swaps === packetId) return
    fetchedRef.current.swaps = packetId
    const mine = () => fetchedRef.current.swaps === packetId
    setSwaps({ loading: true, error: null, data: null })
    api.packetSwaps(packetId)
      .then((d) => { if (mine()) setSwaps({ loading: false, error: null, data: d }) })
      .catch((e) => { if (mine()) setSwaps({ loading: false, error: errText(e), data: null }) })
  }, [open, tab, packetId])

  // Always re-read the GET after any mutation rather than adopting the POST's response body: the
  // POST /checks reply carries gate/attention/results but no override, computedAt or history. Mixing
  // two shapes into the badge is the two-sources bug this whole file is written to avoid.
  const refresh = useCallback(async (patch) => {
    if (!artifactId) return null
    const fresh = await api.artifactChecksResult(artifactId)
    if (onResult) onResult(fresh, patch)
    return fresh
  }, [artifactId, onResult])

  const runChecks = useCallback(async () => {
    setBusy('checks'); setActionError(null); setNotice(null)
    try {
      await api.runArtifactChecks(artifactId)
      const fresh = await refresh()
      setNotice('Checks re-run at ' + fmtWhen(fresh && fresh.computedAt) + '.')
      setReasonOpen(false); setReason('')
    } catch (e) { setActionError(errText(e)) } finally { setBusy(null) }
  }, [artifactId, refresh])

  const approve = useCallback(async () => {
    setBusy('approve'); setActionError(null); setNotice(null)
    try {
      await api.setArtifactStatusDetailed(artifactId, 'approved')
      await refresh({ status: 'approved' })
      setNotice('Approved.')
    } catch (e) {
      // The server is the authority on the gate, so its words are the message. A 409 also means our
      // copy of the gate is stale, so re-read it rather than leaving a stale badge on screen.
      setActionError(e && e.status === 409 ? 'The server refused this approval: ' + errText(e) : errText(e))
      if (e && e.status === 409) { try { await refresh() } catch { /* the original error stands */ } }
    } finally { setBusy(null) }
  }, [artifactId, refresh])

  const approveWithException = useCallback(async () => {
    const r = reason.trim()
    setBusy('override'); setActionError(null); setNotice(null)
    try {
      await api.artifactGateOverride(artifactId, r)
      await api.setArtifactStatusDetailed(artifactId, 'approved')
      await refresh({ status: 'approved' })
      setNotice('Approved with a recorded exception.')
      setReasonOpen(false); setReason('')
    } catch (e) {
      setActionError(e && e.status === 409 ? 'The server refused: ' + errText(e) : errText(e))
      if (e && (e.status === 409 || e.status === 404)) { try { await refresh() } catch { /* the original error stands */ } }
    } finally { setBusy(null) }
  }, [artifactId, reason, refresh])

  if (!artifact) return null

  const f = footerFor(result)
  const problems = reconcile(result)
  const split = attentionSplit(result)
  const reasonTooShort = reason.trim().length < 8

  const footer = (
    <>
      {actionError && <div style={{ flexBasis: '100%', fontSize: 12, color: 'var(--proto-red)' }}>{actionError}</div>}
      {notice && !actionError && <div style={{ flexBasis: '100%', fontSize: 12, color: 'var(--proto-green)' }}>{notice}</div>}
      {reasonOpen && (
        <div style={{ flexBasis: '100%' }}>
          <label htmlFor="ee-gate-reason" className="px-small">Why is it acceptable to ship this asset with these findings? Recorded against your name.</label>
          <textarea id="ee-gate-reason" data-qc={GATE_HOOKS.reason} className="px-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            style={{ width: '100%', marginTop: 4, resize: 'vertical' }} />
          <div className="px-small">{reasonTooShort ? 'at least 8 characters (' + reason.trim().length + ' so far)' : 'this reason will be stored with the approval'}</div>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 170 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{f.headline}</div>
        {f.reason && <div className="px-small">{f.reason}</div>}
      </div>
      <button type="button" className="px-btn" data-qc={GATE_HOOKS.runChecks} onClick={runChecks} disabled={!!busy}>
        {busy === 'checks' ? 'Running...' : (result && result.gate != null ? 'Re-run checks' : 'Run checks')}
      </button>
      {f.needsReason ? (
        reasonOpen ? (
          <>
            <button type="button" className="px-btn" onClick={() => { setReasonOpen(false); setReason('') }} disabled={!!busy}>Cancel</button>
            <button type="button" className="px-btn px-btn-yellow" data-qc={GATE_HOOKS.approve} data-qc-kind="exception" onClick={approveWithException} disabled={!!busy || reasonTooShort}>
              {busy === 'override' ? 'Recording...' : 'Record and approve'}
            </button>
          </>
        ) : (
          <button type="button" className="px-btn px-btn-yellow" data-qc={GATE_HOOKS.approve} data-qc-kind="needs-reason" onClick={() => { setReasonOpen(true); setActionError(null) }} disabled={!!busy}>{f.label}</button>
        )
      ) : (
        <button type="button" className="px-btn px-btn-green" data-qc={GATE_HOOKS.approve} data-qc-kind="approve"
          onClick={approve} disabled={f.disabled || !!busy} title={f.disabled ? f.reason : undefined}>
          {busy === 'approve' ? 'Approving...' : f.label}
        </button>
      )}
    </>
  )

  return (
    <Overlay
      open={open}
      variant="drawer"
      onClose={onClose}
      title={assetLabel(artifact.type)}
      subtitle={[company, role].filter(Boolean).join(' - ') || 'Asset gate'}
      headerRight={<GateBadge result={result} loading={resultLoading} error={resultError} />}
      footer={footer}
    >
      {/* One root for the whole drawer body, carrying the state a verifier needs to select on:
          which tab is showing and which asset it is showing it for. Without it the only way to
          tell two open drawers apart on the live site is the prose in their headers. */}
      <div data-qc={GATE_HOOKS.drawer} data-qc-tab={tab} data-qc-asset={artifact.type || 'unknown'}>

      {resultError && <Quiet>The gate could not be read: {resultError}</Quiet>}

      {/* One reconciled summary, visible on every tab: the same numbers the badge and the footer
          use, plus the split by engine so no finding can appear to go missing between tabs. */}
      {result && (
        <div className="px-box-soft" data-qc={GATE_HOOKS.summary} style={{ padding: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <GateBadge result={result} />
            <span className="px-small" style={{ flex: 1 }}>
              {gateMeta(result.gate).blurb}{result.computedAt ? ' - checked ' + fmtWhen(result.computedAt) : ''}
            </span>
            {artifact.status && <Pill tone={STATUS_TONE[artifact.status] || 'panel'}>{artifact.status}</Pill>}
          </div>
          {(split.listed > 0 || split.counted > 0) && (
            <div className="px-small" style={{ marginTop: 6 }}>
              {split.listed} finding(s) need attention: {split.fix} from the measured rules,
              {' '}{split.review} from the independent reviewer.
              {split.counted !== split.listed
                && ' The server reported ' + split.counted + ' - the note below reports that disagreement rather than resolving it here.'}
            </div>
          )}
          {result.override && (
            <div className="px-small" data-qc={GATE_HOOKS.exception} style={{ marginTop: 6 }}>
              exception recorded by {result.override.by} on {fmtWhen(result.override.at)}: {result.override.reason}
            </div>
          )}
        </div>
      )}

      {problems && (
        <div className="px-note" data-qc={GATE_HOOKS.disagreement} style={{ marginBottom: 12 }}>
          <b>The gate and its findings do not agree.</b> Showing the server&apos;s decision unchanged rather than
          choosing between them:
          <ul style={{ margin: '4px 0 0 0', paddingLeft: 18 }}>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}

      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--proto-rule-soft)', overflowX: 'auto', marginBottom: 12 }}>
        {TABS.map((t) => (
          <div key={t.key} role="button" tabIndex={0} onClick={() => setTab(t.key)}
            data-qc={GATE_HOOKS.tab} data-qc-tab={t.key} data-qc-active={tab === t.key ? '1' : '0'}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTab(t.key) } }}
            className={'px-tab ' + (tab === t.key ? 'px-tab-active' : 'px-tab-idle')}>{t.label}</div>
        ))}
      </div>

      <div data-qc={GATE_HOOKS.panel} data-qc-panel={tab}>
        {tab === 'blocks' && <BlocksTab data={insertions.data} loading={insertions.loading} error={insertions.error} focusField={focusSection} />}
        {tab === 'checks' && <ChecksTab result={result} />}
        {tab === 'compare' && <CompareTab swaps={swaps.data} swapsLoading={swaps.loading} swapsError={swaps.error} insertions={insertions.data} />}
        {tab === 'review' && <ReviewTab result={result} />}
        {tab === 'match' && <MatchTab result={result} />}
      </div>
      </div>
    </Overlay>
  )
}
