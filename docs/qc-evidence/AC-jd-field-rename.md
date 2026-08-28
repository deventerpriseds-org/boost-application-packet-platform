# AC + Feasibility — JD column rename (`jd_real` / `raw_jd` / `jd_text`)

**Status:** FEASIBILITY + ACs ONLY. Nothing implemented. No other file edited.
**Base:** `origin/main` = `91da5e2` (local HEAD identical; `git fetch origin` run at session start).
**Date:** 2026-08-28

The proposed, owner-approved rename:

| Current | Proposed | Meaning per the owner's wording |
|---|---|---|
| `opportunity.jd_real` | `jd_html` | HTML-formatted posting body |
| `opportunity.raw_jd` | `jd_posting_raw` | plain-text posting SOURCE |
| `opportunity.jd_text` | `jd_posting_snapshot` | hash-pinned SNAPSHOT that requirement extraction recomputes from the source on every run; the thing `char_start`/`char_end` index into |
| `opportunity.jd_source` | UNCHANGED | — |

---

## 0. GROUND TRUTH — what actually distinguishes `jd_real` from `raw_jd`

The brief flagged that a previous session got this wrong and was corrected by the owner. Checked
against the code rather than against the column names.

**OBSERVATION (proven by reading the source):** the two columns differ by **FORMAT / NORMALIZATION
PATH**, not by provenance. Both can hold page-fetched text.

- `api/src/functions/tests/jdText.ts:85-93` — `resolvePostingSource()`:
  ```ts
  export function resolvePostingSource(opp: any): { text: string; source: 'jd_real' | 'raw_jd' | null } {
    const real = normalizePostingText(opp?.jd_real)          // 86: strips tags, decodes entities
    if (real) return { text: real, source: 'jd_real' }
    const raw = opp?.raw_jd || ''                            // 88
    // raw_jd skips the HTML normalizer, so fold astral characters here or its offsets stop being
    // addressable from SQL — the same invariant normalizePostingText guarantees for jd_real.
    if (raw && !isAlertDigest(raw, opp?.why_surfaced || '')) return { text: toBmp(raw), source: 'raw_jd' }
    return { text: '', source: null }
  }
  ```
  `jd_real` goes through `normalizePostingText` (tag-strip + entity-decode + astral-fold);
  `raw_jd` goes through `toBmp` **only** (astral-fold). The comment at `jdText.ts:89-90` states the
  distinction explicitly: *"raw_jd skips the HTML normalizer."*
- `api/src/functions/tests/jdText.ts:5-6` — `jd_real` stores `descriptionHtml`, i.e. **HTML**.
- Confirmed at the writer: `jdBackfill.ts:66` and `jdBackfill.ts:512` both
  `update opportunity set jd_real = $1` with `[jd.descriptionHtml, ...]` — HTML.

**The brief's claim is CONFIRMED, with file:line:**

- `api/src/functions/tests/appJdParse.ts:152-155` — `jdParse` fetches a **page** and writes the
  fetched text into **`raw_jd`**, not `jd_real`:
  ```ts
  const fetched = await fetchPageText(url) || ''
  if (fetched && !isAlertDigest(fetched, opp.why_surfaced || '')) {
    rawJd = fetched
    await client.query(`update opportunity set raw_jd = $1 where id = $2`, [fetched, oppId])
  }
  ```
  The same page-fetch→`raw_jd` write appears again at `appJdParse.ts:219` and `appJdParse.ts:316`.
- `api/src/functions/tests/appCapture.ts:47` also writes `raw_jd` (browser-extension capture).
- `api/src/functions/tests/mailWatch.ts:356` writes `raw_jd` (email body).

**INTERPRETATION:** "raw = from the email, real = fetched from the page" is FALSE. Page-fetched text
lands in `raw_jd` from three separate call sites. The real axis is
**HTML (`jd_real`) vs already-plain-text (`raw_jd`)**, which is exactly what the proposed
`jd_html` / `jd_posting_raw` names encode. **The proposed naming is more accurate than the current
naming.** That is a point in the rename's favour and it is evidence-backed.

**Precedence, also ground truth:** `resolvePostingSource` **prefers `jd_real` over `raw_jd`**
(`jdText.ts:86-87` returns early). `jd-import.yml:99-105` already guards on exactly this.

---

## 1. FEASIBILITY TABLE

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (command + result) | Verdict |
|---|---|---|---|---|
| `opportunity.jd_real` → `jd_html` | `jdBackfill.ts:66,512` (`descriptionHtml`); `jdSearch.ts:175` fill | `resolvePostingSource` `jdText.ts:86`; `groundingText` `jdText.ts:65`; `termMiner.ts:112`; `appApply.ts:201,225`; `appJdParse.ts:89,139,197,297` | `grep -rn jd_real api/src app/src api/test app/test scripts .github/workflows docs` → **151 hits** | EXISTS |
| `opportunity.raw_jd` → `jd_posting_raw` | `appJdParse.ts:155,219,316`; `mailWatch.ts:356`; `appCapture.ts:47`; `jd-import.yml` | `resolvePostingSource` `jdText.ts:88-91`; `isAlertDigest`; `appJdParse.ts:272-273` counters | same sweep → **60 whole-word hits** (see §2) | EXISTS |
| `opportunity.jd_text` → `jd_posting_snapshot` | `appRequirements.ts:400` (`set jd_text=$1, jd_text_sha256=$2, jd_text_truncated=$3`); cleared at `:433` | requirement offset re-verification; `requirements.ts:361` | same sweep → **54 whole-word hits** (the naive 135 counts `jd_text_sha256`; see §2) | EXISTS |
| `resolvePostingSource()` | n/a (pure fn) — `jdText.ts:85` | `appReviewer.ts:115`, `appPackets.ts:445,536`, `appChecks.ts:52`, `appJdParse.ts:65`, `requirements.ts:381` | `grep -rn resolvePostingSource` → 6 call sites + 5 doc-comment refs | EXISTS — **the single funnel** |
| Requirement offset path (`char_start`/`char_end`) | `appRequirements.ts:400` pins snapshot + sha256 | offsets index the snapshot; `requirements.ts:14,372` document the invariant | `requirements.ts:372` — *"Offsets index `jd_text`, which is the EMPLOYER'S text (`resolvePostingSource`)"* | EXISTS-BUT-CONSTRAINED — see §3, the column is named in a **stored sha256 contract** |
| SCHEMA_SQL DDL homes | `schema.ts` | applied on every deploy | see §1a below — **more than one home** | **EXISTS-BUT-CONSTRAINED — 2+ homes, one runs at REQUEST time** |
| `.github/workflows/*.yml` | `jd-import.yml` writes the SOURCE | — | see §2 | EXISTS |
| `app/src` frontend refs | — | see §2 | see §2 | see §2 |
| `api/test/*.mjs` guards | — | grep-based structural guards | see §2 | see §2 |

