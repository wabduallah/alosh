-- لَمّة PLAY schema. App tables only; auth lives in 0001_auth.sql.

create table if not exists categories (
  id text primary key,
  name_ar text not null,
  name_en text not null,
  sort_order integer not null default 0
);

create table if not exists games (
  id text primary key,
  name_ar text not null,
  name_en text not null,
  description_ar text not null,
  description_en text not null,
  category text not null,
  tier text not null default 'free',
  engine text not null,
  min_players integer not null default 2,
  max_players integer not null default 14,
  default_seconds integer not null default 30,
  default_rounds integer not null default 6,
  scoring jsonb not null default '{}'::jsonb,
  visible boolean not null default true,
  status text not null default 'published',
  sort_order integer not null default 0,
  icon text not null default 'Gamepad2',
  source text not null default 'admin',
  created_at timestamptz not null default now()
);

create index if not exists games_visible_idx on games (visible, sort_order);

create table if not exists questions (
  id serial primary key,
  game_id text not null references games (id) on delete cascade,
  prompt_ar text not null,
  prompt_en text not null,
  kind text not null default 'mcq',
  choices jsonb not null default '[]'::jsonb,
  correct text,
  accepted jsonb not null default '[]'::jsonb,
  category text,
  difficulty text not null default 'medium',
  image_url text,
  icons jsonb not null default '[]'::jsonb,
  points integer not null default 10,
  time_limit integer,
  status text not null default 'published',
  source text not null default 'admin',
  created_at timestamptz not null default now()
);

create index if not exists questions_game_idx on questions (game_id, status);

create table if not exists rooms (
  id text primary key,
  host_token text not null,
  host_user_id text,
  host_ip text,
  game_id text not null,
  status text not null default 'WAITING',
  current_round integer not null default 0,
  settings jsonb not null default '{}'::jsonb,
  round_state jsonb not null default '{}'::jsonb,
  unlocked boolean not null default false,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '6 hours')
);

create index if not exists rooms_status_idx on rooms (status);
create index if not exists rooms_expires_idx on rooms (expires_at);
create index if not exists rooms_host_idx on rooms (host_user_id, created_at);

create table if not exists players (
  id text primary key,
  room_id text not null references rooms (id) on delete cascade,
  token text not null,
  name text not null,
  user_id text,
  is_bot boolean not null default false,
  score integer not null default 0,
  round_score integer not null default 0,
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index if not exists players_room_idx on players (room_id);
create unique index if not exists players_room_name_idx on players (room_id, lower(name));

create table if not exists answers (
  id serial primary key,
  room_id text not null references rooms (id) on delete cascade,
  player_id text not null references players (id) on delete cascade,
  round integer not null,
  payload jsonb not null,
  response_ms integer not null default 0,
  score_awarded integer not null default 0,
  correct boolean,
  created_at timestamptz not null default now(),
  unique (room_id, player_id, round)
);

create index if not exists answers_room_round_idx on answers (room_id, round);

create table if not exists profiles (
  user_id text primary key,
  display_name text,
  avatar_url text,
  role text not null default 'player',
  created_at timestamptz not null default now()
);

create table if not exists favorites (
  user_id text not null,
  game_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

create table if not exists play_history (
  id serial primary key,
  user_id text,
  room_id text,
  game_id text,
  player_name text,
  score integer not null default 0,
  placement integer,
  played_at timestamptz not null default now()
);

create index if not exists play_history_user_idx on play_history (user_id, played_at desc);
create index if not exists play_history_game_idx on play_history (game_id);

create table if not exists plans (
  id text primary key,
  name_ar text not null,
  name_en text not null,
  price_sar integer not null,
  interval_unit text not null,
  features_ar jsonb not null default '[]'::jsonb,
  features_en jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists subscriptions (
  id text primary key,
  user_id text not null,
  plan_id text not null,
  status text not null,
  source text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists subscriptions_user_idx on subscriptions (user_id, status);

create table if not exists payments (
  id text primary key,
  user_id text,
  plan_id text not null,
  provider text not null,
  amount_sar integer not null,
  status text not null,
  promo_code text,
  external_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payments_status_idx on payments (status, created_at desc);

create table if not exists promo_codes (
  code text primary key,
  kind text not null,
  amount integer not null default 0,
  max_uses integer,
  uses integer not null default 0,
  active boolean not null default true,
  source text not null default 'admin',
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  key text primary key,
  value jsonb not null
);

create table if not exists ui_strings (
  locale text not null,
  key text not null,
  value text not null,
  primary key (locale, key)
);

create table if not exists lexicon (
  id serial primary key,
  locale text not null,
  letter text not null,
  category text not null,
  word text not null,
  source text not null default 'admin',
  unique (locale, letter, category, word)
);

create index if not exists lexicon_lookup_idx on lexicon (locale, letter, category);
