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

## C10 — suites: CONFIRMED

```
cd api && npm test   -> # tests 1027 / # pass 1027 / # fail 0
cd app && npm test   -> # tests 427  / # pass 427  / # fail 0
```
Matches the implementer's claimed 1027/1027 and 427/427 exactly. Ran fresh, not taken from prior
output.

