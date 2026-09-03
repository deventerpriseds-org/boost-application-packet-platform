# VERIFY-baseline-relevant-seed-1

work: baseline-relevant-seed
loop: 1
verifier: independent subagent, no shared context with implementer
started: (see git log / file mtime)

Status: IN PROGRESS — appended incrementally after each claim.

## Environment / build

```
$ cd api && npm run build     # node_modules already present
> tsc
BUILD_RC=0            <- clean, zero TS errors
$ git rev-parse --abbrev-ref HEAD  -> claude/boost-app-setup-approach-ejv09v
$ git log --oneline -3
1b7cfbc docs(memory): the Relevant seed...
571b9a8 docs(tracking): the nine seeded...
7d10e64 feat(baseline): seed the nine Relevant Proficiencies as the no-JD fallback
```

All probes below import the COMPILED module
`api/dist/functions/tests/appBaseline.js` and execute it. Nothing here is read off the source.

---

## C1 — `shapeSlotFields` leaves NO `|` in any of the six SLOT_FIELDS — **REFUTED**

### The claimed case holds (live stored shapes, all six fields)

```
$ node /tmp/probe1.mjs
  SkillsBullets1   => "Enterprise Governance\nTechnology Strategy\nRisk Management\nDigital Transformation" | pipe? false
  SkillsBullets2   => "Strategic Roadmaps\nStakeholder Engagement\nRevenue Optimization"                     | pipe? false
  ExpertiseBullets => "Budget Development and P&L Management\nKPI-driven performance management"             | pipe? false
  RelevantBullets1 => "Governance and Compliance: A, B\nTechnology Strategy: C, D"                           | pipe? false
  RelevantBullets2 => "x\ny\nz"                                                                              | pipe? false
  RelevantBullets3 => "p\nq\nr"                                                                              | pipe? false
```

### The counterexample that refutes it — a separators-only block passes through VERBATIM

```
  raw= "|||"           -> out= "|||"           | PIPE SURVIVES? true
  raw= "|"             -> out= "|"             | PIPE SURVIVES? true
  raw= " | "           -> out= " | "           | PIPE SURVIVES? true
  raw= "-|-"           -> out= "-|-"           | PIPE SURVIVES? true
  raw= "¦ broken bar" -> out= "¦ broken bar" | PIPE SURVIVES? false   (¦ is not a separator; correct)
```

**Mechanism** (`appBaseline.ts` `shapeSlotFields`):

```ts
const raw = out[field]
if (typeof raw !== 'string' || !raw.trim()) continue   // "|||" .trim() is truthy -> NOT skipped
const items = splitItems(raw)
if (!items.length) continue                             // <-- HERE: leaves out[field] === raw, pipes intact
```

`splitItems` (`swaps.ts:118`) splits on `/\r?\n|(?:\s*[|•·]\s*)/` then `.filter(Boolean)`, so a
block made only of separators yields `[]`, hits the `continue`, and the ORIGINAL pipe-bearing string
stays in the returned object and would be injected into the document verbatim.

**Scope of the refutation, stated honestly:** every block containing at least one non-separator item
is shaped correctly, including all live stored values. The failure is confined to a degenerate
separators-only block. Likelihood is low (MasterContext is owner-authored) but not zero, and the
outcome is the exact defect the function exists to prevent — a visible `|` in the rendered resume.
One-line fix: `if (!items.length) { delete out[field]; continue }` or set `out[field] = ''`.

`H:baseline-shape` does not catch this: its loop is `if (!out[f]) continue` over fields it seeded
with real items only, so the branch is never exercised.

---

## C2 — configured count trims; `null`/absent does NOT trim — **CONFIRMED**

```
  SkillsBullets1 cap 3   -> ["Enterprise Governance","Technology Strategy","Risk Management"]  len 3   (of 4)
  SkillsBullets2 cap null-> 3 items kept (source has 3)
  RelevantBullets1 cap 2 -> 2 items kept
  slots = undefined      -> SkillsBullets1 keeps 4 of 4          <- full list, no truncation
  cap 0                  -> 4 kept   (0 is not a positive int -> no trim)
  cap null               -> 4 kept
  cap -1                 -> 4 kept
  cap 99                 -> 4 kept   (cap > length is a no-op, not padding)
```

