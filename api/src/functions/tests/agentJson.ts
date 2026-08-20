// Extracts the JSON object an agent call was asked to return.
//
// Why this is not `content.match(/\{[\s\S]*\}/)`:
//   1. That regex is GREEDY across the whole reply, so the FIRST `{` and the LAST `}` in the message
//      are paired. A model that returns a JSON object followed by any prose containing a brace — or
//      an HTML/CSS fragment, which the ATS-QC prompt explicitly asks for — yields a span that is not
//      valid JSON, `JSON.parse` throws, and the whole call is silently discarded.
//   2. A ```json fence is the most common wrapper and the regex only survives it by accident.
//   3. A throw inside the caller's `try` produced an empty object indistinguishable from "the model
//      had nothing to change" — the failure carried no signal at all.
//
// Returns null when nothing parses. Callers must treat null as a FAILED call, not as "no changes".

export interface ParsedAgentJson {
  value: Record<string, any> | null
  /** How the object was recovered — 'none' means the reply carried no parseable object. */
  via: 'direct' | 'fence' | 'balanced' | 'none'
  /** Populated when via === 'none'; short and safe to log. */
  detail?: string
}

/** Strip a leading ```json / ``` fence and its closing fence, if present. */
function unfence(text: string): string | null {
  const m = text.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/)
  return m ? m[1].trim() : null
}

/**
 * Every BALANCED `{...}` span in the text, in order. String literals and escapes are respected so a
 * brace inside a quoted HTML fragment cannot close the object early.
 */
function balancedSpans(text: string): string[] {
  const spans: string[] = []
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (esc) { esc = false; continue }
      if (ch === '\\') { if (inStr) esc = true; continue }
      if (ch === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) { spans.push(text.slice(start, i + 1)); start = i; break }
      }
    }
    if (spans.length >= 8) break   // a reply with more than a handful of objects is not our payload
  }
  return spans
}

function asRecord(v: any): Record<string, any> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null
}

export function parseAgentJson(content: string | null | undefined): ParsedAgentJson {
  const text = String(content ?? '').trim()
  if (!text) return { value: null, via: 'none', detail: 'empty reply' }

  const direct = (() => { try { return asRecord(JSON.parse(text)) } catch { return null } })()
  if (direct) return { value: direct, via: 'direct' }

  const fenced = unfence(text)
  if (fenced) {
    try {
      const v = asRecord(JSON.parse(fenced))
      if (v) return { value: v, via: 'fence' }
    } catch { /* fall through to the balanced scan */ }
  }

  // Prefer the LARGEST parseable balanced span: the payload object contains any nested ones, and a
  // short preamble object must never win over it.
  let best: Record<string, any> | null = null
  let bestLen = -1
  for (const span of balancedSpans(fenced ?? text)) {
    try {
      const v = asRecord(JSON.parse(span))
      if (v && span.length > bestLen) { best = v; bestLen = span.length }
    } catch { /* not this one */ }
  }
  if (best) return { value: best, via: 'balanced' }

  return { value: null, via: 'none', detail: `no parseable JSON object in ${text.length} chars` }
}

/** True when the parsed object carries no usable field — the call ran but decided nothing. */
export function isEmptyResult(value: Record<string, any> | null | undefined): boolean {
  if (!value) return true
  const vals = Object.values(value)
  if (vals.length === 0) return true
  return vals.every((v) =>
    v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.filter(Boolean).length === 0))
}
