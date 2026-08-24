// D11 — the two in-text highlight treatments ship as TOKEN PAIRS, in both themes.
//
// The defect this file exists to prevent is specific and was written into the design handoff: carry
// #fff03a (keyword) and #fbf2da / #c9b27a (posting echo) verbatim. Carried as literals in a
// component they are correct in light mode and unreadable in dark: the background stays yellow and
// the text keeps inheriting --proto-ink, which flips to near-white. Near-white on yellow.
//
// These are source assertions, not behaviour tests, for the reason the file header of
// postingAnalysis.test.mjs already gives: the rule is about what the STYLESHEET contains. The
// runtime half — that the two treatments actually RESOLVE to different colours, in both themes —
// cannot be answered without a CSS engine and is asserted in test/browser/run.mjs, which reads
// getComputedStyle on the real classes with .proto-dark on and off.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HIGHLIGHT_TOKENS, HIGHLIGHT_CLASS, HIGHLIGHT_LITERALS } from '../src/highlight.js'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const read = (rel) => readFileSync(join(SRC, rel), 'utf8')
const CSS = read('theme.css')

/** The body of a CSS rule, brace-matched so a nested block cannot truncate it. */
function ruleBody(css, selector) {
  const i = css.indexOf(selector)
  if (i === -1) return null
  const open = css.indexOf('{', i)
  let depth = 0
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++
    else if (css[j] === '}' && --depth === 0) return css.slice(open + 1, j)
  }
  return null
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}
const ALL_SRC = walk(SRC)
// Every module, .js AND .jsx. The first version of the swatch guard scanned .jsx only, and a
// verifier put `export const KW_SWATCH = '#fff03a'` — the exact literal D11 names — into
// postingAnalysis.js, a .js file, with the whole suite still green.
const MODULES = ALL_SRC.filter((f) => /\.(js|jsx)$/.test(f))
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ── the two parsers the guards below stand on ───────────────────────────────────────────────────

/**
 * Every `var(...)` in the source, with its NAME argument extracted by brace-matching rather than
 * by a pattern that has to anticipate how the name was written.
 *
 * The name is everything up to the first TOP-LEVEL comma, so a fallback — `var(--x, var(--y))` —
 * yields `--x` and the nested call is returned as its own entry. Nothing about the name's contents
 * is assumed here; the caller decides what a legal name looks like, which is what makes the check
 * a whitelist instead of a list of forbidden spellings.
 */
function varCalls(code) {
  const out = []
  for (const m of code.matchAll(/\bvar\(/gi)) {
    const open = m.index + m[0].length - 1
    let depth = 0, end = -1
    for (let i = open; i < code.length; i++) {
      if (code[i] === '(') depth++
      else if (code[i] === ')' && --depth === 0) { end = i; break }
    }
    if (end === -1) {
      // An unclosed var( means the call is completed somewhere else — by concatenation, or across
      // a literal boundary. That is assembly by definition, so report it rather than skip it.
      out.push({ name: code.slice(open + 1, Math.min(code.length, open + 60)), line: lineOf(code, open) })
      continue
    }
    const inner = code.slice(open + 1, end)
    let d = 0, comma = inner.length
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '(') d++
      else if (inner[i] === ')') d--
      else if (inner[i] === ',' && d === 0) { comma = i; break }
    }
    out.push({ name: inner.slice(0, comma), line: lineOf(code, open) })
  }
  return out
}
const lineOf = (code, index) => code.slice(0, index).split('\n').length

/** #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() → the same three numbers, whatever the spelling. */
function rgbOf(text) {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text.trim())
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('')
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  }
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(text.trim())
  return fn ? [Number(fn[1]), Number(fn[2]), Number(fn[3])] : null
}
/** Every colour literal in a file, in either notation, canonicalised. */
function colorsIn(code) {
  const out = []
  for (const m of code.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+[^)]*\)/g)) {
    // NO alpha pre-strip here. An earlier version ran .replace(/,\s*[\d.]+\s*\)$/, ')') to drop
    // the alpha channel, which on a three-argument rgb() ate the BLUE channel instead — so
    // 'rgb(255, 240, 58)' became 'rgb(255, 240)', failed to parse, and the identical colour to
    // #fff03a slipped through. rgbOf already reads only the first three numbers and ignores
    // whatever follows, so alpha needs no special handling at all.
    const rgb = rgbOf(m[0])
    if (rgb) out.push({ text: m[0], rgb })
  }
  return out
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

