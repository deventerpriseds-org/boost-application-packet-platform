# VERIFY — PR #58 / `claude/three-small-ui-gaps` @ `b6a2f03`

Independent verifier. No shared context with the implementing session. Every line below is
something I ran or read, with the output pasted.

Baseline:

```
$ git rev-parse HEAD
b6a2f03997504366d0e66748b8882cf94fcad5d3
$ git rev-parse --abbrev-ref HEAD
claude/three-small-ui-gaps
$ git status --porcelain
(clean)
$ git log --oneline -3
b6a2f03 Close D:jd-evidence-has-no-field-link - 4.1-20 built the hop it defers
87eaa0e SPEC 4.11: the caveat and the two missing quick actions, in place - no panel
da07ec0 Track the 4.11 scope decision and the precedence-chain root cause
$ git log --oneline -1 origin/main
605c9d8 Tracker: the verifier's three findings, and the doubles rule they earned
```

`git diff --stat origin/main...HEAD` — 16 files, 2588 insertions. Production code touched:
`app/src/assetBlocks.js` (+121), `app/src/postingAnalysis.js` (+43), `app/src/qcRail.js` (+92),
`app/src/screens/AssetBlocks.jsx` (+76), `app/src/screens/PacketBuilder.jsx`,
`app/src/screens/PostingAnalysis.jsx`, `scripts/render-spec.mjs`.

---

## C1 — `omitListCaveat` renders nothing unless an exact rule-driven omit-list row exists

**Status: CONFIRMED** (evidence below; see F-1 for the one qualification).

### The producer, read at source

`api/src/functions/tests/swaps.ts:229-235` — the ONLY `driver: 'rule'` write in `api/src`:

```ts
} else if (onOmitList(o, omitted)) {
  swaps.push({
    list, action: 'dropped', from_label: o, to_label: null, requirement_seq: null,
    verbatim_quote: null, confidence: 0, driver: 'rule',
    rationale: 'on the owner do-not-use list (MasterContext.itemsToOmit)',
  })
```

`grep -rn "driver:" api/src --include=*.ts` returns 5 hits: this one, the `Driver` type, a comment,
and `row()` at :279 which can only emit `'owner' | 'posting' | 'unattributed'`. So `driver:'rule'`
has exactly one producer.

`grep -rn "on the owner do-not-use list" api/src app/src app/test api/test` returns exactly two:

```
api/src/functions/tests/swaps.ts:234:          rationale: 'on the owner do-not-use list (MasterContext.itemsToOmit)',
app/src/assetBlocks.js:544:export const OMIT_LIST_RATIONALE = 'on the owner do-not-use list (MasterContext.itemsToOmit)'
```

Byte-identical. The app's filter is
`s.action === 'dropped' && s.driver === 'rule' && s.rationale === OMIT_LIST_RATIONALE` —
`===` on the whole string, no `includes`, no normalisation, no similarity call.

The row reaches the client intact: `appSwaps.ts:102` selects `s.*` from `swap_decision`, and
`schema.ts:578` declares `rationale text`, so `action`/`driver`/`from_label`/`rationale` arrive in
snake_case exactly as the app reads them.

### C1 — adversarial probe (ran it, output pasted)

Fifteen inputs designed to make a caveat appear when it should not. All returned `null` except the
true positives:

```
empty => null                          near-miss "do not use" => null
undefined => null                      rationale + trailing space => null
null => null                           rationale uppercase => null
non-array string => null               driver model => null
action swapped => null                 driver undefined => null
from_label blank ("   ") => null       from_label missing => null
TRUE POSITIVE => "The last run took \"Agile\" out of this list because it is on your do-not-use
                  list. Putting it back by hand may not stick: that list is applied again on every
                  run. Edit the list in Settings if it belongs here."
```

**Status: CONFIRMED for the row-shape claim.** I could not construct a near-miss that fires.
One caveat found on the input *supply* side, reported as F-1 below — it is not about the filter.

## C2 — the copy states what is known

**Status: CONFIRMED (with F-1 attached).** `app/src/assetBlocks.js:557-560`, read verbatim:

> The last run took "Agile" out of this list because it is on your do-not-use list. Putting it back
> by hand may not stick: that list is applied again on every run. Edit the list in Settings if it
> belongs here.

