# Packet: spec vs shipped

Status: COMPLETE (sections 1-6). Source-only analysis; nothing checked against the live DB
— see §6 for the two claims a `db-query.yml` dispatch would settle.
Author: map agent, 2026-08-22.
Rule for this file: every claim carries a `file:line`. Claims from `.claude/memory.md`
are treated as CLAIMS TO CHECK, not as givens; where memory is wrong it is corrected
inline and marked **[memory correction]**.

---

## 0. Sources consulted (ground truth chain)

| Source | Role | Read? |
|---|---|---|
| `docs/design_handoff/README.md` | handoff index; declares the source-of-truth split | yes |
| `docs/design_handoff/proto-compass/packet.jsx` (525 lines) | **BEHAVIOURAL source of truth** for the packet | yes, in full |
| `docs/design_handoff/Executive Engine Spec.html` | product spec (data model §8, AI contract §10) | pending |
| `docs/design_handoff/compass-tokens/*` | VISUAL source of truth | not needed for this question |
| `docs/APP_ARCHITECTURE.md`, `docs/GAP_REGISTER.md` | as-built architecture + known gaps | pending |
| `.claude/DEFERRED.md` | live defect ledger | pending |
| `app/src/screens/PacketBuilder.jsx`, `app/src/screens/*`, `api/src/**` | shipped | pending |

`README.md:11` is the load-bearing sentence and it says exactly what memory claimed:

> "Treat the `.jsx` as the **behavioral source of truth** (state, routing, interactions)
> and the Compass token CSS as the **visual source of truth**."

`README.md:16` adds that `proto-compass/` (not `proto/`) is the build target.

---

## 1. The INTENDED packet (from spec only, not from shipped code)

Primary evidence: `docs/design_handoff/proto-compass/packet.jsx`.
Secondary: `docs/design_handoff/README.md:62-66` (screen 5) and `README.md:106-107`
(the "Approval rounds" hard-surface note).

### 1.1 What a packet IS

A packet is the per-opportunity **production line** that turns one job-alert email into a
sendable application. `packet.jsx:18`:

> "Each approved opportunity gets a tailored packet — keyword-optimized resume, portfolio,
> and intro video, built through approval rounds until it's ready to send."

One packet per opportunity, keyed by `oppId` (`packet.jsx:94` `getPacket(oppId)`).
A packet is auto-created in `building` on first open of the builder, **seeded from the
triggering email** — not from a blank slate (`packet.jsx:99-107`).

### 1.2 The step rail — 6 steps, ordered

`packet.jsx:78-85` (`PACKET_STEPS`), rendered `packet.jsx:144-162`:

| # | id | label | desc | is it a gated artifact? |
|---|---|---|---|---|
| 1 | `jd` | JD analysis | Extract keywords & ATS terms | **no** — status derives from `p.jdAnalyzed` |
| 2 | `resume` | Resume | Keyword-tailored from master | yes |
| 3 | `cover` | Cover letter | Tailored narrative | yes |
| 4 | `portfolio` | Portfolio | Assemble work samples | yes |
| 5 | `video` | Intro video | Script + record 60s | yes |
| 6 | `review` | Review & send | Approval rounds | **no** — status IS the packet status |

**[memory correction, minor]** memory's "JD → resume → cover → portfolio → video → review"
is correct as an ordering, but note only **4** of the 6 are artifacts. The gate counts to
4, not 6 (`packet.jsx:447-451`, `ReviewStep.arts` = resume/cover/portfolio/video;
`packet.jsx:39` renders `{done}/4`).

Rail rendering rule (`packet.jsx:145-147`): JD's ring shows `approved` iff `p.jdAnalyzed`;
`review`'s ring shows the **packet** status; every other step shows `p.artifacts[id] || 'todo'`.

### 1.3 State machines

**Artifact:** `todo → drafting → review → changes → approved`.
Colour map that enumerates the full set: `packet.jsx:120` and again `packet.jsx:452`.
**[memory correction]** memory is right about the *declared* set, but the prototype itself
only ever WRITES three of them: `drafting` (`packet.jsx:307`, on Regenerate), `review`
(`packet.jsx:312` Submit for review; `packet.jsx:433` video Record) and `approved`
(`packet.jsx:313`, `:396`, `:434`). **Nothing in the prototype ever sets an artifact to
`changes`** — a request-changes bumps the PACKET, not the artifacts (`packet.jsx:456`).
So `changes` is a declared-but-unreachable artifact state even in the source of truth.

