// P8.2 / R3 — the generated document must not quote the EMPLOYER'S figures back as the candidate's.
//
// This is the failure that reads as a strength. "Managed a $18M portfolio across three business
// units" is well-formed, specific, and confident; it is also the posting's own sentence with the
// candidate's name on it. Nothing about length, tone or keyword coverage catches it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { extractFigures, scanEcho, generalize, claimKey, isMarked, stem, ECHO_VERSION,
         scanWording, WORDING_RUN_TOKENS } from '../dist/functions/tests/figureEcho.js'

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

// Everything below was found by an independent verifier AFTER the module was written, tested and
// its PR opened. It constructed one realistic cover letter in which every figure was the
// candidate's own, and R3 named five offenders — four of them wrong. 11 of 31 constructed-innocent
// inputs were accused. This is the exact failure H25 was supposed to have prevented: H25 pinned the
// specific incident strings, not the class.

const INNOCENT = [
  // Ordinals. Both documents write "3rd-party", so the noun rule does not save it — it CONFIRMS the
  // match. The spelled form ("third-party") was silent, so the verdict flipped on typography alone.
  ['Owned 3rd-party vendor integrations end to end.', 'You will manage 3rd-party vendor relationships.'],
  ['Promoted in my 3rd year; delivered a 3rd-party integration layer.', 'Manage 3rd-party vendor relationships.'],
  // Ranges. "5-7 years" was split, and the SEVEN inherited "years" as its noun.
  ['I bring 5-7 years of direct platform leadership.', 'Requires 5-7 years of experience.'],
  ['7 years leading platform organizations.', 'We require 5-7 years of platform experience.'],
  ['Seven years leading platform organizations.', 'We require 5-7 years of platform experience.'],
  // Percentages. `isMarked` exempted ALL of them from the noun rule on the reasoning that "nobody
  // writes $18M incidentally" — true of $18M, false of 20% and 100%.
  ['Cut infrastructure spend 20% in one year.', 'Help us reduce customer churn by 20%.'],
  ['Delivered 100% of committed roadmap items.', 'We are 100% remote.'],
  // Bare currency. Postings are dense with comp bands and benefit amounts; resumes with budgets the
  // candidate really owned. Same number, unrelated subject.
  ['Owned a $180,000 vendor budget.', 'Compensation: $180,000 - $220,000 depending on experience.'],
  ['Administered the $5,000 training stipend.', 'We offer a 401(k) match and a $5,000 learning budget.'],
  // A hyphenated adjective: the figure counts the release train, not the day.
  ['Introduced a 4-day release train.', 'We operate a 4-day workweek.'],
  // Small spelled numbers are prose. The module already excluded "million" for this reason; the
  // argument applies with far more force to "one".
  ['One of the first product hires; owned one platform.', 'You will be one of the first product hires on one platform team.'],
  ['Split the roadmap into two tracks.', 'The role spans two tracks of work.'],
  // An address is not an achievement.
  ['Based near 2400 Congress Ave, Austin.', 'Offices at 2400 Congress Ave, Austin.'],
]

test('every one of the verifier\'s innocent documents is left alone', () => {
  for (const [generated, posting] of INNOCENT) {
    const hits = scanEcho(generated, posting, 'Profile: led platform engineering.').echoes
    assert.deepEqual(hits.map(e => e.figure.raw), [],
      `accused ${JSON.stringify(generated)} of echoing ${JSON.stringify(posting)}`)
  }
})

