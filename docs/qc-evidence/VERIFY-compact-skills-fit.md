# Independent verification — compact resume single Core Skills line

Verifier: independent subagent, no shared context with the implementer.
Target: branch `claude/render-interaction-states`, commit `4c070dd`.
Repo: `/home/user/boost-application-packet-platform`.

Rule for this file: every verdict names the command or `file:line` that settles it.
Appended incrementally — if this file is truncated, everything above the last line was
actually observed.

---

## Setup observed

```
$ git log --oneline -1
4c070dd Compact resume: one Core Skills line, fitted, with the drops named in the margin
$ git branch --show-current
claude/render-interaction-states
```

Commit touches 6 files (`git show --stat 4c070dd`):
`appChecks.ts` (+2/-1), `appPackets.ts` (+38), `checks.ts` (+59/-...),
`compactFit.ts` (+61), `api/test/compactFit.test.mjs` (+119, new),
`docs/qc-evidence/AC-compact-skills-fit.md` (+573, new).

Build + full `npm test` started in background at first tool call; numbers reported below.

---
## Build + test — the commit's own numbers, re-run

```
$ cd api && npm run build ; npm test
BUILD_EXIT=0
# tests 806
# pass 806
# fail 0
# duration_ms 6678.657247
```

Commit message claims "api 806/806, build clean." **CONFIRMED** — the numbers are real.
(That says the suite passes, not that the suite covers the right things. See CLAIM 7.)

---

## CLAIM 7 — "four checks silently stop firing for compact artifacts" — **REFUTED THE IMPLEMENTER; THE AC DOCUMENT WAS RIGHT**

Verdict: **the defect is REAL and is live in `4c070dd`.** The commit message calls this claim
"NOT REAL" and cites `appChecks.ts:109`. That citation is true and irrelevant.

### What actually gates these four checks

`checks.ts:295-296`:
```ts
const fields = mergeFieldsFor(input.type)
const has = (f: string) => fields.includes(f)
```
`has()` tests the artifact type's **TEMPLATE PLACEHOLDER LIST**. It does *not* test which keys
`pkg` contains. So `art.pkg_json` carrying `SkillsBullets1/2` — which is true, `appChecks.ts:37`
selects `p.pkg_json` from the packet join, and `appChecks.ts:110` passes it — cannot rescue these
checks. The four consumers:

- `checks.ts:303` `if (SKILL_FIELDS.some(has))` → gates `skill_char_limit` + `skill_list_count`
- `checks.ts:343` `const listed = [...SKILL_FIELDS, ...RELEVANT_FIELDS].filter(has)` → `listed` is
  empty → `cross_list_redundancy` (`:345 if (listed.length)`) and **BOTH** `omission_list` branches
  (`:364 if (omitted.length && listed.length)` / `:369 else if (listed.length)`) are skipped.
  `omission_list` does not even degrade to `not_applicable` — it vanishes from the result set.

`SKILL_FIELDS = ['SkillsBullets1','SkillsBullets2']` (`checks.ts:282`), and
`TEMPLATE_META.compact_resume.placeholders = ['ResumeSummary','SkillsBullets']`
(`packetTemplates.ts:47`). Neither skill field is in that list.

### Executed proof — identical `pkg`, only `type` differs

```
$ node scratch/c7.mjs
mergeFieldsFor(compact_resume) = ["ResumeSummary","SkillsBullets"]

=== type=resume — 16 checks emitted ===
  skill_char_limit        FAIL  :: 1 of 7 skills exceed 24 chars
                                   offenders=["ThisIsAnExtremelyLongSkillLabelWayOverTheLimit (46)"]
  skill_list_count        WARN  :: 7 skills split 4/3   offenders=["total 7"]
  cross_list_redundancy   FAIL  :: 1 item(s) appear in more than one list
                                   offenders=["Kubernetes (SkillsBullets1 + SkillsBullets2)"]
  omission_list           FAIL  :: 1 item(s) the owner asked never to use
                                   offenders=["SkillsBullets2: Rust"]
  compact_skills_fit      *** NOT EMITTED AT ALL ***

=== type=compact_resume — 12 checks emitted ===
  skill_char_limit        *** NOT EMITTED AT ALL ***
  skill_list_count        *** NOT EMITTED AT ALL ***
  cross_list_redundancy   *** NOT EMITTED AT ALL ***
  omission_list           *** NOT EMITTED AT ALL ***
  compact_skills_fit      PASS  :: Core Skills fits: 92 of 320 chars
```

