// Term normalization + matching for the QC term library.
//
// WHY THIS IS NOT roleTaxonomy.normalize(): that one drops the token `and`, which is right for job
// TITLES ("VP of Product and Design") and fatal for TERMS — it turns `P&L` into `p l` and `M&A` into
// `m a`, colliding with each other and with noise. The two share the intent, not the stopword step.
//
// Entity decoding comes first and is non-negotiable: 71% of live postings contain `&amp;`, and
// without decoding, `P&L` (83 postings) matches nothing. See jdText.ts.
import { decodeEntities } from './jdText'

export type MatchMode = 'exact_norm' | 'case_sensitive_acronym' | 'token_subset'

/**
 * Canonical match form for a term or a candidate phrase.
 * Deliberately NOT stemmed — a stemmer turns `ops`→`op` and `sre`→`sr`. Plurals are explicit aliases.
 */
export function termNormalize(input: any): string {
  if (!input) return ''
  let t = decodeEntities(String(input))
  t = t.normalize('NFKC')
  t = t.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"')
       .replace(/[–—−]/g, '-')
  t = t.replace(/[®™©]/g, '')
  t = t.toLowerCase()
  t = t.replace(/'s\b/g, '')                    // possessive
  t = t.replace(/&/g, ' and ')                  // P&L -> p and l   (the token `and` is KEPT)
  t = t.replace(/[\/\-_]+/g, ' ')               // CI/CD, zero-trust
  t = t.replace(/\b([a-z])\.(?=[a-z]\.)/g, '$1').replace(/\b([a-z])\./g, '$1')  // S.O.C. -> soc
  // Split a trailing digit-run off a letter-run so SOC2 == SOC 2 and ISO27001 == ISO 27001.
  // Only when the digits END the token, so K8s (digits medial) is untouched.
  t = t.replace(/\b([a-z]+)(\d+)\b/g, '$1 $2')
  // Version / level / edition suffixes fold into the same entry — but ONLY unambiguous version
  // markers. A bare trailing integer is NOT stripped: there is no rule that folds "TOGAF 9" into
  // TOGAF while keeping "SOC 2" distinct from "SOC" (and conflating those two would be a real
  // false positive — SOC also means Security Operations Center). Bare-integer variants like
  // "TOGAF 9" are folded by an EXPLICIT alias on the entry, where a human made that judgement.
  t = t.replace(/\b(type)\s*(ii|2)\b/g, '')
       .replace(/\bv\d+(\.\d+)*\b/g, '')       // v2, v1.4
       .replace(/\b\d+\.\d+(\.\d+)*\b/g, '')  // 4.0, 1.2.3  (dotted => a version)
       .replace(/:\s*\d{4}\b/g, '')             // :2022 edition
       .replace(/\b(high|moderate|low)\b(?=\s*$)/g, '')
  t = t.replace(/[^a-z0-9 ]+/g, ' ')
  return t.replace(/\s+/g, ' ').trim()
}

/** Every surface form that should resolve to one entry. */
export function normalizeAliases(display: string, aliases: string[] = []): string[] {
  const set = new Set<string>()
  for (const a of [display, ...aliases]) {
    const n = termNormalize(a)
    if (n) set.add(n)
  }
  return [...set]
}

/**
 * Corroboration-derived confidence. Owner directive: being attested in more INDEPENDENT sources means
 * higher confidence. This is arithmetic over provenance, never a model's opinion.
 * Corpus evidence contributes on a log scale so one very frequent term cannot outrank corroboration.
 */
export function confidenceFor(sources: string[], evidenceDf?: number | null): number {
  const distinct = new Set((sources || []).filter(Boolean))
  const corroboration = Math.min(distinct.size, 4) / 4          // 0..1, saturates at 4 sources
  const df = Math.max(0, evidenceDf || 0)
  const corpus = df > 0 ? Math.min(Math.log10(df + 1) / 2, 1) : 0  // df 100 -> ~1.0
  const score = 0.7 * corroboration + 0.3 * corpus
  return Math.round(Math.min(1, score) * 1000) / 1000
}

/** Does a normalized candidate match an entry, honouring the entry's match mode? */
export function matchesEntry(
  entry: { alias_normalized: string[]; match_mode: MatchMode; display_term: string },
  candidateRaw: string,
): boolean {
  const cand = termNormalize(candidateRaw)
  if (!cand) return false
  if (entry.match_mode === 'case_sensitive_acronym') {
    // `safe` appears in 302 live postings, `scaled agile` in 8 — lowercase matching on SAFe would be
    // ~37x false positives off "safety", "fail-safe". Require the original casing.
    const re = new RegExp(`\\b${entry.display_term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    return re.test(decodeEntities(String(candidateRaw)))
  }
  if (entry.match_mode === 'token_subset') {
    const need = new Set(cand.split(' '))
    return entry.alias_normalized.some((a) => {
      const have = new Set(a.split(' '))
      return [...have].every((w) => need.has(w))
    })
  }
  return entry.alias_normalized.includes(cand)
}
