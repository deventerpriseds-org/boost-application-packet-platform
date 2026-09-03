# IMPL — check-trigger wiring (LANE 1)

Branch `claude/boost-app-setup-approach-6xdoef`. Scope: AC-judge-trigger-points build-order items
**1 (render-path bypass)** and **3 (four edit-writer gaps)**. Written incrementally.

No `git` command was run by this lane (per brief). Files touched are listed at the foot.

---

## Step 0 — read of the current code (evidence for every design decision below)

| Fact | Where | Read at |
|---|---|---|
| `buildTemplatedArtifact` = `ensurePackage` + `renderArtifact`, no check call | `appPackets.ts:811-819` | this run |
| `renderArtifact`'s write flips `status` `todo`->`review` | `appPackets.ts:802` | this run |
| `artifactDocument` calls it | `appPackets.ts:843` | this run |
| `artifactSlides` calls it | `appPackets.ts:922` | this run |
| `runPacketBuild` calls it | `appPackets.ts:1106` | this run |
| `runPacketBuild`'s `evaluateArtifact` | `appPackets.ts:1189` | this run |
| Four un-rechecked writers | `appPackets.ts:1491`, `appPackets.ts:1549`, `appCorrections.ts:368`, `appCorrections.ts:283` | this run |
| `ensurePackage` / `renderArtifact` open **no** transaction | `grep -n "'begin'" appPackets.ts` -> zero hits | this run |
| `evaluateArtifact` opens its own `begin`/`commit` | `appChecks.ts:264` | this run |
| `appCorrections`' two writers `begin`/`commit` their own write | `appCorrections.ts:281`, `:366` | this run |

## Step 0b — DECISION 1: `runPacketBuild`'s call at :1189 is **NOT** removed

