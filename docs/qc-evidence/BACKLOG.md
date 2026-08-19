# Backlog — QC &amp; evidence layer

Prioritized, with acceptance criteria. Sequencing is yours; the dependency order is
P0 → P1 → (P2, P3) → P4 → P5, and P6/P7 are independent.

Ground truth for shapes and weights: `Evidence Model & QC Lineage.html`.
Ground truth for behavior and layout: `Packet QC Prototype.html`.

A note on intent that should shape every item below: **the expected steady state is 100%
coverage.** The pipeline should remediate in loops until every posting line is closed, and a
failure should be rare enough that when the user sees one it means the prompts or the profile
need attention — not that the run is normal. Anything that cannot be closed with evidence that
actually exists in the profile must be **escalated**, never written.

---

## P0 — Wiring bugs (small, do first)

### P0.1 `missingKw` is rendered but never returned
`PacketBuilder.jsx` renders `p.missingKw` as the red "! missing" chips, but `packet` has no
`missing_kw` column and `appPackets.ts` never returns one. The gap list is always empty, so the
one QC surface in the app shows only good news.

- [ ] Add `missing_kw text[] default '{}'` to `packet` in `schema.ts`.
- [ ] Return `missingKw` from the packet GET alongside `coveredKw`.
- [ ] Populate both from the JD analysis rather than leaving them to drift.

**Acceptance:** on a packet whose profile does not cover every term, the right panel shows at
least one red chip, and `GET /api/app/packet/{id}` returns a non-empty `missingKw`. The
`{covered}/{total}` line matches the chip counts.

### P0.2 `jd-analysis` discards its own output
`POST /api/app/opportunity/{id}/jd-analysis` returns `keywords`, `mustHaves`, `atsScore`, `gaps`
to the caller and persists none of it. Reloading the screen loses the analysis.

- [ ] Persist the analysis before returning it.
- [ ] Make the endpoint idempotent — re-running replaces, never appends.

**Acceptance:** run the analysis, hard-reload the packet, and the same keywords, must-haves and
score are present with no second model call.

### P0.3 `todo` status pill is invisible
`Pill` resolves `var(--proto-${tone}-soft)` for background and `var(--proto-${tone})` for text.
Tone `panel` → `--proto-panel-soft` (undefined anywhere in the token sheets) and `--proto-panel`
(a near-white surface). Result: white text on a white card.

- [ ] Replace the string interpolation with an explicit tone → `{bg, fg}` map in
      `app/src/shell.jsx`. `panel` → `--proto-panel-deep` / `--proto-ink2`.

**Acceptance:** a `todo` artifact's status pill has a contrast ratio ≥ 4.5:1 against the card;
no rendered `.px-pill` resolves to an undefined custom property.

---

## P1 — The evidence spine

Nothing here needs new extraction or new prompts. `appJdParse.ts` **already** produces
`jd_requirements` (a `<ul>` of every responsibility, requirement and skill) and `jd_table` (rows
of *Category | Item | ATS Keyword*, category ∈ responsibilities/experience/requirements/skills,
keyword ≤ 25 chars). Today both are stored as HTML strings and the packet screen never reads
them. This is a structuring job.

### P1.1 `requirement` rows
- [ ] New table: `id`, `packet_id` (or `opp_id`), `verbatim`, `char_start`, `char_end`, `kind`
      (`must_have` | `nice_to_have` | `responsibility`), `competency`, `weight` (1–3),
      `coverage` (`covered` | `partial` | `escalated`), `closed_on_loop`.
- [ ] Parse `jd_table` / `jd_requirements` into rows at analysis time; map its Category to `kind`.
- [ ] Resolve `char_start`/`char_end` against `opportunity.jd_real` so every quote is verifiable.

**Acceptance:** for a posting with N bullet lines, N rows exist; each row's `verbatim` is a
substring of `jd_real` at its recorded offsets; `kind` distribution matches the posting's own
sectioning; zero rows have a null `kind`.

