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
**Status:** COMPLETE. All 8 claims adjudicated; 15 load-bearing citations re-verified against source after writing.

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
## CLAIM 6 — VOICE (the spec's headline bug). Both paths verified.

### 6(a) `POST /api/app/voice/turn` — "bare STT → gpt-4o-mini → TTS, no tools/memory"

#### VERDICT: **CONFIRMED, exactly as described.**

Route — `api/src/functions/tests/appVoice.ts:85`:
```ts
app.http('voiceTurn', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/voice/turn', handler: voiceTurn })
```
Handler `voiceTurn` is `appVoice.ts:15-83`. It is three sequential `fetch` calls and nothing else:

1. **STT** — `appVoice.ts:36-39`: `form.append('model', 'whisper-1')` →
   `https://api.openai.com/v1/audio/transcriptions`.
2. **LLM** — `appVoice.ts:54-57`, **Chat Completions, `gpt-4o-mini`**:
   ```ts
   const llmRes = await fetch('https://api.openai.com/v1/chat/completions', {
     method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
     body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 160, temperature: 0.6 })
   ```
   Its entire system prompt is one line — `appVoice.ts:50`:
   ```ts
   { role: 'system', content: 'You are a warm, concise executive career coach on a live voice call. Reply in 1-3 short spoken sentences. No markdown, no lists.' },
   ```
3. **TTS** — `appVoice.ts:63-66`: ElevenLabs `eleven_turbo_v2_5`.

**No tools:** the word `tools` does not appear in the request body at `:56`; `coachToolSchemas` is
not imported by this file (`appVoice.ts:1-2` imports only `@azure/functions` and `runCoachTurn`).
**No memory:** no `recall`/`remember`/`coachMemory` reference anywhere in the file.
**No owner at all:** `voiceTurn` never calls `resolveOwner`, never reads `?owner=`, and writes
nothing to Postgres. Its only context is `body.history`, capped at the last 8 turns (`appVoice.ts:27`).
**No auth:** `authLevel: 'anonymous'` and no `requireWrite` guard.

So `/api/app/voice/turn` is a **completely separate, dumber brain** from the coach. CONFIRMED.

### 6(b) `POST /api/app/voice/chat` — "calls the same runCoachTurn" + hardcoded VOICE_OWNER

#### VERDICT: **CONFIRMED that it calls `runCoachTurn`. The owner constant is CONFIRMED to exist as described — with one correction: it is env-overridable, so "hardcoded" is imprecise. The *substance* of the bug is worse than the spec states.**

Route — `appVoice.ts:120`:
```ts
app.http('voiceChat', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/voice/chat', handler: voiceChat })
```

**It calls the same `runCoachTurn`.** Import at `appVoice.ts:2`:
```ts
import { runCoachTurn } from './coachAgent'
```
Call at **`appVoice.ts:104`**:
```ts
    const result = await runCoachTurn(history, VOICE_OWNER, key)
```
Same function as `coachChat` uses at `coachAgent.ts:202` — so the voice path gets the full
48-tool, 8-hop, memory-backed coach. CONFIRMED.

**THE CONSTANT — `appVoice.ts:87`, verbatim, with line number:**
```ts
const VOICE_OWNER = process.env.VOICE_DEFAULT_OWNER || 'voice@executive-engine.local'
```

**Correction to the spec's wording.** The literal string `'voice@executive-engine.local'` IS present
at `appVoice.ts:87` exactly as the spec says, but it is a **fallback default behind the
`VOICE_DEFAULT_OWNER` env var**, not an unconditional hardcode. A spec sentence reading
"there is a hardcoded `VOICE_OWNER = 'voice@executive-engine.local'`" should be rewritten to
"`VOICE_OWNER` is a **module-level constant** defaulting to `'voice@executive-engine.local'`,
overridable only by the `VOICE_DEFAULT_OWNER` app setting."

**Why that correction makes the bug WORSE, not milder — and this is the finding that matters:**

`VOICE_OWNER` is evaluated **once at module load** (`appVoice.ts:87`, top-level `const`) and passed
verbatim at `appVoice.ts:104`. `voiceChat` **never calls `resolveOwner`**, never reads a `?owner=`
query param, and never reads an `Authorization` header — grep of `appVoice.ts` finds zero
occurrences of `resolveOwner`, `requireWrite`, or `Bearer`. Therefore:

1. **Every voice caller is the same tenant.** Setting `VOICE_DEFAULT_OWNER` does not fix this; it
   only changes *which* single owner everyone becomes. There is **no per-request identity path in
   the voice/chat endpoint at all**. This is a *structural* single-tenancy, not a bad default value.
