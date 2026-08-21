# `resume_user.txt` in this directory is STAGED, NOT APPROVED

**Owner decision, 2026-08-21: the live `resume_user` prompt stays exactly as it is until the current
one is proven working in production.** Live is `v001`, **29,068 chars, sha `4b4af84859072c45`**.

`prompts/resume_user.txt` here is a **proposed** replacement at 26,640 chars. It drops four sections —
`Missing ATS Skills`, `Missing ATS Swap Suggestions`, `Jobscan Extraction`,
`Word and Character Requirements Check` — on the reasoning that the QC engine now computes them.

**Do not load it.** Not with `prompts-load-file.yml`, not with `POST /api/prompts`. The lane that
wrote it flagged its own risk: *"A different owner would keep `Jobscan Extraction` — its per-skill
JD-phrase→resume-phrase table is evidence provenance."* Provenance is what P8.1/P8.3/P8.4 built
subsystems to obtain, so removing its only upstream source is a product decision, not a cleanup.

The file is kept, and guarded for fidelity to its primary source, so that it is ready if and when the
owner approves it. Approval has not been given.

See `docs/qc-evidence/P7-ACCEPTANCE.md` ("Owner decisions on the live prompts") and ledger row `D33`.