### P1.2 `ats_term` rows
- [ ] New table: `id`, `term`, `requirement_ids[]`, `source` (`library_match` |
      `model_inferred`), `library_id`, `frequency_in_posting`, `status` (`covered` |
      `missing` | `inserted` | `escalated`).
- [ ] **Terms must come from a curated library, not from the model.** Build a term library from
      real sources (O*NET skills, a skills taxonomy such as Lightcast, scraped exec postings, ATS
      vendor field dictionaries), version it, and match it against the posting. `jd_table`'s ATS
      Keyword column is a reasonable bootstrap but is model-generated — treat it as candidates to
      seed the library, not as the library.
- [ ] `model_inferred` terms may be shown but never count in the score numerator or denominator.
- [ ] Keep `packet.covered_kw` / `missing_kw` as derived views of this table, not a parallel truth.

**Acceptance:** every scored term resolves to a library entry and to ≥ 1 requirement; a
model-invented term is visibly labelled and provably excluded from the score; the library id and
version appear in the UI.

### P1.2b Term library
- [ ] `term_library` + `term_library_entry`: `library_id`, `version`, `term`, `aliases[]`,
      `family`, `source`, `added_at`.
- [ ] Alias handling matters: "SOC 2", "SOC 2 Type II" and "SOC2" must be one entry with aliases,
      or coverage counts will be wrong.

**Acceptance:** matching is deterministic for a given library version; adding an alias does not
change any historical score, because scores record the version they used.

### P1.3 `skill_candidate` and `swap_decision`
- [ ] `skill_candidate`: `label`, `list` (`skills_1` | `skills_2` | `relevant_1..3`), `origin`
      (`profile_original` | `pass_a` | `pass_b`), `char_len`.
- [ ] `swap_decision`: `from_candidate_id`, `to_candidate_id`, `action` (`kept` | `swapped` |
      `merged` | `dropped` | `added`), `requirement_id`, `verbatim_quote`, `confidence`,
      `rationale`, `driver` (`posting` | `rule`).
- [ ] Capture one row per item in every list, including unchanged ones — the UI shows all
      originals against all finals, so `kept` rows are data, not noise.
- [ ] `driver = 'rule'` for omission-list drops so they are never presented as posting-driven.

**Acceptance:** row count equals the total item count across all five lists; every
`action = 'swapped' | 'added'` row has a non-null `requirement_id` and `verbatim_quote`, or is
recorded as a failure (see P2.2); rendering the swap table requires no model call.

### P1.4 `insertion` rows
- [ ] `insertion`: `artifact_id`, `ats_term_id` or `skill_candidate_id`, `requirement_id`,
      `merge_field` (the real field name — `ResumeSummary`, `SkillsBullets1`,
      `@AboutMe1_50words` …), `before_text`, `after_text`, `method` (`model_rewrite` |
      `template_fill` | `manual`), `loop`.
- [ ] Model each asset as **its merge fields**, not as invented sections: 7 fields for the resume,
      6 for the compact resume, 3 for the cover letter, 7 for the portfolio (README table). Static
      blocks are still listed in the UI, marked not generated, so the user can see what the
      pipeline cannot reach.
- [ ] Store the **passage**, not the whole document. `artifact.version_history jsonb` already
      exists and can host this while the shape settles.

**Acceptance:** every block in the UI renders from a row and names its merge field; no block claims
to be generated when no merge field backs it.

### P1.5 Template reach
- [ ] Record when a requirement is covered **only** in generated fields while the static template
      text omits or contradicts it (check `C5`).
- [ ] Decide per template: edit the static bullets once, or add merge fields (e.g.
      `WorkHistoryBullets1..n`) so the pipeline can place figures in the experience section.

**Acceptance:** a must-have whose only evidence is a generated summary raises a warning naming the
static block that omits it — e.g. work history reading "globally distributed" with no headcount
while the posting asks for 60+.

---

## P2 — Checks and the gate

