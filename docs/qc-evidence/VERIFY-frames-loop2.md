# VERIFY-frames-loop2 — independent loop-2 verification of `5a6728d`

Verifier agent. No shared context with the implementer. Evidence only.

- Repo HEAD at start: `25fdd5f` (doc-only on top of `5a6728d`).
- **`api/` at HEAD is byte-identical to `api/` at `5a6728d`** — `git show --stat 25fdd5f` lists
  only `CLAUDE.md`. So testing the working tree == testing the commit under test.

Findings appended incrementally below.

---

## Method — I did NOT model the database. I ran the real routes.

Loop 1 modelled the `correction` table in JS. I stood up **PostgreSQL 16.13 locally with SSL** and
imported `api/dist/functions/tests/appCorrections.js`, so `applyCorrectionPass`,
`artifactOwnerEdit`, `correctionRevert` and `ensureCorrectionTable` all run for real against a live
server. The SELECT projection F-1 was about is the actual projection; `frame` is an actual column;
every CHECK constraint is enforced. Harnesses:

| file | what it drives |
|---|---|
| `docs/qc-evidence/loop2-e2e-routes.mjs` | the three real routes end to end: claims 1/3, the F-1 column-is-read probe, and 4 real rebuild shapes for claim 7 |
| `docs/qc-evidence/loop2-rebuild-detector.mjs` | whether the rebuild-detector branch is reachable with production-shaped data |

Setup (reproducible):
```
initdb -D /tmp/pgd -U postgres -A trust ; ssl=on with a self-signed cert (pgClient forces ssl)
pg_ctl -o '-p 55432 -k /tmp/pgsock -c listen_addresses=127.0.0.1' start
createdb ee ; create extension "uuid-ossp" ; create table packet(...) ; create table artifact(...)
DATABASE_URL=postgres://postgres@127.0.0.1:55432/ee node docs/qc-evidence/loop2-e2e-routes.mjs
```
`ensureCorrectionTable()` — the production DDL — created the table. Observed columns:
`applied_seq, artifact_id, before_sha256, char_end, char_start, created_at, frame, id, loop,
merge_field, phrase, reason, replacement, reverted_at, reverted_by, run_id, source`.

## Complete enumeration of every refusal `revertOne` can return

Extracted from `api/src/functions/tests/correction.ts` with comments stripped
(`reason:\s*(\`…\`|'…'|"…"|IDENT)`). Reachable from `revertOne`:

| # | reason | asserts a cause? |
|---|---|---|
| 1 | `` `no applied correction with seq ${seq}` `` | no |
| 2 | `` `this change log contains a change of a kind this version cannot place (${names}), so nothing was undone` `` | no |
| 3 | `'this field was rebuilt after you edited it, so the changes are recorded in an order this version cannot safely unpick'` | **YES — a rebuild AND a human edit** |
| 4 | `` `this text no longer matches the change log (change ${n} is not where the record says it is)` `` | no |
| 5 | `STALE_STATE_REASON` (x2 sites) | no — names both possibilities, accuses neither |
| 6 | `` `this text no longer matches the change log (${e.message})` `` (x2 sites) | no |
| 7 | `` `undoing this would lose your edit: ${at.reason}` `` where `at.reason` ∈ {`'the edit records no phrase to find'`, **`'this field was rewritten and no longer contains the words you changed'`**, `'those words now appear more than once in this field…'`} | **the middle one asserts the field was rewritten** |

The sentence claim 7 was about — *"this field was edited after the correction was applied"* — is
**gone from the module**; both of its call sites now return `STALE_STATE_REASON`.

## CONFIRMED — F-1 is really fixed: the `frame` column is READ by the production route

`loop2-e2e-routes.mjs`, against the live DB. Adversarial probe: store a `frame` that contradicts
the `source`→frame map on a real `owner_edit` row and see whether the outcome changes.

```
stored rows          : seq1/generalized/frame=original  seq2/owner_edit/frame=applied
frame column forced to ORIGINAL (map says applied)
revert result        : {"ok":false,"reason":"this text no longer matches the change log (correction 2 is not where the record says it is)"}
revert with truthful frame=applied: {"ok":true,"merge_field":"F","text":"Led 8-figure supplier negotiation across teams"}
ok      F-1 FIXED: a stored frame that contradicts the source map CHANGES the outcome ⇒ the column is READ
```
The map's answer would have been `ok:true`. The column's answer is a refusal. **CONFIRMED.**

## CONFIRMED — claims 1 and 3, re-derived through the real routes (not a fixture)

```
pipeline rows planned: 1 [["$18M","8-figure"]]
text after pass      : "Led 8-figure supplier negotiation across teams"
owner edit           : {"ok":true,...,"text":"Led 8-figure Vendor selection across teams","applied_seq":2}
revert OWNER row     : {"ok":true,"text":"Led 8-figure supplier negotiation across teams"}   ← claim 1a
revert PIPELINE row  : {"ok":true,"text":"Led $18M Vendor selection across teams"}           ← claim 1b
revert with frame=NULL on every row (legacy): {"ok":true,...}                                 ← claim 3
```
Claim 3 is the no-backfill guarantee: with `frame` NULLed on every row in the database, both rows
still revert through `CORRECTION_FRAME`. **CONFIRMED.**