The `pkg` passed to BOTH runs carries `SkillsBullets1`/`SkillsBullets2` — the exact shape
`art.pkg_json` has. 16 checks for `resume`, 12 for `compact_resume`. The four missing ones are
exactly the four the AC document named.

**`omission_list` — the owner's never-use list — FAILS on `resume` naming `Rust`, and is not
emitted at all on `compact_resume` with the same data.**

### It is a REGRESSION introduced on this branch, not pre-existing

```
$ git show origin/main:api/src/functions/tests/packetTemplates.ts | grep -A3 "compact_resume:"
  compact_resume: {
    templateId: RESUME_TEMPLATE_ID, isSlides: false, kindLabel: 'Compact Resume',
    placeholders: ['ResumeSummary','SkillsBullets1','SkillsBullets2','ExpertiseBullets',
                   'RelevantBullets1','RelevantBullets2','RelevantBullets3'],
  },
```
On `main` both skill fields are present, so all four checks fire for `compact_resume` today.
The narrowing to 2 placeholders happened earlier on this branch (`8615afc`), and `4c070dd`
explicitly examined and dismissed the consequence.

**Owner impact:** a compact resume can ship containing an item from `MasterContext.itemsToOmit`
and the packet's own check set will not say so — it will not even report `not_applicable`.

---
## CLAIMS 1-6 — executed against `dist/functions/tests/compactFit.js` (built, not read)

| # | Claim | Verdict |
|---|---|---|
| 1 | `pkg.SkillsBullets` is produced for a compact_resume artifact | **CONFIRMED, with a caveat** |
| 2 | A posting-answering skill is NEVER dropped, any row order | **CONFIRMED** |
| 3 | Unreadable budget ships content unchanged + `budgetUnreadable` | **CONFIRMED, with a caveat** |
| 4 | Tie-break is combined-line position, not `swap_decision.seq` | **CONFIRMED** |
| 5 | `compact_skills_fit` names each dropped skill, reuses `fitCompactSkills` | **CONFIRMED** |
| 6 | Check and render cannot disagree about WHICH item was dropped | **UNPROVEN — overstated** |

### Claim 1 — CONFIRMED

