\set ON_ERROR_STOP 0
-- a real artifact to hang the corrections off
insert into opportunity (id, owner_email, company, role)
  values ('11111111-1111-1111-1111-111111111111','v@e.io','Trinnex','Director') on conflict do nothing;
insert into packet (id, opp_id) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111') on conflict do nothing;
insert into artifact (id, packet_id, type) values ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222','resume') on conflict do nothing;

\echo '--- 1. LEGITIMATE row (must succeed) ---'
insert into correction (artifact_id, merge_field, phrase, replacement, char_start, char_end, before_sha256, applied_seq, reason, source)
values ('33333333-3333-3333-3333-333333333333','ResumeSummary','$18M','8-figure',10,14,repeat('a',64),1,'posting states it; profile does not','generalized');

\echo '--- 2. span does NOT match phrase length (the undo would splice the wrong bytes) ---'
insert into correction (artifact_id, merge_field, phrase, replacement, char_start, char_end, before_sha256, applied_seq, reason, source)
values ('33333333-3333-3333-3333-333333333333','ResumeSummary','$18M','8-figure',10,15,repeat('a',64),2,'r','generalized');

\echo '--- 3. no before_sha256 shape (a stale offset becomes undetectable) ---'
insert into correction (artifact_id, merge_field, phrase, replacement, char_start, char_end, before_sha256, applied_seq, reason, source)
values ('33333333-3333-3333-3333-333333333333','ResumeSummary','60+','multiple',30,33,'not-a-hash',3,'r','generalized');

\echo '--- 4. reverted_by without reverted_at (a half-recorded undo) ---'
insert into correction (artifact_id, merge_field, phrase, replacement, char_start, char_end, before_sha256, applied_seq, reason, source, reverted_by)
values ('33333333-3333-3333-3333-333333333333','ResumeSummary','60+','multiple',30,33,repeat('b',64),4,'r','generalized','v@e.io');

\echo '--- 5. unknown source (a correction whose origin nothing can state) ---'
insert into correction (artifact_id, merge_field, phrase, replacement, char_start, char_end, before_sha256, applied_seq, reason, source)
values ('33333333-3333-3333-3333-333333333333','ResumeSummary','60+','62',30,33,repeat('b',64),5,'r','guessed');

\echo '--- 6. duplicate (artifact, field, seq, run) — a re-run must not double-log ---'
insert into correction (artifact_id, merge_field, phrase, replacement, char_start, char_end, before_sha256, applied_seq, reason, source)
values ('33333333-3333-3333-3333-333333333333','ResumeSummary','$18M','8-figure',10,14,repeat('a',64),1,'again','generalized');

\echo '--- 7. orphan artifact (a correction with nothing to correct) ---'
insert into correction (artifact_id, merge_field, phrase, replacement, char_start, char_end, before_sha256, applied_seq, reason, source)
values ('99999999-9999-9999-9999-999999999999','ResumeSummary','$18M','8-figure',10,14,repeat('a',64),9,'r','generalized');

\echo '--- rows that survived (must be exactly 1) ---'
select count(*) as survived from correction;
