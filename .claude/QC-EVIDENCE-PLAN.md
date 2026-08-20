# QC & Evidence Layer — build plan and live tracker

**Spec:** `docs/qc-evidence/` (SPEC.md, BACKLOG.md P0–P8, 47 screens, runnable prototype).
**Defect register from the prior baseline survey:** `.claude/actions.md` ACT-51.
**This file is the operating contract.** It records the reconciled plan, the decisions taken, and
where the train currently is. Read it first on any resume; it is written to survive context loss.

---

## ▶ RESUME MARKER — where the train is

```
UPDATED       : 2026-08-20 16:10Z
CURRENT PHASE : P8 (review decisions) — running in parallel with P3 and P8.3
STATUS        : P3 (remediation loop) COMPLETE on its branch — PR #14, merged with main,
                H-cases renumbered H28-H33. NOT landed, NOT deployed, NOT confirmed live.
LAST LANDED   : 44d1cfc (H26 one-ID-one-case + contiguity)
NEXT ACTION   : land PR #14; then deploy and run the loop against the
                Trinnex opportunity 9f9c370a-4ac9-441e-b58e-02e3ffcf669e
DONE + LIVE   : P0 · P1 · P2 · P4 · P5 · P6 · X1 X2 X3 X4 · D1 D2 D3 D6 D7 D8 D11
DONE, NOT LIVE: P3 (X5 render-once, D8 per-pass metering, scoped regeneration)
```
*Update this block on every landing. It is the single place to look after a restart.*

Phase status: P0 `done` · P1 `done` · P2 `done` · P3 `RESTARTED` · P4 `done` · P5 `done` ·
P6 `done` · P7 `partial (item 1 landed; 4, 6, 8 held behind P3)` · P8 `in progress`.
P3 `built, PR #14, merged with main, NOT landed`.

### Lanes in flight — who owns which files

A lane may not touch a file another lane owns. `api/test/hardening.test.mjs` is shared and
APPEND-ONLY. H-case IDs are pre-allocated so two lanes cannot collide on one number.

**ONE ID PER LANE DID NOT HOLD, and the failure mode is worth naming.** Each lane finds SEVERAL
defects, so P3 needed six ids and P8.3 four. Append-only is exactly what hid it: every lane appends
at the end of the file, so the branches MERGE CLEANLY, each is green in isolation, and the duplicate
ids land unnoticed while `actions.md` points at numbers that name two things. `H26` on `main` now
asserts one-id-one-case AND contiguity from H1, so the next collision fails a build instead of
being discovered by a reader. Allocate a RANGE per lane, not a number.

