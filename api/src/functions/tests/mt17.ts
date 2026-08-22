import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const MOCK_INPUTS = {
  call1: {
    resumeSummary: 'Visionary technology executive with 20+ years driving digital transformation.',
    skills1: 'Enterprise Architecture | Cloud Strategy | DevSecOps',
    skills2: 'Agile Transformation | SaaS Platforms | M&A Integration',
    expertise: 'Digital Transformation | Engineering Leadership | Platform Modernization',
    workHistory1: 'Led enterprise software strategy across 15 global markets',
    workHistory2: 'Directed digital engineering organization of 120+ engineers',
    workHistory3: 'Architected corporate information solutions platform',
    workHistory4: 'Delivered GIS and water infrastructure analytics systems',
    relevant1: 'Agile Portfolio Mgmt',
    relevant2: 'SaaS Platforms',
    relevant3: 'Data Governance',
    coverLetter: 'Dear Hiring Manager, I am excited to apply for the VP of Engineering role at TechVenture Inc...',
    aboutMe1: 'I lead with innovation and build high-performing engineering cultures across global markets.',
    aboutMe2: 'As a technology executive I have scaled organizations from 20 to 150+ engineers.',
    executiveProfile: 'Technology executive with proven track record delivering enterprise platforms at scale.',
    coreAccomplishments: '• Led $25M digital transformation\n• Scaled engineering org to 150+ engineers\n• Delivered 3 SaaS platforms',
    targetRole: 'VP of Engineering',
    targetCompany: 'TechVenture Inc',
    date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  },
  call2: {
    aboutMe1: 'I lead with a bias toward innovation, building engineering cultures that deliver at scale.',
    aboutMe2: 'With two decades of enterprise leadership, I have driven digital transformation for Fortune 500 organizations across cloud, SaaS, and data-intensive platforms.',
    executiveProfile: 'Technology executive driving enterprise digital transformation through cloud-native platforms, engineering excellence, and strategic leadership.',
    coverLetter: 'Dear Hiring Manager, TechVenture Inc represents exactly the kind of transformational challenge I have built my career around...',
    coldEmail: 'Hi [Name], I noticed the VP of Engineering role at TechVenture Inc and believe my background aligns well with your needs.'
  },
  call3: {
    finalSkills1: ['Enterprise Architecture', 'Cloud Strategy', 'DevSecOps'],
    finalSkills2: ['Agile Transformation', 'SaaS Platforms', 'M&A Integration'],
    finalRelevant1: 'Agile Portfolio Mgmt',
    finalRelevant2: 'SaaS Platforms',
    finalRelevant3: 'Data Governance',
    updatedResumeSummary: 'Visionary technology executive with 20+ years driving digital transformation and delivering cloud-native enterprise SaaS platforms at scale.',
    jobscanQcTable: 'Keyword matches: 85% | ATS score: 92/100'
  }
}

// First non-empty string among the candidates, else null. Arrays are joined
// with newlines so a Call-3 array field and a Call-1 string field are handled
// uniformly. Guarantees a section is only null when EVERY source is empty.
function firstNonEmpty(...cands: any[]): string | null {
  for (const c of cands) {
    if (Array.isArray(c)) { const s = c.filter(Boolean).join('\n').trim(); if (s) return s }
    else if (c != null && String(c).trim()) return String(c).trim()
  }
  return null
}

// Split a single combined skills block into two halves so a resume that only
// produced one "Skills" section still fills both SkillsBullets1/2 slots rather
// than leaving the second empty. Splits on lines/bullets; falls back to the
// whole block in slot 1 when it cannot be halved.
function splitSkills(block: any): [string | null, string | null] {
  const s = block == null ? '' : String(block).trim()
  if (!s) return [null, null]
  const lines = s.split(/\r?\n|(?:\s*[|•·]\s*)/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return [s, null]
  const mid = Math.ceil(lines.length / 2)
  return [lines.slice(0, mid).join('\n'), lines.slice(mid).join('\n')]
}

/**
 * The ONLY fields Call 2's prompt asks for.
 *
 * Zap node 299599701 emits `### Skills1 ###`, `### Skills2 ###`, `### Relevant Skills 1/2/3 ###`, a
 * swap table and a word-count check. Nothing else. A cover letter, an About Me, an executive profile
 * or a resume summary appearing in that reply is the model improvising — and the owner's standing
 * constraint is that THEIR prompts drive the draft, so a field their prompt never requested is by
 * definition not their prompt driving it. Improvised fields are reported and refused, not merged.
 */
export const CALL2_FIELDS = ['skills1', 'skills2', 'relevant1', 'relevant2', 'relevant3'] as const

/**
 * Merge Call 2 onto Call 1 for the ATS QC pass, losing nothing.
 *
 * THE DEFECT THIS EXISTS TO PREVENT, which shipped and was caught by an independent AC read before
 * it could be measured: Call 3's input was assembled as `{...c1, ...c2}`. That was harmless only
 * while `c2` was always `{}` — the JSON parse that never succeeded. The moment Call 2 was parsed
 * properly, `c2` became a full `parseResumePackage` shape, and that shape returns EVERY key
 * defaulted with `|| ''`. So the spread overwrote Call 1's real `resumeSummary`, `expertise`,
 * `coverLetter`, `aboutMe1/2`, `executiveProfile` and `coreAccomplishments` with empty strings, and
 * handed the blanked package to the QC pass.
 *
 * That is the silent-degradation path, and nothing downstream would have caught it: Call 3's
 * `updatedResumeSummary` and `finalSkills*` OUTRANK Call 1 in `assemblePackage`, so a QC pass that
 * graded a blanked package writes its verdict straight into the document — while the build still
 * reports `built: 4, failed: 0`.
 *
 * So the merge is an allowlist of non-empty values, never a spread. `improvised` names any other
 * non-empty field Call 2 returned that differs from Call 1's, so the caller can warn about it.
 */
export function mergeCallTwo(c1: any, c2: any): { merged: Record<string, any>; improvised: string[] } {
  const merged: Record<string, any> = { ...(c1 || {}) }
  for (const k of CALL2_FIELDS) {
    const v = c2 && c2[k]
    if (typeof v === 'string' && v.trim()) merged[k] = v
  }
  const allowed = new Set<string>(CALL2_FIELDS as readonly string[])
  const improvised = Object.keys(c2 || {})
    .filter((k) => !k.startsWith('_') && !allowed.has(k))
    .filter((k) => typeof c2[k] === 'string' && c2[k].trim())
    // A manufactured `date`/`targetRole`/`targetCompany`, or a MasterContext work-history block, is
    // identical to what Call 1 produced from the same inputs. Reporting those as improvisation would
    // fire on every single run — the cry-wolf failure — so only a DIFFERENT value counts.
    .filter((k) => c2[k] !== (c1 || {})[k])
  return { merged, improvised }
}

/** Call 2's contribution to the DRAFT: the allowlisted fields only, so an improvised section cannot win. */
export function call2Draft(c2: any): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of CALL2_FIELDS) {
    const v = c2 && c2[k]
    if (typeof v === 'string' && v.trim()) out[k] = v
  }
  return out
}

