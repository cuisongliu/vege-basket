begin;

alter table todos
  add column if not exists todo_status text not null default 'open',
  add column if not exists discard_reason text,
  add column if not exists discarded_by_user_id bigint references users(id) on delete set null,
  add column if not exists discarded_at timestamptz;

update todos
   set todo_status = case when done then 'completed' else 'open' end
 where todo_status = 'open' and done = true;

alter table todos drop constraint if exists todos_todo_status_check;
alter table todos add constraint todos_todo_status_check
  check (todo_status in ('open', 'completed', 'discarded'));

update todos todo
   set confirmation_status = 'confirmed',
       submitted_at = null,
       needs_revision = false
  from projects project
 where project.id = todo.project_id
   and project.organization_id is null
   and todo.confirmation_status in ('pending_review', 'rejected', 'acceptance_failed');

alter table todo_activity_events drop constraint if exists todo_activity_events_event_type_check;
alter table todo_activity_events add constraint todo_activity_events_event_type_check
  check (event_type in ('created', 'updated', 'completed', 'reopened', 'discarded', 'assigned', 'confirmed', 'rejected', 'acceptance_failed', 'work_hours_added', 'work_hours_updated', 'work_hours_deleted', 'work_hours_submitted'));

commit;