Past tense for the event ("The last run took"), hedged for the consequence ("**may** not stick"),
and the only forward statement is about the rule's persistence ("that list is applied again on every
run"), which is a property of `swaps.ts:229` running unconditionally on every pass — not a
prediction about a specific phrase. No "the next run will drop it". The test asserts
`doesNotMatch(/next run will/)`.

## F-1 (FINDING, affects C1 + C2 + C3) — the swaps handed to these functions are NOT loop-scoped

Observation, from `app/src/screens/AssetBlocks.jsx`:

```
1154:  const allSwaps = (provenance && provenance.swaps && provenance.swaps.swaps) || []
1156:  const rows = useMemo(() => latestRows(state.data), [state.data])     // insertions ARE loop-filtered
1159:  const scopedSwaps = useMemo(() => scopeSwaps(allSwaps, listsInAsset), ...)
```

`latestRows` (`assetBlocks.js:257`) filters insertions to `Number(r.loop) === Number(data.loop)`.
`scopeSwaps` (`assetBlocks.js:320`) filters on `list` **only** — there is no `loop` predicate in it.
And `provenance.swaps.swaps` is documented by the API itself as every pass:

`api/src/functions/tests/appSwaps.ts:113-118`
> `swaps` is EVERY pass (the audit trail); `current` is the latest pass alone (what the packet says
> now). A caller reading the full array as if it were one pass double-counts as soon as a second
> pass exists, which P3 makes routine.

The API returns `current` in the same payload. The app reads `swaps`.

Producible: `appSwaps.ts:55` is `delete from swap_decision where packet_id=$1 and loop=$2` — it
clears only the loop being rebuilt, so earlier loops persist by design.

Measured consequence:

```
scopeSwaps([{list:'skills_1',loop:1,action:'dropped',driver:'rule',...,rationale:R},
            {list:'skills_1',loop:2,action:'kept',driver:'posting',...}], ['skills_1'])
  => [{loop:1,action:"dropped"},{loop:2,action:"kept"}]      // both passes survive

omitListCaveat(<those two rows>)
  => "The last run took \"OldPhrase\" out of this list ..."
```

The last run **kept** it. On a two-loop packet where the owner edited their do-not-use list between
passes, the caveat asserts an event the last run did not perform — the sentence C2 is built to be
truthful about. The same rows drive `restoreOptions`, so a phrase loop 2 already restored is still
offered for restoring.

This is a pre-existing wiring shape (the "Why it changed" rationale list at `AssetBlocks.jsx:585`
reads the same unfiltered array) — but this PR is what attaches a run-specific factual claim to it.
Severity: real, needs a `loop` filter (or `provenance.swaps.current`) before the caveat is trusted
on multi-loop packets. Not a blocker for a single-loop packet, which is every packet until P3 runs.

## C3 — `restoreOptions` never offers an omit-list phrase

**Status: CONFIRMED for the shipped system, PARTIAL as a general invariant.**

`app/src/assetBlocks.js:582-590`:

```js
const labels = [...new Set(rows
  .filter((s) => s && s.action === 'dropped' && s.rationale !== OMIT_LIST_RATIONALE)
```

Probe output:

```
omit-list row only                       => []
same label dropped twice (rule + posting) => [{"label":"Agile", ...}]   <- see below
no args                                   => []
canEdit missing/false                     => []
```

The second line is correct, not a leak: a `driver:'posting'` drop of the same label is a genuine
model drop and the rationale on THAT row is not the omit rationale. The caveat also fires for the
same pair, so the reader sees both facts. Both filters read the same row array — they cannot
disagree about what was dropped.

**The asymmetry I did find.** `omitListCaveat` filters on `driver === 'rule'` **and** the rationale;
`restoreOptions` excludes on the **rationale only**. So a rule-driven drop carrying any *other*
rationale is invisible to the caveat **and** offered as a restore:

```
rule drop, DIFFERENT rationale => [{"label":"Agile","ask":"Put \"Agile\" back into this list. ..."}]
rule drop, rationale MISSING   => [{"label":"Agile", ...}]
rule drop, rationale null      => [{"label":"Agile", ...}]
```

That is precisely the self-undoing control C3 says is impossible. It is **not reachable today** —
`swaps.ts:233` is the only `driver:'rule'` writer and it always carries the literal — and
`H:omit-caveat-rationale-parity` does catch the *rewording* route to it (the assertion
`swapsSrc.includes("rationale: '<literal>'")` goes red the moment the api string changes).

