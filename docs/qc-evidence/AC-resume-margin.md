# AC — resume field-margin gaps (adversarial, independent)

**Written:** 2026-08-25 · by an independent AC-writing subagent that did **not** plan this work.
**Analysis only** — nothing under `app/src` or `api/src` was modified, nothing was committed.

**Scope:** the three gaps put to me as (1) `Changes made` missing from the field margin, (2) hover
linkage absent, (3) `swap_decision.override_value` / `override_state`.

## Ground truth used

Every claim below is checked against **`origin/main`**, not the working tree, per `CLAUDE.md`
("Fetch-first before ANSWERING a status question… Answer from `origin/main`").

```
git fetch origin
git rev-parse origin/main   # b319943  (local HEAD == origin/main; no drift)
git diff origin/main --stat -- app/src/screens/AssetBlocks.jsx app/src/api.js \
    app/src/highlight.js app/src/screens/QcRail.jsx api/src/functions/tests/schema.ts
# -> EMPTY. The working tree is byte-identical to main for every file these ACs touch.
```

I read `docs/qc-evidence/AC-resume-rows.md` → "ADVERSARIAL SUMMARY" first, as instructed. It records
that a previous inventory called ROW 6 and ROW 7 `ABSENT`/`PARTIAL` when both were **shipped**, and
that believing it would have built "a second edit path beside a working one". **That failure mode has
recurred in this brief.** See Gap 1.

---

## VERDICT TABLE — read before writing any code

| Gap | Brief's claim | Ground truth on `origin/main` | Verdict |
|---|---|---|---|
| **1 — `Changes made` in the margin** | "there is NO struck-through original→new diff and **NO Undo control**"; the undo route "is consumed **ONLY** on the QC rail" | **The margin change log is BUILT, Undo included.** `AssetBlocks.jsx:642-649` renders `data-qc={BLOCK_HOOKS.fieldChangeLog}` containing `<CorrectionRow … inField>`, imported at `AssetBlocks.jsx:42` **from `QcRail.jsx`**. `CorrectionRow` (`QcRail.jsx:489`) renders the `Undo` button (`:583-585`, `QC_HOOKS.correctionUndo`) wired to `api.revertCorrection`, the reason (`:568`, `why: …`), and the suggest-a-change box (`:586-588` + `:591-612`). | **MOSTLY ALREADY BUILT — one narrow real gap** (the *struck* diff) + two copy divergences |
| **2 — hover linkage** | "Zero hits for hover/onMouseEnter in AssetBlocks.jsx" | **Confirmed.** `grep -n -i "onMouseEnter\|onMouseLeave\|hover\|onFocus" ` on `git show origin/main:app/src/screens/AssetBlocks.jsx` exits **1** (no matches). | **REAL GAP** (scope corrected below — it is bigger than a handler) |
| **3 — `override_value` / `override_state`** | owner wants a swapped value editable in place | see Gap 3 section | **REAL GAP** (columns do not exist) — **but blocked on an owner decision** |

---

## GAP 1 — `Changes made` in the field margin

### VERDICT: **MOSTLY ALREADY BUILT.** Four of the brief's five particulars are wrong.

This is the ROW-6/ROW-7 failure repeating. Stated bluntly so it cannot be skimmed past:

| # | Brief says | Ground truth (`git show origin/main:<path>`) |
|---|---|---|
| 1 | "there is **NO Undo control**" | **FALSE.** `QcRail.jsx:582-585`: `undo.can ? <button … data-qc={QC_HOOKS.correctionUndo} data-qc-id={row.id} onClick={doUndo} …>Undo</button> : <span … data-qc-available="0">{undo.reason}</span>`. This renders **in the field margin** because `AssetBlocks.jsx:645` mounts `CorrectionRow`. |
| 2 | the route "is consumed **ONLY** on the QC rail (`QcRail.jsx:578`)" | **FALSE.** `AssetBlocks.jsx:42` — `import { CorrectionRow } from './QcRail.jsx'`. One component, two mount points. The rail is where it is *defined*, not the only place it is *used*. |
| 3 | "`app/src/api.js:194`, **`revertOne`**" | **Wrong name and wrong line.** The client export is `revertCorrection` at `api.js:204`. `revertOne` appears in this repo **only inside comments** (`api.js:197`, `assetGate.js:621,625`) as the name of the *server* handler. A grep for `revertOne` across every `app/src/**/*.js{,x}` on `main` returns comment hits and nothing else. Searching for the wrong symbol is a plausible root cause of the whole mis-diagnosis. |
| 4 | "renders 'Why it changed' (rationales, line ~740) **and a `reason`**" — implying that is the change log | **Conflated.** `AssetBlocks.jsx:738-745` "Why it changed" renders `rationales`, derived at `:469` from **`swapsForList`** — that is the *swap* rationale block, a different feature. The corrections `reason` is a separate render at `QcRail.jsx:568`. |
| 5 | "zero hits for line-through/textDecoration" | **FALSE as stated** (`AssetBlocks.jsx:381` is `<s>{s.from_label}</s>`), **but true where it matters**: that `<s>` is in `ListBody`'s "Taken out of this list" (dropped swaps), not in the correction row. **The conclusion survives its broken evidence** — see below. |

### What is genuinely missing (the only real work in Gap 1)

Compared line-by-line against SPEC 4.5's margin bullet — "`Changes made`: struck original → new
wording, the reason, `Undo` and `Suggest something different`":

| SPEC element | Built? | Evidence |
|---|---|---|
| in the margin, "same place as every other field — never moved to the left column" | **YES** | `AssetBlocks.jsx:623` opens `const margin = (…)`; the change-log block at `:642` is inside it |
| the reason | **YES** | `QcRail.jsx:566-570`, `why: {row.reason \|\| 'no reason was recorded for this change'}` |
| `Undo` | **YES**, and correctly refuses | `QcRail.jsx:582-585` + `undoAvailability()` `assetGate.js:605-618` + `revertOutcome()` `:632` |
| `Suggest something different` | **YES in function, NO in label** | button reads **`Change it`** (`QcRail.jsx:588`). `suggestScope()` (`assetGate.js:649`) supplies the panel copy. |
| heading `Changes made` | **NO — reads `Corrected for you`** | `AssetBlocks.jsx:643`. Note a *third* string exists: `CHANGE_LOG_HEADLINE = 'Done for you'` (`assetGate.js:445`), used by the rail. |
| **struck original → new wording** | **NO** | `correctionSentence()` (`assetGate.js:569-575`) returns prose: `'Corrected: "' + phrase + '" rewritten as "' + replacement + '"…'`. Original and replacement are both present and both in plain quotes; **neither is struck**. |

