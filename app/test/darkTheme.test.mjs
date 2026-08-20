// Dark mode ran on a THIRD of its palette for as long as it has existed, and nothing caught it.
//
// `tokens/fig-tokens.css` defines the dark palette on `:root[data-theme="dark"], .dark`.
// `state.jsx` toggled only `.proto-dark`, which matches neither selector — so those 104 tokens
// never applied, and every token outside the 33 that `theme.css`'s hand-written `.proto-dark`
// block happens to redefine kept its LIGHT value while the app looked dark.
//
// The visible symptom was an accent pill at 1.90:1 (dark teal on near-black teal) across 15+
// sites: `--surface-brand-subtle` is one of the 33 and went near-black, `--surface-brand-default`
// is one of the missing 71 and stayed mid-dark. Fixing the pill would have left the other 70.
//
// The invariant is about the WIRING, not the pill: whatever the app sets to mean "dark" must
// match a selector that actually defines the dark palette.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const darkBlock = (css, sel) => {
  const i = css.indexOf(sel)
  if (i === -1) return null
  const open = css.indexOf('{', i)
  let depth = 0
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++
    else if (css[j] === '}' && --depth === 0) return css.slice(open + 1, j)
  }
  return null
}

test('the palette really does define a dark block, on a data-theme selector', () => {
  const body = darkBlock(read('src/tokens/fig-tokens.css'), ':root[data-theme="dark"]')
  assert.ok(body, 'the dark palette block disappeared from fig-tokens.css')
  const count = (body.match(/--[\w-]+:/g) || []).length
  assert.ok(count > 50, `the dark palette should define the full set; found ${count}`)
})

test('the app sets the attribute that palette is keyed on — not only a class it ignores', () => {
  const s = read('src/state.jsx')
  assert.match(s, /setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]dark['"]\s*\)/,
    'dark mode must set data-theme="dark", or the 104-token Compass dark palette never applies')
  assert.match(s, /removeAttribute\(\s*['"]data-theme['"]\s*\)/,
    'and it must be removed on the way back to light, or the app is stuck dark')
})

test('the hand-written .proto-dark patch is a SKIN, never the whole palette', () => {
  // If someone deletes the data-theme line and "fixes" dark mode by growing this block instead,
  // that is the duplicate-palette failure this repo's extend-don't-duplicate rule forbids. The
  // guard is the ratio: the patch must stay far smaller than the palette it sits on top of.
  const patch = darkBlock(read('src/theme.css'), '.proto-dark')
  assert.ok(patch, '.proto-dark disappeared')
  const patchCount = (patch.match(/--[\w-]+:/g) || []).length
  const paletteCount = (darkBlock(read('src/tokens/fig-tokens.css'), ':root[data-theme="dark"]').match(/--[\w-]+:/g) || []).length
  assert.ok(patchCount < paletteCount * 0.75,
    `.proto-dark defines ${patchCount} of ${paletteCount} palette tokens — it is becoming a second palette`)
})
