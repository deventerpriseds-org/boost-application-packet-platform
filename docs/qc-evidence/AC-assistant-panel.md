# AC — SPEC §4.11 Assistant Panel

**Author:** independent AC subagent (adversarial). **Date:** 2026-08-27.
**Repo:** `/home/user/boost-application-packet-platform` @ `e6e5a6a`.

**Source precedence (from `docs/qc-evidence/IMPORT-NOTE.md`), highest first:**
1. `docs/qc-evidence/Evidence Model & QC Lineage.html`
2. `docs/qc-evidence/SPEC.md` §4.11 + §5 (data contracts)
3. `docs/qc-evidence/qc/assist.jsx` (prototype, 123 lines)
4. `docs/qc-evidence/screens/44-assistant-panel.png` (render — never a source of intent)

Where sources disagree the higher one wins and the disagreement is stated explicitly.

**Owner decisions treated as CLOSED (not re-asked):**
- Scope `My profile` is **read-only / warn-only** (option (c)). No `owner_fact` write, no `MasterContext` write.
- The panel edits through the **existing `api.aiEditArtifact` only** — `H:one-edit-path` (`app/test/packetBuilder.test.mjs:167`) must keep passing.

_This file is written incrementally as the analysis proceeds; sections appear in the order they were completed._

---

## §0. STOP FIRST — the brief's premise collides with a decision recorded TODAY

The brief says *"do not re-ask, and check `.claude/DEFERRED.md` before claiming any decision is
open."* I checked. It cuts the other way:

```
$ grep -n -i "4\.11\|assistant" .claude/DEFERRED.md
195:| D:assistant-panel-owner-trialling | OPEN | **RE-CONFIRMED 2026-08-27 after the trial period:
    the panel waits until every other packet-UI piece is done.** Owner ...: *"hold off on the panel
    until all other UI pieces are done. I can build a packet without it."* **STILL NOT RATIFIED AS
    REPLACED, and the eight rows STAY IN THE DENOMINATOR** ...
```

**Observation.** `D:assistant-panel-owner-trialling` is `OPEN`, and its most recent entry is dated
**2026-08-27 — today**. The owner's words are *"hold off on the panel until all other UI pieces are
done."* The register also records the decider as the owner and the trigger as *"Re-raise only when
the rest of the packet UI is closed."*

**Interpretation.** This is a **sequencing hold, not a scope decision.** It does not say the panel is
unwanted (the register is emphatic that recording it as replaced would flatter coverage ~4 points on
a call nobody made). So an AC pass is not wasted work — but **implementation must not start on the
strength of this brief alone.** The two owner decisions the brief hands me (read-only `My profile`,
`aiEditArtifact`-only) are *narrowing* answers about what the panel would be **if** built; they are
not the go-ahead, and DEFERRED.md line 195 is newer than both.

**What I am doing about it.** Writing the full adversarial AC pass, because that is what was asked
and because it is the artefact needed the moment the hold lifts — and stating plainly at the top and
the bottom that **AC-0 is a gate: the hold must be lifted by the owner before AC-1 is started.** I am
not re-asking the two closed questions. I am flagging that a third question — *may we start at all* —
was answered "not yet" today.

---

## §1. FEASIBILITY TABLE (required first) — one row per element §4.11 names

Row ids are `PROTOTYPE-COVERAGE.md:493-501`'s (4.11-1 … 4.11-9), so this table reconciles against the
coverage doc rather than inventing a second numbering.

| # | Element (§4.11) | Producer (who writes it) | Consumer today | Proof (command → result) | Verdict |
|---|---|---|---|---|---|
| **4.11-1** | Docked right column ≥ 1440px | *nothing* | *nothing* | `grep -rn "1440" app/src/` → **1 hit, and it is a comment**: `postingAnalysis.js:627` *"the right column is the assistant, docked >= 1440px only"*. No component, no constant. | **ABSENT** — and see §2.4, the shell may not have the width |
| **4.11-2** | Collapses to a card with `Open assistant` | *nothing* | *nothing* | `grep -rn "Open assistant" app/src/` → 0 hits | **ABSENT** |
| **4.11-3** | Floating panel below 1440px | *nothing* | *nothing* | same as 4.11-1 | **ABSENT** |
| **4.11-4** | Scope selector (This packet / This asset / My profile) | *nothing* | *nothing* | `grep -rn "This packet\|My profile" app/src/` → 0 hits | **ABSENT** (and see §2.5 — two of the three scopes have no route) |
| **4.11-5** | 5 quick actions | `assetBlocks.js` | `AssetBlocks.jsx` | `keywordActions` (`assetBlocks.js:452`) emits a `Drop "<kw>"…` sentence; `seedAskReword` (`AssetBlocks.jsx:559`) emits a reword sentence; `keywordSwapOptions` (`assetBlocks.js:485`) emits a swap sentence | **EXISTS-BUT-CONSTRAINED** — 3 of 5 exist as *scoped in-place* sentence-seeders, not panel chips. §2.6 |
| **4.11-6** | Replies list the exact merge fields they would touch | `artifactAiEdit` | `AssetBlocks.jsx:722` (ignores the body) | `sed -n '1396,1455p' api/.../appPackets.ts` → returns `{ ok, revised, section, effort, model }`. `section` is the **request input echoed back**, and the handler writes **exactly one** key: `pkg[section]`, or `artifact.content` when absent | **ABSENT — and not buildable as rendered.** §2.3 |
| **4.11-7** | Keep / Revert / Re-run QC on a reply | — | — | `grep "app.http(" api/src/functions/tests/*.ts \| grep -i revert` → **only** `correctionRevert` (`app/correction/{id}/revert`) + `taxonomyRevert`. `appSwaps.ts:132` exposes **`swapsGet` only** — a GET. | **Re-run QC = ALREADY BUILT** (`runChecks`, `AssetGateDrawer.jsx:471`). **Revert = ABSENT, no target at all.** **Keep = vacuous.** §2.1 |
| **4.11-8** | Caveat when the next run will revert the change (omission list) | `swaps.ts:234` | `AssetBlocks.jsx:577` | `swaps.ts:234` writes `rationale: 'on the owner do-not-use list (MasterContext.itemsToOmit)'` on `action:'dropped'`, `driver:'rule'`; `appSwaps.ts` `select s.*` ships it; `AssetBlocks.jsx:577` **already renders it**; `checks.ts:399` emits an `omission_list` check with offenders; `assetGate.js:185` labels it | **EXISTS-BUT-CONSTRAINED — the only §4.11 row whose data is genuinely live.** §2.2 |
| **4.11-9** | *"Every field-level action in the UI seeds this panel"* | `seedAsk` (`AssetBlocks.jsx:555`) | the **field's own ask box**, not a panel | `grep -rn "seedAsk" app/src/` → 1 definition, 2 seeder helpers, 4 call sites — **all** open `askOpen` on the same field | **EXISTS-BUT-CONSTRAINED** — the seeding primitive is built and has the right shape; its **destination** is the field box, not a panel. §2.7 |
| *(support)* | A viewport-width hook to key 1/2/3 off | `useViewportWidth` (`PostingAnalysis.jsx:44`) + `keywordColumns` (`postingAnalysis.js:630`) + `mobile` (`state.jsx:36`) | keyword list 2-up/1-up | read the files | **ALREADY BUILT — reuse, do not add a new breakpoint mechanism.** §2.4 |
| *(support)* | An edit route | `artifactAiEdit` (`appPackets.ts:1400`) | 4 call sites app-wide | see 4.11-6 | **ALREADY BUILT** |
| *(support)* | `My profile` write path | — | — | SPEC §5 lists 9 record shapes; **none is a profile record.** `evidence.ts:221` `NEVER_EVIDENCE = new Set(['itemsToOmit'])`; `pipeline.ts:85` excludes `itemsToOmit` from `profileText` | **ABSENT — and owner-confirmed out of scope (read-only).** §2.5 |

