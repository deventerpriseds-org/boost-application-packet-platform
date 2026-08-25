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
--
-- INSERT IS COVERED, and it was not until 2026-08-24. The trigger fired before-update-or-delete
-- only, so an entry could be INSERTED into an already-published library. That is not a lesser hole
-- than UPDATE: coverage is covered/scoreable, so ADDING a scoreable entry moves the DENOMINATOR
-- of every score already recorded against that version, and "a score recorded against version N
-- re-renders identically forever" silently stops being true. Adding a term must create version N+1,
-- which is exactly what this now forces.
create or replace function term_entry_guard() returns trigger as $$
begin
  if exists (select 1 from term_library l
             where l.id = coalesce(new.library_id, old.library_id) and l.status = 'published') then
    raise exception 'term_library_entry is immutable once its library version is published (library_id=%) — add a new version instead',
      coalesce(new.library_id, old.library_id);
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists term_entry_guard_trg on term_library_entry;
create trigger term_entry_guard_trg
  before insert or update or delete on term_library_entry
  for each row execute function term_entry_guard();

-- ...and guard the LIBRARY row itself, or the entry guard above is trivially bypassed: flip
-- published back to draft, edit the entries the entry-guard now permits, then re-publish. The
-- entry guard reads l.status, so un-publishing disarms it. A published version is terminal —
-- it may only be ARCHIVED, never returned to draft and never re-pointed at a different key/version.
create or replace function term_library_guard() returns trigger as $$
begin
  if old.status = 'published' then
    if new.status = 'draft' then
      raise exception 'term_library %/v% is published and cannot return to draft — publish a new version instead',
        old.library_key, old.version;
    end if;
    if new.library_key is distinct from old.library_key or new.version is distinct from old.version
       or new.published_at is distinct from old.published_at then
      raise exception 'term_library %/v% is published — its identity and publish time are immutable',
        old.library_key, old.version;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists term_library_guard_trg on term_library;
create trigger term_library_guard_trg
  before update on term_library
  for each row execute function term_library_guard();

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
  -- 'escalated' here means THE QUOTE COULD NOT BE LOCATED IN THE POSTING, decided at extraction
  -- before any loop exists (requirements.ts). P3's "the loop gave up" is a DIFFERENT population and
  -- lives in the 'escalation' table (decision 15). Two populations in one column is how a gate comes
  -- to count the wrong thing.
  coverage       text check (coverage in ('covered','partial','escalated')),
  -- 'closed_on_loop int' used to sit here. It could not express the artifact dimension: coverage is
  -- judged per-ARTIFACT by evaluateArtifact, and "covered in the resume but not the cover letter" is
  -- the normal case. It had zero writers and zero readers (decision 16), so it is replaced rather
  -- than migrated - by remediation_loop.closed, which is per (artifact, pass) by construction.
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

-- P8.3 / R2 - the evidence excerpt behind a coverage claim.
--
-- R2: a requirement is "evidenced" only when a VERBATIM excerpt of the candidate's stored profile
-- can be shown beside it with its source named. Conflict-register C6 makes that the coverage
-- numerator: counts are recomputed from THESE rows, not from whether the generated document happens
-- to repeat the requirement's words. A requirement with no row here renders as "no evidence found in
-- your profile" and cannot be counted as covered anywhere.
--
-- A TABLE rather than columns on requirement, for three reasons that each bit something already:
--   1. requirement.coverage is TAKEN. requirements.ts writes 'escalated' there to mean "the
--      quote could not be located in the POSTING" - nothing to do with the profile. Two populations
--      in one column makes both unreadable, so nothing here writes it.
--   2. The acceptance sentence counts "requirements with A resolvable evidence quote" - an existence
--      test over many, not a single nullable field. One row is written per requirement today; the
--      shape does not have to change when a second source corroborates one.
--   3. D1/H11: a new store is declared in SCHEMA_SQL and registered in EXPECTED_TABLES, so a
--      migration that silently skipped it is a failing test rather than a 500 at runtime.
--
-- quote is a literal substring of the STORED PROFILE RECORD named by source_key, at
-- [char_start, char_end). Same discipline as requirement.verbatim, pointed at the candidate's
-- profile instead of the employer's posting. record_sha256 is what makes a stale offset detectable
-- after the owner edits their profile, exactly as jd_text_sha256 does for the posting.
-- P8.1 / R1 — what the engine fixed before the user saw it, and how to put it back.
--
-- ONE ROW PER CHANGED SPAN, not per field: a ResumeSummary can carry three independently undoable
-- corrections. That grain is why this is its own table rather than an extension of "insertion"
-- (unique per artifact/field/loop, so it structurally cannot hold three) or "swap_decision" (its
-- "list" CHECK admits only the five list fields, and prose fields like ResumeSummary are not among
-- them, and there is no ordinal to put in "seq"). Both were probed with real INSERTs against a
-- live cluster before this table was written; both rejected the row.
--
-- EVERY OFFSET IS RELATIVE TO THE ORIGINAL, PRE-CORRECTION FIELD TEXT, and stays that way forever.
-- Applying is a right-to-left splice so no pending offset can move; undoing one correction is a
-- replay of the list minus that row. Neither needs the offsets to survive a later rewrite, which
-- is what lets a revert months later be exact instead of approximate.
--
-- before_sha256 is the whole ORIGINAL field text, and it is RECOMPUTED on revert, not merely
-- stored. That is the difference between a guard and a decoration: a field edited by hand after the
-- correction is DETECTED and the revert refuses, rather than splicing into text that has moved.
-- (D19 records the sibling case where a hash is written and served but never recomputed.)
create table if not exists correction (
  id            uuid primary key default uuid_generate_v4(),
  artifact_id   uuid not null references artifact(id) on delete cascade,
  merge_field   text not null,
  phrase        text not null,          -- the exact original substring replaced
  replacement   text not null,
  char_start    int not null,
  char_end      int not null,
  before_sha256 text not null,
  applied_seq   int not null,           -- ascending by char_start, so the change log reads in document order
  reason        text not null,
  source        text not null check (source in ('profile_figure','generalized','owner_edit')),
  run_id        uuid,
  loop          int not null default 0,
  reverted_by   text,
  reverted_at   timestamptz,
  created_at    timestamptz not null default now(),
  -- A row that cannot fund its own undo must not exist. Enforced by the DATABASE, not by a writer's
  -- good intentions: the offsets must describe the phrase they claim to replace.
  constraint correction_span_matches_phrase check (char_end - char_start = length(phrase)),
  constraint correction_span_ordered        check (char_start >= 0 and char_end > char_start),
  constraint correction_sha_shaped          check (before_sha256 ~ '^[0-9a-f]{64}$'),
  -- Reverting is never a DELETE — the change log must still show the row as Undone. Both columns
  -- are set together or neither is.
  constraint correction_revert_paired       check ((reverted_by is null) = (reverted_at is null))
);
-- NULLS NOT DISTINCT is load-bearing and was found by execution, not by reading. Postgres treats
-- NULL as distinct from NULL in a UNIQUE, so with run_id NULL — every correction applied outside a
-- remediation loop, which is the COMMON case — the plain unique permitted unlimited duplicates. A
-- byte-exact duplicate inserted twice and the table held both.
create unique index if not exists correction_unique_seq
  on correction (artifact_id, merge_field, applied_seq, coalesce(run_id, '00000000-0000-0000-0000-000000000000'::uuid));