So Gap 1 reduces to: **one presentational change (strike the original inside the existing sentence)
and two copy questions.** It is emphatically *not* "build the margin change log".

### TIER: **3 for the copy strings, 2 for the struck rendering.** Not tier 1.

Justified against `CLAUDE.md`'s table. `correctionSentence()` decides no gate, no score and no
coverage count; `railChangeLog()` feeds a *display* log. It does **name an offender** in the loose
sense (it names the phrase that was corrected) — but the naming is **already shipped and already
exact**: `phrase`/`replacement` are passed through `String(...)` from the row with no matching,
fuzzy or otherwise (`assetGate.js:538-539`). This change adds **zero** new matching logic, so the
"accusation grade" trigger is not met. **If any AC below is implemented by *re-deriving* which
substring to strike (a search of the replacement text for the original), the tier becomes 1** — see
AC-1.4, which forbids exactly that.

### Integration trace

- **ONE core system:** `app/src/assetGate.js` → `correctionRow()` / `correctionSentence()`. Every
  correction rendering funnels through it — `qcRail.js:18-31` re-exports it, and both mount points
  consume the re-export.
- **Upstream producers:** `api.artifactChecksResult(artifactId)` (`api.js:187`) →
  `useArtifactCorrections` (`AssetBlocks.jsx:102-113`) → `railChangeLog(result)` (`qcRail.js:193`)
  → `correctionsState`/`orderCorrections`/`correctionRow`. The DB source is the corrections rows
  carrying `phrase`, `replacement`, `reason`, `source`, `applied_seq`, `reverted_at/by`.
- **Downstream consumers — BOTH must be checked, this is the trap:**
  1. `QcRail.jsx:635` — the QC step's log (`inField` **false**)
  2. `AssetBlocks.jsx:645` — the field margin (`inField` **true**)
  A change to `correctionSentence()` lands on **both surfaces at once**. That is the correct place
  to change it (one definition), but it means "the QC rail still reads well" is part of the
  acceptance, not an afterthought.
- **EXTEND vs NEW:** **EXTEND, mandatory.** `CorrectionRow`'s own docblock (`QcRail.jsx:472-488`)
  states the rule it exists to enforce. A second correction renderer inside `AssetBlocks.jsx` is
  precisely the parallel system `CLAUDE.md` forbids and the `inField` prop already exists to
  prevent. **Any AC here that is satisfied by writing new JSX in `AssetBlocks.jsx` has been
  satisfied wrongly.**

### Acceptance criteria — Gap 1

**AC-1.1 (the struck original renders, in one place).**
Given a correction row with `phrase = "15"` and `replacement = "18"`, when the field margin renders
it, then the DOM node carrying the sentence contains an element whose computed
`text-decoration-line` is `line-through` and whose text content is exactly `15`, and the text `18`
is present in the same node **without** `line-through`.
*Binary:* a Playwright/`jsdom` assertion on the two computed styles.
*Constraint:* the change is made where `sentence` is produced/rendered — a `git diff` touching
`AssetBlocks.jsx` alone fails AC-1.6.

**AC-1.2 (the QC rail renders identically).**
Given the same correction, when the QC step's change log renders it (`inField = false`), then the
same struck-original assertion in AC-1.1 holds there too.
*Rationale:* proves one definition, not two. This AC is the whole point of the tier-2 call.

**AC-1.3 (an undone row does not lie about which side is struck).**
Given a row where `undone === true` — for which `correctionSentence` currently emits
`Undone: "<replacement>" is back to "<phrase>"` (`assetGate.js:572`) — when it renders, then the
struck text is the **replacement** (the wording no longer in the document), never the `phrase`.
*Binary:* assert the struck node's text equals `replacement` when `undone`, equals `phrase`
otherwise.
*Why this is not pedantry:* strike-through means "this is not what the document says". Reusing the
non-undone orientation on an undone row asserts the opposite of the truth on a surface the user
consults to find out what their document says.

**AC-1.4 (no re-derivation — struck text comes from the field, never from a search).**
Given the implementation, when reviewed, then the struck substring is taken from the
`phrase`/`replacement` **fields of the row model**, and no `indexOf`, `RegExp`, `.replace()`,
`split`, or similarity call is used to locate the original inside the sentence string.
*Binary:* `git diff` review + a grep of the changed hunk for `indexOf|RegExp|new RegExp|replace\(|match\(`.
*Why:* re-finding the original by string search is fuzzy matching in an accusation position
(`CLAUDE.md`: "Fuzzy matching is for RANKING, never for ACCUSING"), and it would promote this work
to tier 1. If the sentence must be decomposed, `correctionSentence()` should instead return
**parts** (`{prefix, from, mid, to, suffix}`) and the string form be composed from them.

**AC-1.5 (empty phrase or empty replacement is not rendered as a struck empty box).**
Given a row where `phrase === ''` or `replacement === ''` (`assetGate.js:538-539` explicitly
tolerates both — `String(r.phrase == null ? '' : r.phrase)`), when it renders, then no zero-width
struck element is emitted; the row states the missing side in words instead.
*Binary:* render with `phrase: ''`; assert no element with `line-through` and `textContent === ''`.
*Absent evidence is `not_applicable`, never `pass`:* an empty original is "we did not record one",
which must read differently from "the original was blank".

**AC-1.6 (extend, do not duplicate).**
Given this gap is closed, when the diff is reviewed, then `AssetBlocks.jsx` contains **no** new
correction-rendering JSX, and the count of `CorrectionRow` **definitions** in `app/src/` is still
exactly **1**.
*Binary:* `grep -rn "export function CorrectionRow" app/src/ | wc -l` → `1`.

### Guards and their mutation proofs — Gap 1

| Guard (H-case slug) | Asserts | **Exact mutation that must make the suite FAIL** |
|---|---|---|
| `H:correction-sentence-parts` | `correctionSentence()` (or its parts-returning successor) yields the original and the replacement as **separately addressable values**, and for `undone` rows the two are swapped per AC-1.3 | In `assetGate.js:571-573`, swap the `undone` ternary's two branches. Suite must fail on the undone-orientation assertion. If it passes, the guard reads only the non-undone path and is inert. |
| `H:one-correction-renderer` | exactly one `export function CorrectionRow` in `app/src/` | Add a second `export function CorrectionRow(){}` to `AssetBlocks.jsx`. Suite must fail. (Mutation is source-level; per `CLAUDE.md` a source grep is the right tool for a structural rule a runtime test cannot express.) |
| `H:struck-side-not-searched` | the changed hunk contains no string-search call used to locate the original | Insert `const i = sentence.indexOf(row.phrase)` into the correction render path. Suite must fail. **Caveat to state honestly:** this guard is a source grep and is the *weakest* of the three — it can be evaded by an aliased helper. It is worth having because the failure it blocks is a tier-promotion, but do not describe it as proof that no re-derivation exists. |

