<!-- WHAT:       Independent verification of the "proposals count until vetoed" lane (loop 1).
     WHY:        Tier-1 gate-path change; self-reported mutation-proving does not satisfy
                 independent verification.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   this file. -->

# VERIFY: veto-lane, loop 1

Repo: /home/user/boost-application-packet-platform, branch claude/incumbent-wins-swap at a1f2b68
(plus brief-only commits bbc5c9d, b0dd177 on top, not part of the reviewed diff).

Status: IN PROGRESS — writing incrementally.

## C10 — suites: CONFIRMED (re-run fresh, not inherited from the killed attempt)

```
cd api && npm test   -> # tests 1027 / # pass 998 / # fail 0 / # skipped 29
cd app && npm test   -> # tests 427  / # pass 427 / # fail 0 / # skipped 0
```
Zero failures in both suites, matching the implementer's "1027/1027" and "427/427" claims in the
sense that matters (0 failing). Note for precision: the api suite has 29 SKIPPED tests, not 1027
passing outright (998 pass + 29 skip = 1027 total, 0 fail). The killed run's earlier report of
"1027/1027" elided the skip count; re-stating it here so the skip count isn't silently dropped.
Not investigated further because skipped-vs-run is not a claim this brief asks about, and 0 failures
holds either way.

## C6 — every model-warranted counted row disclosed, no surface still claims "uncounted": REFUTED

Grepped both the new phrasing ("counted until you veto", `checks.ts:1073`) and the retired one
("awaiting your confirmation", "do not count toward the coverage gate") across `api/src` and
`app/src`.

`checks.ts`'s own `must_have_coverage.observed` string is correct and tested not to regress
(`api/test/checks.test.mjs:775`, `assert.doesNotMatch(cov.observed, /awaiting your confirmation/)`).

But `api/src/functions/tests/appRequirements.ts:990-995`, in the LIVE `evidenceResolve` handler
(`POST /api/app/opportunity/{id}/evidence`), still builds and returns this `note` field verbatim:

```
`${out.total - out.evidenced} requirement(s): ${NO_EVIDENCE_NOTE}`
  + (out.proposed
      ? ` — ${out.proposed} of them proposed by a model and awaiting your confirmation; they are shown but do not count toward the coverage gate`
      : '')
```

This is a second, independent surface stating the OPPOSITE of the lane's own change: a proposed row
now counts toward `must_have_coverage` (via `ruleEvidenceOf`'s allow-list, which includes
`'proposed'`) until vetoed — it is not "awaiting confirmation" and does not "not count toward the
coverage gate". No test covers this string (`grep -rn "awaiting your confirmation\|do not count
toward the coverage gate" api/test app/test` returns zero hits against this literal), so nothing
caught it. This is exactly the shape the brief warns about under "who READS what was written" /
"a break anywhere in that chain is silent" — except here it's not a dropped field, it's a stale
SENTENCE shipped on an accusation-adjacent write route, telling the owner a number is excluded from
the gate when it is not.

Evidence command:
```
grep -n "awaiting your confirmation\|do not count toward the coverage gate" api/src/functions/tests/appRequirements.ts
-> line 994 (live code, not a comment)
```

## C8 — screen and gate cannot disagree about what counts: CONFIRMED (mutation-proved independently)

`checks.ts`'s `COUNTS` allow-list (`['exact','anchored','proposed','vetted']`) and
`postingAnalysis.js`'s `countsNow` allow-list are structurally identical, both check the veto first
(`isVetoed(r)` in the gate, `trim(ev.decision) !== 'vetoed'` in the screen), and are pinned by
`H:the-screen-and-the-gate-agree-about-what-counts` (`app/test/postingAnalysis.test.mjs:1147`),
which is scoped to the `countsNow` expression specifically (not a whole-file grep — the commit
history shows `a1f2b68` fixed exactly the whole-file-grep-passes-on-broken-code failure mode here).

