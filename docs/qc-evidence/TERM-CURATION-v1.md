# ATS term library — curation pass 1

**Every decision below is mine, and every one is reversible.** This file exists instead of me
writing 2,734 rows of SQL straight into the database: applied that way you could not see what was
kept, what was dropped, or why, and you could not change a single call without asking me. Here each
one lands in a diff you can read and argue with, and the seeder applies the file rather than my
opinion.

Nothing here is published. `keyword_coverage` stays null until the numerator fix ships (see
"Blocked on" at the foot).

## What was curated

The **top 260 candidates by the miner's own specificity ranking**, `n` of 2–4 — the order a curation
screen would show them in. Single words are excluded from this pass on purpose (see below). Every
`df` is a count of distinct postings in your corpus of 928.

Source: `term_candidate`, `status='pending'`, via `db-query.yml` run **32761369320**.

## Two rules I applied

**1. A term only belongs in the library if it DISCRIMINATES.** The library is the scoring
denominator, so a term present in nearly every posting *and* nearly every executive resume carries
no signal. `leadership` appears in 843 of 928 postings (91%); matching it says nothing about fit.
This is why the single-word band is excluded wholesale from pass 1 — it is dominated by exactly
that class (`lead` 790, `management` 774, `strategy` 772, `teams` 763).

**2. Exclusions are EXACT whole phrases, never patterns.** Deciding a candidate never reaches you is
accusation-grade, and the repo's own rule is that anything naming an offender must be exact. I had
proposed `^chief ` as a job-title filter; it happens to catch 17 rows cleanly *today*, which is luck
rather than design — `chief of staff responsibilities` or next month's corpus would take a real term
with it. Every rejection below names the literal phrase.

**Rejections MARK, they do not DELETE.** `status='rejected'` with the reason recorded, so a wrong
call is one flip to undo and the excluded set stays readable.

---

## KEPT — 96 terms across six families

### leadership (19)
`executive leadership` 303 · `senior leadership` 199 · `executive level` 160 · `technology leadership` 114 ·
`executive presence` 105 · `strategic leadership` 92 · `professional development` 88 ·
`executive communication` 88 · `performance management` 87 · `product leadership` 76 ·
`engineering leadership` 70 · `technical leadership` 65 · `thought leadership` 65 ·
`talent development` 63 · `culture of accountability` 62 · `leadership roles` 61 ·
`succession planning` 61 · `continuous learning` 71 · `culture of innovation` 56

### strategy_operating_model (23)
`product strategy` 164 · `technology strategy` 149 · `operating model` 126 *(alias: operating models 71)* ·
`strategic planning` 116 · `go to market` 109 · `product vision` 102 · `strategic direction` 82 ·
`product portfolio` 81 · `revenue growth` 80 · `competitive advantage` 78 · `strategic thinking` 76 ·
`measurable outcomes` 76 *(alias: measurable business outcomes 56)* · `strategy and roadmap` 74 ·
`strategic priorities` 72 · `strategy and execution` 69 · `product roadmap` 67 · `strategy aligned` 66 ·
`resource allocation` 64 · `strategic vision` 62 · `market trends` 61 · `strategic initiatives` 60 ·
`vision strategy` 60 · **`p and l` 55** · `board of directors` 53 · `long term growth` 55

> `p and l` is the normalised form of **P&L** — the single highest-value executive term in the corpus
> and the one a naive tokeniser destroys. It survives only because `termNormalize` keeps `and`.

### transformation (11)
`continuous improvement` 233 · `operational excellence` 142 · `operational efficiency` 125 ·
`enterprise wide` 125 · `change management` 121 · `digital transformation` 120 ·
`transformation initiatives` 98 · `technology investments` 89 · `lifecycle management` 89 ·
`organizational change` 65 · `technology initiatives` 62

### data_ai (19)
`decision making` 307 · `data driven` 159 *(aliases: data driven decision 52, driven decision making 50)* ·
`artificial intelligence` 151 *(aliases: artificial intelligence ai 67, intelligence ai 68)* ·
`ai ml` 129 · `ai enabled` 132 · `ai tools` 112 · `machine learning` 107 · `data governance` 105 ·
`data analytics` 104 · `ai powered` 98 · `data science` 95 · `data platforms` 88 · `ai strategy` 79 ·
`ai native` 78 · `data privacy` 72 · `ai driven` 67 · `responsible ai` 66 · `generative ai` 62 ·
`agentic ai` 60 · `ai governance` 60 · `ai capabilities` 85 · `enterprise data` 75

### governance_risk (8)
`risk management` 204 · `information security` 94 · `regulatory compliance` 85 · `incident response` 81 ·
`disaster recovery` 79 · `governance frameworks` 72 · `vendor relationships` 69 *(alias: vendor management 60)* ·
`data privacy` *(also in data_ai — one entry, primary family governance_risk)*

### engineering_platform (16)
`cross functional` 425 *(aliases: cross functional teams 136, functional teams 144,
cross functional collaboration 67, functional collaboration 69, cross functional leadership 52)* ·
`product management` 195 · `emerging technologies` 160 · `information technology` 159 ·
`product development` 143 · `stakeholder management` 121 · `financial services` 120 ·
`enterprise technology` 119 · `project management` 111 · `product engineering` 111 ·
`software development` 98 · `customer success` 99 · `software engineering` 97 · `supply chain` 80 ·
`enterprise software` 77 · `enterprise architecture` 75 · `cloud platforms` 73 · `product design` 70 ·
`service delivery` 67 · `ci cd` 64 · `r and d` 54