`appPackets.ts:670-693` — inside `renderArtifact`, guarded `if (art.type === 'compact_resume')`,
producing `pkg = { ...pkg, SkillsBullets: fit.text }` at `:691`, BEFORE `metaFor`/`varsForType`
at `:696`/`:718`. Both call sites reach it: `appPackets.ts:754` (`buildTemplatedArtifact`) and
`appRemediation.ts:481` (the loop's single render). `varsForType`
(`packetTemplates.ts:127`) reads `pkg[key]` for each declared placeholder, so `SkillsBullets`
is injected.

Caveat, and it is the hazard below: it cannot inject *undefined*, but it can and does inject
**empty string**.

### Claim 2 — CONFIRMED by execution

```
--- CLAIM 2: multi-row label, both orders ---
PASS  Kubernetes survives (kept-row FIRST)
        kept=["Kubernetes","Terraform"] dropped=["Perl","Bash","Docker","Rust","Go","Jenkins","Ansible","Python"]
PASS  Kubernetes survives (posting-row FIRST)
        kept=["Kubernetes","Terraform"] dropped=["Perl","Bash","Docker","Rust","Go","Jenkins","Ansible","Python"]
```
Identical data, both row orders, budget 30, `Kubernetes` carrying BOTH a
`kept/unattributed/no-req` row and a `swapped/posting/req-9` row. It survives either way.
`rankForLabel` (`compactFit.ts:122-124`) reduces with `Math.max`, so per-label rank is
order-independent by construction.

D-4 retested properly (my first assertion was mis-specified — the item survived by being first
in the line, not by rank):
```
--- D-4 retest: dropped+posting must NOT outrank a live unattributed item ---
PASS  the dropped+posting item leaves, the live item stays
        kept=["Terraform"] dropped=["Kubernetes"]
```
`compactFit.ts:103` checks `action === 'dropped'` before `driver`, so the already-removed row
ranks 0 and cannot shield itself at a live skill's expense.

**Residual gap, not a defect in the claim:** a skill with NO swap row at all ranks 0
(`compactFit.ts:99`) and is droppable, even if it happens to answer the posting. `swap_decision`
is the only relevance source. Documented at `compactFit.ts:56`; flagging it because it is the
one way a posting-answering skill *can* leave.

### Claim 3 — CONFIRMED (content is never blanked), with a caveat on `fits`

```
budget=NaN        kept=10/10 dropped=0 fits=true budgetUnreadable=true textLen=86
budget=null       kept=10/10 dropped=0 fits=true budgetUnreadable=true textLen=86
budget=0          kept=10/10 dropped=0 fits=true budgetUnreadable=true textLen=86
budget=-50        kept=10/10 dropped=0 fits=true budgetUnreadable=true textLen=86
budget=undefined  kept=10/10 dropped=0 fits=true budgetUnreadable=true textLen=86
budget='abc'      kept=10/10 dropped=0 fits=true budgetUnreadable=true textLen=86
```
All six unreadable shapes ship all 10 skills unchanged and set `budgetUnreadable: true`.
`checks.ts:849` tests `budgetUnreadable` FIRST, so the check reports the warn, not a pass.

**Caveat:** the result still carries `fits: true` alongside `budgetUnreadable: true`
(`compactFit.ts:171`). Any future consumer reading `fits` alone is told a measurement
succeeded that never happened. `checks.ts` gets this right today; the field does not defend
itself.

### Claim 4 — CONFIRMED by execution, both lists populated

Adversarial `seq`: skills1 items given `seq` 90-94, skills2 items given `seq` 0-4. If the sort
still used `swap_decision.seq`, the skills1 tail would go first.
```
dropped(order)=["Perl","Bash","Docker","Rust","Go","Jenkins","Ansible","Python"]
expected      =["Perl","Bash","Docker","Rust","Go","Jenkins","Ansible","Python"]
```
Drops run from the end of the COMBINED line (`skills2`'s tail first), ignoring `seq` entirely.
`compactFit.ts:184-186` sorts on `b.i - a.i` where `i` is the index in the combined array.
`seq` is carried in the type but is read by nothing in the sort — verified by the test above
producing the combined-order result under inverted `seq`.

Also executed — the never-drop-evidence path:
```
nothing dropped + overBudgetAfterDrops set
        dropped=0 over=true fits=false kept=10
```

### Claim 5 — CONFIRMED

`checks.ts:844-847` calls the imported `fitCompactSkills` (`checks.ts:22`), not a reimplementation.
`checks.ts:856-857` emits `fit.dropped.map(d => `${d.label} — ${d.reason}`)` as `offenders` —
names and reasons, never a count. Executed with a forced drop:

(offender strings observed in the mutation section below.)

### Claim 6 — UNPROVEN; the stated mechanism does not exist

The check does NOT receive the render's decision. It **recomputes** it.

```
$ grep -n "compactFit" api/src/functions/tests/appPackets.ts
9:import { fitCompactSkills, CompactFitResult } from './compactFit'
631:  let compactFit: CompactFitResult | null = null
693:    compactFit = fit
```
`compactFit` is **assigned at :693 and never read** — dead code. Its declaration comment at
`:631` says "carried to the check that names anything dropped to fit". It is carried nowhere.

What actually happens: `checks.ts` re-runs `fitCompactSkills` over rows it fetches itself. The
widened projection (`appChecks.ts:44`, `+requirement_id, seq, list`) is real and is what makes
the recomputation *likely* to agree. But "cannot disagree" is not established — three inputs are
independently sourced:

| Input | Render (`appPackets.ts`) | Check (`appChecks.ts`/`checks.ts`) |
|---|---|---|
| skills lists | in-memory `pkg` from `ensurePackage` | `art.pkg_json` (persisted packet row) |
| provenance | `... order by loop desc, list, seq` (`:675`) | `select ... where packet_id=$1`, **no ORDER BY** (`:44`) |
| budget | `loadThresholds(client, opp.owner_email)` (`:686`) | `thresholds` loaded in `appChecks` |

Row order happens not to matter (`rankForLabel` is a `Math.max` reduce, and line order comes
from the skills arrays), so the missing `ORDER BY` is harmless *today*. The claim is true in
practice and false as stated: the guarantee is "same function, similar inputs", not "same
decision object".

---
## Mutation tests — do the guards actually catch what they claim?

Two of the four claimed mutations, re-run independently. Anchor asserted present before
writing, source restored after, suite re-run to confirm restoration.

### Mutation A — "remove the producer"

Anchor asserted: `appPackets.ts:692  pkg = { ...pkg, SkillsBullets: fit.text }`
Mutated to `pkg = { ...pkg }` (leaves `fit` referenced on the next line, so the build stays clean).
`grep -c "SkillsBullets: fit.text"` → `0` (mutation confirmed applied). `BUILD_OK`.

```
# tests 806   # pass 805   # fail 1
not ok 127 - H:compact-placeholder-has-a-producer: a declared token nothing fills blanks the document
  location: 'api/test/compactFit.test.mjs:210:1'
  error: 'nothing produces pkg.SkillsBullets — the compact resume would ship blank'
```
**CAUGHT.** Guard is live, not inert.

### Mutation B — "report a count instead of the names"

Anchor asserted unique: ``checks.ts:857  fit.dropped.map(d => `${d.label} — ${d.reason}`), 'warn'))``
Mutated to ``[`${fit.dropped.length} skills removed`], 'warn'))``. `BUILD_OK`.