// ── the pairs exist, on :root AND under .proto-dark ─────────────────────────────────────────────

test('both highlights ship as a PAIR — never a background on its own', () => {
  // This used to compare HIGHLIGHT_TOKENS to a hardcoded copy of itself, which proves only that
  // two literals in the repo match. The invariant is about the STYLESHEET: a background with no
  // second token beside it is the whole defect, because the text then falls through to
  // --proto-ink, and --proto-ink in dark mode is near-white. So assert that every token declared
  // here is actually DRAWN by the class that paints its treatment, and that no treatment paints a
  // background alone.
  for (const [treatment, tokens] of Object.entries(HIGHLIGHT_TOKENS)) {
    assert.ok(tokens.length >= 2, `${treatment} declares a single token — a background with nothing beside it`)
    const body = ruleBody(CSS, `.${HIGHLIGHT_CLASS[treatment]} {`)
    assert.ok(body, `.${HIGHLIGHT_CLASS[treatment]} is not defined in theme.css`)
    const drawn = tokens.filter((t) => body.includes(`var(${t})`))
    assert.deepEqual(drawn, tokens,
      `${treatment}: declared but never drawn by .${HIGHLIGHT_CLASS[treatment]}: ${tokens.filter((t) => !drawn.includes(t)).join(', ')}`)
    assert.ok(/background:/.test(body), `${treatment} paints no background at all`)
  }
})

test('every highlight token is defined on :root AND redefined under .proto-dark', () => {
  const light = ruleBody(CSS, ':root {')
  const dark = ruleBody(CSS, '.proto-dark {')
  assert.ok(light && dark, 'theme.css lost :root or .proto-dark')
  for (const token of Object.values(HIGHLIGHT_TOKENS).flat()) {
    assert.match(light, new RegExp(`${token}\\s*:`), `${token} is not defined on :root`)
    assert.match(dark, new RegExp(`${token}\\s*:`),
      `${token} is not redefined under .proto-dark — it keeps its LIGHT value while the app looks dark`)
  }
})

test('a token never resolves to the same value in both themes', () => {
  // If the dark block merely restated the light value, the redefinition above would pass while
  // changing nothing — the exact "it is defined, therefore it works" gap.
  const light = ruleBody(CSS, ':root {')
  const dark = ruleBody(CSS, '.proto-dark {')
  const valueOf = (body, token) => (new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(body) || [])[1]
  for (const token of Object.values(HIGHLIGHT_TOKENS).flat()) {
    const l = valueOf(light, token)
    const d = valueOf(dark, token)
    assert.ok(l && d, `${token} has no value in one of the two themes`)
    assert.notEqual(l.trim(), d.trim(), `${token} is identical in light and dark — the dark block is decorative`)
  }
})