**Packet:** `none → building → review → changes → approved → sent`.
Colour map enumerating the set: `packet.jsx:11`.
Writes observed: `none` (initial, `state.jsx` default), `building` (`packet.jsx:105`),
`changes` (`packet.jsx:456`), `approved` (`packet.jsx:462`), `sent` (`packet.jsx:138` and
`packet.jsx:484`). **[memory correction]** the packet-level `review` state is likewise
never written by the prototype — it exists in the status-colour map (`packet.jsx:11`) and
nowhere else. The real lived path is `none → building → (changes)* → approved → sent`.

### 1.4 The live ATS %

`packet.jsx:113`:
```js
const atsScore = Math.round(30 + (covered / kwBank.length) * 65);
```
So: a floor of 30, plus up to 65 points of keyword-bank coverage — max 95, min 30. It is
**not** a real ATS simulation; it is a monotone function of `p.coveredKw.length` against
the persona's keyword bank (`KEYWORDS[persona]`, `packet.jsx:111`).

Rendered in the header at `packet.jsx:134-135` with a 3-band colour (≥80 green, ≥60
yellow, else red), and again as a pill in the JD step (`packet.jsx:250`) and the resume
step (`packet.jsx:322`).

Intent per `README.md:64`: "ATS opens high (~84%), only gaps flagged red" — achieved by
the seeding rule at `packet.jsx:102-105`, which pre-covers every bank keyword EXCEPT the
last two must-haves, deliberately leaving headroom to optimise.

### 1.5 Per-artifact template picker with an explicit default

`packet.jsx:181-186` — `TEMPLATE_SETS`, keyed by ARTIFACT KEY, ordered arrays:
- `resume`: Infra Modernization / AI · Platform / Turnaround · Cost / Growth · Scale
- `cover`: High-fit direct / Stretch narrative / Referral intro / POV-led
- `portfolio`: Modernization pack / AI transformation pack / Cost & reliability pack
- `video`: 60s exec intro / 90s role pitch / Story-led open

`TemplateBar` (`packet.jsx:188-206`) renders them as pills; **the default is positional** —
`{i === 0 ? ' · default' : ''}` at `packet.jsx:201`, and the selected index defaults to 0
(`packet.jsx:190`). Selection is per-packet, per-artifact: `p.templates[keyName]` as an
INTEGER INDEX, written by `setTemplate` (`packet.jsx:116`).

Crucially, the picker is **not decorative in the spec** — the chosen template *changes the
generated content*: `buildText(tplIdx)` at `packet.jsx:292-294` selects a different summary
(`resumeSummaries[tIdx]`, `:280-285`) or a different opener (`coverOpeners[tIdx]`,
`:286-291`), and re-runs on template change (`packet.jsx:296`). Same for the portfolio
pack preset (`packet.jsx:356-371`) and the video script (`packet.jsx:406-412`).
The template name is also surfaced in the artifact header (`packet.jsx:305`) and embedded
in the generated resume text (`packet.jsx:293`, `[${TEMPLATE_SETS.resume[tIdx]} template]`).

TemplateBar appears in: resume + cover (`packet.jsx:302`), portfolio (`packet.jsx:377`),
video (`packet.jsx:419`). **Not** on the JD or Review steps. So: 4 pickers, one per artifact.

### 1.6 Keyword-coverage meter

Resume step ONLY (`packet.jsx:320` — `keyName === 'resume' && ...`), lines 320-336:
a pill cloud of every bank keyword (green ✓ when covered), a divider, a `covered/total`
count and a `Bar` (`packet.jsx:332`), plus a pointer back to the JD step to fix gaps.

The **toggling** lives in the JD step (`packet.jsx:222` `toggleKw`, rendered 254-263), with
`!` marking a still-missing must-have and an "⚡ Auto-optimize resume" button that covers
the whole bank in one click (`packet.jsx:223`, `:266`).

### 1.7 Version history

`packet.jsx:337-344`, in the right column of BOTH artifact steps (resume + cover).
Three rows, a `live` pill on the newest, a `restore` link on the others.

