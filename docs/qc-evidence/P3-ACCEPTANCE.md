# P3 — remediation loop: acceptance criteria and the divergences that block it

Written COLD by an independent AC agent **before any P3 code exists**, from the backlog, the spec and
the live code — not from an implementation. 46 criteria; the full list is in the session record. What
follows is what a builder must not start without.

Every divergence below was re-verified against the code before being written down. None is inferred.

---

## The four criteria that decide whether P3 is honest

**P3-05 — `converged` must be unfalsifiable.** A row may record `halt_reason='converged'` only when
`cardinality(remaining)=0` AND that pass's `run_id` has a `must_have_coverage` row with `state='pass'`
— not `not_applicable`, not `warn`. Enforced by a table CHECK, not by the writer's good intentions.
"Converged" is the one word a user will trust without reading anything else.

**P3-11 — a close requires an actual edit.** `requirement.closed_on_loop = N` is legal only when an
`insertion` row exists at `loop = N` whose `after_text` differs from its `before_text`. This is the
headline defect class: `covers()` is token overlap over the whole document, so an edit to an unrelated
field can flip a requirement to "covered" and the loop would take credit for closing it.

**P3-25 — documents render once (X5).** A packet completing an N-pass loop over 4 templated artifacts
must issue exactly **4** Drive copies, not 4N.

**P3-37 — green because fixed, never because stopped.** A loop that halts with must-haves still open
must leave the gate `fail`, never `pass`. And P3-38: it must not reach green by *removing evidence* —
the requirement row count must be unchanged across the loop, and `must_have_coverage` must never
transition `fail → not_applicable`.

---

## Divergences — the backlog conflicts with what is already built

Standing directive: **default to what is already built; depart only for a named defect, recorded.**
These are stated, not silently resolved.

### Verified against the code, 2026-08-20

| # | Claim | Ground truth |
|---|---|---|
| **D-1** | "`insertions.ts` and `swaps.ts` both already record a `loop`" | **Half false.** `insertion` has `loop int not null default 0` with `unique (artifact_id, merge_field, loop)`. **`swap_decision` has no `loop` column at all** — its unique key is `(packet_id, list, seq)`. |
| **D-2** | Swap history survives a second pass | **False, and it is a named defect.** `writeSwaps` does `delete from swap_decision where packet_id=$1` on every build. Pass 2 **destroys pass 1's swap record** — the loop deletes its own justification for every change it made. |
| **D-4** | `remediation_loop.n` is a new counter | **Three loop-ish counters already exist**: `packet.round` (read via `order by round desc`, **never incremented**), `insertion.loop` (counts *document renders*, incremented on every build including cache hits that made zero model calls), and `check_result.run_id`. "Extend, don't duplicate" requires choosing one and saying why before adding a fourth. |
| **D-5** | `coverage='escalated'` means "the loop gave up" | **The name is already taken with a different meaning.** `requirements.ts:392` sets `coverage: loc.char_start === null ? 'escalated' : null` at EXTRACTION — it means "the quote could not be located in the posting", decided before any loop exists. Writing loop-escalations into the same column makes two populations indistinguishable. |
| **D-9** | X5 is about orphan documents from the loop | **Worse: every rebuild ALREADY orphans.** There is no Drive `DELETE` anywhere in `api/src/functions/tests/` (only Graph subscription deletes in `mailWatch.ts`), and `buildTemplatedArtifact` overwrites `artifact.doc_url` after each copy. A 4-pass loop would make it 16 files per packet on the quota-bearing OAuth account. |
| **D-10** | The loop can safely re-check | `evaluateArtifact` clears `override_by/at/reason` on every upsert. Correct for a manual re-check; a loop re-checks up to 4 times automatically, silently erasing a human's recorded reason each time. |
| **D-12** | "100% coverage" is the loop's target | **The code has already measured that it is not always reachable.** `template_reach`, `facts_needed` and `facts_settled` deliberately remove requirements from the coverage denominator — eligibility clauses no merge field can carry, and requirements the owner's facts settle. A loop reading open requirements from `requirement` rows directly would chase requirements it structurally cannot close and burn all four passes on them. The denominator must be stated explicitly. |

### Needs an owner decision before building

**D-6 — `closed_on_loop` cannot express the artifact dimension.** It is a single `int` on a
per-**opportunity** `requirement` row. But coverage is judged per-**artifact** by `evaluateArtifact`,
over a per-**packet** `pkg_json`, across four artifacts with different merge fields (resume 7, cover 3).
"Closed on loop 2" is ambiguous across them: covered in the resume but not the cover letter is the
normal case, not the edge case. The backlog is silent; the schema forces one answer.

**D-8 — there is no primitive for scoped regeneration.** The backlog says "re-run generation scoped to
the open requirements only". `buildPackageForJD` is monolithic: call 2 consumes `JSON.stringify(c1)`,
call 3 consumes `{...c1, ...c2}`, and `assemblePackage` merges whole payloads. **Nothing today can
regenerate one merge field.** This is new capability, not a wiring change, and saying so before
building it is the difference between a scoped estimate and a surprise.

**D-7 — the plan's own text on X2 is stale.** It says `appPackets.ts` hardcodes `regen=false`; the
current code reads `regen` from the body in three places. The residual gap is that the UI never sends
it — and that `regen` is all-or-nothing, discarding the whole package, which is precisely the
"regenerates the WHOLE package" failure P3.1 exists to forbid.

---

## Verification vehicles

Sandbox (`cd api && npm ci && npm run build && npm test`) settles the pure-controller criteria:
P3-03, 04, 05 (constraint text), 07, 08, 10, 15, 18, 19, 23, 25 (primary), 27, 29, 30, 40, 42, 44, 46.

`db-query.yml` settles the ledger-arithmetic criteria; `api-test.yml` settles the live loop.
**No UI criterion is claimable** — P5 is not merged and the harness gaps (D2, D3) are open.

Note P3-25's live half needs `diagFolders` extended to list the packet output folder
`1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt` — it currently lists only the two role template folders.
