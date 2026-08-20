// P5.2 — asset blocks with provenance.
//
// One card per MERGE FIELD of the asset, formatted the way the document formats it, with the
// provenance for that field in the margin beside it. This replaces the collapsed `content` string:
// a wall of text cannot say which part of it was written for this posting and which part is
// template boilerplate, and that distinction is the entire point of the screen.
//
// EVERYTHING RENDERED HERE IS SOURCED FROM AN API ROW. Nothing is computed from an assumption:
//   GET /app/artifact/{id}/insertions   -> one row per merge field: generated, before_text,
//                                          after_text, method, loop, list, item_count,
//                                          requirement_id, verbatim_quote, requirement_verbatim,
//                                          plus filled / unfilled / attributed for the whole asset.
//   GET /app/packet/{id}/swaps          -> skill_candidate + swap_decision: action, driver,
//                                          from_label, to_label, verbatim_quote, rationale.
//   GET /app/opportunity/{id}/requirements -> the posting's requirement rows (seq, kind, verbatim).
//
// EVERY COUNT PRINTED HERE COMES OFF THE ROW, not off a re-measurement of the row's text. The
// derivation lives in ../assetBlocks.js so `node --test` can hold it to that; this file is the
// rendering only. See that module's header for why the browser is not allowed to supply a count.
//
// A count with no source is NOT rendered as a zero. `term_library_entry` has no published scoreable
// rows (appChecks.ts leaves keyword_coverage null for exactly this reason) and there is no per-asset
// term-placement endpoint, so the meter STATES that library-term placement is unknown rather than
// omitting the stat — an omitted stat and a measured zero read the same to a reader.
//
// A merge field the pipeline could not fill still gets a card, dashed and marked
// "static template - not generated". `generated: false` is the API's own word for it. A block that
// was not changed has to SAY so; looking generated is the failure this screen exists to prevent.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import {
  BLOCK_HOOKS, KIND_ABBR, KIND_WORD, METHOD_LABEL,
  countMismatchNote, deriveItems, draftSizeText, expectationFor, latestRows, listBodyModel, listsOf,
  meterModel, reqsForRow, scopeSwaps, shapeOf, sharedSourceNote, statPct, wordCount,
} from '../assetBlocks.js'
import { HIGHLIGHT_CLASS } from '../highlight.js'

export { BLOCK_HOOKS }

// ── shared provenance loader ────────────────────────────────────────────────────────────────────

/**
 * Requirements and swaps belong to the OPPORTUNITY and the PACKET, not to one artifact. Loading
 * them once here — rather than inside each card — is what keeps the resume and the compact resume
 * (two artifacts, one packet, byte-identical merge fields) describing the same posting instead of
 * issuing the same two requests twice and drifting if one fails.
 */
export function useAssetProvenance(oppId, packetId) {
  const [state, setState] = useState({ loading: true, requirements: null, swaps: null })
  useEffect(() => {
    let live = true
    setState({ loading: true, requirements: null, swaps: null })
    Promise.all([
      oppId ? api.oppRequirements(oppId).catch(() => null) : Promise.resolve(null),
      packetId ? api.packetSwaps(packetId).catch(() => null) : Promise.resolve(null),
    ]).then(([requirements, swaps]) => {
      if (!live) return
      setState({
        loading: false,
        requirements: requirements && !requirements.error ? requirements : null,
        swaps: swaps && !swaps.error ? swaps : null,
      })
    })
    return () => { live = false }
  }, [oppId, packetId])
  return state
}

// Width of the card itself, not of the window: whether the margin sits beside the text or under it
// depends on this column, which changes with the layout around it.
function useWideRef(min = 700) {
  const ref = useRef(null)
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWide(e.contentRect.width >= min)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [min])
  return [ref, wide]
}

// ── small pieces ────────────────────────────────────────────────────────────────────────────────

function ReqChip({ req }) {
  if (!req) return null
  const abbr = KIND_ABBR[req.kind] || '?'
  const n = Number.isFinite(Number(req.seq)) ? Number(req.seq) + 1 : null
  return (
    <span className="px-chip" title={`${KIND_WORD[req.kind] || req.kind || 'requirement'} - ${req.item_text || ''}`}
      style={{ background: 'var(--proto-accent-soft)', color: 'var(--text-brand)', fontWeight: 600 }}>
      {abbr}{n === null ? '' : n}
    </span>
  )
}

