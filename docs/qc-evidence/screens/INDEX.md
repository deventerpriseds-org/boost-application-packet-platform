# Screens index

47 viewport captures of the prototype, in narrative order. All taken at ~924px wide (the
chips-rail breakpoint) unless noted; shots are crops of the scrolled content, so the top bar and
step rail repeat.

`ARROW` note: the floating "Assistant" button and the bottom "UI SPEC" pill are prototype chrome
and overlap content in some shots.

## JD analysis
| File | Shows |
|---|---|
| 01-jd-responsibilities.png | Extracted from this posting — Responsibilities tab, tab counts |
| 02-jd-requirements-must.png | Requirements tab, MUST HAVE group |
| 03-jd-requirements-nice.png | Requirements tab, NICE TO HAVE group incl. the uncovered FedRAMP line |
| 04-jd-ats-keywords.png | ATS keywords tab — two-column list, library footer |
| 05-jd-evidence-expanded.png | A row expanded: verbatim profile excerpt + source + "Where it is used →" |
| 06-jd-fit-cards.png | Posting vs your profile — four fit cards with graded verdicts |
| 07-jd-compare-table.png | Comparison table: posting asks / profile evidences / fit |

## Overlays
| File | Shows |
|---|---|
| 08-ats-analysis-modal.png | ATS analysis modal opened from the header score (keywords + QC summary) |
| 17-keyword-detail-panel.png | Keyword chip detail: match quality, what it displaced, put back / swap / drop |
| 18-ask-for-a-change-inline.png | Inline "Ask for a change", scoped to one field |
| 44-assistant-panel.png | Assistant panel with field-level change list and Keep / Revert / Re-run QC |

## Resume step
| File | Shows |
|---|---|
| 09-resume-step-top.png | Artifact card header, gate badge, doc buttons, collapsed asset header |
| 10-asset-header-expanded.png | "What this resume answers" expanded — counters + open items |
| 11-resume-summary-field.png | Resume summary field with margin provenance |
| 12-original-and-changes-made.png | "Show original" open + "Changes made" trail with Undo |
| 13-skills-list-field.png | Skills 2 list field — original → final rows |
| 14-work-experience-static.png | Static work-history block: real template text, items in the margin |
| 15-ats-keyword-block.png | Compact resume pipe block (monospace) |
| 16-empty-merge-fields.png | Compact resume's empty SkillsBullets1/2 shown as template text |

## Cover letter step
| File | Shows |
|---|---|
| 19-cover-letter-step.png | Artifact card, Slides buttons, collapsed header |
| 20-cover-header-expanded.png | "What this cover letter answers" expanded |
| 21-cover-letter-body.png | Letter body with keyword highlights and echo underlines |
| 22-cover-letter-body-lower.png | Letter body lower half + margin trail |
| 23-cover-letterhead-template.png | Letterhead / signature / layout template block with merge placeholders |

## Portfolio and video steps
| File | Shows |
|---|---|
| 24-portfolio-step.png | Portfolio artifact card |
| 25-portfolio-accomplishments.png | Core accomplishments pick-list — chosen, not rewritten, mapped to requirements |
| 26-portfolio-deck-skills.png | Static deck skill set with the same mapping |
| 27-intro-video-step.png | Intro video step (todo status, generate script) |

## QC & evidence step
| File | Shows |
|---|---|
| 28-qc-step-top.png | QC header: composite, per-asset gate chips, score block |
| 29-qc-done-for-you.png | "Done for you" — 15 corrections already applied, Change it / Review → |
| 30-qc-needs-a-decision.png | "Needs a decision" — fails and open questions first |
| 31-qc-needs-a-decision-lower.png | Remaining reviews and your-call items |
| 32-qc-coverage-tab.png | Coverage tab — posting line by line + keyword tally |
| 33-qc-swaps-tab.png | Swaps tab — every list item, original → final, covering keyword |
| 34-qc-passes-tab.png | Passes tab — remediation loops, what closed, where it halted |
| 35-qc-checks-tab.png | Checks tab — rules and reviewer checks with named offenders |
| 36-qc-reviewer-tab.png | Review tab — blind second model grade, citations, critique |

