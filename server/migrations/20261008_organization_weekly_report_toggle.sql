-- Allow organization administrators to disable the weekly-report module
-- without deleting assignments, drafts, submissions, or summaries.

begin;

alter table organizations
  add column if not exists weekly_report_enabled boolean not null default true;

commit;
