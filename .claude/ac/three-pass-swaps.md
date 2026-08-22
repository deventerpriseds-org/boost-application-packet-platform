# Acceptance Criteria — three-pass-aware `buildSwaps`

**Status:** DRAFT IN PROGRESS (written incrementally; whatever is here is the deliverable).
**Change under test:** `api/src/functions/tests/swaps.ts` — `LIST_FIELDS` / `buildSwaps` become
THREE-pass aware (Call 2, the refinement pass, becomes an input).
**Tier:** 1 (accusation grade). `swap_decision` rows carry `requirement_id`, `verbatim_quote`,
`confidence`, `driver`, `rationale`; `attribute()` scores token overlap against posting
requirements. A row therefore ASSERTS that a specific skill answers a specific line of the
employer's posting, about a real person's candidacy.

**Author:** independent AC subagent. Written BEFORE implementation. No file other than this one
was modified.

---

## 0. Established facts (each stated with how it was established)

| # | Fact | How established |
|---|---|---|
| F1 | `LIST_FIELDS` maps only two passes: `{passA, passB, merge}`, `passB` = `finalSkills1` etc. | Read `api/src/functions/tests/swaps.ts:32-38` |
| F2 | `Origin` is exactly `'profile_original' \| 'pass_a' \| 'pass_b'` (line 25). `Action` is `kept\|swapped\|merged\|dropped\|added` (26). `Driver` is `posting\|rule\|unattributed` (27). | Read source |
| F3 | The module's own header comment asserts Call 3 → `pass_b` and calls `assemblePackage`'s Call-3-over-Call-1 preference "THE swap decision". Call 2 is not mentioned anywhere in it. | Read `swaps.ts:6-11` |
| F4 | `attribute()` requires `r.verbatim`; below `ATTRIBUTION_THRESHOLD = 0.34` returns null. `SWAP_THRESHOLD = 0.5` on containment similarity separates "same item reworded" from "drop + add". | Read `swaps.ts:128-137`, `:70-79` |
| F5 | Recent commits confirm the bug is already known in-repo: `1cb9927 "Open a row: the skill-analysis screen compares against a pass that returns nothing"`, `f8acc52 "Record which pass wrote each skill, and keep the analysis sections"`. | `git log --oneline -3` |

(Remaining ground-truth checks appended below as they are made.)

| # | Fact | How established |
|---|---|---|
| F6 | **`buildSwaps` line 175: `const finals = splitItems(pkg[f.merge] ?? call3[f.passB])`.** The "after" side is ALREADY the assembled package, not Call 3's raw field. `call3[f.passB]` is only a fallback. | Read `swaps.ts:174-176` |
| F7 | **`pipeline.ts:420`: `const pkg = assemblePackage(c1, call2Draft(c2), c3)`.** So `pkg` already carries Call 2's refinements. Pipeline returns `calls: {c1, c2, c3}` (line ~442) — **`c2` is available at the call site and simply is not passed.** | Read `pipeline.ts:420,442` |
| F8 | `appPackets.ts:427` calls `writeSwaps(client, art.packet_id, opp.id, {...})`; `appSwaps.writeSwaps` forwards `{call1, call3, pkg, requirements, profileText, omitList}` to `buildSwaps` (`appSwaps.ts:41`). **`c2` is dropped between `appPackets` and `writeSwaps`.** | Read `appSwaps.ts:30-41`, grep `appPackets.ts:427` |
| F9 | `appPackets.ts:436-437` — `lineage: skillLineage(c1, c2, c3, pkg)` and `analysis: collectAnalysis(c1, c2)` are computed **two lines after** `writeSwaps`, from the same variables, and written only to `packet.last_build` (`appPackets.ts:821`). **`skillLineage` already receives `c2`; `writeSwaps` does not.** | Read `appPackets.ts:427-437`, `packetBuild.ts:85,128,153` |
| F10 | **`schema.ts:436`: `origin text not null check (origin in ('profile_original','pass_a','pass_b'))`.** A DB CHECK constraint, not just a TS union. | grep `api/src/functions/tests/schema.ts:436` |
| F11 | **No frontend file reads `origin`.** `grep -rn "pass_a\|pass_b\|profile_original"` across `app/src`, `app/test`, `api/src`, `api/test`, `scripts` returns hits ONLY in `swaps.ts`, `pipeline.ts` (comments), `schema.ts:436`, and `api/test/swaps.test.mjs:126-188`. `assetBlocks.js` and `qcRail.js` have **zero** matches. | grep, full-tree |
| F12 | `assetBlocks.js:256` renders `status: swap.action === 'kept' ? 'unchanged' : \`${swap.action} · ${swap.driver}\`` — **`action` and `driver` are rendered as raw strings to the user**; `origin` is not rendered at all. `listBodyModel` keys swaps by `normLabel(s.to_label)` (`:249-251`). | Read `assetBlocks.js:245-269` |
| F13 | `writeSwaps` deletes+inserts **scoped by `(packet_id, loop)`** in one transaction (`appSwaps.ts:45-46,70`); a failed insert rolls the whole pass back. `swapsGet` returns `swaps` (all loops) plus `current` (max loop only), and computes `changed` / `unattributed` from `current` (`appSwaps.ts:98-111`). | Read `appSwaps.ts` |
| F14 | `attribute()` never returns `driver:'rule'`; only the omit-list branch (`swaps.ts:220-226`) does. `row()` sets `driver:'posting'` iff an attribution exists AND action ∈ {swapped, added, dropped}; otherwise `'unattributed'` (`swaps.ts:246-253`). | Read `swaps.ts:242-255` |

