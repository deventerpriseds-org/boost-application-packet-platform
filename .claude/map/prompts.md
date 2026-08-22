# PROMPTS end-to-end map — boost-application-packet-platform

_Status: IN PROGRESS — written incrementally. Everything below is read from files on disk in this
container (no live DB / no live API calls; the sandbox cannot reach either). Where a claim is
inference rather than something I read, it is labelled **INFERENCE**._

Sources of truth used:
- `docs/zap-289877647/README.md` — node table for the original Zapier export
- `docs/zap-289877647/prompts/*.md` — the 5 `chat_completion_memory` nodes verbatim
- `docs/zap-289877647/baseline/*.md` — the 13+1 `set_value` nodes (MasterContext baseline)
- `api/src/**` — the live code that reads the Prompts table and parses model output

---

## HEADLINE FINDING (answers the "single most important question" up front)

**Node 289877668 "Post Analysis QA" (→ `ats_user`) does NOT ask for `finalSkills1`,
`finalSkills2`, `finalRelevant1..3`, or `updatedResumeSummary` as JSON keys — and does not ask
for JSON at all.** It asks for `###`-bookended **section headers** with HTML list bodies.

Verbatim, `docs/zap-289877647/prompts/25-post-analysis-qa.md:40-45`:

```
6. At the bottom of the output, Bookend each header below with ###, and use <ul> and <li> html list tags for each to include the skills for the final merged bullet lists of:
   1 - ###  <h3>  Skills 1 <h3> ###  (Seperate output bookended with ### is a hard requirement)
   2 - ###  <h3>  Skills 2 <h3> ###  (Seperate output bookended with ### is a hard requirement)
   3 - ###  <h3> Relevant Skills 1 <h3> ###  (Seperate output bookended with ### is a hard requirement)
   4 - ###  <h3> Relevant Skills 2 <h3> ###  (Seperate output bookended with ### is a hard requirement)
   5 - ###  <h3> Relevant Skills 3 <h3> ###  (Seperate output bookended with ### is a hard requirement)
```

and `docs/zap-289877647/prompts/25-post-analysis-qa.md:95-96`:

```
### Updated Resume Summary ###
Maintaining the structure, style, and flow of the original, provide an updated resume summary covering the missing that also covers the missing items but in the same word count
```

So the *content* the five `assemblePackage` keys want IS requested — but under the section names
`Skills 1`, `Skills 2`, `Relevant Skills 1/2/3`, `Updated Resume Summary`, wrapped in stray
`<h3>` tags inside the `###` fence, and never as JSON keys named `finalSkills1` etc.

(Code-side confirmation of what `assemblePackage` reads off Call 3 is recorded in the
"Call 3 / ats_user" section below.)

---

## Zap node inventory (from `docs/zap-289877647/README.md`)

| # | node id | title | action | kind |
|---|---|---|---|---|
| 2 | 289877648 | Current Resume Summary | `set_value` | baseline |
| 3 | 289877649 | Current Work Experience | `set_value` | baseline |
| 4 | 289877650 | Current Skills | `set_value` | baseline |
| 5 | 289877651 | Current Expertise | `set_value` | baseline |
| 6 | 289877652 | Relevant Skills | `set_value` | baseline |
| 7 | 289877653 | Cover Letter | `set_value` | baseline |
| 8 | 289877654 | About Me Passage 1 | `set_value` | baseline |
| 9 | 289877655 | About Me Passage 2 | `set_value` | baseline |
| 10 | 289877656 | Exceutive Profile Paragraph | `set_value` | baseline |
| 11 | 289877657 | Executive Profile Core Accomplishments | `set_value` | baseline |
| 12 | 289877658 | Soft/Hard Skills | `set_value` | baseline |
| 13 | 289877659 | Items to Omit | `set_value` | baseline |
| 14 | 294827237 | Sample Cover Letter | `set_value` | baseline |
| 16 | 289877661 | Update Resume/Portfolio Fields (Prompt) | `chat_completion_memory` | **prompt** |
| 17 | 299599701 | Copy: Update Resume/Portfolio Fields (Prompt) | `chat_completion_memory` | **prompt** |
| 19 | 290709248 | Skills HTML Bullet List Formatting | `chat_completion_memory` | **prompt** |
| 25 | 289877668 | Post Analysis QA | `chat_completion_memory` | **prompt** |
| 27 | 291230256 | Strip HTML Skills Bullet List Formatting | `chat_completion_memory` | **prompt** |
| 39 | 289877672 | (untitled) | `send_email` | email |

README's own stated mapping: 289877661 → `resume_user`; 289877668 → `ats_user`; 289877672 →
**NOT migrated**; and a self-declared **KNOWN BUG: `portfolio_user` is byte-identical to
`resume_user`**.

_(sections below filled in as the trace proceeds)_

---

## The live pipeline: which partition key is read where

`api/src/functions/tests/pipeline.ts:305-312` loads EVERY active row of the `Prompts` Azure Table
into `prompts[partitionKey]` (plus `promptVersions[partitionKey]`). The six keys are then consumed:

| Partition key | Read at | Role |
|---|---|---|
| `resume_user` | `pipeline.ts:336` (`resolveZapVars(prompts['resume_user'] …)`) | Call 1 user prompt |
| `resume_system` | `pipeline.ts:337` | Call 1 system prompt |
| `portfolio_user` | `pipeline.ts:376` | Call 2 user prompt |
| `portfolio_system` | `pipeline.ts:377` | Call 2 system prompt |
| `ats_user` | `pipeline.ts:401` (`resolveZapVars(…, atsExtra)`) | Call 3 user prompt |
| `ats_system` | `pipeline.ts:410` | Call 3 system prompt |

Same six keys are read again, independently, by the MT-XX harness routes:
`mt14.ts:32,35` (resume pair), `mt15.ts:37,40` (portfolio pair), `mt16.ts:34,37` (ats pair),
`mt18.ts:37,40`, `mt19.ts:83,88,94,95,102,103`. `mt09.ts:18,26,28` writes/reads a throwaway
`resume_system` row as a Prompts-table CRUD smoke test.

### How each call's reply is parsed — this is where the disagreement lives