**Note on a mutation that will NOT fail, and must be reported as such:** changing the heading string
`'Corrected for you'` → `'Changes made'` (`AssetBlocks.jsx:643`) is behaviourally equivalent to
every guard above. If a guard is written that pins the heading text, say plainly that it pins
**copy**, not behaviour.

### Questions the owner must answer before Gap 1 is built

**Q1.1 — the heading.** SPEC 4.5 says `Changes made`. The margin says `Corrected for you`
(`AssetBlocks.jsx:643`). The rail says `Done for you` (`CHANGE_LOG_HEADLINE`, `assetGate.js:445`).
**Three strings for one concept.** Which wins, and does the rail change with the margin? *(A code
comment at `AssetBlocks.jsx:637` claims `Corrected for you` is "the design's own words" — that
directly contradicts SPEC 4.5. One of the two is wrong and I am not guessing which.)*

**Q1.2 — the button label.** SPEC 4.5 and 4.7 say `Suggest something different`; the button reads
`Change it` (`QcRail.jsx:588`). Is the short label deliberate? It renders on the QC rail too, so
this is not a margin-local decision.

**Q1.3 — is the struck diff wanted at all,** given the sentence already states both sides in quotes
and `CorrectionRow`'s docblock records that a previous redundant label was deleted *after* it shipped
because the screen said the same word three times? A strike may re-add visual noise the last cleanup
removed. This is a design call, not an engineering one.

*(Sections for Gap 2 and Gap 3 follow — written in order, appended as each was verified.)*

---

## GAP 2 — hover linkage between a margin row and its phrase in the text

### VERDICT: **REAL GAP — confirmed.** But the brief understates one half and overstates the other.

**Confirmed absent.** On `origin/main`:
```
git show origin/main:app/src/screens/AssetBlocks.jsx | grep -n -i "onMouseEnter|onMouseLeave|hover|onFocus"
# exit 1 — no matches
git show origin/main:app/src/theme.css | grep -n "is-on"
# exit 1 — no active/hot highlight state exists in the stylesheet either
```
There is no hover state, no lifted "which phrase is hot" state, and **no token for an active
highlight**. The brief found the handler gap; the missing *token* is the part that turns this from a
30-line change into a gated one (see the contrast registry, below).

### CORRECTION 2-A — the substrate is already perfect, and that decides the design

The brief says "note the existing marking machinery". Stronger than that: **the margin row and the
body mark already read from the same array.**

- `AssetBlocks.jsx:520` — `<BlockBody … phrases={wording} />`
- `AssetBlocks.jsx:693-694` — the margin's `posting_wording_kept` block is `wording.map((phrase, i) => …)`

One array, `wording`, rendered twice. The linkage key therefore **already exists** and must not be
invented: it is the phrase string (or its index in `wording`). Any implementation that introduces a
second identifier — a generated id, a `data-*` slug, a normalised key — has created the parallel
system `CLAUDE.md` forbids, and has done so for no reason.

`markRuns()` (`highlight.js:96-135`) already returns `[{t, mark}]` segments covering the whole
input, so the segment that must light up is already isolated. `Marked` (`AssetBlocks.jsx:425-432`)
renders each as `<span className={HIGHLIGHT_CLASS[r.mark]}>`; it needs an *additional* class, not a
new renderer.

### CORRECTION 2-B — "and vice versa" has NO reference implementation, not even in the prototype

SPEC 4.5 says "Hovering a margin row highlights its phrase in the text **and vice versa**." I checked
the prototype rather than assuming it implements its own spec:

- **margin → text: implemented.** `qc/assets.jsx:106,129,288` set lifted state on `onMouseEnter`
  (`setActiveEcho(m.phrase)`, `onHover(it.term)`), and `Marked` (`qc/assets.jsx:8-19`) adds
  `is-on` to the matching `<mark>`.
- **text → margin: NOT implemented.** `qc/assets.jsx:19` renders `<mark>` with **no** handlers. The
  only text-side behaviour is CSS `mark.kw-mark:hover` / `mark.echo-mark:hover` in
  `Packet QC Prototype.html`, which darkens **the mark itself**. Nothing in the prototype highlights
  the *margin row* when the text is hovered.

So half of the SPEC sentence has a working reference and half is unbuilt in every artefact we have.
**Do not infer the missing half's behaviour.** See Q2.1.

### CORRECTION 2-C — scope is bounded by the term library being OFF, and this is not negotiable

`AssetBlocks.jsx:418-424` states it in the code: *"Keyword marking stays absent because
`term_library_entry` has zero published rows; a highlight with no source would be invented."*
`.claude/DEFERRED.md` row `D:term-library-off-by-owner-decision` confirms OFF is an owner decision.

Therefore, of the margin blocks that SPEC 4.5 lists, **exactly one is linkable today**:

| Margin block | Has a phrase marked in the body? | Linkable now? |
|---|---|---|
| `posting_wording_kept` (`BLOCK_HOOKS.fieldWordingKept`, `:693`) | **YES** — same `wording` array feeds `Marked` | **YES — this is the whole buildable scope** |
| `Keywords placed` chips | No — not rendered at all; needs published `term_library_entry` | **NO — forbidden by the constraint** |
| `Corrected for you` | `replacement` is in the text but is not passed to `markRuns` | Possible, but a scope increase — see Q2.2 |
| `Open on this field` findings | offenders are sentences (`$18M (your profile states …)`), not bare phrases | **NO** — marking them would need matching, which is tier 1 |
| `Posting lines answered` chips | requirement text is not marked in the body | NO |

**An AC that says "hovering any margin row highlights its phrase" is unbuildable and must not be
written.** The honest AC is scoped to `posting_wording_kept`.

### TIER: **2.** Justified, with one tier-1 tripwire named.

Pure render/interaction state. It decides no gate, no score, no coverage count. It **displays** an
accusation ("these words came from the employer's ad") but does not compute one — `markRuns()`
already did that, exactly and whole-phrase, and is unchanged here.

**The tripwire:** the moment an implementation matches text to decide *what* to light up — anything
resembling `phrase.toLowerCase().includes(...)`, a similarity score, or a second call to
`markRuns` with different inputs — it is deciding an accusation and becomes **tier 1**. AC-2.5
forbids it.

