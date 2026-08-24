# Component + state inventory — prototype resume/asset step vs the app

**Branch:** `claude/resume-prototype-pass` · **Written:** 2026-08-24 · analysis only, nothing under
`app/src` or `api/src` was touched.

## What this is, and what it replaces

`UI-GAP-REGISTER.md` diffs **rendered text**. That instrument reports `SafetyIQ · Head of
Engineering`, `Kubernetes`, `sixty-two engineers` and `SOC 2 Type II` as "missing panels" — those
are the prototype's demo *values*, not components. Nobody wants the app to say `Kubernetes`.

This document diffs **components**: for each thing the prototype's resume/asset step renders, what
shape of value it holds, every state it can be in, the colour each state paints, the interactions
it supports, what it does when its value is absent, and whether the app has it.

**Sources read (both sides).**

| Side | Files |
|---|---|
| Prototype | `docs/qc-evidence/qc/assets.jsx` (487 L), `packet.jsx` (573 L), `evidence.jsx` (447 L), `assist.jsx` (123 L), `shell.jsx` (131 L), `data.js` (650 L) |
| App — render | `app/src/screens/AssetBlocks.jsx` (822 L), `PacketBuilder.jsx` (943 L), `QcRail.jsx` (847 L), `PostingAnalysis.jsx` (621 L) |
| App — logic | `app/src/assetBlocks.js` (597 L), `assetGate.js` (609 L), `qcRail.js` (862 L), `postingAnalysis.js` (542 L), `highlight.js`, `theme.css` |

**Status vocabulary.** `BUILT` = component and all its states exist (renaming is not a gap).
`PARTIAL` = component exists, named states/colours/transitions missing. `ABSENT` = no component.
`BLOCKED` = cannot be built, no data source — the missing table/endpoint is named.

---

## 1. `Marked` — in-draft keyword & posting-echo highlighter

**Prototype:** `qc/assets.jsx:8-22`, CSS `Packet QC Prototype.html:21-25`.
**Holds:** the field's draft string, plus `terms: string[]` (ATS term ids) and `echoes:
{phrase,kind,fix}[]`. Splits the text on a regex built from the labels and wraps each hit in a
`<mark>`. Longest-label-first sort so `SOC 2 Type II` wins over `SOC 2`.

| State | Trigger | Paint |
|---|---|---|
| keyword idle | term present in text | `background:#fff03a`, `box-shadow: inset 0 -2px 0 #d4c400` |
| keyword on | `active === hit.id` (margin chip hovered) **or** `:hover` | `background:#d4a017`, `inset 0 -2px 0 #8a6410` |
| echo idle | mirror phrase present | `background:transparent`, `inset 0 -1px 0 #c9b27a` (rule only) |
| echo on | `activeEcho` matches **or** `:hover` | `background:#fbf2da`, `inset 0 -2px 0 #a1852f` |
| no terms at all | `terms` and `echoes` both empty | returns the bare string — **no wrapper, no styling** |

**Transitions:** `transition: background 120ms, box-shadow 120ms` on both marks. The linked-hover is
bidirectional: hovering a `KeyChip` in the margin sets `active` and lights the mark in the text;
hovering an `EchoTrail` row sets `activeEcho` and lights that phrase.