-- WIDENING source NEEDS THIS ALTER. THE INLINE CHECK ABOVE IS NOT ENOUGH, AND THE REASON IS THE
-- WHOLE DEFECT CLASS: create table if not exists is a NO-OP on a table that already exists, so it
-- can NEVER alter an existing constraint. Production's correction already exists, so without an
-- explicit ALTER the OLD two-value CHECK keeps rejecting owner_edit forever while this file reads
-- as though it allows it.
--
-- It is worse than a silent no-op, because appCorrections.ts:53 re-declares this whole table in
-- ensureCorrectionTable() and api-deploy.yml deploys the CODE (line 82) BEFORE it runs
-- pg-migrate (line 122). So between those two steps a route can run against a database whose CHECK
-- has not yet been widened, and an owner's edit is rejected by the database with the code already
-- live. The ALTER is what closes that window; H:correction-ddl-parity is what stops the two copies
-- drifting again.
--
-- Unconditional, like every other ALTER in this file: a conditional one skips the database that was
-- created by an older revision, which is exactly the database that needs it.
alter table correction drop constraint if exists correction_source_check;
alter table correction add constraint correction_source_check
  check (source in ('profile_figure','generalized','owner_edit'));
create index if not exists correction_by_artifact on correction (artifact_id, reverted_at);

create table if not exists requirement_evidence (
  id             uuid primary key default uuid_generate_v4(),
  requirement_id uuid not null references requirement(id) on delete cascade,
  quote          text not null,
  source_kind    text not null check (source_kind in ('work_history','accomplishment','profile_field','certification')),
  source_label   text not null,
  source_key     text not null,          -- the stored record the offsets index. NEVER a concatenation.
  char_start     int not null,
  char_end       int not null,
  extra          text,                   -- SPEC 4.1's optional supporting note. Never a second quote.
  ratio          numeric,                -- how much of the requirement the excerpt accounts for. RANKING ONLY.
  method         text not null check (method in ('exact','anchored')),
  record_sha256  text not null,
  resolver_version int not null,
  resolved_at    timestamptz not null default now(),
  -- The same offset discipline the requirement spine enforces.
  check (char_start >= 0 and char_end > char_start),
  check (length(quote) = char_end - char_start),
  -- One quote from one place in one record is one piece of evidence, however many times it resolves.
  unique (requirement_id, source_key, char_start, char_end)
);
create index if not exists req_evidence_req_idx on requirement_evidence(requirement_id);

-- THE OWNER'S CONFIRMATION OF A MODEL-PROPOSED EXCERPT.
--
-- Why coverage was pinned at zero: the deterministic resolver evidences 0 of 35 requirements on a
-- real posting (measured 2026-08-23), because lexical matching cannot bridge the employer's
-- noun-phrase vocabulary to the candidate's verb/gerund prose. The escalation tier already bridges
-- it -- 8 of 12 must-haves got a valid model proposal -- but ruleEvidenceOf excludes a proposed
-- row by design ("a model may PROPOSE, only an exact rule may ACCUSE"). The app told the owner those
-- were "awaiting your confirmation" in three places and there was nothing to confirm them WITH.
-- This is that missing step, and it keeps the house rule intact by making the HUMAN the accuser.
--
-- KEYED ON THE CLAIM, NOT ON THE EVIDENCE ROW, and that is the whole design.
--
-- A confirmation cannot be a column on requirement_evidence. writeRequirements runs
-- delete from requirement where opp_id=$1 on every re-extraction and this table's parent FK is
-- ON DELETE CASCADE, so every confirmation the owner ever gave would be destroyed the next time a
-- posting was re-parsed. requirement.seq is no better: it is a reused positional index, so a
-- confirmation keyed on it would silently transfer to whatever requirement later occupies that slot.
-- The only stable identity is the CLAIM ITSELF -- this requirement text, this excerpt, from this
-- record, at these offsets, with that record's digest.
--
-- EVERY COLUMN OF THE KEY IS LOAD-BEARING, because a confirmation means: "THIS exact sentence, from
-- THIS exact record of mine, answers THIS exact requirement." Change any noun and the owner never
-- made that claim. record_sha256 is what makes a profile edit invalidate it rather than silently
-- inherit it -- a surviving confirmation over a changed record would assert something no human said
-- and no rule can support, which is strictly worse than the honest 0/12 it replaces. Fail closed.
create table if not exists evidence_confirmation (
  id               uuid primary key default uuid_generate_v4(),
  opp_id           uuid not null references opportunity(id) on delete cascade,
  -- The requirement as EXTRACTED TEXT, never its id or seq -- both are destroyed or reused by
  -- re-extraction. This is what survives delete from requirement.
  requirement_text text not null,
  source_key       text not null,
  char_start       int not null,
  char_end         int not null,
  quote            text not null,
  record_sha256    text not null,
  confirmed_at     timestamptz not null default now(),
  -- Resolved SERVER-side from the verified session, never client-supplied -- the same discipline
  -- artifact_gate's override_by carries, and for the same reason: a client-named actor makes the
  -- audit row worthless.
  confirmed_by     text not null,
  -- A withdrawal is recorded rather than deleted, so "the owner confirmed this and then the profile
  -- changed" stays reconstructable months later instead of looking like it never happened.
  withdrawn_at     timestamptz,
  withdrawn_reason text,
  check (char_start >= 0 and char_end > char_start),
  check (length(quote) = char_end - char_start),
  check ((withdrawn_at is null) = (withdrawn_reason is null)),
  unique (opp_id, requirement_text, source_key, char_start, char_end, record_sha256)
);
create index if not exists evidence_confirmation_opp_idx on evidence_confirmation(opp_id);

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
  -- The remediation pass that produced these candidates. Without it writeSwaps' packet-wide DELETE
  -- takes pass 1's candidates with it, and pass 1's swap rows lose the ids they point at.
  loop         int not null default 0,
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
  driver         text not null check (driver in ('posting','rule','unattributed','owner')),
  rationale      text,
  -- P3-21. 'writeSwaps' deleted 'where packet_id=$1' on EVERY build and this table had no loop
  -- column, so pass 2 destroyed pass 1's swap record - the loop deleting its own justification for
  -- every change it had just made. 'loop' is part of the key so each pass keeps its own history and
  -- re-running one pass stays idempotent.
  loop           int not null default 0,
  created_at     timestamptz not null default now(),
  unique (packet_id, list, seq, loop),
  -- A citation needs a source: a posting-driven row must carry both, and no other row may claim one.
  check ((driver = 'posting') = (verbatim_quote is not null))
);
-- DECISION B (owner, 2026-08-25): an edit the OWNER made never moves the gate, in either
-- direction. It cannot fail the packet and it cannot buy a citation. That needs a fourth driver,
-- because the alternative - a separate boolean beside driver - would be a second place that answers
-- "who made this change", and the two would eventually disagree.
--
-- Same lesson as correction.source one migration earlier: the inline CHECK above only decides what a
-- FRESH database is born with. A create-table-if-not-exists is a no-op on a table that already
-- exists, so production keeps the old three-value CHECK until an explicit ALTER runs.
--
-- The paired check below is unaffected and stays exactly as strict: only a posting-driven row may
-- carry a verbatim quote, so an owner row carries none. An owner did not cite the employer.
alter table swap_decision drop constraint if exists swap_decision_driver_check;
alter table swap_decision add constraint swap_decision_driver_check
  check (driver in ('posting','rule','unattributed','owner'));
