# VERIFY — PR #55 (`claude/lane-c-template-id`)

Independent verification. No shared context with the implementing session.
Verified against `origin/main` = `5a84dfd`, branch HEAD = `abfee91`. Complete.

## Status
- [x] Claim 1 — `artifact.template_id` is now written — **CONFIRMED** (incl. `$1..$4`, proven on real PostgreSQL)
- [x] Claim 2 — `diagDocStructure` audits the owner's template — **PARTIALLY REFUTED** (`templateSource` misreports)
- [x] Claim 3 — DEFERRED row `D:no-template-picker` narrowed honestly — **CONFIRMED as honest, REFUTED as complete**
- [x] Claim 4 — nothing else regressed — **CONFIRMED** (267/267 app, 765/765 api, exit 0)
- [x] Extra — rebuild / remediation / `compact_resume` interaction — **no defect**, one follow-on
- [x] Extra — `meta.templateId` undefined for some artifact types — **no defect**, `|| null` is dead but correct

**Two things must change before merge** — see "Required before merge" at the end.

---

## Scope of the change (measured, not taken on trust)

```
$ git log --oneline -1 origin/main
5a84dfd Merge #54 curation
$ git log --oneline origin/main..HEAD
abfee91 Narrow D:no-template-picker - the dead-column half is fixed
52dad4e Merge main into Lane C
3271ccb Lane C: write artifact.template_id, and audit the owner's real template
$ git diff --stat origin/main HEAD
 .claude/DEFERRED.md                         |  2 +-
 api/src/functions/tests/appPackets.ts       |  9 ++++++++-
 api/src/functions/tests/diagDocStructure.ts | 17 +++++++++++++++--
```
Three files. No test file was added by this PR — noted, and returned to under Claim 4.

---

## CLAIM 1 — `artifact.template_id` is now written

### 1(a) "Zero writes on `origin/main`" — **CONFIRMED**

Whole-tree grep at `origin/main` (not just `api/src`), excluding prose dirs:

```
$ git grep -n "template_id" origin/main | grep -v -E "^origin/main:(docs/|\.claude/)"
origin/main:api/src/functions/tests/appPackets.ts:80:  ... select id, type, status, template_id, doc_url, ... from artifact where packet_id = $1
origin/main:api/src/functions/tests/appPackets.ts:200:    artifacts: artifacts.map((a) => ({ ..., templateId: a.template_id, ... }))
origin/main:api/src/functions/tests/schema.ts:102:  template_id   text,
```

Exactly three sites, exactly as claimed: one DDL declaration, one SELECT, one projection.
No `insert`, no `update`, no migration, no script touches it. The only `insert into artifact`
on main is `appPackets.ts:78` `(packet_id, type)` — no `template_id`. **Zero writes confirmed.**
The line numbers cited in the new code comment (`:80`, `:200`) are the true current ones; the
older DEFERRED row cited `:77`/`:125`, which have since drifted — the comment is the accurate one.

### 1(b) "A write now exists in `renderArtifact`" — **CONFIRMED**

`api/src/functions/tests/appPackets.ts:663` (inside `renderArtifact`, which starts at `:613`):

```
update artifact set doc_url = $1, content = coalesce(nullif(content,''), $2), template_id = $3,
  status = case when status = 'todo' then 'review' else status end, updated_at = now() where id = $4
```

`grep -n "update artifact"` across `api/src` returns 8 sites; `:663` is the only one that
sets `template_id`, and it is the only one reachable from a template copy.

### 1(c) "The value is `meta.templateId`, the owner-resolved id" — **CONFIRMED with one correction to the comment**

`renderArtifact` (`appPackets.ts:618-623`) builds `meta` from `loadPipelineSettings()`:

```
const settings = await loadPipelineSettings()
const meta = metaFor(art.type, {
  resumeTemplateId: settings.resumeTemplateId.value,
  portfolioTemplateId: settings.portfolioTemplateId.value,
  coverLetterTemplateId: settings.coverLetterTemplateId.value,
})
```

