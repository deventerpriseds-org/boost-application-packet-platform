# Acceptance criteria — the three prompt-path fixes (D31, D32, D33)

Written **before any code**, by an independent AC pass, against the repo at `ef89dfb`
(`Settle D31 and D33 from the 42 warnings the queue finally let us read`).

**Owner's hard constraint, verbatim:** *"i still want my original prompts to be driving what the
resume draft is"*. Every criterion below is subordinate to it. Evidence/QC may affect grading and
scoring; it may never affect the draft. **No row in the `Prompts` table is edited by any of this
work** — that is AC-0 and it applies to all three changes.

---

## 0. Ground truth I established myself (read this before the criteria)

I did not take the stated facts on trust. What follows is what I could prove **from a primary
source inside the sandbox**, separated from what I could only infer.

### 0.1 OBSERVED — the Call-2 prompt is a SKILLS prompt, not a portfolio prompt

The single source that settles what Call 2 is asked to produce is the zap node the live row was
seeded from, checked into this repo. Measured with a script, not by eye:

| file | block | chars | mentions of "json" | `### … ###` headings it asks for |
|---|---|---|---|---|
| `docs/zap-289877647/prompts/16-…-prompt.md` (node 289877661, the RESUME node) | user_message | **29,069** | **0** | Date, Target Job Title, Skills1, Skills2, Relevant Skills bullet list 1, About Me 1, Job Description Summary, Second Job Description Check, Missing ATS Skills, Missing ATS Swap Suggestions, Skills1, Skills2, Relevant Skills 1, Skills1, Skills2, Word and Character Requirements Check |
| `docs/zap-289877647/prompts/17-copy-…-prompt.md` (node 299599701, the node `portfolio_user` should carry) | user_message | **7,712** | **0** | **Skills1, Skills2, Relevant Skills 1, Relevant Skills 2, Relevant Skills 3, Word and Character Requirements Check** |

D31 records live `portfolio_user` v002 at **7,714 chars**; node 299599701's user_message is
**7,712**. Within two characters (trailing whitespace) — so the live row is this file, and the
prompt-repair described in `pipeline.ts:96-141` has already been applied. **This is the
disconfirming check the fact list did not have, and it changes change 1 materially.**

Read in full, prompt 17 asks for exactly three things:

1. `### Skills1 ###` and `### Skills2 ###` (20-22 skills, evenly split, ≤30 chars each);
2. `### Relevant Skills 1/2/3 ###`;
3. *"generate a table formatted with html tags"* — the 5-column swap table (source list, pre-swap
   item, swapped item, Same/Swapped, **a detailed reason why**), and
   `### Word and Character Requirements Check ###` → `return "Removed"`.

**It never asks for a cover letter, About Me 1, About Me 2, an executive profile, or a cold email.**
Zero occurrences of any of those strings.

### 0.2 OBSERVED — `assemblePackage` reads exactly six keys off Call 2, and Call 2 produces none of them

`api/src/functions/tests/mt17.ts:74-103`. Every use of `call2`:

```
ResumeSummary                        : firstNonEmpty(call3.updatedResumeSummary, call1.resumeSummary, call2.resumeSummary)
'@CoverLetterBody'                   : call2.coverLetter    || call1.coverLetter    || null
'@AboutMe1_50words'                  : call2.aboutMe1       || call1.aboutMe1       || null
'@AboutMe2_60words'                  : call2.aboutMe2       || call1.aboutMe2       || null
'@ExecutiveProfile_55words'          : call2.executiveProfile || call1.executiveProfile || null
coldEmail                            : call2.coldEmail      || null
```

`call2.skills1`, `call2.skills2`, `call2.relevant1/2/3` are **not read anywhere**. So the two facts
compose into a conclusion the fact list gets backwards:

