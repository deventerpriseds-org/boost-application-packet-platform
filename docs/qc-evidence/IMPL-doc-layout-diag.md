# IMPL — `GET /api/diag/doc-layout` (READ-ONLY document layout diagnostic)

Branch: `claude/incumbent-wins-swap`. Files owned by this pass and ONLY these:
- `api/src/functions/tests/diagDocLayout.ts` (NEW)
- `api/test/docLayout.test.mjs` (NEW)
- this file

This agent committed nothing and pushed nothing. **The parent session committed WIP snapshots of
these files mid-write — see §6, which contains a defect the parent must not ship.**

---

## 0. ⚠ READ §6 FIRST IF YOU ARE ABOUT TO SHIP `b483f47`

`b483f47 "WIP snapshot: diag route and render sweep, both mid-write"` captured
`diagDocLayout.ts` **at the instant mutation M9 was applied to it**. HEAD therefore contains a
deliberately injected defect (`truncated: false`). The working tree is correct. Details in §6.

---

## 1. Feasibility table (published BEFORE implementation, per CLAUDE.md)

| Dependency | Producer (writes it) | Consumer (reads it today) | Proof (command + result) | Verdict |
|---|---|---|---|---|
| Docs API structure read | Google | `diagDocStructure.ts:15-19` `getDoc()`; `packetTemplates.ts:222` `templateText()` | read both files | **EXISTS** |
| Drive plain-text export | Google | **nobody in this repo** — `grep -rn "files/.*export" api/src` → 0 hits | grep, 0 hits | **ABSENT (new call; a read-only GET)** |
| `getGoogleOAuthToken()` / `getGoogleToken()` + `HAS_GOOGLE_OAUTH` | `googleAuth.ts:34-63` | `mt05.ts:35-37`, `diagDocStructure.ts:107-109`, `diagTemplates.ts:25-27` | read `googleAuth.ts` | **EXISTS — reused, no second auth path** |
| Owner-resolved resume template id | `pipelineConfig.ts:246` `driveId('resumeTemplateId')` → `ResolvedText {value,source,reason}` | `diagDocStructure.ts:122-131` | read `pipelineConfig.ts:180-255` | **EXISTS — reused** |
| `artifact.doc_url` | packet builder (`appPackets.ts`) | `schema.ts:97-108` — `artifact(id, packet_id, type, status, template_id, doc_url, …)`; **nullable** | read `schema.ts:97-108` | **EXISTS-BUT-CONSTRAINED (nullable — handled as a state, not an error)** |
| Postgres read from a Function route | `pgClient.ts:8` `getPgClient()` | `appPackets.ts:4` and many others | read `pgClient.ts` | **EXISTS** |
| Route registration | `api/package.json:23` `"main": "dist/**/*.js"` | the Azure Functions host | `ls api/src` → no index/barrel; `grep -rn diagSkillSources api/src` → the only importer imports the *helper* (`appSkillBank.ts:24`), never the route | **EXISTS — `app.http(...)` at the bottom of my own file is sufficient. NO other file needed to change.** |

### The overlap I am obliged to declare — `diag/doc-structure` ALREADY EXISTS

`api/src/functions/tests/diagDocStructure.ts` (route `diag/doc-structure`, registered `:172`) already
reads the resume template through the Docs API and already returns a placeholder inventory
(`:84-92`), page size, margins and a table list (`:42`). *"Nothing can read the template"* would be a
false claim and I am not making it.

**OBSERVATION** (read off that file, three specific gaps):
1. `fingerprint()` collects every text run into ONE flat array (`:31-36`) and regexes the **joined**
   string (`:80-81`); tables are collected on the same walk but into a **separate** list (`:42`).
   Nothing links a placeholder to the paragraph/bullet/cell it occupies.
2. The document text is discarded after the placeholder regex (`:80`) — no content, no line counts.
3. It is **not read-only**: `:154-157` defaults `makeCopy` to true (`req.query.get('copy') !== '0'`),
   so a plain `GET /api/diag/doc-structure` **creates a Drive file** via `copyTemplate`; `:150` calls
   `shareAnyone` on the template itself, a permissions write.

**INTERPRETATION** (stated separately so the parent can overrule): gaps 1 and 2 are exactly the
owner's two questions, and gap 3 means the brief's read-only requirement cannot be met by calling
the existing route. A new file is justified. The plumbing was **not** duplicated — auth, the
owner-resolved template id and the expected-placeholder set are imported from the existing modules.
`fingerprint()` is not exported and I did not add an export, because `diagDocStructure.ts` is outside
my ownership on this branch.

