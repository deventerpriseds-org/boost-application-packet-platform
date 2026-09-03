import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { Pill, toneColor } from '../shell.jsx'
import AssetGateDrawer, { ScoreParts } from './AssetGateDrawer.jsx'
import { assetLabel, checkLabel, fieldLabel, severityMeta, SEV_LABEL, fmtWhen, bandTone } from '../assetGate.js'
import {
  QC_HOOKS, RAIL_TABS, railGate, railGateMeta, railAttention, railCounts, railTotals, railBody,
  railHeadline, verdictLine, railVerdict, engineRows, countLink, coverageCards,
  requirementState, qcStepState, packetGate, loopsModel, notApplicableRows, rowsForRequirement,
  swapsForRequirement, swapAskWhy, swapUndo, listOwnersFromArtifacts, arr, errText,
  railChangeLog, undoAvailability, keepAvailability, revertOutcome, suggestScope, CHANGE_LOG_HEADLINE,
  railDecisions, DECISION_NOTE, severityFor, staleChecksNote,
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
      // THE SHIP GATE READS THESE TWO, AND THEY WERE NOT HERE. Without `artifactId`,
      // packetFailList's `if (!artifactId) continue` (qcRail.js:928) skipped EVERY entry, so the
      // Review & send step reported "Nothing blocks sending." on a packet the QC step, reading the
      // same payload in the same session, called "Blocked - 52 to fix, 1 never checked". That is a
      // gate FAILING OPEN: absent evidence rendered as permission, which is the one thing this rail
      // exists to prevent. `PacketBuilder.jsx:950` failed the same way and drew "not loaded" on
      // every asset badge forever.
      //
      // Fixed at the ONE producer rather than at the three consumers, per the repo rule that shared
      // logic belongs at the source everything funnels through - patching packetFailList alone would
      // have left the badges wrong and put a fourth consumer one commit away from the same bug.
      artifactId: a.id,
      type: a.type,
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
      // Frontend checks-wiring gap: a write route (generate/content/ai-edit/owner-edit/revert) can
      // report `checksStale: true` when it saved the text but could not recompute the gate in the
      // same request. `markStale`/`clearStale` below are the only writers of these two fields - the
      // fields are never derived from `c.data` because the GET /checks-result route this rail
      // already polls just reads the STORED gate row and carries no staleness signal of its own, so
      // a plain re-fetch after a write must not be read as proof the number is fresh again.
      stale: !!c.stale,
      staleError: c.staleError || null,
    }
  }), [list, checks, ins, rem])

  const setResult = useCallback((artifactId, fresh) => {
    // Deliberately does NOT touch stale/staleError: this fires after a plain GET /checks-result
    // re-read, which returns the last STORED gate and says nothing about whether it is fresh. Only
    // an actual recompute (clearStale, below) may resolve a stale mark.
    setChecks((m) => ({ ...m, [artifactId]: { ...(m[artifactId] || {}), loading: false, error: null, data: fresh } }))
  }, [])

  const markStale = useCallback((artifactId, error) => {
    setChecks((m) => ({ ...m, [artifactId]: { ...(m[artifactId] || { loading: false, error: null, data: null }), stale: true, staleError: error || null } }))
  }, [])

  const clearStale = useCallback((artifactId) => {
    setChecks((m) => ({ ...m, [artifactId]: { ...(m[artifactId] || { loading: false, error: null, data: null }), stale: false, staleError: null } }))
  }, [])

  return { entries, setResult, markStale, clearStale }
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
function CheckRow({ artifactId, row, onOpen, onGoToField }) {
  const m = severityMeta(row)
  const link = countLink(artifactId, row)
  // SPEC 4.8-11. `data-qc-sev` below carries the SEVERITY the list was ordered by, beside the raw
  // state and engine it is derived from. Without it the rendered order can only be checked against
  // state+engine - which is the very derivation D6 owns and the ordering defect got wrong - so a
  // sweep could read `fail, fail, warn` as correct while a reviewer fail sat above a warn. It is
  // read from the module (`severityFor`), never re-derived here.
  return (
    <div className="px-box-soft" data-qc={QC_HOOKS.check} data-qc-state={row.state} data-qc-engine={row.engine || 'deterministic'}
      data-qc-sev={severityFor(row) || ''}
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
              {/* The SECOND destination (owner decision, option B). The offender name above still
                  opens the drawer, which answers "what does the system know about this field";
                  this answers "what does it actually say" by landing on the draft itself, where
                  the sentence and its edit controls are. Additive on purpose - the existing route
                  is untouched, so nothing anyone already relies on changes. */}
              {onGoToField && (
                <span className="px-link" role="button" tabIndex={0}
                  data-qc={QC_HOOKS.goToField}
                  data-qc-artifact={l.artifact_id} data-qc-section={l.section_id}
                  onClick={() => onGoToField(l.artifact_id, l.section_id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGoToField(l.artifact_id, l.section_id) } }}
                  style={{ cursor: 'pointer', marginLeft: 8, fontSize: 11.5, whiteSpace: 'nowrap' }}>go to the draft -&gt;</span>
              )}
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
//
// SPEC 4.8-20 + 4.8-21 - `Undo this` and `Ask why`, the prototype's PAIR, in the last column. Both
// SEED the assistant panel and send nothing; the sentence, the artifact each binds to and every
// reason either may be absent are `swapUndo` / `swapAskWhy` in qcRail.js, so this file still
// computes nothing.
//
// THE COMMENT THAT USED TO BE HERE SAID `Undo this` "is NOT here and must not be, because there is
// no swap-revert route to call". The premise is still true - `appSwaps.ts` is GET-only and NOTHING
// here calls a mutation - but it was the wrong conclusion: it read a constraint on ONE
// implementation as the absence of the control, when the prototype's own `Undo this`
// (`docs/qc-evidence/qc/evidence.jsx:232`) is a seed, not a mutation, and calls the identical
// `onAsk(...)` its `Ask why` neighbour on `:233` does. The owner decided to keep both. What the
// no-dead-UI rule actually forbids is a control with no TARGET, and `swapUndo` returns null in every
// such case - no owning artifact, nothing named, or a `kept` row where no change was made.
function CompareTab({ swaps, loading, error, pick, owners, onAsk }) {
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
              {/* The last header is deliberately blank: the `Ask why` column is an action, and a
                  heading over it would read as a fifth fact about the swap. */}
              {['Original', 'Final', 'What happened', 'Why', ''].map((h) => (
                <th key={h || 'ask'} style={{ textAlign: 'left', fontSize: 11, color: 'var(--proto-ink2)', padding: '6px 8px', borderBottom: '1px solid var(--proto-rule-soft)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const ask = onAsk ? swapAskWhy(s, owners) : null
              const undo = onAsk ? swapUndo(s, owners) : null
              return (
              <tr key={s.id || (s.list + ':' + s.seq)}>
                <td style={{ fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--proto-rule-soft)' }}>{s.from_label || '-'}</td>
                <td style={{ fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--proto-rule-soft)' }}>{s.to_label || '-'}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--proto-rule-soft)' }}>
                  <Pill tone={s.action === 'dropped' ? 'red' : s.action === 'kept' ? 'panel' : 'accent'}>{s.action}</Pill>
                </td>
                <td style={{ fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--proto-rule-soft)' }}>
                  {s.verbatim_quote
                    ? <span>the posting says &quot;{s.verbatim_quote}&quot;</span>
                    : <span className="px-small">{s.driver === 'owner' ? 'you changed this yourself' : s.driver === 'unattributed' ? 'no line of the posting backs this change' : s.rationale || String(s.driver || '')}</span>}
                </td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--proto-rule-soft)', whiteSpace: 'nowrap' }}>
                  {/* Each rendered ONLY where its own request has an artifact to be about and a
                      label to name. `swapUndo` / `swapAskWhy` return null otherwise - a row whose
                      list no asset renders, or insertions that have not loaded - and a button that
                      opened a panel unable to send would be exactly the control-with-no-target this
                      column refuses. The two absences are NOT the same: on a `kept` row `Undo this`
                      goes and `Ask why` stays, because nothing was changed to undo but why it was
                      left alone is still a real question. */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    {undo && (
                      <button className="px-btn" data-qc={QC_HOOKS.undoSwap} data-qc-artifact={undo.artifactId}
                        data-qc-action={s.action || ''} style={{ fontSize: 11 }}
                        onClick={() => onAsk(undo.text, undo.artifactId)}>Undo this</button>
                    )}
                    {ask && (
                      <button className="px-btn" data-qc={QC_HOOKS.askWhy} data-qc-artifact={ask.artifactId}
                        style={{ fontSize: 11 }}
                        onClick={() => onAsk(ask.text, ask.artifactId)}>Ask why</button>
                    )}
                  </div>
                </td>
              </tr>
              )
            })}
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
function ChecksTab({ entries, pick, requirements, onOpen, onGoToField }) {
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
            {staleChecksNote(e) && (
              <div className="px-note" data-qc={QC_HOOKS.staleChecks} data-qc-artifact={e.artifact.id} style={{ marginBottom: 8 }}>
                {staleChecksNote(e)}
              </div>
            )}
            {!e.resultError && !rows.length && (
              <Quiet>{e.resultLoading
                ? 'Reading the findings for this asset...'
                : pickedSeq == null
                  ? 'No check rows were recorded for this asset.'
                  : 'No finding on this asset names the requirement you picked.'}</Quiet>
            )}
            {rows.map((r, i) => <CheckRow key={r.check_key + ':' + i} artifactId={e.artifact.id} row={r} onOpen={onOpen} onGoToField={onGoToField} />)}
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
function ReviewTab({ entries, onOpen, filtered, onGoToField }) {
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
              ? rows.map((r, i) => <CheckRow key={r.check_key + ':' + i} artifactId={e.artifact.id} row={r} onOpen={onOpen} onGoToField={onGoToField} />)
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
export function CorrectionRow({ row, artifactId, onOpen, onUndid, busy, setBusy, inField = false, onStaleSignal = null }) {
  const [refusal, setRefusal] = useState(null)
  const [askOpen, setAskOpen] = useState(false)
  const [ask, setAsk] = useState('')
  const undo = undoAvailability(row)
  // SPEC 4.11-7's `Keep`. It never can be, and the module says why - see keepAvailability.
  const keep = keepAvailability(row)
  const scope = suggestScope(row)
  const mine = busy && busy.key === row.key
  const canSend = ask.trim().length > 0

  const doUndo = async () => {
    setBusy({ key: row.key, what: 'undo' }); setRefusal(null)
    try {
      // The server's answer decides, on `ok` alone - a correction can revert a field back to the
      // empty string, so branching on the returned text would report a phantom refusal.
      const res = await api.revertCorrection(row.id)
      // `revertCorrection` is one of the routes that can save the revert but fail to recompute the
      // gate in the same request (`checksStale`). That is orthogonal to `revertOutcome`'s ok/refused
      // read of the SAME response - a revert can be both accepted and stale - so both are read off
      // one fetch rather than two.
      if (onStaleSignal) onStaleSignal(!!res.checksStale, res.checksError)
      const outcome = revertOutcome(res)
      if (!outcome.ok) { setRefusal(outcome.reason); return }
      await onUndid()
    } catch (e) {
      // A thrown error still carries the server's own body through postDetailed. It is a refusal
      // with a reason, not a generic failure, and it is shown as one.
      setRefusal(revertOutcome((e && e.body) || { reason: errText(e) }).reason)
    } finally { setBusy(null) }
  }

  // SPEC 4.11-7's `Re-run QC`, on the row that records a change.
  //
  // A REAL ROUTE, not a seed: `api.runArtifactChecks` is the same call the gate drawer's footer
  // makes (`AssetGateDrawer.jsx` GATE_HOOKS.runChecks), and it is followed by the same re-read every
  // other action on this row ends with, so the gate, the counts and this log describe one moment.
  // Reaching it previously meant opening the drawer; the prototype puts it on the change itself,
  // which is where a reader who has just undone something is standing.
  const doRerun = async () => {
    setBusy({ key: row.key, what: 'rerun' }); setRefusal(null)
    try {
      await api.runArtifactChecks(artifactId)
      // `checks` is a genuine, deterministic recompute (runChecks(), not a save-plus-attempt), so a
      // successful call here is the one action allowed to CLEAR a stale mark rather than only set one.
      if (onStaleSignal) onStaleSignal(false)
      await onUndid()
    } catch (e) { setRefusal(errText(e)) } finally { setBusy(null) }
  }

  const doAsk = async () => {
    setBusy({ key: row.key, what: 'ask' }); setRefusal(null)
    try {
      const res = await api.aiEditArtifact(artifactId, { instruction: ask.trim(), section: row.merge_field })
      if (onStaleSignal) onStaleSignal(!!res.checksStale, res.checksError)
      setAsk(''); setAskOpen(false)
      await onUndid()
    } catch (e) { setRefusal(errText(e)) } finally { setBusy(null) }
  }

  return (
    <div className="px-box-soft" data-qc={QC_HOOKS.correction} data-qc-field={row.merge_field}
      data-qc-state={row.undone ? 'undone' : 'corrected'} data-qc-seq={row.seqKnown ? row.seq : ''}
      style={{ padding: 10, marginBottom: 8, borderLeft: '3px solid ' + toneColor(row.undone ? 'panel' : 'accent') }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* THE STATE WORD IS THE SENTENCE'S OWN PREFIX, and it is not repeated beside it.
            correctionSentence() always opens with `Corrected: ` or `Undone: ` - R1 guards exactly
            that - so a separate bold label restated it in BOTH states. It shipped for one deploy
            reading "Corrected for you Corrected: "15" rewritten as..." under a section header that
            already said CORRECTED FOR YOU: the same word three times in two lines. Caught by
            looking at the live screenshot, not by a test.

            What the deleted label was FOR still holds and is still satisfied. Measured in
            test/browser/run-qc-rail.mjs: of the nine px-pill tones, eight fall below 4.5:1 in at
            least one theme - `accent` is 2.90:1 dark, `panel` 4.04:1 dark / 4.28:1 light, the two
            this row would have used. So the state must be carried by a WORD in primary ink rather
            than by a pill, and the colour must stay a secondary rule. The sentence's own prefix is
            that word, in that ink. Dropping the duplicate costs the reader nothing; what would cost
            them is dropping the prefix, which is why R1 guards it and this does not touch it. */}
        <span data-qc-part="sentence" style={{ fontSize: 13, flex: 1, minWidth: 180, color: 'var(--proto-ink)' }}>{row.sentence}</span>
        {/* Rendered INSIDE the field it corrects (AssetBlocks' margin), the field name and the
            "Open <field>" button are both restatements of where the reader already is. The row is
            otherwise identical - same wording, same affordances, same module-owned model - because
            two renderings of one correction is exactly the divergence this component exists to
            prevent. */}
        {/* The field name stays on the row as its own mono tag, which is why the button beside it
            can be the prototype's bare 'Review →' without the reader losing WHERE it goes. Dropping
            this tag and the button's words together is what would leave an unlabelled arrow. */}
        {!inField && (
          <span className="px-small" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{row.merge_field}</span>
        )}
        {!inField && artifactId && row.merge_field && (
          <button type="button" className="px-btn" data-qc={QC_HOOKS.correctionOpen}
            data-qc-artifact={artifactId} data-qc-section={row.merge_field}
            onClick={() => onOpen(artifactId, row.merge_field)}
            style={{ fontSize: 12, padding: '1px 8px' }}>Review →</button>
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
          style={{ fontSize: 12 }}>Change it</button>
        {/* SPEC 4.11-7's third control. Rendered only where there is an artifact to run the checks
            FOR - the in-field variant is mounted with one, but a row with none has no request to
            make and gets no button. */}
        {artifactId && (
          <button type="button" className="px-btn" data-qc={QC_HOOKS.correctionRerun}
            data-qc-artifact={artifactId} onClick={doRerun} disabled={!!busy}
            style={{ fontSize: 12 }}>{mine && busy.what === 'rerun' ? 'Re-running...' : 'Re-run QC'}</button>
        )}
      </div>
      {/* SPEC 4.11-7's FIRST control, and the reason it is a sentence rather than a button. A
          correction is applied before the reader ever sees it, so there is no pending state for a
          `Keep` to move: the button would send nothing and record nothing. The rule is the repo's -
          a control with nothing to act on must not render, and the reason renders in its place. */}
      <div className="px-small" data-qc={QC_HOOKS.correctionKeepNote} data-qc-available="0"
        style={{ marginTop: 4 }}>{keep.reason}</div>
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
function ChangeLog({ entries, onOpen, onRefresh, onStaleSignal = null }) {
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
                  busy={busy} setBusy={setBusy} onUndid={() => onRefresh(entry.artifact.id)}
                  onStaleSignal={onStaleSignal ? (stale, error) => onStaleSignal(entry.artifact.id, stale, error) : null} />
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

/**
 * SPEC 4.8-10 - "Needs a decision", the change log's sibling, ON THE PAGE.
 *
 * It renders railDecisions() and decides NOTHING itself: no severity, no count, no ordering. Those
 * all come from the module, for the reason the whole file split exists - a count bug shipped from a
 * .jsx that did its own arithmetic, and the test that greps this file for that arithmetic is what
 * keeps it from coming back.
 *
 * The row treatment is CheckRow, the same component the Checks tab uses, so a finding looks and
 * behaves identically wherever it is read, including its Open field link.
 */
function Decisions({ entries, onOpen, onGoToField }) {
  const model = railDecisions(entries)
  return (
    <div className="px-box" data-qc={QC_HOOKS.decisions} style={{ padding: 16 }}>
      <Head title="Needs a decision"
        note="What the run could not settle on its own. Every one of these is waiting on you."
        right={<span className="px-small" data-qc={QC_HOOKS.decisionCount} data-qc-n={model.rows}>
          {model.toFix} to fix &middot; {model.toReview} to review
        </span>} />
      {model.assets.map((a) => (
        <div key={a.artifact && a.artifact.id} data-qc={QC_HOOKS.decisionAsset}
          data-qc-artifact={a.artifact && a.artifact.id} data-qc-state={a.status} style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{a.label}</div>
          {/* An asset whose findings could not be READ is named rather than dropped: an omitted
              asset reads as "nothing to decide" for it, which is the same laundering as calling an
              unchecked asset clear. */}
          {a.status === 'error' && (
            <div className="px-note" data-qc={QC_HOOKS.decisionError} style={{ marginTop: 4 }}>
              The findings for this asset could not be read: {a.error}. Nothing here is a statement
              that it is clear.
            </div>
          )}
          {a.status !== 'error' && a.status !== 'open' && (
            <Quiet hook={QC_HOOKS.decisionNote}>{DECISION_NOTE[a.status]}</Quiet>
          )}
          {a.rows.map((d, i) => (
            <CheckRow key={d.row.check_key + ':' + i} artifactId={a.artifact && a.artifact.id}
              row={d.row} onOpen={onOpen} onGoToField={onGoToField} />
          ))}
          {a.anomalies.map((x, i) => (
            <div key={i} className="px-note" data-qc={QC_HOOKS.decisionAnomaly} style={{ marginTop: 6 }}>{x}</div>
          ))}
        </div>
      ))}
      {/* The two empties are DIFFERENT statements and the distinction is the point. "Nothing needs a
          decision" over a packet nobody checked is this feature's vacuous green. */}
      {!model.anyOpen && (
        <div className="px-small" data-qc={QC_HOOKS.decisionNote} style={{ marginTop: 10 }}>
          {model.anyChecked
            ? 'Nothing is waiting on you. Every check that could run is clear.'
            : 'No asset in this packet has been checked yet, so nothing has been decided either way.'}
        </div>
      )}
    </div>
  )
}

// ── the rail ────────────────────────────────────────────────────────────────────────────────────

export default function QcRail({ packetId, company, role, entries, setResult, markStale = null, clearStale = null, requirements, reqError, reqLoading = false, onGoToField, onSeedAssistant = null }) {
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

  // SPEC 4.8-21. The SAME `list -> artifact` map 4.1-20 derives, from the same `entries`, rather
  // than a second one built for this button: a swap row carries no artifact and the assistant seed
  // requires one, which is precisely the hop `listOwnersFromArtifacts` already exists to make.
  const listOwners = useMemo(() => listOwnersFromArtifacts(entries), [entries])

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
                  {headline.band && <Pill tone={bandTone(headline.band)}>{String(headline.band).replace(/_/g, ' ')}</Pill>}
                </div>
              : <div className="px-small">{headline.why}</div>}
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* The SAME component the drawer's Match tab renders, in its compact variant. This
                block and that one used to be two copies of one thing. */}
            <ScoreParts parts={headline.parts} variant="rail" hook={QC_HOOKS.component} />
          </div>
        </div>
      </div>

      {/* The change log, ON THE PAGE (SPEC 4.8) - not behind a tab and not behind a search. What the
          run settled by itself is the first thing a reader should see, because R1's whole claim is
          that they are reviewing finished work rather than a list of chores. */}
      <ChangeLog entries={entries} onOpen={openField} onRefresh={refreshOne}
        onStaleSignal={(artifactId, stale, error) => {
          if (!markStale || !clearStale) return
          if (stale) markStale(artifactId, error); else clearStale(artifactId)
        }} />

      {/* SPEC 4.8-10, the other half of the same sentence: "the two lists are on the page, not
          behind a tab or a search". The change log is what the run SETTLED; this is what it could
          not, and it sits beside it rather than inside the Checks tab. */}
      <Decisions entries={entries} onOpen={openField} onGoToField={onGoToField} />

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
        {tab === 'compare' && <CompareTab swaps={swaps.data} loading={swaps.loading} error={swaps.error} pick={pick}
          owners={listOwners} onAsk={onSeedAssistant} />}
        {tab === 'loops' && <LoopsTab entries={entries} filtered={!!picked} />}
        {tab === 'checks' && <ChecksTab entries={entries} pick={pick} requirements={requirements} onOpen={openField} onGoToField={onGoToField} />}
        {tab === 'review' && <ReviewTab entries={entries} onOpen={openField} filtered={!!picked} onGoToField={onGoToField} />}
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
