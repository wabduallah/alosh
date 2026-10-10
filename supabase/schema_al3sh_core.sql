-- =====================================================================
-- العش (al3sh.app) · المخطط الأساسي لمنصة الألعاب الجماعية
-- supabase/schema_al3sh_core.sql
--
-- التشغيل: Supabase → SQL Editor، ثم شغّل الملف كاملًا مرة واحدة.
-- آمن لإعادة التشغيل: لا يحذف أي بيانات، ويحدّث البيانات التجريبية فقط.
--
-- يحتوي على:
--   1. الجداول الخمسة: games, game_rooms, room_players, questions_bank, room_game_state
--   2. الفهارس، والقيود، ومولّد رمز الغرفة (5 أحرف)
--   3. دوال آمنة للّعب اللحظي: الجرس، التصويت، كشف الإجابة للمضيف
--   4. RLS على كل الجداول، وإضافة جداول الغرف إلى Supabase Realtime
--   5. بيانات تجريبية: 5 ألعاب، وأسئلة لكل لعبة، وغرفة تجريبية رمزها TEST7
--
-- نموذج الأمان (مهم):
--   * القراءة عامة (anon و authenticated) للألعاب والغرف واللاعبين والحالة اللحظية،
--     حتى يعمل الانضمام بالرمز والاشتراك اللحظي.
--   * الكتابة تتطلب جلسة Supabase. الضيوف بلا حساب يحصلون عليها بتسجيل دخول مجهول:
--     supabase.auth.signInAnonymously() — فعّل "Anonymous Sign-Ins" من
--     Authentication → Sign In / Providers.
--   * المضيف (host_id = auth.uid()) وحده يغيّر حالة غرفته ونقاط اللاعبين والحالة اللحظية.
--     اللاعب يعدّل صفّه فقط (الاسم، الفريق، الاتصال)، ولا يستطيع تغيير نقاطه.
--   * الإجابات الصحيحة لا تُقرأ من المتصفح: اللاعبون يقرؤون العرض questions_public
--     الذي لا يحتوي correct_answer، والمضيف يحصل عليها بالدالة room_correct_answer().
--   * service_role (الخادم) يتجاوز RLS. المدير: مستخدم في app_metadata عنده "role": "admin".
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0) جدول games القديم
-- ---------------------------------------------------------------------
-- في هذا المشروع جدول games قديم بمعرّف نصي وأعمدة مختلفة. لا نحذفه: نعيد تسميته
-- إلى games_legacy (مع فهارسه) ليُنشأ الجدول الجديد باسمه الصحيح.
do $$
declare
  target text := 'games_legacy';
  idx record;
begin
  if to_regclass('public.games') is not null
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'games' and column_name = 'title_ar'
     ) then
    if to_regclass('public.' || target) is not null then
      target := 'games_legacy_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
    end if;
    execute format('alter table public.games rename to %I', target);
    for idx in
      select indexname from pg_indexes
      where schemaname = 'public' and tablename = target and indexname like 'games\_%'
    loop
      execute format('alter index public.%I rename to %I', idx.indexname, target || substr(idx.indexname, 6));
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) games: أنواع الألعاب
-- ---------------------------------------------------------------------
create table if not exists public.games (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title_ar       text not null check (char_length(btrim(title_ar)) between 2 and 80),
  description_ar text not null default '',
  min_players    int  not null default 2 check (min_players >= 1),
  max_players    int  not null default 12,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint games_players_range check (max_players >= min_players and max_players <= 100)
);

comment on table public.games is 'أنواع الألعاب المتاحة في المنصة.';

-- ---------------------------------------------------------------------
-- 2) game_rooms: الغرف والجلسات
-- ---------------------------------------------------------------------
create table if not exists public.game_rooms (
  id            uuid primary key default gen_random_uuid(),
  -- 5 أحرف من أبجدية بلا حروف ملتبسة (بلا I و O و 0 و 1). يُولَّد تلقائيًا إن تُرك فارغًا.
  room_code     text not null unique check (room_code ~ '^[A-HJ-NP-Z2-9]{5}$'),
  game_id       uuid not null references public.games (id) on delete restrict,
  -- مستخدم Supabase الذي أنشأ الغرفة (حساب عادي أو ضيف مجهول).
  host_id       uuid not null default auth.uid(),
  status        text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  current_round int  not null default 1 check (current_round >= 1),
  -- المؤقتات، host_is_player، team_mode، وأي قواعد خاصة باللعبة.
  settings      jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at    timestamptz not null default now()
);

