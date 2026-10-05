-- Add the user-scoped AI activity ledger and canonical conversation references.
-- This is a forward-only, idempotent structural migration. It does not copy
-- or decrypt existing AI conversation content.
begin;

create table if not exists ai_activity_records (
  id uuid primary key,
  user_id bigint not null references users(id) on delete cascade,
  module text not null check (char_length(module) between 1 and 80),
  operation text not null check (char_length(operation) between 1 and 120),
  status text not null check (status in ('processing', 'completed', 'failed', 'cancelled')),
  model text,
  related_type text,
  related_id text,
  conversation_id uuid,
  turn_id uuid,
  source_project_ids bigint[] not null default '{}'::bigint[],
  request_content text,
  response_content text,
  error_content text,
  image_count integer not null default 0 check (image_count >= 0 and image_count <= 100),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now()
);

alter table ai_activity_records
  add column if not exists conversation_id uuid,
  add column if not exists turn_id uuid,
  add column if not exists source_project_ids bigint[] not null default '{}'::bigint[];

create index if not exists idx_ai_activity_records_user_created
  on ai_activity_records(user_id, created_at desc, id desc);
create index if not exists idx_ai_activity_records_user_module
  on ai_activity_records(user_id, module, created_at desc);

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_activity_records_conversation_id_fkey'
      and conrelid = 'ai_activity_records'::regclass
  ) then
    alter table ai_activity_records
      add constraint ai_activity_records_conversation_id_fkey
      foreign key (conversation_id) references ai_conversations(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_activity_records_turn_id_fkey'
      and conrelid = 'ai_activity_records'::regclass
  ) then
    alter table ai_activity_records
      add constraint ai_activity_records_turn_id_fkey
      foreign key (turn_id) references ai_turns(id) on delete set null;
  end if;
end $$;

commit;