**[memory correction — important]** In the source of truth this is a MOCK. The three rows
are template strings derived from the round counter, not stored versions:
```js
[`v${p.round}.2 · current · keyword-optimized`, `v${p.round}.1 · +3 must-have terms`, 'v1.0 · from master baseline']
```
`packet.jsx:340`. The `restore` link (`packet.jsx:341`) has **no onClick** — it is inert
even in the prototype. So the SPEC INTENT is "an artifact has a retained version history
with restore"; the spec's own artefact does not demonstrate the mechanism. Any shipped
gap here is a gap against *intent*, and the intent is only stated at this fidelity
(README.md:65 lists "version history" as a required element of every artifact step).

The version label also leaks into the artifact header: `packet.jsx:305` renders
`'Resume v' + p.round + '.2'` — i.e. the displayed version number is a function of the
REVIEW ROUND, which is the strongest signal of the intended coupling: a new review round
is what produces a new artifact version.

### 1.8 Review rounds — the gate

`ReviewStep`, `packet.jsx:445-499`.

- Checklist of the 4 artifacts with status rings + an Open link each (`packet.jsx:471-478`).
- `allApproved = arts.every(a => p.artifacts[a.key] === 'approved')` (`packet.jsx:451`).
- **Request changes** (`packet.jsx:454-459`): requires a non-empty note (`:455`); sets packet
  `status:'changes'`, `round: prev.round + 1`, and **PREPENDS** `{round, from, note, kind}`
  to `feedback[]` (`:456`). **[memory correction]** memory says "appends"; the code prepends
  (newest-first). `README.md:107` also says "prepends" — memory is the outlier.
  Note the stored `round` is `prev.round` (the round the feedback was written *against*),
  while the counter advances — deliberate, and worth preserving in any port.
- **Approve packet** (`packet.jsx:460-464`): hard-gated on `allApproved` (`:461`), sets
  `status:'approved'` and prepends an `approved`-kind feedback entry.
- **Send**: two entry points, both gated on `status === 'approved'` —
  the header button (`packet.jsx:138`: sets `status:'sent'` AND `moveStage(oppId,'applied')`)
  and the in-panel "Send now →" (`packet.jsx:484`: sets `status:'sent'`, toasts
  "moved to Applied", routes to the opp — **but does not actually call `moveStage`**; a
  prototype inconsistency worth not copying).
- **Feedback thread** (`FeedbackThread`, `packet.jsx:501-522`): rendered in the review step
  (`:495`) AND in the right column of each artifact step (`:347`). It merges `p.feedback`
  with two hardcoded seed entries from an "AI reviewer" (`packet.jsx:502-505`) — so the
  intent includes **machine-authored feedback alongside human**, keyed by `kind`
  (`changes` / `approved` / `note`, coloured at `:507`).

### 1.9 The packet LIST screen (often forgotten)

`PacketListScreen`, `packet.jsx:5-75` — a second surface the spec requires:
- "Building now" grid of in-flight packets (`status !== 'none'`), each showing
  `{approved}/4` artifacts, a progress bar, `Round {p.round}`, and JD-analyzed state
  (`packet.jsx:26-43`).
- "Ready to start" table of candidate opportunities — stages
  `saved | enriched | applied | outreach | engaged` (`packet.jsx:8`) — with a
  Build packet / Open action (`packet.jsx:65`).

### 1.10 The intended data shape (implied by the prototype's packet object)

From every read/write in `packet.jsx`, one packet =
```
{ status, round, jdAnalyzed, coveredKw[], artifacts{resume,cover,portfolio,video}, templates{...}, feedback[] }
```
with `feedback[i] = { round, from, note, kind }` and `templates[key] = <index into TEMPLATE_SETS[key]>`.
Artifact CONTENT itself (`text` in `ArtifactStep`, `script` in `VideoStep`, `selected` in
`PortfolioStep`) is held in **local React state only** and is never written into the packet —
another place where the source of truth demonstrates the UI but not the persistence.

---

### 1.11 Corroboration from `Executive Engine Spec.html` (§5, §7.5, §8)

The prose spec agrees with the prototype and adds two things the `.jsx` does not state:

- **§5 "The application packet"** — "Each artifact has its own status (todo → drafting →
  review → changes → approved) **and a selected template**. The packet has a round
  counter, a JD-analyzed flag, a covered-keyword set, and a feedback thread. **It cannot
  ship until all four artifacts are approved.**"
- **§5 "Master profiles & templates"** — "Every asset type (resume, cover, portfolio,
  video, and each outreach channel, and application answers) has a **set of templates with
  an explicit default pre-selected for speed**." So the picker is a product-wide pattern,
  not a packet quirk.