---

## REJECTED — with the class each falls into

### EEO / benefits boilerplate (46)
Every posting carries this; none of it is a candidate capability.

`regard to race` · `orientation gender` · `sex sexual` · `sex national` · `dental and vision` ·
`health dental` · `disability insurance` · `long term disability` · `term disability` ·
`consideration for employment` · `receive consideration` · `receive consideration for employment` ·
`applicants will receive` · `applicants will receive consideration` · `identity or expression` ·
`identity national` · `individuals with disabilities` · `characteristic protected` ·
`status protected` · `status disability` · `protected by law` · `protected by applicable` ·
`applicable law` · `applicable federal` · `applicable federal state` · `federal state` ·
`federal state or local` · `state or local` · `state and local` · `local law` · `local laws` ·
`age disability` · `origin age` · `origin disability` · `origin age disability` · `disability veteran` ·
`employment opportunities` · `paid holidays` · `paid parental` · `tuition reimbursement` ·
`assistance program` · `comprehensive benefits package` · `k plan` · `base pay` ·
`geographic location` · `hiring process` · `committed to providing` · `additional information`

### Degree and education requirements (15)
An education requirement, not a skill the resume places. `persona` already owns qualifications.

`bachelor degree` · `master degree` · `advanced degree` · `related field` · `computer science` ·
`degree in computer` · `degree in computer science` · `bachelor degree in computer` ·
`computer science information` · `computer science engineering` · `science information` ·
`science engineering` · `degree in information` · `engineering or a related` · `information systems`

### Job titles (11)
A different taxonomy — `persona` / roles already owns titles.

`vice president` · `chief technology officer` · `chief technology` · `chief information officer` ·
`chief information` · `technology officer` · `information officer` · `c suite` · `senior executive` ·
`senior leaders` · `human resources`

### Generic filler (28)
Frequent, but says nothing about capability.

`long term` 457 · `high performing` 350 · `end to end` 243 · `full time` 208 · `united states` 177 ·
`high quality` 164 · `large scale` 158 · `third party` 130 · `world class` 126 · `day to day` 123 ·
`fast paced` 111 · `high growth` 109 · `deep expertise` 106 · `high impact` 104 · `next generation` 97 ·
`non technical` 94 · `technology solutions` 92 · `short term` 92 · `every day` 81 ·
`high performance` 81 · `use cases` 78 · `leading enterprise` 72 · `performing teams` 71 ·
`high performing teams` 71 · `real time` 71 · `customer facing` 68 · `high value` 67 ·
`cutting edge` 64 · `mission critical` 69 · `high level` 62 · `complex technical` 84 ·
`internal and external` 75 · `written and verbal` 58 · `products and services` 58 · `around the world` 57

### Verb phrases, not terms (25)
The miner's edge rules let these through; they describe an action, not a capability an ATS indexes.

`develop and execute` · `foster a culture` · `fostering a culture` · `partner closely` ·
`partner with product` · `build and lead` · `build and maintain` · `define and execute` ·
`translate complex` · `identify opportunities` · `lead and develop` · `closely with product` ·
`teams to ensure` · `responsible for defining` · `ensuring alignment` · `provide strategic` ·
`success leading` · `building and scaling` · `ensure compliance` · `reporting directly` ·
`shape the future` · `problem solving` · `re looking` · `don t` · `isn t`

> `don t` and `isn t` are contraction fragments — `termNormalize` strips the apostrophe and the
> miner's edge rule does not catch a two-token remainder. Worth a filter fix, not just a rejection.

### Marginal — deliberately HELD, not decided (7)
Real terms, but I am not confident they discriminate for **your** roles. Left `pending` rather than
decided either way, because a wrong keep inflates a score and a wrong reject hides a gap.

`engineering teams` 110 · `customer needs` 84 · `product managers` 84 · `product teams` 68 ·
`professional services` 68 · `technical teams` 61 · `performance metrics` 60

---

## What this pass does NOT cover

- **Single-word candidates** (945 rows at `n=1`). Some are real and valuable — `cybersecurity` 205,
  `governance` 450, `roadmap` 387, `compliance` 435, `architecture` 377, `automation` 286,
  `analytics` 301, `cloud` 363 — but they sit alongside `leadership` 843 and `management` 774, and
  separating them needs the discrimination rule applied per term. Pass 2.
- **Candidates below the top 260** by specificity — roughly 2,470 rows, mostly `df` under 60.
- **`display_term` casing.** `term_candidate.ngram` stores the NORMALISED form despite its comment
  claiming otherwise, so `SAFe` is stored as `safe` and `P&L` as `p and l`. The promote step must
  restore real casing, or `case_sensitive_acronym` matches a lowercase pattern and silently does
  nothing. **`ci cd` → `CI/CD`, `p and l` → `P&L`, `r and d` → `R&D`, `ai ml` → `AI/ML`.**

## Blocked on

**Nothing may be published until the coverage numerator is fixed.** `appChecks.ts` supplies
`covered: 0` alongside a real `scoreable`, so the moment any library version publishes,
`keyword_coverage` computes `round(0/N*100)` and renders a measured-looking **0%** across six
screens. Fixed in PR #51; publishing before that lands would put a fabricated number in front of
you. That is why this pass stops at decisions.
