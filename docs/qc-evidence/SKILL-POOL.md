# The skill pool, read from live and parsed — what would actually seed 4.6-9

**Measured:** 2026-08-26 · **Source:** `GET /api/diag/skill-sources` on the deployed Function,
api-test run **32997381200**, job **98270069143**, HTTP 200, owner `von.ellis@enterpriseds.io`.
**Parser:** `api/src/functions/tests/skillPool.ts` (`buildSkillPool`), already on `main`, run against
the five field strings exactly as the route returned them.

The owner asked to see this before anything seeds it: *"let me see the skill pool you generate for
seeding."* Nothing is written by reading it — the route is read-only and the parser is pure.

---

## 1. What the store actually holds

`MasterContext`, partition `context`, **1 entity**, five populated fields:

| Field | chars | What it is |
|---|---:|---|
| `skills1` | 225 | 11 terms, `\|`-separated. Fills `{{SkillsBullets1}}`. |
| `skills2` | 180 | 9 terms, `\|`-separated. Fills `{{SkillsBullets2}}`. |
| `softHardSkillsPool` | 444 | 20 terms — the **exact union** of `skills1` and `skills2`, spaced ` \| `. |
| `expertise` | 286 | 7 statements, `\|`-separated. Longer than terms; these are claims, not keywords. |
| `relevantProficiencies` | 958 | **Two-level**: `Category: term, term, … \| Category: …`. ~40 terms in 5 groups. |

---

## 2. The pool the parser produces — 27 entries

**No term here was invented, reworded or cased differently from the store.** Origins are recorded per
term, so a term appearing in two fields is ONE entry with two origins rather than a duplicate.

**From `skills1` (+ `softHardSkillsPool`) — 11**
> Enterprise Governance · Technology Strategy · Risk Management · Digital Transformation ·
> Business Alignment · Cybersecurity Compliance · Cloud Architecture · Agile Transformation ·
> AI/Data Science Strategy · Change Management · Global Operations

**From `skills2` (+ `softHardSkillsPool`) — 9**
> Strategic Roadmaps · Stakeholder Engagement · Revenue Optimization · SaaS Leadership ·
> Process Improvement · Regulatory Compliance · Platform Engineering · Software Development ·
> M&A Due Diligence

**From `expertise` — 7**
> Budget Development and P&L Management · KPI-driven performance management · Enterprise alignment
> of strategy and execution · Governance frameworks for compliance · Optimizing scaled agile
> operations · Strategic roadmaps for customer-centric innovation · M&A due diligence and
> technology integration

**`bySource` counts:** `skills1` 11 · `skills2` 9 · `softHardSkillsPool` **0** · `expertise` 7 ·
`relevantProficiencies` **0**.

`softHardSkillsPool` contributing **0 NEW entries is correct, not a bug** — it is the union of the
other two, so every term was already seen and it is recorded as an additional ORIGIN on the existing
entry. That is the behaviour that makes the origins list meaningful.

---

## 3. THE OWNER DECISION — `relevantProficiencies` contributes nothing, and that is deliberate

All five of its groups were **rejected**, each for the same reason:

| Rejected chunk (truncated) | Why |
|---|---|
| `Governance and Compliance: Standards and Compliance, AI/ML Strategy, …` | too long to be a term (15 words) |
| `Technology Strategy and Transformation: Digital Platform Maturity, …` | too long to be a term (16 words) |
| `Business and Financial Impact: P&L Optimization, Budget and Cost Control, …` | too long to be a term (23 words) |
| `Data Analytics and AI: Enterprise Data Strategy, Data Insights Automation, …` | too long to be a term (23 words) |
| `Execution and Operations: Scaled Agile Engineering, Business Process Re-Engineering, …` | too long to be a term (27 words) |

**The parser is behaving correctly and the field is shaped differently from the others.** Every other
field is a flat `|`-separated list. This one is `Category: a, b, c | Category: d, e, f` — two levels.
The parser splits on `|` only, so each whole category arrives as one 15-27 word string, which it
refuses rather than mangles. **Refusing is the right default**: splitting on `,` blindly would also
shred `Budget Development and P&L Management`-style entries elsewhere, and inventing terms from a
format nobody confirmed is exactly what the no-fake-data rule forbids.

**So the question is the owner's, not the parser's:**

- **(a) Leave it out** — the bank seeds with **27** terms. `relevantProficiencies` stays a
  profile-narrative field, not a skill bank. No code change.
- **(b) Teach the parser the second level** — strip the `Category:` prefix, split the remainder on
  `,`, and record the category as the origin. Takes the bank to **roughly 67** terms and gives every
  proficiency a group label the swap UI could filter by. One change to `splitSkillField`, plus
  guards; the category names themselves would NOT become terms.

**Recommendation: (b)**, because those ~40 are the most specific terms in the whole store and the
grouping is real structure the swap UI can use. But this is a claim about what the owner's data
*means*, so it is not being changed unilaterally.

---

## 4. What this closes and what it does not

**CLOSES:** the "4.6-9 is blocked, the pool cannot be read" claim, which was **wrong twice today** —
see `.claude/actions.md`. The route works, the parser works, and the pool is above.

**DOES NOT CLOSE:** 4.6-9 itself. Still to build, in order — the seeder (writes the bank, per-owner),
then the `Swap for another skill…` control in the keyword panel. Neither is started.

**INHERITED DEFECT, recorded not invented:** `MasterContext` is a **single global partition**, so a
per-owner skill bank seeded from it is a data-separation problem the moment a second owner exists.
This is stated in `diagSkillSources.ts`'s own comment and repeated here so the seeder's author meets
it before writing, not after.