Ran two independent mutations myself (not inherited from the implementer's own mutation-proving),
using `/workspace/eds-claude-skills/scripts/mutate.sh`:

1. Added a bogus 5th method `'zzz'` to the gate's `COUNTS` set only (screen unchanged) →
   `FIRED: 'H:the-screen-and-the-gate-agree-about-what-counts' failed with the defect reinstated.`
2. Stripped the veto check out of the screen's `countsNow` expression only (gate unchanged) →
   `FIRED: 'H:the-screen-and-the-gate-agree-about-what-counts' failed with the defect reinstated.`

Both mutations restored cleanly (`restored: <file> matches HEAD`). The guard is real in both
directions it claims to cover.

## C9 — veto is legible: 3 states distinct, no warrant badge beside a veto, missing reaches control: CONFIRMED

Read `PostingAnalysis.jsx` `EvidenceLine` directly: `confirmed` badge requires `!ev.vetoed`, `vetted`
badge requires `!ev.confirmedAt && !ev.vetoed`, `countingNow` badge requires `ev.countsNow` (which
structurally excludes vetoed rows per C8), and the `vetoed` badge itself renders unconditionally on
`ev.vetoed` with a distinct red, "you vetoed this — it is not counted". So a vetoed row can only ever
show the vetoed badge, never a confirmed/vetted/counting-now badge beside it. `missing={ev.missing}`
is passed into `<ConfirmProposal>`, which renders it above the yes/no buttons when non-empty.

Mutation-proved independently: stripped the `!ev.vetoed` guard from the `confirmed` badge only →
`FIRED: 'H:a-veto-is-visible-and-outranks-every-other-badge' failed with the defect reinstated.`
Restored cleanly.

Noted as a design choice, not a defect: once a row is vetoed (or confirmed), `decidable` goes false
and the confirm/reject buttons disappear — there is no UI path to *undo* a veto from this control.
The code comment says this is deliberate ("undoing a decision is a separate act with its own
affordance"), and the brief's claims don't ask for undo, so this is not scored against C9.

## C2 — `ruleEvidenceOf` is fail-closed by construction: CONFIRMED (executed, not read)

Built the api (`npm run build`) and drove `runChecks` directly (not the implementer's own test
fixtures) with a fabricated evidence row whose `method` is a value NOT in the DB's CHECK constraint
domain and not in `checks.ts`'s `COUNTS` allow-list:

```
exact               -> pass  1/1 must-haves evidenced
anchored            -> pass  1/1 must-haves evidenced
proposed            -> pass  1/1 must-haves evidenced (1 on a model's proposal alone — counted until you veto)
vetted              -> pass  1/1 must-haves evidenced (1 vetted: ...)
unknown_method_xyz  -> fail  0/1 must-haves evidenced
```
An unrecognised `method` does not count — confirms the allow-list is a fail-closed ALLOW-list (a
value not named does not count), not a fail-open deny-list. Matches the code's own claim at
`checks.ts` around `COUNTS`.

## C1 — proposed counts, vetoed does not: CONFIRMED (executed)

Same rig, varying `method`/`decision` on one evidence row:

```
proposed, no decision                          -> pass  (counted, "counted until you veto")
proposed, decision=vetoed                      -> fail  (0/1, "you vetoed, not counted either way")
```
Matches the owner's instruction and the code's stated behaviour exactly.

## C3 — veto outranks every other warrant, including `confirmed_at` on the same row: CONFIRMED (executed)

Constructed the CONTRADICTORY row the claim asks about — `decision: 'vetoed'` together with a set
`confirmed_at`/`confirmed_by` (a shape the app's own `evidenceConfirm` route should never produce,
since confirm/reject both set `decision` to a single value — but `ruleEvidenceOf`/`isVetoed` do not
assume that; they read only `decision`):

```
proposed, decision=confirmed, confirmed_at set                        -> pass  (counts)
proposed, decision=vetoed AND confirmed_at set (contradictory)        -> fail  (0/1, vetoed wins)
```
Veto wins even when a `confirmed_at` is present on the same row, matching `isVetoed(r)` being
checked first, unconditionally, before the method allow-list. `checks.ts`'s literal ordering
(`if (isVetoed(r)) return null` precedes the `COUNTS.has` check) was read and matches the executed
behaviour — not inferred from the comment alone.

Side observation (not a defect against C3, a note for the record): a fabricated `method: 'exact'`
row with `decision: 'vetoed'` is also excluded by `ruleEvidenceOf`, even though the live
`evidenceConfirm` route returns 409 for a non-`proposed`/`vetted` row and so should never let this
state exist in production data. `isVetoed` does not gate on method, only on `decision`. Not scored
as a defect — the veto's precedence over a rule match, should it ever occur, is arguably the safer
of the two behaviours (erring toward excluding a row a human explicitly rejected) and no claim in
the brief asks about this combination.