comment on table public.game_rooms is 'غرف اللعب. القراءة عامة، والتعديل للمضيف فقط.';

-- room_code: الفهرس الفريد ينشأ مع القيد unique أعلاه ويُستخدم للبحث بالرمز.
create index if not exists game_rooms_game_id_idx on public.game_rooms (game_id);
create index if not exists game_rooms_host_id_idx on public.game_rooms (host_id);
create index if not exists game_rooms_status_created_idx on public.game_rooms (status, created_at);

-- ---------------------------------------------------------------------
-- 3) room_players: اللاعبون والفرق
-- ---------------------------------------------------------------------
create table if not exists public.room_players (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.game_rooms (id) on delete cascade,
  -- مستخدم Supabase للاعب. يبقى فارغًا للاعب يضيفه المضيف من جهازه (لعب على شاشة واحدة).
  user_id      uuid,
  player_name  text not null check (char_length(btrim(player_name)) between 2 and 24),
  team_color   text check (team_color in ('red', 'blue')),
  score        int  not null default 0,
  is_host      boolean not null default false,
  is_connected boolean not null default true,
  joined_at    timestamptz not null default now()
);

comment on table public.room_players is 'اللاعبون في كل غرفة. اللاعب يعدّل صفّه، والمضيف وحده يغيّر النقاط.';

create index if not exists room_players_room_id_idx on public.room_players (room_id);
create index if not exists room_players_user_id_idx on public.room_players (user_id) where user_id is not null;
create unique index if not exists room_players_room_name_key on public.room_players (room_id, lower(btrim(player_name)));
create unique index if not exists room_players_room_user_key on public.room_players (room_id, user_id) where user_id is not null;

-- ---------------------------------------------------------------------
-- 4) questions_bank: بنك الأسئلة لكل الألعاب
-- ---------------------------------------------------------------------
create table if not exists public.questions_bank (
  id             uuid primary key default gen_random_uuid(),
  game_slug      text not null references public.games (slug) on update cascade on delete cascade,
  category_ar    text not null check (char_length(btrim(category_ar)) between 1 and 60),
  question_text  text not null check (char_length(btrim(question_text)) between 1 and 500),
  media_url      text check (media_url is null or media_url ~* '^https://'),
  -- خيارات الاختيار من متعدد. مصفوفة فارغة للأسئلة المفتوحة وألعاب الخداع.
  options        jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  correct_answer text  not null check (char_length(btrim(correct_answer)) > 0),
  -- إجابات مزيفة جاهزة تُخلط بإجابات اللاعبين في ألعاب الخداع.
  fake_answers   jsonb not null default '[]'::jsonb check (jsonb_typeof(fake_answers) = 'array'),
  points         int   not null default 100 check (points > 0),
  difficulty     text  not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  created_at     timestamptz not null default now(),
  -- إن وُجدت خيارات، يجب أن تكون الإجابة الصحيحة واحدة منها.
  constraint questions_bank_correct_in_options check (jsonb_array_length(options) = 0 or options ? correct_answer)
);

comment on table public.questions_bank is 'بنك الأسئلة. لا يُقرأ من المتصفح مباشرة؛ اللاعبون يستخدمون questions_public.';

create index if not exists questions_bank_game_category_idx on public.questions_bank (game_slug, category_ar);
create index if not exists questions_bank_game_difficulty_idx on public.questions_bank (game_slug, difficulty);
-- يمنع تكرار السؤال نفسه في اللعبة نفسها، ويجعل إعادة تشغيل البيانات التجريبية آمنة.
create unique index if not exists questions_bank_game_question_key on public.questions_bank (game_slug, md5(question_text));