| Call | Prompt key | Parser | Evidence |
|---|---|---|---|
| 1 (resume) | `resume_user` | **`parseResumePackage`** (`###` section parser) | `pipeline.ts:338` |
| 2 (skills refinement) | `portfolio_user` | **`parseResumePackage`** (changed from `parseAgentJson` — see `pipeline.ts:355-375`) | `pipeline.ts:378` |
| 3 (ATS QC) | `ats_user` | **`parseAgentJson`** (expects a JSON object) | `pipeline.ts:411` |

`parseResumePackage` (`resumeParser.ts:138-201`) splits on the grammar `^\s*###\s*(.+?)\s*###\s*$`
(`resumeParser.ts:111`), classifies each heading via `TITLE_MAP` (`resumeParser.ts:40-66`) and returns
the fixed shape at `resumeParser.ts:175-200`:
`date, targetRole, targetCompany, resumeSummary, skills1, skills2, expertise, relevant1..3,
coverLetter, aboutMe1, aboutMe2, executiveProfile, coreAccomplishments, workHistory1..4`
plus `_unmapped` and `_parsedFieldCount`.

`parseAgentJson` (`agentJson.ts:59`) expects a JSON object; when there is none, `pipeline.ts:416`
emits `Call 3 (ATS QC) returned no JSON object (…) — the package is Call 1 unreviewed`.

### What `assemblePackage` reads off each call (`mt17.ts:131-169`)

| Package key (= document placeholder) | Call 3 source | Call 2 source | Call 1 source | line |
|---|---|---|---|---|
| `ResumeSummary` | `call3.updatedResumeSummary` | `call2.resumeSummary` (last) | `call1.resumeSummary` | `mt17.ts:137` |
| `SkillsBullets1` | `call3.finalSkills1` | `call2.skills1` | `call1.skills1` / split | `mt17.ts:148` |
| `SkillsBullets2` | `call3.finalSkills2` | `call2.skills2` | `call1.skills2` / split | `mt17.ts:149` |
| `ExpertiseBullets` | `call3.finalExpertise`, `call3.expertise` (after C1) | — | `call1.expertise` **first** | `mt17.ts:150` |
| `WorkHistoryBullets1..4` | `call3.workHistory1..4` | — | `call1.workHistory1..4` | `mt17.ts:151-154` |
| `RelevantBullets1..3` | `call3.finalRelevant1..3` | `call2.relevant1..3` | `call1.relevant1..3` | `mt17.ts:155-157` |
| `@Company` | — | — | `call1.targetCompany` | `mt17.ts:158` |
| `@CoverLetterDate` | — | — | `call1.date` | `mt17.ts:159` |
| `@CoverLetterBody` | — | `call2.coverLetter` | `call1.coverLetter` | `mt17.ts:160` |
| `@AboutMe1_50words` | — | `call2.aboutMe1` | `call1.aboutMe1` | `mt17.ts:161` |
| `@AboutMe2_60words` | — | `call2.aboutMe2` | `call1.aboutMe2` | `mt17.ts:162` |
| `@ExecutiveProfile_55words` | — | `call2.executiveProfile` | `call1.executiveProfile` | `mt17.ts:163` |
| `@CoreAccomplishments_5blts_180words` | — | — | `call1.coreAccomplishments` | `mt17.ts:164` |
| `coldEmail` | — | `call2.coldEmail` | — | `mt17.ts:165` |
| `targetRole` / `targetCompany` / `date` | — | — | `call1.*` | `mt17.ts:166-168` |

So the **exact Call-3 keys the code wants** are:
`updatedResumeSummary`, `finalSkills1`, `finalSkills2`, `finalRelevant1`, `finalRelevant2`,
`finalRelevant3` (+ optional `finalExpertise`/`expertise`/`workHistory1..4`). Confirmed as the mock
contract too, `mt17.ts:39-47`.

**Call 2's contribution to the draft is allowlisted to five keys** — `CALL2_FIELDS =
['skills1','skills2','relevant1','relevant2','relevant3']` (`mt17.ts:83`), applied by `call2Draft`
(`mt17.ts:122-129`) and `mergeCallTwo` (`mt17.ts:104-119`). Therefore the `call2.coverLetter`,
`call2.aboutMe1/2`, `call2.executiveProfile`, `call2.coldEmail`, `call2.resumeSummary` branches at
`mt17.ts:137,160-165` **can never fire from the live pipeline** — `pipeline.ts:420` passes
`call2Draft(c2)`, which strips them. They only fire for the mock route `mt17.ts:182` and `mt19.ts:115`.

### Which package keys reach a document

`packetTemplates.ts:76-82 varsForType` injects **only** `TEMPLATE_META[type].placeholders`
(`packetTemplates.ts:22-39`):

- `resume` / `compact_resume` (`:25`,`:29`): `ResumeSummary, SkillsBullets1, SkillsBullets2,
  ExpertiseBullets, RelevantBullets1, RelevantBullets2, RelevantBullets3`
- `portfolio` (`:33`): `@Company, @CoverLetterDate, @CoverLetterBody, @AboutMe1_50words,
  @AboutMe2_60words, @ExecutiveProfile_55words, @CoreAccomplishments_5blts_180words`
- `cover` (`:37`): `@Company, @CoverLetterDate, @CoverLetterBody`

**Package keys assembled but injected into NO template:** `WorkHistoryBullets1`,
`WorkHistoryBullets2`, `WorkHistoryBullets3`, `WorkHistoryBullets4`, `coldEmail`, `targetRole`,
`targetCompany`, `date`. (`targetCompany`/`date` reach documents only indirectly, re-exposed as
`@Company` / `@CoverLetterDate`.) `coldEmail` is assembled at `mt17.ts:165` and is in no
`placeholders` list — and, per the allowlist above, `call2.coldEmail` is stripped before assembly
anyway, so it is doubly dead on the live path.

---

## THE MASTER TABLE — one row per prompt node

Legend for column 6: **DISCARDED** = the prompt emits it and nothing in `api/src` maps it to a
merge field or a stored claim.

### Row 1 — node **289877661 · "Update Resume/Portfolio Fields (Prompt)"** (README row 16)

| | |
|---|---|
| **2. Live partition key** | `resume_user` (+ its `system_message` → `resume_system`). Read `pipeline.ts:336-337`, `mt14.ts:32,35`, `mt18.ts:37,40`, `mt19.ts:83,88`. |
| **3. What it asks for** | `###`-delimited plain-text sections (`16-…md:21,39-41`): `### Date ###` (`:44`), `### Target Job Title` (`:45`), `### Target Company` (`:46`), `### Resume Summary (55-60 words)` (`:49`), `### Skills1 ###` + `### Skills2 ###` (`:108`), `### Expertise` (`:152`), `### Relevant Skills bullet list 1/2/3` (`:166-168`), `### Cover Letter` (`:175`), `### About Me 1`, `### About Me 2` (`:233`), `### 10 - …executive profile introduction…` (`:248`), `### 11 - Core Accomplishments (98-100 words, five bullets)` (`:260`), `### Job Description Summary ###` (`:288`), `### Second Job Description Check ###` (`:315`), `### Missing ATS Skills ###` (`:329`), `### Missing ATS Swap Suggestions ###` (`:341`), a re-issued `### Skills1 ###/### Skills2 ###/### Relevant Skills 1 ###,2,&3` post-swap (`:351`, neutered to `return "Moved"` at `:355-357`), `### Word and Character Requirements Check ###` → `return "Removed"` (`:359-360`), `### Jobscan Extraction` 5-column table (`:362`). **No JSON anywhere.** |
| **4. Who reads it / how** | `pipeline.ts:338` → `parseResumePackage` (`resumeParser.ts:138`). Title→field via `TITLE_MAP` (`resumeParser.ts:40-66`); first occurrence wins (`resumeParser.ts:155`). |
| **5. Reaches a document** | `resumeSummary→ResumeSummary`, `skills1/2→SkillsBullets1/2`, `expertise→ExpertiseBullets`, `relevant1..3→RelevantBullets1..3` (resume template, `packetTemplates.ts:25`); `coverLetter→@CoverLetterBody`, `aboutMe1/2`, `executiveProfile`, `coreAccomplishments`, `targetCompany→@Company`, `date→@CoverLetterDate` (portfolio/cover, `packetTemplates.ts:33,37`). |
| **6. DISCARDED** | `### Job Description Summary ###`, `### Second Job Description Check ###`, `### Missing ATS Skills ###`, `### Missing ATS Swap Suggestions ###`, `### Word and Character Requirements Check ###`, `### Jobscan Extraction` — **none match any `TITLE_MAP` entry**, so each lands in `_unmapped` (`resumeParser.ts:151`) and is only warned about (`pipeline.ts:346-348`). Also **the post-swap re-issue of `### Skills1 ###`** at `:351`: even if the model emits real lists rather than `"Moved"`, `fields.skills1` is already set, so `keys.find(k => !fields[k])` returns `undefined` and the section is pushed to `_unmapped` (`resumeParser.ts:170`) — the swap-refined list can never win. |

