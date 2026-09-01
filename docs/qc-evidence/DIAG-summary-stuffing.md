<!--
WHAT:       Why the current build's ResumeSummary reads as JD keyword-stuffing when the owner's
            JotForm flow, driving the SAME prompts, did not.
WHY:        Owner, 2026-09-01: "this one is a hack full of verbatim lines from the jd that isn't
            subtle at all and would get me accused of stuffing. investigate."
SUPERSEDES: nothing.
SUPERSEDED-BY: nothing -- current.
EVIDENCE:   executed probes /tmp/probe.mjs, /tmp/probe2.mjs, /tmp/probe3.mjs against
            api/dist at 1c43ea8; outputs transcribed verbatim below.
-->

# The summary is stuffed because the coverage predicate PAYS for stuffing

## Verdict up front

**This is not a prompt-quality problem and not a model failure.** The owner's prompts still drive
Call 1 and are untouched. The P3 remediation loop — which is OUR addition, absent from the JotForm
flow — scores a requirement as closed by **literal content-word overlap with the employer's own
sentence**, and rewrites `ResumeSummary` until that score is met. Copying is the only strategy that
satisfies the objective function. Paraphrase is scored as failure and triggers another pass.

## OBSERVATION 1 — the objective function requires literal copying

`api/src/functions/tests/checks.ts:263-282`:

```ts
export const COVERAGE_THRESHOLD = 0.7
export const MIN_JUDGEABLE_TOKENS = 3

export function coversIn(covText, r) {
  const toks = itemTokens(r.verbatim || r.item_text)   // content words; ~60 stopwords stripped
  if (toks.length < MIN_JUDGEABLE_TOKENS) return false
  const hit = toks.filter(tk => covText.includes(tk))  // LITERAL substring test
  if (hit.length / toks.length < COVERAGE_THRESHOLD) return false
  const distinctive = toks.filter(tk => tk.length >= 6)
  return distinctive.length === 0 || distinctive.some(tk => covText.includes(tk))
}
```

`itemTokens` (`swaps.ts:131`) keeps content words. So closing a requirement demands **70% of the
employer's content words appear verbatim in the candidate's text.**

### Executed — `/tmp/probe.mjs`, api/dist at `1c43ea8`

Requirement: *"Experience designing and operating cloud-native microservices on Kubernetes at
enterprise scale"* → tokens `[designing, operating, cloud-native, microservices, kubernetes,
enterprise, scale]` (7).

| Candidate `ResumeSummary` | overlap | `coversText` → requirement CLOSED? |
|---|---|---|
| A. subtle paraphrase — *"…scaled distributed platforms and container orchestration for large regulated enterprises."* | 2/7 = 0.29 | **false** |
| B. partial echo | 3/7 = 0.43 | **false** |
| C. near-verbatim lift of the JD sentence | 7/7 = 1.00 | **true** |

**There is no paraphrase that reaches 0.70.** A subtle summary leaves the requirement OPEN, so
`decidePass` runs another pass against the same predicate and pushes harder toward the JD's words.

## OBSERVATION 2 — `ResumeSummary` is in scope on EVERY pass, and subtlety guarantees it

- `remediation.ts:348` — `STRUCTURAL_FIELDS = ['@Company', '@CoverLetterDate']`. That is the entire
  exclusion list. `ResumeSummary` is a template placeholder (`packetTemplates.ts:25`), so a
  remediation pass may rewrite it.
- `remediation.ts:390-396` — `scopeForRequirements` **withholds** only a field that is the SOLE
  evidence for an already-closed requirement; everything else goes into `fields`. A generic,
  tasteful summary covers no requirement, so it is never withheld. **The more subtle the summary,
  the more certainly the loop rewrites it, every pass.**
- `appRemediation.ts:204,238` — `lastScope.fields` is passed straight to `regenerateFields`.

## OBSERVATION 3 — the prompt forbids INVENTING, never COPYING

`remediation.ts:506-526`, `buildScopedPrompt`. The system message:

```
NEVER invent an employer, a metric, a title, a date, a certification or a system the profile does not contain.
```

The user message hands the model the employer's exact sentences:

```ts
'REQUIREMENTS THE DOCUMENT DOES NOT YET EVIDENCE (the employer\'s own words where available):'
input.open.map(r => `- [#${r.seq} ${r.kind}] ${r.verbatim ? `"${r.verbatim}"` : r.item_text}`)
```

There is **no instruction anywhere in this prompt against reusing the employer's wording.** The
model is given the target sentences, told to make them evidenced, and scored on literal overlap.

## OBSERVATION 4 — the anti-stuffing guard is a warning, and short-phrase stuffing is invisible to it

`checks.ts:554` wires `scanWording`. Two properties defeat it here:

1. **`WORDING_RUN_TOKENS = 8`** (`figureEcho.ts:466`) — it needs **8 consecutive exactly-matching
   tokens** with ≥3 content words.
2. **severity `'warn'`** — it never blocks the gate, and the remediation loop does not read it as
   pressure to stop copying.

### Executed — `/tmp/probe3.mjs`

A summary stitched from SHORT JD phrases, never 8 in a row:

> *"Engineering executive: cloud-native microservices, Kubernetes at enterprise scale, platform
> reliability engineering, regulated financial services, event-driven architecture, observability
> tooling."*

```
posting_wording_kept fires?  false   | runs: 0
requirement 1 CLOSED by it?  true
```

**It closes a requirement and produces ZERO wording offenders.** This is exactly the shape the owner
described: obvious stuffing to a human reader, invisible to the guard.

### Correction to a first reading, recorded so it is not repeated

An earlier probe (`/tmp/probe.mjs`) reported `n/a` for the wording scan on all three candidates. That
was **the probe's fault** — it passed an empty `profileText`, and `scanWording` correctly returns
`notApplicable` with nothing to compare against. Re-run with a real posting AND profile
(`/tmp/probe2.mjs`), the detector DOES fire on a full-sentence lift:

```
A. paraphrase  -> notApplicable: false | kept runs: 0
C. heavy echo  -> notApplicable: false | kept runs: 1
   ['experience designing and operating cloud-native microservices on Kubernetes at enterprise scale']
