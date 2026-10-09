begin;

alter table test_bugs
  add column if not exists verifier_user_id bigint references users(id) on delete set null;

update test_bugs bug
set verifier_user_id = bug.reporter_user_id
where bug.verifier_user_id is null
  and bug.reporter_user_id is not null
  and exists (
    select 1
    from users u
    join user_roles role on role.user_id = u.id and role.role in ('tester', 'organization_admin')
    join test_space_memberships membership
      on membership.user_id = u.id and membership.test_space_id = bug.test_space_id
     and membership.status = 'active' and membership.access_level in ('owner', 'editor')
    where u.id = bug.reporter_user_id and u.account_status = 'active'
  );

create index if not exists idx_test_bugs_verifier_id
  on test_bugs(verifier_user_id, status, updated_at desc);

alter table test_bug_events
  add column if not exists previous_verifier_user_id bigint references users(id) on delete set null,
  add column if not exists next_verifier_user_id bigint references users(id) on delete set null;

alter table test_bug_events
  drop constraint if exists test_bug_events_event_type_check;

alter table test_bug_events
  add constraint test_bug_events_event_type_check
  check (event_type in ('created', 'assigned', 'transferred', 'verifier_transferred', 'status_changed', 'space_transferred'));

commit;
