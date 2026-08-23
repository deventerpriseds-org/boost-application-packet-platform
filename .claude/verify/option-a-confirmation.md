# Independent verification — Option A (owner-confirmable model proposals)

Verifier agent. No shared context with the implementing session. Evidence only.

- Started: 2026-08-23
- Local `HEAD` == `origin/main` == `c1a11c1233a86cd74052e3fff11e15224d18eaf9` (fetched, confirmed).
- Commits under test: `69b14c0` (Option A), `6222160` (escalation priority), `c1a11c1` (docs/ledger).

## Status legend
CONFIRMED / REFUTED / OVERSTATED / UNVERIFIABLE

---

## Log (appended as work proceeds)

### 00 — git state
`git fetch origin` then `git rev-parse HEAD` and `git rev-parse origin/main` both
`c1a11c1233a86cd74052e3fff11e15224d18eaf9`. Working tree clean (`git status --short` empty).
So the local tree IS the deployed-candidate tree; no rewind.

### 01 — source read (static, before any execution)

Files changed by `69b14c0`: `appChecks.ts`, `appRequirements.ts`, `checks.ts`, `evidence.ts`,
`schema.ts`, `evidence.test.mjs`, `evidenceConfirmDb.test.mjs` (new).
Files changed by `6222160`: `appRequirements.ts`, `evidenceConfirmDb.test.mjs`.

Key facts read from source (not yet executed):

- `checks.ts:~655` — `ruleEvidenceOf = (r) => (isProposed(r) && !isConfirmed(r) ? null : evidenceOf(r))`,
  with `isConfirmed = (r) => !!evidenceOf(r)?.confirmed_at`. So a proposed row counts **iff** the
  loaded evidence row carries a non-null `confirmed_at`.
- `appChecks.ts` carries `confirmed_at`/`confirmed_by` from `r.evidence_confirmed_*` into `EvidenceRow`.
- `appRequirements.ts loadRequirementsWithEvidence` LEFT JOINs `evidence_confirmation c` on
  `opp_id`, `requirement_text = coalesce(r.verbatim, r.item_text)`, `source_key`, `char_start`,
  `char_end`, `record_sha256`, `withdrawn_at is null`.

**FIRST DISCREPANCY (static): `quote` is NOT part of the key.** Claim 3 states the identity is
"requirement text + source_key + offsets + quote + record_sha256". `quote` is a stored column, but
it is absent from BOTH the join condition and the `unique (opp_id, requirement_text, source_key,
char_start, char_end, record_sha256)` constraint. It is functionally determined by the other
columns (`record_sha256` pins the record body, the offsets index into it, and a table CHECK forces
`length(quote) = char_end - char_start`), so this is not a hole — but the claim as worded is
inaccurate about what the key contains.

**SECOND DISCREPANCY (static): the commit message describes `do nothing`; the code is `do update`.**
`69b14c0`'s message says idempotency comes from "`do nothing` keeps the first decision". The shipped
statement is `on conflict (...) do update set withdrawn_at = null, withdrawn_reason = null`.
`confirmed_at` and `confirmed_by` are NOT in the SET list, so the original timestamp/actor do
survive — the claimed BEHAVIOUR looks right, the described MECHANISM does not. To be proven by
execution below.

### 02 — LIVE production database (ground truth)

`db-query.yml` run **32636690539**, job **97187430312**, head_sha `c1a11c1`, executed
2026-08-23T11:29:44Z against `eds-postgresql…/boost_resume_n_packet_builder`. Raw output excerpts:

**Requirement population for opp `2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3`**
```
      kind      | count | min | max
----------------+-------+-----+-----
 must_have      |    13 |  22 |  34
 nice_to_have   |     1 |  21 |  21
 responsibility |    21 |   0 |  20
```

**EVERY evidence row on this opportunity, by requirement kind and method**
```
   kind    |  method  | count
-----------+----------+-------
 must_have | proposed |     5
(1 row)
```
There is nothing else. Zero deterministic (`exact`/`anchored`) rows anywhere on this opportunity,
and zero evidence rows on responsibilities.

