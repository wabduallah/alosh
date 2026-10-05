-- Public signal the browsers may listen to. The rooms row itself stays private
-- (it holds host tokens). Supabase Realtime watches this table only.

create table if not exists room_signals (
  code text primary key,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function bump_room_signal() returns trigger
language plpgsql
as $$
begin
  insert into room_signals (code, revision, updated_at)
  values (new.id, new.revision, now())
  on conflict (code) do update
    set revision = excluded.revision,
        updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists rooms_signal on rooms;
create trigger rooms_signal
after insert or update of revision on rooms
for each row execute function bump_room_signal();
