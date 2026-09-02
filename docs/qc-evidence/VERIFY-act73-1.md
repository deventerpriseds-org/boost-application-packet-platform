# VERIFY-act73-1 — Independent verifier pass, loop 1

Repo: `/home/user/boost-application-packet-platform`, branch `claude/eds-skills-setup-summary-ngpaos`
(HEAD `4672e0e`, in sync with origin at time of verification).

This is loop 1: no prior state, all claims derived from scratch. Written incrementally.

---
## C1 — five guards reuse `parse()`, exactly one row parser

**CONFIRMED.** `grep -n "function " app/test/prototypeCoverage.test.mjs` shows 4 functions total:
`parse()` (L40), `checkOf()` (L58), `currentBlock()` (L148), `recount()` (L159). Every one of the 5
new headline guards (`H:headline-block-is-findable`, `H:headline-matches-the-rows`,
`H:headline-percentages-follow-its-own-counts`, `H:headline-guard-window-excludes-the-frozen-blocks`,
`H:headline-guard-has-exactly-one-row-parser`) calls `currentBlock()` and/or `recount()`, and
`recount()` itself calls `parse()` at L160. `currentBlock()` does not parse rows — it only slices
text between headings. No guard reimplements the row regex. There is exactly one `function parse(`
in the file (L40).

## C2 — `H:headline-matches-the-rows` fails in BOTH directions

**CONFIRMED**, by mutation via `mutate.sh` (not by reading — actually reinstated the defect and
watched the suite fail):

- Direction A (headline edited, rows untouched): mutated `169 of 182 ... (92.9%)` →
  `170 of 182 ... (93.4%)`. Result: `FIRED`.
- Direction B (a row's verdict moved, headline untouched): mutated row `4.1-1` from `BUILT` to
  `PARTIAL`. Result: `FIRED`.

Both restores verified clean against HEAD by the harness.

## C3 — scan window covers `13-CURRENT` only, does not flag frozen content

**CONFIRMED.**
1. Baseline: `node --test app/test/prototypeCoverage.test.mjs` on unmutated source — all 10 tests
   pass, including `H:headline-guard-window-excludes-the-frozen-blocks`. Since the document currently
   contains both `148 of 183` (13a) and `83 of 84` (13-RENDER) verbatim, and the test still passes,
   the guard is not firing on that correct content today.
2. Verified the boundary is load-bearing, not incidental: `currentBlock()` (L148-157) stops the slice
   at the FIRST following `### ` heading. Headings via `grep -n "^### "`: `13-CURRENT` at L563,
   `13-RENDER` at L642 — the very next `### `. So the window is L563-641 and structurally cannot
   include 13a (L749) or 13-RENDER's own content.
3. Attacked it directly: mutated `currentBlock()` to widen the window to the SECOND following `### `
   heading (swallowing 13-RENDER's `83 of 84` into the slice). Result: `FIRED` — the guard correctly
   caught the widened window pulling in frozen content it must not touch.

## C4 — `H:headline-percentages-follow-its-own-counts` catches percentage drift

**CONFIRMED** by mutation. Changed `**BUILT** | **169** | **92.9%**` → `**169** | **95.0%**` (count
left alone, percentage drifted from what `169/182` actually computes to). Result: `FIRED`.

## C5 — `H:headline-block-is-findable` fails when the anchor is renamed/deleted

**CONFIRMED** by mutation. Renamed `### 13-CURRENT.` → `### 13-RENAMED.`. Result: `FIRED` — the
guard does not silently pass when it cannot find its target; it fails loudly, which is the "absent
evidence is not a pass" property the brief asked for.

## C6 — mutation-proof, re-run independently, and an attempt to break each guard beyond the author's own tests

Re-ran `mutate.sh` myself (not trusting the PR's reported outcomes) for every guard above; all
`FIRED` as shown in C2-C5.

**`H:headline-guard-has-exactly-one-row-parser`, specifically:**
- Re-ran the documented v3 case: inserted a second function `secondParser()` under a DIFFERENT name,
  reimplementing the row match with the exact literal regex `/^\|\s*(\d+\.\d+)-(\d+)\s*\|/` (same
  escaping as the real parser). Result: `FIRED`. Confirms v3 is not vacuous for the case it was
  written to catch.
- **Attempted to break it beyond what the author tested — and found a real gap.** Inserted a second
  parser using a *behaviourally identical* but differently-escaped regex,
  `/^\|\s*([0-9]+\.[0-9]+)-([0-9]+)\s*\|/` (character class instead of `\d`). This is not a
  behaviourally-inert mutation — `[0-9]` and `\d` match identically for ASCII digits in JS without
  the `/u` flag, so this is a second, functioning row parser that would genuinely drift from `parse()`
  independently, exactly the risk the guard's own comment says it exists to catch ("a second parser
  under a different name that re-implements the row regex and drifts"). Result: **`INERT`** — the
  guard's needle is the LITERAL substring `(\d+\.\d+)-`, so any reimplementation using different
  regex syntax for the same match (character classes, non-capturing groups, a differently-ordered
  alternation, etc.) is invisible to it.

  **This is a genuine, reportable limitation, not a mutate.sh false negative.** The guard's docstring
  already hints at narrowness ("assembled from two halves so it cannot appear contiguously... except
  where a real parser writes it") but does not disclose that the narrowness extends to ANY syntactic
  rewrite of the same regex, not just accidental self-matches. The guard proves "no second copy of
  this exact string," which is a real but strictly weaker property than "no second parser." Given
  this is TIER 1 (a coverage-count / CI-gate guard), flagging it rather than silently accepting the
  brief's framing.

