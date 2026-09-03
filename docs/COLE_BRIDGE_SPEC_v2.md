# Cole Blake ↔ Boost Coach Bridge — corrected spec (v2)

<!--
WHAT:       Buildable spec for reaching Boost's coach engine from Huddle's Cole Blake agent.
WHY:        v1 (BOOST_COPILOT_COLE_BRIDGE_SPEC.md) was written as a self-described "partially
            blind guess". Audited against source: 2 of its claims are confirmed, 3 partly true,
            2 refuted, and it misses two auth bypasses that make its build ORDER unsafe.
SUPERSEDES: BOOST_COPILOT_COLE_BRIDGE_SPEC.md (v1)
EVIDENCE:   docs/spec-research/{A-coach-engine,C-frontend-routes}.md (this repo)
            docs/spec-research/B-huddle-tools.md (huddle-extension-app)
            All read at boost a041d8f / huddle 3148bcd.
-->

**Read §1 before anything else.** v1's recommended first move creates a security hole.

---

## 1. STOP — v1's build order is unsafe

v1 item **C** says to replace `/api/app/voice/chat`'s placeholder owner with the real user.
Do that first and you open your live account to the internet.

```
TODAY                                          AFTER v1 ITEM C (as written)
POST /api/app/voice/chat                       POST /api/app/voice/chat
  authLevel: 'anonymous'   <- appVoice.ts:120    authLevel: 'anonymous'    <- unchanged
  no requireWrite anywhere in the file           no requireWrite           <- unchanged
  owner = voice@executive-engine.local           owner = von.ellis@...     <- CHANGED
  => 48 tools on an EMPTY account                => 48 tools on YOUR account
     harmless misconfiguration                      anonymous send_outreach = real email
```

The placeholder is the **only** thing making the missing guard harmless. v1 removes the
mitigation and never mentions the vulnerability.

**Two bypasses, both verified by hand:**

| # | Where | Mechanism |
|---|---|---|
| 1 | `/api/app/coach/chat` | `resolveOwner` falls back to `req.query.get('owner')` (`appSession.ts:63`); the handler reads `body?.owner` (`coachAgent.ts:198`). No Bearer + no `?owner=` + `owner` in the **JSON body** ⇒ `requireWrite` passes on the demo branch, then the coach runs as that account. The guard's own comment claims it closes the spoof — it closes the query-string one only. |
| 2 | `/api/app/voice/chat` | `authLevel: 'anonymous'` (`appVoice.ts:120`), zero `requireWrite`/`resolveOwner` in the file. All 48 tools, unauthenticated. |

**Mandatory order: guard first, identity second.** Never the reverse.

---

## 2. Feasibility table — what the work PRESUMES actually exists

Verdicts: `EXISTS` / `ABSENT` / `EXISTS-BUT-CONSTRAINED`.