test('and the check is still a check — every real echo lands', () => {
  // The other half of the discipline. A scanner made silent enough to pass the corpus above and
  // nothing else would be worse than the cry-wolf version, because it would look like it worked.
  for (const [generated, posting, expected] of [
    ['Managed a $18M portfolio across three business units.', 'Own a $18M portfolio across three business units.', ['$18M', 'three']],
    ['Ran 60 sites.', 'Seeking 60+ sites experience.', ['60']],          // unmarked answer to a marked ask
    ['Ran 60+ sites.', 'Seeking 60 sites experience.', ['60+']],         // and the reverse
    ['Org Scaling 60+', 'We need 60+ operators.', ['60+']],              // C3: a list item, no noun at all
    ['P&L $18M', 'A $18M P&L.', ['$18M']],
    ['Scaled to one hundred engineers.', 'We have 100 engineers.', ['one hundred']],
    ['Ran sixty sites.', 'Seeking 60+ sites.', ['sixty']],
    ['Supported 400+ industrial operators.', 'Serving 400+ industrial operators.', ['400+']],
    ['Managed a $18 million portfolio.', 'A $18M portfolio.', ['$18 million']],
  ]) {
    assert.deepEqual(scanEcho(generated, posting, 'Profile: led platform engineering.').echoes.map(e => e.figure.raw),
      expected, `missed the echo in ${JSON.stringify(generated)}`)
  }
})

test('"one hundred" is a hundred, not one', () => {
  // `hundred` was in the spelled-number ALTERNATION but missing from MULT, so `MULT['hundred']` was
  // undefined and `|| 1` took over. Both failure directions were live: a real "100 engineers" echo
  // went unseen, AND "one hundred engineers" collided with a posting saying "the one engineer who
  // owns this". A multiplier must appear in both places or neither.
  assert.deepEqual(keys('one hundred engineers'), ['num:100'])
  assert.deepEqual(keys('two hundred fifty clients')[0], 'num:200')
  assert.deepEqual(keys('one thousand engineers'), ['num:1000'])
  assert.deepEqual(keys('one million engineers'), ['num:1000000'])
  assert.deepEqual(scanEcho('Scaled to one hundred engineers.', 'You will be the one engineer who owns this.', 'P.').echoes, [])
})

test('a range never accuses — it exists to stop the splitter', () => {
  assert.deepEqual(raws('Requires 5-7 years of experience'), ['5-7'], 'the range is ONE figure, not 5 and 7')
  assert.deepEqual(raws('Compensation: $180,000 - $220,000'), ['$180,000', '$220,000'])
  // Nobody claims to have accomplished a range, so it matches nothing — not even an identical one.
  assert.deepEqual(scanEcho('I bring 5-7 years.', 'Requires 5-7 years.', 'P.').echoes, [])
})

test('the noun a figure counts skips stopwords, hyphens and proper nouns', () => {
  const unitOf = (t) => extractFigures(t)[0].unit
  assert.equal(unitOf('Delivered 100% of committed roadmap items'), 'committed', 'the "of" told us nothing')
  assert.equal(unitOf('a 4-day release train'), 'release', 'the figure counts the train, not the day')
  assert.equal(unitOf('60+ sites'), 'sites')
  assert.equal(unitOf('2400 Congress Ave'), '', 'a capitalised word is a proper noun, not a counted thing')
})

test('missing either side is decided against the NORMALIZED text, in one place', () => {
  // `jd_real` is HTML, so `<p></p>` is a non-empty raw string and an empty posting. A caller that
  // re-derived emptiness from the raw string disagreed with the scanner and reported a clean PASS
  // on a document it had never compared to anything.
  for (const posting of ['<p></p>', '<div><br/></div>', '&nbsp;&nbsp;', '  <br>  ', '<script>var x=1</script>']) {
    const r = scanEcho('Managed a $18M portfolio.', posting, 'Profile.')
    assert.equal(r.notApplicable, true, `posting ${JSON.stringify(posting)} read as applicable`)
  }
  // The profile half was worse: markup-only produced false ACCUSATIONS, because the thing that
  // would have exonerated the figures read as absent rather than as unreadable.
  for (const profile of ['<p></p>', '<div></div>', '&nbsp;']) {
    const r = scanEcho('Ran 60 sites.', 'Seeking 60+ sites.', profile)
    assert.equal(r.notApplicable, true, `profile ${JSON.stringify(profile)} read as applicable`)
    assert.deepEqual(r.echoes, [], 'an unreadable profile must never produce an accusation')
    assert.match(r.reason, /profile/i)
  }
})

