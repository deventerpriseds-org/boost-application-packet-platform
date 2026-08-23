# AC — Advisory Gate Mode (owner-settable, default OFF)

Tier: **1** (it decides the artifact gate) per CLAUDE.md "Match the process to the risk".
Written by an independent AC subagent. **No implementation in this document.**
Status: ACs complete — awaiting owner sign-off before code.

> NOTE FOR THE IMPLEMENTER: while this was being written, `api/src/functions/tests/checkPrefs.ts`
> changed on disk in a parallel lane and already declares
> `add column if not exists chk_gate_advisory boolean not null default ${DEFAULT_THRESHOLDS.gateAdvisory}`.
> These ACs were derived independently from `origin`-state behaviour and are **not** written against
> that in-flight code. Where they contradict it (see RISK-2 and RISK-8 in particular — putting
> `gateAdvisory` inside `CheckThresholds` puts a blocking-policy flag into the object handed to
> `runChecks`), the AC is the requirement and the code must satisfy it.

---

## 0. What the change is, stated as an invariant

Advisory mode changes **one predicate**: whether a `fail` gate BLOCKS. It changes nothing about what
the engine measures, what it stores, or what it says.

```
today:      blocked  ==  (no gate row)  OR  gate=='fail'  OR  (gate=='warn' AND override_by IS NULL)
advisory:   blocked  ==  (no gate row)  OR  ((gate=='fail' OR gate=='warn') AND override_by IS NULL)
```

`gate`, `attention_count`, every `check_result` row, and every `artifact_score` column are byte-for-byte
untouched by the setting. A shipped-under-advisory artifact is one whose stored verdict still reads
`fail` and which additionally carries `override_by` / `override_at` / `override_reason`. That is the
whole design: the red verdict is preserved **because** it is the discoverability mechanism.

---

## 1. GROUND TRUTH — the blast radius is FIVE sites, not two

The brief named two. Grepping the concept (`gate === 'fail'` / `g.gate = 'fail'` / `railGate(...)==='fail'`)
across `api/src` and `app/src` finds **three more**, and if any of the three is missed the feature is
either unreachable through the product or reachable but unable to ship a packet.

| # | Site | File:line | What it does today | Why advisory must reach it |
|---|---|---|---|---|
| S1 | `approvalBlock` | `api/src/functions/tests/appChecks.ts:192` | `if (g.gate === 'fail') return { blocked: true, reason: '…a fail cannot be overridden' }` | The server-side approval gate. Sole caller: `appPackets.ts:297` (`artifactStatus`, `status==='approved'`). |
| S2 | `artifactGateOverride` | `api/src/functions/tests/appChecks.ts:289` | `if (g.gate === 'fail') return 409 'a fail cannot be overridden — fix the findings or re-run the checks'` | Without this the owner can never *record* the override that S1 would now honour. S1 and S2 are useless apart. |
| **S3** | `recomputePacket` | `api/src/functions/tests/appPackets.ts:137-143` | `select count(*) … where a.packet_id=$1 and g.gate='fail'` → `failing`; `ready` requires `allApproved && failing===0` | **THE ONE MOST LIKELY TO BE MISSED.** Because the gate VALUE stays `fail` (§0), every artifact could be `approved` under advisory and the packet would still compute `review`, never `ready`, so `Send packet →` still never renders. The owner would be told it shipped and it would not have. |
| **S4** | `footerFor` | `app/src/assetGate.js:138-141` | `gate==='fail'` ⇒ `{ disabled: true, headline:'Blocked', reason:'…a fail cannot be overridden' }`, and **no `needsReason`** | The Approve button is disabled client-side, so the reason prompt never opens and `api.artifactGateOverride` (`AssetGateDrawer.jsx:445`) is never called. The server change is unreachable through the UI without this. |
| **S5** | `qcStepState` / `packetGate` | `app/src/qcRail.js:662` and `:678` | `failing = list.filter(e => railGate(e.result)==='fail')` ⇒ QC step never `done`; `packetGate` returns `'fail'` | The QC rail step stays open and red, contradicting a packet the server has moved to `ready`. `qcRail.js:652` says in its own comment that it is "approvalBlock() … restated as a question about the whole packet — the same rule, not a second opinion." If S1 moves and S5 does not, that comment becomes false and the two disagree. |

**AC-0.** Given the five sites above, when the change is complete, then a `grep -rn` for the fail-blocking
concept in `api/src/` and `app/src/` returns **no site that still blocks unconditionally**, and each of
S1–S5 reaches its decision from the *same* owner setting value (S4/S5 from a value the server sent in the
payload — never a second client-side source of truth; see AC-24).

---

## 2. Acceptance criteria