What the guard does **not** catch is a *second* rule-driven drop added with a different rationale:
the guard counts occurrences of **that one literal**, not the number of `driver:'rule'` rows. A new
`swaps.push({... driver:'rule', rationale:'blocked by the owner term library'})` would leave the
guard green and put an omit-style phrase into "Put back X". Cheapest fix: make `restoreOptions`
exclude `s.driver === 'rule'` as well, which closes the class instead of the instance.

## C4 — `shortenAction`

**Status: CONFIRMED for the claim, with F-2 attached.** Probe:

```
no target        => {"ask":null,"reason":"This field has no stated length rule, so there is nothing to shorten it to."}
target ""        => {"ask":null,"reason":"This field has no stated length rule, ..."}
target+observed  => {"ask":"Shorten this field to fit its rule. It measures 70 words against 55-60 words. ..."}
target, no obs   => {"ask":"Shorten this field to fit its rule: 55-60 words. ..."}
canEdit false    => {"ask":null,"reason":null}
mergeField ''    => {"ask":null,"reason":null}
no args          => {"ask":null,"reason":null}
```

`ask` is built by interpolating the `observed`/`target` arguments — there is no template literal
carrying a hardcoded word count anywhere in the function. `AssetBlocks.jsx:581` passes
`observed`/`target`, which are the same values the block prints in its measurement line, so the
sentence cannot disagree with what is on screen.

## F-2 (FINDING, C4/C6) — `shortenAction().reason` is computed, tested, documented, and never rendered

`grep -n "shorten\." app/src/screens/AssetBlocks.jsx` returns only `shorten.ask` (720, 724, 725).
`shorten.reason` has no consumer anywhere in `app/src`.

The JSDoc at `assetBlocks.js:604` says:

> NO RULE, NO CONTROL. ... The reason is SAID rather than the control being silently absent,
> matching `keywordActions`.

`keywordActions` really does render its reason — `AssetBlocks.jsx:1024-1027`
(`if (act.reason) { return <div ...>{act.reason}</div> }`) — and so does `keywordSwapOptions`
(`:1012-1013`). `shortenAction` is the only one of the three whose reason is dropped on the floor.

So the shipped behaviour is: field with no length rule → **nothing at all**, not the stated
explanation. This is the write-only-field class the repo's own step-0b check #1 exists to catch
("who READS what you wrote?"), and the app test
`H:shorten-carries-the-real-rule-never-a-bare-template` asserts the reason's *text* without
asserting anyone renders it — a guard on a string with no consumer.

Not a correctness bug in what is displayed; it is a documented behaviour that does not exist.

## C5 — one `api.aiEditArtifact` call site in `AssetBlocks.jsx`

**Status: CONFIRMED.** `grep -n "aiEditArtifact" app/src/screens/AssetBlocks.jsx`:

```
548:  // the same box, the same `api.aiEditArtifact(..., { section })` route. Not a second edit path,
554:  // return - neither sends, and `api.aiEditArtifact` still has exactly one call site on this screen
714:            the wording stays the reader's to change and `api.aiEditArtifact` still has exactly one
756:                  await api.aiEditArtifact(artifactId, { instruction: ask.trim(), section: row.merge_field })
```

Three comments, one call — line 756, inside the ask box's Send handler. Both new controls call
`seedAsk(...)` only (`:724`, `:733`), which types into the box and opens it unsent. Repo-wide there
are other call sites (`QcRail.jsx:530`, `PacketBuilder.jsx:371`, `OppDetail.jsx:459`), all
pre-existing and outside this screen.

## C6 — no dead UI

**Status: CONFIRMED.** Every new control's render condition is an `&&` / `.map()` on a value that is
empty when there is nothing to act on — absent, never disabled, never a no-op:

```
720:  {shorten.ask && (            ...  Shorten to fit
729:  {restores.map((r) => (       ...  Put back "<label>"      // [] renders nothing
778:  {askSent && !askOpen && (    ...  Sent. "<ask>"
1069: {caveat.text && (            ...  the caveat
```

No `disabled=` attribute is introduced anywhere in the diff, and no `onClick` in the new code is a
toast/stub — `seedAsk` and `setAskSent(null)` are the only handlers. The one gap in the *stated*
design is F-2 above (the "no rule, so nothing to shorten to" explanation never renders).