2. **The voice coach cannot see the real user's data.** `runCoachTurn` threads `owner` into
   `recall()` (`coachAgent.ts:116`), into every owner-scoped tool via `?owner=`
   (`coachTools.ts:167`), and into `coach_activity` / `coach_thread` / `remember`
   (`coachAgent.ts:177-184`). With `owner = 'voice@executive-engine.local'`, a voice turn reads and
   writes an **empty parallel tenant** — the real user's opportunities, packets, memory and thread
   are invisible to it, and anything the user tells it by voice is remembered against the phantom
   owner, never surfacing in the text coach.
3. **It is unauthenticated and can take real actions.** Unlike `coachChat`, which gates on
   `requireWrite(req)` (`coachAgent.ts:196`), `voiceChat` has **no guard whatsoever**. Combined with
   `authLevel: 'anonymous'`, anyone who can reach the URL can drive the full 48-tool coach —
   including `send_outreach` (real Graph email send, `coachTools.ts:33`), `bulk_run`, and
   `advance_stage` — as `voice@executive-engine.local`. The blast radius is limited only by that
   owner having no data. **OBSERVATION from source; no live probe was run** (sandbox egress blocks
   `azurewebsites.net`), so exploitability against the deployed app is NOT-VERIFIED.

**Who calls it:** ElevenLabs ConvAI as a Custom LLM. `appVoice.ts:132`:
```ts
  const customLlmUrl = 'https://job-platform-api.azurewebsites.net/api/app/voice/chat'
```
patched onto the agent by `convaiAgentPoint` (`appVoice.ts:125-150`, route `diag/convai-agent-point`,
`appVoice.ts:152`). **This explains the design and is the constraint any fix must respect:**
ElevenLabs posts a Chat-Completions body from its own servers and has no way to attach the end
user's session Bearer — which is *why* a constant owner was used. The fix therefore cannot simply
be "call `resolveOwner`"; the identity has to be carried some other way (ConvAI dynamic variables /
a per-conversation signed URL / a per-user custom-LLM URL). Any spec that proposes "just resolve
the owner from the request" on this endpoint is **proposing something the caller cannot satisfy**.

**Response shape** (`appVoice.ts:106-114`) hardcodes `model: 'gpt-4o'` in the echoed metadata at
`appVoice.ts:111` regardless of what `cfg.model` actually ran — cosmetic, but it will mislead
anyone reading voice logs to confirm the model.

---
## CLAIM 5 — Owner resolution

### VERDICT: **CONFIRMED** that `resolveOwner` / `appSession.ts` work as the spec describes — **but the coach chat endpoint does not use it the way the guard assumes.** See the defect at the end.

### `resolveOwner(req)` — `api/src/functions/tests/appSession.ts:46-64`

Returns `{ owner, verified }`. Three precedence tiers, first match wins:

**Tier 1 — verified session Bearer** (`appSession.ts:47-52`):
```ts
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (m) {
    const v = verifySession(m[1].trim(), Math.floor(Date.now() / 1000))
    if (v?.email) return { owner: v.email, verified: true }
  }
```
The token is a **home-rolled HMAC-SHA256 JWT**, not a Microsoft/Google token. Minted by
`signSession(email, provider, nowSec)` (`appSession.ts:22-28`), payload `{email, provider, iat, exp}`,
**TTL 12h** (`appSession.ts:13` `const TTL_SEC = 60 * 60 * 12`). Verified with `timingSafeEqual`
(`appSession.ts:37`) and an `exp` check (`appSession.ts:39`). Signing key (`appSession.ts:17`):
```ts
function secret(): string { return process.env.SESSION_SIGNING_SECRET || process.env.MICROSOFT_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || 'dev-only-insecure-secret' }
```

**Tier 2 — UAT bypass header** (`appSession.ts:56-62`), active only when `UAT_BYPASS_TOKEN` is set:
```ts
  const uat = req.headers.get('x-uat-token') || ''
  ...
    if (a.length === b.length && timingSafeEqual(a, b)) return { owner: req.query.get('owner') || process.env.UAT_USER || DEMO_EMAIL, verified: true }
```
Note this returns **`verified: true`** while taking the owner from `?owner=` — i.e. `X-UAT-Token`
grants full impersonation of any email. That is deliberate (comment `appSession.ts:53-55`).

**Tier 3 — unverified `?owner=` query param, else demo** (`appSession.ts:63`):
```ts
  return { owner: req.query.get('owner') || DEMO_EMAIL, verified: false }
```
`DEMO_EMAIL` = `'demo@executive-engine.local'` (`appSession.ts:12`).