```

So the detector is not blind to whole-sentence theft. It is blind to phrase-level stuffing, and it
only warns.

## OBSERVATION 5 — what JotForm did differently

JotForm ran **Call 1** (the owner's generator prompt) and **Call 3** (ATS QC → `updatedResumeSummary`,
`mt17.ts:137`) and stopped. Nothing in that flow measured "does this summary contain 70% of the JD's
words" and rewrote until it did. **The P3 remediation loop is ours.** It is the structural difference,
and it converted the summary from a piece of writing into a coverage-optimisation target.

## NOT ESTABLISHED — one query short

**INFERENCE, not proof:** that the specific summary the owner is reading was written by a remediation
pass rather than by Call 1. The falsification test is a single live read, and `boost-pg-mcp-write`
was lapsed at the time of writing:

```sql
-- Is that summary loop 0 (Call 1) or a later pass (remediation)?
select loop, method, left(after_text,200) from insertion
 where merge_field='ResumeSummary' order by loop;

-- The owner's DEFAULT engineering-resume summary from MasterContext.
-- insertions.ts:92 -- loop 0 before_text IS the MasterContext block for that slot.
select before_text from insertion where merge_field='ResumeSummary' and loop=0 limit 5;
```

If that summary is `loop=0`, everything above is exonerating for the remediation loop and the cause
is upstream in Call 1 instead. **Run the query before acting on this document.**

## Candidate remedies — NOT started, NOT approved, tier 1

Both touch a gate, so both need ACs before any code.

1. **Exempt prose fields from remediation scope.** Add `ResumeSummary` (and the other prose blocks) to
   a scope exclusion so the loop rewrites list fields only. Cheapest, most reversible; costs the
   summary's ability to close a requirement at all.
2. **Make `coversIn` accept profile-evidenced synonyms**, so a paraphrase can close a requirement. Far
   more invasive: `coversIn` decides `must_have_coverage` and therefore the gate, and any loosening
   is a direct weakening of an accusation-grade predicate — the owner's standing instruction is that
   no guard is weakened without being pinged first.
3. **Add an anti-echo instruction to `buildScopedPrompt`.** Our code, not the Prompts table. Cheap and
   additive, but a prompt instruction is not a guard — it would need `posting_wording_kept` tightened
   (a lower `wordingRunTokens`, or a phrase-density measure) to be enforceable rather than hopeful.

**Do not edit anything in the Prompts table.** Standing owner instruction: *"i still want my original
prompts to be driving what the resume draft is."*