### F6+F7+F8 together are the real diagnosis — and it CONTRADICTS the brief's framing

The brief says Call 2 "is not an input" and implies the "after" side is wrong. Observation: the
**after side is already right** (`pkg[f.merge]`, F6/F7). What is missing is the **middle**: there is
no way to say WHICH pass made a change, and `originOf(fin, 'pass_b')` mislabels every Call-2
insertion as Call-3's work. That is a *provenance* defect and a *rationale* defect
(`'reworded by the ATS pass'` / `'introduced by the ATS pass'` — `swaps.ts:205,234` — are **false
statements** when Call 2 did the work), not an after-side defect.

Interpretation (not proven — I could not reach the live DB from this sandbox): the measured
"kept 8, swapped 1, dropped 1, added 1" is only reconcilable with 4 Call-2 replacements if the
`pkg` handed to `writeSwaps` at `appPackets.ts:427` is **not** the same object as the `pkg` at
`pipeline.ts:420` — `appPackets.ts:405` says "Everything below this line reads the *corrected*
package". **AC-0 below makes settling this a precondition of the change.**

| # | Fact | How established |
|---|---|---|
| F15 | **`appPackets.ts:409-416` runs `applyCorrectionPass(client, {artifactId, pkg, ...})` BEFORE `writeSwaps`**, and its comment states "Everything below this line reads the corrected package: the update, writeSwaps, writeInsertions and every later check." So the `pkg` `buildSwaps` sees is a **fourth** mutation — the corrected package — not any call's raw output. | Read `appPackets.ts:405-427` |
| F16 | `packetBuild.ts` `sameList()` exists precisely because of F15: "a correction pass runs after assembly and strips the `- ` bullet prefix, so every value differs from its source by two characters per line." Raw string comparison returned `none` for all five slots on a **healthy** build. | Read `packetBuild.ts:113-125` |
| F17 | `skillLineage` derives `winner` by comparing the SHIPPED value to call3 → call2 → call1 in that order (`packetBuild.ts:135-141`) — the assembler's precedence, applied to what actually shipped. | Read `packetBuild.ts:128-145` |
| F18 | `packetBuild.ts:85-91` states the rule the owner already agreed to: `last_build` is diagnostic only; it "must never be written into `requirement_evidence`, `check_result`, `artifact_score` or `swap_decision` — those are accusation-grade". It also says: "Attributing skills inside the swap system **would be a genuine improvement to `skill_candidate.origin`**, and it is deliberately NOT done here." **This change is the improvement that comment names.** | Read `packetBuild.ts:85-93` |

### Arithmetic check on the brief's own numbers (Observation, then Interpretation)

**Observation.** `kept 8 + swapped 1 + dropped 1 = 10` originals; `kept 8 + swapped 1 + added 1 = 10`
finals (`merged` claims no new final). So exactly **2** of 10 final items differ from Call 1's list.
The brief measures **4** replacements by Call 2.

**Interpretation (inference — confidence medium).** Running the four measured pairs through
`similarity()`: `Stakeholder Collaboration` → `Stakeholder Engagement` = {stakeholder,collaboration}
∩ {stakeholder,engagement} = 1 / min(2,2) = **0.5**, exactly `SWAP_THRESHOLD` → `swapped`. That is
the one swap. `Software Development Lifecycle` → `Software Quality Assurance` = 1/3 = 0.33 → below
threshold → drop + add. `Agile Methodologies` → `High-Performing Teams` = 0, `Operational Efficiency`
→ `Digital Innovation` = 0. Three drops + three adds were expected; **one** of each was stored.
I cannot close that gap from this sandbox. **AC-0 exists to close it before anything is coded** —
building the three-pass logic on an unexplained 2-vs-4 discrepancy is exactly the "compared two
proxies and filled the gap with an assumption" failure this repo's CLAUDE.md forbids.

---

# ACCEPTANCE CRITERIA

Convention: each AC has **Given / When / Then**, **Settles it** (the exact test or query), and
**Mutation** (the change that MUST turn the guard red). Guards land in
`api/test/swaps.test.mjs` + `api/test/hardening.test.mjs` with slug IDs (numeric IDs are banned by `H26`).

---

## AC-0 (BLOCKING PRECONDITION) — reconcile the stored counts against what shipped, before writing code

> **Given** packet for opportunity `9f9c370a-4ac9-441e-b58e-02e3ffcf669e`, whose stored
> `swap_decision` reports skills_1 = kept 8 / swapped 1 / dropped 1 / added 1, while Call 2 is
> measured to have replaced 4 of 10 items,
> **when** the stored rows, the stored `pkg_json->>'SkillsBullets1'`, and `last_build->'lineage'`
> are read together,
> **then** the 2-vs-4 discrepancy is fully explained by a NAMED mechanism (correction-pass rewrite,
> a second `loop`, `splitItems` separator behaviour, or greedy claiming) — and that mechanism is
> written into this file before `LIST_FIELDS` is touched.

