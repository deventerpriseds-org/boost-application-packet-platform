# AC brief — the headline-recount guard (ACT-70)

**Tier 1.** The thing being built ASSERTS A COVERAGE COUNT and decides a CI gate, which is the
definition of accusation-grade in this repo's tier table. Write acceptance criteria BEFORE any code
is written, and publish a FEASIBILITY table first.

## The problem, measured — not hypothetical

`docs/qc-evidence/PROTOTYPE-COVERAGE.md` carries ONE hand-maintained headline in its `13-CURRENT`
block (currently *"169 of 182 prototype elements present (92.9%)"*) beside ~216 verdict rows that
several parallel lanes move independently.

On 2026-09-02 the headline collided **three times in one afternoon**:

| Lane | Its figure | Correct against |
|---|---|---|
| `jd` render pass | earlier figure | its own base |
| `cover`/asset pass | 167 / 182 | its own base |
| QC + Review-and-send pass | 166 / 183 | its own base |
| **merged recount** | **169 / 182** | the merged tree |

Every lane was right about its own tree and every merge conflict landed on that block. The merged
number is always HIGHER than any lane reports, because row moves are additive.

The same defect has ALREADY occurred twice inside the file in its non-concurrent form: the §4.8 and
§4.10 section tallies each contradicted the very table printed above them — §4.10 read *"2 BUILT
(25%) … the weakest section in the spec"* while all eight of its rows carried BUILT with a
`file:line`.

## EXTEND, DO NOT DUPLICATE — this is the most important constraint

`app/test/prototypeCoverage.test.mjs` (122 lines) **already exists** and already contains:

- `parse()` — returns every `| <section>-<n> |` row with its verdict resolved. It scans each cell
  and takes the first that `startsWith` a verdict token, after stripping `*` and `_`.
- `VERDICTS` — the token list, including the spaced variants.
- `checkOf(row)` — the `check: absent <path> <pattern>` grammar.
- Five H-cases, including `H:coverage-every-row-parses`, which exists because an earlier parser
  silently dropped 34 rows and reported 129 BUILT against a real 151.

**The guard belongs in that file and MUST reuse `parse()`.** A second parser is exactly the
"parallel system" the repo's rules forbid, and two parsers that disagree is a worse failure than no
guard at all.

## A discrepancy the ACs must resolve rather than paper over

There are TWO counting methods in play and they are not obviously identical:

- `parse()` (the running code): first cell that `startsWith` a verdict token.
- The method §13-CURRENT *states* it uses: **4th cell, verdict token appearing EARLIEST in the
  cell**.

`13-CURRENT` also records that a containment-based variant produced a false `134/181` with 18
phantom ABSENT rows. **State whether the two methods agree on the current file, and say what the
guard should do if they ever diverge.** Do not assume they agree.

## Also in scope for the ACs

- The denominator is not constant: it moved `183 -> 182` when `4.4-8` closed as DELIBERATE, because
  DELIBERATE rows are excluded per §0. `NOT-IN-PROTOTYPE` and `OUT-OF-SCOPE` are excluded too.
- The file contains SEVERAL count-bearing blocks, not just `13-CURRENT`: `13a` (a deliberately
  FROZEN historical figure, which must NOT be flagged), the per-section tallies (`§4.8 tally — …`),
  and `13b`. Say precisely which are in scope. Flagging the frozen historical block would be a
  cry-wolf failure the repo explicitly forbids.
- The failure message must name the stated figure, the computed figure, and the delta — a guard
  whose message does not tell you what to change is a guard people learn to ignore.

## Deliverables

1. A FEASIBILITY table (Dependency | Producer | Consumer | Proof (command + result) | EXISTS /
   ABSENT / EXISTS-BUT-CONSTRAINED). `ALREADY BUILT` is a first-class verdict — if any part of this
   guard already exists, say so FIRST.
2. Numbered, binary acceptance criteria in `Given / when / then` form. "Works correctly" is not an
   AC.
3. A named MUTATION for each AC: the exact edit that should make the suite FAIL. An inert guard is
   worse than no guard because it is believed.
4. Explicitly state anything you believe should NOT be built, and why.

**Write your findings incrementally to `docs/qc-evidence/AC-headline-recount-guard.md` as you go —
append section by section, do not hold everything for a final answer.**