test('there is ONE implementation of what two documents must share', () => {
  // `scanEcho` inlined the claim rule and never called `claimKey`, so H25's structural guard was
  // watching dead code — it would have gone on passing while the real logic beside it was reverted.
  const src = readFileSync(new URL('../src/functions/tests/figureEcho.ts', import.meta.url), 'utf8')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(/postingFigures\.filter\(f => f\.unit\)\.map\(unitKey\)/.test(src), 'the posting index must build through unitKey')
  assert.ok(/return unitKey\(f\)/.test(src), 'claimKey must delegate, not restate')
  // And the LOOKUP must go through claimKey, or claimKey is production-dead and H25's structural
  // guard watches nothing. The first fix for this left it dead a second time: the inline branch was
  // replaced by an inline call to unitKey, which is claimKey's tail rather than claimKey.
  assert.ok(/\.has\(claimKey\(figure\)\)/.test(src), 'scanEcho must decide through claimKey itself')
  assert.ok(!/postingClaims\.has\(unitKey\(figure\)\)/.test(src), 'the claim rule was inlined again')
})

// ---------------------------------------------------------------------------------------------
// D6 — the extraction gaps, and the two live FALSE ACCUSATIONS found while measuring them.
//
// The DEFERRED row listed three gaps. One of them was already closed: `thirteen`..`nineteen` are
// present in SPELLED on `main` and always were, so the row was stale. The other two were real, and
// chasing them turned up something the row did not claim at all — the extractor was not merely
// MISSING magnitudes, it was mis-reading them in a way that accused people.

test('D6: a magnitude is part of the number, not the noun it counts', () => {
  // THE DEFECT, MEASURED ON `main` BEFORE THE FIX (node, dist build of 8e4c46c):
  //   "Grew the community to 18 million users."   -> [{raw:"18", key:"num:18", unit:"million"}]
  //   "You will own an 18 million dollar budget." -> [{raw:"18", key:"num:18", unit:"million"}]
  //   scanEcho(...).echoes -> ["18"]      i.e. ECHO. A community of users was accused of being
  // lifted from a budget line, because the bare-count scanner took the digits, dropped the
  // magnitude, and the word "million" then became the "unit" the noun rule compares. Any two
  // documents saying "18 million" about anything at all collided.
  const genA = 'Grew the community to 18 million users.'
  const postA = 'You will own an 18 million dollar budget.'
  assert.deepEqual(scanEcho(genA, postA, 'Profile: led platform engineering.').echoes, [],
    'a users figure was accused of echoing a budget figure — the magnitude word was read as the noun')
  assert.equal(extractFigures(genA)[0].unit, 'users', 'the noun is what follows the whole magnitude')
  assert.equal(extractFigures(genA)[0].key, 'cur:18000000', 'the figure is eighteen million, not eighteen')

  // The same defect in the letter form, and it was TYPOGRAPHY-DEPENDENT, which is the tell:
  //   "400k users" -> {raw:"400", unit:"k"}   (lowercase: the letter became the unit -> collided)
  //   "400K users" -> {raw:"400", unit:""}    (uppercase: dropped as a proper noun -> matched nothing)
  // The verdict flipped on the case of one letter. Both now read four hundred thousand users.
  assert.deepEqual(scanEcho('Scaled to 400k users.', 'Manage a 400k budget.', 'P.').echoes, [])
  for (const t of ['Scaled to 400k users.', 'Scaled to 400K users.']) {
    assert.equal(extractFigures(t)[0].key, 'cur:400000', t)
    assert.equal(extractFigures(t)[0].unit, 'users', t)
  }
})