-- ORDER IS LOAD-BEARING, for the same reason as the check_result unique further down (H34).
-- On a database where these tables ALREADY exist - production, since P1 - 'create table if not
-- exists' is a NO-OP and the inline 'loop' column above is never added. The index on the next line
-- then references a column that does not exist and ABORTS THE WHOLE MIGRATION:
--   ERROR: column "loop" does not exist
-- Measured by executing this file against PostgreSQL 16.13 seeded with 'main''s schema.
alter table swap_decision   add column if not exists loop int not null default 0;
alter table skill_candidate add column if not exists loop int not null default 0;
create index if not exists swap_dec_packet_idx on swap_decision(packet_id, loop, list, seq);

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
  unique (artifact_id, run_id, check_key),
  -- A superset of the key above, existing only so remediation_loop can FOREIGN KEY into it (P3-05).
  -- It makes 'halt_reason='converged'' unforgeable: the loop row can only name a state that a real
  -- check_result row for that exact run already holds.
  unique (artifact_id, run_id, check_key, state)
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

-- P2.3 - the decomposed per-artifact score. Named artifact_score, NOT match_score: that column
-- already exists on opportunity with a different live meaning, and reusing the name is how two
-- numbers come to disagree while looking like one.
--
-- Reconciled against the four scores that already exist, none of which is per-artifact:
--   opportunity.match_score  model fit for the ROLE, NOT posting-grounded, then boosted in place
--   opportunity.base_score   the same number captured before that boost
--   opportunity.ats_score    posting-grounded, from atsScoreOne against the real posting
--   packet.ats_score         packet-level, from jdAnalysis
-- match answers "is this role worth pursuing"; ats_score answers "does the candidate match the
-- posting"; this answers "does THIS DOCUMENT cover this posting's requirements".
--
-- A component with no honest source is NULL and the composite is NULL unless all three exist. A
-- composite built from one of three components is a fabricated number wearing a score's clothes -
-- and it is exactly the number a reviewer would trust most.
create table if not exists artifact_score (
  id             uuid primary key default uuid_generate_v4(),
  artifact_id    uuid not null references artifact(id) on delete cascade,
  run_id         uuid not null,
  must_have_coverage int,
  must_have_source   text,
  keyword_coverage   int,
  keyword_source     text,
  seniority_alignment int,
  seniority_source    text,
  composite      int,
  band           text check (band in ('strong','acceptable','needs_work')),
  uncovered_requirement_ids uuid[] not null default '{}',
  -- The rows the coverage check actually reached a verdict ON, which is NARROWER than the
  -- must-haves: eligibility clauses no merge field can carry, and rows the owner's facts own, are
  -- excluded by "coverable". Without this column the reviewer-agreement calculation assumed every
  -- must-have was judged and scored the excluded ones as agreeing or disagreeing rather than
  -- not_comparable — an accusation-grade number built on rows the engine had no opinion about.
  judged_requirement_ids    uuid[] not null default '{}',
  engine_version int not null,
  weights        jsonb not null,
  computed_at    timestamptz not null default now(),
  -- Every historical score is kept so regenerations are comparable; nothing is overwritten.
  unique (artifact_id, run_id),
  check (composite is null or (must_have_coverage is not null and keyword_coverage is not null and seniority_alignment is not null)),
  check ((band is null) = (composite is null))
);
create index if not exists artifact_score_idx on artifact_score(artifact_id, computed_at desc);

-- P6 - the candidate fact table. Atomic, checkable facts about the OWNER, as opposed to
-- MasterContext, which holds prose blocks (resume summary, work history, about-me). Both are the
-- standing profile; they are not duplicates. MasterContext answers "what do we write"; this answers
-- "what is true", and a requirement like "10+ years" or "must be a U.S. Citizen" can be settled
-- against it deterministically instead of guessed at from document text.
--
-- Measured demand across 7,559 live requirement rows: years-of-experience 511, degree/certification
-- 466, citizenship/work-auth 43, clearance 36, scope 24, onsite/remote 20, travel 14, location 14.
-- Years and degrees alone are 13% of every requirement in the corpus.
--
-- GROWING BY DESIGN. source='proposed' rows are written by the system when a posting asks something
-- no fact answers; the owner confirms or corrects them, which promotes them to 'owner_stated'.
-- confirmed_at null means nobody has vouched for it yet, and an unconfirmed fact must never settle a
-- gate - the same rule as absent evidence being not_applicable rather than pass.
create table if not exists owner_fact (
  id           uuid primary key default uuid_generate_v4(),
  owner_email  text not null,
  key          text not null,        -- stable machine key, e.g. experience.years_total
  label        text not null,        -- human label for the settings screen
  category     text not null check (category in ('identity','eligibility','experience','education','scope','preference')),
  value        text,                 -- canonical string form, always set when known
  value_num    numeric,              -- numeric form when comparable, e.g. 22 for years
  unit         text,                 -- years | usd | people | percent | none
  source       text not null default 'proposed' check (source in ('owner_stated','derived','proposed')),
  evidence     text,                 -- where a derived or proposed value came from
  confirmed_at timestamptz,          -- null = nobody has vouched for it
  updated_at   timestamptz not null default now(),
  unique (owner_email, key),
  -- A confirmed fact must have a value; confirming an empty field asserts nothing.
  check (confirmed_at is null or value is not null)
);
create index if not exists owner_fact_owner_idx on owner_fact(owner_email, category);

