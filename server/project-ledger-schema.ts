export const projectLedgerSchemaSql = `
create unique index if not exists idx_projects_id_organization_unique
  on projects(id, organization_id);

create table if not exists project_ledgers (
  project_id bigint primary key references projects(id) on delete cascade,
  organization_id bigint not null references organizations(id) on delete cascade,
  description_markdown_encrypted text not null default '',
  installation_version_encrypted text not null default '',
  last_updated_by_user_id bigint references users(id) on delete set null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, organization_id) references projects(id, organization_id) on delete cascade
);

create table if not exists project_ledger_maintainers (
  project_id bigint not null references projects(id) on delete cascade,
  organization_id bigint not null references organizations(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  configured_by_user_id bigint references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id),
  foreign key (project_id, organization_id) references projects(id, organization_id) on delete cascade,
  foreign key (organization_id, user_id) references organization_memberships(organization_id, user_id) on delete cascade
);

create table if not exists project_ledger_clusters (
  id uuid primary key default gen_random_uuid(),
  project_id bigint not null references projects(id) on delete cascade,
  organization_id bigint not null references organizations(id) on delete cascade,
  name_encrypted text not null,
  name_lookup text not null,
  environment_type_encrypted text not null default '',
  region_encrypted text not null default '',
  access_address_encrypted text not null default '',
  access_account_markdown_encrypted text not null default '',
  status text not null default 'active' check (status in ('active', 'retired')),
  notes_encrypted text not null default '',
  foreign key (project_id, organization_id) references projects(id, organization_id) on delete cascade,
  unique (project_id, name_lookup),
  unique (id, project_id, organization_id)
);

create table if not exists project_ledger_applications (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null,
  project_id bigint not null,
  organization_id bigint not null,
  name_encrypted text not null,
  name_lookup text not null,
  version_encrypted text not null default '',
  updated_on date,
  notes_encrypted text not null default '',
  foreign key (cluster_id, project_id, organization_id) references project_ledger_clusters(id, project_id, organization_id) on delete cascade,
  unique (cluster_id, name_lookup),
  unique (id, cluster_id, project_id, organization_id)
);

create table if not exists project_ledger_licenses (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null,
  project_id bigint not null,
  organization_id bigint not null,
  application_id uuid,
  product_encrypted text not null,
  expires_on date,
  reminder_days integer not null default 30 check (reminder_days between 0 and 3650),
  renewal_owner_user_id bigint references users(id) on delete set null,
  notes_encrypted text not null default '',
  foreign key (cluster_id, project_id, organization_id) references project_ledger_clusters(id, project_id, organization_id) on delete cascade,
  foreign key (application_id, cluster_id, project_id, organization_id) references project_ledger_applications(id, cluster_id, project_id, organization_id) on delete restrict
);

create table if not exists project_ledger_vpn_profiles (
  cluster_id uuid primary key,
  project_id bigint not null,
  organization_id bigint not null,
  content_kind text not null check (content_kind in ('markdown', 'document_link')),
  content_encrypted text not null default '',
  foreign key (cluster_id, project_id, organization_id) references project_ledger_clusters(id, project_id, organization_id) on delete cascade
);

create table if not exists project_ledger_machines (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null,
  project_id bigint not null,
  organization_id bigint not null,
  host_name_encrypted text not null,
  host_name_lookup text not null,
  machine_type_encrypted text not null default '',
  use_encrypted text not null default '',
  cpu_encrypted text not null default '',
  gpu_encrypted text not null default '',
  memory_encrypted text not null default '',
  disks_markdown_encrypted text not null default '',
  operating_system_encrypted text not null default '',
  kernel_encrypted text not null default '',
  architecture_encrypted text not null default '',
  raid_card_encrypted text not null default '',
  network_cards_encrypted text not null default '',
  ssh_markdown_encrypted text not null default '',
  internal_address_encrypted text not null default '',
  external_address_encrypted text not null default '',
  instance_id_encrypted text not null default '',
  notes_encrypted text not null default '',
  foreign key (cluster_id, project_id, organization_id) references project_ledger_clusters(id, project_id, organization_id) on delete cascade,
  unique (cluster_id, host_name_lookup)
);

create table if not exists project_ledger_network_mappings (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null,
  project_id bigint not null,
  organization_id bigint not null,
  network_name_encrypted text not null default '',
  ip_encrypted text not null default '',
  port integer check (port between 1 and 65535),
  access_address_encrypted text not null default '',
  access_scope_encrypted text not null default '',
  purpose_encrypted text not null default '',
  foreign key (cluster_id, project_id, organization_id) references project_ledger_clusters(id, project_id, organization_id) on delete cascade
);

create table if not exists project_ledger_diagrams (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null,
  project_id bigint not null,
  organization_id bigint not null,
  object_key_encrypted text not null,
  file_name_encrypted text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  description_encrypted text not null default '',
  uploaded_by_user_id bigint references users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  is_primary boolean not null default false,
  foreign key (cluster_id, project_id, organization_id) references project_ledger_clusters(id, project_id, organization_id) on delete cascade
);

create unique index if not exists idx_project_ledger_diagrams_primary
  on project_ledger_diagrams(cluster_id) where is_primary;
create index if not exists idx_project_ledger_clusters_project
  on project_ledger_clusters(project_id);
create index if not exists idx_project_ledger_licenses_expiry
  on project_ledger_licenses(cluster_id, expires_on);
create index if not exists idx_project_ledger_machines_cluster
  on project_ledger_machines(cluster_id);
create index if not exists idx_project_ledger_network_mappings_cluster
  on project_ledger_network_mappings(cluster_id);

create or replace function revoke_project_ledger_membership() returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME = 'project_memberships' then
    if TG_OP = 'DELETE' or NEW.status <> 'active' then
      delete from project_ledger_maintainers where project_id = OLD.project_id and user_id = OLD.invited_user_id;
    end if;
  elsif TG_TABLE_NAME = 'organization_memberships' then
    if TG_OP = 'DELETE' or NEW.status <> 'active' then
      delete from project_ledger_maintainers where organization_id = OLD.organization_id and user_id = OLD.user_id;
    end if;
  elsif TG_TABLE_NAME = 'users' then
    if NEW.account_status <> 'active' then delete from project_ledger_maintainers where user_id = OLD.id; end if;
  elsif TG_TABLE_NAME = 'projects' then
    if NEW.organization_id is distinct from OLD.organization_id then delete from project_ledger_maintainers where project_id = OLD.id; end if;
  end if;
  return null;
end;
$$;
drop trigger if exists project_ledger_project_membership_revoked on project_memberships;
create trigger project_ledger_project_membership_revoked after delete or update of status on project_memberships for each row execute function revoke_project_ledger_membership();
drop trigger if exists project_ledger_organization_membership_revoked on organization_memberships;
create trigger project_ledger_organization_membership_revoked after delete or update of status on organization_memberships for each row execute function revoke_project_ledger_membership();
drop trigger if exists project_ledger_user_membership_revoked on users;
create trigger project_ledger_user_membership_revoked after update of account_status on users for each row execute function revoke_project_ledger_membership();
drop trigger if exists project_ledger_organization_changed on projects;
create trigger project_ledger_organization_changed after update of organization_id on projects for each row execute function revoke_project_ledger_membership();
`
