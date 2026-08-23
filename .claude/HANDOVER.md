# HANDOVER — QC/evidence layer, 2026-08-23

Read this first, then `.claude/memory.md` (bottom section) and `.claude/DEFERRED.md`.
Everything below was measured live, not inferred. Run ids are quoted so you can re-read them.

---

## 1. The one-paragraph situation

**The resume generator is fine and has been all along.** Your owner's three-call pipeline produces
drafts from HIS prompts; today's build made 4 artifacts with 0 failures. **What is broken is the QC
layer that grades those drafts and decides `ready`** — evidence resolution, `must_have_coverage`, the
artifact gate. That layer is newer than the working pipeline and is currently the only thing standing
between the owner and shipping. He is (rightly) frustrated that two days went into it.

**NEVER edit any prompt in the Prompts table.** Owner's standing rule: *"i still want my original
prompts to be driving what the resume draft is."* Evidence may affect grading only, never the draft.

---

## 2. What is already DONE (do not redo)

### FIXED + DEPLOYED + VERIFIED LIVE — `31ca007`, the build was deleting its own evidence
`writeEvidence` (api/src/functions/tests/appRequirements.ts) opened by deleting EVERY evidence row
for the opportunity, then re-inserted only deterministic rows. But `proposed` rows can only be made
by the escalation pass, which runs only when a model transport is passed. `runPacketBuild` escalates
first (transport → 8 proposals stored), then runs `evaluateArtifact` per artifact, and THAT calls
`writeEvidence` with four args — no transport, deliberately (four concurrent artifacts must not each
start a model run). So every build paid for 12 model calls and deleted the result seconds later.

Corpus-wide effect: `requirement_evidence` held **1 row across 613 opportunities with requirements**.

Fix: delete scoped by `canEscalate` — *a pass may only delete rows it is structurally able to
rebuild*. Applied inside `writeEvidence` so all four callers are covered. Plus: deterministic
evidence now evicts a stale proposal for the same requirement, because `on conflict (requirement_id,
source_key, char_start, char_end) do nothing` is keyed on the SPAN not the method, and a byte-exact
proposal can hold the span a rule later resolves — the rule insert would have been silently dropped.

Verified live on eMoney, same op that erased them before: **8 proposed rows → 8** (was 8 → 0).
Guards `H:evidence-survives-the-build` + `H:rule-evidence-evicts-a-stale-proposal` in
`api/test/shipPathDb.test.mjs`, both mutation-proven.

---

## 3. THE OPEN BLOCKER — and it is now diagnosed

`must_have_coverage` reads **0/12**, `responsibilities_addressed` **0/21**, on all four artifacts of
a packet built from a REAL 9,749-char posting (eMoney `2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3`).
Deterministic evidence is **0 of 35**; all 12 open must-haves escalated to the model.

**Root cause (measured via `GET /api/app/opportunity/{id}/requirements`, job 97137243552): the
matcher's word rules, NOT missing data.** The profile is real and substantive. Per-requirement
`evidenceSearch` diagnostics:

| seq | requirement | reason | closest excerpt actually found in the profile |
|---|---|---|---|
| 29 | Collaborative executive capable of building alignment | `below_threshold` | "By fostering **collaboration** and ensuring **alignment** across business and te…" |
| 32 | Ability to lead and motivate cross-functional teams | `list_element_unsupported` | "**Led** an enterprise-wide SDLC re-design, optimizing **cross-functional** workf…" |
| 27 | data architecture, data platforms, AI integration | `list_element_unsupported` | "Developed a SaaS **platform integrating** mobile, real-time **data** & **AI**" |
| 24 | Deep expertise in modern architecture patterns | `below_threshold` | "Graduate Certificate, Enterprise **Architecture** and Business Transformation" |
| 22 | 15+ years leading large-scale engineering orgs | `numeric` | "My career has been defined by **leading global organizations**…" |
| 26 | driving DevOps, SRE, platform engineering transformations | `missing_specific_token` | "Enterprise Governance \| Technology Strategy \| Risk Management \| Digital…" |
| 28 | Exceptional communication skills | `no_candidate` | "S U M M A R Y" |
| 31 | critical thinker, strong problem-solving skills | `no_candidate` | "S U M M A R Y" |

**Read seq 29 closely — that is the whole bug.** The profile says "fostering collaboration and
ensuring alignment"; the requirement asks for "collaborative executive capable of building
alignment". A human calls that evidenced. The matcher rejects it because `collaborative` ≠
`collaboration` (**no stemming / morphological normalisation**) and `executive`/`capable` are absent
(**demands a high fraction of exact token forms**). On real prose this yields near-zero recall.