-- P4.1 - one blind review of one artifact, per run.
--
-- Joined to check_result by (artifact_id, run_id): the reviewer ATTACHES to the run the
-- deterministic engine already produced, so a run is one set of findings from two engines rather
-- than two runs that have to be reconciled later.
--
-- citations holds only the citations that VERIFIED against the employer's posting text.
-- dropped_citations holds the rest, each with the reason it failed. Both are stored because a
-- model that fabricates quotes is itself a finding, and a drop count that is computed and thrown
-- away is a finding nobody can act on.
--
-- prompt_version is NOT NULL. 0 means no active row existed in the Prompts table and the built-in
-- fallback was used - which prompt_source records explicitly. A null here would be indistinguishable
-- from "we forgot to record it".
create table if not exists review_verdict (
  id            uuid primary key default uuid_generate_v4(),
  artifact_id   uuid not null references artifact(id) on delete cascade,
  run_id        uuid not null,
  grade         text check (grade in ('strong','acceptable','needs_work')),
  seniority_alignment int check (seniority_alignment between 0 and 100),
  agreed        int not null default 0,
  disagreed     int not null default 0,
  reviewer_stricter int[] not null default '{}',
  reviewer_looser   int[] not null default '{}',
  citations         jsonb not null default '[]',
  dropped_citations jsonb not null default '[]',
  critique      text[] not null default '{}',
  reviewer_model text not null,
  prompt_key     text not null,
  prompt_version int not null,
  prompt_source  text not null check (prompt_source in ('prompts_table','builtin')),
  -- False would mean the payload carried generator reasoning. The code throws rather than writing
  -- that row, so this column exists to make the claim auditable in SQL, not to allow the state.
  blind         boolean not null default true,
  -- Which column the posting text came from, and the digest of the exact string the citations were
  -- verified against. A citation is only meaningful against THAT body.
  posting_source text,
  jd_text_sha256 text,
  ran_at        timestamptz not null default now(),
  unique (artifact_id, run_id)
);
create index if not exists review_verdict_artifact_idx on review_verdict(artifact_id, ran_at desc);

-- P3.1 - one row per remediation PASS per ARTIFACT. The loop's ledger.
--
-- GRAIN. Per artifact, because coverage is judged per artifact by evaluateArtifact and "covered in
-- the resume but not the cover letter" is the normal case, not the edge case (decision 16). The
-- pass number is 'n', and it is the SAME number written to insertion.loop and swap_decision.loop -
-- decision 14: one counter, joined to the before/after evidence, not a fourth counter beside two
-- that already disagree.
--
-- P3-05 - 'converged' IS UNFORGEABLE HERE, not by the writer's good intentions:
--   * the CHECK below requires cardinality(remaining) = 0, and
--   * the composite FOREIGN KEY requires a REAL check_result row at (artifact_id, run_id,
--     'evidence_placed', close_state). So close_state cannot be asserted - it can only be copied
--     from a check the engine actually recorded for that exact run.
-- Together: a row may say 'converged' only when nothing was open AND that pass's own PLACEMENT
-- check passed. Not 'not_applicable', not 'warn'. "Converged" is the one word a user trusts
-- without reading anything else.
-- Proven against PostgreSQL 16.13, not asserted: a forged run_id is refused by the FK, converged
-- with a non-empty remaining by check2, binding to must_have_coverage by the close_check_key
-- CHECK, and crediting a close with no edited field by check3. Only the legitimate row stored.
--
-- P3-38 - a JUDGED state sliding to not_applicable is refused in the table. evidence_placed reports
-- its failures as 'warn', so guarding 'fail' alone would have missed the real transition. A run that
-- goes green by turning a judged check into "nothing to check" has removed evidence, not fixed
-- anything.
-- The FK target for remediation_loop below, established HERE and not with the other idempotent
-- alters at the foot of this file. ORDER IS LOAD-BEARING: on a database where check_result already
-- exists (i.e. production, since P2), 'create table remediation_loop' fails outright with
--   ERROR: there is no unique constraint matching given keys for referenced table "check_result"
-- because Postgres requires a UNIQUE on the referenced tuple at CREATE TABLE time. A fresh database
-- gets it from check_result's own inline constraint; an existing one needs it added first, and
-- "first" means before line the create below, not at the end of the script. Nothing in the
-- sandbox can catch this - there is no Postgres here - so it is asserted structurally (H31).
do $$ begin
  alter table check_result add constraint check_result_artifact_run_key_state_key unique (artifact_id, run_id, check_key, state);
exception when duplicate_table or duplicate_object then null; end $$;