> **Swapping the Call-2 parser from JSON to sections, on its own, changes NOTHING in any document.**
> The section parser would return `skills1/skills2/relevant1-3` from Call 2; `assemblePackage`
> ignores all five. `@CoverLetterBody`, `@AboutMe*`, `@ExecutiveProfile` would keep coming from
> Call 1 — not as a fallback any more, but because Call 2 genuinely has nothing to offer them.

The brief's framing — *"portfolio and cover fields would start coming from Call 2 instead of falling
back to Call 1"* — is **false against the live prompt**. It would only become true if the change
ALSO edits `assemblePackage` to read Call 2's skills, which is a different and much larger decision.
§1 is written for both readings and says which one I think is right.

### 0.3 OBSERVED — the real hazard in change 1 is `{...c1, ...c2}`, not the merge order

`pipeline.ts:357` feeds Call 3 its inputs as `JSON.stringify({ ...c1, ...c2 })`. Today `c2 = p2.value
|| {}` is **always `{}`**, so that spread is a no-op and Call 3 sees Call 1 verbatim.

`parseResumePackage` (`resumeParser.ts:158-200`) returns **every key unconditionally**, defaulted
with `|| ''` — `resumeSummary`, `skills1`, `skills2`, `expertise`, `relevant1-3`, `coverLetter`,
`aboutMe1/2`, `executiveProfile`, `coreAccomplishments` — plus `date`, `targetRole`, `targetCompany`
with **manufactured fallbacks** (today's date, the job title, the company) and `workHistory1-4`
**pulled from MasterContext**.

So if change 1 is implemented as `const c2 = parseResumePackage(r2Content, mc, jobTitle, company)`:

* every field Call 2 did not produce arrives as `''` and **overwrites Call 1's real content** in the
  Call-3 input spread — `expertise`, `coverLetter`, `aboutMe1/2`, `executiveProfile`,
  `coreAccomplishments`, `resumeSummary` all blanked for the ATS QC pass;
* `workHistory1-4` would be re-read from MasterContext and re-spread, and `date`/`targetRole`/
  `targetCompany` re-manufactured — content Call 2 never generated, attributed to Call 2;
* `c2._unmapped` silently replaces `c1._unmapped` in that same spread.

This is the concrete mechanism by which change 1 **silently degrades documents that are currently
acceptable**: the ATS QC pass (Call 3) would grade a blanked package and its `finalSkills*` /
`updatedResumeSummary` outputs — which **win over Call 1 in `assemblePackage`** — would be produced
from it. That reaches the draft. It is the highest-severity item in this document.

### 0.4 OBSERVED — the D33 discards are Call 1's, and the analysis titles are asked for by the OWNER's resume prompt

`pipeline.ts:328-332` warns only over `c1._unmapped`. Call 2's unmapped sections are not warned
about at all today (its whole reply is discarded upstream by `parseAgentJson`). Every title D33
lists — `Job Description Summary`, `Second Job Description Check`, `Missing ATS Skills`,
`Missing ATS Swap Suggestions`, `Word and Character Requirements Check` — appears verbatim in the
node-16 heading list above. They are **the owner's own resume prompt asking for its QC working**,
not prompt cruft. That is the strongest argument for change 2 and I did not have to infer it.

### 0.5 OBSERVED — role focus already has a per-role store; what is missing is a WRITER

`roleFocus.ts:91-99` reads `AppConfig` partition `templates`, RowKey `roleRowKey(roleType)` =
`roleType.toLowerCase().replace(/\s+/g,'-')`, column `roleFocus`. The five-way precedence
(`appconfig` → `persona` → `inferred` → `configured_default` → `seed`) is already built and unit
tested (`api/test/roleFocus.test.mjs`).

`POST /api/config` (`api/src/functions/config.ts:58-93`) upserts **only** `partitionKey: 'auth'` and
**only** RowKeys in `Object.values(CONFIG_KEYS)`. There is **no writer anywhere in the codebase for
`AppConfig/templates/<slug>.roleFocus`** — I grepped: the only touches are `getEntity` reads
(`roleFocus.ts:96`, `pipeline.ts:466`, `mt19.ts:60`) and `mt12.ts:26`, a test-harness seeder.

**So change 3 is not "build a per-template setting". The store exists and the resolver reads it.
The gap is one write path and one control.** Anything that creates a new table, a new partition, or
a second precedence chain violates extend-don't-duplicate against a system that is already correct.

### 0.6 INFERRED (not proven here) — the live-only facts

I cannot reach the Function App, the `Prompts` table, Postgres, or job `945e28ed` from this sandbox
(`CLAUDE.md`: egress blocks `azurewebsites.net`; DB creds are not env vars here). Taken as reported
in D31/D33 and **not independently confirmed**: the four discard sizes 2,957 / 3,178 / 4,736 / 5,404;
`packet.pkg_json` at 8,065 chars with every draft field populated; the 2,694-char
`Second Job Description Check`; the live `roleFocus` warning naming
`templates/director-of-digital-technology-operations-&-innovation`. Each criterion below that
depends on one of these names the workflow that would confirm it.

### 0.7 OBSERVED — second consumer of `portfolio_user`, on a legacy path

`mt19.ts:95-99` builds its own Call 2 from `prompts['portfolio_user']` and parses it with
`r2Content.match(/\{[\s\S]*\}/)` — the greedy regex `agentJson.ts` was written to replace. It is the
legacy MT-XX harness (`web/`, not the product) but it is a real consumer and §1 covers it.

---

## Change 1 — parse Call 2 with the `### Title ###` section parser instead of `parseAgentJson`

**Tier:** treat as **tier 1**, not tier 2. `CLAUDE.md`'s table says tier 1 is *"anything that admits
model output into a stored claim"* and is a property of the code path, not the diff size. Call 2's
parsed output flows into `{...c1,...c2}` → Call 3 → `assemblePackage` → `pkg_json` → `writeSwaps`
(`swap_decision` rows that name which skill was swapped and why) and → `applyCorrectionPass`. A
one-line parser swap here reaches stored claims and the owner's documents. Independent AC (this
document) before code, independent `verifier` after.