```
# tests 806   # pass 805   # fail 1
not ok 128 - H:compact-drop-reaches-the-margin: the owner is told WHICH skill went, not how many
  location: 'api/test/compactFit.test.mjs:223:1'
  error: 'offenders must name each dropped skill and why'
```
**CAUGHT.** Guard is live, not inert.

Restored:
```
$ git status --porcelain
?? docs/qc-evidence/VERIFY-compact-skills-fit.md      # only this file
# tests 806  # pass 806  # fail 0
```

---

## UNPROMPTED FINDINGS

### F1 (HIGH) — a BLANK Core Skills line passes `compact_skills_fit` as green

If both source lists are empty/null/whitespace, `fitCompactSkills` returns `text: ''` with
**no signal at all** — `fits: true`, `dropped: []`, `budgetUnreadable` and `overBudgetAfterDrops`
both undefined:

```
both null            text="" fits=true dropped=0 budgetUnreadable=undefined overBudget=undefined
both empty strings   text="" fits=true dropped=0 budgetUnreadable=undefined overBudget=undefined
both whitespace      text="" fits=true dropped=0 budgetUnreadable=undefined overBudget=undefined

compact_skills_fit on an EMPTY skills package -> PASS :: Core Skills fits: 0 of 320 chars
```

`compactFit.ts:168` `if (fullLength <= budget || items.length === 0)` treats "nothing to fit"
as "it fits". `varsForType` (`packetTemplates.ts:127`) injects `(pkg[key] ?? '').toString()`,
so `{{SkillsBullets}}` becomes `''` and the document renders with an empty Core Skills section.

This is the exact failure the module's own header (`compactFit.ts:1-13`) and
`packetTemplates.ts:36-40` say the feature exists to prevent — arriving through the one door
nobody checked. It also violates the repo's standing rule *"absent evidence is
`not_applicable`, never `pass`"*: nothing was measured, and the owner is told it fits.

The producer guard (`H:compact-placeholder-has-a-producer`) only proves a producer *exists*;
it does not prove the producer emits anything.

### F2 (HIGH) — CLAIM 7's defect, restated as owner impact

A compact resume can ship an item from `MasterContext.itemsToOmit` — the owner's never-use
list — with `omission_list` absent from the result set entirely (not `fail`, not
`not_applicable`). Executed proof in the CLAIM 7 section. Same for `skill_char_limit`,
`skill_list_count`, `cross_list_redundancy`.

**The test suite locks the regression in rather than catching it.** `insertions.test.mjs:47`:
```js
assert.ok(!mergeFieldsFor('compact_resume').some((f) => /^SkillsBullets[0-9]$/.test(f)),
```
No test anywhere asserts those four checks still fire for `compact_resume`. That is why
806/806 is green while the coverage hole is live.

### F3 (HIGH) — the model reviewer now grades a compact resume having seen NO skills

