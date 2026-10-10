-- Apply only to an explicitly approved database.
-- Project supplemental work hours remain separate from todo_work_hours so Bug
-- effort never enters the todo lifecycle or task-level estimates.
create table if not exists project_work_hours (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  test_bug_id bigint references test_bugs(id) on delete set null,
  user_id bigint not null references users(id) on delete cascade,
  work_date date not null,
  minutes integer not null,
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'confirmed')),
  returned_at timestamptz,
  description text not null default '',
  confirmed_by_user_id bigint references users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (minutes > 0 and minutes <= 1440 and minutes % 60 = 0)
);

create index if not exists idx_project_work_hours_user_date
  on project_work_hours(user_id, work_date, status);
create index if not exists idx_project_work_hours_project_date
  on project_work_hours(project_id, work_date, status);
create index if not exists idx_project_work_hours_bug
  on project_work_hours(test_bug_id, created_at desc)
  where test_bug_id is not null;