Guard code: `const cap = slots ? slots[field] : null; const kept = typeof cap === 'number' && cap > 0 ? items.slice(0, cap) : items`.
`0`, `null`, negative and absent all fall to `items` whole. This matches `slots.ts`'s stated rule
that an unset count means UNKNOWN and must never truncate.

---

## C3 — prose fields pass through byte-identical, incidental `|` included — **CONFIRMED (with one stated boundary)**

```
   ResumeSummary    identical? true  => "A prose summary | with an incidental pipe."
   CoreCompetencies identical? true  => "a|b"
   @Company         identical? true  => "X|Y"        (through shapeSlotFields)
   via baselinePkg: ResumeSummary identical? true
```

`shapeSlotFields` iterates `SLOT_FIELDS` only and starts from `{ ...master }`, so every non-slot key
is copied by reference-value and never touched. CONFIRMED.

Boundary worth stating so the claim is not read too widely: through `baselinePkg`, `@Company` and
`@CoverLetterDate` are DELIBERATELY overwritten by the standing seed/caller value (they are assigned
last in the return literal). That is the intended contract asserted by `H:baseline-standing-fields`,
not a violation of C3 — C3 is a property of `shapeSlotFields`, and there it holds byte-identically.

---

## C4 — `relevantOverlay` overrides the pooled Library text with `SEED_RELEVANT_LISTS` — **CONFIRMED**

`baselinePkg` called with all three Relevant fields carrying pooled Library text:

```
$ node /tmp/probe2.mjs
  RelevantBullets1 => ["Portfolio Management","Tech-Driven Innovation","Ops Automation"]     | == seed? true
  RelevantBullets2 => ["Tech Talent Strategy","Innovation Frameworks","Data Insights"]       | == seed? true
  RelevantBullets3 => ["Corporate AI Use Cases","Strategic Partnerships","Global Leadership"] | == seed? true
```

Ordering is correct and load-bearing — `return { ...shaped, ...relevantOverlay(opts?.relevant), '@Company':…, '@CoverLetterDate':… }`
spreads the overlay AFTER the shaped master, so the pooled text cannot win when the overlay emits
the key. (It CAN win when the overlay does not emit the key — see C5.)

---

## C5 — caller-supplied `relevant` wins; empty/malformed falls back to the seed — **REFUTED**

Three sub-parts. Two hold, one fails.

### (a) A caller list wins — CONFIRMED

```
relevantOverlay([['A','B'],['C'],['D','E','F']])
  -> {"RelevantBullets1":"A\nB","RelevantBullets2":"C","RelevantBullets3":"D\nE\nF"}
via baselinePkg(POOL, {relevant: …}) -> ["A\nB","C","D\nE\nF"]
```

### (b) No slot is ever blanked — CONFIRMED (the `stripLeftoverTokens` failure mode does NOT occur)

`relevantOverlay` never emits an empty string; it omits the key instead:

```
  [[""]]              -> keys [] vals []          | ANY empty string? false
  [[" "]]             -> keys [] vals []          | ANY empty string? false
  [[null]] [[0]] [[false]] -> keys [] vals []     | ANY empty string? false
  [["a"],[""],["c"]]  -> keys ["RelevantBullets1","RelevantBullets3"] vals ["a","c"]
```

### (c) "a malformed one falls back to the SEED" — **THIS IS THE PART THAT FAILS**

`relevantOverlay` selects the seed only when the argument is falsy / not an array / an array of
length 0: `const src = (Array.isArray(lists) && lists.length ? lists : SEED_RELEVANT_LISTS)`.
A **non-empty but malformed** array passes that test, so `src` is the caller's junk, every slot
produces `items.length === 0`, no key is emitted, and the pooled master text left by
`shapeSlotFields` survives — the 36-term Library, i.e. the exact defect the seed was created to
replace.

