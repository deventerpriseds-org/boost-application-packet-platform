// P8.2 / R3 — the generated document must not quote the EMPLOYER'S figures back as the candidate's.
//
// This is the failure that reads as a strength. "Managed a $18M portfolio across three business
// units" is well-formed, specific, and confident; it is also the posting's own sentence with the
// candidate's name on it. Nothing about length, tone or keyword coverage catches it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { extractFigures, scanEcho, generalize, claimKey, isMarked, stem, ECHO_VERSION } from '../dist/functions/tests/figureEcho.js'

const keys = (t) => extractFigures(t).map(f => f.key)
const raws = (t) => extractFigures(t).map(f => f.raw)

test('every figure form the AC names is extracted, individually', () => {
  const t = 'Manage a $18M portfolio across three business units, 60+ direct reports, ' +
            '400+ industrial operators, 40% growth, and sixty sites.'
  assert.deepEqual(raws(t), ['$18M', 'three', '60+', '400+', '40%', 'sixty'])
  assert.deepEqual(keys(t), ['cur:18000000', 'num:3', 'num:60', 'num:400', 'pct:40', 'num:60'])
})

test('a percentage is a percentage — it is not the digit 4', () => {
  // Two defects met here, and the result was a figure that appears nowhere in the text.
  //  (a) `/(\d…)\s*(%|percent)\b/` NEVER matches "40% growth": `%` and the following space are both
  //      non-word characters, so the trailing `\b` has no boundary to sit on and the match fails.
  //  (b) the bare-count scanner then backtracked from "40" to "4" to satisfy its own lookahead.
  // Measured before the fix: extractFigures('… 40% growth …') returned exactly {raw:'4',key:'num:4'}.
  // A resume mentioning "4" would have been accused of echoing the posting's growth rate.
  assert.deepEqual(raws('40% growth'), ['40%'])
  assert.deepEqual(raws('40 percent growth'), ['40 percent'])
  for (const t of ['40% growth', '40 percent growth', 'up 12.5% YoY'])
    assert.ok(!keys(t).some(k => k.startsWith('num:')), `${t} minted a phantom count: ${keys(t)}`)
})

test('a spelled multiplier is part of one figure, and is never a figure on its own', () => {
  // "one million users" is ONE claim worth 1e6, not "one" and "million".
  assert.deepEqual(raws('one million users'), ['one million'])
  assert.deepEqual(keys('one million users'), ['num:1000000'])
  // And the bare word carries no number: a resume with "a million things to fix" must not collide
  // with every posting that priced anything in millions.
  assert.deepEqual(extractFigures('a million things to fix'), [])
  assert.deepEqual(extractFigures('hundreds of thousands of rows'), [])
})

test('a figure is counted once — a currency amount does not also yield its magnitude word', () => {
  assert.deepEqual(keys('$18 million ARR'), ['cur:18000000'])
  assert.deepEqual(keys('$18M ARR'), ['cur:18000000'])
  assert.equal(keys('$18 million ARR').filter(k => k === 'num:1000000').length, 0)
})

test('the spelled form and the digit form of the same number collide', () => {
  // "sixty engineers" echoes the posting's "60+ engineers" exactly as badly as "60 engineers" does.
  // A digits-only scanner misses it entirely, which is the whole reason spelled numbers are here.
  assert.equal(keys('sixty engineers')[0], keys('60 engineers')[0])
  assert.equal(keys('60+ direct reports')[0], keys('60 direct reports')[0],
    'dropping the plus does not launder the number')
  assert.notEqual(keys('60 sites')[0], keys('600 sites')[0])
})

test('a year is not a figure', () => {
  // This check NAMES an offender, so it must err toward silence. "Founded in 2019" in the posting
  // and "since 2019" on the resume is the calendar, not a stolen number — and dates appear in
  // nearly every pairing of documents, so counting them would make R3 fire on almost every artifact
  // and be learned as noise. The deliberate cost is a missed "2000 users" echo.
  assert.deepEqual(extractFigures('Led the platform since 2019 at Acme'), [])
  assert.deepEqual(raws('rebuilt in 1998 and again in 2024'), [])
  const r = scanEcho('Owned delivery since 2019.', 'Founded in 2019, we build things.', 'Profile.')
  assert.deepEqual(r.echoes, [], 'a shared date was reported as a stolen figure')
  // Narrow on purpose — a plus, a comma or a decimal means it was never written as a year.
  assert.deepEqual(raws('2019+ deployments'), ['2019+'])
  assert.deepEqual(raws('1,987 accounts'), ['1,987'])
  assert.deepEqual(raws('2500 users'), ['2500'], 'outside 1900-2099 it is a quantity')
})