## Drawer and send
| File | Shows |
|---|---|
| 39-drawer-fields-tab.png | Drawer opened by deep link, Fields tab, gate footer |
| 40-drawer-checks-tab.png | Drawer Checks tab |
| 41-drawer-swaps-tab.png | Drawer Swaps tab |
| 42-drawer-reviewer-tab.png | Drawer Review tab |
| 43-drawer-match-tab.png | Drawer Match tab (score breakdown) |
| 37-review-and-send.png | Review & send — per-asset gates and statuses |
| 38-review-send-gate-list.png | Packet gate card derived from the live fail list |

## Prototype-only comparison mode (do not build)
| File | Shows |
|---|---|
| 45-current-app-mode.png | "Current app" — the layer removed, today's behavior |
| 46-current-app-mode-lower.png | Current app: the collapsed draft string and the empty-chip bug note |
| 47-qc-layer-highlight-off.png | QC layer with "Highlight additions" off — production appearance |

---

## The APP side, same seven steps (added 2026-08-29)

The 47 captures above are the PROTOTYPE — the denominator `PROTOTYPE-COVERAGE.md` measures against,
and they do not need re-taking. What was missing was the other half of the comparison: what the app
actually renders. These seven are that half, taken at the same ~924px width, against real Trinnex
data (opp `9f9c370a`) through the local fixture harness at `main` = `025a54b`.

| File | Step | app / proto body chars |
|---|---|---|
| app-jd.png | Posting analysis | 6,997 / 3,355 |
| app-resume.png | Resume | 15,889 / 13,990 |
| app-cover.png | Cover letter | 4,209 / 4,746 |
| app-portfolio.png | Portfolio | 14,021 / 7,213 |
| app-video.png | Intro video | 736 / 781 |
| app-qc.png | QC & evidence | 128,803 / 6,575 |
| app-send.png | Review & send | 7,720 / 915 |

**READ THESE FOR STRUCTURE, NOT FOR VALUES.** Which panels, controls and states exist is what the
coverage comparison needs and is what these prove. The specific numbers and findings inside them are
NOT current: the harness serves a point-in-time fixture dump, so `app-qc.png` shows a
`skill_char_limit` finding reading *"5 of 20 skills exceed 30 chars"* from an older check run, while
the live row for that same check reads `pass — 20 skills, longest 22 — every skill <= 24` as of
15:47 on 2026-08-29. Reading a finding off one of these as current is the exact trap that produced
three false defect reports earlier the same day.

**Character counts are not a completeness measure either** — the owner named that directly. `app-qc`
at 19x the prototype is an outlier that still wants explaining, not a score.

Regenerate with `/tmp/render-all.mjs <oppId> <route-keyed fixtures>`; see `LOCAL-RENDER-UAT.md` for
the fixture requirements, and note `build-fixtures.mjs` must be run on a raw dump first.

## Render pass 2026-09-02 — §4.8 / §4.10 parity (see PROTOTYPE-COVERAGE.md §16)

| File | Instrument | Data | Shows |
|---|---|---|---|
| render-0902-live-qc.png | `ui-verify.yml` run 33642950751 | **LIVE production** | QC step: gate, four numbers, per-asset chips, Done for you, Needs a decision |
| render-0902-live-send.png | `ui-verify.yml` run 33643149667 | **LIVE production** | Review & send: 5 asset rows, gate card `14 items to fix across 5 assets`, `Open field →` on 4 rows |
| render-0902-tab-coverage.png | `render-app.mjs` | fixture (run 33642945263) | Coverage tab: must-have 7/7, nice-to-have `not measured`, Responsibilities 11/11 |
| render-0902-tab-compare.png | `render-app.mjs` | fixture | Original vs final: `Undo this` + `Ask why` paired in the last column |
| render-0902-tab-checks.png | `render-app.mjs` | fixture | Checks tab grouped by rule with named offenders |
| render-0902-tab-review.png | `render-app.mjs` | fixture | Independent review: prompt source, grade, agreement, citations, critique |
| render-0902-tab-loops.png | `render-app.mjs` | fixture | Remediation loops: honest "generated once and never revisited" |

**COUNTS OFF THE FIXTURE SHOTS ARE UNUSABLE — structure only.** `fixture-refresh.yml` has no
`run_id` predicate while the live route does, so the fixture carries every historical check run
(246 rows / 26 distinct `check_key` on the resume). That is why the fixture `Checks` tab repeats a
rule and why the older `app-send.png` reads `112 items` where live reads `14`. PROTOTYPE-COVERAGE.md
§16d has the evidence and the fix. The two `render-0902-live-*.png` shots went through the real
route and do not have this problem.