**Headline: of the 9 rows, 0 are built, 1 (`Re-run QC`, half of 4.11-7) is already built elsewhere,
3 are constrained-but-real, and 2 — `Revert` (4.11-7) and 4.11-6 — are NOT BUILDABLE on today's
data and must not be rendered.**

---

## §2. THE HUNTS — what the brief asked me to go after

### §2.1 `Keep` / `Revert` / `Re-run QC` (4.11-7): two of the three have no target

`qc/assist.jsx:95-97` renders all three with **no `onClick`**. That is not a prototype shortcut to be
filled in — for two of them there is nothing to fill it in with.

| Button | Is there anything to call? | Evidence |
|---|---|---|
| **Re-run QC** | **YES — already built.** | `runChecks` — `AssetGateDrawer.jsx:471`, mounted at `:533` on `data-qc={GATE_HOOKS.runChecks}` |
| **Revert** | **NO. No route exists, for either meaning.** | `grep "app.http(" api/src/functions/tests/*.ts \| grep -iE "revert\|undo\|swap"` → `correctionRevert` (`app/correction/{correctionId}/revert`), `taxonomyRevert`, and `swapsGet`. **`appSwaps.ts:132` registers exactly one route and it is a GET.** |
| **Keep** | **Vacuous — there is nothing to keep.** | `artifactAiEdit` **writes before it replies**: `update packet set pkg_json = $1 …` runs *then* the 200 returns (`appPackets.ts:1446-1451`) |

**The brief's suspicion is confirmed, and it is worse than "only correction-revert exists".**
`correctionRevert` cannot serve an assistant reply even in principle, and the reason is structural,
not missing plumbing:

- It is keyed by a **`correctionId`** and reverts a `correction` row — a char-offset-anchored
  auto-correction. It replays `revertOne(current, applied, target.applied_seq)` against **every
  sibling correction on that field**, because *"the offsets are original-relative and only the full
  list can reconstruct the original text"* (`appCorrections.ts`, in-file comment).
- `artifactAiEdit` **creates no `correction` row and stores no before-image.** It overwrites
  `pkg[section]` wholesale with model prose. There is no `char_start`, no `before_sha256`, no
  `applied_seq` — so there is nothing `revertOne` could anchor to even if a route were pointed at it.
- The app already **says so to the user**: the ask box's own warning is
  *"This rewrites **{merge_field}** only. **Anything auto-corrected in it can no longer be undone.**"*
  (`AssetBlocks.jsx:709`). An assistant reply offering `Revert` would contradict a warning the same
  codebase prints one component away.

