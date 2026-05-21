export const schemaSql = `
create table if not exists users (
  id bigserial primary key,
  email text not null unique,
  display_name text not null default '',
  password_hash text not null default '',
  created_at timestamptz not null default now()
);

alter table users add column if not exists display_name text not null default '';

create table if not exists ai_settings (
  user_id bigint primary key references users(id) on delete cascade,
  base_url text not null default '',
  api_key text not null default '',
  model text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists projects (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists journal_entries (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists todos (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  title text not null,
  due_date date not null,
  priority text not null default 'medium',
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists collaborators (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  project_id bigint not null references projects(id) on delete cascade,
  name text not null,
  role text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table todos
  add column if not exists collaborator_id bigint references collaborators(id) on delete set null;

create table if not exists risks (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  content text not null,
  journal_entry_id bigint references journal_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, content)
);

create table if not exists draft_items (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  source text not null default 'manual',
  content text not null,
  suggested_project_id bigint references projects(id) on delete set null,
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists summaries (
  id bigserial primary key,
  user_id bigint references users(id) on delete cascade,
  project_id bigint not null references projects(id) on delete cascade,
  type text not null,
  title text not null,
  period text not null,
  content text not null,
  created_at timestamptz not null default now()
);

alter table summaries
  add column if not exists user_id bigint references users(id) on delete cascade;

update summaries
set user_id = projects.user_id
from projects
where summaries.project_id = projects.id
  and summaries.user_id is null;

update summaries
set user_id = projects.user_id,
    project_id = null,
    period = '飞书对话分析'
from projects
where summaries.project_id = projects.id
  and projects.name = '飞书对话分析'
  and projects.tags @> array['飞书', '对话分析']::text[];

alter table summaries
  alter column project_id drop not null;

delete from projects
where projects.name = '飞书对话分析'
  and projects.tags @> array['飞书', '对话分析']::text[]
  and not exists (select 1 from todos where todos.project_id = projects.id)
  and not exists (select 1 from collaborators where collaborators.project_id = projects.id)
  and not exists (select 1 from risks where risks.project_id = projects.id)
  and not exists (
    select 1
    from journal_entries
    where journal_entries.project_id = projects.id
      and journal_entries.content <> '用于保存从飞书转发的群聊对话分析结果。'
  );

create index if not exists idx_projects_user_id on projects(user_id);
create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_sessions_expires_at on sessions(expires_at);
create index if not exists idx_journal_entries_project_id on journal_entries(project_id);
create index if not exists idx_todos_project_id on todos(project_id);
create index if not exists idx_todos_collaborator_id on todos(collaborator_id);
create index if not exists idx_collaborators_user_id on collaborators(user_id);
create index if not exists idx_collaborators_project_id on collaborators(project_id);
create index if not exists idx_risks_project_id on risks(project_id);
create index if not exists idx_draft_items_user_id on draft_items(user_id);
create index if not exists idx_summaries_user_id on summaries(user_id);
create index if not exists idx_summaries_project_id on summaries(project_id);
`
