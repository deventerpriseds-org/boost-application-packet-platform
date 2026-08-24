# VERIFY — PR #47 (`claude/session-handoff-setup-ctozd3`)

Independent verifier. No shared context with the implementing session. Written incrementally.

- Repo: `deventerpriseds-org/boost-application-packet-platform`
- Scope: `git diff origin/main...HEAD`, origin/main = `06abee7`, HEAD = `02682c3`
- Commits in scope: `f619735`, `02682c3`
- Date of run: 2026-08-24

Diff stat (observed):

```
 .claude/actions.md                | 110 +++++++++++
 .claude/memory.md                 |  66 +++++++
 app/src/assetBlocks.js            |  30 ++--
 app/src/assetGate.js              |   4 +
 app/src/packetBuilder.js          |  50 ++++++
 app/src/postingAnalysis.js        |  29 ++-
 app/src/qcRail.js                 |  42 ++++++
 app/src/screens/AssetBlocks.jsx   | 158 +++++++++++++---
 app/src/screens/OppDetail.jsx     |  26 +++-
 app/src/screens/PacketBuilder.jsx |  73 ++++++---
 app/test/assetBlocks.test.mjs     |  39 ++++-
 app/test/packetBuilder.test.mjs   |  99 ++++++++++
 app/test/postingAnalysis.test.mjs |  61 +++++++-
 app/test/qcRail.test.mjs          | 111 ++++++++++++
 14 files changed, 848 insertions(+), 50 deletions(-)
```

---

## A. Suite + build (run by me, not reported by the implementer)

### `cd app && npm test`

Script is `node --test test/*.test.mjs` (app/package.json:10).

```
1..240
# tests 240
# suites 0
# pass 240
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 605.255741
```

**240 pass, 0 fail.** Cross-checked the total against per-file `test(` counts, which sum to 240:

```
apiForce 3 | assetBlocks 46 | assetGate 25 | corrections 25 | darkTheme 3 | highlight 7
overlay 11 | packetBuilder 5 | postingAnalysis 44 | postingCompare 25 | qcRail 46
```

### `cd app && npm run build`

```
vite v5.4.21 building for production...
✓ 243 modules transformed.
dist/index.html                     0.65 kB │ gzip:   0.42 kB
dist/assets/index-CGO9vNwe.css     36.32 kB │ gzip:   7.16 kB
dist/assets/index-Cjexy5K8.js   1,103.36 kB │ gzip: 297.46 kB
✓ built in 4.20s
```

**Build succeeds.** The only warning is the pre-existing >500 kB chunk-size advisory, not an error.

---

## CLAIM 1 — `offendersByField(result, checkKey)` — **CONFIRMED**

Source read: `app/src/qcRail.js:456–491`.

Each sub-assertion, against the code:

| Sub-claim | Evidence |
|---|---|
| Groups a check's offenders by merge field | `qcRail.js:474` `const field = sectionIdForOffender(checkKey, s)`, then `qcRail.js:481` `(byField[field] \|\| (byField[field] = [])).push(text)` |
| Uses the EXISTING `sectionIdForOffender` | Same line 474 — that function is defined once at `qcRail.js:378` and is the one `offenderLinks` already uses at `qcRail.js:425`. One parse, two consumers. |
| Does not define a second parse | The only string work after resolution is a *prefix strip* of the field already returned (`qcRail.js:476`: `s.startsWith(field + ':') ? s.slice(field.length + 1).trim() : s.trim()`) plus a whole-value quote strip (`:479`). Neither re-decides *which* field — they only remove a prefix the resolver already named. No `indexOf(':')`, no `split(':')`, no `MERGE_FIELDS` scan in this function. |
| Returns `null` for a missing check row | `qcRail.js:471` `if (!row) return null` |
| Returns a `{byField:{}}` object for present-but-clean | `byField` is initialised `{}` at `:472` and the loop body never runs when `offenders` is empty; the return at `:483` is `{ row, byField, state, expected }`. Distinguishable from `null`. |
| Drops offenders resolving to no field | `qcRail.js:475` `if (!field) continue` — no fallback bucket, no "unattributed" key. |

Runtime confirmation that the module actually loads and exports these (not just that they are typed in the file):

```
$ node --input-type=module -e "import * as q from './src/qcRail.js'; ..."
arr exported from qcRail: function
offendersByField: function
offendersForField: function
```

Note on the doc-comment's stated rationale ("SPLIT ON THE FIELD NAME, never on the first colon…
a kept phrase can itself contain a colon"): I checked this is real rather than decorative. Because
the strip is `s.slice(field.length + 1)`, a phrase containing a colon survives whole. This is
exercised by `H:wording-phrase-survives-whole` (observed passing, test #237), and I mutation-proved
that guard — see section B, mutation M1.