- **§8 data model**, two rows:
  - `packet` → `oppId, status, round, jdAnalyzed, coveredKw[], templates{resume,cover,portfolio,video}, artifacts{…status}, feedback[]`
  - `artifact` → `type, status (todo→drafting→review→changes→approved), **template**, **version history**`
  So *version history is a first-class field of the artifact entity in the spec's own data
  model* — not merely a UI panel.
- **§4 (users)** — "A secondary user is a **partner/reviewer** (the plan includes one
  partner seat) who can review packets and leave feedback during approval rounds." The
  feedback thread is therefore multi-actor by design; `FeedbackThread`'s "AI reviewer"
  seed entries (`packet.jsx:502-505`) are the third actor.
- **§7.5** — restates the builder, ending "Review step gates sending on all-approved;
  'Request changes' spins a new round; **sending moves the opportunity to `applied`**."

---

## 2. What is SHIPPED

Primary files: `app/src/screens/PacketBuilder.jsx` (826 lines),
`app/src/screens/Packets.jsx`, `api/src/functions/tests/appPackets.ts` (1149 lines),
`api/src/functions/tests/schema.ts`, `api/src/functions/tests/packetTemplates.ts`.

### 2.1 The shipped data model (`schema.ts:82-110`)

```sql
create table if not exists packet (
  status   text not null default 'building' check (status in ('building','review','ready','sent')),  -- :85
  round    int not null default 1,                                                                   -- :86
  jd_analyzed boolean, covered_kw text[], ats_score int,
  feedback jsonb default '[]',                                                                       -- :90
  ...);
create table if not exists artifact (
  type   text check (type in ('resume','compact_resume','cover','portfolio','video')),               -- :101
  status text default 'todo' check (status in ('todo','drafting','review','changes','approved')),    -- :102-ish
  template_id text,                                                                                  -- :102
  doc_url text,
  version_history jsonb default '[]',                                                                -- :104
  ...);
```
Plus columns added by idempotent ALTERs at runtime: `artifact.content`, `artifact.drive_url`
(`appPackets.ts:55-56`), `packet.pkg_json` (`appPackets.ts:289`).

Note the packet status enum SHIPPED is `building | review | ready | sent` — the spec's
`approved` is renamed `ready`, and `none`/`changes` do not exist as packet statuses.
`recomputePacket` (`appPackets.ts:84-97`) derives it: `ready` iff every artifact is
`approved` AND no `artifact_gate.gate='fail'`; else `review` if any artifact left `todo`;
else `building`. **`sent` is in the CHECK constraint and is written by nothing** (grep for
`'sent'` across `api/src` returns only `outreach_message.state`, `schema.ts:85`, and
`schema.ts:119`).

### 2.2 Step rail — 7 steps, not 6

`PacketBuilder.jsx:31-44` (`STEPS`):

| # | key | label | vs spec |
|---|---|---|---|
| 1 | `jd` | **Posting analysis** | spec's "JD analysis", deliberately renamed (`:32-33` comment) |
| 2 | `resume` | Resume | + also renders `compact_resume` (`:504`) — a 5th artifact the spec has no step for |
| 3 | `cover` | Cover letter | matches |
| 4 | `portfolio` | Portfolio | matches |
| 5 | `video` | Intro video | matches |
| 6 | `qc` | **QC & evidence** | **NEW — not in the spec at all** |
| 7 | `send` | Review & send | spec's "review" |

Step 6 (QC) is the largest thing this product has built beyond the spec: `QcRail.jsx`,
`qcRail.js`, `checks.ts`, `evidence.ts`, `dimensions.ts`, `remediation.ts`,
`appChecks.ts` — the whole gate/evidence subsystem. It is an EXTENSION, correctly so; the
divergence table below treats it as such and does not score it as a gap.

Step completion (`PacketBuilder.jsx:68-77`): `jd` = `p.jdAnalyzed`; `qc` = `qc.done`;
`send` = `p.status === 'ready'`; artifact steps = all their types `approved`.

### 2.3 The bucket verdict per spec element

**BUILT**

