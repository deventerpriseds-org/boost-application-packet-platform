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

-- ── Term library (QC & evidence layer, P1.2b) ────────────────────────────────────────────────────
-- A VERSIONED, CURATED vocabulary that ATS keyword scoring resolves against. Deliberately NOT
-- owner-scoped: it is shared reference data, unlike library_entity (per-owner content) and
-- taxonomy_title (per-owner job-TITLE tiers, a different axis — "is this one of my target roles?"
-- rather than "which skills does this posting demand?").
--
-- Immutability is the point: a published version and its entries can never change, so a score
-- recorded against version N re-renders identically forever. Adding an alias creates version N+1.
create table if not exists term_library (
  id              uuid primary key default uuid_generate_v4(),
  library_key     text not null,
  version         int not null,
  status          text not null default 'draft' check (status in ('draft','published','archived')),
  -- Per-source audit: name, exact release, retrieval URL + date, licence, required attribution.
  -- CC BY 4.0 (O*NET) obliges us to name the release and USDOL/ETA wherever terms surface.
  source_manifest jsonb not null default '{}',
  entry_count     int not null default 0,
  notes           text,
  created_at      timestamptz not null default now(),
  published_at    timestamptz,
  unique (library_key, version)
);

create table if not exists term_library_entry (
  id                uuid primary key default uuid_generate_v4(),
  library_id        uuid not null references term_library(id) on delete cascade,
  term_key          text not null,              -- stable identity ACROSS versions (soc_2, p_and_l)
  display_term      text not null,              -- what the UI shows: "SOC 2"
  normalized        text not null,              -- canonical match form
  aliases           text[] not null default '{}',
  alias_normalized  text[] not null default '{}',   -- what the matcher indexes
  family            text not null,              -- compliance | security | cloud_platform | data_ai | ...
  term_type         text not null,              -- technology | certification | framework | competency | ...
  match_mode        text not null default 'exact_norm'
                    check (match_mode in ('exact_norm','case_sensitive_acronym','token_subset')),
  -- MANY sources, not one. Owner directive: corroboration across sources raises confidence, and every
  -- keyword must be able to show HOW it was sourced. O*NET/ESCO are helpers, never gates — a term the
  -- corpus attests is valid even if neither lists it (most exec vocabulary is in that position).
  sources           text[] not null default '{}',   -- onet | esco | jd_corpus | nist_csf | cncf | curated
  source_refs       jsonb not null default '{}',    -- per-source id: UNSPSC code, ESCO URI, CSF subcat
  soc_codes         text[] not null default '{}',
  scoreable         boolean not null default true,  -- false = display-only; enforces "model terms never score"
  confidence        numeric(4,3),               -- derived from independent-source corroboration, not a model
  evidence_df       int,                        -- document frequency in jd_real at seed time
  weight            numeric,
  added_at          timestamptz not null default now(),
  unique (library_id, term_key)
);
create index if not exists term_entry_lib_idx on term_library_entry(library_id);
create index if not exists term_entry_alias_idx on term_library_entry using gin (alias_normalized);
create index if not exists term_entry_norm_idx on term_library_entry(normalized);

-- Enforce immutability in the DATABASE, not by convention: the acceptance criterion "adding an alias
-- does not change any historical score" is only true if published entries genuinely cannot be edited.
create or replace function term_entry_guard() returns trigger as $$
begin
  if exists (select 1 from term_library l
             where l.id = coalesce(old.library_id, new.library_id) and l.status = 'published') then
    raise exception 'term_library_entry is immutable once its library version is published (library_id=%)',
      coalesce(old.library_id, new.library_id);
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists term_entry_guard_trg on term_library_entry;
create trigger term_entry_guard_trg
  before update or delete on term_library_entry
  for each row execute function term_entry_guard();

-- Candidate terms mined from the real posting corpus, awaiting human curation.
-- This is the EXTRACTION side of the term library: every row is a literal substring of a real
-- employer's posting with a countable document frequency, never model output. That is what lets it
-- satisfy "terms must not be model-generated" while still supplying the exec vocabulary O*NET lacks
-- (measured: roadmap 626, board 480, budget 416, operating model 222, P&L 83 — none in O*NET).
create table if not exists term_candidate (
  id            uuid primary key default uuid_generate_v4(),
  owner_email   text not null,
  ngram         text not null,        -- the literal surface form as it appears in postings
  normalized    text not null,        -- termNormalize(ngram)
  n             int not null,         -- 1..4
  df            int not null,         -- document frequency across scanned postings
  sample_opp_ids uuid[] not null default '{}',
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected','merged')),
  merged_into   text,                 -- term_key it was folded into, when status='merged'
  reviewed_at   timestamptz,
  reviewed_by   text,
  mined_at      timestamptz not null default now(),
  corpus_size   int not null default 0,   -- postings scanned, so df is interpretable later
  unique (owner_email, normalized)
);
create index if not exists term_cand_status_idx on term_candidate(owner_email, status, df desc);