> **HANDOFF NOTE (no file edited).** A real consolidation exists for later: `fingerprint()` and my
> `docReport()` walk the same Docs tree twice. The merge point is `diagDocStructure.ts` exporting
> `fingerprint`, plus flipping `diag/doc-structure`'s `copy` default to off so it stops being a
> mutating GET. **I did not make that change.**

---

## 2. What the route returns, and why it is shaped that way

`GET /api/diag/doc-layout?templateId=&artifactId=&type=&maxChars=` — all params optional.

**The question behind it.** The template's placeholders are exactly `{{ExpertiseBullets}}`
`{{RelevantBullets1..3}}` `{{ResumeSummary}}` `{{SkillsBullets1}}` `{{SkillsBullets2}}` and nothing
else (`diagSkillSources.ts:16-22`, live api-test run 32973162995; restated `config.ts:134`,
`slots.ts:19`). **One token per list**, expanding to whatever `injectValues`
(`packetTemplates.ts:204-211`) writes. So counting tokens answers *"how many lists"*, never *"how
many lines fit"* — a capacity is a fact about the printed page. Hence two halves:

| Half | Google call | Answers |
|---|---|---|
| `template.placeholders[]` — per occurrence: `region`, `container` (`paragraph`\|`listItem`), `namedStyleType`, `bulletNestingLevel`, **`table {tableIndex, rows, columns, rowIndex, columnIndex}`**, `paragraphText` | **Docs API** `GET https://docs.googleapis.com/v1/documents/{id}` | *Does the layout physically constrain this list?* A list in a fixed table cell is constrained; a bulleted paragraph in open body text is not. Only the Docs API distinguishes them. |
| `…doc.sections[]` — `heading`, `headingStyle`, `lines[]`, `lineCount`, `charCount`; plus `text.{chars,truncated,sample}` | **Drive export** `GET /drive/v3/files/{id}/export?mimeType=text/plain`, falling back to Docs-derived text | *What did a real build actually print?* — what "8 skills" and "3 / 2 / 3 relevant items" look like on the page. |

`via.structure` and `via.text` name which call produced each half in every response, including when
the Drive export failed and the text fell back.

**Line counting.** A "line" is one paragraph, further split on `\n`, `\r`, and `\v`. All three
matter: an owner's list is separate paragraphs, an injected list arrives through a single
`replaceAllText` whose newlines can land inside one paragraph, and `\v` is Docs' soft break
(Shift+Enter) which prints as a new line and is the natural way to keep a list inside one cell.
Counting only paragraphs would report a rendered 8-item list as **1 line** — the exact number the
owner is trying to discover, reported wrong.

**Section splitting uses the document's own `namedStyleType`**, never an ALL-CAPS heuristic. A
heuristic would be right most of the time and silently wrong the rest, and a mis-split section
reports a wrong capacity for a real list. Guarded by
`H:section-split-uses-the-DOCUMENTS-own-heading-style-not-a-guess`, whose fixture is the literal
counter-example `SQL, ETL, API DESIGN` (ALL CAPS, short, and not a heading).

**Degrading honestly — the accusation-shaped branch.** `unreadableDoc()` returns
`placeholders: null`, `placeholderCount: null`, `sections: null`, `totalLines: null`, `read: false`
and the reason. **Never `[]`, never `0`.** An owner reading `placeholderCount: 0` would conclude the
template imposes no layout constraint and set slot counts accordingly — when in fact nobody reached
the document. Same shape as `diagSkillSources.ts:62` and `:123-125`, both written after this exact
confusion. `missingPlaceholders` is `null` unless the template was actually read, so a "missing"
list is never computed against an inventory nobody fetched.

**Read-only is structural.** Every Google call is a GET. No `files/copy`, no `:batchUpdate`, no
`permissions`, no DELETE; the single SQL statement is a `select`. This matters because the route is
`authLevel: 'anonymous'` — any mutation reachable from it is reachable by anyone.

---

## 3. Build and test — real output

```
$ cd api && npm run build
> job-platform-api@1.0.0 build
> tsc
                      # clean, no diagnostics

$ node --test test/docLayout.test.mjs
# tests 15   # pass 15   # fail 0

$ node --test test/*.test.mjs          # whole API suite
# tests 948  # pass 948  # fail 0  # skipped 0
```

