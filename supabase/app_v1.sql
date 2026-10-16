-- =============================================================================
-- سجل ملفات SQL (app_migrations) وفحص الموقع لها. يُشغَّل بعد mafia_v7.sql و court_v6.sql و rooms_v2.sql،
-- وتشغيله مرة ثانية آمن.
--
-- 1) app_migrations: كل ملف يُشغَّل يُسجَّل هنا باسمه (يسجّله الملف نفسه أو أمر npm run db:supabase).
--    هذا الملف يسجّل كل الملفات التي قبله في supabase/manifest.txt على أنها شُغّلت.
-- 2) app_schema_status(الأسماء): أي الملفات المطلوبة لم تُشغَّل بعد. يستعملها الموقع ليُنبّه المدير.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.mafia_spy_check(uuid,uuid)') is null
     or to_regprocedure('public.court_timer(uuid,integer,text)') is null
     or to_regprocedure('public.room_kick(uuid,uuid)') is null then
    raise exception 'شغّل mafia_v7.sql و court_v6.sql و rooms_v2.sql أولًا، ثم app_v1.sql.';
  end if;
end $$;

create table if not exists public.app_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;

insert into public.app_migrations (name) values
  ('schema_al3sh_core.sql'),
  ('0019_bluff_master.sql'),
  ('0020_outsider.sql'),
  ('0021_heads_up.sql'),
  ('0022_heads_up_categories.sql'),
  ('0023_social_mafia.sql'),
  ('mafia_v2.sql'),
  ('mafia_v3.sql'),
  ('admin_panel.sql'),
  ('schema_alhalba.sql'),
  ('alhalba_v2.sql'),
  ('alhalba_v3.sql'),
  ('alhalba_v4.sql'),
  ('admin_v2.sql'),
  ('admin_v3.sql'),
  ('mafia_v4.sql'),
  ('guests_v1.sql'),
  ('guests_v2.sql'),
  ('polish_v1.sql'),
  ('rooms_v1.sql'),
  ('grid_v1.sql'),
  ('mafia_v5.sql'),
  ('mafia_v6.sql'),
  ('alhalba_v5.sql'),
  ('alhalba_v6.sql'),
  ('alhalba_content_v1.sql'),
  ('admin_v4.sql'),
  ('court_v1.sql'),
  ('court_cases_v1.sql'),
  ('court_v2.sql'),
  ('court_cases_v2.sql'),
  ('court_v3.sql'),
  ('court_cases_v3.sql'),
  ('court_v4.sql'),
  ('court_cases_v4.sql'),
  ('court_cases_v5.sql'),
  ('court_v5.sql'),
  ('court_cases_v6.sql'),
  ('court_v6.sql'),
  ('rooms_v2.sql'),
  ('mafia_v7.sql'),
  ('app_v1.sql')
on conflict do nothing;

create or replace function public.app_schema_status(p_files text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'missing', coalesce((select jsonb_agg(f order by o) from unnest(p_files) with ordinality t(f, o)
                          where not exists (select 1 from public.app_migrations m where m.name = f)), '[]'::jsonb),
    'last', (select name from public.app_migrations order by applied_at desc, name desc limit 1));
$$;
revoke all on function public.app_schema_status(text[]) from public, anon;
grant execute on function public.app_schema_status(text[]) to authenticated;

notify pgrst, 'reload schema';