**Per-must-have, run through the PRODUCTION join expression verbatim**
```
 seq |   kind    |  method  |      source_key       | start | end | confirmed |       confirmed_by
  22 | must_have | none     |                       |       |     | no        |
  23 | must_have | proposed | workHistory3          |   324 | 554 | YES       | von.ellis@enterpriseds.io
  24 | must_have | none     |                       |       |     | no        |
  25 | must_have | none     |                       |       |     | no        |
  26 | must_have | none     |                       |       |     | no        |
  27 | must_have | proposed | relevantProficiencies |   502 | 710 | YES       | von.ellis@enterpriseds.io
  28 | must_have | none     |                       |       |     | no        |
  29 | must_have | proposed | aboutMe2              |   504 | 696 | no        |
  30 | must_have | proposed | workHistory2          |     0 | 154 | no        |
  31 | must_have | none     |                       |       |     | no        |
  32 | must_have | proposed | aboutMe1              |   290 | 467 | no        |
  33 | must_have | none     |                       |       |     | no        |
  34 | must_have | none     |                       |       |     | no        |
```

**`evidence_confirmation` — the entire table**
```
 total_confirmations | opps
                   2 |    1
```
```
 req                                      | source_key            | start | end | confirmed_by              | confirmed_at                 | withdrawn_at
 Proven track record of delivering comple | workHistory3          |   324 | 554 | von.ellis@enterpriseds.io | 2026-08-23 05:48:26.83232+00 |
 Strong understanding of data architectur | relevantProficiencies |   502 | 710 | von.ellis@enterpriseds.io | 2026-08-23 05:48:26.83232+00 |
```

**`must_have_coverage` check_result history for this opportunity (newest first)**
```
      type      | state | observed                                                                                                  | created_at
 resume         | fail  | 2/12 must-haves evidenced (5 model-proposed, awaiting your confirmation, 1 answered from your profile facts, not counted either way) | 2026-08-23 05:48:49
 portfolio      | fail  | 0/12 must-haves evidenced (1 answered from your profile facts, not counted either way)                     | 2026-08-23 03:36:50
 cover          | fail  | 0/12 must-haves evidenced (1 answered from your profile facts, not counted either way)                     | 2026-08-23 03:36:49
 compact_resume | fail  | 0/12 must-haves evidenced (1 answered from your profile facts, not counted either way)                     | 2026-08-23 03:36:48
 resume         | fail  | 0/12 must-haves evidenced (1 answered from your profile facts, not counted either way)                     | 2026-08-23 03:36:47
 …
```

**Requirements holding more than one evidence row**
```
 seq | ev_rows
(0 rows)
```

#### What this settles

- **CLAIM 1 — CONFIRMED.** `must_have_coverage` on production moved from `0/12` to
  `2/12 must-haves evidenced (5 model-proposed, awaiting your confirmation, 1 answered from your
  profile facts, not counted either way)`. The observed string is quoted byte-for-byte from
  `check_result`. NOTE it is still `state = fail` — coverage moved, the gate did not open.
- **CLAIM 1's "for the right reason" — CONFIRMED.** The denominator is 12 before AND after
  (13 must-haves minus the 1 fact-owned row), so it did not move. There are ZERO deterministic
  evidence rows on the whole opportunity, so the numerator cannot have come from a rule row
  appearing. The numerator is 2 and `evidence_confirmation` holds exactly 2 rows, both on this
  opportunity, both on `must_have` seqs 23 and 27, both matched by the production join. Numerator ==
  confirmations, exactly.
- **CLAIM 4 — CONFIRMED for the "0 -> 5" half.** Live: 5 proposals, all 5 on `must_have`
  (seq 23,27,29,30,32); zero on responsibilities. Given must-haves live at seq 22-34 and
  responsibilities at seq 0-20, a `seq`-ordered `slice(0,12)` could not have reached any of them.
- **The "pending hides confirmed" risk did NOT materialise here** — no requirement on this
  opportunity carries more than one evidence row, so the `ratio desc nulls last` tie-break never
  had to choose. Whether it CAN is tested separately below (section 04).

#### DEFECT FOUND — the observed string double-counts confirmed proposals

`checks.ts` builds the tail from `const proposed = coverable.filter(isProposed)`, and `isProposed`
is `evidenceOf(r)?.method === 'proposed'` — it is NOT filtered by `isConfirmed`. So all 5 proposed
rows are reported, inside a parenthetical that ends `", not counted either way"`.

Live, only **3** proposals are awaiting a decision (seqs 29, 30, 32); the other 2 are confirmed and
ARE the numerator. So the shipped string says, in one sentence, that 5 proposals are "awaiting your
confirmation … not counted either way" while its own numerator of 2 is made *entirely* of two of
those five. The count is wrong and the "not counted either way" clause is false for 2 of the 5.