**Scope decision the build must make FIRST, in writing, before any code:** §0.2 proves the parser
swap alone is a no-op on documents. There are two candidate scopes and they are not the same change:

* **Scope A — parse only.** Replace `parseAgentJson(r2)` with a section parse. Documents byte-identical.
  Value delivered: Call 2's skills and its swap-reasoning table become *available* (feeding change 2),
  and the false warning *"Call 2 returned no JSON object"* stops. **This is the scope I recommend.**
* **Scope B — parse and consume.** Additionally change `assemblePackage` so `call2.skills1/skills2/
  relevant1-3` outrank Call 1's. This **does** change documents, and it changes the *resume draft*,
  which is the surface the owner's hard constraint protects. It is a separate owner decision and must
  not ride in on change 1.

AC-1.0 through AC-1.9 apply to Scope A. AC-1.10+ apply only if the owner explicitly signs off on B.

---

### AC-1.0 (blocking, precedes all others) — the prompts are untouched

**Given** the owner's constraint that their original prompts drive the draft, **when** change 1 is
complete, **then** no `Prompts` table row's `content`, `version`, or `is_active` differs from its
pre-change value, and no file under `prompts/` or `docs/zap-289877647/prompts/` is modified.

* **Settles it:** `git diff --stat <base>..HEAD -- prompts/ docs/zap-289877647/` returns empty; and
  `api-test.yml` `GET /api/prompts?key=portfolio_user` before and after returns the same
  `version` and `length` (7,714). Compare the two run logs, not a memory of the first.
* **Mutation:** bump `version` on a scratch row in a throwaway build and confirm the comparison
  reports a difference. If it reports "same", the check is reading the wrong field.

### AC-1.1 — Call 2 is parsed by the section grammar, and the JSON warning is gone

