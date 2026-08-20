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
// A count with no source is NOT rendered. Library-term placement has no per-asset endpoint and
// `term_library_entry` has no published scoreable rows (appChecks.ts leaves keyword_coverage null
// for exactly this reason), so the meter omits a terms stat rather than printing a zero that reads
// like a measurement.
//
// A merge field the pipeline could not fill still gets a card, dashed and marked
// "static template - not generated". `generated: false` is the API's own word for it. A block that
// was not changed has to SAY so; looking generated is the failure this screen exists to prevent.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'

// ── text shaping ────────────────────────────────────────────────────────────────────────────────

// Mirrors splitItems() in api/src/functions/tests/swaps.ts exactly. If this split disagreed with
// the one that produced `item_count`, a block would show a different number of lines than its own
// row claims, and the row is what the checks were run against.
export function splitItems(block) {
  const s = block == null ? '' : String(block).trim()
  if (!s) return []
  return s
    .split(/\r?\n|(?:\s*[|•·]\s*)/)
    .map((l) => l.replace(/^[-*•·\s]+/, '').trim())
    .filter(Boolean)
}

const wordCount = (s) => (String(s || '').trim().match(/\S+/g) || []).length

// Loose comparison used ONLY to line a document item up with the swap row that produced it. It
// never decides anything: a miss just means the item renders without its arrow.
const normLabel = (s) => String(s || '').toLowerCase().replace(/[.;:,]+$/, '').replace(/\s+/g, ' ').trim()

/**
 * How the document lays this field out, derived from the row rather than from a field-name list:
 *  - `list`  — the row names a skill_candidate list, or its text splits into more than one item.
 *  - `pipe`  — a single line of pipe-separated terms; the document prints it as an ATS run.
 *  - `prose` — everything else.
 * A field-name allow-list would go stale the moment a template gains a placeholder.
 */
export function shapeOf(row) {
  if (!row.generated) return 'static'
  const text = row.after_text || ''
  const pipes = (text.match(/\s\|\s/g) || []).length
  if (!/\r?\n/.test(text) && pipes >= 2) return 'pipe'
  if (row.list || splitItems(text).length > 1) return 'list'
  return 'prose'
}

/**
 * The portfolio and cover merge fields carry their own size expectation in their NAME
 * (`@AboutMe1_50words`, `@CoreAccomplishments_5blts_180words`). That name is the only place the
 * expectation exists — no API field carries it — so it is read off the field and attributed to the
 * field, never presented as an independent measurement.
 */
export function expectationFor(field) {
  const w = /(\d+)\s*words/i.exec(field || '')
  const b = /(\d+)\s*blts?/i.exec(field || '')
  if (!w && !b) return null
  return { words: w ? Number(w[1]) : null, bullets: b ? Number(b[1]) : null }
}

const KIND_ABBR = { must_have: 'M', nice_to_have: 'N', responsibility: 'R' }
const KIND_WORD = { must_have: 'must-have', nice_to_have: 'nice-to-have', responsibility: 'responsibility' }

// How the row's own `method` reads in plain language. `manual` is never inferred by the pipeline —
// it exists so a human edit can be told apart from a model rewrite, and it is shown as what it is.
const METHOD_LABEL = {
  template_fill: 'written for this posting',
  model_rewrite: 'rewritten by a later pass',
  manual: 'edited by hand',
}

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
  return (
    <div className="px-small" style={{ marginTop: 6, textTransform: 'none', fontStyle: 'italic', lineHeight: 1.5, color: 'var(--proto-ink2)' }}>
      Posting says: &quot;{text}&quot;
    </div>
  )
}

