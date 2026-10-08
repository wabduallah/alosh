-- Match supabase/schema.sql realtime access. Server queries use DATABASE_URL
-- and bypass RLS. The browser anon key may only read room_signals.

alter table public.room_signals enable row level security;
drop policy if exists room_signals_read on public.room_signals;
create policy room_signals_read on public.room_signals for select to anon, authenticated using (true);
grant select on public.room_signals to anon, authenticated;

alter table public.users enable row level security;

do $$
begin
  alter publication supabase_realtime add table public.room_signals;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