**Given** a Call-2 reply that is `### Skills1 ###`-delimited plain text with an embedded HTML table,
**when** `buildPackageForJD` parses it, **then** the run's warnings contain **no**
`Call 2 (portfolio) returned no JSON object` line, and `steps` records the section count parsed
(e.g. `Agent Call 2 (skills/ATS) — parsed N sections by title`).

* **Settles it:** a new unit test in `api/test/` that feeds a captured real Call-2 reply (the exact
  shape prompt 17 asks for: 5 headings + an HTML table + `Removed`) through the new parse function
  and asserts `skills1`/`skills2`/`relevant1`/`relevant2`/`relevant3` are non-empty. **Do not use a
  hand-written fixture that happens to parse** — build the fixture from the heading list in
  `docs/zap-289877647/prompts/17-copy-…-prompt.md`, which is the contract.
* **Mutation:** revert the parse to `parseAgentJson` and the test must fail with all five fields
  empty. If it still passes, the test is asserting on Call 1's output by accident.

### AC-1.2 — the Call-2 result is an ALLOWLIST, never a whole `parseResumePackage` shape

**Given** `parseResumePackage` returns every key defaulted to `''` plus MasterContext work history
and a manufactured `date`/`targetRole`/`targetCompany` (§0.3), **when** Call 2 is parsed, **then**
the returned object contains **only keys Call 2's own prompt asks for** — the five skills/relevant
keys and nothing else — and **carries no key whose value is `''` or was sourced from MasterContext**.

* **Settles it:** unit test asserting `Object.keys(c2)` is a subset of the declared allowlist AND
  that no value is the empty string; plus a source-level guard (grep-style, in `hardening.test.mjs`)
  that `pipeline.ts` does not call `parseResumePackage(` with `r2`/`base2`/`c2` in scope.
* **Mutation:** implement Call 2 as `parseResumePackage(r2Content, mc, jobTitle, company)` and both
  assertions must fail — the key set explodes and `expertise: ''` appears.

### AC-1.3 (highest severity) — the Call-3 input must not lose a single character of Call 1

**Given** Call 3's inputs are `JSON.stringify({ ...c1, ...c2 })` (`pipeline.ts:357`) and today
`c2 === {}`, **when** Call 2 now returns a populated object, **then** for every key present in `c1`
with a non-empty value, the object handed to Call 3 carries a value that is **either byte-identical
to `c1`'s or a non-empty value Call 2 actually generated** — never `''`, never `undefined`, never a
MasterContext re-read.

* **Settles it:** a unit test on the extracted merge function (extract it — the current inline
  spread cannot be tested without a live OpenAI key) that takes a realistic `c1` and a Call-2 object
  missing most keys, and asserts no key transitions non-empty → empty. Assert on the **full key
  set**, not a sample.
* **Mutation:** restore the naive `{...c1, ...c2}` with a `c2` carrying `coverLetter: ''` and the
  test must fail naming `coverLetter`. A test that only checks `skills1` will pass and is inert.
* **Why this is the one to get right:** Call 3's `finalSkills1/2`, `finalRelevant1/2/3` and
  `updatedResumeSummary` **outrank Call 1** in `assemblePackage`. A Call 3 that graded a blanked
  package writes degraded content straight into `pkg_json` and into `swap_decision`. This is the
  silent-degradation path, and nothing downstream would flag it: the build still reports
  `built: 4, failed: 0`.

### AC-1.4 — which fields Call 2 may supply, and which it may never overwrite

**Given** the live `portfolio_user` (node 299599701) asks only for Skills1, Skills2, Relevant Skills
1-3, a swap table, and a word-count check, **when** the merge runs, **then**:

