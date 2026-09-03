<!-- WHAT:       Acceptance criteria for the Settings screen that lets the owner edit their own
                 master profile (the 14 `owner_master_block` rows), produced from
                 BRIEF-ac-master-profile-editor.md.
     WHY:        TIER 1 -- see the brief. This is the feasibility + AC pass required before any
                 implementation of that brief begins.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   commands run and their output are inlined per section below. -->

# AC — the master profile editor (loop 1)

Status: IN PROGRESS. Sections below are appended and committed as they are produced.

## 0. Feasibility table

| Dependency | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|
| `MC_LABEL` completeness against the 14 `MC_KIND` keys | `evidence.ts` (`MC_KIND`, `MC_LABEL`, both hand-written literals) | nothing today -- `MC_LABEL`'s own comment says it exists "for the settings-screen names of those fields", written for a screen that does not exist | Node script diffing the two object literals' key sets: `MC_KIND (14): aboutMe1,aboutMe2,coreAccomplishments,executiveProfile,expertise,relevantProficiencies,resumeSummary,skills1,skills2,softHardSkillsPool,workHistory1,workHistory2,workHistory3,workHistory4` / `MC_LABEL (14):` identical list / `equal sets: true` | **EXISTS** -- complete, 14/14, ready to use as-is |
| `owner_master_block_key_check` domain vs. `MC_KIND` | `schema.ts` (`ALTER ... ADD CONSTRAINT owner_master_block_key_check`) | Postgres, on every INSERT/UPDATE | Node script extracting the 14 literal strings from the CHECK clause and diffing against the `MC_KIND` key list: `matches MC_KIND: true`, `itemsToOmit in CHECK domain: false` | **EXISTS** -- the DB-level lock is live and excludes `itemsToOmit` |
| The DB-CHECK/`MC_KIND` parity guard itself | `api/test/hardening.test.mjs` (`H:mastercontext-block-key-domain`) | run on every `npm test` | `cd api && node --test test/hardening.test.mjs` -> `ok 143 - H:mastercontext-block-key-domain: the block_key CHECK matches MC_KIND exactly` | **EXISTS** -- this guard is already live and passing; the editor does not need to invent it, only not break it |
| `owner_master_block` writers today | `masterContext.ts` (`copyMasterContextToPostgres`, called only from the `masterContextCopy` POST route) | `readMasterContextEntity()` reads it; nothing else writes it | `grep -rn "owner_master_block" api/src app/src` -- one INSERT statement (`masterContext.ts:157`), inside the one-time copy function, no other writer anywhere | **EXISTS-BUT-CONSTRAINED** -- the only writer is the one-time seed. No editor writer exists. Confirms this is new work, not a duplicate. |
| A master-profile editor screen or route, anywhere in the app | -- | -- | `grep -rniE "master-block\|masterProfile\|master-profile\|masterBlock" api/src app/src` -- zero hits outside `masterContext.ts`'s own doc comments; `grep -n "app.http" **/*.ts \| grep -i master` -- only `diagMasterSource` (read-only diagnostic) and `masterContextCopy` (one-time seed, POST-only, no GET, no per-block edit) | **ABSENT** -- confirmed. This is genuinely unbuilt, not a regression guard in disguise. |
| `H:mastercontext-one-accessor` -- does it force the new route into `masterContext.ts`? | `hardening.test.mjs` | -- | Read the guard: it only forbids OTHER files from re-opening a raw `PartitionKey eq 'context'` Storage scan. A Postgres-backed editor route in any file would not trip it. | **EXISTS-BUT-CONSTRAINED** -- not a hard requirement, but `masterContext.ts` is still the right home (see §1) |
| `Settings.jsx` -- does it have a routing slot a new section drops into? | `app/src/screens/Settings.jsx` (`SECTIONS` array + one `active === '<key>' && <Component/>` line per tab) | rendered by `Settings()` | Read the file: 11 existing entries (`account`, `intake`, `roles`, `facts`, `locations`, `templates`, `coach`, `workspace`, `quality`, `usage`, `system`), each following the same `Card` + dirty-tracking + `sessionValid()` + `px-btn-accent` Save pattern (e.g. `TemperatureSettings`, `FactsSettings`) | **EXISTS** -- adding a 12th entry is a two-line addition to `SECTIONS` plus one render line; no new pattern needed |
| `appSearchPrefs.ts`'s auth shape as the settings-write precedent | `appSearchPrefs.ts` | `app/src/api.js` (`searchPrefsGet`/`searchPrefsSet`) | Read the file: GET uses `resolveOwner(req).owner` (accepts unverified `?owner=`); POST calls `requireWrite(req)` first and takes the owner from the verified session, never from the query string; both do **partial** updates (`sets`/`vals` built only from keys present in the body) | **EXISTS** -- this is the exact auth + partial-update shape the new route must copy |
| `app/src/api.js` -- does it already pass `?owner=` on settings calls? | `api.js` | every `*Settings` component | `searchPrefsGet: () => get('/app/search-prefs?owner=' + encodeURIComponent(_owner))`; `searchPrefsSet` deliberately omits `?owner=` (POST, verified session decides) | **EXISTS** -- the client-side convention (GET carries `?owner=`, POST does not) is already established and must be followed, not reinvented |

