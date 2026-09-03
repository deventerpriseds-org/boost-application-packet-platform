# AC — Video script authoring: QC review, manual trigger, editable draft, provenance, context wiring

**Tier 1** (this change admits model output into a stored claim, and touches the QC gate surface).
> ## ⛔ INCOMPLETE — THE PASS DIED, DO NOT READ THIS AS A FINISHED AC SET
> The AC subagent **terminated early on an API 529 (Overloaded)** — a transient server error, not a
> conclusion. Its last words were *"Requirements 2 and 4 look largely already built. Let me verify
> the edit path."* So: **the feasibility TABLE is unassembled, requirements 2 and 4 are UNPROVED,
> and NO ACs have been written yet.** Findings F1-F6 below stood before it died and each carries its
> own proof. Committed at 7,994 bytes purely as restore insurance, per this repo's rule that a
> stalled pass is stamped rather than left readable as a pass. Resumed after this commit.

**Status: INCOMPLETE — pass terminated on a 529. Sections appear as they are proved.**
Author: AC subagent (cold read). Date: 2026-09-03. Branch: `claude/boost-app-setup-approach-lkjoid`.

The owner's five requirements, verbatim intent:
1. Video script draft gets **the same QC Review treatment and right-hand panel as the cover letter**.
2. **Draft generation is a MANUAL click**, never automatic per submission.
3. **Anything the script states as fact must expose WHAT it came from and WHERE** — the generator
   needs the raw JD.
4. Three owner-controlled steps: **trigger** → **expose script as editable text** → **manually push
   to video creation**.
5. **Wire profile/master context AND company context into `artifactGenerate`'s user message.**

---

## 1. FEASIBILITY TABLE (published FIRST, per CLAUDE.md "Feasibility BEFORE implementation")

_(populating — see below)_

### Raw findings log (appended live as proved — the table is assembled from these)

**F1 — `artifactGenerate` ALREADY HAS the raw JD in memory and throws it away.**
`api/src/functions/tests/appPackets.ts:284` does `const opp = (await client.query(\`${OPP_FIELDS} where id = $1\`, [art.opp_id])).rows[0]`.
`OPP_FIELDS` (`appPackets.ts:408-409`) is:
```
select id, company, role, comp_range, why_surfaced, company_signals,
  pain_hypotheses, persona_key, jd_html, jd_posting_raw from opportunity
```
`jd_html` and `jd_posting_raw` are ALREADY SELECTED. The user message at `appPackets.ts:288` simply
never references them. Requirement 3's "the generator needs access to the raw JD" is therefore NOT a
data-access problem — the row is already in the variable. Verdict: **EXISTS**.
Its own comment says why it exists: *"It was duplicated across four call sites and all four omitted
jd_html, which is how generation ended up reading a synthesised pseudo-JD instead of the posting (X1)."*
The constant was created to fix exactly this class of bug, and `artifactGenerate` is a fifth call
site that reads the constant but does not use the field.

**F2 — the profile / master-context reader is ALREADY IMPORTED into this exact file.**
`appPackets.ts:17`: `import { sourceText } from './appFacts'`. Used at `appPackets.ts:564` and
`appPackets.ts:1013`. `appFacts.ts:34` `sourceText()` returns `{ text, sources, records }`, where
`text` = resume template (Google Doc, via `getGoogleOAuthToken`) + MasterContext blocks (Azure
Storage Table, via `readMasterContextEntity`), and **`sources` is an explicit provenance list**
(`resume template <id>`, `MasterContext (N blocks)`, or `... UNREADABLE: <err>`).
=> Requirement 5 is **NOT blocked** on `D:master-context-lives-in-the-wrong-store`. `artifactGenerate`
runs in the Function App, which reaches the Storage Table directly. The migration is orthogonal.

**F3 — `resolvePostingSource` / `groundingText` (`jdText.ts:63`, `:83`) are ALREADY IMPORTED at
`appPackets.ts:7`** and used at `appPackets.ts:448` and `:563`. `resolvePostingSource` returns
`{ text, source: 'jd_html' | 'jd_posting_raw' | null }` — i.e. **it already names WHERE the text came
from**, and its docstring already states the evidence rule: *"Anything that records offsets or quotes
must use THIS function and accept `source:null` when the real posting is absent."*
This is the existing provenance primitive requirement 3 must extend.