// The posting's own words. Rendered as a quote and never paraphrased — an attribution the reader
// cannot check against the ad is not an attribution.
function Verbatim({ text }) {
  if (!text) return null
  // The POSTING ECHO highlight (D11): a pale wash under a rule, painted through the shared .qc-echo
  // class. It is deliberately a different KIND of treatment from the keyword highlight - a filled
  // highlighter - so the two cannot be confused by a reader who cannot separate the two hues.
  return (
    <div className="px-small" data-qc={BLOCK_HOOKS.quote}
      style={{ marginTop: 6, textTransform: 'none', fontStyle: 'italic', lineHeight: 1.5, color: 'var(--proto-ink2)' }}>
      Posting says: <span className={HIGHLIGHT_CLASS.postingEcho}>&quot;{text}&quot;</span>
    </div>
  )
}

// A statement the card makes about itself that its own source contradicts. Shown, never resolved
// in the browser's favour.
function CountMismatch({ note }) {
  if (!note) return null
  return (
    <div className="px-note" data-qc={BLOCK_HOOKS.mismatch} style={{ marginTop: 8, borderColor: 'var(--proto-yellow, var(--proto-rule-soft))' }}>
      <div className="px-small" style={{ textTransform: 'none', lineHeight: 1.5 }}>{note}</div>
    </div>
  )
}

function Stat({ label, n, d, sub }) {
  const pct = statPct(n, d)
  const all = d > 0 && n === d
  return (
    <div data-qc={BLOCK_HOOKS.stat} data-qc-stat={label} style={{ minWidth: 150, flex: '1 1 150px' }}>
      <div className="px-label">{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '2px 0 5px' }}>
        <b style={{ fontSize: 18, lineHeight: 1, color: all ? 'var(--proto-green)' : 'var(--text-brand)' }}>{n}</b>
        <span style={{ fontSize: 12, color: 'var(--proto-ink3)' }}>of {d}</span>
      </div>
      <div className="px-bar"><i style={{ width: `${pct}%`, background: all ? 'var(--proto-green)' : 'var(--surface-brand-default)' }} /></div>
      <div className="px-small" style={{ textTransform: 'none', marginTop: 4 }}>{sub}</div>
    </div>
  )
}

/**
 * The distribution meter. Every stat here has a denominator that came out of an API response; a
 * stat whose source is missing is not shown as 0 of 0 — it is stated as unknown in the notes
 * underneath, so "nothing was placed" and "nothing was measured" cannot be confused.
 */
function DistributionMeter({ rows, filled, unfilled, requirements, scopedSwaps, terms }) {
  const { stats, notes } = meterModel({ rows, filled, unfilled, requirements, scopedSwaps, terms })
  if (!stats.length && !notes.length) return null

  return (
    <div className="px-box" data-qc={BLOCK_HOOKS.meter} style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>What is in this asset</div>
      {stats.length > 0 && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {stats.map((s) => <Stat key={s.key} label={s.label} n={s.n} d={s.d} sub={s.sub} />)}
        </div>
      )}
      {notes.map((n, i) => (
        <div key={i} className="px-small" data-qc={BLOCK_HOOKS.note} style={{ textTransform: 'none' }}>{n}</div>
      ))}
    </div>
  )
}

// ── one merge field ─────────────────────────────────────────────────────────────────────────────