The AC ruling says to remove it as redundant. **I am not removing it, and this is the brief's own
escape hatch ("if removing it would change behaviour in any way you cannot fully account for, DO NOT
remove it").** The reason is explicit and load-bearing in the code:

`runPacketBuild` builds all artifacts first, then runs `resolveEvidenceForOpp` (`appPackets.ts:1141`),
and only THEN evaluates. The comment at `appPackets.ts:1155-1157` states why:

> *"AFTER the evidence pass, because coverage is decided by the evidence rows it persists and the
> gate must read the same rows rather than a second resolution of the same question."*

A call placed inside `buildTemplatedArtifact` runs **before** the evidence pass on the build path.
Removing :1189 would therefore compute every build's gate against `requirement_evidence` rows that do
not exist yet — a silent coverage regression on the one path that works today.

So: the check call moves INTO `buildTemplatedArtifact` (one shared root, per AC 4b), and
`runPacketBuild` — and only `runPacketBuild` — passes `{ check: false }` to defer to its own
post-evidence call. That keeps exactly ONE `evaluateArtifact` run per artifact per build (AC 4d's
"not zero and not two") while closing the render-path bypass for `artifactDocument` / `artifactSlides`.

## Step 0c — DECISION 2: the shared helper lives in a NEW module `appRecheck.ts` (import-cycle check)

Cycle check, done before choosing a location (`grep -n "^import" appCorrections.ts appChecks.ts`):

- `appChecks.ts:19` imports `listCorrections` from `./appCorrections`.
- `appPackets.ts:16` imports `applyCorrectionPass` from `./appCorrections`.

So **both** candidate homes the AC named create a static cycle for `appCorrections`:
`appCorrections -> appChecks -> appCorrections`, and `appCorrections -> appPackets -> appCorrections`.
(`appPackets` itself is fine — it already imports `evaluateArtifact` from `appChecks` at line 19.)

Resolution: `api/src/functions/tests/appRecheck.ts`, which resolves `evaluateArtifact` through a
**dynamic `await import('./appChecks')` inside the function body**, so it adds no static edge at all.
Both `appPackets.ts` and `appCorrections.ts` import it statically. One implementation, zero cycles.
This is a NEW FILE — it must be included in the lane's commit.

---

## Step 1 — ITEM 1 (render-path bypass): DONE

New file `api/src/functions/tests/appRecheck.ts` — `recheckAfterTextWrite(client, artifactId, owner,
opts?)`. Never throws; returns `{ ok, error? }`. `evaluateArtifact` resolved via a dynamic
`await import('./appChecks')` (compiles to a lazy `require` — verified in
`dist/functions/tests/appRecheck.js:66`), so no static cycle exists.

`appPackets.ts`:
- `buildTemplatedArtifact` now takes `owner: string` and `opts?: { check?: boolean }` and calls
  `recheckAfterTextWrite` after `renderArtifact` (`appPackets.ts:839`). Failure rides out on
  `warnings`, so a build that produced a document still returns success.
- `artifactDocument` (`:870`) and `artifactSlides` (`:949`) pass `owner`; neither disables the check.
  **These two routes are the bypass and are now covered.**
- `runPacketBuild` (`:1139`) passes `owner, { check: false }` and KEEPS its own
  `evaluateArtifact` at the post-evidence position (see Decision 1). One run per artifact per build.

**Nested-transaction check:** `grep -n "'begin'" appPackets.ts` -> zero hits, so neither
`ensurePackage` nor `renderArtifact` holds an open transaction when the new call fires. No nesting
is introduced on the render path.

## Step 2 — ITEM 3 (four edit writers): DONE

All four call the one shared helper, after their write, non-fatally:

| Writer | File:line of the recheck | Transaction |
|---|---|---|
| `artifactContent` | `appPackets.ts:1539` | no txn — call follows the UPDATEs |
| `artifactAiEdit` | `appPackets.ts:1605` | no txn — call follows the UPDATEs |
| `correctionRevert` | `appCorrections.ts:307` | **after `commit`**, outside the txn |
| `artifactOwnerEdit` | `appCorrections.ts:406` | **after `commit`**, outside the txn |

`artifactContent`, `artifactAiEdit` and `artifactOwnerEdit` did not resolve an owner at all
(`requireWrite` only); each now does `resolveOwner(req)` for the recheck. All four responses gained
`checksStale` / `checksError` beside `ok: true`, so a save is never reported as a failure and the
client is told when the gate is stale (AC 2a's "report stale" half).

`ensurePackage` and `artifactRemediate` were NOT touched — they already evaluate.

**Build:** `cd api && npm run build` -> `tsc` clean, no output, exit 0.

**Smoke of the helper's non-fatal contract** (`node -e` against `dist`):
`recheckAfterTextWrite({}, 'a1', 'o@x', {evaluate: ok})` -> `{"ok":true}`, evaluator received
`("a1","o@x")`; with a throwing evaluator -> `{"ok":false,"error":"Error: boom"}` and **no throw**.

---

## Step 3 — GUARDS (appended to the end of `api/test/hardening.test.mjs`)

Three slugs, no numeric ids (H26). A local body extractor had to be named `anyAsyncFunctionBody`:
`asyncFunctionBody` already exists at `hardening.test.mjs:2649` and matches only
`export async function`, and `buildTemplatedArtifact` is not exported.

| Slug | What it asserts | Kind |
|---|---|---|
| `H:render-path-runs-checks` | `buildTemplatedArtifact` calls `recheckAfterTextWrite`; `artifactDocument` and `artifactSlides` build through it and never pass `check:false`; **exactly one** call site in the file may defer; `runPacketBuild` still calls `evaluateArtifact` and does so AFTER `resolveEvidenceForOpp` | source structure (an HTTP route + Google Drive + live pg cannot be exercised from `node --test`) |
| `H:text-write-rechecks` | all four writers call the shared helper, and the two that own a transaction call it AFTER `commit` (positional assertion, not mere presence) | source structure |
| `H:recheck-is-non-fatal` | a throwing evaluator yields `{ok:false,error}` and **does not throw**; the evaluator receives the artifact id and the session-resolved owner | **behavioural**, against `dist/` |

## Step 4 — MUTATION PROOF

### `mutate.sh` COULD NOT BE USED, and this is a constraint of the lane, not a choice

`/workspace/eds-claude-skills/scripts/mutate.sh` **refuses a file with uncommitted changes**
(`git diff --quiet -- "$FILE"` -> "NOT-APPLIED: ... has uncommitted changes"). Every file in this
lane is uncommitted and the brief forbids me from running any `git` command, so the refusal cannot
be cleared from here. Verbatim output of the attempt:

```
NOT-APPLIED: src/functions/tests/appPackets.ts has uncommitted changes.
             Commit or stash first -- otherwise a failed restore looks like your own edit.
```

**ACTION FOR THE COORDINATOR:** after committing this lane, re-run each mutation below with the real
`mutate.sh` — the anchors are reproduced verbatim so it is a copy-paste. I did not leave the guards
unproven: I ran the mutations through a harness that keeps mutate.sh's FOUR outcomes
(`FIRED` / `INERT` / `NOT-APPLIED` / `UNDETERMINED`), reads the anchor from a FILE (so a stale anchor
is caught, not fuzzily matched), refuses an ambiguous anchor, and replaces mutate.sh's `git` restore
oracle with a **sha256 comparison against the pre-mutation bytes**. It lives in the scratchpad, not
the repo — it is a stand-in for one lane, not a second system to maintain.

Every mutation FIRED. Every restore was asserted by sha256.

| # | File | Defect reinstated | Test that had to fail | Outcome | Restore |
|---|---|---|---|---|---|
| M1 | `appPackets.ts` | delete the `recheckAfterTextWrite` call from `buildTemplatedArtifact` (the bypass, exactly as found) | `H:render-path-runs-checks` | **FIRED** | sha256 match |
| M2 | `appPackets.ts` | `artifactDocument` passes `{ check: false }` (bypass reinstated at the route) | `H:render-path-runs-checks` | **FIRED** | sha256 match |
| M3 | `appPackets.ts` | delete `runPacketBuild`'s own post-evidence `evaluateArtifact` | `H:render-path-runs-checks` | **FIRED** | sha256 match |
| M4 | `appPackets.ts` | delete `artifactContent`'s recheck | `H:text-write-rechecks` | **FIRED** | sha256 match |
| M5 | `appCorrections.ts` | delete `artifactOwnerEdit`'s recheck | `H:text-write-rechecks` | **FIRED** | sha256 match |
| M6 | `appCorrections.ts` | move `correctionRevert`'s recheck INSIDE its transaction | `H:text-write-rechecks` | **FIRED** | sha256 match |
| M7 | `appRecheck.ts` | make the shared helper RETHROW (a checking failure fails the owner's write) | `H:recheck-is-non-fatal` | **FIRED** | sha256 match |

## Step 5 — BUILD AND TEST (actual numbers)

- `cd api && npm run build` -> `tsc`, no diagnostics, exit 0. Run again after the mutations restored.
- `node --test test/hardening.test.mjs` -> **tests 151, pass 151, fail 0**.
- `npm test` (build + **every** suite, `test/*.test.mjs`) -> **tests 1074, pass 1074, fail 0**, 15.4s.

## Step 6 — SELF-ATTACK (0b), findings and residuals

1. **Who reads what I wrote?** The four edit routes now return `checksStale` / `checksError` beside
   `ok: true`. **No frontend consumer exists yet** — I own only `api/` files this lane, and the field
   is what AC 2a asked for ("a `checksStale: true` field, or equivalent, so the client can show it").
   Flagged, not hidden: wiring `QcRail`/`AssetGateDrawer` to it is a separate item.
2. **Can the system produce it?** The helper's real path resolves `evaluateArtifact` through
   `await import('./appChecks')`. Executed for real against `dist/`:
   `appChecks loaded, evaluateArtifact is function`. In production the module is already loaded
   (appPackets imports it statically), so the dynamic import is a cache hit.
3. **How many homes does the concept have?**
   `grep -rn "update packet set pkg_json\|update artifact set content" src/functions/tests/*.ts`
   -> `appCorrections.ts:287,387`, `appPackets.ts:306,630,1525,1532,1598,1600`,
   `appRemediation.ts:266`. Of these: 630 = `ensurePackage` (build path, evaluated),
   266 = `artifactRemediate` (already evaluates), 1525/1532/1598/1600 + 287/387 = the four writers
   now wired. `renderArtifact`'s own write (`appPackets.ts:~802`) is covered at the shared root.
   `renderArtifact` has three other callers — `appBaseline.ts:371` (AC-ruled out of scope: synthetic
   `dismissed` opportunity, no posting, no requirements) and `appRemediation.ts:481` (already
   evaluates). Neither is affected: `renderArtifact`'s signature is unchanged.
4. **Delete each new load-bearing line — does a test fail?** M1-M7 above. All FIRED.

### RESIDUAL I DID NOT FIX, named rather than smoothed over

**`artifactGenerate` (`appPackets.ts:276`) is an eighth writer with the same defect and it is OUTSIDE
this lane's scope.** Its write is
`update artifact set content = $1, status = 'review', version_history = ... where id = $3`
(`appPackets.ts:306`) — it flips status to `review` UNCONDITIONALLY (not even the
`case when status='todo'` the render path uses) and calls nothing. The AC pass covered it as AC 4 and
left it `EXISTS-BUT-CONSTRAINED`, pending confirmation of whether any type it still serves is one
`runChecks` actually scores; the brief scoped me to items 1 and 3. **My guard's name is accurate —
it says "from the RENDER path" — so nobody should read it as covering `artifactGenerate`.**
Recommend it be resolved (fixed, or marked not-applicable with evidence) rather than left open.

### ONE BEHAVIOURAL CONSEQUENCE WORTH STATING

`artifactDocument` / `artifactSlides` return `ok: !built!.warnings?.length`. A recheck failure now
adds a warning, so those routes return `ok: false` (with a real `docUrl`) when the document was
produced but its gate could not be computed. That is deliberate and matches the existing P7 rule
("a partial build must not report unqualified success"); it is a response-shape change for those two
routes and is called out so it is not discovered as a surprise.

## FILES TOUCHED (for the commit)

- `api/src/functions/tests/appRecheck.ts` — **NEW FILE**, must be added.
- `api/src/functions/tests/appPackets.ts`
- `api/src/functions/tests/appCorrections.ts`
- `api/test/hardening.test.mjs` — appended at the end only.
- `docs/qc-evidence/IMPL-check-trigger-wiring.md` — this file.

No file outside the owned set was edited. No `git` command was run by this lane.

## Step 7 — FINAL RE-RUN (after a concurrent lane appended to the same test file)

`hardening.test.mjs` went from **151 tests to 159** between my first green run and my last: another
lane appended eight H-cases to the same file while this lane was running. One intermediate run showed
`159 tests / 158 pass / 1 fail`; the failing test could not be reproduced on the two runs either side
of it and was not one of mine — it is a concurrent lane mid-edit on shared source, and the
coordinator should re-run the suite once all lanes have landed rather than trust any single lane's
number.

Final state observed here, twice consecutively:

- `npm run build` -> `tsc` clean, exit 0
- `node --test test/hardening.test.mjs` -> **tests 159, pass 159, fail 0**
- my three guards by name:
  - `ok 149 - H:render-path-runs-checks: an artifact cannot reach status review from the render path unchecked`
  - `ok 150 - H:text-write-rechecks: every artifact-text writer re-runs the checks it just invalidated`
  - `ok 151 - H:recheck-is-non-fatal: a checking failure never fails the write that triggered it`
- smart-quote codepoint scan (python, not `grep -P`) over all four edited files: **0 hits**.