| Spec element | Shipped at |
|---|---|
| Step rail, deep-linked | `PacketBuilder.jsx:31-44`, `:228-233` (step lives in the route `#/packet/:id/:step`), desktop rail `:792-814`, mobile scroller `:720-738` |
| Packet auto-created on first open | `appPackets.ts:67-76` — `loadPacket` inserts the packet then one `artifact` row per missing type |
| JD step pre-populated from the triggering email | `PacketBuilder.jsx:511-532` (Source/Role/Comp/Location/HM), fed by `api.getOpportunity` |
| Live "ATS %" in the header | `PacketBuilder.jsx:501` (`p.atsScore`), rendered by `MatchEstimateButton` `:782` / `:716`. **Renamed** "Match estimate" on purpose (`:780-781`: "nothing here came from an applicant tracking system, and the number is a model estimate, not keyword coverage") |
| Keyword-coverage surface | moved out of the resume step into `KeywordTallyOverlay` (`:693-700`), opened from the header; `PostingAnalysisCard` on the JD step `:578-582` |
| Artifact editable draft | `AssetBlocks` per merge field, `PacketBuilder.jsx:121-124` |
| Artifact status machine (all 5 states) | enum `appPackets.ts:51`; UI writes `approved`/`changes`/`review` at `:189`, `:194`, `:199`; server writes `review` on generate (`appPackets.ts:217`); `drafting` is the only unwritten state |
| Approve-all gates readiness | `appPackets.ts:86-94` — server-side, **stronger than spec** (also requires no failing gate) |
| Server-side approval gate | `appPackets.ts:240-244` — a direct API call cannot approve a blocked artifact |
| Packet list screen | `app/src/screens/Packets.jsx`, `api` `packetsList` `appPackets.ts:151-176` |
| Real document generation (spec §9) | `packetTemplates.ts` copy→`replaceAllText`→export; `appPackets.ts` `renderArtifact`; queued build `buildQueue.ts` |

**SCAFFOLDED** (column/prop/route exists; nothing writes it, or nothing reads it)

| Thing | Evidence |
|---|---|
| `packet.feedback jsonb` | declared `schema.ts:90`. **Zero writes and zero reads.** `grep -n feedback api/src/functions/tests/appPackets.ts` → no hits at all: it is not in `packetShape` (`:99-127`) and not in any `update packet` statement anywhere in `api/src`. |
| `artifact.template_id` | declared `schema.ts:102`; SELECTed `appPackets.ts:77`; projected to the client as `templateId` `appPackets.ts:125`. **Never written** — the only `insert into artifact` is `appPackets.ts:75`, `(packet_id, type)`, and no `update artifact set template_id` exists. **Never read by the client** — `grep -rni "templateid" app/src` matches only `api.js:290-291` (`templateFocusGet/Set`, a *pipeline-config* Drive-id, unrelated to `artifact.template_id`). So the column is NULL for every row in production and the API field it feeds is consumed by nothing. |
| `artifact.version_history jsonb` | declared `schema.ts:104`. Written **once**, `appPackets.ts:216-221`: `version_history = coalesce(version_history,'[]') \|\| jsonb_build_object('len', $2::int)` — it appends **only the character count** of each draft. **Never read** by anything (`grep -rn version_history` → schema + that one write). It cannot restore anything: prior `content` is destroyed by the same statement (`set content = $1`). |
| `packet.status = 'sent'` | in the CHECK (`schema.ts:85`) and given its own group with a green pill in the packet list (`Packets.jsx:13`). Nothing writes it, so that group is permanently empty. |
| `packet.round` **repurposed, not dead** | `schema.ts:86`; read `appPackets.ts:68` (ORDER BY) and `:101` (`round:` in `packetShape`). **[memory correction]** memory says nothing writes it — that was true and is not any more: `appRemediation.ts:488` runs `update packet set round = round + 1`. But `appRemediation.ts:484-488` says explicitly it "counts REMEDIATION RUNS - one per run", i.e. **it no longer means "review round"**. And no `app/src` file renders `p.round` (grep: zero hits). |

**ABSENT**