| field | Call 2 may supply? | rule |
|---|---|---|
| `skills1`, `skills2`, `relevant1/2/3` | **yes** | captured; consumed only under Scope B |
| the swap table / `Word and Character Requirements Check` | **yes, as analysis** | routed to change 2's store; never to `pkg_json` |
| `coverLetter`, `aboutMe1`, `aboutMe2`, `executiveProfile`, `coldEmail` | **never** | Call 2's prompt does not ask for them; a value here means the model improvised. **Refuse it and warn**, do not merge it |
| `resumeSummary` | **never** | `assemblePackage` has it as third choice; letting an improvised Call-2 summary land there would put unrequested text in the resume |
| `workHistory1-4`, `date`, `targetRole`, `targetCompany`, `expertise`, `coreAccomplishments` | **never** | Call 1 / MasterContext own these |

**Then** a Call-2 reply containing e.g. `### Cover Letter ###` produces a warning naming the section
and **does not** alter `@CoverLetterBody`.

* **Settles it:** unit test feeding a Call-2 reply that contains `### Cover Letter ###` and
  `### Executive Profile ###`; assert `assemblePackage(c1, c2, c3)['@CoverLetterBody'] === c1.coverLetter`
  and that a warning names both sections.
* **Mutation:** widen the allowlist to include `coverLetter` and the test must fail with
  `@CoverLetterBody` equal to Call 2's text.
* **Note on the refusal being the right choice:** this is deliberately the *opposite* of "the later
  call wins". The owner's constraint is that their prompts drive the draft. A field the Call-2 prompt
  never requested is by definition not the owner's prompt driving it.

### AC-1.5 — when Call 1 and Call 2 both return the same section, Call 1 wins for draft fields

**Given** both prompts emit `### Skills1 ###` and `### Skills2 ###` (node 16 and node 17 both list
them — §0.1), **when** both calls return them, **then** under Scope A `pkg.SkillsBullets1/2` are
unchanged from today (`call3.finalSkills1 → call1.skills1`), and Call 2's copies are stored as
*analysis* (change 2) labelled with their call of origin — never merged into the draft slot.

* **Settles it:** unit test with a `c1` and a `c2` that both carry `skills1`; assert
  `assemblePackage(...).SkillsBullets1` traces to `c1` (make the two strings distinguishable), and
  assert the retained analysis record carries `call: 2`.
* **Mutation:** flip the precedence to Call 2 and the test must fail.
* **Is Call 1 winning the right choice?** Under Scope A, yes and it is not close: today's documents
  are built from Call 1 + Call 3 and are *acceptable to the owner*. Changing the winner is a document
  change, and a document change needs the owner, not an AC. There is a real argument the other way —
  Call 2's skills are the post-ATS-swap list and are arguably better — but Call 3 already performs an
  ATS skills merge and already outranks Call 1, so Scope B would insert a **third** opinion between
  them with no defined precedence against `finalSkills*`. Scope B without an explicit
  Call-2-vs-Call-3 precedence rule is not a change, it is a coin flip.

### AC-1.6 — a useless Call 2 must degrade exactly as it does today

**Given** Call 2 returns an empty reply, an HTTP error, prose with no `### … ###` headings, or
headings that map to nothing, **when** the build runs, **then** it completes with the same
document content it produces today, `built: 4, failed: 0`, and a warning that distinguishes the
three cases: *no reply*, *reply with no sections*, *sections that map to no field*.

* **Settles it:** three unit cases (`''`, `'Sorry, I cannot help with that.'`,
  `'### Nonsense ###\nbody'`); assert `assemblePackage` output is byte-identical to
  `assemblePackage(c1, {}, c3)` in all three, and that the warning strings differ.
* **Mutation:** make the parse throw on a heading-less reply and the "build still completes" case
  must fail. A `try/catch` that swallows to `{}` also fails the *warnings differ* assertion — which
  is the point: `agentJson.ts`'s own header says a failed call must never be indistinguishable from
  "nothing to change".

### AC-1.7 — every existing consumer of `parseAgentJson` still works

