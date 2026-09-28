-- Reference migration for installations that apply versioned SQL separately.
-- server/schema.ts contains the idempotent bootstrap equivalent.
update todos
   set estimated_work_minutes = ceil(estimated_work_minutes::numeric / 60)::integer * 60
 where estimated_work_minutes is not null
   and estimated_work_minutes > 0
   and estimated_work_minutes % 60 <> 0;

update todo_work_hours
   set minutes = ceil(minutes::numeric / 60)::integer * 60,
       updated_at = now()
 where minutes > 0
   and minutes % 60 <> 0;

alter table todos drop constraint if exists todos_estimated_work_minutes_check;
alter table todos add constraint todos_estimated_work_minutes_check
  check (estimated_work_minutes is null or (estimated_work_minutes > 0 and estimated_work_minutes <= 525600 and estimated_work_minutes % 60 = 0));

alter table todo_work_hours drop constraint if exists todo_work_hours_minutes_check;
alter table todo_work_hours add constraint todo_work_hours_minutes_check
  check (minutes > 0 and minutes <= 1440 and minutes % 60 = 0);

alter table todo_activity_events drop constraint if exists todo_activity_events_event_type_check;
alter table todo_activity_events add constraint todo_activity_events_event_type_check
  check (event_type in ('created', 'updated', 'completed', 'reopened', 'assigned', 'confirmed', 'rejected', 'acceptance_failed', 'work_hours_added', 'work_hours_updated', 'work_hours_deleted', 'work_hours_submitted'));