### P2.1 Deterministic rules engine
No model. Ports the checks that today live as instructions inside prompts (Q1–Q16 in
`Zap 289877647 Workflow Baseline.html` §5).

- [ ] `check_result`: `artifact_id`, `check_key`, `engine` (`deterministic` | `reviewer`),
      `state` (`pass` | `warn` | `fail` | `not_applicable`), `observed`, `expected`,
      `offenders[]`.
- [ ] Implement: must-have coverage complete · responsibilities addressed · explicit terms
      present (or escalated) · skills ≤ 24 chars · relevant ≤ 20 chars · no cross-list
      redundancy · list count 20–22 evenly split · omission-list membership · AI-tell vocabulary
      and em-dash scan · markup/code-fence residue · whitespace · empty template fields · word
      counts for the portfolio slots · correct company named throughout (catches the stale
      company name the sample cover letter carried) · every claim traceable to the profile.
- [ ] `offenders[]` must name the specific items, not a count.

**Acceptance:** each check returns the same result for the same input every time; a deliberately
25-character skill produces exactly one `fail` naming that skill; running the engine costs no
tokens.

### P2.2 Gate aggregation and approval blocking
- [ ] Any `fail` → gate `fail`. No fails but a `warn` or a reviewer disagreement → `warn`.
      Otherwise `pass`.
- [ ] An uncited `swapped`/`added` decision is always a `fail`, never a `warn`.
- [ ] A term dropped for length without an escalation is a `fail` — length pressure is not an
      honest gap.
- [ ] `fail` blocks `setArtifactStatus(..., 'approved')` server-side, not just in the UI.
- [ ] `warn` requires an explicit override that records actor, timestamp and reason.
- [ ] `packet.status = 'ready'` additionally requires no asset gate at `fail`.

**Acceptance:** a direct API call attempting to approve a `fail`-gated artifact is rejected; an
override on a `warn` writes an audit row; the send step cannot be reached with a `fail` open.

### P2.3 Decomposed `match_score`
- [ ] `match_score`: `artifact_id`, `must_have_coverage`, `keyword_coverage`,
      `seniority_alignment`, `composite`, `uncovered_requirement_ids[]`, `engine_version`,
      `computed_at`.
- [ ] `composite = 0.5·must_have + 0.3·keyword + 0.2·seniority`. Bands: ≥ 85 strong,
      70–84 acceptable, < 70 needs work.
- [ ] Score each asset separately (the compact resume carries a different skill block from the
      full resume), plus a packet-level mean.
- [ ] Keep every historical score so regenerations are comparable.

**Acceptance:** each sub-score expands to the requirement or term rows behind it; recomputing
with the same `engine_version` and inputs reproduces the number exactly; the header number is
clickable down to the requirement that moved it.

---

## P3 — Remediation loop

### P3.1 Loop controller
- [ ] After generation, compute coverage. While requirements remain open and `loop < max`
      (start at 4), re-run generation **scoped to the open requirements only** — do not rewrite
      closed blocks.
- [ ] Record a `remediation_loop` row per pass: `n`, `ran_at`, `closed[]`, `remaining[]`, `note`,
      `halted`.
- [ ] Halt when a pass closes nothing, and record why.
- [ ] Loop 2+ should first look for evidence already in the profile that was not surfaced — the
      $18M budget and the 60+ team size in the prototype both existed in the work history and
      were simply not pulled forward.

**Acceptance:** a packet whose profile can cover everything reaches 100% must-have coverage with
no human action; the loop log shows what each pass closed; no pass rewrites an already-closed
block.

### P3.2 Escalations
- [ ] `escalation`: `requirement_id`, `ats_term_id`, `artifact_id`, `state`
      (`open` | `resolved` | `accepted`), `title`, `detail`, `ask`.
- [ ] Created when the loop halts with anything open. The detail must state what was searched and
      why it could not be closed.
- [ ] Two resolutions: the user supplies evidence (reopens the loop) or accepts the gap (score
      stays honest).

