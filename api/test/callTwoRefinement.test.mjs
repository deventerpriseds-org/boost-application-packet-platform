// Call 2 is the owner's SECOND skills-refinement pass — and for the product's whole life its output
// was thrown away, so the refinement never ran.
//
// The evidence, from the primary source rather than from the symptom. `portfolio_user` v002 is Zap
// node 299599701, "Copy: Update Resume/Portfolio Fields" (checked into this repo at
// docs/zap-289877647/prompts/17-...), and it emits exactly six sections: Skills1, Skills2, Relevant
// Skills 1/2/3, Word and Character Requirements Check. Plain `### Title ###` text. It never asks for
// JSON, and it never mentions a cover letter, an About Me, an executive profile or a cold email —
// which are precisely the fields `assemblePackage` used to ask Call 2 for.
//
// So the code was parsing sections with a JSON parser, failing on every build (2,957 / 3,178 /
// 4,736 / 5,404 characters discarded in job 945e28ed alone), and shipping Call 1's unrefined skills.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assemblePackage } from '../dist/functions/tests/mt17.js'
import { parseResumePackage } from '../dist/functions/tests/resumeParser.js'

const src = (f) => readFileSync(new URL(`../src/functions/tests/${f}`, import.meta.url), 'utf8')

test('H:call-2-refinement-reaches-the-document: the refined lists beat the first draft', () => {
  // The pass exists to "replace the least relevant or loosely aligned skills from previous outputs
  // with these refined phrases" under a 30-character limit. If its output does not outrank Call 1's
  // in the assembled package, the pass is a 16,000-token call that changes nothing.
  const call1 = { skills1: 'draft s1', skills2: 'draft s2', relevant1: 'draft r1', relevant2: 'draft r2', relevant3: 'draft r3' }
  const call2 = { skills1: 'refined s1', skills2: 'refined s2', relevant1: 'refined r1', relevant2: 'refined r2', relevant3: 'refined r3' }
  const pkg = assemblePackage(call1, call2, {})
  assert.equal(pkg.SkillsBullets1, 'refined s1', 'the document shipped the unrefined skills')
  assert.equal(pkg.SkillsBullets2, 'refined s2')
  assert.equal(pkg.RelevantBullets1, 'refined r1')
  assert.equal(pkg.RelevantBullets2, 'refined r2')
  assert.equal(pkg.RelevantBullets3, 'refined r3')
})

test('H:call-3-still-outranks-call-2: the QC pass runs last and sees the refinement', () => {
  // Call 3 is the ATS QC pass; it runs after Call 2 and is now handed Call 2's lists as its input.
  // Promoting Call 2 above Call 1 must not promote it above the pass that reviewed it.
  const call1 = { skills1: 'draft s1', relevant1: 'draft r1' }
  const call2 = { skills1: 'refined s1', relevant1: 'refined r1' }
  const call3 = { finalSkills1: 'qc s1', finalRelevant1: 'qc r1' }
  const pkg = assemblePackage(call1, call2, call3)
  assert.equal(pkg.SkillsBullets1, 'qc s1', 'the QC pass was overruled by the pass it reviewed')
  assert.equal(pkg.RelevantBullets1, 'qc r1')
})

test('H:call-1-is-still-the-floor: a silent Call 2 must not blank the document', () => {
  // The failure mode this replaces was silent fallback. The fallback itself is correct and must
  // survive: a Call 2 that returns nothing usable leaves Call 1's draft in place rather than
  // emptying five fields.
  const call1 = { skills1: 'draft s1', skills2: 'draft s2', relevant1: 'draft r1', relevant2: 'draft r2', relevant3: 'draft r3' }
  for (const empty of [{}, { skills1: '', relevant1: '' }]) {
    const pkg = assemblePackage(call1, empty, {})
    assert.equal(pkg.SkillsBullets1, 'draft s1', 'an empty Call 2 blanked the skills')
    assert.equal(pkg.RelevantBullets3, 'draft r3')
  }
})

test('H:call-2-is-parsed-as-sections-not-json: the parser must match the prompt', () => {
  // Structural, because the runtime path needs OpenAI, Postgres and Drive to reach. What is being
  // asserted cannot be expressed as a unit test: that the parser chosen for Call 2's reply is the
  // one that matches the prompt Call 2 actually sends.
  const code = src('pipeline.ts')
  const call2 = code.slice(code.indexOf('const base2 ='), code.indexOf('const atsExtra'))
  assert.ok(call2.includes('parseResumePackage('), 'Call 2 is not parsed with the section parser')
  assert.ok(!call2.includes('parseAgentJson('),
    'Call 2 is parsed as JSON, but its prompt emits ### sections ### and never asks for JSON')
  // Call 3's prompt DOES ask for JSON and its parse succeeds in production — the JSON path is
  // correct there, so this must not be read as "the JSON parser is wrong".
  const call3 = code.slice(code.indexOf('const base3 ='), code.indexOf('const pkg ='))
  assert.ok(call3.includes('parseAgentJson('), 'Call 3 should still be parsed as JSON — it returns JSON')
})

