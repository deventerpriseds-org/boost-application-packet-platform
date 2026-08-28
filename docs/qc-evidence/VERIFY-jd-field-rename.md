# VERIFY — PR #60 `claude/jd-field-rename` (commit 9428adc)

Independent verification. No shared context with the implementer. Every line below is
either a command + its actual output, or a statement explicitly labelled as inference.

Baseline: `origin/main` = `50db566`. `HEAD` = `9428adc` (branch `claude/jd-field-rename`).
`git status --porcelain` was empty at start — clean tree.

Status: IN PROGRESS (appended finding by finding).

---
## FINDING F1 (NEW — missed by the implementer's blast radius) — `review_verdict.posting_source` is a FOURTH home for the old names AS DATA, and it is not migrated

**Severity: real.** The implementer's stated radius covered `requirement.jd_source` as "the" value
migration. It is not the only one.

Ground truth (the producer, not a comparison of proxies):

`api/src/functions/tests/appReviewer.ts:115-117, 215` — the value written to
`review_verdict.posting_source` comes from the SAME function whose union was renamed:

```
const resolved = resolvePostingSource(art)
const postingSource = art.jd_posting_snapshot ? (resolved.source || 'jd_posting_snapshot') : resolved.source
...
posting_source: postingSource,
```

`origin/main:api/src/functions/tests/jdText.ts:85` returned `'jd_real' | 'raw_jd' | null`.
Branch `api/src/functions/tests/jdText.ts:85` returns `'jd_html' | 'jd_posting_raw' | null`.

So `review_verdict.posting_source` holds exactly the same vocabulary as `requirement.jd_source`,
written by the same expression — and the migration rewrites only `requirement.jd_source`.

**Proven by execution** on the populated production-shaped database (build steps in F0 below),
after applying the branch SCHEMA_SQL three times:

```
$ psql -d prodlike -c "select artifact_id, posting_source, jd_posting_snapshot_sha256 from review_verdict"
             artifact_id              | posting_source |            jd_posting_snapshot_sha256
--------------------------------------+----------------+--------------------------------------------------
 44444444-4444-4444-4444-444444444444 | jd_real        | aaaa00000000...aa
```

The COLUMN `jd_text_sha256` was correctly renamed on this table. The DATA in the sibling column
`posting_source` was not. Because `posting_source` carries **no CHECK constraint**
(`schema.ts:824` is a bare `posting_source text`), nothing errors — the column silently becomes a
mixed vocabulary: pre-deploy rows say `jd_real`/`raw_jd`, post-deploy rows say
`jd_html`/`jd_posting_raw`, for the identical meaning.

Note this is the *inverse* of why `requirement.jd_source` was caught: that one has a CHECK, so
leaving it would have thrown. The absence of a constraint is precisely what let this one hide.

**Impact is data-integrity, not a crash.** No consumer was found comparing `posting_source` to a
literal (`grep -rn "posting_source" api/src app/src api/test scripts .github` → 6 hits, all
pass-through: `appReviewer.ts:215,272,281,288,446` and the DDL at `schema.ts:824`). So nothing
breaks today; a future reader or query that filters `posting_source = 'jd_html'` will silently
under-count every pre-migration verdict.

**Fix is two lines, inside the existing block, needing no constraint dance:**
```sql
update review_verdict set posting_source = 'jd_html'        where posting_source = 'jd_real';
update review_verdict set posting_source = 'jd_posting_raw' where posting_source = 'raw_jd';
```

---

## FINDING F2 — **BLOCKER.** The deploy window silently strands ALL JD data, permanently, and it is near-certain to fire

This is the named hazard, and it is not theoretical. **Proven by execution on PostgreSQL 16.13.**

### The mechanism

`api-deploy.yml` deploys CODE first (step "Deploy to Azure Functions", line 80), then
**polls `/api/health` until the worker is UP AND SERVING** (line 113-118), and only THEN posts
`/api/diag/pg-migrate` (line 120). The health poll is explicit proof that the new code is live
and taking traffic before the migration runs.

In that window the NEW code's request-time `ensure*` helpers run against the OLD database and
execute `add column if not exists jd_html text` / `jd_posting_raw` / `jd_posting_snapshot*`.
That creates the new columns EMPTY. The migration's second condition —
`and not exists (... column_name = 'jd_html')` — is then FALSE, so **the rename never fires**.

This is the exact failure mode the implementer's own comment describes for the H39 ordering
vector ("a silent no-op that looks like success"), reached by a different vector that is not
guarded at all.

### It does not need a human. Two TIMERS guarantee it.

```
$ grep -rn "app.timer" api/src/functions/tests/*.ts
api/src/functions/tests/jdBackfill.ts:110:app.timer('jdBackfillTick', { schedule: '0 */3 * * * *', ... })   # EVERY 3 MINUTES
api/src/functions/tests/appJdParse.ts:350:app.timer('jdParseTick',   { schedule: '0 */5 * * * *', ... })   # EVERY 5 MINUTES
```
```
$ grep -n "ensureCols\|ensureJdColumns" api/src/functions/tests/jdBackfill.ts api/src/functions/tests/appJdParse.ts
jdBackfill.ts:89:    await ensureCols(client)        <- inside jdBackfillTick (registered line 110)
appJdParse.ts:137:   await ensureJdColumns(client)
```
`jdBackfill.ts:18-24` (branch) is `add column if not exists jd_html text`.
`appJdParse.ts:17-29` (branch) is `add column if not exists jd_posting_raw ... jd_html ...`.

A 3-minute timer against a deploy+converge window that is minutes long. This is not an edge case.

### PROVEN BY EXECUTION

```
$ psql -q -c "create database deploywin" postgres
$ psql -v ON_ERROR_STOP=1 -q -d deploywin -f /tmp/schema_main_nv.sql   # main schema  -> exit 0
$ psql -v ON_ERROR_STOP=1 -q -d deploywin -f /tmp/seed.sql             # populate     -> exit 0

--- BEFORE: data lives in the old columns ---
 11111111-...  | <p>HTML BODY ONE &amp; ampersand</p> | PLAIN SOURCE ONE      | SNAPSHOT ONE the offsets index
 22222222-...  |                                      | PLAIN SOURCE TWO only | SNAPSHOT TWO body

### DEPLOY WINDOW: new code live, pg-migrate not yet run. One timer tick:
$ psql -d deploywin -c "alter table opportunity add column if not exists jd_posting_raw text, ...,
                        add column if not exists jd_html text, ..."        -> exit 0
$ psql -d deploywin -c "alter table opportunity add column if not exists jd_posting_snapshot text,
                        add column if not exists jd_posting_snapshot_sha256 text, ..." -> exit 0

### NOW pg-migrate runs (branch SCHEMA_SQL):
branch schema exit=0            <-- GREEN. No error. The deploy reports success.

### RESULT
                  id     |               jd_real                | jd_html |        raw_jd         | jd_posting_raw |            jd_text             | jd_posting_snapshot
 11111111-...            | <p>HTML BODY ONE &amp; ampersand</p> |         | PLAIN SOURCE ONE      |                | SNAPSHOT ONE the offsets index |
 22222222-...            |                                      |         | PLAIN SOURCE TWO only |                | SNAPSHOT TWO body              |
```

**Every JD value is stranded in the old column. Every new column is NULL. The migration exited 0.**

### It is PERMANENT — subsequent deploys do not self-heal

```
$ for n in 2 3; do psql -v ON_ERROR_STOP=1 -q -d deploywin -f /tmp/schema_branch_nv.sql; echo "run $n exit=$?"; done
run 2 exit=0
run 3 exit=0
$ psql -d deploywin -t -c "select id, coalesce(jd_real,'(null)'), coalesce(jd_html,'(NULL/EMPTY)') from opportunity"
 11111111-... | <p>HTML BODY ONE &amp; ampersand</p> | (NULL/EMPTY)
 22222222-... | (null)                               | (NULL/EMPTY)
```
The double condition that makes the block idempotent is the same thing that makes this
unrecoverable without a hand-written repair. Once `jd_html` exists, the rename can never fire.

### The database is left HALF-migrated, which is worse than either end state

```
$ psql -d deploywin -t -c "select column_name from information_schema.columns
                            where table_name='opportunity' and (column_name like 'jd_%' or column_name='raw_jd')"
 jd_html                          <- empty
 jd_posting_raw                   <- empty
 jd_posting_snapshot              <- empty
 jd_posting_snapshot_sha256       <- empty
 jd_posting_snapshot_truncated    <- empty
 jd_real                          <- HOLDS THE DATA
 jd_text                          <- HOLDS THE DATA
 jd_text_sha256                   <- HOLDS THE DATA
 jd_text_truncated                <- HOLDS THE DATA
 raw_jd                           <- HOLDS THE DATA

$ psql -d deploywin -t -c "select table_name||'.'||column_name from information_schema.columns
                            where column_name in ('jd_text_sha256','jd_posting_snapshot_sha256')"
 opportunity.jd_posting_snapshot_sha256   <- empty (created by the ensure helper)
 opportunity.jd_text_sha256               <- still there, holds the data
 requirement.jd_posting_snapshot_sha256   <- RENAMED CORRECTLY (nothing pre-creates it)
 review_verdict.jd_posting_snapshot_sha256 <- RENAMED CORRECTLY
```
`requirement` and `review_verdict` migrate fine, because no `ensure*` helper touches them. Only
`opportunity` — the table holding the postings — is stranded.

