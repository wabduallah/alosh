-- أحداث استخدام مجهولة: عدد النقرات والبحث والمناسبات. بلا معرّف مستخدم ولا IP.
-- Anonymous usage events. No user id and no IP are stored.

create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  detail     text check (detail is null or char_length(detail) <= 40),
  created_at timestamptz not null default now()
);

comment on table public.events is 'أحداث مجهولة للقياس. الإضافة للجميع، والقراءة للمشرف فقط.';

create index if not exists events_name_created_idx on public.events (name, created_at);

alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;

grant insert (name, detail) on public.events to anon, authenticated;
create policy events_insert_anyone on public.events
  for insert to anon, authenticated
  with check (true);

grant select on public.events to authenticated;
create policy events_select_admin on public.events
  for select to authenticated
  using (public.is_app_admin());
