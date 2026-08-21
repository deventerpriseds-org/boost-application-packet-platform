# AC-matcher — requirement→profile evidence resolution (option (c): purpose-made matcher)

> **INCOMPLETE — findings only, no criteria.** The subagent writing this was killed after 85
> records; `eds-agent-guard.sh` caught it (silent 246s, 97-char final text). Because its brief
> required incremental writes, the eleven findings below survived on disk — the previous agent
> doing this same job wrote nothing until the end and lost all of it. That is the whole argument
> for the brief discipline, demonstrated twice in one session.
>
> **The criteria still need writing.** Do not treat this as a reviewed AC set.


status: in progress

Scope: `POST /api/app/opportunity/{id}/evidence` returns `evidenced: 0` on real data
(runs 32451913037, 32480993987 — 45 requirements, 15 readable profile records, 0 evidenced,
0 refused; `requirement_evidence` holds 0 rows in production).

Decision under AC: **option (c)** — stop reusing `locate()` (a posting-anchoring function) for
requirement→profile comparison; build a purpose-made comparison. Options (a) fold verb tense and
(b) lower the threshold were rejected by the owner.

## Findings established by reading, before any criterion

(being appended as research proceeds)

> Read at `origin/main` = `3f236ed` ("Merge PR #28"). The worktree branch `claude/deploy-runs-migration`
> is not an ancestor of `origin/main`, but `git diff HEAD origin/main` is EMPTY — the trees are
> identical, so every line quoted below is `origin/main`'s.

**F1 — `locate()` is a POSTING function, and its own header says so.** `requirements.ts:264`
signature is `locate(paraphrase: string, postingText: string, taken: Span[] = [])`. Its docstring
(`:249-262`) is written entirely about the employer's posting: *"Find where in `postingText` the
paraphrase came from"*, *"a posting that repeats a bullet under both 'Responsibilities' and 'What
you'll do'"*, and its closing guarantee is *"the returned verbatim is exactly
`postingText.slice(char_start, char_end)`"*. The module header (`:5-17`) grounds the whole design in
one fact: the jd_table Item is *a paraphrase of the very document being searched*, so a span always
exists to be found. **That premise does not transfer.** `evidence.ts:237` calls
`locate(text, rec.text)` where `text` is a requirement from the employer and `rec.text` is the
candidate's profile — two documents with no derivation relationship. Shared vocabulary between them
is coincidental, and `locate` has no way to know it is now being asked a different question.

**F2 — `evidence.ts` names this reuse as a virtue, in writing, which is why nobody re-examined it.**
`evidence.ts:14-17`: *"`requirements.locate()` — the same anchoring that resolves a model paraphrase
back to the employer's own words in the posting now resolves it back to the candidate's own words in
the profile. Same guarantee, both directions."* The guarantee that transfers is only the
substring/offset guarantee. The guarantee that does NOT transfer — and that the comment silently
claims — is that the target document is a source the input was derived from. This is the
"extend, don't duplicate" rule applied to the wrong axis: reuse was correct as a value and wrong as
a fact.

**F3 — two thresholds stack multiplicatively, and neither is the one that was tuned.**
`ANCHOR_THRESHOLD = 0.6` (`requirements.ts:193`) gates the sweep AND is re-applied after sentence
clipping (`:336`). Then `EVIDENCE_THRESHOLD = 0.7` (`evidence.ts:187`) is applied to
`itemTokens(loc.verbatim)` ∩ `wantTokens(requirement)` (`:249-252`). Then `MIN_QUOTE_CHARS` /
`MIN_QUOTE_WORDS` from `reviewer` (`:246-247`), then a DISTINCTIVE-token requirement (`:253`,
tokens ≥ 6 chars). A requirement must clear four independent gates measured with two different
tokenizers (`contentTokens`/`LOC_STOP` inside `locate`; `itemTokens`/`STOP` inside `evidence`). The
0.7 was chosen to preserve `checks.COVERAGE_THRESHOLD`'s meaning (`evidence.ts:177-181`) — i.e. it
was calibrated against a DOCUMENT the generator wrote, not against a profile written years earlier
in a different grammatical mood.

