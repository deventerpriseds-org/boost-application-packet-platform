import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'
import { getGoogleToken, getGoogleOAuthToken, HAS_GOOGLE_OAUTH, IMPERSONATE_SUBJECT, getMicrosoftToken } from './googleAuth'
import { resolveZapVars } from './zapVars'
import { resolveRoleFocus, roleDirective } from './roleFocus'
import { assemblePackage, mergeCallTwo, call2Draft } from './mt17'
import { parseResumePackage } from './resumeParser'
import { parseAgentJson, isEmptyResult } from './agentJson'
import { loadPipelineSettings, requireDriveId, isDriveId, isEmailish, CONFIG_KEYS, PipelineSettings } from './pipelineConfig'
import { copyThen, deleteDriveFile } from './packetTemplates'
import { buildScopedPrompt } from './remediation'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// P7 item 8. The four Drive ids used to be declared HERE as well as in `packetTemplates.ts` — two
// byte-identical copies of the same four literals, which is how one of them goes stale without
// anyone noticing. They are now resolved per run from `PipelineSettings` (owner value if set,
// `SEED_DRIVE_IDS` otherwise), and the seeds have exactly one home.
const TEST_PDF_BASE64 = 'JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPD4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQo+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmCjAwMDAwMDAwMDkgMDAwMDAgbgowMDAwMDAwMDU4IDAwMDAwIG4KMDAwMDAwMDExNSAwMDAwMCBuCnRyYWlsZXIKPDwKL1NpemUgNAovUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKMTkwCiUlRU9G'

/**
 * Copy a template and inject the merge values, returning the new file id.
 *
 * D13, first half. The old body did `copy` then `batchUpdate` and threw on an injection failure —
 * leaving a real Google file whose id existed only in a local variable inside the function that had
 * just thrown. The caller could not clean it up because the caller never learned the id. `copyThen`
 * owns both halves so the id is in scope at the moment it is needed, and deletes the copy before
 * rethrowing; the rethrown message says whether the delete worked.
 */
