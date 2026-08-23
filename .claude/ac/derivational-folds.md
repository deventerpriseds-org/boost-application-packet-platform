# ACs: Derivational folds in requirementSupport.forms()

Status: COMPLETE — awaiting sign-off (2026-08-23). ACs only; no source file was edited.
Tier 1 (accusation grade): `sameWord` decides `must_have_coverage`, the `mustName` absolute gate,
and `evidenceProposal.overclaimed`.

**The one thing to read first: Part 0 / O-1 — the proposed fold does NOT fix the worked example the
brief cites (measured 0.200 -> 0.400 support, threshold 0.6). And Part 0 / O-3 — the naive fold
BREACHES the absolute named-entity gate (measured: three requirements flip to `ok: true`).**

## Research log (append-only)

### Files read
- `api/src/functions/tests/requirementSupport.ts` (785 lines) — `forms()` 113-143, `sameWord()` 146-151,
  `MIN_STEM = 4` @103, `supportIn()` 658-773.
- `api/src/functions/tests/termMatch.ts` — line 13-16 comment: *"Deliberately NOT stemmed — a stemmer
  turns `ops`→`op` and `sre`→`sr`. Plurals are explicit aliases."*
- `api/src/functions/tests/appRequirements.ts` @549 — 2nd consumer of `sameWord`.
- `api/src/functions/tests/evidenceProposal.ts` @338 — 3rd consumer of `sameWord` (`carries`).
- `api/test/matcher.test.mjs` @830-848 — the existing fold table + the existing NOT-fold table.
- `api/test/evidence.test.mjs` @174-182, @286-322 — the threshold-MOVEMENT tests.