and the SAME `meta.templateId` binding is what is handed to the Drive copy at `:639`
(`copyThen(token, meta.templateId, name, ...)`) and what is written at `:663`. One variable,
two uses — so the recorded id and the copied id **cannot diverge**. That is the strongest form
of this claim and it holds.

**CORRECTION — the code comment overstates.** It says `meta.templateId` is
*"the OWNER-RESOLVED id ... **never the seed constant**"*. That is false. `resolveText`
(`pipelineConfig.ts:128-133`) returns `{ value: fallback, source: 'default' }` when the AppConfig
row is absent or rejected, and `SEED_DRIVE_IDS.resumeTemplateId` **is** `RESUME_TEMPLATE_ID`
(`pipelineConfig.ts:61`). So with no owner setting configured, the value written **is** the seed
constant. The *behaviour* is right (it records the document actually copied); the *comment's*
absolute is wrong and will mislead the next reader. Prose defect, not a logic defect.

### 1(d) SQL parameter numbering — **CONFIRMED CORRECT (no off-by-one)**

```
set doc_url = $1 , content = coalesce(nullif(content,''), $2) , template_id = $3 ... where id = $4
params:      [ url ,                                  preview ,  meta.templateId || null ,   art.id ]
```
$1→url, $2→preview, $3→templateId, $4→art.id. The added column was appended **after** `$2` and
`where id` was renumbered `$3`→`$4` correctly. Runtime proof against real PostgreSQL below.

**Runtime proof against real PostgreSQL 16.13** (local container instance; `artifact` table copied
verbatim from `schema.ts`; the SQL string was *read out of the source file at runtime* so it cannot
drift from what I reviewed):

```
SQL under test:
  update artifact set doc_url = $1, content = coalesce(nullif(content,''), $2), template_id = $3,
    status = case when status = 'todo' then 'review' else status end, updated_at = now() where id = $4

AFTER: { "type":"resume", "status":"review",
         "template_id":"TEMPLATE_ID_VALUE",
         "doc_url":"https://docs.google.com/document/d/DOC_URL_VALUE/edit",
         "content":"PREVIEW_VALUE" }

PASS — every value landed in its own column; no off-by-one.
NULL-template row: {"status":"approved","template_id":null}   (status preserved; null, not '')
```

**Claim 1 verdict: CONFIRMED.** The write exists, records the id actually copied, and the parameter
numbering is correct — proven by execution, not by reading. One inaccurate sentence in the new code
comment (see 1(c)).

---

## CLAIM 2 — `diagDocStructure` audits the owner's template

### The resolution chain and query-parameter precedence — **CONFIRMED**

`diagDocStructure.ts:82-90`. `req.query.get('templateId')` is first in the `||` chain, so an
explicit query parameter still wins. The functional half of the claim is delivered: on `origin/main`
the diagnostic read `RESUME_TEMPLATE_ID` unconditionally; it now reads `google.resumeTemplateId`,
so an owner who has configured a template gets that document audited.

### `templateSource` — **REFUTED. It misreports, and the branch it exists to expose is dead code.**

This is the real defect in the PR.

`loadPipelineSettings() → settingsFromConfig() → resolveText()` **never returns an empty value**.
`pipelineConfig.ts:128-133`:

```ts
export function resolveText (raw, fallback, accept, label): ResolvedText {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s)        return { value: fallback, source: 'default' }
  if (!accept(s)) return { value: fallback, source: 'default', reason: `${label} rejected: ...` }
  return { value: s, source: 'config' }
}
```

and `SEED_DRIVE_IDS.resumeTemplateId` **is** `RESUME_TEMPLATE_ID` (`pipelineConfig.ts:61`). The
interface comment says so outright (`pipelineConfig.ts:186-190`): *"Always populated: a seed when
the owner has set nothing... **Never `''`**"*.

So `resolvedTemplateId` is truthy in every real case, and the ternary that tests its truthiness
always takes the "owner setting" branch.

**Executed against the real compiled module** (`api/dist/.../pipelineConfig.js`, driving the exact
expression from `diagDocStructure.ts:86-88`):