| Spec element | Confirmation |
|---|---|
| **Per-artifact template picker** | No `TemplateBar`, no `TEMPLATE_SETS`, no template control anywhere in `app/src/screens/PacketBuilder.jsx` (826 lines, zero occurrences of a template selector) or any other packet screen. |
| **Template choice changing generated content** | `ARTIFACT_BRIEF` (`appPackets.ts:178-184`) is a fixed per-TYPE brief; `artifactGenerate` (`:187-227`) builds one system+user prompt with no template parameter. |
| **Version history UI / restore** | No panel, no restore control, nothing renders `version_history`. |
| **Reviewer feedback thread** | No thread UI, no note field, no `from`/`kind`. The only "Request changes" (`PacketBuilder.jsx:194`, `OppDetail.jsx:608`) flips one artifact's status and captures **no note**. |
| **Review ROUNDS as a concept** | Nothing increments a review round; `requestChanges`-equivalent does not touch `packet.round`; no round is displayed anywhere in the app. |
| **The partner/reviewer seat** (spec §4) | No second-actor identity on any packet write; `requireWrite` resolves one owner. |
| **Send → `packet.status='sent'`** | Nothing writes it (§2.1). |
| **Send → opportunity stage `applied`** | The only `update opportunity set stage` in `api/src` is `appOpportunities.ts:160` (the generic PATCH). The send button — `PacketBuilder.jsx:784`, `:679` — is `onClick={() => go('/compose/'+id)}`: it **navigates to the outreach composer** and writes nothing. |
| **Packet-level `changes` status** | Not in the shipped enum (`schema.ts:85`). |
| **Portfolio "assemble from a sample library"** | The spec's checkbox grid of work samples (`packet.jsx:362-394`) has no shipped equivalent; portfolio is a generated Slides deck. |

---

## 3. Divergence table

`DEFERRED` column names the open ledger row that covers the gap, or **UNRECORDED**.

| # | Spec element | Shipped state | Evidence (file:line) | Covered by a `.claude/DEFERRED.md` row? |
|---|---|---|---|---|
| 1 | Per-artifact template picker with an explicit default | **ABSENT** — one hardcoded template id per artifact TYPE | `packetTemplates.ts:22-39` `TEMPLATE_META`; owner override only at the pipeline level, `packetTemplates.ts:46-72` `metaFor`/`OVERRIDE_KEY`; no UI in `PacketBuilder.jsx` | **UNRECORDED** |
| 2 | `artifact.template_id` carries the per-artifact choice | **SCAFFOLDED** — column + API projection, never written, never read | `schema.ts:102`; read `appPackets.ts:77`; projected `appPackets.ts:125`; only insert `appPackets.ts:75` sets `(packet_id, type)` | **UNRECORDED** |
| 3 | Version history per artifact, with restore | **SCAFFOLDED to the point of being misleading** — stores only draft LENGTH; every build overwrites `content` | write `appPackets.ts:216-221`; column `schema.ts:104`; no reader | **UNRECORDED** |
| 4 | Reviewer feedback thread (`packet.feedback[]`) | **SCAFFOLDED** — column exists, zero writes, zero reads | `schema.ts:90`; absent from `packetShape` `appPackets.ts:99-127` | **UNRECORDED** |
| 5 | Review ROUNDS — "request changes" bumps the round | **REPURPOSED** — `round` now counts remediation runs, and no UI shows it | `appRemediation.ts:484-488`; `appPackets.ts:61-66`; `PacketBuilder.jsx:194` captures no note | **PARTIAL — `D:remediation-never-ran`** covers whether remediation ever RUNS (`remediation_loop` = 0 rows in prod), which is what now increments `round`. It does **not** cover the loss of the review-round concept. |
| 6 | Send moves the opportunity to `applied` | **ABSENT** — the button navigates to the composer | `PacketBuilder.jsx:784` and `:679` (`go('/compose/'+id)`); only stage writer is `appOpportunities.ts:160` | **UNRECORDED** |
| 7 | Packet reaches `sent` | **ABSENT** — enum value + a list group with no writer | `schema.ts:85`; `Packets.jsx:13` | **UNRECORDED** |
| 8 | Packet status `approved` | **RENAMED** to `ready` (defensible; also strengthened by the gate) | `schema.ts:85`; `appPackets.ts:94` | n/a — deliberate |
| 9 | ATS % is keyword coverage (`30 + 65·covered/total`) | **CHANGED** — a model-produced estimate, relabelled "Match estimate" | spec `packet.jsx:113`; shipped `PacketBuilder.jsx:501`, `:780-782`; `covered_kw` meaning documented `appPackets.ts:103-115` | **`D14`** (open) — "covered_kw does not mean covered" |
| 10 | Keyword-coverage meter inside the resume step | **MOVED** to a header-opened overlay | `PacketBuilder.jsx:693-700`; comment `:234-235`, `:688-692` | n/a — deliberate (D4) |
| 11 | 4 gated artifacts | **5** (`compact_resume` added) | `schema.ts:101`; `PacketBuilder.jsx:47`, `:504` | n/a — deliberate extension |
| 12 | 6-step rail | **7** (`qc` inserted before send) | `PacketBuilder.jsx:39-43` | n/a — deliberate extension |
| 13 | Artifact `drafting` state | in the enum, never written | `appPackets.ts:51`; generate writes `'review'` `appPackets.ts:217` | **UNRECORDED** (cosmetic) |
| 14 | Partner/reviewer seat leaves feedback during rounds | **ABSENT** — single-owner writes only | spec §4; `requireWrite`/`resolveOwner` in `appSession.ts` | **UNRECORDED** |
| 15 | Portfolio assembled from a selectable work-sample library | **ABSENT** — generated deck instead | spec `packet.jsx:355-401`; shipped `packetTemplates.ts:31-34` | **UNRECORDED** |

