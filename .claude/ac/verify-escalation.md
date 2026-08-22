# Independent verification — escalation wiring
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
