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
  **`Boost DB Connector`** is `connected: true` but was `enabledInChat: false` in the prior session.
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