**Acceptance:** an uncoverable nice-to-have produces exactly one open escalation and **zero**
invented content anywhere in the assets; the score reflects the gap rather than hiding it.

---

## P4 — Independent reviewer

### P4.1 Blind reviewer
- [ ] New prompt row in the existing `Prompts` Azure Table (`promptsApi.ts` already versions by
      `partitionKey` + `version` + `is_active`) — e.g. `reviewer_ats_user`.
- [ ] Input: posting text, requirement rows, the finished asset. **Not** the generator's
      rationale, and not its swap reasons.
- [ ] Output: `grade`, per-decision agreement, `citations[]` of
      `{requirement_id, verbatim_quote, claim}`, `critique[]`.
- [ ] Validate every citation server-side: the quote must appear in `jd_real` and resolve to the
      claimed `requirement_id`. Discard claims that do not — they never reach the user.
- [ ] Store `review_verdict` with `reviewer_model`, `prompt_version`, `blind`, `ran_at`.
- [ ] Meter the call through the existing `usage_metering` table.

**Acceptance:** the reviewer's request payload provably excludes generator rationale; a fabricated
quote is dropped rather than displayed; agreement counts in the UI come from stored rows;
`prompt_version` is present on every verdict.

### P4.2 Reviewer vs rules separation
- [ ] Deterministic results and reviewer results are never merged into one number. The rules
      engine decides pass/fail; the reviewer grades and critiques.

**Acceptance:** every `check_result` row carries its `engine`, and the UI groups by it.

---

## P5 — UI

Build against `Packet QC Prototype.html`. Order within P5: 5.2 → 5.1 → 5.3 → 5.4, because the
asset block view is what makes the generated output legible at all.

### P5.1 QC &amp; evidence rail step
- [ ] New step between `video` and `send`; step circle takes the packet gate color.
- [ ] Five tabs: Coverage · Original vs final · Remediation loops · Checks · Independent review.
- [ ] Coverage keeps the three requirement classes in **separate** cards with their own
      closed/total counts, and renders the posting line by line with click-to-filter.
- [ ] Selecting a requirement filters the other tabs; a clear-filter affordance appears.

**Acceptance:** a reviewer can answer "is this swap posting-driven?" without leaving the step;
responsibilities are never mixed with must-haves; the 100%-or-escalated rule is visible at a
glance.

### P5.2 Asset blocks with provenance
- [ ] Replace the collapsed `content` string with block-level rendering: one card per **merge
      field**, formatted the way the document formats it — list fields as vertical lists with the
      swapped-in value to the right of an arrow, the ATS block as a monospace pipe run, prose
      fields as prose.
- [ ] Default to **open**. The draft is the point of the screen.
- [ ] Show static blocks too, dashed and marked "static template · not generated".
- [ ] Margin shows origin, loop, requirement chips, library terms placed, the reason, and the
      verbatim posting line. "Compare with original" reveals the before text inline in **blue** —
      the original is information, not an error.
- [ ] Distribution meter above: posting lines placed in this asset, library terms placed, and how
      many of the asset's fields are generated versus static.
- [ ] Same treatment for the cover letter (paragraph slots) and portfolio (numbered slides with
      an "expected" caption per slide).

**Acceptance:** for any block a user can see what it was, what it became, which posting line drove
it and which loop produced it, without opening another screen; a block that was not changed says
so rather than looking generated.

### P5.3 Per-asset drawer
- [ ] Gate badge on every artifact card and in the send list; opens a right drawer.
- [ ] Tabs: Score · Checks · Blocks & provenance · Original vs final · Review.
- [ ] Footer action follows the gate (Approve / Approve with exceptions / disabled with reason).

**Acceptance:** the drawer opens over the current step without navigation; the footer state
matches the server's gate decision.

### P5.4 JD step reorganization
- [ ] Parsed-posting card with **three** columns: Responsibilities · Requirements (must-have and
      nice-to-have as sub-groups within the same column) · ATS keywords.
- [ ] The keyword column names the library it matched against, its size and sources, and labels
      model-inferred words as excluded.