---

## 4. The UNRECORDED gaps, ranked by cost to the owner

`.claude/DEFERRED.md` holds ~23 open rows and **every one of them is about the QC /
evidence / checks / remediation / build-queue / contrast lanes** — `D3`, `D11`, `D13`,
`D14`, `D20`, `D23b`, `D29`, `D31`, `D33`, `D34`, `D36`, `D:remediation-atomicity`,
`D:escalation-term-target`, `D:pass-ceiling-contradiction`, `D:remediation-never-ran`,
`D:facts-before-evidence-precedence`, `D:locate-truncates-requirements`,
`D:compound-requirements-unevidenceable`, `D:api-duplicate-keys`, `D:hslug-scan-one-file`,
`D:id-hygiene-duplicated`, `D:openai-transport-duplicated`, `D:swap-screen-reads-a-dead-pass`,
`D:reasoning-semantic-judge`.

**Not one row concerns the review loop, the template picker, versioning, feedback, or
sending.** That is exactly the predicted shape: the ledger grew by tripping over defects
inside the subsystem the last several phases were building, so the parts of the spec
nobody has walked into are invisible to it.

Ranked by what the absence costs the owner:

**1 — The review loop does not exist, and the packet cannot be SENT. (rows 4, 5, 6, 7, 14)**
This is the top of the list because it breaks the product's end-to-end claim. The spec's
loop is: request changes (with a note) → round++ → thread → approve all → send → opportunity
becomes `applied`. Shipped: an artifact flips to `changes` with **no note**
(`PacketBuilder.jsx:194`), so the reason for the rejection is not recorded anywhere; there
is no round; the packet can reach `ready` and then the "Send packet →" button just navigates
to the composer (`PacketBuilder.jsx:784`). Consequences the owner actually feels:
- the opportunity **never advances to `applied` from the packet**, so pipeline counts,
  funnel health and "days in stage" under-report every application actually sent;
- `Packets.jsx`'s "Sent" group is permanently empty — a screen region that can never populate;
- the partner/reviewer seat the plan sells (spec §4) has no mechanism at all;
- re-work is unattributable: nothing records what a reviewer asked for or which pass answered it.

**2 — Every build is DESTRUCTIVE; there is no way back to a previous draft. (row 3)**
`appPackets.ts:216-221` overwrites `artifact.content` and appends only `{"len": N}`.
`packet.pkg_json` is likewise overwritten in place (`appPackets.ts:419`, `:1071`;
`appRemediation.ts:266`). The owner presses "Rebuild from current draft" or "Build entire
packet" and the previous wording is gone — with a `version_history` column sitting there
that looks like it protects them. The one genuine partial exception is `insertion`, which is
keyed `unique (artifact_id, merge_field, loop)` (`schema.ts:506`) and retains `before_text` /
`after_text` per remediation loop — so **merge-field-level history exists for remediation
passes only**, and nothing for ordinary regenerates. This is the highest-risk *silent* gap:
the scaffolding actively implies a safety net that is not there.

**3 — The template picker is absent and `artifact.template_id` is inert. (rows 1, 2)**
Directly contradicts this repo's own standing rule ("No hardcoded config — everything
user-setting driven", `CLAUDE.md`). Today the resume, compact resume, cover and portfolio
each get exactly one Drive template (`packetTemplates.ts:13-39`), overridable only globally
per owner through pipeline config (`metaFor`, `:67-72`). The owner cannot say "use the
turnaround resume for this opportunity and the growth resume for that one" — which is the
single most load-bearing per-opportunity choice in the spec, because in the prototype the
template *selects the narrative* (`packet.jsx:280-296`). `D32` records the owner's ruling
that *"the resume chosen drives the persona"* — so the per-packet template choice also
decides the role focus of the generated text, which makes this a content-correctness gap,
not just a convenience one. And `artifact.template_id` already exists as the right place
to put it, so the fix is a wiring job, not a schema design.

