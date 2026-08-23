# Import note

This folder is the **QC & evidence layer handoff package**, delivered by the owner as
`Boost_Exec_Pipeline.zip` on 2026-08-19 and committed here verbatim so it survives session/context
loss. Nothing in it was authored in this repo.

- `SPEC.md` — the build spec. §2 (R1–R7) are ground rules that constrain every screen.
- `BACKLOG.md` — P0…P8 with the author's acceptance criteria.
- `screens/` + `screens/INDEX.md` — 47 captioned screenshots, narrative order.
- `Packet QC Prototype.html` + `qc/*.jsx` + `qc/data.js` — runnable prototype. **Behavioral ground
  truth, NOT production code.** Per its README: do not port its inline styles.
- `app/src/theme.css`, `app/src/tokens/*` — copies the prototype loads. The repo's real versions
  live at `app/src/`; these are here only so the prototype runs standalone. **Do not diff them
  against the app as if they were authoritative.**
- `Evidence Model & QC Lineage.html` — data shapes, scoring weights, lineage. **Updated 2026-08-23
  to the as-built revision — see "The lineage doc is the newest artefact" below. This file now
  outranks the prototype and the screenshots wherever they disagree.**
- `Zap 289877647 Workflow Baseline.html` — what the pipeline does today + known defects
  (§5 = the Q1–Q16 checks P2.1 ports; §6 = the hygiene items P7 lists).

**Values the README says to carry over verbatim:** keyword highlight `#fff03a`; posting-echo tint
`#fbf2da` with `#c9b27a` underline; 250px provenance margin; breakpoints 1080 / 1200 / 1440.

**Explicitly not to be built** (SPEC §8, §4.12): the Current-app / Highlight-additions comparison
mode, authentication, template editing, the Docs/Slides render itself, mobile below ~700px.

**Known premise error in the package** (verified against this repo 2026-08-19): `BACKLOG.md` P0.2
says `jd-analysis` "persists none of it". False — `appPackets.ts:491` persists `jd_analyzed`,
`ats_score` and `covered_kw`. Only `mustHaves` and `gaps` are discarded. See the plan file
`.claude/QC-EVIDENCE-PLAN.md` for the reconciled version of every item.

---

## The lineage doc is the newest artefact — it outranks the prototype and the screenshots

**Update 2026-08-23.** The owner re-supplied two HTML pages. Everything else in the package was
re-checked byte-for-byte and is **unchanged**: all 47 PNGs, all six `qc/*.jsx`, `qc/data.js`, the
four token/theme CSS files, `SPEC.md`, `BACKLOG.md`, `README.md`. Only these two moved:

| File | Change |
|---|---|
| `Packet QC Prototype.html` | 2 lines — a `color-scheme: light only` meta + style. No behaviour. |
| `Evidence Model & QC Lineage.html` | 121 lines — **first draft → as-built.** Substantive. |

The version committed on 2026-08-19 was the **first draft**: it said "Step one of two", carried
"Decision for you" open questions, listed **eight** records, and proposed a QC rail step. The
current file is the **settled, as-built** revision. What changed:

1. **The QC rail step is DROPPED.** §5a and §7 are explicit: *"New rail step at position 6 →
   **Dropped.** No QC step."* Evidence lives **in the asset, beside the line it explains**; the
   packet-level roll-up is the single **ATS Match** modal opened from the header composite. The
   per-asset right drawer is dropped with it. Rail stays `jd · resume · cover · portfolio · video · send`.
2. **A ninth record: `correction`** — `kind` (posting_figure | omit_list | markup_residue), `found`,
   `replaced_with`, `source` (posting_verbatim | profile_field | rule), `applied`, `undone_at`.
3. **A new pipeline step 2, auto-correct**, before the rules engine: hard fails with exactly one
   right answer are fixed *before display*, emitting reversible `correction` rows.
   Sequence is now generate → **auto-correct** → deterministic rules → blind reviewer → aggregate → gate.
4. **`swap_decision` gains `override_value` + `override_state`** (suggested | reverted | custom).
   §5c: the ⇄ control exchanges the two sides, and the *ships* value is text-editable so the user can
   type a third option. Nothing is applied silently; a reverted suggestion stays auditable.
5. **Two open questions settled:** a `warn` does **not** block approval (it needs a recorded
   override naming who and why); weights **50 / 30 / 20**, bands **85 / 70**, ATS-compact resume
   scored separately.
6. **Ordering rule:** QC leads with **"Done for you"** (corrections already applied) *before*
   **"Needs a decision"**. The flat Q1–Q16 list is a detail view inside the second group, never the
   top level.

### Precedence, and the contradiction it resolves

The prototype and the screenshots still depict the **rejected** design — `qc/packet.jsx:315` adds a
`{ key: 'qc', label: 'QC & evidence', isNew: true }` rail step, and `screens/INDEX.md` captions a
"QC & evidence step" (28–36) and a per-asset drawer (39–43). The lineage doc is the later artefact
and records that decision being reversed after the prototype was captured.

> **Rule: where the lineage doc disagrees with the prototype or the screenshots, the lineage doc
> wins.** Do not build the QC rail step or the per-asset drawer from the screenshots.

### Two divergences between the settled spec and what is built (verified 2026-08-23)

| Settled spec says | This repo has | Status |
|---|---|---|
| No QC rail step (§5a, §7) | `app/src/screens/PacketBuilder.jsx:42` — `{ key: 'qc', num: 6, label: 'QC & evidence' }` | **Built the dropped design.** Not yet reconciled. |
| `correction` record (§2) | `api/src/functions/tests/schema.ts:370` — `create table if not exists correction` | Built, matches. |
| `swap_decision.override_value` / `override_state` (§2, §5c) | Absent — no match in `api/src` or `app/src` | **Not built.** This is the ⇄ swap-back and the editable *ships* value the owner asked for. |

The third row is the spec basis for the owner's *"put back the item it displaced"* complaint and for
defect-register items **C1 + C3**; `BACKLOG.md` P8.6 asks for the same control.

---

Working plan + live status: **`.claude/QC-EVIDENCE-PLAN.md`**.