test('D6: a currency written as an ISO code is currency', () => {
  // Measured on `main`: "Own a USD 18M portfolio." produced ONE figure, {raw:"18", key:"num:18"} —
  // the symbol-only pattern declined it and the bare-count scanner threw the M away. Not a
  // near-miss: eighteen standing in for eighteen million.
  for (const code of ['USD', 'EUR', 'GBP', 'CAD']) {
    const [f] = extractFigures(`Own a ${code} 18M portfolio.`)
    assert.equal(f.kind, 'currency', code)
    assert.equal(f.key, 'cur:18000000', code)
    assert.equal(f.raw, `${code} 18M`, 'the raw literal is what a correction would splice out')
    assert.ok(f.marked, 'a magnitude with a currency marker announces itself')
  }
  // A posting priced in a code is now caught in the generated document, and vice versa.
  assert.deepEqual(scanEcho('Managed a $18M portfolio.', 'Own a USD 18M portfolio.', 'P.').echoes.map(e => e.figure.raw), ['$18M'])
  // Lower case is prose, not a price. Deliberate silence: no document that quotes a currency code
  // writes it in lower case, and declining costs nothing real.
  assert.notEqual(extractFigures('spent usd 18m on it')[0]?.kind, 'currency')
})

test('D6: deleting the dollar sign does not launder the posting\'s figure', () => {
  // The `60`/`60+` rule already refuses this move for a plus; it did not for a currency symbol.
  // Measured on `main`: scanEcho('Managed a 18M portfolio.', 'Own a $18M portfolio.', ...) -> [].
  assert.deepEqual(scanEcho('Managed a 18M portfolio.', 'Own a $18M portfolio.', 'P.').echoes.map(e => e.figure.raw), ['18M'])
  // ...but ONLY through the noun rule, because a number with no symbol does not announce itself.
  // This is the line between the fix and a cry-wolf: a headcount is not a budget.
  assert.deepEqual(scanEcho('Grew to 18M users.', 'Own a $18M budget.', 'P.').echoes, [],
    'an unmarked magnitude must still clear the noun rule')
  assert.equal(extractFigures('Managed a 18M portfolio.')[0].marked, false)
})

test('D6: the spelled teens were never missing — pin them so the stale row cannot be "fixed" twice', () => {
  // DEFERRED D6 claimed thirteen/fourteen/sixteen/seventeen/eighteen/nineteen were absent from
  // SPELLED. They are present on `main` and extract correctly; the row was stale. Pinned rather
  // than deleted, so the next reader of that row gets a test instead of a second implementation.
  const want = { thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 }
  for (const [word, n] of Object.entries(want)) {
    assert.deepEqual(extractFigures(`We run ${word} sites.`).map(f => f.key), [`num:${n}`], word)
  }
})

// ---------------------------------------------------------------------------------------------
// D4 — wording kept from the posting. A LIST, never a rewrite.

test('D4: a long verbatim run from the posting is listed', () => {
  const posting = 'You will manage a portfolio of enterprise customers across three business units and report to the COO.'
  const gen = 'Managed a portfolio of enterprise customers across three business units for a regional utility.'
  const r = scanWording(gen, posting, 'Profile: led platform engineering teams.')
  assert.equal(r.notApplicable, false)
  assert.equal(r.kept.length, 1, JSON.stringify(r.kept))
  assert.equal(r.kept[0].phrase, 'a portfolio of enterprise customers across three business units')
  // The offsets must address the phrase in the GENERATED text, so a UI can outline it.
  assert.equal(gen.slice(r.kept[0].start, r.kept[0].end), r.kept[0].phrase)
})

test('D4: ordinary professional prose is not an accusation', () => {
  // THE PRIMARY RISK. Two people writing about the same job independently share vocabulary, whole
  // phrases, and often a full clause. A list shown to a person about their own writing must not
  // fire on any of this.
  const posting = 'We are seeking a senior engineering leader to drive operational excellence in a fast paced environment. '
    + 'The successful candidate will have strong communication skills and a track record of delivery.'
  const profile = 'Led platform engineering. Strong communication skills.'
  for (const gen of [
    'Drove operational excellence in a fast paced environment.',          // 6 tokens — under the run
    'Senior engineering leader with strong communication skills.',        // shared, but short
    'I have a track record of delivery and strong communication skills.', // two short shared runs
    'Built and led platform engineering teams across three regions.',
  ]) {
    assert.deepEqual(scanWording(gen, posting, profile).kept, [], gen)
  }
})

