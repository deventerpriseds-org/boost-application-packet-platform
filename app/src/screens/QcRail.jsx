import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { Pill, toneColor } from '../shell.jsx'
import AssetGateDrawer from './AssetGateDrawer.jsx'
import { assetLabel, checkLabel, fieldLabel, severityMeta, fmtWhen } from '../assetGate.js'
import {
  QC_HOOKS, RAIL_TABS, railGate, railGateMeta, railAttention, railCounts, railTotals, railBody,
  railHeadline, verdictLine, railVerdict, engineRows, countLink, coverageCards,
  requirementState, qcStepState, packetGate, loopsModel, notApplicableRows, rowsForRequirement,
  swapsForRequirement, pctWidth, arr, errText,
  railChangeLog, undoAvailability, revertOutcome, suggestScope, CHANGE_LOG_HEADLINE,
} from '../qcRail.js'

// P5.1 - the packet-level QC & evidence rail.
//
// THIS FILE COMPUTES NOTHING. Every gate word, every count, every severity ordering, every
// closed/total and every deep-link target is returned by ../qcRail.js and rendered here. That split
// is not tidiness: the count bug this step exists to prevent shipped from a component that did its
// own arithmetic, and app/test/qcRail.test.mjs greps this file to prove it does not.
//
// It EXTENDS what P5.2/P5.3 already built rather than standing up a parallel QC surface:
//   - the per-asset verdict is AssetGateDrawer (P5.3), opened over the step - not re-implemented;
//   - engine grouping, score parts and state colours are the assetGate.js selectors;
//   - the posting spine is the same GET /opportunity/{id}/requirements the JD step reads.
//
// The one rule worth restating on screen and in code: the SERVER owns the gate. `gate: null` is
// "not checked", which is the absence of a verdict rather than permission, and it never wears green.

// ── data ────────────────────────────────────────────────────────────────────────────────────────

/**
 * ONE source for every asset's QC payload in this packet.
 *
 * The step circle, the counts strip, every tab and the drawer all read this same map, so they cannot
 * disagree. Two components each fetching checks-result for the same artifact is precisely how one
 * surface comes to show a stale gate beside a fresh one.
 *
 * Every call goes through api.js, which appends ?owner= - resolveOwner() falls back to the DEMO
 * owner without it and silently 404s the real owner's rows.
 */
export function useQcEntries(artifacts, { withInsertions = false, withRemediation = false } = {}) {
  const list = useMemo(() => arr(artifacts), [artifacts])
  const ids = list.map((a) => a && a.id).filter(Boolean).join(',')
  const [checks, setChecks] = useState({})
  const [ins, setIns] = useState({})
  const insWanted = useRef(new Set())
  // D:remediation-never-ran — the loop ledger. Fetched on the same terms as insertions and kept in
  // its own map, so a tab that does not ask for it pays nothing and `loopsModel` can tell "no pass
  // has run" from "we did not ask".
  const [rem, setRem] = useState({})
  const remWanted = useRef(new Set())

  useEffect(() => {
    let dead = false
    const wanted = ids ? ids.split(',') : []
    setChecks((m) => {
      const next = {}
      for (const id of wanted) next[id] = m[id] || { loading: true, error: null, data: null }
      return next
    })
    for (const id of wanted) {
      api.artifactChecksResult(id)
        .then((r) => { if (!dead) setChecks((m) => ({ ...m, [id]: { loading: false, error: null, data: r } })) })
        .catch((e) => { if (!dead) setChecks((m) => ({ ...m, [id]: { loading: false, error: errText(e), data: null } })) })
    }
    return () => { dead = true }
  }, [ids])

  useEffect(() => {
    if (!withInsertions) return undefined
    let dead = false
    const wanted = ids ? ids.split(',') : []
    for (const id of wanted) {
      if (insWanted.current.has(id)) continue
      insWanted.current.add(id)
      setIns((m) => ({ ...m, [id]: { loading: true, error: null, data: null } }))
      api.artifactInsertions(id)
        .then((r) => { if (!dead) setIns((m) => ({ ...m, [id]: { loading: false, error: null, data: r } })) })
        .catch((e) => { if (!dead) setIns((m) => ({ ...m, [id]: { loading: false, error: errText(e), data: null } })) })
    }
    return () => { dead = true }
  }, [ids, withInsertions])

  useEffect(() => {
    if (!withRemediation) return undefined
    let dead = false
    const wanted = ids ? ids.split(',') : []
    for (const id of wanted) {
      if (remWanted.current.has(id)) continue
      remWanted.current.add(id)
      setRem((m) => ({ ...m, [id]: { loading: true, error: null, data: null } }))
      api.artifactRemediationGet(id)
        .then((r) => { if (!dead) setRem((m) => ({ ...m, [id]: { loading: false, error: null, data: r } })) })
        .catch((e) => { if (!dead) setRem((m) => ({ ...m, [id]: { loading: false, error: errText(e), data: null } })) })
    }
    return () => { dead = true }
  }, [ids, withRemediation])

  const entries = useMemo(() => list.filter((a) => a && a.id).map((a) => {
    const c = checks[a.id] || { loading: true, error: null, data: null }
    const i = ins[a.id] || { loading: false, error: null, data: null }
    const rm = rem[a.id] || { loading: false, error: null, data: null }
    return {
      artifact: a,
      label: assetLabel(a.type),
      result: c.data,
      resultLoading: c.loading,
      resultError: c.error,
      insertions: i.data,
      insertionsLoading: i.loading,
      insertionsError: i.error,
      remediation: rm.data,
      remediationLoading: rm.loading,
      remediationError: rm.error,
    }
  }), [list, checks, ins, rem])

  const setResult = useCallback((artifactId, fresh) => {
    setChecks((m) => ({ ...m, [artifactId]: { loading: false, error: null, data: fresh } }))
  }, [])

  return { entries, setResult }
}