**And the VALUE migration still fires**, so the rows now actively lie:
```
$ psql -d deploywin -c "select jd_source, count(*) from requirement group by 1"
 jd_html        | 2
 jd_posting_raw | 1
```
`requirement.jd_source = 'jd_html'` while `opportunity.jd_html` is NULL and the text is in `jd_real`.

### Runtime consequence (traced, not assumed)

`jdText.ts:85-92` reads `opp?.jd_html` then `opp?.jd_posting_raw`; both are NULL, so
`resolvePostingSource` returns `{text:'', source:null}`. `appReviewer.ts:118` then hits the
"no employer posting text" refusal. `appPackets.ts:406` selects `jd_html, jd_posting_raw` — NULL.
`appApply.ts:201` filters `coalesce(length(jd_html),0) > 200` — matches nothing.
Net effect on production: **every posting reads as empty across reviewer, packets and apply.**

### Why the existing guards do not catch it

`H:rename-precedes-its-adds` only checks ordering WITHIN `SCHEMA_SQL`. The `ensure*` helpers are
a different file and a different process; no guard in the branch asserts anything about them.

### The fix

The rename's second condition must tolerate an empty new column. E.g. per column:

```sql
if exists (... 'jd_real') then
  if exists (... 'jd_html') then
    -- the ensure* helper won the race: fold the empty column away first
    update opportunity set jd_html = jd_real where jd_html is null and jd_real is not null;
    alter table opportunity drop column jd_html;
  end if;
  alter table opportunity rename column jd_real to jd_html;
end if;
```
(or equivalently: run pg-migrate BEFORE the code deploy for this one release, or gate the
`ensure*` helpers behind "old column absent"). Any of these is a design decision for the owner —
the finding here is that the current block is **not** safe under the repo's own deploy order.

---

## FINDING F3 — the three new guards are NOT inert (all three mutation-proved), but guard 3 has a BLIND SPOT that matters

Mutations were made in a throwaway worktree (`git worktree add /tmp/mutwt 9428adc --detach`);
the repo tree was never modified.

**Baseline, unmutated:** `node --test test/hardening.test.mjs` → `# pass 111 / # fail 0`.

### M1 — `H:jd-column-rename-complete` FIRES ✅
Mutation: `api/src/functions/tests/jdText.ts:86`, `opp?.jd_html` → `opp?.jd_real`.
```
not ok 109 - H:jd-column-rename-complete: no executable reference to a pre-rename JD column name
    api/src/functions/tests/jdText.ts:86 still names jd_real
# pass 110 / # fail 1
```

### M2 — `H:rename-precedes-its-adds` FIRES ✅
Mutation: the whole `BEGIN/END jd-rename-migration` block relocated below
`add column if not exists jd_posting_snapshot_truncated boolean;`.
```
not ok 110 - H:rename-precedes-its-adds: a guarded rename runs before the add of the column it creates
    add column if not exists opportunity.jd_posting_snapshot at 67679 runs BEFORE the rename that creates it at 71509 ...
    (+ 2 more, for _sha256 and _truncated)
# pass 110 / # fail 1
```

### M3 — `H:rename-covers-every-table-declaring-the-column` FIRES ✅
Mutation: the `review_verdict` rename `if` block deleted from the migration.
```
not ok 111 - H:rename-covers-every-table-declaring-the-column: every table declaring a renamed column has a rename
    review_verdict.jd_posting_snapshot_sha256 is declared with a POST-rename name but the migration never renames it on review_verdict ...
# pass 110 / # fail 1
```

All three guards are live. **C10 CONFIRMED.**

### But: guard 3 is structurally blind to ALTER-declared columns — and those are the important ones

Guard 3 only walks `create table if not exists (\w+)\s*\(...\n\);` bodies
(`hardening.test.mjs`, the `for (const t of sql.matchAll(...))` loop). The `opportunity` JD
columns are **not** declared in a `create table` body — they are added by
`alter table opportunity add column if not exists jd_posting_snapshot ...` (schema.ts:1201-1203),
and `jd_html`/`jd_posting_raw` are not in SCHEMA_SQL at all. So the guard cannot see them.

**Proven:**
```
$ # delete the single most load-bearing rename in the migration:
$ #   alter table opportunity rename column jd_text to jd_posting_snapshot;
$ node --test test/hardening.test.mjs
# pass 111
# fail 0                      <-- GREEN
$ rm -rf /var/tmp/p84pg && node --test test/dimensionsDb.test.mjs
# pass 7
# fail 0                      <-- ALSO GREEN
```

Deleting the rename that moves the hash-pinned posting snapshot leaves **the entire hardening
suite and the populated-database suite green**. This is exactly CLAUDE.md's step-0b item 4
("delete each new load-bearing PRODUCTION line — does a test fail?") coming back negative.

The 2-table case the guard was written for (`requirement`, `review_verdict`) is covered.
The 5-column `opportunity` case — the one holding the actual posting text — is not covered by
any guard. It is covered only by `dimensionsDb.test.mjs` *incidentally*, and only for
`requirement.jd_posting_snapshot_sha256` (which is why that test caught the original defect and
not this one).

Suggested strengthening: extend guard 3's declaration scan to include
`alter table (\w+) add column if not exists (\w+)` as a declaration site, not only
`create table` bodies. (Verified as the gap by execution above; the fix itself is untested.)

### F3 CORRECTION — I was wrong about the blind spot being a real coverage gap

I initially concluded the deleted `opportunity` rename was uncaught, on the strength of
`hardening.test.mjs` + `dimensionsDb.test.mjs` both staying green. That was checking two proxies
and not the third. Running the remaining DB suite refutes it:

```
$ # mutation: delete ONLY  alter table opportunity rename column jd_text to jd_posting_snapshot;
$ rm -rf /var/tmp/edsparity /var/tmp/p84pg
$ node --test test/schemaParity.test.mjs
not ok 1 - a database built by UPGRADE is identical to one built FRESH
    cols: present after upgrade and absent on a FRESH database ...
    + [ 'opportunity.jd_text text null=YES default=NONE' ]
    - []
# pass 1 / # fail 1
```
And with **all five** `opportunity` renames deleted, the full suite fails on the same test:
```
$ node --test test/*.test.mjs        # /tmp/mut-full.log
not ok 768 - a database built by UPGRADE is identical to one built FRESH
    + [ 'opportunity.jd_text text null=YES default=NONE',
    +   'opportunity.jd_text_sha256 text null=YES default=NONE', ... ]
# tests 890 / # pass 889 / # fail 1
```

**Corrected verdict.** `H:rename-covers-every-table-declaring-the-column` IS structurally blind to
ALTER-declared columns — that part stands and is worth fixing, since the guard's own docstring
claims to "cover the NEXT rename for free" and it does not. But the *behaviour* is covered:
`schemaParity.test.mjs` catches a missing `opportunity` rename by leftover-column divergence.
So this is a guard-precision observation, **not a coverage hole**. Downgraded from a finding to a
note. The earlier F3 text above is left in place deliberately so the correction is auditable.

---

## F0 — how the production-shaped database was built (the substrate for C1-C6)

`jd_real`/`raw_jd` are NOT in SCHEMA_SQL. **Verified independently, not taken from the comment:**
```
$ git show origin/main:api/src/functions/tests/schema.ts > /tmp/main_schema.ts
$ grep -n "jd_real\|raw_jd\|jd_text" /tmp/main_schema.ts
235:  evidence_df int,   -- document frequency in jd_real at seed time      (COMMENT)
323:-- ... in opportunity.jd_text.                                          (COMMENT)
351:  jd_source text check (jd_source in ('jd_real','raw_jd')),             (VALUES, not columns)
352:  jd_text_sha256 text not null,                                         (requirement)
825:  jd_text_sha256 text,                                                  (review_verdict)
1090-1092: alter table opportunity add column if not exists jd_text / jd_text_sha256 / jd_text_truncated
```
No `jd_real` / `raw_jd` column DDL anywhere in main's SCHEMA_SQL. Their only homes are the
request-time helpers:
```
$ for f in appJdParse appRequirements appCapture mailWatch jdBackfill; do git show origin/main:api/src/functions/tests/$f.ts | grep -n "add column if not exists jd\|add column if not exists raw_jd"; done
appJdParse.ts:20,26     raw_jd, jd_real
appRequirements.ts:116-118  jd_text, jd_text_sha256, jd_text_truncated
appCapture.ts:46        raw_jd
mailWatch.ts:355        raw_jd
jdBackfill.ts:21        jd_real
```
**C2 sub-claim CONFIRMED** — five helpers, exactly as stated.