### `requireWrite(req)` — `appSession.ts:72-76`

```ts
export function requireWrite(req: HttpRequest): HttpResponseInit | null {
  const { owner, verified } = resolveOwner(req)
  if (verified || owner === DEMO_EMAIL) return null
  return { status: 401, headers: HEADERS, jsonBody: { error: 'sign in required to modify this workspace', owner } }
}
```
**Rule: a mutation is allowed iff (verified session OR UAT header) OR the target is the demo
workspace.** Unverified reads against a real owner are allowed; unverified *writes* are 401.

### Which coach operations require what

| Route | Guard | Effect |
|---|---|---|
| `app/coach/chat` | `requireWrite` (`coachAgent.ts:196`) | write-gated |
| `app/coach/memory/add` | `requireWrite` (`:330`) | write-gated |
| `app/coach/memory/delete` | `requireWrite` (`:345`) | write-gated |
| `app/coach/memory/bootstrap` | `requireWrite` (`:213`) | write-gated |
| `app/coach/provision` | `requireWrite` (`:231`) | write-gated |
| `app/coach/upload` | `requireWrite` (`:256`) | write-gated |
| `app/coach/config` (POST) | `requireWrite` (`:307`) | write-gated |
| `app/coach/thread/clear` | `requireWrite` (`:378`) | write-gated |
| `app/coach/config` (GET) | **none** | anonymous read |
| `app/coach/memory/list` | **none** — `resolveOwner(req).owner` (`:220`) | unverified read of any owner |
| `app/coach/activity` | **none** — `resolveOwner(req).owner` (`:355`) | unverified read of any owner |
| `app/coach/thread` | **none** — `resolveOwner(req).owner` (`:366`) | unverified read of any owner |
| `app/coach/status` | **none** — `resolveOwner(req).owner` (`:289`) | unverified read of any owner |
| `app/voice/chat` | **NONE** | see Claim 6(b) |
| `app/voice/turn` | **NONE** | no owner concept at all |

Every route is `authLevel: 'anonymous'` (`coachAgent.ts:387-405`) — there is **no Azure Functions
function-key layer**; `requireWrite` is the entire write boundary.

### DEFECT FOUND — the `requireWrite` guard reads the QUERY param, the handler reads the BODY

`coachChat` — `api/src/functions/tests/coachAgent.ts:196-198`, verbatim:
```ts
    const guard = requireWrite(req); if (guard) return guard
    const body = await req.json() as any
    const _ro = resolveOwner(req); const owner = _ro.verified ? _ro.owner : (body?.owner || DEMO_EMAIL).toString()
```

`requireWrite` → `resolveOwner` reads **`req.query.get('owner')`** (`appSession.ts:63`).
Line 198's unverified branch reads **`body.owner`**. These are different inputs, so:

- Request with **no `Authorization` header**, **no `?owner=` in the URL**, and body
  `{"messages":[…], "owner":"<any real email>"}`
- → `resolveOwner` sees no query param → `owner = DEMO_EMAIL`, `verified = false`
- → `requireWrite` hits the `owner === DEMO_EMAIL` branch (`appSession.ts:74`) → **returns null, allowed**
- → line 198 then sets `owner = body.owner` = the real account
- → `runCoachTurn` runs the full 48-tool coach as that account.

`appSession.ts:68-70` states the guard's intent explicitly: *"this closes the `?owner=` spoof on
mutating routes."* For `coachChat` it does not, because the spoof value is taken from a place the
guard never inspects. Passing the same email in the **query** string would correctly 401; passing it
in the **body** does not.

**Same pattern at two more sites** — identical `_ro.verified ? _ro.owner : (body?.owner || DEMO_EMAIL)`
line at `coachAgent.ts:334` (`coachMemoryAdd`) and `coachAgent.ts:380` (`coachThreadClear`).

**Marked OBSERVATION → high-confidence INFERENCE from source. NOT-VERIFIED against the deployed
app** — no live request was made (sandbox egress blocks `azurewebsites.net`). To ground-truth it,
run `api-test.yml` with `path: /api/app/coach/chat`, no `?owner=`, body carrying `owner` +
`messages`, and check whether the reply reflects the real account's data.

---

## CLAIM 4 — System prompt: "the AI operator AND resident architect"

### VERDICT: **CONFIRMED verbatim.**