**Verdict: rendering `Revert` is exactly the dead UI the standing rule forbids** (*"Never ship a
`onClick={() => toast('...')}` stub as a real button… If a feature isn't ready, hide the control"*).
`Keep` is worse than dead — it is **misleading**, because it implies the change was pending approval
when it was committed to `pkg_json` before the reply was rendered. Both must be omitted, or the flow
must first become propose-then-apply (see AC-13, a real but separate build).

### §2.2 The caveat (4.11-8) — hardcoded in the prototype, derivable in the app, and it is the one good row

**The sources disagree and the higher one wins.** `qc/assist.jsx:19` carries `note:` as a **hardcoded
string** on a fixture message. SPEC §4.11 says *"**a** caveat **when** a change will be reverted by
the next run (omission list)"* — conditional, therefore derived. **SPEC outranks the prototype on
intent** (the prototype outranks it only on *what a screen shows*, per `IMPORT-NOTE.md`). So: derived.
**Say so explicitly — an implementer copying `m.note` would ship a lie that renders on every reply.**

Where `itemsToOmit` lives, and who reads it — the full producer→consumer trace:

| Hop | Location | What it does |
|---|---|---|
| Origin | `MasterContext.itemsToOmit` (Azure Storage **Table**, not Postgres) | the owner's do-not-use list |
| Merge-field map | `zapVars.ts:47` | `'289877659__Items to Omit': val('itemsToOmit')` |
| Into the pipeline | `pipeline.ts:95` | `omitList: String(mc?.itemsToOmit \|\| '')` |
| **Excluded from evidence** | `pipeline.ts:85`, `evidence.ts:131`, `evidence.ts:221` `NEVER_EVIDENCE = new Set(['itemsToOmit'])` | it is what the owner **banned**, never something they can be evidenced as having done |
| Consumed — swaps | `swaps.ts:145` (`omitList?`), `swaps.ts:234` | emits `action:'dropped'`, `driver:'rule'`, `rationale: 'on the owner do-not-use list (MasterContext.itemsToOmit)'` |
| Consumed — checks | `checks.ts:396-402` | `omission_list` check; `bad(...)` carries **`offenders`** = `hits.map(x => \`${x.f}: ${x.i}\`)`; `na(...)` when no list is configured |
| To the client | `appSwaps.ts` `select s.*` | `rationale` + `driver` ship |
| **Rendered today** | `AssetBlocks.jsx:577`, `:1017-1020`; `QcRail.jsx:346`; `AssetGateDrawer.jsx:300`; label `assetGate.js:185` | already on screen |

**Conclusion: 4.11-8 is the only §4.11 row whose data is live end-to-end, read-only, and already
reaching the browser.** The raw `itemsToOmit` string is *never* sent to the client — and must not be,
per `NEVER_EVIDENCE` — but the **closed set of labels this packet's run actually dropped for being on
it** is present in `swaps[]`. That is a sound, honest, non-fabricating predicate.

**Adversarial limit an AC must state:** matching a restore request against that set answers *"the last
run dropped this label for being on your list"* — **not** *"the next run will drop it"*. Those are
different sentences and the second is a prediction. The copy must be the first. `swaps.ts` uses
`onOmitList()`, a fuzzy matcher, and CLAUDE.md's standing rule is **fuzzy matching is for RANKING,
never for ACCUSING** — a caveat that names an offender is accusation-grade, so the client-side match
must be **exact, whole-phrase**, against `from_label` values already recorded, never a re-implemented
similarity score. See AC-9/AC-10.

**Independent of the panel:** `AC-packet-ui-final.md:681` already flags 4.11-8 as *"a real user-facing
gap regardless of the panel"*. I agree, and it is the one piece of §4.11 I would build even under the
hold — as a margin note in the existing change log, needing no panel at all. See AC-11.

### §2.3 4.11-6 "replies list the exact merge fields they would touch" — NOT BUILDABLE, and doubly so

I read the handler rather than inferring from the client (`appPackets.ts:1400-1452`). Two independent
blockers, either one fatal:

1. **`section` is an input, not a discovery.** The reply is
   `{ ok: true, revised, section, effort, model }` — `section` is the value the *caller* sent, echoed.
   The route never determines which field a request "would touch"; it is **told**, and it obeys.
2. **The route can only ever write ONE field**, and only the one named:
   `const merged = { ...pkg, [section]: revised }`, else `update artifact set content = $1`.
   **The prototype's own example reply changes TWO fields** — `SkillsBullets2: Kubernetes → M&A Due
   Diligence` *and* `RelevantBullets2: Corporate AI Use Cases → Kubernetes` (`assist.jsx:20-22`).
   A single `aiEditArtifact` call **cannot produce that reply**, and the owner's decision that the
   panel uses `aiEditArtifact` **only** forecloses the multi-call orchestration that could.
3. There is also **no item-level diff**. `revised` is the whole new section text. A `from → to` at the
   *bullet* level, as the prototype renders, would have to be re-derived in the browser by diffing
   old against new — inventing a mapping the server never asserted. That is *"never fabricate a
   composite"*.

**Honest scope for 4.11-6, and it is the most this row can be:** the panel may state, **before
sending**, the *one* field the request is scoped to — because the client chose it. It must not claim
to predict, and must not render an item-level `from → to`. **What would make the full row honest:**
`artifactAiEdit` returning a server-computed `changed: [{ field, before, after }]` (trivially
available — it holds `currentText` and `revised` at line ~1424) plus a propose-then-apply mode. That
is an **API change**, therefore Tier 1 work outside this AC pass, and it is the same prerequisite
`Keep`/`Revert` need. Recorded as AC-13, deliberately not written as buildable today.

### §2.4 The 1440px dock breakpoint — reuse the existing mechanism, and the dock does not fit

**(a) There IS an existing breakpoint mechanism. Do not add a new one.**

| Reusable | Where | Why it is the right one |
|---|---|---|
| `useViewportWidth()` | `PostingAnalysis.jsx:44-56` | already the app's viewport hook |
| `keywordColumns(width)` / `KEYWORD_2UP_MIN` | `postingAnalysis.js:618-633` | the app's **pattern** for a viewport rule: the number lives in a `node --test`-loadable module, **not** a CSS media query, for two stated reasons — *"one source"*, and *"it is assertable"* via `data-qc-cols`, because `ui-verify.yml` *"can set a viewport width but can only SELECT, never read a computed style"* |
| `mobile` | `state.jsx:36-38` | app-wide `matchMedia` flag — **wrong tool here**: it is a max-width mobile flag, not a ≥1440 dock rule |

`postingAnalysis.js:627` **already names this exact feature** as the sibling of the rule it
implements: *"matching the sibling rule in the same backlog item (**"the right column is the
assistant, docked >= 1440px only"**), which is a viewport rule too."* So the mechanism was written
with 4.11-1 in mind. **A new media query or a new hook would be the duplication the standing rule
forbids** — and would be invisible to `ui-verify.yml`, so the breakpoint could never be verified.

**(b) The dock does not fit in this app's shell — and this is arithmetic, not opinion.**

| | Prototype | This app |
|---|---|---|
| Shell content cap | `qc/shell.jsx:96` → **`maxWidth: 1560`** | `app/src/shell.jsx:463` → **`maxWidth: 1280`** |
| Nav | `qc/shell.jsx:75` → 196 | `app/src/shell.jsx:399` → 196 (52 collapsed) |
| Scroll-pane padding | — | `app/src/shell.jsx:462` → 24 each side |
| Step rail | 220 | 220 (`PacketBuilder.jsx:1182`) |
| Docked assistant | `packet.jsx:541` → **340 open / 280 collapsed** | — |

At a 1440 viewport in **this** app: `1440 − 196 − 48 = 1196` content pane; today the centre is
`1196 − 220 − 16 = **960px**`. Add the prototype's dock: `1196 − 220 − 16 − 340 − 16 = **604px**` open,
`**664px**` collapsed.

**664 is not a coincidence.** It is the exact number in the app's own two comments —
`PacketBuilder.jsx:1180` *"(1280 shell cap − 196 nav leaves ~664px at 1440)"* and `PostingAnalysis.jsx:8`
*"leaving ~664px at 1440, and **P5.2's asset blocks need ~850px**"* — describing the **280px right
column decision D4 deleted**. `1196 − 220 − 16 − 280 − 16 = 664`. ✔

> **Observation.** The prototype's collapsed assistant card is **280px** — byte-for-byte the width of
> the right column this app removed. **Interpretation (high confidence, arithmetic-backed):** docking
> the assistant re-creates precisely the layout D4 was taken to escape, and opening it (604px) is
> *worse* than the state that was rejected.

Worse: **inside the 1280 cap the dock never fits at any viewport width.** The cap binds above
~1524px, so the best case is `1280 − 220 − 16 − 340 − 16 = **688px** < 850px`. **4.11-1 is not a
"≥1440" problem; it is unbuildable without either raising the shell cap (blast radius: every screen)
or shrinking the dock below what `assist.jsx` needs.**

**Two stale comments, and an AC must not trust either.** `PacketBuilder.jsx:1180` and
`PostingAnalysis.jsx:8` both still say the centre is ~664px at 1440. Post-D4 the literal widths give
**960px**. The comments describe the *pre-D4* layout. **Any AC about width must assert a MEASURED
width via `ui-verify.yml`, never a number read out of a comment.** (I nearly propagated 664 myself.)

### §2.5 The scope selector (4.11-4) — one of three scopes has a route

| Scope | Route | Verdict |
|---|---|---|
| **This asset** | `aiEditArtifact(id, { instruction })` — no section; writes `artifact.content` (`PacketBuilder.jsx:371`) | **EXISTS** |
| **This packet** | none. `artifactAiEdit` takes ONE `artifactId` | **ABSENT** — a packet-wide scope is N calls, i.e. a second edit path, which the owner's `aiEditArtifact`-only decision forbids |
| **My profile** | none, **and owner-closed as read-only** | **ABSENT by decision** |

The `My profile` read-only ruling is corroborated by all three sources the brief names, and I confirm
each: prototype `const [scope, setScope] = React.useState('This packet')` — `scope` is **written by
the chips and read by nothing but its own highlight** (`assist.jsx:26`, `:73-76`); SPEC §5 lists nine
record shapes and **none is a profile record**; the lineage doc puts profile editing in Settings.
`ProfileLink` → `#/settings/facts` (`PostingAnalysis.jsx:60`) is where it goes.

**Adversarial point the brief did not raise.** `AC-packet-ui-final.md:658` argues a scope selector
*"makes a promise about blast radius that `artifactAiEdit` (which takes one `section`) does not
keep."* **That is correct and it applies to `This packet` too, not only `My profile`.** A selector
offering three scopes where one works is dead UI in a costlier form than a dead button: it changes
what the user believes they asked for. **Either ship the selector with `This packet` and
`My profile` visibly disabled-with-reason (AC-6), or do not ship the selector.** Do not ship three
live-looking chips over one route.

### §2.6 Do the five quick actions duplicate seeds that already exist? — three of five, yes

| Prototype quick action (`assist.jsx:4-10`) | Already in the app? | Evidence |
|---|---|---|
| `Undo a swap` → `'Undo the swap of '` | **as a real control, not a sentence** | `CorrectionRow` undo, `QcRail.jsx:578`, backed by `correctionRevert` |
| `Say why` → `'Why did you change '` | **yes, as a seeded sentence** | `seedAskReword` (`AssetBlocks.jsx:559`); margin already renders the reason (`:577`, `:1017`) |
| `Keyword is wrong` → `'This keyword does not apply to me: '` | **yes, as a seeded sentence** | `keywordActions` (`assetBlocks.js:452`) → `Drop "<kw>" from this field. Rewrite the text without it rather than swapping in a synonym.` |
| `Put back an original` → `'Put back the original wording in '` | **NO control anywhere** | — |
| `Shorten to fit` → `'Shorten this to fit its word rule: '` | **NO control anywhere** | — |

**All five are literally sentence templates** — `assist.jsx:4-10` contains nothing but `{ l, t }` label/text
pairs. `setText(q.t)` is the whole behaviour. **This is the same primitive the app already has**
(`seedAsk` sets text + opens the box), so panel chips would be a **second copy of a seeding vocabulary
that already has one home.** Under *"extend, don't duplicate"* the sentences must come from one
exported table consumed by both surfaces, never re-typed into the panel (AC-7).

**And note what the two missing ones reveal.** `Put back an original` and `Shorten to fit` are the only
two with **no scoped in-place control** — because they are the only two that are *not* naturally
field-scoped. That is the honest argument that something cross-field is missing, and it is a much
narrower gap than "build the panel": **two seeder controls, in the field margin, next to the three
that already exist** (AC-12). `Shorten to fit` in particular has its rule already computed and on
screen — `observedFor` / `targetFor` (`AssetBlocks.jsx:563-566`) render `56 words · 55–60 words`, so
the sentence can be seeded with the real numbers instead of the prototype's bare colon.

### §2.7 THE GOVERNING SENTENCE — seeders vs. destination. **Answer: SEED (option 3), with a caveat.**

*"Every field-level action in the UI seeds this panel."*

**Verified against the prototype's mechanics, as instructed.** `Assist` takes `seed` / `setSeed`, and
`assist.jsx:28` is:

```js
React.useEffect(() => { if (seed) { setText(seed); setOpen(true); setSeed(''); } }, [seed]);
```

Three moves: **set the text, open the surface, clear the seed so it cannot re-fire.** Now the app's
primitive, `AssetBlocks.jsx:555-559`:

```js
const seedAsk = (sentence) => { setAsk(sentence); setAskOpen(true) }
const seedAskReword = (phrase) => seedAsk(`Reword "${phrase}" so it does not repeat the posting's wording.`)
```

**Set the text, open the surface.** *(No clear-the-seed step — because the app passes the sentence as
an argument rather than through a lifted state slot, so there is no stale seed to clear. Same
contract, one hop shorter.)*

> **These are the same primitive with different destinations.** The prototype lifts `seed` to
> `packet.jsx` and the destination is the panel; the app keeps it local and the destination is the
> field's own ask box. **The brief's reading is correct: the per-field boxes are SEEDERS.** The panel
> is a *destination* they do not currently have — the app substituted a different destination.

**So: REMAIN, REPLACE, or SEED?** **SEED — and the per-field boxes must REMAIN.** Not a compromise;
each half is forced by different evidence:

*Why the boxes must remain (against REPLACE):*
1. **The field box is the only surface that can make the scope promise true.** It says *"This rewrites
   **{merge_field}** only"* and passes `section: row.merge_field`. A panel cannot say that without the
   field context, which is precisely what §2.5 shows the scope selector fails to supply.
2. **Ground rule R6** — *"Ad-hoc correction over batch approval. The user should be able to change
   anything they happen to notice, **in place, scoped to the field they are looking at**"* (SPEC §2).
   **R6 constrains every screen and it names in-place scoping as the decision.** Removing the in-place
   box to force requests through a panel would violate a ground rule to satisfy a screen description.
3. **The owner has used it** (per the brief) and DEFERRED.md records *"I can build a packet without
   it"* — i.e. the shipped path works.
4. **SPEC §4.7 independently requires it**: *"Opens under the field… `Scoped to this field only.`,
   Cancel and Send. On send it confirms in place **and forwards to the assistant**."* §4.7 keeps the
   inline box in the same document that describes the panel. **The two are specced to coexist.**

*Why "seed" and not "coexist independently":* §4.7's *"forwards to the assistant"* is row **4.7-8**,
and it is unbuilt for the same reason everything else here is — no destination. That is the one line
that makes §4.11 and §4.7 one feature rather than two.

**The unavoidable structural cost, and it is the thing to weigh.** Today `seedAsk` is **component-local
state inside one field block**. To seed a panel it must be **lifted** to `PacketBuilder.jsx` — every
field-level action becomes a call into a shared slot. **That is the real cost of §4.11: not the panel,
the lift.** And it is where `H:one-edit-path` bites (§3).

---

## §3. `H:one-edit-path` — what it actually asserts, and how the panel satisfies it

The brief says the ACs *"must not break it, and must say how the panel satisfies it."* First, what it
asserts — because the obvious reading is wrong.

```
app/test/packetBuilder.test.mjs:167  H:one-edit-path
  assert.match(src, /api\.aiEditArtifact\(a\.id, \{ instruction: assetAsk\.trim\(\) \}\)/)
  assert.equal((src.match(/api\.aiEditArtifact\(/g) || []).length, 1, 'exactly one edit call in this screen')
  assert.ok(!/section:/.test(src.slice(i, i + 120)), 'the whole-asset edit must NOT pass a section')
```

`src` is `PacketBuilder.jsx` alone. Two sibling guards do the same for `AssetBlocks.jsx`
(`qcRail.test.mjs:909` `H:wording-ask-reuses-the-field-edit-path`; `proposedKeywords.test.mjs:222`).

> **Observation.** The invariant is **"exactly one edit call PER SCREEN FILE"**, not "one call site in
> the app." App-wide there are already **four**: `AssetBlocks.jsx:722` (with `section`),
> `QcRail.jsx:530` (with `section`), `PacketBuilder.jsx:371` (no section), `OppDetail.jsx:459`
> (with `section`) — plus the definition at `api.js:217`.
> **Interpretation.** The guard protects *"one route, two scopes"*, i.e. no screen may grow a
> **parallel** way to change text. It does **not** forbid a new file from calling the same route.
> **Do not "satisfy" it by claiming the app has one call site — that claim is false and an
> implementer repeating it would be caught by `grep -rn aiEditArtifact app/src/`.**

Baseline confirmed green before any change:

```
$ cd app && node --test test/packetBuilder.test.mjs
# tests 13  # pass 13  # fail 0
```

**How the panel satisfies it — three constraints, all testable:**

1. **The panel lives in its own file** (`app/src/screens/AssistantPanel.jsx`) and is *mounted* in
   `PacketBuilder.jsx`. Mounting adds no `api.aiEditArtifact(` token to `PacketBuilder.jsx`, so the
   count stays 1 and the existing `assetAsk` call and its no-`section` assertion are untouched.
2. **The panel makes at most ONE `aiEditArtifact` call, and passes `section` from the seed** — never
   an unsectioned call (that is `PacketBuilder.jsx`'s whole-asset scope, and duplicating it in a
   second file is exactly the parallel path the guard exists to stop). A new guard
   `H:assistant-panel-single-edit-call` must assert count `=== 1` in `AssistantPanel.jsx`, matching
   the three siblings' shape.
3. **Better still — and this is the design I would push:** the panel makes **no** call at all in the
   seed case. `seedAsk` is lifted so the panel *composes* a sentence and hands it back to the field
   block that owns the section, which sends through its existing call site. Then the panel is a
   composer, the guard set is unchanged, and the count in every file stays as it is today.
   **Constraint 3 is incompatible with the floating variant** (4.11-3), where the field block may be
   scrolled out of the tree — so choosing 2 vs 3 is a real fork, not a style preference. AC-8 pins it.

**A guard that must be ADDED, not merely not-broken.** Nothing today asserts the panel does not grow
a *second* mechanism. Per CLAUDE.md, a new guard must be **mutation-proven**: write it, restore the
defect (add a second `aiEditArtifact` call to `AssistantPanel.jsx`), confirm the suite **fails**,
revert.

---

## §4. ACCEPTANCE CRITERIA

Each is binary and observable. Tag = the `PROTOTYPE-COVERAGE.md` row it discharges. `ui-verify.yml`
is the only tool in this environment that can see a rendered width, so every viewport AC names a
`data-qc` hook it can `SELECT` — per `postingAnalysis.js:622-626`, it *"can set a viewport width but
can only SELECT, never read a computed style."*

### Group A — the gate (blocks everything below)

**AC-0** · *(process, not a feature)*
> **Given** `.claude/DEFERRED.md:195` records `D:assistant-panel-owner-trialling` as `OPEN`,
> re-confirmed **2026-08-27** with the owner's *"hold off on the panel until all other UI pieces are
> done"*, **when** any AC below is picked up for implementation, **then** the register shows that row
> moved out of `OPEN` by the **owner** (not by an implementing agent), naming which of options A/B/C
> was chosen — **or** no `app/src` file is modified.
>
> *Binary: `grep -n "D:assistant-panel-owner-trialling" .claude/DEFERRED.md` shows a state other than
> `OPEN`. Failing that, the correct outcome of this AC pass is **AC-11 only** (§2.2), which needs no panel.*

### Group B — where it lives (4.11-1, 4.11-2, 4.11-3)

**AC-1** · `4.11-1` · **MEASUREMENT GATE — run before writing dock code**
> **Given** the app shell caps content at `maxWidth: 1280` (`shell.jsx:463`) against the prototype's
> `1560` (`qc/shell.jsx:96`), and `PostingAnalysis.jsx:8` records that *"P5.2's asset blocks need
> ~850px"*, **when** `ui-verify.yml` renders `#/packet/<id>` at viewport **1440** and again at **1920**
> with a `340px` docked column present, **then** the measured centre-column width is **≥ 850px at both**.
>
> *Predicted result: **FAIL**. `1280 − 220 − 16 − 340 − 16 = 688px`, and the cap binds above ~1524px,
> so no viewport makes it pass. **If it fails, AC-2 is struck** and 4.11-1 is recorded NOT-BUILDABLE
> WITHOUT A SHELL CHANGE — raising the 1280 cap is a separate, every-screen change requiring its own
> AC pass and owner sign-off. Do not silently shrink the dock to make this pass: a dock narrower than
> `assist.jsx` needs is a different feature, and must be re-specced, not assumed.*

**AC-2** · `4.11-1` · *conditional on AC-1 passing*
> **Given** AC-1 passed, **when** the packet screen renders at a viewport ≥ the dock threshold,
> **then** `[data-qc="assistant"][data-qc-mode="docked"]` is present, `[data-qc-mode="float"]` is
> absent, and the assistant is a sibling of the step rail and content column inside the same flex row
> (not `position: fixed`).

**AC-3** · `4.11-2`
> **Given** the assistant is docked and closed, **when** the packet screen renders, **then**
> `[data-qc="assistant-card"]` shows the heading `Assistant`, a request count for **this packet**, and
> a button labelled exactly `Open assistant`; **and** clicking it makes `[data-qc="assistant-panel"]`
> present without a route change or a page reload.
>
> *Adversarial: the count must be **derived from this packet's request list**, not a literal. The
> prototype's `msgs.filter(m => m.who === 'you').length` counts an in-memory array seeded with a
> fixture (`assist.jsx:15-23`). A count rendered from a hardcoded seed is the fake-live-data the
> standing rule bans. If no request store exists, the card omits the count — it does not print `0`
> dressed as a measurement.*

**AC-4** · `4.11-3`
> **Given** a viewport **below** the dock threshold, **when** the packet screen renders, **then**
> `[data-qc="assistant"][data-qc-mode="float"]` is present, `[data-qc-mode="docked"]` is absent, the
> collapsed affordance is a fixed-position button, and the open panel does not overlay the step rail
> at ≥ 1080px.

**AC-5** · `4.11-1/-3` · **anti-duplication**
> **Given** `postingAnalysis.js:618-633` already implements the app's viewport-rule pattern (a
> testable module constant + a `data-qc-*` attribute, deliberately **not** a CSS media query),
> **when** the dock threshold is added, **then** it is exported as a named constant from a module
> loadable by `node --test`, consumed via the existing `useViewportWidth()` (`PostingAnalysis.jsx:44`)
> — extracted to a shared module if reuse requires it — **and** `grep -rn "1440" app/src/*.css
> app/src/**/*.css` returns no new media query for it.
>
> *Binary: a `node --test` case asserts `assistantMode(1439) === 'float'` and
> `assistantMode(1440) === 'docked'` with no DOM. Do not reuse `state.jsx:36`'s `mobile` — it is a
> max-width mobile flag, a different rule.*

### Group C — scope (4.11-4)

**AC-6** · `4.11-4`
> **Given** `artifactAiEdit` accepts one `artifactId` and at most one `section` (`appPackets.ts:1400`),
> so `This packet` has no route and `My profile` is owner-closed as read-only, **when** the scope
> selector renders, **then** `This asset` is selectable and `This packet` / `My profile` render
> **visibly disabled with a stated reason** — or the selector is not rendered at all.
>
> *Three live-looking chips over one working route is dead UI in its costliest form: it changes what
> the user believes they asked for. `AC-packet-ui-final.md:658` makes the same objection.*

**AC-7** · `4.11-4` · **the read-only ruling, enforced**
> **Given** the owner's decision that `My profile` **warns and does not write**, **when** scope
> `My profile` is selected and a request is sent, **then** the panel renders a notice naming where the
> profile is edited (`ProfileLink` → `#/settings/facts`, `PostingAnalysis.jsx:60-63`) and **no**
> network call is made to any profile route.
>
> *Guard (`H:assistant-panel-profile-is-read-only`), grep-based and mutation-proven:
> `AssistantPanel.jsx` contains no `owner_fact`, no `MasterContext`, and no `api.` call other than the
> single edit call AC-14 permits. This is the row most likely to be "helpfully" extended later —
> SPEC §5 defines **no** profile record, and `evidence.ts:221` `NEVER_EVIDENCE` shows the codebase
> already treats profile internals as write-protected from this direction.*

### Group D — seeding: the governing sentence (4.11-9, 4.7-8)

**AC-8** · `4.11-9` · **the seed contract**
> **Given** `assist.jsx:28` defines seeding as *set text → open → clear the seed*, **when** any
> field-level action fires with the panel as destination, **then** the panel opens, its textarea
> contains the seeded sentence **verbatim and editable**, the seed slot is cleared so it cannot
> re-fire on the next render, and **nothing is sent** until the user presses Send.
>
> *"Nothing is sent" is load-bearing: `AssetBlocks.jsx:551-554` records that both existing seeders
> *"set state and return - neither sends, and `api.aiEditArtifact` still has exactly one call site"*.
> A seeder that sends is a second edit path wearing a different name.*

**AC-9** · `4.11-9` / `4.7-8` · **the field boxes REMAIN**
> **Given** SPEC §2 **R6** requires correction *"in place, scoped to the field they are looking at"*
> and SPEC §4.7 keeps the inline box (`Scoped to this field only.`) in the same document as the panel,
> **when** the panel ships, **then** `List Tweaks` and its ask box are still present on every field
> block, still call `aiEditArtifact` with `section: row.merge_field`, and
> `qcRail.test.mjs:909` + `proposedKeywords.test.mjs:222` still pass unchanged.
>
> **The answer to the brief's question, stated: the boxes SEED the panel and REMAIN. Not replaced.**
> Replacing them would break R6 (a ground rule that *"constrains every screen"*), would remove the
> only surface that can honestly promise single-field scope (§2.5), and would delete a path the owner
> has used.

**AC-10** · `4.11-5` · **one sentence vocabulary, not two**
> **Given** all five prototype quick actions are sentence templates (`assist.jsx:4-10`) and three
> already exist in the app (`keywordActions` `assetBlocks.js:452`; `seedAskReword`
> `AssetBlocks.jsx:559`; `keywordSwapOptions` `assetBlocks.js:485`), **when** the panel renders quick
> actions, **then** every sentence comes from **one exported table** consumed by both the field
> margin and the panel, and no sentence literal is duplicated between them.
>
> *Binary: `grep -rn 'Reword "' app/src/` returns exactly one definition site (it returns one today —
> `AssetBlocks.jsx:559` — and `proposedKeywords.test.mjs:220` already pins that string verbatim).*

### Group E — replies, caveat, and the honest limits (4.11-6, 4.11-7, 4.11-8)

**AC-11** · `4.11-6` · **the honest half, and its ceiling**
> **Given** `artifactAiEdit` echoes the caller's `section` and writes exactly one key
> (`{ ...pkg, [section]: revised }`, `appPackets.ts:1446`), **when** a request is composed in the
> panel, **then** the panel states the **single** merge field the request is scoped to **before**
> sending — sourced from the seed's own `section`, never from the response — **and** renders **no**
> item-level `from → to` row and **no** second field.
>
> *`assist.jsx:20-22` shows a reply changing **two** fields from one request. That is unreachable
> through this route and must not be imitated. Deriving bullet-level `from → to` by diffing `revised`
> against the old text would be fabricating a mapping the server never asserted.*

**AC-12** · `4.11-8` · **the caveat is DERIVED**
> **Given** `swaps.ts:234` records `action:'dropped'`, `driver:'rule'`,
> `rationale:'on the owner do-not-use list (MasterContext.itemsToOmit)'`, and `appSwaps.ts` ships it
> via `select s.*` (already rendered at `AssetBlocks.jsx:577`), **when** a request names a phrase that
> **exactly, whole-phrase** matches the `from_label` of such a row **in this packet's latest loop**,
> **then** the caveat renders naming that phrase; **and when** no such row matches, **no caveat
> renders at all**.
>
> *Binary and mutation-provable: with zero omit-driven drops, `[data-qc="assistant-caveat"]` is absent.
> **The prototype's `m.note` is a hardcoded string on a fixture (`assist.jsx:19`); SPEC's *"a caveat
> **when** a change will be reverted"* is conditional. SPEC outranks the prototype on intent — copying
> `m.note` ships a sentence that is false on most replies.***

**AC-13** · `4.11-8` · **accusation-grade matching**
> **Given** CLAUDE.md's standing rule *"fuzzy matching is for RANKING, never for ACCUSING"* and that
> `swaps.ts` matches with `onOmitList()` server-side, **when** the panel decides whether to show the
> caveat, **then** it compares **exact, whole-phrase, case-insensitive** against recorded `from_label`
> values and never re-implements a similarity score in the browser.
>
> *And the copy says what is **known**, not what is predicted: "the last run dropped **X** because it
> is on your do-not-use list" — not "the next run will drop it". The raw `itemsToOmit` string must
> never be sent to the client (`evidence.ts:221` `NEVER_EVIDENCE`, `pipeline.ts:85`).*

**AC-14** · `4.11-7` · **`Keep` and `Revert` MUST NOT RENDER**
> **Given** `grep "app.http(" api/src/functions/tests/*.ts | grep -i revert` yields only
> `correctionRevert` (which requires a `correction` row with char offsets and a `before_sha256`) and
> `taxonomyRevert`, that `appSwaps.ts:132` registers a **GET only**, and that `artifactAiEdit`
> **writes before it replies** and creates **no** `correction` row, **when** a reply renders, **then**
> **no** `Revert` control and **no** `Keep` control is present; `Re-run QC` may render and must invoke
> the existing `runChecks` (`AssetGateDrawer.jsx:471`).
>
> *`Revert` has no target — this confirms the brief's belief and sharpens it: `correctionRevert` could
> not serve it even if wired, because there is nothing for `revertOne` to anchor to. `Keep` is worse
> than dead: it implies pending approval for a change already committed to `pkg_json`. The app already
> tells the user the opposite one component away — "Anything auto-corrected in it can no longer be
> undone" (`AssetBlocks.jsx:709`).*

**AC-15** · regression
> **Given** the three per-screen edit-path guards are green today (`node --test
> test/packetBuilder.test.mjs` → 13/13), **when** the panel ships, **then** all three still pass
> unchanged, **and** a new mutation-proven `H:assistant-panel-single-edit-call` asserts
> `AssistantPanel.jsx` contains at most one `api.aiEditArtifact(` and never an unsectioned call.
>
> *Mutation proof required: add a second call, confirm the suite FAILS, revert. A guard that passes
> with its defect reinstated is worse than none.*

### Group F — buildable NOW, independent of the panel and of AC-0

**AC-16** · `4.11-8`, no panel required
> **Given** the omit-list rationale is already computed, already shipped and already rendered
> (`AssetBlocks.jsx:577`, `:1017-1020`), but nothing tells the reader a manual edit may be **undone by
> the next remediation loop**, **when** a field's change log shows an item whose `from_label` matches
> an omit-driven `dropped` row, **then** the margin states it in place.
>
> *`AC-packet-ui-final.md:681` independently reached this: *"a real user-facing gap regardless of the
> panel"*. It is Tier 2, ~15 lines, reuses a rendered value, and needs no owner decision.*

**AC-17** · `4.11-5`, no panel required
> **Given** `Put back an original` and `Shorten to fit` are the only two quick actions with **no**
> control anywhere, **when** they are added as in-place seeders beside the three that exist, **then**
> each calls `seedAsk` (no new edit path), and `Shorten to fit`'s sentence carries the field's **real**
> rule from the already-computed `observedFor`/`targetFor` (`AssetBlocks.jsx:563-566`, rendering e.g.
> `56 words · 55–60 words`) rather than the prototype's bare `'Shorten this to fit its word rule: '`.
>
> *This is the narrow, honest version of the gap: **two seeder controls**, not a panel. It closes the
> real half of 4.11-5 at Tier 2 cost and is a strict subset of the panel's work if the panel later ships.*

---

## §5. WHERE THE SOURCES DISAGREE — and which one wins

Required by the brief. Four real conflicts; higher precedence wins each time.

| # | Conflict | Sources | Winner | Consequence |
|---|---|---|---|---|
| 1 | **The caveat: hardcoded vs derived** | Prototype `assist.jsx:19` — `note:` is a literal string on a fixture. SPEC §4.11 — *"**a** caveat **when** a change will be reverted by the next run"* | **SPEC** (precedence 2 > 3). The prototype outranks SPEC only on *what a screen shows* (`IMPORT-NOTE.md`), and this is a question of *when* it shows. | AC-12: derived, conditional, absent when nothing matches |
| 2 | **A reply changing two fields** | Prototype `assist.jsx:20-22` shows `SkillsBullets2` **and** `RelevantBullets2` changing from one request. `artifactAiEdit` writes exactly one key. | **The code.** The prototype is a fixture, not a behavioural claim about a route that exists — and SPEC §4.11 itself gives only a *single*-field example (`SkillsBullets2: Kubernetes → M&A Due Diligence`). | AC-11: one field, no item-level diff |
| 3 | **Dock at ≥1440** | SPEC §3 — *"Assistant docks only ≥ 1440px so the content column keeps ~600px"*. This app's shell caps at 1280 vs the prototype's 1560; and `PostingAnalysis.jsx:8` says the blocks *"need ~850px"*. | **Neither — SPEC's *reason* wins over its *number*.** The rule's stated purpose is a usable content column; in a 1280 shell, 1440 does not deliver one. | AC-1: measure first; the threshold is re-derived or the dock is struck |
| 4 | **"Every field-level action seeds this panel" vs. the shipped field boxes** | SPEC §4.11 (panel is the destination) vs `AssetBlocks.jsx:547` code comment claiming the field box *is* the seeded surface | **SPEC** on intent — a code comment is a claim about code, not a decision (`accuracy-log.md`'s first entry is this exact failure). **But SPEC §4.7 and ground rule R6 keep the inline box**, so this is not a replacement. | AC-9: boxes **seed** the panel and **remain** |

**Two further notes where the sources are stale rather than conflicting:**

- `PacketBuilder.jsx:1180` and `PostingAnalysis.jsx:8` both still state the packet centre is *"~664px
  at 1440"*. Post-D4 the literal widths give **~960px**; 664 was the *pre-D4* figure (it reproduces
  exactly with the removed 280px column: `1196 − 220 − 16 − 280 − 16 = 664`). **Trust measurements,
  not comments** — I nearly propagated 664 as current.
- `PROTOTYPE-COVERAGE.md:499` calls 4.11-7 `PARTIAL` on the strength of `Undo` and `runChecks` existing.
  That is right about `Re-run QC` and misleading about `Revert`: those pieces belong to `correction`
  rows, which `aiEditArtifact` never creates. **`Revert` on a reply is ABSENT, not partial.**

---

## §6. NOT BUILDABLE — state it plainly

| Row | Why not | What would make it buildable |
|---|---|---|
| **4.11-6** (full: replies list the fields they *would* touch) | `section` is an input echoed back; the route writes one key and cannot predict | `artifactAiEdit` returns server-computed `changed: [{ field, before, after }]` — it already holds `currentText` and `revised` — **plus** a propose-then-apply mode. **API change → Tier 1, its own AC pass.** |
| **4.11-7 `Revert`** | No route for either meaning. `correctionRevert` needs a `correction` row with char offsets + `before_sha256`; `aiEditArtifact` creates none and stores no before-image. `appSwaps.ts` is GET-only. | Either `aiEditArtifact` emits a reversible `correction` row, or a new artifact-snapshot revert route. Both are Tier 1. |
| **4.11-7 `Keep`** | Vacuous — the write is committed before the reply renders | Propose-then-apply (same prerequisite as above) |
| **4.11-1 dock** | `1280 − 220 − 16 − 340 − 16 = 688px < 850px` at *every* viewport; the cap binds above ~1524px | Raise the shell's `maxWidth: 1280` (blast radius: every screen) **or** re-spec a narrower assistant. Neither is inside this AC pass. |
| **4.11-4 `This packet` scope** | One `artifactId` per call; a packet-wide scope is N calls = a second edit path, forbidden by the owner's `aiEditArtifact`-only ruling | A packet-scoped edit route, or explicit sign-off to loop client-side |
| **4.11-4 `My profile` write** | Owner-closed read-only; SPEC §5 defines no profile record | n/a — closed by decision, not by capability |

**Six of the nine rows are blocked on something other than effort. Only 4.11-8 and half of 4.11-5
are both wanted and reachable today — and neither needs the panel.**

---

## §7. SEQUENCE BY COST

| # | Item | ACs | Tier | Cost | Blocked by |
|---|---|---|---|---|---|
| **1** | **Ask the owner to lift or re-affirm the hold** | AC-0 | — | one question | — |
| **2** | **The omit-list caveat, in the field margin** | AC-16, AC-13 | 2 | ~15 lines, value already rendered | **nothing** |
| **3** | **`Put back an original` + `Shorten to fit` as in-place seeders** | AC-17, AC-10 | 2 | two `seedAsk` callers | **nothing** |
| **4** | **The width measurement** | AC-1 | 2 | one `ui-verify.yml` run | AC-0 |
| **5** | Breakpoint constant + hook reuse | AC-5 | 2 | small; reuses `keywordColumns` pattern | AC-1 |
| **6** | Float-only panel shell + collapsed affordance | AC-4, AC-3 | 2 | new component | AC-0, AC-1 |
| **7** | Seed lift + the panel as destination | AC-8, AC-9 | 2 | **the real cost** — lifts field-local state to `PacketBuilder.jsx` | 6 |
| **8** | Scope selector, two chips disabled-with-reason | AC-6, AC-7 | 2 | small | 7 |
| **9** | Pre-send single-field statement; **no** Keep/Revert | AC-11, AC-14 | 2 | small | 7 |
| **10** | Panel caveat (reuses #2's derivation) | AC-12, AC-13 | 2 | small | 7, 2 |
| **11** | Guards + mutation proofs | AC-15 | **never skipped** | one command each | each above |
| **12** | Docked variant | AC-2 | 2 | — | **struck unless AC-1 passes** |
| **13** | Propose-then-apply + `changed[]` from the API | *(none written)* | **1** | new AC pass, verifier, live verification | separate owner decision |

**Items 2 and 3 are the whole of what is both wanted and unblocked, and they are ~2 hours of Tier 2
work that needs no panel and no owner decision.** Everything from item 4 down waits on AC-0.

---

## §8. SUMMARY

1. **The build is on hold as of today.** `.claude/DEFERRED.md:195` was re-confirmed **2026-08-27**:
   *"hold off on the panel until all other UI pieces are done."* AC-0 gates every other AC. The brief's
   two closed decisions narrow *what the panel would be*; they are not a go-ahead, and the register is
   newer than both.
2. **The governing sentence reads as the brief suspects — SEED — but the field boxes REMAIN.**
   `assist.jsx:28` and `AssetBlocks.jsx:555` are the same primitive with different destinations.
   Ground rule **R6** and **SPEC §4.7** both keep the in-place box; the panel is a destination it does
   not yet have. Replacing the boxes would break a ground rule to satisfy a screen description.
3. **`Revert` has no target and `Keep` is vacuous — neither may render.** `aiEditArtifact` writes
   before it replies and creates no `correction` row; `correctionRevert` could not serve it even if
   wired. `Re-run QC` is the one third that is already built.
4. **4.11-6 is not buildable honestly**, and for a sharper reason than "the route doesn't return what
   changed": `section` is an *input echoed back*, and the route can only ever write one field — so the
   prototype's own two-field example is unreachable.
5. **The dock does not fit, at any width.** The prototype's shell is `1560`, this app's is `1280`, and
   `280px` — the exact width of the right column decision **D4 deleted** — is the difference. Docking
   `assist.jsx` leaves 604–688px against blocks that need ~850px. **4.11-1 is a shell decision, not a
   breakpoint one.**
6. **Reuse the existing viewport mechanism** (`useViewportWidth` + a `keywordColumns`-style module
   constant). `postingAnalysis.js:627` already names this feature as its sibling rule. A new media
   query would be invisible to `ui-verify.yml` and unverifiable.
7. **Three of five quick actions already exist as scoped seeders; the two that do not are the only two
   that are not field-scoped** — and they are two small controls, not a panel.
8. **`H:one-edit-path` is per-screen-file, not app-wide** (four call sites exist today). The panel
   satisfies it by living in its own file and adding no call to `PacketBuilder.jsx`; a new
   mutation-proven guard must pin the panel's own count.
9. **The one thing worth building regardless: AC-16**, the omit-list caveat. Its data is live, already
   rendered, read-only, and it closes a real user-facing gap with no panel and no decision.

*AC pass complete. Nothing under `app/src` or `api/src` was modified; this file is the only one written.*