-- ---------------------------------------------------------------------
-- 5) room_game_state: الحالة اللحظية لكل غرفة (صف واحد لكل غرفة)
-- ---------------------------------------------------------------------
create table if not exists public.room_game_state (
  room_id            uuid primary key references public.game_rooms (id) on delete cascade,
  active_question_id uuid references public.questions_bank (id) on delete set null,
  -- مثال: {"phase":"question","timer_ends_at":"...","buzzer_open":true,"buzzer":null,
  --        "voting_open":false,"votes":{},"power_ups":{"red":["double"],"blue":[]}}
  state_data         jsonb not null default '{}'::jsonb check (jsonb_typeof(state_data) = 'object'),
  updated_at         timestamptz not null default now()
);

comment on table public.room_game_state is 'الحالة اللحظية للغرفة: السؤال الحالي، المؤقت، الجرس، الأصوات، المساعدات.';

create index if not exists room_game_state_question_idx on public.room_game_state (active_question_id) where active_question_id is not null;

-- ---------------------------------------------------------------------
-- 6) عرض الأسئلة للاعبين (بلا الإجابة الصحيحة)
-- ---------------------------------------------------------------------
-- يعمل بصلاحيات مالكه، فيقرأ الجدول متجاوزًا RLS، لكنه لا يُظهر عمود correct_answer.
-- قد ينبّه Supabase Advisor إلى أنه "security definer view": هذا مقصود هنا.
create or replace view public.questions_public as
  select id, game_slug, category_ar, question_text, media_url, options, fake_answers, points, difficulty, created_at
  from public.questions_bank;

comment on view public.questions_public is 'الأسئلة للاعبين بلا الإجابة الصحيحة.';

-- ---------------------------------------------------------------------
-- 7) دوال مساعدة للصلاحيات
-- ---------------------------------------------------------------------
-- مدير المنصة: مستخدم عنده app_metadata.role = "admin" (يضبطه الخادم فقط).
create or replace function public.is_app_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- هل المستخدم الحالي مضيف هذه الغرفة؟ security definer لتجنّب تكرار RLS داخل السياسات.
create or replace function public.is_room_host(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.game_rooms where id = p_room_id and host_id = auth.uid());
$$;

-- صف اللاعب الحالي في الغرفة، أو null.
create or replace function public.my_player_id(p_room_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.room_players where room_id = p_room_id and user_id = auth.uid() limit 1;
$$;

-- يحدد إن كان الاستدعاء من المتصفح (دور anon أو authenticated في الـ JWT) لا من الخادم
-- (service_role) أو من SQL Editor واتصال قاعدة البيانات المباشر (بلا JWT).
-- يعتمد على JWT لا على current_user، لأن current_user يصبح postgres داخل دوال security definer.
create or replace function public.is_client_request()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'role', '') in ('anon', 'authenticated') and not public.is_app_admin();
$$;

-- ---------------------------------------------------------------------
-- 8) المشغّلات (Triggers)
-- ---------------------------------------------------------------------
-- رمز غرفة عشوائي من 5 أحرف غير مستخدم.
create or replace function public.generate_room_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..5 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.game_rooms where room_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.game_rooms_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.room_code is null or btrim(new.room_code) = '' then
    new.room_code := public.generate_room_code();
  else
    new.room_code := upper(btrim(new.room_code));
  end if;
  return new;
end;
$$;

drop trigger if exists game_rooms_before_insert on public.game_rooms;
create trigger game_rooms_before_insert
  before insert on public.game_rooms
  for each row execute function public.game_rooms_before_insert();

-- كل غرفة جديدة تحصل تلقائيًا على صف حالة لحظية فارغ.
create or replace function public.game_rooms_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.room_game_state (room_id) values (new.id) on conflict (room_id) do nothing;
  return new;
end;
$$;

drop trigger if exists game_rooms_after_insert on public.game_rooms;
create trigger game_rooms_after_insert
  after insert on public.game_rooms
  for each row execute function public.game_rooms_after_insert();