**No `ALREADY BUILT` outcome.** Every producer/consumer check above confirms the data and its guards
exist; no screen, route, or writer for owner-driven editing exists anywhere in the repo. This is new
work, correctly scoped as "wire an editor onto data and locks that already exist" rather than "design
a new subsystem."

## 1. Extend, don't duplicate -- where the route lives

**The new GET/POST editor route extends `masterContext.ts`, not `appSearchPrefs.ts`, and is a NEW
route rather than new fields bolted onto an existing one.** Both halves of that sentence are
deliberate:

- **Why not fold into `appSearchPrefs.ts`'s existing GET/POST**: that route's payload is a handful of
  scalars (geo ids, booleans, small ints) fetched on every load of Settings ▸ Intake and
  Settings ▸ Quality. The 14 master-profile blocks are free text -- work-history paragraphs, resume
  summaries -- easily tens of thousands of characters combined. Bolting them onto `search-prefs`
  would make every unrelated settings-prefs read pull the owner's entire profile text over the wire,
  and would mix two data shapes (one-row-per-owner scalars vs. many-rows-per-owner text blocks)
  behind one endpoint. That is a real cost, not a style preference, so a separate route is justified.
- **Why `masterContext.ts` and not a new file**: it is already the one place that (a) imports
  `MC_KIND`, (b) contains the only existing writer of `owner_master_block`
  (`copyMasterContextToPostgres`) and its route (`masterContextCopy`), and (c) states in its own
  header that it is "the ONE place the owner's master profile is read out of" -- now, out of either
  store. Adding the editor route beside `masterContextCopy` in the same file is the same table, the
  same imports, the same file -- literally extending, not duplicating.
