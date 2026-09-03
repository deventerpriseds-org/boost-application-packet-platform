# A — Coach Engine: audit of the REAL current state

<!--
WHAT:       Fact-check of a feature spec's claims about the Boost coach engine, against the code.
WHY:        The spec makes claims (routes, model, hop limits, tool counts, a VOICE_OWNER bug) that
            must be verified against source before anything is built on them.
EVIDENCE:   Every claim below carries file path + line number + verbatim snippet.
SUPERSEDES: nothing
SUPERSEDED-BY: nothing -- current
-->

**Repo:** `/home/user/boost-application-packet-platform` — branch `origin/main`, commit `a041d8f`
**Method:** read the source. Verdicts: CONFIRMED / REFUTED / PARTLY-TRUE / NOT-FOUND / NOT-VERIFIED.
**Status:** IN PROGRESS (written incrementally)

---
## Where the coach engine actually lives (orientation)

Everything is under `api/src/functions/tests/` — despite the directory name, this is **production
source**, not a test folder. `api/src/functions/` contains only `apps.ts`, `buildStamp.ts`,
`config.ts`, `health.ts`, `processJob.ts` and the `tests/` dir.

| File | Lines | Role |
|---|---|---|
| `api/src/functions/tests/coachAgent.ts` | 405 | `SYSTEM` prompt, `runCoachTurn()`, `coachChat` route + memory/config/upload routes |
| `api/src/functions/tests/coachTools.ts` | 179 | `coachToolSchemas()` + `executeCoachTool()` — the tool registry |
| `api/src/functions/tests/coachMemory.ts` | 137 | `remember` / `recall` / `listMemory` / `bootstrapMemory` / `getPool` |
| `api/src/functions/tests/appVoice.ts` | 152 | `/api/app/voice/turn` and `/api/app/voice/chat` |
| `api/src/functions/tests/appSession.ts` | 107 | `resolveOwner()` / `requireWrite()` |

---

## CLAIM 1 — "POST /api/app/coach/chat exists and runs runCoachTurn()"

### VERDICT: **CONFIRMED**

**Route registration** — `api/src/functions/tests/coachAgent.ts:387`:
```ts
app.http('coachChat', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/chat', handler: coachChat })
```
Exact route path string: **`app/coach/chat`** → served at `POST /api/app/coach/chat`
(Azure Functions prepends the `/api` route prefix). `authLevel: 'anonymous'` — **no function key
required**; auth is entirely application-level (see Claim 5).

**Handler** — `api/src/functions/tests/coachAgent.ts:191`:
```ts
export async function coachChat(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
```

**It calls runCoachTurn** — `coachAgent.ts:202`:
```ts
const result = await runCoachTurn(history, owner, key)
```

**Request/response shape** (`coachAgent.ts:190`, `:197-204`):
- Body: `{ messages:[{role,content}], owner }` — `messages` is **required** (`:200` returns 400
  `messages required` if empty) and is **truncated to the last 16** (`:199` `body.messages.slice(-16)`).
- Response: `{ reply, toolCalls, uiActions, usedMemory, usedVectorStore }` (`:204`).

**Other coach routes registered in the same file** (`coachAgent.ts:388-395`) — verbatim route strings:
`app/coach/memory/bootstrap`, `app/coach/memory/list`, `app/coach/provision`, `app/coach/upload`,
`app/coach/config` (GET+POST), `app/coach/activity`, `app/coach/thread`, `app/coach/memory/delete`.
*(line numbers for these confirmed below in the registration block.)*

---

## CLAIM 2 — "OpenAI Responses API, model gpt-4o, up to 8 tool-call hops per turn"

### VERDICT: **PARTLY-TRUE** — API and hop limit CONFIRMED; the model is a *default*, overridable two ways.

**Responses API — CONFIRMED.** `coachAgent.ts:12`:
```ts
const OPENAI_URL = 'https://api.openai.com/v1/responses'
```
POSTed at `coachAgent.ts:152-155`. Response parsing keys on Responses-API shapes
(`output_text`, `output[].type === 'function_call'`, `function_call_output`, `previous_response_id`)
— `coachAgent.ts:52-62`, `:150`, `:169`.

