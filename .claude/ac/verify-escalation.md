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
