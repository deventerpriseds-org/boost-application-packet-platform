# AC — `llm-coverage-judge`

```
WHAT:          Acceptance criteria + feasibility table for replacing the lexical `coversIn`
               predicate with an LLM-derived, machine-verified coverage verdict that the
               approval GATE reads (must_have_coverage / responsibilities_addressed /
               evidence_placed).
WHY:           On the owner's live Trinnex packet the shipped ResumeSummary scores 0/19
               requirements covered while four are visibly paraphrased. Measured root cause:
               `coversIn` needs 70% LITERAL content-word overlap with no derivational
               morphology, so `strategy`!=`strategies`, `leadership`!=`leader`.
               See DIAG-coverage-recognition.md and FEASIBILITY-llm-judgement.md.
SUPERSEDES:    nothing. This is the AC pass for the work FEASIBILITY-llm-judgement.md §7 proposes.
SUPERSEDED-BY: nothing -- current.
EVIDENCE:      docs/qc-evidence/DIAG-coverage-recognition.md
               docs/qc-evidence/FEASIBILITY-llm-judgement.md
               branch claude/incumbent-wins-swap @ 44271bf
TIER:          1 (accusation grade -- the change decides `must_have_coverage`, which is the
               gate, and admits model output into a stored claim).
STATUS:        IN PROGRESS -- sections appended as they are settled.
```

---
