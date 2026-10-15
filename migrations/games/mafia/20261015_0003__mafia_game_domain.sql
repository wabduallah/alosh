-- =============================================================================
-- Mafia game domain migration (tables for Mafia module)
-- Naming: YYYYMMDD_HHMM__mafia_game_domain.sql
-- =============================================================================

create table if not exists public.mafia_games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms (id) on delete cascade,
  host_id uuid not null references public.room_players (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mafia_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.mafia_games (id) on delete cascade,
  player_id uuid not null references public.room_players (id) on delete cascade,
  player_name text,
  role text,
  alive boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists mafia_games_room_idx on public.mafia_games (room_id);
create index if not exists mafia_players_game_idx on public.mafia_players (game_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger mafia_games_set_updated_at
before update on public.mafia_games
for each row
execute function public.set_updated_at();

comment on table public.mafia_games is 'Game-level state for Mafia module';
comment on table public.mafia_players is 'Players in a Mafia game';
