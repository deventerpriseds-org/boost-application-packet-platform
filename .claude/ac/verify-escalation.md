# Independent verification — escalation wiring

## !!! URGENT — READ FIRST: MY TEST-HARNESS EDIT WAS COMMITTED BY THE PARENT SESSION !!!

While I was mutation-testing the guards (claim 8), the parent session committed the working tree
mid-mutation. Commit **`c230f30`** ("Settings: Quality section — the chk_* controls and the comparison
dimensions", 2026-08-22 01:04:00) contains **my deliberately-injected defect**:

```
api/src/functions/tests/appPackets.ts:666
    const evidencePre = await selfPost(`app/opportunity/${oppId}/evidence?owner=${encodeURIComponent(owner)}`, {})
```
`git log -S evidencePre -- api/src/functions/tests/appPackets.ts` -> `c230f30`.

This line is **not the implementer's code and must be deleted**. It is a second, duplicate call to the
evidence-resolve route placed BEFORE the artifact build loop — i.e. it violates the owner's hard
constraint (claim 6) and it doubles the model spend of every build. `git show 86c6e54:...` contains
zero occurrences; it appeared only in `c230f30`.

Consequence, measured at HEAD `c230f30`:
```
$ node --test test/*.test.mjs
# tests 662  # pass 660  # fail 2
not ok 422 - H:draft-is-written-from-prompts-not-evidence
  error: 'evidence is resolved BEFORE the artifacts are built — it must run after, on what was written'
not ok 116 - D:ledger-stale-row-fails
```
The guard did its job — it is the reason this was caught. **`git revert`/hand-remove that one line.**

I did not commit anything and I have left the working tree as I found it; the line is in a commit,
not in my scratch state, so I cannot undo it without rewriting the parent's history.

---
Branch `claude/qc-escalation-wiring` @ 86c6e54. Verifier has no shared context with the implementing agent.
Started: (in progress — appended incrementally)

## Status
- [ ] C1 zero model calls when off
- [ ] C2 proposed row cannot turn must_have_coverage green
- [ ] C3 proposed quote byte-exact
- [ ] C4 transport failure != "profile supports nothing"
- [ ] C5 rejected proposed insert costs one row
- [ ] C6 resume draft written from prompts not evidence
- [ ] C7 schema change real+safe (executed on populated DB)
- [ ] C8 guards not inert (mutation test >=4)

---
## C2 (highest value) — "a model-proposed row cannot turn `must_have_coverage` green"

### Verdict on the literal claim: CONFIRMED (for `must_have_coverage` only)
`api/src/functions/tests/checks.ts:631-632`
```ts
const isProposed = (r) => evidenceOf(r)?.method === 'proposed'
const ruleEvidenceOf = (r) => (isProposed(r) ? null : evidenceOf(r))
```
`checks.ts:651` `const unevidenced = coverable.filter(r => !ruleEvidenceOf(r))` — a proposed row stays in
`unevidenced`, so the `ok(...)` branch at :684 is unreachable while any proposed row is the only evidence.

### BUT — TWO SIBLING CHECKS IN THE SAME BLOCK STILL USE THE UNFILTERED `evidenceOf`. (details below, being tested)
- `checks.ts:685` `const unaddressed = resp.filter(r => !evidenceOf(r))`  -> `responsibilities_addressed`
- `checks.ts:697` `const evidenced = [...coverable, ...resp].filter(r => evidenceOf(r))` -> `evidence_placed`
Both are in the *same else-branch*, 34 and 46 lines below the `ruleEvidenceOf` helper written to prevent
exactly this. Executable proof pending.

### C2 — EXECUTED. **LEAK CONFIRMED in `responsibilities_addressed`.**
Probe: `api/test/zz-verifier-adversarial.test.mjs` (my own file, run with `node --test`).
```
  RESP without evidence : warn | 0/1 responsibilities evidenced
  RESP with proposed    : pass | 1/1 evidenced
not ok 4 - V-C2b
  error: 'LEAK: a model-proposed row turned responsibilities_addressed warn -> pass ("1/1 evidenced")'
```
The ONLY difference between the two runs is `method: 'proposed'` vs an absent row. Same requirement,
same package. `checks.ts:685` `resp.filter(r => !evidenceOf(r))` — the unfiltered helper, 34 lines
below the `ruleEvidenceOf` helper written to stop exactly this.

`responsibilities_addressed` is a real `CheckResult` with `state:'pass'` and it feeds `gateFor()`.
Its severity is `warn` on failure, so it cannot by itself make a gate `fail`->`pass`... but it CAN
remove a `warn` from the gate: `gateFor` returns `'warn'` if `results.some(r => r.state === 'warn')`.
So **a model proposal can move an artifact's gate from `warn` to `pass`** when it is the last warn
standing. That is a model answer changing a gate, which is the exact thing claim 2 exists to prevent.

`evidence_placed` (`checks.ts:697`) also uses the unfiltered `evidenceOf` — a proposed row enters the
`evidenced` population. First probe moved it not_applicable -> warn (not pass); a sharper probe follows.

### C2 — SECOND LEAK, larger: `dimensions.ts` grades a dimension **`strong`** off a proposed row.
`api/src/functions/tests/dimensions.ts:439`
```ts
const evidenced = judgeable.filter(r => r.evidence && r.evidence.quote)
```
No `method` check — and `method` is not even in the type: `dimensions.ts:241`
`evidence?: { quote: string; source_label: string; source_kind: string; ratio?: number | null } | null`.
So the module structurally **cannot** tell a rule's finding from a model's proposal.

Executed (`test/zz-verifier-2.test.mjs` V2-c). Requirement: *"Modernize the legacy platform and retire
technical debt across the estate"*. Evidence row: the quote *"Reduced outages from nine hours to one"*
— an excerpt sharing no content word with the requirement, i.e. exactly the case the escalation tier
exists to produce.
```
  WITH a proposed-shaped evidence row : [["platform_modernization","strong","evidence","Reduced outages from nine hours to one"]]
  WITHOUT any evidence row            : [["platform_modernization","weak","evidence",null]]
```
`gradeFit(1,1) = 'strong'` (`dimensions.ts:211-215`, STRONG_AT >= 0.99). The owner's four-card
comparison flips **weak -> strong** on a model proposal, with the model's excerpt printed in the
`profile` slot under `basis: 'evidence'` and `source: 'evidence'` — the field whose own doc comment
(`dimensions.ts:265`) reads *"NEVER a model's summary — an excerpt, or a fact the owner confirmed."*
It is an excerpt, so that comment is technically satisfied and completely misleading in effect.

`checks.ts` was hardened; the sibling grader that reads the SAME evidence rows was not. This is the
repo's own "fix all consumers, not just the one you found" rule, broken in the commit that cites it.

Also note `dimensions.ts:471` `sort((a,b) => (b.evidence.ratio || 0) - ...)` — a proposed row's null
ratio coerces to 0, so it sorts LAST among evidenced rows; but when it is the only one it becomes
`best` and its quote is what the card displays.

**The dimensions leak is on the DEPLOYED path, not just in theory.**
`appRequirements.ts:695` writes the proposed rows, then `:700` `rebuildComparison(...)` in the SAME
request. `appDimensions.ts:203-211 shapeRequirement` maps the join to the grader and **drops
`evidence_method` entirely** — quote / source_label / source_kind / ratio only. Provenance is thrown
away at that boundary, so `comparison_dimension` is written with `fit='strong'`, `basis='evidence'`,
`profile_source='evidence'` for a row a model proposed. Nothing downstream can recover the fact.

### C2 VERDICT: **REFUTED as stated for the system; CONFIRMED only for the single check named.**
- `must_have_coverage`: protected. CONFIRMED.
- `artifactScore.computeArtifactScore`: protected *transitively* — it parses `"<covered>/<judged>"`
  out of the must_have_coverage `observed` string (`artifactScore.ts:113`) and never reads evidence
  rows itself. CONFIRMED (by derivation from the above, plus reading the file: no evidence access).
- `responsibilities_addressed`: **LEAKS** — warn -> pass, executed.
- `dimensions.ts` / `comparison_dimension`: **LEAKS** — weak -> strong, executed.
- `evidence_placed`: uses the unfiltered helper; my probes moved it not_applicable -> warn but I did
  not construct a not_applicable -> pass case. Reported as a leak of the same class, severity lower.

---
## C7 — "the schema change is real and safe" — **CONFIRMED (EXECUTED on a populated DB)**

Baseline used: **`ebc52b4`**, not `origin/main`. `origin/main` is now `444e436` = *"Merge pull request
#45 from claude/qc-escalation-wiring"* — **this branch is ALREADY MERGED TO MAIN**, so `origin/main`'s
SCHEMA_SQL is byte-identical to the branch's (diff = 1 trailing newline). Using `origin/main` as the
"previous schema", as CLAUDE.md's recipe literally says, would have produced a **vacuous pass**:
applying a schema on top of itself. `ebc52b4` is the real pre-change schema (merge-base / first parent
of the merge commit).

```
$ psql -v ON_ERROR_STOP=1 -q -d upg -f /tmp/schema_prev_nv.sql   # ebc52b4  -> exit 0
$ psql ... seed opportunity + 2 requirement rows + 1 'exact' requirement_evidence row
$ psql -v ON_ERROR_STOP=1 -q -d upg -f /tmp/schema_nv.sql        # branch   -> exit 0
$ psql -v ON_ERROR_STOP=1 -q -d upg -f /tmp/schema_nv.sql        # re-run   -> exit 0 (idempotent)
```
Pre-existing deterministic row, after the migration:
```
 method_ok | ratio_ok | sha_ok | rv_ok | pv_null | quote_ok
 t         | t        | t      | t     | t       | t
```
Constraint after:
`requirement_evidence_method_check CHECK (method = ANY (ARRAY['exact','anchored','proposed']))`
Column after: `proposal_version | integer | is_nullable=YES | default=<none>` — nullable, NOT defaulted, as claimed.

Behavioural assertions, executed:
- proposed row with `ratio NULL` inserts: `INSERT 0 1`, returns `proposed | (null) | 1`
- bogus method REFUSED: `ERROR: ... violates check constraint "requirement_evidence_method_check"` on `'guessed'`
- `length(quote) = char_end - char_start` still enforced on a proposed row: `ERROR ... requirement_evidence_check1`

Minor (not a defect): the `exception when undefined_table` guard wraps only the ADD CONSTRAINT
(`schema.sql:1101-1104`). The DROP at :1100 and the ADD COLUMN at :1108 are unguarded — harmless,
because `create table if not exists requirement_evidence` is at :394 of the same file, so the table is
always present by then. The guard is therefore dead code, and inconsistently applied.

Not in SCHEMA_SQL: `chk_evidence_escalate` / `chk_evidence_escalate_max` live only in
`ensureCheckPrefs` (runtime DDL), and `owner_search_prefs` is not in SCHEMA_SQL at all. Consistent
with the existing chk_ columns, so not a regression — but it means the pg-migrate step does not
create them; the first API call does.

---
## C1 — "ZERO model calls when the owner switched it off" — **CONFIRMED**
`test/zz-verifier-adversarial.test.mjs` V-C1a/b/c, with a counting spy transport:
```
ok 1 - V-C1a  (calls === 0, escalated 0, proposed 0, inserts 0)
ok 2 - V-C1b
ok 13 - V-C1c (escalateOne makes no call for a requirementClass row)
```
Three independent gates, all required (`appRequirements.ts:213`): `opts.escalate === true` **AND**
`fetchJson` truthy. And `resolveOptionsFrom` (`checkPrefs.ts:113`) maps a `false` column to
`escalate:false` — `!== false` upgrades only *absent*, never *false*.

Measured truth table for `resolveOptionsFrom`:
| DB state | `loadThresholds` yields | `escalate` |
|---|---|---|
| no `owner_search_prefs` row | `{}` | **true** (seed) |
| `chk_evidence_escalate = true` | `evidenceEscalate:true` | true |
| `chk_evidence_escalate = false` | `evidenceEscalate:false` | **false** |
| `chk_evidence_escalate = NULL` | `evidenceEscalate:false` (`=== true` in loadThresholds) | false |

**Caveat on how the claim is worded.** "Escalation makes zero model calls when the owner has switched
it OFF" is true. But the default is now **ON**, and the code still says otherwise in three places
(see WHAT I FOUND). `evidence.ts:275` still reads *"Escalation is OPT-IN. Absent means off — never
'unset, so use the default'."* — that comment is now false.

---
## C3 — "a proposed quote is byte-exact in the record it names" — **CONFIRMED**
`verifyProposal` (`evidenceProposal.ts:145`) is `rec.text.indexOf(quote)` on the ORIGINAL bytes: no
lowercasing, no normalize(), no trim, no fuzzy fallback. Every constructed near-miss was refused:
```
  leading space      substring=false -> refused:quote_not_in_record
  NBSP for space     substring=false -> refused:quote_not_in_record
  curly apostrophe   substring=false -> refused:quote_not_in_record
  ellipsis append    substring=false -> refused:quote_not_in_record
  digit paraphrase   substring=false -> refused:quote_not_in_record
  case tidy          substring=false -> refused:quote_not_in_record
  two records join   substring=false -> refused:quote_not_in_record
  zero-width space   substring=false -> refused:quote_not_in_record
  NFD-vs-NFC accent  substring=false -> refused:quote_not_in_record
  cross-record quote (A's text attributed to B) -> refused:quote_not_in_record
```
- **Unicode normalization**: no `.normalize()` anywhere on this path (`grep -c normalize` on
  evidenceProposal.ts / openaiJson.ts = 0). NFD-vs-NFC is refused, which is the conservative direction.
- **Trailing whitespace**: a trailing space is only accepted when it is *genuinely in the record*, and
  then the offsets still re-slice to it and `char_end-char_start === quote.length` holds (V2-e). My
  first probe flagged this as a leak; **that was my error, not the code's** — I asserted refusal for a
  string that really is a substring.
- **`contentJson` brace salvage**: a salvaged object still goes through `verifyProposal`; a salvaged
  paraphrase is refused `quote_not_in_record` (V-C3d). Nested braces yield `null` rather than a
  half-parsed object (V-C3e).
- **The re-slice in `writeEvidence`**: `appRequirements.ts:230` re-checks
  `rec.text.slice(e.char_start, e.char_end) !== e.quote` and increments `refused` + `offset_mismatch`.
  Executed (V-C3c): stored quote === record bytes at the stored offsets.

---
## C4 — "a transport failure never reads as 'the profile supports nothing'" — **CONFIRMED**
```
  thrown       -> evidenced=0 proposed=0 refusals={"transport_failed":1}
  httpError    -> evidenced=0 proposed=0 refusals={"transport_failed":1}
  nonJsonBody  -> evidenced=0 proposed=0 refusals={"unparseable":1}
  emptyBody    -> evidenced=0 proposed=0 refusals={"unparseable":1}
  missingKey   -> {"transport_failed":1}        (via the REAL openAiJson factory, OPENAI_API_KEY deleted)
  --- contrast ---
  model_declined -> {"model_declined":1}
```
All four leave the row unevidenced, write nothing, and none is reported as `model_declined`.
`openaiJson.ts:44` throws on a missing key; `:56` throws on non-2xx — both become `transport_failed`,
never a value that reads like an answer.
*Caveat:* `unparseable` and `transport_failed` are distinct from `model_declined` but **not from each
other in the owner-facing note** — `evidenceResolve`'s `note` (`appRequirements.ts:707`) reports only
`out.proposed`; `escalation_refusals` is returned in the JSON body but no UI copy names an outage.

---
## C5 — "a rejected proposed insert costs one row, not the run" — **CONFIRMED**
Fake client rejecting only the insert whose `requirement_id === 'p1'`:
```
  inserts: d1/exact, p2/proposed
  out: {"evidenced":1,"proposed":1,"refused":1,"r":{"insert_rejected":1}}
  begin=3 commit=2 rollback=1
```
The deterministic row `d1` survives; the *later* proposed row `p2` is still attempted and succeeds;
only `p1` is lost. `appRequirements.ts:236-252` wraps each proposed insert in its own
`begin`/`commit`, with `rollback` in the catch. Three `begin`s = the deterministic transaction plus
one per proposed insert, as claimed.
*Nit:* the comment says "ONE ROW, ONE SAVEPOINT" but the code uses `begin`/`commit`/`rollback`, i.e. a
**separate transaction**, not a `SAVEPOINT`. The behaviour is what was claimed; the word is wrong.

---
## C6 — "the resume draft is written from prompts, never from evidence" — **CONFIRMED**
The drafting chain reads, in order:
`ensurePackage` (`appPackets.ts:338`) -> `packet.pkg_json` cache, `generationJd(opp)`,
`buildPackageForJD` (`pipeline.ts:367`) -> `assemblePackage(c1,c2,c3)` (`mt17.ts:74`), then
`applyCorrectionPass` with `postingText` + `profileText` from `sourceText()`, then `writeSwaps`.
`assemblePackage` takes **only the three model calls** and `firstNonEmpty`s their slots. There is no
DB read of `requirement_evidence` anywhere in it.

`grep -rn requirement_evidence api/src/functions/tests/*.ts` (excluding schema.ts) hits exactly two
files: `appRequirements.ts` (the writer/reader) and `appPackets.ts` — and in `appPackets.ts` every hit
is a **comment** or the unrelated `PROFILE_SOURCES` set at :754. Zero query sites in the draft path.

Ordering: `packetBuildAll` builds every artifact in the `for (const a of artifacts)` loop
(`appPackets.ts:665-675`) and only then calls the evidence route (`:692`). CONFIRMED.

**Caveat, and it is now urgent:** at HEAD `c230f30` this is **BROKEN by the contaminating line above** —
a duplicate `selfPost(.../evidence...)` now runs BEFORE the loop. Removing `evidencePre` restores it.

---
## C8 — "the guards are not inert" — **CONFIRMED for 9 of 10; ONE REAL GAP FOUND**
Each defect was reinstated in the TypeScript source, `npm run build`, full `node --test test/*.test.mjs`,
then restored. Results:

| # | Defect reinstated | file | Result |
|---|---|---|---|
| M1 | `ruleEvidenceOf` -> `evidenceOf` in the coverage numerator | checks.ts:651 | **FIRED** (2 fail) |
| M2 | `opts.escalate === true` -> `!== false` | appRequirements.ts:213 | **FIRED** (1 fail) |
| M3 | `note('transport_failed')` -> `note('model_declined')` | appRequirements.ts | **FIRED** (1 fail) |
| M4 | remove the per-insert `begin`/`commit` | appRequirements.ts:236-252 | **FIRED** (2 fail) |
| M5 | `rec.text.indexOf(quote)` -> case-insensitive | evidenceProposal.ts:145 | **FIRED** (2 fail) |
| M6 | `escalate: !== false` -> `=== true` (revert on-by-default) | checkPrefs.ts:113 | **FIRED** (4 fail) |
| M7 | render the banned record into the prompt | evidenceProposal.ts:107 | **FIRED** (5 fail) |
| M8 | **delete the pre-insert offset re-check in the escalation block** | appRequirements.ts:230 | ***INERT — 0 fail*** |
| M9 | `ratio: null` -> `ratio: 1` on a proposed row (fabricated composite) | evidenceProposal.ts:262 | **FIRED** (1 fail) |
| M10 | move the evidence call BEFORE the build loop | appPackets.ts | **FIRED** (2 fail) |

### M8 — the one worthless guard, and it is the one the code brags loudest about
`appRequirements.ts:226-230` reads:
```ts
// THE SAME accusation-grade assertion the deterministic path makes, applied again here rather
// than trusted from `verifyProposal`. Two independent checks of the same invariant is not
// redundancy when one of them is the last thing standing between a model's string and a
// stored claim.
const rec = byKey.get(e.source_key)
if (!rec || rec.text.slice(e.char_start, e.char_end) !== e.quote) { refused++; note('offset_mismatch'); continue }
```
I replaced it with `if (!rec) { ... }` — deleting the byte comparison entirely. **The full suite still
passed, 662/662.** `M24`/`M25` guard the *deterministic* pre-store assertion; nothing guards this one.
So the "last thing standing between a model's string and a stored claim" can be deleted without any
test noticing. Add an H-case that drives a proposal whose offsets do not re-slice (e.g. a stubbed
`verifyProposal`, or a record mutated between verify and insert) and asserts `offset_mismatch`.

**Caveat on M4-M10:** the parent session was committing concurrently, so the baseline test count moved
(657 -> 658 -> 662) across the run. Each row's fired/inert verdict is a within-run comparison against
its own restore, so the verdicts stand, but the absolute counts are not comparable across rows.

---
# WHAT I FOUND THAT NOBODY ASKED ABOUT

### 1. `dimensions.ts` still grades a model proposal `strong`. **STILL OPEN at HEAD `c230f30`.**
Re-run after the parent's fix commit: `responsibilities_addressed` and `evidence_placed` are now on
`ruleEvidenceOf` and no longer leak. `dimensions.ts` was not touched and still does:
```
  WITH a proposed-shaped evidence row : [["platform_modernization","strong","evidence","Reduced outages from nine hours to one"]]
  WITHOUT any evidence row            : [["platform_modernization","weak","evidence",null]]
```
Commit `bee71aa`'s message says *"The guard is now written over the SET of evidence-reading checks
rather than over one name, so a fourth check added later that counts a proposed row as settled fails."*
That set is `checks.ts` only. The **fourth evidence-reading grader already exists**, in a different
file, and is not in the set. `appDimensions.shapeRequirement` (`:203-211`) drops `evidence_method`, so
`dimensions.ts` cannot be fixed without also widening that mapping.

### 2. `writeEvidence` MISCOUNTS `evidenced` when an escalation insert is refused.
`appRequirements.ts:257` `const evidenced = resolved.filter(r => r.evidence).length - refused` —
but `refused` is *also* incremented by the escalation block (`offset_mismatch` at :230,
`insert_rejected` at :251). An escalation-path refusal is therefore subtracted from the
**deterministic** evidenced count. Executed:
```
  rows actually STORED   : d1:exact, p2:proposed
  writeEvidence reported : {"total":3,"evidenced":1,"unevidenced":2,"refused":1,"proposed":1}
```
Two evidence rows are in the database; the route tells the owner one. `unevidenced` is
correspondingly inflated. This propagates to `evidenceResolve`'s owner-facing `note` and to
`packetBuildAll`'s `evidence.evidenced`. Control run with no insert failure reports correctly, so the
defect is exactly the shared counter. Fix: give the escalation block its own counter and stop folding
it into the deterministic `refused`.

### 3. Three comments now state the opposite of what the code does.
Commit `86c6e54` flipped the default to ON and did not sweep the prose that says it is OFF:
- `evidence.ts:275` — *"Escalation is OPT-IN. Absent means off — never 'unset, so use the default'."*
  `resolveOptionsFrom` does exactly the thing this sentence forbids.
- `appRequirements.ts:82` — *"Escalation is off by default"*, used as part of the safety argument for
  deploying code before the migration.
- `appRequirements.ts:207` — *"The owner's toggle is opt-in and its unconfigured state is OFF
  (`resolveOptionsFrom`)"* — names the function that contradicts it.
And the guard `H:escalation-is-off-by-default` (`matcher.test.mjs:1267`) keeps a name that asserts a
policy the product no longer has; it actually tests `writeEvidence`'s local `=== true` gate, which is
a different (still true) claim. Rename it, e.g. `H:escalation-needs-both-toggle-and-transport`.

### 4. `bee71aa`'s commit message describes a code change the commit does not contain.
`git show --name-only bee71aa` -> **`.claude/DEFERRED.md` only, 1 insertion, 1 deletion.** The message
claims *"Both now use it"*, *"Both fixes proven by reversion: each sibling reverted independently
fails the suite"*, and *"api build clean, 657/657 tests pass"*. The actual `checks.ts` fix landed in
`6f5a469`, whose subject is *"Accuracy log: I called correct model matches stretches"*. Two commits'
messages and contents are effectively swapped. Anyone auditing this later by `git log` will look in
the wrong commit. (The claimed 657/657 is also not reproducible: HEAD is 660/662 with the two
failures listed at the top of this file.)

### 5. Cost exposure of the default flip.
`openaiJson.ts:38` `const model = opts.model || process.env.OPENAI_MODEL || 'gpt-4o'` — the escalation
tier defaults to **gpt-4o** ($2.50/$10 per 1M, `usageMeter.ts` PRICES), not the mini tier the rest of
the packet pipeline uses (`packet:*:generate` logs `gpt-4o-mini`). Each call ships the **entire**
profile record set in `buildProposalUser`, once per unevidenced requirement, up to 12 per run — and
now for every owner with no `owner_search_prefs` row, without them ever opting in. `packetBuildAll`
calls the evidence route on every build. Metering IS wired (`logUsage('evidence:escalate', ...)`) and
gpt-4o is priced, so this is visible after the fact; it is not capped by budget, only by count.

### 6. `PROPOSAL_VERSION` is written twice, from two places, and they can drift.
`escalateOne` stamps `row.proposal_version = PROPOSAL_VERSION` (`evidenceProposal.ts:266`) and
`writeEvidence` then ignores it, binding the module-level `PROPOSAL_VERSION` constant into `$13`
directly (`appRequirements.ts:246`). Harmless today (same constant, same module) but the row's own
field is dead, and a future per-ruleset version on the row would be silently discarded.

### 7. "ONE ROW, ONE SAVEPOINT" is not a savepoint.
`appRequirements.ts:236-252` uses `begin`/`commit`/`rollback` — a separate transaction per insert, not
`SAVEPOINT`/`ROLLBACK TO`. The behaviour matches the claim; the terminology does not, and the comment
explains the Postgres poisoned-transaction rule that savepoints solve while not using one.

### 8. The CLAUDE.md schema recipe produced a vacuous test, and would have again.
It says to diff against `origin/main` — but this branch is already merged there, so
`git show origin/main:api/.../schema.ts` returns the branch's own file (diff: 1 newline). Following the
recipe literally applies a schema on top of itself and passes for free. I used `ebc52b4` instead. The
recipe needs "the merge-base / the last commit before your change", not "origin/main".

### 9. The `exception when undefined_table` guard in SCHEMA_SQL is inconsistent and dead.
`schema.ts:1100` (DROP CONSTRAINT) and `:1108` (ADD COLUMN) are unguarded while `:1101-1104` (ADD
CONSTRAINT) is wrapped. All three are unreachable-as-failures because `create table if not exists
requirement_evidence` is at `:394` of the same string. Confirmed by execution: the bare DROP against a
database without the table errors `relation "requirement_evidence" does not exist`. Harmless as
ordered; misleading as written.

### 10. Escalation outcome detail never reaches the owner's screen.
`escalation_refusals` distinguishes `transport_failed` / `unparseable` / `model_declined` /
`insert_rejected` / `over_cap` and is returned in the JSON body, but `evidenceResolve`'s human-readable
`note` (`appRequirements.ts:707`) mentions only `out.proposed`. An owner whose OpenAI key is missing
sees the same sentence as an owner whose profile genuinely supports nothing. That is the exact
distinction claim 4 exists to protect, preserved in the data and dropped at the last surface.

---
# VERDICT SUMMARY

| # | Claim | Verdict |
|---|---|---|
| 1 | Zero model calls when the owner switched escalation off | **CONFIRMED** (spy transport, 3 gate combinations) |
| 2 | A model-proposed row cannot turn `must_have_coverage` green | **CONFIRMED for that check.** REFUTED as a system property at the commit I was given: `responsibilities_addressed` leaked warn->pass (since fixed in `6f5a469`); **`dimensions.ts` still leaks weak->strong at HEAD** |
| 3 | A proposed quote is byte-exact in the record it names | **CONFIRMED** (10 adversarial near-misses, all refused; offsets re-slice) |
| 4 | A transport failure never reads as "the profile supports nothing" | **CONFIRMED** for all 4 modes + missing key; distinct from `model_declined` in the data, not in the owner-facing note |
| 5 | A rejected proposed insert costs one row, not the run | **CONFIRMED** (deterministic row and the later proposed row both survive) |
| 6 | The resume draft is written from prompts, never from evidence | **CONFIRMED in `86c6e54`. BROKEN at HEAD `c230f30`** by the contaminating `evidencePre` line |
| 7 | The schema change is real and safe | **CONFIRMED** — executed against a populated DB carrying `ebc52b4`'s schema; pre-existing `exact` row untouched, bogus method refused |
| 8 | The guards are not inert | **CONFIRMED for 9/10.** One guard is missing entirely: the escalation pre-insert offset re-check can be deleted with zero test failures |

### Required before this can be called done
1. **Delete `api/src/functions/tests/appPackets.ts:666` (`evidencePre`)** — my harness artefact, committed in `c230f30`. It breaks the owner's hard constraint and doubles build spend.
2. Fix `dimensions.ts` / `appDimensions.shapeRequirement` so a proposed row cannot grade a dimension.
3. Fix the `evidenced` miscount (escalation refusals decrementing the deterministic count).
4. Add an H-case for the escalation pre-insert offset assertion (currently unguarded).
5. Sweep the three comments and one test name that still say escalation is off by default.
6. Correct the record for `bee71aa` / `6f5a469` — the message and the code are in different commits.

### What I could NOT verify from this sandbox
- Nothing about the **live** system: no Azure, no production Postgres, no SPA. I did not run
  `db-query.yml` or `api-test.yml`; every verdict above is from local execution against a local
  Postgres 16.13 and the built `dist/`.
- Whether real OpenAI responses behave like my hand-written model answers. The transport is injected,
  so I exercised the rules, never the model.
- The Settings UI control for `chk_evidence_escalate` (`app/src/screens/Settings.jsx:1583`) — it exists
  in source; I did not render it.
