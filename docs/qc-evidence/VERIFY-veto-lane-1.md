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