```
SEED RESUME_TEMPLATE_ID = 1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw

A. no owner setting at all (the common case)
   templateSource: "owner setting (google.resumeTemplateId)"
   TRUE source   : default   => *** MISREPORTS ***
B. owner HAS set google.resumeTemplateId
   templateSource: "owner setting (google.resumeTemplateId)"
   TRUE source   : config    => HONEST
C. owner set a GARBAGE id (silently rejected by isDriveId)
   templateId    : 1bwOcxvkbih...   <-- the SEED, not the owner's
   templateSource: "owner setting (google.resumeTemplateId)"
   TRUE source   : default   => *** MISREPORTS ***
   warnings      : ['google.resumeTemplateId ignored (not a Drive id rejected: "not-an-id"); using the seeded id']
D. explicit ?templateId= wins
   templateSource: "query"             => correct
E. AppConfig unreachable (readAppConfigAuth swallows and returns {})
   templateSource: "owner setting (google.resumeTemplateId)"
   TRUE source   : default   => *** MISREPORTS ***
```

Three of five cases misreport. Case **C** is the worst: the diagnostic audits the seed document,
tells you it used the owner's setting, and the `warnings` array that says otherwise is not read or
surfaced by this route. That is a *sharper* version of the very failure the new comment says it
fixes — *"an owner could set a template id and watch the builder use a different one."*

The third branch, `'seed constant - NO owner setting is configured'`, is **unreachable**. It fires
only when `resolvedTemplateId === ''`, i.e. only via `.catch(() => '')`, and
`loadPipelineSettings()` cannot reject: `readAppConfigAuth` wraps the whole Table read in
`try { ... } catch { /* degrade */ }` and returns `{}` (`pipelineConfig.ts:203-215`), and
`settingsFromConfig` is pure. So:

- **On the question I was asked to check** — no, `.catch(() => '')` cannot mask a real settings
  failure, because there is no settings failure it can catch. It is dead. But the *misreporting it
  was suspected of causing is real anyway*, arriving through `.value` truthiness instead.
- The correct discriminator already exists and was designed for exactly this question:
  `s.resumeTemplateId.source === 'config'`. `pipelineConfig.ts:96-100` documents it in so many
  words — *"`source` is not decoration. The whole P7-8 defect was invisible precisely because the
  run never said WHICH value it used."* The implementer had the purpose-built field in hand and
  used a truthiness test that can only ever answer "yes".

**Fix (one line):**
```ts
const s = await loadPipelineSettings().catch(() => null)
const templateId = (req.query.get('templateId') || s?.resumeTemplateId.value || RESUME_TEMPLATE_ID).trim()
const templateSource = req.query.get('templateId') ? 'query'
  : s?.resumeTemplateId.source === 'config' ? 'owner setting (google.resumeTemplateId)'
  : 'seed constant - NO owner setting is configured'
```
and surfacing `s?.warnings` on `out` would make case C self-explaining.

**Claim 2 verdict: PARTIALLY REFUTED.** Chain and query precedence CONFIRMED; `templateSource`
REFUTED — it is wrong whenever no valid owner setting exists, which is the default state.

---

## CLAIM 3 — `D:no-template-picker` was narrowed honestly

### The row was *forced* to change, it was not volunteered — **and that is fine**

The OLD check was `absent api/src/functions/tests/appPackets.ts set[^\n]*template_id\s*=` on an
OPEN row. Executed against the branch's `appPackets.ts`:

```
OLD check: /set[^\n]*template_id\s*=/  => match: true
```

`D:ledger-stale-row-fails` fails an OPEN `absent` row whose pattern matches
(`deferredLedger.test.mjs:152-155`: *"now matches ... — the thing was built, close the row"*). So
the ledger guard genuinely detected the fix and refused to stay green. The narrowing was compelled
by a working guard, which is the ledger doing its job.

### Remaining claim (ii), "there is no per-artifact template picker" — **CONFIRMED STILL TRUE**

Exhaustive grep for a caller-supplied template id anywhere in `api/src`:

