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
**inconsistent date formats inside merged text** remain unguarded — and ruling (a) below, written
after reading `splitItems()` and `TEMPLATE_META`, concludes that **neither is a hazard here** and
that guarding either would fire on correct output. **Ruling on brief question (c): YES — extend, do
not create.**

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

**F12. There is ALREADY a per-template config store, keyed by drive id.** `api/src/functions/config.ts`
(the "RESUME TEMPLATE's role focus" block, ~line 100-130) uses AppConfig partition `templates`,
rowKey `resume-<driveId>`, currently carrying one field: `roleFocus`. `isTemplateRow()` restricts
rowKeys to `/^resume-[A-Za-z0-9_-]{10,}$/` and the writer accepts **only** `roleFocus`, with an
explicit comment that *"a writer that accepts arbitrary fields on arbitrary rows is a way to put
anything into AppConfig."*
→ **A per-template audit record has an existing, correctly-shaped home.** No new table. Any
extension must keep the named-field allowlist rather than widening to arbitrary fields.

---

## Rulings on the four questions the brief demanded (Interpretation, grounded in F1-F12)

**(a) Can generated CONTENT introduce a parse hazard the template does not have? — NO.**
Injection is `replaceAllText` with plain strings (F3): it cannot create a table, a column, a text
box, an image, or a header/footer. Working through the brief's own four candidate content hazards:
- **HTML residue** — real, and **already `fail`** via `markup_residue` (F6). No action.
- **Tab characters** — **already `warn`** via `whitespace` (F6). No action. (A tab in a text run is
  whitespace in the extracted stream; it does not create a column. Marginal either way, and covered.)
- **Pipe-joined lists — NOT A HAZARD, and checking them would cry wolf.** Ground truth:
  `splitItems()` (`swaps.ts:45-51`) splits on `/\r?\n|(?:\s*[|•·]\s*)/` — the pipeline **treats `|`
  as a first-class item separator, identically to a newline**, so pipe-joined output is this
  product's own normal shape and every length/count check already measures it correctly. In the
  rendered Doc it is one line of plain text; an ATS reads it as text. `A | B | C` is a mainstream,
  ATS-safe resume convention — it is not a multi-column layout. A check here would fire on correct
  documents produced by the system's own generator. **This is the smart-quote-linter shape exactly,
  and I am refusing it.** *(This corrects my own first pass, which listed pipes as "unguarded"
  before I read `splitItems`.)*
- **Inconsistent date formats — a TEMPLATE property, not a content one.** The resume's seven merge
  fields are `ResumeSummary`, `SkillsBullets1/2`, `ExpertiseBullets`, `RelevantBullets1-3`
  (`TEMPLATE_META`). **None of them is the employment-history block.** Employment dates live in
  static template text the pipeline never touches — the same reasoning `checks.ts:213-235` already
  applies to location and clearance. So date-format consistency is audited on the template, not
  checked per packet.

**Net: all five documented structural parse breakers, plus date consistency, are properties of the
TEMPLATE. Zero of them belong in a per-packet check. The two content hazards that do exist are
already covered by existing checks.** This is the single most important conclusion in this document.

**(b) Does the product render more than one template, and can the owner change it un-audited?**
**Yes to both, and this is the decisive fact.** Four artifact types across three template ids, two
of which are Slides (F4). All three ids are owner-overridable through `CONFIG_KEYS`
(`google.resumeTemplateId` / `portfolioTemplateId` / `coverLetterTemplateId`), settable in Settings
(`Settings.jsx:1794-1796`), read by `renderArtifact` on every build (F2). **A one-time audit
therefore has a half-life set by the owner's next edit to a Settings text field, with nothing
anywhere that notices.** Option (1) alone is refuted.

**(c) Is there an existing check/system to EXTEND rather than a new subsystem?**
**Yes — four of them, and every piece of this work fits inside one.**
| Need | Extend this | Not this |
|---|---|---|
| Read a template's structure | `diagDocStructure.ts` `fingerprint()` (F11) | a new audit service |
| Store the audit per template | AppConfig `templates` / `resume-<driveId>` (F12) | a new table |
| Flag content-level hazards | `markup_residue` / `whitespace` in `checks.ts` (F6) | a new check family |
| Know which template rendered an artifact | `artifact.template_id`, already in the schema (F9/F10) | a new column |

**(d) What is the cheapest thing that catches a TEMPLATE REGRESSION?**
Not a unit test — CI cannot reach Google (no OAuth token in the sandbox or in a plain CI job; the
egress proxy blocks it, and `renderArtifact` needs `getGoogleOAuthToken()`). Not a startup
assertion — the Function App would then fail to start because the owner edited a Doc, which converts
a document-formatting opinion into an outage. **The cheapest correct thing is a read-only
`GET /api/diag/parse-safety` extension of the endpoint that already fingerprints the template,
resolved through the owner's configured id, whose result is stored on the `templates/resume-<driveId>`
row and shown in Settings beside the field where the owner sets that id.** A regression is caught the
next time the audit runs, and the audit is cheap enough to run on a schedule or on save.