**App status: `ABSENT` for the asset step.** The two highlight treatments exist and are correct —
`app/src/highlight.js` defines `HIGHLIGHT_CLASS.keyword` (`.qc-kw`) and `.postingEcho` (`.qc-echo`)
with the same handoff literals (`#fff03a`, `#fbf2da`, `#c9b27a`) plus dark-mode pairs
(`theme.css:87-88, 182-183, 249-250`) — but **nothing marks up the draft text on the asset step.**
Searched: `grep -rn "HIGHLIGHT_CLASS" app/src/` returns 6 sites — `AssetBlocks.jsx:198`
(`Verbatim`, the posting quote in the margin), `AssetGateDrawer.jsx:174,237` (drawer quotes) and
`PostingAnalysis.jsx:311` (the JD step's keyword list). `BlockBody` (`AssetBlocks.jsx:374-394`)
renders `{row.after_text}` as a plain string in all four shapes. There is no `active` /
`activeEcho` state anywhere in `AssetBlocks.jsx`.
**Empty/unknown:** prototype degrades to plain text, which is the correct designed behaviour and is
also what the app does — the difference is that the app never leaves that state.

---

## 2. `Rule` — the field's contract, coloured by whether the field meets it

**Prototype:** `qc/assets.jsx:24-30`. **Holds:** `{ rule: string, observed: string|null, state:
'pass'|'warn'|'fail'|null }`. Renders `"<observed> · <rule>"`, or the rule alone when nothing is
observed; falls back to computing a word count from the text if the rule string contains "word".

| State | Colour |
|---|---|
| pass / unstated | `var(--proto-ink3)` |
| warn | `var(--proto-yellow)` |
| fail | `var(--proto-red)` |
| no rule at all | returns `null` — the slot collapses |

**App status: `PARTIAL`.** The two halves exist and are now unit-matched, which was the register's
biggest real finding and is fixed: `observedFor()` (`assetBlocks.js:568-597`) mirrors `targetFor()`
(`:516-549`) branch for branch, so a skills list reads `longest 22 chars` beside `≤ 24 chars each`
rather than a word count beside a character limit. Both are rendered at `AssetBlocks.jsx:448-459`.
`ResumeSummary` now has a band — `resumeSummaryWords: [55, 60]` (`api/.../checks.ts:66,152,490`,
`assetBlocks.js:508`) — closing the triage's item 1.
**Missing: the STATE COLOUR.** `AssetBlocks.jsx:449` and `:458` both render `className="px-small"`
with no state-derived colour, so a field that is 70 words against a 55–60 band looks exactly like
one that is 57. The per-field pass/warn/fail verdict exists (`checkResult` rows, `severityFor()`),
it is simply not joined to this line. `--proto-yellow` / `--proto-red` are defined
(`theme.css:66-68`) and unused here.
**Empty/unknown:** correct on both sides. `targetFor()` returns `null` rather than guessing a
threshold, and the app hides the target span rather than printing a fabricated one.

---

## 3. `KeyChip` — one ATS keyword placed in this field

**Prototype:** `qc/assets.jsx:34-49`. **Holds:** a term id resolving to
`{ term, match: 'exact'|'variant'|'loose'|null, postingSays, note }`.

| State | Trigger | Paint |
|---|---|---|
| exact / variant, idle | `match !== 'loose'` | bg `var(--proto-accent-soft)`, fg `var(--text-brand)`, no ring |
| loose, idle | `match === 'loose'` | bg `transparent`, fg `var(--proto-ink3)`, ring `inset 0 0 0 1px var(--proto-rule-soft)` |
| on (hovered **or** its detail panel open) | `active === id \|\| open === id` | bg `--proto-accent-soft`, fg `--text-brand`, ring `inset 0 0 0 1.5px var(--surface-brand-default)` — a loose chip loses its quiet treatment while on |
| reworded marker | `match === 'variant'` | a `≈` prefix glyph at `fontSize 9, opacity .75` |
| unresolvable id | `termById(id)` misses | returns `null` |

**Interactions:** `onMouseEnter` → sets `active`, which highlights the same term inside the draft
via `Marked`. `onClick` → toggles `KeyDetail` open/closed beneath the chip row. `title` carries
`"Exact term / Reworded / Loose — not scored · click for options"`.

**App status: `BLOCKED`.** No keyword chips render on the asset step at all. `AssetBlocks.jsx:795`
passes `terms={null}` into `DistributionMeter` as a literal, and `meterModel`
(`assetBlocks.js:396-403`) therefore takes the else branch and emits `UNKNOWN_TERMS_NOTE` — *"No
published, scoreable library terms exist yet, so how many of them this asset places is unknown -
not measured, not zero."* The data source named in `assetBlocks.js:360-364`: `term_library_entry`
has **zero published scoreable rows** (db-query run 32327554276), which is the same reason
`appChecks.ts` leaves `keyword_coverage` null, **and there is no per-asset term-placement
endpoint**. Both would have to exist: rows in `term_library_entry`, plus something like
`GET /app/artifact/{id}/terms` returning `{term, match, postingSays, note}` per placed term.
**Note the app renders the honest unknown rather than a fabricated 0 — that is the right empty
state and should survive whatever fills the gap.** The chip's *rendering* is cheap once the rows
exist; `.px-chip` and `--proto-accent-soft` are already there.

---

## 4. `KeyDetail` — the panel a keyword chip opens

**Prototype:** `qc/assets.jsx:53-88`. **Holds:** the term, its match word, `postingSays`, `note`,
and the `SKILL_ROWS` swap that inserted it (`{orig, list}`), plus `SKILL_BANK` for the swap picker.

**States:** open (only ever one at a time — `openKey` is a single value, not a set) / closed;
swap-picker **empty** (`pick === ''` → the Swap button is `disabled`) / **chosen** (enabled);
**came-from-a-swap** (renders the extra `Put back "<orig>"` button and the "Took the place of…"
sentence) / **native** (neither renders).
**Colours:** panel `var(--proto-panel)` inside `.px-box`; `postingSays` italic in `.px-small`;
`note` in `var(--proto-ink2)`. No severity colour — this is a chooser, not a finding.
**Interactions:** ✕ closes. Three escape hatches, all of which compose an assistant instruction
rather than mutating anything directly: *Put back "<orig>"*, *Swap* (for a `SKILL_BANK` pick), and
*Drop it, leave the line open*.
**Empty/unknown:** unresolvable id → `null`; no `note` → that line is omitted, not blanked.

**App status: `BLOCKED`** — same root as §3. Note that the app already has the *escape-hatch
pattern* this panel is made of: `CorrectionRow`'s `Change it` (`QcRail.jsx:539-541`) and the field's
`List Tweaks` box both compose an instruction and post it to `api.aiEditArtifact(id, {instruction,
section})`. So when term rows exist, this is an extension of an existing edit path, not a new one.

---

## 5. `EchoTrail` — figures half: "Changes made"

**Prototype:** `qc/assets.jsx:92-121`. **Holds:** the `mirrors` where `kind === 'figure'`, each
`{ phrase, fix, posting, why }` — a number lifted from the ad, already replaced in the draft text.

| State | Trigger | Paint |
|---|---|---|
| corrected (default) | `!reverted[m.phrase]` | status word `Corrected` in `var(--proto-green)`; body `<s>phrase</s> → <b>fix</b>`, the struck half in `var(--proto-ink3)` |
| undone | `reverted[m.phrase]` | status word `"Undone · the ad's figure is back"` in `var(--proto-red)`; link flips to `Redo correction` |
| linked-hover on | `activeEcho` equals the currently-live string (`fix` when corrected, `phrase` when undone) | row background `var(--proto-yellow-soft)` |
| off | otherwise | row background `transparent` |

**Interactions:** `onMouseEnter` sets `activeEcho` → lights that phrase inside the draft. `Undo` /
`Redo correction` toggles local `reverted` state **and the draft text above re-renders** — the
`fix()` reducer at `assets.jsx:361-362` re-applies or withdraws every non-reverted replacement, so
the correction and the sentence can never disagree. `Suggest something different` seeds the
assistant.
**Empty/unknown:** `if (!mirrors || !mirrors.length) return null` — the whole margin section
vanishes when nothing was corrected, which is correct here (a heading over nothing is noise).

**App status: `BUILT`.** Rendered in the field margin at `AssetBlocks.jsx:576-585` under the label
`Corrected for you`, using the *same* `CorrectionRow` component the QC step uses
(`QcRail.jsx:476-568`), passed `inField` so it drops the field-name tag and the `Review →` button
the reader does not need when already inside the field. States present: **corrected / undone**
(`data-qc-state`, left border `toneColor('accent')` vs `toneColor('panel')`, `row.sentence`
prefixed `Corrected:` / `Undone:` — guarded by R1); **undo busy** (`Undoing...`, all controls
`disabled` while `busy`); **undo refused** (`px-note` carrying the server's own reason —
a state the prototype does not have and should keep); **undo unavailable** (`undoAvailability()`
renders the reason in place of the button); **ask open/closed** with its own busy (`Sending...`)
and disabled-on-empty Send. The undo is a real server round-trip (`api.revertCorrection`), not
local state.
**Two deliberate divergences, both defensible:** the app has no linked-hover highlight (needs §1
first), and the state word is carried by the sentence prefix in primary ink rather than by a
coloured pill — measured reason at `QcRail.jsx:512-527`, eight of the nine pill tones fall below
4.5:1 in at least one theme.
**Empty/unknown:** app hides the block on `corrections.length === 0`, same as the prototype; and
`correctedCount` is `null` (not 0) for a payload that was never measured, so the meter prints
nothing rather than "0 corrected" (`assetBlocks.js:410-418`). That is stricter than the prototype.

---

## 6. `EchoTrail` — phrases half: "Wording kept from the posting"

**Prototype:** `qc/assets.jsx:122-144`. **Holds:** the `mirrors` where `kind !== 'figure'` — a
phrase the draft kept from the ad that only the writer can judge. `{ phrase, posting, why }`.

| State | Trigger | Paint |
|---|---|---|
| kept (default) | `kept[i] !== 'reworded'` | status word `kept` in `var(--proto-ink2)`; phrase in normal weight |
| rewording | after pressing `Reword it` | status word `rewording` in `var(--proto-yellow)`; phrase gets `text-decoration: line-through` |
| linked-hover on | `activeEcho === m.phrase` | row background `var(--proto-yellow-soft)` |

**Interactions:** hover → lights the phrase in the draft. `Reword it` / `Undo` flips the local state
word. `Ask assistant` seeds a reword instruction.
**Empty:** the section is omitted when there are no phrase mirrors.

**App status: `PARTIAL`.** Built at `AssetBlocks.jsx:601-630`, labelled through
`checkLabel('posting_wording_kept')` → *"Wording kept from the posting"* (`assetGate.js:161`), fed
from `offendersByField(result, 'posting_wording_kept')` grouped in `useArtifactCorrections`
(`:110-115`). The `kept` status word is present in `var(--proto-ink2)`, and the check's own
`expected` string is printed underneath so "why is this listed?" is answered where it is asked.
The reword control is present as `Tweak this`, which seeds the field's own ask box
(`seedAskReword`, `:408-411`) — an equivalent under a different name, and a better-wired one than
the prototype's, since it reaches the real `ai-edit` route.
**Missing: the `rewording` state.** No `line-through`, no `--proto-yellow` status word, no toggle.
The code says why (`:598-600`): in the prototype the toggle flips local state and nothing else, and
**there is no store behind an "I chose to reword this" decision** — shipping it would be a control
that forgets, which the "no dead UI" rule forbids. That is the right call, so this row's real
status is *PARTIAL by deliberate deferral*: to close it you need a persisted decision (a
`wording_decision` row keyed by artifact + phrase, or an extra column on the check result), not a
`useState`.
**Also missing:** the linked-hover background (`--proto-yellow-soft` on the row) — blocked on §1
like every other linked-hover.
**Empty/unknown:** correct — `wording.length > 0` gates the block, and this is the case the brief
warns about: **the block is BUILT and renders nothing when the sample packet has no kept phrases.**
That is not ABSENT.

---
## 7. `ReqChip` — one posting line this field answers

**Prototype:** `qc/assets.jsx:151-164`. **Holds:** a requirement id resolving to
`{ id, kind, competency, verbatim, coverage }`.

| State | Trigger | Paint |
|---|---|---|
| covered | `coverage === 'covered'`, `quiet` off | bg `var(--proto-green-soft)`, fg `var(--proto-green)` |
| open | `coverage !== 'covered'` | bg `var(--proto-red-soft)`, fg `var(--proto-red)` |
| quiet | `quiet` prop (used in the JD list, where the dot already carries coverage) | bg `var(--proto-panel-deep)`, fg `var(--proto-ink)`, competency in `--proto-ink` |
| short | `short` prop | the competency word is dropped, id only |
| clickable / inert | `onPick` present or not | `cursor: pointer` vs `default` |
| unresolvable id | `reqById` misses | returns `null` |

**Interactions:** click → `onPick(id)`, which opens the coverage view for that requirement. `title`
carries `"<Must-have|Nice-to-have|Responsibility> · <verbatim>"`.
**Empty:** null on an unknown id — nothing is rendered for a chip it cannot name.

**App status: `BUILT` (renamed, and the rename is the better name).** `AssetBlocks.jsx:150-161`,
labelled through the shared `reqChipLabel(kind, seq)` (`postingAnalysis.js:214-221`). The
abbreviations are `RQ-MH` / `RQ-NTH` / `RESP` rather than `M` / `N` / `D` — **that is the owner's
rename and it is an equivalent, not a gap.** It also fixes a real defect the prototype has: `D` for
"responsibility" is unguessable, and the app's own comment (`AssetBlocks.jsx:163-173`) records that
readers guessed `R` meant "required".
**States present:** clickable-vs-inert is not applicable (the app's chips are inert by design — the
posting line is quoted directly underneath by `Verbatim`, so there is nothing to navigate to);
`title` carries kind + item text; a chip with no `seq` degrades to the bare abbreviation rather
than inventing `#0` (`:216-221`, guarded). One **PARTIAL**: there is no covered/open colour split —
every chip paints `var(--proto-accent-soft)` / `var(--text-brand)`. In the app's model that is
arguably correct (a chip in a field's margin *is* a line this field answers, so "open" cannot
occur), but if uncovered requirements ever chip here the two states need distinguishing.
**Empty:** `if (!req) return null` — same as the prototype.

---

## 8. `ReqLegend` — what the chip abbreviations mean

**Prototype:** `qc/assets.jsx:166-178`. Renders three fixed rows, `M1–M5` / `D1–D4` / `N1–N3`, each
a mono badge on `var(--proto-panel-deep)` beside its expansion, in `var(--proto-ink2)`. One state.
Rendered **once per asset**, at the bottom of `AssetDocView` (`:482`).

**App status: `BUILT`, and better.** `AssetBlocks.jsx:175-186`. The app's version filters to the
kinds actually present on that field (`present.has(l.kind)`), so it stays a legend rather than a
glossary of things the reader cannot see, and it renders **directly under the chips it explains**
(`:642`) rather than once at the bottom of the asset. Built from `KIND_LEGEND`, which is derived
from the same two maps the chips read — so a kind can never be chipped and un-legended.
**Empty:** `rows.length < 1` → `null`.

---

## 9. `AssetHeader` — collapsed row ("What this resume answers")

**Prototype:** `qc/assets.jsx:213-225`. **Holds:** the asset's coverage rollup plus the counts of
each `attentionFor(type)` severity bucket.

| Token | Condition | Paint |
|---|---|---|
| title `What this <label> answers` | always | 13px/700 |
| `N/N must-haves · N/N keywords` | always | `.px-small` |
| `N corrected` | `done.length > 0` | 700 in `var(--proto-green)` |
| `N to fix` | `fails.length > 0` | 700 in `var(--proto-red)` |
| `N to review` | `items.length > 0` | 700 in `SEV_COLOR[sev]` — `--proto-yellow` for warn, `--proto-red` for open |
| `N your call` | `calls.length > 0` | `.px-small`, no colour |
| `Show ▾` | collapsed | `.px-link` |

**States:** closed (default, `useState(false)`) / open. The whole closed row is the click target
(`cursor: pointer`). A zero bucket is **omitted, not printed as 0**.

**App status: `BUILT`.** `DistributionMeter` at `AssetBlocks.jsx:256-319`, default closed via the
named constant `ASSET_ANSWERS_DEFAULT_OPEN = false` (`assetBlocks.js:470`) so one test can assert it
beside the card body's opposite default. Every token is present with the prototype's own colour:
`meterCorrected` green (`:279-284`), `meterToFix` red (`:289-294`), `meterToReview` yellow
(`:295-300`), `meterYourCall` uncoloured (`:301-305`), plus the summary stats on the closed row
(`:270-274`) and `Show`/`Hide`. The three severity buckets come from `severityCounts()`
(`assetGate.js:117-125`), which is built on the *same* `severityFor` split the QC rail uses, so the
header and the rail can never disagree about how many findings block the asset.
**Improved over the prototype:** it is a real disclosure — `role="button"`, `tabIndex`,
`aria-expanded`, Enter/Space handler.
**Empty/unknown:** the strongest part. `correctedCount` is `null` for a payload that was never
measured and the token is hidden; a measured `0` is also hidden (`meterModel:411-418`, "0
disagreements" is a measurement reported that was never taken). Zero buckets are omitted. If
`stats`, `notes` and `corrected` are all empty the whole meter returns `null` (`:259`).

---

## 10. `AssetHeader` — expanded: the four `Cell` stats

**Prototype:** `qc/assets.jsx:203-212, 229-247`. Four fixed cells — **Must-haves**,
**Responsibilities**, **Nice-to-haves**, **ATS keywords** — each `{ n, d, sub }`.

| State | Paint |
|---|---|
| complete (`n === d`) | the number in `var(--proto-green)` |
| incomplete | the number in `var(--proto-yellow)` |
| the "of D" denominator | always `var(--proto-ink3)`, 12px |

Above them, a sentence that switches: all must-haves covered → *"Every must-have requirement is
answered somewhere in this asset."*; otherwise → *"<competency list> is not answered here — check
the other assets."* Then always: *"N of M blocks were written for this posting; the rest is template
text you cannot change from the zap."*

**App status: `PARTIAL` — the component is built, the stat SET differs, and the difference is
deliberate.** `Stat` at `AssetBlocks.jsx:214-228` renders label / `n of d` / a `.px-bar` progress
bar / a sub-line, green at `n === d` and `--text-brand` otherwise. It has a **bar the prototype does
not**, and it is fed from `meterModel` (`assetBlocks.js:372-419`), which emits up to four stats:
`Posting lines placed`, `Changes the posting drove`, `Fields generated`, `Library terms placed`.
So three of the prototype's four cells have no counterpart — must-have / responsibility /
nice-to-have are not split out, they are rolled into one `Posting lines placed` stat. The module's
header states the reason: the prototype's cells are computed against fabricated demo data, and
replacing a measured stat with the prototype's prettier one would be inventing a number.
`Library terms placed` is the §3 `BLOCKED` case.
**To close the split honestly** you need per-kind denominators on `GET
/app/opportunity/{id}/requirements` (it returns `total`, not `{must_have, nice_to_have,
responsibility}` counts) — a small extension of an existing endpoint, not a new one.
**Empty/unknown:** the app's best behaviour in the whole step. `totalReqs` null-or-zero → the stat
is replaced by `UNKNOWN_REQS_NOTE` ("…is unknown - not zero"); no term rows → `UNKNOWN_TERMS_NOTE`.
A stat never renders as `0 of 0`. `statPct` never divides by zero.

---

## 11. `AssetHeader` — expanded: the attention list (fail / open / warn / soft)

**Prototype:** `qc/assets.jsx:248-261`. **Holds:** the asset's `ATTENTION` rows, concatenated in
severity order `fails → items(warn+open) → calls(soft)`. Each row `{ sev, title, detail, sec, req }`.

| Severity | Label (`SEV_LABEL`) | Row background (`SEV_SOFT`) | Label colour (`SEV_COLOR`) |
|---|---|---|---|
| `fail` | Fix before approval | `var(--proto-red-soft)` | `var(--proto-red)` |
| `open` | Needs your answer | `var(--proto-red-soft)` | `var(--proto-red)` |
| `warn` | Review | `var(--proto-yellow-soft)` | `var(--proto-yellow)` |
| `fixed` | Corrected for you | `var(--proto-green-soft)` | `var(--proto-green)` |
| `soft` | Your call | `var(--proto-panel)` | `var(--proto-ink3)` |

**Interactions:** the whole row is clickable when it carries a `sec` (→ `onFocus(sec)`, scrolls and
rings the field) or a `req` (→ `onPick`); a row with neither is `cursor: default`. A row with `sec`
also shows `Go to field →`.
**Empty:** the block is omitted when all three buckets are empty; if the gate passes and nothing is
open, `assets.jsx:277` prints *"Nothing to review on this asset."* in `--proto-green`.

**App status: `PARTIAL`.** The **vocabulary and tone map are built and are read from the prototype**
— `SEV_LABEL` at `assetGate.js:89-94` carries the four words verbatim and a guard reads them out of
`qc/data.js` so they cannot drift; `SEV_TONE` (`:95`) maps `fix→red`, `review→yellow`, `soft→panel`,
`fixed→green`. `severityMeta()` returns the pair for one row.
**What is missing on the asset step is the LIST ITSELF.** The expanded meter renders `stats` and
`notes` only (`AssetBlocks.jsx:309-316`) — there is no per-asset findings list in the header, and in
the field margin only **two** of the five severities render: corrections (`fixed`, §5) and
`posting_wording_kept` (`warn`, §6). A `fail`, an unmapped `warn`, or a reviewer `soft` on this
asset appears **only** on the QC step (`QcRail.jsx`) and in `AssetGateDrawer`, not beside the
sentence it names. The counts are on the collapsed row (§9) with nothing to expand into.
**One state is ABSENT by design and correctly so:** `open` / "Needs your answer" — `assetGate.js:78-87`
records that in the prototype it comes from `OPEN_ITEMS`, a separate list of questions each carrying
its own `ask`, and the app has no such source; minting it from a state we do have would be inventing
a bucket. That is a `BLOCKED` sub-row: it needs an open-question store, not a label.
**Empty:** no app equivalent of *"Nothing to review on this asset."* — with zero findings the
expanded meter shows stats and nothing else, so "checked and clear" and "not checked" look alike at
this level. (The gate word does distinguish them, but only in the drawer.)

---

## 12. `AssetHeader` — expanded: "Already corrected in this asset"

**Prototype:** `qc/assets.jsx:262-276`. A separate green list — `SEV_LABEL.fixed` on
`var(--proto-green-soft)`, label `Corrected` in `var(--proto-green)`, each row ending in a
`Review →` button that focuses the field. One state; omitted when `done.length === 0`.

**App status: `BUILT`, relocated deliberately.** The same rows render in the **field margin**
(§5) rather than in a rollup at the top, and the rollup lives on the QC step under
`CHANGE_LOG_HEADLINE = 'Done for you'` (`assetGate.js:396`, rendered `QcRail.jsx:622`). The
comment at `AssetBlocks.jsx:80-99` states this is the design's own two-surface arrangement — same
rows, two places, one definition (`railChangeLog`), and `result.corrections` is deliberately never
read in a `.jsx` so two definitions of "how many corrections there are" cannot arise. The
prototype's `Review →` is correctly dropped in the in-field rendering (`inField`), since the reader
is already there.
**Empty:** hidden at zero on both surfaces, and `null` vs `0` are kept apart (§9).

---
## 13. `FieldList` — a `type: 'list'` merge field (Skills 1/2, Expertise, Relevant 1–3)

**Prototype:** `qc/assets.jsx:282-298`. **Holds:** `items: { orig, final, action, req, term, why
}[]`. Three-column grid `orig | arrow | final`.

| State | Trigger | Paint |
|---|---|---|
| changed (`swapped` / `added`) | `action !== 'kept'` | middle column shows `→`; `final` at weight 600 |
| unchanged | `action === 'kept'` | middle column **empty**; right column reads the literal word `unchanged` in `.px-small` |
| linked-hover on | `active === it.term` | row background `#fff8b0` (a literal — the only hard-coded colour in the file) |
| off | otherwise | `transparent` |
| last row | `i === items.length - 1` | no `borderBottom` |

**Interactions:** hover a row → sets `active` → lights that term inside every other field's draft.
**Empty:** the component itself has no empty branch — `items` is always non-empty in the fixture.

**App status: `BUILT`, with a different and better-sourced status column.** `ListBody` at
`AssetBlocks.jsx:323-372`, model in `listBodyModel` (`assetBlocks.js:324-351`).
- **changed**: `line.from` renders as `<from> → ` in `var(--proto-ink3)` with the new text at
  weight 600 — same shape as the prototype's three columns, collapsed into one flow.
- **unchanged**: `status` is the literal `unchanged` when `swap.action === 'kept'`.
- **no swap row at all**: `status` is `''` — a line the pipeline did not record a decision for.
  The prototype has no such state; the app needs it because the swap table is real.
- **swapped/added with a driver**: `` `${action} · ${driver}` `` — e.g. `swapped · posting`. This is
  provenance the prototype does not carry.
- **packet-level marker**: a second line `packet-level` in `var(--proto-ink3)` with a `title`
  explaining it, because `swap_decision` is keyed by PACKET and the same row renders on every asset
  that renders this list (`sharedSourceNote`, `:296-311`). Without it two cards read as two changes.
- **dropped**: a whole extra section, `Taken out of this list`, struck through with its rationale
  (`:360-369`) — the prototype has no `dropped` state.
- **count disagreement**: `CountMismatch` (`:205-212`) renders a `--proto-yellow`-bordered note when
  the row's `item_count` and the browser's split disagree, stating that the row's number is the one
  the checks ran against. Not in the prototype; it is the right call.

**Missing:** the linked-hover (`#fff8b0`) — same §1 dependency.
**Empty/unknown:** a list field with no items renders zero lines and the surrounding card still
renders its heading, measurement and margin, so the field does not vanish. `deriveItems` falls back
to the split when no count was recorded, and says so.

---

## 14. `PickList` — a `type: 'select'` field (choose from stored items)

**Prototype:** `qc/assets.jsx:300-330`. **Holds:** `items: { text, selected, req, blocked }[]`.
Used by the portfolio (`P4` Core accomplishments, `P6` deck skills), **not by the resume** — but it
is part of the asset step's component set and the resume would need it the moment a merge field is
"chosen, not written".

| State | Trigger | Paint |
|---|---|---|
| selected | `sel[i]` | checkbox filled `var(--surface-brand-default)` with a white `✓`; row `opacity: 1` |
| unselected | `!sel[i]` | checkbox `transparent` with `inset 0 0 0 1px var(--border-input)`; row `opacity: .55` |
| blocked | `it.blocked` (e.g. `'omission list'`) | text `line-through`; right column reads `omit`, `title` carries the reason |
| mapped | `it.req` | a `<ReqChip short>` in the right column |
| unmapped | no `req`, not blocked | an em-dash with `title="No matching line in this posting"` |
| searchable | `items.length > 10` | a `Find…` input appears and the body caps at `maxHeight: 260` with `overflow: auto` |
| short list | `≤ 10` | no search box, no scroll cap |

**Footer:** `N of M on the page` plus a `Send to assistant` button carrying the current selection.
**Empty:** filtering to nothing renders an empty body with the counter still showing — no designed
"no matches" state, which is a gap in the prototype itself.

**App status: `ABSENT`.** `shapeOf()` (`assetBlocks.js:135-149`) returns only `static` / `pipe` /
`list` / `prose` — there is no `select` shape, and `BlockBody` (`AssetBlocks.jsx:374-394`) has no
branch for one. Searched `app/src/` for a checkbox-list field renderer: none. A chosen-not-written
field currently renders as `prose` or `list`, so the reader cannot see what was *not* chosen, and
the `blocked` state (an item the owner's omission list rules out) has nowhere to render even though
the check exists (`omission_list`, `assetGate.js:158`).
**To build it** you need per-item candidacy on the insertions payload — which items were available
and which were selected — not just the joined `after_text`. The swap table is the closest existing
shape (`skill_candidate` + `swap_decision`); this is a candidate list for a non-skill field.

---

## 15. `AskBox` — "Ask for a change", scoped to one field

**Prototype:** `qc/assets.jsx:334-350`. **Holds:** free text plus the slot name.

| State | Trigger | Paint / behaviour |
|---|---|---|
| closed | default | only the `Ask for a change` link renders |
| open, empty | `!t.trim()` | Send is `disabled` |
| open, typed | text present | Send enabled, `.px-btn-accent` |
| sent | after Send | the box is **replaced** by *"Sent to the assistant for <slot>. Changes appear field by field before saving."* in `var(--proto-green)` at weight 700 |

Panel `var(--proto-panel)` inside `.px-box`; `autoFocus` on the textarea; footnote *"Scoped to this
field only."*; Cancel closes without sending.

**App status: `BUILT` (renamed `List Tweaks`, and it is the more honest name).**
`AssetBlocks.jsx:516-554`. The rename is the owner's: the control does not ask anyone for anything —
it posts the instruction plus the field's current text to `api.aiEditArtifact(artifactId, {
instruction, section: row.merge_field })` and writes the revised text back
(`appPackets.ts:1299`). The old name also collided with `Request changes` on the artifact card.
**States present:** closed / open (`aria-expanded`, the link flips to `Cancel`); **disabled** while
`askBusy || !ask.trim()`; **busy** (`Sending...`); **error** (`askError` in a `px-note` carrying the
server's message — a state the prototype has no equivalent of); on success the box closes and
`onCorrectionsChanged()` re-reads the change log.
**Divergence:** no "sent" confirmation panel — the app closes the box and refreshes instead, which
is stronger (it shows the actual result rather than promising one), but it means a slow round trip
shows nothing between `Sending...` and the redraw.
**Extra, correctly:** a warning the prototype lacks — *"This rewrites `<field>` only. Anything
auto-corrected in it can no longer be undone."*
**Also seeded from elsewhere:** `seedAskReword(phrase)` (`:408-411`) opens this same box pre-filled,
which is how §6's `Tweak this` works. One edit path, two entry points.
**Gated:** hidden entirely for a static field or when `artifactId` is missing (`:516`) — no dead
control on a block the pipeline cannot write.

**Related, and the one genuinely open control:** the prototype ALSO has a **per-asset**
`Ask for a change` on the artifact card (`packet.jsx:257`), seeding `In the resume: `. The app's
card (`PacketBuilder.jsx:200-240`) has `Approve` / `Regenerate` / `Reopen` but no asset-level ask.
Status `ABSENT`; it is a thin extension of `api.aiEditArtifact` with no `section`.

---

## 16. `AssetBlock` — the card itself

**Prototype:** `qc/assets.jsx:352-470`. The container that holds §2, §13/§14, §15 and the whole
margin (§3–§8).

| State | Trigger | Paint |
|---|---|---|
| dynamic | `s.dynamic` | background `var(--proto-paper)` |
| static | `!s.dynamic` | background `var(--proto-panel)`, and the body text drops to `var(--proto-ink2)` |
| focused | `focus === s.id` (deep link from an attention row) | `box-shadow: inset 0 0 0 2px var(--surface-brand-default)`, **`transition: box-shadow 200ms`**, auto-scrolled into view, ring clears after `2200ms` |
| wide | container ≥ 1080px | two columns `minmax(0,1fr) 250px`, margin separated by a `borderLeft` |
| narrow | below | one column, margin separated by a `borderTop` and `paddingTop: 10` |
| original shown | `before` toggled | a `--surface-info-subtle` panel with `inset 0 0 0 1px var(--blue-200)`, heading in `var(--text-info)` |
| original identical | `s.sameAsBefore` | the heading reads `ORIGINAL · identical, template text is not merged per packet` instead of `· before this posting` |
| letter kind | `kind === 'letter'` | body 13px / line-height 1.75 instead of 12.5 / 1.65 |
| pipe type | `s.type === 'pipe'` | mono, 11.5px, line-height 1.9, `word-break: break-word` |

**App status: `PARTIAL`.** `AssetBlocks.jsx:396-679`. Present: **static vs dynamic** — and the app
goes further, using `.px-dashed` (a dashed border) *and* `--proto-panel` for a static block plus
`data-qc-static`, so an unfilled merge field is visibly not a draft; **wide vs narrow** via
`useWideRef(700)`, a `ResizeObserver` on the card itself rather than the window (`:133-146`) —
correct, since the column width is what decides; **original shown/hidden** with `aria-expanded`
and `Show original` / `Hide original` (the design's wording; the app's older `Compare with original`
was renamed to match); **pipe** shape mono-rendered.
**Missing states:**
- **the focus ring and its 200ms transition.** No deep-link target on the asset step. `grep -rn
  "scrollIntoView" app/src/` finds `AssetGateDrawer.jsx:140` and `PacketBuilder.jsx:671` — the
  drawer's `BlocksTab` (`:136-175`) *does* implement it (`box-shadow: inset 0 0 0 2px
  var(--border-brand)`, `scrollIntoView({block:'center'})`, plus an honest *"the finding you opened
  names X, but this asset has no recorded block for that field"* state). So the behaviour is built
  — on a **second, simpler rendering of the same insertion rows**, not on this card. A finding on
  the QC rail lands in the drawer, never beside the sentence in the asset step.
- **`sameAsBefore`** — no equivalent. The app always heads the panel `Original - before this
  posting`, so a block whose "original" is byte-identical (every static template field) makes a
  false claim about having changed.
- **`kind === 'letter'`** typography — one size for every asset type.
**Empty/unknown:** the app is stronger. A static block gets a card with an explicit sentence —
*"No value reached this merge field, so the document keeps whatever the template already says here.
The pipeline cannot see that text, so it is not shown as a draft."* (`:375-382`) — rather than
vanishing. The whole panel has three empty states: no rows + no fallback (`:750-756`, distinguishing
*"provenance could not be read (error)"* from *"nothing generated yet"*), no rows + fallback
(`:758-769`, renders the stored draft and says why), and loading.

---

## 17. Margin: the provenance line + pass badge

**Prototype:** `qc/assets.jsx:418-423`. Three mutually exclusive words plus an optional pass number.

| State | Trigger | Paint |
|---|---|---|
| template | `!s.dynamic` | `Template · same in every packet`, `.px-small` weight 700 (inherits `--proto-ink3`) |
| written | `s.edited` | `Written for this posting` in `var(--text-brand)` weight 700 |
| from profile | dynamic, not edited | `From profile` in `var(--text-brand)` weight 700 |
| pass badge | `s.pass` present | `pass N` in `.px-small` |

**App status: `BUILT`.** `AssetBlocks.jsx:565-570`. Static → `Template · same in every packet` in
`var(--proto-ink2)` (a contrast fix, not a divergence); otherwise `METHOD_LABEL[row.method]` in
`var(--text-brand)`, and `loop N` in place of `pass N`.
**Note the app's wording is the corrected one.** `METHOD_LABEL` is re-exported from `assetGate.js`
(`:180-197` comment) rather than redefined, because two copies existed and disagreed:
`template_fill` was labelled *"written for this posting"* here and *"filled straight from the
package"* there. `insertions.ts:66,87` defines `template_fill` as text that was **not** changed for
this posting, so the prototype-matching wording was the false one — and false in the flattering
direction. The three values are `filled straight from the package` / `rewritten by a later pass` /
`edited by hand`.
**Empty:** an unmapped method degrades to the raw value rather than blanking.

---

## 18. Margin: "Claimed but not in the text"

**Prototype:** `qc/assets.jsx:452-456`, computed in `data.js:354-368`. A field lists `terms` it
claims to place; this names the ones whose literal string is absent from the field's own text.
One state, `.px-small` in `var(--proto-yellow)`, `text-transform: none`.
**Empty:** hidden when `missingTerms` is empty.

**App status: `BLOCKED`** — same dependency as §3. The *check* has an analogue server-side
(`ATS distribution` in the prototype's `CHECKS`; the app's nearest is `must_have_coverage` /
`changes_cited`), but a per-field claimed-terms list needs the term rows §3 names.

---

## 19. Margin: the hovered term's posting line

**Prototype:** `qc/assets.jsx:458-462`. When a `KeyChip` is hovered, the requirement's `verbatim`
appears at the bottom of the margin in italic `.px-small`. One state; `null` when the term has no
requirement.

**App status: `BUILT` as an always-on equivalent.** `Verbatim` (`AssetBlocks.jsx:190-201`) renders
`Posting says: "<quote>"` permanently at the foot of every margin, with the quote painted in the
**posting-echo** highlight (`.qc-echo` — pale wash under a rule, deliberately a different *kind* of
treatment from the keyword highlight so the two cannot be confused by a reader who cannot separate
the hues). Source precedence `row.requirement_verbatim || row.verbatim_quote || reqs[0].verbatim ||
firstSwapQuote` (`:665`) — always the employer's own words, never a paraphrase.
**Empty:** `if (!text) return null`, and when a generated block has no quote the `reason` line above
says so outright — *"No posting line matched this block, so nothing in the ad drove its wording."*
(`:437`). That is a designed absent-state the prototype does not have.

---

## 20. `AssetDocView` — the asset's block stack

**Prototype:** `qc/assets.jsx:472-485`. Header + one `AssetBlock` per section + one `ReqLegend`.
**Empty state:** `if (!doc)` → a centred `.px-box` reading *"Nothing drafted yet."*

**App status: `BUILT`.** `AssetBlocks` default export (`:695-822`): a `N merge fields` count row
with a `Show blocks` / `Hide blocks` disclosure (`aria-expanded`, keyboard), the meter, then one
`AssetBlock` per row keyed `merge_field + loop`. `latestRows` filters to the latest loop only, so
older passes are history behind `before_text` rather than extra cards. `ReqLegend` is per-field
(§8) rather than once at the bottom.
**Empty/unknown:** three distinct states versus the prototype's one (see §16), which is the correct
direction — *not drafted*, *could not be read*, and *drafted before per-field records existed* are
three different facts about the same blank screen.

---

## 21. `GateBadge` on the artifact card

**Prototype:** `qc/evidence.jsx:6-24`, rendered on the resume card at `packet.jsx:227`. A pill
carrying `"<score> · N to fix · N to review"` or `"<score> · clear"`, a dot in the gate colour, and
`GATE_SOFT[g]` / `GATE_COLOR[g]` backgrounds — green / yellow / red. `small` variant. Clicking opens
the QC drawer on that asset. `null` when the asset has no gate.
Also on the card: the `blocked` control (`packet.jsx:261-271`) — when the gate fails, `Approve` is
`disabled` and a red `N to fix — <first finding title> →` button appears that deep-links to the
offending field.

**App status: `PARTIAL`.** `GateBadge` **exists and is stronger** (`AssetGateDrawer.jsx:44-73`):
five states rather than three — `error` → `gate unavailable` with the message in `title`;
`!result` → `checking...` / `not loaded`; `pass|warn|fail` → `Clear` / `Needs a decision` /
`Blocked` (SPEC 7 bans the engine's own vocabulary as a user-facing label, so `fail` will never
appear and **that gap-register row can never close**); `null` gate → `Not checked`, which is the
absence of a verdict rather than permission; plus an `exception` pill when overridden. `fix` and
`review` are counted and labelled **separately**, never totalled under one word — a defect that
shipped once (`:52-63`).
**But it is not on the resume step's card.** `grep -rn "GateBadge" app/src/` → `AssetGateDrawer.jsx`
(definition + two self-uses) and `Packets.jsx:140` (the packet list). `PacketBuilder.jsx` mentions
it only in a comment (`:157`). So on the step where the reader is reading the draft, the gate is
represented only by the `N to fix` / `N to review` tokens inside the collapsed meter (§9) — a count
without a verdict word and without a route to the finding.
**The `blocked` Approve state is `ABSENT` too:** `PacketBuilder.jsx:202-237` renders `Approve`
unconditionally enabled for a `review`/`changes` artifact. The server does refuse
(`approvalBlock()` in `appChecks.ts`, mirrored by `footerFor()` in `assetGate.js:215`), so the rule
is enforced — but the card offers a button that will be rejected instead of saying why first.

---
# Build order — the PARTIAL / ABSENT / BLOCKED rows ranked by user-visible impact

Ranked by what a reader loses today, not by effort. Rows 1–8 are buildable now; 9–12 need a data
source or a store first.

| # | § | Component / state | Status | Why it ranks here |
|---:|---|---|---|---|
| 1 | §1 | `Marked` — keyword + posting-echo highlighting **inside the draft text** | ABSENT | The whole margin is a set of pointers into a sentence that is never marked. It is also the **unlock for four other rows** — every linked-hover in §5, §6, §13 and §19 depends on it. The colours, the two treatments and the dark-mode pairs already exist in `highlight.js` / `theme.css`; only the wrapper is missing. |
| 2 | §16 | Focus ring + scroll-to-field on the asset card (`inset 0 0 0 2px`, 200ms, clears after 2.2s) | PARTIAL | A finding on the QC rail cannot land beside the sentence it names — it lands in the drawer's second rendering of the same rows. The behaviour is already written at `AssetGateDrawer.jsx:136-175`; this is moving it onto the card, not inventing it. |
| 3 | §11 | The per-field findings list (all five severities, not just `fixed` + `posting_wording_kept`) | PARTIAL | The collapsed header counts `N to fix` / `N to review` with **nothing to expand into**. A `fail` on this asset is invisible on the step where the reader is reading the draft. `SEV_LABEL` / `SEV_TONE` / `severityMeta` are all built; the renderer is not. |
| 4 | §2 | State colour on the field's measurement/target line | PARTIAL | Both halves are now correct and unit-matched — but a 70-word summary against a 55–60 band paints identically to a 57-word one. One `severityFor`-derived colour on two spans. Cheapest correctness win in the step. |
| 5 | §21 | `GateBadge` on the artifact card + `Approve` disabled when the gate fails | PARTIAL | The badge exists and has five well-built states; it is simply not rendered on this step. Today the card offers an `Approve` the server will refuse, instead of saying why first. |
| 6 | §15 | Asset-level `Ask for a change` on the artifact card | ABSENT | The last unbuilt item on the earlier triage's own list. A thin extension of `api.aiEditArtifact` with no `section` — do not build a second edit path. |
| 7 | §16 | `sameAsBefore` — "identical, template text is not merged per packet" | PARTIAL | Small but it is a **false claim**: every static field's Original panel is headed *"before this posting"* when nothing changed. Fixable from `before_text === after_text`. |
| 8 | §11 | "Nothing to review on this asset." | ABSENT | The designed *checked-and-clear* state. Without it, clear and unchecked look the same on the card. Guard on `severity.fix + review + soft === 0` **and** a loaded result — never on an empty payload, which is the unchecked case. |
| 9 | §10 | Per-kind stat split (must-have / responsibility / nice-to-have) | PARTIAL | Needs per-kind denominators on `GET /app/opportunity/{id}/requirements`, which returns `total` only. An endpoint extension, not a new system. Until then the single `Posting lines placed` stat is the honest version. |
| 10 | §6 | The `rewording` state on a kept phrase (strike-through + `--proto-yellow` + toggle) | PARTIAL | Deliberately deferred: no store exists for "I chose to reword this", and a toggle that forgets is dead UI. Needs a persisted decision keyed by artifact + phrase. |
| 11 | §3 §4 §18 | `KeyChip`, `KeyDetail`, "Claimed but not in the text" | BLOCKED | `term_library_entry` has **zero published scoreable rows** (db-query run 32327554276 — the same reason `keyword_coverage` is null) **and** there is no per-asset term-placement endpoint. Both must exist. The app's current `UNKNOWN_TERMS_NOTE` is the correct behaviour meanwhile and should survive the fix. |
| 12 | §14 | `PickList` (`type: 'select'` fields) | ABSENT | Portfolio-only today, so no resume impact — but needs per-item candidacy on the insertions payload (which items were available, which chosen, which blocked by the omission list), not just the joined text. |

Not ranked, deliberately: **§11's `open` / "Needs your answer" severity** is `BLOCKED` on an
open-question store (`OPEN_ITEMS` has no app counterpart) and `assetGate.js:78-87` is right that
minting it from a state we already have would be inventing a bucket. **§7's covered/open chip
colour** cannot occur in the app's model — a chip in a field's margin *is* a line that field
answers. **§16's letter typography** is cosmetic.

---

# WHAT THE GAP REGISTER GETS WRONG

`UI-GAP-REGISTER.md:71` scores the `resume` step at **62 panels** missing (its own `§ resume`
section header, quoted by `triage/resume.md:3`, says 61 — the two runs disagree, which is itself a
reason not to treat the number as a backlog). The section prints 40 of them plus a `…and 21 more`
bullet. Every one of those 40 was classified against the app source:

| Class | Count | Share of the 40 |
|---|---:|---:|
| **Demo values** — a SafetyIQ / Head-of-Engineering sample string, not a component | **26** | 65% |
| **Measurement strings** whose component is BUILT (the numbers differ because the data differs) | **6** | 15% |
| **Component names that are BUILT today** (some renamed) | **6** | 15% |
| **Banned vocabulary** — can never close by string equality | **1** | 2.5% |
| **A genuinely absent component** | **1** | 2.5% |

**The 26 demo values.** `SafetyIQ · Head of Engineering`, `Platform Modernization`,
`Cloud-native Services`, `sixty-two engineers`, `eight figures`, `Roadmap Alignment`,
`SOC 2 / ISO 27001`, `Multi-region AWS`, `SOC 2 Type II`, `P&L Ownership`, `Distributed Teams`,
`Cycle Time Reduction`, `Safety-critical Systems`, `Kubernetes`, `safety-critical`,
`Budget development and P&L ownership`, `KPI driven engineering performance management`,
`Enterprise strategy and execution alignment`, `Governance frameworks for audit compliance`,
`Optimizing scaled software delivery operations`, `Strategic roadmaps with product partnership`,
`DevSecOps`, `Board Reporting`, `Cloud Migration`, `Org Scaling 62`, `Safety-critical`.
Nobody wants the app to say `Kubernetes`. These are the *contents* of components — `KeyChip`,
`FieldList` rows, the draft text — and closing them would mean rendering another company's job ad.

**The 6 measurement strings.** `56 words · 55–60 words`, `longest 22 chars · ≤ 24 chars each`,
`longest 23 chars · ≤ 24 chars each`, `6 × 5 words · 6 phrases, exactly 5 words`,
`0 over 20 chars · max 1 item over 20 chars`, `1 over 20 chars · max 1 item over 20 chars`. The
component behind all six is one pair of functions, `observedFor()` + `targetFor()`
(`assetBlocks.js:516-597`), and **it is built** — including `resumeSummaryWords: [55, 60]`, the
band the earlier triage called *"the biggest real hole in the step"*, now in `CheckThresholds`
(`api/.../checks.ts:66,152,490`) and wired at `assetBlocks.js:508`. Six rows, one change, already
made. They will still never match by string, because the app measures the owner's real draft
against the owner's threshold.

**The 6 component names that are BUILT.** `4 corrected` → `BLOCK_HOOKS.meterCorrected`
(`AssetBlocks.jsx:279-284`). `3 to review` → `meterToReview` (`:295-300`). `Posting lines answered`
→ `:635`. `Changes made` → `Corrected for you` (`:578`) — **renamed, not missing**.
`Wording kept from the posting` → `checkLabel('posting_wording_kept')` (`assetGate.js:161`,
rendered `AssetBlocks.jsx:603`). `kept` → the status word at `:608`.

**The 1 banned row.** `fail` — SPEC 7 bans the engine's own vocabulary as a user-facing label; the
app says `Blocked`. `UI-GAP-REGISTER.md:41-44` already says these rows are retired by judgement and
must not be "fixed", so the instrument is knowingly counting rows it tells you to ignore.

**The 1 real one.** `Keywords placed` — and it is `BLOCKED` on a data source, not on UI work (§3).

### So: of the 40 printed rows, ZERO name a component that is absent and buildable.

The one that names an absent component names a blocked one. Meanwhile the genuine gaps this
inventory found — **the draft text is never marked up (§1)**, **a finding cannot land beside the
sentence it names (§16)**, **there is no per-field findings list (§11)**, **the measurement line has
no state colour (§2)**, **the gate badge is not on the card (§21)** — appear in the register **not
at all**, because each of them is a *state, colour, transition or route* rather than a string that
one side renders and the other does not. That is the structural blind spot: **a text diff can only
see components that print words, and only when their words match.**

The register remains useful for what it was built for — catching a whole panel that never renders —
provided its fixture set is full (`UI-GAP-REGISTER.md:46-60`). It is the wrong instrument for
"does this component have every state it needs", which is what the owner asked for and what this
document answers.

---

*Analysis only. No file under `app/src` or `api/src` was modified; nothing was committed.*