**F4 — the existing JD-grounded prompt builder `generationJd()` is 160 lines above the ad-hoc
video prompt, in the same file, and the video path does not call it.**
`appPackets.ts:447` `generationJd(opp)` returns
`{ jd, grounded }` where `jd` is:
```
JOB POSTING (the employer's own words - ground every claim in this):
<resolvePostingSource(opp).text sliced to 12000>

RESEARCH CONTEXT (our notes, NOT from the posting):
<role/company/comp/company_signals/pain_hypotheses>
```
and `grounded` is persisted as `packet.jd_grounded` (`appPackets.ts:~615`). Its docstring records the
exact defect being repeated in the video path: *"Was: a pseudo-JD assembled from role + company +
why_surfaced + company_signals + pain_hypotheses, with `jd_html` never selected."* — which is a
**verbatim description of `artifactGenerate`'s current user message**. The templated build (`resume`,
`compact_resume`, `cover`, `portfolio`) goes through `ensurePackage` → `generationJd`; the video is
the ONE type that still uses the pre-X1 pseudo-JD string. Verdict: **EXISTS** (the fix is to route
video through the existing builder, not to write a new one).

**F5 — THE HARD CONSTRAINT ON REQUIREMENT 1. The checks engine grades `packet.pkg_json` merge
fields, NOT `artifact.content`, and `video` has no merge fields at all.**
- `appChecks.ts:191-192`: `runChecks({ type: art.type, pkg: art.pkg_json || {}, ... })`.
- `checks.ts:423`: `const fields = checkFieldsFor(input.type)`.
- `checks.ts:390`: `checkFieldsFor(type)` = `CHECK_FIELDS_FOR[type] || mergeFieldsFor(type)`.
- `insertions.ts:61`: `mergeFieldsFor(type)` = `TEMPLATE_META[type]?.placeholders ?? []`.
- `packetTemplates.ts` `TEMPLATE_META` has entries for `resume`, `compact_resume`, `portfolio`,
  `cover` — and **NO `video` entry**. So `checkFieldsFor('video') === []`.
The engine's own comment (`checks.ts:409-421`) names this exact failure mode from when
`compact_resume` lost its placeholders: *"it silently took SIX CHECKS WITH IT ... They did not
degrade to `not_applicable`; they were never emitted at all, and `gateFor` cannot see a check that
never ran. Measured ... resume 17 results, compact_resume 12."*
`gateFor` (`checks.ts`) does refuse a vacuous pass — `if (!results.length) return 'warn'` — so a
video gate cannot go green on zero rows. But an unactionable permanent `warn` is not the cover
letter's QC treatment either.
Verdict: **EXISTS-BUT-CONSTRAINED**. The rail, the gate, the score and the panel are generic; the
CHECK CONTENT is merge-field-shaped and the video script is a single prose blob in
`artifact.content`. Requirement 1 cannot be satisfied by "point the existing rail at video" alone.

**F6 — MEASURED, AND IT IS A LIVE DEFECT ON `main`, NOT A FEASIBILITY NOTE.**
Running the real compiled engine (`api/dist/functions/tests/checks.js`, built from HEAD):
```
$ node -e "const c=require('./dist/functions/tests/checks.js'); ...runChecks({type:t, pkg:{ResumeSummary:'x',SkillsBullets1:'a; b',SkillsBullets2:'c; d'}, ...})"
resume          results=17   gate=fail   attention=3
compact_resume  results=18   gate=fail   attention=3
cover           results=9    gate=fail   attention=1
portfolio       results=9    gate=fail   attention=1
video           results=8    gate=PASS   attention=0   fields=[]
```
and with an empty pkg: `video / empty pkg -> results=8 gate=pass attention=0`.

**`POST /api/app/artifact/{videoArtifactId}/checks` today returns a GREEN GATE for a video
artifact, having graded ZERO characters of the script.** `checks.ts` contains **0** references to
`.content` (`grep -c "input.content\|\.content" checks.ts` → `0`) — the engine cannot see the video
script at all. `empty_merge_fields` passes because there are no merge fields to be empty; the video
does not even emit `word_counts`.
Downstream: `approvalBlock` (`appChecks.ts:331`) returns `{blocked:false}` on `gate==='pass'`, so
`artifactStatus` → `approved` succeeds. **A fabricated video script can be approved through a gate
that checked nothing.** This is precisely the standing rule *"Absent evidence is `not_applicable`,
never `pass`. A check that passed because there was nothing to check against is how a gate goes
green on unverified work."*
Verdict: this is the single strongest argument FOR requirement 1, and it upgrades requirement 1 from
"nice parity" to "close a vacuous gate". An AC and an H-case are owed here regardless of whether the
rest of the feature ships.