| Dependency | Producer | Consumer today | Proof | Verdict |
|---|---|---|---|---|
| Coach endpoint | `coachChat` `coachAgent.ts:191` | Boost coach panel | route `app/coach/chat` `:387`; `runCoachTurn` `:202` | **EXISTS** |
| Coach tool belt | `coachTools.ts` | `runCoachTurn` | **48** tools (47 `fn()` + Tavily); v1 says "~50" | **EXISTS** |
| Hop limit | `coachAgent.ts:141` | — | `const maxHops = 8` | **EXISTS** |
| Model `gpt-4o` | — | — | **not fixed in code**; v1 states it as fact | **EXISTS-BUT-CONSTRAINED** |
| Durable memory | `coach_memory`, `coach_thread`, `coach_activity` | `remember`/`recall` | keyed by owner email | **EXISTS** |
| `coach_triples` KG | nothing | **nothing** | created, never read or written — yet the system prompt (`:23`) and `Settings.jsx:1042` both advertise it | **ABSENT (falsely advertised)** |
| Artifact deep links | `artifact.doc_url` / `drive_url` | `get_packet` | real external URLs | **EXISTS** |
| App routes `/pipeline/{id}`, `/packets/{id}` | — | — | `shell.jsx` NAV has flat routes only; no `:param` route anywhere in `app/src` | **ABSENT** |
| Hash routing | `state.jsx:21,32` | whole SPA | `window.location.hash`, default `#/today` | **EXISTS-BUT-CONSTRAINED** |
| `swap_decision` data | swap pipeline | `GET /app/packet/{id}/swaps` | table + read route exist; no coach tool | **EXISTS-BUT-CONSTRAINED** |
| Per-turn persona overlay | — | — | zero matches repo-wide; `coach_config` is a **single global row** (`id INT PRIMARY KEY DEFAULT 1`, no owner column) | **ABSENT** |
| Huddle per-agent tool execution | `runAgentTurn` inside `runHuddleTurn` `huddle.functions.ts:1885` | 4 dispatch sites | v1 called this "not located"; it is located | **EXISTS** |
| Single-agent-only tool precedent | `groom_backlog` / terry-locke | 4 sites + capability gate | complete worked example | **EXISTS** |
| Cross-app server auth | `tasks-sync.ts` shared secret | journey → Huddle | `x-webhook-secret` / `JOURNEY_PROXY_TOKEN` | **EXISTS** |
| Cole Blake persona | `agents.ts` | router + snapshot | all 7 fields confirmed verbatim; **longest snapshot of 15** (1,718 chars) | **EXISTS** |
| Cole owns a capability | — | — | only `terry-locke` has `capabilities` (`agents.ts:88`) | **ABSENT** |

---

## 3. What v1 got wrong

| v1 claim | Reality | Why it matters |
|---|---|---|
| "Deep-link discipline — system prompt change only, **zero new tools**", called the "highest-leverage, lowest-effort fix" | The URLs it mandates **do not resolve**. Boost is hash-routed (`state.jsx:21`) and its links omit the `#`; and `/pipeline/{id}`/`/packets/{id}` are not routes at all | A prompt-only change makes the coach emit confidently-broken links — worse than none, because it looks like it worked |
| Swap anchor `#swap-{id}` is a "small frontend addition" | Under hash routing the fragment **is** the route; a URL cannot carry a second meaningful `#` | Needs a new addressing scheme, e.g. `#/packets?id=…&swap=…` — a design decision |
| `personaOverlay` param, "optional, recommended" | No such param, and `coach_config` is one global row shared with the voice path | Not a param — a schema change |
| "~50 tools" | Exactly 48 | Minor, but it is the number people will diff against |
| Model is gpt-4o | Not fixed in code | Anything asserting model behaviour is unfounded |
| Huddle tenant `ee633423` vs Boost `b9791c7d` | **Backwards.** Boost's live tenant is `ee633423` (`api-deploy.yml:82`); `b9791c7d` is Huddle's **local `.env`** value | See §4 — subtler than either reading |
| Huddle per-agent tool execution "not located", bridge unbuildable until found | `runAgentTurn` inside `runHuddleTurn`, `huddle.functions.ts:1885` | v1 told the next session to start on an already-answered question |
| Make Cole a "thin passthrough" | `instructionsOverride` **replaces** rather than merges (`:2987`); Cole has the longest snapshot of all 15 | Subtractive prompt edit — Huddle's CLAUDE.md forbids it without explicit sign-off |
| (missing) | Two auth bypasses | §1 |
| (missing) | One human, **two emails** (`dev@`, `von.ellis@`) | §5 — v1's identity model splits memory in two |

---

## 4. The tenant question, stated precisely

Both v1 and an earlier pass of this review got this wrong, in opposite directions, because
**three different artefacts disagree and each looks authoritative alone.**

