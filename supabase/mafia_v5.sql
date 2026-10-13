-- =============================================================================
-- المافيا، الإصدار 5. يُشغَّل بعد mafia_v4.sql، وتشغيله مرة ثانية آمن.
--
-- 1) الجاسوس: حليف المافيا. يرى في جواله من هم المافيا (وهم يرونه)، ولا يختار ضحية،
--    ويفوز مع المافيا. المحقق يراه «ليس مافيا». يُحسب مع المافيا في التساوي.
-- 2) «من صوّت على من» للراوي وحده: الحالة العامة تحمل عدد الأصوات لكل لاعب فقط،
--    والتفاصيل في جدول لا يقرؤه إلا الراوي عبر mafia_vote_details.
-- 3) الراوي يرى أدوار الجميع من بداية التوزيع: mafia_roles.
-- 4) الراوي: المضيف (كما كان) أو لاعب عشوائي، والمضيف عندها يلعب مثل الباقين.
-- 5) مؤقت التصويت: عند انتهائه يصوّت النظام عشوائيًا عن كل من لم يصوّت، ثم تُعلن النتيجة.
-- =============================================================================

-- الجداول ----------------------------------------------------------------------

alter table public.room_mafia_roles drop constraint if exists room_mafia_roles_role_check;
alter table public.room_mafia_roles add constraint room_mafia_roles_role_check
  check (role in ('mafia', 'citizen', 'doctor', 'detective', 'jester', 'mayor', 'bodyguard', 'sniper', 'seer', 'spy'));

alter table public.room_mafia_votes add column if not exists auto boolean not null default false;

