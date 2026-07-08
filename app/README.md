# Executive Engine

An AI operating system for the executive job search — the production app shell
built on the `boost_resume_n_packet_builder` service layer.

## Slice 1

Vite + React 18, Compass design tokens. Three screens wired to the live Azure
Functions service layer (`/api/app/*`, backed by Postgres/pgvector):

- **Today** — inbox-scrub hero, KPI strip, do-next + in-flight lists
- **Opportunities** — filterable/sortable table (search, urgency, stage)
- **Pipeline** — 12-column kanban with drag-to-advance (optimistic + persisted)

Persona switcher (CTO / VP Eng / VP Product) re-filters the catalog. Demo data
is flagged `is_demo=true` so a per-email fresh start is possible.

## Dev

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
```

`VITE_API_URL` overrides the default API base
(`https://job-platform-api.azurewebsites.net/api`).