test('within a theme the two highlights are different colours AND different treatments', () => {
  // Different hue alone is not enough: two treatments that differ only in hue are ONE treatment to
  // a reader who cannot separate those hues. The keyword is a filled highlight; the posting echo
  // is a wash under a rule. So the two rules must not have the same shape either.
  for (const [name, sel] of [['light', ':root {'], ['dark', '.proto-dark {']]) {
    const body = ruleBody(CSS, sel)
    // Assert the token is THERE before reading it. Reading first threw a TypeError when a token
    // was missing, which fails the test but reports "cannot read properties of undefined" instead
    // of naming the token that vanished - a guard whose failure message does not name the cause
    // costs the next reader the diagnosis this file exists to hand them.
    const valueOf = (t) => {
      const m = new RegExp(`${t}\\s*:\\s*([^;]+);`).exec(body)
      assert.ok(m, `${name}: ${t} is not defined at all`)
      return m[1].trim()
    }
    assert.notEqual(valueOf('--qc-kw-bg'), valueOf('--qc-echo-bg'),
      `${name}: the keyword highlight and the posting echo paint the same background`)
  }
  const kw = ruleBody(CSS, `.${HIGHLIGHT_CLASS.keyword} {`)
  const echo = ruleBody(CSS, `.${HIGHLIGHT_CLASS.postingEcho} {`)
  assert.ok(kw && echo, 'one of the two highlight classes is missing from theme.css')
  assert.match(kw, /background:\s*var\(--qc-kw-bg\)/)
  assert.match(kw, /color:\s*var\(--qc-kw-fg\)/, 'the keyword highlight must carry its own ink, not inherit --proto-ink')
  assert.match(echo, /background:\s*var\(--qc-echo-bg\)/)
  assert.match(echo, /border-bottom:[^;]*var\(--qc-echo-rule\)/, 'the posting echo is an UNDERLINE — its rule token must be drawn')
  assert.ok(!/border-bottom/.test(kw), 'the keyword highlight has grown the echo\'s rule — the two treatments have converged')
})

// ── nothing paints a highlight by hand ──────────────────────────────────────────────────────────

test('no module contains a highlight swatch, in any spelling of the same colour', () => {
  // Three holes, all found by a verifier against the first version of this guard:
  //   1. it scanned .jsx ONLY, so `export const KW_SWATCH = '#fff03a'` in postingAnalysis.js — a
  //      .js module — passed. That is the exact literal D11 names as the defect.
  //   2. `'rgb(255, 240, 58)'` is #fff03a written another way and was not matched at all.
  //   3. `'#fff03b'` is one digit off and indistinguishable on screen.
  // So the guard no longer matches SPELLINGS. It extracts every colour literal in the file,
  // canonicalises it to r/g/b, and measures distance to each swatch.
  //
  // THRESHOLD EVIDENCE (measured over all of src/ at 6f6a0b3, both file types): the nearest
  // non-swatch colour in the entire codebase is #ffe in RolesTitles.jsx at 24.2; the next are
  // #f6f6f6 at 28.7 and #333 at 31.8. #fff03b is at 1.0. A cutoff of 12 catches the near-miss with
  // room to spare and still leaves a 2x margin under the closest legitimate colour, so it cannot
  // cry wolf on code that is right.
  const NEAR = 12
  const swatches = HIGHLIGHT_LITERALS.map(rgbOf)
  for (const file of MODULES) {
    if (file === join(SRC, 'highlight.js')) continue   // the declaration itself
    const code = stripComments(readFileSync(file, 'utf8'))
    for (const { text, rgb } of colorsIn(code)) {
      for (let i = 0; i < swatches.length; i++) {
        const d = distance(rgb, swatches[i])
        assert.ok(d > NEAR,
          `${file.slice(SRC.length)} contains ${text} — that is ${d === 0 ? 'exactly' : `within ${d.toFixed(1)} of`} `
          + `the highlight swatch ${HIGHLIGHT_LITERALS[i]}, which belongs to theme.css as a token`)
      }
    }
  }
})