### Integration trace

- **ONE core system:** `app/src/highlight.js` — `HIGHLIGHT_CLASS` / `HIGHLIGHT_TOKENS` /
  `HIGHLIGHT_LITERALS` / `markRuns`. Its own docblock says it exists so that "a name that three
  files hand-type is a name that drifts, and here the thing that drifts is a COLOUR, which fails
  silently". The active state belongs **there**, beside the class it modifies.
- **Upstream producers:** `useArtifactCorrections` → `wording` (the `posting_wording_kept` offender
  list from `artifactChecksResult`) → passed to *both* `BlockBody` (`:520`) and the margin (`:693`).
- **Downstream consumers of `HIGHLIGHT_CLASS` / the tokens — all must reconcile:**
  1. `AssetBlocks.jsx:425-432` `Marked`
  2. `app/src/theme.css:249-250` — `.qc-kw` / `.qc-echo` rule bodies
  3. **`app/test/browser/run-contrast.mjs:94-95`** — the contrast registry names `.qc-kw` and
     `.qc-echo` with `grounds: DEFAULT_GROUNDS`. Per `DEFERRED.md` D28 this sweep is **1,062 checks
     across both themes and a STALE entry fails the suite** (`run-contrast.mjs:252`). **A new active
     class with a new background is a new selector that must be registered with a `why`, in both
     themes, or the suite fails — correctly.** This is the dependency the brief did not name and it
     is the one that makes this more than a handler.
  4. Any other `HIGHLIGHT_CLASS` call site — `highlight.js`'s docblock says margin quotes and the JD
     step also paint these treatments; each must be checked for whether it now inherits an active
     state it never asked for.
- **EXTEND vs NEW:** **EXTEND.** Add an active modifier to the existing `HIGHLIGHT_CLASS` contract
  and an `active` prop to the existing `Marked`. A new `HighlightedText` / `LinkedPhrase` component
  beside `Marked` is a duplicate and fails AC-2.6.

### Acceptance criteria — Gap 2

**AC-2.1 (margin → text).** Given a field whose `wording` array contains `"safety-critical"` and
whose `after_text` contains that phrase, when the pointer enters that margin row inside
`[data-qc="<BLOCK_HOOKS.fieldWordingKept>"]`, then the body `<span>` wrapping `safety-critical`
carries the active class in addition to `qc-echo`, and **no other** marked span in that field does.
*Binary:* count of elements with the active class === 1, and its `textContent` === `safety-critical`.

**AC-2.2 (the link releases).** Given AC-2.1's hover is active, when the pointer leaves the margin
row, then zero elements in that field carry the active class.
*Binary:* count === 0. *Why explicit:* a `setState` on enter with no matching leave is the standard
form of this bug and leaves the document permanently painted.

**AC-2.3 (a phrase occurring twice lights both, or states which — no silent pick).** Given
`after_text` contains the hovered phrase **twice**, when the margin row is hovered, then **every**
occurrence carries the active class.
*Binary:* count === 2. *Why:* `markRuns` marks all non-overlapping occurrences, so the margin row
already refers to all of them. Lighting only the first tells the reader there is one.

**AC-2.4 (a margin row whose phrase is NOT in the body is inert, and says nothing false).** Given a
`wording` entry that `markRuns(after_text, [phrase])` does not match (the check ran against text
that has since been rewritten), when that row is hovered, then zero elements gain the active class
**and no error is thrown**; the row must not render an affordance implying a target exists.
*Binary:* count === 0, no console error.
*This is the `not_applicable`-never-`pass` AC:* absent evidence of a match is "there is nothing to
point at", never "pointing succeeded".

**AC-2.5 (no new matching — the active phrase is passed, never re-found).** Given the
implementation, when reviewed, then the hovered phrase reaches `Marked` as a **prop whose value is
an element of the same `wording` array** the margin rendered, and the diff introduces no
`includes(`, `indexOf(`, `RegExp`, `toLowerCase().` comparison or similarity call outside
`markRuns`'s existing body.
*Binary:* grep of the diff hunk. *Why:* this is the tier-1 tripwire. Re-deriving the target is
matching, and matching in an accusation position is exactly what `CLAUDE.md` reserves for exact,
whole-phrase logic that already exists one function away.

**AC-2.6 (extend, do not duplicate).** Given this gap is closed, when the diff is reviewed, then
`app/src/` contains exactly one function that converts text + phrases into marked spans, and the
active class name is exported from `app/src/highlight.js` alongside `HIGHLIGHT_CLASS` — never typed
as a literal in a `.jsx`.
*Binary:* `grep -rn "export function Marked\|function Marked" app/src/ | wc -l` → `1`; and the
literal active class string appears in `highlight.js` only.

**AC-2.7 (the active treatment is a registered colour in BOTH themes).** Given the active state
introduces any new colour, when the suite runs, then `app/test/browser/run-contrast.mjs` reports
zero failures with the new selector present in `RULES` with a stated `why`, measured light **and**
dark, and any new swatch listed in `HIGHLIGHT_LITERALS` (`highlight.js:56-64`) so the
"pasted into a component" grep still covers it.
*Binary:* `run-contrast.mjs` exit 0 with the new selector in its output.
*If the active state is achieved with no new colour* (e.g. an outline in an existing token), then
this AC is **`not_applicable`** and must be reported as such — not as a pass.

**AC-2.8 (keyboard reaches it, or the control is not the only route).** Given the linkage exists,
when a keyboard-only user tabs to the margin row, then either the same active state is applied on
`focus`, or the margin row is not the sole means of locating the phrase.
*Binary:* dispatch `focus`; assert the same count assertion as AC-2.1, **or** record explicitly
that the design decision was "hover is an enhancement, the phrase is also named in text" — which is
already true (`:698` renders the phrase as a `<span>`), making this AC satisfiable by evidence
rather than by code. State which.

**AC-2.9 (no linkage is claimed for blocks that cannot have one).** Given the term library is OFF
per `D:term-library-off-by-owner-decision`, when this work lands, then no `Keywords placed` chip,
keyword highlight, or `qc-kw` linkage is rendered or asserted, and no AC in the delivered set
depends on a published `term_library_entry` row.
*Binary:* `grep -rn "qc-kw" app/src/screens/AssetBlocks.jsx` returns no new call site.

### Guards and their mutation proofs — Gap 2