### 1a. THE DDL HOMES — the single most important finding in this document

There is **more than one** place that creates these columns, and they do not all run at deploy time.

**HOME 1 — `api/src/functions/tests/schema.ts`** (the `SCHEMA_SQL` template, re-run on every deploy).

**HOME 2 — `api/src/functions/tests/appJdParse.ts:17-30`, `ensureJdColumns()`** — runs at
**REQUEST time**, on every `POST /api/app/opportunity/{id}/jd-parse`:

```ts
// Ensure the 5 JD columns and raw_jd exist on the opportunity table.
async function ensureJdColumns(client: any) {
  await client.query(`
    alter table opportunity
      add column if not exists raw_jd         text,
      ...
      add column if not exists jd_real         text,
      add column if not exists jd_fetched_at   timestamptz
  `)
}
```

**CONSEQUENCE, and it is severe:** if the rename is applied but `ensureJdColumns` is not updated in
the same change, then **the very next `jd-parse` request silently re-creates `raw_jd` and `jd_real`
as EMPTY columns** alongside the renamed ones. The table then has both `jd_html` (populated) and
`jd_real` (empty, NULL for every row). `resolvePostingSource` reading the wrong one returns `''` →
`source: null` → every downstream evidence path degrades to "no employer text", silently. This is a
**data-integrity failure that no build, no type-check and no fresh-database schema run would catch**,
because `add column if not exists` succeeds either way and `tsc` cannot see a SQL string.

This is the same class as the CLAUDE.md-recorded miss: *"A third DDL home was missed, and
`H:correction-ddl-parity` compared only the `source` domain, so it was structurally blind."*

`ensureJdColumns` is called at `appJdParse.ts:137` (and the sweep entry points). Verified below.

### 1b. ALL DDL HOMES — verified sweep

Command (run from repo root; `.claude/worktrees/**` excluded — those are stale agent worktrees, not
shipped code):

```
grep -rn "add column if not exists *\(jd_real\|raw_jd\|jd_text\)" --include=*.ts --include=*.mjs --include=*.yml --include=*.sql .
```

| # | File:line | Columns created | **When it runs** | Verdict |
|---|---|---|---|---|
| 1 | `api/src/functions/tests/schema.ts:1090-1092` | `jd_text`, `jd_text_sha256`, `jd_text_truncated` | **deploy** (SCHEMA_SQL) | EXISTS |
| 2 | `api/src/functions/tests/appJdParse.ts:20,26` (`ensureJdColumns`) | `raw_jd`, `jd_real` | **REQUEST** — called at `:137`, `:194`, `:295` | **EXISTS-BUT-CONSTRAINED** |
| 3 | `api/src/functions/tests/jdBackfill.ts:21` | `jd_real` | **REQUEST/timer** | **EXISTS-BUT-CONSTRAINED** |
| 4 | `api/src/functions/tests/mailWatch.ts:355` | `raw_jd` | **REQUEST** | **EXISTS-BUT-CONSTRAINED** |
| 5 | `api/src/functions/tests/appCapture.ts:46` | `raw_jd` | **REQUEST** | **EXISTS-BUT-CONSTRAINED** |
| 6 | `api/src/functions/tests/appRequirements.ts:116-118` | `jd_text`, `jd_text_sha256`, `jd_text_truncated` | **REQUEST** | **EXISTS-BUT-CONSTRAINED** |
| 7 | `api/test/dimensionsDb.test.mjs:93-96` | all three (test fixture) | test | EXISTS |

**`jd_real` and `raw_jd` are NEVER created by `SCHEMA_SQL` at all.** Their only DDL homes are the
five request-time `ensure*` helpers. Verified: `grep -n "jd_real\|raw_jd" api/src/functions/tests/schema.ts`
returns only comments (`:235`, `:1088`) and the **CHECK-constraint literal** at `:351` — no
`add column` for either. So a migration written only in `SCHEMA_SQL` renames columns that
five other code paths will immediately re-create.

**SIX request-time re-creation sites must be edited in the same commit as the rename, or the rename
silently self-reverts into a split-brain table.**

### 1c. `jd_source` — the rename has a DATA-VALUE dimension, not just a column-name one

`opportunity.jd_source` is listed as UNCHANGED, and its *column name* is. But a **different**
`jd_source` — `requirement.jd_source` — stores the **string literals `'jd_real'` / `'raw_jd'`** as
data, under a CHECK constraint:

- `api/src/functions/tests/schema.ts:351` — `jd_source text check (jd_source in ('jd_real','raw_jd'))`
- `api/src/functions/tests/requirements.ts:363` — `jd_source: 'jd_real' | 'raw_jd' | null` (TS union)
- `api/src/functions/tests/jdText.ts:85` — `resolvePostingSource` returns `source: 'jd_real' | 'raw_jd' | null`
- `api/src/functions/tests/requirements.ts:419` — `jd_source: source` (the value is persisted)
- `api/src/functions/tests/appRequirements.ts:409,414` — INSERT carries `jd_source`