`reviewer.ts:123` builds its payload from `mergeFieldsFor(input.type)`. Executed:
```
resume          reviewer asset fields = ["ResumeSummary","SkillsBullets1","SkillsBullets2","ExpertiseBullets","RelevantBullets1"]
compact_resume  reviewer asset fields = ["ResumeSummary"]
```
`SkillsBullets` is declared but is never in `packet.pkg_json` (it is computed inside
`renderArtifact` and never persisted), so it is filtered out by `if (typeof v === 'string' && v.trim())`.
The reviewer judges requirement coverage on a compact resume containing a summary and nothing else.

### F4 (MEDIUM) — remediation can no longer repair skills on a compact resume

`remediation.ts:377`, executed:
```
resume          remediation candidate fields = ["ResumeSummary","SkillsBullets1",...,"RelevantBullets3"]
compact_resume  remediation candidate fields = ["ResumeSummary","SkillsBullets"]
```
`SkillsBullets` is always empty in `pkg_json`, and `SkillsBullets1/2` — which actually hold the
content — are no longer candidates. A skills-related finding on a compact resume has no field
the loop can rewrite. Anything the loop *did* write to `SkillsBullets` would be silently
overwritten by `renderArtifact` on the next render.

### F5 (MEDIUM) — frontend consumers of `SkillsBullets` (singular) are unhandled

The task named the `/^SkillsBullets\d$/` pattern; it does not match `SkillsBullets`.

| Location | Effect for the compact resume's one field |
|---|---|
| `app/src/qcRail.js:340` `MERGE_FIELDS` | `SkillsBullets` absent. Its own doc comment (`:336`) still says *"resume / compact_resume - 7 each"* and *"A check offender names one of these or it names none; there is no third possibility"* — both now false. |
| `app/src/assetGate.js:210` `FIELD_LABEL` | no entry → the block has no human label |
| `app/src/assetBlocks.js:234` `FIELD_ORDER` | not listed → sorts to the end, after every unknown field |
| `app/src/assetBlocks.js:606` `targetFor` | `/^SkillsBullets\d$/` misses → returns `null`, no stated rule shown |
| `app/src/assetBlocks.js:660` `observedFor` | same regex, same miss → no measurement shown |

`assetBlocks.js:649-652` explicitly warns that `targetFor`/`observedFor` must gain branches
together — they did stay in sync with each other, and both miss the new field.

### F6 — is `compactSkillsMaxChars` actually ENFORCED now? **YES.**

Previously declared and read by nothing. Now read in two places:
- `appPackets.ts:687` — the render's budget (`thresholds?.compactSkillsMaxChars ?? DEFAULT_THRESHOLDS...`)
- `checks.ts:846` — the check's budget

Per-owner and user-changeable, so no hardcoded-config violation. `checkPrefs.ts:46` declares
`chk_compact_skills_chars`, and `checkPrefColumns()` derives the UI list from that same SQL —
executed:
```
chk_compact_skills_chars present in checkColumns: true  ->  {"column":"chk_compact_skills_chars","type":"int"}
```
`Settings.jsx` `ChecksSettings` renders every returned column, so the control appears.

**Gap:** `CHK_LABELS` (`Settings.jsx:1583`) has no entry, and the comment at `:1582` says
*"Anything without an entry falls back to its column name."* The owner sees a control labelled
`chk_compact_skills_chars` with no explanation, next to friendly labels like "Longest skill
label". Cosmetic, but it is the one setting that decides what gets deleted from a document
they send to employers.

### F7 (LOW) — `compactFit` in `renderArtifact` is dead code

`appPackets.ts:631` declares it, `:693` assigns it, nothing reads it. The declaration comment
claims it is "carried to the check". See CLAIM 6.

### F8 (LOW) — `fits: true` is set alongside `budgetUnreadable: true`

`compactFit.ts:171`. `checks.ts` reads `budgetUnreadable` first so it is correct today, but the
result object tells any other consumer that a measurement succeeded which never ran.

### F9 (INFO) — output format

`fitCompactSkills` joins with `DEFAULT_SEPARATOR = ' | '` and `renderArtifact` passes no
separator, so `{{SkillsBullets}}` receives one pipe-delimited line
(`"Kubernetes | Terraform | Go"`), not bullets. The separator is a code constant with no owner
setting. Whether that matches the compact template's Core Skills block is **UNVERIFIED** — the
commit itself notes `google.compactResumeTemplateId` is unset and no document has been rendered.