| Artefact | Value | What it actually describes |
|---|---|---|
| Boost `api-deploy.yml:82` | `ee633423-…` | Boost **deployed** (observed) |
| Huddle `.env:2`, `.env.example:9` | `b9791c7d-…` | Huddle **local dev** |
| Huddle `deploy-swa.yml:199` | `${AZURE_TENANT_ID}` | Huddle **deployed** — resolves to `ee633423-…` if the org secret is the documented one |

**Verdict: UNDETERMINED**, high confidence they match in production (inference from the org
secret, not an observation). Settle by reading the deployed bundle or the SWA app setting.

**It does not gate the build.** The recommended transport is the shared secret, which sidesteps
tenant identity entirely — exactly what `tasks-sync.ts` was built to do.

---

## 5. Identity: one human, two emails

Owner-stated: both apps reach the same person via **`dev@`** and **`von.ellis@`**. v1's model is
"shared identity = same email", which silently splits `coach_memory` into two stores — the exact
failure the bridge exists to prevent.

**Required:** a canonical-identity resolver in Boost mapping every known address to one owner key
before it touches `coach_memory`/`coach_thread`. Alias list is config, not a literal (this repo's
no-hardcoded-config rule). Do this **before** any cross-app memory test, or the test passes for
the wrong reason.

---

## 6. The one real fork: passthrough vs. tool

v1 assumed passthrough and filed the consequence as "optional". It is the decision.

| | **A — Thin passthrough** (v1) | **B — Boost tool on Cole** (recommended) |
|---|---|---|
| What happens | Cole forwards the message; Boost's brain replies; Huddle speaks it | Cole keeps his brain; calls a `boost_*` tool when he needs Boost data |
| Cost / what you lose | Cole's 1,718-char snapshot is **bypassed** — `instructionsOverride` replaces, doesn't merge (`:2987`). Subtractive prompt change ⇒ needs explicit sign-off | One tool registered at 4 sites (`:3225`, `:3263`, `:4319`, `:6239`) + voice (`realtime-tools.server.ts:113`) |
| Makes easy later | One prompt to maintain | Cole composes Boost data with calendar, tasks, other agents |
| Makes hard later | Cole can never blend Boost data with Huddle context; his voice/persona must be rebuilt on the Boost side | Two prompts stay in sync |
| Reversible? | **Hard to reverse** — the snapshot decays once bypassed | **Yes** — delete the tool |

**Recommendation: B.** It is additive (no sign-off needed), it has a complete working precedent in
`groom_backlog`, and it is reversible. A's only advantage — one prompt — is bought by discarding
the longest-tuned persona you have.

Cause→effect: pick A, so Cole's snapshot stops being read, so his career-coaching voice comes from
Boost's operator prompt, so you rebuild it via a `personaOverlay` that does not exist and needs a
schema change — arriving back where B starts, having lost the snapshot.

---

## 6b. CORRECTION — ElevenLabs is a VOICE-ONLY path, and §6 leaned on it too hard

Owner, 2026-09-03: *"check huddle I don't believe it's using openlabs API actively at the moment."*
Correct for text chat, and it narrows an argument this spec made.

**`src/features/huddle/lib/huddle.functions.ts` — the text-chat turn — contains ZERO
`synthesizeSpeech` calls.** Typing to an agent never reaches ElevenLabs. EL is called from exactly
four places, all voice:

| Caller | Path |
|---|---|
| `useVoiceCallRealtimeSpeak.ts:222`, `:607` | 1:1 voice call (the DEFAULT engine) |
| `useGroupVoice.ts:224` | group voice |
| `useCeremonyVoice.ts:361` | ceremonies / stand-ups |
| `AgentVoiceField.tsx:29` | the settings voice preview |

