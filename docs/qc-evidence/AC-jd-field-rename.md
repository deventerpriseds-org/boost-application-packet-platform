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
| `opportunity.raw_jd` → `jd_posting_raw` | `appJdParse.ts:155,219,316`; `mailWatch.ts:356`; `appCapture.ts:47`; `jd-import.yml` | `resolvePostingSource` `jdText.ts:88-91`; `isAlertDigest`; `appJdParse.ts:272-273` counters | same sweep → **61 hits** | EXISTS |
| `opportunity.jd_text` → `jd_posting_snapshot` | `appRequirements.ts:400` (`set jd_text=$1, jd_text_sha256=$2, jd_text_truncated=$3`); cleared at `:433` | requirement offset re-verification; `requirements.ts:361` | same sweep → **135 hits** | EXISTS |
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