**Settles it** — `db-query.yml` with:
```sql
select s.loop, s.action, s.from_label, s.to_label, s.driver, s.confidence
  from swap_decision s join packet p on p.id = s.packet_id
 where p.opp_id = '9f9c370a-4ac9-441e-b58e-02e3ffcf669e' and s.list = 'skills_1'
 order by s.loop, s.seq;
select p.pkg_json->>'SkillsBullets1' as shipped,
       p.last_build->'lineage'       as lineage,
       jsonb_array_length(coalesce(p.last_build->'analysis','[]'::jsonb)) as analysis_sections
  from packet p where p.opp_id = '9f9c370a-4ac9-441e-b58e-02e3ffcf669e';
select origin, count(*) from skill_candidate c join packet p on p.id=c.packet_id
 where p.opp_id='9f9c370a-4ac9-441e-b58e-02e3ffcf669e' and c.list='skills_1' group by origin;
```
**Mutation** — n/a (this is a gate on the work, not a code guard). Its failure mode is being skipped:
if the implementation lands without this section filled in, AC-0 is failed by inspection.

---

## AC-1 — which pass is the "after" side, and which pass gets NAMED

The after side does not move. `finals = splitItems(pkg[f.merge] ?? call3[f.passB])` (F6) is already
"what shipped" and must stay that way. What is new is a **per-row `pass` attribution** that must
never contradict it.

### AC-1a — the shipped list remains the sole "after" side

> **Given** `call1`, `call2`, `call3` and `pkg` where all three passes emit a different `skills1`,
> **when** `buildSwaps` runs,
> **then** every `to_label` on every row, and every `finals`-derived candidate, comes from
> `pkg.SkillsBullets1` — never from `call2.skills1` and never from `call3.finalSkills1`.

**Settles it** — `test('H:swaps-after-is-shipped: finals come from pkg, never from a call payload')`:
build with `pkg={SkillsBullets1:'P one\nP two'}`, `call2={skills1:'C2 one'}`,
`call3={finalSkills1:'C3 one'}`; assert `r.swaps.every(s => !s.to_label || /^P /.test(s.to_label))`.
**Mutation** — change line 175 to `splitItems(call2[f.passB2] ?? pkg[f.merge])`. Test must fail.

### AC-1b — the named pass is the EARLIEST pass that introduced the item

> **Given** a final item `F` present in the shipped list,
> **when** attribution runs,
> **then** `pass` = the earliest of {call_1, call_2, call_3} whose own list for that slot contains
> `F` under `normItem` equality; if no pass's list contains `F`, `pass = 'assembled'` (the correction
> pass or the assembler produced it) and the row is **never** described as any call's work.

Rationale: if Call 2 introduced an item and Call 3 merely kept it, Call 2 introduced it. Crediting
Call 3 is the false statement `swaps.ts:234` makes today (`'introduced by the ATS pass'`).

**Settles it** — `test('H:swaps-earliest-pass: an item Call 2 introduced and Call 3 kept is credited to Call 2')`:
`call1.skills1='A'`, `call2.skills1='A\nB'`, `call3.finalSkills1='A\nB'`, `pkg.SkillsBullets1='A\nB'`;
assert the `added` row for `B` has `pass === 'call_2'`.
**Mutation** — reverse the search order to call3 → call2 → call1. Row becomes `call_3`; test fails.

### AC-1c — the three cases the brief names, enumerated

| Case | Call 2 changed | Call 3 changed | Required `pass` on the change row |
|---|---|---|---|
| i | yes | no | `call_2` |
| ii | yes | yes (further) | `call_2` for the item Call 2 introduced that survived; `call_3` for an item only Call 3's list contains |
| iii | no | yes | `call_3` |
| iv | neither; text differs from all three | — | `assembled`, `driver` unchanged, rationale must not name a call |

**Settles it** — one table-driven test per row, `test('H:swaps-pass-matrix: ...')`.
**Mutation** — hardcode `pass='call_3'` for every non-`kept` row. Rows i and iv fail.

### AC-1d — attribution must never contradict what shipped (the `skillLineage` parity invariant)

> **Given** a slot whose shipped value equals Call 2's list under `sameList` (i.e.
> `skillLineage(...).winner === 'call2'`),
> **when** `buildSwaps` attributes that list's rows,
> **then** **no** row in that list carries `pass === 'call_3'`, and no rationale string contains
> "ATS pass".

This is the single highest-value guard in the set: it is the assertion that the provenance the
screen shows cannot disagree with the document the owner sends.

**Settles it** — `test('H:swaps-lineage-parity: no row credits a pass the shipped slot did not come from')`
building the same `(c1,c2,c3,pkg)` fixture through BOTH `skillLineage` and `buildSwaps` and
cross-asserting. Must run over a fixture where `pkg` carries the `- ` prefix that F16 documents, so
the parity test exercises the real formatting divergence rather than a clean one.
**Mutation** — restore the current literal `'introduced by the ATS pass'` on the `added` branch.
Test must fail on the `winner==='call2'` fixture.