// ── small presentational pieces ─────────────────────────────────────────────────────────────────

const Quiet = ({ hook, children }) => (
  <div className="px-dashed" data-qc={hook || QC_HOOKS.empty} style={{ padding: 12, fontSize: 12, color: 'var(--proto-ink2)' }}>{children}</div>
)

const Head = ({ title, note, right }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
    <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
    {note && <span className="px-small" style={{ flex: 1, minWidth: 120 }}>{note}</span>}
    {right}
  </div>
)

/** The packet gate word. `tone` is resolved through toneColor - never by building a token name. */
function GateWord({ gate, meta, loading }) {
  // "Not checked" is an accusation about the data. It is never printed while the request that would
  // answer the question is still in flight.
  return (
    <span data-qc={QC_HOOKS.gate} data-qc-state={loading ? 'loading' : gate}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: toneColor(loading ? 'panel' : meta.tone) }} />
      <span style={{ fontSize: 14, fontWeight: 700 }}>{loading ? 'Reading the gate...' : meta.word}</span>
    </span>
  )
}

/**
 * A count that opens the field it counted (P8.5).
 *
 * Clickable ONLY when the module resolved a section for it. An offender that resolves to nothing is
 * excluded from the link set and rendered inert BELOW with the reason - a count wired to a link that
 * lands nowhere teaches a reader the evidence trail is broken, which is the one thing this rail is
 * for.
 */
function CountLink({ artifactId, row, onOpen }) {
  const link = countLink(artifactId, row)
  if (!link.count) return null
  if (!link.linkable) {
    return (
      <span data-qc={QC_HOOKS.checkCount} data-qc-linkable="0" title={link.reason}
        style={{ fontSize: 12, fontWeight: 700, color: 'var(--proto-ink2)' }}>{link.count}</span>
    )
  }
  return (
    <button type="button" className="px-btn"
      data-qc={QC_HOOKS.checkCount} data-qc-linkable="1"
      data-qc-artifact={link.artifact_id} data-qc-section={link.section_id}
      onClick={() => onOpen(link.artifact_id, link.section_id)}
      title={'Open ' + fieldLabel(link.section_id)}
      style={{ fontSize: 12, fontWeight: 700, padding: '1px 8px' }}>{link.count}</button>
  )
}