Secondary observations, lower priority:
- `no_candidate` rows return `closestExcerpt: "S U M M A R Y"` — the Google resume TEMPLATE's
  letter-spaced headings are in the profile corpus. "S U M M A R Y" tokenises as 7 single letters.
  Worth checking whether template scaffolding should be in the evidence corpus at all.
- **seq 34 is `"The salary range for this position is $279,000 - $346,000"` classified as a
  `must_have`.** That is compensation text, not a requirement, and is permanently uncoverable — it
  drags the denominator down forever. Extraction defect, separate from the matcher.

### Next step, and DO IT IN THIS ORDER
1. **Measure before tuning.** `requirementSupport.ts` is pure TypeScript, no DB — write a local
   harness that runs the 12 eMoney must-have texts against the real profile excerpts quoted above
   and prints the actual overlap ratio + which rule rejected each. Tuning a threshold blind is how
   this got mis-calibrated the first time (`checks.ts:516` records a 0.5→0.7 tightening made against
   *paraphrase*-shaped Trinnex rows, which is what broke real-verbatim matching).
2. Then decide between: stemming/lemmatisation, a lower threshold, or synonym/competency mapping.
   **This is TIER 1** (it decides `must_have_coverage` → the gate): independent AC subagent BEFORE
   coding, independent `verifier` after, mutation-prove every new guard.
3. Keep the house rule intact: **a `proposed` row must NEVER count toward the numerator**
   (`ruleEvidenceOf`/`isProposed` in `checks.ts` ~611-640). "A model may PROPOSE, only an exact rule
   may ACCUSE." Raising recall must come from the deterministic matcher, not by counting proposals.

---

## 3b. SHIPPED TONIGHT — advisory gate mode (and it is a BRIDGE, not a fix)

`chk_gate_advisory` is LIVE and **ON for von.ellis@enterpriseds.io** (commit `c226247`, deploy run
32619566221; verified live: `advisory:true`, `gate:"fail"`, `attention:4`). A `fail` is now
overridable through the existing audited path — verified session, >=8-char reason, recorded. It does
NOT rewrite the gate value and does NOT change any check row.

**The owner correctly called this the lesser option.** It does not repair coverage; it lets him ship
past a grader that reads 0/12. Two live costs: `approvalBlock` is PER ARTIFACT, so it is four
override prompts per packet; and habituation — if every packet ships by accepting four blocking
findings, the QC rail becomes noise he has trained himself to click past, which is worse than no
gate. **Turn `chk_gate_advisory` back OFF the day the confirmation path lands.** Nothing else
reminds him.

Five sites carry advisory (two server gates, `recomputePacket`, and two client mirrors). The
`recomputePacket` one was found by the AC pass and would have failed SILENTLY — it counts
`gate='fail'` and needs zero for `ready`, so without it every artifact goes `approved`, every call
returns 200, and nothing ships.

## 3c. YOUR TASK: Option A — the confirmation path

**The ACs are ALREADY WRITTEN: `.claude/ac/confirm-proposed-evidence.md`** (39 ACs, 8 risks,
11-guard spec). Read them; do not re-derive them. Two design traps they caught, both verified
independently against source:
1. **A confirmation cannot be keyed on `requirement_id`.** `writeRequirements` runs
   `delete from requirement where opp_id=$1` on every re-extraction (`appRequirements.ts:359,388`)
   and `requirement_evidence.requirement_id` is `ON DELETE CASCADE` (`schema.ts:406`) — re-parsing a
   posting would silently destroy every confirmation the owner gave. Key on CLAIM IDENTITY:
   requirement text + `source_key` + offsets + quote bytes + `record_sha256`.
2. **The gate path never re-verifies evidence.** `verifyRequirementRows` is called only at
   `appRequirements.ts:499,559`; `appChecks.ts:77` builds the gate's evidence off the raw join.
   Harmless while proposals cannot count — fatal the moment one does, because a confirmation
   pointing at a profile record the owner has since edited enters the numerator unchecked.
3. Any confirmation column reaching the joined row MUST be named `evidence_confirmed_*` or the D19
   prefix redaction will leave it asserting "a human vouched for this" beside a withdrawn quote.

Migration already dry-run on a POPULATED local DB: two nullable columns + an all-or-none
`(confirmed_at is null) = (confirmed_by is null)` constraint apply cleanly, the existing `proposed`
row survives UNCONFIRMED, a half-confirmation is rejected by a real constraint error, and
`add column ... not null default false` DOES backfill existing rows.

## 4. Corrections to earlier claims — do not re-inherit these errors

- **"31% of 1,941 opportunities lack `jd_real`" was WRONG.** That counted dismissed + demo + other
  owners. The owner's ACTIVE pipeline: **1,114 opps, 1,030 (92.5%) have `jd_real`**, backfill queue
  **empty**, 1,526 successful fetches. The JD backfill is NOT broken and is NOT the bottleneck.
