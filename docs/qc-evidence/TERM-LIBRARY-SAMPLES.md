# ATS term library — sample entries for sign-off

**Nothing here is published.** These are candidate entries in the real `term_library_entry` shape,
for you to judge the shape and the quality bar before the curation UI and the publish route are
built.

> ## Correction — the first draft of this file was wrong twice
>
> The owner: *"you're using only onet but there was also discussion of an option for more executive
> centric items."* Both halves are right, and the second is the one that matters.
>
> **1. I duplicated a system that already exists.** `api/src/functions/tests/termMiner.ts` (225
> lines) is the extraction half of this library, it is on `main`, it registers **three live routes**
> (`POST app/qc/terms/mine`, `GET app/qc/terms/candidates`, `POST app/qc/terms/candidate/{id}`), and
> **it had already run** — `term_candidate` holds **2,734 pending rows mined 2026-08-19**
> (db-query run 32688577032). I ignored all of it and hand-rolled ad-hoc extraction SQL. Everything
> below now comes from that existing queue.
>
> **2. My terms were O*NET-shaped even though I excluded O*NET.** The first draft's 18 samples were
> AWS / CI-CD / DevOps / LLM — IC-technical vocabulary, for an owner whose personas are VP and
> Director. `termMiner.ts:6-8` states the purpose in its own header: to supply *"the executive
> vocabulary O\*NET does not carry"*, and `schema.ts:265` repeats it. I built the thing that header
> exists to avoid.
>
> **3. Two "findings" I reported as discoveries were already solved in that file.** My
> "capitalisation measures sentence position" is what its `STOP` list handles; my "exclusion classes"
> section rediscovered EEO/benefits boilerplate, and its comments record the identical numbers from
> its own first live run (`dental and vision` 177, `regard to race` 220, `orientation gender` 239).
> Its ranking is already **specificity, not raw df**, for exactly the reason I wrote up as new.
> One thing my ad-hoc regex would have destroyed and the miner protects: `termNormalize` deliberately
> keeps the token `and` so **`P&L` survives as `p and l`** — an acronym-only pattern loses P&L, M&A
> and R&D outright.

## Where the numbers come from

`df` = how many DISTINCT postings in your corpus contain the term. Corpus = your non-dismissed
opportunities with `jd_real` over 200 characters; `pct` is df as a share of that corpus. Read from
`term_candidate` via **db-query run 32688607431**. Not estimated, not modelled, not model-generated —
every row is a literal substring of a real posting, which is what satisfies the spec's
*"terms must not be model-generated"* rule.

---

## The executive vocabulary — this is the part that was missing

Ranked from the miner's own pending queue. These are what a VP/Director posting actually asks for,
and **not one of them was in the first draft.**

### family: `leadership`

| term_key | display_term | term_type | df | pct |
|---|---|---|---:|---:|
| `executive_leadership` | Executive leadership | competency | **303** | 33% |
| `cross_functional` | Cross-functional | competency | **425** | 46% |
| `senior_leadership` | Senior leadership | competency | **199** | 21% |
| `executive_level` | Executive level | competency | **160** | 17% |
| `technology_leadership` | Technology leadership | competency | **114** | 12% |
| `executive_presence` | Executive presence | competency | **105** | 11% |
| `stakeholder_management` | Stakeholder management | competency | **121** | 13% |

### family: `strategy_operating_model`

| term_key | display_term | term_type | df | pct |
|---|---|---|---:|---:|
| `decision_making` | Decision making | competency | **307** | 33% |
| `product_strategy` | Product strategy | competency | **164** | 18% |
| `technology_strategy` | Technology strategy | competency | **149** | 16% |
| `operating_model` | Operating model | competency | **126** | 14% |
| `strategic_planning` | Strategic planning | practice | **116** | 13% |
| `product_vision` | Product vision | competency | **102** | 11% |
| `enterprise_wide` | Enterprise-wide | competency | **125** | 13% |

### family: `transformation`

| term_key | display_term | term_type | df | pct |
|---|---|---|---:|---:|
| `digital_transformation` | Digital transformation | competency | **120** | 13% |
| `change_management` | Change management | practice | **121** | 13% |
| `continuous_improvement` | Continuous improvement | practice | **233** | 25% |
| `operational_excellence` | Operational excellence | competency | **142** | 15% |
| `operational_efficiency` | Operational efficiency | competency | **125** | 13% |
| `emerging_technologies` | Emerging technologies | competency | **160** | 17% |

### family: `governance_risk`

