-- =============================================================================
-- Court game domain migration (table skeletons for the Court game module)
-- Naming: YYYYMMDD_HHMM__court_game_domain.sql
-- =============================================================================

create table if not exists public.court_cases (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms (id) on delete cascade,
  title text not null,
  description text,
  host_id uuid not null references public.room_players (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists court_cases_room_id_idx on public.court_cases (room_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger court_cases_set_updated_at
before update on public.court_cases
for each row
execute function public.set_updated_at();

comment on table public.court_cases is 'Per-room case state for the Court game module.';