**F13. The template population is not one document — it is a PER-ROLE SET, and the product already
has a "Compact ATS Resume" concept that is NOT CONFIGURED.** `pipeline.ts:615-655` resolves a
**fourth** template id, `compactResumeTemplateId`, first from AppConfig `templates/<roleRow>` (role
slug, e.g. `templates/vp-product`) and only then from `google.compactResumeTemplateId`; when neither
is set it pushes the warning *"No compact ATS resume template for role … — the compact ATS resume
was NOT generated."* and `steps` records `Compact ATS resume template: NOT CONFIGURED`.
Two consequences:
1. **A one-time audit of "the" template is not even well-defined** — the owner can hold a different
   compact resume template per role, in rows nobody enumerates. Option (1) alone is refuted twice.
2. **There is already a product concept whose entire purpose is an ATS-parseable resume.** The
   right place for parse-safety is that concept — not a new one. Note it is a *deliverable* that is
   currently never generated, which is a larger finding than parse-safety itself and belongs in the
   backlog rather than in this scope.
   *(Adjacent divergence, out of scope but recorded: `packetTemplates.metaFor()` maps
   `compact_resume` → `resumeTemplateId` and ignores `compactResumeTemplateId` entirely, while
   `pipeline.ts` honours it. Two paths, two answers to "which file is the compact resume".)*

**F14. Qualification on the date ruling, sought as disconfirming evidence.** `pipeline.ts:646` and
`mt19.ts:121` DO build a resume var map containing `WorkHistoryBullets1-4`, and `mt17.ts:151-154`
generates them — so employment-section text is not categorically ungenerated. But (i) `TEMPLATE_META`
(the product path, `renderArtifact` → `varsForType`) exposes **seven** placeholders and
`WorkHistoryBullets*` is not among them, and (ii) the generated values are achievement sentences
("Led enterprise software strategy across 15 global markets"), not date strings. **The date ruling
stands for the product path**; if `WorkHistoryBullets*` is ever added to `TEMPLATE_META` **and** the
prompt is ever changed to emit dates, revisit it. AC-16 encodes that trigger.

---

## RECOMMENDATION (the deliverable)

### Verdict: **(1) + (2), narrowly scoped. NOT (3). And one unrelated defect fixed on the way.**

**Do NOT build a per-packet parse-safety check. I am recommending against the largest piece of this
scope.** Five independent reasons, each sufficient on its own:

1. **It would be checking a constant.** Every packet built from template X gets the identical
   verdict. Hundreds of `check_result` rows carrying one bit of information that changes only when
   the owner edits a Doc.
2. **It cannot be done without breaking `runChecks`.** `runChecks(input): CheckResult[]` is a
   **synchronous, pure function of strings** (F5). Layout lives only in the Google Doc JSON.
   Reaching it means an `async` network call inside the gate engine — and `appReviewer`
   **re-aggregates checks from a DATABASE read** (`gateFor` comment, `checks.ts:835-838`), where no
   Doc is reachable at all. The purity of that function is load-bearing; trading it for a constant
   is a bad trade.
3. **A deterministic `fail` blocks the gate (F7).** The failing property would be one the owner
   authored by hand, in a tool this product does not control, and cannot fix from inside the app.
   That is a gate that blocks work and offers no remedy — the "always-red gate people learn to
   ignore" the codebase already names at `checks.ts:224-226`.
4. **It would condemn the portfolio and cover letter permanently (F4).** They are Slides. Every
   Slides file is text boxes. Any uniform structural check fails them forever, correctly by its own
   rule and uselessly in practice.
5. **The content hazards it would be catching are already caught, or are not hazards (ruling (a)).**
   The remaining candidates were pipes — which are the product's own separator — and dates, which
   the product path does not generate.

**Do build, in this order:**

| # | Thing | Tier | Rough cost | Catches |
|---|---|---|---|---|
| **B1** | Write `template_id` in `renderArtifact` (F10) | 2 | ~3 lines + 1 H-case | A dead column the UI already reads; prerequisite for everything else |
| **B2** | Extend `fingerprint()` + resolve the OWNER's id (F11) | 2 | ~40 lines | Makes the existing diagnostic report on the document that is actually copied, and cover headers/footers + text boxes |
| **B3** | One-time audit, written to `docs/qc-evidence/` with the raw fingerprint pasted in | 3 | ~30 min, no code | The defect F1 says is probably live today |
| **B4** | Store the audit verdict on AppConfig `templates/resume-<driveId>` (F12) and show it in Settings beside the id field | 2 | ~80 lines | The regression when the owner changes the id (F2/F13) |
| **B5** | H-cases (AC-17..20) | 2 | ~30 lines | Re-introduction of B1/B2's defects |

**Why (1) alone fails:** the owner can change `google.resumeTemplateId` in a Settings text box, and
can set a different `compactResumeTemplateId` per role (F2, F13). An audit of one id has a half-life
of one Settings edit, and nothing anywhere notices.

**Why (2) must NOT be a CI unit test or a startup assertion:** reading a template requires
`getGoogleOAuthToken()` and network access to `docs.googleapis.com`. CI and the dev sandbox have
neither (`CLAUDE.md`: the sandbox egress blocks these hosts; `GOOGLE_REFRESH_TOKEN` lives only on
the Function App). A startup assertion is worse than useless: it makes the API fail to boot because
the owner reformatted a Google Doc — converting a formatting opinion into an outage. **The only
transport that can actually read the template is a route on the deployed Function**, which is what
`diag/doc-structure` already is.

**Cost of doing nothing:** the product ships resumes from a template that a diagnostic was written
because it has columns and images (F1), with no record of whether that is safe and no way to notice
when it changes. Given B3 costs half an hour and no code, doing nothing is not defensible.
