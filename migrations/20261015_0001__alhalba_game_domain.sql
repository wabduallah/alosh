-- =============================================================================
-- Alhalba domain schema example
-- Naming convention: YYYYMMDD_HHMM__game_name_short_description.sql
-- This file demonstrates the migration pattern used to isolate one game domain.
-- =============================================================================

create table if not exists public.alhalba_rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms (id) on delete cascade,
  round_number int not null default 1,
  phase text not null default 'lobby' check (phase in ('lobby', 'bid', 'prove', 'result', 'over')),
  topic_id uuid null,
  topic_text text,
  bidder_id uuid null,
  bidder_name text,
  contender_id uuid null,
  contender_name text,
  answer_count int not null default 0,
  answers jsonb not null default '[]'::jsonb,
  score_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists alhalba_rounds_room_id_idx on public.alhalba_rounds (room_id, round_number);

create table if not exists public.alhalba_topics (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  category text not null default 'عام',
  min_answers int not null default 3 check (min_answers between 1 and 30),
  time_limit_sec int not null default 30 check (time_limit_sec between 10 and 180),
  difficulty int not null default 2 check (difficulty between 1 and 3),
  created_at timestamptz not null default now()
);

create index if not exists alhalba_topics_category_idx on public.alhalba_topics (category, difficulty);

create or replace function public.set_alhalba_round_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger alhalba_rounds_set_updated_at
before update on public.alhalba_rounds
for each row
execute function public.set_alhalba_round_updated_at();

comment on table public.alhalba_rounds is 'Per-room state for the Alhalba game module.';
comment on table public.alhalba_topics is 'Curated topic catalog for the Alhalba game module.';