// One finding. The severity pill is the only colour signal, and not_applicable carries its own grey
// and its own words so it can never be read as a pass. severityMeta is engine-aware where stateMeta
// was not: a reviewer `fail` reads 'Your call', because D6 says it cannot block this artifact.
function CheckRow({ artifactId, row, onOpen }) {
  const m = severityMeta(row)
  const link = countLink(artifactId, row)
  return (
    <div className="px-box-soft" data-qc={QC_HOOKS.check} data-qc-state={row.state} data-qc-engine={row.engine || 'deterministic'}
      style={{ padding: 10, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 140 }}>{checkLabel(row.check_key)}</span>
        <CountLink artifactId={artifactId} row={row} onOpen={onOpen} />
        <Pill tone={m.tone}>{m.label}</Pill>
      </div>
      <div className="px-small" style={{ marginTop: 4 }}>
        {row.state === 'not_applicable' ? 'why it could not be checked: ' : 'what we saw: '}
        {row.observed || '(nothing recorded)'}
      </div>
      {row.expected && <div className="px-small">what it should be: {row.expected}</div>}
      {link.linked.length > 0 && (
        <ul style={{ margin: '6px 0 0 0', paddingLeft: 18 }}>
          {link.linked.map((l, i) => (
            <li key={'l' + i} style={{ fontSize: 12, marginBottom: 2 }}>
              <span className="px-link" role="button" tabIndex={0}
                data-qc-artifact={l.artifact_id} data-qc-section={l.section_id}
                onClick={() => onOpen(l.artifact_id, l.section_id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(l.artifact_id, l.section_id) } }}
                style={{ cursor: 'pointer' }}>{l.offender}</span>
            </li>
          ))}
        </ul>
      )}
      {link.inert.length > 0 && (
        <ul style={{ margin: '6px 0 0 0', paddingLeft: 18 }}>
          {link.inert.map((l, i) => (
            <li key={'i' + i} data-qc={QC_HOOKS.countInert} style={{ fontSize: 12, marginBottom: 2, color: 'var(--proto-ink2)' }}>
              {l.offender} <span className="px-small">- {l.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── tabs ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Coverage. THREE cards, always, one per requirement class, each with its own closed/total.
 *
 * Nothing sums across kinds and a kind with zero rows still gets a card reading "none extracted" -
 * dropping it would make the screen look complete when a whole class was never extracted from the
 * posting.
 */
function CoverageTab({ requirements, reqError, reqLoading, entries, pick, setPick }) {
  if (reqError) return <Quiet>The posting spine could not be read: {reqError}</Quiet>
  // "none extracted" is a statement about the posting. Printing it before the rows have arrived
  // would accuse the extractor of a failure that is really a request in flight.
  if (reqLoading) return <Quiet>Reading the posting spine...</Quiet>
  const cards = coverageCards(requirements, entries)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {cards.map((card) => (
        <div key={card.key} className="px-box" data-qc={QC_HOOKS.coverageCard} data-qc-kind={card.key}
          style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'baseline', gap: 8, background: 'var(--proto-panel)', borderBottom: '1px solid var(--proto-rule-soft)' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{card.label}</span>
            <div style={{ flex: 1 }} />
            <span data-qc={QC_HOOKS.coverageCount} data-qc-kind={card.key}
              style={{ fontSize: 12, fontWeight: 700, color: card.closed === null ? 'var(--proto-ink2)' : toneColor(card.closed === card.total ? 'green' : 'red') }}>
              {card.empty ? card.note : card.closed === null ? card.note : card.closed + '/' + card.total}
            </span>
          </div>
          <div className="px-small" style={{ padding: '6px 14px', borderBottom: card.rows.length ? '1px solid var(--proto-rule-soft)' : 'none' }}>
            {card.source}
          </div>
          {card.rows.map((r) => {
            const st = requirementState(card, r)
            const on = pick === r.id
            return (
              <div key={r.id || r.seq} data-qc={QC_HOOKS.reqRow} data-qc-state={st.state}
                role="button" tabIndex={0}
                onClick={() => setPick(on ? null : r.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPick(on ? null : r.id) } }}
                style={{ padding: '9px 14px', borderBottom: '1px solid var(--proto-rule-soft)', cursor: 'pointer', background: on ? 'var(--proto-accent-soft)' : 'transparent' }}>
                <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: toneColor(st.tone) }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.5 }}>
                    {r.verbatim || r.item_text}
                  </span>
                  <span className="px-small" style={{ whiteSpace: 'nowrap' }}>{st.label}</span>
                </div>
                {!r.verbatim && (
                  <div className="px-small" style={{ marginTop: 3 }}>
                    the employer wording could not be located, so this is the parser paraphrase
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// Original vs final. The packet-level swap table, filtered by the picked requirement when there is
// one. Packet-level is said out loud: one swap row covers every asset built from this packet.
function CompareTab({ swaps, loading, error, pick }) {
  if (loading) return <Quiet>Loading what the tailoring pass changed...</Quiet>
  if (error) return <Quiet>Could not load the comparison: {error}</Quiet>
  const all = arr(swaps && swaps.swaps)
  const rows = swapsForRequirement(swaps, pick)
  if (!all.length) return <Quiet>Nothing was swapped, added or dropped for this packet.</Quiet>
  if (!rows.length) return <Quiet>No change in this packet cites the requirement you picked.</Quiet>
  return (
    <div>
      <Head title="What the tailoring pass changed"
        note={'Packet-level: one row here covers every asset built from this packet. '
          + arr(swaps && swaps.swaps).length + ' decision(s), ' + Number(swaps.unattributed || 0) + ' citing no line of the posting.'} />
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
                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--proto-rule-soft)' }}>
                  <Pill tone={s.action === 'dropped' ? 'red' : s.action === 'kept' ? 'panel' : 'accent'}>{s.action}</Pill>
                </td>
                <td style={{ fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--proto-rule-soft)' }}>
                  {s.verbatim_quote
                    ? <span>the posting says &quot;{s.verbatim_quote}&quot;</span>
                    : <span className="px-small">{s.driver === 'unattributed' ? 'no line of the posting backs this change' : s.rationale || String(s.driver || '')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Remediation loops.
 *
 * READS THE REAL LEDGER. The comment here used to say "P3 IS NOT BUILT - there is no
 * remediation_loop table and no escalation table in the API", which was true when written and
 * stopped being true when both tables shipped. What was actually missing was a CALLER — four routes
 * were deployed and `app/src/api.js` referenced none of them, so P3 had run ZERO times in production
 * while this tab told the owner the controller did not exist (`D:remediation-never-ran`).
 *
 * `loopsModel` still falls back to `insertion.loop` when the ledger has not been fetched, and SAYS
 * SO — "no pass has run" and "we did not ask" are different facts and only one of them is about the
 * packet.
 */
function LoopsTab({ entries, filtered }) {
  const m = loopsModel(entries)
  return (
    <div data-qc={QC_HOOKS.loops}>
      <Head title="Remediation loops" note={m.note} />
      {filtered && (
        <div className="px-small" style={{ marginBottom: 8 }}>
          The requirement filter does not narrow this tab: a pass record has no requirement on it, so
          filtering here would silently show you the same rows under a heading claiming otherwise.
        </div>
      )}
      {m.empty && <Quiet>{m.emptyText}</Quiet>}
      {m.openEscalations > 0 && (
        <div className="px-small" style={{ marginTop: 6, color: 'var(--text-warn)' }}>
          {m.openEscalations} requirement(s) the loop could not close are waiting on you.
        </div>
      )}
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {m.assets.map((a) => (
          <div key={a.artifact_id} className="px-box-soft" style={{ padding: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 120 }}>{a.label}</span>
              {a.loading
                ? <span className="px-small">loading...</span>
                : a.error
                  ? <span className="px-small">could not be read: {a.error}</span>
                  : <Pill tone="panel">{a.passes} generation pass(es)</Pill>}
            </div>
            {!a.loading && !a.error && (
              <div className="px-small" style={{ marginTop: 4 }}>
                {a.remediation
                  ? a.remediation + ' pass(es) after the first, ' + a.rewritten + ' block(s) rewritten'
                  : 'generated once and never revisited - no remediation pass has run'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Every asset's findings, ordered by what must be acted on first. The ordering is severityWeight()
// in the module - a reviewer fail sorts BELOW a measured fail because it can never block (D6).
function ChecksTab({ entries, pick, requirements, onOpen }) {
  const picked = arr(requirements).find((r) => r.id === pick) || null
  const pickedSeq = picked ? Number(picked.seq) : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {entries.map((e) => {
        const result = e.result
        const rows = rowsForRequirement(result, pickedSeq)
        const na = notApplicableRows(result)
        return (
          <div key={e.artifact.id} data-qc={QC_HOOKS.asset} data-qc-artifact={e.artifact.id}>
            <Head title={e.label}
              note={e.resultLoading ? 'loading the gate...' : railBody(result)}
              right={<GateWord gate={railGate(result)} meta={railGateMeta(result)} loading={e.resultLoading} />} />
            {e.resultError && <Quiet>The gate could not be read: {e.resultError}</Quiet>}
            {!e.resultError && !rows.length && (
              <Quiet>{e.resultLoading
                ? 'Reading the findings for this asset...'
                : pickedSeq == null
                  ? 'No check rows were recorded for this asset.'
                  : 'No finding on this asset names the requirement you picked.'}</Quiet>
            )}
            {rows.map((r, i) => <CheckRow key={r.check_key + ':' + i} artifactId={e.artifact.id} row={r} onOpen={onOpen} />)}
            {na.length > 0 && pickedSeq == null && (
              <div className="px-note" data-qc={QC_HOOKS.notApplicable} style={{ marginTop: 4 }}>
                {na.length} check(s) had nothing to test against and are counted in neither number. That is not a pass:
                <ul style={{ margin: '4px 0 0 0', paddingLeft: 18 }}>
                  {na.map((x, i) => <li key={i}>{checkLabel(x.check_key)} - {x.reason}</li>)}
                </ul>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// The independent reviewer. D6 is stated on the screen, not only enforced in the engine: a reader
// who sees a red reviewer row must be able to tell why the asset is not blocked.
function ReviewTab({ entries, onOpen, filtered }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-qc={QC_HOOKS.review}>
      <Head title="Independent review"
        note="A reviewer disagreement can ask for a decision, but it can never block an asset on its own - only the measured rules do that." />
      {filtered && (
        <div className="px-small">
          The requirement filter does not narrow this tab - the reviewer grades the asset as a whole,
          so its rows are not indexed by a single posting line. Use Checks for a per-requirement view.
        </div>
      )}
      {entries.map((e) => {
        const v = verdictLine(railVerdict(e.result))
        const rows = engineRows(e.result, 'reviewer')
        return (
          <div key={e.artifact.id} data-qc={QC_HOOKS.asset} data-qc-artifact={e.artifact.id}>
            <Head title={e.label} note={v.text} />
            {rows.length
              ? rows.map((r, i) => <CheckRow key={r.check_key + ':' + i} artifactId={e.artifact.id} row={r} onOpen={onOpen} />)
              : <Quiet>{v.ran ? 'The reviewer ran but recorded no findings for this asset.' : 'Nothing here has been second-guessed.'}</Quiet>}
          </div>
        )
      })}
    </div>
  )
}

// P8.6-CHANGELOG-BEGIN
// A structural marker, not a decoration: app/test/corrections.test.mjs slices the change-log region
// out of this file by these two sentinels rather than by a component name, so renaming anything in
// here cannot move the region a guard is looking at - or quietly shrink it.
/**
 * P8.6 / R1 - the change log. "The user reviews a change log, not a to-do list."
 *
 * ONE CORRECTION, and everything about it comes from the module. This component decides no count, no
 * ordering, no availability and no wording; it renders `railChangeLog(result)` and the row models
 * inside it. `result.corrections` is never read here - the moment a .jsx reads that property there
 * are two definitions of how many corrections there are, which is the exact bug the counts strip
 * above it already shipped twice.
 *
 * The two affordances the backlog names, and what each is actually wired to:
 *
 *   Undo                       -> POST /app/correction/{id}/revert, and ONLY when the row carries the
 *                                 id that route needs. No id, no control: a button that cannot make a
 *                                 request is dead UI, and the row says why instead.
 *   Suggest something different -> POST /app/artifact/{id}/ai-edit with `section`, the SAME
 *                                 field-scoped edit path the resume editor already uses. Not a second
 *                                 way to ask for a change.
 */
export function CorrectionRow({ row, artifactId, onOpen, onUndid, busy, setBusy, inField = false }) {
  const [refusal, setRefusal] = useState(null)
  const [askOpen, setAskOpen] = useState(false)
  const [ask, setAsk] = useState('')
  const undo = undoAvailability(row)
  const scope = suggestScope(row)
  const mine = busy && busy.key === row.key
  const canSend = ask.trim().length > 0

  const doUndo = async () => {
    setBusy({ key: row.key, what: 'undo' }); setRefusal(null)
    try {
      // The server's answer decides, on `ok` alone - a correction can revert a field back to the
      // empty string, so branching on the returned text would report a phantom refusal.
      const outcome = revertOutcome(await api.revertCorrection(row.id))
      if (!outcome.ok) { setRefusal(outcome.reason); return }
      await onUndid()
    } catch (e) {
      // A thrown error still carries the server's own body through postDetailed. It is a refusal
      // with a reason, not a generic failure, and it is shown as one.
      setRefusal(revertOutcome((e && e.body) || { reason: errText(e) }).reason)
    } finally { setBusy(null) }
  }

  const doAsk = async () => {
    setBusy({ key: row.key, what: 'ask' }); setRefusal(null)
    try {
      await api.aiEditArtifact(artifactId, { instruction: ask.trim(), section: row.merge_field })
      setAsk(''); setAskOpen(false)
      await onUndid()
    } catch (e) { setRefusal(errText(e)) } finally { setBusy(null) }
  }

  return (
    <div className="px-box-soft" data-qc={QC_HOOKS.correction} data-qc-field={row.merge_field}
      data-qc-state={row.undone ? 'undone' : 'corrected'} data-qc-seq={row.seqKnown ? row.seq : ''}
      style={{ padding: 10, marginBottom: 8, borderLeft: '3px solid ' + toneColor(row.undone ? 'panel' : 'accent') }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* NOT a <Pill>. Measured in test/browser/run-qc-rail.mjs: of the nine px-pill tones, eight
            fall below 4.5:1 in at least one theme - `accent` is 2.90:1 in dark and `panel` is
            4.04:1 dark / 4.28:1 light, which are the two this row would have used. That is a live
            defect in the shared tones and it is reported as one; what it is NOT is a reason to add
            a ninth unreadable pill. The state is the row's own ink, which measures well in both
            themes, and the colour is a RULE rather than the text - so the two states are told apart
            by their word first and their colour second, which is also the only way a reader who
            cannot see the difference gets the information at all. */}
        <b style={{ fontSize: 12, letterSpacing: '.3px' }}>{row.undone ? 'Undone' : 'Corrected'}</b>
        <span data-qc-part="sentence" style={{ fontSize: 13, flex: 1, minWidth: 180, color: 'var(--proto-ink)' }}>{row.sentence}</span>
        {/* Rendered INSIDE the field it corrects (AssetBlocks' margin), the field name and the
            "Open <field>" button are both restatements of where the reader already is. The row is
            otherwise identical - same wording, same affordances, same module-owned model - because
            two renderings of one correction is exactly the divergence this component exists to
            prevent. */}
        {!inField && (
          <span className="px-small" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{row.merge_field}</span>
        )}
        {!inField && artifactId && row.merge_field && (
          <button type="button" className="px-btn" data-qc={QC_HOOKS.correctionOpen}
            data-qc-artifact={artifactId} data-qc-section={row.merge_field}
            onClick={() => onOpen(artifactId, row.merge_field)}
            style={{ fontSize: 12, padding: '1px 8px' }}>Open {row.fieldName || row.merge_field}</button>
        )}
      </div>
      {/* The reason is the SUBSTANCE of a change log - R1's whole claim is that the user can see why
          each change was made - so it is primary ink, not the `px-small` tertiary token, which
          measured 2.56:1 in light in this file's own contrast section. Metadata below it stays
          quiet; the reason does not. */}
      <div data-qc-part="why" style={{ marginTop: 4, fontSize: 12, color: 'var(--proto-ink)' }}>
        why: {row.reason || 'no reason was recorded for this change'}
      </div>
      <div data-qc-part="source" style={{ fontSize: 12, color: 'var(--proto-ink)' }}>the replacement was {row.sourceText}</div>
      {row.undone && row.undoneAt && (
        <div className="px-small">undone {fmtWhen(row.undoneAt)}{row.undoneBy ? ' by ' + row.undoneBy : ''}</div>
      )}
      {refusal && (
        <div className="px-note" data-qc={QC_HOOKS.correctionRefusal} style={{ marginTop: 6 }}>
          <b>This was not undone.</b> {refusal}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {undo.can
          ? <button type="button" className="px-btn" data-qc={QC_HOOKS.correctionUndo} data-qc-id={row.id}
              onClick={doUndo} disabled={!!busy}>{mine && busy.what === 'undo' ? 'Undoing...' : 'Undo'}</button>
          : <span className="px-small" data-qc={QC_HOOKS.correctionUndo} data-qc-available="0">{undo.reason}</span>}
        <button type="button" className="px-btn" data-qc={QC_HOOKS.correctionSuggest}
          data-qc-section={row.merge_field} onClick={() => setAskOpen((v) => !v)} disabled={!!busy}
          style={{ fontSize: 12 }}>Suggest something different</button>
      </div>
      {askOpen && (
        <div style={{ marginTop: 6 }}>
          <div className="px-small" style={{ letterSpacing: '.4px' }}>{scope.label}</div>
          <div className="px-small">{scope.scope}</div>
          <textarea className="px-input" rows={2} value={ask} placeholder={scope.placeholder}
            onChange={(e) => setAsk(e.target.value)} style={{ width: '100%', marginTop: 4, resize: 'vertical' }} />
          <div className="px-small">{scope.caveat}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button type="button" className="px-btn" onClick={() => { setAskOpen(false); setAsk('') }} disabled={!!busy}>Cancel</button>
            <button type="button" className="px-btn px-btn-accent" onClick={doAsk} disabled={!!busy || !canSend}>
              {mine && busy.what === 'ask' ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The change log for the whole packet, on the page rather than behind a tab (SPEC 4.8).
 *
 * FOUR STATES, four sentences, and they are not interchangeable. An asset whose payload carried no
 * change log at all is not an asset with nothing to correct: it is an asset nobody asked. Saying
 * "nothing needed correcting" about it would be this feature's version of the vacuous green, and it
 * is the only state that exists until the correction API lands.
 */
function ChangeLog({ entries, onOpen, onRefresh }) {
  const [busy, setBusy] = useState(null)
  const logs = entries.map((e) => ({ entry: e, log: railChangeLog(e.result) }))
  const anyRows = logs.some((l) => l.log.rows.length)
  return (
    <div className="px-box" data-qc={QC_HOOKS.changeLog} style={{ padding: 16 }}>
      <Head title={CHANGE_LOG_HEADLINE}
        note="Everything the run could settle on its own, already applied to your text. Change or revert any of it." />
      {logs.map(({ entry, log }) => (
        <div key={entry.artifact.id} data-qc={QC_HOOKS.asset} data-qc-artifact={entry.artifact.id} style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{entry.label}</span>
            {log.hasNumber && (
              <span className="px-small" data-qc={QC_HOOKS.corrected} data-qc-n={log.count}>{log.count} corrected</span>
            )}
            {log.hasNumber && log.undone > 0 && (
              <span className="px-small" data-qc={QC_HOOKS.correctionsUndone} data-qc-n={log.undone}>{log.undone} undone</span>
            )}
          </div>
          {entry.resultLoading
            ? <Quiet>Reading the change log for this asset...</Quiet>
            : log.rows.length
              ? log.rows.map((row) => (
                <CorrectionRow key={row.key} row={row} artifactId={entry.artifact.id} onOpen={onOpen}
                  busy={busy} setBusy={setBusy} onUndid={() => onRefresh(entry.artifact.id)} />
              ))
              : <Quiet hook={QC_HOOKS.correctionNote}>{log.body}</Quiet>}
          {log.anomalies.map((a, i) => (
            <div key={i} className="px-note" data-qc={QC_HOOKS.correctionAnomaly} style={{ marginTop: 6 }}>{a}</div>
          ))}
        </div>
      ))}
      {!anyRows && (
        <div className="px-small" style={{ marginTop: 10 }}>
          Nothing above is waiting on you. Corrections are counted on their own and are never added
          to the numbers beside the gate.
        </div>
      )}
    </div>
  )
}

// P8.6-CHANGELOG-END

// ── the rail ────────────────────────────────────────────────────────────────────────────────────

export default function QcRail({ packetId, company, role, entries, setResult, requirements, reqError, reqLoading = false }) {
  const [tab, setTab] = useState('coverage')
  const [pick, setPick] = useState(null)
  const [drawer, setDrawer] = useState(null)          // { artifactId, section }
  const [swaps, setSwaps] = useState({ loading: false, error: null, data: null })
  const swapsFor = useRef(null)

  useEffect(() => {
    if (tab !== 'compare' || !packetId || swapsFor.current === packetId) return undefined
    swapsFor.current = packetId
    let dead = false
    setSwaps({ loading: true, error: null, data: null })
    api.packetSwaps(packetId)
      .then((d) => { if (!dead) setSwaps({ loading: false, error: null, data: d }) })
      .catch((e) => { if (!dead) setSwaps({ loading: false, error: errText(e), data: null }) })
    return () => { dead = true }
  }, [tab, packetId])

  const loading = entries.some((e) => e.resultLoading)
  const totals = railTotals(entries)
  const gate = packetGate(entries)
  const meta = railGateMeta({ gate })
  const step = qcStepState(entries)
  const openField = useCallback((artifactId, section) => setDrawer({ artifactId, section }), [])

  // After an undo or a scoped rewrite, RE-READ the payload the counters and the log both come from.
  // Splicing the row out of local state would leave the change log, the corrections number and the
  // gate describing three different moments - and the gate is the one that moves, because reverting
  // a correction puts the figure back and re-opens the check that named it.
  const refreshOne = useCallback(async (artifactId) => {
    const fresh = await api.artifactChecksResult(artifactId)
    setResult(artifactId, fresh)
  }, [setResult])

  // The headline is the RESUME's score when there is one - the packet has no composite of its own,
  // and inventing one by averaging three artifacts would be exactly the fabricated composite the
  // score engine refuses to produce.
  const scoreEntry = entries.find((e) => e.artifact.type === 'resume') || entries[0] || null
  const headline = railHeadline(scoreEntry && scoreEntry.result && scoreEntry.result.score)

  const picked = arr(requirements).find((r) => r.id === pick) || null
  const drawerEntry = drawer ? entries.find((e) => e.artifact.id === drawer.artifactId) : null

  return (
    <div data-qc={QC_HOOKS.rail} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Summary. Every number here comes from the module; nothing on this screen is added up. */}
      <div className="px-box" style={{ padding: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <GateWord gate={gate} meta={meta} loading={loading} />
            <span className="px-small">{loading ? 'reading the gate for every asset in this packet' : step.reason}</span>
          </div>
          <div data-qc={QC_HOOKS.counts} style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <b data-qc={QC_HOOKS.toFix} style={{ fontSize: 18 }}>{totals.toFix}</b>
              <span className="px-small">to fix</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <b data-qc={QC_HOOKS.toReview} style={{ fontSize: 18 }}>{totals.toReview}</b>
              <span className="px-small">to review</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <b data-qc={QC_HOOKS.unchecked} style={{ fontSize: 18 }}>{totals.unchecked}</b>
              <span className="px-small">never checked</span>
            </span>
            {/* The corrections number. A THIRD number, never folded into either counter: a
                correction is work already done, and adding it to "to fix" would tell the reader to
                fix something that is already fixed. It appears only when at least one asset sent a
                change log - printing 0 for assets nobody asked is the reviewer's "0 disagreements". */}
            {totals.correctionsMeasured > 0 && (
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                <b data-qc={QC_HOOKS.corrected} data-qc-n={totals.corrected} style={{ fontSize: 18 }}>{totals.corrected}</b>
                <span className="px-small">corrected for you</span>
              </span>
            )}
            {totals.correctionsMeasured > 0 && totals.correctionsUndone > 0 && (
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                <b data-qc={QC_HOOKS.correctionsUndone} data-qc-n={totals.correctionsUndone} style={{ fontSize: 18 }}>{totals.correctionsUndone}</b>
                <span className="px-small">undone by you</span>
              </span>
            )}
          </div>
          <div className="px-small" data-qc={QC_HOOKS.body} style={{ marginTop: 8 }}>
            The two numbers answer different questions and are never added together: only the measured
            rules can block an asset, and a reviewer disagreement asks for a decision instead. An asset
            that was never checked is counted on its own - it is the absence of a verdict, not a pass.
            Changes already made for you are counted separately again, and are in neither number.
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {entries.map((e) => {
              const g = e.resultLoading ? 'loading' : railGate(e.result)
              const m = railGateMeta(e.result)
              const c = railCounts(e.result)
              return (
                <span key={e.artifact.id} role="button" tabIndex={0}
                  data-qc={QC_HOOKS.asset} data-qc-artifact={e.artifact.id} data-qc-state={g}
                  onClick={() => setDrawer({ artifactId: e.artifact.id, section: null })}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setDrawer({ artifactId: e.artifact.id, section: null }) } }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', boxShadow: 'inset 0 0 0 1px var(--proto-rule-soft)', fontSize: 12 }}>
                  {e.label}
                  <Pill tone={e.resultLoading ? 'panel' : m.tone}>{e.resultLoading ? 'reading...' : m.word}</Pill>
                  {c.toFix > 0 && <Pill tone="red">{c.toFix} to fix</Pill>}
                  {c.toReview > 0 && <Pill tone="yellow">{c.toReview} to review</Pill>}
                  <span className="px-small">{e.resultLoading ? 'reading...' : railAttention(e.result) + ' counted'}</span>
                </span>
              )
            })}
          </div>
        </div>

        {/* The score. A composite is only shown when the server computed one; today it never does,
            because two of its three parts have no source. The parts say why, in the server's words. */}
        <div style={{ width: 230, flexShrink: 0 }}>
          {/* The packet has NO composite of its own, and averaging three artifacts into one would be
              exactly the fabricated number computeArtifactScore refuses to produce. So this is one
              asset's score, and it says which. */}
          <div className="px-small" style={{ letterSpacing: '.4px', textTransform: 'uppercase' }}>Match</div>
          <div className="px-small">
            {scoreEntry
              ? scoreEntry.label + ' only - there is no packet-wide score, and averaging the assets would invent one'
              : 'no asset in this packet has a score'}
          </div>
          <div data-qc={QC_HOOKS.headline} style={{ marginTop: 2 }}>
            {headline.hasNumber
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.05 }}>{headline.value}</span>
                  {headline.band && <Pill tone={headline.band === 'strong' ? 'green' : headline.band === 'acceptable' ? 'yellow' : 'red'}>{String(headline.band).replace(/_/g, ' ')}</Pill>}
                </div>
              : <div className="px-small">{headline.why}</div>}
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {headline.parts.map((p) => (
              <div key={p.key} data-qc={QC_HOOKS.component} data-qc-part={p.key} data-qc-measured={p.value == null ? '0' : '1'}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 12, flex: 1 }}>{p.label}</span>
                  {p.value == null
                    ? <Pill tone="panel">not measured</Pill>
                    : <span style={{ fontSize: 13, fontWeight: 700 }}>{p.value}</span>}
                </div>
                {p.value != null && (
                  <div className="px-bar" style={{ marginTop: 4 }}><i style={{ width: pctWidth(p.value) }} /></div>
                )}
                <div className="px-small" style={{ marginTop: 2 }}>{p.source || 'no source was recorded for this part'}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The change log, ON THE PAGE (SPEC 4.8) - not behind a tab and not behind a search. What the
          run settled by itself is the first thing a reader should see, because R1's whole claim is
          that they are reviewing finished work rather than a list of chores. */}
      <ChangeLog entries={entries} onOpen={openField} onRefresh={refreshOne} />

      {/* Tabs. The picked requirement filters the other tabs, and the clear affordance appears with it. */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--proto-rule-soft)', overflowX: 'auto', alignItems: 'center' }}>
        {RAIL_TABS.map((t) => (
          <div key={t.key} role="button" tabIndex={0}
            data-qc={QC_HOOKS.tab} data-qc-tab={t.key} data-qc-active={tab === t.key ? '1' : '0'}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTab(t.key) } }}
            className={'px-tab ' + (tab === t.key ? 'px-tab-active' : 'px-tab-idle')}>{t.label}</div>
        ))}
        <div style={{ flex: 1 }} />
        {picked && (
          <span data-qc={QC_HOOKS.filter} className="px-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            filtered to #{picked.seq}
            <span className="px-link" role="button" tabIndex={0} data-qc={QC_HOOKS.clearFilter}
              onClick={() => setPick(null)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPick(null) } }}
              style={{ cursor: 'pointer' }}>clear</span>
          </span>
        )}
      </div>

      <div data-qc={QC_HOOKS.panel} data-qc-panel={tab}>
        {tab === 'coverage' && <CoverageTab requirements={requirements} reqError={reqError} reqLoading={reqLoading} entries={entries} pick={pick} setPick={setPick} />}
        {tab === 'compare' && <CompareTab swaps={swaps.data} loading={swaps.loading} error={swaps.error} pick={pick} />}
        {tab === 'loops' && <LoopsTab entries={entries} filtered={!!picked} />}
        {tab === 'checks' && <ChecksTab entries={entries} pick={pick} requirements={requirements} onOpen={openField} />}
        {tab === 'review' && <ReviewTab entries={entries} onOpen={openField} filtered={!!picked} />}
      </div>

      {/* The per-asset verdict is P5.3's drawer, opened OVER this step - not a second QC panel.
          It brings the Overlay primitive (escape, focus trap, scroll lock, close-on-navigation). */}
      {drawer && drawerEntry && (
        <AssetGateDrawer
          open
          artifact={drawerEntry.artifact}
          packetId={packetId}
          company={company}
          role={role}
          focusSection={drawer.section}
          result={drawerEntry.result}
          resultLoading={drawerEntry.resultLoading}
          resultError={drawerEntry.resultError}
          onResult={(fresh) => setResult(drawer.artifactId, fresh)}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  )
}
