-- Allow a subset of work-hour entries to be submitted and accepted independently.
alter table todo_work_hours drop constraint if exists todo_work_hours_status_check;
alter table todo_work_hours add constraint todo_work_hours_status_check
  check (status in ('pending', 'submitted', 'confirmed'));