test('a reported figure carries no stray whitespace', () => {
  // `\s*` before the optional magnitude word swallows the space even when no word follows, so
  // "$2019 spend" reported the raw "$2019 ". That trailing space is what a correction would search
  // for and what the drawer would print back at the user.
  for (const t of ['$2019 spend', '$18 million ARR', '$400k budget', '60 + reports']) {
    for (const f of extractFigures(t)) {
      assert.equal(f.raw, f.raw.trim(), `${t} reported ${JSON.stringify(f.raw)}`)
      assert.equal(t.slice(f.start, f.end), f.raw, `${t}: span and raw disagree`)
    }
  }
})

test('a posting figure absent from the profile is an echo', () => {
  const r = scanEcho('Managed a $18M portfolio across three business units.',
                     'You will manage a $18M portfolio across three business units.',
                     'Led platform engineering for a regional utility.')
  assert.equal(r.notApplicable, false)
  assert.deepEqual(r.echoes.map(e => e.figure.raw), ['$18M', 'three'])
  assert.ok(r.echoes.every(e => e.disposition === 'echo'))
  assert.deepEqual(r.shared, [])
})

test('a figure the profile ALSO states is kept, and says which profile figure licenses it', () => {
  // The case a blanket rule gets wrong. If the profile genuinely says the candidate ran 60 sites and
  // the posting asks for 60+, stripping it deletes a true, evidenced achievement because the
  // employer happened to name a similar number. R2 (evidence) beats a literal reading of R3.
  const r = scanEcho('Ran 60 sites and a $18M portfolio.',
                     'Seeking someone who has run 60+ sites and managed a $18M portfolio.',
                     'Operated 60 sites across the Midwest.')
  assert.deepEqual(r.shared.map(e => e.figure.raw), ['60'])
  assert.equal(r.shared[0].disposition, 'shared_with_profile')
  assert.equal(r.shared[0].profileRaw, '60', 'the caller must be able to cite the profile figure')
  assert.deepEqual(r.echoes.map(e => e.figure.raw), ['$18M'], 'the unevidenced one is still an echo')
})

test('a figure the posting never mentions is left alone', () => {
  const r = scanEcho('Cut incident volume 37% and shipped 14 releases.',
                     'You will own reliability for a large fleet.',
                     'Cut incident volume 37% and shipped 14 releases.')
  assert.deepEqual(r.echoes, [])
  assert.deepEqual(r.shared, [])
  assert.equal(r.notApplicable, false)
})

test('no posting text is NOT a clean scan', () => {
  // Absent evidence is not_applicable, never pass. A caller that reads `echoes.length === 0` as
  // "no echoes found" would show a green R3 for a document nobody compared to anything.
  for (const posting of ['', null, undefined, '   ', '<p></p>']) {
    const r = scanEcho('Managed a $18M portfolio.', posting, 'Profile.')
    assert.equal(r.notApplicable, true, `posting=${JSON.stringify(posting)} read as applicable`)
    assert.equal(r.echoes.length, 0)
    assert.ok(r.reason && r.reason.length > 0, 'not_applicable must say why')
  }
})

test('an HTML posting is compared through the one canonical normalizer', () => {
  // jd_real stores descriptionHtml. Comparing against raw HTML — or against a second, private regex
  // — is how two consumers end up disagreeing about what the posting says.
  const r = scanEcho('Managed a $18M P&L across three business units.',
                     '<div><p>Own a $18M P&amp;L across three business units.</p></div>', 'Profile.')
  assert.deepEqual(r.echoes.map(e => e.figure.raw), ['$18M', 'three'])
})

test('offsets address the generated text exactly, so a caller can highlight the span', () => {
  const gen = 'Managed a $18M portfolio.'
  const r = scanEcho(gen, 'Own a $18M portfolio.', 'Profile.')
  const f = r.echoes[0].figure
  assert.equal(gen.slice(f.start, f.end), f.raw)
  assert.equal(gen.slice(f.start, f.end), '$18M')
})

test('generalize never invents a number', () => {
  const one = (t) => extractFigures(t)[0]
  assert.equal(generalize(one('$18M portfolio')), '8-figure')   // 18,000,000 -> eight figures
  assert.equal(generalize(one('$400k budget')), '6-figure')
  assert.equal(generalize(one('60+ reports')), 'multiple')
  assert.equal(generalize(one('three units')), 'multiple')
  assert.equal(generalize(one('40% growth')), null, 'there is no honest generalisation of a rate')
  // Whatever it returns, it must not contain a digit lifted from the original figure.
  for (const t of ['$18M portfolio', '60+ reports', 'three units', '40% growth']) {
    const g = generalize(one(t))
    if (g) assert.ok(!/\d{2,}/.test(g), `${t} -> ${g} carried the original digits through`)
  }
})

