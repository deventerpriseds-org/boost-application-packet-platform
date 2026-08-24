# How ATS actually works, and what it means for this product

Researched 2026-08-24. **Calibration first:** most writing on this subject is content marketing by
companies selling resume-scanning tools, and it is repetitive rather than evidentiary. The claims
below are marked by how well they are supported. Where the strongest available source is still a
vendor, that is said rather than hidden.

---

## 1. The myth that distorts everything downstream

> **"75% of resumes are auto-rejected by an ATS before a human sees them."**

**Unsupported.** The figure traces to a defunct 2013 startup and has **no peer-reviewed study behind
it**. It matters because it drives the entire keyword-stuffing folk practice — if a robot is
rejecting you, you fight the robot. That premise is wrong.

**What the strongest source actually found.** The one piece of work with real methodology in this
space reviewed **1.7 million job applications and 225,000 resumes**, and interviewed recruiters at
Amazon, Microsoft, a Big Four consultancy and a Fortune 500 manufacturer:

- **92% of ATS platforms rank and sort** — but **recruiters, not algorithms, decide where to stop
  reading** the ranked list.
- The ATS *"doesn't actually rank candidates or decide who is better"* — it gives recruiters
  **filters**, and a human works the filtered set.

So the resume is not fighting a gatekeeper robot. It is competing for **position in a list a human
scrolls**, and separately it must **survive being filtered out** by hard criteria.

---

## 2. What actually happens, stage by stage

| Stage | What the system does | Can the resume's wording change the outcome? |
|---|---|---|
| **1. Parse** | Converts the file to text and maps it onto the vendor's own field schema | **No — but formatting can destroy it.** See §5 |
| **2. Knockout** | Hard filters: work authorisation, minimum education, a required certification, years of experience | **No.** These are answered in the *application form*, not the resume. An unmet hard requirement is a real gap |
| **3. Search / filter** | Recruiter runs boolean filters over the **normalised** fields (`AND` / `OR` / `NOT`) | **Yes — this is where terms matter most** |
| **4. Rank / sort** | Orders the surviving set | **Yes, partially** |
| **5. Human read** | A person reads the top of the list | **Yes — and this is what actually gets you picked** |

Two things follow that most advice gets wrong:

- **Boolean search is mostly a *sourcing* tool** — recruiters going out to *find* candidates in the
  database — more than an *incoming-application screen*. It is described bluntly in the research as
  *"filters with a better paint job,"* 30-year-old technology.
- **Knockout questions are the real rejection mechanism**, and no resume wording fixes them.

---

## 3. Where keywords matter, and where they do not

**Three zones of keyword real estate**, in descending order of what they buy you:

1. **Professional summary** — high-level terms, recognised immediately by the human reader.
2. **Skills / tools section** — precise tool and technology terms. This is what the vendor taxonomy
   normalises and what boolean filters hit.
3. **Experience bullets** — where a term is tied to outcome and scope. **Often the most persuasive**,
   because the skills section asserts and the bullet *evidences*.

**Repetition does not help.** The consistent finding: *a term in the right place beats the same term
repeated*. One or two natural uses with evidence outperform density. This kills the keyword-stuffing
strategy on its own terms — not for honesty reasons, for effectiveness reasons.

### Exact match vs synonym — the nuance that matters here

The blunt version everywhere is *"the ATS doesn't care about synonyms, it cares about exact matches"*
— if the posting says `customer support`, write `customer support`, not `customer assistance`.

The more careful version, and the one that fits the design: **modern systems do some semantic
matching, and the recommended hedge is to carry the core term *plus* a small set of widely accepted
variants.** That is precisely an **alias set**, which is why aliases were called load-bearing.

**The honesty constraint is explicit in the source material, not something added here:** mirror the
employer's wording *only where it is accurate for you*; otherwise use a truthful synonym that
reflects real experience. That is the same rule as SPEC R2 — evidence or escalate — arrived at
independently.

---

## 4. What this means for the library — it CONFIRMS the owner's reading

The owner's position was: *"the library is a guide or examples for what the prompts already have the
AI doing, not a strict source. If the perfect value is available great; if it's not quite close
enough, generate in a similar style/length to the others in the library."*

The research supports that, and the SPEC already encodes it:

| Research finding | SPEC mechanism that already exists |
|---|---|
| Exact match is the safest hit | `match: exact` → scored |
| Carry accepted variants alongside the core term | `match: variant`, the `≈` reworded chip → scored |
| Semantic/loose matching is unreliable | `match: loose` → **shown, not scored** |
| Never claim what is not true | `source: model` → **shown, never scored**; `scoreable` column |