```
$ grep -rn "req.query.get('templateId')\|body?.templateId\|body.templateId\|{ templateId" api/src/
config.ts:154-155   POST /api/config/templates  { templateId, roleFocus }
diagDocStructure.ts:85-86   GET /api/diag/doc-structure?templateId=
packetTemplates.ts:18       (the TemplateMeta interface)
```

Neither is a picker:
- `config.ts` uses `templateId` as the **key** of a role-focus mapping (`resume-<id>` RowKey). It
  does not decide which template an artifact uses.
- `diagDocStructure` is a read-only structural audit; it builds no artifact.
- Nothing in `app/src` ever sends a template id for an artifact —
  `api.js:293 templateFocusSet` is the role-focus call, and that is the only sender.

`packetTemplates.ts:22-39` still hardcodes one id per TYPE and `metaFor:67-72` still applies only a
global per-owner override. **Claim (ii) holds.**

### The new check is NOT vacuous — **mutation-proven**

`check: absent api/src/functions/tests/appPackets.ts body\?\.templateId`

Today: `/body\?\.templateId/ => match: false` — the row correctly stays OPEN.
Falsifiability, proven by reinstating the thing it guards:

```
### MUTATION — add `const pickedTemplate = String(body?.templateId || '').trim()` to appPackets.ts
not ok 14 - D:ledger-stale-row-fails: a row whose claim no longer holds fails, in both directions
    'L161 D:no-template-picker: /body\?\.templateId/ now matches api/src/functions/tests/appPackets.ts
     — the thing was built, close the row'
# pass 15 / # fail 1        (reverted afterwards; tree clean)
```

`body?.X` is also the dominant idiom in that file (11 occurrences: `body?.status`, `body?.note`,
`body?.regen`, `body?.content`, `body?.instruction`, `body?.effort`, ...), so it is a realistic
signature, not a contrived one.

**Two honest limits on it, which the row does not state:**
1. It is scoped to `appPackets.ts`. A picker built in a new file, or written as
   `body.templateId` / `const { templateId } = body`, would not trip it. The old check had the same
   file-scoping, so this is not a regression — but "the row closes when **a route** accepts a
   caller-supplied template id" over-promises relative to what the pattern actually watches.
2. File scoping is load-bearing here in a way worth recording: `config.ts:155` **already contains**
   `body?.templateId` for an unrelated purpose. An unscoped version of this check would have been a
   false positive on day one.

### **The real problem with the narrowing: claim (i) is now guarded by nothing**

The old check machine-verified the `template_id` column's state. The new check watches a completely
different construct. Claim (i) — *"`renderArtifact` writes it"* — now lives only as prose in the
ledger cell. **Mutation-proven:**

```
### MUTATION — revert the fix entirely (drop `template_id = $3`, renumber back to $3)
build: OK
# tests 765  # pass 765  # fail 0
```

The whole fix can be silently reverted and **all 765 api tests plus the ledger stay green**. There
is no test anywhere that asserts the write — `grep -rn "template_id\|templateId" api/test/` returns
one unrelated hit (`templateConfig.test.mjs:35`, about the role-focus route).

This is the exact failure mode `.claude/DEFERRED.md`'s own preamble names: *"a claim about state
that nothing re-checks is how work that was never done reads as done."* The row now contains one.
The repo's `CLAUDE.md` rule — *"When you find a mistake ... add an H-case in the same commit that
fixes it. Not a paragraph in a doc. A test."* — was not followed.

**Suggested minimum:** an H-case slug, e.g.
`test('H:artifact-records-the-template-it-was-built-from', ...)` asserting that the `update artifact`
statement in `renderArtifact` sets `template_id` from the same `meta.templateId` binding passed to
`copyThen`, and that the placeholder indices are contiguous `$1..$4`.

**Claim 3 verdict: CONFIRMED as to honesty of the narrowing** (claim (ii) is genuinely still true,
the new check genuinely fails if a picker is built). **REFUTED as to completeness** — the half that
was fixed lost its machine check and gained no test, so the ledger's coverage of this row went down,
not up.

---

## CLAIM 4 — nothing else regressed