### Row 2 — node **299599701 · "Copy: Update Resume/Portfolio Fields (Prompt)"** (README row 17)

| | |
|---|---|
| **2. Live partition key** | `portfolio_user` (+ same `system_message` → `portfolio_system`). Read `pipeline.ts:376-377`, `mt15.ts:37,40`, `mt19.ts:94-95`. Its `system_message` is **byte-identical to node 289877661's** (compare `16-…md:8` and `17-…md:8`) — which `pipeline.ts:145-151` says is CORRECT and deliberately not flagged. |
| **3. What it asks for** | `### Skills1 ###` and `### Skills2 ###` (`17-…md:45`), `### Relevant Skills 1 ###`, `### Relevant Skills 2 ###`, `### Relevant Skills 3 ###` (`:90-92`), an unheaded 5-column HTML swap-reasoning table (`:94-101`), and `### Word and Character Requirements Check ###` → `return "Removed"` (`:104-105`). **That is the entire output contract — 5 real sections.** It never asks for a cover letter, About Me, executive profile, core accomplishments, resume summary or cold email. |
| **4. Who reads it / how** | `pipeline.ts:378` → `parseResumePackage`. Historically `parseAgentJson`; changed with the long note at `pipeline.ts:355-375`. |
| **5. Reaches a document** | Only through the allowlist `CALL2_FIELDS = ['skills1','skills2','relevant1','relevant2','relevant3']` (`mt17.ts:83`), applied by `call2Draft` (`mt17.ts:122`) at `pipeline.ts:420`, and preferred over Call 1 at `mt17.ts:148-149,155-157`. |
| **6. DISCARDED** | The 5-column swap-reasoning table (`:94-101`) — it has **no `###` header at all**, so `splitSections` folds it into whichever section precedes it (`resumeParser.ts:121-136`), i.e. it is appended to `relevant3`'s body or dropped as untitled preamble. `### Word and Character Requirements Check ###` → `_unmapped`. Any cover letter / About Me / profile the model volunteers is explicitly **refused** and reported as `improvised` (`mt17.ts:110-118`, warned at `pipeline.ts:407-409`). |

### Row 3 — node **290709248 · "Skills HTML Bullet List Formatting"** (README row 19)

| | |
|---|---|
| **2. Live partition key** | **NONE — never migrated.** No `Prompts` partition key anywhere in `api/src` corresponds to it (the only six keys read are the ones tabled above, `pipeline.ts:336-410`). |
| **3. What it asks for** | 15+ `###` sections (`19-…md:14`): `### Original Skills 1/2 ###`, `### Relevant Skills 1/2/3 ###` (`:16-20`), `### Updated Skills 1/2 ###`, `### Updated Relevant Skills 1/2/3 ###` (`:24-28`), `### Stored Skills ###`, `### Stored Relevant Skills ###` (`:32-33`), `### Expertise ###`, `### Updated Expertise ###` (`:37-38`), `### Core Achievements ###`, `### Updated Core Achievements ###` (`:42-43`). Every one is the *same* transform: wrap a bullet list in `<ul>/<li>`. |
| **4. Who reads it** | In the zap: node **290709249** splits it on `###` (full JSON `290709249.params.inputs = {{290709248__response__content}}`), and node 289877668 reads `{{290709249__output__Item 13}}` / `Item 15` as **"List B" Skills 1/2** (`25-…md:64,66`). In the app: **nothing**. |
| **5/6. Fate** | Whole node DISCARDED. Consequence is not cosmetic — see the gap list: Call 3's "List B" inputs resolve to empty string. |

### Row 4 — node **289877668 · "Post Analysis QA"** (README row 25)