**So the library is not a whitelist on what the AI may write. It is the denominator for what
COUNTS.** The AI can write anything; the library decides what earns credit. That is exactly the
owner's "guide, not strict source" — with one addition worth stating plainly: the library **is**
strict about credit, and that strictness is what stops the model grading its own work.

**"Generate in a similar style/length to the others"** is the `variant` tier, and it already scores.
It is not a design change — it is a tier the design has and the product has never populated.

---

## 5. The biggest cause of failure is PARSING, and this product does not check for it

This is the finding with the most practical value, and it is the one the product currently ignores.

**A 2023 Jobscan analysis put over 60% of online-submitted resumes as having formatting or content
issues that disrupt parsing.** (Vendor source — Jobscan sells a scanner — so treat the exact figure
as indicative, not proven. The failure *mechanisms* below are independently well documented.)

| What breaks | Why |
|---|---|
| **Tables and multi-column layouts** | The parser serialises top-to-bottom, left-to-right — so a two-column layout interleaves as *row1col1, row1col2, row2col1…*, putting a job title next to skills from a different role |
| **Headers and footers** | Most engines **ignore** these regions entirely as "page furniture" — contact details placed there can vanish |
| **Text boxes** | Many parsers skip the layer completely |
| **Graphics, logos, skill bars** | Cannot be read; the information simply disappears |
| **Inconsistent dates** | Mixing `March 2023`, `03/2023` and `3-23` confuses date extraction |

### The gap in this product, stated precisely

Every check that exists today is about **text content**: `word_counts`, `skill_char_limit`,
`relevant_char_limit`, `expertise_phrase_length`, `empty_merge_fields`, `whitespace`,
`markup_residue`, `ai_tells`, `cross_list_redundancy`, `company_named`, `company_in_body`.

**None of them asks whether the rendered document can be parsed.** A packet can pass every check,
score well, clear the gate — and still be a two-column template whose skills interleave with job
titles the moment a parser reads it.

**But the right fix is NOT a new per-packet check.** Artifacts render from a Google Docs template the
owner controls, so parse-safety is a property of the **template**, not of each generated packet. It
is a **one-time template audit** — tables, columns, headers/footers, text boxes, images, date format
— not a check that should run on every build. Naming it as a per-packet check would add ceremony to
every packet to catch a defect that can only change when the template changes.

---

## 6. Vendor field dictionaries — why chasing them is a dead end

Workday's skills field is a **structured taxonomy with a predefined standardised list**, not a
free-text box — a searchable database field recruiters filter on directly. That taxonomy is
proprietary; there is **no free developer download** for Workday's or Greenhouse's field/skills
dictionary.

**The finding that settles it:** ATS vendors increasingly build those taxonomies **on top of
Lightcast/EMSI or O\*NET**. So a vendor dictionary is largely a re-wrapped copy of sources already
available free — bought at the price of a licensing problem. **HR Open Standards** remains the only
free, legitimate route to vendor-shaped *field structure*, and it standardises **fields, not
skills**.

Which gives the ATS-field-dictionary decision a concrete job it can actually do: research §3 says
**section placement changes what a term is worth**. A field taxonomy is what lets the library record
**which field a term belongs in** — summary vs skills vs experience bullet. That is a real capability
and it is not what a skills taxonomy provides.

---

## Sources

Ranked by evidentiary weight. The first has real methodology; the rest are practitioner or vendor
material, consistent with each other on mechanism and unreliable on statistics.

- [How Applicant Tracking Systems Actually Work](https://huntr.co/blog/how-applicant-tracking-systems-work) — the 1.7M-application / 225k-resume review, recruiter interviews, and the debunking of the 75% figure
- [Jobscan — What is an ATS](https://www.jobscan.co/applicant-tracking-systems)
- [Jobscan — resume tables and columns](https://www.jobscan.co/blog/resume-tables-columns-ats/)
- [Jobscan — ATS formatting mistakes](https://www.jobscan.co/blog/ats-formatting-mistakes/)
- [CIO — beating a resume-filtering ATS](https://www.cio.com/article/284414/applicant-tracking-system.html)
- [Indeed — ATS resume keywords](https://www.indeed.com/career-advice/resumes-cover-letters/ats-resume-keywords)
- [Goodwill — using keywords on your resume](https://www.goodwill.org/blog/career-and-financial-advice/how-to-use-keywords-on-your-resume-and-why-it-matters-in-2026/)
- [How Workday, Greenhouse & Taleo read your resume](https://www.shashiworks.com/ats-workday-greenhouse-taleo.html)
- [ATS parsing errors: causes and fixes](https://scale.jobs/blog/ats-parsing-errors-causes-and-fixes)