create table if not exists remediation_loop (
  id             uuid primary key default uuid_generate_v4(),
  packet_id      uuid not null references packet(id) on delete cascade,
  artifact_id    uuid not null references artifact(id) on delete cascade,
  n              int not null check (n >= 0),
  run_id         uuid not null,
  ran_at         timestamptz not null default now(),
  -- Requirement ids, matching artifact_score.uncovered_requirement_ids' precedent. 'closed' is what
  -- this pass may TAKE CREDIT FOR; 'phantom_closes' is what flipped to covered with no edit of this
  -- pass carrying the evidence - recorded, never credited (P3-11).
  closed         uuid[] not null default '{}',
  phantom_closes uuid[] not null default '{}',
  remaining      uuid[] not null default '{}',
  -- The merge fields this pass genuinely rewrote (after_text <> before_text). A close is only
  -- creditable when this is non-empty, so the two travel together.
  edited_fields  text[] not null default '{}',
  scope_fields   text[] not null default '{}',
  note           text,
  halted         boolean not null default false,
  -- EVERY member of remediation.ts's HaltReason union, and the test that keeps them equal is
  -- H40. They drifted once and the failure was the worst shape available: 'unattributed_coverage'
  -- was added to the union and not here, so at the exact moment the loop CORRECTLY refused to claim
  -- an unattributed convergence, the insert recording that refusal violated this CHECK - the packet
  -- already mutated, no ledger row at all, the phantom escalation never reached, and a 500 to the
  -- caller. A guard that cannot persist its own refusal is not a guard.
  halt_reason    text check (halt_reason in ('converged','no_progress','max_passes','cost_ceiling','token_ceiling','time_budget','no_coverage_evidence','nothing_reachable','unattributed_coverage','ungrounded','error')),
  -- Copied from this run's deterministic evidence_placed check, and FK-verified against it.
  --
  -- RETARGETED from must_have_coverage after P8.3 landed C6. That check is computed purely from
  -- whether the owner's PROFILE evidences a requirement and never reads the generated document, so
  -- no merge-field rewrite can move it and a loop tied to it could never honestly converge.
  -- evidence_placed is the document-side half - 'every requirement your profile evidences is
  -- actually stated in this document' - which is precisely what a rewrite can move.
  close_check_key text not null default 'evidence_placed' check (close_check_key = 'evidence_placed'),
  close_state     text not null check (close_state in ('pass','warn','fail','not_applicable')),
  prev_close_state text check (prev_close_state in ('pass','warn','fail','not_applicable')),
  -- must_have_coverage, recorded for REPORTING only and deliberately NOT part of any constraint
  -- below: the loop cannot move it, so binding convergence to it would make convergence unreachable.
  coverage_state  text check (coverage_state in ('pass','warn','fail','not_applicable')),
  -- Evidence must survive the loop (P3-38). Recorded per pass so db-query can verify it after merge.
  req_count      int not null default 0,
  -- Metering (D8). cost_usd is NULL when any call in the pass ran on an unpriced model - never 0,
  -- which would read as free and would let the cost ceiling pass on an undercount.
  prompt_tokens  int not null default 0,
  completion_tokens int not null default 0,
  cost_usd       numeric(12,8),
  unpriced_calls int not null default 0,
  elapsed_ms     int not null default 0,
  engine_version int not null default 1,
  -- Decision 19 / D-10. 'evaluateArtifact' clears override_by/at/reason on EVERY upsert. That is
  -- deliberate and correct for a MANUAL re-check: an override approves a specific set of findings,
  -- not the artifact forever. A remediation loop re-checks up to four times automatically, so the
  -- same clause would silently discard a human's recorded reason four times inside one run.
  -- The LOOP is the offender, so the loop carries the record: the override standing before this
  -- pass evaluated is copied here before it is cleared. 'evaluateArtifact' itself is untouched -
  -- the standing directive is to default to what is already built, and its behaviour is not a
  -- defect on the path it was written for.
  cleared_override_by     text,
  cleared_override_at     timestamptz,
  cleared_override_reason text,
  -- P3-18. Open requirements the STANDING PROFILE already evidences, judged with the same predicate
  -- as the gate. The backlog's own example: the $18M budget and the 60+ team size were in the work
  -- history and were simply never pulled forward. A pass that fails to close one of these is a
  -- different and more damning finding than 'the candidate does not have it'.
  profile_evidence uuid[] not null default '{}',
  -- P3-24. The Drive file this run superseded. There is no Drive DELETE anywhere in this codebase
  -- (D-9), so every rebuild already orphans a file; recording the id makes the orphan population
  -- MEASURABLE instead of merely growing. Deleting them is a separate owner decision (plan 11-18)
  -- and is deliberately not done here.
  superseded_doc_url text,
  unique (artifact_id, n),
  -- Every CHECK here is NAMED. An anonymous one gets an auto-name like remediation_loop_check4,
  -- which cannot be dropped and re-added idempotently - and an unreplaceable CHECK is one that keeps
  -- its ORIGINAL expression forever on any database that already has the table. Measured: after the
  -- retarget, check4 on an upgraded database still read prev_close_state = 'fail' while a fresh one
  -- read prev_close_state in ('warn','fail'). Since evidence_placed signals failure as 'warn', the
  -- guard was blind to the exact transition it exists to catch, on precisely the databases that
  -- matter. Naming them is what makes the block below possible.
  constraint remediation_loop_override_audit_check
    check ((cleared_override_by is null) = (cleared_override_reason is null)),
  constraint remediation_loop_halt_flag_check check ((halt_reason is null) = (not halted)),
  -- P3-05.
  constraint remediation_loop_converged_check
    check (halt_reason is distinct from 'converged'
           or (cardinality(remaining) = 0 and close_state = 'pass')),
  -- P3-11. A credited close requires an edit; a pass that rewrote nothing may credit nothing.
  constraint remediation_loop_credit_needs_edit_check
    check (cardinality(closed) = 0 or cardinality(edited_fields) > 0),
  -- P3-38. evidence_placed reports its failures as 'warn', not 'fail', so the transition to guard
  -- against is any JUDGED state sliding to not_applicable: that is the evidence disappearing, which
  -- colours like a pass in any UI that treats "no findings" as fine.
  constraint remediation_loop_evidence_intact_check
    check (not (prev_close_state in ('warn','fail') and close_state = 'not_applicable')),
  foreign key (artifact_id, run_id, close_check_key, close_state)
    references check_result (artifact_id, run_id, check_key, state) on delete cascade
);
create index if not exists remediation_loop_packet_idx on remediation_loop(packet_id, n);
create index if not exists remediation_loop_artifact_idx on remediation_loop(artifact_id, n);

-- P3.2 - what the loop could not close, stated as an ask rather than a silent gap.
--
-- A SEPARATE TABLE ON PURPOSE (decision 15). requirement.coverage='escalated' is already set at
-- EXTRACTION and means "the quote could not be located in the posting" - decided before any loop
-- exists. Writing loop-escalations into the same column would make two populations indistinguishable
-- and the coverage denominator would start counting the wrong thing.
--
-- 'detail' must state WHAT WAS SEARCHED and WHY IT COULD NOT BE CLOSED. An escalation that only says
-- "not covered" asks the user to redo the search the loop already did.
--
-- Two resolutions, per the backlog: the user supplies evidence (state -> 'resolved', which reopens
-- the loop) or accepts the gap (state -> 'accepted', and the score keeps reporting it).
create table if not exists escalation (
  id             uuid primary key default uuid_generate_v4(),
  packet_id      uuid not null references packet(id) on delete cascade,
  artifact_id    uuid not null references artifact(id) on delete cascade,
  requirement_id uuid references requirement(id) on delete cascade,
  ats_term_id    uuid,          -- P1.2 term_library_entry; no FK until a library version is published
  state          text not null default 'open' check (state in ('open','resolved','accepted')),
  title          text not null,
  detail         text not null,
  ask            text not null,
  loop           int not null default 0,      -- the pass the loop gave up on
  halt_reason    text,
  resolution_note text,
  resolved_by    text,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- One open escalation per requirement per artifact: the acceptance says an uncoverable
  -- nice-to-have produces EXACTLY ONE open escalation, and a loop that re-runs must update it
  -- rather than stack duplicates.
  unique (artifact_id, requirement_id),
  -- A resolution needs an actor and a time, or it is not a resolution.
  check ((state = 'open') = (resolved_at is null)),
  check ((resolved_at is null) = (resolved_by is null)),
  -- P3-35. Every escalation resolves to the exact object it is about, so the count can deep-link
  -- (R5). A bare title with no target is a dead end for the person being asked to act on it.
  check (requirement_id is not null or ats_term_id is not null)
);
create index if not exists escalation_packet_idx on escalation(packet_id, state);
create index if not exists escalation_artifact_idx on escalation(artifact_id, state);

