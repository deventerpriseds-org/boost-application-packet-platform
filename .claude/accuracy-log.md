
## 2026-08-22 — Called correct model matches "stretches", twice in one session

| | |
|---|---|
| **Claim** | Two of five escalation proposals were "stretches": for *"scalable, **secure**, high-quality software"* the quote "says nothing about security"; for *"AI/ML and **IoT**"*, "real-time data collection is not IoT". |
| **Ground truth** | Both are good matches. The owner: *"How is the quote saying nothing about security when it is requiring the ability to build scalable secure and high quality software?... I'd have to say the second example with AI/ML is close enough as well."* |
| **The single source that would have settled it** | Asking what a human reviewer would conclude from the requirement AS A WHOLE — not auditing each adjective for a matching token. A compound requirement is satisfied by evidence of the capability, not by term-by-term coverage. |
| **Root-cause pattern** | Applying token-level strictness to a RELEVANCE judgement. The deterministic matcher must be term-exact because it ACCUSES; a relevance read must not be, because it RANKS. I imported the wrong standard across that line. |
| **Why it is in this log rather than a note** | **SECOND OCCURRENCE THE SAME DAY.** Earlier: I called a correct match a false positive and was corrected — *"an llm also would have said it was true positive due to evidence like these meeting the requirement."* A repeat means prose did not hold. |
| **Cost** | Not just a wrong tally. Those two examples were the empirical evidence cited for keeping proposed rows out of the coverage gate, and they were written into `.claude/DEFERRED.md` as a live finding. The design decision may still be right on structural grounds — the evidence offered for it was not. |

**GUARD — apply before writing "stretch", "false positive", "overclaims" or "weak match" about any
model output:**
1. **State what a human reviewer would conclude from the requirement as a whole, FIRST.** If that
   answer is "yes, this person clearly does this", the match is good — stop. A missing adjective is
   not a defect.
2. **Never audit a compound requirement adjective-by-adjective.** "scalable, secure, high-quality"
   is one capability claim, not three token searches.
3. **The model's REASONING being padded is not the MATCH being wrong.** Judge the quote against the
   requirement; judge the reasoning separately and say which one is at fault.
4. Only after 1–3 still say "no" may the word "stretch" be used — and then name the specific thing a
   reviewer would reject, not the term that failed to appear.
