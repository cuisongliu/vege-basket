export const schemaSql = `
create table if not exists users (
  id bigserial primary key,
  email text not null unique,
  display_name text not null default '',
  password_hash text not null default '',
  created_at timestamptz not null default now()
);

alter table users add column if not exists display_name text not null default '';
alter table users add column if not exists feishu_user_id text not null default '';
alter table users add column if not exists feishu_receive_id_type text not null default 'user_id';
alter table users add column if not exists feishu_email text not null default '';

update users
set feishu_email = feishu_user_id
where feishu_email = ''
  and feishu_user_id like '%@%';

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

alter table projects
  add column if not exists description_encrypted text;

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
  declined_at timestamptz,
  unique (project_id, invited_email)
);

alter table project_memberships
  add column if not exists invited_email_lookup text;

alter table project_memberships
  add column if not exists declined_at timestamptz;

create table if not exists project_invite_links (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  owner_user_id bigint not null references users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

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
  detail text not null default '',
  due_date date not null,
  priority text not null default 'medium',
  done boolean not null default false,
  confirmation_status text not null default 'confirmed'
    check (confirmation_status in ('confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_modules (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now(),
  unique (project_id, name)
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

alter table todos
  add column if not exists detail text not null default '';

alter table todos
  add column if not exists assignee_user_id bigint references users(id) on delete set null,
  add column if not exists assigned_by_user_id bigint references users(id) on delete set null,
  add column if not exists assigned_at timestamptz;

alter table todos
  add column if not exists project_module_id bigint references project_modules(id) on delete set null;

alter table todos
  add column if not exists confirmation_status text not null default 'confirmed';

alter table todos
  drop constraint if exists todos_confirmation_status_check;

alter table todos
  add constraint todos_confirmation_status_check
  check (confirmation_status in ('confirmed', 'rejected'));

alter table todos
  drop column if exists confirmed;

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

create table if not exists notification_states (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  kind text not null,
  source_id bigint not null,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, source_id)
);

create table if not exists project_integrations (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  provider text not null,
  target_type text not null,
  target_id text not null default '',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, provider, target_type)
);

create table if not exists notification_deliveries (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  kind text not null,
  source_id bigint not null,
  channel text not null,
  target_type text not null,
  target_id text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text not null default '',
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, source_id, channel, target_type, target_id)
);

create table if not exists project_package_events (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  type text not null default 'upgrade',
  status text not null default 'draft',
  title text not null,
  created_by_user_id bigint references users(id) on delete set null,
  assignee_user_id bigint references users(id) on delete set null,
  assigned_by_user_id bigint references users(id) on delete set null,
  assigned_at timestamptz,
  delivery_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table project_package_events
  add column if not exists status text not null default 'draft';

alter table project_package_events
  alter column status set default 'draft';

alter table project_package_events
  add column if not exists assignee_user_id bigint references users(id) on delete set null,
  add column if not exists assigned_by_user_id bigint references users(id) on delete set null,
  add column if not exists assigned_at timestamptz;

alter table project_package_events
  add column if not exists delivery_date date not null default current_date;

create index if not exists idx_project_package_events_assignee
  on project_package_events (assignee_user_id, created_at desc);

create table if not exists project_package_groups (
  id bigserial primary key,
  project_package_event_id bigint not null references project_package_events(id) on delete cascade,
  package_name text not null,
  created_at timestamptz not null default now(),
  unique (project_package_event_id, package_name)
);

create table if not exists project_package_items (
  id bigserial primary key,
  project_package_group_id bigint not null references project_package_groups(id) on delete cascade,
  source_package_id text not null default '',
  source_package_name text not null default '',
  channel text not null default 'release',
  channel_label text not null default '',
  arch text not null default 'amd64',
  version text not null default '',
  object_key text not null default '',
  object_last_modified timestamptz,
  size_bytes bigint,
  created_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists project_package_operations (
  id bigserial primary key,
  project_package_event_id bigint not null references project_package_events(id) on delete cascade,
  project_package_group_id bigint references project_package_groups(id) on delete cascade,
  kind text not null default 'document',
  status text not null default 'pending',
  title text not null default '',
  label text not null default '',
  content text not null default '',
  completed boolean not null default false,
  auto_generated boolean not null default false,
  created_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table project_package_operations
  add column if not exists completed boolean not null default false;

alter table project_package_operations
  add column if not exists status text not null default 'pending';

create table if not exists project_package_operation_todos (
  project_package_operation_id bigint not null references project_package_operations(id) on delete cascade,
  todo_id bigint not null references todos(id) on delete cascade,
  note text not null default '',
  note_author_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_package_operation_id, todo_id)
);

alter table project_package_operation_todos
  add column if not exists note text not null default '';

alter table project_package_operation_todos
  add column if not exists note_author_user_id bigint references users(id) on delete set null;

create table if not exists todo_notes (
  id bigserial primary key,
  todo_id bigint not null references todos(id) on delete cascade,
  author_user_id bigint references users(id) on delete set null,
  content text not null default '',
  source_operation_id bigint references project_package_operations(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_todo_notes_source_operation_unique
  on todo_notes(todo_id, source_operation_id)
  where source_operation_id is not null;

create table if not exists todo_note_mentions (
  id bigserial primary key,
  todo_note_id bigint not null references todo_notes(id) on delete cascade,
  mentioned_user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (todo_note_id, mentioned_user_id)
);

create index if not exists idx_projects_user_id on projects(user_id);
create index if not exists idx_project_memberships_project_id on project_memberships(project_id);
create index if not exists idx_project_memberships_owner_user_id on project_memberships(owner_user_id);
create index if not exists idx_project_memberships_invited_user_id on project_memberships(invited_user_id);
create index if not exists idx_project_memberships_invited_email on project_memberships(invited_email);
create index if not exists idx_project_memberships_invited_email_lookup on project_memberships(invited_email_lookup);
create unique index if not exists idx_project_memberships_project_email_lookup
  on project_memberships(project_id, invited_email_lookup)
  where invited_email_lookup is not null;
create index if not exists idx_project_invite_links_project_id on project_invite_links(project_id);
create index if not exists idx_project_invite_links_owner_user_id on project_invite_links(owner_user_id);
create index if not exists idx_project_invite_links_token on project_invite_links(token);
create unique index if not exists idx_project_invite_links_active_project
  on project_invite_links(project_id)
  where revoked_at is null;
create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_sessions_expires_at on sessions(expires_at);
create index if not exists idx_journal_entries_project_id on journal_entries(project_id);
create index if not exists idx_journal_entries_author_user_id on journal_entries(author_user_id);
create index if not exists idx_todos_project_id on todos(project_id);
create index if not exists idx_todos_collaborator_id on todos(collaborator_id);
create index if not exists idx_todos_created_by_user_id on todos(created_by_user_id);
create index if not exists idx_todos_assignee_user_id on todos(assignee_user_id);
create index if not exists idx_todos_due_date on todos(due_date);
create index if not exists idx_todos_project_module_id on todos(project_module_id);
create index if not exists idx_project_modules_project_id on project_modules(project_id);
create index if not exists idx_todo_notes_todo_id on todo_notes(todo_id);
create index if not exists idx_todo_notes_author_user_id on todo_notes(author_user_id);
create index if not exists idx_todo_note_mentions_user_id on todo_note_mentions(mentioned_user_id);
create index if not exists idx_collaborators_user_id on collaborators(user_id);
create index if not exists idx_collaborators_project_id on collaborators(project_id);
create index if not exists idx_collaborators_name_lookup on collaborators(user_id, name_lookup);
create index if not exists idx_risks_project_id on risks(project_id);
create index if not exists idx_draft_items_user_id on draft_items(user_id);
create index if not exists idx_summaries_user_id on summaries(user_id);
create index if not exists idx_summaries_project_id on summaries(project_id);
create index if not exists idx_notification_states_user_kind
  on notification_states(user_id, kind);
create index if not exists idx_project_integrations_project_provider
  on project_integrations(project_id, provider);
create index if not exists idx_notification_deliveries_status
  on notification_deliveries(channel, status, updated_at);
create index if not exists idx_notification_deliveries_user_kind
  on notification_deliveries(user_id, kind);
create index if not exists idx_project_package_events_project_id
  on project_package_events(project_id, created_at);
create index if not exists idx_project_package_groups_event_id
  on project_package_groups(project_package_event_id);
create index if not exists idx_project_package_items_group_id
  on project_package_items(project_package_group_id, created_at desc);
create index if not exists idx_project_package_operations_event_id
  on project_package_operations(project_package_event_id, created_at asc);
create index if not exists idx_project_package_operations_group_id
  on project_package_operations(project_package_group_id, created_at asc);
create index if not exists idx_project_package_operation_todos_operation_id
  on project_package_operation_todos(project_package_operation_id);
create index if not exists idx_project_package_operation_todos_todo_id
  on project_package_operation_todos(todo_id);
`