```
  relevant=undefined      -> allSeed=[true,true,true]     <- falls back to seed  OK
  relevant=null           -> allSeed=[true,true,true]     <- OK
  relevant=[]             -> allSeed=[true,true,true]     <- OK
  relevant='notanarray'   -> allSeed=[true,true,true]     <- OK

  relevant=[[]]           -> allSeed=[false,false,false]
                             R1="Governance and Compliance: A, B\nTechnology Strategy: C, D\nBusiness: E, F"
  relevant=[['']]         -> allSeed=[false,false,false]  (pooled Library in all three)
  relevant=[null]         -> allSeed=[false,false,false]  (pooled Library in all three)
  relevant=[['  ']]       -> allSeed=[false,false,false]  (pooled Library in all three)
  relevant=[['A']] partial-> R1="A"  but R2/R3 = pooled Library, NOT the seed
```

Worst case, executed:

```
baselinePkg(POOL, { relevant: [['Only','One','List']] })
   RelevantBullets1 => "Only\nOne\nList"
   RelevantBullets2 => "Governance and Compliance: A, B\nTechnology Strategy: C, D\nBusiness: E, F"
   RelevantBullets3 => "Governance and Compliance: A, B\nTechnology Strategy: C, D\nBusiness: E, F"
```

So the answer to the adversarial question "can ordering let the pooled 36-term Library text win?" is
**YES** — not by ordering, but by the overlay declining to emit a key. A caller who supplies fewer
than three lists gets pooled Library text in the remaining slots.

### (d) Additional defect found while probing (c): some malformed shapes THROW

```
  relevant=['notalist']  -> *** THROWS *** TypeError: (src[i] || []).map is not a function
  relevant=[42]          -> *** THROWS *** TypeError: (src[i] || []).map is not a function
  relevant=[{a:1}]       -> *** THROWS *** TypeError: (src[i] || []).map is not a function
```

`body.relevant` is caller-supplied JSON passed straight through
(`relevant: body.relevant` in `baselineArtifacts`), so `POST {"relevant":["a","b","c"]}` — a plain
flat-array mistake — throws inside `baselinePkg`. The route's `try` catches it, so the caller sees
**HTTP 500 `"(src[i] || []).map is not a function"`** rather than the documented fallback.

**Fix for both (c) and (d):** validate per-slot rather than on the outer array, e.g.
`const list = Array.isArray(src[i]) ? src[i] : []; const items = list.map(...).filter(Boolean);
out[field] = (items.length ? items : [...SEED_RELEVANT_LISTS[i]]).join('\n')` — which also makes the
seed a true per-slot floor.

`H:baseline-relevant-seed` does not catch this: its fallback assertions are only
`relevantOverlay([])` and `relevantOverlay(undefined)`, the two shapes that DO work.

---

## C6 — 3 lists of 3, nine distinct, ≤1 item over 24 chars per list, ≤1 AI-prefixed — **CONFIRMED**

Executed against the compiled export:

```
$ node /tmp/probe4.mjs
lists: 3
  list1 len=3 ["Portfolio Management","Tech-Driven Innovation","Ops Automation"]
  list2 len=3 ["Tech Talent Strategy","Innovation Frameworks","Data Insights"]
  list3 len=3 ["Corporate AI Use Cases","Strategic Partnerships","Global Leadership"]
total items: 9
distinct (lowercased): 9 / 9

char lengths:
  list1: Portfolio Management=20  Tech-Driven Innovation=22  Ops Automation=14 | over24: 0
  list2: Tech Talent Strategy=20  Innovation Frameworks=21  Data Insights=13   | over24: 0
  list3: Corporate AI Use Cases=22  Strategic Partnerships=22  Global Leadership=17 | over24: 0
  max length overall: 22

AI-prefixed per the guard regex /\bAI\b|AI\//i :
   MATCH: "Corporate AI Use Cases"
  count: 1
```

Every sub-part holds: 3×3, 9/9 distinct, 0 items over 24 in any list (so the "≤1" rule passes with
margin — the longest is 22), exactly 1 AI-prefixed item.

**Adversarial note on the guard (not a defect in the seed):** `H:baseline-relevant-seed`'s AI test is
`/\bAI\b|AI\//i`, which is defeatable by an AI-related term that is not literally "AI"-prefixed:

