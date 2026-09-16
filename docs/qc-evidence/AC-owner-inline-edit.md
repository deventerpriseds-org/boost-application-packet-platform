# AC — Owner inline edit, in-block, with version history

Task (owner's words): "update the text to be editable and saveable right there in the block by
myself, not only ai edits that i have to list. i should be able to click edit and update while
previous versions are saved in case we need to revert. I believe this is the case in other parts
of the packet builder"

Written cold, against `origin/main` (this branch is up to date with it, see git log below).
Sources actually read: `api/src/functions/tests/appCorrections.ts` (full artifactOwnerEdit +
artifactCorrectionsGet + correctionRevert), `api/src/functions/tests/correction.ts` (full —
locateOwnerPhrase, reapplyOwnerEdits, originalOf, revertOne, CORRECTION_FRAME), `api/src/functions/tests/appPackets.ts`
(artifactContent, artifactAiEdit — read in full), `api/src/functions/tests/schema.ts` (correction
table DDL), `app/src/screens/AssetBlocks.jsx` (AssetBlock, the askOpen box, the "Corrected for
you" margin), `app/src/screens/QcRail.jsx` (CorrectionRow, in-field mode), `app/src/screens/OppDetail.jsx`
(ResumeField, ResumeTab, staleById), `app/src/screens/PacketBuilder.jsx` (ArtifactCard, useQcEntries,
markQcStale), `app/src/api.js` (ownerEdit, saveArtifactContent, aiEditArtifact, revertCorrection).

Session state at start: `git log --oneline -3` → `4689908`/`b657217`/`a041d8f`;
`git rev-list --left-right --count origin/<branch>...HEAD` → `0  0` (in sync, not behind/ahead).

---

## 0. Correcting the owner's own premise — checked, not accepted

Command: `grep -rn "<textarea" app/src/screens/*.jsx` then read every hit's surrounding component.

**The owner is half right, and the half that's wrong is the half that matters most to him.**

There IS an existing "click Edit → textarea shows the real field text → Save" round trip:
`ResumeField` in `app/src/screens/OppDetail.jsx:440`. It is wired on the Resume tab of the
opportunity detail screen, not inside the Packet Builder's `AssetBlocks.jsx` field blocks the
owner is describing — but the UX shape he remembers is real and it is the right one to match.

**But `ResumeField.save()` calls `api.saveArtifactContent` → `POST /app/artifact/{id}/content`
(`artifactContent` in `appPackets.ts:1520`), which does a bare
`update packet set pkg_json = $1 ...` with NO insert into `correction` anywhere in that
function.** Read the full function body (`appPackets.ts:1520-1558`) — confirmed, there is no
`correction` table write on this path at all. So the "previous versions are saved in case we
need to revert" half of the owner's ask is **NOT true anywhere in the app today**. `ResumeField`
overwrites `pkg_json[fieldKey]` with no way to recover what was there before. This is a real,
pre-existing gap in `ResumeField` itself — noted here, not fixed here (out of scope for this AC
pass, which is scoped to the new AssetBlocks control) — worth a follow-up ACT item.

The ONLY thing in this codebase that keeps a revertable version history of a text field is the
`correction` table (`source='owner_edit'` for a manual edit, `frame='applied'`), written by
`artifactOwnerEdit` (`appCorrections.ts:337`) and read back by `artifactCorrectionsGet` /
reverted by `correctionRevert`. **Confirmed nothing in `app/src/` calls `ownerEdit` today**
(`grep -rn "ownerEdit" app/src api/src` → the only hits are the `api.js:201` definition and the
back-end file itself; zero call sites in any `.jsx`). So the feasibility table in the brief is
confirmed correct on every row I checked, with one addition: there is a SECOND, decoy pattern
(`ResumeField`/`artifactContent`) that looks like what the owner wants but silently fails the
"revertable" half — the new control must NOT copy that one.

**Verdict for "extend, don't duplicate":** match `ResumeField`'s UX shape (inline Edit → textarea
→ Save/Cancel, in place) but call `artifactOwnerEdit`, never `artifactContent`, so the result
actually has the version history the owner asked for. Do not create a third pattern.

---

## 1. Feasibility table — re-verified against origin/main, row by row

| Dependency | Producer | Consumer today | Proof (command + actual output) | Verdict |
|---|---|---|---|---|
| `POST /app/artifact/{id}/owner-edit` | `appCorrections.ts:337 artifactOwnerEdit`, registered `appCorrections.ts:415` | none in `app/src` | `grep -rn "ownerEdit" app/src api/src` → only `api.js:201` (client def) and the two `appCorrections.ts` hits (impl + route reg) | **EXISTS-BUT-UNCALLED — confirmed** |
| `api.ownerEdit(artifactId, body)` | `app/src/api.js:201` | no caller | `grep -rn "api\.ownerEdit\|\.ownerEdit(" app/src` → only the definition line itself | **EXISTS-BUT-UNCALLED — confirmed** |
| version history rows | `correction` table, `source='owner_edit'`, `frame='applied'`, `applied_seq`, `before_sha256` | `artifactCorrectionsGet` (`appCorrections.ts:209`) | read the full route; returns `{artifact_id, corrections: rows}`, empty array (not absent key) when none | **EXISTS — confirmed** |
| revert one version | `correctionRevert` (`appCorrections.ts:237`) | `QcRail.jsx` `CorrectionRow` (`QcRail.jsx:574`), and **also already rendered inline inside `AssetBlocks.jsx`** via `import { CorrectionRow } from './QcRail.jsx'` at `AssetBlocks.jsx:50`, mounted at `AssetBlocks.jsx:1040` under the "Corrected for you" label (`AssetBlocks.jsx:1038`) | `grep -n "CorrectionRow" app/src/screens/AssetBlocks.jsx` → import line 50, usage line 1040 | **EXISTS AND ALREADY WIRED INSIDE THE VERY BLOCK THE OWNER IS ASKING ABOUT** — stronger than the brief's row, which only cited `QcRail.jsx` |
| the field block UI | `app/src/screens/AssetBlocks.jsx` | its only `<textarea>` at line 972 is the AI "List Tweaks" instruction box (`askOpen` block, sends to `api.aiEditArtifact`), not a direct-edit-the-text textarea | `grep -n "<textarea" app/src/screens/AssetBlocks.jsx` → one hit, line 972, inside the `askOpen &&` block that posts to `aiEditArtifact` | **ABSENT — confirmed, this is the real gap** |
| AI edit path | `api.aiEditArtifact` → `artifactAiEdit` (`appPackets.ts:1564`) | `AssetBlocks.jsx` Send button, `AssetBlocks.jsx:978-992` | read in full | **EXISTS — confirmed, and must keep working unchanged (see AC-9)** |
| a *decoy* whole-field-overwrite pattern that looks like what's wanted but has no version history | `artifactContent` (`appPackets.ts:1520`) | `ResumeField` in `OppDetail.jsx:440`, via `api.saveArtifactContent` (`api.js:239`) | read `artifactContent` in full: only writes `artifact.content` / `packet.pkg_json`, zero `correction` inserts | **EXISTS, WORKS, BUT IS THE WRONG MODEL TO COPY — see §0** |
| per-field staleness UI pattern (`checksStale` → visible badge) | `artifactOwnerEdit`/`artifactContent`/`aiEditArtifact` all return `checksStale` | **at the ARTIFACT-CARD level**: `PacketBuilder.jsx` `useQcEntries`/`markQcStale`, rendered as `<Pill tone="warn">checks may be stale</Pill>` at `PacketBuilder.jsx:204`; **at OppDetail level**: `staleById` map, `OppDetail.jsx:516-518`, same `Pill tone="warn"` at line 622. **`AssetBlock` (the field-level component inside `AssetBlocks.jsx`) currently receives NO `onStaleSignal` prop at all** | `grep -n "onStaleSignal\|stale" app/src/screens/AssetBlocks.jsx` → zero hits in the `AssetBlock` function signature/body (only unrelated comments at lines 606, 895) | **EXISTS-BUT-CONSTRAINED — the pattern exists twice at two other altitudes (artifact-card, whole-page), but is not threaded down to the per-field block. Must be threaded, not invented fresh.** |

**Table `ALREADY BUILT` calls:** revert-one-version UI is already built and already inside this
exact block (stronger claim than the brief made — verified by reading the import, not assumed).
The staleness *pattern* is already built twice; only the *plumbing* into `AssetBlock` is missing.

## 2. The design decision: (A) whole-text-as-phrase vs (B) minimal client diff

Read in full: `locateOwnerPhrase` and `reapplyOwnerEdits` (`correction.ts:206-238`),
`artifactOwnerEdit` (`appCorrections.ts:337-412`), the caller of the correction pass in
`appPackets.ts` around line 640, and every consumer of `ownerLapsed`/`built.warnings` down to the
browser.

**Trace of what happens to a lapsed edit, end to end (the exact question the brief asks):**

1. On any rebuild, `reapplyOwnerEdits` (`correction.ts:220`) re-locates every stored `owner_edit`
   row's `phrase` in the freshly generated text via `locateOwnerPhrase` — an **exact, case-sensitive
   `indexOf`**, refusing on 0 or 2+ matches, with **no fuzzy fallback of any kind** (confirmed by
   reading the function body — it is literally `hay.indexOf(needle)` plus a second `indexOf` call to
   check for a second occurrence).
2. A miss is pushed to a `lapsed` array (`correction.ts:232`), collected into `ownerLapsed`
   (`appCorrections.ts:159-172`), and returned from the correction-pass function.
3. `appPackets.ts:640-642` turns each lapsed row into one line in `built.warnings`:
   `` `your edit to ${field} could not be kept — ${reason}` ``. **This is a real, intentional
   surfacing point** — the comment there says it was added because an earlier version silently
   dropped the value (found by an independent verifier), so lapses are NOT swallowed at the API
   layer.
4. `built.warnings` reaches the client as `s.result.warnings` from `api.buildJob(jobId)`
   (`PacketBuilder.jsx:648`). **But the client reads only `.length`** (`PacketBuilder.jsx:654`,
   `const warned = (s.result?.warnings || []).length`) and shows a single aggregate toast:
   `"Built N documents — M warnings, nothing sent"`. Confirmed by reading the whole `pollBuild`
   function — there is no per-warning render anywhere, no list, no field name, no "your wording for
   X was lost" message. **The owner is told a number changed, never which field lapsed, never what
   the lost wording said, and the toast is transient (fires once, no persistent log).**

**So under either (A) or (B), a lapsed edit today is silent about WHAT was lost — that gap exists
independent of which mapping is chosen, and item 1 below (checksStale) does not cover it either.**
It is a real, pre-existing gap in the warnings pipe. Flagging as **AC-7** below rather than fixing
it, since fixing `PacketBuilder.jsx`'s warning renderer is outside this control's own blast radius —
but this new feature makes the gap matter far more (a full-paragraph rewrite disappearing without
naming itself is a bigger loss than a single figure normalization).

**The actual trade-off, in the owner's own terms:**

| | (A) whole current text as `phrase` | (B) minimal client-side diff |
|---|---|---|
| Backend change needed | **None** — `artifactOwnerEdit` already accepts arbitrary-length phrase/replacement and the "exactly once" check is trivially true for the whole string | A new diff algorithm (word- or sentence-level) has to be written and maintained client-side |
| Does your typed edit survive the NEXT rebuild? | **No, almost never**, once the rebuild regenerates that field's prose at all — the phrase is the entire pre-rebuild paragraph, and a rebuilt paragraph reproducing it byte-for-byte is not realistic. It will lapse, and per the trace above, you will see only a generic "M warnings" toast with no indication it was YOUR paragraph that got lost. | **Much more likely to survive**, because a short, specific phrase ("led a team of 4" → "led a team of 6") stays findable in regenerated prose even when the surrounding sentence changes |
| What you get for "previous versions saved" | A full before/after snapshot of the whole field in one `correction` row — literally the clean version-history behavior asked for, and it reverts correctly through the existing `correctionRevert`/`CorrectionRow` UI with **zero backend change** (verified below) | Same revert mechanism, but each row is a small phrase-level diff, so "revert" restores one small change rather than one whole rewrite — arguably a WORSE match to "click Edit, retype the block, Save, keep the old version" |
| What happens when you rewrite a whole paragraph (not a phrase-level tweak) | Works exactly as designed — that's what it's for | **The diff degenerates to "replace everything" anyway** — a client-side diff against a full paragraph rewrite typically finds the two texts share no useful common substring, so it produces the same whole-field phrase/replacement pair (A) would have produced directly, except after paying for a diff library, its edge cases (word boundaries, punctuation, multi-paragraph fields), and its own test suite |

**Verified claim from the brief:** "a whole-field-snapshot correction row reverts correctly
through `revertOne`" — read `revertOne` (`correction.ts:327` onward, via `correctionRevert`
`appCorrections.ts:237-313`) in full. `revertOne` unwinds `applied`-frame rows (which is what
`owner_edit` rows are, per `CORRECTION_FRAME.owner_edit = 'applied'`, `correction.ts:65`)
**descending by `applied_seq`**, splicing `replacement` back out and `phrase` back in, verified
against `before_sha256` before writing anything. For a single whole-field row this reduces to
exactly "restore what `phrase` recorded" — no special-casing needed, no length limit in the
splice logic (it is plain JS string slicing), confirmed correct by reading the algorithm rather
than assumed from its name.

**RECOMMENDATION: (A).** It costs zero backend changes, it is what "keep my previous version so I
can revert" actually means (a real snapshot, not a synthetic diff), and its one real cost — the
edit is much more likely to be silently dropped on the next full rebuild — is a real, stated
trade-off the owner should knowingly accept, not a reason to build and maintain a client-side diff
algorithm that degrades to the same "whole field" behavior the moment he does the exact thing he
described ("retype the whole paragraph"). Building (B) buys rebuild-survival for phrase-sized
tweaks the owner didn't ask for (he asked to retype a block, not nudge one word), at the cost of a
new algorithm this repo would then own forever. **Do not weaken the exactly-once-match refusal to
make (B) look more attractive — that refusal is a correctness guard, not friction (binding rule).**

This is exactly why **AC-7 (the lapse-visibility gap)** matters more under (A): recommend (A), but
do not ship it without also closing the "M warnings, no names" gap, or a rebuild can silently
erase an owner's whole rewritten paragraph with nothing in the UI ever naming which field or what
was lost.

---