**F4 — no stemming anywhere on this path, and that is a deliberate, documented decision made for a
different function.** `itemTokens` (`swaps.ts`) does not stem; `termMatch.ts` records stemming as
*rejected* (`ops`→`op`, `sre`→`sr`); `figureEcho.stem()` handles plurals only. So `built ≠ build`,
`promoted ≠ promote`, `leading ≠ lead`, `manages ≠ manage`. Requirements are imperative/nominal
("Lead the strategy…", "Build and promote…", "Ability to manage…"); résumés are past tense. The
token spaces systematically miss.

**F5 — measured behaviour against one real record** ("Built and promoted a high-performing
engineering culture"):

| requirement | locate result | span ratio | outcome |
|---|---|---|---|
| "Build and promote a high-performing engineering culture" | anchored on `"high-performing engineering culture"` | 0.60 | NOT evidenced (0.60 < 0.70) |
| "Built and promoted a high-performing engineering culture" | exact | 1.00 | evidenced |
| "Ability to manage remote teams" | **unlocatable** | — | NOT evidenced |

Note the shape: tense alone moves a requirement from 1.00 to 0.60 — it does not degrade gracefully,
it falls off a cliff, because `locate` first *throws away* the unmatched verb by clipping to the span
that matched, and then the 0.7 gate is measured on that shortened span.

**F6 — production is at `evidenced: 0` AND `refused: 0`.** Both zero is the important pair. `refused`
is `writeEvidence`'s count of rows that failed the pre-store substring assertion. Zero refusals with
zero evidence means nothing ever *reached* the storage contract — the failure is entirely upstream in
`resolveEvidence`, and every guard `writeEvidence` publishes is currently vacuous (it has never been
exercised on real data). A guard that has only ever seen an empty input set is `not_applicable`, not
`pass`.

**F7 — the U+0130 offset defect is recorded in three places and any replacement can reintroduce it.**
`requirements.ts:272-280` records it in full: `toLowerCase()` is not length-preserving (U+0130 →
two code units), so indexing a lower-cased COPY yields offsets that are shifted, and the resulting
quote *is still a true substring of the record at the offsets recorded* — merely the wrong
characters. That is why "assert the quote is a substring" does not catch it. It was fixed by
searching case-insensitively over the ORIGINAL string (`new RegExp(..., 'gi')`, `m.index`,
`m[0].length`), bumped `EXTRACTOR_VERSION` 1→2, and `evidence.ts:394-408` carries a whole
`misresolved` state and note for the rows written before it. **A new matcher that normalizes case,
strips punctuation, or stems into a rewritten string and then indexes THAT string reintroduces this
class exactly.** Any normalization must carry an offset map back to the original, or must be used
only for scoring and never for offsets.

**F8 — the fixtures were written to pass, and I can show it rather than assert it.** Every POSITIVE
fixture requirement in `api/test/evidence.test.mjs` is a **verbatim substring of the fixture profile**:

| test fixture requirement | where it appears verbatim |
|---|---|
| `Led the platform modernization programme across four product lines` | `MC.workHistory1`, exactly |
| `Owned the digital water technology roadmap with Product` | `MC.workHistory2`, exactly |
| `Established the SOC 2 Type II compliance programme from nothing` | `MC.coreAccomplishments`, exactly |
| `Owned the digital water technology roadmap with Product and Design` | that verbatim span + two words |

Each of these takes `locate`'s **exact** branch (or an anchored span *of* the verbatim sentence),
which artificially restores the P1 premise — the "requirement" really was derived from the haystack.
The NEGATIVE fixtures are all semantically remote (`offshore wind turbine fleets`, `Fluency in
Japanese`, `Top Secret SCI clearance`) — cases that fail on vocabulary alone, at any threshold, with
any matcher. **The file contains no fixture where a requirement is TRUE of the profile but worded
differently, and none where a requirement is FALSE of the profile but shares its vocabulary.** Those
two cells are the entire subject matter of this ticket, and the suite is silent on both. The file's
own header claims fixtures are "from real Trinnex requirement text (opp 9f9c370a)" — that is true
only of `evidence.test.mjs:250-271`, which uses the real imperative rows
(`Reside in the East Coast of the United States`, `Ability to manage remote engineering teams`) and
uses them **only to count a denominator**, never to resolve evidence. The one place real requirement
text meets the resolver, the resolver is not called.
This is the ledger's own observation restated with a citation: *"it evidences correctly when the
requirement happens to be phrased in the candidate's words, so any test whose fixture is written
alongside the code passes."*

**F9 — the ledger row already exists and its recommendation is now WRONG.**
`.claude/DEFERRED.md` row `D:evidence-resolves-nothing`, state `OPEN`, closes with
*"Recommend (a)"* and `check: manual db-query.yml — select count(*) from requirement_evidence; a
non-zero count closes this`. The owner chose (c). **Both halves of that row are now defects in
their own right**: the recommendation contradicts the decision, and the closing check is nearly
vacuous — a matcher that evidences everything scores non-zero and closes the row. See AC-M31/M32.

**F10 — the owner threshold does NOT reach the route in the defect.** `appChecks.ts:109-112` passes
`{threshold: thresholds.evidenceThreshold, minTokens: thresholds.evidenceMinTokens}` into
`writeEvidence`, and `evidence.test.mjs:276-296` guards exactly that line. But
`appRequirements.evidenceResolve:498` calls `writeEvidence(client, opp.id, profile.records)` **with
no opts**, and `requirementsBackfill:441` does the same. So `POST /api/app/opportunity/{id}/evidence`
— the route in runs 32451913037 / 32480993987 — and the backfill both ignore
`owner_search_prefs.chk_evidence_threshold` and use the literals. The existing guard passes because
it greps `appChecks.ts` only; it is the single-file-grep failure `CLAUDE.md` names. Any new matcher
config inherits this hole unless the ACs close it.

**F11 — the storage contract is enforced by the DATABASE, not only by code**, and it constrains the
shape of any replacement (`appRequirements.ts:31-53`, mirrored in `schema.ts:404`):
`check (char_start >= 0 and char_end > char_start)`; `check (length(quote) = char_end - char_start)`;
`method text not null check (method in ('exact','anchored'))`;
`unique (requirement_id, source_key, char_start, char_end)`; `record_sha256 text NOT NULL`;
`resolver_version int NOT NULL`; FK to `requirement(id) on delete cascade`.
Three consequences the implementer must not discover at insert time: (i) a quote **stitched from two
spans** violates the length check; (ii) a new `method` value (`'semantic'`, `'stemmed'`, `'lemma'`)
violates the CHECK and requires an explicit `alter table … drop constraint / add constraint`, the
same dance `ensureRequirementCols:64-66` already had to do for `requirement_kind_source_check`;
(iii) the UNIQUE is per `(requirement_id, source_key, char_start, char_end)`, so the table **already
permits several evidence rows per requirement** even though `resolveEvidence` returns at most one,
and `loadRequirementsWithEvidence:214-217` already picks one with
`order by x.ratio desc nulls last, x.source_key, x.char_start limit 1`.

**F12 — `refused` is documented as structurally unable to fire, and the doc is right.**
`appRequirements.ts:111-117`: *"It has never rejected anything and structurally cannot today:
`locate` CONSTRUCTS its verbatim by slicing the haystack, so the comparison is a tautology (measured
by the independent verifier: 4,000 randomized rounds, 0 mismatches)."* A purpose-made matcher that
builds a quote any other way — normalizing, stemming, joining, trimming — makes that assertion
live for the first time. It must stay, and it must be proven to fire.