function Stat({ label, n, d, sub }) {
  const pct = d > 0 ? Math.round((n / d) * 100) : 0
  const all = d > 0 && n === d
  return (
    <div style={{ minWidth: 150, flex: '1 1 150px' }}>
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
 * stat whose source is missing is dropped from the row entirely rather than shown as 0 of 0.
 */
function DistributionMeter({ rows, filled, unfilled, requirements, scopedSwaps }) {
  const placedReqIds = new Set(rows.map((r) => r.requirement_id).filter(Boolean))
  const totalReqs = requirements && Number.isFinite(Number(requirements.total)) ? Number(requirements.total) : null
  const changed = scopedSwaps.filter((s) => s.action === 'swapped' || s.action === 'added')
  const postingDriven = changed.filter((s) => s.driver === 'posting')
  const fields = filled + unfilled

  const stats = []
  if (totalReqs !== null && totalReqs > 0) {
    stats.push(<Stat key="lines" label="Posting lines placed" n={placedReqIds.size} d={totalReqs} sub="requirement rows this asset cites" />)
  }
  if (changed.length > 0) {
    stats.push(<Stat key="driven" label="Changes the posting drove" n={postingDriven.length} d={changed.length} sub="list changes citing a posting line" />)
  }
  if (fields > 0) {
    stats.push(<Stat key="fields" label="Fields generated" n={filled} d={fields} sub={`${unfilled} static template ${unfilled === 1 ? 'field' : 'fields'}`} />)
  }
  if (!stats.length) return null

  return (
    <div className="px-box" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>What is in this asset</div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>{stats}</div>
      {totalReqs === null && (
        <div className="px-small" style={{ textTransform: 'none' }}>
          This posting has no requirement rows yet, so how much of it this asset answers is unknown - not zero.
        </div>
      )}
    </div>
  )
}

// ── one merge field ─────────────────────────────────────────────────────────────────────────────

function ListBody({ row, swapsForList }) {
  const items = splitItems(row.after_text)
  const byTo = new Map()
  for (const s of swapsForList) if (s.to_label) byTo.set(normLabel(s.to_label), s)
  const dropped = swapsForList.filter((s) => s.action === 'dropped' && s.from_label)
  return (
    <div>
      {items.map((item, i) => {
        const s = byTo.get(normLabel(item))
        const from = s && s.from_label && s.from_label !== s.to_label ? s.from_label : null
        return (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'baseline',
            padding: '6px 0', borderBottom: '1px solid var(--proto-rule-soft)',
          }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, minWidth: 0 }}>
              {from && (
                <span style={{ color: 'var(--proto-ink3)' }}>
                  {from} <span style={{ padding: '0 4px' }}>&rarr;</span>
                </span>
              )}
              <span style={{ fontWeight: from ? 600 : 400 }}>{item}</span>
            </div>
            <span className="px-small" style={{ whiteSpace: 'nowrap' }}>
              {s ? (s.action === 'kept' ? 'unchanged' : `${s.action} · ${s.driver}`) : ''}
            </span>
          </div>
        )
      })}
      {dropped.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="px-label" style={{ marginBottom: 3 }}>Taken out of this list</div>
          {dropped.map((s, i) => (
            <div key={i} className="px-small" style={{ textTransform: 'none', lineHeight: 1.5 }}>
              <s>{s.from_label}</s>{s.rationale ? ` - ${s.rationale}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BlockBody({ row, shape, swapsForList }) {
  if (shape === 'static') {
    return (
      <div className="px-small" style={{ textTransform: 'none', lineHeight: 1.6 }}>
        No value reached this merge field, so the document keeps whatever the template already says
        here. The pipeline cannot see that text, so it is not shown as a draft.
      </div>
    )
  }
  if (shape === 'list') return <ListBody row={row} swapsForList={swapsForList} />
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

function AssetBlock({ row, reqs, swapsForList, wide }) {
  const [showBefore, setShowBefore] = useState(false)
  const shape = shapeOf(row)
  const isStatic = shape === 'static'
  const expect = expectationFor(row.merge_field)
  const items = splitItems(row.after_text)
  const words = wordCount(row.after_text)

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
            {row.item_count > 1 ? `${row.item_count} lines - ` : ''}{words} words
          </span>
        )}
        {expect && (
          <span className="px-small" style={{ textTransform: 'none' }}>
            field name asks for {expect.bullets ? `${expect.bullets} bullets` : ''}{expect.bullets && expect.words ? ' - ' : ''}{expect.words ? `${expect.words} words` : ''}
            {isStatic ? '' : ` - this draft has ${expect.bullets ? `${items.length} bullets, ` : ''}${words} words`}
          </span>
        )}
      </div>

      <BlockBody row={row} shape={shape} swapsForList={swapsForList} />

      {showBefore && row.before_text && (
        <div className="px-note" style={{ marginTop: 9 }}>
          <div className="px-label" style={{ color: 'var(--text-info)', marginBottom: 3 }}>Original - before this posting</div>
          <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{row.before_text}</div>
        </div>
      )}

      {row.before_text && (
        <div style={{ marginTop: 8 }}>
          <span className="px-link" style={{ fontSize: 11.5 }} onClick={() => setShowBefore((v) => !v)}>
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
    <div className={isStatic ? 'px-dashed' : 'px-box'} style={{
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
 */
export default function AssetBlocks({ artifact, provenance, fallback, defaultOpen = true }) {
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

  const rows = useMemo(() => {
    const all = (state.data && state.data.insertions) || []
    if (!all.length) return []
    // The endpoint returns every loop; `loop` is the latest. Older loops are the history behind
    // `before_text`, not extra blocks to draw.
    const latest = Number(state.data.loop)
    return all.filter((r) => Number(r.loop) === latest)
  }, [state.data])

  // Swaps are recorded per PACKET and per list; `insertion.list` is what ties a list back to the
  // merge field that renders it, so only the lists this asset actually renders are in scope.
  const listsInAsset = useMemo(() => new Set(rows.map((r) => r.list).filter(Boolean)), [rows])
  const scopedSwaps = useMemo(() => allSwaps.filter((s) => listsInAsset.has(s.list)), [allSwaps, listsInAsset])

  // A block cites the requirement its own insertion row names, plus the requirements the swap rows
  // for the list it renders name. Both are stored requirement_ids — a chip is never derived from a
  // keyword match made in the browser.
  const reqsFor = (row) => {
    const ids = [row.requirement_id]
    if (row.list) for (const s of scopedSwaps) if (s.list === row.list && s.requirement_id) ids.push(s.requirement_id)
    const out = []
    const seen = new Set()
    for (const id of ids) {
      if (!id || seen.has(id)) continue
      seen.add(id)
      const r = reqById.get(id)
      if (r) out.push(r)
    }
    return out.sort((a, b) => Number(a.seq) - Number(b.seq))
  }

  if (state.loading) return <div className="px-small">Loading blocks...</div>

  if (!rows.length) {
    if (!fallback) {
      return (
        <div className="px-small" style={{ textTransform: 'none' }}>
          {state.error
            ? `Block provenance could not be read for this asset (${state.error}).`
            : 'Nothing has been generated for this asset yet, so there are no blocks to show.'}
        </div>
      )
    }
    return (
      <div>
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
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>
          {rows.length} merge {rows.length === 1 ? 'field' : 'fields'}
        </div>
        <span className="px-link" style={{ fontSize: 11.5 }} onClick={() => setOpen((v) => !v)}>
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
          />
          {rows.map((r) => (
            <AssetBlock
              key={`${r.merge_field}-${r.loop}`}
              row={r}
              reqs={reqsFor(r)}
              swapsForList={r.list ? scopedSwaps.filter((s) => s.list === r.list) : []}
              wide={wide}
            />
          ))}
        </>
      )}
    </div>
  )
}
