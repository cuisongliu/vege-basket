-- Veges incremental migration: organization-scoped package-market policy.
-- Apply this file after the organizations and users tables exist.
-- The statements are intentionally idempotent so a retry after a transient
-- connection failure does not require a hand-written rollback.

begin;

create table if not exists organization_feature_settings (
  organization_id bigint not null references organizations(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  revision integer not null default 0 check (revision >= 0),
  updated_by_user_id bigint references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, feature_key)
);

create table if not exists organization_package_market_channel_policies (
  organization_id bigint not null references organizations(id) on delete cascade,
  channel text not null check (channel in ('release', 'ci')),
  enabled boolean not null default true,
  mode text not null default 'all' check (mode in ('all', 'selected')),
  updated_by_user_id bigint references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, channel)
);

create table if not exists organization_package_market_selections (
  organization_id bigint not null references organizations(id) on delete cascade,
  channel text not null check (channel in ('release', 'ci')),
  rule_id text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, channel, rule_id)
);

create index if not exists idx_organization_package_market_selections_lookup
  on organization_package_market_selections(organization_id, channel, rule_id);

commit;