| term_key | display_term | term_type | df | pct |
|---|---|---|---:|---:|
| `risk_management` | Risk management | practice | **204** | 22% |
| `data_governance` | Data governance | practice | **105** | 11% |

### family: `product_gtm`

| term_key | display_term | term_type | df | pct |
|---|---|---|---:|---:|
| `product_management` | Product management | competency | **195** | 21% |
| `product_development` | Product development | competency | **143** | 15% |
| `go_to_market` | Go-to-market | competency | **109** | 12% |
| `customer_success` | Customer success | competency | **99** | 11% |
| `data_driven` | Data-driven | competency | **159** | 17% |

**Scale of the correction:** `executive leadership` at 303 and `cross functional` at 425 both beat
`SaaS` (198), the highest-scoring term in my first draft. The vocabulary this owner is actually
judged on was absent from a list I presented as complete.

---

## The technical terms still belong — as a smaller set

From the first draft, corroborated by their own corpus counts, kept because postings do ask for them:
`AI/ML` 174, `AWS` 151, `APIs` 126, `Agile` 112, `CI/CD` 100, `ERP` 101, `CRM` 100, `LLM` 79,
`PMP` 79, `DevOps` 78, `Azure` 72, `SDLC` 57, `NIST` 57, `GCP` 56, `GDPR` 56, `CISSP` 64,
`Salesforce` 56. Acronyms use `case_sensitive_acronym`: matching `AI` case-insensitively hits
*detail*, *email*, *retail*, *available*; `ML` hits *html*.

`artificial intelligence` 151 and `machine learning` 107 appear separately in the queue and are
**aliases of `ai_ml`**, not new entries — merging them is exactly what the miner's
`status: merged` + `merged_into` decision is for.

---

## Two defects in the existing queue, found by reading it

Both are real and neither is a reason to distrust the miner — the second is the miner working.

**1. The stored candidates are STALE against the current blocklist.** The queue still contains
`orientation gender` 239, `regard to race` 220, `dental and vision` 177, `sex sexual` 155,
`protected by law` 95 — all five of which are in `BOILERPLATE` in the code today. They survive
because the rows were mined 2026-08-19 and the blocklist was extended afterwards. `termsMine`
already purges pending rows the current filters would no longer produce, so **a re-mine fixes this
without any code change**, and never touches a row a human has decided on.

**2. Boilerplate the blocklist does NOT yet cover.** These are still ranked high and are not terms:
`long term` 457, `bachelor degree` 404, `related field` 299, `computer science` 263,
`full time` 208, `united states` 177, `master degree` 154, `advanced degree` 151,
`receive consideration` 132, `federal state` 133, `third party` 130, `paid holidays` 125,
`consideration for employment` 123, `degree in computer science` 121, `long term disability` 88,
`characteristic protected` 100. Classes: degree requirements, employment type, geography, EEO tail,
benefits. `vice president` 234 is real but belongs to the **role taxonomy** (`persona` /
`taxonomy_title`), not here — that separation is already stated in `schema.ts:195`.

---

## What is deliberately NOT here

- **No model-invented terms.** Every row is corpus-attested. `scoreable` exists so a model
  suggestion can display without scoring; nothing here is one.
- **No `confidence` values.** Confidence is defined as independent-source corroboration and only the
  corpus has been consulted. A number now would be the fabricated-composite failure this repo
  forbids.
- **No `soc_codes` / `source_refs`.** Those need O*NET / ESCO, whose CC BY 4.0 terms require naming
  the release and USDOL/ETA wherever terms surface — the audit `source_manifest` is built for.
  O\*NET remains a **corroboration helper, never a gate**: `schema.ts:228` already rules that a term
  the corpus attests is valid even if neither O*NET nor ESCO lists it, *"most exec vocabulary is in
  that position"*.

## What is actually left to build

The extraction half exists and has run. Missing:

1. **Curation UI** — `termsCandidates` and `termsCandidateDecide` are live routes with **zero
   consumers in `app/src`**. 2,734 rows are queued with no screen to approve them from.
2. **The promote step** — nothing turns an approved `term_candidate` into a `term_library_entry`
   (assigning `family`, `term_type`, `match_mode`, aliases) or publishes a version.
3. **A re-mine** to purge the stale boilerplate above.

Publishing a version is what makes `keyword_coverage` a real number instead of null, and turns
`Keywords placed`, the keyword detail panel, "Claimed but not in the text", and the
`Every library keyword lands in a field` check into ordinary work. Because it feeds scoring, that
build is **tier 1**.