---

## AC-2 — `skill_candidate.origin` vocabulary

### AC-2a — a new value is a SCHEMA change, not a TypeScript change

> **Given** `schema.ts:436` `check (origin in ('profile_original','pass_a','pass_b'))` (F10),
> **when** a candidate row with any new origin value is inserted,
> **then** the insert fails with `violates check constraint` **unless** the CHECK has been widened —
> and because `writeSwaps` wraps all inserts in one transaction (F13), that failure discards the
> ENTIRE pass's provenance for that packet, silently, behind
> `catch (e) { console.warn('[packets] swap provenance not recorded:', ...) }` (`appPackets.ts:429`).

**Settles it** — the mandatory local-Postgres migration drill in CLAUDE.md: apply
`origin/main`'s `SCHEMA_SQL`, **seed `skill_candidate` rows with `pass_a`/`pass_b`**, then apply the
new `SCHEMA_SQL` on top with `ON_ERROR_STOP=1`, then insert one row per NEW origin value and assert
exit 0. A fresh-DB run does not satisfy this (the `check` is inline in `create table if not exists`
and is skipped on the populated DB — so the widening MUST be a separate idempotent
`alter table ... drop constraint ... / add constraint ...`, and `H39`/`H39b` ordering applies).
**Mutation** — omit the `alter table` and rely on the inline `check`. The populated-DB run must fail
the new-value insert. If it passes, the drill was run against a fresh DB and proves nothing.

### AC-2b — ADD values; never redefine an existing one

> **Given** rows already stored with `origin='pass_b'`, which under the two-pass model meant "in the
> final list but not in Call 1's list" — an assertion that cannot distinguish Call 2 from Call 3,
> **when** the vocabulary is extended,
> **then** `pass_a` and `pass_b` keep their old meanings verbatim and are **never** reassigned,
> **no backfill is run**, and new rows use a distinguishable new vocabulary
> (`call_1` / `call_2` / `call_3`, plus the unchanged `profile_original`).

**Recommendation (mine, for sign-off):** add `call_1`,`call_2`,`call_3`; keep `pass_a`,`pass_b` in the
CHECK forever as historical-only. Because the vocabularies are disjoint, **a reader can tell a
pre-change row from a post-change row by the value alone** — no `built_at` comparison, no migration
flag. The tempting alternative (redefine `pass_b` = Call 2, add `pass_c` = Call 3) silently rewrites
the meaning of every historical row and must be rejected.

> **A stored historical row means, after the change:** "this label was in the final list and not in
> Call 1's — which of Call 2 or Call 3 put it there was not recorded." That sentence, not a guess,
> is what any UI or export must render for a `pass_b` row.

**Settles it** — `test('H:origin-vocab-additive: pass_a/pass_b are never emitted by new code and never rewritten')`:
(1) `buildSwaps` output contains no `pass_a`/`pass_b`; (2) a source grep proves no `update
skill_candidate set origin` statement exists anywhere in `api/src`; (3) the schema CHECK still lists
`pass_a` and `pass_b`.
**Mutation** — add a backfill `update skill_candidate set origin='call_3' where origin='pass_b'`.
Guard (2) must fail.

### AC-2c — does adding a value break existing readers? Measured answer: NO

> **Given** the full-tree grep in F11 — `origin` is read by **no** file in `app/src` (including
> `assetBlocks.js` and `qcRail.js`) and by no file in `api/src` outside `swaps.ts` and `schema.ts` —
> **when** a third pass value is introduced,
> **then** no frontend rendering changes, and the only breakage surface is the DB CHECK (AC-2a).

Note the contrast that makes this safe: `assetBlocks.js:256` **does** render `action` and `driver`
as raw interpolated strings (`` `${swap.action} · ${swap.driver}` ``, F12). So a new **`origin`**
value is invisible and safe; a new **`action`** or **`driver`** value would print raw text into the
packet screen.

> **Therefore (AC-2c-ii):** this change MUST NOT add a new `Action` or a new `Driver` value. Pass
> attribution goes in its own field.

**Settles it** — `test('H:no-new-action-or-driver: the Action and Driver unions are unchanged by the three-pass work')`
asserting the exact sorted union members against a frozen literal list, plus a grep that
`assetBlocks.js` still has no `origin` reference.
**Mutation** — add `'refined'` to `Action`. Test fails.

---

## AC-3 — counts must reconcile with what shipped (no false accusation)

> **Given** any `(call1, call2, call3, pkg)`,
> **when** `buildSwaps` returns,
> **then** for EVERY list, all four of these hold:
> 1. `kept + swapped + merged + dropped === originals.length`
> 2. `kept + swapped + added === finals.length` (`merged` claims no new final — that is why it exists)
> 3. every row with `action ∈ {kept, swapped, merged, added}` has a non-null `to_label` that is
>    `normItem`-present in the shipped final list
> 4. every `dropped` row's `from_label` is `normItem`-**absent** from the shipped final list