| Guard (H-case slug) | Asserts | **Exact mutation that must make the suite FAIL** |
|---|---|---|
| `H:hover-link-releases` | after a leave event, zero nodes carry the active class (AC-2.2) | Delete the `onMouseLeave` handler (or make it a no-op `() => {}`). Suite must fail. If it still passes, the guard asserts only the enter path. |
| `H:hover-link-all-occurrences` | all occurrences light, not the first (AC-2.3) | In the active-class predicate, add `&& i === firstMarkedIndex` so only the first marked run activates. Suite must fail on a two-occurrence fixture. **This mutation requires the fixture to actually contain the phrase twice** — if the fixture has one occurrence the mutation is behaviourally equivalent and will correctly fail to fail; say so and fix the fixture rather than claiming the guard is proven. |
| `H:hover-link-no-rematch` | no string-search call is used to locate the hovered phrase (AC-2.5) | Replace the passed-down active phrase with `wording.find(w => text.toLowerCase().includes(w.toLowerCase()))`. Suite must fail. **Weakest guard of the three** — it is a source grep and an aliased helper evades it; worth having because the failure it blocks is a tier promotion, but do not call it proof. |
| `H:highlight-active-class-single-source` | the active class string is exported from `highlight.js` and not hand-typed in a `.jsx` (AC-2.6) | Hard-code the active class string as a literal in `AssetBlocks.jsx`'s `Marked`. Suite must fail. |
| *(contrast)* — **no new H-case** | `run-contrast.mjs` already fails on an unregistered selector and on a stale entry | Add the new active rule to `theme.css` **without** registering it in `RULES`. The existing sweep must fail. **Do not write a new guard for this** — the guard exists; duplicating it is the parallel-system mistake at the test layer. |

### Questions the owner must answer before Gap 2 is built

**Q2.1 — is "and vice versa" in scope?** SPEC 4.5 asks for it; the prototype does **not** implement
it (`qc/assets.jsx:19` renders `<mark>` with no handlers — only a CSS self-hover). If yes, what does
a highlighted *margin row* look like? There is no treatment for it in `theme.css` or the prototype,
and inventing one adds a colour that must clear the D28 contrast sweep in both themes. **I am not
guessing this.** Recommended framing for the decision: ship margin→text first (it has a reference
implementation), and treat text→margin as its own scoped item.

**Q2.2 — does the linkage extend to `Corrected for you`?** SPEC 4.5's sentence says "a margin row",
unqualified. Today only `posting_wording_kept` phrases are passed to `markRuns` (`:520`). Linking
corrections would mean passing `replacement` strings into the body marking too — which changes what
is highlighted in the draft, a visible change to every field with a correction. In scope or not?

**Q2.3 — hover on touch.** The `ReqLegend` comment at `AssetBlocks.jsx:733-734` records that "a
tooltip was the only expansion before, which no touch device shows". A hover-only linkage
reintroduces exactly that class of defect. Is a tap-to-pin state wanted (the prototype's
`onClick={() => onOpen(open === id ? null : id)}` at `qc/assets.jsx:39` suggests pinning was
intended), or is hover-only accepted as a progressive enhancement?

---

## GAP 3 — `swap_decision.override_value` + `override_state`

### VERDICT: **REAL GAP** at the schema level — **but it must NOT be built as briefed.**

**The columns genuinely do not exist.** `git show origin/main:api/src/functions/tests/schema.ts`,
`swap_decision` (`:534-557`): the full column list is `id, packet_id, list, seq, action,
from_candidate_id, to_candidate_id, from_label, to_label, requirement_id, verbatim_quote,
confidence, driver, rationale, loop, created_at`. `grep -n -i "override" ` on the same file returns
`artifact_gate` (`:631-636`) and `remediation_loop` (`:852-854`) only — **never `swap_decision`**.

*(Minor: the brief's path `app/src/functions/tests/` does not exist. The schema is
`api/src/functions/tests/schema.ts`.)*

**However, three findings on `origin/main` mean the briefed shape would silently destroy user data
and quietly move an accusation.** These are the reason this gap cannot go straight to
implementation.

### FINDING 3-A (BLOCKING) — a value stored on `swap_decision` is DELETED by the next build

`appSwaps.ts:45` — `writeSwaps` runs, inside its transaction:
```
delete from swap_decision where packet_id=$1 and loop=$2
delete from skill_candidate where packet_id=$1 and loop=$2
```
…then re-inserts every row from `buildSwaps()`. The delete is scoped to the pass, **not to the
row**, and it is **idempotent by design** — the function's own docblock (`appSwaps.ts:11-28`) states
"re-running one pass stays idempotent". So **re-running the same pass wipes an override stored on
that row**, and nothing in `writeSwaps` reads, preserves, or re-applies a column it did not
generate.

This is not a hypothetical: the docblock records that this exact delete already destroyed the swap
record once (P3-21), and the fix was to scope it by `loop` — which does nothing for a user value
written into a pass the pipeline will write again. **An override column on `swap_decision` is a
column whose contents the pipeline is architecturally licensed to delete.**

Any AC set that puts `override_value` on `swap_decision` without resolving this is specifying data
loss. See Q3.1.

### FINDING 3-B (BLOCKING, tier-setting) — `swap_decision` feeds the GATE, the SCORE and the SHIPPED DOCUMENT

The brief presents this as an in-place edit affordance. It is not. `to_label` is read by three
things that decide or state something:

1. **The gate and the score.** `appChecks.ts:43-44` selects
   `action, driver, to_label, from_label, requirement_id, seq, list from swap_decision` and passes
   it as `swaps` into `evaluateArtifact` (`:113`), whose return type is
   `{ gate, attention, results, score }`.
2. **An accusation that names offenders.** `checks.ts:906-919`, check `changes_cited`:
   ```
   uncited.map(s => `${s.action}: ${s.to_label || s.from_label}`)
   ```
   — the offender string **is** `to_label`. Overriding it renames the thing being accused.
3. **The text that ships in the document.** `appPackets.ts:669-693` builds the compact resume's
   `SkillsBullets` from `swap_decision` rows via `fitCompactSkills`, and `checks.ts:867-903`
   re-runs the **same** function over the **same** rows for the `compact_skills_fit` check. So an
   override changes both what the reader receives and what the check says about it — and the code
   comment at `checks.ts:860-862` says the two must stay one implementation precisely so they cannot
   name different items.

### TIER: **1 — accusation grade.** Not negotiable, and it is a property of the code path.

`CLAUDE.md`: tier 1 is "anything that decides… the artifact gate, a score, a coverage count, or that
names an offender." Finding 3-B shows `to_label` does **all four**. Per the same rule — "Tier 1 is a
property of the CODE PATH, not of the change's size" — the fact that this may look like two columns
and a text input is irrelevant.