| | |
|---|---|
| **2. Live partition key** | `ats_user` (+ `system_message` `"You are a helpful assistant."` → `ats_system`). Read `pipeline.ts:401,410`, `mt16.ts:34,37`, `mt19.ts:102-103`. |
| **3. What it asks for** | `### Final Skills QC ###` + an HTML comparison table (`25-…md:26-38`); then five `###`-bookended lists — `Skills 1`, `Skills 2`, `Relevant Skills 1`, `Relevant Skills 2`, `Relevant Skills 3`, each as `<ul>/<li>` (`:40-45`); `### Resume Summary Validation ###` + HTML table (`:86-94`); `### Updated Resume Summary ###` (`:95-96`); `### Missing ATS Skills ###` → `Return text "Removed"` (`:98-99`); `### ATS Distribution Check ###` → `"Removed"` (`:101-102`); a second `### Missing ATS Skills ###` → `"Removed"` (`:104-105`); `### Cold Email Template ###` (`:107-123`); `###Jobscan check` 5-column HTML table with a match-score footer row (`:125-158`). **It asks for HTML + `###` sections. It never asks for JSON and never names a `finalSkills*` key.** |
| **4. Who reads it / how** | `pipeline.ts:411` → **`parseAgentJson`** (`agentJson.ts:59`) — a JSON-object parser. |
| **5. Reaches a document** | Intended: `updatedResumeSummary→ResumeSummary`, `finalSkills1/2→SkillsBullets1/2`, `finalRelevant1..3→RelevantBullets1..3` (`mt17.ts:137,148-149,155-157`), each **outranking Calls 1 and 2**. Actual: nothing, because the parse cannot succeed (gap G1). |
| **6. DISCARDED** | `### Final Skills QC ###` table, `### Resume Summary Validation ###` table, the three `"Removed"` stubs, `### Cold Email Template ###`, and the `###Jobscan check` table — **no key in `assemblePackage` corresponds to any of them**. `jobscanQcTable` appears in the mock (`mt17.ts:46`) but is read by no line of `assemblePackage` (`mt17.ts:131-169`). |

### Row 5 — node **291230256 · "Strip HTML Skills Bullet List Formatting"** (README row 27)

| | |
|---|---|
| **2. Live partition key** | **NONE — never migrated.** |
| **3. What it asks for** | 5+ `###` sections (`27-…md:14`): `### Final Skills 1 ###`, `### Final Skills 2 ###`, `### Final Relevant Skills 1/2/3 ###` (`:16-20`) — strip all HTML back to plain text — plus `### Pipe Separated Original Skills ###` (`:22`) and `### Pipe Separated Final Skills ###` (`:26`). |
| **4. Who reads it** | In the zap this is the LAST step before the resume document: node `291230257` splits it on `###`, and `293026317/18/19/20/21` trim `Item 3/5/7/9/11` into `SkillsBullets1`, `SkillsBullets2`, `RelevantBullets1..3` on the Google Doc (full JSON, node `289877670.params`). In the app: **nothing**. |
| **5/6. Fate** | Whole node DISCARDED — see gap G2: this is the node that turned the QA pass's HTML into the plain text the template expects, and the app has no equivalent. |

### Row 6 — node **289877672 · `send_email`** (README row 39)

Not a prompt. README states it was **NOT migrated**; `docs/zap-289877647/39-send-email.md` is 320
lines of review-email HTML. It is the ONLY consumer in the whole zap of
`{{290709250__output__Item 17}}` = **"Updated Resume Summary"** (`39-send-email.md:44`), of the cold
email (`:31-32`), and of the Jobscan/QC tables (`:37-53` and the table that follows).

---

## THE ZAP'S OWN DOCUMENT MAPPING (the primary source for "what was supposed to reach a document")

From `zap-289877647.full.json`, node `289877670` "Create Sample Resume Template in Google Docs"
(`file = 1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw` — **the same id as
`packetTemplates.ts:13 RESUME_TEMPLATE_ID`**):

| Doc placeholder | Zap source | Ultimate origin |
|---|---|---|
| `ResumeSummary` | `{{289877667__ResumeSummary}}` | loop node `289877667` ← `289877662 Item 9` ← **Call 1** |
| `SkillsBullets1` | `{{293026317__output}}` | ← `291230257 Item 3` ← **291230256 (Strip HTML)** ← `290709250` ← **289877668 (Post Analysis QA)** |
| `SkillsBullets2` | `{{293026318__output}}` | same chain, `Item 5` |
| `ExpertiseBullets` | `{{289877667__Expertise}}` | ← `289877662 Item 15` ← **Call 1** |
| `RelevantBullets1/2/3` | `{{293026319/20/21__output}}` | ← `291230257 Item 7/9/11` ← **Strip-HTML chain** ← Post Analysis QA |

Portfolio (`289877671`, presentation id `1ULZZLBs9zwLEN…` = `packetTemplates.ts:14`) and cover
(`291230258`, `1QN4Cnw4R9krUH…` = `packetTemplates.ts:15`) take `@AboutMe1_50words`,
`@AboutMe2_60words`, `@ExecutiveProfile_55words`, `@CoreAccomplishments_5blts_180words`,
`@Company`, `@CoverLetterDate`, `@CoverLetterBody` — **all from the `289877667` loop, i.e. all from
Call 1** (`289877662 Item 25/27/29/31/7/3/23`; core accomplishments passes through `289877666`
"Remove Dash"). The placeholder names match `packetTemplates.ts:33,37` exactly.

**Two facts fall out of this, and both contradict the code:**
1. In the zap, **`ResumeSummary` on the document is Call 1's**, not the QA pass's `Updated Resume
   Summary`. The updated summary went only to the review email (`39-send-email.md:44`).
   `mt17.ts:137` inverts this — `call3.updatedResumeSummary` **outranks** `call1.resumeSummary`.
2. In the zap, the skills bullets reach the doc through **three post-processing nodes the app never
   migrated** (290709248 → 290709249, 291230256 → 291230257 → 2930263xx). The app replaced that
   whole chain with "Call 3 returns JSON keys" — a contract no prompt ever agreed to.

---

## BASELINE `set_value` NODES → MasterContext

`api/src/functions/tests/zapVars.ts:37-50` is the whole mapping. `resolveZapVars` blanks every
unmapped `{{…}}` (`zapVars.ts:59-63`).