## C7 — suites and build at `b6a2f03`

**Status: CONFIRMED.** Ran all three myself:

```
$ cd api && npm test        1..886   # tests 886  # pass 886  # fail 0   (6527ms)
$ cd app && npm test        1..372   # tests 372  # pass 372  # fail 0   (735ms)
$ cd app && npm run build   vite v5.4.21 ... 245 modules transformed ... built in 3.68s
                            dist/assets/index-GAf0gNLd.js 1,147.20 kB
```

Matches the commit messages' "api 886/886, app 372/372, app build green" exactly.

## C8 — the mutation that refused to prove

**Status: CONFIRMED, and the replacement guard is PARTIAL.**

I applied the mutation myself. `app/src/assetBlocks.js:549`, `s.driver === 'rule' &&` deleted:

```
$ cd app && npm test
1..372   # tests 372   # pass 372   # fail 0   (741ms)
```

**The claim is true.** Nothing in the suite can tell the two conditions apart, because the only
fixture that carries the rationale also carries `driver:'rule'`, and the only fixtures with a
different driver also carry a different rationale. It is behavioural equivalence, not a missing
assertion — the honest report the repo's own rule asks for. File restored, suite re-run, 372/372.

**Does `H:omit-caveat-rationale-parity` protect the assumption?** Partly. I mutation-tested the
guard in three directions rather than taking the commit message's word:

| mutation applied to `api/src/functions/tests/swaps.ts` | app suite | verdict |
|---|---|---|
| M1 — flip the producer's `driver: 'rule'` → `'posting'` | **fail=1**, `not ok 71 - H:omit-caveat-rationale-parity` | guard live |
| M2 — reword the rationale (`do-not-use` → `do not use`) | **fail=1**, same guard | guard live |
| M3 — **add a SECOND `driver:'rule'` drop with a different rationale** | **pass=372, fail=0** | **guard blind** |

M3 in full, so it cannot be dismissed as a non-compiling straw man — a new `else if` branch pushing
`{... action:'dropped', driver:'rule', rationale:'blocked by the owner term library'}`:

```
$ npx tsc --noEmit -p api/tsconfig.json   -> exit 0
$ cd api && npm test                      -> # tests 886  # pass 886  # fail 0
$ cd app && npm test                      -> # tests 372  # pass 372  # fail 0
```

The guard counts occurrences of **one literal** and checks the `swaps.push({` immediately before it.
A second rule-driven drop is outside both assertions. That is not hypothetical damage: rows from
that branch produce **no caveat** (rationale mismatch) **and** a "Put back X" control
(`restoreOptions` excludes on rationale only) — the self-undoing control C3 exists to forbid,
delivered through the one hole the guard leaves.

So: the assumption the guard names ("exactly one producer, on a `driver:'rule'` row") is only half
pinned. It pins *that producer*; it does not pin *that there is only one*. Making the assertion
`(swapsSrc.match(/driver: 'rule'/g) || []).length === 1` would close it in one line.

## C9 — ADVERSARIAL: delete each new load-bearing line, one at a time

19 single-line mutations to `app/src/assetBlocks.js`, each applied alone, `cd app && npm test` after
each, file restored between. **8 SURVIVED.** Full table:

| # | mutation | result |
|---|---|---|
| M-a | `omitListCaveat`: drop the `Array.isArray` guard | **SURVIVED** |
| M-b | `omitListCaveat`: drop the `s &&` null-row guard | **SURVIVED** |
| M-c | `omitListCaveat`: drop `action === 'dropped'` | CAUGHT (66) |
| M-d | `omitListCaveat`: drop `driver === 'rule'` | **SURVIVED** (= C8) |
| M-e | `omitListCaveat`: exact rationale → `.includes('do-not-use')` | **SURVIVED** |
| M-f | `omitListCaveat`: drop the blank-label `.filter(Boolean)` | **SURVIVED** |
| M-g | `omitListCaveat`: drop the `new Set` dedupe | **SURVIVED** |
| M-h | `omitListCaveat`: drop the empty-return (always emit text) | CAUGHT (66, 67) |
| M-i | `omitListCaveat`: singular/plural → always plural | **SURVIVED** |
| M-j | `restoreOptions`: drop `if (!canEdit) return []` | CAUGHT (69) |
| M-k | `restoreOptions`: drop the omit-list exclusion | CAUGHT (69) |
| M-l | `restoreOptions`: drop `action === 'dropped'` | **SURVIVED** |
| M-m | `restoreOptions`: drop the blank-label filter | **SURVIVED** |
| M-n | `shortenAction`: drop the `!canEdit` guard | CAUGHT (70) |
| M-o | `shortenAction`: drop the `!mergeField` guard | **SURVIVED** |
| M-p | `shortenAction`: drop the no-target early return | CAUGHT (70) |
| M-q | `shortenAction`: revert `ask` to the prototype's bare template | CAUGHT (70) |
| M-r | `restoreOptions`: drop the real label from the ask sentence | CAUGHT (69) |
| M-s | `omitListCaveat`: `may not stick` → `will be undone` | CAUGHT (67) |