### A. DEFAULT OFF — proving the change is inert (the most important ACs in this set)

**AC-1.** Given an owner whose `owner_search_prefs` row has `chk_gate_advisory = false`, and an artifact
whose `artifact_gate` row is `gate='fail'`, when `POST /api/app/artifact/{id}/status {"status":"approved"}`
is called with a verified session, then the response is **HTTP 409** with body
`{"error":"<N> blocking finding(s); a fail cannot be overridden","gate":"fail","artifactId":"<id>"}` —
the same status code, the same key set, and the same `error` string, character for character, as
`origin/main` produces for the same row.

**AC-2.** Given the same owner and artifact, when `POST /api/app/artifact/{id}/gate-override {"reason":"shipping tonight"}`
is called with a verified session, then the response is **HTTP 409** with
`{"error":"a fail cannot be overridden — fix the findings or re-run the checks","gate":"fail"}`,
character for character as today, and `artifact_gate.override_by` remains `NULL`.

**AC-3 — THE INERTNESS PROOF (mechanised, not argued).** Given the blocking decision is extracted into
one pure, exported, synchronously-testable function of the form
`gateDecision({ gate, overrideBy, attentionCount, advisory })` returning the existing
`{ blocked, reason, gate }` shape, when a test enumerates the **complete** input matrix —
`gate ∈ {null (no row), 'pass', 'warn', 'fail'} × overrideBy ∈ {null, 'x@y.z'} × attentionCount ∈ {0, 3}`
= 16 rows — with `advisory: false`, then **every one of the 16 output tuples is deep-equal to a frozen
expected table checked into the test file**, and that frozen table is produced by running the same 16
inputs through `origin/main`'s `approvalBlock` logic (transcribed into the test with the `origin/main`
source quoted in the comment above it). One deep-equal assertion over the whole matrix; no sampling.
*Rationale: "it behaves the same" is unfalsifiable prose; a 16-row frozen truth table is falsifiable in
one command, and it is the only artifact that makes "inert when off" a checkable claim rather than a
promise.*

**AC-4.** Given the same 16-row matrix run with `advisory: true`, when the outputs are compared to the
`advisory: false` outputs, then **exactly the four `gate='fail'` rows differ** (1 gate × 2 `overrideBy`
× 2 `attentionCount`) and the twelve `null`/`pass`/`warn` rows are unchanged in every field. Of the four:
the two with `overrideBy=null` change only their `reason` to the override-needed wording (`blocked` stays
`true`); the two with `overrideBy` set change `blocked` from `true` to `false`. *A thirteenth differing
row means the setting reached a decision it has no business touching.*

**AC-5.** Given `advisory=false` and an artifact with `gate='fail'` **that already carries an
`override_by`** (possible only if the row was overridden while advisory was on and the setting was then
turned off), when approval is attempted, then it is **blocked** — turning the setting off re-blocks a
previously-overridden fail rather than grandfathering it. *Observable: HTTP 409 with the AC-1 body.
An override is permission granted under a policy; revoking the policy revokes the permission.*

**AC-6.** Given an owner who has **no row at all** in `owner_search_prefs` (`loadThresholds` returns `{}`),
when any of S1–S5 evaluates, then advisory is **OFF**. The reader must resolve `=== true`, **not** the
`!== false` pattern used by `evidenceEscalate` in `resolveOptionsFrom` — that pattern exists to make a
setting default ON and is the exact inversion of what is required here. *Observable: a unit test asserting
the resolver returns `false` for `{}`, `{ gateAdvisory: undefined }`, `{ gateAdvisory: null }`, and
`{ gateAdvisory: 0 }`, and `true` only for the boolean `true`.*

### B. ON — override only through the existing audited path

**AC-7.** Given `chk_gate_advisory = true` and an artifact at `gate='fail'`, when
`POST /api/app/artifact/{id}/gate-override` is called with a **verified** session and
`{"reason":"owner accepted: evidence resolver is known-blind, shipping tonight"}`, then the response is
**HTTP 200**, and `select gate, override_by, override_at, override_reason from artifact_gate where artifact_id=$1`
returns `gate='fail'` (unchanged), `override_by = <the session's resolved owner email>`,
`override_at` non-null, `override_reason` = the submitted string.

**AC-8.** Given `chk_gate_advisory = true` and the same artifact, when the override is attempted with
`{"reason":"ok"}` (7 characters or fewer after trim), then the response is **HTTP 400**
`{"error":"a reason of at least 8 characters is required"}` and `override_by` stays `NULL`.
*The advisory branch must sit AFTER the existing `reason.length < 8` check, not beside it.*

