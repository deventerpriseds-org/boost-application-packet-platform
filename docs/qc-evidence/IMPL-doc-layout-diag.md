# IMPL — `GET /api/diag/doc-layout` (READ-ONLY document layout diagnostic)

Branch: `claude/incumbent-wins-swap`. Files owned by this pass and ONLY these:
- `api/src/functions/tests/diagDocLayout.ts` (NEW)
- `api/test/docLayout.test.mjs` (NEW)
- this file

Nothing committed, nothing pushed — the tree is left for the parent session.

---

## 1. Feasibility table (published BEFORE implementation, per CLAUDE.md)

| Dependency | Producer (writes it) | Consumer (reads it today) | Proof (command + result) | Verdict |
|---|---|---|---|---|
| Docs API structure read | Google | `diagDocStructure.ts:15-19` `getDoc()`; `packetTemplates.ts:222` `templateText()` | read both files | **EXISTS** |
| Drive plain-text export | Google | **nobody in this repo** — `grep -rn "files/.*export" api/src` → 0 hits | grep, 0 hits | **ABSENT (new call, read-only GET)** |
| `getGoogleOAuthToken()` / `getGoogleToken()` + `HAS_GOOGLE_OAUTH` | `googleAuth.ts:34-63` | `mt05.ts:35-37`, `diagDocStructure.ts:107-109`, `diagTemplates.ts:25-27` | read `googleAuth.ts` | **EXISTS — reused, no second auth path** |
| Owner-resolved resume template id | `pipelineConfig.ts:246` `driveId('resumeTemplateId')` → `ResolvedText {value,source,reason}` | `diagDocStructure.ts:122-131` | read `pipelineConfig.ts:180-255` | **EXISTS — reused** |
| `artifact.doc_url` | packet builder (`appPackets.ts`) | `schema.ts:97-108` — `artifact(id, packet_id, type, status, template_id, doc_url, …)`; **nullable** | read `schema.ts:97-108` | **EXISTS-BUT-CONSTRAINED (nullable — must be handled)** |
| Postgres read from a Function route | `pgClient.ts:8` `getPgClient()` | `appPackets.ts:4` and many | read `pgClient.ts` | **EXISTS** |
| Route registration | `api/package.json:23` `"main": "dist/**/*.js"` | Azure Functions host | `grep -rn diagSkillSources api/src` → no importer other than `appSkillBank` importing the *helper*, never the route | **EXISTS — `app.http(...)` at the bottom of my own file is sufficient; NO index file to edit** |

### The overlap I am obliged to declare — `diag/doc-structure` ALREADY EXISTS

`api/src/functions/tests/diagDocStructure.ts` (route `diag/doc-structure`, registered at `:172`) already
reads the resume template through the Docs API and already returns a placeholder inventory
(`:84-92`), page size, margins, and a table list (`:42`).

**It does not answer either of the owner's two questions, and it is not read-only.** Observed, by
reading the file:

1. **No placeholder→container mapping.** `fingerprint()` collects text runs into one flat array
   (`:31-36`) and regexes the *joined* string (`:80-81`). Tables are collected on the same walk but
   into a *separate* list (`:42`). Nothing connects `{{SkillsBullets1}}` to the paragraph, bullet or
   table cell it sits in — which is exactly question 1. `tables` gives `{rows, columns}` for the
   document's tables, but not *which* table/cell a placeholder occupies.
2. **No rendered content and no line counts.** `fingerprint()` returns counts and geometry; the
   document's text is discarded after the placeholder regex (`:80`). Question 2 is unanswerable
   from its output.
3. **It MUTATES Google by default.** `:154-157` — `makeCopy` defaults to true (`copy !== '0'`), so a
   plain `GET /api/diag/doc-structure` **creates a Drive file** via `copyTemplate`. It also calls
   `shareAnyone` on the template itself (`:150`), a permissions write. The brief for this route is
   explicitly read-only, so it cannot be satisfied by "call the existing route".

**Decision (INTERPRETATION, stated so the parent can overrule):** a new file is justified — the two
routes answer different questions and have opposite mutation profiles. I did *not* duplicate the
plumbing: auth, the owner-resolved template id, and the expected-placeholder set are all imported
from the existing modules. What I could not import is `fingerprint()`, which is not exported; I did
not add an export to `diagDocStructure.ts` because that file is outside my ownership on this branch.

> **HANDOFF NOTE for the parent session (no file edited):** there is a real consolidation available
> later — `diagDocStructure.fingerprint()` and my `docReport()` walk the same Docs tree twice. If the
> parent wants one walker, the merge point is `diagDocStructure.ts` exporting `fingerprint`, and
> `diag/doc-structure` growing a `?copy=0` default so it stops being a mutating GET. **I did not make
> that change**; `diagDocStructure.ts` is not mine on this branch.

---

## 2. Status log (append-only)

- [t0] Progress file created.
- [t1] Fact-finding complete; feasibility table above written from files read, not memory.
  Files read: `diagSkillSources.ts`, `googleAuth.ts`, `packetTemplates.ts`, `diagDocStructure.ts`,
  `diagTemplates.ts`, `pgClient.ts`, `pipelineConfig.ts:180-255`, `schema.ts:90-108`,
  `slideTables.ts:1-45`, `slideTables.test.mjs:1-40`, `api/package.json`.
- [t2] Writing `api/src/functions/tests/diagDocLayout.ts`.
</content>
