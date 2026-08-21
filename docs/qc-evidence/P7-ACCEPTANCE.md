# P7 — pipeline hygiene: acceptance criteria

Written COLD by an independent agent against `main` at `426a6ff`, before any P7 work. The headline
is that **half the section is already done** — the backlog was written against the original Zapier
zap, and much of it did not survive migration or was fixed in passing.

## Already closed — do NOT build these

| Item | Status | Evidence |
|---|---|---|
| 2. Concatenated split | **MOOT** | `grep -rn "split('###')" api/src` → 4 hits, none joins two prompts' output. Calls 2 and 3 parse via `parseAgentJson`. |
| 3. Hour-based memory key | **MOOT** | `grep -rn "getHours\|memoryKey\|conversationKey" api/src` → **zero**. No conversation memory exists in `api/` at all. |
| 7. Temperature 1.0 on QA | **FIXED** | `SEED_TEMPERATURES = {generate:0.7, qc:0.15}`; tested (`qc < generate`); owner-editable at `openai.qcTemperature`. |
| 5. `Unknown` → Drive folder id | **FIXED** | `isDriveId` rejects it, `requireDriveId` runs before the copy naming the setting, `resolveRoleFocus` can no longer emit a bare string. |
| 1. Positional coupling (parity half) | **FIXED** | `resumeParser` classifies each part independently; a stray `###` no longer re-aligns later sections. |
| 6. No failure path (MT-22 half) | **HALF** | `warnings[]`/`qcApplied` exist on `pipelineRun` — and the PRODUCTION path discards all of it. |

**4 of 8 closed, 2 half-closed.** Real work: items 1-residual, 4, 6-production, 8.

## The four that are genuinely open

**Item 1 residual — the backlog's own acceptance line is not met.** It reads *"a prompt edit that adds
a section cannot silently move content into the wrong resume slot."* Measured on `main`: a `###`
section whose title matches no `TITLE_MAP` entry is classified as BODY and absorbed into the previous
field, title and all. The delimiter is no longer load-bearing on parity; it is still load-bearing on
TITLE_MAP membership. An unrecognised section must go to a named bucket with a warning — silently
losing it and silently misfiling it are the same defect.

**Item 6 production half — the path that actually ships discards every warning.**
`buildTemplatedArtifact` reads none of `warnings`/`qcApplied`; all three call sites return bare
`{ok:true}`. The only surfacing is a `console.warn` nobody reads. Worse: `POST /api/pipeline/run`
returns **200** with `pass:false` on failure, and `api-test.yml` exits 1 only on ≥400 — so **a fully
failed pipeline run produces a GREEN Actions run.** A verification vehicle that reports success for a
failed run is worse than no vehicle.

**Item 4 — establish the fact before acting.** The duplicate-prompt claim rests on equal LENGTHS
(`resume_user` ≡ `portfolio_user` at 29,068 chars), not on compared content. Hash the four rows via
`GET /api/prompts` first; if they differ, the item is false and no authoring is warranted.

**Item 8 — the backlog understates this, and inverts it.** It says "hardcoded constants". The truth is
sharper: **six settings the console ALREADY offers are silently ignored by the pipeline.**
`google.resumeTemplateId`, `google.portfolioTemplateId`, `google.coverLetterTemplateId`,
`google.outputFolderId`, `microsoft.senderEmail`, `microsoft.recipientEmail` are all writable at
`web/src/App.jsx:52-71`; `CONFIG_KEYS` lists four keys and none of those six. The Drive ids are
hardcoded in eleven files, twice over. The Graph sender is a bare literal.

> **A setting that exists and is not read is worse than one that does not exist: it tells the owner
> they are in control when they are not.**

The fix EXTENDS `CONFIG_KEYS` with the RowKeys the console already writes. A renamed constant, an env
var, or a new `TEMPLATE_IDS` module is a rejection, not a fix.

## Owner decisions on the live prompts (2026-08-21)

**`resume_user` stays exactly as it is until the current prompt is proven working.** Live:
`v001`, **29,068 chars, sha `4b4af84859072c45`**. The `claude/qc-d14-d33` lane staged a trimmed
replacement (26,640 chars) that drops four sections — `Missing ATS Skills`,
`Missing ATS Swap Suggestions`, `Jobscan Extraction`, `Word and Character Requirements Check` — on
the reasoning that the QC engine now computes them. **That is not to be loaded.** The lane's own
agent flagged the risk it was taking: *"A different owner would keep `Jobscan Extraction` — its
per-skill JD-phrase→resume-phrase table is evidence provenance."* Evidence provenance is what
P8.1/P8.3/P8.4 built subsystems to obtain, so removing its only upstream source is a product
decision, not a cleanup. Revisit only after the current prompt is proven working in production; until
then the discarded-section warnings are the correct behaviour and `D33` stays open.

**Item 4 is settled, and the answer was the opposite of the length-based guess.** The duplicate was
real but `portfolio_user` was the wrong row, not `resume_user`: it held a byte-identical copy of the
resume prompt (both 29,068, sha `4b4af848`). The primary source settled which was wrong — Zap
289877647 node 289877661 is the resume prompt at 29,069 chars, node 299599701 the portfolio prompt at
7,712. `portfolio_user` is now `v002`, **7,712 chars, sha `b1adf7ee79f17c29`**, and Call 2's input
fell by ~16,000 to 5,118 tokens with all four fields populated (`@AboutMe1_50words` 382,
`@ExecutiveProfile_55words` 405, `@CoreAccomplishments` 772, `@CoverLetterBody` 1,453).

**No prompt has ever been trimmed.** Measured against the live store, not the repo —
`GET /api/prompts`, run `32448350079`, nine keys. Only two differ from their seed, and both grew or
were corrected rather than shortened:

| Key | Live | Change |
|---|---|---|
| `ats_system` | v002, 4,210 | **28-char stub → 4,210.** Authored by `62e4ede`; the stub was measured in run `32290705438`. A 150× increase. |
| `portfolio_user` | v002, 7,714 | wrong prompt replaced with the right one (see Item 4) |
| `ats_user`, `portfolio_system`, `resume_system`, `resume_user`, `review_email`, `reviewer_system`, `reviewer_user` | v001 | untouched since seeding |

In the repo, all three commits that have ever touched `prompts/` are pure additions across every
branch — zero deletions. The apparent `reviewer_system.txt | 28 ----` diffs on older branches are
those branches predating `1cb5986`, which created the file.

## Also found, outside the eight

`Promise.all(docJobs)` means one Drive failure discards the successful copies too — and with no Drive
`DELETE` anywhere in `api/src`, every failed attempt orphans files on the quota-bearing OAuth account.
**Any retry design must be traced against X5 (render once) first, or a retry multiplies the orphans.**

## Discipline

Every guard must be proven by reverting the fix and watching it fail. The named anti-pattern is
`app/test/assetGate.test.mjs`'s former `(attention - rev) + rev === attention` — true of every pair of
numbers, and it shipped beside the bug it claimed to guard.

`i += 2` still appears in `mt15.ts:64` and `mt16.ts:61` — the identical pre-fix walk, still live in the
legacy MT routes. "Fix all consumers" is a strict rule: `resumeParser.ts` was one of three.