`./scripts/check.sh` (full: app tests + app build + api build + api tests), exit code **0**:

```
== app: tests ==     # tests 267   # pass 267   # fail 0
== app: build ==     ✓ 245 modules transformed.   ✓ built in 4.20s
== api: build ==     (tsc clean)
== api: tests ==     # tests 765   # pass 765   # fail 0   # duration_ms 7664
== all checks passed - safe to commit ==
EXIT=0
```

**CONFIRMED — green.** With the caveat established under Claim 3: green is not evidence *for* this
PR, because the suite is exactly as green with the change fully reverted. The PR adds **zero** test
lines (`git diff --stat` = 3 files, none under `api/test/` or `app/test/`).

---

## ADDITIONAL INVESTIGATION (asked for, because the implementer may have been wrong)

### Does writing `template_id` on EVERY build interact badly with rebuilds / the remediation loop / `compact_resume`?

**Rebuilds — no hazard, and the semantics are the better choice.** The write is the last statement
in `renderArtifact`, in the *same* `update` as `doc_url`, so the pair can never desynchronise: if
`copyThen` throws, neither is written and the previous pair survives intact. A rebuild after the
owner changes `google.resumeTemplateId` overwrites `template_id` with the new id — correct, because
the row's meaning is "the document this artifact was built from", and the artifact *was* just
rebuilt from the new one.

**Remediation loop — no hazard.** `appRemediation.ts:481` calls `renderArtifact` **once**, after
the loop finishes, with `{ loop: finalLoop }` (the ONE-copy-per-artifact rule at
`appPackets.ts:606-611`). One render, one write, same `meta`.

**`compact_resume` — no wrong id lands, but a pre-existing inconsistency is now user-visible.**
`OVERRIDE_KEY` (`packetTemplates.ts:53-58`) maps `compact_resume → resumeTemplateId`, so a
compact-resume artifact copies the resume template and now records the resume template id. That is
*truthful* — it is the file that was copied.
The inconsistency: a separate owner setting `google.compactResumeTemplateId` exists and is rendered
in the UI as "Compact resume template" (`app/src/screens/Settings.jsx:1795`,
`web/src/App.jsx:69`). It is read by `pipeline.ts:630-655` and `mt19.ts:57-131` — the **legacy MT
harness** — and by **nothing in `renderArtifact`/`metaFor`**. So the product builder ignores it.
Not introduced by this PR, but this PR is what surfaces `templateId` to the UI, so from now on an
owner can set "Compact resume template" to X and watch the compact-resume artifact report template
Y. Worth its own DEFERRED row.

**A stale-`template_id` hazard I looked for and FALSIFIED.** `appPackets.ts:741` and `:845` update
`doc_url` **without** touching `template_id` (the from-scratch `documents.create` /
`presentations.create` paths). If reachable after a templated build, they would leave a
`template_id` pointing at a template the current `doc_url` was not made from. They are **not
reachable**: both sit behind `if (metaFor(art.type)) { ...templated path...; return }`
(`:702` and `:781`), and every type in the `artifact.type` check constraint except `video` has a
`TEMPLATE_META` entry — while `video` is rejected at `:697` in `artifactDocument`. So no currently
valid artifact type can reach either branch. Hypothesis raised, tested, **disproven**.
(`appVideo.ts:94` also writes `doc_url` alone, but a video artifact has no template, so `null` is
the correct value there.)

### Is `meta.templateId` ever undefined/null, and does `|| null` handle it?

**It can never be undefined at the write site — the `|| null` is dead but harmless.**

- `renderArtifact` returns at `:624` (`if (!meta) return null`) *before* the query, so the write is
  unreachable for any type without a `TEMPLATE_META` entry. **`video` is exactly that case** and
  therefore never reaches the write at all.
- For the four templated types, `TEMPLATE_META` always supplies a non-empty seed string, and
  `metaFor` only replaces it when the override is truthy after `.trim()`
  (`packetTemplates.ts:71`), so it cannot substitute `''` or `undefined`.
