# Roles & Titles taxonomy — source of truth

Source: user-provided (2026-07-28) + `Boost_Exec_Pipeline.PDF` PRD (docs/design_handoff).
This file is the canonical input for the taxonomy seed + matcher. Three levels:
**Role group → Role → Title variant**. Tiers: `fav` (favorite/promoted), `watch` (default),
`off` (excluded from ingestion).

## Group / Role structure

- **C Suite** — CTO, CIO, Chief Digital Officer, Chief Data Officer, CPO, Chief AI Officer, COO
- **VP & Head of** — Software, Engineering, Product, Technology, Digital, Data Analytics & AI,
  Architecture, Delivery & Operations, Solutions & Automation, Transformation & Strategy
- **Director** — Software, Engineering, Product, Technology, Digital, Data Analytics & AI,
  Architecture, Delivery & Operations, Solutions & Automation, Transformation & Strategy

## Inclusion rules (per PRD §5)

- **COO** (C Suite): include ONLY when software, digital transformation, product delivery,
  technology operations, or business transformation is central to the position.
- **Director** (group): primarily Senior Director / Executive Director / Managing Director.
  Ordinary Director only when comp, enterprise scope, team size, ownership, or succession
  potential is exceptional.

## Favorites — user's "ideal roles to be surfaced or promoted"

All title variants listed under the user's "ideal roles" block seed as tier=`fav`. Everything
else in the taxonomy seeds as `watch`. Favorites (abbreviated + long forms both count as
variants):

### C Suite favorites
CTO / Chief Technology Officer — Enterprise, Divisional, Business Unit, Product, Platform,
Software, Digital, Field, Deputy, Fractional (+ bare CTO and each abbreviated form).
CIO / Chief Information Officer — Enterprise, Divisional, Business Unit, Digital, Technology,
Fractional.
Chief Digital Officer — CDO, Chief Digital and Technology Officer, Chief Digital Transformation
Officer, Chief Digital Innovation Officer, Chief Digital and Information Officer, Chief Digital
and Product Officer, Fractional CDO, Digital CDO.
Chief Data Officer — Chief Data and Analytics Officer, Chief Data and AI Officer, Chief
Analytics Officer, Chief Data and Technology Officer, Chief Data and Digital Officer, Fractional,
Data CDO, Chief Data & Analytics Officer, Chief Data & AI Officer.
CPO / Chief Product Officer — Chief Product and Technology Officer, Chief Product and Digital
Officer, Chief Product Development Officer, Chief Product and Engineering Officer, Fractional,
Product CPO.
Chief AI Officer — CAIO, Chief Artificial Intelligence Officer, Chief AI and Data Officer,
Chief AI and Technology Officer, Chief Analytics and AI Officer, Chief Data Analytics and AI
Officer, Fractional, Chief AI & Data Officer.
COO (gated by inclusion rule) — Chief Operating Officer, Chief Technology and Operating Officer,
Chief Digital Operating Officer, Chief Product and Operating Officer, Chief Transformation and
Operating Officer, Divisional COO, Business Unit COO, Technology COO, Digital COO.

### VP & Head of favorites (each family: "Vice President of X", "VP of X", "Head of X",
"Global Head of X" variants)
Software, Engineering, Product, Technology, Digital, Data/Analytics/AI, Architecture,
Delivery & Operations, Solutions & Automation, Transformation & Strategy — full variant lists
per the user's block (e.g. VP of Software Engineering, Head of Digital Transformation, Global
Head of Data and AI, VP of Enterprise Architecture, Chief Architect / Enterprise Chief Architect /
Distinguished Chief Architect, etc.).

### Director favorites (Senior Director / Executive Director / Managing Director / Global Director
of each family) — per the user's block. Ordinary "Director of X" excluded unless exceptional.

> NOTE: The complete, machine-usable variant lists are encoded in the seed module
> `api/src/functions/tests/roleTaxonomy.ts` (`ROLE_TAX`). This markdown is the human summary;
> the .ts seed is authoritative for matching.