- [ ] Name the profile explicitly — the analysis compares the posting against the user's **master
      profile** and should link to it. "The profile" with no referent is unintelligible to a
      first-time user.
- [ ] Reserve the word "ATS" for the keyword library and its coverage. Requirements and
      responsibilities are posting analysis, not ATS.
- [ ] Make the two surfaces distinct: the JD-step card is the **source** (extraction + run
      result), the right panel is the **tally**. Say so in each.
- [ ] "Run / re-run analysis" gets a working busy state and a result strip.
- [ ] Right panel renders once — sidebar at ≥ 1200px, one collapsible header row below that.

**Acceptance:** a first-time user can tell requirements, responsibilities and keywords apart
without reading documentation; the re-run button visibly does something; the panel appears exactly
once per screen.

---

## P6 — Intake and the profile

The 13 hardcoded `set_value` steps in the zap are the candidate's standing material, identical on
every run (`docs/zap-289877647/baseline/`).

- [ ] Move them into an editable profile: resume summary, work experience, skills, expertise,
      relevant skills, about-me 1–2, executive profile, core accomplishments, omission list,
      soft/hard skill bank. `library_entity` (kind `role_profile`) is a plausible home.
- [ ] Per-run block on the JD step: posting URL/paste/file, role type → template routing,
      recipient, and optional per-run overrides.
- [ ] Derived and never typed: target title, company, date, requirement and term sets.
- [ ] Fix the three storage-key collisions carried over from the zap (`Current Expertise` written
      by three steps, `Executive Profile Paragraph` by two).
- [ ] `Soft/Hard Skills` is never read by anything — decide whether it feeds the term matcher or
      goes away.

**Acceptance:** a second application requires only the posting and the recipient; editing the
resume summary once changes every future packet; no two profile fields share a key.

---

## P7 — Pipeline hygiene carried over from the zap

Only relevant to the parts of the zap still being migrated. Full detail in
`Zap 289877647 Workflow Baseline.html` §6.

- [ ] **Positional coupling.** Content is addressed as `Item 3 … Item 55` after splitting on
      `###`. Any prompt change shifts every downstream field silently. Move to named keys or JSON.
- [ ] **Concatenated split.** One step splits the joined output of two different prompts, so their
      section counts are load-bearing on each other.
- [ ] **Hour-based memory key.** `{{form id}}{{hour}}` means two runs in one hour share
      conversation memory and a run crossing the hour boundary loses it mid-chain.
- [ ] **Duplicate generation.** Two near-identical 16k-token prompts; one step converts skills to
      HTML and a later one converts them back to plain text.
- [ ] **Unvalidated fallback.** An unmatched role yields the literal string `Unknown`, passed
      straight to Google Docs as a folder id.
- [ ] **No failure path.** No retries, no validation that any field exists, no notification when a
      document or model call fails.
- [ ] **Temperature 1.0 on the QA step.** The reconciliation step should not be the most creative
      call in the pipeline.
- [ ] **Single-tenant constants.** Hardcoded person name in document titles, one Engineering
      template folder, role routing that only knows two roles.

**Acceptance:** a prompt edit that adds a section cannot silently move content into the wrong
resume slot; a failed run notifies rather than sending a partial packet.

---

## P8 — Decisions added in the evidence-layer review

These came out of reviewing the prototype and override anything above that contradicts them.
Ground rules are stated in `SPEC.md` §2 (R1–R7).

### P8.1 Auto-correct before reporting (R1)
- [ ] Anything the rules engine can fix deterministically is fixed in the generated text before the
      user sees it, and written to a `correction` row: `artifact_id`, `section_id`, `phrase`,
      `replacement`, `reason`, `source` (`profile_figure` | `generalized`), `reverted_by`,
      `reverted_at`.
- [ ] The UI presents corrections as a change log in finished framing, with per-correction Undo and
      "suggest something different". Reverting restores the original string in place.
- [ ] Corrections never count toward the fix/review counters; they have their own count.

