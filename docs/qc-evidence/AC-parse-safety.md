# AC — ATS Parse-Safety of Generated Documents

**Status:** IN PROGRESS (written incrementally by an independent AC-writing agent; not an implementation plan yet)
**Scope:** whether/how the platform should verify that rendered artifacts can be PARSED by an applicant tracking system.
**Author note:** this document is adversarial by design. Sections are appended as research completes.

## Research log
- (started) creating file before any research, per brief.

## Findings from source (Observation — read from the files, not inferred)

**F1. The resume template is a Google DOC that ALREADY CONTAINS TABLES AND IMAGES — this is
evidenced, not hypothetical.** `api/src/functions/tests/diagDocStructure.ts` exists solely to
fingerprint *"table column widths, image size/crop, page size + margins"* and its header comment
states its purpose verbatim: *"This exists to trace WHY generated resumes come out with squished
columns / skewed images when the source template renders correctly."* A diagnostic written to debug
squished **columns** on the resume template is direct evidence that the resume template is
table/column-based. `fingerprint()` returns `tableCount`, `tables[].columns`, `imageCount`.
→ The parse hazard named in ATS-RESEARCH §5 is very likely PRESENT in the live product today. That
raises the value of an audit and lowers the value of debating whether it "could" happen.

**F2. The owner CAN change the template, and nothing re-audits when they do.**
`packetTemplates.ts` `metaFor(type, ids)` applies `TemplateIdOverrides.resumeTemplateId` /
`portfolioTemplateId` / `coverLetterTemplateId` over the seeded `TEMPLATE_META`, and the comment on
that interface says the override keys *"have been writable in Auth & Config since it was written."*
→ **A one-time audit of the seeded template ID is void the moment the owner points at a different
Doc.** This is the single strongest argument against option (1) standing alone.

**F3. Content injection is `replaceAllText` with PLAIN TEXT — it structurally CANNOT introduce a
table, a text box, an image, a column, or a header/footer.** `injectValues()` issues only
`replaceAllText` requests (`packetTemplates.ts:150-157`); `stripLeftoverTokens()` likewise. There is
no `insertTable`, no `insertInlineImage`, no `createParagraphBullets` in the injection path.
→ **Ruling on brief question (a): NO, generated content cannot introduce the FIVE DOCUMENTED
STRUCTURAL parse breakers.** It can only introduce *character-level* hazards inside a text run: tab
characters, pipe-joined pseudo-columns, HTML residue, inconsistent date formats. Those are text
content — which is exactly what the existing check family already governs.

**F4. Two of the four artifact types are Google SLIDES, not Docs.** `PORTFOLIO_TEMPLATE_ID` and
`COVER_LETTER_TEMPLATE_ID` are Slides (`isSlides: true`). Every Slides file is, by construction, a
canvas of TEXT BOXES — the third documented parse breaker. If parse-safety were applied uniformly
across artifact types it would condemn the portfolio and cover letter categorically and permanently.
→ Parse-safety must be scoped to the artifact that an ATS actually parses (the resume). Applying it
to Slides artifacts is the cry-wolf failure mode this repo already deleted a linter for.

**F5. `runChecks()` never sees the rendered document.** `CheckInput` (`checks.ts:186-211`) carries
`type`, `pkg` (merge-field values), `company`, `omitList`, `profileText`, `postingText`,
`requirements`, `swaps`, `facts`, `evidence`, `thresholds`. There is no doc id, no doc JSON, no
rendered text. Every existing check is a function of the merge-field strings.
→ The research finding is confirmed at the source: **no existing check can observe layout at all.**

**F6. Two of the four content-level hazards are ALREADY caught by existing checks.**
- HTML residue: `markup_residue` (`checks.ts:457-468`) fails on `<table>`, `<tr>`, `<td>`, `<br>`,
  `<ul>`, `<li>` tags, HTML entities, code fences and unresolved `{{tokens}}` — state `fail`.
- Tab characters: `whitespace` (`checks.ts:470-480`) flags `/\t/` per field — state `warn`.
→ Of the content-introduced hazards the brief asks about, only **pipe-joined pseudo-columns** and
**inconsistent date formats inside merged text** are unguarded. Both belong in the existing text
checks, not in a new subsystem. **Ruling on brief question (c): YES — extend, do not create.**

**F7. A deterministic `fail` BLOCKS the gate.** `gateFor()` (`checks.ts:828-843`): any deterministic
`fail` returns `'fail'`. Per `CLAUDE.md` "Match the process to the risk", anything that decides the
artifact gate is **tier 1 — accusation grade**. A parse-safety check emitting `fail` is therefore
the highest-ceremony change in the codebase, and it would be blocking approval on a property of a
file the owner designed by hand. That is precisely the profile of the deleted smart-quote linter.

**F8. There is already a precedent for exactly this shape of finding — and it is not a check that
fails.** The `ELIGIBILITY_RE` block (`checks.ts:213-235`) handles "requirements NO GENERATED MERGE
FIELD can carry": it reports `not_applicable`, **names every one**, and hands the decision to the
human to confirm against the **static template**. Its comment states the reasoning that applies
verbatim here: *"reporting it as uncovered coverage would make the gate permanently red on every
posting carrying such a clause. An always-red gate is one people learn to ignore."*
→ Parse-safety is the same class of fact: a property of the static template that the pipeline cannot
change. The house style for that class is **surface it, name it, never gate on it.**

**F9. `artifact.template_id` already exists in the schema** (`schema.ts`, `create table artifact`:
`template_id text`). An artifact already records which template it rendered from — so "was this
artifact rendered from an audited template?" is answerable from data that is already stored, with no
new table.

**F10. `artifact.template_id` IS NEVER WRITTEN — it is a dead column, and the UI reads it.**
`grep -rn template_id api/src app/src` returns exactly three sites: the `create table` in
`schema.ts:102`, a `select ... template_id ...` at `appPackets.ts:80`, and
`templateId: a.template_id` served to the client at `appPackets.ts:200`. `renderArtifact()`
(`appPackets.ts:613-658`) resolves `meta.templateId` from `loadPipelineSettings()` and copies that
exact file — then its final `update artifact set doc_url = ..., content = ..., status = ...` writes
everything EXCEPT `template_id`. **So every artifact row reports `templateId: null` while the render
path knew the real id and threw it away.** This is a standalone defect independent of parse-safety,
and it is the prerequisite for linking any artifact to an audit of the template it came from.

**F11. `/api/diag/doc-structure` already does most of a parse-safety audit — for the WRONG id.**
`diagDocStructure.ts:75` defaults to the imported `RESUME_TEMPLATE_ID` **constant**, not to the
owner-resolved `settings.resumeTemplateId` that `renderArtifact` actually copies. An owner who has
set `google.resumeTemplateId` gets a fingerprint of a document their packets are not built from —
the same class of defect `pipelineConfig.ts:99` records ("an owner who had set
`google.resumeTemplateId` and got the seeded" value). `fingerprint()` already returns `tableCount`,
`tables[].columns`, `imageCount`, `pageSize`, `margins`. What it does NOT look at:
`doc.headers` / `doc.footers`, `positionedObjects` used as text boxes, or date formats.
→ **The audit tool is ~70% built.** Building a new one would be the "parallel system" this repo
forbids; the work is a small extension of `fingerprint()` plus the owner-resolved id.