**When a call IS running, EL is the voice — despite the engine's name.** `voice-engine-store.ts`
defaults to `realtime-speak`, which reads as "OpenAI Realtime speaks". It does not: the session is
minted `output_modalities:["text"]` (`useVoiceCallRealtimeSpeak.ts:18`) and `:380` explicitly
disables the remote OpenAI audio track — *"Text-out session -> no OpenAI audio track ... we voice
via EL"*. This matches the org-level pattern in `/root/.claude/CLAUDE.md`: Realtime as brain/ear,
ElevenLabs as voice.

**A documented silent-failure mode, which is the other way the observation can be true even on a
call.** `:179-181` and `:213-214` record a reported default-engine bug where the reply text rendered
and **no audio played with no error** — a mobile autoplay rejection, and separately an `ok:false`
synth result (e.g. *"ELEVENLABS_API_KEY is not configured"*), both previously swallowed. Both now
surface a toast, but the failure mode is real and looks exactly like "EL isn't being used".

**What this changes here.** §6 argued for option B partly because Cole's own EL voice speaks the
relayed reply. That holds **only in a voice call**; in text chat there is no TTS at all, so the
voice argument is narrower than §6 implied. **The recommendation does not change** — it rests on
the snapshot being additive rather than subtractive, and on `groom_backlog` as precedent, neither
of which involves voice. §6's voice line should be read as applying to voice sessions only.

**Incidental correction to a stale comment:** `elevenlabs.server.ts:51-52` says agent `voiceId`s
"are human placeholders (\"terry\", \"iris\") until real ElevenLabs voices are assigned". All 15
agents now carry real ~20-char EL ids, Cole's `o2zd9K5QOO7ppTb04Lx0` among them, so `resolveVoiceId`'s
fallback never fires for a roster agent today.

**Not verified:** whether `ELEVENLABS_API_KEY` is actually populated on the deployed SWA. The
sandbox cannot reach it, and Huddle exposes no config-status route (`src/routes/api/public/` has
none). Settle it by reading the SWA app setting, or by starting one voice call and watching for the
"Couldn't play voice" toast.

## 7. Build order

**Phase 0 — SECURITY (blocks everything).**
- **S1** Guard `/api/app/voice/chat`: shared-secret header, ElevenLabs-side. Prove anonymous ⇒ 401.
- **S2** Close the body-`owner` bypass: `requireWrite` and the handler must read identity from
  one function. Prove body-only `owner` ⇒ 401 on a non-demo account.
- **S3** Set a dedicated `SESSION_SIGNING_SECRET` (today it defaults to the Graph app secret, so
  anyone who can mint a token can impersonate anyone).

**Phase 1 — Boost hardening.**
- **B1** Canonical identity resolver (§5).
- **B2** Frontend param routes + hash-aware link builder — **prerequisite** for any deep-link
  prompt. Decide the swap addressing scheme here.
- **B3** Deep-link prompt rule (only after B2).
- **B4** `list_swaps` tool over the existing `GET /app/packet/{id}/swaps`.
- **B5** `override_swap`, modelled on the `correction` table pattern.
- **B6** Voice identity — **only after S1**.
- **B7** Either delete `coach_triples` or stop advertising it in the prompt and Settings.

**Phase 2 — Bridge.**
- **H1** Boost exposes `GET /tools` + `POST /tool` behind the shared secret.
- **H2** Register the Boost tool at all **four** Huddle sites + voice.
- **H3** Give Cole a `capabilities` entry so ownership is data-driven, not hardcoded.
- **H4** Cross-app memory test — meaningful only after B1.

---

## 8. Genuinely open questions

