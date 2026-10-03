begin;

alter table project_package_items
  add column if not exists environment_variables text,
  add column if not exists values_path text,
  add column if not exists values_patch text;

alter table project_package_event_container_images
  add column if not exists environment_variables text,
  add column if not exists values_path text,
  add column if not exists values_patch text;

alter table project_package_event_offline_packages
  add column if not exists environment_variables text,
  add column if not exists values_path text,
  add column if not exists values_patch text;

commit;