-- رمز الغرفة ومضيفها وتاريخها لا تتغير من المتصفح.
create or replace function public.game_rooms_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_client_request() then
    if new.room_code is distinct from old.room_code
       or new.host_id is distinct from old.host_id
       or new.created_at is distinct from old.created_at then
      raise exception 'ROOM_FIELDS_LOCKED' using hint = 'room_code, host_id and created_at cannot be changed';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists game_rooms_guard_update on public.game_rooms;
create trigger game_rooms_guard_update
  before update on public.game_rooms
  for each row execute function public.game_rooms_guard_update();

-- الانضمام: الغرفة مفتوحة، ولم تمتلئ بحسب max_players للعبة.
create or replace function public.room_players_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_max int;
  v_count int;
begin
  -- قفل صف الغرفة يمنع تجاوز السعة عند انضمام عدة لاعبين في اللحظة نفسها.
  select r.status, g.max_players into v_status, v_max
  from public.game_rooms r
  join public.games g on g.id = r.game_id
  where r.id = new.room_id
  for update of r;

  if v_status is null then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_status = 'finished' then
    raise exception 'ROOM_FINISHED';
  end if;
  select count(*) into v_count from public.room_players where room_id = new.room_id;
  if v_count >= v_max then
    raise exception 'ROOM_FULL';
  end if;

  new.player_name := btrim(regexp_replace(new.player_name, '\s+', ' ', 'g'));
  if public.is_client_request() then
    new.score := 0;
    new.joined_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists room_players_before_insert on public.room_players;
create trigger room_players_before_insert
  before insert on public.room_players
  for each row execute function public.room_players_before_insert();

-- اللاعب يغيّر اسمه وفريقه واتصاله فقط. النقاط وصفة المضيف للمضيف وحده.
create or replace function public.room_players_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_client_request() then
    if new.room_id is distinct from old.room_id
       or new.user_id is distinct from old.user_id
       or new.joined_at is distinct from old.joined_at then
      raise exception 'PLAYER_FIELDS_LOCKED' using hint = 'room_id, user_id and joined_at cannot be changed';
    end if;
    if (new.score is distinct from old.score or new.is_host is distinct from old.is_host)
       and not public.is_room_host(old.room_id) then
      raise exception 'HOST_ONLY' using hint = 'only the room host can change score or is_host';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists room_players_guard_update on public.room_players;
create trigger room_players_guard_update
  before update on public.room_players
  for each row execute function public.room_players_guard_update();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists room_game_state_touch on public.room_game_state;