- **The auth/partial-update SHAPE is copied from `appSearchPrefs.ts`** (GET via `resolveOwner`, POST
  via `requireWrite` + verified-session owner, partial updates keyed by what's present in the body).
  That satisfies "extend, don't duplicate" at the pattern level even though the route itself is new.

## 2. The Tier-1 questions, answered

**1. `itemsToOmit` stays unwritable -- THREE locks, and the route adds no new one, it reuses the
existing two plus the DB's:**
   - Lock 1 (route): the new route only ever iterates `Object.keys(MC_KIND)` to decide which
     `block_key`s it will accept from the request body. `itemsToOmit` is not a key of `MC_KIND`
     (verified above), so it is never in the iteration set -- there is no `if (key === 'itemsToOmit')
     reject` branch to forget, because the field the route reads from is the one place that never
     contains it in the first place.
   - Lock 2 (`MC_KIND` itself): unchanged, already the "second lock on the same door" per its own
     comment.
   - Lock 3 (DB CHECK): unchanged, `owner_master_block_key_check`, proven above to exclude
     `itemsToOmit`.
   A fourth lock (an explicit `if (block_key === 'itemsToOmit') return 400` in the route) is
   **belt-and-braces, not required** -- the route structurally cannot accept a key outside
   `Object.keys(MC_KIND)` by construction (AC7 makes this an observable behaviour, not just a design
   claim).

**2. Empty vs. absent.** The route is a **partial update, keyed strictly by which block keys are
   present in the POST body** -- the same discipline `appSearchPrefs.ts` already uses for
   `targetGeoIds`/`remoteOnly`/`tempThresholds`. The screen only ever sends the block(s) the owner
   actually edited in that save (tracked the same way every sibling `*Settings` component tracks
   `dirty`), never the whole 14-block form. Consequences:
   - A block the owner never touches is never sent -> its row stays exactly as it was (present-empty
     stays present-empty; absent stays absent).
   - A block the owner clears to `''` and saves IS sent (it is dirty), and is written as `''` --
     which is the honest, intended transition: the owner acted, so "never set" becoming "deliberately
     emptied" is correct, not a collapse of the distinction. What the design must never do, and does
     not, is auto-resave untouched fields on every save (that would be the actual collapse, turning
     silence into an assertion).
   - No control in the editor produces the reverse transition (present-empty -> absent, i.e. row
     deletion). Nothing in the brief asks for that, and inventing a "delete this block entirely"
     action is out of scope for a text-editing screen (AC set below does not include it).

**3. Cross-owner write.** The POST handler calls `requireWrite(req)` first, exactly like
   `masterContextCopy` already does, and takes the write target from `resolveOwner(req).owner`
   **after** that guard passes -- never from a client-supplied `owner` field in the body and never
   from `?owner=`. This is the same defect class `appSearchPrefs.ts` and `masterContextCopy` already
   avoid; the new route copies their shape rather than re-deriving it.

**4. `masterBaseline`'s output moves the moment a block saves -- what the owner sees.** Silence here
   would be exactly the "black box" pattern the owner has objected to before (Settings ▸ Roles).
   The screen carries a **static, one-line note** near the editor (not a dynamic per-save warning,
   which would need to know which packets are affected and is out of scope): "Changes here apply to
   packets built from now on. Packets already built keep the wording they were originally built
   with." This is copy, not a feature -- it costs one `<div>`, keeps "seems simple" intact, and closes
   the silence gap without building a cross-reference to `insertion.before_text`.

**5. Concurrency: last-write-wins, deliberately, no optimistic lock.** Justification, not just a
   default: this is single-owner, low-contention data (one person editing their own profile text,
   almost always from one tab), and every existing sibling settings screen in this file
   (`TemperatureSettings`, `SweepSettings`, `ChecksSettings`, ...) already uses plain last-write-wins
   with a client-side "Unsaved changes" indicator and no server-side conflict detection. Building
   optimistic locking here would be the first settings screen in the file to do so, for a risk
   (two tabs, same owner, rare) whose cost on collision is bounded and recoverable (re-type one field
   of your own text) -- not proportional to the round-trip + conflict-UI cost optimistic locking would
   add. `updated_at` already exists on the row for a future need; nothing here requires reading it
   back into a conflict check today.

## 3. Acceptance criteria

Binary, `Given / when / then`. Numbered for reference from guards below.

- **AC1.** Given the owner has all 14 blocks in Postgres, when they open the profile editor, then
  they see all 14 fields, each pre-filled with its current text (including blocks whose text is
  `''`), labelled with `MC_LABEL`'s wording for that key.
- **AC2.** Given a block the owner has never had seeded (absent row), when they open the editor,
  then that field renders as empty **and the screen does not send it back on save unless the owner
  edits it** (AC5 covers the mechanism).
- **AC3.** Given the owner edits one block and clicks Save, when the save completes, then a reload of
  the screen shows the edited text (round trip).
- **AC4.** Given the owner edits one block and saves, when the save completes, then the other 13
  blocks' stored rows are byte-identical to before the save (partial update proven, not just
  claimed).
- **AC5.** Given the owner opens the editor and changes nothing, when they leave the screen, then no
  write request is made at all (no accidental resave of untouched data).
- **AC6.** Given the owner clears a block's text to empty and saves, when the save completes, then
  the stored row exists with `text = ''` (not deleted, not left at its old value).
- **AC7.** Given a POST body naming a `block_key` outside the 14 in `MC_KIND` (e.g. `itemsToOmit`, or
  a typo), when the request is handled, then the route refuses that key with a 4xx **before** the
  query reaches Postgres (the DB CHECK is the backstop, not the only line of defence -- AC7 is what
  makes "belt-and-braces" in §2.1 an observable behaviour rather than a design claim).