### F-3 (FINDING, HIGH — M-e) — the "never fuzzily" guard cannot see a fuzzy implementation

Replacing

```js
s.rationale === OMIT_LIST_RATIONALE
```

with

```js
String(s.rationale||'').includes('do-not-use')
```

leaves **372/372 green** — including
`H:omit-caveat-matches-the-rationale-exactly-never-fuzzily: accusation-grade`, the test written to
forbid exactly this.

Why it is blind: both of its near-miss fixtures are
`OMIT_LIST_RATIONALE.replace('do-not-use','do not use')` and the bare string `'omit'`. Neither
contains the substring `do-not-use`, so a substring implementation returns `null` for both and the
assertions pass. The guard tests two *particular* near-misses, not the *property* of exactness.

This is the inert-guard class CLAUDE.md names ("an inert guard is worse than no guard, because it is
believed"), sitting on the single most accusation-grade line in the diff — the one that decides
whether the app tells the owner their own list will undo their edit. A rationale like
*"kept despite the do-not-use list"* would fire the caveat under the mutant and nothing would catch
it. Closing it needs one fixture that **contains** the literal without **equalling** it, e.g.
`rationale: OMIT_LIST_RATIONALE + ' (superseded)'` → expect `null`.

### F-4 (FINDING, MEDIUM — M-l) — `restoreOptions` offering to restore rows that were never dropped

Deleting `s.action === 'dropped'` from `restoreOptions` leaves the suite green. Without it, `kept`,
`swapped`, `added` and `merged` rows all become "Put back "X"" controls — a request to restore a
phrase that is already in the list. `omitListCaveat`'s equivalent line **is** guarded (M-c CAUGHT),
so this is an asymmetry in coverage between two functions written in the same commit: the fixture at
`assetBlocks.test.mjs:1114` contains only `dropped` rows, so the filter has nothing to do.

### F-5 (FINDINGS, LOW — M-a, M-b, M-f, M-g, M-i, M-m, M-o) — unguarded defensive lines

Each changes real behaviour and no test notices:

- **M-f / M-m** — `.filter(Boolean)` after `.trim()`. My probe shows `from_label: '   '` currently
  yields `null` / `[]`; without it the caveat renders `took "" out of this list` and a
  `Put back ""` control appears. Empty labels are producible: `from_label` is `o`, an item split out
  of a rendered list.
- **M-g** — the `new Set` dedupe. Two identical omit rows (two loops, same phrase — see F-1) render
  `took "Agile" and "Agile" out of this list`.
- **M-a / M-b** — the `Array.isArray` and `s &&` guards. Behaviour differs only for a non-array
  argument or a null row (both throw without them); neither is in a fixture.
- **M-i** — the singular/plural ternary; the test asserts three substrings that survive either form.
- **M-o** — `!mergeField`; every fixture passes one.

## C10 — `D:jd-evidence-has-no-field-link`

**Status: PARTIAL — the feature IS built; the "covered by qcRail.test.mjs" claim is only half true.**

**The hop is real.** Traced end to end, not inferred:

```
PacketBuilder.jsx:866-876   <PostingAnalysisCard ... swaps={provenance.swaps}
                              listOwners={listOwnersFromArtifacts(qcEntries)} onGoToField={goToField} />
PacketBuilder.jsx:441-448   withInsertions: activeStep === 'qc' || activeStep === 'jd'
PostingAnalysis.jsx:610     export function PostingAnalysisCard({ ... swaps, listOwners, onGoToField })
PostingAnalysis.jsx:645/650/652  <Group ... usageOf={usageOf} onGoToFieldRef={onGoToField} />
PostingAnalysis.jsx:501     <RequirementRow ... usage={usageOf ? usageOf(r) : null} onGoToFieldRef={...} />
PostingAnalysis.jsx:368     {usage && onGoToFieldRef && (   ...   onGoToFieldRef(usage.artifactId, usage.mergeField)
```

`listOwnersFromArtifacts` / `requirementUsage` exist in `app/src/qcRail.js` and are imported at
`PacketBuilder.jsx:16`. The no-dead-UI condition at `:368` is real. The row's closure is factually
correct: it was built, not hand-waved. The same props are also passed to `ProfileCompareCard`
(`:863-864`), a second consumer.

**The guard claim, tested.** `app/test/qcRail.test.mjs:1596-1638` does cover the two pure functions
(three tests: owners map, empty-not-partial, usage-null-unless-named). It does **not** cover the
wiring — and the wiring is where the defect the ledger row described actually lived. Five mutations,
each run alone with `npm test` **and** `npm run build`:

| mutation | app suite | build |
|---|---|---|
| W-1 revert `withInsertions` to `activeStep === 'qc'` — **the exact original defect** | **372/372 green** | ok |
| W-2b drop `listOwners={...}` from the `PostingAnalysisCard` call | **372/372 green** | ok |
| W-3b drop `onGoToField={goToField}` from the same call | **372/372 green** | ok |
| W-4 drop `onGoToFieldRef` from the Must-have `<Group>` | **372/372 green** | ok |
| W-5 drop the `usage &&` no-dead-UI condition at `:368` | **372/372 green** | ok |

W-1 is the finding. The closed row said the link "would be absent exactly where SPEC asks for it"
because the map was empty on the JD step; reverting one token restores that precise state with the
suite and the build green. W-5 is the second: the row's own acceptance sentence — *render the link
ONLY where a swap actually names the requirement (no dead UI)* — is enforced by nothing.

**Did closing the row silence a guard with no replacement?** The dropped `check:` was
`absent app/src/screens/PostingAnalysis.jsx onGoToField` — a *staleness* check that fires when the
feature IS built. It was never a regression guard, so dropping it loses nothing in that direction.
But the row was closed on the strength of "qcRail.test.mjs already asserts both derivations", and
the derivations are not what breaks. The repo already has the right pattern in the same file —
`qcRail.test.mjs:1004-1009` source-greps `QcRail.jsx` for `onGoToField` on every tab — so an
equivalent grep over `PacketBuilder.jsx` / `PostingAnalysis.jsx` plus one on the `jd` step in
`withInsertions` would close W-1..W-5 in a handful of lines.

---

## Verdict

| # | claim | verdict |
|---|---|---|
| C1 | `omitListCaveat` fires only on an exact rule-driven omit row | **CONFIRMED** (see F-1 on input scoping, F-3 on the guard) |
| C2 | the copy states what is known, not what the next run will do | **CONFIRMED** (F-1 qualifies "the last run") |
| C3 | `restoreOptions` never offers an omit-list phrase | **PARTIAL** — true today; the filter is rationale-only, and C8's guard does not close the second-producer route |
| C4 | `shortenAction` gates on a real rule and carries the real strings | **CONFIRMED** (F-2: its `reason` is never rendered) |
| C5 | one `api.aiEditArtifact` call site in `AssetBlocks.jsx` | **CONFIRMED** |
| C6 | no dead UI — absent, not disabled | **CONFIRMED** (F-2 is a missing explanation, not a dead control) |
| C7 | suites + build pass at `b6a2f03` | **CONFIRMED** — api 886/886, app 372/372, build ok |
| C8 | the `driver === 'rule'` mutation refuses to prove | **CONFIRMED**; replacement guard **PARTIAL** (M3 blind) |
| C9 | adversarial line deletion | **8 of 19 survived** — F-3 (high), F-4 (medium), F-5 (low) |
| C10 | 4.1-20 built, regression covered | **PARTIAL** — built and wired; W-1..W-5 all survive |

Tree at finish: only `docs/qc-evidence/VERIFY-pr58.md` untracked. Every mutation restored,
`app` 372/372 and `api` 886/886 re-run green afterwards.