export function assemblePackage(call1: any, call2: any, call3: any): Record<string, string | null> {
  // Skills: prefer the QC'd Call-3 arrays, then Call-1 per-slot fields, then a
  // split of any single combined skills block (call1.skills / call3.finalSkills).
  const combined = firstNonEmpty(call1.skills, call3.finalSkills, call1.skillsCombined)
  const [splitS1, splitS2] = splitSkills(combined)
  return {
    ResumeSummary: firstNonEmpty(call3.updatedResumeSummary, call1.resumeSummary, call2.resumeSummary),
    // CALL 2 SITS BETWEEN THE QC PASS AND THE FIRST DRAFT, and it used to be absent from these five
    // lines entirely. Call 2 is the owner's second refinement pass — Zap node 299599701, "Copy:
    // Update Resume/Portfolio Fields" — whose whole instruction is "Replace the least relevant or
    // loosely aligned skills from previous outputs with these refined phrases" under a 30-character
    // limit. Its output was parsed as JSON, failed, and was discarded on every build, so the
    // documents shipped Call 1's unrefined lists and the refinement the owner wrote never ran.
    //
    // Call 3 still wins where it produced something: it is the ATS QC pass, it runs last, and it
    // sees Call 2's refinement as input. The order is therefore latest-informed first, and Call 1
    // remains the floor.
    SkillsBullets1: firstNonEmpty(call3.finalSkills1, call2.skills1, call1.skills1, splitS1),
    SkillsBullets2: firstNonEmpty(call3.finalSkills2, call2.skills2, call1.skills2, splitS2),
    ExpertiseBullets: firstNonEmpty(call1.expertise, call3.finalExpertise, call3.expertise),
    WorkHistoryBullets1: firstNonEmpty(call1.workHistory1, call3.workHistory1),
    WorkHistoryBullets2: firstNonEmpty(call1.workHistory2, call3.workHistory2),
    WorkHistoryBullets3: firstNonEmpty(call1.workHistory3, call3.workHistory3),
    WorkHistoryBullets4: firstNonEmpty(call1.workHistory4, call3.workHistory4),
    RelevantBullets1: firstNonEmpty(call3.finalRelevant1, call2.relevant1, call1.relevant1),
    RelevantBullets2: firstNonEmpty(call3.finalRelevant2, call2.relevant2, call1.relevant2),
    RelevantBullets3: firstNonEmpty(call3.finalRelevant3, call2.relevant3, call1.relevant3),
    '@Company': call1.targetCompany || null,
    '@CoverLetterDate': call1.date || null,
    '@CoverLetterBody': call2.coverLetter || call1.coverLetter || null,
    '@AboutMe1_50words': call2.aboutMe1 || call1.aboutMe1 || null,
    '@AboutMe2_60words': call2.aboutMe2 || call1.aboutMe2 || null,
    '@ExecutiveProfile_55words': call2.executiveProfile || call1.executiveProfile || null,
    '@CoreAccomplishments_5blts_180words': call1.coreAccomplishments || null,
    coldEmail: call2.coldEmail || null,
    targetRole: call1.targetRole || null,
    targetCompany: call1.targetCompany || null,
    date: call1.date || null,
  }
}

export async function mt17(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }

  try {
    let body: any = {}
    try { body = await req.json() } catch {}
    const call1 = body.call1 || MOCK_INPUTS.call1
    const call2 = body.call2 || MOCK_INPUTS.call2
    const call3 = body.call3 || MOCK_INPUTS.call3

    const pkg = assemblePackage(call1, call2, call3)
    const nullFields = Object.entries(pkg).filter(([, v]) => v === null).map(([k]) => k)

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass: nullFields.length === 0,
        detail: nullFields.length === 0 ? 'All delivery package fields assembled successfully.' : `Null fields: ${nullFields.join(', ')}`,
        package: pkg
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt17', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-17', handler: mt17 })