| Zap node | Title | Token | MasterContext field | Interpolated into a live prompt today? |
|---|---|---|---|---|
| 289877648 | Current Resume Summary | `289877648__value` | `mc.resumeSummary` (`zapVars.ts:38`) | **YES** — `resume_user` + `portfolio_user` |
| 289877649 | Current Work Experience | `289877649__value` | `workHistory1..4` joined (`zapVars.ts:28-30,39`) | **YES** — both |
| 289877650 | Current Skills | `289877650__value` | `"Skills List 1:\n…\n\nSkills List 2:\n…"` from `mc.skills1`,`mc.skills2` (`zapVars.ts:34,40`) | **YES** — both |
| 289877651 | Current Expertise | `289877651__value` | `mc.expertise` (`zapVars.ts:41`) | **YES** — both |
| 289877652 | Relevant Skills | `289877652__value` | `mc.relevantProficiencies` (`zapVars.ts:42`) | **YES** — both |
| 289877653 | **Cover Letter** | `289877653__value` | **NOT IN THE MAP** | **NO** — no live prompt references the token either |
| 289877654 | About Me Passage 1 | `289877654__value` | `mc.aboutMe1` (`zapVars.ts:43`) | **YES** — both |
| 289877655 | About Me Passage 2 | `289877655__value` | `mc.aboutMe2` (`zapVars.ts:44`) | **YES** — both |
| 289877656 | Exceutive Profile Paragraph | `289877656__value` | `mc.executiveProfile` (`zapVars.ts:45`) | **YES** — both |
| 289877657 | Executive Profile Core Accomplishments | `289877657__value` | `mc.coreAccomplishments` (`zapVars.ts:46`) | **YES** — both |
| 289877658 | **Soft/Hard Skills** | `289877658__value` | **NOT IN THE MAP** | **NO** — token appears in no live prompt |
| 289877659 | Items to Omit | `289877659__Items to Omit` | `mc.itemsToOmit` (`zapVars.ts:47`) | **YES** — both |
| 294827237 | **Sample Cover Letter** | `294827237__value` | **NOT IN THE MAP** | **NO** |

Two non-baseline entries complete the map: `289877647__answers__Target Job Description` → the run's
JD (`zapVars.ts:48`) and `zap_meta_human_now` → the server clock (`zapVars.ts:49`) — the latter used
only by `resume_user` (`16-…md:44`).

`itemsToOmit` is deliberately EXCLUDED from `profileFromMasterContext` (`pipeline.ts:97`, reason at
`pipeline.ts:422-424`) so a banned item is never credited as profile content.

---

## `ats_user`'s TOKENS — which resolve and which are blanked

`pipeline.ts:385-400` builds `atsExtra` with exactly nine keys. Node 289877668 references **21
distinct tokens**. Everything not in `atsExtra` or the base map is replaced with `''`
(`zapVars.ts:59-63`).

| Token in `ats_user` | Resolves? | Where |
|---|---|---|
| `289877667__ResumeSummary` | ✅ `c1.resumeSummary` | `pipeline.ts:391` |
| `289877667__skills list 1` / `2` | ✅ `c2.skills1 \|\| c1.skills1` (etc.) | `pipeline.ts:392-393` |
| `289877667__Expertise` | ✅ `c1.expertise` | `pipeline.ts:394` |
| `289877667__Relevant 1` / `2` / `3` | ✅ | `pipeline.ts:395-397` |
| `289877662__output__Item 7` | ✅ company | `pipeline.ts:398` |
| `289877662__output__Item 5` | ✅ jobTitle | `pipeline.ts:399` |
| `289877647__answers__Target Job Description` | ✅ the JD | `zapVars.ts:48` |
| `289877662__output__Item 33` — *the Job Responsibilities & Skills HTML table* | ❌ **blanked** | not in `atsExtra` |
| `289877662__output__Item 53` — *JD skills for the Jobscan check* | ❌ **blanked** | — |
| `289877662__output__Item 41/43/45` — *"Relevant skills b" lists* | ❌ **blanked** | — |
| `290709249__output__Item 13` / `Item 15` — *"List B" Skills 1/2* | ❌ **blanked** | producer node 290709248 was never migrated |
| `289877647__answers__Hiring Contact Name` | ❌ **blanked** | — |
| `289877647__answers__LinkedIn Connection to Mention?` | ❌ **blanked** | — |
| `289877647__id`, `289877660__hour` (memory key) | ❌ **blanked** | — |

So **12 of 21** tokens reach the model empty. The prompt's first instruction —
*"Store but don't output the column items from the html table included here"* (`25-…md:15`) — is
handed an empty string, and its central task, comparing List A against List B, compares against
nothing.

---

# DIRECT ANSWERS

## Q1. Which zap nodes were NEVER migrated into the Prompts table, and what did they do?

Only three of the zap's five `chat_completion_memory` nodes have a live partition key. The full
40-node list is in `zap-289877647.full.json`; the never-migrated ones are:

**Prompt nodes never migrated**
- **290709248 · "Skills HTML Bullet List Formatting"** (`prompts/19-…md`). Wrapped 15+ bullet lists
  in `<ul>/<li>` — `Original Skills 1/2`, `Relevant Skills 1/2/3`, `Updated Skills 1/2`, `Updated
  Relevant Skills 1/2/3`, `Stored Skills`, `Stored Relevant Skills`, `Expertise`, `Updated
  Expertise`, `Core Achievements`, `Updated Core Achievements` (`19-…md:16-43`). In the zap its
  output was split by node `290709249` and fed to Post Analysis QA as **"List B"**
  (`25-…md:64,66` reference `{{290709249__output__Item 13}}` / `Item 15`).
- **291230256 · "Strip HTML Skills Bullet List Formatting"** (`prompts/27-…md`). The inverse
  transform — HTML back to plain text — producing `### Final Skills 1/2 ###`, `### Final Relevant
  Skills 1/2/3 ###`, and two pipe-separated blocks (`27-…md:16-26`). **This is the node that fed the
  resume document**: `291230257` split it, `293026317/18/19/20/21` trimmed it, and those became
  `SkillsBullets1/2` and `RelevantBullets1/2/3` on the Google Doc (full JSON, `289877670.params`).

**Non-prompt nodes never migrated** (no partition key exists for any of them; the six read keys are
enumerated at `pipeline.ts:336-410`):
- `298124586` (Code: template-folder if/then), `289877660` (Code: current hour — supplies the memory
  key `{{289877660__hour}}` used at `25-…md:24`).