async function copyAndInject(token: string, templateId: string, name: string, varMap: Record<string, string>, isSlides: boolean, outputFolderId: string) {
  // Validate BEFORE the request so a missing/blank/sentinel id is reported as the configuration gap
  // it is, naming the document, instead of arriving at Drive as an opaque 404 on `files//copy`.
  const tpl = requireDriveId(templateId, `Template id for "${name}"`)
  const parent = requireDriveId(outputFolderId, 'Output folder id', CONFIG_KEYS.outputFolderId)
  const { id } = await copyThen(token, tpl, name, parent, async (fileId: string) => {
    const requests = Object.entries(varMap).map(([find, replace]) => ({ replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: replace } }))
    const apiBase = isSlides ? 'https://slides.googleapis.com/v1/presentations' : 'https://docs.googleapis.com/v1/documents'
    const batchRes = await fetch(`${apiBase}/${fileId}:batchUpdate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ requests })
    })
    if (!batchRes.ok) throw new Error(`Inject ${name} failed: HTTP ${batchRes.status}`)
  })
  return id
}

/**
 * D13, second half — build every document, and leave no file behind if any of them fails.
 *
 * `Promise.all` was the defect and the reason it was invisible: it rejects on the FIRST rejection
 * while every other job keeps running to completion in the background. At the catch site there was
 * therefore nothing to enumerate — the sibling copies had not finished yet, and when they did, their
 * ids went nowhere. `allSettled` waits for all of them, which is what makes the successful ids
 * enumerable at all, and only then is cleanup even possible.
 *
 * Exported and pure of Drive-specific knowledge (it takes a `remove` callback) so the behaviour can
 * be exercised in a test without a Google token — the guard has to prove the CLEANUP, not the
 * spelling of `allSettled`.
 */
export async function buildAllOrCleanUp(
  jobs: Array<Promise<string>>,
  remove: (id: string) => Promise<boolean>,
): Promise<{ ids: string[]; cleanedUp: string[]; orphaned: string[]; errors: string[] }> {
  const settled = await Promise.allSettled(jobs)
  const ids = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value as string] : []))
  const errors = settled.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as any)?.message || r.reason)] : []))
  if (!errors.length) return { ids, cleanedUp: [], orphaned: [], errors }
  const cleanedUp: string[] = []
  const orphaned: string[] = []
  for (const id of ids) {
    // Sequential, not Promise.all: a cleanup loop that fails halfway is the bug this closes.
    ;(await remove(id).catch(() => false)) ? cleanedUp.push(id) : orphaned.push(id)
  }
  return { ids: [], cleanedUp, orphaned, errors }
}

/**
 * The standing profile as two strings, from a MasterContext row.
 *
 * `itemsToOmit` is EXCLUDED from `profileText`: it is the owner's do-not-use list, injected into the
 * resume prompt as {{289877659__Items to Omit}}. Leaving it in would mark a banned item as part of
 * the profile — the exact inverse of the truth — and P1.3 would then file a rule-driven drop as
 * `profile_original`.
 *
 * Extracted from `buildPackageForJD` (it was inline there) so the remediation loop can read the same
 * profile without running a whole 3-agent generation to get at it. One projection, two callers.
 */
export function profileFromMasterContext(mc: any): { profileText: string; omitList: string } {
  return {
    omitList: String((mc as any)?.itemsToOmit || ''),
    profileText: Object.entries(mc || {})
      .filter(([k, v]) => typeof v === 'string' && k !== 'itemsToOmit')
      .map(([, v]) => v as string).join(' '),
  }
}

/**
 * P7 item 4 — two prompt roles whose USER prompt is byte-identical.
 *
 * THE FACT, ESTABLISHED FROM THE PRIMARY SOURCE, not from a comparison of the two live rows. The
 * backlog claim rested on equal LENGTHS and had never been checked; comparing the two live rows
 * would only have shown they are the same, never which one is wrong. The source both rows derive
 * from is the zap export, in this repo at `docs/zap-289877647/prompts/`.
 *
 *   LIVE (GET /api/prompts, Actions run 32435525197, 2026-08-21):
 *     resume_user       29,068 chars   sha256 4b4af848…   \ identical to each other
 *     portfolio_user    29,068 chars   sha256 4b4af848…   /
 *     ats_user           8,807 chars   sha256 970fce2e…     (control: differs)
 *
 *   PRIMARY SOURCE (the zap nodes the migration seeded them from):
 *     node 289877661  "Update Resume/Portfolio Fields"        user_message  29,069 chars
 *     node 299599701  "Copy: Update Resume/Portfolio Fields"  user_message   7,712 chars
 *
 *   Live `portfolio_user` matches node 289877661 — the RESUME node — whitespace-normalised, with a
 *   29,060-character common prefix. Against node 299599701, the node it should have been seeded
 *   from, it diverges after 329 characters.
 *
 * So `portfolio_user` was seeded with the wrong zap node. It is the resume prompt: 42 `###` section
 * markers, no mention of JSON, while Call 2 parses its reply with `parseAgentJson`. Call 2 therefore
 * cannot return a JSON object, and the portfolio and cover letter fall back to Call 1 on every run,
 * at the cost of a second 16,000-token call. The correct text is not something to invent — it is
 * checked into this repo at
 * `docs/zap-289877647/prompts/17-copy-update-resume-portfolio-fields-prompt.md`. Installing it
 * rewrites live document generation for the real owner, so it is an owner decision and a
 * `DEFERRED.md` row, not something this lane does on its way past.
 *
 * RESOLVED SINCE — read this before trusting the measurements above, which are now HISTORY.
 * The owner installed the correct text: live `portfolio_user` is v002, **7,714 chars**, notes
 * "Zap 289877647 node 299599701 user_message verbatim", confirmed by
 * `GET /api/prompts?key=portfolio_user` on 2026-08-22 (api-test run 32553002646). This guard did NOT
 * fire on the 2026-08-22 build, correctly — the two prompts differ now.
 *
 * The JSON half outlived the fix by a day, because installing the right prompt did not change how
 * its reply was parsed. Node 299599701 emits `### Skills1 ###`, `### Skills2 ###`, `### Relevant
 * Skills 1/2/3 ###` — plain sections, never JSON — so `parseAgentJson` kept failing for a NEW reason
 * and the warning kept reading like the old one. Call 2 is now parsed with `parseResumePackage`;
 * see the comment at the call site. The lesson worth keeping: a fix that leaves the symptom identical
 * is indistinguishable from no fix, and the second cause hid behind the first for a full day.
 *
 * WHY `_user` ONLY, AND IT IS THE WHOLE REASON THIS FUNCTION IS NARROW. The live `resume_system` and
 * `portfolio_system` rows are ALSO byte-identical (329 chars, sha256 803330a2…) — and that is
 * CORRECT. Both zap nodes carry the same 331-character `system_message`; the duplication is faithful
 * to the source, not a seeding mistake. An earlier draft of this check flagged it, which would have
 * been a guard firing on correct configuration on every single run — the cry-wolf failure that makes
 * people stop reading warnings. Two calls may legitimately share a system prompt. They may not
 * legitimately share the instruction that says what to produce.
 *
 * Exact equality, never similarity: this names an offender, and H4's rule is that fuzzy matching is
 * for ranking and never for accusing. Blank rows are skipped — two unset prompts both defaulting to
 * '' are absent, not duplicated.
 */
export function duplicatePromptPairs(prompts: Record<string, string>): Array<[string, string]> {
  const keys = Object.keys(prompts)
    .filter((k) => k.endsWith('_user') && (prompts[k] || '').trim().length > 0)
    .sort()
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (prompts[keys[i]] === prompts[keys[j]]) pairs.push([keys[i], keys[j]])
    }
  }
  return pairs
}

/**
 * D12 — the status a run's outcome gets, as a pure function.
 *
 * Split out because a status decision reachable only through a live Function App cannot be guarded,
 * and the sandbox cannot reach one. Same split as `checks.ts` vs `appChecks.ts`.
 *
 * THE DECISION, and it is deliberately not uniform:
 *
 *  - `caught` — an exception aborted the run. Nothing completed, there are no urls, and the job row
 *    may still say `processing`. This returned 200, so a fully failed pipeline produced a GREEN
 *    Actions run. It is an error and it takes an error status. 502 rather than 500 because every
 *    realistic failure on this path is an upstream call: OpenAI, Drive, Docs/Slides, Graph, Tables.
 *
 *  - completed but not clean — the documents exist and were mailed; a config gap, an inert QC call
 *    or a duplicated prompt made the RESULT imperfect. This keeps a 2xx, and the reason is not
 *    squeamishness about the number: `POST /api/pipeline/run` is NOT idempotent — it copies Google
 *    files. A non-2xx invites a retrying client to re-run it, and P7-ACCEPTANCE's own warning is
 *    that any retry design must be traced against X5 (render once) first or a retry MULTIPLIES the
 *    D13 orphans. Marking a delivered packet as a transport failure would manufacture exactly that.
 *    The caller is fixed instead, in `api-test.yml`, which is also the general fix: 85 routes here
 *    return a `pass` boolean and the workflow ignored every one of them.
 *
 * An independent AC agent, reading this cold, asked instead that EVERY `pass:false` path be non-2xx.
 * That disagreement is real and is recorded in `.claude/DEFERRED.md` rather than silently resolved.
 */
export function runOutcome(o: { caught: boolean; docCount: number; emailsSent: number; warningCount: number }):
  { status: number; pass: boolean; outcome: 'pass' | 'completed_with_findings' | 'error' } {
  if (o.caught) return { status: 502, pass: false, outcome: 'error' }
  const clean = o.docCount >= 3 && o.emailsSent >= 1 && o.warningCount === 0
  return clean
    ? { status: 200, pass: true, outcome: 'pass' }
    : { status: 200, pass: false, outcome: 'completed_with_findings' }
}

/** Load the MasterContext profile on its own. The loop needs it; a full generation does not. */
export async function loadProfile(): Promise<{ profileText: string; omitList: string }> {
  const ctxClient = TableClient.fromConnectionString(CONN, 'MasterContext')
  let mc: any = {}
  for await (const e of ctxClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'context'" } })) mc = e
  return profileFromMasterContext(mc)
}

/** Fallback only. The live value is the owner's `rem_model` on `owner_search_prefs` (D-4). */
export const SCOPED_REGEN_MODEL = 'gpt-4o-mini'

/**
 * FIELD-SCOPED REGENERATION — the primitive that did not exist (D-8 / decision 17).
 *
 * `buildPackageForJD` takes a job description and returns a whole package; `assemblePackage(c1,c2,c3)`
 * takes three whole payloads and returns a whole package. Call 2 consumes `JSON.stringify(c1)` and
 * call 3 consumes `{...c1, ...c2}`. There is one generation entry point, it is all-or-nothing, and
 * nothing anywhere could regenerate a single merge field. That is not a wiring gap — P3.1's "re-run
 * generation scoped to the open requirements only, do not rewrite closed blocks" cannot be built on
 * top of it, because pass 2 would regenerate everything and destroy content that was already correct.
 *
 * This makes ONE model call for a NAMED SUBSET of merge fields and returns only those fields. It
 * does not touch the package: `remediation.applyScopedFields` merges the result and REFUSES any key
 * outside the scope, so "scoped" is enforced on the way in rather than requested in a prompt.
 */
export async function regenerateFields(opts: {
  key: string
  company: string
  role: string
  pass: number
  fields: string[]
  current: Record<string, any>
  open: Array<{ seq: number; verbatim: string | null; item_text: string; kind: string }>
  profileText?: string
  omitList?: string
  temperature?: number
  maxTokens?: number
  model?: string
  profileChars?: number
  suppliedEvidence?: Array<{ seq: number | null; note: string }>
}): Promise<{ fields: Record<string, any>; usage: any; model: string; via: string; detail: string }> {
  const { system, user } = buildScopedPrompt({
    company: opts.company, role: opts.role, pass: opts.pass, fields: opts.fields,
    current: opts.current, open: opts.open, profileText: opts.profileText, omitList: opts.omitList,
    profileChars: opts.profileChars, suppliedEvidence: opts.suppliedEvidence,
  })
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.key}` },
    body: JSON.stringify({
      model: opts.model || SCOPED_REGEN_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: opts.maxTokens ?? 4000,
      temperature: opts.temperature ?? 0.4,
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) throw new Error(`scoped regeneration HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = await res.json() as any
  const parsed = parseAgentJson(json?.choices?.[0]?.message?.content)
  // A pass that returned nothing usable is NOT an empty edit — it is a failed call, and reporting it
  // as "changed nothing" would let a broken model key read as "the document was already fine".
  return {
    fields: parsed.value && typeof parsed.value === 'object' ? parsed.value as Record<string, any> : {},
    usage: json?.usage,
    model: opts.model || SCOPED_REGEN_MODEL,
    via: parsed.via,
    detail: parsed.value ? '' : `scoped regeneration returned no JSON object (${parsed.detail})`,
  }
}

// The proven 3-agent packet generation (resume → portfolio/cover → ATS QC),
// grounded in the Prompts + MasterContext tables and role focus, returning the
// assembled placeholder package. Extracted from pipelineRun so BOTH the MT-22
// test flow and the production Executive Engine packet builder use the identical
// engine (this is what produced the correctly-filled portfolio files).
// Returns `calls` alongside the package because P1.3 cannot reconstruct what changed from the merged
// output alone: assemblePackage's per-slot preference for Call 3 over Call 1 IS the swap decision,
// and both sides are needed to see it. These were previously discarded at the end of this function.
export async function buildPackageForJD(opts: { key: string; jd: string; roleType: string; company: string; jobTitle: string; personaRole?: string | null }): Promise<{ pkg: Record<string, string | null>; steps: string[]; roleFocus: any; roleFocusSource: string; calls: { c1: any; c2: any; c3: any }; usage: Array<{ pass: string; usage: any }>; promptVersions: Record<string, number>; profileText: string; omitList: string; warnings: string[]; qcApplied: boolean; settings: PipelineSettings }> {
  const { key, jd, roleType, company, jobTitle } = opts
  const steps: string[] = []
  const warnings: string[] = []

  // Runtime knobs come from the existing AppConfig/auth store (Auth & Config screen), not from code.
  const settings = await loadPipelineSettings()
  warnings.push(...settings.warnings)

  const role = await resolveRoleFocus(roleType, settings.defaultRoleFocus, opts.personaRole)
  const roleFocus = role.focus
  if (role.warning) warnings.push(`role focus: ${role.warning}`)
  steps.push(`Role focus "${roleFocus}" (source: ${role.source})`)

  // X6 — the version is loaded alongside the content. This projection took `content` only, so
  // nothing downstream could say WHICH prompt produced a given package. P4 requires a
  // prompt_version on every verdict, and "the active one at the time" is not recoverable after the
  // fact once a prompt is superseded.
  const promptClient = TableClient.fromConnectionString(CONN, 'Prompts')
  const prompts: Record<string, string> = {}
  const promptVersions: Record<string, number> = {}
  for await (const e of promptClient.listEntities({ queryOptions: { filter: 'is_active eq true' } })) {
    const key = (e as any).partitionKey
    prompts[key] = (e as any).content || ''
    promptVersions[key] = Number((e as any).version ?? 0)
  }
  // P7 item 4 — see `duplicatePromptPairs`. Proven live: `resume_user` and `portfolio_user` are
  // byte-identical, as are `resume_system` and `portfolio_system`, so Call 2 runs the resume prompt
  // and its JSON parse can never succeed. Nothing in the run said so; it now does, by name.
  for (const [a, b] of duplicatePromptPairs(prompts)) {
    warnings.push(`Prompts "${a}" and "${b}" are byte-identical (${prompts[a].length} chars) — one of the two roles is not being performed. Edit it in the dev console's Prompts screen.`)
  }

  const ctxClient = TableClient.fromConnectionString(CONN, 'MasterContext')
  let mc: any = {}
  for await (const e of ctxClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'context'" } })) mc = e

  // `temperature` was never sent, so the Chat Completions default applied to all three calls —
  // including the reconciliation pass, which is the one call in the run that should be the least
  // creative. Both values are configurable (AppConfig/auth), seeded from `SEED_TEMPERATURES`.
  const openai = (system: string, user: string, maxTokens: number, temperature: number) => fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature })
  }).then(r => r.ok ? r.json() : r.text().then(t => { throw new Error(`OpenAI HTTP ${r.status}: ${t}`) }))

  const tGen = settings.generateTemperature.value
  const tQc = settings.qcTemperature.value
  steps.push(`Temperatures — generation ${tGen} (${settings.generateTemperature.source}), QC ${tQc} (${settings.qcTemperature.source})`)

  const base1 = resolveZapVars(prompts['resume_user'] || 'Write resume package with ### sections.', mc, jd)
  const r1 = await openai(prompts['resume_system'] || 'You are an executive resume writer.', roleDirective(roleFocus) + base1, 16000, tGen) as any
  const c1: any = parseResumePackage(r1.choices?.[0]?.message?.content || '', mc, jobTitle, company)
  steps.push(`Agent Call 1 (resume) — parsed ${c1._parsedFieldCount} fields by title`)
  if (!c1._parsedFieldCount) warnings.push('Call 1 produced no recognisable ### sections — the package is MasterContext only')
  // P7 item 1. A `### Title ###` section whose title maps to no merge field used to be swallowed
  // by the field above it, title and all — so a prompt edit that ADDED a section silently moved
  // content into the wrong resume slot, which is exactly what P7's acceptance line forbids. The
  // parser now keeps it separate; this makes it visible, because silently dropping it and silently
  // misfiling it are the same defect.
  for (const u of (c1._unmapped || [])) {
    warnings.push(`Call 1 returned a section named "${u.title}" that maps to no merge field — its ${u.body.length} characters were NOT placed in any document`)
  }

  // Calls 2 and 3 were sending their prompts RAW: every `{{node__field}}` token the seeded Zapier
  // prompts carry reached the model as a literal. For Call 3 that included the job description
  // itself, so the ATS-QC pass was asked to compare two lists against a posting it never saw.
  // `extra` supplies the tokens that only exist mid-run (Call-1's own output, the target company
  // and role); everything still unmapped is blanked rather than shown to the model.
  // CALL 2 IS A SECOND SKILLS-REFINEMENT PASS, and this code spent its life believing otherwise.
  //
  // It was parsed with `parseAgentJson`, warned "Call 2 (portfolio) returned no JSON object", and
  // fell back to Call 1 — on every build, for both postings, four times in the 2026-08-22 run
  // (2,957 / 3,178 / 4,736 / 5,404 characters discarded). That was read as a flaky model, then as a
  // duplicate-prompt bug. It is neither. The prompt itself settles it, and it is the one source that
  // could: `portfolio_user` v002 is Zap node **299599701, "Copy: Update Resume/Portfolio Fields"** —
  // a COPY of Call 1's node — and it emits `### Skills1 ###`, `### Skills2 ###`, `### Relevant
  // Skills 1/2/3 ###` and `### Word and Character Requirements Check ###`. Plain text sections, the
  // same shape Call 1 returns. It never asks for JSON, so the JSON parse could never have succeeded.
  //
  // It also never emits a cover letter, an About Me, an executive profile or a cold email — the
  // fields `assemblePackage` asks Call 2 for. In the zap those come from the baseline `set_value`
  // nodes (7-11, i.e. MasterContext) and from Call 1. That expectation was fiction, and no model
  // output could have satisfied it.
  //
  // What the pass actually does is in its own words: "Replace the least relevant or loosely aligned
  // skills from previous outputs with these refined phrases", under a ≤30-character limit and the
  // Jobscan hard-skill definition. So it is parsed with the SAME parser Call 1 uses, and its refined
  // lists are preferred over Call 1's — which is the two-pass refinement the owner's prompts describe
  // and the product has never once performed.
  const base2 = resolveZapVars(prompts['portfolio_user'] || 'Portfolio JSON.', mc, jd)
  const r2 = await openai(prompts['portfolio_system'] || 'You are a helpful assistant.', roleDirective(roleFocus) + `${base2}\n\nCALL1:\n${JSON.stringify(c1)}`, 16000, tGen) as any
  const c2: any = parseResumePackage(r2.choices?.[0]?.message?.content || '', mc, jobTitle, company)
  if (!c2._parsedFieldCount) warnings.push('Call 2 (skills refinement) produced no recognisable ### sections — the skills are Call 1 unrefined')
  steps.push(`Agent Call 2 (skills refinement) — parsed ${c2._parsedFieldCount} fields by title`)
  for (const u of (c2._unmapped || [])) {
    warnings.push(`Call 2 returned a section named "${u.title}" that maps to no merge field — its ${u.body.length} characters were NOT placed in any document`)
  }

  const atsExtra: Record<string, string> = {
    // THE REFINED LISTS, NOT THE FIRST DRAFT. Call 3 is the ATS QC pass and it judges what it is
    // given; handed Call 1's skills it re-does work Call 2 already did, against text that is no
    // longer what the document will carry. The zap runs node 17 (this refinement) BEFORE the QA
    // node, so this is the faithful order as well as the useful one. Call 1 remains the fallback for
    // anything Call 2 did not return.
    '289877667__ResumeSummary': c1.resumeSummary || '',
    '289877667__skills list 1': c2.skills1 || c1.skills1 || '',
    '289877667__skills list 2': c2.skills2 || c1.skills2 || '',
    '289877667__Expertise': c1.expertise || '',
    '289877667__Relevant 1': c2.relevant1 || c1.relevant1 || '',
    '289877667__Relevant 2': c2.relevant2 || c1.relevant2 || '',
    '289877667__Relevant 3': c2.relevant3 || c1.relevant3 || '',
    '289877662__output__Item 7': company || '',
    '289877662__output__Item 5': jobTitle || '',
  }
  const base3 = resolveZapVars(prompts['ats_user'] || 'ATS QC.', mc, jd, undefined, atsExtra)
  // ALLOWLIST MERGE, NOT A SPREAD — see `mergeCallTwo`. `{...c1, ...c2}` was safe only while the
  // Call-2 parse always failed and `c2` was `{}`; with a real parse it blanks six of Call 1's fields
  // with the `|| ''` defaults `parseResumePackage` returns, and hands the emptied package to the QC
  // pass whose verdict outranks Call 1 in the document.
  const { merged: call3Input, improvised } = mergeCallTwo(c1, c2)
  for (const k of improvised) {
    warnings.push(`Call 2 returned a "${k}" its prompt never asked for — refused, so the draft keeps Call 1's`)
  }
  const r3 = await openai(prompts['ats_system'] || 'You are a helpful assistant.', `${base3}\n\nINPUTS:\n${JSON.stringify(call3Input)}`, 15500, tQc) as any
  const p3 = parseAgentJson(r3.choices?.[0]?.message?.content)
  const c3: any = p3.value || {}
  // An inert Call 3 is the difference between "QC ran and agreed" and "QC never landed". It used to
  // be swallowed by a `catch` and reported as neither; every downstream swap row then reads `kept`.
  const qcApplied = !!p3.value && !isEmptyResult(p3.value)
  if (!p3.value) warnings.push(`Call 3 (ATS QC) returned no JSON object (${p3.detail}) — the package is Call 1 unreviewed`)
  else if (!qcApplied) warnings.push('Call 3 (ATS QC) returned an empty object — no skill merge or summary update was applied')
  steps.push(`Agent Call 3 (ATS QC + skills merge) — JSON via ${p3.via}, applied: ${qcApplied}`)

  const pkg = assemblePackage(c1, call2Draft(c2), c3) as Record<string, string | null>
  // The standing profile, so an item that predates this application can be marked profile_original
  // rather than credited to a pass that merely repeated it. `itemsToOmit` is EXCLUDED: it is the
  // owner's do-not-use list, injected into the resume prompt as {{289877659__Items to Omit}}.
  // Leaving it in would mark a banned item as part of the profile — the exact inverse of the truth.
  const { profileText, omitList } = profileFromMasterContext(mc)
  // The MT-22 route returns `warnings` to its caller; the production packet builder
  // (appPackets.buildTemplatedArtifact) does not read them, so emit them here too — otherwise a
  // config gap or an inert QC call is invisible on the path that actually ships documents.
  if (warnings.length) console.warn(`[pipeline] ${warnings.length} warning(s) for ${jobTitle} @ ${company}:\n - ${warnings.join('\n - ')}`)

  // D8 - the three generation calls were never metered. Their `usage` objects were read from the
  // OpenAI reply and then dropped on the floor here, so the production packet build recorded ZERO
  // rows in usage_metering while being the most expensive thing the product does. They are returned
  // rather than logged here so metering stays in the HTTP layer that owns the pg client.
  const usage = [
    { pass: 'resume', usage: (r1 as any)?.usage },
    { pass: 'portfolio', usage: (r2 as any)?.usage },
    { pass: 'ats-qc', usage: (r3 as any)?.usage },
  ]
  return { pkg, steps, roleFocus, roleFocusSource: role.source, calls: { c1, c2, c3 }, usage, promptVersions, profileText, omitList, warnings, qcApplied, settings }
}

