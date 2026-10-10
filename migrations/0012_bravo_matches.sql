-- Bravo section: one history row per finished room, with the exact config it was played under.
-- Room configuration itself lives in rooms.settings (jsonb: bravoMode, categories, rounds, seconds).
-- This table keeps a frozen copy so history survives later edits and can be queried by mode/category.

create table if not exists bravo_matches (
  room_id       text primary key references rooms (id) on delete cascade,
  game_id       text not null,
  mode          text not null default 'quick' check (mode in ('quick', 'roles', 'rapid')),
  categories    text[] not null default '{}',
  rounds        integer not null check (rounds between 1 and 15),
  seconds       integer not null check (seconds between 8 and 180),
  player_count  integer not null check (player_count >= 0),
  scorecard     jsonb not null default '[]'::jsonb,
  finished_at   timestamptz not null default now()
);

create index if not exists bravo_matches_finished_idx on bravo_matches (finished_at desc);
create index if not exists bravo_matches_mode_idx on bravo_matches (mode, finished_at desc);

-- Server queries use DATABASE_URL and bypass RLS. The browser anon key gets no access.
alter table bravo_matches enable row level security;
