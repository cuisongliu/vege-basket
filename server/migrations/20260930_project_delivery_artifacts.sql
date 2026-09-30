begin;

create table if not exists project_package_event_container_images (
  id bigserial primary key,
  project_package_event_id bigint not null references project_package_events(id) on delete cascade,
  position integer not null check (position >= 0),
  image_ref text not null,
  unique (project_package_event_id, position)
);

create table if not exists project_package_event_offline_packages (
  id bigserial primary key,
  project_package_event_id bigint not null references project_package_events(id) on delete cascade,
  position integer not null check (position >= 0),
  download_url text not null,
  unique (project_package_event_id, position)
);

create index if not exists idx_project_package_event_container_images_event
  on project_package_event_container_images(project_package_event_id, position);

create index if not exists idx_project_package_event_offline_packages_event
  on project_package_event_offline_packages(project_package_event_id, position);

commit;