Full process applies: this AC set **before** coding, an independent `verifier` **after**, every new
guard mutation-proven, and live verification via `db-query.yml` + `api-test.yml`. Plus, because it
is a schema change, `CLAUDE.md`'s **strict** local-Postgres rule: the migration must be executed
against a database seeded with `main`'s schema **and populated rows**, not a fresh one (`H39`/`H39b`).

### FINDING 3-C — there are already TWO in-place edit paths. This may be a third.

**This is the "Extend, don't duplicate" question, and it is the one I would put to the owner first.**
The app already lets a user change a generated value:

| Existing path | What it does | Route |
|---|---|---|
| `correction` + revert | records `phrase → replacement` per `merge_field` with `before_sha256`, `applied_seq`, an undo, and a refusal when the text moved | `POST /app/correction/{id}/revert` |
| `aiEditArtifact(id, {instruction, section})` | field-scoped rewrite, already reachable from the field margin **and** from `CorrectionRow`'s "Change it" | `POST /app/artifact/{id}/ai-edit` |
| `saveArtifactContent(id, body)` | writes artifact content directly | `POST /app/artifact/{id}/content` |

`correction` is strikingly close to what `override_value` would be: it is per-field, it stores the
original and the replacement, it survives as an audit row rather than mutating in place, and
`correction_revert_paired` / `correction_span_matches_phrase` already encode the integrity rules an
override needs. **A new `override_value` on `swap_decision` may be a second answer to a question
`correction` already answers**, which is the exact failure `CLAUDE.md` records (the `taxonomy_title`
system built beside `persona`). It is also immune to Finding 3-A, because `correction` rows are
keyed to the artifact and are not deleted by `writeSwaps`.

I am **not** asserting `correction` is the right home — `correction.merge_field` is a document field
and a swap is a list item, and `source` is constrained to `('profile_figure','generalized')`. I am
asserting that **standing up a third edit path without answering this is forbidden by the standing
rule**, and the answer is an owner/architecture decision, not mine to guess. See Q3.2.

### FINDING 3-D (incidental, found en route) — `api.js` defines `packetSwaps` twice

`git show origin/main:app/src/api.js` defines `artifactInsertions` at **:171 and :191** and
`packetSwaps` at **:172 and :193** — duplicate keys in one object literal. The later definition
silently wins. Both pairs are byte-identical today, so there is **no live defect**, but any Gap-3
work that edits the earlier `packetSwaps` line will be a **silent no-op**. Flagged, not fixed —
it is outside this brief's scope.

### Integration trace

- **ONE core system:** `api/src/functions/tests/appSwaps.ts` — `writeSwaps` (the only writer) and
  `swapsGet` (the only reader route). All swap derivation is in `swaps.ts` (pure, tested by
  `api/test/swaps.test.mjs`).
- **Upstream producers:** `buildSwaps()` ← `call1`/`call3`/`pkg` from the generation, plus
  `requirement` rows resolved by `seq`. **No user input reaches this table today** — that is the
  change being proposed, and it is why the tier is 1: it admits user (and, via `ai-edit`, model)
  output into a row the gate reads.
- **Downstream consumers — every one must be reconciled before "done":**
  1. `appChecks.ts:43` → `evaluateArtifact` → **gate + score**
  2. `checks.ts:906` `changes_cited` → **names offenders**
  3. `checks.ts:867` `compact_skills_fit` → **warn state + named dropped labels**
  4. `appPackets.ts:669` → `fitCompactSkills` → **`SkillsBullets` in the shipped compact resume**
  5. `appSwaps.ts:93` `swapsGet` → `{swaps, current, changed, unattributed}`
  6. `app/src/screens/AssetBlocks.jsx:66` (field margin), `AssetGateDrawer.jsx:402`, `QcRail.jsx:670`
  Consumers 1-4 are server-side and **none** of them currently distinguishes a generated label from
  an overridden one. Adding the column without teaching all four is how the mismatched-numbers
  failure in `CLAUDE.md` happens on a gate path.
- **Route surface:** `appSwaps.ts:8` — `'Access-Control-Allow-Methods': 'GET,OPTIONS'`, and
  `swapsGet` is the only handler. **There is no write route for swaps at all.** This gap needs one,
  and it must go through `requireWrite()` (per `api.js:178-184`, a mutation takes its owner from the
  verified session and must not carry `?owner=`).
- **EXTEND vs NEW:** **UNRESOLVED — and that is the deliverable here, not a recommendation.**
  Extending `swap_decision` collides with Finding 3-A. Extending `correction` collides with its
  `source` CHECK and its field/list mismatch. A new table is a third edit path. **Q3.2 must be
  answered before an AC set can be finalised.** The ACs below are therefore written as
  *store-agnostic invariants* — they hold whichever store wins.

### Acceptance criteria — Gap 3 (store-agnostic; all are blocked on Q3.1/Q3.2)

**AC-3.1 (an override survives a re-run of its own pass).** Given a swap row with an override, when
`writeSwaps` runs again for the **same** `(packet_id, loop)`, then the override is still readable
afterwards with the same value.
*Binary:* seed a row + override, call `writeSwaps` with identical args, `select` the override → equal.
*This is the AC that fails today's briefed design* (Finding 3-A). It is first because it is the one
most likely to be skipped and the only one whose failure is silent data loss.

**AC-3.2 (an override survives a NEW pass, or is explicitly invalidated — never silently).** Given
an override on loop N, when loop N+1 is written, then either the override is carried forward, or it
is recorded as superseded with the pass number that superseded it. It must never simply disappear.
*Binary:* after the N+1 write, the override is either present or present-and-marked-superseded;
"absent" fails.

**AC-3.3 (the gate reads the overridden value, and every consumer agrees).** Given an override
changing a label from `A` to `B`, when checks are re-run, then `changes_cited`'s offender strings,
`compact_skills_fit`'s dropped labels, `swapsGet`'s `current`, **and** the compact resume's rendered
`SkillsBullets` all show `B` — or **all four** show `A`. A split is a failure.
*Binary:* one fixture, four assertions, all equal.
*Why:* consumers 1-4 above are four re-derivations of one value. `CLAUDE.md`: counts across surfaces
"must reconcile because they read the same funnel".