test('H:call-2-sections-parse-into-the-fields-the-package-reads', () => {
  // End to end over the two units that matter, with the section titles taken from the real prompt
  // (docs/zap-289877647/prompts/17-...): parse a Call-2-shaped reply and assemble it. This is what
  // proves the two halves agree on field NAMES — the failure that would otherwise look like a
  // working parse and an unchanged document.
  const reply = [
    '### Skills1 ###', 'Portfolio Governance', '',
    '### Skills2 ###', 'Vendor Strategy', '',
    '### Relevant Skills 1 ###', 'Agile Transformation', '',
    '### Relevant Skills 2 ###', 'Cloud Migration', '',
    '### Relevant Skills 3 ###', 'Risk Management', '',
    '### Word and Character Requirements Check ###', 'Removed', '',
  ].join('\n')
  const c2 = parseResumePackage(reply, {}, 'Director', 'Trinnex')
  assert.equal(c2.skills1, 'Portfolio Governance')
  assert.equal(c2.skills2, 'Vendor Strategy')
  assert.equal(c2.relevant1, 'Agile Transformation')
  assert.equal(c2.relevant3, 'Risk Management')
  // The check section maps to no merge field, which is correct — it is analysis, not document text.
  // It must be REPORTED rather than silently swallowed; that is what D33 is about.
  assert.ok((c2._unmapped || []).some((u) => /Word and Character/i.test(u.title)),
    'the analysis section was swallowed instead of reported')

  const pkg = assemblePackage({ skills1: 'draft', relevant1: 'draft' }, c2, {})
  assert.equal(pkg.SkillsBullets1, 'Portfolio Governance', 'the parsed refinement did not reach the package')
  assert.equal(pkg.RelevantBullets1, 'Agile Transformation')
})

test('H:call-3-input-never-loses-call-1: the merge is an allowlist, not a spread', async () => {
  // THE DEFECT, caught by an independent AC read after it had shipped and before it could be
  // measured. Call 3's input was `{...c1, ...c2}`, harmless only while the Call-2 JSON parse always
  // failed and c2 was `{}`. Parsed properly, c2 is a full `parseResumePackage` shape, and that shape
  // returns EVERY key defaulted with `|| ''` — so the spread blanked Call 1's resumeSummary,
  // expertise, coverLetter, aboutMe1/2, executiveProfile and coreAccomplishments and handed the
  // emptied package to the QC pass. Nothing downstream would have caught it: Call 3's
  // updatedResumeSummary and finalSkills* OUTRANK Call 1 in the document, and the build still
  // reports built:4 failed:0.
  const { mergeCallTwo } = await import('../dist/functions/tests/mt17.js')
  const c1 = {
    resumeSummary: 'real summary', expertise: 'real expertise', coverLetter: 'real cover',
    aboutMe1: 'real a1', aboutMe2: 'real a2', executiveProfile: 'real profile',
    coreAccomplishments: 'real accomplishments', skills1: 'draft s1', relevant1: 'draft r1',
    workHistory1: 'real wh1',
  }
  // Exactly what parseResumePackage returns for a reply that only carried skills sections.
  const c2 = {
    skills1: 'refined s1', skills2: '', relevant1: 'refined r1', relevant2: '', relevant3: '',
    resumeSummary: '', expertise: '', coverLetter: '', aboutMe1: '', aboutMe2: '',
    executiveProfile: '', coreAccomplishments: '', workHistory1: 'real wh1', _unmapped: [],
  }
  const { merged, improvised } = mergeCallTwo(c1, c2)

  // Assert on the FULL key set, not a sample: a test that only checks skills1 passes and is inert.
  for (const k of Object.keys(c1)) {
    assert.ok(String(merged[k] || '').trim(),
      `Call 3 would have been handed an empty "${k}" — Call 1's content was lost`)
  }
  assert.equal(merged.resumeSummary, 'real summary')
  assert.equal(merged.coverLetter, 'real cover')
  assert.equal(merged.skills1, 'refined s1', 'the refinement did not reach Call 3')
  assert.equal(merged.relevant1, 'refined r1')
  assert.deepEqual(improvised, [], 'a value identical to Call 1 was reported as improvisation')
})

test('H:call-2-may-not-improvise-a-draft-field: refused and named, not merged', async () => {
  // Node 299599701 asks for skills only. A cover letter or an executive profile in that reply is the
  // model improvising, and the owner's constraint is that THEIR prompts drive the draft — a field
  // their prompt never requested is by definition not their prompt driving it. This is deliberately
  // the opposite of "the later call wins".
  const { mergeCallTwo, call2Draft, assemblePackage } = await import('../dist/functions/tests/mt17.js')
  const c1 = { coverLetter: 'the real cover letter', executiveProfile: 'the real profile', skills1: 'draft s1' }
  const c2 = { coverLetter: 'IMPROVISED cover', executiveProfile: 'IMPROVISED profile', skills1: 'refined s1' }

  const { merged, improvised } = mergeCallTwo(c1, c2)
  assert.equal(merged.coverLetter, 'the real cover letter', 'an improvised cover letter reached the QC pass')
  assert.deepEqual(improvised.sort(), ['coverLetter', 'executiveProfile'], 'the improvisation was not reported')

  const pkg = assemblePackage(c1, call2Draft(c2), {})
  assert.equal(pkg['@CoverLetterBody'], 'the real cover letter', 'an improvised cover letter reached the DOCUMENT')
  assert.equal(pkg['@ExecutiveProfile_55words'], 'the real profile')
  assert.equal(pkg.SkillsBullets1, 'refined s1', 'the allowlist also blocked the field Call 2 is FOR')
})