`api/src/functions/tests/coachAgent.ts:17` — first line of the `SYSTEM` constant:
```ts
const SYSTEM = `You are the Executive Engine Coach — the AI operator AND resident architect of an executive job-search platform ("Executive Engine"). You are not a generic assistant: you know this system's architecture intimately and you can both operate it and help extend it.
```
The `SYSTEM` template literal runs `coachAgent.ts:17-50` (34 lines) and covers: platform
description (`:20`), memory self-description (`:23`), role (`:26-28`), the 12-stage pipeline
playbook (`:30-37`), the never-auto-send rule (`:39`), data-location rules (`:41-44`), and
operating principles incl. the June-2023 cutoff / Tavily rule (`:46-50`).

### Where a persona/system prompt could be appended per-turn

The **only** place instructions are assembled — `coachAgent.ts:147`:
```ts
      instructions: dateHint.trim() + '\n\n' + cfg.systemPrompt + memHint,
```
Three concatenated parts, all computed **before** the hop loop:
- `dateHint` — `coachAgent.ts:112`, built from `DB_CUTOFF` + today's date. Not caller-controllable.
- `cfg.systemPrompt` — from `getCoachConfig()` (`coachAgent.ts:89-97`).
- `memHint` — `coachAgent.ts:114-118`, the top-5 `recall()` hits for the last user message.

A second, smaller instruction channel exists: a `role:'system'` message unshifted onto the input at
`coachAgent.ts:134-137` (present on hop 0 only — see the note under Claim 2).

### Is `cfg.systemPrompt` per-turn overridable TODAY?

### **NO. REFUTED.** It is a single global row, not a per-turn or even per-owner value.

`getCoachConfig()` — `coachAgent.ts:93`:
```ts
    const { rows } = await pool.query<{ system_prompt: string; model: string }>(`SELECT system_prompt, model FROM coach_config WHERE id=1`)
```
`coach_config` is declared with a **single-row primary key** — `coachAgent.ts:65`:
```ts
  await pool.query(`CREATE TABLE IF NOT EXISTS coach_config (id INT PRIMARY KEY DEFAULT 1, vector_store_id TEXT, updated_at TIMESTAMPTZ DEFAULT now())`)