- **AC8.** Given a signed-in owner A and a request bearing `?owner=B` (B a real, different owner) on
  the POST route, when the request is handled, then the write is applied to A's rows, never B's
  (`resolveOwner`'s verified-session precedence, exercised against this specific route).
- **AC9.** Given an unauthenticated request (no verified session, not the demo owner) to the POST
  route, when it is handled, then it is refused with 401, matching `requireWrite`'s existing contract
  for every other owner-scoped write.
- **AC10.** Given a save fails server-side (e.g. Postgres unreachable), when the owner is on the
  editor screen, then they see an explicit error message naming the failure, and their unsaved edits
  remain in the input fields (not cleared, not silently lost) -- matching the existing
  `TemperatureSettings`/`ChecksSettings` failure-copy pattern in this file.
- **AC11.** Given the owner saves a block, when the save succeeds, then the screen shows the static
  note from §2.4 ("packets already built keep their original wording") is present on the screen at
  all times the editor is open, not only after a save (it is standing copy, not a toast).

## 4. Guards (mutation-provable)

Written against the implementation this brief specifies (not yet built at the time of writing --
each guard names the file it will live in and the exact mutation that must flip it red, so it can be
mutation-proved with `scripts/mutate.sh` the moment the corresponding code lands):

1. **File:** `api/test/hardening.test.mjs` (new case, working name
   `H:master-profile-editor-rejects-unknown-key`). **Mutation:** in the new POST handler (in
   `masterContext.ts`), change the key-validation from `Object.keys(MC_KIND).includes(block_key)` to
   always `true` (i.e. delete the guard clause). **Proves:** AC7. **Must-fail test:** a unit test
   posting `{ blocks: { itemsToOmit: 'x' } }` and asserting the response is a 4xx and no query ran
   (spy on the pg client, assert zero calls).
2. **File:** same test file, working name `H:master-profile-editor-owner-from-session`. **Mutation:**
   in the POST handler, change `resolveOwner(req).owner` (read after `requireWrite`) to
   `req.query.get('owner') || resolveOwner(req).owner` (i.e. reintroduce the query-string spoof path
   `requireWrite` exists to close). **Proves:** AC8. **Must-fail test:** a request with a verified
   session for owner A and `?owner=B`, asserting the row written carries `owner_email = 'A'`.
3. **File:** same test file, working name `H:master-profile-editor-partial-update`. **Mutation:** in
   the POST handler, change the write loop from "only keys present in `req.body.blocks`" to "every
   key in `MC_KIND`, defaulting absent ones to the currently-stored value or `''`" (i.e. make it a
   full-form resave). **Proves:** AC2 and AC4. **Must-fail test:** send a body with exactly one block
   key, assert the other 13 keys receive zero `INSERT/UPDATE` statements (spy on the query calls, not
   just the end state -- an unconditional `UPDATE ... SET text = text` would pass an end-state-only
   assertion while still writing 14 rows).
4. **File:** same test file, working name `H:master-profile-editor-requires-write-guard`.
   **Mutation:** delete the `requireWrite(req)` call at the top of the new POST handler. **Proves:**
   AC9. **Must-fail test:** POST with no `Authorization` header and `owner` not equal to the demo
   email, assert 401 and zero rows written.

Existing guards this work must keep green, not duplicate: `H:mastercontext-block-key-domain`,
`H:mastercontext-one-accessor`, `H:mastercontext-rollback-flag` (all three re-run and passing as of
this AC pass -- §0 table).

## 5. The smallest first commit

**The route only: `GET /app/master-profile` and `POST /app/master-profile`, added to
`masterContext.ts`, with the four guards in §4 and AC1-AC9 covered by tests against the route
directly (no UI yet).** This is independently revertable (one file, one new route pair, no schema
change -- the table and its CHECK already exist), and proves the whole hard part (the three Tier-1
locks, partial-update semantics, and auth) before any screen code is written. The Settings.jsx
section (AC10, AC11, the static note, and the visible round-trip) is the natural second commit, built
against a route already proven correct in isolation.

## 6. Binding-rules compliance note

No prompt in the Prompts table was read or edited. Every verdict above cites the command run and its
literal output. No existing guard's assertion was weakened or proposed to be weakened; the three
existing `H:mastercontext-*` cases are named as guards to preserve, not to loosen. Coverage in §0 was
measured against the full 14-key population (`MC_KIND`/`MC_LABEL`/CHECK domain diffed as complete
sets), not a single sampled row.