**OBSERVATION worth flagging, not mine to explain.** An earlier full-suite run during this pass
reported `# pass 924 / # fail 0 / # skipped 24`; the final run reports `948 / 0 / 0`. Both had zero
failures. The tree was being edited concurrently by the parent/verifier (`scripts/build-fixtures.mjs`
and `scripts/render-app.mjs` are modified in `git status`), so the 24 previously-skipped cases are
almost certainly DB/fixture-gated cases that became runnable. **INTERPRETATION, unproven** — I did
not chase it, as those files are outside my ownership.

---

## 4. Mutation proofs — every guard, with the defect reinstated

Method: apply the mutation to the TypeScript source, **rebuild with `tsc`**, run
`node --test test/docLayout.test.mjs`, require a FAILURE, restore, rebuild.
Scripts: `/tmp/.../scratchpad/mutate.sh`, `mutate2.sh`, `/tmp/m3.sh`.

| # | Mutation (behaviour reverted) | Result |
|---|---|---|
| M1 | `unreadableDoc` returns `placeholders: []`, `placeholderCount: 0` instead of `null` | **DETECTED** — `H:unreachable-google-is-not-zero-placeholders` |
| M2 | `container` always `'paragraph'` (bullet detection dropped) | **DETECTED** ×2 |
| M3 | `table: cell` → `table: null` (cell context dropped) | **DETECTED** — `H:placeholder-site-reports-its-container` |
| M4 | headers/footers not walked | **DETECTED** — `H:placeholder-site-walks-headers-and-footers` |
| M5 | `\v` removed from the line split (soft breaks uncounted) | **DETECTED** — `H:countable-lines-…` |
| M6 | paragraphs not split on embedded `\n` | **DETECTED** ×3 |
| M7 | ALL-CAPS-and-short added as a heading heuristic | **DETECTED** ×2 — `H:section-split-uses-the-DOCUMENTS-own-heading-style-not-a-guess` |
| M8 | `extractSections` skips table cells | **DETECTED** — `H:section-lines-include-table-cell-text` |
| M9 | `truncated: false` always | **DETECTED** — `H:truncation-is-announced-…` |
| M10 | `chars` reports the truncated length, not the real one | **DETECTED** — same guard |
| M11 | `parseDocId` returns the input for anything unmatched (guesses) | **DETECTED** — `H:parse-doc-id-extracts-…` |
| M12c | Drive export ignored; text always derived from the Docs structure | **DETECTED** — `H:drive-export-preferred-…` |
| **M13a** | the Docs GET becomes `method: 'POST'` | **DETECTED** — `H:doc-layout-route-is-read-only` |
| **M13b** | the Docs URL becomes `…/{id}:batchUpdate` | **DETECTED** — `H:doc-layout-route-is-read-only` |
| M14 | the SELECT becomes `update artifact set …` | **DETECTED** — `H:doc-layout-route-is-read-only` |
| M15c | the walker is made tolerant of the **Slides** shape | **DETECTED** — `H:doc-layout-reads-the-DOCS-shape-not-the-slides-shape` |

**Three mutations were re-done because the first attempt was an invalid proof.** M12/M13/M15 as
first written were rejected by `tsc`. A build failure says nothing about whether the *guard* works —
it only says the mutation was ill-typed — so counting it as "detected" would have been exactly the
inert-guard-believed-to-be-live failure the rule exists to prevent. They were rewritten to compile
(M12c, M13a/M13b, M15c) and only then did the tests catch them. The read-only guard in particular is
proved by two independent compiling mutations.

**After every run: `# pass 15 # fail 0` and `diff -q` reports the source identical to the original.**

**Honest limit.** The mutations exercise the *pure* functions and the *source-shape* guard. The route
handler `diagDocLayout()` itself is not unit-tested — it needs a Google token and a Postgres
connection, so `node --test` cannot reach it. Its `ok` computation
(`template.read && (!artifactId || artifact.doc.read)`) and its auth-failure early return are
**reviewed, not executed**. Only §5 settles those.

---

## 5. The live check the parent should fire the moment this deploys

The sandbox cannot reach `azurewebsites.net`. A **new** route also needs ~90-120s of worker converge
after `api-deploy.yml` finishes or it will 404 — that is not a bug in this route.

