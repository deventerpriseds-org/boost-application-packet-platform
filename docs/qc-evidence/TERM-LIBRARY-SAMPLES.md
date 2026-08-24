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

## Sources — the prototype's list is Jul 30 and two of its four were later superseded

The owner named both places, and both say what they say:

- **`docs/qc-evidence/qc/data.js:25`** — `TERM_LIB = { id: 'ENG-LEAD v4', size: 1840, sources:
  ['O*NET 29.2', 'Lightcast skills', '3.1k exec postings', 'ATS field dictionaries'], updated:
  'Jul 30' }`, rendered by `packet.jsx:103` and `evidence.jsx:177`. (Four sources **including**
  O*NET, not besides it.)
- **`docs/qc-evidence/BACKLOG.md:79-82`** — the requirement: *"Terms must come from a curated
  library, not from the model… O\*NET skills, a skills taxonomy such as Lightcast, scraped exec
  postings, ATS vendor field dictionaries"*, and *"`jd_table`'s ATS Keyword column is a reasonable
  bootstrap but is model-generated — treat it as candidates to seed the library, not as the library."*

**That list is dated Jul 30. `.claude/QC-EVIDENCE-PLAN.md` records owner decisions from 2026-08-19
that change two of the four.** The schema's `sources` enum (`schema.ts:230`) reads
`onet | esco | jd_corpus | nist_csf | cncf | curated` — which is the post-decision list exactly, and
is how you can tell the schema was written after those decisions rather than from the prototype.

| Prototype source (Jul 30) | Status now | Where |
|---|---|---|
| O*NET 29.2 | **Kept**, but demoted to *supplement* | plan:421 |
| Lightcast skills | **DECLINED — paid.** *"O\*NET only — free, no paid option… No Lightcast, no paid source."* | plan:387 |
| 3.1k exec postings (scraped) | **Kept and PROMOTED to PRIMARY**, as our own corpus | plan:421-427 |
| ATS field dictionaries | **NEVER DECIDED — the one genuine open question** | — |
| *(added)* ESCO | **Included.** *"'O\*NET only' was aimed at paid vendors."* | plan:445 |
| *(added)* NIST CSF 2.0 + NICE, CNCF landscape | **Safe to ingest wholesale** | plan:429-432 |

Three consequences worth stating plainly:

1. **The corpus is the primary exec source, not a fallback.** *"our own `jd_real` corpus is the
   PRIMARY exec term source; O\*NET is the supplement — inverting the backlog's assumption"* — on
   evidence of 1,230 real postings, **876 (71%) C-level/VP/Head-of**, with roadmap 626, board 480,
   budget 416, operating model 222, digital transformation 153, P&L 83, M&A 66, SOC 2 34, all absent
   from O*NET. **`termMiner.ts` is that decision implemented.**
2. **Declining Lightcast cost less than it looks.** O*NET's `Hot Technology` / `In Demand` flags are
   themselves Lightcast-derived — *"the demand signal we declined to pay for is already in the free
   dataset."*