-- P8.4 -- the posting-vs-profile comparison, one row per dimension per opportunity.
--
-- REGISTERED HERE, not only in an ensure-path (D21 / D1 / H11). The table shipped created solely by
-- ensureDimensionTable (appDimensions.ts), so it worked at runtime while diag/pg-migrate never
-- listed it and H11 could not guard it -- a store that exists in production but not in the
-- migration's completeness report is a gap nothing signals.
--
-- THIS DDL AND ensureDimensionTable's MUST STAY IDENTICAL, and a comment saying so is not what
-- keeps them identical. Every database that ran the ensure-path ALREADY HAS this table, so the
-- create-table-if-not-exists below is SKIPPED there -- exactly the trap that shipped three times in
-- one session. A CHECK that differed between the two paths would therefore be enforced on fresh
-- installs and absent on production, silently and forever. What actually holds them together is
-- H:dimension-ddl-parity in api/test/dimensionsDb.test.mjs, which builds the table BOTH ways
-- against a real cluster and diffs every column, constraint and index the database reports.
--
-- Deliberately NOT interpolated from a shared constant, though that would make drift impossible:
-- SCHEMA_SQL is extracted as RAW SOURCE TEXT by three consumers (api/test/schemaParity.test.mjs,
-- api/test/dimensionsDb.test.mjs, and the local-schema procedure in CLAUDE.md), and a JS
-- interpolation left unexpanded in that text is invalid SQL. Note also that a backtick anywhere in
-- this file's SQL would END the template literal -- writing this comment with backticks in it broke
-- the build once, in this very block. The executed test is the guard; the literal is the contract.
create table if not exists comparison_dimension (
  id              uuid primary key default uuid_generate_v4(),
  opp_id          uuid not null references opportunity(id) on delete cascade,
  dimension_key   text not null,
  label           text not null,
  fit             text not null check (fit in ('strong','moderate','weak','not_applicable')),
  basis           text not null check (basis in ('fact','evidence','none')),
  numeric_verdict text check (numeric_verdict in ('satisfied','not_satisfied','unavailable')),
  shortfall       text check (shortfall in ('nothing_found','falls_short')),
  posting_seq     int,
  posting_text    text,
  posting_quoted  boolean,
  profile_value   text,
  profile_source_label text,
  profile_source  text check (profile_source in ('evidence','fact')),
  note            text,
  reason          text,
  covered         int,
  total           int,
  matched_seqs    int[] not null default '{}',
  set_source      text not null check (set_source in ('owner','seed_family','seed_default')),
  role_family     text not null,
  dimension_version int not null,
  resolved_at     timestamptz not null default now(),
  unique (opp_id, dimension_key),
  -- The acceptance sentence, as a constraint: every moderate/weak grade carries the reason.
  check (fit not in ('moderate','weak') or (note is not null and btrim(note) <> '')),
  -- Its mirror: a row that measured nothing must say which state it was in.
  check (fit <> 'not_applicable' or (reason is not null and btrim(reason) <> '')),
  -- A graded row has a denominator; an ungraded one must not invent one.
  check (fit = 'not_applicable' or (covered is not null and total is not null and total > 0)),
  check (fit <> 'not_applicable' or (covered is null and total is null)),
  -- The posting cell must say whether it is the employer's words or the model's paraphrase.
  check (posting_text is null or posting_quoted is not null)
);
create index if not exists comparison_dimension_opp_idx on comparison_dimension(opp_id);

-- Idempotent multi-tenant column adds (safe on tables that predate them)
-- artifact_score gained judged_requirement_ids AFTER the table shipped, so the inline column in the
-- create above reaches a FRESH database only. On every database that already has artifact_score --
-- which is the one production runs -- "create table if not exists" is skipped and takes the new
-- column with it. Measured: applying this file to a database carrying main's schema left
-- artifact_score with uncovered_requirement_ids and no judged_requirement_ids, exit 0, silently.
-- The ALTER is what actually delivers it. H39/H39b are the general form of this trap.
alter table artifact_score add column if not exists judged_requirement_ids uuid[] not null default '{}';

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
-- P3 idempotent adds (safe on databases created before the remediation loop existed).
--
-- F2. 'remediation_loop' was created by an earlier revision of THIS lane with must_have_* columns,
-- so on any database that ran that revision 'create table if not exists' is a no-op and the rename
-- below never happens: the migration exits 0, reports clean, and the table still has
-- must_have_check_key with the FK bound to it. The first INSERT then fails with
--   ERROR: column "close_state" does not exist
-- This is H39's own class turned on H39's own table - a statement (here, every INSERT the loop
-- makes) depending on a column that is present in the CREATE and unreachable on an existing
-- database. H39c now walks columns that have NO alter at all, which is the case H39b could not see.
--
-- Renames rather than add+drop: the old columns hold the same values under the old names, and a
-- database that ran the earlier revision may already have ledger rows in them.
do $$
declare fk text;
begin
  if exists (select 1 from information_schema.columns
              where table_name='remediation_loop' and column_name='must_have_check_key')
     and not exists (select 1 from information_schema.columns
              where table_name='remediation_loop' and column_name='close_check_key') then
    -- The composite FK is auto-named after its columns, so it cannot be dropped by a literal name
    -- that survives a rename. Find it.
    select conname into fk from pg_constraint
     where conrelid = 'remediation_loop'::regclass and contype = 'f'
       and confrelid = 'check_result'::regclass;
    if fk is not null then execute format('alter table remediation_loop drop constraint %I', fk); end if;
    alter table remediation_loop drop constraint if exists remediation_loop_must_have_check_key_check;

    alter table remediation_loop rename column must_have_check_key to close_check_key;
    alter table remediation_loop rename column must_have_state to close_state;
    alter table remediation_loop rename column prev_must_have_state to prev_close_state;
    alter table remediation_loop alter column close_check_key set default 'evidence_placed';

    -- ROWS WRITTEN UNDER THE OLD CRITERION ARE DELETED, NOT REWRITTEN.
    -- Such a row asserts "converged, because must_have_coverage said pass". Under the retarget that
    -- assertion is meaningless: that check never read the document. Rewriting close_check_key to
    -- 'evidence_placed' would restate a claim the engine never made about a criterion it never
    -- applied - fabricated provenance, which is the one thing this whole lane exists to prevent.
    -- (It also cannot satisfy the FK below: there is no check_result row at that run for the new
    -- key.) Deleting is safe here because the loop is re-runnable and no ledger row means the run is
    -- simply redone from pass 1. remediation_loop has never existed on production - measured
    -- 2026-08-20, db-query 32390257883: p3_tables_present = 0 - so the only rows this can touch are
    -- from a local database that ran an earlier revision of this lane.
    delete from remediation_loop where close_check_key is distinct from 'evidence_placed';

    alter table remediation_loop add constraint remediation_loop_close_check_key_check
      check (close_check_key = 'evidence_placed');
    alter table remediation_loop add constraint remediation_loop_close_fkey
      foreign key (artifact_id, run_id, close_check_key, close_state)
      references check_result (artifact_id, run_id, check_key, state) on delete cascade;
  end if;
