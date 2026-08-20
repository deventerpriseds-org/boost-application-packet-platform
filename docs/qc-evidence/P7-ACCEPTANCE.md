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