`jd_source`: **49 refs across 7 files.**

**PROVEN by execution** (local PostgreSQL 16.13, per the CLAUDE.md recipe):

```
create table requirement(id int, jd_source text check (jd_source in ('jd_real','raw_jd')));
insert into requirement values (1,'jd_real');   -- exit=0
insert into requirement values (2,'jd_html');   -- ERROR: new row ... violates check constraint
                                                --        "requirement_jd_source_check"  exit=1
```

And the constraint is **not** repairable by re-running the CREATE on a populated database:

```
create table if not exists requirement(id int, jd_source text check (jd_source in ('jd_html','jd_posting_raw')));
NOTICE:  relation "requirement" already exists, skipping
select pg_get_constraintdef(...) -> CHECK ((jd_source = ANY (ARRAY['jd_real'::text, 'raw_jd'::text])))
```

**CONSEQUENCE:** if the TS union is renamed to `'jd_html' | 'jd_posting_raw'` without an explicit
`drop constraint` / `add constraint` migration, **every requirement extraction fails at INSERT** with
a check-constraint violation. This is a hard, loud, total outage of requirement extraction — not a
silent degradation. It is the one failure mode in this document that cannot ship unnoticed, which
paradoxically makes it *less* dangerous than finding #1a.

There is a third option, and it is the cheapest: **leave the stored provenance values as the strings
`'jd_real'`/`'raw_jd'`** and rename only the columns. That decouples the data contract from the
column names — at the cost of the exact naming confusion the rename exists to remove. This is a
decision the owner must make; it is not a detail to be settled by the implementer.

---

## 2. EXACT REFERENCE INVENTORY

Sweep: `api/src app/src api/test app/test scripts .github/workflows docs`, **this document excluded**,
`\b` word boundaries (a plain `jd_text` grep also matches `jd_text_sha256` and inflates the count by
81 — the naive number is 135, the true whole-word number is 54).

### Totals

| Name | Whole-word refs | Files | Code only (excl. `docs/`) |
|---|---|---|---|
| `jd_real` | **151** | 35 | 96 refs / 26 files |
| `raw_jd` | **60** | 20 | 56 refs / 18 files |
| `jd_text` | **54** | 15 | 42 refs / 11 files |
| **Sum of the three** | **265** | — | **194** |
| Unique LINES (a line naming two names counted once) | **234** | **40 files** | 164 lines / 29 files |

**Not in the proposal but structurally coupled — these must be scoped in or explicitly excluded:**

| Name | Refs | Files | Note |
|---|---|---|---|
| `jd_text_sha256` | **82** | 15 | the hash that pins the snapshot; `schema.ts:352` is `not null` |
| `jd_text_truncated` | **11** | 5 | sibling of `jd_text` |
| `jd_source` (incl. the stored literals) | **49** | 7 | see §1c |

If `jd_text` → `jd_posting_snapshot`, leaving `jd_text_sha256` un-renamed produces
`jd_posting_snapshot` + `jd_text_sha256` — a pairing *less* coherent than today's. Renaming them too
adds **93 more references**, taking the true job to **~358 references / ~45 files**.

### Verdict on the "102 refs / 32 files" prior estimate — **INCORRECT, a substantial undercount**

No interpretation of the sweep reproduces it:

| Reading | Refs | Files |
|---|---|---|
| `api/src` + `app/src` only, unique lines | 91 | 21 |
| all code (excl. `docs/`), unique lines | 164 | 29 |
| all code + `docs/`, unique lines | **234** | **40** |
| all code + `docs/`, summed occurrences | **265** | 40 |
| …including `jd_text_sha256` + `jd_text_truncated` | **~358** | ~45 |

The honest figure for "lines a human must review" is **234 lines across 40 files**, rising to ~358
if the sibling columns are included. **Do not plan against 102.**

### Per-file counts

`jd_real` (151):

| Count | File |
|---|---|
| 38 | `docs/qc-evidence/fixtures.json` |
| 14 | `api/test/requirements.test.mjs` |
| 12 | `api/src/functions/tests/jdBackfill.ts` |
| 7 | `api/test/generationJd.test.mjs` |
| 7 | `api/src/functions/tests/appJdParse.ts` |
| 6 | `api/test/hardening.test.mjs` |
| 6 | `api/src/functions/tests/jdText.ts` |
| 5 | `api/src/functions/tests/appPackets.ts` |
| 5 | `.github/workflows/jd-import.yml` |
| 4 | `docs/qc-evidence/BACKLOG.md`, `api/src/functions/tests/figureEcho.ts`, `api/src/functions/tests/appApply.ts` |
| 3 | `docs/qc-evidence/TERM-LIBRARY-SAMPLES.md`, `docs/qc-evidence/DEFECT-REGISTER-2026-08-23.md`, `api/src/functions/tests/termMiner.ts`, `api/src/functions/tests/schema.ts` |
| 2 | `Evidence Model & QC Lineage.html`, `AC-term-library-lane.md`, `api/test/jdText.test.mjs`, `api/test/figureEcho.test.mjs`, `api/test/dimensionsDb.test.mjs`, `requirements.ts`, `jdSearch.ts`, `appRequirements.ts` |
| 1 | `P8.1-ACCEPTANCE.md`, `AC-term-library-build.md`, `AC-anchored-requirements.md`, **`app/src/screens/OppDetail.jsx`**, `api/test/appReviewer.test.mjs`, `mailWatch.ts`, `checks.ts`, `artifactScore.ts`, `appReviewer.ts`, `appRemediation.ts`, `appChecks.ts` |

`raw_jd` (60):

