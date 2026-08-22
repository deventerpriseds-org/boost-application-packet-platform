# Acceptance Criteria — Reasoning Overclaim Verification (Option A)

**Change under judgement:** extend `verifyProposal` (`api/src/functions/tests/evidenceProposal.ts`)
so the model-authored `reasoning` sentence is checked against the QUOTE it justifies. Where the
reasoning asserts a requirement token the quote does not carry, the reasoning is dropped (stored
null) and counted. The quote check (byte-exact `indexOf`) and the row itself are untouched.

**Measured defect:** db-query run 32541365164 — 2 of 5 stored justifications assert something their
own quote does not show ("security" on a scalability quote; "IoT" on a "real-time data collection"
quote).

**Status:** DRAFT — criteria 1-3 written from the brief before reading code; remainder appended
after reading `evidenceProposal.ts` / `requirementSupport.ts`.

---

## Criteria

1. **Given** the escalation-tier proposal for requirement "Ensure delivery of scalable, secure, and
   high-quality software" with the measured quote ("Redesigned a predictive analytics suite …
   scalable digital experience …") and the measured reasoning (which asserts "security"),
   **when** `verifyProposal` runs in `api/src/functions/tests/evidenceProposal.ts`,
   **then** the returned proposal has `reasoning === null` and the overclaim counter is incremented
   by exactly 1, proven by a unit case in `api/test/hardening.test.mjs` named with a slug
   (`H:reasoning-overclaim-security`) that passes the exact measured strings and asserts both.

2. **Given** the escalation-tier proposal for requirement "Knowledge of AI/ML and IoT technologies"
   with the measured quote ("Developed a SaaS platform integrating real-time data collection …")
   and the measured reasoning asserting "IoT data",
   **when** `verifyProposal` runs,
   **then** `reasoning === null` and the counter increments, proven by
   `H:reasoning-overclaim-iot` in `api/test/hardening.test.mjs` using the exact measured strings —
   and specifically NOT satisfied by any fuzzy/similarity score, since the token `iot` is absent
   from the quote by exact whole-word comparison.

3. **Given** a proposal whose reasoning stays general and introduces no requirement token the quote
   lacks (e.g. requirement "Ensure delivery of scalable … software", quote as measured, reasoning
   "The quote shows the candidate redesigned a service into a scalable digital experience."),
   **when** `verifyProposal` runs,
   **then** `reasoning` is returned unchanged (identical string, not trimmed-to-null, not
   rewritten) and the overclaim counter does not increment — asserted by
   `H:reasoning-no-false-positive` in `api/test/hardening.test.mjs`. False positives are the
   primary risk: a guard that drops sound reasoning will be switched off.