```
   "Artificial Intelligence Strategy" guard matches? false
   "Machine Learning Ops"             guard matches? false
   "GenAI Enablement"                 guard matches? false
   "AIOps Platforms"                  guard matches? false
   "Generative Intelligence"          guard matches? false
   "LLM Adoption"                     guard matches? false
```

So the owner's "the AI is a little redundant" correction is enforced only against the literal
token. A future edit reintroducing the cluster as "GenAI / AIOps / Machine Learning" would pass.
This does not affect C6's verdict — the seed as it stands satisfies the stated property.

---

## C7 — no model call, directly or through anything it calls — **CONFIRMED**

A grep of the one file is not sufficient, so two passes were run.

### Pass 1 — MODULE import closure (this alone would NOT settle the claim)

The transitive *import* closure of `appBaseline.ts` is 50 files and **does** contain OpenAI
transport (`appPackets.ts` → `pipeline.ts`, `openaiJson.ts`, `appReviewer.ts` — 59 code hits). So
"no OpenAI code is loaded into the process" is FALSE, and any verification resting on the import
closure would wrongly refute the claim. The claim is about the CALL graph.

### Pass 2 — import-scoped CALL graph from `baselineArtifacts` / `baselinePkg`

Resolving each call site only against names defined in that file or imported into it:

```
IMPORT-SCOPED CALL-REACHABLE SET: 28 functions across 11 files
  appBaseline.ts     baselineArtifacts, baselinePkg, relevantOverlay, shapeSlotFields, todayIso
  appInsertions.ts   loadMasterBaseline
  appPackets.ts      renderArtifact
  appSession.ts      requireWrite, resolveOwner
  evidence.ts        masterBaseline
  packetTemplates.ts metaFor
  pgClient.ts        getPgClient
  pipelineConfig.ts  driveId, isDriveId, loadPipelineSettings, mailbox, parseTemperature,
                     readAppConfigAuth, resolveText, settingsFromConfig
  roleFocus.ts       fetchTemplateEntity, resolveTemplateSlots, templateRowKey
  slots.ts           emptySlots, readSlot, readSlots, slotProp
  swaps.ts           splitItems

MODEL / EXTERNAL-AI TRANSPORT HITS IN THE REACHABLE SET: 0

SANITY CONTROL (same analyzer, different entry point — proves it CAN see a model call):
  trace from artifactDocument -> 1 hit: 'ensurePackage('
```

The sanity control matters: an analyzer that finds nothing everywhere proves nothing. It finds the
model path from `artifactDocument` and not from `baselineArtifacts`. The structural reason is that
`ensurePackage` (→ `buildPackageForJD` → OpenAI) is called by `buildTemplatedArtifact`, **not** by
`renderArtifact`; `appBaseline` calls `renderArtifact` directly and so bypasses generation entirely.

### Pass 3 — every callee of `renderArtifact`, checked individually

`renderArtifact` calls `loadPipelineSettings`, `client.query`, `loadThresholds`, `fitCompactSkills`,
`splitItems`, `metaFor`, `getGoogleOAuthToken`, `copyThen`, `injectValues`, `stripLeftoverTokens`,
`shareAnyone`, `varsForType`, `writeInsertions`. Every literal `https://` fetch host in the files
that define them:

```
  packetTemplates.ts : www.googleapis.com
  googleAuth.ts      : login.microsoftonline.com  oauth2.googleapis.com
  appSession.ts      : graph.microsoft.com
  appInsertions.ts / compactFit.ts / checkPrefs.ts / swaps.ts / roleFocus.ts /
  pipelineConfig.ts / pgClient.ts / evidence.ts / slots.ts : <no literal https fetch>
```

Case-insensitive `openai|anthropic|heygen|elevenlabs` count with comments stripped is 0 in all of
them except `roleFocus.ts` (2) and `pipelineConfig.ts` (4), and those are **AppConfig key strings**,
not transport:

```
  28:  generateTemperature: 'openai.generateTemperature',
  29:  generateModel: 'openai.generateModel',
  30:  qcTemperature: 'openai.qcTemperature',
  32:  defaultRoleFocus: 'openai.defaultRoleFocus',
```

Google Docs/Drive, Microsoft Graph, Postgres and Azure Tables are reached. No model transport is.
**C7 CONFIRMED.**

