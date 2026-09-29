# UX Review — recent additions (Add job, Unrecognized locations)

<!--
WHAT:       Independent adversarial UX review of three recent UI additions to Pipeline-Exec
            (Executive Engine): the "+ Add job" top-bar trigger + paste-a-URL panel, the
            Settings > Locations "Unrecognized locations" card, and how both sit inside the
            existing app shell.
WHY:        The product owner stated the recent UI additions "don't follow good practices in
            most cases". This review finds the specific defects rather than reassuring.
SUPERSEDES: nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:   Live screenshots (desktop 1440px Opportunities + Settings>Locations; owner's own
            phone screenshot of Opportunities), app/src/theme.css, app/src/tokens/fig-tokens.css,
            app/src/screens/Opportunities.jsx, app/src/screens/Settings.jsx, app/src/shell.jsx
REVIEWER:   Independent design review pass, 2026-09-29. No stake in the implementation.
-->

**Status:** IN PROGRESS — findings appended as they are established.

## Ground truth used

| Artifact | What it proves |
|---|---|
| Owner's phone screenshot of Opportunities (`8b3f034d-image.jpg`, 1029x2257 native) | Real device, real viewport, real data — the most important artifact here |
| Desktop Opportunities, 1440px | Where `+ Add job` now lives, and the filter stack above the table |
| Desktop Settings ▸ Locations, 1440px | The Unrecognized-locations card at real volume (416 jobs / 315 locations / 12 shown) |
| `app/src/theme.css` | `.px-*` utilities and `--proto-*` tokens, incl. the codebase's own measured contrast ratios |
| `app/src/tokens/fig-tokens.css` | Resolved Compass token values |
| `app/src/screens/Opportunities.jsx` | `AddJobByLink` + header/filter area |
| `app/src/screens/Settings.jsx` | `LocationSettings` |
| `app/src/shell.jsx` | `TopBar`, `TopBarActions`, `SideNav`, mobile bottom nav |

## Findings

_(appended below, most severe first — re-ranked at the end)_