**AC-9.** Given `chk_gate_advisory = true`, when the override is attempted with an **unverified**
session (no verified Bearer — e.g. `?owner=` only), then the response is **HTTP 403**
`{"error":"an override needs a verified session — the audit row records who did it"}` and `override_by`
stays `NULL`. Given no session at all, `requireWrite` refuses first, unchanged.

**AC-10.** Given `chk_gate_advisory = true`, when the override succeeds, then `override_by` is the
**server-resolved** owner from `resolveOwner(req)` and there is **no request-body field** by which a
caller can name a different actor. *Observable: posting `{"reason":"…","override_by":"someone@else.com"}`
stores the session owner, not the body value. This is the `artifact_gate` comment's own rule
(`schema.ts:536-539`), and advisory mode must not become the hole in it.*

**AC-11.** Given `chk_gate_advisory = true` and an artifact at `gate='fail'` with an override recorded,
when `POST /api/app/artifact/{id}/status {"status":"approved"}` is called, then it returns **HTTP 200**
and `artifact.status='approved'`. Given the same artifact **without** an override recorded, then it
returns **HTTP 409** with reason `"<N> finding(s) need an explicit override with a reason"` —
advisory makes a fail *overridable*, it never makes a fail *pass*.

**AC-12.** Given `chk_gate_advisory = true` and an artifact at `gate='pass'`, when the override route is
called, then the existing `{"ok":true,"gate":"pass","note":"nothing to override"}` 200 is returned
unchanged. *No new override rows on clean artifacts.*

### C. REPORTING MUST NOT CHANGE

**AC-13.** Given one artifact and one fixed set of inputs, when `evaluateArtifact` is run with
`chk_gate_advisory = false` and then again with `chk_gate_advisory = true`, then for the two runs:
every `check_result` row matches on `(check_key, engine, state, observed, expected, offenders)`;
`artifact_gate.gate` is identical; `artifact_gate.attention_count` is identical; and every
`artifact_score` column (`must_have_coverage`, `must_have_source`, `keyword_coverage`, `keyword_source`,
`seniority_alignment`, `seniority_source`, `composite`, `band`, `uncovered_requirement_ids`,
`judged_requirement_ids`, `engine_version`, `weights`) is identical.
*Observable proof: the two runs' rows are compared with a single deep-equal over the projected sets — not
eyeballed. Run ids and timestamps are excluded from the comparison and nothing else is.*

**AC-14.** Given the check engine, when the source is inspected, then `runChecks`, `gateFor`,
`attentionCount`, `computeArtifactScore` and every function they call contain **no reference** to the
advisory setting under any name (`gateAdvisory`, `chk_gate_advisory`, `advisory`). *A source-level guard,
because this is a structural rule a runtime test can only sample. See RISK-2: routing the flag through
`CheckThresholds` puts it inside the object literal handed to `runChecks`, one careless `if` away from
becoming an input to a measurement.*

**AC-15.** Given `GET /api/app/artifact/{id}/checks-result`, when it is called with advisory on and with
advisory off for the same unchanged artifact, then `gate`, `attention`, `results`,
`engines.deterministic.results`, `engines.reviewer.results` and `score` are identical. The response MAY
gain new keys describing the *policy* (see AC-22) but MUST NOT change the value of any existing key.

**AC-16.** Given `reconcile()` in `app/src/assetGate.js`, when advisory is on and an artifact is
`gate='fail'` with an override, then `reconcile()` reports **no** contradiction. *A payload that is
"fail + overridden" must not be read by the UI's own self-consistency check as the server contradicting
itself; if it is, the drawer starts printing a warning on every packet the owner ships.*

### D. END-TO-END — the packet reaches `ready` and `Send packet` appears

**AC-17.** Given a packet whose every buildable artifact (`metaFor(a.type)` — video excluded, per
`appPackets.ts:127`) is at `gate='fail'`, and `chk_gate_advisory = true`, when the owner records an
override with a reason on each such artifact and approves each one, then:
1. every `artifact.status = 'approved'`;
2. `recomputePacket` computes `allApproved = true` **and** `failing = 0`, where `failing` counts only
   `gate='fail'` rows **with `override_by IS NULL`**;
3. `packet.status = 'ready'`;
4. the Packet Builder renders `Send packet →`.
*Observable: `db-query.yml` showing `packet.status='ready'` for that packet id, plus a `ui-verify.yml`
run whose EXPECT includes `Send packet`. Steps 2 and 3 are the ones that fail silently if S3 is missed:
every artifact reads `approved`, and the packet still says `review`.*

**AC-18.** Given `chk_gate_advisory = false`, when the same query runs, then `failing` counts **every**
`gate='fail'` row regardless of `override_by`, exactly as today. *AC-17's relaxation must itself be
conditioned on the setting; an unconditional `and override_by is null` in that count is a behaviour
change with the setting off, and AC-13/AC-3 alone would not catch it because it is neither a check row
nor `approvalBlock`.*