- The six `text_line_item` splitters `289877662`, `290709249`, `290709250`, `291230257`, and the
  cleanup formatters `289877664` (strip ```` ```html ````), `289877665` (strip ```` ``` ````),
  `289877666` (remove dash from core accomplishments).
- The trim nodes `293026316` (ATS skills), `293026317`, `293026318`, `293026319`, `293026320`,
  `293026321`.
- The loop node `289877667` "Create Loop to Trim whitespace", whose 15 named outputs
  (`ResumeSummary`, `skills list 1/2`, `Expertise`, `Relevant 1/2/3`, `Target Company`, `Target
  Role`, `About Me pt 1/2`, `Exec Profile pgrph`, `Core Accomplishments`, `Today's Date`, `Cover
  Letter`) are what the document nodes actually read.
- The four document nodes `289877670`, `293026322`, `289877671`, `291230258` — replaced by
  `packetTemplates.ts` (same template file ids, `packetTemplates.ts:13-15`).
- `289877672` `send_email` — the review/grade email, confirmed NOT migrated by
  `docs/zap-289877647/README.md` and preserved at `docs/zap-289877647/39-send-email.md`.

The app collapsed the split/format/strip/trim chain into "the model returns structured output" and
kept only the three generation prompts.

## Q2. Does node 289877668 ask for `finalSkills1` / `finalSkills2` / `finalRelevant1..3` / `updatedResumeSummary`?

**No — not under those names, and not as JSON.** It asks for `###`-bookended sections. Quoted
verbatim from `docs/zap-289877647/prompts/25-post-analysis-qa.md`:

- `:40-45` — the five skills lists:
  > `6. At the bottom of the output, Bookend each header below with ###, and use <ul> and <li> html list tags for each to include the skills for the final merged bullet lists of:`
  > `   1 - ###  <h3>  Skills 1 <h3> ###  (Seperate output bookended with ### is a hard requirement)`
  > `   2 - ###  <h3>  Skills 2 <h3> ###  (Seperate output bookended with ### is a hard requirement)`
  > `   3 - ###  <h3> Relevant Skills 1 <h3> ###  (Seperate output bookended with ### is a hard requirement)`
  > `   4 - ###  <h3> Relevant Skills 2 <h3> ###  (Seperate output bookended with ### is a hard requirement)`
  > `   5 - ###  <h3> Relevant Skills 3 <h3> ###  (Seperate output bookended with ### is a hard requirement)`
- `:95-96` — the summary:
  > `### Updated Resume Summary ###`
  > `Maintaining the structure, style, and flow of the original, provide an updated resume summary covering the missing that also covers the missing items but in the same word count`

The word "JSON" does not occur anywhere in the node — the file's only structural instructions are
the opposite: `:89` *"Generate a clean HTML table without wrapping it in triple backticks or any code
formatting. I need raw HTML output only"*, and `:126` *"Output a 5-column HTML table, formatted using
`<table>`, `<tr>`, `<td>`, `<thead>`, and `<tbody>` tags"*.

**So the content is requested; the SHAPE is not.** The code asks for a JSON object:
- `pipeline.ts:411` — `const p3 = parseAgentJson(r3.choices?.[0]?.message?.content)`.
- `pipeline.ts:410` sends `${base3}\n\nINPUTS:\n${JSON.stringify(call3Input)}` — **it appends no
  instruction to return JSON**, and `pipeline.ts:327-330`'s request body carries **no
  `response_format`** (contrast `pipeline.ts:258`, which sets `response_format: { type: 'json_object' }`
  for scoped regeneration).
- `parseAgentJson` (`agentJson.ts:59-87`) tries direct parse → fence strip → balanced-brace scan, and
  returns `{value:null, via:'none'}` when none succeeds.
- A reply of `###`-fenced HTML has no balanced JSON object, so `p3.value === null`, `c3 = {}`
  (`pipeline.ts:412`), and every `call3.*` lookup in `assemblePackage` (`mt17.ts:137,148-149,155-157`)
  is `undefined` → `firstNonEmpty` falls through to Call 2/Call 1.

**That is a complete, sufficient explanation for "live builds show Call 3 returning NOTHING for all
five fields" — and it is mechanical, not a model failure.** The observation is exactly what this code
must produce given this prompt. It should surface as the warning at `pipeline.ts:416`:
`Call 3 (ATS QC) returned no JSON object (…) — the package is Call 1 unreviewed`.
*(Observation: the prompt text and the parser. Interpretation: that this is the cause of the live
symptom. Confirmable by reading `warnings[]` / the `steps` line `Agent Call 3 … JSON via none,
applied: false` from a real build — I cannot reach a live build from this sandbox.)*

**The repo already contains a second opinion that agrees.** `mt16.ts:57-58`, the harness route for
the very same `ats_user` prompt, says:
> `// The real ATS/Post-Analysis-QA prompt returns ###-delimited HTML sections,`
> `// not JSON. Parse into { header: body } and verify the expected sections.`

and it parses the reply with `splitSections` (`mt16.ts:63-66`) — the section parser — while
`pipeline.ts:411` parses the identical prompt's reply with `parseAgentJson`. **Two files in this
repo disagree about the output format of one prompt, and the production one is the one that is
wrong.** `mt16.ts:42`'s hardcoded fallback (`'…Return JSON with: finalSkills1 (array)…'`) is the
only text anywhere that ever requested those key names — and it is used **only when the live prompt
is missing** (`userPrompt || '…'`).

## Q3. Prompts in the live table with no zap ancestor / rows that have drifted

**I cannot query the live `Prompts` table from this sandbox** (`CLAUDE.md`: egress blocks
`azurewebsites.net`; the answer would come from `GET /api/prompts` via `api-test.yml`). Everything
below is from the repo, and the prior-art numbers are treated as history.

- **Ancestry.** Every one of the six keys has a zap ancestor on the evidence in the repo:
  `resume_user`←289877661, `resume_system`←289877661's `system_message` (`16-…md:8`),
  `portfolio_user`←299599701, `portfolio_system`←299599701's `system_message` (`17-…md:8`, identical
  text), `ats_user`←289877668, `ats_system`←289877668's `system_message` `"You are a helpful
  assistant."` (`25-…md:8`). **No key exists in `api/src` that lacks one.** Nothing in the repo seeds
  the table (there is no `SEED_PROMPT`/`seedPrompts` anywhere; the only writer is
  `POST /api/prompts`, `promptsApi.ts:58+`, and `mt09.ts:18` writing a throwaway `resume_system`
  row) — so a live row with no ancestor is possible and **unfalsifiable from here**. The check
  that would settle it: `GET /api/prompts` and diff each `content` against
  `docs/zap-289877647/prompts/*.md`.