| Count | File |
|---|---|
| 15 | `.github/workflows/jd-import.yml` |
| 13 | `api/src/functions/tests/appJdParse.ts` |
| 5 | `api/test/requirements.test.mjs` |
| 4 | `api/src/functions/tests/jdText.ts` |
| 3 | `docs/qc-evidence/fixtures.json`, `api/test/generationJd.test.mjs`, `api/src/functions/tests/mailWatch.ts` |
| 2 | `appRequirements.ts`, `appCapture.ts` |
| 1 | `DEFECT-REGISTER-2026-08-23.md`, `hardening.test.mjs`, `dimensionsDb.test.mjs`, `appReviewer.test.mjs`, `schema.ts`, `requirements.ts`, `jdBackfill.ts`, `appReviewer.ts`, `appRemediation.ts`, `appPackets.ts`, `appChecks.ts` |

`jd_text` (54, whole-word):

| Count | File |
|---|---|
| 11 | `api/test/requirements.test.mjs` |
| 9 | `.github/workflows/jd-import.yml` |
| 6 | `docs/qc-evidence/AC-anchored-requirements.md` |
| 6 | `api/src/functions/tests/appRequirements.ts` |
| 4 | `api/src/functions/tests/appReviewer.ts` |
| 3 | `docs/qc-evidence/fixtures.json`, `api/test/dimensionsDb.test.mjs`, `api/src/functions/tests/requirements.ts` |
| 2 | `docs/qc-evidence/AC-P8.3.md`, `api/src/functions/tests/schema.ts` |
| 1 | `RENDER-COMPARE-PACKET.md`, **`app/src/screens/PacketBuilder.jsx`**, **`app/src/postingAnalysis.js`**, `api/test/appReviewer.test.mjs`, `api/src/functions/tests/jdText.ts` |

### The frontend is very nearly a non-participant — a genuinely favourable finding

```
grep -rnE "\b(jd_real|raw_jd|jd_text)\b" app/src
app/src/postingAnalysis.js:646:   // is opportunity.jd_text, whose length arrives as `jdTextLen` from the requirements endpoint, and
app/src/screens/PacketBuilder.jsx:832:  //  passed off as what the employer wrote. The employer's own text is opportunity.jd_text,
app/src/screens/OppDetail.jsx:181:  // A JD not yet fetched carries the anchor-truth placeholder (jd_real still null). Distinguish it
```

**All 3 frontend references are COMMENTS.** No JSX, no API-shape field, no state key. The frontend
consumes `jdTextLen` from the requirements endpoint, never the column. **Verdict: `app/src` is
EXISTS-BUT-CONSTRAINED → effectively out of scope**, which removes the whole JSX/smart-quote/esbuild
risk class from this change. Frontend work is 3 comment edits.

### `api/test` grep-based structural guards

`api/test/hardening.test.mjs:313-320` asserts on the **literal string** `jd_real`:

```js
// duplicated across four call sites and every one of them omitted jd_real.
assert.ok(/jd_real/.test(proj), 'the projection must carry the employer posting')
  'the old jd_real-less projection must not reappear')
```

This guard **inverts** under the rename: it demands the projection contain `jd_real`, so after a
correct rename it FAILS. That is desirable — it is a tripwire that makes a half-done rename loud
rather than silent — but it means `hardening.test.mjs` must be edited in the same commit, and the
edit must preserve the invariant (*the projection carries the employer posting*) rather than delete
the assertion. Also at `:109` (fixture), `:657`, `:713` (evidence comments).

---

## 3. THE MIGRATION SHAPE QUESTION — answered by EXECUTION, not opinion

All four results below were produced against the container's **PostgreSQL 16.13**
(`/usr/lib/postgresql/16`), following the recipe in `CLAUDE.md` ▸ *"Run the schema locally."*

### 3a. Can this be a bare `alter table ... rename column` in SCHEMA_SQL? **NO.**

```
create table opportunity(id int, jd_real text, raw_jd text, jd_text text);
insert into opportunity values (1,'<p>html</p>','plain','snap');

-- FIRST deploy
alter table opportunity rename column jd_real to jd_html;    -> exit=0

-- SECOND deploy (SCHEMA_SQL re-runs; the rename is already applied)
alter table opportunity rename column jd_real to jd_html;
ERROR:  column "jd_real" does not exist
exit=1
```