**AC-19.** Given a packet made `ready` under advisory overrides, when the packet is sent, then
`packet.status='sent'` and `sent` remains terminal through subsequent `recomputePacket` calls
(unchanged behaviour, `appPackets.ts:111-116`).

### E. GRANULARITY

**AC-20.** Given `artifact_gate.artifact_id` is the primary key, when an override is recorded, then it
covers **exactly one artifact and exactly one run** (`artifact_gate.run_id` at the time of the override).
There is **no packet-level override**, no route that overrides more than one artifact per call, and
overriding artifact A leaves artifact B's `override_by` `NULL`. *Observable: a packet of 4 blocked
artifacts requires 4 separate overrides with 4 separate reasons; `select count(*) from artifact_gate
where … and override_by is not null` = 1 after the first call.*

**AC-21.** Given advisory is on, when the owner overrides, then the reason they typed is stored against
**that artifact**, not copied to siblings. *Rationale: the reason is the audit record's only content. A
blanket reason applied to four assets says nothing true about any of them, and "Approve all" would make
the audit trail a formality — which is precisely the objection to advisory mode, and the thing that must
not be true of it.*

### F. RE-RUN BEHAVIOUR — the override must NOT survive

**AC-22.** Given an artifact with a recorded advisory override, when the deterministic checks are re-run
(`POST /api/app/artifact/{id}/checks` → `evaluateArtifact`), then the existing `on conflict … do update
set … override_by = null, override_at = null, override_reason = null` (`appChecks.ts:150-156`) **still
fires**, the override is cleared, and the artifact is blocked again until re-overridden — under advisory
on *and* off.

**The argument, because this is where a naive implementation will "helpfully" diverge:** an override is a
human judgement about a **specific enumerated set of findings**, identified by `run_id`. A re-run
replaces that set. The new set may be worse — more findings, different findings, a different artifact
body — and the recorded reason ("accepted: two skills over the character limit") would then be attached
to findings the human never saw. Preserving the override across a re-run does not preserve a decision; it
**fabricates** one. Advisory mode makes this *more* dangerous, not less: today a fail can never be
overridden at all, so a surviving override could only ever mis-authorise a warn. Under advisory it would
mis-authorise a blocking finding, silently. The clearing behaviour is therefore load-bearing and must be
proven still live after the change, not merely left alone.

**AC-23.** Given an artifact that was approved under an advisory override and whose packet is `ready`,
when the checks are re-run and the gate is still `fail`, then `recomputePacket` recounts `failing` as 1
(the override is gone), and `packet.status` drops from `ready` back to `review`. *Observable end-to-end:
the packet leaves the ready group by itself. `appPackets.ts:137-139` already documents this exact
intention for the non-advisory case; advisory must not break it.*

**AC-24.** Given the reviewer pass re-aggregates the gate (`appReviewer.ts:337-342`), when it produces
any `warn`/`fail` row (`clearOverride = ran && rows.some(...)`), then the advisory override is cleared
by the same rule and the caller is told — unchanged. Given a reviewer **refusal** path (no posting text,
no model call, only `not_applicable`), the override is **not** cleared — also unchanged.

### G. DISCOVERABILITY — the owner must be able to see it shipped on an exception

**AC-25.** Given the gate value is deliberately left at `fail` (§0), when a packet ships under advisory,
then **every existing red surface stays red**: the asset badge, the drawer headline, `packetGate()`, and
the `attention` count. *This is the primary discoverability guarantee and it is free — it is the reason
AC-37 forbids rewriting the gate to `warn`.*

**AC-37 — the gate VALUE is never rewritten.** Given advisory mode is on, when any code path executes,
then no statement anywhere writes `gate='warn'` (or any value other than what `gateFor()` computed) into
`artifact_gate` on account of the setting, and no response body reports a `gate` other than the stored
one. Advisory changes the **blocking decision**; it never edits the **verdict**. *See RISK-3 for why this
is the single most damaging naive implementation available.*

**AC-26.** Given an artifact approved under an advisory override, when the asset drawer is open, then it
shows the actor, the timestamp, and the verbatim reason — the existing `warn_overridden` footer copy
(`assetGate.js:143-145`: "`<by>` accepted these findings: `<reason>`") extended to the fail case with
wording that does **not** read as clearance. *Binary check: the rendered string contains the override
actor's email and the reason text, and does not contain the word "Clear".*