-- P1.1 — the evidence spine. One row per line the employer asked for, anchored to a character range
-- in the posting so any downstream claim can be re-read at its source.
--
-- item_text is what the MODEL wrote (jd_table's Item column is a paraphrase, measured on live
-- rows). verbatim is the EMPLOYER'S own words at [char_start, char_end) in opportunity.jd_text.
-- They are separate columns on purpose: conflating them fabricates evidence that P1.3's
-- verbatim_quote and P4's citation validator would then cite as if the employer had written it.
-- A row that could not be located keeps null offsets and a null verbatim rather than inventing either.
create table if not exists requirement (
  id             uuid primary key default uuid_generate_v4(),
  opp_id         uuid not null references opportunity(id) on delete cascade,
  seq            int not null,              -- jd_table row order, so re-extraction is a stable upsert
  item_text      text not null,             -- model paraphrase. NEVER presented as a quote.
  verbatim       text,                      -- posting substring at the offsets below, or null
  char_start     int,
  char_end       int,
  match_method   text not null check (match_method in ('exact','anchored','unlocatable','beyond_model_window','no_posting')),
  kind           text not null check (kind in ('must_have','nice_to_have','responsibility')),
  kind_source    text not null check (kind_source in ('posting_required_marker','posting_optional_marker','posting_section_heading','category','category_default','fallback')),
  model_keyword  text,                      -- jd_table ATS Keyword: a P1.2 candidate, never scoreable
  competency     text,                      -- resolved by the term library (P1.2); null until then
  coverage       text check (coverage in ('covered','partial','escalated')),
  closed_on_loop int,
  weight         int not null check (weight between 1 and 3),
  source_category text,
  jd_source      text check (jd_source in ('jd_real','raw_jd')),
  jd_text_sha256 text not null,             -- offsets are only valid against THIS posting body
  extractor_version int not null,
  created_at     timestamptz not null default now(),
  unique (opp_id, seq),
  check ((char_start is null) = (char_end is null)),
  check ((char_start is null) = (verbatim is null)),
  check (char_start is null or (char_start >= 0 and char_end > char_start))
);
create index if not exists requirement_opp_idx on requirement(opp_id);
create index if not exists requirement_kind_idx on requirement(opp_id, kind);

-- P1.3 — what the pipeline CHANGED, and whether the posting explains it.
-- One candidate row per item in every list, INCLUDING unchanged ones: the packet screen shows all
-- originals against all finals, so "we looked at this and kept it" is a different statement from
-- "we never considered it". Both are data.
create table if not exists skill_candidate (
  id           uuid primary key default uuid_generate_v4(),
  packet_id    uuid not null references packet(id) on delete cascade,
  list         text not null check (list in ('skills_1','skills_2','relevant_1','relevant_2','relevant_3')),
  label        text not null,
  origin       text not null check (origin in ('profile_original','pass_a','pass_b')),
  char_len     int not null,
  created_at   timestamptz not null default now()
);
create index if not exists skill_cand_packet_idx on skill_candidate(packet_id, list);

-- One row per original (kept/swapped/merged/dropped) plus one per item the ATS pass introduced.
-- driver: 'posting' means a requirement quote justifies the change. There is no omission list in
-- this pipeline, so a change nothing explains is 'unattributed' - NOT 'rule', which would invent an
-- authority for a model's unexplained choice. P2.2 blocks on the unattributed count.
create table if not exists swap_decision (
  id             uuid primary key default uuid_generate_v4(),
  packet_id      uuid not null references packet(id) on delete cascade,
  list           text not null check (list in ('skills_1','skills_2','relevant_1','relevant_2','relevant_3')),
  seq            int not null,
  action         text not null check (action in ('kept','swapped','merged','dropped','added')),
  from_candidate_id uuid references skill_candidate(id) on delete set null,
  to_candidate_id   uuid references skill_candidate(id) on delete set null,
  from_label     text,
  to_label       text,
  requirement_id uuid references requirement(id) on delete set null,
  verbatim_quote text,                 -- the EMPLOYER's words, never a paraphrase
  confidence     numeric(4,3) not null default 0,
  driver         text not null check (driver in ('posting','rule','unattributed')),
  rationale      text,
  created_at     timestamptz not null default now(),
  unique (packet_id, list, seq),
  -- A citation needs a source: a posting-driven row must carry both, and no other row may claim one.
  check ((driver = 'posting') = (verbatim_quote is not null))
);
create index if not exists swap_dec_packet_idx on swap_decision(packet_id, list, seq);