- `resolveText` cannot return `''` (proven under Claim 2), so `settings.*.value` cannot blank it.

So `meta.templateId || null` never evaluates to `null` in practice. I still executed the `null`
branch against real PostgreSQL to confirm it would behave if it ever did:
`{"status":"approved","template_id":null}` — a genuine SQL NULL, **not** an empty string, and the
`case when status = 'todo'` guard correctly leaves a non-`todo` status alone. The defensive coalesce
is correct; it is simply unreachable.

---

## VERDICT SUMMARY

| # | Claim | Verdict | What settles it |
|---|---|---|---|
| 1a | Zero writes on `origin/main` | **CONFIRMED** | `git grep template_id origin/main` → 3 hits, all reads/DDL |
| 1b | A write now exists in `renderArtifact` | **CONFIRMED** | `appPackets.ts:663`, only `update artifact` of 8 that sets it |
| 1c | Value is `meta.templateId`, owner-resolved | **CONFIRMED** (comment overstates) | same binding as `copyThen` at `:639`; but it IS the seed when unconfigured, so "never the seed constant" is false |
| 1d | Parameter numbering correct | **CONFIRMED** | executed on PostgreSQL 16.13; every value in its own column |
| 2 | `diagDocStructure` resolves owner template, `?templateId=` still wins | **CONFIRMED** | `diagDocStructure.ts:82-90`; case D |
| 2 | `templateSource` names which was used | **REFUTED** | executed: 3/5 cases report "owner setting" when the true source is `default`; the third branch is dead code |
| 3 | Row narrowed honestly, claim (ii) still true | **CONFIRMED** | no route takes a per-artifact template id; new check mutation-proven falsifiable |
| 3 | Narrowing is complete | **REFUTED** | the fixed half lost its machine check; full revert leaves 765/765 green |
| 4 | Nothing else regressed | **CONFIRMED** | `check.sh` exit 0 — 267/267 app, 765/765 api |
| + | Rebuild / remediation / `compact_resume` hazard | **NO DEFECT** (one follow-on) | one render per artifact; write atomic with `doc_url`; from-scratch paths unreachable |
| + | `meta.templateId` undefined for video | **NO DEFECT** | `if (!meta) return null` at `:624` precedes the write; `|| null` dead but correct |

### Required before merge

1. **`diagDocStructure.ts:86-88` — `templateSource` is wrong.** Discriminate on
   `s.resumeTemplateId.source === 'config'`, not on `.value` truthiness. As shipped, the field
   asserts the owner's setting was used in the two cases where it demonstrably was not (unset, and
   set-but-rejected). A diagnostic that lies about its own provenance is worse than one that stays
   silent, and this route exists to answer exactly that question.
2. **Add a test for the `template_id` write.** A full revert of the fix is currently invisible to
   `check.sh` and to the ledger. Per this repo's own strict rule, the mistake becomes a test.

### Nice to have

3. Fix the code comment at `appPackets.ts:656-662` — "never the seed constant" is false.
4. Surface `settings.warnings` on the `diagDocStructure` response so a rejected owner id explains
   itself (case C above produces a warning that nothing reads).
5. New DEFERRED row: `google.compactResumeTemplateId` is offered in the UI and read only by the
   legacy MT path, so the product builder ignores it — now visible because `templateId` reaches
   the client.

### Method notes
- All mutations were reverted; `git status` shows source files clean (only this evidence file).
- Local PostgreSQL 16.13 at `/tmp/pgsock:55432` was used for the SQL proof; the SQL string was read
  out of `appPackets.ts` at runtime rather than retyped.
- `templateSource` was exercised against the real compiled `api/dist` module, not a re-implementation.
- Not verified here: nothing was run against the live Function App or the live database. The claim
  "195 artifacts, 0 with a `template_id`" in the ledger is from a prior session and I did not
  re-measure it; whether `template_id` actually populates in production requires a build on the
  deployed API. **NOT VERIFIABLE from this sandbox** — the egress proxy blocks `azurewebsites.net`,
  and this would need `api-test.yml` + `db-query.yml` after the branch lands on `main`.