**AC-3.4 (an override never manufactures a citation).** Given a row with `driver = 'unattributed'`,
when a user overrides its value, then `driver` remains `'unattributed'` and `verbatim_quote` remains
null, and `changes_cited` still counts it as uncited.
*Binary:* override an unattributed row; assert `changes_cited` count is unchanged.
*Why:* the schema check `check ((driver = 'posting') = (verbatim_quote is not null))` (`:556`) says a
citation needs a source. A user typing a better label does not make the employer have asked for it.
**An override that improves a gate is the single most dangerous outcome of this feature.**

**AC-3.5 (the overridden state is visible wherever the value is).** Given a row is overridden, when
any surface renders its label, then that surface states the value was set by the user.
*Binary:* the rendered output contains an override marker on all of: the field margin, the QC rail,
the gate drawer.
*Why:* `changes_cited` names offenders. A user-supplied string presented as a pipeline decision is a
fabricated provenance claim.

**AC-3.6 (`override_state` is an enumerated CHECK, and an empty override is not a state).** Given the
column exists, when a row is written, then `override_state` is constrained by a database `check (…
in (…))` exactly as every sibling state column is (`action`, `driver`, `origin`, `list` all are),
and `(override_value is null) = (override_state is null or override_state = 'none')` is enforced by
the database.
*Binary:* `insert` with a bogus state → rejected; `insert` with a value and no state → rejected.
*Why:* `artifact_gate` (`:635-636`) already encodes this pattern — "An override needs all three
parts or none: a reason with no actor is not an audit trail." Follow it, do not reinvent it.

**AC-3.7 (an empty override is not an empty document).** Given a user clears an override to `''`,
when the document renders, then the field does not silently ship blank; the clear is either refused
or reverts to the generated value.
*Binary:* set `override_value = ''`; assert rendered `SkillsBullets` is non-empty.
*Why:* `checks.ts:883-886` records a real defect of exactly this shape — a blank Core Skills line
that reported "0 of 320 chars" as a **green pass**.

**AC-3.8 (writes are session-authenticated).** Given the new write route, when it is called without
a verified session, then it is refused by `requireWrite()`, and the client helper sends **no**
`?owner=` parameter.
*Binary:* unauthenticated call → non-2xx; `grep` the new `api.js` helper for `?owner=` → absent.

**AC-3.9 (the migration executes on a POPULATED database).** Given the schema change, when it is
applied to a database seeded with `git show origin/main:api/src/functions/tests/schema.ts` **and
populated with real `packet` / `skill_candidate` / `swap_decision` rows**, then
`psql -v ON_ERROR_STOP=1` exits **0**, and any statement naming the new columns appears **after**
the idempotent `alter table … add column if not exists` that creates them.
*Binary:* exit code 0. *Why:* `H39`/`H39b`; a fresh database skips `create table if not exists`
entirely and proves nothing.

**AC-3.10 (no third edit path without sign-off).** Given this work lands, when the diff is reviewed,
then either it extends an existing store, or the PR body records the owner's explicit approval for a
new one, naming what exists and why it is insufficient.
*Binary:* the approval is quoted in the PR body, or the diff touches no new table.

### Guards and their mutation proofs — Gap 3