end $$;
alter table remediation_loop add column if not exists coverage_state text;
alter table remediation_loop add column if not exists profile_evidence uuid[] not null default '{}';
alter table remediation_loop add column if not exists superseded_doc_url text;
alter table remediation_loop add column if not exists cleared_override_by text;
alter table remediation_loop add column if not exists cleared_override_at timestamptz;
alter table remediation_loop add column if not exists cleared_override_reason text;

-- EVERY MUTABLE CHECK ON remediation_loop IS REPLACED HERE, not just the one that bit us.
--
-- F1 and F2 compose, and the composition is the lesson: correcting a CHECK inside
-- 'create table if not exists' fixes a FRESH database only. On one that already ran an earlier
-- revision the create is skipped and the old expression survives - while the source-reading guard
-- passes, because it reads the source. Three separate constraints on this one table were caught
-- this way, the third only by executing the migration:
--   halt_reason        kept 10 members, so the loop could not persist its own refusal
--   close_check_key    stayed bound to must_have_coverage
--   check4             stayed 'prev = fail', blind to 'warn' - which is how evidence_placed
--                      reports failure, so the evidence-removal guard was off on exactly the
--                      databases it protects
-- Replacing all of them, unconditionally and idempotently, removes the class rather than the
-- instances. The table is new to this lane and small; there is no reason to be selective.
do $$ begin
  -- close_check_key's CHECK is also re-added by the rename block above, but that block is
  -- CONDITIONAL on the old must_have_* columns existing. A database created by the revision that
  -- already had close_check_key skips it entirely and would keep whatever expression it was born
  -- with. Unconditional here, like every other one.
  alter table remediation_loop drop constraint if exists remediation_loop_close_check_key_check;
  alter table remediation_loop add constraint remediation_loop_close_check_key_check
    check (close_check_key = 'evidence_placed');

  alter table remediation_loop drop constraint if exists remediation_loop_halt_reason_check;
  alter table remediation_loop add constraint remediation_loop_halt_reason_check
    check (halt_reason in ('converged','no_progress','max_passes','cost_ceiling','token_ceiling',
                           'time_budget','no_coverage_evidence','nothing_reachable',
                           'unattributed_coverage','ungrounded','error'));

  alter table remediation_loop drop constraint if exists remediation_loop_halt_flag_check;
  alter table remediation_loop add constraint remediation_loop_halt_flag_check
    check ((halt_reason is null) = (not halted));

  alter table remediation_loop drop constraint if exists remediation_loop_converged_check;
  alter table remediation_loop add constraint remediation_loop_converged_check
    check (halt_reason is distinct from 'converged'
           or (cardinality(remaining) = 0 and close_state = 'pass'));

  alter table remediation_loop drop constraint if exists remediation_loop_credit_needs_edit_check;
  alter table remediation_loop add constraint remediation_loop_credit_needs_edit_check
    check (cardinality(closed) = 0 or cardinality(edited_fields) > 0);

  alter table remediation_loop drop constraint if exists remediation_loop_evidence_intact_check;
  alter table remediation_loop add constraint remediation_loop_evidence_intact_check
    check (not (prev_close_state in ('warn','fail') and close_state = 'not_applicable'));

  alter table remediation_loop drop constraint if exists remediation_loop_override_audit_check;
  alter table remediation_loop add constraint remediation_loop_override_audit_check
    check ((cleared_override_by is null) = (cleared_override_reason is null));

  -- The auto-named survivors from the pre-naming revision, dropped so they cannot linger beside
  -- their named replacements enforcing a stale expression.
  alter table remediation_loop drop constraint if exists remediation_loop_check2;
  alter table remediation_loop drop constraint if exists remediation_loop_check3;
  alter table remediation_loop drop constraint if exists remediation_loop_check4;
  alter table remediation_loop drop constraint if exists remediation_loop_check5;
  -- check1 is the anonymous halt-flag CHECK from the pre-naming revision, and the anonymous
  -- override-audit one sits beside it. Same expressions as their named replacements, so harmless in
  -- effect - but a duplicate constraint is a second thing to keep in step, and the whole point of
  -- this block is that an upgraded database ends up enforcing EXACTLY what a fresh one does.
  alter table remediation_loop drop constraint if exists remediation_loop_check1;
  alter table remediation_loop drop constraint if exists remediation_loop_check;
  alter table remediation_loop drop constraint if exists remediation_loop_must_have_state_check;
  alter table remediation_loop drop constraint if exists remediation_loop_prev_must_have_state_check;
  -- DROP BEFORE ADD, even for these two. A bare 'add constraint' on a database where the name
  -- already exists raises duplicate_object, which - with a WHEN handler on the block - aborts every
  -- REMAINING statement silently. That is exactly what happened: on the path where the table was
  -- created after the rename, these two already existed, the block died here, and halt_reason was
  -- never replaced. The migration exited 0 the whole time. An exception handler that hides the rest
  -- of its block is the absent-evidence-reads-as-success shape, in PL/pgSQL.
  alter table remediation_loop drop constraint if exists remediation_loop_close_state_check;
  alter table remediation_loop add constraint remediation_loop_close_state_check
    check (close_state in ('pass','warn','fail','not_applicable'));
  alter table remediation_loop drop constraint if exists remediation_loop_prev_close_state_check;
  alter table remediation_loop add constraint remediation_loop_prev_close_state_check
    check (prev_close_state in ('pass','warn','fail','not_applicable'));
  -- coverage_state arrives by ALTER, and an ALTER adding a bare 'text' column carries no CHECK. A
  -- fresh database got the enum from the CREATE and an upgraded one had none at all - the two
  -- enforcing different rules, which is the exact condition this block exists to eliminate.
  alter table remediation_loop drop constraint if exists remediation_loop_coverage_state_check;
  alter table remediation_loop add constraint remediation_loop_coverage_state_check
    check (coverage_state in ('pass','warn','fail','not_applicable'));
