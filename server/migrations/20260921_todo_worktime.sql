-- Reference migration for installations that apply versioned SQL separately.
-- server/schema.ts contains the idempotent bootstrap equivalent.
alter table todos
  add column if not exists estimated_work_minutes integer,
  add column if not exists needs_revision boolean not null default false,
  add column if not exists rejection_reason text,
  add column if not exists submitted_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by_user_id bigint references users(id) on delete set null,
  add column if not exists acceptance_version integer not null default 0;

alter table todos drop constraint if exists todos_estimated_work_minutes_check;
alter table todos add constraint todos_estimated_work_minutes_check
  check (estimated_work_minutes is null or (estimated_work_minutes > 0 and estimated_work_minutes <= 525600 and estimated_work_minutes % 15 = 0));

create unique index if not exists idx_todos_id_project_id_unique on todos(id, project_id);

create table if not exists todo_work_hours (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  todo_id bigint not null,
  user_id bigint not null references users(id) on delete cascade,
  work_date date not null,
  minutes integer not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  description text not null default '',
  confirmed_by_user_id bigint references users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (minutes > 0 and minutes <= 1440 and minutes % 15 = 0),
  foreign key (todo_id, project_id) references todos(id, project_id) on delete cascade
);

create index if not exists idx_todo_work_hours_user_date on todo_work_hours(user_id, work_date, status);
create index if not exists idx_todo_work_hours_project_date on todo_work_hours(project_id, work_date, status);
create index if not exists idx_todo_work_hours_todo on todo_work_hours(todo_id, created_at desc);