**Model `gpt-4o` — PARTLY-TRUE (it is a fallback default, not a fixed literal).** `coachAgent.ts:14`:
```ts
const MODEL = process.env.COACH_MODEL || 'gpt-4o'
```
And the request actually sends **`cfg.model`**, not `MODEL` — `coachAgent.ts:146`:
```ts
      model: cfg.model,
```
`cfg` comes from `getCoachConfig()` (`coachAgent.ts:89-97`), which reads the **`coach_config`
table** (single global row `id=1`) and falls back to `MODEL`:
```ts
    const { rows } = await pool.query<{ system_prompt: string; model: string }>(`SELECT system_prompt, model FROM coach_config WHERE id=1`)
    const sp = rows[0]?.system_prompt
    return { systemPrompt: sp || SYSTEM, model: rows[0]?.model || MODEL, custom: !!sp }
```
So the effective precedence is **`coach_config.model` → `process.env.COACH_MODEL` → `'gpt-4o'`**.
Any spec sentence saying "the coach runs gpt-4o" is true only of the un-overridden default. The
live value is NOT-VERIFIED from the sandbox (would require reading `coach_config` in prod Postgres
or `GET /api/app/coach/config`).

**8 hops — CONFIRMED as a literal.** `coachAgent.ts:141`:
```ts
  const maxHops = 8
```
Loop `coachAgent.ts:144`: `for (let hop = 0; hop <= maxHops; hop++) {`  → up to **9 model calls**.
Break condition `coachAgent.ts:161`:
```ts
    if (calls.length === 0 || hop === maxHops) { reply = extractText(json).trim(); break }
```
So tools are executed on hops 0..7 = **at most 8 rounds of tool execution**, and the 9th call
(hop 8) is text-only. "Up to 8 tool-call hops" is an accurate reading. Note each hop can execute
**multiple** tool calls (`coachAgent.ts:164` loops over `calls`), so 8 hops ≠ 8 tool calls.

**Note — a possible correctness bug, worth flagging to the spec author** (`coachAgent.ts:171-172`):
```ts
    runningInput.length = 0
    runningInput.push(...nextInput)
```
The conversation array is **cleared** each hop and replaced with only the `function_call_output`
items; continuity rides on `previous_response_id` (`:150`, `:158`). This is a legitimate Responses-API
pattern, but it means the injected system message at `:134-137` is present on hop 0 only.
Marked OBSERVATION, not a defect claim — no runtime evidence gathered.

---
## CLAIM 3 — "~50 tools"

### VERDICT: **PARTLY-TRUE — the exact number is 48** (49 when a populated vector store exists).

**48 = 47 `fn(...)` schemas + `TAVILY_WEB_SEARCH_TOOL`.**

- 47 `fn(...)` entries in `coachToolSchemas()` — `api/src/functions/tests/coachTools.ts:81-138`
  (`return [ ... ]`, counted by `grep -cE "^\s*fn\('"` over lines 81-138 → **47**).
- `+1` `TAVILY_WEB_SEARCH_TOOL` — `coachTools.ts:136`, imported from
  `api/src/functions/tests/tavilySearch.ts:4-22`, `name: 'tavily_web_search'` (`tavilySearch.ts:6`).
- **Total advertised on every turn: 48.**
- `+1` conditionally: `file_search` is appended ONLY if a vector store exists AND has ≥1 completed
  file — `api/src/functions/tests/coachAgent.ts:130`:
  ```ts
  if (vsId && vsHasFiles) tools.push({ type: 'file_search', vector_store_ids: [vsId] })
  ```
  (`vsHasFiles` computed at `coachAgent.ts:124-129` from a live GET to
  `https://api.openai.com/v1/vector_stores/{id}` checking `file_counts.completed > 0`.)
  That is a **built-in tool type, not a function tool** — so "~50 tools" is a fair round number but
  the precise, citable figure the spec should use is **48 function tools (49 array entries with
  `file_search` active)**.

### The complete list of 48 tool names (verbatim, in schema order)

