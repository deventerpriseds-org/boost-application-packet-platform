# ATS term library — sample entries for sign-off

**Nothing here is published.** These are candidate entries in the real `term_library_entry` shape,
derived from **your corpus**, for you to judge the shape and the quality bar before the seeder and
the publish route are built. `term_library` and `term_library_entry` exist in `schema.ts` with a
full design — families, term types, match modes, per-source audit, immutability — and **zero rows
and no writer**. That emptiness is what makes `keyword_coverage` null, `Keywords placed` unbuildable
and `Every library keyword lands in a field` unrenderable.

## Where the numbers come from

`evidence_df` = how many DISTINCT postings in your own corpus contain the term. Measured
2026-08-24 over **the opportunities holding `jd_real` longer than 800 characters**, via
`db-query.yml` runs **32687462831** and **32687509847**. Not estimated, not modelled.

Nothing below was invented by a model. Every candidate came out of the corpus, and every one that
did not appear was dropped rather than kept on plausibility.

---

## Two findings that change the design, both measured rather than assumed

### 1. Capitalisation measures SENTENCE POSITION, not termhood

The first extraction pass ranked capitalised phrases by document frequency. Its top rows:

| term | df | what it actually is |
|---|---:|---|
| `Lead` | 850 | a bullet-initial verb |
| `Partner` | 718 | a bullet-initial verb |
| `Proven` | 694 | a bullet-initial adjective |
| `Build` | 644 | a bullet-initial verb |
| `Establish` | 544 | a bullet-initial verb |

Every one is capitalised because it starts a line, and the pass could not tell that from a proper
noun. **A seeder that ranks on capitalisation seeds verbs.** The second pass requires the candidate
to sit MID-SENTENCE (preceded by a lowercase word or comma) or to be a pure acronym — and the verbs
vanish.

### 2. Frequency cannot separate a TERM from a SECTION HEADING

Even mid-sentence, the ranking is led by document furniture:

| term | df | class |
|---|---:|---|
| `Responsibilities` | 377 | section heading |
| `Qualifications` | 288 | section heading |
| `You` | 262 | pronoun |
| `SaaS` | **198** | **a real term** |

`Responsibilities` is nearly twice as common as `SaaS` and is not a skill. **Document frequency
measures commonness; termhood needs a type.** The schema already anticipated this — `term_type`
and `family` are required columns — so the seeder must classify, and anything it cannot classify
into a known type does not enter the library.

### The exclusion classes the corpus produced

Named here because each will re-appear on every future seed run, and a seeder that rediscovers them
each time will re-admit them:

| class | examples from the run | why excluded |
|---|---|---|
| Section headings | `Responsibilities` 377, `Qualifications` 288, `Description` 193, `Summary` 135, `Overview` 115 | document furniture |
| Job titles | `Vice President` 204, `CEO` 255, `CTO` 175, `Chief Technology Officer` 68 | a different taxonomy — this app already has `persona` / roles for titles |
| Degree fields | `Computer Science` 275, `Business Administration` 97, `Information Systems` 90 | an education requirement, not a skill the resume places |
| Geography | `CA` 70, `NY` 57, `VA` 91, `DC` 82, `California` 65, `Canada` 62 | eligibility, handled by `owner_fact.identity.location` |
| Benefits | `Dental` 70, `Medical`, `PTO` | employer offer, not candidate capability |
| Boilerplate | `You` 262, `Company` 155, `Range` 154, `Type` 85, `Title` 58 | template scaffolding |

---

## Sample entries — 18 across five families

`scoreable` is `true` only where the term is corpus-attested AND has one correct written form.
`sources: ['jd_corpus']` on every row, because that is the only source consulted so far;
corroboration against O*NET / ESCO / NIST / CNCF is what would raise `confidence`, and the schema's
`source_manifest` requires naming each release and its licence when that happens.

### family: `cloud_platform`

| term_key | display_term | aliases | term_type | match_mode | evidence_df | scoreable |
|---|---|---|---|---|---:|:--:|
| `aws` | AWS | Amazon Web Services | technology | `case_sensitive_acronym` | **151** | yes |
| `azure` | Azure | Microsoft Azure | technology | `exact_norm` | **72** | yes |
| `gcp` | GCP | Google Cloud Platform, Google Cloud | technology | `case_sensitive_acronym` | **56** | yes |

