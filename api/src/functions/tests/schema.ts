// Production data model for the Executive Engine app database
// (boost_resume_n_packet_builder). Canonical source of the schema; the migration
// runner (diag/pg-migrate) executes this idempotently. Maps spec §8 entities.
//
// Conventions: lowercase snake_case; UUID PKs; text + CHECK for enums (flexible);
// JSONB for nested/variable structures; created_at/updated_at on mutable rows;
// pgvector column on opportunity for dedupe/match; pg_trgm indexes for fuzzy
// company/role matching.

export const SCHEMA_SQL = `
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists "uuid-ossp";

-- Multi-tenancy + demo flagging: every user-owned row is scoped by owner_email
-- (the user's profile email) and flags demo/seed rows so a real user can start
-- clean. Demo seed uses owner_email = 'demo@executive-engine.local', is_demo=true.
-- "Fresh start for user X" = delete demo rows, insert with owner_email = X.

-- Personas (CTO / VP Engineering / VP Product) — re-filter catalog & baselines
create table if not exists persona (
  id           uuid primary key default uuid_generate_v4(),
  owner_email  text not null default 'demo@executive-engine.local',
  is_demo      boolean not null default false,
  key          text not null,
  name         text not null,
  master_role  text not null,
  comp_target  text,
  positioning  text,
  created_at   timestamptz not null default now(),
  unique (owner_email, key)
);

-- The atomic unit. 12-stage pipeline; embedding powers dedupe/match.
create table if not exists opportunity (
  id            uuid primary key default uuid_generate_v4(),
  owner_email   text not null default 'demo@executive-engine.local',
  is_demo       boolean not null default false,
  persona_key   text,
  company       text not null,
  logo_url      text,
  role          text not null,
  location      text,
  comp_range    text,
  match_score   int check (match_score between 0 and 100),
  fit           text check (fit in ('Strategic','Good','Stretch')),
  urgency       text check (urgency in ('Hot','Warm','Cool')),
  source        text,
  source_date   date,
  why_surfaced  text,
  hiring_manager text,
  recruiter     text,
  roles_for     text[] default '{}',
  stage         text not null default 'discovered'
                check (stage in ('discovered','saved','enriched','applied','outreach','engaged','screen','r1','panel','final','offer','accepted')),
  dismissed     boolean not null default false,
  pain_hypotheses jsonb default '[]',
  company_signals jsonb default '[]',
  embedding     vector(1536),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists opp_stage_idx on opportunity(stage) where not dismissed;
create index if not exists opp_persona_idx on opportunity(persona_key);
create index if not exists opp_company_trgm on opportunity using gin (company gin_trgm_ops);
create index if not exists opp_role_trgm on opportunity using gin (role gin_trgm_ops);
create index if not exists opp_embedding_hnsw on opportunity using hnsw (embedding vector_cosine_ops);

-- Stakeholders/contacts per opportunity
create table if not exists contact (
  id        uuid primary key default uuid_generate_v4(),
  opp_id    uuid not null references opportunity(id) on delete cascade,
  name      text not null,
  role      text,
  signal    text,
  match     text,
  created_at timestamptz not null default now()
);
create index if not exists contact_opp_idx on contact(opp_id);

-- Application packet (created on keep+approve). Ships when all artifacts approved.
create table if not exists packet (
  id           uuid primary key default uuid_generate_v4(),
  opp_id       uuid not null references opportunity(id) on delete cascade,
  status       text not null default 'building' check (status in ('building','review','ready','sent')),
  round        int not null default 1,
  jd_analyzed  boolean not null default false,
  covered_kw   text[] default '{}',
  ats_score    int,
  feedback     jsonb default '[]',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists packet_opp_idx on packet(opp_id);

-- Artifacts within a packet, each with its own status state machine
create table if not exists artifact (
  id            uuid primary key default uuid_generate_v4(),
  packet_id     uuid not null references packet(id) on delete cascade,
  type          text not null check (type in ('resume','compact_resume','cover','portfolio','video')),
  status        text not null default 'todo' check (status in ('todo','drafting','review','changes','approved')),
  template_id   text,
  doc_url       text,
  version_history jsonb default '[]',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists artifact_packet_idx on artifact(packet_id);

-- Multi-channel outreach messages + cadence scheduling
create table if not exists outreach_message (
  id          uuid primary key default uuid_generate_v4(),
  opp_id      uuid not null references opportunity(id) on delete cascade,
  contact_id  uuid references contact(id) on delete set null,
  channel     text not null check (channel in ('coldEmail','linkedinConnect','linkedinDM','inMail','coldCall','followUp')),
  tone        text,
  template    text,
  body        text,
  state       text not null default 'draft' check (state in ('draft','scheduled','due','sent')),
  day_offset  int,
  scheduled_for timestamptz,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists outreach_opp_idx on outreach_message(opp_id);
create index if not exists outreach_due_idx on outreach_message(state, scheduled_for);

-- Interviews: prep, transcript, debrief
create table if not exists interview (
  id          uuid primary key default uuid_generate_v4(),
  opp_id      uuid not null references opportunity(id) on delete cascade,
  stage       text,
  scheduled_for timestamptz,
  questions   jsonb default '[]',
  transcript  text,
  debrief     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists interview_opp_idx on interview(opp_id);

-- Offer / negotiation tracker
create table if not exists offer (
  id          uuid primary key default uuid_generate_v4(),
  opp_id      uuid not null references opportunity(id) on delete cascade,
  their_offer jsonb,
  counter     jsonb,
  floor       jsonb,
  benchmarks  jsonb default '[]',
  status      text not null default 'open' check (status in ('open','countered','accepted','declined')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists offer_opp_idx on offer(opp_id);

-- Library entities referenced during generation
create table if not exists library_entity (
  id         uuid primary key default uuid_generate_v4(),
  owner_email text not null default 'demo@executive-engine.local',
  is_demo    boolean not null default false,
  kind       text not null check (kind in ('role_profile','template','playbook','asset')),
  name       text not null,
  category   text,
  is_default boolean not null default false,
  content    jsonb default '{}',
  created_at timestamptz not null default now()
);
create index if not exists library_kind_idx on library_entity(kind);

-- Asset engagement analytics (opens / view time / forwards)
create table if not exists asset_event (
  id           bigserial primary key,
  asset_id     text not null,
  opp_id       uuid references opportunity(id) on delete set null,
  viewer       text,
  event        text not null check (event in ('open','view','forward','download')),
  view_seconds int default 0,
  ts           timestamptz not null default now()
);
create index if not exists asset_event_asset_idx on asset_event(asset_id);

-- OpenAI cost/token metering
create table if not exists usage_metering (
  id                bigserial primary key,
  model             text,
  feature           text,
  prompt_tokens     int,
  completion_tokens int,
  cost_usd          numeric(12,8),
  ts                timestamptz not null default now()
);

-- Idempotent multi-tenant column adds (safe on tables that predate them)
alter table persona        add column if not exists owner_email text not null default 'demo@executive-engine.local';
alter table persona        add column if not exists is_demo boolean not null default false;
alter table opportunity    add column if not exists owner_email text not null default 'demo@executive-engine.local';
alter table opportunity    add column if not exists is_demo boolean not null default false;
alter table library_entity add column if not exists owner_email text not null default 'demo@executive-engine.local';
alter table library_entity add column if not exists is_demo boolean not null default false;
create index if not exists opp_owner_idx2 on opportunity(owner_email);
`;

// Tables we expect to exist after migration (used by the runner to report).
export const EXPECTED_TABLES = [
  'persona', 'opportunity', 'contact', 'packet', 'artifact', 'outreach_message',
  'interview', 'offer', 'library_entity', 'asset_event', 'usage_metering'
]