**Given** `parseAgentJson` has four call sites (`pipeline.ts:250` scoped regeneration,
`pipeline.ts:358` Call 3, `appReviewer.ts:159`, and the removed `pipeline.ts:340`), **when** change 1
lands, **then** the other three are untouched and `api/test/agentJson.test.mjs` and
`api/test/openaiJson.test.mjs` pass unchanged.

* **Settles it:** `npm test` in `api/`; plus `grep -n "parseAgentJson" api/src/functions/tests/*.ts`
  returns exactly the three surviving call sites and the import.
* **Mutation:** delete `parseAgentJson`'s export and the build must fail at three named sites — if
  it fails at fewer, a call site was missed.
* **Explicitly in scope:** `mt19.ts:95-99` (§0.7) still parses `portfolio_user` output with a greedy
  `/\{[\s\S]*\}/`. It is legacy, but leaving it means the same prompt is parsed two incompatible
  ways in one repo. **Required: either fix it to the same section parse, or add a one-line comment
  at that site pointing at this AC and at D31.** Silence is not an option — it is exactly the
  "fix one consumer, miss the others" failure `CLAUDE.md` has a strict rule about.

### AC-1.8 — provenance: anyone can tell which call produced a document field

**Given** the whole point of the change is that a field's origin can shift, **when** a packet is
built, **then** for every key in `pkg` there is a recorded, queryable answer to *"which call did this
come from?"* — at minimum in the build result the owner already receives, and durably for the four
fields whose source can change.

* **Settles it:** `assemblePackage` gains a sibling that returns `{ field: 'call1'|'call2'|'call3'|
  'mastercontext'|'null' }` computed from the **same** `firstNonEmpty` decisions (one source of
  truth — not a second copy of the precedence, which would drift). Unit test: for a `c1/c2/c3` where
  every field is distinguishable, assert the provenance map matches the actual winner for all 22 keys.
  Live confirmation: `db-query.yml` `select pkg_json -> '_provenance' from packet where id = …`, or
  the `packet_build_job.result` payload — D35 proves that payload survives a non-success job.
* **Mutation:** hardcode one entry to `'call1'` and the all-22-keys assertion must fail. A test that
  samples three fields will pass and is inert.
* **Do not** implement provenance as a second precedence table read by eye. The measured failure this
  repo already logged (`swap_decision` vs the merged package) is that a merged output alone cannot
  show what it replaced.

### AC-1.9 — the change is proven on the live system, on more than one posting

**Given** D31 itself records that *"one green run after one red run is a coin"* and its own close was
reversed on exactly that basis, **when** change 1 is claimed done, **then** it has been run against
**at least two different opportunities** on the deployed Function, and for each: the
`Call 2 … no JSON object` warning is absent, the four `@`-prefixed document fields are byte-identical
to the pre-change build of the same opportunity, and `built: 4, failed: 0`.

* **Settles it:** `api-test.yml` `POST /api/app/opportunity/<uuid>/packet/build-async` with
  `regen: true` on two opportunities, then `GET /packet/build-job/{id}` to `state=done`; capture
  `pkg_json` via `db-query.yml` before and after and diff the four fields. **Before-capture must
  happen first** — after the deploy there is no way back to the old values.
* **Mutation:** not applicable to a live run; instead the pre/post diff must be shown to be capable
  of failing by diffing two builds of *different* opportunities, which must report differences.
* `wait-run.sh sha:api-deploy.yml:$(git rev-parse HEAD)` — never `latest:` (H15).

### AC-1.10 / Scope B only — do not build without written owner sign-off

**Given** Scope B changes the resume draft, **when** it is proposed, **then** the owner has been
shown, in writing: (a) that Call 2's skills are the post-swap list and Call 3's `finalSkills*`
currently outrank Call 1; (b) the explicit three-way precedence proposed; (c) a side-by-side of the
skills lists from one real build under both precedences. Absent all three, the change is not built.

* **Settles it:** the sign-off text exists in `.claude/actions.md` with a date. No sign-off, no code.