### BLAST RADIUS — `sameWord` has FOUR call sites, not one
| Call site | What it decides | Grade |
|---|---|---|
| `requirementSupport.ts:697` `carries` in `supportIn` | **every** gate: `mustName`, `generic_overlap_only`, `list_element_unsupported`, `no_distinctive_token`, and `support` (the threshold numerator+denominator) | **Tier 1 — accusation** |
| `evidenceProposal.ts:338` `carries` | `overclaimed` (withdraws a model's explanation, names it in stored `extra`) and `missing` (the published fact) | **Tier 1 — accusation** |
| `appRequirements.ts:549` | `lookedFor.missingWords` / `closestExcerpt` — read-only diagnostic shown to owner, cannot flip `evidenced` | Tier 2 — advisory |
| `matcher.test.mjs:98` | test harness re-implementation of the same expression | test |

### Measured facts about `supportIn` that constrain the change
1. `carries` is used for `mustName` too (line 729). **Folds ALREADY reach the named-entity gate.**
   A derivational fold therefore CAN let a named token be satisfied by a different word. This is the
   sharpest false-positive surface in the change.
2. `ratio` (line 720-721) is `exactHits/want.length` — **no folds at all**. Folds must leave `ratio`
   byte-identical; it is the ranking key and the stored `evidence_ratio`.
3. `support` (line 719) = `judged.filter(carries).length / judged.length`, `judged = mustCarry` —
   this is the ONLY number the owner threshold gates. Loosening `carries` pushes `support` toward 1
   for every excerpt, which is precisely the H42 "settings-shaped constant" defect the code comment
   at 713-717 records having already been made once.
4. `evidenceProposal.verifyReasoning`: looser folds cut BOTH ways —
   `carries(r,t)` looser ⇒ MORE false withdrawals of a model explanation;
   `carries(q,t)` looser ⇒ FEWER true withdrawals. Both directions are wrong-in-production.

---

# PART 0 — READ THIS BEFORE THE ACs: the premise is only PARTLY true (measured)

Every number below was produced by patching the **built** module
(`api/dist/functions/tests/requirementSupport.js`) with the proposed folds
(`-ation`/`-ative`, `-ment`, `-ship`, `-ability`→`-able`) and running the real `supportIn`.
Nothing here is read off the source.

## O-1. The proposed fold does NOT fix the worked example the brief cites.

Requirement `Collaborative executive capable of building alignment`
vs excerpt `By fostering collaboration and ensuring alignment across business and technology`:

| | contentful tokens | carried | `support` | verdict at threshold 0.6 |
|---|---|---|---|---|
| before | 5 | `alignment` | **0.200** | refused `below_threshold` |
| after  | 5 | `alignment`, `collaborative` | **0.400** | **still refused `below_threshold`** |

Longer form (`… across business and technology`): 0.429 → 0.571. Still below 0.6.

**Why**: only ONE of the four missing tokens is a derivational miss. `executive`, `capable` and
`building` are missing because **the excerpt contains no word of that family at all** — there is no
`capability`, no `execut*`, no `build*` in it. `capable`↔`capability` folds correctly and buys
nothing here. The blocking cause on this requirement is *absent content*, not morphology.

*(Observation vs interpretation: the brief states `mustCarry.length` = 4 and support = 1/4 = 0.25.
Measured with the shipped module it is 5 and 1/5 = 0.200. Same case, slightly different token count —
`claimTokens` keeps `building`. The conclusion is unaffected.)*

**Consequence for the ACs, and it is the most important line in this document:** no AC may be
written as *"opportunity 2cb56fb3 requirement N becomes evidenced"*. That is an outcome this change
cannot deliver, and an implementer chasing it will keep loosening the fold until it passes — which
is precisely how an accusation-grade matcher becomes a rubber stamp. The ACs below are written
against **`sameWord` pair behaviour** and **`support` movement**, never against a coverage count.

## O-2. Three of the four "measured NO MATCH" pairs are recovered; one needs a rewrite, not a strip.

| pair | strip-based rule | rewrite-based rule |
|---|---|---|
| `collaborative` ~ `collaboration` | ✅ | ✅ |
| `integration` ~ `integrating` | ✅ | ✅ |
| `mentorship` ~ `mentoring` / `mentor` | ✅ | ✅ |
| `capable` ~ `capability` | ❌ **impossible** | ✅ |

Measured: `forms('capability')` under a `-ability` **strip** = `{capability}` and
`forms('capable')` = `{capable}` — the strip yields `cap` (3 chars), which `MIN_STEM = 4` refuses,
**correctly**. A `-ability`→`-able` **surface rewrite** (`capability` → `capable`, a 7-char real
word) reaches it without touching `MIN_STEM`. See AC-12.

## O-3. THE MEASURED SHOWSTOPPER: the fold breaches the absolute named-entity gate.

`mustName` is checked with the *same* `carries` closure (`requirementSupport.ts:729` → `:697` →
`sameWord`). Folds therefore already reach a gate the module's own header calls absolute. Run with
the patched module, threshold 0.6:

| requirement (capitalised token ⇒ `mustName`) | record | before | after |
|---|---|---|---|
| `Own the Foundation program end to end` | `I found the program gaps end to end and closed them.` | refused `missing_specific_token` | **`ok: true`** |
| `Drive the Transformation agenda for the group` | `A transformative agenda for the group was delivered by me.` | refused | `ok: true` |
| `Deliver the Automation roadmap` | `I automated the roadmap for the enterprise delivery team.` | refused | `ok: true` |

Row 1 is a false provenance: the named token `Foundation` is satisfied by `found`, the past tense of
`find`. Rows 2 and 3 are arguably sound folds, which is exactly why row 1 is dangerous — the same
mechanism produces both and no ratio separates them.

## O-4. Plurals silently defeat every proposed fold, and the obvious repair re-opens the collisions.

`forms()` applies each rule to the ORIGINAL token only; it never re-folds its own output. Measured
with the patched module:

```
no    capabilities ~ capable        no    alignments ~ align
no    mentorships ~ mentor          no    integrations ~ integrate
no    transformations ~ transform   no    collaborations ~ collaborative
```

Postings write these plural constantly. A one-pass "de-pluralize, then fold" variant was also built
and measured. It recovers all of them — and buys these at the same time:

```
MATCH operations ~ operative   MATCH operations ~ operate    MATCH relations ~ relative
MATCH foundations ~ found      MATCH departments ~ depart    MATCH flagships ~ flag
MATCH statements ~ states
```

So the plural question is not a detail to leave to the implementer's taste; it doubles the
false-positive surface and must be an explicit, asserted decision (AC-13).

---

# PART 1 — ACCEPTANCE CRITERIA

Tier: **1 (accusation grade)** per CLAUDE.md "Match the process to the risk" — `sameWord` decides
`must_have_coverage`, `mustName`, and `evidenceProposal.overclaimed`. Independent `verifier` required.

## A. Happy path — the folds that must start matching

**AC-1.** Given `sameWord` with the derivational folds installed, when it is called on each pair
`('collaborative','collaboration')`, `('capability','capable')`, `('integration','integrating')`,
`('mentorship','mentoring')`, then every call returns `true`, **and** the reversed-argument call
returns `true` for the same pair (symmetry).

**AC-2.** Given the same build, when `forms('collaborative')` and `forms('collaboration')` are
compared, then their intersection is non-empty — i.e. the match in AC-1 is produced by a shared
member of the two form sets, not by a special-case pair table. *(A pair table would satisfy AC-1
while leaving `collaborate`/`collaborating` unreached; the module's design is set intersection.)*

**AC-3.** Given the same build, when `sameWord` is called on the closure of each target family —
`('collaboration','collaborate')`, `('collaborative','collaborating')`, `('integration','integrate')`,
`('mentorship','mentored')`, `('alignment','align')`, `('management','manage')`,
`('leadership','leader')`, `('ownership','owner')`, `('accountability','accountable')`,
`('responsibility','responsible')`, `('scalability','scalable')`, `('availability','available')` —
then all return `true`.

**AC-4.** Given the requirement `Experience with data integration and real-time analytics` and the
record `I led teams integrating real-time data across the enterprise analytics estate`, when
`supportIn` is run at `threshold: 0.6, maxSentences: 1, minQuoteChars: 20, minQuoteWords: 4,
distinctiveLen: 6`, then `support` is **1.000** (measured before: 0.750) and `ok` is `true`.

**AC-5.** Given the requirement `Coaching and mentorship of senior engineering leaders` and the
record `I focused on mentoring senior engineering leaders throughout my tenure`, when `supportIn` is
run with the AC-4 options, then `support` rises from **0.600 to 0.800** and `ok` stays `true`.

**AC-6.** Given the requirement `Collaborative executive capable of building alignment` and the
record `By fostering collaboration and ensuring alignment across business and technology`, when
`supportIn` is run with the AC-4 options, then the inline `support` computed over `mustCarry` is
**0.400, up from 0.200**, and the result is **still refused with reason `below_threshold`**.
*(This AC exists to pin O-1: the change is an improvement on this requirement and NOT a fix for it.
An implementation that makes this one `ok: true` has over-loosened and fails this AC.)*

## B. `ratio` and provenance must not move

**AC-7.** Given any `(requirement, record)` pair, when `supportIn` is run before and after the
change, then the returned `ratio` is **numerically identical**. `ratio` is `exactHits/want.length`
(line 720-721) with no fold applied, it is the ranking key, and it is what is stored in
`requirement_evidence.evidence_ratio`. Verified across the eight measured cases in Part 0: ratio was
identical (0.75, 0.6, 0.5, 0.5, …) in every one.

**AC-8.** Given the change, when `RESOLVER_VERSION` is inspected, then it has been **incremented**.
Stored rows are attributed to a ruleset (`requirementSupport.ts:24`); changing what `sameWord`
accepts changes the ruleset, and rows written under the old version must remain distinguishable.

**AC-9.** Given the change, when the offsets returned by `supportIn` are checked, then
`text.slice(span.start, span.end).length === span.end - span.start` still holds for every result —
folds operate on TOKEN STRINGS only and must never be applied to a rewritten copy of the record that
an index is then taken from (the H32 class, `H:offsets-from-original`).

## C. THE FALSE-POSITIVE BOUNDARY — the section that decides whether this ships

Every pair below was **measured** against the patched build. Each must be asserted as
`assert.ok(!sameWord(a, b))` in the guard. A pair marked ⚠ is one the naive proposed rule
**currently matches** — the implementation must be narrowed until it does not, or the pair must be
argued down in writing and the argument recorded in the test comment.

### C.1 — `-ion` / `-ive`: use `-ation`/`-ative`, never a bare `-ion`/`-ive` strip

A bare 3-char strip of `-ion` and `-ive` was measured. It produces these, all of which must NOT match:

**AC-10.** Given the change, when `sameWord` is called on each pair below, then every call returns
`false`.

| pair | why it must not match | bare `-ion`/`-ive` | `-ation`/`-ative` |
|---|---|---|---|
| `execution` ~ `executive` | **the single most dangerous pair in this corpus.** `executive` is in the requirement text of the very posting that motivated the change; `execution` ("flawless execution", "strategy execution") is in nearly every résumé. Matching them claims an executive-level identity from a delivery noun. | ⚠ MATCH | ✅ no |
| `objective` ~ `object` / `objects` | `objective` (goal) vs `object` (thing/verb). Different claims entirely. | ⚠ MATCH | ✅ no |
| `competitive` ~ `competition` | "competitive compensation" (a posting's benefit blurb) vs "competition" (market). | ⚠ MATCH | ✅ no |
| `decision` ~ `decisive` | "decision support system" vs "decisive leader" — a system and a trait. | ⚠ MATCH | ✅ no |
| `mission` ~ `misses` / `miss` | `mission` → `miss` (4 chars, clears `MIN_STEM`). Absurd and reachable. | ⚠ MATCH | ✅ no |
| `native` ~ `nation` | blocked only by `MIN_STEM` (`nat` = 3). Assert it so a floor change cannot silently open it. | ✅ no | ✅ no |
| `vision` ~ `vise` | `vis` = 3, refused by `MIN_STEM`. Same reason to pin it. | ✅ no | ✅ no |

**AC-11.** Given the `-ation`/`-ative` narrowing, when `sameWord('execution','execute')` and
`sameWord('adoption','adopt')` and `sameWord('retention','retain')` and `sameWord('decision','decide')`
are called, then all return **`false`**, and this is **accepted as a known, documented gap**, not a
defect. It is the price of AC-10 row 1. The gap must be stated in the module comment so the next
reader does not "fix" it by widening to a bare `-ion` strip and silently re-opening
`execution`~`executive`.

Residual `-ation`/`-ative` collisions that survive the narrowing and must be **explicitly ruled on**
(measured MATCH under the narrow rule):

| pair | assessment |
|---|---|
| `foundation` ~ `found` | ⚠ **FALSE — must be blocked.** `found` is `IRREGULAR['found'] = 'find'`. Measured to flip a `mustName` gate (O-3). |
| `relation` ~ `relative` | ⚠ **FALSE — must be blocked.** "investor relations" vs "relative to plan". |
| `notation` ~ `note` / `noted` | ⚠ FALSE. Low frequency; block it anyway — it is free. |
| `operation` ~ `operative` | borderline. `operative` is rare in this corpus. Implementer must state a verdict; if allowed, say so in the comment. |
| `creation` ~ `creative` | borderline-acceptable ("content creation" ~ "creative"). State the verdict. |
| `initiative` ~ `initiation` | acceptable. |
| `information` ~ `informative` | acceptable. |
| `administration` ~ `administrative`, `communication` ~ `communicate`, `innovation` ~ `innovative`, `automation` ~ `automate`, `migration` ~ `migrate`, `optimization` ~ `optimize`, `modernization` ~ `modernize`, `motivation` ~ `motivate`, `allocation` ~ `allocate`, `evaluation` ~ `evaluate`, `negotiation` ~ `negotiate`, `consolidation` ~ `consolidate`, `presentation` ~ `present`, `transformation` ~ `transform` | **TRUE — these are the fold's value.** Assert a representative handful as positives so a later narrowing cannot quietly kill them. |

### C.2 — `-ment`

**AC-12a.** Given the change, when `sameWord` is called on each pair below, then every call returns `false`.

| pair | why | measured under naive `-ment` strip |
|---|---|---|
| `department` ~ `depart` / `departed` | **the headline `-ment` false positive.** "department strategy" vs "I departed the region". Measured to raise `support` 0.667 → 1.000 on a real-shaped case. | ⚠ MATCH |
| `commitment` ~ `commit` / `commits` | in a technology résumé `commit`/`commits` are version-control nouns. "Commitment to inclusion" evidenced by "1,200 commits" is false provenance. | ⚠ MATCH |
| `statement` ~ `state` / `states` / `stated` | "problem statement" vs "multi-state operations" / "as stated". | ⚠ MATCH |
| `moment` ~ `mo`, `segment` ~ `seg`, `payment` ~ `pay`, `comment` ~ `com`, `element` ~ `ele`, `augment` ~ `aug` | blocked only by `MIN_STEM`. Pin them so a floor change cannot open them. | ✅ no |
| `document` ~ `docu`, `argument` ~ `argu`, `instrument` ~ `instru`, `sentiment` ~ `senti`, `fragment` ~ `frag` | the rule fires where `-ment` is not a suffix, producing junk stems. Harmless only because nothing else reduces to them — assert that nothing does. | n/a |

TRUE `-ment` folds to keep (assert as positives): `alignment`~`align`, `management`~`manage`,
`deployment`~`deploy`, `engagement`~`engage`, `enablement`~`enable`, `investment`~`invest`,
`improvement`~`improve`, `achievement`~`achieve`, `assessment`~`assess`, `recruitment`~`recruit`,
`procurement`~`procure`, `government`~`govern`.

**AC-12b.** Given `-ment` folds `government`→`govern`, when `sameWord('governance','govern')` and
`sameWord('compliance','comply')` are called, then they return `false`, and the module comment states
that `-ance`/`-ence` is **deliberately out of scope**. Half-covering a morphological family is how a
matcher becomes unpredictable; the gap must be named, not discovered.

### C.3 — `-ship`

**AC-12c.** Given the change, when `sameWord` is called on each pair below, then every call returns `false`.

| pair | why | measured |
|---|---|---|
| `flagship` ~ `flag` / `flags` / `flagged` | **the headline `-ship` false positive.** "flagship product" vs "I flagged the risk". Measured to raise `support` 0.667 → 1.000. | ⚠ MATCH |
| `hardship` ~ `hard` | `hard` is 4 chars and clears the floor. | ⚠ MATCH |
| `worship` ~ `wor`, `township` ~ `town`(?) | `wor` = 3, refused. Pin it. | ✅ no |
| `relationship` ~ `relative` | must stay `false` — it is only `false` because folds do **not** compose (`relationship`→`relation`, and `relation` is never re-folded). This pair is the canary for AC-13. | ✅ no |

TRUE `-ship` folds to keep: `mentorship`~`mentor`, `leadership`~`leader`, `ownership`~`owner`,
`partnership`~`partner`, `internship`~`intern`, `stewardship`~`steward`, `membership`~`member`,
`scholarship`~`scholar`, `dealership`~`dealer`. (`sponsorship` is caught pre-gate by
`ELIGIBILITY_RE`, so it never reaches this path — note it, do not rely on it.)

### C.4 — `-ability` / `-ibility`

**AC-12d.** Given the change, when `sameWord` is called on each pair below, then every call returns `false`.

| pair | why |
|---|---|
| `disability` ~ `disable` / `disabled` | ⚠ **MATCH under the rewrite rule and must be blocked.** "reasonable accommodation for a disability" vs "disabled the legacy service". A protected-characteristic word matched to a deployment verb is the worst-tasting false positive in this whole set. |
| `liability` ~ `liable` | borderline; both are legal-register and rare here. State a verdict. |
| `ability` ~ `able` | already moot — both are in `STOP` and never reach `claimTokens`. Assert it anyway; `STOP` is editable. |

TRUE `-ability`/`-ibility` folds to keep: `capability`~`capable`, `accountability`~`accountable`,
`scalability`~`scalable`, `availability`~`available`, `reliability`~`reliable`,
`sustainability`~`sustainable`, `responsibility`~`responsible`, `flexibility`~`flexible`,
`visibility`~`visible`, `credibility`~`credible`, `stability`~`stable`, `portability`~`portable`.

### C.5 — the frozen pairs from the existing test must not regress

**AC-12e.** Given the change, when the existing NOT-fold assertions at `matcher.test.mjs:844-847`
are run, then `('managed','manager')`, `('data','date')`, `('culture','cultural')`,
`('platform','perform')`, `('water','waiter')` all still return `false`, and `forms('ops')` still
lacks `op`, and `forms('sre')` still lacks `sr`. All seven were re-measured under the patched build
and still hold — the guard must keep proving it, not assume it.

## D. `MIN_STEM` interaction

**AC-13a.** Given the change, when `MIN_STEM` is read, then it is **still 4** and no derivational
rule introduces its own lower floor. The `addDoubled` floor of 3 exists for a *second* reduction of a
stem that already cleared 4 (`running`→`runn`→`run`); no derivational fold may reuse it.

**AC-13b.** Given a derivational rule that **strips** a suffix (`-ment`, `-ship`, bare `-ation`
stem), when the stripped remainder is shorter than `MIN_STEM`, then it is discarded via the existing
`add()` helper — the rule must go through `add()`, never `out.add()` directly. Measured proof that
this is load-bearing: `moment`→`mo`, `segment`→`seg`, `payment`→`pay`, `comment`→`com`,
`worship`→`wor`, `vision`→`vis`, `native`→`nat`, `creation`→`cre` are ALL refused by the floor
today, and each would be a live false positive without it.

**AC-13c.** Given a derivational rule that **rewrites** a suffix (`-ability`→`-able`,
`-ation`→`-ate`), when the produced form is measured, then it is a **longer or equal-length real
word**, so `MIN_STEM` is not the control that protects it. The control is instead the **minimum
input length** on the rule (measured working values: `t.length > 8` for `-ability`, `> 7` for
`-ation`/`-ative`, `> 6` for `-ment`/`-ship`). Each minimum must be stated in the code with the
shortest word it is there to exclude, in the style of the existing `MIN_STEM` comment.

**AC-13d.** Given the change, when the two cases `termMatch.ts:15` names as the reason it rejected
stemming are tested, then `sameWord('ops','op')` and `sameWord('sre','sr')` are both `false` and
`forms('ops')`/`forms('sre')` are unchanged from `main`. **Do `termMatch.ts`'s reasons apply here?**
Read at `termMatch.ts:13-16`: *"Deliberately NOT stemmed — a stemmer turns `ops`→`op` and `sre`→`sr`.
Plurals are explicit aliases."* Its objection is to **short-token over-stemming in a term library
where an entry names a product**, and it is answered by `MIN_STEM = 4`, which every proposed
derivational fold inherits. **Its reasoning does not otherwise transfer**: `termMatch` matches a
*term against a library entry* (`exact_norm`, `case_sensitive_acronym`, `token_subset`) where the
target is a name; `forms()` decides whether two *prose words* are the same word. The relevant part
of that objection is already honoured; the rest is a different job. This finding must be repeated in
the module comment so the decision is visible rather than re-litigated.

## E. The named-entity path

**AC-14.** Given the requirement `Own the Foundation program end to end` (where `Foundation` is a
capitalised non-first token and therefore a `mustName` token per `namedEntityTokens`) and the record
`I found the program gaps end to end and closed them`, when `supportIn` is run at threshold 0.6,
then the result is **refused with reason `missing_specific_token`** — the same as before the change.
*(Measured: the naive fold makes this `ok: true`. This AC currently FAILS and is the gate on shipping.)*

**AC-15.** Given the change, when the `mustName` check at `requirementSupport.ts:729` is read, then
a named token is satisfied **only** by the folds that existed on `main` (inflectional), or by exact
identity — no derivational fold may satisfy a `mustName` token. Two shapes satisfy this; either is
acceptable, and the implementer must state which and why:
  (a) `carries` is split into `carriesInflectional` (used for `mustName`) and `carriesAll` (used for
      `support` and the `CATEGORY`/list gates); or
  (b) `forms()` takes a mode flag and `mustName` is evaluated in inflectional-only mode.
**Not acceptable:** leaving one `carries` and arguing the collisions are unlikely. The module's own
header calls named entities absolute — *"No ratio, no fold beyond the enumerated ones, no
similarity"* — and O-3 measured three requirements flipping through that gate.

**AC-16.** Given the split in AC-15, when a named token that is a plain plural is tested —
requirement `Deliver on the Kubernetes migration` vs record `we ran Kubernetes clusters` — then the
existing inflectional behaviour is unchanged, so the split does not tighten `mustName` either.

**AC-17.** Given `evidenceProposal.verifyReasoning`, when the change lands, then the pair
`(carries(reasoning, t), carries(quote, t))` at `evidenceProposal.ts:338` uses the **same
inflectional-only** rule for `overclaimed` as `mustName` does. Reason, measured from the source: a
looser fold moves `overclaimed` in **both** wrong directions at once — `carries(r,t)` looser
withdraws a model explanation that never named the entity, and `carries(q,t)` looser suppresses a
withdrawal that should fire. `overclaimed` writes an accusation into stored `extra`
(*"a model's explanation was withdrawn: it credited the excerpt with X"*), so it is the same grade
as `mustName`.

**AC-18.** Given `evidenceProposal.verifyReasoning`, when `missing` is computed, then it MAY use the
full folded rule (it is a published *fact*, not an accusation), and the change to it must be
observable: for requirement `Coaching and mentorship of senior leaders` with quote
`I focused on mentoring senior leaders`, the stored note must no longer say
`the excerpt does not mention: mentorship`.

## F. The owner threshold must stay live (H42 / "settings-shaped constant")

**AC-19.** Given the change, when the two threshold tests in `api/test/evidence.test.mjs`
(`the threshold is a seeded default a caller can move, not a constant`, ~line 174, and the pair at
~line 321-322) are run, then both still pass — i.e. `resolveEvidence(req, recs, { threshold: 0.99 })`
is still `null` and `{ threshold: 0.4 }` is still truthy for the same fixture. These assert
**movement, not a value**, precisely because an earlier revision made contentful coverage a hard gate
and drove `support` to exactly 1 whenever it was compared, rendering the setting inert
(`requirementSupport.ts:713-717`).

**AC-20.** Given a corpus run over the live profile records, when the distribution of the inline
`support` value is collected across all `(requirement, record)` candidate pairs, then **the share of
pairs with `support === 1.0` must not exceed its pre-change share by more than 15 percentage points**,
and at least one requirement in the sample must still land strictly between 0 and 1. A fold set that
drives `support` to 1 everywhere passes every happy-path AC and re-creates the exact defect H42 was
written for. *(Measured warning sign already present: on three of the eight Part-0 cases the fold
took `support` from 0.667 to exactly 1.000 — including the two false ones,
`department`/`departed` and `flagship`/`flagged`.)*

**AC-21.** Given the change, when `chk_evidence_threshold` is read, then it is still the owner-settable
column and no new hardcoded constant governing match strictness has been introduced without an owner
path (CLAUDE.md "No hardcoded config"). If the fold list itself is judged owner-relevant, say so and
get explicit approval to leave it code-only — the module already argues `CATEGORY` is deliberately
not owner-settable because it is a safety floor, and the same argument plausibly covers the fold
table. **State the verdict; do not leave it unaddressed.**

## G. Plural composition — decide it explicitly

**AC-22.** Given the change, when `sameWord('capabilities','capable')`,
`sameWord('alignments','align')`, `sameWord('mentorships','mentor')`,
`sameWord('integrations','integrate')` and `sameWord('transformations','transform')` are called,
then the implementer's stated decision holds for all five identically — either all `true` (folds are
tried on the de-pluralized form too) or all `false` (folds apply to the original token only) — and
the choice is recorded in the module comment with the cost measured in O-4.

**AC-23.** Given the "de-pluralize then fold" choice, if it is taken, then the following measured
consequences are each blocked by the false-positive rules of section C, re-verified in the plural
form: `sameWord('operations','operative')`, `sameWord('operations','operate')`,
`sameWord('relations','relative')`, `sameWord('foundations','found')`,
`sameWord('departments','depart')`, `sameWord('flagships','flag')`, `sameWord('statements','states')`
all return `false`. *(All seven were measured MATCH in the naive de-pluralize variant.)*

**AC-24.** Given any implementation, when `forms()` is read, then it performs **one pass over the
original token** and no rule consumes another rule's output. Canary assertion:
`sameWord('relationship','relative') === false` — it is `false` today only because `relationship`
→ `relation` is never re-folded through `-ation`. A recursive `forms()` makes it `true`.

## H. Corpus regression and the over-loosening detector

**AC-25.** Given the change is merged and deployed, when the corpus-wide count is taken via
`db-query.yml` —
`select count(*) from requirement_evidence;` and
`select count(distinct opportunity_id) from requirement_evidence;` —
then the row count is recorded **before** the deploy (measured baseline: **1 row across 613
opportunities**) and again after a re-resolve, and the after-figure is reported with its delta.

**AC-26.** Given the after-figure, when it is judged, then it must satisfy a **stated plausibility
bound agreed before the run**, not after. Proposed bound, derived from the Part-0 measurements: the
fold recovers roughly one blocked token per affected requirement, moving `support` by ~0.15-0.25 —
so a **single-digit-to-low-tens** increase in evidenced requirements on the eMoney opportunity is
plausible. **A jump to near-total coverage (e.g. `must_have_coverage` reading 11/12 or 12/12) is a
FAILURE signal, not a success**, and must trigger a per-requirement audit before anything is claimed.
Rationale: this change cannot legitimately produce that outcome — AC-6 measures the flagship
requirement still refused after the fold.

**AC-27.** Given the deploy, when a per-requirement diff is produced for one opportunity
(2cb56fb3), then for **every** requirement that newly gained evidence, the stored quote is read and
the specific folded token pair that unlocked it is named. Any pair not on the approved list in
section C is a defect, regardless of how plausible the quote reads. *(This is the only check that
catches an unanticipated collision; the enumerated list in C can only cover what was imagined.)*

**AC-28.** Given `appRequirements.ts:549`, when the change lands, then `lookedFor.missingWords` and
`closestExcerpt` are confirmed to shift consistently with `supportIn` — this is a **third** consumer
of `sameWord` and it is what the owner reads as *"what we looked for"*. It is advisory, not
accusation-grade, so it needs no separate gate, but a silent divergence between the note and the
verdict is a reported-bug shape.

---

# PART 2 — REGRESSION GUARD SPEC

Two H-cases. Both go in **`api/test/matcher.test.mjs`** (beside the existing
`the fold: enumerated, and it does NOT reintroduce the stems termMatch rejected` at line ~830) —
that is where the fold's behaviour already lives, and CLAUDE.md rule 4 prefers a runtime test over a
source grep where the behaviour can be exercised. Slugs, never numbers (`H26` fails a new numeric ID).

## Guard 1 — `test('H:derivational-folds-do-not-overreach: ...')`

Must assert, in one test:

1. **Positives** — every pair in AC-1 and AC-3, both argument orders (symmetry).
2. **Negatives** — every pair listed in C.1-C.5 as must-not-match, each with a one-line comment
   naming *why*, and for the ⚠ rows the measured evidence that the naive rule matched them:
   ```
   // Measured 2026-08-23 against a patched build of dist/functions/tests/requirementSupport.js:
   // a bare -ion/-ive 3-char strip returns TRUE for execution~executive. `executive` is a token of
   // the live eMoney requirement "Collaborative executive capable of building alignment".
   ['execution', 'executive'],
   ```
3. **The `MIN_STEM` canaries** — `moment`~`mo`, `segment`~`seg`, `payment`~`pay`, `comment`~`com`,
   `worship`~`wor`, `vision`~`vise`, `native`~`nation`, `creation`~`creative` (whichever verdict is
   taken), plus the frozen `ops`/`op` and `sre`/`sr`, and `assert.equal(MIN_STEM, 4)` via an export
   or a source read so a floor change cannot pass silently.
4. **The non-composition canary** — `assert.ok(!sameWord('relationship','relative'))` with the
   comment explaining it is `false` only because `forms()` does not re-fold its own output.
5. **The plural decision** — the five AC-22 pairs asserted to one consistent verdict, and if the
   de-pluralize variant was taken, all seven AC-23 pairs asserted `false`.

## Guard 2 — `test('H:named-entity-gate-takes-no-derivational-fold: ...')`

This is the one that guards the accusation. Must assert:

1. `supportIn` on the three O-3 cases (`Foundation`/`found`, `Transformation`/`transformative`,
   `Automation`/`automated`) returns `reason: 'missing_specific_token'` — i.e. the derivational fold
   does not reach `mustName`.
2. `supportIn` on a plain-inflection named case (`Kubernetes migration` / `Kubernetes clusters`)
   still resolves, proving the split did not tighten `mustName`.
3. `evidenceProposal.verifyReasoning`: a reasoning sentence naming `Foundation` against a quote
   containing only `found` does **not** produce `overclaimed: ['foundation']` — the fold must not
   manufacture a withdrawal — **and** a reasoning sentence naming `IoT` against a quote without it
   still does. Both directions, in one test, because a guard that only checks the firing direction
   is the vacuous-gate shape `evidenceProposal.ts:293-296` records having already been built once.
4. A structural assertion that there is not one shared `carries` doing both jobs — e.g. read
   `requirementSupport.ts` and assert the `mustName` line does not call the same closure the
   `support` line calls. Strip comments before matching (CLAUDE.md H-case rule 2: two guards have
   already fired on a comment).

## MANDATORY mutation-proof — never skipped, at any tier

For **each** guard, before the commit lands:

```
# Guard 1
1. Widen the fold to the bare -ion/-ive 3-char strip (the naive rule).
2. Run: cd api && node --test test/matcher.test.mjs
3. REQUIRED: H:derivational-folds-do-not-overreach FAILS, naming execution~executive.
4. Restore. Re-run. Suite green.

# Guard 2
1. Revert the mustName split — point line 729's check back at the folded `carries`.
2. Run: cd api && node --test test/matcher.test.mjs
3. REQUIRED: H:named-entity-gate-takes-no-derivational-fold FAILS on the Foundation/found case.
4. Restore. Re-run. Suite green.
```

If a mutation is **behaviourally equivalent** and correctly fails to fail, say so explicitly and do
not claim the assertion is proven (CLAUDE.md). Three guards in one prior session passed with their
defect reinstated and would have shipped as protection that protected nothing.

Also required, and not a substitute for the above: `cd api && npm run build && node --test test/`
green, including `evidence.test.mjs`'s two threshold-movement tests (AC-19).

---

# PART 3 — ALTERNATIVES CONSIDERED

## (a) Lower `evidenceThreshold` instead of adding folds — **WORSE, and it cannot work**

Measured: on the flagship requirement the fold moves `support` 0.200 → 0.400. To evidence it by
threshold alone you would need `chk_evidence_threshold ≤ 0.2`, i.e. *one contentful word in five
is enough*. **Specific failure mode**: the threshold is a single global dial over `mustCarry`
coverage; it cannot distinguish "the word is present in a different derivational form" from "the
word is simply absent." Dropping it to 0.2 admits every excerpt that shares one word with the
requirement, and the only things still standing between that and a stored claim are the exact
safety-floor rules (`mustName`, `generic_overlap_only`) — which is exactly the configuration
`CATEGORY`'s comment says the M10 floor must survive but was never meant to carry alone.
It also produces the wrong *quote*: the ranking key `ratio` is unfolded, so a low threshold selects
whichever excerpt happens to share a common word. **Verdict: not an alternative — it trades a false
negative for an unbounded false positive.** Worth noting the converse though: because AC-6 shows the
fold alone does not clear 0.6 on the motivating requirement, the owner may still want to *review*
the threshold afterwards. That is a separate, owner-facing decision with its own evidence, not a
substitute for this change.

## (b) A real stemmer (Porter / Snowball) — **WORSE here, for a reason already recorded twice**

**Specific failure mode**: Porter is aggressive and unenumerable. It maps `operate`→`oper`,
`relational`→`relat`, `executive`→`execut`, `execution`→`execut` — reproducing the exact
`execution`~`executive` collision AC-10 exists to prevent, with no way to exempt one pair. It also
reintroduces `ops`→`op`, the case `termMatch.ts:15` names as the reason stemming was rejected, and
`MIN_STEM` cannot be bolted onto a library rule without disabling it wholesale. Worse for this
codebase specifically: `RESOLVER_VERSION` promises *same records + same requirement = same row*, and
a dependency's stemmer changes behaviour on a version bump that no one reviews. **The house rule
"fuzzy matching is for RANKING, never for ACCUSING" is not satisfied by a stemmer** — a stemmer is
enumerable only in the sense that its source is readable, not in the sense that a reviewer can state
what it will and will not join. Enumerated folds are auditable pair-by-pair, which is what an
accusation-grade check requires. **Verdict: rejected on the same grounds `termMatch.ts` rejected it,
strengthened by the measurement in AC-10.**

## (c) Competency / synonym mapping — **BETTER on ceiling, WORSE on cost and risk; the right NEXT step, not this one**

A curated map (`collaboration ≈ partnership ≈ cross-functional alignment`, `mentorship ≈ coaching ≈
developing talent`) reaches what morphology never can: the measured residual misses
`secure`~`security`, `governance`~`govern`, `architecture`~`architect`, `retention`~`retain`,
`adoption`~`adopt`, `strategy`~`strategic`, and the true blockers on the flagship requirement
(`executive`, `capable`, `building` have no derivational bridge to that excerpt at all —
**this is the approach that would actually fix AC-6's case**).
**Specific failure modes**: (1) a synonym map is a *semantic* claim, so every entry is a place a
false accusation can hide, and unlike a fold it cannot be validated by inspecting two spellings —
`mentorship ≈ coaching` is a judgement, and someone has to own it; (2) CLAUDE.md "No hardcoded
config" makes it owner-settable data, which means a table, a UI, a seed, and a migration — a much
larger change than this one; (3) it does not remove the need for folds, because the map would need
an entry for every inflection of every synonym unless folds normalise first. **Verdict: complementary,
higher ceiling, materially higher risk and cost. Folds first — they are provably safe pair-by-pair and
they are the input a synonym map would want. Propose it as its own phase with its own ACs.**

## (d) Let the escalation tier / `evidenceProposal` handle it — **WORSE as the primary answer, and it is already what happens**

This is the status quo: a requirement the deterministic matcher refuses falls to a model proposal
(`evidenceProposal.ts`) or an `escalation` row asking a human. **Specific failure modes**: (1) it
admits model output into a stored claim for a case a deterministic rule can settle exactly, which
inverts the module's whole design — `verifyReasoning` exists precisely because two of five live
model explanations asserted what their quote does not show; (2) the measured volume makes it
unworkable: **0 of 35 requirements resolved deterministically on one opportunity**, so escalation is
not a tail, it is the entire path; (3) it leaves `must_have_coverage` reading 0/12 in the interim,
which is the reported bug. **However** — and this is why it stays on the list — the escalation tier
is the correct destination for the residue AC-6 and AC-11 leave behind, and the *right* framing of
this change is "shrink what escalates to what genuinely needs a human," not "replace escalation."
A false negative surfaces a requirement to a person; a false positive writes a false claim into the
packet. **Verdict: keep it as the fallback it is; do not let it absorb a class the folds can settle.**

## (e) Do nothing / re-scope — worth stating

Because AC-6 shows the flagship case is **not** fixed by this change, "add folds" must not be sold as
"fixes `must_have_coverage` 0/12." The honest framing for sign-off is:
*this change removes one measurable class of false negative (derivational mismatch), moves `support`
by ~0.15-0.25 on affected requirements, and is a prerequisite for (c), which is where the remaining
coverage lives.* Sign off on that, or re-scope to include (c) now.

---

# PART 4 — SIGN-OFF CHECKLIST

- [ ] AC-6 accepted: the motivating requirement is **still refused** after this change. If that is
      not acceptable, stop and scope alternative (c) instead.
- [ ] AC-14 / AC-15 (named-entity split) accepted as blocking — currently **failing** on the naive rule.
- [ ] Verdicts stated for the borderline pairs: `operation`~`operative`, `creation`~`creative`,
      `commitment`~`commit`, `statement`~`state`, `liability`~`liable`.
- [ ] Plural decision made (AC-22) with its cost accepted (O-4).
- [ ] AC-21: fold table code-only vs owner-settable — verdict recorded.
- [ ] AC-26 plausibility bound agreed **before** the post-deploy corpus count is read.