**(a) Template structure — the one that answers the slot-count question.**
```jsonc
mcp__github__actions_run_trigger(
  method: "run_workflow",
  owner: "deventerpriseds-org", repo: "boost-application-packet-platform",
  workflow_id: "api-test.yml", ref: "main",
  inputs: { "method": "GET", "path": "/api/diag/doc-layout?owner=von.ellis@enterpriseds.io" })
```
Expect `ok: true`, `template.read: true`, `template.placeholderNames` equal to
`["ExpertiseBullets","RelevantBullets1","RelevantBullets2","RelevantBullets3","ResumeSummary","SkillsBullets1","SkillsBullets2"]`,
`missingPlaceholders: []`, and a `table` object on the `SkillsBullets1/2` entries **if** the skills
block is a two-column table. `templateIdSource` says whether the owner's setting or the seed was
audited — check it before trusting the rest.

**(b) A rendered document.** Get a real artifact id first (`db-query.yml`):
```sql
select a.id, a.type, a.doc_url from artifact a
where a.type = 'resume' and a.doc_url is not null
order by a.updated_at desc limit 5;
```
then
```jsonc
inputs: { "method": "GET",
          "path": "/api/diag/doc-layout?artifactId=<uuid>&owner=von.ellis@enterpriseds.io" }
```
Expect `artifact.doc.sections[]` where the Core Skills section's `lineCount` is **8** and the
relevant lists come out **3 / 2 / 3** — the figures the parent measured today. If those numbers come
back different, the measurement is wrong, not the route; that is the whole point of the route.

**(c) The failure branch, which is the one most worth seeing.**
```jsonc
inputs: { "method": "GET", "path": "/api/diag/doc-layout?templateId=doesNotExist1234567890" }
```
Expect **`ok: false`**, `template.read: false`, `template.error` naming the Docs API status, and
`template.placeholders: null` — **not** `[]`, and `placeholderCount: null` — **not** `0`.
If that response ever shows `0`, the route is lying and the guard has gone inert.

---

## 6. ⚠ HANDOFF — `b483f47` captured this file mid-mutation and contains a defect

**OBSERVATION.** `git log --oneline` on this branch shows commits made by the parent session, not by
me: `b483f47 "WIP snapshot: diag route and render sweep, both mid-write"`,
`72aa7ee "WIP: diagDocLayout route, mid-write by its agent"`,
`6f21bda "WIP: progress doc for the read-only doc-layout diagnostic"`.

`git diff api/src/functions/tests/diagDocLayout.ts` (working tree vs HEAD) is exactly one line:

```diff
@@ -317,7 +317,7 @@ export function docReport(
     text: {
       chars: full.length,
-      truncated: false,                      <- what b483f47 COMMITTED
+      truncated: full.length > maxChars,     <- correct; what the working tree holds
```

**INTERPRETATION (high confidence).** `truncated: false` is mutation **M9** from §4. The snapshot was
taken during the mutation run, in the window between the mutation being applied and the script
restoring the original. It is not a merge artefact and not a half-finished thought.

**What the parent must do:** the **working tree is correct** — take it as-is. Do not `git checkout`
this file from `b483f47`, and do not resolve any conflict in favour of HEAD. The cheap check, which
is also the guard that catches it:

```bash
cd api && node --test test/docLayout.test.mjs      # 15/15 on the correct file;
                                                   # H:truncation-is-announced-… FAILS on b483f47's
```

**The general lesson, for whoever writes the next brief.** Mutation-proving temporarily writes a
known defect into a tracked source file. If anything else commits that tree on a timer, it can
capture the defect. Either mutate a copy outside the repo, or do not snapshot-commit while a
mutation run is in flight.

---

## 7. Status log (append-only)

- [t0] Progress file created.
- [t1] Fact-finding complete; §1 feasibility table written from files read, not memory. Files read:
  `diagSkillSources.ts`, `googleAuth.ts`, `packetTemplates.ts`, `diagDocStructure.ts`,
  `diagTemplates.ts`, `pgClient.ts`, `pipelineConfig.ts:180-255`, `schema.ts:90-108`,
  `slideTables.ts:1-45`, `slideTables.test.mjs:1-40`, `api/package.json`.
- [t2] `api/src/functions/tests/diagDocLayout.ts` written.
- [t3] `api/test/docLayout.test.mjs` written — 15 cases, all slug-named per the H-case rule.
- [t4] `npm run build` clean; 15/15 new tests pass; full suite 0 failures.
- [t5] Mutation round 1: 12/15 detected, **3 invalid proofs** (rejected by `tsc`).
- [t6] Mutation rounds 2 and 3: the 3 rewritten to compile; all now DETECTED. 16 mutations, 16 caught.
- [t7] Final: build clean, `948/948` suite pass, source verified byte-identical to pre-mutation.
- [t8] Discovered `b483f47` holds the M9 defect — §6 written. Nothing committed by this agent.
</content>
