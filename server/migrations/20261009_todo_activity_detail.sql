begin;

alter table todo_activity_events
  add column if not exists detail text not null default '';

update todo_activity_events event
   set detail = todo.discard_reason
  from todos todo
 where event.todo_id = todo.id
   and event.event_type = 'discarded'
   and event.detail = ''
   and todo.todo_status = 'discarded'
   and todo.discard_reason is not null
   and event.id = (
     select latest.id
       from todo_activity_events latest
      where latest.todo_id = event.todo_id
        and latest.event_type = 'discarded'
      order by latest.occurred_at desc, latest.id desc
      limit 1
   );

commit;