**AC-27.** Given the packet is `ready` **because of** one or more overrides, when the Packet Builder
renders it, then the ready state is visually distinguished from a merit-clean ready state, and names the
count: e.g. "Ready — N asset(s) accepted with a recorded exception". *Binary check: `ui-verify.yml` with
`expect` containing both `Ready` and `exception`; and for a merit-clean packet the same EXPECT must
**not** match. Two runs, one asserting presence and one asserting absence — otherwise the badge could be
unconditional and still pass.*

**AC-28.** Given `qcStepState` (`qcRail.js:653-668`), when the QC step is marked done under advisory,
then its `reason` string states that findings were **accepted**, never that they are clear. The existing
`'every asset is clear, or its findings were accepted with a recorded reason'` string must not be shown
for a packet that carries an overridden `fail` without naming the fail. *Binary: the reason for an
advisory-shipped packet contains "blocking" or "accepted", and the count.*

**AC-29.** Given the data needed by AC-26–28 (`override.by`, `override.at`, `override.reason` per
artifact), when the packet screen loads, then that data reaches it **from the server payload** the packet
screen already fetches — not by the client inferring an exception from `gate==='fail' && status==='approved'`.
*A client-side inference is a second source of truth for the same fact and is how S4/S5 came to disagree
with S1 in the first place. `GET /checks-result` already returns `override`; the packet/artifact list
payload must carry it too, or the packet screen must fetch it, but exactly one of those.*

**AC-30.** Given the owner asks "which packets shipped on an exception?", when a single DB query is run,
then it answers: `select p.id, count(*) from artifact_gate g join artifact a on a.id=g.artifact_id join
packet p on p.id=a.packet_id where g.override_by is not null and g.gate='fail' group by p.id`. *This is
already answerable from the schema with no new column — stated as an AC so that no one adds a
`shipped_under_advisory` flag that can drift from the row that actually proves it.*

### H. SETTINGS

**AC-31.** Given `chk_gate_advisory` is declared inside `ENSURE_CHECK_COLUMNS_SQL` in
`api/src/functions/tests/checkPrefs.ts` as `boolean not null default false`, when `checkPrefColumns()`
runs, then it returns `{ column: 'chk_gate_advisory', type: 'boolean' }` — which automatically makes it
writable by `writeCheckPrefs` (derived whitelist) and renderable by `ChecksSettings` in
`app/src/screens/Settings.jsx` (which maps over `checkColumns`). *No hand-maintained list is added
anywhere; H42's lesson holds.*

**AC-32 — the setting must reach the EXISTING owner.** Given `von.ellis@enterpriseds.io` already has a
row in `owner_search_prefs` created before this change, when the schema is applied, then
`select chk_gate_advisory from owner_search_prefs where owner_email='von.ellis@enterpriseds.io'` returns
**`false`**. *Note the mechanism precisely, because the brief's warning about `syncCheckPrefDefaults`
points at a different failure: `add column if not exists <new> not null default false` **does** backfill
existing rows, because the column is new. `syncCheckPrefDefaults` exists for the other case — a
**changed** seed on an **existing** column, which `add column if not exists` skips entirely. Both must
hold here: (a) the new column backfills existing rows to `false` — verified by `db-query.yml` against
production, not by reasoning; (b) `syncCheckPrefDefaults` must still run and must not throw on a boolean
seed (it interpolates `SEEDED_DEFAULT[column]`, which for this column is the literal `false`) — verified
by `select column_default from information_schema.columns where column_name='chk_gate_advisory'`
returning `false`.*

**AC-33.** Given the Settings ▸ Quality checks screen, when it renders `chk_gate_advisory`, then it shows
a **human label and help text**, not the raw column name. `CHK_LABELS` in `Settings.jsx:1580-1600` must
gain an entry; without one the fallback `[column, '']` prints `chk_gate_advisory` with no explanation.
The help text must state the consequence in the owner's words — that a blocking finding can then be
shipped past with a recorded reason, and that the finding itself is still reported and still recorded
against the packet. *Binary: `ui-verify.yml` on the settings route with `expect` containing the label and
a fragment of the help text, and **not** containing the string `chk_gate_advisory`.*

**AC-34.** Given the owner toggles it on and saves, when `POST` the search-prefs route returns, then
`wroteChecks` includes `chk_gate_advisory`, and a subsequent `GET` returns the new value. Given the owner
toggles it off, then the next approval attempt on a `fail` artifact returns the AC-1 409 **without a
redeploy** — the setting is read per request, never cached in module scope.

**AC-35.** Given the boolean control, when it is rendered, then it is a checkbox/toggle (the `type==='boolean'`
branch that `chk_evidence_escalate` already uses), and `writeCheckPrefs` rejects a non-boolean value for it
(`if (typeof raw !== 'boolean') continue`) — so `"true"` as a string is ignored rather than coerced.

