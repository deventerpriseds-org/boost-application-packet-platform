# VERIFY-three-small — independent verification of `claude/three-small-ui-gaps`

Verifier agent. No shared context with the implementer. Written incrementally.

Branch: `claude/three-small-ui-gaps` — commits `2de4ae5`, `3101025`, `8d721a0` on `5e79581`.
Started: (in progress)

## Log

- [start] `git log --oneline -6` confirms the three commits exist on the branch, in the claimed order,
  on top of `5e79581`:
```
8d721a0 4.8-10: "Needs a decision" on the QC page, beside what the run settled
3101025 4.5-40: static blocks show the {{merge field}} inline, and stop contradicting it
2de4ae5 4.1-3: the JD step gets its only route into QC
02b8cd6 Loop-2 verification of F5 closes ...
5e79581 Loop-2 verifier work in flight ...
```
  `git status --short`: only two UNTRACKED files (`docs/qc-evidence/loop2-claims-2-5-6.mjs`,
  `docs/qc-evidence/loop2-safety-floor.mjs`) — no uncommitted modifications to the touched source.

## TIER: CHEAP + DETERMINISTIC — re-run in full by the verifier, not taken on the implementer's word

| Command (cwd) | Observed output | Verdict |
|---|---|---|
| `cd app && npm test` | `# tests 311 / # pass 311 / # fail 0 / duration_ms 903.166231` | matches the implementer's claim (311/0) |
| `cd app && npm run build` | `vite v5.4.21 ... 245 modules transformed ... built in 4.28s`, `dist/assets/index-B4gXmUqE.js 1,126.97 kB` — no error | clean |
| smart-quote codepoint scan (python3, U+2018/19/201C/201D) over all 10 touched files | `TOTAL SMART-QUOTE HITS: 0` | clean |
| `cd api && npm test` | `# tests 843 / # pass 843 / # fail 0` | api side green |
| `git diff 5e79581..HEAD -- api/ \| wc -l` | `0` | **`api/` is literally untouched by the three commits** — zero diff bytes, not merely "no logic change" |
| `cd api && npm run build` | `> tsc` and no diagnostics | clean |

**RADIUS CHALLENGE, part 1 — `api/` exclusion ACCEPTED, and on a stronger ground than the implementer gave.**
The implementer argued "no `api/` file was touched". The stronger proof is that `git diff 5e79581..HEAD -- api/`
emits **zero bytes**, so no `api/` behaviour can have changed by construction. `api` suite re-run anyway
(843/843) per 0c's cheap-tier rule.

---

## CLAIMS 1-5 — gap 4.1-3 (`See where each one is answered ->`)

**Claim 1 — control exists, navigates via `onOpenQc` -> `setActiveStep`, no router in the card. CONFIRMED.**
- `app/src/screens/PostingAnalysis.jsx:552-559` renders the control, hook `data-qc={POSTING_HOOKS.openQc}`,
  `onClick={onOpenQc}`.
- `app/src/postingAnalysis.js:35` — `openQc: 'jd-open-qc'` added to `POSTING_HOOKS`.
- `app/src/screens/PacketBuilder.jsx:842` — `onOpenQc={() => setActiveStep('qc')}`.
- `PacketBuilder.jsx:396-399` — `setActiveStep` calls `go('/packet/${id}/${key}')` after validating
  `key` against `STEPS`; `state.jsx:32` — `go` sets `window.location.hash` to `#/packet/<id>/qc`.
  So the hash target is confirmed by reading the chain, not by inference from the prop name.
- **No router in the card**, verified with a stricter grep than the implementer's test uses:
  `grep -nE "\bgo\s*\(|from '\.\./state|state\.jsx|useNavigate|location\.hash" app/src/screens/PostingAnalysis.jsx`
  -> `exit=1`, no output.

**Claim 2 — HIDDEN, not inert, on no requirements / `reqError`. CONFIRMED.**
`PostingAnalysis.jsx:551`: `{onOpenQc && !reqError && rows.length > 0 && (`. `rows` is
`groupRequirements(req?.requirements || []).all` (`PostingAnalysis.jsx:494-495`;
`postingAnalysis.js:363-376` returns `all` = the input array). So `req == null`, `req.requirements == []`,
or `reqError` truthy each collapse the whole element — nothing inert is rendered.

**Claim 3 — keyboard-reachable and visible to `compare-ui.mjs`. CONFIRMED.**
The control tag carries `role="button" tabIndex={0}` and
`onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenQc() } }}`.
`scripts/compare-ui.mjs:115` collects `document.querySelectorAll('button, [role="button"], a')`, so a
`role="button"` span IS collected. Two further filters on :116-117 were checked and the control survives
both: `.filter((t) => t && t.length < 40)` — the collected text is `See where each one is answered →`
(31 chars), and `!/@/.test(t)`. **Also checked, because the AC named it as a blast-radius risk:**
`compare-ui.mjs` has **no pinned expected control count** (`grep -nE "expected|EXPECTED|assert|toEqual"`
-> only two unrelated length filters), so adding a control cannot break it.

**Claim 11 — the mono slot label survives. CONFIRMED.**
`AssetBlocks.jsx:582-583` still renders `data-qc={BLOCK_HOOKS.fieldSlot}` with `{row.merge_field}` in a
monospace font stack. The `{{token}}` at `:404-406` is a second, separate element with its own new hook
`BLOCK_HOOKS.fieldPlaceholder`. Addition, not replacement.

**Claim 9 (first half) — the contradictory sentence is gone. CONFIRMED.**
`grep -rn "pipeline cannot see that text" app/src/` returns exactly ONE hit,
`app/src/screens/AssetBlocks.jsx:397`, and it is inside a `//` comment explaining the removal — not
inside any rendered JSX string.