Criterion 3 is the invariant the brief asks for: **a row saying "swapped" for an item absent from the
final merged list is a false accusation** — it tells the owner their resume says something it does
not. Criterion 4 is its mirror: claiming an item was dropped while it is still in the document.

> **AC-3b — the invariant must hold *per pass* as well.** `swapsGet` computes `changed` and
> `unattributed` from `current` = max-`loop` rows only (F13). Adding a pass dimension must not
> tempt anyone to emit two rows for one item (one per pass): `swaps.filter(s => s.list===L &&
> s.to_label===X && s.action!=='merged').length <= 1` for every `(L, X)`.

**Settles it** — `test('H:swaps-counts-reconcile: every row names an item the document actually contains')`,
run as a **property test** over ≥200 randomised `(originals, finals)` pairs including: empty lists,
identical lists, total replacement, 2→1 merges, duplicate labels within one list, and labels differing
only by trailing punctuation (`normItem` strips `[.;:,]+$`).
**Mutation A** — delete the `claimed.add(bestI)` on the swap branch (line 204). Duplicate claiming
breaks (2) and (3); test fails.
**Mutation B** — change the `merged` branch to push `'swapped'`. Breaks (2); test fails.

---

## AC-4 — the model's own swap reasoning: stored ALONGSIDE, never replacing

The owner's Call 2 prompt asks for "a detailed reason why the skill was swapped or not". That prose
is **evidence of the model's intent**, not evidence about the candidate. `packetBuild.ts:85-91`
(F18) already states the boundary; this AC makes it enforceable for `swap_decision`.

### AC-4a — the exact fields model prose MUST NOT reach

> **Given** any model-produced reason text,
> **when** provenance is persisted,
> **then** it is written to exactly one new nullable column — **`swap_decision.model_reason text`** —
> and to nothing else. It MUST NOT be written to, or influence the value of, ANY of:

| Table | Columns that must never receive model prose |
|---|---|
| `swap_decision` | `requirement_id`, `verbatim_quote`, `confidence`, `driver`, `action`, `rationale`, `from_label`, `to_label`, `from_candidate_id`, `to_candidate_id`, `list`, `loop`, `seq` |
| `skill_candidate` | `label`, `origin`, `char_len`, `list`, `loop` |
| `requirement` | `verbatim`, `item_text`, `kind`, `seq` |
| `requirement_evidence` | all columns |
| `check_result` | all columns |
| `artifact_score` | all columns |
| `insertion` | `after_text`, `before_sha256` |

Specifically: `verbatim_quote` stays **the employer's words only** — it comes from
`attribute() → r.verbatim` (F4/F14) and from nowhere else. `confidence` stays the **derived token
overlap**, a number the model never sees. `driver` stays one of `posting|rule|unattributed`, decided
by `attribute()` and the omit-list branch only (F14). `rationale` stays the **derived** sentence.

**Extend-don't-duplicate note:** one nullable column on `swap_decision` — not a new
`swap_reason` table. A separate table would be a second provenance brain over the same
`(packet_id, list, loop, seq)` key.

### AC-4b — the reason must not move a count, a score, or a gate

> **Given** two builds identical except that one has `model_reason` populated on every row,
> **when** `buildSwaps`, `swapsGet`, and every check/score consumer run,
> **then** `itemCount`, `unattributed`, `changed`, every `driver`, every `confidence`, and every
> `check_result` / `artifact_score` value are **byte-identical** between the two.

This is the guard that keeps model prose out of the accusation path even if someone later "improves"
attribution by reading it.

**Settles it** —
`test('H:model-reason-inert: populating model_reason changes no derived value')`: run `buildSwaps`
twice on the same fixture, once with reasons attached, and `assert.deepEqual` after stripping
`model_reason`. Plus `test('H:model-reason-column-isolation: ...')` — a **source grep** over
`api/src/**` asserting the identifier `model_reason` appears in exactly the persist statement and
the read projection, and never within the same statement as `requirement_id`, `verbatim_quote`,
`confidence`, `driver`, `check_result`, `artifact_score` or `requirement_evidence`
(comments stripped first, per H-case rule 2 — do not cry wolf on a doc comment).
**Mutation A** — set `rationale: modelReason || rationale`. `H:model-reason-inert` must fail.
**Mutation B** — set `verbatim_quote: modelReason` when no attribution is found. Both guards fail.
**Mutation C** — make `unattributed` skip rows that have a `model_reason`. AC-4b fails.

### AC-4c — an unparsed or absent reason is `null`, never a fabricated one

> **Given** Call 2 returned no parseable reason for an item (the common case — F/`pipeline.ts:379`
> warns Call 2 can produce **no** recognisable `###` sections at all),
> **when** the row is written,
> **then** `model_reason` is `NULL` — never `''`, never a derived sentence copied in, never a
> placeholder.

Per the repo's standing rule: **absent evidence is `not_applicable`, never `pass`**; and a screen
that shows a derived sentence in a field labelled "the model's reason" is fabrication.
**Settles it** — fixture with `call2={}`; assert every `model_reason === null`.
**Mutation** — default it to the derived `rationale`. Test fails.