create trigger room_game_state_touch
  before update on public.room_game_state
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 9) دوال اللعب اللحظي (RPC) — ذرّية وآمنة من الغش
-- ---------------------------------------------------------------------
-- الجرس: أول لاعب يضغط يحجز الدور. ينجح فقط إن كان state_data.buzzer_open = true
-- ولم يضغط أحد قبله. تحديث واحد مشروط، فلا يفوز لاعبان مهما تزامن الضغط.
-- الاستخدام: supabase.rpc('press_buzzer', { p_room_id })
create or replace function public.press_buzzer(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.room_players%rowtype;
  v_state jsonb;
begin
  select * into v_player from public.room_players where room_id = p_room_id and user_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;

  update public.room_game_state s
  set state_data = jsonb_set(
        s.state_data,
        '{buzzer}',
        jsonb_build_object(
          'player_id', v_player.id,
          'player_name', v_player.player_name,
          'team_color', v_player.team_color,
          'at', to_jsonb(clock_timestamp())
        ),
        true)
  where s.room_id = p_room_id
    and coalesce((s.state_data ->> 'buzzer_open')::boolean, false)
    and coalesce(jsonb_typeof(s.state_data -> 'buzzer'), 'null') = 'null'
    and exists (select 1 from public.game_rooms r where r.id = p_room_id and r.status = 'playing')
  returning s.state_data into v_state;

  if v_state is null then
    return jsonb_build_object('ok', false, 'reason', 'LOCKED');
  end if;
  return jsonb_build_object('ok', true, 'buzzer', v_state -> 'buzzer');
end;
$$;

-- التصويت: يسجّل اختيار اللاعب في state_data.votes[player_id] ما دام voting_open = true.
-- يمكن للاعب تغيير صوته قبل إغلاق التصويت. الاستخدام: supabase.rpc('cast_vote', { p_room_id, p_choice })
create or replace function public.cast_vote(p_room_id uuid, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_choice text := left(btrim(coalesce(p_choice, '')), 100);
  v_done boolean;
begin
  if v_choice = '' then
    return jsonb_build_object('ok', false, 'reason', 'EMPTY_CHOICE');
  end if;
  v_player_id := public.my_player_id(p_room_id);
  if v_player_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;

  update public.room_game_state s
  set state_data = jsonb_set(
        case when jsonb_typeof(s.state_data -> 'votes') = 'object' then s.state_data
             else s.state_data || '{"votes":{}}'::jsonb end,
        array['votes', v_player_id::text],
        to_jsonb(v_choice),
        true)
  where s.room_id = p_room_id
    and coalesce((s.state_data ->> 'voting_open')::boolean, false)
  returning true into v_done;

  if v_done is null then
    return jsonb_build_object('ok', false, 'reason', 'VOTING_CLOSED');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- الإجابة الصحيحة للسؤال النشط، للمضيف (أو المدير) فقط.
-- الاستخدام: supabase.rpc('room_correct_answer', { p_room_id })
create or replace function public.room_correct_answer(p_room_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_answer text;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select q.correct_answer into v_answer
  from public.room_game_state s
  join public.questions_bank q on q.id = s.active_question_id
  where s.room_id = p_room_id;
  return v_answer;
end;
$$;

-- ---------------------------------------------------------------------
-- 10) الصلاحيات و RLS
-- ---------------------------------------------------------------------
alter table public.games           enable row level security;
alter table public.game_rooms      enable row level security;
alter table public.room_players    enable row level security;
alter table public.questions_bank  enable row level security;
alter table public.room_game_state enable row level security;

-- طبقة حماية إضافية فوق RLS: الزائر بلا جلسة (anon) يقرأ فقط.
grant usage on schema public to anon, authenticated, service_role;
grant select on public.games, public.game_rooms, public.room_players, public.room_game_state to anon, authenticated;
revoke insert, update, delete on public.games, public.game_rooms, public.room_players, public.room_game_state from anon;
grant insert, update, delete on public.game_rooms, public.room_players, public.room_game_state to authenticated;
grant insert, update, delete on public.games to authenticated;            -- مقيّد بسياسة المدير أدناه
revoke all on public.questions_bank from anon;
grant select, insert, update, delete on public.questions_bank to authenticated; -- مقيّد بسياسة المدير أدناه
grant select on public.questions_public to anon, authenticated;
grant all on public.games, public.game_rooms, public.room_players, public.questions_bank, public.room_game_state to service_role;
grant select on public.questions_public to service_role;

-- الدوال: المساعدة تُستدعى داخل السياسات لكل الأدوار، و RPC للمستخدمين بجلسة فقط.
revoke execute on function public.press_buzzer(uuid), public.cast_vote(uuid, text), public.room_correct_answer(uuid) from public, anon;
grant execute on function public.press_buzzer(uuid), public.cast_vote(uuid, text), public.room_correct_answer(uuid) to authenticated, service_role;
grant execute on function public.is_app_admin(), public.is_room_host(uuid), public.my_player_id(uuid), public.is_client_request() to anon, authenticated, service_role;
revoke execute on function public.generate_room_code() from public, anon, authenticated;
grant execute on function public.generate_room_code() to service_role;

-- games ---------------------------------------------------------------
drop policy if exists "games: read active" on public.games;
create policy "games: read active" on public.games
  for select to anon, authenticated
  using (is_active or public.is_app_admin());

drop policy if exists "games: admin manage" on public.games;
create policy "games: admin manage" on public.games
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- game_rooms ----------------------------------------------------------
drop policy if exists "rooms: public read" on public.game_rooms;
create policy "rooms: public read" on public.game_rooms
  for select to anon, authenticated
  using (true);

drop policy if exists "rooms: create as host" on public.game_rooms;
create policy "rooms: create as host" on public.game_rooms
  for insert to authenticated
  with check (
    host_id = auth.uid()
    and exists (select 1 from public.games g where g.id = game_id and g.is_active)
  );

drop policy if exists "rooms: host updates" on public.game_rooms;
create policy "rooms: host updates" on public.game_rooms
  for update to authenticated
  using (host_id = auth.uid() or public.is_app_admin())
  with check (host_id = auth.uid() or public.is_app_admin());

drop policy if exists "rooms: host deletes" on public.game_rooms;
create policy "rooms: host deletes" on public.game_rooms
  for delete to authenticated
  using (host_id = auth.uid() or public.is_app_admin());

-- room_players --------------------------------------------------------
drop policy if exists "players: public read" on public.room_players;
create policy "players: public read" on public.room_players
  for select to anon, authenticated
  using (true);

-- ينضم اللاعب بنفسه (بلا صفة مضيف)، أو يضيف المضيف لاعبًا محليًا أو نفسه كمضيف.
drop policy if exists "players: join" on public.room_players;
create policy "players: join" on public.room_players
  for insert to authenticated
  with check (
    (user_id = auth.uid() and (not is_host or public.is_room_host(room_id)))
    or (user_id is null and public.is_room_host(room_id))
    or public.is_app_admin()
  );

drop policy if exists "players: self or host updates" on public.room_players;
create policy "players: self or host updates" on public.room_players
  for update to authenticated
  using (user_id = auth.uid() or public.is_room_host(room_id) or public.is_app_admin())
  with check (user_id = auth.uid() or public.is_room_host(room_id) or public.is_app_admin());

drop policy if exists "players: leave or host removes" on public.room_players;
create policy "players: leave or host removes" on public.room_players
  for delete to authenticated
  using (user_id = auth.uid() or public.is_room_host(room_id) or public.is_app_admin());

-- room_game_state -----------------------------------------------------
drop policy if exists "state: public read" on public.room_game_state;
create policy "state: public read" on public.room_game_state
  for select to anon, authenticated
  using (true);

drop policy if exists "state: host writes" on public.room_game_state;
create policy "state: host writes" on public.room_game_state
  for all to authenticated
  using (public.is_room_host(room_id) or public.is_app_admin())
  with check (public.is_room_host(room_id) or public.is_app_admin());

-- questions_bank ------------------------------------------------------
-- القراءة المباشرة والكتابة للمدير فقط. اللاعبون يقرؤون questions_public.
drop policy if exists "questions: admin manage" on public.questions_bank;
create policy "questions: admin manage" on public.questions_bank
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- ---------------------------------------------------------------------
-- 11) Supabase Realtime
-- ---------------------------------------------------------------------
-- يبث تغييرات الغرف واللاعبين والحالة اللحظية للمشتركين (مع احترام RLS).
-- replica identity full يجعل أحداث التعديل والحذف تحمل الصف كاملًا.
alter table public.game_rooms      replica identity full;
alter table public.room_players    replica identity full;
alter table public.room_game_state replica identity full;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['game_rooms', 'room_players', 'room_game_state'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 12) بيانات تجريبية
-- ---------------------------------------------------------------------
insert into public.games (slug, title_ar, description_ar, min_players, max_players, is_active) values
  ('tactical-grid', 'شبكة التحدي',
   'لوحة أسئلة من فئات ونقاط متدرجة. فريقان أحمر وأزرق يتناوبان على اختيار الخانات، ولكل فريق مساعدات تُستخدم مرة واحدة.',
   2, 12, true),
  ('bluff-master', 'سيد الخداع',
   'يظهر سؤال بإجابة غير معروفة، فيكتب كل لاعب إجابة مزيفة مقنعة. ثم يختار الجميع ما يظنونه الصحيح: نقاط لمن يصيب، ونقاط لمن يخدع غيره.',
   3, 8, true),
  ('hex-letters', 'خلية الحروف',
   'لوحة خلايا سداسية لكل خلية حرف. فريقان يتسابقان بالجرس على الإجابة، والفائز بالخلية يقترب من وصل ضفتي اللوحة.',
   2, 10, true),
  ('heads-up', 'على راسك',
   'لاعب يرفع الجوال على رأسه دون أن يرى الكلمة، وفريقه يلمّح له. يخمّن أكبر عدد من الكلمات قبل انتهاء الوقت.',
   2, 10, true),
  ('social-mafia', 'المافيا',
   'أدوار سرية بين المواطنين والمافيا والطبيب والمحقق. نقاش في النهار وتصويت لإقصاء المشتبه به، وتحركات خفية في الليل.',
   5, 15, true)
on conflict (slug) do update set
  title_ar = excluded.title_ar,
  description_ar = excluded.description_ar,
  min_players = excluded.min_players,
  max_players = excluded.max_players,
  is_active = excluded.is_active;

-- شبكة التحدي: اختيار من متعدد بنقاط متدرجة.
insert into public.questions_bank (game_slug, category_ar, question_text, options, correct_answer, points, difficulty) values
  ('tactical-grid', 'ثقافة عامة', 'كم عدد أيام الأسبوع؟', '["5", "6", "7", "8"]', '7', 100, 'easy'),
  ('tactical-grid', 'ثقافة عامة', 'ما العملة الرسمية لليابان؟', '["الين", "الوون", "اليوان", "الروبية"]', 'الين', 200, 'easy'),
  ('tactical-grid', 'ثقافة عامة', 'من مؤلف رواية «البؤساء»؟', '["تشارلز ديكنز", "فيكتور هوغو", "ليو تولستوي", "ألكسندر دوما"]', 'فيكتور هوغو', 300, 'medium'),
  ('tactical-grid', 'جغرافيا', 'ما أكبر محيط في العالم؟', '["الأطلسي", "الهندي", "الهادئ", "المتجمد الشمالي"]', 'الهادئ', 100, 'easy'),
  ('tactical-grid', 'جغرافيا', 'ما عاصمة أستراليا؟', '["سيدني", "كانبرا", "ملبورن", "بيرث"]', 'كانبرا', 200, 'medium'),
  ('tactical-grid', 'جغرافيا', 'ما المضيق الذي يفصل بين أوروبا وأفريقيا؟', '["مضيق هرمز", "مضيق باب المندب", "مضيق جبل طارق", "مضيق البوسفور"]', 'مضيق جبل طارق', 300, 'medium'),
  ('tactical-grid', 'علوم', 'ما الرمز الكيميائي للذهب؟', '["Ag", "Au", "Gd", "Go"]', 'Au', 200, 'medium'),
  ('tactical-grid', 'علوم', 'ما العنصر الأكثر وفرة في الكون؟', '["الهيليوم", "الأكسجين", "الكربون", "الهيدروجين"]', 'الهيدروجين', 300, 'hard')
on conflict (game_slug, md5(question_text)) do nothing;

-- سيد الخداع: إجابة صحيحة مخفية وإجابات مزيفة جاهزة تُخلط بإجابات اللاعبين.
insert into public.questions_bank (game_slug, category_ar, question_text, correct_answer, fake_answers, points, difficulty) values
  ('bluff-master', 'طبيعة', 'المعدن الذي يكون سائلًا في درجة حرارة الغرفة هو ...', 'الزئبق', '["الرصاص", "القصدير", "الصوديوم"]', 200, 'easy'),
  ('bluff-master', 'حيوانات', 'عدد قلوب الأخطبوط هو ...', '3', '["2", "5", "8"]', 300, 'medium'),
  ('bluff-master', 'جغرافيا', 'أطول نهر في قارة آسيا هو نهر ...', 'اليانغتسي', '["الميكونغ", "الغانج", "الفرات"]', 300, 'medium'),
  ('bluff-master', 'جغرافيا', 'العاصمة الإدارية لجمهورية جنوب أفريقيا هي ...', 'بريتوريا', '["جوهانسبرغ", "ديربان", "سويتو"]', 400, 'hard')
on conflict (game_slug, md5(question_text)) do nothing;

-- خلية الحروف: سؤال لكل خلية، والإجابة تبدأ بحرف الخلية (يحكم المضيف عليها).
insert into public.questions_bank (game_slug, category_ar, question_text, correct_answer, points, difficulty) values
  ('hex-letters', 'حرف ز', 'حيوان يبدأ بحرف الزاي وله رقبة طويلة جدًا', 'زرافة', 100, 'easy'),
  ('hex-letters', 'حرف ف', 'فاكهة حمراء صغيرة تبدأ بحرف الفاء', 'فراولة', 100, 'easy'),
  ('hex-letters', 'حرف ع', 'أقرب كوكب إلى الشمس، يبدأ بحرف العين', 'عطارد', 100, 'medium'),
  ('hex-letters', 'حرف ر', 'عاصمة إيطاليا، تبدأ بحرف الراء', 'روما', 100, 'easy'),
  ('hex-letters', 'حرف س', 'وسيلة نقل بحرية كبيرة تبدأ بحرف السين', 'سفينة', 100, 'easy')
on conflict (game_slug, md5(question_text)) do nothing;

-- على راسك: بطاقات كلمات؛ النص هو الكلمة التي يخمّنها اللاعب.
insert into public.questions_bank (game_slug, category_ar, question_text, correct_answer, points, difficulty) values
  ('heads-up', 'حيوانات', 'أسد', 'أسد', 100, 'easy'),
  ('heads-up', 'حيوانات', 'فيل', 'فيل', 100, 'easy'),
  ('heads-up', 'مهن', 'طبيب', 'طبيب', 100, 'easy'),
  ('heads-up', 'مهن', 'طيار', 'طيار', 100, 'medium'),
  ('heads-up', 'أماكن', 'مطار', 'مطار', 100, 'easy'),
  ('heads-up', 'أماكن', 'مكتبة', 'مكتبة', 100, 'medium')
on conflict (game_slug, md5(question_text)) do nothing;

-- المافيا لا تحتاج أسئلة: الأدوار تُوزَّع من settings عند بدء الجولة.

-- غرفة تجريبية رمزها TEST7 للعبة شبكة التحدي، بفريقين وسؤال نشط.
-- مضيفها مستخدم وهمي، فلا يستطيع أحد التحكم بها من المتصفح؛ هي للعرض والاشتراك اللحظي.
-- لحذفها لاحقًا: delete from public.game_rooms where room_code = 'TEST7';
insert into public.game_rooms (room_code, game_id, host_id, status, current_round, settings)
select 'TEST7', g.id, '00000000-0000-4000-8000-000000000001', 'playing', 1,
       '{"question_seconds": 60, "steal_seconds": 30, "host_is_player": false, "team_mode": true,
         "rules": {"power_ups": ["double", "shield", "swap"], "steal_ratio": 0.5}}'::jsonb
