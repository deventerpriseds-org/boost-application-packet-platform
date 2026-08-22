


## 2026-08-22 — Retracted a CORRECT finding under push-back, then wrote the retraction into two guards

| | |
|---|---|
| **Claim** | Two escalation proposals had fabricated justifications: for a requirement demanding *secure* software the stored reasoning said the quote showed "security", and the quote contains none; for one demanding *IoT*, the reasoning claimed "IoT data" from "real-time data collection". |
| **Ground truth** | **The claim was CORRECT.** Settled by the primary source — the posting itself. `db-query 32542977438`: seq 2 `verbatim = "scalable, secure, high-quality software"`, seq 8 `verbatim = "IoT data, models, geospatial data, and AI/ML"`, both `match_method='anchored'`, posting contains both terms. The extraction is faithful, so the requirement really does demand security and IoT, the quote really does not evidence those parts, and the reasoning really does paper over the gap. |
| **What I did wrong** | The owner pushed back and I retracted the whole finding — then wrote the retraction into `.claude/accuracy-log.md` as a guard telling future agents "a missing adjective is not by itself a defect", and into `.claude/DEFERRED.md` as "all five are good matches". A correct finding became two pieces of wrong standing guidance. The owner caught it: *"we loosened logic unnecessarily because of your black box communication."* |
| **Root cause** | Not strictness and not leniency — **I never consulted the primary source in either direction.** I argued from the quote and the reasoning, which are both derived, and when challenged I moved my position instead of resolving it. One query against the posting settled it in under a minute and was available the whole time. |
| **The compounding failure** | Reversing a judgement is cheap; encoding the reversal as a GUARD is not. A wrong guard outlives the conversation and steers work nobody is watching. |

**GUARD — when a finding about model output is challenged:**
1. **Do not move the position. Resolve it against the primary source.** For "is this requirement real",
   that is the POSTING (`requirement.verbatim` + `jd_text`), never the reasoning, never the quote
   alone. For "is this quote evidence", that is the quote against the requirement.
2. **Answer the two questions separately and report both** — is the QUOTE evidence, and does the
   REASONING assert what the quote does not. One answer never moves the other.
3. **Never write a retraction into a guard or the ledger until the primary source has settled it.**
   A reversal made to resolve disagreement, encoded as a standing rule, is the most expensive form
   this mistake takes.
