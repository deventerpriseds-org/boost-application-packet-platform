# Post Analysis QA

_Zap 289877647 · node 289877668 · action `chat_completion_memory`_

## system_message

```
You are a helpful assistant.
```

## user_message

```
(Input - Job Responsibilities & Skills) 
Store but don't output the column items from the html table included here so that they can be recalled as the "Job Responsibilities & Skills list" in upcoming tasks: {{289877662__output__Item 33}}

(Input - Resume Summary) 
Store but don't output this passage as the "Resume Summary" to be referenced in tasks below: {{289877667__ResumeSummary}}

( Input - Skills & Relevent Skills )
Skills 1:{{289877667__skills list 1}}Skills 2: {{289877667__skills list 2}}Expertise: {{289877667__Expertise}} Relevant Skills 1: {{289877667__Relevant 1}}Relevant Skills 2:{{289877667__Relevant 2}}Relevant Skills 3:{{289877667__Relevant 3}}


The tables below reference data from a previous prompt sharing memory key {{289877647__id}}{{289877660__hour}}

### Final Skills QC  ### (Incude Final Skills QC as a header)
Compare the following skill lists against the provided job description

**Objectives:**
1. Identify and eliminate redundancy across Skills Lists A (1,2), Skills Lists B (1,2),  and the Relevant Skills Lists (1, 2, and 3).
2. Compare each skill in Lists A to Lists B, and Relevant Skills. When merging, replace it only if a more relevant, non-redundant, critical skills for the ideal candidate for the JD and ATS-optimized term exists.
3. Skills A (from lists 1,2) and Skills B (from lists 1,2) items must be 24 characters or fewer.
4. All Relevant Skills (from lists 1, 2, and 3) must be 20 characters or fewer.
5. Produce an **HTML table** with the following columns:
   - List A Skills (1,2) and relevant list a skills (1,2 and 3)
   - List B Skills (1,2) and  relevant list b skills (1,2 and 3)
   - Merged list, with chosen value (if swapped; if not insert original List A value)
   - Detailed Reasoning / JD text for Alignment

6. At the bottom of the output, Bookend each header below with ###, and use <ul> and <li> html list tags for each to include the skills for the final merged bullet lists of:
   1 - ###  <h3>  Skills 1 <h3> ###  (Seperate output bookended with ### is a hard requirement)
   2 - ###  <h3>  Skills 2 <h3> ###  (Seperate output bookended with ### is a hard requirement)  
   3 - ###  <h3> Relevant Skills 1 <h3> ###  (Seperate output bookended with ### is a hard requirement) 
   4 - ###  <h3> Relevant Skills 2 <h3> ###  (Seperate output bookended with ### is a hard requirement) 
   5 - ###  <h3> Relevant Skills 3 <h3> ###  (Seperate output bookended with ### is a hard requirement) 



**Evaluation Criteria:**
- Retain skills from List A only if they are clearly aligned with job responsibilities and not already covered more effectively in Skills 1, Skills 2, or the Relevant Skills lists.
- Swaps should prioritize ATS keyword coverage, clarity, and conciseness.
- Use phrasing that mirrors language in the job description when possible.

**Skill Lists:**

List A
Skills 1 (≤ 24 characters)
{{289877667__skills list 1}}
Skills 2 (≤ 24 characters)
{{289877667__skills list 2}}

List B
Skills 1 (≤ 24 characters)
{{290709249__output__Item 13}}
Skills 2 (≤ 24 characters)
{{290709249__output__Item 15}}


Relevant skills a (lists 1, 2 and 3)
Relevant Skills 1 (≤ 20 characters)
{{289877667__Relevant 1}}
Relevant Skills 2 (≤ 20 characters)
{{289877667__Relevant 2}}
Relevant Skills 3 (≤ 20 characters)
{{289877667__Relevant 3}}

Relevant skills b (lists 1, 2 and 3)
Relevant Skills 1 (≤ 20 characters)
{{289877662__output__Item 41}}
Relevant Skills 2 (≤ 20 characters)
{{289877662__output__Item 43}}
Relevant Skills 3 (≤ 20 characters)
{{289877662__output__Item 45}}


### Resume Summary Validation ### (Output this as the header)
✅ Analyze whether the resume summary fully covers the full item list of extracted job responsibilities and skills. Return the output as raw, plain text with an HTML table formatting below that. Do not ask me to fill in the rest, fill in all yourself.

Generate a table formatted with html tags (Generate a clean HTML table without wrapping it in triple backticks or any code formatting. I need raw HTML output only, suitable for pasting directly into an HTML document or web page.)
Step 1
Column 1: All items you listed in the Job Responsibilities & Skills List
Column 2: Blank
Step 2
Update Column 2 to Matching text covering the requirement found in the resume summary text (or label as "Missing") 
### Updated Resume Summary ###
Maintaining the structure, style, and flow of the original, provide an updated resume summary covering the missing that also covers the missing items but in the same word count

### Missing ATS Skills ### - Generate a table formatted with html tags
Return text "Removed"

### ATS Distribution Check ###  - Generate a table formatted with html tags
Return text "Removed"

### Missing ATS Skills ###  - Generate a table formatted with html tags
Return text "Removed"

### Cold Email Template ###
Write a professional cold email to [Contact Name] expressing interest in the [Job Title] role at [Company Name] very similar to the example below. If a connection exists, Mention that [Connection Name] is in my network and that I recently became aware of the opportunity.  Highlight that the role aligns with my experience leading and delivering Key outcomes relevant to the role.  Emphasize results including Metrics or Achievements if relevant examples exist from my resume portfolio or experience.  Mention that I’ve attached my resume and portfolio.  Close with a warm, low-pressure ask to connect or be directed to the appropriate contact. Use a tone that is executive, concise, and respectful, without using em dashes anywhere in the message. Sign off as Von Ellis.  

Inputs: 
Cold Contact name: {{289877647__answers__Hiring Contact Name}} 
Company name: {{289877662__output__Item 7}} 
LinkedIn Connection Name to Mention:  {{289877647__answers__LinkedIn Connection to Mention?}} 
Role: {{289877662__output__Item 5}}

Example cover letter:
Hello Kylie, 

I trust this message finds you well. Scott Jackson is a part of my network and I have recently become aware of the Head of Engineering opportunity at SafetyIQ. The opportunity to lead a high-impact, secure platform build fits perfectly with my background and leadership experience. I have led globally distributed engineering teams, delivering secure, scalable platforms that increased delivery speed, strengthened SOC 2 and ISO 27001 compliance, and aligned product strategy with critical business goals. 

I have attached my resume and portfolio for your review. If you believe there may be a possible fit, I would be delighted to connect for an initial conversation. Alternatively, if there is someone else you recommend I speak with, I would greatly appreciate any guidance. Thank you in advance for your time and consideration. I look forward to hearing from you. 

Warm regards, Von Ellis  

###Jobscan check 
Follow the steps below to generate a full QC Check Table. Extract all hard and soft skills from the job description. Check whether they are included in the resume. Output a 5-column HTML table, formatted using <table>, <tr>, <td>, <thead>, and <tbody> tags.t. Do not wrap it in code blocks, markdown, or triple backticks.

Step 1: Extract Skills from Job Description
Using all explicitly skills previously extracted from the job description({{289877662__output__Item 53}}).
Classify each as:
Hard Skill — teachable, measurable, technical (e.g., frameworks, software, delivery practices)
Soft Skill — interpersonal, behavioral, or leadership qualities (e.g., collaboration, communication, ambiguity tolerance)

Step 2: Evaluate Resume Alignment
For each hard skill:
Search the resume sections skills, and relevant skills for matching content.
For each soft skill:
Search the resume summary for matching content.
Mark each skill with one of the following statuses:
✅ Direct — Exact or clearly aligned phrase is found in both JD and resume
❌  Indirect - Somewhat related to phrase in both the JD and resume
❌ Missing — Skill is mentioned in JD but not found in resume
⚪ Not Required — Skill is in the resume but not mentioned in the job description

Step 3: Build the Table (in HTML)
Output the table using standard HTML elements:
Format with <table>, <tr>, <td>, <thead>, and <tbody> tags
Do not include markdown or triple backticks
Do not wrap the result in <pre> or any <code> blocks
Ensure the table includes all five columns:
| Category (Hard/Soft) | Skill | Status | JD Quote | Resume Quote |
Ensure the columns with quotes show phrases for context of how the skill was mentioned

Step 4: Match Score Breakdown (in Table Footer)
Add a final <tr> to the table to summarize:
✅ Number and % of required hard skills covered
✅ Number and % of required soft skills covered
✅ Total match rate (exclude Not Required rows from total)

**Job Description:**
{{289877647__answers__Target Job Description}}

```