-- سجل الأصوات بالأسماء، للراوي فقط (لا سياسات قراءة: يُقرأ عبر mafia_vote_details).
create table if not exists public.room_mafia_vote_log (
  room_id   uuid not null references public.game_rooms (id) on delete cascade,
  round     int not null,
  stage     int not null default 1,
  voter_id  uuid references public.room_players (id) on delete cascade,
  target_id uuid references public.room_players (id) on delete cascade,
  weight    int not null default 1,
  auto      boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists room_mafia_vote_log_room_idx on public.room_mafia_vote_log (room_id, round);
create index if not exists room_mafia_vote_log_voter_idx on public.room_mafia_vote_log (voter_id);
create index if not exists room_mafia_vote_log_target_idx on public.room_mafia_vote_log (target_id);
alter table public.room_mafia_vote_log enable row level security;
revoke all on public.room_mafia_vote_log from anon, authenticated;

-- أدوات --------------------------------------------------------------------------

create or replace function public.mafia_role_ar(p_role text)
returns text language sql immutable set search_path = public as $$
  select case p_role when 'mafia' then 'مافيا' when 'citizen' then 'مواطنًا' when 'doctor' then 'الطبيب'
    when 'detective' then 'المحقق' when 'jester' then 'المهرّج' when 'mayor' then 'العمدة'
    when 'bodyguard' then 'الحارس' when 'sniper' then 'القنّاص' when 'seer' then 'العرّافة'
    when 'spy' then 'الجاسوس' else '' end;
$$;

-- هل المستخدم الحالي هو الراوي؟ المضيف إن لم يُختر راوٍ من اللاعبين.
create or replace function public.mafia_is_narrator(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_app_admin() then true
    when (select s.state_data->>'narrator_id' from public.room_game_state s where s.room_id = p_room_id) is null
      then public.is_room_host(p_room_id)
    else (select (s.state_data->>'narrator_id')::uuid from public.room_game_state s where s.room_id = p_room_id)
         = public.my_player_id(p_room_id)
  end;
$$;
revoke all on function public.mafia_is_narrator(uuid) from public, anon;
grant execute on function public.mafia_is_narrator(uuid) to authenticated;

-- المافيا تفوز إذا ساوى عددها مع الجاسوس عدد الباقين.
create or replace function public.mafia_winner(p_room_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when x.mafia_alive = 0 then 'citizens'
    when x.mafia_alive + x.spy_alive >= x.other_alive then 'mafia'
    else null
  end
  from (
    select count(*) filter (where r.role = 'mafia' and r.alive) as mafia_alive,
           count(*) filter (where r.role = 'spy' and r.alive) as spy_alive,
           count(*) filter (where r.role not in ('mafia', 'spy') and r.alive) as other_alive
    from public.room_mafia_roles r
    where r.room_id = p_room_id
  ) x;
$$;
revoke all on function public.mafia_winner(uuid) from public, anon;

-- البدء ------------------------------------------------------------------------

create or replace function public.mafia_start(p_room_id uuid, p_settings jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_players uuid[];
  v_n int;
  v_mafia int;
  v_spy int;
  v_roles text[] := '{}';
  v_settings jsonb;
  v_day int;
  v_vote int;
  v_mayor uuid;
  v_random boolean := coalesce(p_settings->>'narrator', 'host') = 'random';
  v_narrator uuid;
  v_narrator_name text;
  i int;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  if not exists (select 1 from public.game_rooms r where r.id = p_room_id and r.status = 'playing') then
    return jsonb_build_object('ok', false, 'reason', 'ROOM_NOT_PLAYING');
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NO_STATE');
  end if;
  if coalesce(v_state.state_data->>'phase', '') <> '' then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_STARTED');
  end if;

  if v_random then
    -- كل من في الغرفة (والمضيف معهم)، وأولهم بالقرعة هو الراوي.
    select array_agg(p.id order by random()) into v_players from public.room_players p where p.room_id = p_room_id;
    v_narrator := v_players[1];
    v_players := v_players[2:];
    select player_name into v_narrator_name from public.room_players where id = v_narrator;
  else
    select array_agg(p.id order by random()) into v_players
      from public.room_players p where p.room_id = p_room_id and not p.is_host;
  end if;
  v_n := coalesce(array_length(v_players, 1), 0);
  if v_n < 5 then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ENOUGH_PLAYERS');
  end if;
  if v_n > 14 then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY_PLAYERS');
  end if;

  v_mafia := case when jsonb_typeof(p_settings->'mafia') = 'number' and (p_settings->>'mafia')::int > 0
                  then (p_settings->>'mafia')::int
                  else case when v_n >= 10 then 3 when v_n >= 7 then 2 else 1 end end;
  v_spy := case when coalesce((p_settings->>'spy')::boolean, false) then 1 else 0 end;
  if (v_mafia + v_spy) * 2 >= v_n then
    return jsonb_build_object('ok', false, 'reason', 'BAD_MAFIA_COUNT');
  end if;
  v_day := coalesce((p_settings->>'day_seconds')::int, 0);
  if v_day not in (0, 60, 120, 180, 300) then
    v_day := 0;
  end if;
  v_vote := coalesce((p_settings->>'vote_seconds')::int, 0);
  if v_vote not in (0, 30, 45, 60, 90, 120) then
    v_vote := 0;
  end if;
  v_settings := jsonb_build_object(
    'mafia', v_mafia,
    'auto_mafia', not (jsonb_typeof(p_settings->'mafia') = 'number' and (p_settings->>'mafia')::int > 0),
    'reveal_roles', coalesce((p_settings->>'reveal_roles')::boolean, false),
    'day_seconds', v_day,
    'vote_seconds', v_vote,
    'narrator', case when v_random then 'random' else 'host' end,
    'jester', coalesce((p_settings->>'jester')::boolean, false),
    'mayor', coalesce((p_settings->>'mayor')::boolean, false),
    'bodyguard', coalesce((p_settings->>'bodyguard')::boolean, false),
    'sniper', coalesce((p_settings->>'sniper')::boolean, false),
    'seer', coalesce((p_settings->>'seer')::boolean, false),
    'spy', v_spy = 1);

  for i in 1..v_mafia loop
    v_roles := array_append(v_roles, 'mafia');
  end loop;
  v_roles := v_roles || array['doctor', 'detective']::text[];
  if v_spy = 1 then v_roles := array_append(v_roles, 'spy'); end if;
  if (v_settings->>'bodyguard')::boolean then v_roles := array_append(v_roles, 'bodyguard'); end if;
  if (v_settings->>'mayor')::boolean then v_roles := array_append(v_roles, 'mayor'); end if;
  if (v_settings->>'jester')::boolean then v_roles := array_append(v_roles, 'jester'); end if;
  if (v_settings->>'sniper')::boolean then v_roles := array_append(v_roles, 'sniper'); end if;
  if (v_settings->>'seer')::boolean then v_roles := array_append(v_roles, 'seer'); end if;
  if array_length(v_roles, 1) >= v_n then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY_ROLES');
  end if;

  delete from public.room_mafia_roles where room_id = p_room_id;
  delete from public.room_mafia_actions where room_id = p_room_id;
  delete from public.room_mafia_votes where room_id = p_room_id;
  delete from public.room_mafia_vote_log where room_id = p_room_id;
  for i in 1..v_n loop
    insert into public.room_mafia_roles (room_id, player_id, role)
    values (p_room_id, v_players[i], coalesce(v_roles[i], 'citizen'));
    if v_roles[i] = 'mayor' then
      v_mayor := v_players[i];
    end if;
  end loop;

  update public.room_game_state
    set state_data = state_data || jsonb_build_object(
      'phase', 'night', 'round', 1, 'winner', null, 'last_result', null, 'runoff', null,
      'settings', v_settings, 'mayor', v_mayor::text, 'last_votes', null, 'last_tally', null,
      'day_ends_at', null, 'vote_ends_at', null,
      'narrator_id', v_narrator::text, 'narrator_name', v_narrator_name,
      'log', '[]'::jsonb, 'players_count', v_n, 'last_shot', null, 'last_settings', null)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'mafia', v_mafia, 'narrator', v_narrator_name);
end;
$$;

-- دوري ---------------------------------------------------------------------------

create or replace function public.mafia_my_role(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_sd jsonb;
  v_role text;
  v_alive boolean;
  v_phase text;
  v_round int;
  v_inspections jsonb := '[]'::jsonb;
  v_pending text;
  v_pick uuid;
begin
  if v_me is null then
    return null;
  end if;
  select s.state_data into v_sd from public.room_game_state s where s.room_id = p_room_id;
  if v_sd->>'narrator_id' is not null and (v_sd->>'narrator_id')::uuid = v_me then
    return jsonb_build_object('started', true, 'narrator', true);
  end if;
  select r.role, r.alive into v_role, v_alive
    from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = v_me;
  if not found then
    return jsonb_build_object('started', false);
  end if;
  v_phase := v_sd->>'phase';
  v_round := coalesce((v_sd->>'round')::int, 1);

  if v_role = 'detective' then
    select coalesce(jsonb_agg(jsonb_build_object('round', a.round, 'name', p.player_name, 'mafia', t.role = 'mafia') order by a.round), '[]'::jsonb)
      into v_inspections
      from public.room_mafia_actions a
      join public.room_mafia_roles t on t.room_id = a.room_id and t.player_id = a.target_id
      join public.room_players p on p.id = a.target_id
     where a.room_id = p_room_id and a.actor_id = v_me and a.kind = 'inspect'
       and (a.round < v_round or v_phase <> 'night');
    if v_phase = 'night' then
      select p.player_name into v_pending
        from public.room_mafia_actions a join public.room_players p on p.id = a.target_id
       where a.room_id = p_room_id and a.actor_id = v_me and a.round = v_round;
    end if;
  end if;

  if v_phase = 'night' then
    select a.target_id into v_pick from public.room_mafia_actions a where a.room_id = p_room_id and a.round = v_round and a.actor_id = v_me;
  elsif v_phase = 'vote' then
    select v.target_id into v_pick from public.room_mafia_votes v where v.room_id = p_room_id and v.round = v_round and v.voter_id = v_me;
  end if;

  return jsonb_build_object(
    'started', true,
    'role', v_role,
    'alive', v_alive,
    -- المافيا ترى زملاءها، والجاسوس يرى المافيا.
    'teammates', case when v_role in ('mafia', 'spy') then (
        select coalesce(jsonb_agg(p.player_name order by p.joined_at), '[]'::jsonb)
        from public.room_mafia_roles m
        join public.room_players p on p.id = m.player_id
        where m.room_id = p_room_id and m.role = 'mafia' and m.player_id <> v_me
      ) else '[]'::jsonb end,
    -- والمافيا ترى الجاسوس حليفًا لها.
    'spies', case when v_role = 'mafia' then (
        select coalesce(jsonb_agg(p.player_name order by p.joined_at), '[]'::jsonb)
        from public.room_mafia_roles m
        join public.room_players p on p.id = m.player_id
        where m.room_id = p_room_id and m.role = 'spy'
      ) else '[]'::jsonb end,
    'inspect', case when jsonb_array_length(v_inspections) > 0
                    then case when (v_inspections->-1->>'mafia')::boolean then 'mafia' else 'not_mafia' end end,
    'inspections', v_inspections,
    'pending_inspect', v_pending,
    'my_pick', v_pick,
    'last_save', case when v_role = 'doctor' then (
        select a.target_id from public.room_mafia_actions a
         where a.room_id = p_room_id and a.actor_id = v_me and a.kind = 'save' and a.round = v_round - 1) end,
    'self_save_used', case when v_role = 'doctor' then exists (
        select 1 from public.room_mafia_actions a
         where a.room_id = p_room_id and a.actor_id = v_me and a.kind = 'save' and a.target_id = v_me and a.round < v_round) end,
    'shot_used', case when v_role = 'sniper' then exists (
        select 1 from public.room_mafia_actions a where a.room_id = p_room_id and a.actor_id = v_me and a.kind = 'shoot') end,
    'seer_result', case when v_role = 'seer' then (
        select jsonb_build_object('name', p.player_name, 'role', t.role)
          from public.room_mafia_actions a
          join public.room_mafia_roles t on t.room_id = a.room_id and t.player_id = a.target_id
          join public.room_players p on p.id = a.target_id
         where a.room_id = p_room_id and a.actor_id = v_me and a.kind = 'reveal' limit 1) end
  );
end;
$$;

-- الليل: المافيا لا تختار زميلًا ولا الجاسوس.
create or replace function public.mafia_night_action(p_room_id uuid, p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_state public.room_game_state%rowtype;
  v_round int;
  v_role text;
  v_alive boolean;
  v_target_role text;
  v_target_alive boolean;
  v_kind text;
begin
  if v_me is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id;
  if not found or coalesce(v_state.state_data->>'phase', '') <> 'night' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_round := coalesce((v_state.state_data->>'round')::int, 1);

  select r.role, r.alive into v_role, v_alive
    from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = v_me;
  if not found or not v_alive then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ACTIVE');
  end if;
  v_kind := case v_role when 'mafia' then 'kill' when 'doctor' then 'save' when 'detective' then 'inspect'
                        when 'bodyguard' then 'guard' end;
  if v_kind is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTION');
  end if;

  select r.role, r.alive into v_target_role, v_target_alive
    from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = p_target_id;
  if not found or not v_target_alive then
    return jsonb_build_object('ok', false, 'reason', 'BAD_TARGET');
  end if;
  if v_kind = 'kill' and v_target_role in ('mafia', 'spy') then
    return jsonb_build_object('ok', false, 'reason', 'BAD_TARGET');
  end if;
  if v_kind <> 'save' and p_target_id = v_me then
    return jsonb_build_object('ok', false, 'reason', 'BAD_TARGET');
  end if;

  if v_kind = 'inspect' and exists (
    select 1 from public.room_mafia_actions a where a.room_id = p_room_id and a.round = v_round and a.actor_id = v_me
  ) then
    return jsonb_build_object('ok', false, 'reason', 'LOCKED');
  end if;

  if v_kind = 'save' then
    if exists (
      select 1 from public.room_mafia_actions a
       where a.room_id = p_room_id and a.round = v_round - 1 and a.actor_id = v_me and a.kind = 'save' and a.target_id = p_target_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'SAME_SAVE');
    end if;
    if p_target_id = v_me and exists (
      select 1 from public.room_mafia_actions a
       where a.room_id = p_room_id and a.round < v_round and a.actor_id = v_me and a.kind = 'save' and a.target_id = v_me
    ) then
      return jsonb_build_object('ok', false, 'reason', 'SELF_USED');
    end if;
  end if;

  insert into public.room_mafia_actions (room_id, round, actor_id, kind, target_id)
    values (p_room_id, v_round, v_me, v_kind, p_target_id)
    on conflict (room_id, round, actor_id)
    do update set kind = excluded.kind, target_id = excluded.target_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- قائمة اللاعبين: بلا الراوي.
create or replace function public.mafia_players(p_room_id uuid)
returns table (player_id uuid, player_name text, alive boolean, player_role text, is_mayor boolean)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select s.state_data->>'phase' as phase,
           coalesce((s.state_data->'settings'->>'reveal_roles')::boolean, false) as reveal,
           nullif(s.state_data->>'narrator_id', '')::uuid as narrator
      from public.room_game_state s where s.room_id = p_room_id
  )
  select p.id,
         p.player_name,
         coalesce(r.alive, true),
         case when (select phase from s) = 'over' or ((select reveal from s) and r.alive = false) or r.role = 'mayor'
              then r.role end,
         coalesce(r.role = 'mayor', false)
  from public.room_players p
  left join public.room_mafia_roles r on r.room_id = p.room_id and r.player_id = p.id
  where p.room_id = p_room_id
    and case when (select narrator from s) is null then not p.is_host else p.id <> (select narrator from s) end
  order by p.joined_at;
$$;

-- أدوار الجميع: للراوي فقط، من بداية التوزيع.
create or replace function public.mafia_roles(p_room_id uuid)
returns table (player_id uuid, player_name text, role text, alive boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.mafia_is_narrator(p_room_id) then
    return;
  end if;
  return query
    select p.id, p.player_name, r.role, r.alive
      from public.room_mafia_roles r join public.room_players p on p.id = r.player_id
     where r.room_id = p_room_id
     order by case r.role when 'mafia' then 0 when 'spy' then 1 else 2 end, p.joined_at;
end;
$$;
revoke all on function public.mafia_roles(uuid) from public, anon;
grant execute on function public.mafia_roles(uuid) to authenticated;

-- تفاصيل الأصوات بالأسماء: للراوي فقط.
create or replace function public.mafia_vote_details(p_room_id uuid)
returns table (round int, stage int, voter text, target text, weight int, auto boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.mafia_is_narrator(p_room_id) then
    return;
  end if;
  return query
    select l.round, l.stage, vp.player_name, tp.player_name, l.weight, l.auto
      from public.room_mafia_vote_log l
      join public.room_players vp on vp.id = l.voter_id
      join public.room_players tp on tp.id = l.target_id
     where l.room_id = p_room_id
     order by l.round desc, l.stage desc, tp.player_name, vp.player_name;
end;
$$;
revoke all on function public.mafia_vote_details(uuid) from public, anon;
grant execute on function public.mafia_vote_details(uuid) to authenticated;

-- التقدّم: الليل للراوي فقط.
create or replace function public.mafia_progress(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_phase text;
  v_round int;
  v_narrator boolean := public.mafia_is_narrator(p_room_id);
begin
  if not (v_narrator or public.is_room_host(p_room_id) or public.my_player_id(p_room_id) is not null) then
    return null;
  end if;
  select s.state_data->>'phase', coalesce((s.state_data->>'round')::int, 1) into v_phase, v_round
    from public.room_game_state s where s.room_id = p_room_id;
  if v_phase = 'vote' then
    return jsonb_build_object('phase', 'vote',
      'done', (select count(*) from public.room_mafia_votes v
                 join public.room_mafia_roles r on r.room_id = v.room_id and r.player_id = v.voter_id and r.alive
                where v.room_id = p_room_id and v.round = v_round),
      'total', (select count(*) from public.room_mafia_roles r where r.room_id = p_room_id and r.alive));
  end if;
  if v_phase = 'night' and v_narrator then
    return jsonb_build_object('phase', 'night',
      'done', (select count(*) from public.room_mafia_actions a
                 join public.room_mafia_roles r on r.room_id = a.room_id and r.player_id = a.actor_id and r.alive
                where a.room_id = p_room_id and a.round = v_round and a.kind in ('kill', 'save', 'inspect', 'guard')),
      'total', (select count(*) from public.room_mafia_roles r
                 where r.room_id = p_room_id and r.alive and r.role in ('mafia', 'doctor', 'detective', 'bodyguard')),
      'mafia_split', (select count(distinct a.target_id) > 1 from public.room_mafia_actions a
                       where a.room_id = p_room_id and a.round = v_round and a.kind = 'kill'));
  end if;
  return jsonb_build_object('phase', v_phase);
end;
$$;

-- الفجر: للراوي.
create or replace function public.mafia_resolve_night(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_round int;
  v_kill uuid;
  v_save uuid;
  v_guard uuid;
  v_guard_by uuid;
  v_victim uuid;
  v_role text;
  v_name text;
  v_winner text;
  v_result text;
  v_day int;
begin
  if not public.mafia_is_narrator(p_room_id) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or coalesce(v_state.state_data->>'phase', '') <> 'night' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_sd := v_state.state_data;
  v_round := coalesce((v_sd->>'round')::int, 1);

  select a.target_id into v_kill
    from public.room_mafia_actions a
    where a.room_id = p_room_id and a.round = v_round and a.kind = 'kill'
    group by a.target_id
    order by count(*) desc, random()
    limit 1;
  select a.target_id into v_save
    from public.room_mafia_actions a
    where a.room_id = p_room_id and a.round = v_round and a.kind = 'save'
    limit 1;
  select a.target_id, a.actor_id into v_guard, v_guard_by
    from public.room_mafia_actions a
    join public.room_mafia_roles r on r.room_id = a.room_id and r.player_id = a.actor_id and r.alive
    where a.room_id = p_room_id and a.round = v_round and a.kind = 'guard'
    limit 1;

  if v_kill is null or v_kill = v_save then
    v_victim := null;
  elsif v_kill = v_guard then
    v_victim := v_guard_by;
  else
    v_victim := v_kill;
  end if;

  if v_victim is not null then
    update public.room_mafia_roles set alive = false where room_id = p_room_id and player_id = v_victim
      returning role into v_role;
    select p.player_name into v_name from public.room_players p where p.id = v_victim;
    v_result := 'قُتل ' || coalesce(v_name, 'لاعب') || ' هذه الليلة'
      || case when coalesce((v_sd->'settings'->>'reveal_roles')::boolean, false) then '، وكان ' || public.mafia_role_ar(v_role) else '' end
      || '.';
  else
    v_result := 'لم يُقتل أحد هذه الليلة.';
  end if;

  v_winner := public.mafia_winner(p_room_id);
  v_day := coalesce((v_sd->'settings'->>'day_seconds')::int, 0);
  update public.room_game_state
    set state_data = state_data || jsonb_build_object(
      'phase', case when v_winner is null then 'day' else 'over' end,
      'winner', v_winner,
      'runoff', null,
      'last_result', v_result,
      'day_ends_at', case when v_winner is null and v_day > 0 then to_jsonb(now() + make_interval(secs => v_day)) else null end,
      'log', coalesce(v_sd->'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('round', v_round, 'type', 'night', 'text', v_result)))
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'winner', v_winner);
end;
$$;

-- فتح التصويت: للراوي، ومعه مؤقت التصويت إن ضُبط.
create or replace function public.mafia_open_vote(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secs int;
begin
  if not public.mafia_is_narrator(p_room_id) then
    raise exception 'HOST_ONLY';
  end if;
  select coalesce((s.state_data->'settings'->>'vote_seconds')::int, 0) into v_secs
    from public.room_game_state s where s.room_id = p_room_id and s.state_data->>'phase' = 'day';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  update public.room_game_state
    set state_data = state_data || jsonb_build_object('phase', 'vote', 'runoff', null, 'day_ends_at', null,
      'vote_ends_at', case when v_secs > 0 then to_jsonb(now() + make_interval(secs => v_secs)) else null end)
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- حسم التصويت (داخلي): النتيجة للجميع بعدد الأصوات فقط، والتفاصيل في سجل الراوي.
create or replace function public.mafia_close_vote_core(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_round int;
  v_stage int;
  v_top uuid;
  v_top_count int;
  v_ties int;
  v_tied jsonb;
  v_names text;
  v_name text;
  v_role text;
  v_winner text;
  v_result text;
  v_runoff jsonb;
  v_tally jsonb;
  v_secs int;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or coalesce(v_state.state_data->>'phase', '') <> 'vote' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_sd := v_state.state_data;
  v_round := coalesce((v_sd->>'round')::int, 1);
  v_runoff := v_sd->'runoff';
  v_stage := case when jsonb_typeof(v_runoff) = 'array' then 2 else 1 end;
  v_secs := coalesce((v_sd->'settings'->>'vote_seconds')::int, 0);

  -- سجل الراوي: من صوّت على من.
  insert into public.room_mafia_vote_log (room_id, round, stage, voter_id, target_id, weight, auto)
  select v.room_id, v.round, v_stage, v.voter_id, v.target_id, case when r.role = 'mayor' then 2 else 1 end, v.auto
    from public.room_mafia_votes v
    join public.room_mafia_roles r on r.room_id = v.room_id and r.player_id = v.voter_id and r.alive
   where v.room_id = p_room_id and v.round = v_round;

  -- للجميع: عدد الأصوات لكل لاعب.
  select coalesce(jsonb_agg(jsonb_build_object('target', tp.player_name, 'votes', t.c) order by t.c desc, tp.player_name), '[]'::jsonb)
    into v_tally
    from (
      select v.target_id, sum(case when r.role = 'mayor' then 2 else 1 end) as c
        from public.room_mafia_votes v
        join public.room_mafia_roles r on r.room_id = v.room_id and r.player_id = v.voter_id and r.alive
       where v.room_id = p_room_id and v.round = v_round
       group by v.target_id
    ) t join public.room_players tp on tp.id = t.target_id;

  with t as (
    select v.target_id, sum(case when r.role = 'mayor' then 2 else 1 end) as c
      from public.room_mafia_votes v
      join public.room_mafia_roles r on r.room_id = v.room_id and r.player_id = v.voter_id and r.alive
     where v.room_id = p_room_id and v.round = v_round
     group by v.target_id
  )
  select (select t.target_id from t order by t.c desc limit 1), (select max(t.c) from t)
    into v_top, v_top_count;
  with t as (
    select v.target_id, sum(case when r.role = 'mayor' then 2 else 1 end) as c
      from public.room_mafia_votes v
      join public.room_mafia_roles r on r.room_id = v.room_id and r.player_id = v.voter_id and r.alive
     where v.room_id = p_room_id and v.round = v_round
     group by v.target_id
  )
  select count(*), coalesce(jsonb_agg(t.target_id::text), '[]'::jsonb) into v_ties, v_tied from t where t.c = v_top_count;

  if v_top is not null and v_ties > 1 and jsonb_typeof(v_runoff) is distinct from 'array' then
    select string_agg(p.player_name, ' و' order by p.joined_at) into v_names
      from public.room_players p where v_tied @> to_jsonb(p.id::text);
    v_result := 'تعادل بين ' || coalesce(v_names, 'لاعبين') || '. صوّتوا مرة ثانية بينهم فقط.';
    delete from public.room_mafia_votes where room_id = p_room_id and round = v_round;
    update public.room_game_state
      set state_data = state_data || jsonb_build_object(
        'runoff', v_tied, 'last_result', v_result, 'last_tally', v_tally, 'last_votes', null,
        'vote_ends_at', case when v_secs > 0 then to_jsonb(now() + make_interval(secs => v_secs)) else null end,
        'log', coalesce(v_sd->'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('round', v_round, 'type', 'vote', 'text', v_result, 'tally', v_tally)))
      where room_id = p_room_id;
    return jsonb_build_object('ok', true, 'runoff', true);
  end if;

  if v_top is not null and v_ties = 1 then
    update public.room_mafia_roles set alive = false where room_id = p_room_id and player_id = v_top
      returning role into v_role;
    select p.player_name into v_name from public.room_players p where p.id = v_top;
    if v_role = 'jester' then
      v_result := 'أُقصي ' || coalesce(v_name, 'لاعب') || ' بالتصويت، وكان المهرّج! فاز المهرّج.';
      v_winner := 'jester';
    else
      v_result := 'أُقصي ' || coalesce(v_name, 'لاعب') || ' بالتصويت'
        || case when coalesce((v_sd->'settings'->>'reveal_roles')::boolean, false) then '، وكان ' || public.mafia_role_ar(v_role) else '' end
        || '.';
    end if;
  elsif v_top is null then
    v_result := 'لم يصوّت أحد، لم يُقصَ أحد.';
  else
    v_result := 'تعادل مرة ثانية، لم يُقصَ أحد.';
  end if;

  v_winner := coalesce(v_winner, public.mafia_winner(p_room_id));
  update public.room_game_state
    set state_data = state_data || jsonb_build_object(
      'phase', case when v_winner is null then 'night' else 'over' end,
      'round', case when v_winner is null then v_round + 1 else v_round end,
      'winner', v_winner,
      'runoff', null,
      'vote_ends_at', null,
      'last_result', v_result,
      'last_tally', v_tally,
      'last_votes', null,
      'log', coalesce(v_sd->'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('round', v_round, 'type', 'vote', 'text', v_result, 'tally', v_tally)))
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'winner', v_winner);
end;
$$;
revoke all on function public.mafia_close_vote_core(uuid) from public, anon, authenticated;

-- إغلاق التصويت: للراوي.
create or replace function public.mafia_close_vote(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mafia_is_narrator(p_room_id) then
    raise exception 'HOST_ONLY';
  end if;
  return public.mafia_close_vote_core(p_room_id);
end;
$$;

-- انتهى وقت التصويت: النظام يصوّت عشوائيًا عن كل من لم يصوّت، ثم يُغلق التصويت.
-- يستدعيه الراوي، أو أي لاعب في الغرفة إن غاب جهاز الراوي.
create or replace function public.mafia_vote_timeout(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_round int;
  v_runoff jsonb;
  v_ends timestamptz;
  v_voter record;
  v_target uuid;
begin
  if not (public.mafia_is_narrator(p_room_id) or public.is_room_host(p_room_id) or public.my_player_id(p_room_id) is not null) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if coalesce(v_sd->>'phase', '') <> 'vote' or v_sd->>'vote_ends_at' is null then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_ends := (v_sd->>'vote_ends_at')::timestamptz;
  if now() < v_ends - interval '1 second' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_YET');
  end if;
  v_round := coalesce((v_sd->>'round')::int, 1);
  v_runoff := v_sd->'runoff';

  for v_voter in
    select r.player_id from public.room_mafia_roles r
     where r.room_id = p_room_id and r.alive
       and not exists (select 1 from public.room_mafia_votes v where v.room_id = p_room_id and v.round = v_round and v.voter_id = r.player_id)
  loop
    select t.player_id into v_target
      from public.room_mafia_roles t
     where t.room_id = p_room_id and t.alive and t.player_id <> v_voter.player_id
       and (jsonb_typeof(v_runoff) is distinct from 'array' or v_runoff @> to_jsonb(t.player_id::text))
     order by random() limit 1;
    if v_target is not null then
      insert into public.room_mafia_votes (room_id, round, voter_id, target_id, auto)
        values (p_room_id, v_round, v_voter.player_id, v_target, true)
        on conflict (room_id, round, voter_id) do nothing;
    end if;
  end loop;

  return public.mafia_close_vote_core(p_room_id);
end;
$$;
revoke all on function public.mafia_vote_timeout(uuid) from public, anon;
grant execute on function public.mafia_vote_timeout(uuid) to authenticated;

-- مباراة جديدة: تُمسح أيضًا سجلات الأصوات.
create or replace function public.mafia_reset(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NO_STATE');
  end if;
  if coalesce(v_sd->>'phase', '') <> 'over' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_OVER');
  end if;
  delete from public.room_mafia_roles where room_id = p_room_id;
  delete from public.room_mafia_actions where room_id = p_room_id;
  delete from public.room_mafia_votes where room_id = p_room_id;
  delete from public.room_mafia_vote_log where room_id = p_room_id;
  update public.room_game_state
    set active_question_id = null,
        state_data = jsonb_build_object('last_settings', v_sd->'settings')
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;


notify pgrst, 'reload schema';