- **Every `check_result` in the database belonged to ONE opportunity — Trinnex `9f9c370a`** — which
  is a 1,054-char browser-extension snippet (`job_id` NULL, `job_url` NULL, `why_surfaced` = "Saved
  from a web page", source `Extension`). It cannot be auto-repaired: **the extension did not record
  the URL.** Every QC number reported before 2026-08-23 came from this one bad row. Use **eMoney
  `2cb56fb3`** (real 9,749-char posting) as the test opportunity from now on.
- **`CLAUDE.md` claims `AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` are in the CCR env. They are NOT.**
  Measured: 133 env vars, zero Azure/PG credentials, `az` not logged in. Fix that doc.

---

## 5. Environment facts you will need

- **The sandbox CANNOT reach Azure Postgres.** TCP 5432 blocked (proxy answers CONNECT on :443,
  hangs on :5432); no DB credentials in env; the Azure PG firewall would also need this sandbox's IP.
  There is no local workaround.
- **`claude mcp list` → "No MCP servers configured."** GitHub/Supabase/`Azure_pg_mcp` are injected
  server-side by the claude.ai connector layer; there is nothing local to copy or edit.
  `Azure_pg_mcp` points at **`RAG_AI_Agents` — the WRONG database** (no `requirement_evidence`).
  **`Boost_DB_Connector`**: DO NOT TRUST THE PRIOR SESSION ON THIS. That session's connector view was
  proven STALE — after the owner deleted and recreated the connector, `ListConnectors` there still
  returned the OLD `directoryUuid` (42f9b20a-5c8e-4d6b-b1e9-f099ae5c2330) and `enabledInChat: false`,
  i.e. a record of a connector that no longer existed. Conclusions drawn there (including a
  "connector names with spaces get dropped" hypothesis reported as DISPROVEN) were based on that
  ghost row and are UNTESTED, not settled. Check your OWN tool list for `mcp__Boost*` and report what
  you actually see.
  **If its tools (`mcp__Boost*`) are present in YOUR session, USE THEM — they are ~instant.**
  Verify with a `select current_database()`; you want `boost_resume_n_packet_builder`.
- **Otherwise use GitHub Actions** (~40-60s per round trip — **BATCH many questions into ONE query**):
  - `db-query.yml` with `{sql: "..."}` → poll → `get_job_logs`
  - `api-test.yml` with `{method, path, body}` — reaches `azurewebsites.net`; the sandbox cannot
  - `./scripts/wait-run.sh sha:api-deploy.yml:<sha>` — **never `latest:` for a deploy** (H15)
- Local PostgreSQL 16.13 IS available for real schema/DB tests (see `CLAUDE.md`).
- Owner email for `?owner=`: `von.ellis@enterpriseds.io`.

## 6. Process rules that are actually enforced

- **Tier by blast radius** (`CLAUDE.md` "Match the process to the risk"). Tier 1 = anything deciding
  `must_have_coverage`/the gate/a score → full ceremony. Tier 3 = prose → just do it.
- **NEVER skip mutation-proving a new guard**, at any tier. Write guard → reinstate the defect →
  confirm the suite FAILS → restore. Grep the mutated line to prove the mutation applied; a
  `perl -0pi`/`replace()` that silently no-ops makes a "green" result vacuous.
- H-case names use a **SLUG, never a number**: `test('H:two-words-here: …')`.
- Branch discipline: never commit to `main` directly; feature branch → PR → `--ff-only` → push main
  (that is what deploys). Re-run `git fetch origin` before answering ANY status question.
- Owner's communication rule, verbatim: *"i dont automatically scroll back up to review every word
  of the narration created while i was away. i look for the where are wee and actions neededd to
  move on statements at the bottom given that's where my screen is so you have to resumarize at the
  bottom when asking me to make decisions succinctly but intuiitively"* — **put the summary and the
  decisions at the BOTTOM**, in short markdown tables with severity emoji.
- Owner has said: **stop asking, pick and proceed** when the alternative is stalling. But a change to
  LIVE behaviour (e.g. making the gate advisory instead of blocking) still needs his explicit word.

## 7. The open decision he has not answered

He was shipping packets before this gate existed, and the gate now blocks everything.
- **Option A** — make the gate advisory (surface findings, don't block `ready`) so he ships today,
  fix the matcher behind it. *This was the recommendation; it is a live-behaviour change and needs
  his go-ahead.*
- **Option B** — fix the matcher first, gate stays blocking, he stays blocked.

Also still open: #19 parse Call 3 as sections, #20 three-pass swap attribution, surface `kind_source`
on the QC rail so a `category_default` must-have does not read as an employer requirement.
