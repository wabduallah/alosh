-- «أعلمني عند الإطلاق»: بريد لكل لعبة قادمة. يضيفه الزائر، ولا يقرؤه إلا المشرف.
-- Launch alerts: a visitor adds an email for an upcoming game. Only admins read it.

create table if not exists public.launch_alerts (
  id         uuid primary key default gen_random_uuid(),
  game_id    text not null check (char_length(game_id) between 1 and 40),
  email      text not null check (char_length(email) between 5 and 254 and email like '%_@_%._%'),
  created_at timestamptz not null default now(),
  unique (game_id, email)
);

comment on table public.launch_alerts is 'بريد لتنبيه عند إطلاق لعبة. الإضافة للجميع، والقراءة للمشرف فقط.';

alter table public.launch_alerts enable row level security;
revoke all on public.launch_alerts from anon, authenticated;

grant insert (game_id, email) on public.launch_alerts to anon, authenticated;
create policy launch_alerts_insert_anyone on public.launch_alerts
  for insert to anon, authenticated
  with check (true);

grant select on public.launch_alerts to authenticated;
create policy launch_alerts_select_admin on public.launch_alerts
  for select to authenticated
  using (public.is_app_admin());