### family: `engineering_practice`

| term_key | display_term | aliases | term_type | match_mode | evidence_df | scoreable |
|---|---|---|---|---|---:|:--:|
| `ci_cd` | CI/CD | continuous integration, continuous delivery | practice | `case_sensitive_acronym` | **100** | yes |
| `devops` | DevOps | — | practice | `exact_norm` | **78** | yes |
| `agile` | Agile | — | framework | `exact_norm` | **112** | yes |
| `sdlc` | SDLC | software development lifecycle | framework | `case_sensitive_acronym` | **57** | yes |
| `api_design` | APIs | API, application programming interface | technology | `case_sensitive_acronym` | **126** | yes |

### family: `data_ai`

| term_key | display_term | aliases | term_type | match_mode | evidence_df | scoreable |
|---|---|---|---|---|---:|:--:|
| `ai_ml` | AI/ML | machine learning, artificial intelligence | competency | `case_sensitive_acronym` | **174** | yes |
| `llm` | LLM | large language model, LLMs | technology | `case_sensitive_acronym` | **79** | yes |
| `data_science` | Data Science | — | competency | `exact_norm` | **72** | yes |
| `analytics` | Analytics | — | competency | `exact_norm` | **65** | yes |

### family: `security_compliance`

| term_key | display_term | aliases | term_type | match_mode | evidence_df | scoreable |
|---|---|---|---|---|---:|:--:|
| `cissp` | CISSP | — | certification | `case_sensitive_acronym` | **64** | yes |
| `nist` | NIST | NIST CSF, NIST Cybersecurity Framework | framework | `case_sensitive_acronym` | **57** | yes |
| `gdpr` | GDPR | — | regulation | `case_sensitive_acronym` | **56** | yes |

### family: `business_platform`

| term_key | display_term | aliases | term_type | match_mode | evidence_df | scoreable |
|---|---|---|---|---|---:|:--:|
| `crm` | CRM | customer relationship management | technology | `case_sensitive_acronym` | **100** | yes |
| `erp` | ERP | enterprise resource planning | technology | `case_sensitive_acronym` | **101** | yes |
| `salesforce` | Salesforce | — | technology | `exact_norm` | **56** | yes |
| `pmp` | PMP | Project Management Professional | certification | `case_sensitive_acronym` | **79** | yes |

---

## Why `case_sensitive_acronym` matters, concretely

The schema offers three match modes and the acronym one is not decoration. Matching `AI`
case-insensitively hits **`detail`, `email`, `retail`, `available`, `domain`** — a resume would be
credited with artificial intelligence for containing the word "detail". `ML` case-insensitively hits
`html`. That mode exists so a two-letter acronym can be matched safely, and every acronym above uses it.

## One measurement caveat, stated rather than buried

`AI` alone measured **836** — but the acronym pattern matches the `AI` inside `AI/ML` too, so that
836 OVERLAPS the 174 for `AI/ML` and is not a count of postings wanting general AI capability. The
sample above therefore carries `ai_ml` at its own measured 174 and does **not** seed a bare `ai`
entry. A seeder must de-overlap nested acronyms before trusting any of these counts, and this row is
the proof that it matters.

## What is deliberately NOT here

- **No model-invented terms.** The schema's `scoreable` column exists precisely so a model
  suggestion can be displayed without scoring — the prototype models it too (`DevSecOps`, source
  `model`, `freq: 0`, *"earns no score credit"*). Nothing below was proposed by a model.
- **No `confidence` values.** Confidence is defined as derived from independent-source
  corroboration, and only one source has been consulted. Writing a number now would be the
  fabricated-composite failure this repo forbids: a component of the score has no source, so the
  score is null.
- **No `soc_codes` or `source_refs`.** Those need O*NET / ESCO, which need the licence and
  attribution handling `source_manifest` describes.

## What sign-off unlocks

Publishing a first version makes `keyword_coverage` a real number instead of null, and turns four
currently-unbuildable UI rows into ordinary work: `Keywords placed` chips, the keyword detail panel,
"Claimed but not in the text", and the `Every library keyword lands in a field` check.
</content>