**Acceptance:** a packet whose only problems are auto-correctable reaches the user with zero open
items and a non-empty change log; undoing a correction restores the exact original substring and
re-opens the corresponding check.

### P8.2 Posting figures are never echoed (R3)
- [ ] Deterministic scan of every generated field for figures that appear in the posting (currency
      amounts, headcounts with `+`, counts of business units, customer counts) plus their spelled-out
      forms.
- [ ] Replace with the candidate's own figure from the profile when one exists (`60+` → `62`,
      `sixty engineers` → `sixty-two engineers`), otherwise generalize (`$18M` → `8-figure`,
      `three business units` → `multiple business units`).
- [ ] Applies to swap results too — a list item may not read `Org Scaling 60+` or `P&L $18M`.
- [ ] Non-numeric echoes stay a user judgement call and are listed separately as
      "wording kept from the posting".

**Acceptance:** no generated field or list item contains a numeric string that also appears in
`jd_real`; each replacement is logged with its reason; the check is deterministic and costs no
tokens.

### P8.3 Evidence excerpts on every coverage claim (R2)
- [ ] `requirement.evidence`: `quote`, `source_kind` (`work_history` | `accomplishment` |
      `profile_field` | `certification`), `source_label`, `extra`, and offsets into the profile
      record.
- [ ] The JD step expands any "evidenced" row to that quote and source. A requirement with no
      evidence row renders as "no evidence found in your profile" and cannot be counted as covered.

**Acceptance:** coverage counts equal the number of requirements with a resolvable evidence quote;
an evidence quote is a substring of the stored profile record it names.

### P8.4 Posting-vs-profile comparison, graded
- [ ] Persist the comparison dimensions (tenure, org size, budget, compliance, modernization, cycle
      time, domain, public sector — configurable per role family) with the posting requirement, the
      profile value and a graded fit plus an optional qualifier note.
- [ ] The JD step shows the comparison, not pipeline counters ("posting lines", "passes").

**Acceptance:** the JD result reads as a two-sided comparison; every moderate/weak grade carries the
reason.

### P8.5 One source per number, and every number deep-links (R4, R5)
- [ ] A single selector returns an asset's items by severity (`fail` | `open` | `warn` | `fixed` |
      `soft`); gate badges, asset headers, drawer footers, the QC lists and the send gate all read it.
- [ ] Fix and review counts are always labelled separately.
- [ ] Every item carries `artifact_id` + `section_id` so any count can open the field, scroll to it
      and outline it. Navigation out of a modal closes the modal first.

**Acceptance:** no two labels describing the same population print different numbers; every count in
the UI is clickable and lands on a visible destination.

### P8.6 Ad-hoc correction affordances (R6)
- [ ] Per-field "ask for a change" scoped to that merge field.
- [ ] `Show original` on every field including static template blocks (which render their real
      template text and merge placeholders).
- [ ] Keyword-level controls: put back the item it displaced, swap for another skill from the
      profile's bank, or drop it and leave the posting line open — each recording the coverage
      consequence.

**Acceptance:** a user can correct any field they happen to notice without going through the QC
step; dropping a keyword lowers coverage rather than silently keeping the claim.

### P8.7 Presentation constraints
- [ ] Requirement ids always render with kind and competency, with a legend on screen (R7).
- [ ] Keyword highlight in text: highlighter yellow; posting echo: pale tan underline; the two are
      never the same treatment.
- [ ] The requirement lists are tabbed (Responsibilities / Requirements / ATS keywords) with per-tab
      counts; the ATS list is 2-up ≥ 1040px and 1-up below; the old three-column layout stays
      available behind a flag.
- [ ] Keywords/ATS analysis lives in the modal behind the header score — not duplicated in a right
      column. The right column is the assistant, docked ≥ 1440px only.
- [ ] Asset headers are collapsed by default.

**Acceptance:** no id renders bare; no surface renders the keyword panel twice; the content column
never drops below ~600px at 1440px.
