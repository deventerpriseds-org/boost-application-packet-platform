-- P8.1 / R1 — the correction ledger. Every row must be able to fund its own undo.
create table if not exists correction (
  id            uuid primary key default uuid_generate_v4(),
  artifact_id   uuid not null references artifact(id) on delete cascade,
  run_id        uuid,
  loop          int,
  merge_field   text not null,
  phrase        text not null,
  replacement   text not null,
  char_start    int  not null,
  char_end      int  not null,
  before_sha256 text not null,
  applied_seq   int  not null,
  reason        text not null,
  source        text not null,
  frame         text,
  reverted_by   text,
  reverted_at   timestamptz,
  created_at    timestamptz not null default now(),

  -- AC-9: a row that cannot fund its own undo must not exist. The constraint lives in the table,
  -- not in a writer's good intentions — every writer is one refactor away from forgetting.
  constraint correction_span_matches_phrase check (char_end - char_start = length(phrase)),
  constraint correction_span_sane           check (char_start >= 0 and char_end > char_start),
  constraint correction_phrase_nonempty     check (length(phrase) > 0),
  constraint correction_sha_shaped          check (before_sha256 ~ '^[0-9a-f]{64}$'),
  -- Kept in lockstep with schema.ts and appCorrections.ts. A fixture whose domain is NARROWER than
  -- production tests a schema nobody runs, and would have passed every assertion below while the
  -- real table rejected the value. H:correction-ddl-parity holds the three copies together.
  constraint correction_source_known        check (source in ('profile_figure','generalized','owner_edit')),
  constraint correction_frame_check         check (frame is null or frame in ('original','applied')),
  -- AC-12: a revert is recorded, never a DELETE. Both columns move together or neither does.
  constraint correction_revert_paired       check ((reverted_by is null) = (reverted_at is null)),
  -- AC-10: a substituted figure must carry its provenance, or it is a guess wearing a citation.
  constraint correction_profile_provenance  check (
    source <> 'profile_figure' or (reason is not null and length(reason) > 0)),
  -- AC-4: re-running a pass must not duplicate a row.
  --
  -- NULLS NOT DISTINCT is load-bearing and was not there first. A plain UNIQUE treats every NULL as
  -- distinct, so with run_id NULL — which is every correction applied outside a remediation loop,
  -- i.e. the common case — the constraint silently permits unlimited duplicates. It reads as
  -- correct; only executing it says otherwise. Measured on PG 16.13: probe 6 inserted a byte-exact
  -- duplicate of probe 1 and the table held 2 rows where it should have held 1.
  unique nulls not distinct (artifact_id, merge_field, applied_seq, run_id)
);
create index if not exists correction_artifact_idx on correction(artifact_id) where reverted_at is null;
