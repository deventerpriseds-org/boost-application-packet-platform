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
