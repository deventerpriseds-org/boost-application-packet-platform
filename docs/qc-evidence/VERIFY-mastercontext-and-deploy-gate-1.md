<!-- WHAT:       Independent verification of three changes landed on main 2026-09-03: the
                 MasterContext accessor + owner_master_block table + Postgres backing, the
                 table-registration guard (H:every-declared-table-is-registered), and the
                 deploy-gate sha fix (H:deploy-sha-comes-from-the-bundle).
     WHY:        TIER 1 -- masterBaseline() feeds every swap_decision "original" column, and the
                 deploy gate decides whether a migration may run at all.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   this file. -->

# VERIFY LOOP
work: mastercontext-and-deploy-gate
loop: 1

Repo: `/home/user/boost-application-packet-platform`, branch `claude/incumbent-wins-swap`
(HEAD `417c875`, based on `origin/main` @ `5dbd4df`).

No PRIOR STATE -- this is loop 1. Coverage is total; every claim gets a verdict below.

---

## C1. The accessor is the only production read of MasterContext

**Status: IN PROGRESS**
