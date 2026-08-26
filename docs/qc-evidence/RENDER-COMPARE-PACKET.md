# RENDER-COMPARE-PACKET.md

**Task:** Render the Executive Engine app LOCALLY (never "live" — the sandbox cannot reach
`*.azurestaticapps.net` or `azurewebsites.net`) and compare it TAB BY TAB against the rendered
prototype, for the PACKET MODULE only.

**Owner's question (verbatim):** *"what ui components / ux functions are still missing? how close is
each page to being functional?"*

**Branch:** `claude/three-small-ui-gaps` (== `main` at `028fdec`)
**Started:** 2026-08-26
**Status:** IN PROGRESS — appended incrementally as evidence arrives.

---

## Method — what was actually run

**No new harness was invented.** `scripts/render-app.mjs` already exists for exactly this: it serves
the real `app/dist` bundle over localhost, fulfils every `/api/**` request from
`docs/qc-evidence/fixtures.json` (route-keyed, longest-match-wins), seeds `ee_auth_user` in
`localStorage`, reloads past the auth gate, and screenshots / dumps body text. `app/test/browser/*`
(Vite + Playwright component probes) were read and are cited where a claim needs a component-level
fact rather than a page-level one.

```
cd /home/user/boost-application-packet-platform/app && npm run build
# ✓ 245 modules transformed. dist/assets/index-mppgfN3g.js 1,127.52 kB. built in 4.42s
```

Fixture: `docs/qc-evidence/fixtures.json` — a REAL production packet pulled via `db-query.yml` and
assembled by `scripts/build-fixtures.mjs`. Opportunity `2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3`
(eMoney Advisor — SVP, Development and Enterprise Architecture), packet
`4860ae3b-fa3a-46d0-9cfc-e656ae6835a5`, status `review`, `jdAnalyzed: false`, 5 artifacts,
35 requirements, 22 merge fields in `pkg`, `coveredKw: []`, `missingKw: 8`, `atsScore: null`,
`mustHaves: []`.

**Tabs are read from `STEPS` in `app/src/screens/PacketBuilder.jsx:100-115`** — not assumed:

| # | key | label | sub |
|---|---|---|---|
| 1 | `jd` | Posting analysis | Requirements, responsibilities, keywords |
| 2 | `resume` | Resume | Keyword-tailored from master |
| 3 | `cover` | Cover letter | Tailored narrative |
| 4 | `portfolio` | Portfolio | Assemble work samples |
| 5 | `video` | Intro video | Script + record 60s |
| 6 | `qc` | QC & evidence | Coverage, checks, review |
| 7 | `send` | Review & send | Approval rounds |

---

## Log

- [init] File created before any investigation, per brief.
- [build] `app/dist` built, 4.42s, no errors.


---

## A. WHAT ACTUALLY RENDERED — all 7 tabs, one command each

```
node scripts/render-app.mjs --route '#/packet/2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3/<step>' \
  --fixtures docs/qc-evidence/fixtures.json --text --settle 4000
```

| Step | `bodyLen` | `pageErrors` | Unmatched `/api/` calls (a screen rendering on `{}`) |
|---|---:|---|---|
| `jd` | 9,915 | `[]` | none |
| `resume` | 12,479 | `[]` | `/api/config/templates` |
| `cover` | 3,727 | `[]` | none |
| `portfolio` | 8,812 | `[]` | none |
| `video` | **724** | `[]` | none |
| `qc` | 78,767 | `[]` | `/api/app/artifact/{5 ids}/remediation` |
| `send` | **826** | `[]` | none |

Every tab rendered. **Zero page errors on all seven** — no tab is broken. Two tabs (`video`, `send`)
render under 1KB of text, and that is the finding, not a harness failure: their fixture data is
present and served, there is simply almost nothing on the page.

**Two fixture gaps are themselves findings, recorded here rather than papered over:**

1. `/api/config/templates` — unfixtured, so `ResumeTemplatePicker`
   (`PacketBuilder.jsx:41-98`) received `{}` and, by its own rule at line 56
   (`if (!rows || (rows.length < 2 && !value)) return null`), rendered **nothing**. Its behaviour
   with 2+ templates is `not_applicable` in this run, not `pass`. **Fixture needed:**
   `"/config/templates": { "templates": [{templateId,label,roleFocus}, …] }` (≥2 rows).
2. `/api/app/artifact/{id}/remediation` — unfixtured for all five artifacts, so the QC tab's
   **Remediation loops** sub-tab is driven by `{}`. Its populated state is `not_applicable`.
   **Fixture needed:** `"/artifact/<id>/remediation": {…}` per artifact.

`scripts/build-fixtures.mjs` does not emit either key — confirmed by the key list of
`fixtures.json` (21 keys, none matching `templates` or `remediation`).