**Guard limitation worth recording:** `H:baseline-no-model` reads only
`../src/functions/tests/appBaseline.ts`. It would not fire if a model call were added inside
`renderArtifact` or any other callee — the property it names ("directly or by import") is broader
than what it checks.

---

## C8 — the guards are NOT inert — **CONFIRMED**

All mutations run through `/home/user/eds-claude-skills/scripts/mutate.sh` (three-outcome harness:
`FIRED` / `INERT` / `NOT-APPLIED`), anchors supplied as FILES, `cd api && npm test` as the suite.
Pre-check: `git diff --quiet -- api/src/functions/tests/appBaseline.ts` -> **FILE CLEAN vs HEAD**,
so every restore assertion below is meaningful.

Five mutations across four distinct assertions in the two guards. **Harness verdict token is quoted
verbatim in each case.**

### `H:baseline-shape`

**M1 — reinstate the PIPES defect** (the one the owner actually saw)
```
anchor:  out[field] = kept.join('\n')
repl:    out[field] = kept.join(' | ')
$ mutate.sh api/src/functions/tests/appBaseline.ts /tmp/mut/m1.anchor /tmp/mut/m1.repl "cd api && npm test" "H:baseline-shape"
FIRED: 'H:baseline-shape' failed with the defect reinstated. The guard is real.
restored: api/src/functions/tests/appBaseline.ts matches HEAD
```

**M2 — reinstate "invent a slot count", i.e. a null cap truncates**
```
anchor:  const kept = typeof cap === 'number' && cap > 0 ? items.slice(0, cap) : items
repl:    const kept = items.slice(0, typeof cap === 'number' && cap > 0 ? cap : 3)
FIRED: 'H:baseline-shape' failed with the defect reinstated. The guard is real.
restored: api/src/functions/tests/appBaseline.ts matches HEAD
```

### `H:baseline-relevant-seed`

**M3 — remove the overlay so the pooled 36-term Library wins the three Relevant slots**
```
anchor:  ...shaped,
         ...relevantOverlay(opts?.relevant),
repl:    ...shaped,
FIRED: 'H:baseline-relevant-seed' failed with the defect reinstated. The guard is real.
restored: api/src/functions/tests/appBaseline.ts matches HEAD
```

**M4 — reinstate the owner's AI-redundancy defect (three AI-prefixed terms)**
```
repl:  ['Portfolio Management', 'Tech-Driven Innovation', 'AI in Operations'],
       ['Tech Talent Strategy', 'Innovation Frameworks', 'AI/ML Advancements'],
FIRED: 'H:baseline-relevant-seed' failed with the defect reinstated. The guard is real.
restored: api/src/functions/tests/appBaseline.ts matches HEAD
```

**M5 — reinstate a duplicate across the nine**
```
repl:  ['Corporate AI Use Cases', 'Strategic Partnerships', 'Portfolio Management'],
FIRED: 'H:baseline-relevant-seed' failed with the defect reinstated. The guard is real.
restored: api/src/functions/tests/appBaseline.ts matches HEAD
```

**5 of 5 FIRED, 0 INERT, 0 NOT-APPLIED.** No mutation broke `tsc` (the harness restored cleanly each
time and the post-run `git status --porcelain` shows only this evidence file as untracked, with no
modified sources).

### What the guards do NOT cover — stated because "not inert" is not "sufficient"

Both guards are real, and both are blind to the two defects found under C1 and C5. That is not an
inference: **those defects exist in HEAD right now and the suite is 1026/1026 green.**

- `H:baseline-shape` iterates `for (const f of SLOT_FIELDS) { if (!out[f]) continue; … }` over a
  fixture whose fields all contain real items, so the `!items.length` early-`continue` branch that
  preserves a separators-only string is never reached.
- `H:baseline-relevant-seed` tests the fallback with `relevantOverlay([])` and
  `relevantOverlay(undefined)` only — the two shapes that work. `[[]]`, `[['']]`, `[null]`,
  `[['A']]` and `['x']` are untested, and all five misbehave.

---

## C9 — full suite — **CONFIRMED**

```
$ cd api && npm test        # "test": "npm run build && node --test test/*.test.mjs"
1..1026
# tests 1026
# suites 0
# pass 1026
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 8887.312981
```