-- ONLY undefined_table is swallowed - the legitimate case of running this file before the table
-- exists. 'duplicate_object' was in this list and it silently ate the rest of the block; every
-- statement above now drops before it adds, so it cannot arise, and if anything else goes wrong the
-- migration must FAIL LOUDLY rather than leave half the constraints stale.
exception when undefined_table then null; end $$;
alter table requirement     drop column if exists closed_on_loop;
-- The old 3-column unique is what made pass 2 overwrite pass 1; replace it with the loop-aware one.
alter table swap_decision   drop constraint if exists swap_decision_packet_id_list_seq_key;
do $$ begin
  alter table swap_decision add constraint swap_decision_packet_list_seq_loop_key unique (packet_id, list, seq, loop);
exception when duplicate_table or duplicate_object then null; end $$;
alter table packet         add column if not exists must_haves text[];
alter table packet         add column if not exists jd_grounded boolean;
alter table packet         add column if not exists jd_analyzed_at timestamptz;
-- The last build's OUTCOME, so a diagnosis does not live only in an HTTP response.
--
-- build-all takes about three minutes of real work and the gateway gives up at four, so the
-- response carrying "warnings" and the discarded-section list is routinely lost (D35: measured
-- twice, most recently run 32546312184, where every artifact finished at 02:31:50 and the 504 fired
-- at 02:31:51). Two open findings — D31's unparseable Call 2 and D33's 7,446 discarded characters —
-- are stuck precisely because the evidence for them was only ever in that response. Persisting it
-- turns "we cannot see what happened" into a row anyone can query afterwards.
alter table packet         add column if not exists last_build jsonb;

-- PER-PACKET RESUME TEMPLATE (2026-08-24). The owner has more than one resume - a regular one, a
-- compact one, and different ones per role - and until now the product had exactly one
-- google.resumeTemplateId for all of them, so "use the Product resume for this opportunity" could
-- not be expressed at all.
--
-- It is a COLUMN rather than a new table because the collection already exists: AppConfig partition
-- templates holds one resume-<driveId> row per resume template, each carrying its own
-- roleFocus and (since today) a label. What was missing was only the per-packet CHOICE, and a
-- choice is one value.
--
-- NULL means "use the owner's configured default", which is what every existing packet means, so
-- this migration changes no behaviour for anything already built.
--
-- Choosing the resume also chooses the PERSONA, and that is deliberate rather than incidental: the
-- owner's ruling is *"let the resume chosen drive the persona"*, and resolveRoleFocus already
-- takes the resume template id as its highest-priority source. So this one column feeds both the
-- document that gets copied AND the focus word every generation prompt is prefixed with, with no
-- second setting to keep in sync.
alter table packet         add column if not exists resume_template_id text;

alter table library_entity add column if not exists owner_email text not null default 'demo@executive-engine.local';
alter table library_entity add column if not exists is_demo boolean not null default false;
create index if not exists opp_owner_idx2 on opportunity(owner_email);

-- D35 — the build queue, because a three-minute request cannot survive a four-minute gateway.
--
-- packet/build-all does ~3 minutes of real work (four artifacts, several model calls each, plus
-- Google Docs writes) and the gateway gives up at 4. Measured: run 32546312184 returned 504 one
-- second AFTER the last artifact landed, and run 32548283352 returned 502, while /api/health was
-- fine throughout. The work completes; only the answer is lost. That also blocks D31 and D33, whose
-- evidence only ever existed in that response.
--
-- One row per requested build. The POST creates it and returns immediately; a timer claims and runs
-- it. state is the whole contract: a caller must be able to tell not started from running from
-- failed, and a job that dies mid-build must be reclaimable rather than wedged in running
-- forever, which is what claimed_at and attempts are for.
create table if not exists packet_build_job (
  id           uuid primary key default uuid_generate_v4(),
  opp_id       uuid not null references opportunity(id) on delete cascade,
  owner_email  text not null,
  regen        boolean not null default false,
  state        text not null default 'pending' check (state in ('pending','running','done','failed')),
  attempts     int not null default 0,
  claimed_at   timestamptz,
  finished_at  timestamptz,
  result       jsonb,
  error        text,
  created_at   timestamptz not null default now()
);
-- The claim order. state first because every claim filters on it.
create index if not exists pbj_claim_idx on packet_build_job(state, created_at);
-- One build in flight per opportunity. Without this an impatient double-click queues two builds of
-- the same packet, and they would race each other writing the same artifacts and spend the model
-- budget twice. Partial, so finished jobs do not block the next request.
create unique index if not exists pbj_one_live_per_opp
  on packet_build_job(opp_id) where state in ('pending','running');

-- P8.3 escalation tier — a third provenance for an evidence row.
--
-- method was constrained to ('exact','anchored'), both produced by the deterministic resolver. The
-- escalation tier adds rows a MODEL proposed and an exact substring check then accepted, and those
-- must be distinguishable from the rows a rule settled on its own — otherwise a reader a month
-- later cannot tell which claims carry model judgement, and neither can a query.
--
-- The constraint is what makes this safe rather than decorative: writing a model row as 'exact'
-- would be the loosening this whole subsystem exists to prevent, and the CHECK refuses any value
-- that is not one of the three. Verified by execution against a POPULATED database carrying main's
-- schema (2026-08-21): 'proposed' + proposal_version inserted, a deterministic 'exact' row inserted
-- unchanged with proposal_version null, and a bogus 'guessed' REFUSED by this constraint.
--
-- DROP-THEN-ADD, in that order, per this file's own rule: "add constraint" is not idempotent, and
-- an already-present old constraint would otherwise abort the migration or be silently swallowed.
alter table requirement_evidence drop constraint if exists requirement_evidence_method_check;
do $$ begin
  alter table requirement_evidence add constraint requirement_evidence_method_check
    check (method in ('exact','anchored','proposed'));
exception when undefined_table then null; end $$;
-- NULL means no model was involved, which is what every existing row means and why the column is
-- nullable rather than defaulted. A default would backfill 1 onto 'exact' rows and assert model
-- provenance for work a rule did alone.
alter table requirement_evidence add column if not exists proposal_version int;
-- The model's one-sentence justification. The extra column is SPEC 4.1's supporting note and is the right
-- home for it — it is prose about the quote, never a second quote — so no column is added for it.
`;

// Tables we expect to exist after migration (used by the runner to report).
export const EXPECTED_TABLES = [
  'correction',
  'persona', 'opportunity', 'contact', 'packet', 'artifact', 'outreach_message',
  'interview', 'offer', 'library_entity', 'asset_event', 'usage_metering',
  'term_library', 'term_library_entry', 'term_candidate', 'requirement',
  'skill_candidate', 'swap_decision', 'insertion', 'check_result', 'artifact_gate', 'artifact_score', 'owner_fact', 'review_verdict',
  'remediation_loop', 'escalation', 'requirement_evidence', 'comparison_dimension',
  'packet_build_job', 'evidence_confirmation'
]