### AC-4d — the reason is length-capped, like `collectAnalysis` already caps analysis

> **Given** `ANALYSIS_SECTION_MAX = 4000` / `ANALYSIS_TOTAL_MAX = 24000` already exist for exactly
> this reason (`packetBuild.ts`: "an uncapped diagnostic column is a table that grows without anyone
> deciding it should"),
> **when** `model_reason` is stored,
> **then** it reuses those exported constants rather than introducing a third cap, and truncation is
> recorded (a `…` marker or a boolean), never silent.

**Settles it** — assert a 10,000-char reason is stored truncated AND flagged.
**Mutation** — remove the cap. Test fails.

---

## AC-5 — `skillLineage` / `collectAnalysis` overlap: FOLD THE COMPARISON, KEEP THE SURFACES

**Recommendation: keep both surfaces; extract the one shared primitive; add a parity guard.**

Reasoning, against "Extend, don't duplicate":
- What genuinely duplicates is the **pass-precedence comparison** (`sameList` + call3→call2→call1
  order, `packetBuild.ts:113-141`) versus the new per-item pass attribution in `swaps.ts`. Two
  independent implementations of "which pass wrote this" is precisely the two-role-brains failure
  the repo's rule names. **Extract `sameList`/the precedence order into one exported helper and have
  both call it.**
- What must NOT be merged is the **storage**. `packetBuild.ts:85-91` (F18) is an explicit,
  already-agreed boundary: `last_build` is diagnostic (nothing scores off it), `swap_decision` is
  accusation-grade. Folding `skillLineage` INTO `swap_decision` would move raw per-call payloads
  into the accusation table; folding `swap_decision`'s attribution OUT into `last_build` would put a
  claim about the candidate somewhere no gate can audit. Both are worse than the small duplication.
- `collectAnalysis` does not overlap at all — it captures `_unmapped` sections, a different artefact.
  **Leave it entirely alone.**

> **Given** the same `(c1, c2, c3, pkg)`,
> **when** `skillLineage` reports `winner` for a slot and `buildSwaps` attributes that slot's rows,
> **then** the two agree: `winner === 'call2'` ⇒ no row in that list has `pass === 'call_3'`
> (this is AC-1d), and `winner === 'none'` ⇒ at least one row has `pass === 'assembled'`.

**Settles it** — `test('H:lineage-swaps-one-brain: pass precedence has exactly one implementation')`:
(1) the behavioural parity assertion above; (2) a source grep proving the `call3 → call2 → call1`
precedence literal and the bullet-stripping normaliser each appear in exactly ONE module.
**Mutation** — copy `sameList` into `swaps.ts` and let it drift (e.g. drop the `•` from the bullet
class). Guard (2) fails; guard (1) fails on a `•`-prefixed fixture.

---

## AC-6 — regression: nothing changes for packets built before this

### AC-6a — the two-pass call path is byte-identical

> **Given** `buildSwaps` invoked WITHOUT a `call2` argument (the exact shape of all 15 existing
> assertions in `api/test/swaps.test.mjs`),
> **when** it runs,
> **then** `candidates`, `swaps`, `itemCount` and `unattributed` are **deepEqual** to `origin/main`'s
> output for the same input — including origins (`pass_a`/`pass_b`), rationales, drivers and
> confidences.

Concretely: `call2` is **optional**, defaulted to `{}`, and when it is empty the module must fall
back to today's exact behaviour. This is what makes the change safe to deploy without a backfill.

**Settles it** — a golden-file test: check in `api/test/fixtures/swaps-golden.json` generated from
`git show origin/main:api/src/functions/tests/swaps.ts`, and assert the new module reproduces it
exactly for ~12 inputs. **Plus: the existing `api/test/swaps.test.mjs` must pass unmodified** — if a
line of that file has to change, AC-6a is failed, and the diff must be justified in this document.
**Mutation** — make `call2` required, or make the empty-`call2` path emit `call_1` instead of
`pass_a`. Golden test fails.

### AC-6b — no stored row is rewritten, and the read API shape is unchanged

> **Given** packets built before this change,
> **when** `GET /api/app/packet/{id}/swaps` is called,
> **then** the response still has exactly the keys `{packetId, loop, candidates, swaps, current,
> passes, changed, unattributed}` (`appSwaps.ts:107-111`), `changed`/`unattributed` return the same
> numbers as before, and every historical `skill_candidate.origin` still reads `pass_a`/`pass_b`.

Note `passes` here means **`loop` values**, not generation calls. **Do not overload it.** A third
generation pass introduces a name collision with the remediation-loop vocabulary; if a
pass-attribution summary is added to the response it needs a distinct key (e.g. `byGenerationPass`),
never a redefinition of `passes`.

**Settles it** — live check via `api-test.yml`:
`GET /api/app/packet/<pre-change-packet-id>/swaps?owner=von.ellis@enterpriseds.io`, run BEFORE the
deploy and again after, and diff the two JSON bodies (they must be identical); plus a unit assertion
on the response key set.
**Mutation** — rename `passes` to carry generation passes. Key-set assertion + the live diff fail.

### AC-6c — `assetBlocks.listBodyModel` still renders every pre-change packet

> **Given** the live consumer chain `app/src/api.js packetSwaps → app/src/assetBlocks.js
> listBodyModel`, which keys swaps by `normLabel(s.to_label)` and renders
> `` `${swap.action} · ${swap.driver}` `` (F12),
> **when** rows with a new `pass` field are returned alongside rows without one,
> **then** the rendered `status`, `from`, `dropped` and `sharedNote` values are unchanged for rows
> without a `pass`, and a missing `pass` never renders as `undefined` anywhere on screen.

**Settles it** — `app/test/` unit test on `listBodyModel` with a mixed old/new row array; plus a live
`ui-verify.yml` run against the packet screen for a **pre-change** packet, `expect` set to a string
that must be present and to the absence of `undefined` in the body snippet.
**Mutation** — interpolate `pass` into `status` unconditionally
(`` `${swap.action} · ${swap.driver} · ${swap.pass}` ``). Old rows render `undefined`; test fails.

### AC-6d — provenance failure stays non-fatal, and stops being silent

> **Given** the new persist can now fail on a widened-but-not-migrated CHECK (AC-2a),
> **when** `writeSwaps` throws,
> **then** the packet build still succeeds (today's `catch` at `appPackets.ts:429` is preserved) —
> **and** the failure is surfaced in the build's `warnings` array, not only to `console.warn`.

Today a CHECK violation makes an entire packet's provenance vanish with only a server-log line. That
is the "a 200 with a zero count is a result to investigate, not a pass" rule applied to this path.
**Settles it** — inject a throwing client; assert the build returns and that `warnings` contains a
string naming swap provenance.
**Mutation** — remove the warning push. Test fails.

---

## AC-0 addendum — the most likely explanation of the 2-vs-4 gap, and the query that settles it

`assemblePackage` is `firstNonEmpty(call3.finalSkills1, call2.skills1, call1.skills1, splitS1)`
(`mt17.ts:148`) — confirmed by reading. Combined with the brief's ground truth that Call 3 returns
nothing for `finalSkills1`, **the shipped list IS Call 2's list**. So a `swap_decision` set that
reports only 2 differences from Call 1 cannot have been computed against that shipped list.

**Leading hypothesis (inference — confidence medium-high; NOT verified, no live DB from here):**
the stored `swap_decision` rows predate the Call-2 parse fix. `pipeline.ts:355-375` records that
Call 2 "was parsed with `parseAgentJson`, warned … and fell back to Call 1 — **on every build**".
On such a build `c2` was `{}`, `assemblePackage` fell through to `call1.skills1`, and near-total
`kept` is the CORRECT answer for that build. The `last_build.lineage` showing four Call-2
replacements was written by a LATER build (commits `f8acc52`, `e5a75f4`, `1cb9927` are all from
today). Both artefacts would then be individually right and describing different generations.

**The single query that settles it** (both tables carry `created_at`, `schema.ts:441,469`):
```sql
select 'swap'  src, min(created_at) lo, max(created_at) hi, count(*) from swap_decision s
   join packet p on p.id=s.packet_id where p.opp_id='9f9c370a-4ac9-441e-b58e-02e3ffcf669e'
union all
select 'cand', min(created_at), max(created_at), count(*) from skill_candidate c
   join packet p on p.id=c.packet_id where p.opp_id='9f9c370a-4ac9-441e-b58e-02e3ffcf669e'
union all
select 'packet', min(updated_at), max(updated_at), count(*) from packet
  where opp_id='9f9c370a-4ac9-441e-b58e-02e3ffcf669e';
```
If `packet.updated_at` > `max(swap_decision.created_at)`, the hypothesis holds and the screen is not
under-reporting so much as showing a **stale pass** — which is a **different bug with a different
fix** (re-run `writeSwaps`, or key the read on the build that produced it) and would mean the
three-pass rewrite, on its own, does not fix what the owner is looking at.

> **This is why AC-0 blocks.** Shipping the three-pass change against the wrong diagnosis would leave
> the reported symptom intact and be reported as fixed.

---

## Additional schema facts found while writing AC-2

| # | Fact | How established |
|---|---|---|
| F19 | `action` and `driver` ALSO carry CHECK constraints (`schema.ts:454,466`), and both tables carry `created_at timestamptz default now()` (`:441,:469`). `swap_decision` has `unique (packet_id, list, seq, loop)`. | Read `schema.ts:425-470` |
| F20 | `verbatim_quote text, -- the EMPLOYER's words, never a paraphrase` is already a schema-level comment (`schema.ts:459`). AC-4a is enforcing an existing stated contract, not inventing one. | Read `schema.ts:459` |
| F21 | **A stale, actively-wrong comment sits above `swap_decision`:** "There is no omission list in this pipeline, so a change nothing explains is 'unattributed' - NOT 'rule'" (`schema.ts:446-447`). `swaps.ts:13-21` explicitly documents this as **confirmed wrong** and emits `driver='rule'` for omit-list drops. The schema comment must be corrected in the same commit. | Read both |

---

# CRITIQUE — what is risky, what I have probably got wrong, what contradicts the brief

## 1. The brief's premise is partly wrong, and this is the most important thing here

The brief says Call 2 "is not an input" and frames the fix as making the comparison three-pass aware.
**Observation:** `buildSwaps` line 175 already uses `pkg[f.merge]` — the assembled, corrected package
— as the "after" side, and `mt17.ts:148` proves that package IS Call 2's list when Call 3 is empty.
**Interpretation:** the after side is already correct. The real defects are (a) **provenance** —
every Call-2 insertion is labelled `pass_b` and rationalised as "the ATS pass", which is a false
sentence; and (b) possibly **staleness** (AC-0 addendum), which the three-pass change would not fix
at all. If the implementer accepts the brief's framing and "adds Call 2 as the after side", they will
make the after side **worse** — moving it off what shipped and onto an intermediate payload,
violating AC-1a.

## 2. What I could not verify, and am therefore not claiming

- **I did not reach the live database.** Every statement about opportunity
  `9f9c370a-…`'s stored rows is the brief's measurement plus my arithmetic on it, not my observation.
  The 2-vs-4 reconciliation is unresolved and AC-0 exists because of that.
- **I did not run any test.** No fixture in this document has been executed. The similarity
  arithmetic (`Stakeholder Collaboration`→`Stakeholder Engagement` = 0.5) is hand-computed from
  `itemTokens`/`STOP` and could be wrong if `stakeholder` or `collaboration` is a stopword — I read
  the `STOP` list and neither is in it, but I did not execute `similarity()`.
- **I did not read `applyCorrectionPass`.** I know from `appPackets.ts:405-416` that it runs on `pkg`
  before `writeSwaps` and from `packetBuild.ts:113-125` that it strips bullet prefixes. Whether it
  can change an item's *words* (not just formatting) is unverified — and if it can, AC-1b's
  `'assembled'` case is not an edge case but the common one, and `normItem` equality against call
  payloads will under-match. **Read it before implementing AC-1b.**
- **`skillLineage`/`collectAnalysis` were added today** (`f8acc52`) and may still be in flux. My
  AC-5 recommendation assumes they stay.

## 3. Where these criteria are most likely to be wrong

- **AC-1b (earliest pass) may be the wrong semantic.** I chose "earliest pass that introduced the
  item" because crediting Call 3 for Call 2's work is the observed false statement. But an owner
  asking "who changed my resume last" may want the LATEST pass that touched the slot. These give
  opposite answers in case (ii). **This needs an owner decision, not an AC-writer's choice** — I
  have written the criteria for "earliest" and flagged it here rather than hiding the choice.
- **AC-2b's `call_1/call_2/call_3` vocabulary is a recommendation, not a derived requirement.** Its
  one strong property is that the vocabularies are disjoint so historical rows self-identify. If the
  owner prefers `pass_a/pass_b/pass_c`, AC-2b's *additive, no-backfill, no-redefinition* rule still
  applies and is the part that matters.
- **AC-3's equation (2) assumes `merged` never claims a final.** That is true of today's greedy
  implementation but is an invariant I am *inferring* from `swaps.ts:211-219`, not one anyone stated.
  If a three-pass version ever emits a per-pass `merged` chain, equation (2) breaks legitimately and
  the guard becomes a cry-wolf. AC-3b is my attempt to pre-empt that; it may be insufficient.
- **AC-4d assumes reusing `ANALYSIS_SECTION_MAX` is right.** A per-item swap reason is a much smaller
  object than an unmapped analysis section; a 4,000-char cap per swap row across ~50 rows per packet
  is 200KB per build. That cap is probably too generous, and the right number needs measuring against
  a real Call-2 reply. Per the repo's no-hardcoded-config rule, whatever number is chosen should be
  an owner-changeable setting seeded in code, not a literal.

## 4. The risk I would rank first

**AC-2a.** The `origin` CHECK constraint sits inside `create table if not exists`, so the migration
is skipped on the production database, and the failure mode is not an error the owner sees — it is
`writeSwaps` throwing inside a transaction, rolling back the entire pass, and being swallowed by
`catch (e) { console.warn(...) }` at `appPackets.ts:429`. **The packet builds fine and its whole
provenance record silently vanishes.** That is the exact shape of the two migration-killing defects
CLAUDE.md documents, on the exact code path this change touches. The populated-DB drill in AC-2a is
not ceremony; it is the only thing that catches it. AC-6d turns the silence into a warning.

## 5. One thing to fix that is not in scope but is in the blast radius

`schema.ts:446-447` asserts "There is no omission list in this pipeline" while `swaps.ts:220-226`
emits `driver='rule'` for omit-list drops and `swaps.ts:13-21` documents the comment as confirmed
wrong (F21). A reader auditing an accusation-grade table is told by the schema that a value the code
routinely writes cannot occur. Correct the comment in the same commit; it costs nothing and it is
the kind of stale note that produces the next wrong first answer.

---
*End of acceptance criteria. Written by an independent AC subagent before implementation.
No file other than this one was modified.*