- **Prior art, read and treated as history** — `pipeline.ts:102-156` (`duplicatePromptPairs`):
  - Measured 2026-08-21 (run 32435525197): `resume_user` 29,068 / `portfolio_user` 29,068 (same
    sha256 `4b4af848…`) / `ats_user` 8,807 (`pipeline.ts:110-113`).
  - Primary source: node 289877661 `user_message` 29,069 chars; node 299599701 `user_message` 7,712
    (`pipeline.ts:116-117`).
  - **Superseded, per the comment's own "RESOLVED SINCE" block** (`pipeline.ts:132-136`): the owner
    installed the right text; live `portfolio_user` is v002, 7,714 chars, notes *"Zap 289877647 node
    299599701 user_message verbatim"*, confirmed 2026-08-22 (api-test run 32553002646).
  - `resume_system` / `portfolio_system` byte-identical at 329 chars is **correct, not drift**
    (`pipeline.ts:145-151`) — the two zap nodes genuinely share a 331-char system message.
- **Drift I CAN evidence from the repo, and it is drift in the comments, not the table:**
  - `pipeline.ts:117` records node 299599701's `user_message` at **7,712** chars; the live v002 row
    is **7,714** (`pipeline.ts:133`). On disk today
    `docs/zap-289877647/prompts/17-…md` is 8,317 bytes total including its 20-line markdown wrapper —
    consistent with ~7.7 KB of prompt body, so the 2-char delta is whitespace normalisation, not a
    different prompt. **INFERENCE**, from byte counts only.
  - `promptsApi.ts:24-25` states *"`resume_user` alone is ~7,700 characters"*. Every other
    measurement in the repo puts `resume_user` at **29,068-29,069** (`pipeline.ts:111,116`), and the
    on-disk node 16 file is 29,936 bytes vs node 17's 8,317. **The `promptsApi` comment is stale —
    it quotes `portfolio_user`'s size under `resume_user`'s name.** Cosmetic, but it is the kind of
    stale figure that produces a wrong diagnosis.
  - `README.md`'s "KNOWN BUG: `portfolio_user` is byte-identical to `resume_user`" is **also now
    history** and contradicts `pipeline.ts:132-136`. The export README was not updated when the
    owner fixed the row.

## Q4. The baseline `set_value` nodes

Mapping is the table in the **BASELINE `set_value` NODES → MasterContext** section above
(`zapVars.ts:37-50`). Summary:

- **10 of 13 baseline nodes are mapped AND live-interpolated** — 289877648/649/650/651/652/654/655/
  656/657/659 — because `resume_user` (node 16) and `portfolio_user` (node 17) both reference
  exactly those ten tokens (verified by extracting every `{{…}}` from each node file).
- **3 are mapped by nothing and referenced by nothing:** `289877653` **Cover Letter**, `289877658`
  **Soft/Hard Skills**, `294827237` **Sample Cover Letter**. They are absent from
  `zapVars.ts:37-50`, and no live prompt contains their tokens — so even if a MasterContext field
  existed, it would never be interpolated.
- **`ats_user` interpolates NO baseline node at all.** Its inputs come from `atsExtra`
  (`pipeline.ts:385-400`) and the JD; 12 of its 21 tokens resolve to `''` (table above).
- The one extra live-only token is `zap_meta_human_now` → server clock (`zapVars.ts:49`), used only
  by `resume_user` (`16-…md:44`).

---

# THE GAP LIST — where prompts and code disagree, most consequential first

### G1 — `ats_user` is asked for `###`/HTML and parsed as JSON. Call 3 is inert on every build.
- Prompt: `25-…md:40-45,86-96,126` — `###`-bookended sections and *"raw HTML output only"*.
- Code: `pipeline.ts:411` `parseAgentJson`; `pipeline.ts:410` appends no JSON instruction;
  `pipeline.ts:327-330` sets no `response_format`.
- Consequence: `c3 = {}` (`pipeline.ts:412`), so `assemblePackage`'s five highest-precedence
  sources — `updatedResumeSummary`, `finalSkills1/2`, `finalRelevant1/2/3` (`mt17.ts:137,148-149,
  155-157`) — never resolve. **The entire ATS QC pass is bought at 15,500 tokens and thrown away.**
  This is the identical defect class already fixed once for Call 2 (`pipeline.ts:355-375`), left
  unfixed on Call 3.
- Corroborated inside the repo by `mt16.ts:57-58`, which states the format correctly and parses with
  `splitSections`.

### G2 — Even if Call 3 parsed, the app has no HTML-stripping stage; the zap had two nodes for it.
- The prompt demands `<ul>/<li>` bodies (`25-…md:40`); the resume template placeholders take plain
  text (zap chain `289877668 → 290709250 → 291230256 (Strip HTML) → 291230257 → 293026317/18/19/20/21
  → 289877670.params.template_field__SkillsBullets1…`).
- Node 291230256 was never migrated (Q1). `packetTemplates.ts:150-157 injectValues` does a raw
  `replaceAllText` with no sanitisation.
- Consequence: a "fixed" G1 that merely swaps in `parseResumePackage` would inject literal
  `<ul><li>…` markup into the Google Doc. **G1's fix is incomplete without G2.**

### G3 — Call 3 is asked to compare List A against a List B that is always empty.
- `25-…md:62-66` sources List B from `{{290709249__output__Item 13}}` / `Item 15`, i.e. from node
  290709248 — never migrated. `atsExtra` (`pipeline.ts:385-400`) supplies neither, so `zapVars.ts:62`
  blanks both.
- Same for `{{289877662__output__Item 33}}` (`25-…md:15`, the Job Responsibilities table the prompt
  says to "store … for upcoming tasks"), `Item 53` (`:129`, the Jobscan skill source), and
  `Item 41/43/45` (`:79-83`, "Relevant skills b").