| # | Tool | Backing |
|---|---|---|
| 1 | `list_opportunities` | HTTP route |
| 2 | `get_opportunity` | HTTP route |
| 3 | `advance_stage` | HTTP route |
| 4 | `dismiss_opportunity` | HTTP route |
| 5 | `get_packet` | HTTP route |
| 6 | `list_packets` | HTTP route |
| 7 | `generate_artifact` | HTTP route |
| 8 | `create_document` | HTTP route |
| 9 | `create_slides` | HTTP route |
| 10 | `list_outreach` | HTTP route |
| 11 | `opportunity_outreach` | HTTP route |
| 12 | `generate_outreach` | HTTP route |
| 13 | `send_outreach` | HTTP route |
| 14 | `interview_prep` | HTTP route |
| 15 | `offer_analysis` | HTTP route |
| 16 | `get_usage` | HTTP route |
| 17 | `assets_analytics` | HTTP route |
| 18 | `config_status` | HTTP route (no owner) |
| 19 | `app_health` | HTTP route (no owner) |
| 20 | `app_selftest` | HTTP route (no owner) |
| 21 | `mail_config` | HTTP route (no owner) |
| 22 | `mail_subscriptions` | HTTP route (no owner) |
| 23 | `remember` | **local** — `coachMemory.remember` |
| 24 | `recall` | **local** — `coachMemory.recall` |
| 25 | `list_interviews` | HTTP route |
| 26 | `interview_debrief` | HTTP route |
| 27 | `seed_cadence` | HTTP route |
| 28 | `set_outreach_state` | HTTP route |
| 29 | `outreach_tick` | HTTP route |
| 30 | `mail_poll_now` | HTTP route (no owner) |
| 31 | `analyze_jd` | HTTP route |
| 32 | `enrich_opportunity` | HTTP route |
| 33 | `build_full_packet` | HTTP route |
| 34 | `answers_vision` | HTTP route |
| 35 | `generate_video` | HTTP route |
| 36 | `video_status` | HTTP route |
| 37 | `set_artifact_status` | HTTP route |
| 38 | `list_personas` | HTTP route |
| 39 | `list_ats_sources` | HTTP route |
| 40 | `add_ats_source` | HTTP route |
| 41 | `ats_preview` | HTTP route |
| 42 | `ats_ingest` | HTTP route |
| 43 | `match_score` | HTTP route |
| 44 | `apply_prepare` | HTTP route |
| 45 | `bulk_run` | HTTP route |
| 46 | `bulk_status` | HTTP route |
| 47 | `ui_action` | **local** — returns a directive the browser executes (`coachTools.ts:158-162`) |
| 48 | `tavily_web_search` | **local** — `tavilySearch()` (`coachTools.ts:143-149`) |

### DEFECT FOUND — one route is defined but unreachable

`archive_video` exists in the `ROUTES` map — `coachTools.ts:53`:
```ts
  archive_video:      { method: 'POST', ownerQuery: true, path: (a) => `app/artifact/${enc(a.artifactId)}/archive` },
```
…but there is **no `fn('archive_video', …)` schema**, so the model is never told it exists and can
never emit that call. Verified by set-difference of the 47 schema names against the 45 `ROUTES`
keys: the only ROUTES-minus-schemas entry is `archive_video`. **Dead code today.**
(Conversely, the 3 schemas with no ROUTES entry — `remember`, `recall`, `ui_action` — are correct:
`executeCoachTool` handles them before the `ROUTES` lookup at `coachTools.ts:150-162`.)

### Spec cross-check — tools the spec lists by area

The spec's per-area tool list was **not supplied to this audit**, so a name-by-name diff of
"spec lists X but X does not exist" is **NOT-VERIFIED**. What IS established here is the ground
truth to diff against: the 48 names above are exhaustive as of commit `a041d8f`. Any spec name not
in that table does not exist; anything in that table the spec omits is a gap. The one item most
likely to be wrong in either direction is `archive_video` — it reads as a real tool in the source
but is **not callable**.

### How tools execute (matters for any Huddle-side reuse)

`executeCoachTool` — `coachTools.ts:141-177` — does **not** call internal functions for the 44
route-backed tools. It makes a **fresh outbound HTTP request back to the same Function App**
(`coachTools.ts:166-170`):
```ts
    let url = `${SELF_BASE}/${route.path(args)}`
    if (route.ownerQuery) url += (url.includes('?') ? '&' : '?') + `owner=${encodeURIComponent(ctx.owner)}`
```
`SELF_BASE` — `coachTools.ts:13`:
```ts
const SELF_BASE = process.env.COACH_SELF_BASE || 'https://job-platform-api.azurewebsites.net/api'
```
**Critically: identity is threaded as a `?owner=` QUERY PARAM only. No Authorization header is
forwarded.** So every tool-side call re-enters the API as an *unverified* caller (see Claim 5 for
why that matters). Output is truncated to 12,000 chars (`coachTools.ts:173`).

---