1. **Deployed Huddle tenant** — read the bundle or the SWA setting (§4). Non-blocking.
2. **Swap addressing under hash routing** — query params or a rethink? Decide in B2.
3. **`override_swap` regeneration scope** — patch the section or re-run `generate_artifact`? (v1's only open question that survives.)
4. **ElevenLabs shared-secret mechanism** — which header ConvAI can actually send, for S1.

---

## 9. Live schema — CONFIRMED against production

Run `33773656095` (`db-query.yml`, `success`, 15:37Z) against
`eds-postgresql / boost_resume_n_packet_builder`, 87 rows. This replaces v1's §1.1, whose own text
cited a **different app's** Supabase project ref before correcting itself mid-sentence.

| Table | Confirmed live | Note |
|---|---|---|
| `artifact` | `doc_url`, `drive_url`, `content`, `version_history`, `heygen_video_id`, `type`, `status` | The deep-link DATA is real. Only the app ROUTES are missing (§3) |
| `swap_decision` | every column v1 named — `from_candidate_id`, `to_candidate_id`, `from_label`, `to_label`, `requirement_id`, `verbatim_quote`, `confidence`, `driver`, `rationale`, `loop` | **plus `list`, `seq`, `action`, which v1 omitted** — `action` is what `override_swap` must write |
| `correction` | `char_start`, `char_end`, `before_sha256`, `applied_seq`, `reverted_by`, `reverted_at`, `frame` | Offset + hash + revert trail. Confirms it as the right model for **B5** |
| `coach_memory` | `owner`, `kind`, `text`, `source`, `embedding` (USER-DEFINED = pgvector), `metadata` | Keyed by `owner` **text** — so the alias split in §5 is real, not hypothetical |
| `coach_thread` | `owner`, `messages` (jsonb), `updated_at` | Keyed by `owner` |
| `coach_activity` | `owner`, `user_msg`, `reply`, `tools`, `instructions` | Keyed by `owner` |
| `coach_triples` | `owner`, `subject`, `predicate`, `object`, `confidence`, `source_id` | Table EXISTS; the audit finding is that **no code reads or writes it** |
| `packet` | `status`, `round`, `ats_score`, `must_haves`, `covered_kw`, `pkg_json`, `last_build` | As described |

**What this changes:** `list_swaps` (**B4**) and `override_swap` (**B5**) are confirmed buildable on
real columns — `override_swap` writes `action` and mirrors `correction`'s hash-verified revert
pattern. And because all four `coach_*` tables key on a bare `owner` text column, **B1 is load-bearing
rather than tidy-up**: two addresses produce two disjoint memory stores by construction.

### Production row counts — run `33775383895` (`success`, 15:54Z)

| Table | Rows | What it settles |
|---|---|---|
| `coach_triples` | **0** | The dead-table finding is now CONFIRMED IN PRODUCTION, not inferred from a grep |
| `coach_memory` | 129 | The coach is heavily used... |
| `coach_activity` | 92 | ...so an empty `coach_triples` is not "new and unused". Its siblings fill; it does not |
| `coach_thread` | 7 | |
| `coach_config` | **1** | **Single global row CONFIRMED** — a per-owner overlay is a schema change, exactly as §3 says |
| `swap_decision` | 79 | Real rows for **B4**/**B5** to work against |

The 0-against-129 contrast is the falsification test, not just a number: if any code path wrote
triples, the table would fill like its siblings. **B7 is now evidence-backed** — the system prompt
(`:23`) and `Settings.jsx:1042` advertise a knowledge graph that has never held a single row.

## 10. Not verified



Narrowed after two live runs. **Still unproven:**

- **Both auth bypasses in production.** Verified by READING source at `a041d8f`; deliberately not
  exploited. Settling them means calling the deployed routes, which is a live security test and
  needs the owner's say-so first.
- **The deployed Huddle tenant** (§4) — read the bundle or the SWA app setting.
- **Which header ElevenLabs ConvAI can send**, for S1.

**No longer unproven:** the live `coach_config` row (1 row, confirmed), `coach_triples` being dead
(0 rows against 129/92 in its siblings), and the whole `swap_decision` / `artifact` / `correction`
column set. Sourced from `db-query.yml` runs `33773656095` and `33775383895` — the MCP connectors
were reconnected mid-session but their tools do not re-register into a running CCR session, so the
workflow fallback carried both queries.
