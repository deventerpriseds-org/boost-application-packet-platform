# Local render UAT — app vs prototype, side by side, offline

**Read this before comparing the app to the prototype. It exists so the next session inherits the
method instead of rediscovering it — and, more importantly, inherits the ways it lies.**

---

## 0. The one thing to understand first

There are **two** instruments in this repo, and they are not interchangeable.

| | `compare-ui.mjs` / `render-app.mjs` (this doc) | `ui-verify.yml` |
|---|---|---|
| Runs | locally, in the sandbox, ~2s | GH runner, against the LIVE app |
| Data | **replayed fixtures** — canned JSON | **real production data** |
| Proves | structure, layout, what renders | what a user actually sees |
| Fidelity | exactly as good as the fixture file | real |

**The offline harness does not mirror a real run and cannot, by construction.** It intercepts
`**/api/**` and serves a hand-assembled file. Its purpose is to make the UI renderable offline —
mirroring production was assumed, never verified.

> **If the offline harness and `ui-verify.yml` ever disagree, the offline one is wrong.**
> A finding that matters — especially "the app is missing X" — gets confirmed on `ui-verify.yml`
> before it is reported to anyone.

---

## 1. Run it

```bash
# 0. one-time: prototype vendor bundle (react, react-dom, babel) must be local — the sandbox
#    cannot reach unpkg.com, and the prototype's index.html loads all three from there.
#    compare-ui.mjs rewrites those three <script src> to vendor/*.js in its work copy.
VENDOR=<dir containing react.js react-dom.js babel.js>

# 1. fixtures — from a FULL production dump (see §2). This step now REFUSES to write a
#    fixture that would be misread as a measurement.
node scripts/build-fixtures.mjs --raw raw-dump.json --opp <oppId> --out /tmp/fx.json

# 2. app side must be current, or you are diffing a stale bundle
(cd app && npm run build)

# 3. all seven steps
node scripts/compare-ui.mjs --all --vendor "$VENDOR" --fixtures /tmp/fx.json --json /tmp/gap.json
```

The seven steps are `jd`, `resume`, `cover`, `portfolio`, `video`, `qc`, `send`
(`compare-ui.mjs:49`). The app route is `#/packet/<oppId>/<step>` — `App.jsx:40`.

**To look at a step rather than diff it**, render both sides to PNG and read them. Structure is
mechanical; hierarchy, emphasis and spacing are judgement, and judgement needs eyes.

---

## 2. What a fixture MUST carry, and why each one is load-bearing

A missing input does not error. The app renders correctly against nothing, and **the nothing reads
exactly like a missing feature.** That is the entire failure mode.

| Key | Drives | If absent, it looks like |
|---|---|---|
| `/search-prefs` → **`.checks`** | every rule label — `≤ 24 chars each`, word bands, the gate contract | **the product has lost its character limits** |
| `/swaps` | every `original → final` row | the swap feature was never built |
| `requirements` | "Posting lines answered", coverage cards | the JD step is empty |
| `checkResults` | the whole Checks tab, every gate word | nothing is checked |
| `/opportunity/{id}/packet` **flat** | the header and the entire body | a blank company and no content |

Two traps that are properties of the harness, not of your usage:

1. **Fixture keys match as URL substrings, longest-match-wins.** A key `packet` matches
   `/api/app/packetS` and serves one object where a list is expected → renders `No packets yet.`,
   i.e. identical to real empty data. **Keys must be route paths.**
2. **`GET /app/opportunity/{id}/packet` returns the packet FLAT**, not wrapped
   (`appPackets.ts:219`). Wrapping it in `{ packet: … }` renders a blank header and empty body.

---

## 3. The guards, and what they refuse

Both were added on 2026-08-29 after this harness produced three false findings in one session.

- **`build-fixtures.mjs` exits non-zero and writes nothing** when the set is thin
  (no `requirements` / `checkResults` / `swaps` / `checks` thresholds). `--allow-thin` is the
  deliberate escape hatch for a smoke render where **you will count nothing**.
- **`compare-ui.mjs` runs a CANARY before any comparison** and exits 1 if the fixture cannot carry
  a finding — specifically if `/search-prefs` has no `checks`, or there is no `/swaps` key.

The principle both encode:

> **An instrument that cannot see has no standing to report an absence.**
> Prove the harness can see a known-present thing before letting it say anything is missing.

This is why they are exits and not warnings. The previous version *did* print
`!!! THIN FIXTURE SET - the next gap number will be INFLATED`. A session read that line on its own
terminal and proceeded anyway. **An advisory warning on a measuring instrument is worth nothing,
because the failure mode is an agent that already believes its number.**

---

## 4. What this harness has actually gotten wrong

Recorded so the next session recognises the shape rather than repeating it. All three are one
failure: **an absence created by the input, reported as an absence in the product.**

| Reported | Truth | The input error |
|---|---|---|
| "`supportIn` protects 0 of 20 template items" | wrong question entirely | fed it a two-word label; production feeds **profile records** (`evidence.ts:406`) |
| "5 of 7 steps are missing their UI" (app bodies 615–628 chars) | app was fine | raw-dump file used as a route-keyed fixture; key `packet` matched `/packets` |
| **"the 24/20 character limits have been removed from the app's code and/or pipeline"** | **live at 24 and 20** | `/search-prefs` carried no `checks`, so all 24 thresholds rendered unset |

The third is the expensive one. It was reported to the owner as a catastrophe. Ground truth, from
production the same hour:

```sql
select chk_skill_max_chars, chk_relevant_max_chars from owner_search_prefs;
--  24 | 20
```

`build-fixtures.mjs:88` had always written `f['/search-prefs'] = { prefs: {} }` — **no `checks` key
in any fixture this repo has ever produced.** So every offline render in its history showed every
threshold as unset, and the rule label degraded from `longest 22 chars · ≤ 24 chars each` to
`7 lines · 18 words`.

A fourth, not a fixture bug but the same class: **"the app has no `original → final` swap row."**
It has had one since `3a577b6` (2026-08-20), `AssetBlocks.jsx:377-382`. The grep was for a literal
`->`; the source emits `&rarr;`. **A failed search is not an absent feature.**

---

## 5. What it proves, and what it does not

**Proves:** which panels and controls render, in what order, with what disclosure state, given a
known payload. Regressions in structure. That a component mounts at all.

**Does NOT prove:**
- that a user sees it — that is `ui-verify.yml`, against the live app
- that the data is right — the fixture is a snapshot, and a stale one within hours
- that anything is **absent**. An absence here is a hypothesis. Confirm it in the source
  (read the import list, and search for the rendered entity, not the ASCII you assumed) and then
  on the live app, before it is stated as a fact.

**`bodyLen` is not a completeness measure.** Character counts were tabled as a step-by-step
comparison on 2026-08-29 and the owner rejected it correctly: *"why would lines of code be a
comparison for UI completeness?"* The app legitimately renders more than the prototype on several
steps (its `send` step is richer; its `qc` step far richer). Use `panelsOnlyInPrototype` /
`controlsOnlyInPrototype` — named elements — and confirm each one in code.

---

## 6. Where the denominator lives

`docs/qc-evidence/PROTOTYPE-COVERAGE.md` enumerates every prototype element against `SPEC.md`
§4.1–§4.12 with a `file:line` per row. **Re-reconcile it before quoting it** — it was measured at
`34eda36` and rows have closed since without the doc being updated (§4.11 reads 0% while
`AssetPanel`/`AssistantPanel.jsx` is mounted at `PacketBuilder.jsx:1101`). A ranking that is not
re-reconciled reports work as outstanding that is already done, already refused, or impossible.
