# C — Frontend routing vs the spec's deep-link contract

WHAT:       Audits BOOST_COPILOT_COLE_BRIDGE_SPEC.md §5 (deep-link contract) and §4.1.A
            ("deep-link discipline") against the product frontend's actual router.
WHY:        The spec calls §4.1.A "the single highest-leverage, lowest-effort fix -- system
            prompt change only, zero new tools". Measured below: the URLs it mandates do not
            resolve, so a prompt-only change makes the coach emit confidently-broken links.
SUPERSEDES: nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:   file:line citations below, read at boost origin/main a041d8f

## Verdict: REFUTED — §4.1.A is not prompt-only, and §5's URL shapes are wrong

### Finding 1 — Boost is a HASH-routed SPA; the spec's links omit the `#`

| Evidence | |
|---|---|
| `app/src/state.jsx:21` | `const [hash, setHash] = useState(() => window.location.hash \|\| '#/today')` |
| `app/src/state.jsx:23-24` | `const onHash = () => setHash(window.location.hash \|\| '#/today')` / `window.addEventListener('hashchange', onHash)` |
| `app/src/state.jsx:32` | ``export const go = (path) => { window.location.hash = path.startsWith('#') ? path : `#${...}` }`` |

Real URLs are `{APP}/#/route`. The spec's §5 writes `{BOOST_APP_URL}/pipeline/{opportunityId}`
with no `#`, so the hash is empty and the app falls back to `#/today`. **Every deep link the
spec specifies lands on the Today screen.**

### Finding 2 — there are NO parameterised routes to deep-link INTO

`app/src/shell.jsx` `NAV` (lines 7-22) defines flat collection routes only:

    /today  /swipe  /opportunities  /pipeline  /packets  /outreach
    /interview  /library  /roles  /library/roles  /library/playbooks  /call  /intake

A repo-wide grep for `'/<seg>/:<param>'` route patterns in `app/src` returns NOTHING. So
`/pipeline/{opportunityId}` and `/packets/{packetId}` are not routes in any form -- with or
without the `#`. The spec asserts both as if they exist.

### Finding 3 — the swap anchor is structurally unavailable, not merely "not yet added"

§5 specifies `{BOOST_APP_URL}/packets/{packetId}#swap-{swapId}` and footnotes it as a "small
frontend addition -- anchor doesn't exist yet". Under hash routing the ROUTE already occupies
the fragment, and a URL cannot carry a second meaningful `#`. This is not a small addition; it
needs a different addressing scheme entirely (e.g. `#/packets?id=<id>&swap=<id>`), which is a
design decision, not a nit.

## Consequence for the rewritten spec

The dependency the spec presumes -- "the data exists, the coach just isn't told to surface it" --
is only half true. The DATA (`artifact.doc_url`/`drive_url`) is a genuine artifact URL and works
standalone. The APP ROUTES are the broken half: opportunity and packet links have no target.

Correct verdict per the feasibility-table convention: **EXISTS-BUT-CONSTRAINED**, and the
constraint changes the effort estimate from "prompt only" to "frontend routing + prompt".
