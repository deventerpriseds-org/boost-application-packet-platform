// The top bar's page-actions slot, and the one screen that uses it.
//
// WHY THIS FILE EXISTS. "+ Add job" shipped owning a full-width row of its own directly under the
// header, to hold a single right-aligned button. The owner sent a phone screenshot of that row and
// said: "Move the add button to the right on the top row." On a 390px viewport the row cost ~56px
// of vertical space above the fold, where the stage funnel and the first job row compete for every
// pixel.
//
// Three things can silently undo that, and none of them fails a build:
//   1. the trigger drifts back onto the page,
//   2. the portal target is resolved during RENDER, which returns null on the first pass with no
//      re-render to correct it -- the button then never appears at all, on any screen,
//   3. the slot id is typed as a literal in a screen, so a rename in shell.jsx leaves that screen
//      portalling into a node that does not exist.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shell = readFileSync(new URL('../src/shell.jsx', import.meta.url).pathname, 'utf8')
const opps = readFileSync(new URL('../src/screens/Opportunities.jsx', import.meta.url).pathname, 'utf8')

test('H:add-job-trigger-lives-in-the-top-bar: not in a page row of its own', () => {
  // (1) The trigger is inside the slot component, not loose in the page tree.
  assert.match(opps, /<TopBarActions>\s*\n\s*<button className="px-btn px-btn-accent" data-qc="add-job-open"/,
    'the + Add job button must render inside <TopBarActions>, not as a page-level element')

  // (2) THE LOAD-BEARING ONE: no page-level right-aligned wrapper around the trigger. This is the
  //     exact construct that was removed, and the one a later edit would most naturally reinstate.
  assert.ok(!/justifyContent: 'flex-end' \}\}>\s*\n\s*<button[^>]*data-qc="add-job-open"/.test(opps),
    'the trigger must not sit in its own flex-end row on the page -- that is the row the owner asked to reclaim')

  // (3) It renders in BOTH states. `if (!open) return trigger` covers closed; the open panel must
  //     also render it, or the control vanishes at the moment it is used.
  const triggerRenders = (opps.match(/\{trigger\}/g) || []).length
  assert.equal(triggerRenders, 1, 'the open panel must render {trigger} exactly once')
  assert.match(opps, /if \(!open\) return trigger/,
    'the closed state must return the trigger alone, so no empty box lands in the page flex column')

  // (4) Closed state puts NO box in the page column. A wrapper div here would re-introduce the
  //     parent's 16px gap and leave a phantom row exactly where the old one was.
  assert.ok(!/if \(!open\) return \(\s*\n\s*<div/.test(opps),
    'the closed state must not render a wrapper element -- that recreates the gap the move removed')
})

test('H:topbar-slot-is-resolved-in-an-effect: never read during render', () => {
  // The slot id is a shared constant, consumed by the slot div itself.
  assert.match(shell, /export const TOPBAR_ACTIONS_ID = 'ee-topbar-actions'/,
    'the slot id must be an exported constant, so a rename cannot orphan a screen')
  assert.match(shell, /<div id=\{TOPBAR_ACTIONS_ID\}/,
    'the slot div must use the constant, not a re-typed string literal')

  // THE BUG THIS GUARDS: `document.getElementById` during render returns null on the first pass and
  // React never re-renders to correct it, so the button silently never appears. It must be read in
  // an effect and held in state.
  const fn = shell.slice(shell.indexOf('export function TopBarActions'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.match(body, /useEffect\(\(\) => \{ setNode\(document\.getElementById\(TOPBAR_ACTIONS_ID\)\) \}, \[\]\)/,
    'the node must be resolved inside useEffect and stored in state')
  assert.ok(!/const node = document\.getElementById/.test(body),
    'the node must NOT be read during render -- that returns null on the first pass and never recovers')
  assert.match(body, /return node \? createPortal\(children, node\) : null/,
    'render null until the node resolves, rather than portalling into null')
})