3. **Licensing is already scoped.** Storing the token `TOGAF`/`ITIL`/`SAFe` is nominative use and
   fine; importing their taxonomies is not. `SAFe` needs case-sensitive matching — `safe` appears in
   302 postings, `scaled agile` in 8. Same class as the `AI`/*detail* problem.

### Cost of every source (owner: *"ata vendor field is in… need to see cost of the. all. looking for free"*)

**Total for the whole recommended set: $0.** ATS vendor field dictionaries are now IN, and the free
route for them is named below.

#### Free — usable now

| Source | Cost | Licence / obligation | How this is known |
|---|---|---|---|
| **Your own `jd_real` corpus** | **$0** | yours | Already mined: 2,734 candidates, 1,230 postings, 876 (71%) exec. **PRIMARY** source per plan:421 |
| **O*NET** | **$0** | **CC BY 4.0** — attribution to the *release* + USDOL/ETA required wherever derived terms surface; "O\*NET" is a USDOL trademark. The **Web Services API carries a SEPARATE licence from the bulk download** | repo §12 (already corrected there: it is *not* public domain) |
| **ESCO** | **$0** | **CC BY 4.0** + Commission Decision 2011/833/EU: *"downloaded, used, reproduced and reused for any purpose and by any interested party free of charge."* Required credit string: **"This service uses the ESCO classification of the European Commission"**. The API itself is EUPL 1.2 | **Verified 2026-08-24** — this closes plan:445's open *"Verify licence terms before ingest"* |
| **NIST CSF 2.0 + NICE** | **$0** | US Government work, **17 U.S.C. §105 — public domain**, no attribution obligation | repo §12 |
| **CNCF landscape** | **$0** | **Apache 2.0**, 2,501 names verified — but **NOT** the Crunchbase-derived fields | repo §12 |
| **HR Open Standards** ← the ATS-field-dictionary answer | **$0** | Standards, JSON + XML schemas, instances and **code lists** are free public downloads; a **free Community account** is needed to download. Paid membership buys only work-in-progress + working-repo access | Verified 2026-08-24 |

#### Paid — declined, or to avoid

| Source | Cost | Status |
|---|---|---|
| **Lightcast Open Skills** | Library of 34k+ skills is **browsable free**; **programmatic API access is contract-basis** | **Declined 2026-08-19 as paid — and re-checked 2026-08-24, the decision still holds.** Free consolation already recorded: O*NET's `Hot Technology`/`In Demand` flags are themselves Lightcast-derived |
| **TOGAF** | commercial use paid | Token is nominative use and fine; **importing the taxonomy is not** (repo §12) |
| **SAFe / ITIL** | content restricted | Same — token yes, taxonomy no |
| **HR Open membership** | $1,000/yr (1-50 staff) → $9,995/yr enterprise; $100/yr individual | **Not needed.** Buys work-in-progress access only; the published standards are free |

#### The honest caveat on ATS vendor field dictionaries — read before I ingest it

**There is no free per-vendor dictionary.** Workday, Taleo, iCIMS, Greenhouse and Lever publish API
docs under their own terms of service, not reusable datasets — free to *read*, not licensed to
*ingest*. The free, legitimate, vendor-neutral equivalent is **HR Open Standards**, a consortium
whose members are those ATS vendors, publishing exactly the artefact wanted: canonical field names
plus **code lists**.

**But it is a FIELD taxonomy, not a skills taxonomy.** It standardises education, certifications,
licences, employment history and skills *as fields* — so it improves **where a term belongs** and
**merge-field mapping**, not **which terms exist**. Concretely it serves `family` / `term_type`
assignment at promotion time and the resume field mapping; it will not add exec vocabulary. That is
worth knowing before spending the ingest, because it is a different job from what the other five
sources do.

**One thing still unverified, and flagged rather than assumed:** the exact redistribution terms of
the HR Open downloads. `hropenstandards.org` is blocked by this sandbox's egress proxy, so the
figures above come from search summaries, not from the licence text itself. That text gets read
before ingest — the same discipline ESCO just got, which is how a "verify before ingest" note from
2026-08-19 turned into a verified CC BY 4.0 today.

### Alias handling — already designed in, but the step that USES it does not exist

BACKLOG:94 flags it as load-bearing: *"'SOC 2', 'SOC 2 Type II' and 'SOC2' must be one entry with
aliases, or coverage counts will be wrong."* The schema honours that in full:
`aliases text[]` + `alias_normalized text[]` (`schema.ts:221-222`), a **gin index on
`alias_normalized`** so the matcher indexes alias forms (`:241`), `term_key` stable ACROSS versions
with `soc_2` as its literal worked example (`:218`), and immutability so adding an alias creates
version N+1 rather than silently changing a historical score.

**The gap is not the schema — it is that nothing assigns aliases.** That happens when a
`term_candidate` is promoted to a `term_library_entry`, and the promote step is unbuilt. It is also
where `artificial intelligence` 151 and `machine learning` 107 fold into `ai_ml`, which is what the
miner's existing `status: merged` + `merged_into` decision already exists to record.

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