Re-run after all five mutations were restored — identical result (1026/1026, `duration_ms
8743.185207`), and `git status --porcelain` lists only `?? .claude/verify/VERIFY-baseline-relevant-seed-1.md`.

**Total 1026 · pass 1026 · fail 0 · skipped 0 · cancelled 0 · todo 0.**

---

## Adversarial angles — answers

| Angle | Answer |
|---|---|
| Can a pipe SURVIVE into a rendered slot field? | **YES.** A separators-only block (`"\|"`, `"\|\|\|"`, `" \| "`, `"-\|-"`) hits `if (!items.length) continue` and is returned verbatim. See C1. |
| Can `relevantOverlay` emit an EMPTY STRING for a slot (silent blanking)? | **NO.** It omits the key instead of writing `''`; verified across `[['']] [[' ']] [[null]] [[0]] [[false]]`. This failure mode is genuinely closed. |
| Does `baselinePkg` apply the overlay AFTER shaping — can the pooled Library win? | Ordering is correct (`...shaped` then `...relevantOverlay(...)`), but **the Library still wins** whenever the overlay omits a key: any malformed or short caller list leaves pooled 36-term text in the remaining slots. See C5(c). |
| Is the AI check defeatable by an AI-related but not AI-prefixed item? | **YES.** `/\bAI\b\|AI\//i` misses "Artificial Intelligence Strategy", "GenAI Enablement", "AIOps Platforms", "Machine Learning Ops", "LLM Adoption". Guard weakness, not a seed defect. |

---

## VERDICT

```
C1  REFUTED       shapeSlotFields leaves no '|' in the six SLOT_FIELDS
C2  CONFIRMED     configured count trims; null/absent/0/negative never trims
C3  CONFIRMED     prose + @-placeholders pass through byte-identical
C4  CONFIRMED     relevantOverlay overrides the pooled Library with SEED_RELEVANT_LISTS
C5  REFUTED       caller list wins; empty/malformed falls back to the seed
C6  CONFIRMED     3x3, nine distinct, <=1 over 24 chars per list, <=1 AI-prefixed
C7  CONFIRMED     no model call reached, directly or through any callee
C8  CONFIRMED     both guards mutation-proved: 5/5 FIRED, 0 INERT, 0 NOT-APPLIED
C9  CONFIRMED     1026 tests, 1026 pass, 0 fail, 0 skipped
```

### Summary

Seven of nine confirmed. The implementation does what it claims on every live input I could find,
the two guards are genuinely load-bearing (five independent mutations, five FIRED), and the
no-model property survives a real call-graph trace rather than a single-file grep — the import
closure DOES contain OpenAI transport, so that distinction had to be established rather than
assumed.

Two claims fail, both on inputs the guards never exercise:

**C1** is true for every block containing at least one real item, including all live stored values.
It is false for a separators-only block, which `shapeSlotFields` returns verbatim via the
`if (!items.length) continue` branch — so a MasterContext field reading `"|"` renders a pipe in the
document, the exact defect the function exists to remove. Low likelihood, but it is the named
property and it does not hold universally.

**C5** fails on its second half and is the more serious of the two. The seed fallback is selected by
`Array.isArray(lists) && lists.length`, an outer-array test, so a caller list that is non-empty but
malformed or short — `[[]]`, `[['']]`, `[null]`, `[['A']]` — does **not** fall back to the seed. The
overlay emits no key and the slot keeps the pooled 36-term Library text, which is precisely the
outcome `SEED_RELEVANT_LISTS` was created to replace. A partial list (one list supplied instead of
three) silently leaves Library text in slots 2 and 3. Worse, `relevant: ['a','b','c']` — a flat
array, the most likely caller mistake — throws `TypeError: (src[i] || []).map is not a function`
inside `baselinePkg`, which the route converts to an HTTP 500. The claim's "rather than blanking the
slot" half IS true: no empty string is ever emitted.

Both are fixable in a few lines (validate per-slot, fall back per-slot to `SEED_RELEVANT_LISTS[i]`;
`delete out[field]` on the empty-items branch), and both should get an H-case since the existing
guards are demonstrably blind to them.