- Consequence: **12 of 21 tokens empty.** The QC pass's core comparison, its Jobscan extraction and
  its cold-email personalisation (`{{…Hiring Contact Name}}`, `{{…LinkedIn Connection to Mention?}}`,
  `:111-113`) all run against blanks. This makes G1 partly moot: fixing the parser would admit a
  verdict formed from empty inputs into the document, **and Call 3 outranks Calls 1 and 2**.

### G4 — `mt17.ts:137` inverts the zap's own precedence for `ResumeSummary`.
- Zap: the resume document's `ResumeSummary` is `{{289877667__ResumeSummary}}` = `289877662 Item 9`
  = **Call 1's** section (full JSON, `289877670.params` + `289877667.params.loop_values`). The QA
  pass's `Updated Resume Summary` went **only to the review email**, `39-send-email.md:44`.
- Code: `firstNonEmpty(call3.updatedResumeSummary, call1.resumeSummary, …)` — Call 3 **outranks**
  Call 1 (`mt17.ts:137`).
- Consequence: currently latent (G1 keeps `call3` empty). The moment G1 is fixed, the document's
  summary silently changes source — a behaviour change the owner never asked for, and one the export
  is the primary source against.

### G5 — Call 1's own post-swap refinement can never reach a document.
- `16-…md:351` — *"Provide an updated `### Skills1 ###`, `### Skills2 ###`, `### Relevant Skills 1 ###`,
  2, & 3 with the adjustments suggested swaps"*.
- `resumeParser.ts:155` — `keys.find(k => !fields[k])`, first occurrence wins; a second `### Skills1 ###`
  finds `fields.skills1` already set and falls to `resumeParser.ts:170`, `_unmapped`.
- The prompt has been edited to neuter this (`:355-357` `return "Moved"` for both lists) — so today
  the loss is intentional. **But the mechanism is silent and general**: any prompt edit that
  re-issues an already-filled section loses it, reported only as a generic
  *"maps to no merge field"* warning (`pipeline.ts:346-348`), which is the wrong reason.

### G6 — Six analysis sections per build are produced and dropped; the Call-3 half is not even collected.
- Call 1 emits `### Job Description Summary ###`, `### Second Job Description Check ###`,
  `### Missing ATS Skills ###`, `### Missing ATS Swap Suggestions ###`, `### Word and Character
  Requirements Check ###`, `### Jobscan Extraction` (`16-…md:288,315,329,341,359,362`). None matches
  `TITLE_MAP` (`resumeParser.ts:40-66`) → `_unmapped`.
- `collectAnalysis(built.calls.c1, built.calls.c2)` (`appPackets.ts:437`, defined
  `packetBuild.ts:153`) surfaces the Call-1/Call-2 ones — **it takes no `c3` argument**, and `c3`
  from `parseAgentJson` has no `_unmapped` field to surface anyway. So Call 3's `### Final Skills QC ###`
  table, `### Resume Summary Validation ###` table, `### Cold Email Template ###` and `###Jobscan
  check` table are **not even visible as discarded**.

### G7 — `coldEmail` is doubly dead on the live path.
- `assemblePackage` sets `coldEmail: call2.coldEmail || null` (`mt17.ts:165`), but `pipeline.ts:420`
  passes `call2Draft(c2)`, whose allowlist is `CALL2_FIELDS` (`mt17.ts:83,122-129`) — `coldEmail` is
  not in it, so the value is always stripped.
- The prompt that actually writes a cold email is `ats_user` (`25-…md:107-123`) — Call 3, whose
  output is discarded by G1, and whose key would be a `###` section, not `coldEmail`.
- `coldEmail` is in no `TEMPLATE_META.placeholders` list (`packetTemplates.ts:22-39`), so
  `varsForType` never injects it (`packetTemplates.ts:80`). It renders into the delivery email as
  `${(pkg.coldEmail || '').slice(0,2000)}` (`pipeline.ts:596`) — i.e. **an empty `<pre>` block on
  every build**.

### G8 — Four assembled package keys reach no template.
`WorkHistoryBullets1..4` are assembled (`mt17.ts:151-154`, sourced from MasterContext via
`resumeParser.ts:195-198`) but appear in **no** `placeholders` array (`packetTemplates.ts:25,29,33,37`),
so `varsForType` (`packetTemplates.ts:80`) never emits them. Same for `targetRole` (`mt17.ts:166`).
Whether the resume template has a work-history placeholder at all is a question for
`GET /diag/template-placeholders` (`packetTemplates.ts:7`) — not answerable from the sandbox.

### G9 — `### Target Job Title` / `### Target Company` are declared without a closing `###`.
`16-…md:45-46` writes `### Target Job Title - Extract and return…` — one-sided. `HEADING_LINE`
(`resumeParser.ts:111`) requires `^\s*###\s*(.+?)\s*###\s*$`, alone on its line. The prompt's global
instruction (`:40` *"Bookend each Header with ### in front and back"*) is what saves it, so this
depends on the model obeying the general rule over the specific example. Low blast radius —
`parseResumePackage` falls back to the request's `jobTitle`/`company` (`resumeParser.ts:177-178`) —
but it is a real prompt/parser mismatch.

### G10 — Documentation drift (no runtime effect, high misdiagnosis cost).
- `docs/zap-289877647/README.md` still asserts the `portfolio_user == resume_user` bug that
  `pipeline.ts:132-136` records as fixed on 2026-08-22.
- `promptsApi.ts:24-25` sizes `resume_user` at "~7,700 characters"; every measurement says 29,068
  (`pipeline.ts:111,116`).
- README's node table lists 20 of the 40 nodes; the other 20 (formatters, trims, loop, doc nodes)
  are only in `zap-289877647.full.json`, which is where the document field mapping actually lives.

---

## What I could NOT verify from this sandbox (and what would settle it)

| Claim | Settled by |
|---|---|
| Live `Prompts` rows match the zap export byte-for-byte | `GET /api/prompts` via `api-test.yml`, diffed against `docs/zap-289877647/prompts/*.md` |
| Call 3 actually returns `###` HTML (not JSON) at runtime | a real build's `warnings[]` / the `steps` entry `Agent Call 3 … JSON via none, applied: false` (`pipeline.ts:416-418`) |
| Whether the resume template contains a work-history placeholder | `GET /diag/template-placeholders` (`packetTemplates.ts:7`) |
| Whether a live row exists with no zap ancestor | the same `GET /api/prompts` listing — key set vs. the six read at `pipeline.ts:336-410` |

_Status: COMPLETE._