// GET /api/jobs?status=received — list jobs for the approval queue
export async function jobsList(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const status = req.query.get('status')
  const client = TableClient.fromConnectionString(CONN, 'JobApplications')
  const jobs: any[] = []
  const filter = status ? `PartitionKey eq 'applications' and Status eq '${status}'` : "PartitionKey eq 'applications'"
  for await (const e of client.listEntities({ queryOptions: { filter } })) {
    jobs.push({
      jobId: (e as any).rowKey, jobTitle: (e as any).JobTitle, company: (e as any).Company,
      roleType: (e as any).RoleType, status: (e as any).Status, receivedAt: (e as any).ReceivedAt,
      fullResumeUrl: (e as any).FullResumeUrl || '', compactResumeUrl: (e as any).CompactResumeUrl || '',
      portfolioUrl: (e as any).PortfolioUrl || '', coverLetterUrl: (e as any).CoverLetterUrl || ''
    })
  }
  jobs.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))
  return { status: 200, headers: HEADERS, jsonBody: { jobs } }
}

// POST /api/pipeline/run { jobId } — the MT-22 graduation flow:
// approve -> 3 agent calls -> 4 role-routed docs -> log complete -> deliver email
export async function pipelineRun(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  // D12, first of three exits. A missing key is a configuration error on the server: nothing ran,
  // there is no result, and 200 told every caller the opposite. 500 with the same body.
  if (!key) return { status: 500, headers: HEADERS, jsonBody: { pass: false, outcome: 'error', detail: 'OPENAI_API_KEY not set' } }

  const steps: string[] = []
  try {
    const body = await req.json() as any
    const jobId = body?.jobId
    if (!jobId) return { status: 400, headers: HEADERS, jsonBody: { pass: false, outcome: 'error', detail: 'jobId required' } }

    // 1. Load the approved job
    const jobsClient = TableClient.fromConnectionString(CONN, 'JobApplications')
    const job = await jobsClient.getEntity('applications', jobId) as any
    const roleType = job.RoleType || 'Engineering'
    const company = job.Company || 'Unknown Company'
    const jobTitle = job.JobTitle || 'Unknown Role'
    let jd = ''
    try { jd = JSON.parse(job.Payload || '{}').jobDescription || '' } catch {}
    if (!jd) jd = `${jobTitle} at ${company}`
    steps.push(`Loaded job ${jobId} (${jobTitle} @ ${company}, ${roleType})`)

    await jobsClient.updateEntity({ partitionKey: 'applications', rowKey: jobId, Status: 'processing' } as any, 'Merge')

    // 2-4. Proven 3-agent generation (shared with the production packet builder).
    const built = await buildPackageForJD({ key, jd, roleType, company, jobTitle })
    const { pkg, steps: genSteps, roleFocus } = built
    const warnings: string[] = [...built.warnings]
    steps.push(...genSteps)

    // P7 item 8 — the four Drive ids and the two mailboxes now come from AppConfig/auth, which the
    // Auth & Config screen has been writing all along. `source` is printed so an owner who set a
    // template id and got a different document back can see which value the run actually used.
    const cfg = built.settings
    steps.push(`Drive ids — resume ${cfg.resumeTemplateId.source}, portfolio ${cfg.portfolioTemplateId.source}, `
      + `cover ${cfg.coverLetterTemplateId.source}, output folder ${cfg.outputFolderId.source}`)
    // A job row's own address wins; otherwise the owner's configured recipient; the seed is the
    // last resort and it is reported as such. `isEmailish` refuses a blank or placeholder row.
    const jobAddress = String(job.SendToEmail || '').trim()
    if (jobAddress && !isEmailish(jobAddress)) warnings.push(`Job ${jobId} SendToEmail is not an email address (${JSON.stringify(jobAddress)}) — using ${cfg.recipientEmail.value}`)
    const sendTo = isEmailish(jobAddress) ? jobAddress : cfg.recipientEmail.value
    const sendFrom = cfg.senderEmail.value
    steps.push(`Mail — from ${sendFrom} (${cfg.senderEmail.source}), to ${sendTo} (${isEmailish(jobAddress) ? 'job row' : cfg.recipientEmail.source})`)

    // AppConfig: role-specific compact resume template, then the owner's configured default. A role
    // with neither used to skip the 4th document in silence — `pass` only counts >= 3 docs, so a
    // packet could ship without the ATS resume and still report success.
    const roleRow = roleType.toLowerCase().replace(/\s+/g, '-')
    let compactResumeTemplateId = ''
    let compactSource = 'none'
    try {
      const cfg = TableClient.fromConnectionString(CONN, 'AppConfig')
      const row = await cfg.getEntity('templates', roleRow) as any
      compactResumeTemplateId = String(row.compactResumeTemplateId || '')
      if (compactResumeTemplateId) compactSource = `templates/${roleRow}`
    } catch (e) {
      const status = (e as any)?.statusCode
      if (status !== 404) warnings.push(`AppConfig templates/${roleRow} lookup failed: ${String((e as any)?.message || e).slice(0, 160)}`)
    }
    if (!compactResumeTemplateId && built.settings.compactResumeTemplateId) {
      compactResumeTemplateId = built.settings.compactResumeTemplateId
      compactSource = CONFIG_KEYS.compactResumeTemplateId
    }
    if (compactResumeTemplateId && !isDriveId(compactResumeTemplateId)) {
      warnings.push(`Compact resume template id from ${compactSource} is not a Drive id (${JSON.stringify(compactResumeTemplateId)}) — the compact ATS resume was NOT generated`)
      compactResumeTemplateId = ''
      compactSource = 'invalid'
    }
    if (!compactResumeTemplateId) {
      warnings.push(`No compact ATS resume template for role "${roleType}" — add compactResumeTemplateId to AppConfig templates/${roleRow}, or set ${CONFIG_KEYS.compactResumeTemplateId} in Auth & Config. The compact ATS resume was NOT generated.`)
    }
    steps.push(`Compact ATS resume template: ${compactResumeTemplateId ? compactSource : 'NOT CONFIGURED'}`)

    // 5. Generate documents (role-routed compact resume as 4th)
    const token = HAS_GOOGLE_OAUTH ? await getGoogleOAuthToken() : await getGoogleToken(saJson!, 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/presentations', IMPERSONATE_SUBJECT)
    const resumeVars: Record<string, string> = { '{{ResumeSummary}}': pkg.ResumeSummary || '', '{{SkillsBullets1}}': pkg.SkillsBullets1 || '', '{{SkillsBullets2}}': pkg.SkillsBullets2 || '', '{{ExpertiseBullets}}': pkg.ExpertiseBullets || '', '{{WorkHistoryBullets1}}': pkg.WorkHistoryBullets1 || '', '{{WorkHistoryBullets2}}': pkg.WorkHistoryBullets2 || '', '{{WorkHistoryBullets3}}': pkg.WorkHistoryBullets3 || '', '{{WorkHistoryBullets4}}': pkg.WorkHistoryBullets4 || '', '{{RelevantBullets1}}': pkg.RelevantBullets1 || '', '{{RelevantBullets2}}': pkg.RelevantBullets2 || '', '{{RelevantBullets3}}': pkg.RelevantBullets3 || '' }
    const portfolioVars: Record<string, string> = { '{{@Company}}': pkg['@Company'] || '', '{{@CoverLetterDate}}': pkg['@CoverLetterDate'] || '', '{{@CoverLetterBody}}': pkg['@CoverLetterBody'] || '', '{{@AboutMe1_50words}}': pkg['@AboutMe1_50words'] || '', '{{@AboutMe2_60words}}': pkg['@AboutMe2_60words'] || '', '{{@ExecutiveProfile_55words}}': pkg['@ExecutiveProfile_55words'] || '', '{{@CoreAccomplishments_5blts_180words}}': pkg['@CoreAccomplishments_5blts_180words'] || '' }

    const folder = cfg.outputFolderId.value
    const docJobs = [
      copyAndInject(token, cfg.resumeTemplateId.value, `Full Resume — ${company}`, resumeVars, false, folder),
      copyAndInject(token, cfg.portfolioTemplateId.value, `Portfolio — ${company}`, portfolioVars, true, folder),
      copyAndInject(token, cfg.coverLetterTemplateId.value, `Cover Letter — ${company}`, portfolioVars, true, folder),
    ]
    if (compactResumeTemplateId) docJobs.push(copyAndInject(token, compactResumeTemplateId, `Compact ATS Resume (${roleType}) — ${company}`, resumeVars, false, folder))
    // D13 — `Promise.all` here rejected on the first failure while the other copies ran to
    // completion in the background, so the files they created were never referenced by anything and
    // leaked onto the owner's Drive on every failed build. See `buildAllOrCleanUp`.
    const build = await buildAllOrCleanUp(docJobs, (id) => deleteDriveFile(token, id))
    if (build.errors.length) {
      const cleanup = build.orphaned.length
        ? `${build.cleanedUp.length} deleted, ${build.orphaned.length} ORPHANED (${build.orphaned.join(', ')}) — delete them by hand`
        : `${build.cleanedUp.length} partial document(s) deleted, none orphaned`
      throw new Error(`Document generation failed: ${build.errors.join(' | ')}. Cleanup: ${cleanup}`)
    }
    const ids = build.ids
    const [resumeId, portfolioId, coverLetterId, compactId] = ids
    const urls = {
      fullResume: `https://docs.google.com/document/d/${resumeId}/edit`,
      compactAtsResume: compactId ? `https://docs.google.com/document/d/${compactId}/edit` : '',
      portfolio: `https://docs.google.com/presentation/d/${portfolioId}/edit`,
      coverLetter: `https://docs.google.com/presentation/d/${coverLetterId}/edit`,
    }
    steps.push(`Generated ${ids.length} documents`)

    // 6. Log job record complete
    await jobsClient.updateEntity({
      partitionKey: 'applications', rowKey: jobId, Status: 'complete',
      FullResumeUrl: urls.fullResume, CompactResumeUrl: urls.compactAtsResume,
      PortfolioUrl: urls.portfolio, CoverLetterUrl: urls.coverLetter,
      ProcessedAt: new Date().toISOString()
    } as any, 'Merge')
    steps.push('Job record updated to complete')

    // 7. Delivery emails (application package + video placeholder)
    const tenantId = process.env.MICROSOFT_TENANT_ID || 'ee633423-c321-413c-a191-ace8b07e4196'
    const clientId = process.env.MICROSOFT_CLIENT_ID
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
    let emailsSent = 0
    if (clientId && clientSecret) {
      const mtoken = await getMicrosoftToken(tenantId, clientId, clientSecret)
      const html = `<html><body style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto">
        <h2>Application Package: ${company} — ${jobTitle}</h2>
        <h3>Documents</h3><ul>
          <li><a href="${urls.fullResume}">Full Resume</a></li>
          ${urls.compactAtsResume ? `<li><a href="${urls.compactAtsResume}">Compact/ATS Resume (${roleType})</a></li>` : ''}
          <li><a href="${urls.portfolio}">Portfolio</a></li>
          <li><a href="${urls.coverLetter}">Cover Letter</a></li>
        </ul>
        <h3>Cold Email Draft</h3><pre style="background:#f5f5f5;padding:12px">${(pkg.coldEmail || '').slice(0, 2000)}</pre>
        </body></html>`
      const sendMail = (subject: string, contentHtml: string, withPdf: boolean) => fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sendFrom)}/sendMail`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mtoken}` },
        body: JSON.stringify({ message: { subject, body: { contentType: 'HTML', content: contentHtml }, toRecipients: [{ emailAddress: { address: sendTo } }], ...(withPdf ? { attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'application.pdf', contentType: 'application/pdf', contentBytes: TEST_PDF_BASE64 }] } : {}) } })
      })
      const e1 = await sendMail(`Application Prep: ${company} - ${jobTitle}`, html, true)
      if (e1.ok) emailsSent++
      const e2 = await sendMail(`Video Introduction (coming soon): ${company} - ${jobTitle}`, `<html><body style="font-family:Arial"><h3>Video introduction placeholder</h3><p>Your personalized video introduction for the ${jobTitle} role at ${company} is being produced and will follow shortly.</p></body></html>`, false)
      if (e2.ok) emailsSent++
      steps.push(`Sent ${emailsSent} of 2 delivery emails to ${sendTo}`)
    } else {
      steps.push('Microsoft creds not set — skipped delivery emails')
    }

    // D12, and the decision is deliberately SPLIT, because two different things were both being
    // reported as 200 and only one of them is a transport-layer success.
    //
    // THIS exit: the run completed. Documents exist, the mail was attempted, the request succeeded.
    // `pass:false` here means "the RESULT is not clean" — a config gap, an inert QC call, a prompt
    // pair that is byte-identical — not "the call failed". Turning that into a 4xx/5xx would be
    // lying about the transport and would make the artifacts this run DID produce look undelivered
    // to a client reading the status alone. So it stays 2xx, and the caller is fixed instead:
    // `api-test.yml` now fails the job when the body self-reports `pass:false`, which is the generic
    // half — 85 routes in this repo return a `pass` boolean and the workflow was ignoring all of
    // them, so a status change here would have closed exactly one of 85.
    //
    // The CATCH exit below is the other half, and there 200 was simply wrong.
    //
    // `outcome` exists so a caller does not have to infer the difference from the shape of the body.
    const verdict = runOutcome({ caught: false, docCount: ids.length, emailsSent, warningCount: warnings.length })
    return {
      status: verdict.status, headers: HEADERS,
      jsonBody: {
        pass: verdict.pass,
        outcome: verdict.outcome,
        detail: `Pipeline complete for ${jobTitle} @ ${company} (${roleType}): ${ids.length} docs, ${emailsSent}/2 emails.`
          + (warnings.length ? ` ${warnings.length} warning(s).` : ''),
        jobId, roleType, roleFocus, roleFocusSource: built.roleFocusSource, qcApplied: built.qcApplied,
        urls, emailsSent, steps, warnings
      }
    }
  } catch (err) {
    // D12, the other half. NOTHING here completed: an exception aborted the run partway, there are
    // no urls, and the job row may still say `processing`. Returning 200 told every caller — the
    // dev console, `api-test.yml`, any future client — that the request had succeeded, and a fully
    // failed pipeline therefore produced a GREEN Actions run. That is not a "result", it is an
    // error, and it takes an error status.
    //
    // 502 rather than 500: every realistic failure on this path is an upstream call — OpenAI, Drive,
    // Docs/Slides, Graph, Table Storage. The body is unchanged so nothing that reads `detail`/`steps`
    // loses anything; `web/src/App.jsx` parses the body regardless of status and reads `data.pass`,
    // so the console is unaffected (checked at App.jsx:438).
    const verdict = runOutcome({ caught: true, docCount: 0, emailsSent: 0, warningCount: 0 })
    return { status: verdict.status, headers: HEADERS, jsonBody: { pass: verdict.pass, outcome: verdict.outcome, detail: String(err), steps } }
  }
}

app.http('jobsList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'jobs', handler: jobsList })
app.http('pipelineRun', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'pipeline/run', handler: pipelineRun })