| Guard (H-case slug) | Asserts | **Exact mutation that must make the suite FAIL** |
|---|---|---|
| `H:swap-override-survives-rewrite` | AC-3.1 — `writeSwaps` re-run preserves an override | Restore `appSwaps.ts:45` to the unconditional `delete from swap_decision where packet_id=$1 and loop=$2` with no preserve/re-apply step. Suite must fail. **This is the most important mutation in this document** — it reinstates the exact live behaviour the feature must survive. |
| `H:override-never-cites` | AC-3.4 — an override cannot flip `driver` to `'posting'` or populate `verbatim_quote` | In the override writer, also set `driver='posting'` (and a quote, or the schema CHECK rejects the row first). Suite must fail on the `changes_cited` count assertion. **Note:** if the writer is mutated to set `driver` alone, the **database CHECK** at `schema.ts:556` rejects it — the suite fails at the DB, not the assertion. That is a pass for safety but does **not** prove the application-level guard; mutate the pair together and state which layer caught it. |
| `H:override-consumers-agree` | AC-3.3 — all four consumers read one value | Change **one** consumer (e.g. `checks.ts:868`'s `sw.to_label`) back to the generated column while the others read the override. Suite must fail. If it passes, the fixture has no overridden row and the guard is vacuous — say so and fix the fixture. |
| `H:override-state-enumerated` | AC-3.6 — the DB rejects an unlisted state and an unpaired value | Drop the `check (… in (…))` from the schema and re-run the populated migration + insert test. Suite must fail. |
| `H:override-marked-in-ui` | AC-3.5 — every surface marks an overridden value | Delete the override marker from **one** of the three surfaces. Suite must fail, naming that surface. |

**A mutation that will correctly FAIL TO FAIL, stated in advance:** renaming `override_state`'s
allowed values (e.g. `'user'` → `'manual'`) while updating the CHECK and every reader together is
behaviourally equivalent. No guard here will catch it and none should. Do not treat its passing as
evidence the guards are inert.

### Questions the owner must answer before Gap 3 is built

**Q3.1 (BLOCKING) — what happens to an override when the packet is regenerated?** `writeSwaps`
deletes and re-inserts the pass (`appSwaps.ts:45`). Three coherent answers exist and they produce
different schemas:
 (a) the override survives and is re-applied to the matching row after every write — needs a stable
 identity for "the same swap" across regenerations, which `(packet_id, list, seq, loop)` does **not**
 provide because `seq` is assigned by iteration order in `writeSwaps` (`:57`, `seq++`);
 (b) the override is invalidated by a regeneration and the user is told;
 (c) an overridden row is pinned and the pipeline may not overwrite it.
**I will not guess.** (a) is what "editable in place" implies to a user and is the most expensive.

**Q3.2 (BLOCKING) — extend `correction`, extend `swap_decision`, or a new store?** Per Finding 3-C
the app already has two in-place edit paths and `correction` already solves the durability problem
that defeats `swap_decision`. `CLAUDE.md` requires this to be answered *before* a new structure
exists, with what exists and why it is insufficient stated. *(Note this is the same unresolved
question `AC-resume-rows.md` §5 Q3 raised for ROW 10 — "extend `correction`, extend `swap_decision`,
or approve a new table?" It has been open across two AC passes. It is the gating decision for both.)*

**Q3.3 — may an override change the GATE?** Today `changes_cited` fails a packet on uncited changes.
If a user overrides a label, does the check re-run against their text (their typo becomes an
accusation) or against the generated label (the check describes text nobody will read)? AC-3.4 fixes
the *citation* half; the *evaluation* half is a product decision.

**Q3.4 — is `to_label` the only overridable field, or also `rationale` / `requirement_id`?** The
brief says "a swapped value". `swap_decision` has three user-meaningful text columns. Overriding
`requirement_id` would let a user assert a citation, which AC-3.4 forbids for `driver`; the same
reasoning should apply, and I would like that confirmed rather than assumed.

**Q3.5 — where does the user change this?** Per `CLAUDE.md`'s "No hardcoded config" rule the control
must be a real UI affordance, not a code-only capability. Which surface owns it — the field margin
(`AssetBlocks.jsx`), the QC rail's swaps tab, or the gate drawer? All three already fetch
`packetSwaps`.

---

# ADVERSARIAL SUMMARY

## 1. What the brief gets wrong

| # | Brief's claim | Ground truth on `origin/main` | Cost if believed |
|---|---|---|---|
| 1 | Gap 1: "**NO Undo control**" in the field margin | `CorrectionRow` is rendered **in the margin** (`AssetBlocks.jsx:645`, `inField`) with the `Undo` button (`QcRail.jsx:582-585`) wired to `api.revertCorrection` | A **second** change-log renderer is built beside a working one — the identical ROW-6 failure `AC-resume-rows.md` documents, in the same file |
| 2 | Gap 1: undo "consumed **ONLY** on the QC rail" | `AssetBlocks.jsx:42` imports `CorrectionRow` **from** `QcRail.jsx`. One definition, two mounts | Same as above |
| 3 | Gap 1: the client helper is `revertOne` at `api.js:194` | It is `revertCorrection` at `api.js:204`. `revertOne` is the **server** handler, named only in comments | Likely the root cause of #1-#2: the wrong symbol was searched for |
| 4 | Gap 1: "renders 'Why it changed' (rationales)" as the change log | `:738-745` renders **swap** rationales from `swapsForList` — a different feature from corrections | Conflates two margin blocks; work is scoped against the wrong one |
| 5 | Gap 1: "zero hits for line-through" | `AssetBlocks.jsx:381` has `<s>{s.from_label}</s>` | Evidence was wrong; the **conclusion** happened to survive (that `<s>` is in dropped-swaps, not corrections) |
| 6 | Gap 3: "`app/src/functions/tests/` swap_decision schema" | The path is `api/src/functions/tests/schema.ts` | Minor |

**Gap 2 is the only one of the three whose diagnosis holds as written.**

## 2. Verdicts, tiers, and what is actually buildable

| Gap | Verdict | Tier | Buildable now? |
|---|---|---|---|
| **1** — `Changes made` | **~90% ALREADY BUILT.** Real remainder: the **struck** original→new rendering. Plus two copy divergences (`Corrected for you` vs SPEC's `Changes made`; `Change it` vs `Suggest something different`) | **3** (copy) / **2** (struck render) | **Yes** for the struck render. Copy is blocked on Q1.1/Q1.2 — there are **three** competing strings for one heading and SPEC contradicts a code comment |
| **2** — hover linkage | **REAL GAP, confirmed** (no `onMouseEnter`/`hover` in the file, no `is-on` token in `theme.css`) | **2** | **Yes — margin→text only**, scoped to `posting_wording_kept`, which is the only margin block whose phrases are marked in the body. "Vice versa" is blocked on Q2.1 — **the prototype does not implement it either** |
| **3** — `override_value` | **REAL GAP** (columns absent) **but must not be built as briefed** — `writeSwaps` would delete the override, and `to_label` feeds the gate, the score, an offender list and the shipped document | **1 — accusation grade** | **NO. Blocked on Q3.1 and Q3.2**, both architectural |

## 3. Recommended sequence

1. **Gap 2 (margin→text), scoped to `posting_wording_kept`.** Highest value, tier 2, no owner
   decision needed for the half that has a reference implementation. Its one real dependency is the
   D28 contrast registry (`run-contrast.mjs:94-95`), which the brief did not name.
2. **Gap 1's struck rendering**, once Q1.1/Q1.2 settle the copy — small, and it is one change in
   `correctionSentence()` that lands on both surfaces at once.
3. **Gap 3 — do not start.** Take Q3.1 and Q3.2 to the owner first. Q3.2 is the *same* question
   `AC-resume-rows.md` §5 Q3 has had open since the previous pass.

**Stated plainly:** the brief describes three gaps of roughly equal size. Measured against `main`,
one is nearly finished, one is real and half-scoped, and one is a tier-1 schema change with a
data-loss defect in its premise and an unanswered architecture question underneath it.

## 4. Cross-cutting — applies to all three

- **AC-X.1 (mutation-prove every new guard).** `CLAUDE.md`: "THE ONE STEP THAT IS NEVER SKIPPED, AT
  ANY TIER." Each guard above names its exact mutation. Where a mutation is behaviourally equivalent
  and correctly fails to fail, **say so** — do not claim the assertion is proven.
- **AC-X.2 (H-case slugs, never numbers).** Every guard above uses a two-word-plus slug. `H26` fails
  the suite on a new numeric ID.
- **AC-X.3 (absent evidence is `not_applicable`).** AC-2.4, AC-2.7, AC-3.2 are the instances.
  A check that passed because there was nothing to check is not a pass.
- **AC-X.4 (no dead UI).** Every control specified is wired to a real route or a real store. Gap 3's
  control must not be built before Q3.1/Q3.2 — an override input with no durable store is precisely
  the "control that forgets" `AssetBlocks.jsx:690-692` records being deliberately **not** shipped for
  the prototype's `Reword it` toggle.
- **AC-X.5 (JSX build hygiene).** After every `.jsx` edit: the smart-quote `sed` sweep, then the
  **Python** codepoint scan, then `cd app && npm run build` exits 0 **after** the sweep. Do not add a
  repo-wide smart-quote linter — one was written and deleted the same night for 8 false positives.
- **AC-X.6 (nothing depends on the term library).** `D:term-library-off-by-owner-decision`. No AC
  above requires a published `term_library_entry` row; AC-2.9 guards it explicitly.
- **AC-X.7 (Prompts table untouched).** No AC above proposes any edit to the Prompts table, per the
  standing owner directive.
- **AC-X.8 (branch + deploy discipline).** Develop on `claude/<feature>`, fast-forward onto `main`,
  verify with `./scripts/wait-run.sh sha:<workflow>:$(git rev-parse HEAD)` **backgrounded**, never
  `latest:`.

---

*Analysis only. Nothing under `app/src` or `api/src` was modified; nothing was committed. Every
verdict is sourced from `git show origin/main:<path>` at `b319943`.*