```
`system_prompt` and `model` are added by `ALTER … ADD COLUMN IF NOT EXISTS` (`coachAgent.ts:66-67`).
There is **no `owner` column**. The write path `coachConfigSet` (`coachAgent.ts:304-324`) hardcodes
`id=1` in both branches (`:312`, `:317`) — so **every owner shares one prompt, and saving one
overwrites it for everybody**, including the voice path.

`runCoachTurn`'s signature — `coachAgent.ts:102-106` — takes exactly three params:
```ts
export async function runCoachTurn(
  history: Array<{ role: string; content: string }>,
  owner: string,
  key: string,
```
No prompt/persona parameter. `coachChat` passes nothing beyond those (`:202`), and never reads a
prompt field off the body.

### What would have to change to support a `personaOverlay` param

Minimum viable change set (each item is a real edit, not a suggestion of one):
1. `runCoachTurn` (`coachAgent.ts:102-106`) gains a 4th param, e.g.
   `opts?: { personaOverlay?: string }`.
2. `coachAgent.ts:147` becomes
   `instructions: dateHint.trim() + '\n\n' + cfg.systemPrompt + (overlay ? '\n\n' + overlay : '') + memHint`.
   Appending **after** `cfg.systemPrompt` and **before** `memHint` keeps the recalled-memory block
   last, matching the current ordering contract.
3. `coachChat` (`coachAgent.ts:197-202`) reads the overlay off the body and passes it through.
4. **Length + trust budget:** the overlay is caller-supplied text going straight into `instructions`.
   The turn is already logged to `coach_activity.instructions` truncated at 8,000 chars
   (`coachAgent.ts:181`) — an unbounded overlay silently truncates the audit record. A cap belongs
   in the same change.
5. `voiceChat` (`appVoice.ts:104`) would need the same pass-through or it stays on the bare default.

None of that exists today.

---

## CLAIM 8 — "Does any endpoint accept a per-turn system-prompt / persona override today?"

### VERDICT: **REFUTED — NOT-FOUND. No such parameter exists anywhere in the repo.**

`grep -rn "personaOverlay\|persona_overlay\|systemPromptOverride\|promptOverlay" api/src app/src`
→ **zero matches.** (The only `overlay` hits in the repo are CSS/z-index code in
`app/src/overlay.js` and `app/src/shell.jsx` — unrelated UI layering.)

The only writable prompt surface is `POST /api/app/coach/config { systemPrompt?, model?, reset? }`
(`coachAgent.ts:303-324`), which is **persistent and global** (`id=1`), not per-turn. Using it as a
per-turn overlay would mean writing the DB before each turn and racing every other caller —
including the voice path — so it is not a workaround.

**A `personaOverlay` param is genuinely new work, correctly scoped by the spec as a change rather
than a use of something existing.**

---

## CLAIM 7 — Memory: `remember` / `recall` tools and the coach tables

### VERDICT: **CONFIRMED for `coach_memory`, `coach_activity`, `coach_thread`. REFUTED for `coach_triples` — the table is created and never used.**

### Keyed by owner email — CONFIRMED

`coach_memory` DDL — `api/src/functions/tests/coachMemory.ts:37-46`:
```sql
CREATE TABLE IF NOT EXISTS coach_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner TEXT NOT NULL DEFAULT 'shared',
  kind TEXT NOT NULL DEFAULT 'note',           -- note | fact | conversation | file
  text TEXT NOT NULL,
  source TEXT,
  embedding vector(1536) NOT NULL,
```
The keying column is **`owner TEXT`**, holding the owner **email** — it is populated from the same
`owner` string `resolveOwner` produces. Indexed at `coachMemory.ts:47`
(`coach_memory_owner_idx ON coach_memory (owner)`), plus an HNSW cosine index at `:48-49`.

**Embedding:** `text-embedding-3-small`, 1536 dims — `coachMemory.ts:10-11`. Input truncated to
8,000 chars (`coachMemory.ts:86`).

**`remember`** — `coachMemory.ts:94-103`, INSERT at `:99-101`, `owner` = `$1` defaulting to
`'shared'` (`:101`). Tool wrapper `coachTools.ts:150-153` passes `ctx.owner`.

**`recall`** — `coachMemory.ts:108-121`. The scoping clause, `coachMemory.ts:116`:
```sql
     WHERE owner = $2 OR owner = 'shared'
```
Cosine ordering at `:117` (`ORDER BY embedding <=> $1::vector`), score `1 - (embedding <=> …)` at
`:114`, `k` clamped 1..20 (`:111`). **Note: rows with `owner='shared'` are visible to every owner** —
a deliberate shared tier, but it means memory is not strictly isolated. Same clause in `listMemory`
(`coachMemory.ts:129`).

**Auto-recall on every turn** — `coachAgent.ts:116` (`k: 5`), injected as `memHint` at `:117`.
**Auto-remember of every turn** — `coachAgent.ts:177`:
```ts
  try { if (reply) await remember({ owner, kind: 'conversation', text: `User: ${String(lastUser).slice(0, 500)}\nCoach: ${reply.slice(0, 500)}`, source: 'coach-chat' }) } catch {}
```

### `coach_activity` and `coach_thread` — CONFIRMED, owner-keyed

DDL is inline in `coachAgent.ts:70-76` (`ensureOpsTables`), **not** in `BOOTSTRAP_SQL`:
```ts
  await pool.query(`create table if not exists coach_activity (
    id uuid primary key default gen_random_uuid(), owner text not null, user_msg text, reply text,
    tools jsonb default '[]'::jsonb, instructions text, created_at timestamptz default now())`)
```
```ts
  await pool.query(`create table if not exists coach_thread (owner text primary key, messages jsonb default '[]'::jsonb, updated_at timestamptz default now())`)
```
- `coach_activity`: **`owner text not null`**, one row per turn, written at `coachAgent.ts:180-181`
  (stores `user_msg`, `reply`, the `tools` trace, and the full `instructions` truncated to 8,000).
  Read by `GET app/coach/activity` at `:358` (`where owner=$1 … limit 40`).
- `coach_thread`: **`owner text primary key`** — exactly one thread per owner, upserted at
  `coachAgent.ts:183-184`, holding the last 40 messages (`:182` `.slice(-40)`). Read at `:369`,
  deleted at `:382`.

**So all four names in the spec are keyed on the owner email**, and every one of them is written
with whatever string `runCoachTurn` was handed — which is why Claim 6(b) is data-destroying for
voice: it partitions memory, activity and thread under `voice@executive-engine.local`.

### DEFECT FOUND — `coach_triples` is dead, but the product tells users it is live

`coach_triples` is created (`coachMemory.ts:51-64`, with owner/subject/FTS indexes) and named in
`bootstrapMemory`'s verification SELECT (`coachMemory.ts:72`). **There is no INSERT, UPDATE or
SELECT against it anywhere in `api/src` or `app/src`** — the only other occurrences repo-wide are
two pieces of *user-facing copy*:

- The coach's own system prompt, `coachAgent.ts:23`: *"pgvector tables coach_memory (semantic,
  embedded) and **coach_triples (a knowledge graph)**"*
- The Settings screen, `app/src/screens/Settings.jsx:1042`: *"pgvector tables `coach_memory` +
  `coach_triples`"*

So the coach will describe a knowledge graph it does not populate, and Settings advertises it.
The table is an empty shell. (Verified by `grep -rn "coach_triples" api/src app/src` — 8 hits, all
either DDL, the bootstrap existence-check, or copy.)

### Minor — `deleteMemory` is not owner-scoped

`coachMemory.ts:134-137`:
```ts
export async function deleteMemory(id: string): Promise<{ deleted: number }> {
  const { rows } = await getPool().query<{ id: string }>(`DELETE FROM coach_memory WHERE id=$1 RETURNING id`, [id])
```
No `owner` predicate. `coachMemoryDelete` (`coachAgent.ts:345-348`) gates on `requireWrite` but then
passes only `body.id` — so any caller who satisfies `requireWrite` (including the unauthenticated
demo path) can delete **any owner's** memory row given its UUID. Guessing a v4 UUID is impractical,
but ids are returned by `GET app/coach/memory/list`, which has **no guard at all** (`coachAgent.ts:220`).

---
## ANSWER — what a Huddle-side caller must send to get an authenticated, owner-scoped turn

### The request

```
POST https://job-platform-api.azurewebsites.net/api/app/coach/chat
Content-Type: application/json
Authorization: Bearer <session-token>

{ "messages": [ { "role": "user", "content": "…" } ] }
```

Response: `{ reply, toolCalls, uiActions, usedMemory, usedVectorStore }` (`coachAgent.ts:204`).

### Concretely, on each header

- **`Authorization: Bearer <token>` — this is the ONLY thing that produces `verified: true`**
  (`appSession.ts:47-52`). With it, `coachAgent.ts:198` takes `_ro.owner` and **ignores `body.owner`
  entirely**, so the turn is genuinely owner-scoped: memory, activity, thread and all 44 owner-scoped
  tools run against that email.
- **No Azure function key is needed** — every route is `authLevel: 'anonymous'` (`coachAgent.ts:387`).
- **`?owner=` is NOT the way** for an authenticated call. It only ever yields `verified: false`
  (`appSession.ts:63`), which makes `requireWrite` 401 for any non-demo email (`appSession.ts:74-75`).
  Do not rely on the body-`owner` path described in the Claim 5 defect — it currently works, but it
  is a bug and any fix will break a caller depending on it.

### The token is NOT a Microsoft/Google token — it is boost's own HMAC JWT

Three ways to obtain one, in order of preference for a Huddle-side service:

**1. Mint it directly (server-to-server, no OAuth round-trip).** This is what `api-test.yml` does —
`.github/workflows/api-test.yml:55-65`:
```python
header  = b64url(json.dumps({'alg':'HS256','typ':'JWT'}, separators=(',',':')))
payload = b64url(json.dumps({'email': owner, 'provider':'api-test', 'iat': now, 'exp': now + 12*3600}, separators=(',',':')))
sig     = b64url(hmac.new(client_secret.encode(), f'{header}.{payload}'.encode(), hashlib.sha256).digest())
token   = f'{header}.{payload}.{sig}'
```
The shared secret is resolved server-side by `appSession.ts:17` as
`SESSION_SIGNING_SECRET || MICROSOFT_CLIENT_SECRET || AZURE_CLIENT_SECRET`. Huddle already holds
`AZURE_CLIENT_SECRET` as an org secret, so **Huddle can mint a valid boost session token for any
owner email with no user interaction.** Payload must be exactly `{email, provider, iat, exp}` —
`verifySession` requires `payload.email` and a numeric `exp` in the future (`appSession.ts:39`).
Max useful lifetime 12h by convention (`appSession.ts:13`), though `exp` is caller-chosen when
minting directly.
**Caveat, and it is load-bearing:** the signing key defaults to the *Graph app secret*. Rotating
`AZURE_CLIENT_SECRET` silently invalidates every outstanding session token, and any service that can
mint these can impersonate **any** boost user. Setting a dedicated `SESSION_SIGNING_SECRET` before
wiring Huddle in is the safer path.

**2. Exchange a Microsoft Graph access token** — `POST /api/auth/session { msAccessToken }`
(`appSession.ts:89-105`, route registered `appSession.ts:107`). Verifies the token against
`https://graph.microsoft.com/v1.0/me` (`:95`) and returns `{ token, email, displayName, expiresInSec }`.

**3. Exchange a Google auth code** — `POST /api/auth/google/token { code, redirectUri }`
(`api/src/functions/tests/appAuthGoogle.ts:11`, `signSession(...,'google',...)` at `:42`, registered
at `:53`).

**4. (Testing only) `X-UAT-Token: <UAT_BYPASS_TOKEN>` + `?owner=<email>`** — `appSession.ts:56-62`.
Returns `verified: true` for an arbitrary owner. Only active when `UAT_BYPASS_TOKEN` is set on the
Function App. Not appropriate for a production Huddle integration.

### Two things that will bite a Huddle integration

1. **`messages` is required and capped at 16** (`coachAgent.ts:199-200`). Send the last 16 turns;
   anything earlier is dropped. Server-side continuity comes from `coach_thread` (last 40,
   `coachAgent.ts:182`) which is **read by `GET /api/app/coach/thread` but never fed back into
   `runCoachTurn`** — the caller owns history.
2. **Latency.** A turn can be up to 9 sequential OpenAI Responses calls (`coachAgent.ts:144`), each
   fanning out to N tool calls that are themselves **sequential outbound HTTPS round-trips** back to
   the Function App (`coachTools.ts:164-170`, `await` inside a `for`). Plus a `recall()` embedding
   call (`coachAgent.ts:116`) and possibly a vector-store GET (`:126`) before the loop starts. There
   is **no timeout, no retry, no streaming** anywhere in `runCoachTurn`. Any Huddle-side call needs a
   generous timeout and should not sit on a user-facing synchronous path.

---

## SPEC ERRORS FOUND

Each row: what the spec asserts, what the code says, and the evidence.

### 1. "~50 tools" — imprecise; the number is **48**
`coachTools.ts:81-138` contains exactly **47** `fn(...)` schemas, plus `TAVILY_WEB_SEARCH_TOOL`
(`coachTools.ts:136`) = **48**. A 49th array entry, `file_search`, is appended **only** when a vector
store exists with ≥1 completed file (`coachAgent.ts:130`) and is a built-in type, not a function.
Use "48 function tools" — a spec that drives a build should not round a countable literal.

### 2. "model gpt-4o" — stated as fact; it is a **fallback default** with two overrides above it
`coachAgent.ts:14` (`process.env.COACH_MODEL || 'gpt-4o'`) is not what is sent. The request sends
`cfg.model` (`coachAgent.ts:146`), sourced from the `coach_config` DB row (`coachAgent.ts:93-95`).
Precedence: `coach_config.model` → `COACH_MODEL` env → `'gpt-4o'`. **The live production value is
NOT-VERIFIED** — nothing in this audit read `coach_config`. Any spec claim about which model runs
today is unverifiable from source alone; it needs a `GET /api/app/coach/config` or a DB read.

### 3. "hardcoded VOICE_OWNER = 'voice@executive-engine.local'" — the string is real, "hardcoded" is wrong, and the real defect is understated
`appVoice.ts:87` is `process.env.VOICE_DEFAULT_OWNER || 'voice@executive-engine.local'` — an
env-overridable default. Rewrite the wording. **More importantly, the spec frames this as a wrong
constant; it is actually a missing capability.** `voiceChat` has **no identity path at all** — no
`resolveOwner`, no `?owner=`, no header read (`appVoice.ts:93-118`). Setting the env var only changes
*which one* owner everybody becomes. A spec that says "fix the hardcoded owner" will produce a fix
that does not work, because the caller (ElevenLabs ConvAI, `appVoice.ts:132`) has nowhere to put the
user's identity. The real work is choosing a transport for per-conversation identity.

### 4. The spec's proposed `personaOverlay` param — correctly identified as new, but the blocker is bigger than a missing param
`personaOverlay` does not exist (grep: zero matches). Beyond adding the param, note that
**`cfg.systemPrompt` is a single global row** — `coach_config` has PK `id INT PRIMARY KEY DEFAULT 1`
(`coachAgent.ts:65`), no `owner` column, and both write branches hardcode `id=1`
(`coachAgent.ts:312`, `:317`). So there is no per-owner prompt today either. If the spec assumes
personas layer onto a per-user base prompt, that assumption is **REFUTED** — the base is global and
shared with the voice path.

### 5. UNREPORTED DEFECT — `requireWrite` is bypassable on `/api/app/coach/chat` via `body.owner`
The guard inspects `req.query.get('owner')` (`appSession.ts:63`); the handler then takes
`body?.owner` (`coachAgent.ts:198`). A request with no Bearer, no `?owner=`, and `owner` in the JSON
body passes the demo branch (`appSession.ts:74`) and then runs the full coach as any account.
Same line at `coachAgent.ts:334` and `:380`. The guard's own comment (`appSession.ts:68-70`) claims
it "closes the `?owner=` spoof on mutating routes" — for these three routes it does not.
INFERENCE from source; **NOT-VERIFIED live.**

### 6. UNREPORTED DEFECT — `/api/app/voice/chat` is completely unguarded
Unlike `coachChat` (`requireWrite` at `coachAgent.ts:196`), `voiceChat` has **no guard**
(`appVoice.ts:93-118`) and is `authLevel: 'anonymous'` (`appVoice.ts:120`). Anyone reaching the URL
drives all 48 tools, including `send_outreach` — real Graph email (`coachTools.ts:33`) — and
`bulk_run`. Blast radius is currently bounded only by `voice@executive-engine.local` owning no data,
which means **fixing the owner bug without adding a guard converts a harmless misconfiguration into
an open door on a real account.** Sequence the two changes accordingly.

### 7. UNREPORTED DEFECT — `coach_triples` is advertised to users but never written
Created at `coachMemory.ts:51-64`; **zero INSERT/SELECT anywhere**. Yet the coach's own system prompt
tells the user its memory lives in "coach_memory … and coach_triples (a knowledge graph)"
(`coachAgent.ts:23`) and Settings repeats it (`app/src/screens/Settings.jsx:1042`). Any spec section
describing a knowledge-graph memory tier is describing an empty table.

### 8. UNREPORTED DEFECT — `archive_video` is a tool that cannot be called
Present in `ROUTES` (`coachTools.ts:53`) with no matching `fn(...)` schema, so it is never advertised
to the model. Reading the source, it looks like a 49th tool; it is dead. If the spec's tool list
includes it, that entry is wrong.

### 9. UNREPORTED DEFECT — `deleteMemory` has no owner predicate
`coachMemory.ts:135`: `DELETE FROM coach_memory WHERE id=$1` — no owner check. Reachable via
`POST app/coach/memory/delete` (`coachAgent.ts:345-348`), and row ids are handed out by
`GET app/coach/memory/list`, which has **no guard at all** (`coachAgent.ts:218-223`).

### 10. Wording — `/api/app/voice/turn` and `/api/app/voice/chat` are unrelated systems
Both CONFIRMED as described individually, but they share only a URL prefix: `voiceTurn` is
STT→`gpt-4o-mini` Chat Completions→ElevenLabs TTS with no owner, tools or memory
(`appVoice.ts:15-83`), while `voiceChat` is a Chat-Completions-shaped façade over the full coach
(`appVoice.ts:104`). A spec sentence like "the voice path" is ambiguous and should always name which.

### Items that are CONFIRMED and need no change
- `POST /api/app/coach/chat` exists, route string `app/coach/chat`, handler `coachChat`, calls
  `runCoachTurn` (`coachAgent.ts:387`, `:191`, `:202`).
- OpenAI **Responses** API (`coachAgent.ts:12`).
- **8** tool-call hops, literal `const maxHops = 8` (`coachAgent.ts:141`).
- System prompt opens "the AI operator AND resident architect" (`coachAgent.ts:17`).
- Bearer-vs-`?owner=` model, verified reads/writes split (`appSession.ts:46-76`).
- `voice/chat` calls the same `runCoachTurn` (`appVoice.ts:104`).
- `remember`/`recall` over pgvector `coach_memory`, owner-email keyed (`coachMemory.ts:37-121`).
- `coach_activity` / `coach_thread` owner-keyed (`coachAgent.ts:70-76`).

---

## NOT-VERIFIED — the limits of this audit

Everything above is read from source at commit `a041d8f`. **No code was executed and no live request
was made** — the sandbox egress blocks `azurewebsites.net` and the Postgres connectors were not
authorized this session. Specifically un-grounded:

1. **The live `coach_config` row** — whether a custom `system_prompt`/`model` is set in production.
   Settle with `GET /api/app/coach/config` via `api-test.yml`, or a `db-query.yml` read of
   `select system_prompt is not null, model from coach_config where id=1`.
2. **The `body.owner` bypass (spec error 5)** — reasoned from source, not exercised. Settle with
   `api-test.yml`: `path: /api/app/coach/chat` (no `?owner=`), `API_OMIT_AUTH: true`, body carrying
   `owner` + `messages`; a reply grounded in that owner's real pipeline proves it.
3. **Whether `/api/app/voice/chat` is reachable unauthenticated in production** — the route is
   anonymous in source; no probe was run.
4. **The spec's own per-area tool list** was not provided to this audit, so "the spec lists X which
   does not exist" could not be enumerated. The 48-name table under Claim 3 is the ground truth to
   diff against.
5. **`VOICE_DEFAULT_OWNER`** — whether it is set on the Function App is unknown; check
   `/api/config-status` or the app settings.

**Status: COMPLETE.**
