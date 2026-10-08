alter table todo_work_hours
  add column if not exists returned_at timestamptz;