| Lane | Branch | Owns | H-ids |
|---|---|---|---|
| P8.2 R3 figure echo | `claude/qc-p8-2-figures` (PR #10) | `figureEcho.ts`, `checks.ts`, `appChecks.ts`, `appFacts.ts` | H24, H25 |
| P8.7 UI remainder | subagent worktree | `app/` (theme.css, PostingAnalysis, Today, packetBuilder) | — |
| P3 remediation loop | `claude/qc-p3-remediation` (PR #14) | `pipeline.ts`, `appPackets.ts`, `appSwaps.ts`, `appInsertions.ts`, `remediation.ts`, `appRemediation.ts` | **H28-H33** |
| P8.3 evidence excerpts | `claude/qc-p8-3-evidence` | `requirements.ts`, evidence schema | H27 |

**The P3 lane was lost once.** A subagent ran it, died without pushing, and left no branch — the
work was gone with no trace but a stale entry in this file. Restarted 2026-08-20 as a fresh lane,
not a resume. Lesson applied to every lane above: a lane that has not pushed a branch has produced
nothing, whatever a summary says about it.

### Blocked, and on what

| Item | Blocked on |
|---|---|
| P8.2 rewrite/generalize half | P8.1 correction table (to log and revert a replacement) |
| P8.6 correction affordances | P8.1 |
| P7 items 4, 6, 8 | P3 (they touch `pipeline.ts` / `appPackets.ts`) |
| P8.4 comparison dimensions | P8.7 landing (both are in `app/`) |
| P0.3 residual + its H-case | P8.7 landing (`app/src/theme.css`) |

---

## 0. How this plan was produced (and why it departs from the backlog)

Four independent AC agents read BACKLOG.md against the actual code. They found the backlog was
written without full codebase knowledge and **several of its premises are false**. Those are
corrected below. One agent made live production calls; those results are marked **LIVE**.

**Do not implement a backlog bullet that this file marks as rejected or corrected without
re-checking the code yourself.** The backlog is the intent; this file is the contract.

---

## 0b. Standing directives from the owner (2026-08-19)

1. **On any spec-vs-codebase divergence, DEFAULT TO WHAT IS ALREADY BUILT.** The design agent wrote
   the spec without the depth this codebase survey has. Depart from an existing pattern only for a
   concrete, named defect — and record why in the commit.
2. **Do not stop for per-item sign-off.** Accumulate owner decisions in §11 and surface them in
   batches so several can be cleared at once.
3. **Aim for one-shot deployment.** Batch a phase's `app/` and `api/` work into ONE landing on `main`
   so both deploy workflows fire once, then verify once (a new API route needs ~90–120s converge).
   Look upstream and downstream before landing, not after.

## 1. Cross-cutting decisions (taken — do not re-litigate)

| # | Decision | Why |
|---|---|---|
| **D1** | New relational tables go in `schema.ts` `SCHEMA_SQL` **and** `EXPECTED_TABLES`. The ad-hoc `ensure*()` ALTER pattern is only for columns bolted onto existing tables. | `SCHEMA_SQL` has 11 tables; 13–18 more are created ad-hoc and `pgMigrate` never sees them. Six more on the wrong side is a permanent tax. (ACT-51 B4) |
| **D2** | `PacketBuilder`'s step becomes route-driven: `App.jsx:40` passes `step={parts[2] \|\| 'jd'}`. | It is the ONLY multi-view screen not routing its tab (`OppDetail`, `Interview`, `Library`, `Settings` all do). Unlocks R5 deep-links AND all UI verification. |
| **D3** | `scripts/ui-verify.mjs` gains `VIEWPORT_W/H`, `expect_absent`, a `measure` selector, and a `click` step. | The harness today cannot click, cannot vary viewport, cannot assert absence. Without this, most P5/P8 ACs are unverifiable. This is itself a code change and needs its own AC+verifier pass. |
| **D4** | The 280px right ATS panel is **removed**; its content moves into the §4.3 modal. | P8.7 overrides P5.4 (P8 preamble says P8 wins). Also arithmetic: shell caps content at 1280 minus 196 nav ⇒ 664px centre at 1440; P5.2 blocks need ~850px. Removing the panel is what makes it fit. |
| **D5** | Drawer tabs: **Blocks & provenance · Checks · Original vs final · Independent review · Match**, default Blocks & provenance. | SPEC §4.9 + prototype order (BACKLOG calls the prototype "ground truth for behavior") with SPEC §7 plain-language labels (bans "passes"/"distribution" as labels). |
| **D6** | A reviewer disagreement degrades the gate to `warn` but can **never** produce `fail`. Only deterministic rows produce `fail`. | Resolves the P4.2 ↔ P2.2 tension. Must be stated once, centrally — resolved per-screen is how two screens print different gates. |
| **D7** | `promptsApi.ts` POST gets `requireWrite`. | It is `authLevel:'anonymous'` with no guard, and a POST to any of six partition keys instantly rewrites live document generation. P4 increases traffic to it. One-line fix, same pattern as `appPackets.ts:270`. |
| **D8** | `usageMeter.logUsage` is extended to accept BOTH OpenAI usage shapes (`prompt_tokens\|\|input_tokens`, `completion_tokens\|\|output_tokens`) and `PRICES` gains the missing models. | The Responses API returns `input_tokens`/`output_tokens`, so `packet:ai-edit` almost certainly records ZERO rows today. Expect `/app/usage` totals to JUMP once fixed — that is a correction, not a regression. Tell the owner before it surprises them. |
| **D9** | `ResumeField`/`ResumeTab` is **lifted** to a shared module and hosted by PacketBuilder. Lift the loader too (`useArtifactPackage(oppId)`). | Two editors already drive the same endpoints; the richer one is where users can't find it. A third is a rejection. |
| **D10** | The overlay primitive (`<Overlay variant="drawer"\|"modal">`) lives in `shell.jsx`, next to `Pill`/`MatchScore`. Uses the existing unused `--zindex-*` tokens. | Close-on-navigation (P8.5) is a GLOBAL rule that cannot be owned by whichever screen opens the overlay. |
| **D11** | Highlight colors ship as **token pairs** defined on `:root` AND redefined in `.proto-dark`: `--qc-kw-bg/-fg`, `--qc-echo-bg/-rule`, `--qc-scrim`. | The README says carry `#fff03a` / `#fbf2da` / `#c9b27a` verbatim, but as raw literals they break in dark mode (`--proto-ink` flips to near-white ON yellow). |
| **D12** | Tab bars use the existing `.px-tab`/`.px-tab-active`/`.px-tab-idle`. | They exist and are used ZERO times while 5 screens hand-roll them. It is also a dark-mode FIX: the hand-rolled version uses `--surface-brand-default`, which `.proto-dark` does NOT flip; `.px-tab-active` uses `--border-brand`, which it does. Converting the 5 existing screens is OUT of scope — follow-up. |

---

## 2. Prerequisites the backlog does not list (these gate real work)

| # | Prerequisite | Gates | Evidence |
|---|---|---|---|
| **X1** | **Feed the real posting into generation.** `buildTemplatedArtifact` (`appPackets.ts:236-240`) synthesises a pseudo-JD from role/company/why_surfaced. `jd_real` is never selected. | P1.3, P1.4, P8.2 — every provenance row and every `verbatim_quote` would otherwise record a fabrication, and P8.2's acceptance passes VACUOUSLY. | ACT-51 A3 |
| **X2** | **Make `regen` reachable.** `appPackets.ts:234` reuses cached `pkg_json`; `:454` hardcodes `regen=false`; the UI never sends it. | P3.1 (a loop on today's code runs 4 passes, closes nothing, and reports looping), P8.1-AC7. | ACT-51 A2 |
| ~~X3~~ | **DONE (2026-08-19)** — `api/src/functions/tests/jdText.ts` exports `normalizePostingText` / `groundingText` / `decodeEntities`; consumers repointed: `appApply.atsScoreOne` (LIVE scorer), `appPackets.jdAnalysis`, `appJdParse` (fetch + `resolveJdSource`). Original: Canonical `jd_text`. `jd_real` is HTML (`jdBackfill.ts:66` stores `descriptionHtml`); three different strip-regexes exist. | P1.1 offsets, P4.1 citation validation, P8.2 figure scan, P8.3 evidence substrings — none can work against HTML. Export ONE `normalizePostingText()` extending `appJdParse.ts`'s. |
| ~~X4~~ | **DONE (2026-08-19)** — `npm test` in `api/` runs Node 22's built-in runner over `test/*.test.mjs`; 22 assertions green. Zero new dependencies. Original: A test runner. `api/package.json` has build/watch/start/dev only — no test script, no framework. | Every `node --test` AC. Node 22 ships a built-in runner: zero new dependency. |
| **X5** | **Documents render ONCE, after the loop.** Each `buildTemplatedArtifact` call does a Drive `files/{id}/copy`. | P3.1 — 4 passes × 4 templated artifacts = **16 orphaned Drive files per packet** on a quota-bearing OAuth account. |
| **X6** | **Prompt `version` must be loaded.** `pipeline.ts:49` projects only `partitionKey`→`content`, discarding `version`/`rowKey`. | P4.1's "`prompt_version` on every verdict" is unmeetable reusing that line. |

---

## 3. LIVE ground truth (measured 2026-08-19, not inferred)

- **The duplicate-prompt defect is live.** `GET /api/prompts` (run `32290705438`): `resume_user` **29068** ≡ `portfolio_user` **29068**; `resume_system` **329** ≡ `portfolio_system` **329**; `ats_system` is a **28-char stub**. Two of three agent calls run the same 29k prompt. (Byte-identity inferred from equal length + the repo README's assertion; prove with a sha256.)
- **The profile lives in `MasterContext`** (Azure Table, `PartitionKey='context'`, 15 fields) — verified by `mt-13` (run `32290483525`) returning `pass:true, "All 15 required fields present"`. NOT `library_entity`, which has zero rows, zero write path and zero UI.
- **The zap is effectively dead:** 39 of 40 nodes `paused:true`. Only the JotForm trigger is live. P7's "parts still being migrated" therefore means "defects still present in `api/`", not "still running in Zapier".
- **Two zap baseline nodes were never migrated at all** (`289877653` Cover Letter sample, `294827237` Sample Cover Letter). The "three storage-key collisions" the backlog asks us to fix were already resolved — partly BY dropping these two.
- **`softHardSkillsPool` is stored, required by the health check, and read by nothing.**

---

## 4. Premise corrections — backlog claims that are FALSE

| Backlog | Claim | Reality |
|---|---|---|
| P0.1 | "Add `missing_kw text[]` to `packet`" | **REJECTED.** `opportunity.ats_gaps` already holds a real-JD-derived gap list (`appApply.ts:179`), refreshed by a 5-min timer, returned by no endpoint. A new column would be a second, WEAKER list (sourced from `jdAnalysis`, which never reads the posting). Extend `ats_gaps`; expose it through `packetShape`. |
| P0.2 | "persists none of it" | **FALSE.** `appPackets.ts:491` persists `jd_analyzed`, `ats_score`, `covered_kw`. Only `mustHaves` and `gaps` are dropped — and `gaps` is exactly what P0.1 needs. The real defect is that it is **non-idempotent** (calls OpenAI every time) and **never reads the posting**. |
| P0.3 | "in `PacketBuilder.jsx`" | **INCOMPLETE.** `tone="panel"` is also passed at `Library.jsx:246,432` and `OppDetail.jsx:572`. One-file fix in `shell.jsx`, 17-call-site read radius. |
| P1.1 | "map `jd_table` Category to `kind`" | **CANNOT produce `nice_to_have`** — the prompt (`appJdParse.ts:89-97`, an inline literal) has no such category. Prompt change required first. |
| P1.1 | "`char_start/end` against `jd_real`" | **UNWORKABLE** — `jd_real` is HTML and the model sees a stripped, 12,000-char-TRUNCATED rendering. Needs X3 + a truncation flag. |
| P1.1 | "map `jd_table` Category to `kind`" (2nd correction) | **`nice_to_have` needs no prompt change.** It is read off the POSTING ("Preferred:", "is a plus") in a 400-char window before the located span. Deterministic, and it backfills the 1349 already-parsed rows with zero model calls. `kind_source` records why each kind was chosen. |
| P1.1 | "each row's `verbatim` is a substring of `jd_real`" | **UNSATISFIABLE AS WRITTEN — the Item column is a model PARAPHRASE.** Live rows (db-query `32303342032`) read "Lead the operational performance of the renewable-generation portfolio." Storing Items as `verbatim` fabricates quotes. Resolution: `item_text` = the model's words, `verbatim` = the posting span the paraphrase was located in. A row that cannot be located keeps null offsets. |
| P1.1 | "the packet screen never reads them" | True only of `PacketBuilder`. `jd_requirements`/`jd_table` have **4 live consumers** (`OppDetail.jsx:378,384` and `Swipe.jsx:408,411` via `dangerouslySetInnerHTML`; `appRoleTaxonomy.ts:81`; `appApply.ts:172`). |
| P1.4 | "6 merge fields for the compact resume" | **FALSE** — it has 7, and is a **byte-identical duplicate** of `resume` (same templateId, same placeholders). |
| P2.1 | "ports Q1–Q16" | Its own bullet list silently **omits Q5, Q10, Q12, Q15, Q16**. Four listed checks (coverage/responsibilities/terms/traceability) are NOT deterministic-from-text and are hard-blocked on P1. |
| P2.2 | "blocks approval server-side, not just in the UI" | **There is no UI blocking either.** `artifactStatus` (`appPackets.ts:180-196`) has NO state machine — `todo→approved` in one hop, no ownership check. And the only real send path (`appOutreach.ts:234`) has no packet gate at all. |
| P2.3 | "score each asset separately (compact carries a different skill block)" | **FALSE today** — same template, same placeholders, same cached `pkg_json`. |
| P2.3 | reproducible composite | `seniority_alignment` is **reviewer-graded** (an LLM output), so it must be a stored INPUT, not a recomputed output. Also makes P2.3 depend on P4, contradicting the stated order. |
| P5.4 | "three columns" | **OVERRIDDEN by P8.7** — tabs, with three columns behind a flag. |
| P5.4 | "the re-run button visibly does something" | Partly stale — a busy state already exists (`PacketBuilder.jsx:384`). What's missing is a PERSISTENT result strip (the toast vanishes in 2200ms). |
| P6 | "`library_entity` is a plausible home" | **WRONG** — empty enum value, no writer, no UI. The incumbent is `MasterContext`. |
| P7 | items 2 (concatenated split) & 3 (hour-based memory key) | **MOOT** — no joined split and zero memory-key hits in `api/`. Mark closed with evidence; write no ACs. |
| P7 | item 1 (positional coupling) | **FIXED** at original severity (`resumeParser.ts` maps by TITLE). A narrowed residual remains: `:56` pairs `parts[i]/[i+1]` positionally, so a stray `###` inside prose re-aligns everything after it. |
| P8.1/P8.2 | the prototype's corrections | **Fixtures, not an engine** (`qc/data.js:427-433` is a 7-entry literal applied at RENDER time). Undo is `useState` only. Do not transcribe those literals. |

---

## 5. The prototype has a bug — do not port it faithfully

**`ChecksView` ignores `engine`** (`qc/evidence.jsx:266-288` groups by `c.key`; `engine` appears zero times in that file), and **`gateFor` has no engine filter** (`qc/data.js:548-553`). A `reviewer`-engine `fail` would set the gate — contradicting P4.2. **The sample data hides it**: all six reviewer rows are `state:'pass'`.

**And `gateFor` reads `CHECKS` while the badge reads `ATTENTION`** (`data.js:641`), where `ATTENTION` = non-pass CHECKS **+ `OPEN_ITEMS` + loose terms + MIRRORS`. So an asset with an open question but no failing check renders **gate `pass` alongside a badge saying "1 to fix"** — precisely the R4 violation P8.5 exists to prevent, present in the reference implementation. P8.5-AC2 is the regression test.

---

## 6. Harness gaps — ACs that are NOT verifiable today

`scripts/ui-verify.mjs` asserts positive body text and screenshots. It **cannot**: assert absence of a
string, measure layout, vary viewport, or click. Affected: every breakpoint AC, every post-click AC,
every "renders exactly once" AC, P8.4-AC5, P8.5-AC7, P8.7-AC5/AC8. **D3 fixes this and must land
before those ACs can be signed.** Do not claim coverage on an AC the harness cannot express — say so.

---

## 7. Phase order (corrected)

```
X1 X2 X3 X4 (prerequisites)  →  P0  →  P1  →  P2 ─┬─→ P4 ─→ P5 (5.2→5.1→5.3→5.4)
                                          P3 ─────┘
P6, P7 independent.   P8 OVERRIDES earlier phases — apply its decisions as you build each one,
                      not as a final pass.
```
D2 and D3 land with P0 (they are cheap and they unblock verification for everything after).

---

## 8. Per-phase contract

### P0 — Wiring bugs  ◀ CURRENT
1. **P0.3 tone map** — explicit `TONE = {tone:{bg,fg}}` in `shell.jsx`; `panel` → `--proto-panel-deep`/`--proto-ink2`. No `var(--proto-${tone}-soft)` interpolation anywhere. Also kill `--proto-ink1` (`PacketBuilder.jsx:621`, undefined, no fallback).
   *AC:* `grep -n 'var(--proto-\${' app/src/shell.jsx` → 0. Contrast ≥4.5:1 in BOTH themes. Verify `#/packets`, `#/library`, `#/opportunity/{id}`.
2. **P0.1+P0.2 merged** — expose `opportunity.ats_gaps` as `missingKw` via `packetShape`; persist `gaps`+`mustHaves`; make `jd-analysis` idempotent (no model call without `{force:true}`); ground it in `jd_real` or refuse with `{grounded:false}` rather than scoring a job title.
   *AC:* `information_schema` shows NO `packet.missing_kw`. Legend prints `C/(C+M)` matching chip counts. Two calls with no intervening write → byte-identical, zero new `usage_metering` rows. Unscored opp → explicit not-yet-scored copy, never "No keyword gaps found."
3. **D2** — route-driven step. **D3** — harness extension.
*Also close:* ACT-51 A1, F11.

### P1 — Evidence spine
Order: **1.2b → 1.2 → 1.1(kw) → 1.1 → 1.3 → 1.4**; 1.5 defers into P2.1 (it needs `check_result`).
Blocked on X1 (1.3/1.4), X3 (1.1). Key ACs: every `verbatim` is a substring of `jd_text` at its
offsets; zero null `kind`; `nice_to_have` exists (forces the prompt change); one `ats_term` row for
SOC 2/SOC2/SOC 2 Type II; `model_inferred` never in numerator OR denominator; adding an alias changes
no historical score; retire or rewire `atsBackfillTick` so `ats_gaps` stops being a parallel truth.

### P2 — Checks and gate
Split P2.1 into a **text-only** engine (ships now) and a **row-dependent** engine (needs P1).
**AC 2.1.9 is the safety AC:** coverage checks with no `requirement` rows emit `not_applicable`,
**never `pass`** — otherwise the gate goes green on an unverified artifact.
P2.2: 409 on direct API approve of a `fail`-gated artifact; `warn` override writes an audit row with
a **server-resolved** actor; `ready` requires no `fail`; `outreachSend` gains the gate.
**Before shipping run `select count(*) from artifact where status='approved'`** — every historical
artifact has zero check rows; decide grandfathering explicitly or `ready` flips for every packet.
P2.3: name the table `artifact_score`, NOT `match_score` (that column exists with a different live
meaning). Reconcile all four existing scores or don't ship a fifth.

### P3 — Remediation loop  ◀ BUILT (PR #14), NOT LANDED, NOT LIVE
**X2 re-verified by grep, not taken on faith:** `regen` is read from the body at `appPackets.ts:382/457/558`,
honoured at `:319`, and `PacketBuilder.jsx:584` sends it. The X2 text below is STALE — the cache is
reachable-through, so no loop AC passes vacuously against it.

**Shipped shape.** Pure logic in `remediation.ts` (no pg / no network / no clock); DB, model calls and
wall clock in `appRemediation.ts`. New tables `remediation_loop` (one row per artifact per pass) and
`escalation`. `converged` is unforgeable in the SCHEMA — a CHECK plus a composite FK into
`check_result`, so the coverage state on a loop row can only be COPIED from a check the engine really
recorded, never asserted. Field-scoped regeneration built as new capability (decision 17): the model's
out-of-scope keys are REJECTED on the way in, not requested in a prompt.

**Six defects found and fixed with it, each an H-case (H26-H31):** `writeSwaps` deleted the whole
packet's swap history on every build (the loop deleting its own justification); generation and
rendering were one function (16 Drive copies per packet at 4 passes, on a codebase with no Drive
DELETE anywhere); `insertion.loop` counted RENDERS because the writer derived it; `packet.round` was
read by two consumers and written by nothing; and — the one that would have taken production down —
**the composite FK's UNIQUE target was added at the FOOT of `SCHEMA_SQL`, so `create table
remediation_loop` aborts the whole migration on any database where `check_result` already exists.**
A fresh DB was fine. Nothing here could catch it: there is no Postgres in the sandbox.

**Departures, each named:** `requirement.closed_on_loop` dropped rather than written (decision 16 —
it cannot express the artifact dimension, and had zero writers and zero readers); loop escalations
get their own table (decision 15); the cleared-override record lives on `remediation_loop`, NOT on
`artifact_gate`, because `evaluateArtifact`'s clear is correct for a MANUAL re-check and it is the
LOOP that turns one considered clear into four silent ones — so `appChecks.ts` is untouched.
**P3-45 is NOT claimable** (P5 unmerged, harness cannot click or assert absence). **P3-21/25's live
half is blocked** on `diagFolders` listing the packet output folder.

**AC 3.1.0 (X2) blocks everything else** — without it every loop AC passes vacuously against a cache.
Needs a field-scoped generation primitive (`pipeline.ts` is monolithic; calls 2/3 consume the whole
prior payload). Documents render once (X5). Meter every pass (D8) — `grep -n "logUsage(.*, {})" api/src/` → 0.
Enforce a cost ceiling, not just observation. Watch the Functions consumption-plan timeout; copy
`atsBackfill`'s wall-clock guard (`appApply.ts:204`).

### P4 — Independent reviewer
Prompt row in the existing `Prompts` table (D7 first). Loader must project `version` (X6).
Citations validated server-side against `normalizePostingText` (X3) — the SAME function the extractor
used, not a second regex. Fabricated quote → dropped, counted, never rendered. Meter it (D8).
P4.2: `engine` non-null; gate reads deterministic rows only (D6); UI groups by engine at top level —
**this is a change to `ChecksView`, not a port of it** (§5).

### P5 — UI (5.2 → 5.1 → 5.3 → 5.4)
Blocked on P1/P2/P3 tables existing AND populated for a real packet — building against fixtures is a
"No dead UI" violation. D9 (lift `ResumeField`), D10 (`Overlay` in `shell.jsx`), D11 (token pairs),
D12 (`.px-tab`). Use the unused `.px-dashed` (static blocks), `.px-note` (before-text), `.px-bar`
(distribution meter). Blocks default OPEN; asset headers default COLLAPSED (different objects — not
a conflict, but trivially misread as one).

### P6 — Intake and profile
Extend **`MasterContext`** by relocating it to owner-scoped Postgres + read/write API + a Settings
page, and repoint every reader at ONE accessor. Do NOT create `library_entity` role_profile rows.
Fix the first/last row divergence (`pipeline.ts:53-54` takes LAST, `mt13.ts:26-30` takes FIRST).
Disposition the two dropped nodes and `softHardSkillsPool` explicitly.

### P7 — Pipeline hygiene
Items 2 & 3 MOOT (evidence in §3/§4). Item 1 fixed, narrowed residual only. Live: **4** (duplicate
29k prompt — LIVE, §3), **5** (silent fallbacks), **6** (no failure path — `console.warn` only,
`ok:true` on partial), **7** (temperature defaults to 1.0 on ALL calls including QC reconciliation),
**8** (template ids hardcoded TWICE, single-tenant sender/recipient).

### P8 — Review decisions (apply throughout)
Corrections are persisted rows against `pkg_json` (not render-time substitution, not `artifact.content`),
applied BEFORE Doc injection, revertible to the exact substring, idempotent, and **not re-applied after
a revert** (the highest-risk interaction — see X2). Figure scan needs X1 or it passes vacuously.
Carve-out: a figure in BOTH posting and profile is KEPT and cited (R2 beats a literal reading of R3).
One severity selector feeds every count. Every count deep-links. No hardcoded correction rules.

---

## 9. Conflict register (P8 overrides)

| # | P8 | Overrides | Resolution |
|---|---|---|---|
| C1 | 8.1 | P2.1 "25-char skill → one `fail`" | `fail` only when no deterministic correction exists; else `fixed` + a correction row |
| C2 | 8.1 | P2.2 "any `fail` → gate `fail`" | Gate reads POST-correction state; a revert re-reddens it |
| C3 | 8.2 | P1.3 + prototype `data.js:131` (`P&L $18M`, "matches the figure in the posting") | That swap becomes illegal; P1.3 ACs add "and contains no posting figure" |
| C4 | 8.2 | P2.2 length rule | Re-run length checks after every correction; a length fail caused by a correction must name it |
| C5 | 8.2 | R2 / P8.3 | Figure in both posting AND profile → keep + cite, do not rewrite |
| C6 | 8.3 | P1.2 / P2.3 numerators | Coverage counts recomputed from evidence rows, not from term placement |
| C7 | 8.4 | P5.4 | Comparison replaces counters; "posting lines"/"passes" banned as JD-step labels |
| C8 | 8.5 | P2.2 | `gate()` is defined over the severity selector output (§5 regression test) |
| C9 | 8.5 | P0.1 | Ratio sourced from the selector; kill `coveredKw.length + missingKw.length` |
| C10 | 8.6 | P2.2 | The server block applies to APPROVAL only, never to honest degradation |
| C11 | 8.7 | P5.4 | Tabs win; three columns behind a flag |
| C12 | 8.7 | P0.1 / P5.4 | P0.1's DATA fix stands; its PLACEMENT moves to the modal. Reconcile `OppDetail.jsx:381-385` too |
| C13 | 8.7 | P5.2 | NOT a conflict — asset HEADER collapses, field BLOCK opens. State it in both |

---

## 10. Verification vehicles (the sandbox cannot reach prod)

- **DB** → `db-query.yml` (`sql` input), read via `get_job_logs`.
- **API** → `api-test.yml` (`method`/`path`/`body`); exits 1 on ≥400.
- **UI** → `ui-verify.yml` → read the `UI_VERIFY_RESULT` line. Limited until D3.
- **Unit** → needs X4 (Node 22 built-in runner).
- A new API route needs **~90–120s** of worker converge before it stops 404ing.
- Every code phase runs the repo gate: independent AC subagent → implement → independent `verifier`.


---

## 11. DECISIONS NEEDED (batched — answer by number)

Accumulated so I don't stop-start. Each carries my recommendation; "agree" is a valid answer to all.

| # | Decision | Recommendation |
|---|---|---|
| ~~1~~ | **REVISED 2026-08-19 — DO NOT COLLAPSE. The agent's original recommendation was WRONG and the owner caught it.** The two numbers measure DIFFERENT populations, so merging them destroys the distinction the spec is built on. Evidence: `SPEC.md:366` — *"Reserve 'ATS' for the keyword library and its coverage; requirements and responsibilities are posting analysis"*; `SPEC.md:324` — `score: must, kw, sen, composite`, i.e. **kw is one of four**; `BACKLOG:178` — `composite = 0.5·must + 0.3·kw + 0.2·sen`. So the spec's **ATS score = keyword coverage ONLY = 30% of the composite**. Meanwhile `opportunity.ats_score`'s own prompt (`appApply.ts:174`) asks for *"% of the role's important keywords/**requirements** the candidate already demonstrably covers"* — keywords AND requirements, i.e. a broad MATCH measure that is simply misnamed `ats_score`. **Correct resolution: keep both, fix the LABELS.** R4 requires "say what a number counts" and that two labels for the SAME population agree — it does not require one number for different populations. Actions: (a) `opportunity.ats_score` is surfaced as **Match**, never "ATS"; (b) the packet header's "ATS Match %" becomes the spec's **keyword coverage** once P1.2 lands, and until then must not claim to be ATS; (c) the broad per-artifact number is P2.3's `composite`. The measured impact figures below stand but no longer argue for a collapse — they argue that keyword coverage needs its own producer (P1.2), which is why 3/38 is so low.
| **2** | **Ungrounded score display.** When an opp has no posting, should the header show a score at all? Today it does; it is now labelled `grounded:false`. | **Suppress the number, show "not scored against a posting yet."** A score derived from a job title invites false confidence. |
| ~~3~~ | **DECIDED (owner, 2026-08-19): reset status, never lose the packet.** Reset every packet/artifact status when the gate ships — do NOT grandfather approvals as `pass`. But a packet must never disappear or become hard to find: **`opportunity.stage` is NOT touched**, packets are never deleted, and every started packet must still surface in its stage list (saved / reached) at the beginning of that stage. Owner's words: "I don't wanna have to research through the list to find those I was interested in and start it over again." ⇒ P2.2 constraint: status reset is a STATE change only; findability and stage placement are preserved. |
| **4** | **Send blocking scope (P2.2).** Should cold outreach be blocked when a packet gate is `fail`? An outreach email is not the packet. | **No.** Block packet approval and `ready`; leave outreach send alone. Blocking it conflates two things. |
| **5** | **Drawer tabs (D5).** Prototype/SPEC say Fields·Checks·Swaps·Review·Match; BACKLOG says Score·Checks·Blocks·Original-vs-final·Review. | **Blocks & provenance · Checks · Original vs final · Independent review · Match.** Prototype order, plain-language labels. |
| **6** | **Reviewer disagreement (D6).** Can the blind reviewer ever produce a gate `fail`? | **No — `warn` only.** Deterministic rules decide pass/fail; the reviewer grades. |
| ~~7~~ | **RESOLVED 2026-08-20, and the plan's own prescription was WRONG.** D7 said "add `requireWrite`, one line, same pattern as every other mutation." That would NOT have closed the hole: `requireWrite` allows a write when `verified \|\| owner === DEMO_EMAIL` (`appSession.ts`), and `resolveOwner` **defaults** owner to `DEMO_EMAIL` when no `?owner=` is supplied. An unauthenticated POST resolves to demo and is waved through — while the diff reads as guarded. That guard is right for owner-scoped tables, which have a demo partition; `Prompts` is **global shared state with no demo partition**, so a "demo" write there rewrites the real owner's live document generation. **Shipped instead:** `artifactGateOverride`'s guard — `const { verified } = resolveOwner(req); if (!verified) return 403` — placed INSIDE the POST branch so the unauthenticated GET and the CORS preflight still work. Encoded as **H19**. |
| ~~8~~ | **DECIDED (owner, 2026-08-19): O*NET only — free, no paid option.** Seed `term_library` from O*NET (public domain). Additionally: commission a **subagent research pass** to baseline/boost the library beyond raw O*NET before first use, since O*NET is thin at exec level. `jd_table` keywords remain candidates only, never the library. No Lightcast, no paid source. |
| ~~9~~ | **DECIDED (owner, 2026-08-19): keep the duplication as-is.** It breaks nothing and the priority is getting the system working. Do NOT retire `compact_resume`, do NOT build a second template now. Consequence to carry: P2.3 will score two structurally-identical assets and produce two identical numbers — surface them with `sharedSource: true` rather than presenting them as independently derived. Replace the compact template later. |
| **10** | **Two zap baseline nodes were never migrated** (`289877653`, `294827237` — cover-letter samples). | **Record as intentionally dropped** unless you want the sample letters back as profile fields. |
| **11** | **`softHardSkillsPool`** is stored, required by the health check, read by nothing. | **Wire it as the swap bank** for P8.6's "swap for another skill" — that is its natural consumer. |
| **12** | **`/app/usage` totals will JUMP** once `logUsage` is fixed (D8) — the production packet build has never been metered and `packet:ai-edit` almost certainly records zero rows. | **Proceed.** It is a correction, not a regression, but the cost dashboard will visibly change. **Shipped 2026-08-20 with two departures worth knowing about:** (a) the plan said "`PRICES` gains the missing models" — `AI_EDIT_MODEL` defaults to `gpt-5.6-luna` and I do not know its real price, so instead of inventing one an unpriced model now records `cost_usd = NULL`. A wrong cost is worse than a missing one, and it is indistinguishable from a real one in the table. Prices are overridable via `MODEL_PRICES_JSON` so a new model can be costed without a deploy. (b) `appPackets.ts:324` passed `logUsage(..., {})`, which `logUsage` discards on zero tokens — so the **production packet build had never recorded a single row**, the most expensive operation in the product. `buildPackageForJD` now returns each pass's usage and all three are metered separately. Expect call COUNT to jump as well as cost. |
| **13** | **Reviewer prompt fallback (new, P4).** The reviewer reads `reviewer_system`/`reviewer_user` from the `Prompts` table. Neither row exists yet. Refuse to run, or run on a built-in prompt? | **Run on the built-in, and say so loudly.** A verdict from the built-in records `prompt_version = 0` with `prompt_source = 'builtin'` (NOT NULL beside it, so 0 is never ambiguous) and emits a `reviewer_prompt_source` **warn** naming the missing partition key. Refusing outright trades a visible, fixable warning for a QC layer that silently produces no review — the worse failure. **Owner action to clear the warn:** author the two rows in the prompts console. |

| **14** | **P3 loop counter (D-4).** Three loop-ish counters already exist: `packet.round` (read, **never incremented**), `insertion.loop` (counts document RENDERS — incremented on every build, including a cache hit that made zero model calls), and `check_result.run_id`. P3 wants a fourth. | **Make `insertion.loop` mean the remediation pass, and stop incrementing it on cache hits.** It is the only one already joined to the before/after evidence the loop needs. `packet.round` is dead — either wire it or drop it, but do not add a fourth counter beside two that already disagree. |
| **15** | **P3 escalation column (D-5).** `requirement.coverage='escalated'` is ALREADY set at extraction, meaning "the quote could not be located in the posting" — decided before any loop exists. P3.2 wants the same word for "the loop gave up". | **Leave `coverage` alone; give escalations their own table.** Two populations in one column is exactly how a gate comes to count the wrong thing. |
| ~~16~~ | **WITHDRAWN — this was never an owner decision.** I asked which grain `closed_on_loop` should have. One grep settles it: **`closed_on_loop` appears exactly once in the entire codebase — its own declaration at `schema.ts:308`. Zero writers, zero readers.** (The only other hits are a P4 test fixture that uses it as a *forbidden* field, which proves nothing reads it.) There is no upstream to break, no downstream to reconcile, no data to migrate. | **Determined:** whoever builds P3 shapes the column to what P3 needs. Since coverage is judged per-ARTIFACT (`evaluateArtifact`), it becomes per-artifact — a `requirement_id + artifact_id` row, not an int on the requirement. Free to change precisely because nothing depends on it. **The real lesson: I escalated a question with a null blast radius instead of grepping for one. Trace producers and consumers BEFORE asking.** |
| ~~17~~ | **REFRAMED — a finding, not a decision.** Traced: `assemblePackage(call1, call2, call3)` (`mt17.ts:74`) takes three whole payloads and returns a whole package; `buildPackageForJD` takes a JD and returns a whole package. One generation entry point, all-or-nothing, no field selector anywhere. So scoped regeneration genuinely does not exist. | **Determined: build it as part of P3.** The question was never "do you want this feature" — it is that P3.1 cannot be built as written without it, and the named defect it prevents is real: pass 2 regenerates everything and destroys content that was already correct. Estimate the primitive as part of P3, not as a surprise inside it. |
| **18** | **Every rebuild already orphans a Drive file (D-9).** There is no Drive `DELETE` anywhere in `api/src/functions/tests/`; `buildTemplatedArtifact` overwrites `artifact.doc_url` after each copy. This is TODAY's behaviour, not a loop regression — the loop would multiply it to 16 files per packet at 4 passes, on the quota-bearing OAuth account. | **Fix render-once (X5) as planned, and separately decide whether to delete superseded copies.** Named because the plan's X5 wording implies the loop introduces the problem. It does not; it amplifies one that already exists. |
| **19** | **A loop erases human overrides (D-10).** `evaluateArtifact` clears `override_by/at/reason` on every upsert. That is correct for a manual re-check; a loop re-checks up to four times automatically. | **Record the cleared override before clearing it.** The rule ("an override approves a specific set of findings") still holds — but silently discarding a human's recorded reason four times in one run is not what that rule was written for. |


---

## 12. O*NET research outcome (decision #8) — and the live bug it found

### It found a LIVE production bug, now fixed (X3)
`jd_real` stores `descriptionHtml`; every consumer stripped TAGS but never decoded ENTITIES, so the
scorer saw the literal `P&amp;L`. Measured live: **`&amp;` in 872 of 1,230 real postings (71%)**;
**`P&L` present in 83 postings, matched in ZERO.** Same for M&A, R&D, "Risk & Compliance". The gap
lists shown to the owner were wrong because of it. Fixed; 11/11 assertions pass.

### Corrections to decision #8's premise
- **O*NET is CC BY 4.0, NOT public domain.** Commercial use/derivatives fine, but attribution to the
  release + USDOL/ETA is REQUIRED wherever derived terms surface; "O*NET" is a USDOL trademark. The
  Web Services API carries a SEPARATE licence from the bulk download.
- **O*NET cannot supply the exec vocabulary.** No occupation exists for CDO, CPO or CAIO — 9 of ~19
  target roles collapse into `11-1011.00 Chief Executives`, which lists **16** Hot Technologies total.
  Its `Essential Skills` file is psychometric constructs ("Systems Evaluation"), not ATS keywords —
  **the file that sounds like the term library is the one you cannot score with.** Nothing covers
  board reporting, P&L, M&A diligence, platform modernization, SOC 2 / FedRAMP / ISO 27001.
- **PLAN CHANGE (a correction, not a decision):** our own `jd_real` corpus is the **PRIMARY** exec term
  source; O*NET is the **supplement** — inverting the backlog's assumption. Evidence: 1,230 real
  postings, **876 (71%) C-level/VP/Head-of**, measured DF — roadmap 626, board 480, budget 416,
  operating model 222, digital transformation 153, P&L 83, M&A 66, due diligence 56, SOC 2 34. All
  absent from O*NET. Mining n-grams is **extraction, not generation**, so it satisfies the
  "not model-generated" rule when gated on DF>=5 + human approval.
- **Free consolation for declining paid data:** O*NET's `Hot Technology`/`In Demand` flags are
  **Lightcast-derived** — the demand signal we declined to pay for is already in the free dataset.
- **Licensing line:** storing the TOKEN `TOGAF`/`ITIL`/`SAFe` is nominative use and fine; **importing
  their taxonomies is not** (TOGAF commercial use is paid; SAFe/ITIL content restricted). Safe to
  ingest wholesale: **NIST CSF 2.0 + NICE** (US Gov work, 17 U.S.C. 105) and **CNCF landscape**
  (Apache 2.0, 2,501 names verified) — but NOT CNCF's Crunchbase-derived fields.
- `SAFe` needs **case-sensitive** matching: `safe` appears in 302 postings, `scaled agile` in 8.

### Revised seeding order
0. ~~Canonical normalizer~~ DONE. 1. Tables + immutability trigger + `scoreable`.
2. **Corpus miner + curation queue (highest yield).** 3. O*NET ingest. 4. NIST/CNCF/cloud packs.
5. Hand-curated exec competency pack. 6. Cut `atsScoreOne` over to the pinned library.

### New decisions (13-15)
| # | Decision | Recommendation |
|---|---|---|
| **13** | **O*NET attribution placement** — CC BY 4.0 requires crediting release + USDOL/ETA wherever derived terms surface. | Footer of the ATS/keyword modal, beside the library id + version (the spec already shows a provenance line there). |
| ~~14~~ | **DECIDED (owner): use BOTH O*NET and ESCO as sources**, neither a blocker. Original:, renaming files and shipping a migration crosswalk. Seed from 30.3 now and migrate, or wait? | **Wait for 31.0.** O*NET is phase 3 and phases 0-2 are weeks; avoids writing the ingest twice. |
| ~~15~~ | **DECIDED (owner): include ESCO.** Original: — ~1,201 digital concepts, targets exactly O*NET's exec/digital weakness. "O*NET only" was aimed at paid vendors. | **Include it.** Costs nothing, no approval needed. Verify licence terms before ingest. |


---

## 13. Source model for the term library (owner directive, 2026-08-19)

Owner: *"go with both as sources. being in both should give higher confidence. onet/esco can't be a
blocker rather a helper, it should be used when we can and serve as a model if we need to generate
values to complete a packet. we should know how an ats keyword was sourced."*

Four design consequences, binding on P1.2/P1.2b:

1. **A term has MANY sources, not one.** `term_library_entry.source text` becomes
   **`sources text[]`** plus a per-source `source_ref` map. A term attested in O*NET AND ESCO AND the
   corpus is a different confidence object from one seen once.
2. **Corroboration drives confidence.** Store `confidence` derived from *how many independent sources
   agree*, not from a model's opinion. Corpus DF is one input; O*NET/ESCO membership are others.
   Ranking and the scoring numerator should prefer corroborated terms.
3. **O*NET/ESCO are HELPERS, never gates.** A term missing from both is still valid if the corpus
   attests it (that is the majority of exec vocabulary — see §12). Absence from O*NET must never block
   a term, and an O*NET/ESCO outage or a pinned-release lag must never block a packet build.
4. **Provenance is user-visible and per-keyword.** "We should know how an ATS keyword was sourced" is
   a UI requirement, not just a column: every keyword chip must be able to show its source set
   (`O*NET 31.0 · ESCO · corpus DF 83`) and, where applicable, its `scoreable` status. This is the
   same affordance the spec's keyword detail panel already defines — extend that, don't add a second.

**Tension to resolve before P3/P8.2 (flagged, not decided):** "serve as a model if we need to generate
values to complete a packet" points at using O*NET/ESCO vocabulary to *shape* generated wording. SPEC
R2 ("evidence or escalate") forbids writing a claim the profile cannot support. These reconcile only
if O*NET/ESCO influence **phrasing of evidenced content** — never the existence of a claim. i.e. it may
choose the word "platform modernization" over "system upgrade" for something the profile already
evidences; it may never assert an unevidenced capability because O*NET says the role usually has it.
Recorded here so it is decided deliberately rather than drifting.
