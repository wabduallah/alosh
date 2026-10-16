-- =============================================================================
-- A tiny stand-in for what Supabase provides, so the game SQL can be replayed and
-- tested on a plain Postgres (local, CI). Never run this on the real project.
--
-- Who is calling: set_config('test.uid', '<user uuid>', false); admin: set_config('test.admin', '1', false).
-- =============================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists extensions;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  is_anonymous boolean default false,
  created_at timestamptz default now(),
  last_sign_in_at timestamptz
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select case when nullif(current_setting('test.uid', true), '') is null then 'anon' else 'authenticated' end
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'sub', nullif(current_setting('test.uid', true), ''),
    'role', auth.role(),
    'app_metadata', case when current_setting('test.admin', true) = '1' then '{"role":"admin"}'::jsonb else '{}'::jsonb end)
$$;
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;
grant usage on schema public, auth to anon, authenticated, service_role;
