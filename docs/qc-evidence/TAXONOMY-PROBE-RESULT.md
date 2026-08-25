# ESCO and O*NET, measured — closes open unknown U5

**Evidence:** `taxonomy-probe.yml` run **32800619474** (job 97660567546), ESCO live JSON API +
O\*NET bulk release **db_29_2_text**. Cross-checked for `profit and loss` by an independent
transport, Tavily `/extract` run **32800388544** (HTTP 200), which returned the identical ESCO
payload.

This closes `AC-term-library-build.md:661` **U5** — *"How many of the 105 curated terms are attested
by ESCO or O\*NET? … Requires the taxonomy files, not the DB — but it must be measured and reported
BEFORE the gate is called a gate."* It had never been measured. It is now.

## The headline

**EXACT matches across 12 terms, in either taxonomy: ZERO.** Not one term produced an `EXACT` line.
Every O\*NET hit is a `contains` — the term appearing inside a longer sentence or product name.

`schema.ts:299` / `termMiner.ts:8` claim *"roadmap 626, board 480, budget 416, operating model 222,
P&L 83 — none in O\*NET"*. The **df numbers** were always real (corpus counts, db-query
32688607431). The **"none in O\*NET"** clause carried no cited evidence anywhere in the repo. It is
now confirmed true, and true more broadly than it claimed.

## Per term

| term | ESCO — what it actually returns | O\*NET |
|---|---|---|
| `roadmap` | **no skill match** (zero results) | **absent from every published name** |
| `P&L` | semiconductors · set up portable field transmission equipment · prepare bills of lading | **absent** |
| `profit and loss` | follow betting strategies · manage profitability · estimate profitability · sell weight loss products · prevent kiln loss of heat | only inside one Task sentence |
| `operating model` | prepare cost-plus pricing models · create model · develop models · build predictive models | **absent** |
| `board` | scaffolding components · liaise with board members · on board hazards · operate tote board | 483 `contains`, all noise (boarding pass printers, switchboard) |
| `budget` | manage school budget · manage budgets · prepare casting budget | 213 `contains`, all Task sentences |
| `stakeholder management` | negotiate with stakeholders · engage with rail stakeholders | **absent** |
| `digital transformation` | keep up with digital transformation of industrial processes | `Digital Transformation Director` (Alternate Title) |
| `M&A` | handle mergers and acquisitions · design musical instruments | `DealMaven M&A Accretion/Dilution One-Pager` (a software product) |
| `due diligence` | insolvency law · monitor tank thermometer · assess crop damage | **absent** |
| `product strategy` | plan marketing strategy · sales strategies | **absent** |
| `governance` | information governance compliance · implement veterinary clinical governance | ESG Manager, Data Governance Analyst (job titles) |

## Why — the samples explain it

O\*NET is an **occupational** taxonomy, not a keyword vocabulary. Its name-bearing layers are:

- `Skills.txt` — **35** abstract items total: *Active Listening, Negotiation, Critical Thinking,
  Management of Financial Resources, Systems Evaluation, Time Management*
- `Knowledge.txt` — **33** school subjects: *Economics and Accounting, Law and Government,
  Personnel and Human Resources, Sales and Marketing*
- `Work Activities.txt` — **41** abstract verbs: *Developing Objectives and Strategies, Guiding,
  Directing, and Motivating Subordinates, Monitoring and Controlling Resources*
- `Technology Skills.txt` — **8,768** named software products: *3M Encoder, 3PL Central,
  24SevenOffice Project*

There is no layer in O\*NET that could ever hold `roadmap` or `P&L`. The nearest concept to P&L is
*Management of Financial Resources* — which no ATS scans for and no JD writes. ESCO is the same
shape: verb-phrase competences (`manage profitability`), not resume keywords.

## Two consequences for the design

**1. Taxonomy-as-gate admits NOTHING.** If membership required an ESCO/O\*NET exact match, the
published library would be empty — 0 of 12 executive terms qualify. This is not a tuning problem;
the taxonomies do not contain this class of vocabulary at all. `schema.ts:227-230` already said so
as an owner directive — *"O\*NET/ESCO are helpers, never gates"* — and this measurement is the
evidence behind it.

**2. Attestation must be EXACT, never "the search returned something."** ESCO reports
`"total": 97` for `profit and loss` and its top hit is **follow betting strategies**. A gate keyed
on "ESCO returned a result" would admit P&L on the strength of a gambling competence, and `due
diligence` on *monitor tank thermometer*. This is risk `a6` in `AC-term-library-build.md:423`
realised exactly as written, and it is why this repo's standing rule — *fuzzy matching is for
RANKING, never for ACCUSING* — applies to admission.

## What this leaves as the actual authority

Neither taxonomy can be the "anchored authority on ATS terms" the owner asked for. The only
corpus-independent signal that a phrase is a **requirement** rather than a frequent word is the
extracted `requirement` row — the system flagged it, rather than it merely being common text.
That distinction is the owner's own framing: *"so we arent just pulling words form text used often
but not highlighted by the system."*

ESCO/O\*NET remain worth recording in `sources` / `source_refs` when they do match, as provenance.
They cannot decide admission.