test('no custom-property name is assembled at runtime, in any form', () => {
  // P0.3: `var(--qc-kw-${tone})` is not an error. CSS drops a declaration it cannot parse without
  // a word of warning, so the rule simply does not appear — which is how the `todo` pill became
  // invisible.
  //
  // THIS GUARD WAS REWRITTEN. The first version matched ONE spelling — /var\(--[a-z0-9-]*\$\{/ —
  // and a verifier walked through it five different ways, every one of them valid CSS confirmed in
  // real Chromium:
  //     background: `var( --temp-${k}-tint )`      whitespace inside var()
  //     background: `var(\n  --temp-${k}\n)`       a newline inside var()
  //     background: `var(--my_prop-${k})`          _ in the name; [a-z0-9-]* excludes it
  //     background: 'var(--temp-' + k + '-tint)'   built by string concatenation
  //     const p = `--temp-${k}`; `var(${p})`       name built first, wrapped after
  // Enumerating five more alternatives would leave a sixth. So this no longer describes what is
  // FORBIDDEN. It parses each `var(` — brace-matching to that call's own closing paren — and
  // requires the NAME to be a plain custom-property identifier and nothing else. A whitelist has
  // no sixth spelling to miss: whitespace, newlines, quotes, `+` and `${` all fail it identically,
  // while a legitimate `var(--x)` and a legitimate fallback `var(--x, var(--y))` pass untouched.
  for (const file of MODULES) {
    const code = stripComments(readFileSync(file, 'utf8'))
    for (const call of varCalls(code)) {
      assert.match(call.name, /^\s*--[A-Za-z0-9_-]+\s*$/,
        `${file.slice(SRC.length)}:${call.line} builds a custom-property name at runtime: var(${call.name.trim()})`)
    }
    // And the same name assembled BEFORE it is wrapped — `const p = `--temp-${k}`` — which is a
    // var() whose own argument looks innocent by the time it is written.
    const built = /--[A-Za-z0-9_-]*\$\{/.exec(code)
    assert.equal(built, null,
      `${file.slice(SRC.length)}: a custom-property name is assembled before it reaches var(): "${built && built[0]}"`)
  }
})

test('every consumer paints through HIGHLIGHT_CLASS, never a hand-typed class name', () => {
  // The first version required the `className="..."` form, so `className={"qc-kw"}` and
  // `className={`qc-kw ${x}`}` both walked past it. (A verifier's first attempt LOOKED caught —
  // but the failure it saw was the collateral "both treatments are used" check at the bottom of
  // this test, not the hand-typing assertion.)
  //
  // Matching more className spellings is the same losing game as the var() guard above, so this
  // does not look at className at all. There is NO legitimate reason for the token `qc-kw` or
  // `qc-echo` to appear anywhere in a module except the one line of highlight.js that declares it
  // — not in a className, not in a querySelector, not in a string being concatenated. Absence is
  // the rule, and absence has only one spelling.
  for (const file of MODULES) {
    if (file === join(SRC, 'highlight.js')) continue   // the declaration itself
    const code = stripComments(readFileSync(file, 'utf8'))
    for (const cls of Object.values(HIGHLIGHT_CLASS)) {
      const hit = new RegExp(`(^|[^\\w-])${cls}([^\\w-]|$)`).exec(code)
      assert.equal(hit, null,
        `${file.slice(SRC.length)} names the class "${cls}" directly — it must come from `
        + 'HIGHLIGHT_CLASS so the class and the stylesheet cannot drift apart')
    }
  }
  // Both treatments are used, or the pair that is not used is a colour nobody can see is wrong.
  const all = MODULES.map((f) => readFileSync(f, 'utf8')).join('\n')
  assert.match(all, /HIGHLIGHT_CLASS\.keyword/)
  assert.match(all, /HIGHLIGHT_CLASS\.postingEcho/)
  const users = MODULES.filter((f) => readFileSync(f, 'utf8').includes('HIGHLIGHT_CLASS.'))
  assert.ok(users.length >= 2, `both highlights must actually be used; found ${users.length} consumer(s)`)
})

// ── markRuns: the posting's wording marked INSIDE the draft ──────────────────────────────────────
//
// The gap this closes: the prototype marks echoes in the draft text (`Marked`, qc/assets.jsx:8) and
// the app painted both treatments ONLY in margin quotes and on the JD step — every HIGHLIGHT_CLASS
// call site was one of those, and BlockBody rendered row.after_text as a bare string. The margin
// was a set of pointers into a sentence that was never marked.
import { markRuns } from '../src/highlight.js'

const joined = (runs) => runs.map((r) => r.t).join('')
const marked = (runs) => runs.filter((r) => r.mark).map((r) => r.t)

test('H:mark-is-lossless: the segments always rebuild the original text exactly', () => {
  // A renderer walks these segments to draw the field. If they do not concatenate back to the input,
  // the draft the owner reads is not the draft that was generated — silently, with no error.
  for (const [text, phrases] of [
    ['Led safety-critical systems work across three teams.', ['safety-critical']],
    ['nothing to mark here', ['absent']],
    ['', ['x']],
    ['edge', []],
    ['Safety-critical at the start', ['safety-critical']],
    ['ends with safety-critical', ['safety-critical']],
  ]) {
    assert.equal(joined(markRuns(text, phrases)), text, `lost text for ${JSON.stringify(text)}`)
  }
})

test('H:mark-is-exact-never-fuzzy: a highlight is an accusation and must not guess', () => {
  // Standing rule: fuzzy matching is for RANKING, never for ACCUSING. Marking says "these words came
  // from the employer's ad" — painting the writer's own sentence as borrowed is worse than painting
  // nothing, so only exact runs are marked. Case is the one thing ignored, because the generator
  // re-cases a phrase at a sentence start.
  assert.deepEqual(marked(markRuns('we ship Safety-Critical systems', ['safety-critical'])),
    ['Safety-Critical'], 'case must not prevent a match')
  assert.deepEqual(marked(markRuns('we ship safety critical systems', ['safety-critical'])), [],
    'a near miss (hyphen dropped) must NOT be marked')
  assert.deepEqual(marked(markRuns('delivery velocity', ['deliver'])), ['deliver'],
    'a substring match is exact by definition and is marked')
  assert.deepEqual(marked(markRuns('anything', [''])), [], 'an empty phrase marks nothing')
  assert.deepEqual(marked(markRuns('anything', ['a'])), [], 'a single character is not a phrase')
})

test('H:mark-longest-first: a shorter phrase never splits a longer one', () => {
  // Given both `safety-critical` and `safety-critical systems`, taking the shorter first consumes
  // the head of the longer and leaves ` systems` unmarked — one echo rendered as a marked half and
  // an unmarked half, which reads as two different findings.
  const runs = markRuns('we build safety-critical systems daily',
    ['safety-critical', 'safety-critical systems'])
  assert.deepEqual(marked(runs), ['safety-critical systems'])
  assert.equal(joined(runs), 'we build safety-critical systems daily')
})

test('H:mark-every-occurrence-once: repeats are all marked, and never overlap', () => {
  const runs = markRuns('cloud native and cloud native again', ['cloud native'])
  assert.deepEqual(marked(runs), ['cloud native', 'cloud native'])
  // No segment may be emitted twice, which is what an overlap would do to the rebuilt text.
  assert.equal(joined(runs), 'cloud native and cloud native again')
})

test('H:mark-renders-in-the-draft: the wiring exists, not just the function', () => {
  const src = readFileSync(new URL('../src/screens/AssetBlocks.jsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  // BlockBody used to render `{row.after_text}` bare. Every shape that prints draft text must go
  // through the marker, or the margin points at nothing again.
  // COUNTED, not merely present. There are TWO shapes that print `row.after_text` — the pipe run
  // and the prose block — and asserting the marker "appears" passes while one of them is reverted
  // to a bare `{row.after_text}`. Whitespace also defeats an inline `>{row.after_text}<` regex,
  // which is how this guard first passed a mutation that unmarked half the drafts.
  assert.equal((src.match(/<Marked text=\{row\.after_text\} phrases=\{phrases\} \/>/g) || []).length, 2,
    'both draft shapes (pipe and prose) must render through the marker')
  assert.ok(!/\{row\.after_text\}(?!\s*phrases)/.test(src.replace(/<Marked text=\{row\.after_text\} phrases=\{phrases\} \/>/g, '')),
    'a draft shape still renders after_text unmarked')
  assert.match(src, /<Marked text=\{line\.text\} phrases=\{phrases\} \/>/, 'list items must mark too')
  assert.match(src, /phrases=\{wording\}/, 'the marker must be fed the kept phrases for THIS field')
})