**Answer to the precise question asked — what happens on the SECOND deploy after the rename:**
the statement **errors**, and because the migration is run with `psql -v ON_ERROR_STOP=1` (mandated
by `CLAUDE.md`: *"`ON_ERROR_STOP=1` is required: without it `psql` reports success having skipped
every statement after the first error"*), **it aborts the entire migration at that line.** Every
`alter table` / `create index` below the rename in `SCHEMA_SQL` never executes. The next deploy that
adds any column would appear to succeed in CI and silently not apply. This is a **self-inflicted
outage on deploy #2**, not a cosmetic wart.

### 3b. Is there an `IF EXISTS` escape hatch? **NO — it does not parse.**

```
alter table opportunity rename column if exists raw_jd to jd_posting_raw;
ERROR:  syntax error at or near "exists"
exit=1
```

PostgreSQL supports `ALTER TABLE IF EXISTS` (guarding the **table**), but there is **no `IF EXISTS`
for the column in a `RENAME COLUMN`**. So idempotency cannot be bought with a keyword; it requires a
conditional block.

### 3c. The pattern this rename MUST follow — and it already exists in this very file

**This is EXTEND-existing, not invent-new.** `SCHEMA_SQL` already contains a proven idempotent-rename
idiom, written for exactly this hazard, at **`api/src/functions/tests/schema.ts:1106-1123`**:

```sql
do $$
declare fk text;
begin
  if exists (select 1 from information_schema.columns
              where table_name='remediation_loop' and column_name='must_have_check_key')
     and not exists (select 1 from information_schema.columns
              where table_name='remediation_loop' and column_name='close_check_key') then
    ...
    alter table remediation_loop rename column must_have_check_key to close_check_key;   -- :1121
    alter table remediation_loop rename column must_have_state    to close_state;        -- :1122
    alter table remediation_loop rename column prev_must_have_state to prev_close_state; -- :1123
  end if;
end $$;
```

The guard is a **double condition** — *old column present* AND *new column absent*. Both halves are
required: the first alone re-fires if something re-creates the old column (which §1a proves five code
paths do); the second alone would skip a genuine first run.

**PROVEN idempotent by execution** (3 consecutive runs on a populated table):

```
run 1 -> exit=0     run 2 -> exit=0     run 3 -> exit=0
select jd_html from opportunity  ->  <p>h</p>     (data preserved, not dropped/re-added)
```

The comment at `schema.ts:1104-1105` also states the reason to prefer RENAME over add+drop, and it
applies verbatim here: *"the old columns hold the same values under the old names, and a database
that ran the earlier revision may already have ledger rows in them."* `jd_real`/`raw_jd`/`jd_text`
hold live production data on ~1,349 parsed opportunities — **add-new + copy + drop-old is not
acceptable**; rename preserves the rows atomically.

### 3d. The exact DDL to change, with file:line

| # | File:line | Today | Required change |
|---|---|---|---|
| 1 | `schema.ts:1090-1092` | `add column if not exists jd_text / jd_text_sha256 / jd_text_truncated` | rename to the new name, and **add the guarded `do $$` rename block** for all three columns |
| 2 | `schema.ts:351` | `jd_source text check (jd_source in ('jd_real','raw_jd'))` | **decision required** (§1c) — CHECK is not updated by `create table if not exists` on a populated DB (proven) |
| 3 | `appJdParse.ts:20,26` | `add column if not exists raw_jd / jd_real` | rename — **or the rename self-reverts (§1a)** |
| 4 | `jdBackfill.ts:21` | `add column if not exists jd_real` | rename |
| 5 | `mailWatch.ts:355` | `add column if not exists raw_jd` | rename |
| 6 | `appCapture.ts:46` | `add column if not exists raw_jd` | rename |
| 7 | `appRequirements.ts:116-118` | `add column if not exists jd_text …` | rename |
| 8 | `api/test/dimensionsDb.test.mjs:93-96` | fixture DDL | rename |

**Ordering constraint (`H39`/`H39b`):** the guarded rename block must sit **ABOVE** every statement
that names the new column, and the `add column if not exists <new>` lines must come **AFTER** the
rename — otherwise `add column if not exists jd_posting_snapshot` runs first, creates an **empty**
column, and the rename's `not exists (…'jd_posting_snapshot')` guard then evaluates FALSE, so the
rename never fires and the real data stays in `jd_text` forever. That is a silent no-op that leaves
a fully-populated old column and an empty new one — exactly the failure `H39b` was written for.

**Migration-shape verdict: FEASIBLE, but only as a guarded `do $$` block placed above the adds, and
only if all 8 DDL sites move in one commit.** A bare `alter table … rename column` in `SCHEMA_SQL`
is **NOT viable** — it breaks deploy #2.

---

## 4. BLAST RADIUS / INTEGRATION TRACE

### The ONE core function every consumer funnels through

**`resolvePostingSource(opp)` — `api/src/functions/tests/jdText.ts:85`.**

It is the only place in the codebase that reads `jd_real` and `raw_jd` *for evidence purposes* and
decides which one wins. `jdText.ts:76-84` states this is deliberate and distinct from
`groundingText()`, because `groundingText` falls back to `jd_summary`/`jd_requirements`, which are
**model output** — *"a character offset into the model's own summary quotes the model, not the
employer."*

**Upstream producers** (write the columns it reads):

| Producer | Column | Line |
|---|---|---|
| `jdBackfill.ts` | `jd_real` (`descriptionHtml`) | `:66`, `:512` |
| `jdSearch.ts` | `jd_real` fill for fresh opps | `:175` |
| `appJdParse.ts` | `raw_jd` (page fetch) | `:155`, `:219`, `:316` |
| `mailWatch.ts` | `raw_jd` (email body) | `:356` |
| `appCapture.ts` | `raw_jd` (extension capture) | `:47` |
| `.github/workflows/jd-import.yml` | `raw_jd` (committed file) | write step |

**Downstream consumers** (call the funnel):

| Consumer | Line | What it does with it |
|---|---|---|
| `requirements.ts` | `:381` `resolvePostingSource(opp)` | **the offset path** — `:419` persists `jd_text`, `jd_text_sha256`, `jd_source` |
| `appChecks.ts` | `:52` | R3 check; `:47` comment forbids `groundingText` here |
| `appPackets.ts` | `:445`, `:536` | packet grounding |
| `appReviewer.ts` | `:115` | *"the same function the extractor used, never a second regex"* (`:114`) |
| `appJdParse.ts` | `:65` `resolveJdSource()` | single-job source gate |
| `checks.ts` | `:208`, `:417` | documents the invariant |

**Second-order consumers reading the columns directly, bypassing the funnel** (these are the ones a
`resolvePostingSource`-only edit would MISS):

`termMiner.ts:112` (`length(coalesce(jd_real,'')) > 200`), `appApply.ts:201,225`
(`coalesce(length(jd_real),0) > 200`), `appJdParse.ts:89,139,197,297` (SELECT projections),
`appJdParse.ts:272-273` (`count(*) filter (where … raw_jd is not null …)`), `figureEcho.ts` (4),
`artifactScore.ts` (1), `appRemediation.ts` (1), `appReviewer.ts` (11 × `jd_text`).

These are **raw SQL strings**. `tsc` cannot see inside them. A missed one fails at **runtime**, on
production, as `ERROR: column "jd_real" does not exist` — or worse, silently returns 0 rows if the
old column was re-created empty by §1a.

### The offset invariant — why `jd_text` is the highest-stakes of the three

`requirements.ts:372` — *"Offsets index `jd_text`, which is the EMPLOYER'S text
(`resolvePostingSource`)"*; `requirements.ts:361` — *"the EXACT string every offset indexes. Persist
it, or offsets rot."* The snapshot is pinned by `jd_text_sha256` (`schema.ts:352`,
**`not null`**, comment: *"offsets are only valid against THIS posting body"*).

