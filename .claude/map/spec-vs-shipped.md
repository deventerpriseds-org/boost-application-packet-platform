# Packet: spec vs shipped

Status: IN PROGRESS (written incrementally — whatever is here is the deliverable).
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

## 2. What is SHIPPED

(pending — next section)