**AC-36.** Given `H:every-threshold-is-configurable` (`hardening.test.mjs:3802`) asserts every
`DEFAULT_THRESHOLDS` rule is loadable from owner config, when the advisory flag is added, then that test
still passes **and** its meaning is not quietly widened. If `gateAdvisory` is placed in
`DEFAULT_THRESHOLDS`/`CheckThresholds`, `loadThresholds` must map it — but see AC-14 and RISK-2: a
blocking-policy flag inside the object handed to `runChecks` is a category error. Preferred: the flag is a
`chk_*` column read by its own resolver, and `H:every-threshold-is-configurable` is left describing
measurement thresholds only.

---

## 3. Regression guard spec — `api/test/hardening.test.mjs`

Naming per CLAUDE.md: **slug, never a number**, at least two words. `H1`–`H44` are frozen; `H26`
fails the suite on a new numeric id.

**EVERY guard below carries a MANDATORY mutation proof.** The procedure is fixed and is not optional
at any tier (CLAUDE.md, "THE ONE STEP THAT IS NEVER SKIPPED"): write the guard → revert the exact
behaviour it guards → run `node --test api/test/hardening.test.mjs` → **confirm that specific test
FAILS** → restore → confirm it passes. Record the observed failure message in the commit. A guard that
passes with its defect reinstated is protection that protects nothing, and is worse than none because
it is believed. If a mutation is behaviourally equivalent and correctly fails to fail, **say so** and do
not claim the assertion proven.

| # | Slug | Asserts | Mutation that MUST make it fail |
|---|---|---|---|
| G1 | `H:advisory-off-still-blocks-a-fail` | The AC-3 16-row frozen truth table with `advisory:false`, deep-equal in one assertion. | Change the `advisory:false` fail branch to return `blocked:false`. Also, separately: swap the resolver to `!== false`, which flips an unset owner ON — must fail on the `{}` case. |
| G2 | `H:advisory-needs-the-setting-at-every-site` | **Source guard.** In `stripComments`'d sources, every construct that decides on a `fail` — `appChecks.ts` (S1, S2), the `failing` count SQL in `appPackets.ts` (S3), `assetGate.js footerFor` (S4), `qcRail.js qcStepState`/`packetGate` (S5) — is within a branch that reads the advisory value. Enumerate the five sites by name; assert the count of fail-deciding sites found equals 5, so a **sixth** site added later fails the test rather than slipping through. | Delete the setting check from **each** site in turn (5 mutations, run separately). Each must fail. This is the guard that catches the brief's own undercount of the blast radius. |
| G3 | `H:advisory-never-rewrites-the-gate` | **Source guard.** No source under `api/src/functions/tests/` contains a write of a literal gate value conditioned on the advisory flag; `gateFor()` remains the sole producer of the value stored in `artifact_gate.gate`. Plus a runtime assertion: with advisory on, an artifact whose checks produce a deterministic fail still stores `gate='fail'`. | Add `gate = advisory ? 'warn' : gate` before the upsert. Must fail on both halves. |
| G4 | `H:advisory-does-not-change-what-the-checks-say` | Runtime: `runChecks` + `gateFor` + `attentionCount` + `computeArtifactScore` over one fixed input produce identical output with the flag true and false (AC-13). Source: the AC-14 grep — no advisory identifier appears in the measurement path. | Make one check's threshold or one `gateFor` branch read the flag. Must fail. |
| G5 | `H:advisory-override-keeps-the-audit-trail` | The override route's ordering is intact: `requireWrite` → `verified` 403 → `reason.length < 8` 400 → advisory branch. Assert all three refusals still fire with advisory ON, and that `override_by` is written from the resolved session, never from the body. | Move the advisory branch above the `verified` check; and separately, lower the reason minimum to 0. Each must fail. |
| G6 | `H:a-rerun-clears-an-advisory-override` | The `evaluateArtifact` upsert still contains `override_by = null, override_at = null, override_reason = null` in its `do update set`, unconditionally (not wrapped in `if (!advisory)`), and `appReviewer`'s `clearOverride` rule is unchanged. | Wrap the clearing in an advisory conditional, or delete it. Must fail. |
| G7 | `H:advisory-defaults-off-for-an-existing-owner` | `checkPrefColumns()` includes `chk_gate_advisory` as `boolean`; `SEEDED_DEFAULT['chk_gate_advisory'] === 'false'`; the resolver returns `false` for `{}`, `undefined`, `null`, `0`, `'true'` and `true` only for boolean `true`. | Change the declared default to `true`; change the resolver to `!== false`. Each must fail. |
| G8 | `H:advisory-is-visible-where-a-packet-ships` | `assetGate.js` / `qcRail.js` / the packet ready state each surface the override's actor and reason for an overridden fail; `reconcile()` returns no contradiction for a `fail`+override payload (AC-16). | Remove the override from the footer copy for the fail case; and separately make `reconcile()` flag `fail`+override. Each must fail. |
| G9 | `H:ready-counts-an-override-only-when-advisory` | The `failing` SQL relaxation in `recomputePacket` is conditioned on the setting (AC-18): with the flag off the count includes overridden fails. | Make `and override_by is null` unconditional. Must fail. This is the mutation that proves S3 was not merely edited but edited *conditionally*. |