test('the scan is deterministic and un-metered — it makes no model call', () => {
  // R3 is a measurement, not a judgement. If it reached a model it would cost money per artifact,
  // vary between runs, and be unable to state a byte offset. A source rule, not a runtime one:
  // the absence of an import cannot be exercised.
  const src = readFileSync(new URL('../src/functions/tests/figureEcho.ts', import.meta.url), 'utf8')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const banned of ['pgClient', '@azure/functions', 'logUsage', 'openai', 'fetch(']) {
    assert.ok(!src.includes(banned), `figureEcho.ts references ${banned} — it is no longer pure`)
  }
  assert.ok(/from '\.\/jdText'/.test(src), 'normalization must come from jdText, never a second regex')
  // Same input, same answer, every time.
  const a = JSON.stringify(scanEcho('Ran 60 sites, $18M.', 'Need 60+ sites, $18M.', 'Ran 60 sites.'))
  const b = JSON.stringify(scanEcho('Ran 60 sites, $18M.', 'Need 60+ sites, $18M.', 'Ran 60 sites.'))
  assert.equal(a, b)
  assert.equal(typeof ECHO_VERSION, 'number')
})

test('a bare number is not a claim — the noun it counts is part of the claim', () => {
  // Measured against a real package before this rule existed: a posting saying "three business
  // units" produced three offenders — "Skill number 3", "Other skill 3" and "One two three four
  // five" — not one of which mentions a business unit. This check NAMES people; it errs to silence.
  const posting = 'Own three business units and a $18M portfolio.'
  const r = scanEcho('Skill number 3\nOne two three four five\nRan 3 marathons.', posting, 'Profile.')
  assert.deepEqual(r.echoes, [], `incidental threes were accused: ${r.echoes.map(e => e.figure.raw)}`)
  // The real echo still lands.
  assert.deepEqual(scanEcho('Led three business units.', posting, 'Profile.').echoes.map(e => e.figure.raw), ['three'])
  // And a figure at the end of a line does not borrow the next line's first word as its noun.
  assert.equal(extractFigures('Skill number 3\nbusiness as usual')[0].unit, '')
})

test('a MARKED figure is a claim on its own — the posting\'s punctuation does not decide the match', () => {
  // "$18M" and "60+" announce a quantity; nobody writes them incidentally. Keying them through the
  // noun too made the commonest echo of all invisible: a posting asking for "60+ sites" and a
  // resume answering "60 sites" did not match, because the posting's plus marked it and the
  // resume's absence of one did not. Which rule applies is decided by the GENERATED figure.
  assert.ok(isMarked(extractFigures('$18M portfolio')[0]))
  assert.ok(isMarked(extractFigures('60+ reports')[0]))
  assert.ok(!isMarked(extractFigures('three units')[0]))
  assert.equal(claimKey(extractFigures('$18M portfolio')[0]), claimKey(extractFigures('$18M budget')[0]),
    'a marked figure keys on itself, whatever noun follows')
  assert.deepEqual(scanEcho('Ran 60 sites.', 'Seeking 60+ sites experience.', 'Profile.').echoes.map(e => e.figure.raw), ['60'])
  assert.deepEqual(scanEcho('Managed $18M.', 'A $18M portfolio.', 'Profile.').echoes.map(e => e.figure.raw), ['$18M'])
})

test('a plural folds onto its singular, and nothing else does', () => {
  // `/e?s$/` was the first rule written. It turns "sites" into "sit", and — worse — folds
  // "business" to "busines" while "businesses" folds to "business", so the singular and plural of
  // the AC's own example land on different keys.
  assert.equal(stem('sites'), 'site')
  assert.equal(stem('units'), 'unit')
  assert.equal(stem('businesses'), stem('business'))
  assert.equal(stem('facilities'), 'facility')
  assert.equal(stem('business'), 'business', 'a word that merely ends in s is not a plural')
  assert.deepEqual(scanEcho('Led three business unit rebuilds.', 'Own three business units.', 'P.').echoes.map(e => e.figure.raw), ['three'])
  // Folding is exact-suffix, never similarity — two different nouns stay two different claims.
  assert.deepEqual(scanEcho('Led three divisions.', 'Own three business units.', 'P.').echoes, [])
})