-- P1.4 — what text landed in which REAL merge field of which artifact, what it replaced, and which
-- requirement justifies it. Each asset is modelled as ITS merge fields, not as invented sections:
-- merge_field values come from TEMPLATE_META, the same table varsForType injects from, so a row can
-- never name a slot the document does not have.
-- A field the package could not fill still gets a row with generated=false. That is the point - the
-- UI lists what the pipeline CANNOT reach beside what it filled, so static template text is visible
-- as static instead of being mistaken for generated content.
create table if not exists insertion (
  id             uuid primary key default uuid_generate_v4(),
  artifact_id    uuid not null references artifact(id) on delete cascade,
  merge_field    text not null,
  generated      boolean not null,
  before_text    text,
  after_text     text,
  method         text not null check (method in ('model_rewrite','template_fill','manual')),
  loop           int not null default 0,
  list           text check (list in ('skills_1','skills_2','relevant_1','relevant_2','relevant_3')),
  item_count     int not null default 0,
  requirement_id uuid references requirement(id) on delete set null,
  verbatim_quote text,
  confidence     numeric(4,3) not null default 0,
  created_at     timestamptz not null default now(),
  unique (artifact_id, merge_field, loop),
  -- An ungenerated block has no content and can cite nothing.
  check (generated or (after_text is null and verbatim_quote is null and item_count = 0))
);
create index if not exists insertion_artifact_idx on insertion(artifact_id, loop);

-- P2.1 — one row per check per artifact per run. offenders names the specific items, never a
-- count: a count tells a reviewer something is wrong without telling them what to fix.
-- not_applicable is a first-class state and NOT a pass. A coverage check that "passed" because
-- there were no requirement rows to check against is how a gate goes green on an artifact nobody
-- verified - the single most dangerous row this table could hold.
create table if not exists check_result (
  id           uuid primary key default uuid_generate_v4(),
  artifact_id  uuid not null references artifact(id) on delete cascade,
  run_id       uuid not null,        -- one id per engine run, so a run is inspectable as a set
  check_key    text not null,
  engine       text not null check (engine in ('deterministic','reviewer')),
  state        text not null check (state in ('pass','warn','fail','not_applicable')),
  observed     text,
  expected     text,
  offenders    text[] not null default '{}',
  created_at   timestamptz not null default now(),
  unique (artifact_id, run_id, check_key)
);
create index if not exists check_result_artifact_idx on check_result(artifact_id, created_at desc);

-- The aggregated verdict for one artifact, plus the override trail. A warn may be overridden by a
-- human; a fail may not, because only deterministic rows produce fail and those are facts about
-- the text. Actor is resolved SERVER-side from the session - a client-supplied actor would make the
-- audit row worthless.
create table if not exists artifact_gate (
  artifact_id     uuid primary key references artifact(id) on delete cascade,
  run_id          uuid not null,
  gate            text not null check (gate in ('pass','warn','fail')),
  attention_count int not null default 0,
  computed_at     timestamptz not null default now(),
  override_by     text,
  override_at     timestamptz,
  override_reason text,
  -- An override needs all three parts or none: a reason with no actor is not an audit trail.
  check ((override_by is null) = (override_at is null)),
  check ((override_by is null) = (override_reason is null))
);

-- Idempotent multi-tenant column adds (safe on tables that predate them)
alter table persona        add column if not exists owner_email text not null default 'demo@executive-engine.local';
alter table persona        add column if not exists is_demo boolean not null default false;
alter table opportunity    add column if not exists owner_email text not null default 'demo@executive-engine.local';
alter table opportunity    add column if not exists is_demo boolean not null default false;
-- Role-taxonomy tagging (Phase 1): matched group/role/variation, tier, favorite flag, pre-boost score.
alter table opportunity    add column if not exists matched_group text;
alter table opportunity    add column if not exists matched_role text;
alter table opportunity    add column if not exists matched_variation text;
alter table opportunity    add column if not exists title_tier text;
alter table opportunity    add column if not exists is_favorite boolean not null default false;
alter table opportunity    add column if not exists base_score int;
-- The canonical posting text every requirement offset indexes, plus its digest. Stored, not
-- recomputed: an offset is only meaningful against the exact string it was measured on, and jd_real
-- is re-fetched by the backfill timer.
alter table opportunity    add column if not exists jd_text text;
alter table opportunity    add column if not exists jd_text_sha256 text;
alter table opportunity    add column if not exists jd_text_truncated boolean;
alter table packet         add column if not exists must_haves text[];
alter table packet         add column if not exists jd_grounded boolean;
alter table packet         add column if not exists jd_analyzed_at timestamptz;
alter table library_entity add column if not exists owner_email text not null default 'demo@executive-engine.local';
alter table library_entity add column if not exists is_demo boolean not null default false;
create index if not exists opp_owner_idx2 on opportunity(owner_email);
`;

// Tables we expect to exist after migration (used by the runner to report).
export const EXPECTED_TABLES = [
  'persona', 'opportunity', 'contact', 'packet', 'artifact', 'outreach_message',
  'interview', 'offer', 'library_entity', 'asset_event', 'usage_metering',
  'term_library', 'term_library_entry', 'term_candidate', 'requirement',
  'skill_candidate', 'swap_decision', 'insertion', 'check_result', 'artifact_gate'
]
