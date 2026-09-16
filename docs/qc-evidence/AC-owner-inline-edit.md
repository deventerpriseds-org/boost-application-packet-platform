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

*(Section continues below as it is written — design decision, the five non-goals, and the final
AC checklist. Committed incrementally; if the container is reclaimed mid-run, whatever has been
pushed is what survives.)*