**Favourable finding:** a column RENAME does not change any stored *value*. `jd_text`'s bytes,
its sha256, and every `char_start`/`char_end` are untouched. The offset invariant survives a rename
**provided the rename is a true `RENAME COLUMN` and not an add+copy+drop** (a copy through a
different encoding path would change bytes and invalidate every stored sha256). §3c's pattern is a
true rename. **Verdict: the offset invariant is NOT at risk from the rename itself** — only from a
botched migration shape.

### EXTEND vs NEW

**EXTEND-existing, unambiguously.** No new table, column, endpoint or subsystem is created. The
migration idiom already exists at `schema.ts:1106-1123` and is reused verbatim. The single funnel
`resolvePostingSource` already exists and is not being duplicated. There is **no parallel system**
being stood up. Per CLAUDE.md ▸ *"Extend, don't duplicate"*, this passes.

---

## 5. ACCEPTANCE CRITERIA

Each is binary and observable. "Works correctly" appears nowhere.

### Group A — the rename is actually applied

**AC-1 (rename applied, data preserved).**
Given the production `opportunity` table with populated `jd_real`, `raw_jd` and `jd_text`, when the
post-deploy `SCHEMA_SQL` has run once, then
`select column_name from information_schema.columns where table_name='opportunity' and column_name in
('jd_html','jd_posting_raw','jd_posting_snapshot')` returns **exactly 3 rows**, the same query for
`('jd_real','raw_jd','jd_text')` returns **0 rows**, and for every id,
`length(jd_html)`, `length(jd_posting_raw)` and `length(jd_posting_snapshot)` equal the
pre-migration `length(jd_real)`, `length(raw_jd)`, `length(jd_text)` captured in the pre-flight
snapshot. (Verified via `db-query.yml`.)

**AC-2 (rename is a RENAME, not add+copy+drop).**
Given the migration has run, when `select count(*) from opportunity where jd_posting_snapshot is not
null and jd_posting_snapshot_sha256 <> encode(sha256(jd_posting_snapshot::bytea),'hex')` is executed,
then it returns **0** — proving no byte of the snapshot changed and every stored digest still
matches. A non-zero result means the migration copied through a re-encoding path and **every stored
offset is invalid**; that is a hard stop and a rollback.

### Group B — the migration is re-runnable (the deploy-#2 question)

**AC-3 (second deploy does not abort).**
Given the rename has already been applied, when `SCHEMA_SQL` is executed a **second and third** time
under `psql -v ON_ERROR_STOP=1`, then each run exits **0**, and the column set from AC-1 is
unchanged. (Proven achievable in §3c; this AC asserts it for the real `SCHEMA_SQL`.)

**AC-4 (executed against a POPULATED prior-schema database, per the strict rule).**
Given a local PostgreSQL 16 database to which `git show origin/main:api/src/functions/tests/schema.ts`'s
`SCHEMA_SQL` has been applied **and into which real rows have been seeded** with non-null
`jd_real`/`raw_jd`/`jd_text`, when the branch's `SCHEMA_SQL` is applied on top with
`ON_ERROR_STOP=1`, then it exits **0** and AC-1's column assertions hold. A fresh-database run does
**not** satisfy this AC.

**AC-5 (ordering — `H39`/`H39b`).**
Given the branch's `SCHEMA_SQL`, when the guarded rename block's line number is compared to every
`add column if not exists jd_posting_snapshot%` line, then the rename block appears **strictly
earlier**; and after AC-4's run,
`select count(*) from opportunity where jd_posting_snapshot is null` returns **0** for the seeded
rows (all of which were seeded with non-null `jd_text`), proving the rename fired rather than an
empty column being added first and the double-guard then silently skipping the rename.

### Group C — every consumer still reads

**AC-6 (no old column name survives in executable code).**
Given the branch, when
`grep -rnE "\b(jd_real|raw_jd|jd_text|jd_text_sha256|jd_text_truncated)\b" api/src app/src scripts .github/workflows`
is run, then it returns **0 matches outside comments and outside the guarded rename block in
`schema.ts`** (the rename block must name the old columns — that is its job). Every one of the
**194 code-only references** counted in §2 is accounted for as either renamed or deliberately-retained-in-comment.

**AC-7 (all 8 DDL homes moved together).**
Given the branch, when
`grep -rn "add column if not exists *\(jd_real\|raw_jd\|jd_text\)" --include=*.ts --include=*.mjs api/ `
is run (excluding `.claude/worktrees`), then it returns **0 matches**. This is the AC that prevents
the §1a self-reverting split-brain table.

