

## 2026-08-22 — Collapsed "the match is good" and "the reasoning is fabricated" into one verdict

| | |
|---|---|
| **What I did** | Called two escalation proposals "stretches" because the model's REASONING asserted things absent from the quote ("security", "IoT"). |
| **What was actually true** | Two separate facts, and I reported them as one. **The MATCH is good** — the quote evidences the requirement. **The REASONING contains a fabricated claim** — it says the excerpt shows security when nothing in it is about security. |
| **The two errors, in order** | (1) I judged the MATCH bad on the basis of the REASONING. The owner corrected that. (2) I then retracted the whole finding, throwing away the valid observation about the reasoning — the owner corrected that too: *"you were correct and i agree with you mentioning secure / security is just false and fabricated."* |
| **Root-cause pattern** | Not strictness, and this is why the first version of this entry was wrong. The failure is COLLAPSING TWO JUDGEMENTS INTO ONE VERDICT, then swinging the whole verdict when either half is challenged. Over-correcting is the same error as over-claiming: both replace a decomposition with a single label. |
| **Cost** | A real defect — a model fabricating justification text that is STORED and SHOWN to the owner as evidence — was briefly written out of the ledger as "no finding". Recorded as `D:proposal-reasoning-unverified`. |

**GUARD — before writing any verdict on a model output, answer BOTH questions separately and say
both answers:**
1. **Is the QUOTE evidence for the requirement?** Judge the excerpt against the requirement as a
   whole. A compound requirement ("scalable, secure, high-quality") is one capability claim, not
   three token searches — a missing adjective is not by itself a defect.
2. **Does the REASONING assert anything the quote does not support?** That is a fabrication and is
   worth reporting on its own, whatever the answer to (1) was.
3. **Never let one answer move the other**, and never retract a sound observation because a
   different one was wrong. If challenged on either, re-answer THAT question — not both.