Substrate: PostgreSQL 16.13 on a throwaway cluster (`/tmp/vpgsock`, port 55433).
`db=prodlike` = main's SCHEMA_SQL (exit 0) + those five helpers' DDL + seeded rows
(2 opportunities, 4 requirements incl. one all-null-offset row, 1 review_verdict via packet+artifact).
`pgvector` stubbed per CLAUDE.md; `ON_ERROR_STOP=1` throughout.

---

## CLAIM-BY-CLAIM VERDICTS

### C1 — idempotent, 3+ runs on a populated DB — **CONFIRMED**
```
$ for n in 1 2 3; do psql -v ON_ERROR_STOP=1 -q -d prodlike -f /tmp/schema_branch_nv.sql; echo "RUN $n psql exit=$?"; done
RUN 1 psql exit=0
RUN 2 psql exit=0
RUN 3 psql exit=0
```
(No output other than `... already exists, skipping` / `... does not exist, skipping` NOTICEs.)

### C2 — works on a production-shaped DB — **CONFIRMED** (with the F2 caveat)
Exit 0 on the substrate above. **But see F2**: it is production-shaped only if no `ensure*` helper
ran between the code deploy and the migration. Under the repo's actual deploy order it does not hold.

### C3 — data preserved, renamed not dropped-and-re-added — **CONFIRMED**
```
BEFORE                                              AFTER (3 runs)
jd_real   = '<p>HTML BODY ONE &amp; ampersand</p>'  jd_html            = '<p>HTML BODY ONE &amp; ampersand</p>'
raw_jd    = 'PLAIN SOURCE ONE'                      jd_posting_raw     = 'PLAIN SOURCE ONE'
jd_text   = 'SNAPSHOT ONE the offsets index'        jd_posting_snapshot= 'SNAPSHOT ONE the offsets index'
jd_text_sha256      = 'aaaa…aa'                     jd_posting_snapshot_sha256    = 'aaaa…aa'
jd_text_truncated   = f / t                         jd_posting_snapshot_truncated = f / t
```
Byte-identical, NULLs preserved as NULLs (row 2's `jd_real` was NULL and stayed NULL).

### C4 — requirement char_start/char_end unchanged — **CONFIRMED**
```
BEFORE                                     AFTER
seq 1: 0 / 8   'SNAPSHOT'                  seq 1: 0 / 8   'SNAPSHOT'
seq 2: 9 / 16  'ONE the'                   seq 2: 9 / 16  'ONE the'
seq 1: 0 / 12  'SNAPSHOT TWO'              seq 1: 0 / 12  'SNAPSHOT TWO'
seq 2: (null)/(null) (null)                seq 2: (null)/(null) (null)
```
A `RENAME COLUMN` is a catalog operation and touches no other column; the all-null row also
survives the three `check ((char_start is null) = ...)` constraints unchanged.

### C5 — all tables carrying `jd_text_sha256` — **CONFIRMED. I enumerated them myself; the answer is three.**
Enumerated by parsing main's SCHEMA_SQL, tracking the enclosing `create table`:
```
$ python3 <parse main_schema.ts, attribute each line to its create table>
351  [table=requirement]     jd_source text check (jd_source in ('jd_real','raw_jd'))
352  [table=requirement]     jd_text_sha256 text not null
825  [table=review_verdict]  jd_text_sha256 text
1091 [ALTER]                 alter table opportunity add column if not exists jd_text_sha256 text
```
`requirement`, `review_verdict`, `opportunity` — and the migration renames all three. Confirmed
post-migration on the live-shaped DB:
```
$ psql -d prodlike -t -c "select table_name||'.'||column_name from information_schema.columns
                           where column_name like 'jd_posting%' or column_name like 'jd_html%'"
 opportunity.jd_html
 opportunity.jd_posting_raw
 opportunity.jd_posting_snapshot
 opportunity.jd_posting_snapshot_sha256
 opportunity.jd_posting_snapshot_truncated
 requirement.jd_posting_snapshot_sha256
 review_verdict.jd_posting_snapshot_sha256
```

### C6 — jd_source values migrated, CHECK accepts new / rejects old — **CONFIRMED**
```
$ psql -d prodlike -c "select jd_source, count(*) from requirement group by 1"
 jd_html        | 2
 jd_posting_raw | 1
 (null)         | 1        <- the null row is untouched; the CHECK permits null
$ psql -d prodlike -t -c "select pg_get_constraintdef(oid) from pg_constraint where conname='requirement_jd_source_check'"
 CHECK ((jd_source = ANY (ARRAY['jd_html'::text, 'jd_posting_raw'::text])))
```
Rejection of the old values is proven by the constraint definition itself: `jd_real`/`raw_jd` are
not in the array, so any insert of them raises 23514. (Note: this is the constraint text read back
from `pg_constraint`, i.e. what the database is actually enforcing, not the source SQL.)

### C7 — no code path names a pre-rename column — **CONFIRMED (swept independently)**
```
$ rg '\bjd_real\b|\braw_jd\b|\bjd_text\b|\bjd_text_sha256\b|\bjd_text_truncated\b' \
     -g '*.{ts,tsx,js,jsx,mjs,cjs,sql,yml,yaml,json,sh,py}'
```
Every hit is one of: (a) inside the whitelisted `BEGIN/END jd-rename-migration` block,
(b) a comment, (c) `hardening.test.mjs`'s own `JD_OLD_NAMES` list, (d) `dimensionsDb.test.mjs`'s
deliberately pre-rename fixture (lines 99-128). **Zero executable non-migration references.**
I also swept places the implementer's guard does NOT scan:
```
$ grep -rn "jd_real\|raw_jd\|jd_text" web/           -> (no output)
$ grep -rln ... app/ | grep -v app/src               -> (no output)
$ grep -rn "create table" ... (all DDL homes)        -> api/test/sql/correction.sql has no JD columns
```
And for tsc-invisible dynamic SQL: no `${...}`-interpolated **column** name touches a JD column
(`appRemediation.ts:139` interpolates the whole-query constant `OPP_FIELDS`, which is
`appPackets.ts:406` and already reads `jd_html, jd_posting_raw`; `mt28.ts`/`mt34.ts` interpolate
TABLE names only).

### C8 — `jd_fetch_log.jd_text_len` is a different concept — **CONFIRMED by reading the writer, not the comment**
```
$ grep -rn "jd_text_len" api/src app/src .github scripts
api/src/functions/tests/jdFetchLog.ts:37   jd_text_len INT,      (its own CREATE TABLE, not SCHEMA_SQL)
api/src/functions/tests/jdFetchLog.ts:59   INSERT ... jd_text_len ...  <- bound to row.jdTextLen
```
The only producers:
```
jdBackfill.ts:59-61   let jd = extractGuestJdHtml(r.body); ... logJdFetch({ ..., jdTextLen: jd.textLen, bytes: r.body.length, ... })
jdFetchProbe.ts:35-37 same shape
```
`jd.textLen` is the length of text extracted from a **provider HTTP response body at fetch time**,
before anything is stored on `opportunity`. It is never `opportunity.jd_text`.
(`appRequirements.ts:703` also uses the identifier `jdTextLen`, but that is a **JSON response field**
for the UI computed from `opp.jd_posting_snapshot` — a different sink, correctly left alone.)
Genuinely a different concept. Not renaming it is right.

### C9 — jd-import.yml writes the SOURCE and refuses when jd_html is populated — **CONFIRMED**
```
.github/workflows/jd-import.yml:126-131
  update opportunity
     set jd_posting_raw = :'jd',            <- THE SOURCE
         job_url = nullif('$JOB_URL',''),
         updated_at = now()
   where id = '$OPP';
```
Nothing writes `jd_posting_snapshot`. The refusal survives the rename intact:
```
REAL_CHARS=$(psql ... "select coalesce(length(jd_html),0) from opportunity where id='$OPP'")
if [ "${REAL_CHARS:-0}" -gt 0 ]; then
  echo "::error::jd_html holds $REAL_CHARS chars and resolvePostingSource PREFERS it, so writing jd_posting_raw would have no effect..."
  exit 1
fi
```
The verify-after-write (`select length(jd_posting_raw)` vs the file length) and the undo trail
(`select coalesce(jd_posting_raw,'(null)')`) were renamed consistently. The whole diff is
name-substitution only — no logic changed (`git diff origin/main...HEAD -- .github/workflows/jd-import.yml`
is 24 changed lines, all of them a column name or the prose naming one).

### C10 — the three guards are not inert — **CONFIRMED.** See F3 above for the three mutation runs.

### C11 — no test deleted or skipped — **CONFIRMED**
```
$ diff <(git ls-tree -r --name-only origin/main api/test) <(git ls-tree -r --name-only HEAD api/test)
(identical file sets — no deletions, no additions)

$ test() declarations:  origin/main = 868   HEAD = 871      (+3 = exactly the three new guards)
$ skip/todo markers:    origin/main = 32    HEAD = 32       (unchanged)
```

### C12 — real suite numbers — **CONFIRMED, and NOTHING skipped**
```
$ cd api && npm test                     # tsc build + node --test test/*.test.mjs
# tests 890 / # pass 890 / # fail 0 / # skipped 0 / # todo 0    EXIT=0

$ cd app && node --test test/*.test.mjs
# tests 391 / # pass 391 / # fail 0 / # skipped 0              EXIT=0

$ cd app && npm run build                                       EXIT=0
```
Per the brief, the two DB suites were also run **in isolation with clean state**:
```
$ rm -rf /var/tmp/p84pg /var/tmp/edsparity
$ cd api && node --test test/dimensionsDb.test.mjs
# tests 7 / # pass 7 / # fail 0 / # skipped 0        <- RAN, did not skip

$ rm -rf /var/tmp/edsparity
$ cd api && node --test test/schemaParity.test.mjs
# tests 2 / # pass 2 / # fail 0 / # skipped 0        <- RAN, did not skip
```
For contrast, an `origin/main` worktree run that raced another process over `/var/tmp/p84pg`
reported `# tests 887 / # pass 855 / # skipped 32` — confirming the brief's warning that these
suites skip silently under concurrency. The branch numbers above have 0 skipped, so they are real.

---

## THE "WHAT WAS MISSED" HUNT

**A fourth table / index / view / trigger / constraint / function naming an old column?**
Queried the catalog of the migrated live-shaped database directly (not the source):
```
$ psql -d prodlike -t -c "<union over pg_indexes, pg_views, pg_constraint, pg_trigger, pg_proc,
                            information_schema.columns matching \mjd_real\M|\mraw_jd\M|\mjd_text\M|...>"
(empty)
```
No leftover object of any kind. **Nothing missed at the DDL level.** The miss is at the DATA level
(F1, `review_verdict.posting_source`).

**Raw SQL in a template literal that tsc cannot see?** Swept — see C7. Clean.

**Deploy-order risk?** REAL AND PROVEN — see **F2**, the blocker.

**Locking on ~11,953 rows? — NOT a genuine risk. Measured, not argued.**
Seeded `requirement` to 11,957 rows (11,503 `jd_real` + 453 `raw_jd` + 1 null), matching the
implementer's production measurement, then timed each statement:
```
$ psql -d scaletest -c "\timing on" -c "update requirement set jd_source='jd_html' where jd_source='jd_real';" ...
UPDATE 11503     Time: 164.675 ms
UPDATE 453       Time:  13.598 ms
ALTER TABLE      Time:   3.510 ms      (the CHECK re-add, incl. its full validation scan)
```
Whole branch SCHEMA_SQL on that database, second pass: `real 0m0.135s`.
- The five `rename column` statements are catalog-only — no table rewrite, sub-millisecond.
- The ACCESS EXCLUSIVE window is ~4 ms (constraint drop + re-add). The UPDATEs take only
  ROW EXCLUSIVE, which does not block readers.
- Total ~200 ms of work on production-scale data.
**Verdict: not worth flagging as a production lock hazard.** The risk in this migration is F2,
not locking.

---

## F2 CALIBRATION — how certain is "near-certain"?

Confirming the premise rather than assuming it: **there is no startup migration path.**
```
$ grep -rn "SCHEMA_SQL" api/src --include=*.ts | grep -v schema.ts
api/src/functions/tests/pgMigrate.ts:3:  import { SCHEMA_SQL, EXPECTED_TABLES } from './schema'
api/src/functions/tests/pgMigrate.ts:15:   await client.query(SCHEMA_SQL)
```
`SCHEMA_SQL` is executed in exactly one place — the `GET/POST /api/diag/pg-migrate` HTTP route.
Nothing runs it on worker start. So the window between "new code serving" and "pg-migrate returns"
is genuinely open, and only the deploy workflow closes it.

**Observation vs interpretation, stated separately as CLAUDE.md requires:**
- **Observed:** the window exists; `jdBackfillTick` (3 min) and `jdParseTick` (5 min) both call an
  `ensure*` helper that creates the new columns; executing that sequence strands all JD data and
  the migration still exits 0.
- **Interpretation (not measured against the live Function App):** the probability of a timer
  landing inside the window. It is a RACE, not a certainty — if the migration POST wins, everything
  migrates correctly and this never bites. I did not measure the real window length on Azure, so
  "near-certain" in F2 is my inference from a 3-minute timer against a deploy+converge window the
  workflow itself polls for up to 180 s. Treat the *hazard* as proven and the *odds* as inferred.
- **Either way the exposure is asymmetric:** winning the race costs nothing; losing it silently and
  permanently strands every posting on production, with a green deploy and no error anywhere.

---

## VERDICT

| # | Claim | Verdict | Basis |
|---|---|---|---|
| C1 | migration is idempotent (3+ runs, populated DB) | **CONFIRMED** | 3 runs, `psql exit=0` each |
| C2 | works on a production-shaped DB | **CONFIRMED**, but see F2 | main SCHEMA_SQL + 5 `ensure*` helpers + rows; exit 0 |
| C3 | data preserved (renamed, not re-added) | **CONFIRMED** | byte-identical values + NULLs across all 5 columns |
| C4 | requirement offsets unchanged | **CONFIRMED** | 0/8, 9/16, 0/12, null/null before == after |
| C5 | all THREE tables renamed | **CONFIRMED** | enumerated myself: requirement, review_verdict, opportunity |
| C6 | jd_source values migrated + CHECK correct | **CONFIRMED** | catalog readback of `requirement_jd_source_check` |
| C7 | no code path names a pre-rename column | **CONFIRMED** | independent rg sweep incl. `web/`, dynamic SQL, all DDL homes |
| C8 | `jd_fetch_log.jd_text_len` correctly untouched | **CONFIRMED** | traced to `extractGuestJdHtml(r.body).textLen` |
| C9 | jd-import writes SOURCE, refuses on jd_html | **CONFIRMED** | the UPDATE + the guard, both read verbatim |
| C10 | the three guards are not inert | **CONFIRMED** | 3 mutations, each fails exactly one guard |
| C11 | no test deleted or skipped | **CONFIRMED** | identical file sets; 868 → 871 (+3 guards); skips 32 → 32 |
| C12 | real suite numbers | **CONFIRMED** | api 890/890, app 391/391, 0 skipped; DB suites RAN in isolation |

**Every claim the implementer made is true.** The rename itself is correct, complete at the DDL
level, idempotent, and data-preserving.

**Two things they missed, neither of which any claim covers:**

| | Finding | Severity |
|---|---|---|
| **F2** | The deploy window (code before pg-migrate) lets a 3-minute timer's `ensure*` helper create the new columns empty, after which the rename can never fire — all JD data stranded, permanently, behind a green deploy. **Proven by execution.** | **BLOCKER — do not merge as-is** |
| **F1** | `review_verdict.posting_source` stores the same renamed vocabulary as `requirement.jd_source` and is not value-migrated. Silent because that column has no CHECK. | Should fix — 2 lines |

**Note (not a finding):** `H:rename-covers-every-table-declaring-the-column` only scans
`create table` bodies, so it cannot see ALTER-declared columns; `schemaParity.test.mjs` covers the
behaviour, so this is guard precision, not a coverage hole. See the F3 correction.

**Regression baseline** (per the verifier playbook, run despite the change being schema-only):
api build `exit 0`; app build `exit 0`; api suite 890/890; app suite 391/391; both DB suites ran
clean in isolation. No regressions observed.

**Repo hygiene:** all mutation work was done in a detached worktree (`/tmp/mutwt`, `/tmp/mainwt`),
both restored. `git status --porcelain` in the repo shows only this file:
```
?? docs/qc-evidence/VERIFY-jd-field-rename.md
```
Nothing committed, nothing pushed.

*Verification complete.*

---
---

## Loop 2 — verification of the deploy-window fix (ea30d93)

Second independent verifier. No shared context with the implementer and none with the loop-1
verifier beyond the PRIOR STATE summary in my brief and the loop-1 report above, which I read
before starting. Every line below is a command and its real output, or is explicitly labelled
as inference.

`git rev-parse HEAD` → `ea30d9329323de0ecfc78ffecb86bd8c0ab4fe3e`
`git status --porcelain` → empty (clean tree, so the built `dist/` matches the source I read).
Substrate: **PostgreSQL 16.13** (`/usr/lib/postgresql/16`), fresh cluster on `/tmp/pgsock:55432`.

```
$ psql -c "select version()"
 PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu ...
```

Both schemas were obtained the way CLAUDE.md prescribes — branch from the **built module**, main
from `git show origin/main:...` — never hand-copied:

```
$ cd api && npm run build            # tsc, exit 0
$ node -e "import('./dist/functions/tests/schema.js').then(m=>fs.writeFileSync('/tmp/schema_branch.sql', m.SCHEMA_SQL))"
$ git show origin/main:api/src/functions/tests/schema.ts > /tmp/main_schema.ts   # then sliced SCHEMA_SQL
1485 /tmp/schema_branch.sql
1352 /tmp/schema_main.sql
```
pgvector is absent here, so `create extension vector` / `vector(1536)` / the hnsw index were
stubbed in BOTH files identically; everything else executes for real.

Sanity check that the dump really carries the new loop (not a stale build):
```
$ sed -n '/BEGIN jd-rename-migration/,/END jd-rename-migration/p' /tmp/schema_branch_nv.sql | grep "('.*',.*'.*',.*'.*')"
      ('opportunity',    'jd_real',           'jd_html'),
      ('opportunity',    'raw_jd',            'jd_posting_raw'),
      ('opportunity',    'jd_text',           'jd_posting_snapshot'),
      ('opportunity',    'jd_text_sha256',    'jd_posting_snapshot_sha256'),
      ('opportunity',    'jd_text_truncated', 'jd_posting_snapshot_truncated'),
      ('requirement',    'jd_text_sha256',    'jd_posting_snapshot_sha256'),
      ('review_verdict', 'jd_text_sha256',    'jd_posting_snapshot_sha256')
```

---

### D6 — the loop covers every pair — **CONFIRMED**

I derived the required set myself, from execution, rather than reading the VALUES list and
agreeing with it. Two independent halves, because the seven pairs do not all live in one place.

**Half 1 — the pairs SCHEMA_SQL itself declares.** Build a fresh database from main's schema and
a fresh one from the branch's, then diff every column in `public`:

```
$ psql -v ON_ERROR_STOP=1 -q -d freshmain   -f /tmp/schema_main_nv.sql     # exit 0
$ psql -v ON_ERROR_STOP=1 -q -d freshbranch -f /tmp/schema_branch_nv.sql   # exit 0
$ comm -23 cols_main.txt cols_branch.txt        # only in MAIN = the old names
opportunity.jd_text
opportunity.jd_text_sha256
opportunity.jd_text_truncated
requirement.jd_text_sha256
review_verdict.jd_text_sha256
$ comm -13 cols_main.txt cols_branch.txt        # only in BRANCH = the new names
opportunity.jd_posting_snapshot
opportunity.jd_posting_snapshot_sha256
opportunity.jd_posting_snapshot_truncated
requirement.jd_posting_snapshot_sha256
review_verdict.jd_posting_snapshot_sha256
```
Five pairs, and the pairing is unambiguous (same table, same suffix). No sixth old column is
left behind anywhere in the schema — the "only in main" list is exhaustive by construction.

**Half 2 — the two pairs that exist ONLY in request-time helpers** (`jd_real`, `raw_jd` are not
in either SCHEMA_SQL, so the diff above cannot see them). Swept every `.ts` in `api/src` on both
refs, not one file:

```
$ for f in $(git ls-tree -r --name-only origin/main api/src | grep '\.ts$'); do
    git show origin/main:$f | grep -nE "add column if not exists" | grep -iE "jd|raw_jd|posting"; done
appCapture.ts:46        raw_jd
appJdParse.ts:20,26     raw_jd , jd_real
appRequirements.ts:116-118  jd_text, jd_text_sha256, jd_text_truncated   (on table `opportunity`)
jdBackfill.ts:21        jd_real
mailWatch.ts:355        raw_jd

$ grep -rnE "add column if not exists" api/src --include=*.ts | grep -iE "jd|raw_jd|posting"   # branch
appCapture.ts:46        jd_posting_raw
appJdParse.ts:20,26     jd_posting_raw , jd_html
appRequirements.ts:116-118  jd_posting_snapshot, _sha256, _truncated     (on table `opportunity`)
jdBackfill.ts:21        jd_html
mailWatch.ts:355        jd_posting_raw
```
So the helper-only pairs are exactly `opportunity.jd_real→jd_html` and
`opportunity.raw_jd→jd_posting_raw`. Nothing else changed name.

**Union = 7 pairs = the VALUES list, exactly.** No pair was lost in the rewrite from seven
hand-written blocks to one loop. **D6 CONFIRMED.**

---

### Blast-radius challenge (schema level) — the stated radius holds for DDL, with one addition the implementer did already make

I did not take "nothing else changed" on trust. Diffing every constraint and every index between
the two FRESH databases:

```
$ comm -23 con_main.txt con_branch.txt      # only in main
requirement requirement_jd_source_check CHECK ((jd_source = ANY (ARRAY['jd_real'::text, 'raw_jd'::text])))
$ comm -13 con_main.txt con_branch.txt      # only in branch
requirement requirement_jd_source_check CHECK ((jd_source = ANY (ARRAY['jd_html'::text, 'jd_posting_raw'::text])))
$ comm -23 idx_main.txt idx_branch.txt ; comm -13 idx_main.txt idx_branch.txt
(both empty)
```
One CHECK changed, zero index changes, and the migration already drops+re-adds that CHECK around
the value UPDATEs. **No un-migrated DDL object outside the stated radius.**

---

### D7 part 1 — `review_verdict.posting_source` carries NO CHECK, before or after

The refusal risk for the new UPDATEs is a constraint rejecting the new vocabulary. There is none:

```
$ psql -At -d freshbranch -c "select coalesce(string_agg(conname,','),'(none)') from pg_constraint
    where conrelid='review_verdict'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%posting_source%'"
(none)
```
And on `freshmain`, `review_verdict`'s only CHECKs are `grade`, `prompt_source`,
`seniority_alignment` — `posting_source` is unconstrained on both refs. The two new UPDATEs
cannot be rejected. (Value migration itself is proven under D1/D7 below.)

---

### The substrate for D1-D5, D8 — a populated, production-shaped database

Built independently of loop 1. `jd_real`/`raw_jd` are not in main's SCHEMA_SQL, so the seed adds
them exactly as the main-era helpers do (`appCapture.ts:46`, `appJdParse.ts:20,26`,
`jdBackfill.ts:21`, `mailWatch.ts:355`), then seeds all three affected tables with the OLD
vocabulary, deliberately including a NULL in each renamed column, an em-dash, an HTML entity and
an embedded apostrophe so a lossy path would show:

```
$ psql -v ON_ERROR_STOP=1 -q -d dw -f /tmp/schema_main_nv.sql   # exit 0
$ psql -v ON_ERROR_STOP=1 -q -d dw -f /tmp/seed.sql             # exit 0
    id    |                         jd_real                          |        raw_jd         |            jd_text             |  sha   | jd_text_truncated
 11111111 | <p>HTML BODY ONE &amp; ampersand — em-dash, O'Brien</p>  | PLAIN SOURCE ONE      | SNAPSHOT ONE the offsets index | aaaaaa | f
 22222222 |                                                          | PLAIN SOURCE TWO only | SNAPSHOT TWO body              | bbbbbb | t
 33333333 | <div>HTML THREE</div>                                    |                       |                                |        |
```
plus 4 `requirement` rows (`jd_source` ∈ {`jd_real`,`raw_jd`,NULL}) and 3 `review_verdict` rows
(`posting_source` ∈ {`jd_real`,`raw_jd`,NULL}).

The deploy window is reproduced by executing the **branch's own** `ensure*` DDL verbatim, from the
files, against that old database — `jdBackfill.ts:19-22`, `appJdParse.ts:19-27`,
`appRequirements.ts:114-118`, `appCapture.ts:46`, `mailWatch.ts:355`:

```
$ psql -v ON_ERROR_STOP=1 -q -d dw -f /tmp/deploywindow.sql     # exit 0
$ psql -At -d dw -c "select column_name from information_schema.columns
                      where table_name='opportunity' and (column_name like 'jd\_%' or column_name='raw_jd')"
jd_html  jd_posting_raw  jd_posting_snapshot  jd_posting_snapshot_sha256  jd_posting_snapshot_truncated
jd_real  jd_text  jd_text_sha256  jd_text_truncated  raw_jd        (+ jd_company/jd_title/... unrelated)
```
This is precisely loop-1's F2 state: old columns populated, new columns present and empty.
(`requirement` and `review_verdict` are untouched by the window — no `ensure*` helper alters them,
which is why the old block half-migrated.)

---

### D1 — the deploy window is genuinely fixed — **CONFIRMED**

```
$ psql -v ON_ERROR_STOP=1 -q -d dw -f /tmp/schema_branch_nv.sql
BRANCH SCHEMA run1 exit=0        (grep -iE "error|exception" on the log: no hits)

    id    |                         jd_html                          |    jd_posting_raw     |      jd_posting_snapshot       |  sha   | t
 11111111 | <p>HTML BODY ONE &amp; ampersand — em-dash, O'Brien</p>  | PLAIN SOURCE ONE      | SNAPSHOT ONE the offsets index | aaaaaa | f
 22222222 |                                                          | PLAIN SOURCE TWO only | SNAPSHOT TWO body              | bbbbbb | t
 33333333 | <div>HTML THREE</div>                                    |                       |                                |        |
```
Every value moved. Compare against loop-1's measured output for the same scenario, where all three
new columns were `(NULL/EMPTY)` and the old columns held everything.

**Old columns gone, everywhere — not just on `opportunity`:**
```
$ psql -At -d dw -c "select table_name||'.'||column_name from information_schema.columns
    where table_schema='public' and column_name in
      ('jd_real','raw_jd','jd_text','jd_text_sha256','jd_text_truncated')"
(no rows)
```

**Byte-exact, not eyeballed** — an equality assertion per row, including the NULLs:
```
$ psql -At -d dw -c "select (...jd_html = '<p>HTML BODY ONE &amp; ampersand — em-dash, O''Brien</p>'
      and jd_posting_raw='PLAIN SOURCE ONE' and jd_posting_snapshot='SNAPSHOT ONE the offsets index'
      and jd_posting_snapshot_sha256=repeat('a',64) and jd_posting_snapshot_truncated=false),
    (row 2: jd_html IS NULL and the rest exact), (row 3: only jd_html set, rest IS NULL)"
1|1|1
```
All three rows exact. NULL stayed NULL; no coalescing to `''`, no truncation.

**Both value migrations fired in the same run:**
```
$ select coalesce(jd_source,'(null)'), count(*) from requirement group by 1
 (null) 1 | jd_html 2 | jd_posting_raw 1
$ select coalesce(posting_source,'(null)'), count(*) from review_verdict group by 1
 (null) 1 | jd_html 1 | jd_posting_raw 1
```
and `requirement.jd_posting_snapshot_sha256` still pins the right hashes (`aaaaaa` ×2, `bbbbbb` ×2).

---

### D2 — still idempotent from the recovered state — **CONFIRMED**

```
$ for n in 2 3 4; do psql -v ON_ERROR_STOP=1 -q -d dw -f /tmp/schema_branch_nv.sql; echo "run $n exit=$?"; done
run 2 exit=0
run 3 exit=0
run 4 exit=0
```
Data after run 4 is identical to after run 1 (same three rows, same counts), and
`old_cols_left = 0`. The `continue when not exists(old)` short-circuit is what carries this: on
runs 2-4 no pair matches, the loop is a no-op, and the two value UPDATEs match zero rows.

---

### D3 — the ordinary path (no deploy window) still works — **CONFIRMED**

Fresh populated old database, **no** `ensure*` DDL applied, so the new columns genuinely do not
exist (`count = 0` verified before the run):

```
$ for n in 1 2 3; do psql -v ON_ERROR_STOP=1 -q -d ord -f /tmp/schema_branch_nv.sql; echo "ordinary run $n exit=$?"; done
ordinary run 1 exit=0
ordinary run 2 exit=0
ordinary run 3 exit=0
```
Same three rows recovered byte-for-byte, `old_cols_left = 0`, both value migrations applied. The
refactor did not break the case that already worked.

**Column attributes survive the rename** (a `rename column` preserves type/nullability — checked,
not assumed, because `requirement.jd_text_sha256` is `NOT NULL` on main):
```
 opportunity    | jd_html                       | text    | YES
 opportunity    | jd_posting_snapshot_truncated | boolean | YES
 requirement    | jd_posting_snapshot_sha256    | text    | NO     <-- NOT NULL preserved
 review_verdict | jd_posting_snapshot_sha256    | text    | YES
```

---

### D4 — the refusal is real and safe — **CONFIRMED**

Deploy window, then the live new code actually WRITES to the new column (what `jdBackfillTick`
does when it fetches a posting) while `jd_real` still holds the old value:

```
    id    |                         jd_real                          |            jd_html
 11111111 | <p>HTML BODY ONE &amp; ampersand — em-dash, O'Brien</p>  | <p>FETCHED BY THE NEW CODE</p>

$ psql -v ON_ERROR_STOP=1 -q -d ambig -f /tmp/schema_branch_nv.sql
EXIT=3
psql:...:1175: ERROR:  jd-rename: opportunity.jd_real still exists and opportunity.jd_html already
                       holds 1 non-null row(s). Refusing to guess which is authoritative.
```
Non-zero exit — so `api-deploy.yml`'s migrate step fails loudly rather than reporting success.

**Nothing was dropped and nothing was renamed:**
```
$ select column_name ... in (the 8 old+new names)
jd_html  jd_posting_raw  jd_posting_snapshot  jd_real  jd_text  jd_text_sha256  jd_text_truncated  raw_jd
    id    |                jd_real                 |            jd_html             |    raw_jd    | jd_posting_raw |   jd_text    | jd_posting_snapshot
 11111111 | <p>HTML BODY ONE ... O'Brien</p>       | <p>FETCHED BY THE NEW CODE</p> | PLAIN ...ONE |                | SNAPSHOT ONE |
```
Both values intact. The `drop column` never executed for pairs 1 and 2 either — see D8.

---

### D5 — the refusal cannot fire spuriously, at realistic scale — **CONFIRMED**

20,000 seeded postings + the 3 originals, and 20,004 `requirement` rows; deploy-window DDL
applied so all five new `opportunity` columns exist and are **entirely NULL**:

```
$ select count(*) rows, count(jd_html), count(jd_posting_raw), count(jd_posting_snapshot),
         count(jd_posting_snapshot_sha256), count(jd_posting_snapshot_truncated) from opportunity
20003 | 0 | 0 | 0 | 0 | 0

$ psql -v ON_ERROR_STOP=1 -q -d bulk -f /tmp/schema_branch_nv.sql
EXIT=0  wall=0.55s          (grep -cE "ERROR" on the log: 0)

$ select count(*) rows, count(jd_html), count(jd_posting_raw), count(jd_posting_snapshot), count(jd_posting_snapshot_sha256)
20003 | 20002 | 20002 | 20002 | 20002        <-- 20002, because row 22222222 has jd_real NULL by design
$ old_cols_left = 0
$ select coalesce(jd_source,'(null)'), count(*) from requirement group by 1
 (null) 1 | jd_html 10018 | jd_posting_raw 9985
$ select jd_html, jd_posting_raw, left(jd_posting_snapshot,30) from opportunity where company='Co 17777'
<p>html 17777</p>|raw 17777|snapshot body 17777 xxxxxxxxxx
```
No spurious refusal, no data loss, and the whole migration is sub-second on 20k rows — so the
`count(*)` probe the fix adds per pair is not a performance concern either.

---

### D8 — `raise exception` leaves NO partial rename committed — **CONFIRMED (it rolls back)**

The answer is that the entire `do $$ ... $$` is **one statement**, so under psql's autocommit it is
one implicit transaction: a `raise exception` on pair #3 undoes the drops and renames pairs #1 and
#2 already performed inside the same block. Proven rather than reasoned:

Setup — ambiguity on pair #3 ONLY (`jd_text` vs a non-empty `jd_posting_snapshot`); pairs #1 and #2
have clean empty placeholders that the loop would drop-and-rename:
```
$ select count(jd_html), count(jd_posting_raw), count(jd_posting_snapshot) from opportunity
0 | 0 | 1
$ psql -v ON_ERROR_STOP=1 -q -d rollb -f /tmp/schema_branch_nv.sql
EXIT=3
psql:...:1175: ERROR:  jd-rename: opportunity.jd_text still exists and opportunity.jd_posting_snapshot
                       already holds 1 non-null row(s). Refusing to guess which is authoritative.

--- columns after the abort ---
jd_html  jd_posting_raw  jd_posting_snapshot  jd_real  jd_text  raw_jd
--- values ---
 11111111 | jd_real=<p>HTML BODY ONE ...</p> | raw_jd=PLAIN SOURCE ONE | jd_text=SNAPSHOT ONE ...
          | jd_html=(null) | jd_posting_raw=(null) | jd_posting_snapshot=WRITTEN BY NEW CODE
```
`jd_real` and `raw_jd` are **still there**, and the empty `jd_html`/`jd_posting_raw` placeholders
were **not** dropped. Had the block not been atomic, those two `drop column` + `rename` pairs would
have persisted and the database would be in a third, hand-made state. It is not.

**The resulting state is recoverable by a later run** once a human resolves the ambiguity:
```
$ psql -d rollb -c "update opportunity set jd_text=jd_posting_snapshot where jd_posting_snapshot is not null;
                     alter table opportunity drop column jd_posting_snapshot;"
$ psql -v ON_ERROR_STOP=1 -q -d rollb -f /tmp/schema_branch_nv.sql
recovery run EXIT=0
 11111111 | jd_html=<p>HTML BODY ONE ...</p> | jd_posting_raw=PLAIN SOURCE ONE | jd_posting_snapshot=WRITTEN BY NEW CODE
$ old_cols_left = 0 ;  jd_source: (null) 1 | jd_html 2 | jd_posting_raw 1
```

**Consequence worth stating explicitly (observation, not a defect in the block).** `ON_ERROR_STOP=1`
means a refusal aborts **the rest of SCHEMA_SQL**, not merely this block — every statement below
line 1175 silently never runs on that deploy. Measured on the refused database:
```
$ select coalesce(jd_source,'(null)'), count(*) from requirement group by 1
 (null) 1 | jd_real 2 | raw_jd 1                      <-- value migration never ran
$ select pg_get_constraintdef(oid) from pg_constraint where conname='requirement_jd_source_check'
CHECK ((jd_source = ANY (ARRAY['jd_real'::text, 'raw_jd'::text])))   <-- CHECK never re-added
```
That is the correct and intended behaviour for a refusal (nothing half-applied), but it means an
unrelated schema change landing in the same deploy is also blocked until the ambiguity is cleared
by hand. This is inherent to `ON_ERROR_STOP` + a single migration file, not something the fix
introduced.

---

### D7 — F1 is fixed for TWO of the THREE values that column holds — **PARTIALLY CONFIRMED**

**The two the fix covers work.** Proven under D1/D2/D3 above: `review_verdict.posting_source`
`jd_real → jd_html` and `raw_jd → jd_posting_raw`, on every path, with no CHECK to reject them
(`posting_source` is a bare `text` on both refs — see the constraint dump earlier).

---

## FINDING L2-F1 (NEW) — `review_verdict.posting_source` also stores `'jd_text'`, and that value is NOT migrated

**Severity: real, same class and blast radius as loop-1's F1 — silent data-integrity, no crash.**
This is the *same column* F1 was about; the fix migrated two of its three old values.

**Ground truth is the producer, not the schema.** `review_verdict.posting_source` is written from
one expression, and on `origin/main` that expression can emit a third literal:

```
$ git show origin/main:api/src/functions/tests/appReviewer.ts | sed -n '116,117p'
  const postingText: string = art.jd_text || resolved.text
  const postingSource = art.jd_text ? (resolved.source || 'jd_text') : resolved.source
                                                        ^^^^^^^^^^^
```
The branch changed that same line to the new name:
```
$ sed -n '116,117p' api/src/functions/tests/appReviewer.ts
  const postingText: string = art.jd_posting_snapshot || resolved.text
  const postingSource = art.jd_posting_snapshot ? (resolved.source || 'jd_posting_snapshot') : resolved.source
```
So `'jd_text'` and `'jd_posting_snapshot'` are the same fact under two names — exactly the
condition the migration exists to remove — and the migration does not touch it:
```
$ sed -n '1197,1207p' api/src/functions/tests/schema.ts
update requirement     set jd_source      = 'jd_html'        where jd_source      = 'jd_real';
update requirement     set jd_source      = 'jd_posting_raw' where jd_source      = 'raw_jd';
update review_verdict  set posting_source = 'jd_html'        where posting_source = 'jd_real';
update review_verdict  set posting_source = 'jd_posting_raw' where posting_source = 'raw_jd';
```
There is no `where posting_source = 'jd_text'`.

**PROVEN BY EXECUTION** — populated old database, a verdict row written the way main's line 117
writes it, then the branch SCHEMA_SQL:
```
$ psql -q -d third -c "insert into review_verdict (..., posting_source, jd_text_sha256)
                       values (..., 'jd_text', repeat('a',64))"
=== BEFORE ===            === AFTER (migration EXIT=0) ===
 (null)   1                (null)          1
 jd_real  1                jd_html         1
 jd_text  1                jd_text         1     <-- STRANDED
 raw_jd   1                jd_posting_raw  1
```
The migration exits 0 and leaves the row saying `jd_text`, a column name that no longer exists,
while every new row for the identical case says `jd_posting_snapshot`.

**It is the only such literal — I swept both refs, every file, not one.**
```
$ for f in $(git ls-tree -r --name-only origin/main api/src app/src | grep -E '\.(ts|tsx|js|jsx)$'); do
    git show origin/main:$f | grep -nE "'jd_text'" | grep -v "jd_text_sha256|jd_text_truncated|jd_text_len"; done
api/src/functions/tests/appReviewer.ts:117      <-- the only hit, on either ref
```
And the sibling `*_source` columns are NOT this vocabulary — `artifact_score.must_have_source` /
`keyword_source` / `seniority_source` store a `"<covered>/<judged>"` denominator string built by
`artifactScore.ts:194`, never a column name. `requirement.jd_source` is CHECK-bounded to
`jd_real|raw_jd`, so it cannot carry `jd_text`. **`review_verdict.posting_source` is the only
column with the gap.**

**Reachability of the `'jd_text'` write (INFERENCE from tracing the code, not a production count).**
`art` is `... o.jd_real, o.raw_jd, o.why_surfaced, o.jd_text ...` (`appReviewer.ts:97-100` on main),
so the literal is written whenever `opportunity.jd_text` is non-empty AND
`resolvePostingSource` returns `source: null` — i.e. `normalizePostingText(jd_real)` is empty and
`raw_jd` is empty *or* `isAlertDigest(raw_jd, why_surfaced)`. `jd_text` is a snapshot persisted at
extraction time while `raw_jd`/`why_surfaced` keep being rewritten afterwards (`mailWatch.ts:355`),
so a posting whose later alert email flips `isAlertDigest` to true lands exactly here. I judge this
**uncommon but reachable**; I have NOT measured how many production rows carry it — the Postgres
connectors in this session are unauthenticated (`boost-pg-mcp-write` and the others all reported
"requires authentication"), so I could not query live. **The one query that would settle the count:**
```sql
select posting_source, count(*) from review_verdict group by 1 order by 2 desc;
```
If it returns zero `jd_text` rows the finding is cosmetic; if it returns any, they are stranded.

**Fix is one line, in the block that already exists:**
```sql
update review_verdict set posting_source = 'jd_posting_snapshot' where posting_source = 'jd_text';
```
It must be ordered with the other two (any order — the three source values are disjoint).

**Why the existing guards do not catch it.** `H:jd-column-rename-complete` whitelists the
`BEGIN/END jd-rename-migration` block and scans for old *column names in executable code*; the
stranded value is DATA, and there is no guard asserting that every literal the old code could
store has an UPDATE. The same structural blindness that hid loop-1's F1 (no CHECK to fail loudly)
hides this one.

---

### D9 part 1 — the NEW guard `H:rename-survives-the-deploy-window` is NOT inert — **CONFIRMED**

Mutations in a throwaway worktree (`git worktree add /tmp/mutwt2 ea30d93 --detach`); the repo tree
was never modified. Baseline unmutated: `node --test test/hardening.test.mjs` → **112 pass, 0 fail,
0 skipped** (loop 1 saw 111; this commit adds one).

Each of the guard's three assertions was proved independently, then the real regression:

| Mutation | Result |
|---|---|
| **M4a** — `execute format('alter table %I drop column %I', ...)` → `null;` (never drop the placeholder) | `not ok 112 - H:rename-survives-the-deploy-window` — **FIRES** (pass 111 / fail 1) |
| **M4b** — `raise exception` → `raise notice` (refuse quietly instead of aborting) | **FIRES** (111/1) |
| **M4c** — `where %I is not null` → `where true or ...` (refusal fires unconditionally) | **FIRES** (111/1) |
| **M5** — the whole inner branch replaced by `continue when exists(new)`, i.e. the exact pre-fix semantics | **FIRES** (111/1) |

M5 is the mutation that matters, and I did not stop at the guard going red — I proved the mutation
**reintroduces the real defect**, so the guard is protecting behaviour and not a string:

```
$ # M5 applied, rebuilt, SCHEMA_SQL re-dumped, run against a fresh deploy-window database
$ psql -v ON_ERROR_STOP=1 -q -d m5 -f /tmp/schema_M5_nv.sql
MUTATED schema on the deploy-window db EXIT=0        <-- GREEN, exactly loop-1's F2
    id    |                     jd_real                     | jd_html |          jd_text          |  snap
 11111111 | <p>HTML BODY ONE &amp; ampersand — em-dash...</p>| (NULL)  | SNAPSHOT ONE the offsets… | (NULL)
 22222222 | (null)                                          | (NULL)  | SNAPSHOT TWO body         | (NULL)
 33333333 | <div>HTML THREE</div>                           | (NULL)  | (null)                    | (NULL)
```
Stranded again, exit 0. The guard is live and it guards the right thing. **D9 part 1 CONFIRMED.**

---

## FINDING L2-F2 (NEW) — the refactor SILENTLY DISABLED the two pre-existing rename guards for these columns

**Severity: real.** This is the regression the brief asked me to hunt, and it is not in the stated
blast radius — the implementer said "`hardening.test.mjs` (one new guard). Nothing else changed."
Two existing guards changed behaviour **without their code being touched**, because both derive
their input by regex from the migration's *shape*, and the shape changed.

### The mechanism

Both guards find renames with the same literal pattern:
```
$ grep -n "matchAll(/alter table" test/hardening.test.mjs
  (H:rename-precedes-its-adds)                       /alter table\s+(\w+)\s+rename column\s+(\w+)\s+to\s+(\w+)/g
  (H:rename-covers-every-table-declaring-the-column) /alter table\s+(\w+)\s+rename column\s+(\w+)\s+to\s+(\w+)/g
```
The refactor replaced seven literal `alter table opportunity rename column jd_real to jd_html`
statements with one `execute format('alter table %I rename column %I to %I', ...)`. `%I` is not
`\w+`, so **the JD renames are now invisible to both guards.** Measured directly:

```
$ node -e "<the guards' own regex, applied to SCHEMA_SQL at each ref>"
9428adc (pre-fix)     -> matches: 10   opportunity.jd_real->jd_html, opportunity.raw_jd->jd_posting_raw,
                                       opportunity.jd_text->jd_posting_snapshot, opportunity.jd_text_sha256->…,
                                       opportunity.jd_text_truncated->…, requirement.jd_text_sha256->…,
                                       review_verdict.jd_text_sha256->…,
                                       remediation_loop.must_have_check_key->close_check_key, (+2 more)
ea30d93 (branch HEAD) -> matches: 3    remediation_loop.must_have_check_key->close_check_key,
                                       remediation_loop.must_have_state->close_state,
                                       remediation_loop.prev_must_have_state->prev_close_state
```
**Seven of ten renames vanished from both guards' input.** Only the three pre-existing
`remediation_loop` renames — still written as literal SQL — are still seen. The guards do not fail;
they simply have nothing to say about the JD columns any more, and they still report green.

### Proven by mutation — the identical defects loop 1 measured as CAUGHT now sail through

Loop 1 recorded, against `9428adc`:
> **M2 — `H:rename-precedes-its-adds` FIRES ✅** (block relocated below the adds)
> **M3 — `H:rename-covers-every-table-declaring-the-column` FIRES ✅** (review_verdict rename deleted)

The same two mutations against `ea30d93`:

```
########## M2: move the whole BEGIN/END jd-rename-migration block BELOW the adds ##########
# pass 112
# fail 0                                   <-- GREEN. Loop 1: "FIRES", pass 110 / fail 1.

########## M3a: delete the review_verdict pair from the VALUES list ##########
$ sed -n '/select \* from (values/,/as t(tbl/p' src/functions/tests/schema.ts
      ('opportunity',    'jd_real',           'jd_html'),
      ('opportunity',    'raw_jd',            'jd_posting_raw'),
      ('opportunity',    'jd_text',           'jd_posting_snapshot'),
      ('opportunity',    'jd_text_sha256',    'jd_posting_snapshot_sha256'),
      ('opportunity',    'jd_text_truncated', 'jd_posting_snapshot_truncated'),
      ('requirement',    'jd_text_sha256',    'jd_posting_snapshot_sha256')
    ) as t(tbl, old_col, new_col)          <-- review_verdict pair GONE
# pass 112
# fail 0                                   <-- GREEN. Loop 1: "FIRES", pass 110 / fail 1.

########## M3b: delete the opportunity jd_text -> jd_posting_snapshot pair ##########
# pass 112
# fail 0
```
`git diff` against `ea30d93:api/src/functions/tests/schema.ts` confirmed the tree was pristine
before each mutation and restored after.

### What this costs, per guard

- **`H:rename-covers-every-table-declaring-the-column`** — this is the guard written *because* the
  first draft renamed only the `opportunity` copy of `jd_text_sha256`. Dropping a pair from the
  VALUES list is now a one-line deletion that the hardening suite waves through. Whether anything
  else catches it is measured under D10 below.
- **`H:rename-precedes-its-adds`** (the H39/H39b ordering invariant) — no longer enforced for these
  columns. *Mitigating, and I want to be precise rather than alarming:* the fix itself makes the
  ordering hazard much less dangerous, because an `add column` that ran first now creates an EMPTY
  column which the loop DROPS and renames. So this one is a lost guard rather than a live bug. It
  still matters for the next rename someone writes as `execute format`.
- **`H:rename-survives-the-deploy-window`** is unaffected — it greps the block for `drop column` /
  `raise exception` / `is not null`, not for rename statements, which is why it survives the very
  shape change that blinded its two neighbours.

### The narrow fix

Teach both regexes the `format` form as well as the literal one, e.g. accept `%I` as an identifier
token and read the pairs out of the VALUES list — or, more simply, keep the VALUES list as the
single declaration and have the guards parse *it*. Deleting either guard is not the fix; they are
green today only because they can no longer see the thing they were written to police.

---

### HUNT-1 — does `format('%I')` quote every identifier here correctly? — **CONFIRMED, no problem**

`%I` quotes only when the identifier requires it; all seven table/column names are lowercase
`[a-z_]`, so it emits them bare:
```
$ select format('alter table %I rename column %I to %I','opportunity','jd_real','jd_html'),
         format('select count(*) from %I where %I is not null','review_verdict','jd_posting_snapshot_sha256')
alter table opportunity rename column jd_real to jd_html | select count(*) from review_verdict where jd_posting_snapshot_sha256 is not null
```
And the whole path executes for real under D1/D3/D5. `%I` is also the correct choice over `%s` —
it is the injection-safe form — and the `information_schema` lookups correctly use the raw
parameter (`table_name = r.tbl`) rather than a quoted one, which is the right pairing.

### HUNT-4 — ordering hazard from "one statement instead of seven"? — **not applicable / no change**

The pre-fix version was already a single `do $$ ... end $$;`. The diff turns seven `if` blocks
inside that one statement into one loop inside the same one statement. Statement granularity, and
therefore transaction granularity, is unchanged. (Its consequence is measured under D8.)

---

## FINDING L2-F3 (NEW) — the refusal is ASYMMETRIC: an EMPTY *old* column beside a populated *new* one blocks every future deploy

**Severity: moderate — no data loss, but it hard-fails the deploy and needs a manual DROP.**
This is a hazard the fix introduces; the pre-fix block skipped this state silently.

The block asks "is the NEW column empty?" and treats emptiness as proof of a placeholder. It never
asks the same question of the OLD column. So the mirror-image placeholder — an empty **old** column
recreated by code running the OLD `ensure*` DDL after the migration already succeeded — reads as
genuine ambiguity and raises.

**Reachable by a rollback, or by a stale worker** (CLAUDE.md documents ~90-120s of Azure Functions
worker convergence on every deploy, and `azure-functions-deploy-verify` exists precisely because old
and new workers coexist). `origin/main`'s helpers still execute
`add column if not exists jd_real / raw_jd / jd_text / jd_text_sha256 / jd_text_truncated`.

**PROVEN BY EXECUTION:**
```
$ # 1. normal successful migration on a populated database
migration #1 exit=0        (jd_html now holds 2 non-null rows, jd_real gone)

$ # 2. OLD code runs again — main's ensure* DDL, verbatim
$ psql -f /tmp/oldcode.sql        old ensure* exit=0
$ select count(*) rows, count(jd_real) old_nonnull, count(jd_html) new_nonnull from opportunity
3 | 0 | 2                  <-- jd_real recreated, ENTIRELY EMPTY; jd_html holds the data

$ # 3. the next deploy runs the migration again
migration #2 EXIT=3
ERROR:  jd-rename: opportunity.jd_real still exists and opportunity.jd_html already holds 2
        non-null row(s). Refusing to guess which is authoritative.
```
Every subsequent deploy now fails at that line and — per D8 — the whole rest of SCHEMA_SQL is
skipped, until a human runs `alter table opportunity drop column jd_real`. No data is at risk, but
the deploy pipeline is stuck and the error message points at the *populated* column as the problem
rather than at the empty one that actually caused it.

**Narrow fix, symmetric with the one already there:** before raising, check the OLD column too —
if the old column is entirely NULL while the new one holds rows, the old column is the placeholder,
so drop *it* and `continue`. Only raise when BOTH hold rows. That is the genuinely ambiguous case
the comment describes, and it is the only one worth refusing on.

---

## FINDING L2-F4 (NEW, lower severity) — the `information_schema` lookups have no `table_schema` filter, and this commit turns that from a silent skip into a deploy-blocking refusal

`schema.ts` contains **zero** occurrences of `table_schema` (file-wide convention, so the omission
itself is pre-existing, not introduced here). What changed is the consequence.

```
$ grep -c "table_schema" api/src/functions/tests/schema.ts
0
```

**Before the fix**, a same-named table in another schema made `exists(old)` true and
`not exists(new)` false, so the pair was skipped — harmless.
**After the fix**, the same state reaches the `count(*)` probe. `%I` has no schema qualification, so
the probe resolves via `search_path` and counts the rows of `public.opportunity`, then raises:

```
$ # public is already fully migrated; add an unrelated table in another schema
$ create schema archive; create table archive.opportunity (id int, jd_real text, jd_html text);
$ psql -v ON_ERROR_STOP=1 -q -d multisch -f /tmp/schema_branch_nv.sql
migration #2 EXIT=3
ERROR:  jd-rename: opportunity.jd_real still exists and opportunity.jd_html already holds 2
        non-null row(s). Refusing to guess which is authoritative.
```
`public.opportunity` has no `jd_real` at all; the refusal is entirely false and permanent.

**Likelihood: unmeasured.** I could not query the production database to see whether
`boost_resume_n_packet_builder` has any schema besides `public` — the Postgres MCP connectors in
this session all reported "requires authentication". **The query that would settle it:**
```sql
select table_schema, table_name from information_schema.columns
 where column_name in ('jd_real','raw_jd','jd_text','jd_text_sha256','jd_text_truncated')
 group by 1,2;
```
If that returns only `public` rows, this is theoretical. **Fix is one clause per lookup:**
`and table_schema = 'public'` (or `current_schema()`), plus schema-qualifying the `format`.