test('D4: the candidate\'s own wording is theirs, even when the ad says it too', () => {
  // Same three-way split as scanEcho: R2 beats a literal reading of R3. Stripping a person's own
  // sentence because the employer wrote something similar is the harm, not the fix.
  const phrase = 'a portfolio of enterprise customers across three business units'
  const posting = `You will manage ${phrase} and report to the COO.`
  const gen = `Managed ${phrase} for a regional utility.`
  assert.equal(scanWording(gen, posting, 'Nothing relevant here.').kept.length, 1, 'control: it fires without the profile')
  assert.deepEqual(scanWording(gen, posting, `Career summary: managed ${phrase} since 2016.`).kept, [],
    'the profile states the same words — they are the candidate\'s')
})

test('D4: absent evidence is not_applicable, never "no wording was kept"', () => {
  const gen = 'Managed a portfolio of enterprise customers across three business units.'
  for (const [posting, profile, why] of [['', 'Profile.', 'no posting'], ['<p></p>', 'Profile.', 'markup-only posting'],
                                          ['Real posting text here.', '', 'no profile']]) {
    const r = scanWording(gen, posting, profile)
    assert.equal(r.notApplicable, true, why)
    assert.deepEqual(r.kept, [], why)
    assert.ok(r.reason && r.reason.length > 10, why)
  }
})

test('D4: matching is exact — nothing here stems, scores or ranks', () => {
  const phrase = 'a portfolio of enterprise customers across three business units'
  const posting = `You will manage ${phrase} and report to the COO.`
  const profile = 'Profile: led platform engineering.'
  // One word different in the middle breaks the run. A fuzzy matcher would still fire; that is
  // precisely what "fuzzy matching is for RANKING, never for ACCUSING" forbids.
  assert.deepEqual(scanWording('Managed a portfolio of enterprise clients across three business units.', posting, profile).kept, [])
  // A plural difference also breaks it. `stem` is deliberately not used on prose.
  assert.deepEqual(scanWording('Managed a portfolio of enterprise customer across three business unit.', posting, profile).kept, [])
})

test('D4: a run of pure connective tissue is not a passage', () => {
  // The content-word floor at its real boundary. A job ad and a resume can easily share eight
  // consecutive words of grammar — "and you will have to be able to" — and that is a fact about
  // English, not evidence of copying. Reporting it would train the reader to dismiss the list.
  const posting = 'The role is demanding and you will have to be able to travel each quarter.'
  const gen = 'The work was demanding and you will have to be able to deliver under pressure.'
  const r = scanWording(gen, posting, 'Profile: led engineering.')
  assert.deepEqual(r.kept, [], `connective tissue was reported: ${JSON.stringify(r.kept)}`)
  // ...and the floor is what does it: the same run carrying real content IS reported.
  const posting2 = 'You will have to be able to run a distributed platform organisation.'
  const gen2 = 'I have had to be able to run a distributed platform organisation.'
  assert.equal(scanWording(gen2, posting2, 'Profile: led teams.', 6).kept.length, 1,
    'a run with three content words is a passage')
})

test('D4: the run length is a seeded default, not a constant', () => {
  // CLAUDE.md: no behaviour-affecting value may be code-only. Threaded from
  // CheckThresholds.wordingRunTokens, so an owner can tune it without a code change.
  const posting = 'We need someone to drive operational excellence across the enterprise every day.'
  const gen = 'Drove operational excellence across the enterprise every day.'
  const profile = 'Profile: led platform engineering.'
  assert.deepEqual(scanWording(gen, posting, profile).kept, [], 'silent at the default run length')
  assert.equal(scanWording(gen, posting, profile, 5).kept.length, 1, 'a lower threshold surfaces it')
  assert.equal(typeof WORDING_RUN_TOKENS, 'number')
})