**Live verification required in addition to the suite (tier 1):**
- `db-query.yml` — `select column_default from information_schema.columns where table_name='owner_search_prefs' and column_name='chk_gate_advisory'` ⇒ `false`; and `select chk_gate_advisory from owner_search_prefs where owner_email='von.ellis@enterpriseds.io'` ⇒ `false`.
- `api-test.yml` — the AC-1 and AC-2 409s **before** the toggle is flipped (proving inertness on the live system, not just in the suite), then the AC-7/AC-11 200s after.
- `db-query.yml` — `select status from packet where id='<id>'` ⇒ `ready` (AC-17), and after a re-run ⇒ `review` (AC-23).
- `ui-verify.yml` — the settings label (AC-33), the exception-badged ready state present (AC-27) and absent on a merit-clean packet.

---

## 4. Adversarial risks and naive-implementation traps

**RISK-1 — the blast radius is 5 sites and the brief says 2; missing S3 makes the feature look done and ship nothing.**
`recomputePacket` counts `g.gate='fail'` with no reference to `override_by`. Because AC-37 keeps the
gate value at `fail`, an implementer who changes only `approvalBlock` and `artifactGateOverride` will see
every artifact go `approved` — every API call returning 200 — and the packet will still compute `review`
and `Send packet →` will still not render. The failure mode is the worst kind: all the evidence they
would naturally gather says success. **Mitigation: G2 and G9, and AC-17 stated as an end-to-end
observable (`packet.status='ready'` in the DB) rather than as a series of 200s.**

**RISK-2 — routing the flag through `CheckThresholds` puts a blocking-policy flag into the measurement engine.**
The in-flight code adds `DEFAULT_THRESHOLDS.gateAdvisory` and a `chk_gate_advisory` column beside the
threshold columns. That is a tempting reuse (it gets the writer and the Settings UI for free, per AC-31)
but `thresholds` is the object handed straight into `runChecks({ …, thresholds })`. Every other member of
that object is an input to a *measurement*. One flag in there that is an input to a *policy* is one
`if (thresholds.gateAdvisory)` away from an engine that measures differently when the owner is in a
hurry — and that would corrupt `check_result` and `artifact_score` history permanently, invisibly, and
with no way to tell the two populations apart afterwards. It also silently widens
`H:every-threshold-is-configurable` from "every measurement rule is configurable" to "every flag is",
weakening a guard while appearing to satisfy it. **Mitigation: AC-14 (source guard, no advisory identifier
anywhere in the measurement path), AC-36, G4. Keep the column — it belongs with the other `chk_*` owner
prefs — but give it its own resolver rather than threading it through `CheckThresholds`.**

**RISK-3 — "just downgrade the gate to `warn` when advisory is on." This is the most damaging shortcut available.**
It is a one-line change, it makes every one of S1–S5 work with no further edits, and it is wrong on four
counts: (a) it **falsifies the stored verdict** — `artifact_gate.gate` is the engine's recorded finding,
and rewriting it means the database no longer contains the fact that a deterministic check failed;
(b) it **destroys the audit trail's meaning** — the override row would then say "a warn was accepted",
which is a materially different and much smaller claim than the one the human actually made; (c) it
**breaks score-history comparability** — gate values before and after the change would no longer be
drawn from the same distribution, so any trend over `artifact_score.band` / gate mix silently shifts and
nothing records why; (d) it **destroys the discoverability that AC-25 gets for free** — every red badge
turns yellow, and the owner loses the one visual signal distinguishing a packet that shipped on merit
from one that shipped on an exception. The gate is the engine's testimony. Advisory mode is a decision
about what to do with that testimony, and it does not get to edit it. **Mitigation: AC-37, G3.**

**RISK-4 — an override granted before a re-run silently authorises a WORSE set of findings.**
Structurally closed today by the unconditional clearing in the `artifact_gate` upsert — which is exactly
why it is at risk: an implementer chasing "the owner had to re-override after every regenerate, that's
annoying" will make the clearing conditional on advisory, or drop it. Under advisory that turns a
human's approval of two over-length skill bullets into standing authorisation for whatever the next run
finds, including findings that never existed when they typed the reason. **Mitigation: AC-22 with the
argument stated, AC-23 as the observable (the packet leaves `ready` by itself), G6 with the mutation.**

