// The reader for model output that reached no document. Pure logic lives in `../packetAnalysis.js`.
//
// One component serves every home. `home="jd"` renders the JD summary and the Jobscan extraction on
// the posting step; `home="fields"` will render the length check beside the field blocks, and so on.
// Placing it per-home rather than building one Analysis page is the same rule the corrections follow:
// beside the thing it is about, not on a tab that lists things.
import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import {
  ANALYSIS_HOOKS, sectionsFor, analysisCacheKey,
} from '../packetAnalysis.js'

/**
 * SEMI-DYNAMIC CACHE, module-scoped and deliberately unbounded in time.
 *
 * The payload can only change when a BUILD runs, so an entry keyed on `(packetId, builtAt)` is
 * correct forever: a rebuild produces a different key rather than making this entry wrong. There is
 * no TTL because there is no staleness window to cover — a TTL here would only re-fetch bytes that
 * cannot have changed.
 *
 * TWO ENTRIES PER PACKET, because the key includes the build. Old builds' entries are dead weight
 * rather than a correctness problem, so the map is capped at a small size and trimmed oldest-first;
 * an unbounded map in a long session is a leak, and this is a screen the owner returns to.
 */
const CACHE = new Map()
const CACHE_MAX = 12
function cacheGet (key) { return key ? CACHE.get(key) || null : null }
function cachePut (key, value) {
  if (!key) return
  CACHE.set(key, value)
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value)
}

/**
 * The panel for ONE home.
 *
 * RENDERS NOTHING when this packet has no sections for this home — including while the first fetch
 * is in flight. A disclosure that appears and then empties is worse than one that appears late: the
 * owner clicks it, finds nothing, and learns to ignore it. The standing no-dead-UI rule.
 */
export default function AnalysisPanel ({ packetId, home }) {
  const [state, setState] = useState({ loading: true, sections: [], error: null })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!packetId) { setState({ loading: false, sections: [], error: null }); return undefined }
    let live = true
    // The cache is keyed on the BUILD, which the response carries — so the first request for a
    // packet is always made, and every later one for the same build is free. Keyed lookaside rather
    // than a request-level cache because `builtAt` is only knowable from the response.
    ;(async () => {
      const r = await api.packetAnalysis(packetId).catch((e) => ({ error: String(e?.message || e) }))
      if (!live) return
      if (!r || r.error) { setState({ loading: false, sections: [], error: r?.error || 'unavailable' }); return }
      const key = analysisCacheKey(packetId, r.builtAt)
      const cached = cacheGet(key)
      const sections = cached || r.sections || []
      if (!cached) cachePut(key, sections)
      setState({ loading: false, sections, error: null })
    })()
    return () => { live = false }
  }, [packetId])

  const rows = sectionsFor(state.sections, home)
  // No sections, no control — and an ERROR is silent here too. This panel is supplementary: a failed
  // fetch must not put a red box on a step whose real content loaded fine.
  if (state.loading || !rows.length) return null

  return (
    <div className="px-card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>What the models found</div>
          <div className="px-small" style={{ textTransform: 'none', color: 'var(--proto-ink2)' }}>
            Written while building this packet. None of it is placed in your documents.
          </div>
        </div>
        <span className="px-link" role="button" tabIndex={0}
          data-qc={ANALYSIS_HOOKS.toggle} data-qc-home={home} data-qc-count={rows.length}
          style={{ fontSize: 12 }}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v) } }}>
          {open ? 'Hide' : `Show ${rows.length}`}
        </span>
      </div>

      {open && (
        <div data-qc={ANALYSIS_HOOKS.panel} data-qc-home={home}
          style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((sec, i) => (
            <div key={`${sec.title}-${i}`} data-qc={ANALYSIS_HOOKS.section}
              data-qc-title={sec.title} data-qc-call={sec.call || ''}
              style={{ borderTop: '1px solid var(--proto-rule-soft)', paddingTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{sec.title}</span>
                {sec.call && (
                  <span className="px-small" style={{ textTransform: 'none' }}>pass {sec.call}</span>
                )}
                {/* THE CUT IS NAMED. Two of the live sections are already truncated by the storage
                    cap, and a reader who is not told will take a severed sentence for the model's
                    own ending. */}
                {sec.truncated && (
                  <span className="px-note" data-qc={ANALYSIS_HOOKS.truncated}
                    style={{ fontSize: 11, padding: '1px 6px' }}>
                    shortened — {sec.chars.toLocaleString()} characters were written, this shows the first {sec.body.length.toLocaleString()}
                  </span>
                )}
              </div>
              {/* Model prose and HTML tables both arrive here. `pre-wrap` keeps the line breaks the
                  model wrote without interpreting anything as markup — this is text the pipeline
                  did not place, so it is shown as written rather than rendered as a document. */}
              <div style={{
                marginTop: 6, fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                wordBreak: 'break-word', color: 'var(--proto-ink)', maxHeight: 320, overflowY: 'auto',
              }}>
                {sec.body}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