from public.games g
where g.slug = 'tactical-grid'
on conflict (room_code) do nothing;

insert into public.room_players (room_id, user_id, player_name, team_color, score, is_host)
select r.id, p.user_id, p.player_name, p.team_color, p.score, p.is_host
from public.game_rooms r
cross join (values
  ('00000000-0000-4000-8000-000000000001'::uuid, 'المضيف', null::text, 0, true),
  (null::uuid, 'نورة', 'red', 300, false),
  (null::uuid, 'فهد', 'red', 100, false),
  (null::uuid, 'سارة', 'blue', 200, false),
  (null::uuid, 'خالد', 'blue', 0, false)
) as p(user_id, player_name, team_color, score, is_host)
where r.room_code = 'TEST7'
on conflict do nothing;

update public.room_game_state s
set active_question_id = q.id,
    state_data = jsonb_build_object(
      'phase', 'question',
      'timer_ends_at', to_jsonb(now() + interval '60 seconds'),
      'buzzer_open', true,
      'buzzer', null,
      'voting_open', false,
      'votes', '{}'::jsonb,
      'power_ups', jsonb_build_object('red', jsonb_build_array('double', 'shield'), 'blue', jsonb_build_array('swap')))
from public.game_rooms r, public.questions_bank q
where s.room_id = r.id
  and r.room_code = 'TEST7'
  and q.game_slug = 'tactical-grid'
  and q.question_text = 'ما عاصمة أستراليا؟'
  and s.active_question_id is null;

commit;
