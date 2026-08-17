# Zap 289877647 — Engineering Screen Job Description Analysis (extracted)

Title: **(Copy) (Copy) Jotform (Latest) Engineering Screen Job Description Analysis (w Google Doc)**  ·  Status: `on`  ·  40 nodes.
Source: your Zapier export (0c70cb76-zapfile.json). This preserves the ORIGINAL prompt + email
sections in git — the live app only migrated the resume/portfolio/ATS generation prompts into the
`Prompts` Azure Table; the review/grade email (node 289877672) was NOT migrated.

| # | node id | title | action | kind | file |
|---|---|---|---|---|---|
| 2 | 289877648 | Current Resume Summary | `set_value` | baseline | [baseline/02-current-resume-summary.md](baseline/02-current-resume-summary.md) |
| 3 | 289877649 | Current Work Experience | `set_value` | baseline | [baseline/03-current-work-experience.md](baseline/03-current-work-experience.md) |
| 4 | 289877650 | Current Skills | `set_value` | baseline | [baseline/04-current-skills.md](baseline/04-current-skills.md) |
| 5 | 289877651 | Current Expertise | `set_value` | baseline | [baseline/05-current-expertise.md](baseline/05-current-expertise.md) |
| 6 | 289877652 | Relevant Skills | `set_value` | baseline | [baseline/06-relevant-skills.md](baseline/06-relevant-skills.md) |
| 7 | 289877653 | Cover Letter | `set_value` | baseline | [baseline/07-cover-letter.md](baseline/07-cover-letter.md) |
| 8 | 289877654 | About Me Passage 1 | `set_value` | baseline | [baseline/08-about-me-passage-1.md](baseline/08-about-me-passage-1.md) |
| 9 | 289877655 | About Me Passage 2 | `set_value` | baseline | [baseline/09-about-me-passage-2.md](baseline/09-about-me-passage-2.md) |
| 10 | 289877656 | Exceutive Profile Paragraph | `set_value` | baseline | [baseline/10-exceutive-profile-paragraph.md](baseline/10-exceutive-profile-paragraph.md) |
| 11 | 289877657 | Executive Profile Core Accomplishments | `set_value` | baseline | [baseline/11-executive-profile-core-accomplishments.md](baseline/11-executive-profile-core-accomplishments.md) |
| 12 | 289877658 | Soft/Hard Skills | `set_value` | baseline | [baseline/12-soft-hard-skills.md](baseline/12-soft-hard-skills.md) |
| 13 | 289877659 | Items to Omit | `set_value` | baseline | [baseline/13-items-to-omit.md](baseline/13-items-to-omit.md) |
| 14 | 294827237 | Sample Cover Letter | `set_value` | baseline | [baseline/14-sample-cover-letter.md](baseline/14-sample-cover-letter.md) |
| 16 | 289877661 | Update Resume/Portfolio Fields (Prompt) | `chat_completion_memory` | prompt | [prompts/16-update-resume-portfolio-fields-prompt.md](prompts/16-update-resume-portfolio-fields-prompt.md) |
| 17 | 299599701 | Copy: Update Resume/Portfolio Fields (Prompt) | `chat_completion_memory` | prompt | [prompts/17-copy-update-resume-portfolio-fields-prompt.md](prompts/17-copy-update-resume-portfolio-fields-prompt.md) |
| 19 | 290709248 | Skills HTML Bullet List Formatting | `chat_completion_memory` | prompt | [prompts/19-skills-html-bullet-list-formatting.md](prompts/19-skills-html-bullet-list-formatting.md) |
| 25 | 289877668 | Post Analysis QA | `chat_completion_memory` | prompt | [prompts/25-post-analysis-qa.md](prompts/25-post-analysis-qa.md) |
| 27 | 291230256 | Strip  HTML Skills Bullet List Formatting | `chat_completion_memory` | prompt | [prompts/27-strip-html-skills-bullet-list-formatting.md](prompts/27-strip-html-skills-bullet-list-formatting.md) |
| 39 | 289877672 |  | `send_email` | email | [39-send-email.md](39-send-email.md) |

## Key mappings to the live app
- node 289877661 *Update Resume/Portfolio Fields (Prompt)* → `resume_user` in the Prompts table (resume item + skill char-length rules).
- node 289877668 *Post Analysis QA* → `ats_user` (JD analysis).
- node 289877672 *send_email* (review/grade email) → **NOT migrated** — lived only in the zap until now.
- KNOWN BUG in the live table: `portfolio_user` is byte-identical to `resume_user` (bad seed).

## Full zap
- **`zap-289877647.full.json`** — the ENTIRE zap (all 40 nodes) in one file. This is the canonical "the zap we migrated" artifact.