**4 — `drafting` and the packet-level `changes` state are dead enum values. (row 13)**
Low cost on its own; listed because a status enum that contains states nothing can reach is
how a future gate accidentally treats "not yet reached" as "passed".

**5 — Portfolio work-sample selection. (row 15)**
The spec's portfolio step is a curated checkbox grid over a real asset library; shipped is
a generated one-pager. Genuinely a product decision, not obviously a defect — flagged so
someone makes it deliberately rather than discovering it in a demo.

---

## 5. The two direct questions

### Q1 — the template picker: built, scaffolded, or absent? Is `artifact.template_id` read?

**ABSENT as a picker; the column is SCAFFOLDED and read by nothing that matters.**

Observation:
- `TEMPLATE_META` (`packetTemplates.ts:22-39`) maps artifact TYPE → one Drive file id.
  `resume` and `compact_resume` deliberately share `RESUME_TEMPLATE_ID`.
- Per-OWNER (not per-packet, not per-artifact) overrides exist:
  `metaFor(type, ids)` at `packetTemplates.ts:67-72`, keyed by
  `OVERRIDE_KEY` (`:53-58`) → `google.resumeTemplateId` / `portfolioTemplateId` /
  `coverLetterTemplateId` in pipeline config.
- There is no per-artifact choice, no set of alternatives to choose from, and no UI
  control: `PacketBuilder.jsx` contains no template selector of any kind.
- `artifact.template_id`: SELECTed at `appPackets.ts:77`, projected as `templateId` at
  `appPackets.ts:125`, and that is the end of it. The only `insert into artifact`
  (`appPackets.ts:75`) does not set it; there is no `update artifact set template_id`
  anywhere in `api/src`; and no file under `app/src` reads `templateId` off an artifact.

Interpretation: the column is NULL on every row in production and the API field is dead
weight. Verdict — **absent (picker), scaffolded (column), unread (client)**.
Confidence: high for the source facts (they are exhaustive greps over both trees); the
"NULL in production" half is an inference from "no writer exists", not a DB observation —
`db-query.yml` with `select count(*) from artifact where template_id is not null` would
settle it in one dispatch.

### Q2 — does anything version an artifact's content?

**No. Every build is destructive.** Taking the three candidates named:

| Candidate | Retains a prior version? | Evidence |
|---|---|---|
| `artifact.content` | **No.** Three separate statements replace it in place, none of them copying the old value anywhere | `appPackets.ts:217` (generate), `:1064` (edit save), `:1131` (revise) |
| `artifact.version_history` | **No content** — appends `{"len": <int>}` only, and nothing ever reads it | `appPackets.ts:218`; `schema.ts:104` |
| `packet.pkg_json` | **No.** Overwritten wholesale on every build and every remediation pass | `appPackets.ts:419`, `appPackets.ts:1069-1071`, `appRemediation.ts:266` |
| `insertion` (the one partial exception) | **Yes, narrowly** — `unique (artifact_id, merge_field, loop)` keeps one row per merge field PER LOOP, each with `before_text` and `after_text` | `schema.ts:491-510` |

So the only history the system keeps is a per-merge-field before/after trail across
*remediation loops* — and `D:remediation-never-ran` records that `remediation_loop` has
**0 rows in production**, so in practice today there is no retained history of any kind.
An ordinary "Regenerate" or "Rebuild from current draft" is irreversible.

---

## 6. What I did NOT verify

- Nothing here was checked against the live database or the deployed Function. Every claim
  is from source on the local checkout. Two claims that a `db-query.yml` dispatch would
  settle and I did not run: `artifact.template_id is not null` count (Q1), and
  `packet.feedback <> '[]'` count.
- I did not read the whole of `appPackets.ts` (1149 lines) or `QcRail.jsx`; the greps for
  `template_id`, `feedback`, `version_history`, `'sent'` and `set stage` were repo-wide
  over `api/src` and `app/src`, which is what the absence claims rest on.
- Compass token / visual conformance was out of scope for this question.