**RISK-5 — the setting defaults ON for existing owners, or for the owner with no prefs row.**
Two distinct mechanisms, and only one of them is the one the brief warns about. (i) A *new* column
declared `not null default false` **does** backfill existing rows, so an existing owner lands on `false` —
but if it is declared `default true` "so the owner can ship tonight", every owner including `demo@` gets
a permanently weaker gate that nobody chose. (ii) The `resolveOptionsFrom` house style for
`evidenceEscalate` is `!== false`, deliberately ON-by-default for an owner with **no row** — and
`ensureCheckPrefs` only adds the column, it never inserts a row, so "no row" is a live state.
Copy-pasting that idiom here defaults advisory ON for exactly the owners who never configured anything.
**Mitigation: AC-6 and AC-32 (both mechanisms, verified against the live DB not by reasoning), G7 with
both mutations.**

**RISK-6 — `attention_count` and `artifact_score` history stop being comparable across the change.**
They stay comparable **only if** AC-13/AC-37 hold: the same inputs must produce the same rows, and the
gate must not be rewritten. If either is violated the break is retroactive and unfixable, because
`check_result` and `artifact_score` are append-only history with no column recording which policy was in
force. Note also that `artifact_score` is keyed `(artifact_id, run_id) do nothing` — a re-run after an
override writes a *new* run's score, so the history is dense and any distribution shift will be visible
in it. **Mitigation: AC-13 as a deep-equal over the projected row sets, G4. Additionally: do NOT add a
`policy`/`advisory` column to `check_result` or `artifact_score` to "make it comparable" — that admits a
policy flag into the measurement record, which is RISK-2 in a new place. The override row on
`artifact_gate` already carries the fact (AC-30).**

**RISK-7 — the client-side mirrors become a second source of truth.**
S4 (`footerFor`) and S5 (`qcStepState`) restate `approvalBlock` in JS, and both say so in their own
comments. If the advisory value reaches them from anywhere other than the server payload — a separate
settings fetch, a `localStorage` cache, a prop threaded from a different screen — then the button's
opinion and the server's 409 can disagree per-screen, which is the exact class of defect
`app/src/assetGate.js`'s `reconcile()` was written to catch. Worse: a client that decides advisory is on
while the server says off shows an enabled Approve button that 409s, and the owner concludes the product
is broken. **Mitigation: AC-24/AC-29 (one payload, server-sent), AC-16, G8.**

**RISK-8 — advisory becomes permanent because nothing tracks why it was turned on.**
The owner's stated intent is to unblock shipping **tonight** while the deterministic evidence resolver
(0 of 35 resolving, `must_have_coverage` pinned at 0/12) is fixed in parallel. Once on, the toggle has no
expiry, no reminder, and no record of the condition it was compensating for; the packets shipped under it
carry reasons, but the *policy* does not. The realistic failure is not a bug — it is that in three weeks
the gate is advisory, the resolver is fixed, and nobody turns it back off, so the product's quality gate
is permanently a suggestion. **Mitigation: not code. Two things: (a) AC-33's help text must state that
this is a temporary posture and what turning it off restores; (b) `.claude/actions.md` records the
advisory toggle as an OPEN item tied to the evidence-resolver fix, so that closing the resolver work
surfaces "turn advisory back off" rather than leaving it to memory. Flagging it here because an AC set
that only covers the mechanism would let the mechanism outlive its reason.**

**RISK-9 — the two `appChecks.ts` sites get fixed inconsistently.**
S1 and S2 are 97 lines apart and phrased differently (`return {blocked:true,…}` vs `return 409`). An
implementer who fixes S2 but not S1 produces a system where the owner can record an override and still
cannot approve — an audit row for a decision that had no effect, which is a worse artifact than no
override at all. The reverse (S1 but not S2) produces an unreachable relaxation. **Mitigation: G2
enumerates both by name and asserts the site count, so neither can be edited alone and a sixth site
added later fails the suite.**

---

## 5. Out of scope (stated so it is a decision, not an omission)

- Fixing the deterministic evidence resolver (0 of 35). This AC set deliberately does not touch
  `must_have_coverage`; advisory mode is the unblock, the resolver is the fix, and conflating them
  would make the resolver work hostage to the ship.
- Any packet-level or bulk override (AC-20/AC-21 forbid it).
- Any change to what `gateFor` / `attentionCount` / `computeArtifactScore` compute (AC-13/AC-14).
- Any expiry, TTL, or auto-revert on the setting itself (RISK-8 handles it as a tracked action, not code).
