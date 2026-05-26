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

alter table projects
  add column if not exists tags_encrypted text;

update projects
set tags_encrypted = array_to_json(tags)::text
where tags_encrypted is null;

create table if not exists project_memberships (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  owner_user_id bigint not null references users(id) on delete cascade,
  invited_user_id bigint references users(id) on delete cascade,
  invited_email text not null,
  invited_email_lookup text,
  role text not null default 'member',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (project_id, invited_email)
);

alter table project_memberships
  add column if not exists invited_email_lookup text;

create table if not exists journal_entries (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

alter table journal_entries
  add column if not exists author_user_id bigint references users(id) on delete set null,
  add column if not exists visibility text not null default 'private';

update journal_entries
set author_user_id = projects.user_id
from projects
where journal_entries.project_id = projects.id
  and journal_entries.author_user_id is null;

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
  name_lookup text,
  role text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table collaborators
  add column if not exists name_lookup text;

alter table todos
  add column if not exists collaborator_id bigint references collaborators(id) on delete set null;

alter table todos
  add column if not exists created_by_user_id bigint references users(id) on delete set null;

update todos
set created_by_user_id = projects.user_id
from projects
where todos.project_id = projects.id
  and todos.created_by_user_id is null;

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

alter table summaries
  alter column project_id drop not null;

create index if not exists idx_projects_user_id on projects(user_id);
create index if not exists idx_project_memberships_project_id on project_memberships(project_id);
create index if not exists idx_project_memberships_owner_user_id on project_memberships(owner_user_id);
create index if not exists idx_project_memberships_invited_user_id on project_memberships(invited_user_id);
create index if not exists idx_project_memberships_invited_email on project_memberships(invited_email);
create index if not exists idx_project_memberships_invited_email_lookup on project_memberships(invited_email_lookup);
create unique index if not exists idx_project_memberships_project_email_lookup
  on project_memberships(project_id, invited_email_lookup)
  where invited_email_lookup is not null;
create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_sessions_expires_at on sessions(expires_at);
create index if not exists idx_journal_entries_project_id on journal_entries(project_id);
create index if not exists idx_journal_entries_author_user_id on journal_entries(author_user_id);
create index if not exists idx_todos_project_id on todos(project_id);
create index if not exists idx_todos_collaborator_id on todos(collaborator_id);
create index if not exists idx_todos_created_by_user_id on todos(created_by_user_id);
create index if not exists idx_collaborators_user_id on collaborators(user_id);
create index if not exists idx_collaborators_project_id on collaborators(project_id);
create index if not exists idx_collaborators_name_lookup on collaborators(user_id, name_lookup);
create index if not exists idx_risks_project_id on risks(project_id);
create index if not exists idx_draft_items_user_id on draft_items(user_id);
create index if not exists idx_summaries_user_id on summaries(user_id);
create index if not exists idx_summaries_project_id on summaries(project_id);
`