function ListBody({ row, swapsForList, artifactId, listOwners }) {
  const model = listBodyModel(row, swapsForList, { artifactId, listOwners })
  return (
    <div>
      {model.lines.map((line, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'baseline',
          padding: '6px 0', borderBottom: '1px solid var(--proto-rule-soft)',
        }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, minWidth: 0 }}>
            {line.from && (
              <span style={{ color: 'var(--proto-ink3)' }}>
                {line.from} <span style={{ padding: '0 4px' }}>&rarr;</span>
              </span>
            )}
            <span style={{ fontWeight: line.from ? 600 : 400 }}>{line.text}</span>
          </div>
          {/* The status and the packet-level marker stack rather than run on, so the column stays
              as narrow as its longest token on a phone. */}
          <span className="px-small" style={{ textAlign: 'right' }}
            title={line.sharedSource ? 'packet-level decision - recorded once for the whole packet' : undefined}>
            <span style={{ whiteSpace: 'nowrap' }}>{line.status}</span>
            {line.sharedSource && (
              <span style={{ display: 'block', whiteSpace: 'nowrap', color: 'var(--proto-ink3)' }}>packet-level</span>
            )}
          </span>
        </div>
      ))}

      {/* Decision 9: swap_decision is keyed by PACKET, so this same row renders on every asset that
          renders this list. Saying so is what stops two cards reading as two separate changes. */}
      {model.sharedNote && (
        <div className="px-small" data-qc={BLOCK_HOOKS.shared} style={{ textTransform: 'none', lineHeight: 1.5, marginTop: 8, color: 'var(--proto-ink2)' }}>
          {model.sharedNote}
        </div>
      )}

      {model.dropped.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="px-label" style={{ marginBottom: 3 }}>Taken out of this list</div>
          {model.dropped.map((s, i) => (
            <div key={i} className="px-small" style={{ textTransform: 'none', lineHeight: 1.5 }}>
              <s>{s.from_label}</s>{s.rationale ? ` - ${s.rationale}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BlockBody({ row, shape, swapsForList, artifactId, listOwners }) {
  if (shape === 'static') {
    return (
      <div className="px-small" style={{ textTransform: 'none', lineHeight: 1.6 }}>
        No value reached this merge field, so the document keeps whatever the template already says
        here. The pipeline cannot see that text, so it is not shown as a draft.
      </div>
    )
  }
  if (shape === 'list') return <ListBody row={row} swapsForList={swapsForList} artifactId={artifactId} listOwners={listOwners} />
  if (shape === 'pipe') {
    return (
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.9, wordBreak: 'break-word', whiteSpace: 'pre-line' }}>
        {row.after_text}
      </div>
    )
  }
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.65, whiteSpace: 'pre-line' }}>{row.after_text}</div>
  )
}

function AssetBlock({ row, reqs, swapsForList, wide, artifactId, listOwners }) {
  const [showBefore, setShowBefore] = useState(false)
  const shape = shapeOf(row)
  const isStatic = shape === 'static'
  const expect = expectationFor(row.merge_field)
  // The ROW's count, not a re-split of its text. When the two disagree the card says so rather
  // than printing the browser's number over the one the checks were run against.
  const measured = deriveItems(row)
  const count = measured.count
  const countNote = countMismatchNote(measured.recorded, measured.splitCount)
  const words = wordCount(row.after_text)
  const sharedNote = swapsForList.length && shape !== 'list' ? sharedSourceNote(row.list, artifactId, listOwners) : null

  // The reason this block reads the way it does. For a list field the swap rows carry the pipeline's
  // own rationale; for every other field the reason is the attribution (or the honest absence of one).
  const rationales = [...new Set(swapsForList.filter((s) => s.rationale && s.action !== 'kept').map((s) => s.rationale))]
  const firstSwapQuote = (swapsForList.find((s) => s.verbatim_quote) || {}).verbatim_quote || null
  const reason = isStatic
    ? 'Nothing was generated for this field, so nothing changed it.'
    : rationales.length
      ? null
      : reqs.length
        ? 'Written against the posting line cited above.'
        : 'No posting line matched this block, so nothing in the ad drove its wording.'

  const content = (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{row.merge_field}</span>
        {!isStatic && (
          <span className="px-small">
            {count > 1 ? `${count} lines - ` : ''}{words} words
          </span>
        )}
        {expect && (
          <span className="px-small" style={{ textTransform: 'none' }}>
            field name asks for {expect.bullets ? `${expect.bullets} bullets` : ''}{expect.bullets && expect.words ? ' - ' : ''}{expect.words ? `${expect.words} words` : ''}
            {isStatic ? '' : ` - this draft has ${draftSizeText(row, expect)}`}
          </span>
        )}
      </div>

      <BlockBody row={row} shape={shape} swapsForList={swapsForList} artifactId={artifactId} listOwners={listOwners} />

      <CountMismatch note={countNote} />

      {sharedNote && (
        <div className="px-small" data-qc={BLOCK_HOOKS.shared} style={{ textTransform: 'none', lineHeight: 1.5, marginTop: 8, color: 'var(--proto-ink2)' }}>
          {sharedNote}
        </div>
      )}

      {showBefore && row.before_text && (
        <div className="px-note" data-qc={BLOCK_HOOKS.before} style={{ marginTop: 9 }}>
          <div className="px-label" style={{ color: 'var(--text-info)', marginBottom: 3 }}>Original - before this posting</div>
          <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{row.before_text}</div>
        </div>
      )}

      {row.before_text && (
        <div style={{ marginTop: 8 }}>
          <span className="px-link" data-qc={BLOCK_HOOKS.compareToggle} data-qc-open={showBefore ? '1' : '0'}
            style={{ fontSize: 11.5 }} onClick={() => setShowBefore((v) => !v)}>
            {showBefore ? 'Hide original' : 'Compare with original'}
          </span>
        </div>
      )}
    </div>
  )

  const margin = (
    <div style={{
      minWidth: 0,
      borderLeft: wide ? '1px solid var(--proto-rule-soft)' : 'none',
      borderTop: wide ? 'none' : '1px solid var(--proto-rule-soft)',
      paddingLeft: wide ? 14 : 0, paddingTop: wide ? 0 : 10,
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {isStatic
          ? <span className="px-small" style={{ fontWeight: 700, color: 'var(--proto-ink2)' }}>static template · not generated</span>
          : <span className="px-small" style={{ fontWeight: 700, color: 'var(--text-brand)' }}>{METHOD_LABEL[row.method] || row.method}</span>}
        <span className="px-small">loop {row.loop}</span>
      </div>

      {reqs.length > 0 && (
        <div style={{ marginTop: 9 }}>
          <div className="px-label" style={{ marginBottom: 4 }}>
            {reqs.length === 1 ? 'Posting line answered' : 'Posting lines answered'}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {reqs.map((r) => <ReqChip key={r.id} req={r} />)}
          </div>
        </div>
      )}

      {rationales.length > 0 && (
        <div style={{ marginTop: 9 }}>
          <div className="px-label" style={{ marginBottom: 4 }}>Why it changed</div>
          {rationales.map((r, i) => (
            <div key={i} style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--proto-ink2)', marginTop: i ? 4 : 0 }}>{r}</div>
          ))}
          <div className="px-small" style={{ textTransform: 'none', marginTop: 4 }}>
            recorded against the packet, not this asset alone
          </div>
        </div>
      )}

      {reason && (
        <div style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 9, color: 'var(--proto-ink2)' }}>{reason}</div>
      )}

      {/* The posting's own line. `requirement_verbatim` is the joined requirement row;
          `verbatim_quote` is the quote the attribution stored at write time; a swap row carries its
          own. Whichever exists, it is text the employer wrote — never a paraphrase of it. */}
      <Verbatim text={row.requirement_verbatim || row.verbatim_quote || (reqs[0] && reqs[0].verbatim) || firstSwapQuote} />
    </div>
  )

  return (
    <div className={isStatic ? 'px-dashed' : 'px-box'}
      data-qc={BLOCK_HOOKS.field} data-qc-field={row.merge_field} data-qc-static={isStatic ? '1' : '0'}
      style={{
      padding: 14, display: 'grid', gridTemplateColumns: wide ? 'minmax(0,1fr) 250px' : '1fr', gap: 16,
      background: isStatic ? 'var(--proto-panel)' : 'var(--proto-paper)',
    }}>
      {content}{margin}
    </div>
  )
}

// ── the asset ───────────────────────────────────────────────────────────────────────────────────

/**
 * Every merge field of one artifact, plus the meter above them.
 *
 * `fallback` is the artifact's stored content string. It is rendered only when the artifact has no
 * insertion rows at all — a draft written before P1.4, or a type with no template (the intro video
 * has no merge fields). Showing the old dump beats showing an empty screen, and it says which it is.
 *
 * `listOwners` / `onListsRendered` are how a card learns that another asset in the same packet
 * renders the same list, so a packet-level swap can name the assets it is shared with instead of
 * appearing twice as two separate changes. Both are optional: without them a shared swap still says
 * it is packet-level, it just cannot name the sibling.
 */
export default function AssetBlocks({ artifact, provenance, fallback, defaultOpen = true, label, listOwners, onListsRendered }) {
  const [open, setOpen] = useState(defaultOpen)
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const [ref, wide] = useWideRef(700)

  useEffect(() => {
    let live = true
    setState({ loading: true, error: null, data: null })
    api.artifactInsertions(artifact.id)
      .then((d) => { if (live) setState({ loading: false, error: d && d.error ? String(d.error) : null, data: d && d.error ? null : d }) })
      .catch((e) => { if (live) setState({ loading: false, error: String(e.message || e), data: null }) })
    return () => { live = false }
  }, [artifact.id])

  const reqById = useMemo(() => {
    const m = new Map()
    for (const r of (provenance && provenance.requirements && provenance.requirements.requirements) || []) m.set(r.id, r)
    return m
  }, [provenance])

  const allSwaps = (provenance && provenance.swaps && provenance.swaps.swaps) || []

  const rows = useMemo(() => latestRows(state.data), [state.data])

  const listsInAsset = useMemo(() => listsOf(rows), [rows])
  const scopedSwaps = useMemo(() => scopeSwaps(allSwaps, listsInAsset), [allSwaps, listsInAsset])

  // Report which lists this asset renders, so sibling cards can say a swap is shared with it. Keyed
  // on the sorted list names so an unchanged set never re-fires.
  const listsKey = useMemo(() => Array.from(listsInAsset).sort().join(','), [listsInAsset])
  useEffect(() => {
    if (!onListsRendered) return
    onListsRendered(artifact.id, label || artifact.type, listsKey ? listsKey.split(',') : [])
  }, [artifact.id, artifact.type, label, listsKey, onListsRendered])

  if (state.loading) return <div className="px-small">Loading blocks...</div>

  if (!rows.length) {
    if (!fallback) {
      return (
        <div className="px-small" data-qc={BLOCK_HOOKS.empty} style={{ textTransform: 'none' }}>
          {state.error
            ? `Block provenance could not be read for this asset (${state.error}).`
            : 'Nothing has been generated for this asset yet, so there are no blocks to show.'}
        </div>
      )
    }
    return (
      <div data-qc={BLOCK_HOOKS.fallback}>
        <div className="px-small" style={{ textTransform: 'none', marginBottom: 6 }}>
          {state.error
            ? `Block provenance could not be read (${state.error}) - showing the stored draft.`
            : 'This draft has no per-field record, so it is shown as it was stored.'}
        </div>
        <div className="px-box" style={{ padding: 10, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', background: 'var(--proto-panel)' }}>
          {fallback}
        </div>
      </div>
    )
  }

  return (
    <div ref={ref} data-qc={BLOCK_HOOKS.root} data-qc-open={open ? '1' : '0'}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>
          {rows.length} merge {rows.length === 1 ? 'field' : 'fields'}
        </div>
        <span className="px-link" data-qc={BLOCK_HOOKS.toggle} data-qc-open={open ? '1' : '0'}
          style={{ fontSize: 11.5 }} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide blocks' : 'Show blocks'}
        </span>
      </div>

      {open && (
        <>
          <DistributionMeter
            rows={rows}
            filled={Number(state.data.filled) || 0}
            unfilled={Number(state.data.unfilled) || 0}
            requirements={provenance && provenance.requirements}
            scopedSwaps={scopedSwaps}
            terms={null}
          />
          {rows.map((r) => (
            <AssetBlock
              key={`${r.merge_field}-${r.loop}`}
              row={r}
              reqs={reqsForRow(r, scopedSwaps, reqById)}
              swapsForList={r.list ? scopedSwaps.filter((s) => s.list === r.list) : []}
              wide={wide}
              artifactId={artifact.id}
              listOwners={listOwners}
            />
          ))}
        </>
      )}
    </div>
  )
}