The task asked me to "confirm the 5 remaining proposals are reported as awaiting confirmation and
NOT counted." **REFUTED as worded**: there are 3 remaining, not 5, and the string reports 5.
The numerator itself is correct — `unevidenced` uses `ruleEvidenceOf`, so the confirmed rows are
correctly excluded from the offenders list. This is a REPORTING defect on an accusation-grade
surface, not a counting defect.

### 03 — mutation testing every new guard (local PostgreSQL 16.13)

Baseline: `node --test api/test/evidenceConfirmDb.test.mjs` → **6 pass / 0 fail**.
Every mutation was applied to `api/src/functions/tests/appRequirements.ts`, GREPPED to prove it
landed (a silent no-op `replace()` makes a green result meaningless), rebuilt with `tsc`, then run.
Source restored and re-verified by md5 (`52c034403e67658786f7adbc9aa1f53b`) at the end; final
re-run is 6/6 pass and `git status` is clean.

| # | Mutation (the defect reinstated) | grep proof | Result |
|---|---|---|---|
| M1 | `c.confirmed_at as evidence_confirmed_at` → `coalesce(c.confirmed_at, e.resolved_at) …` ("every proposal auto-confirms") | line 483 matched | **KILLS 1, 3, 4** |
| M2 | → `null::timestamptz as evidence_confirmed_at` (confirmation never reaches the gate) | applied+verified | **KILLS 2, 3, 4, 5** |
| M3 | delete `and c.record_sha256 = e.record_sha256` from the join | occurrences → 0 | **KILLS 3 only** |
| M4 | delete `and c.requirement_text = coalesce(r.verbatim, r.item_text)` from the join | occurrences → 0 | **KILLS 4 only** |
| M5 | AFTER-DELETE trigger on `requirement` that deletes the matching `evidence_confirmation` — i.e. the confirmation stored so it dies with the requirement row, the exact defect the test names | 3 occurrences of `_mut_cascade` | **KILLS 5 only** |

So `H:unconfirmed-proposal-is-not-confirmed`, `H:confirmed-proposal-is-carried-to-the-gate`,
`H:a-changed-profile-record-voids-the-confirmation`, `H:a-changed-requirement-voids-the-confirmation`
and `H:confirmation-survives-re-extraction` are all **non-vacuous** — each dies to its own defect,
and M3/M4/M5 each kill exactly one test, which is the strongest form of the proof.

(Note: M5's trigger persists in the shared test database. My first re-run after restoring the source
still showed test 5 failing until I ran `drop trigger _mut_cascade_trg` — the source was clean, the
database was not. Recorded because it briefly looked like a real regression and was not.)

#### THE ESCALATION GUARD IS VACUOUS FOR THE TWO REGRESSIONS THAT MATTER

`H:escalation-spends-its-cap-on-must-haves-first` runs a real fixture through `writeEvidence`, but
its assertions are (a) `attempted === 12`, which merely counts must-have ROWS IN THE DATABASE and is
true regardless of what escalation did, and (b) two source greps over the block between
`const open = rows.filter` and `for (const r of attempt)`:
`assert.match(block, /sort\(/)` and `assert.match(block, /must_have:\s*0/)`.
The `asked` array the fixture collects is never asserted on. Nothing about the ORDER actually
attempted is measured.

| # | Mutation | grep proof | Result |
|---|---|---|---|
| M6a | `const attempt = prioritised.slice(…)` → `const attempt = open.slice(…)` — the sort still computed, just not used. **This is verbatim the defect `6222160` says the guard catches.** | line 312 = `const attempt = open.slice(0, Math.max(0, cap))` | **PASSES — 6/6 green** |
| M6b | comparator inverted, `rank(a) - rank(b)` → `rank(b) - rank(a)` (must-haves ranked LAST) | applied+verified | **PASSES — 6/6 green** |
| M6c | whole `ESCALATION_RANK`/`prioritised` block deleted and `attempt` taken from `open` | `ESCALATION_RANK|prioritised` count → 0 | **KILLS 6** |

`6222160`'s commit message states: *"Guard: H:escalation-spends-its-cap-on-must-haves-first,
mutation-proven — reverting to `open.slice(...)` makes it fail."* **That is REFUTED by execution.**
Reverting to `open.slice(...)` leaves the suite fully green. The guard only fires when the now-dead
sort lines are also physically deleted from the source. It is a source grep dressed as a behavioural
test: it proves the TEXT `sort(` and `must_have: 0` exist in that region, not that must-haves are
attempted first. A one-character comparator flip — the single most likely real regression — sails
through it.