**AC-8 (the funnel still resolves on live data).**
Given the deployed API after the migration, when `POST /api/app/opportunity/<uuid>/requirements` is
called via `api-test.yml` for an opportunity known to have a populated posting, then the response
carries `jd_source` **non-null** and a requirement count **> 0**. A 200 with `jd_source: null` or a
zero count is a FAILURE, not a pass (CLAUDE.md: *"A 200 with a zero count is a result to investigate,
not a pass"*).

**AC-9 (the second-order raw-SQL consumers still execute).**
Given the deployed API, when the routes backed by `termMiner.ts:112`, `appApply.ts:201/225` and
`appJdParse.ts:272-273` are each invoked via `api-test.yml`, then each returns **HTTP 200** with no
`column ... does not exist` in the Function logs. These four sites read the columns in raw SQL,
bypassing `resolvePostingSource`, so `tsc` cannot prove them.

**AC-10 (`jd_source` value contract is coherent).**
Given the owner's decision from §1c, when a fresh requirement extraction runs on production, then the
INSERT succeeds and `select distinct jd_source from requirement` returns **only values permitted by
the live CHECK constraint** (`select pg_get_constraintdef(oid) from pg_constraint where conrelid='requirement'::regclass and contype='c'`).
Zero check-constraint violations in the Function logs.

### Group D — the jd-import fix must not be undone

**AC-11 (jd-import still writes the SOURCE, not the snapshot).**
Given `.github/workflows/jd-import.yml` after the rename, when its write step is inspected, then it
performs `update opportunity set jd_posting_raw = ...` — i.e. the **renamed SOURCE column** — and
does **NOT** write `jd_posting_snapshot`. Concretely: `grep -c "set jd_posting_snapshot" jd-import.yml`
returns **0**, and `grep -c "set jd_posting_raw" jd-import.yml` returns **≥ 1**.
*This guards the fix landed in `04da595` ("jd-import writes the SOURCE; the 23 Aug write landed and
was undone"). Renaming `jd_text`→`jd_posting_snapshot` while renaming `raw_jd`→`jd_posting_raw`
creates a real opportunity to reintroduce the exact bug, because the new names are more similar to
each other than the old ones were.*

**AC-12 (the jd-import precedence guard survives).**
Given `jd-import.yml` after the rename, when the pre-write guard at today's `:99-105` is inspected,
then it still reads the **HTML column** (`jd_html`) to decide whether the raw import would be a
no-op, and still `exit 1`s when that column is non-empty. `grep -c "jd_html" jd-import.yml` ≥ 1.
A rename that leaves this guard reading a now-nonexistent `jd_real` makes `REAL_CHARS` empty, the
`-gt 0` test false, and the guard **silently stops guarding** — a write that reports success and
changes nothing a reader will ever see, the precise failure class that file exists to catch.

### Group E — the offset invariant

**AC-13 (offsets still index the snapshot).**
Given requirement rows with `char_start`/`char_end` written before the migration, when
`select count(*) from requirement r join opportunity o on o.id=r.opportunity_id
where r.verbatim is distinct from substring(o.jd_posting_snapshot from r.char_start+1 for r.char_end-r.char_start)`
is run, then it returns **the same count as the identical pre-migration query against `jd_text`** —
i.e. the rename introduced **zero** new offset mismatches. (Baseline must be captured BEFORE the
migration; a non-zero baseline is pre-existing and not this change's regression.)

**AC-14 (sha256 pinning unbroken).**
Given the migration, when a **re-extraction** is run on one opportunity via `api-test.yml`, then the
newly written `jd_posting_snapshot_sha256` equals the pre-migration `jd_text_sha256` for that row,
proving `resolvePostingSource` recomputes byte-identical text from the renamed source columns.

### Group F — the regression guard

**AC-15 (a straggler old name fails the suite).**
Given a new H-case in `api/test/hardening.test.mjs` named with a slug (per CLAUDE.md — **never a
number**; `H26` fails the suite on a new numeric ID), e.g.
`test('H:jd-column-rename-complete: no executable reference to a pre-rename JD column name')`,
when any of `jd_real`, `raw_jd`, `jd_text`, `jd_text_sha256`, `jd_text_truncated` appears in a
**non-comment** line of `api/src/**`, `app/src/**`, `scripts/**` or `.github/workflows/**` — excluding
the guarded rename block in `schema.ts`, which is whitelisted by explicit line range — then the suite
**FAILS** naming the file and line.

**AC-16 (that guard is MUTATION-PROVED — never skipped, at any tier).**
Given AC-15's guard, when a single old reference is deliberately reinstated (e.g. revert
`jdBackfill.ts:21` to `add column if not exists jd_real text`), then `npm test` in `api/` **FAILS**
and names `jdBackfill.ts`; and when the reinstatement is reverted, the suite passes again. A guard
that stays green with the defect reinstated is inert and does not satisfy this AC.

**AC-17 (the pre-existing `jd_real` projection guard is preserved, not deleted).**
Given `api/test/hardening.test.mjs:313-320` — which today asserts the SELECT projection contains
`jd_real` — when the rename lands, then that assertion **still exists** and asserts the projection
contains `jd_html`. `grep -c "the projection must carry the employer posting" hardening.test.mjs`
returns **≥ 1**. Deleting the assertion to make the suite green is an explicit FAILURE of this AC.

### Group G — build and no-regression

**AC-18.** Given the branch, when `npm run build` is run in `api/` and in `app/`, then both exit **0**.

**AC-19.** Given the branch, when `npm test` is run in `api/`, then the full suite passes with **no
test deleted or skipped** relative to `origin/main` (`grep -c "^\s*test(" ` count is ≥ the count on
`origin/main`, plus the new H-case).

---

## 6. RISKS, AND WHAT WOULD MAKE THIS NOT WORTH DOING

### The three that matter

**RISK 1 — the five request-time `ensure*` DDL homes silently re-create the old columns (§1a).**
*Likelihood if not explicitly scoped: HIGH. Severity: SEVERE, and SILENT.*
This is the defining risk of the change. Renaming in `SCHEMA_SQL` alone leaves five code paths that
run `add column if not exists jd_real/raw_jd/jd_text` **on ordinary user requests**. The table ends
up with a populated `jd_html` and an empty `jd_real`, and any consumer still pointing at the old name
reads NULL rather than erroring. `resolvePostingSource` then returns `source: null`, and per
`jdText.ts:83` that is a **legitimate, expected state** for 116 of 1,349 opportunities — so the
system degrades into "no employer text" **without a single error being raised anywhere**. Nothing in
the build, `tsc`, or a fresh-database schema run can see it. Mitigated by AC-7 + AC-15/16.

**RISK 2 — `requirement.jd_source` stores the old names as DATA under a CHECK constraint (§1c).**
*Likelihood: HIGH. Severity: HIGH, but LOUD.*
`schema.ts:351` constrains `jd_source in ('jd_real','raw_jd')`, and `create table if not exists` does
**not** update it on a populated database (proven). Rename the TS union without a
`drop constraint`/`add constraint` migration and **every requirement extraction fails at INSERT**.
Being loud makes it recoverable, but it also means the change is **not** the "pure column rename" it
appears to be — it is a column rename *plus a data-value migration plus a constraint migration*, and
that requires an owner decision (rename the stored values, or deliberately keep them as legacy
strings) that has **not been made**.

**RISK 3 — the scope is ~2.5× larger than estimated, and the sibling columns were never scoped.**
*Likelihood: CERTAIN. Severity: MEDIUM.*
The plan of record says 102 refs / 32 files. The measured figure is **234 unique lines across 40
files** — and if `jd_text_sha256` (82 refs) and `jd_text_truncated` (11 refs) are renamed for
coherence, **~358 references across ~45 files**. Leaving them un-renamed produces the pairing
`jd_posting_snapshot` + `jd_text_sha256`, which is **less coherent than what exists today** and
partially defeats the change's purpose. Either way the estimate is wrong, and an estimate that is
wrong by 2.5× on a mechanical change is how a "quick rename" consumes a day.

### Lesser risks

- **RISK 4 — raw SQL is invisible to the type checker.** ~20 of the references are inside template
  literals. A green `npm run build` proves nothing about them; only AC-8/AC-9's live calls do.
- **RISK 5 — `fixtures.json` (38 + 3 + 3 = 44 refs) drifts from the schema.** Test fixtures keyed on
  old names will silently stop matching production shape. Mechanical, but easy to miss.
- **RISK 6 — deploy-window skew.** `api-deploy.yml` deploys the Function and `SCHEMA_SQL` runs
  post-deploy; between the DDL landing and worker convergence (~90-120s per CLAUDE.md) old workers
  hold connections issuing queries against the OLD names. Expect a **short window of
  `column does not exist` errors on live traffic**. Not fatal, but it is real user-visible impact
  for a change with zero user-visible benefit.
- **RISK 7 (low) — the frontend.** Only 3 references, **all comments**. Effectively no risk; noted
  because it is the one place the change is cheaper than expected.

### What would make this NOT worth doing — stated plainly

**The rename delivers zero runtime behaviour change and zero user-visible benefit.** Its entire value
is clarity for future readers and agents. That value is real and I do not want to dismiss it — §0
establishes that the current names are **actively misleading** (`jd_real` vs `raw_jd` reads as a
provenance distinction and is in fact a format distinction; a previous session got exactly this wrong
and had to be corrected by the owner). The proposed names encode the true axis. So there is a
genuine, evidenced defect in the status quo.

**But weigh that against what §1a, §1c and §2 measured:**

1. It is **not a pure rename**. It is a rename + a value migration + a constraint migration + a
   6-site request-time DDL sweep. Three of those four were not in the plan of record.
2. The single largest risk (RISK 1) fails **silently, on production, in a way that mimics a
   legitimate state** (`source: null`) that the system is designed to tolerate. That is the worst
   possible failure signature for an evidence system whose entire purpose is not fabricating
   provenance.
3. The scope estimate is out by 2.5×.

**My honest verdict: PROCEED, but only with the scope corrected and the `jd_source` decision made
first — and if the owner is not willing to absorb ~358 references and a constraint migration, then
the better trade is to STOP and take the 90% of the clarity gain for ~2% of the risk:**

> **The cheap alternative.** Rename nothing. Add a comment block at `jdText.ts:85` above
> `resolvePostingSource` stating in one sentence what §0 proves — *"`jd_real` is HTML, `raw_jd` is
> plain text; both may be page-fetched; the axis is FORMAT, not provenance"* — plus an H-case
> asserting that comment's presence. This addresses the actual documented harm (a session
> misreading the distinction) at near-zero risk, and can be done in one commit today.

That is a legitimate finding and the evidence supports it: **the misleading-name defect is real, but
it has caused exactly one recorded incident, and the fix as scoped carries a silent-data-corruption
mode that the incident did not.** The rename is the *right* end state; it is not obviously the right
*next* action.

**Recommended sequencing if the owner proceeds with the full rename:**

1. **Owner decides `jd_source`** (§1c) — rename stored values, or keep legacy strings. Blocking.
2. **Owner decides the sibling columns** (`jd_text_sha256`, `jd_text_truncated`) — in or out. Blocking.
3. Write AC-15's H-case **first**, mutation-prove it (AC-16), and watch it fail on `main`.
4. Do all 8 DDL homes + all 194 code references in **one commit** — a partial rename is strictly
   worse than either end state.
5. Capture AC-13's offset baseline and AC-1's length snapshot from production **before** deploying.
6. Land on `main` (nothing deploys from a feature branch), then AC-8/AC-9/AC-13 against live.

---

## Appendix — every command run to produce this document

```bash
git fetch origin && git log --oneline -3 origin/main        # 91da5e2, local HEAD identical
grep -rn "jd_real\|raw_jd\|jd_text" api/src app/src api/test app/test scripts .github/workflows docs
grep -rnE "\b(jd_real|raw_jd|jd_text)\b" ...                # whole-word; the number that matters
grep -rn "resolvePostingSource" ...
grep -rn "add column if not exists *\(jd_real\|raw_jd\|jd_text\)" --include=*.ts --include=*.mjs --include=*.yml --include=*.sql .
grep -rn "ensureJdColumns" --include=*.ts api/src
grep -n  "rename column" api/src/functions/tests/schema.ts   # -> the existing idempotent idiom, :1121-1123
# local PostgreSQL 16.13, per CLAUDE.md "Run the schema locally":
#   bare rename run 2      -> ERROR: column "jd_real" does not exist        exit=1
#   rename column IF EXISTS-> ERROR: syntax error at or near "exists"       exit=1
#   guarded do $$ block    -> runs 1,2,3 all exit=0; data preserved
#   CHECK jd_source        -> insert 'jd_html' violates requirement_jd_source_check
#   create table if not exists on populated DB -> NOTICE skipping; CHECK unchanged
```

**Not done, deliberately:** nothing implemented, no other file edited, no commit, no push.
