// Resolves the Zapier {{nodeId__field}} placeholders embedded in the seeded
// prompts (from Zap 289877647) into real values, so the model receives a fully
// grounded prompt instead of literal placeholder tokens.
//
// Replacement sources:
//   - candidate baseline content  -> MasterContext table fields
//   - the job description         -> per-run request payload
//   - current date/time           -> server clock
//
// IMPORTANT: skills1 and skills2 stay SEPARATE (two labeled input lists). They
// map to two independent resume-doc columns ({{SkillsBullets1}}/{{SkillsBullets2}});
// blending them would overflow the page.

type MasterContext = Record<string, any>

export function resolveZapVars(promptText: string, mc: MasterContext, jobDescription: string, nowIso?: string): string {
  const now = nowIso || new Date().toISOString()
  const humanDate = new Date(now).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const val = (k: string) => (mc && mc[k] != null ? String(mc[k]) : '')

  // Work experience: four fields recombined into the single "Current Work
  // Experience" blob the prompt expects, but kept as distinct paragraphs.
  const workExperience = [val('workHistory1'), val('workHistory2'), val('workHistory3'), val('workHistory4')]
    .filter(Boolean)
    .join('\n\n')

  // Skills: kept as TWO explicitly labeled lists so the model preserves the
  // two-column output structure. Never concatenated into one list.
  const skillsInput = `Skills List 1:\n${val('skills1')}\n\nSkills List 2:\n${val('skills2')}`

  // nodeId__field -> replacement value
  const map: Record<string, string> = {
    '289877648__value': val('resumeSummary'),
    '289877649__value': workExperience,
    '289877650__value': skillsInput,
    '289877651__value': val('expertise'),
    '289877652__value': val('relevantProficiencies'),
    '289877654__value': val('aboutMe1'),
    '289877655__value': val('aboutMe2'),
    '289877656__value': val('executiveProfile'),
    '289877657__value': val('coreAccomplishments'),
    '289877659__Items to Omit': val('itemsToOmit'),
    '289877647__answers__Target Job Description': jobDescription || '',
    'zap_meta_human_now': humanDate,
  }

  // Replace every {{ key }} (tolerating internal whitespace). Any unmapped
  // {{...}} token is blanked out so no literal placeholder reaches the model.
  return promptText.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, key) => {
    const k = String(key).trim()
    if (k in map) return map[k]
    return ''
  })
}
