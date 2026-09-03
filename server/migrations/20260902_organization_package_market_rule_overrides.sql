-- Veges incremental migration: component-level package-market channel overrides.
-- Existing organizations retain their current range behavior until an override
-- row is explicitly saved, so this migration never broadens package visibility.

begin;

create table if not exists organization_package_market_rule_overrides (
  organization_id bigint not null references organizations(id) on delete cascade,
  rule_id text not null,
  channel text not null check (channel in ('release', 'ci')),
  enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, rule_id, channel)
);

commit;
