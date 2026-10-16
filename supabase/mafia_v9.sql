-- =============================================================================
-- «المافيا»، الإصدار 9: للعب في الديوانية. يُشغَّل بعد mafia_v8.sql و site_v1.sql، وتشغيله مرة ثانية آمن.
--
-- 1) الطرد أو الخروج من الغرفة يعيد حساب الفائز فورًا.
-- 2) من لا يصوّت حتى انتهاء الوقت ممتنع: لا تصويت عشوائي عنه.
-- 3) «المقتولون يرون الأدوار» مقفول افتراضيًا.
-- 4) الترشيح (اختياري): الراوي يختار 2 أو 3 مرشحين، والتصويت عليهم فقط.
-- 5) التصويت الشفوي: الراوي يختار من خرج، أو يكتب عدد الأصوات لكل لاعب (mafia_oral_result).
-- 6) كل اللاعبين يلمسون جوالهم ليلًا: من بلا دور ليلي يختار «من تشك فيه» (لا يؤثر على اللعب)،
--    وفي النهاية يظهر «أكثر من اشتُبه فيه».
-- 7) الراوي يرى من صوّت على من أثناء التصويت.
-- 8) خيار «الليلة الأولى بلا قتل».
-- =============================================================================

do $$
begin
  if to_regprocedure('public.mafia_night_timeout(uuid)') is null or to_regclass('public.app_migrations') is null then
    raise exception 'شغّل الملفات حتى mafia_v8.sql أولًا، ثم mafia_v9.sql.';
  end if;
end $$;

-- الاشتباه الليلي: جدول مستقل (لا يتعارض مع رصاصة القنّاص أو كشف العرّافة في الجولة نفسها).
create table if not exists public.room_mafia_suspects (
  room_id   uuid not null references public.game_rooms (id) on delete cascade,
  round     int not null,
  actor_id  uuid not null references public.room_players (id) on delete cascade,
  target_id uuid not null references public.room_players (id) on delete cascade,
  primary key (room_id, round, actor_id)
);
alter table public.room_mafia_suspects enable row level security;
revoke all on public.room_mafia_suspects from anon, authenticated;

-- البداية: الإعدادات الجديدة.
create or replace function public.mafia_start(p_room_id uuid, p_settings jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
  v_night int;
  v_mayor uuid;
  v_random boolean := coalesce(p_settings->>'narrator', 'host') = 'random';
  v_narrator uuid;
  v_narrator_name text;
  v_lovers uuid[];
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
  v_night := coalesce((p_settings->>'night_seconds')::int, 0);
  if v_night not in (0, 45, 60, 90, 120) then
    v_night := 0;
  end if;
  if v_vote not in (0, 30, 45, 60, 90, 120) then
    v_vote := 0;
  end if;
  v_settings := jsonb_build_object(
    'mafia', v_mafia,
    'auto_mafia', not (jsonb_typeof(p_settings->'mafia') = 'number' and (p_settings->>'mafia')::int > 0),
    'reveal_roles', coalesce((p_settings->>'reveal_roles')::boolean, false),
    'day_seconds', v_day,
    'vote_seconds', v_vote,
    'night_seconds', v_night,
    'narrator', case when v_random then 'random' else 'host' end,
    'jester', coalesce((p_settings->>'jester')::boolean, false),
    'mayor', coalesce((p_settings->>'mayor')::boolean, false),
    'bodyguard', coalesce((p_settings->>'bodyguard')::boolean, false),
    'sniper', coalesce((p_settings->>'sniper')::boolean, false),
    'seer', coalesce((p_settings->>'seer')::boolean, false),
    'spy', v_spy = 1,
    'lovers', coalesce((p_settings->>'lovers')::boolean, false),
    'disguised', coalesce((p_settings->>'disguised')::boolean, false),
    'dead_see_roles', coalesce((p_settings->>'dead_see_roles')::boolean, false),
    'nominate', coalesce((p_settings->>'nominate')::boolean, false),
    'vote_mode', case when p_settings->>'vote_mode' in ('pick', 'count') then p_settings->>'vote_mode' else 'phone' end,
    'no_first_kill', coalesce((p_settings->>'no_first_kill')::boolean, false),
    'preset', case when p_settings->>'preset' in ('quick', 'diwaniya', 'beginners') then p_settings->>'preset' end);

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
  if (v_settings->>'disguised')::boolean then v_roles := array_append(v_roles, 'disguised'); end if;
  if array_length(v_roles, 1) >= v_n then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY_ROLES');
  end if;

  delete from public.room_mafia_roles where room_id = p_room_id;
  delete from public.room_mafia_actions where room_id = p_room_id;
  delete from public.room_mafia_votes where room_id = p_room_id;
  delete from public.room_mafia_vote_log where room_id = p_room_id;
  delete from public.room_mafia_nights where room_id = p_room_id;
  delete from public.room_mafia_suspects where room_id = p_room_id;
  for i in 1..v_n loop
    insert into public.room_mafia_roles (room_id, player_id, role)
    values (p_room_id, v_players[i], coalesce(v_roles[i], 'citizen'));
    if v_roles[i] = 'mayor' then
      v_mayor := v_players[i];
    end if;
  end loop;

  -- العاشقان: لاعبان من المواطنين (بلا المهرّج)، يعرف كل منهما الآخر ويموتان معًا.
  if (v_settings->>'lovers')::boolean then
    select array_agg(r.player_id order by random()) into v_lovers
      from public.room_mafia_roles r
     where r.room_id = p_room_id and r.role not in ('mafia', 'spy', 'jester');
    if coalesce(array_length(v_lovers, 1), 0) >= 2 then
      update public.room_mafia_roles set partner_id = v_lovers[2] where room_id = p_room_id and player_id = v_lovers[1];
      update public.room_mafia_roles set partner_id = v_lovers[1] where room_id = p_room_id and player_id = v_lovers[2];
    end if;
  end if;

  update public.room_game_state
    set state_data = state_data || jsonb_build_object(
      'phase', 'night', 'round', 1, 'winner', null, 'last_result', null, 'runoff', null,
      'settings', v_settings, 'mayor', v_mayor::text, 'last_votes', null, 'last_tally', null,
      'day_ends_at', null, 'vote_ends_at', null,
      'narrator_id', v_narrator::text, 'narrator_name', v_narrator_name,
      'log', '[]'::jsonb, 'players_count', v_n, 'last_shot', null, 'last_settings', null, 'unmasked', '[]'::jsonb, 'nominees', null)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'mafia', v_mafia, 'narrator', v_narrator_name);
end;
$$;

create or replace function public.mafia_reset(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
  delete from public.room_mafia_nights where room_id = p_room_id;
  delete from public.room_mafia_suspects where room_id = p_room_id;
  update public.room_game_state
    set active_question_id = null,
        state_data = jsonb_build_object('last_settings', v_sd->'settings')
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- الحسم بعد التصويت (بالجوال أو شفويًا): p_counts = {"<player id>": أصوات}.
-- تعادل ← إعادة بين المتعادلين، المتخفي ← ينجو أول مرة، وإلا يُقصى الأعلى. p_pick: الراوي اختار الخارج مباشرة.
create or replace function public.mafia_settle_vote(p_room_id uuid, p_counts jsonb, p_pick boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_round int;
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
  v_grief text := '';
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or coalesce(v_state.state_data->>'phase', '') not in ('vote', 'day') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_sd := v_state.state_data;
  v_round := coalesce((v_sd->>'round')::int, 1);
  v_runoff := v_sd->'runoff';
  v_secs := coalesce((v_sd->'settings'->>'vote_seconds')::int, 0);

  -- أصوات اللاعبين الأحياء فقط، والأكبر من صفر.
  create temporary table if not exists pg_temp.mafia_t (target_id uuid, c int) on commit drop;
  delete from pg_temp.mafia_t where true;
  insert into pg_temp.mafia_t
  select (e.key)::uuid, (e.value)::text::int
    from jsonb_each(coalesce(p_counts, '{}'::jsonb)) e
    join public.room_mafia_roles r on r.room_id = p_room_id and r.player_id = (e.key)::uuid and r.alive
   where (e.value)::text ~ '^[0-9]+$' and (e.value)::text::int > 0;

  select case when p_pick then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object('target', tp.player_name, 'votes', t.c) order by t.c desc, tp.player_name), '[]'::jsonb) end
    into v_tally
    from pg_temp.mafia_t t join public.room_players tp on tp.id = t.target_id;
  select (select t.target_id from pg_temp.mafia_t t order by t.c desc limit 1), (select max(t.c) from pg_temp.mafia_t t) into v_top, v_top_count;
  select count(*), coalesce(jsonb_agg(t.target_id::text), '[]'::jsonb) into v_ties, v_tied from pg_temp.mafia_t t where t.c = v_top_count;

  if v_top is not null and v_ties > 1 and jsonb_typeof(v_runoff) is distinct from 'array' then
    select string_agg(p.player_name, ' و' order by p.joined_at) into v_names
      from public.room_players p where v_tied @> to_jsonb(p.id::text);
    v_result := 'تعادل بين ' || coalesce(v_names, 'لاعبين') || '. صوّتوا مرة ثانية بينهم فقط.';
    delete from public.room_mafia_votes where room_id = p_room_id and round = v_round;
    v_sd := v_sd;
    update public.room_game_state
      set state_data = state_data || jsonb_build_object(
        'phase', 'vote', 'runoff', v_tied, 'nominees', null, 'day_ends_at', null, 'last_result', v_result, 'last_tally', v_tally, 'last_votes', null,
        'vote_ends_at', case when v_secs > 0 then to_jsonb(now() + make_interval(secs => v_secs)) else null end,
        'log', coalesce(v_sd->'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('round', v_round, 'type', 'vote', 'text', v_result, 'tally', v_tally)))
      where room_id = p_room_id;
    return jsonb_build_object('ok', true, 'runoff', true);
  end if;

  -- المتخفي: أول إقصاء له لا يُميته. يُعلن نفسه، وينتهي تصويت اليوم بلا إقصاء.
  if v_top is not null and v_ties = 1
     and exists (select 1 from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = v_top and r.role = 'disguised' and r.alive)
     and not (coalesce(v_sd->'unmasked', '[]'::jsonb) @> to_jsonb(v_top::text)) then
    select p.player_name into v_name from public.room_players p where p.id = v_top;
    v_result := 'صوّتم على ' || coalesce(v_name, 'لاعب') || '… لكنه 🎭 المتخفي! نجا هذه المرة، وانتهى تصويت اليوم بلا إقصاء.';
    update public.room_game_state
      set state_data = state_data || jsonb_build_object(
        'phase', 'night', 'round', v_round + 1, 'runoff', null, 'nominees', null, 'vote_ends_at', null, 'day_ends_at', null,
        'last_result', v_result, 'last_tally', v_tally, 'last_votes', null,
        'unmasked', coalesce(v_sd->'unmasked', '[]'::jsonb) || jsonb_build_array(v_top::text),
        'log', coalesce(v_sd->'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('round', v_round, 'type', 'vote', 'text', v_result, 'tally', v_tally)))
      where room_id = p_room_id;
    return jsonb_build_object('ok', true, 'unmasked', true);
  end if;

  if v_top is not null and v_ties = 1 then
    update public.room_mafia_roles set alive = false where room_id = p_room_id and player_id = v_top
      returning role into v_role;
    select p.player_name into v_name from public.room_players p where p.id = v_top;
    v_grief := public.mafia_grief(p_room_id, v_top, coalesce((v_sd->'settings'->>'reveal_roles')::boolean, false));
    if v_role = 'jester' then
      v_result := 'أُقصي ' || coalesce(v_name, 'لاعب') || ' بالتصويت، وكان المهرّج! فاز المهرّج.';
      v_winner := 'jester';
    else
      v_result := 'أُقصي ' || coalesce(v_name, 'لاعب') || ' بالتصويت'
        || case when coalesce((v_sd->'settings'->>'reveal_roles')::boolean, false) then '، وكان ' || public.mafia_role_ar(v_role) else '' end
        || '.' || v_grief;
    end if;
  elsif v_top is null then
    v_result := case when p_pick then 'قرّر الراوي: لا إقصاء اليوم.' else 'لم يصوّت أحد، لم يُقصَ أحد.' end;
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
      'nominees', null,
      'vote_ends_at', null,
      'day_ends_at', null,
      'last_result', v_result,
      'last_tally', v_tally,
      'last_votes', null,
      'log', coalesce(v_sd->'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('round', v_round, 'type', 'vote', 'text', v_result, 'tally', v_tally)))
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'winner', v_winner);
end;
$$;
revoke all on function public.mafia_settle_vote(uuid, jsonb, boolean) from public, anon, authenticated;

-- إغلاق التصويت بالجوال: سجل الراوي، ثم الحسم.
create or replace function public.mafia_close_vote_core(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
  v_grief text := '';
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

  select coalesce(jsonb_object_agg(t.target_id::text, t.c), '{}'::jsonb) into v_tally
    from (
      select v.target_id, sum(case when r.role = 'mayor' then 2 else 1 end) as c
        from public.room_mafia_votes v
        join public.room_mafia_roles r on r.room_id = v.room_id and r.player_id = v.voter_id and r.alive
       where v.room_id = p_room_id and v.round = v_round
       group by v.target_id
    ) t;
  return public.mafia_settle_vote(p_room_id, v_tally, false);
end;
$$;

-- انتهى وقت التصويت: من لم يصوّت ممتنع (لا تصويت عشوائي عنه).
create or replace function public.mafia_vote_timeout(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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

  -- من لم يصوّت ممتنع.

  return public.mafia_close_vote_core(p_room_id);
end;
$$;

-- التصويت: على المرشحين فقط إذا رشّح الراوي.
create or replace function public.mafia_vote(p_room_id uuid, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_state public.room_game_state%rowtype;
  v_round int;
  v_alive boolean;
  v_target_alive boolean;
  v_runoff jsonb;
begin
  if v_me is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id;
  if not found or coalesce(v_state.state_data->>'phase', '') <> 'vote' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_round := coalesce((v_state.state_data->>'round')::int, 1);
  v_runoff := v_state.state_data->'runoff';

  select r.alive into v_alive from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = v_me;
  if not found or not v_alive then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ACTIVE');
  end if;
  select r.alive into v_target_alive from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = p_target_id;
  if not found or not v_target_alive or p_target_id = v_me then
    return jsonb_build_object('ok', false, 'reason', 'BAD_TARGET');
  end if;
  if jsonb_typeof(v_runoff) = 'array' and not (v_runoff @> to_jsonb(p_target_id::text)) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_RUNOFF');
  end if;
  if jsonb_typeof(v_runoff) is distinct from 'array' and jsonb_typeof(v_state.state_data->'nominees') = 'array'
     and not ((v_state.state_data->'nominees') @> to_jsonb(p_target_id::text)) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_NOMINEE');
  end if;

  insert into public.room_mafia_votes (room_id, round, voter_id, target_id)
    values (p_room_id, v_round, v_me, p_target_id)
    on conflict (room_id, round, voter_id)
    do update set target_id = excluded.target_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mafia_open_vote(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
    set state_data = state_data || jsonb_build_object('phase', 'vote', 'runoff', null, 'nominees', null, 'day_ends_at', null,
      'vote_ends_at', case when v_secs > 0 then to_jsonb(now() + make_interval(secs => v_secs)) else null end)
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- الترشيح: الراوي يختار 2 أو 3 لاعبين أحياء، ويُفتح التصويت عليهم فقط.
create or replace function public.mafia_nominate(p_room_id uuid, p_nominees uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secs int;
  v_n int;
begin
  if not public.mafia_is_narrator(p_room_id) then
    raise exception 'HOST_ONLY';
  end if;
  select coalesce((s.state_data->'settings'->>'vote_seconds')::int, 0) into v_secs
    from public.room_game_state s where s.room_id = p_room_id and s.state_data->>'phase' = 'day';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  select count(distinct r.player_id) into v_n from public.room_mafia_roles r
   where r.room_id = p_room_id and r.alive and r.player_id = any(coalesce(p_nominees, '{}'));
  if v_n < 2 or v_n > 3 or v_n <> coalesce(array_length(p_nominees, 1), 0) then
    return jsonb_build_object('ok', false, 'reason', 'NOMINEES');
  end if;
  update public.room_game_state
    set state_data = state_data || jsonb_build_object('phase', 'vote', 'runoff', null, 'day_ends_at', null,
      'nominees', (select jsonb_agg(x::text) from unnest(p_nominees) x),
      'vote_ends_at', case when v_secs > 0 then to_jsonb(now() + make_interval(secs => v_secs)) else null end)
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.mafia_nominate(uuid, uuid[]) from public, anon;
grant execute on function public.mafia_nominate(uuid, uuid[]) to authenticated;

-- التصويت الشفوي: الراوي يكتب عدد الأصوات لكل لاعب ({"<id>": 3, ...})، أو يختار من خرج (p_pick،
-- و{} = لا إقصاء). من النهار أو أثناء التصويت. الأصوات بالجوال لهذه الجولة تُلغى.
create or replace function public.mafia_oral_result(p_room_id uuid, p_counts jsonb, p_pick boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_runoff jsonb;
begin
  if not public.mafia_is_narrator(p_room_id) then
    raise exception 'HOST_ONLY';
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if coalesce(v_sd->>'phase', '') not in ('day', 'vote') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if jsonb_typeof(coalesce(p_counts, '{}'::jsonb)) <> 'object' or (p_pick and (select count(*) from jsonb_object_keys(coalesce(p_counts, '{}'::jsonb))) > 1) then
    return jsonb_build_object('ok', false, 'reason', 'BAD_COUNTS');
  end if;
  -- في الإعادة: المتعادلون فقط.
  v_runoff := v_sd->'runoff';
  if jsonb_typeof(v_runoff) = 'array' and exists (select 1 from jsonb_object_keys(coalesce(p_counts, '{}'::jsonb)) k where not v_runoff ? k) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_RUNOFF');
  end if;
  delete from public.room_mafia_votes where room_id = p_room_id and round = coalesce((v_sd->>'round')::int, 1);
  return public.mafia_settle_vote(p_room_id, coalesce(p_counts, '{}'::jsonb), coalesce(p_pick, false));
end;
$$;
revoke all on function public.mafia_oral_result(uuid, jsonb, boolean) from public, anon;
grant execute on function public.mafia_oral_result(uuid, jsonb, boolean) to authenticated;

-- الراوي يرى الأصوات لحظة بلحظة.
create or replace function public.mafia_vote_details(p_room_id uuid)
 RETURNS TABLE(round integer, stage integer, voter text, target text, weight integer, auto boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
begin
  if not public.mafia_is_narrator(p_room_id) then
    return;
  end if;
  -- الأصوات الحالية (أثناء التصويت)، ثم السجل.
  return query
    select x.round, x.stage, x.voter, x.target, x.weight, x.auto from (
      select v.round, (case when jsonb_typeof(s.state_data->'runoff') = 'array' then 2 else 1 end) as stage,
             vp.player_name as voter, tp.player_name as target, (case when r.role = 'mayor' then 2 else 1 end) as weight, v.auto
        from public.room_mafia_votes v
        join public.room_game_state s on s.room_id = v.room_id and s.state_data->>'phase' = 'vote'
        join public.room_mafia_roles r on r.room_id = v.room_id and r.player_id = v.voter_id and r.alive
        join public.room_players vp on vp.id = v.voter_id
        join public.room_players tp on tp.id = v.target_id
       where v.room_id = p_room_id and v.round = coalesce((s.state_data->>'round')::int, 1)
      union all
      select l.round, l.stage, vp.player_name, tp.player_name, l.weight, l.auto
        from public.room_mafia_vote_log l
        join public.room_players vp on vp.id = l.voter_id
        join public.room_players tp on tp.id = l.target_id
       where l.room_id = p_room_id) x
     order by x.round desc, x.stage desc, x.target, x.voter;
end;
$$;

-- الليلة الأولى بلا قتل (إن اختارها المضيف).
create or replace function public.mafia_night_action(p_room_id uuid, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
  if v_kind = 'kill' and v_round = 1 and coalesce((v_state.state_data->'settings'->>'no_first_kill')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'FIRST_NIGHT');
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

create or replace function public.mafia_resolve_night(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
  v_grief text := '';
begin
  if not (public.mafia_is_narrator(p_room_id) or coalesce(current_setting('alosh.night_timeout', true), '') = 'on') then
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

  if v_round = 1 and coalesce((v_sd->'settings'->>'no_first_kill')::boolean, false) then
    v_kill := null;
  end if;
  if v_kill is null or v_kill = v_save then
    v_victim := null;
  elsif v_kill = v_guard then
    -- الحارس يموت بدل من يحرسه، إلا إذا حماه الطبيب.
    v_victim := case when v_guard_by = v_save then null else v_guard_by end;
  else
    v_victim := v_kill;
  end if;

  if v_victim is not null then
    update public.room_mafia_roles set alive = false where room_id = p_room_id and player_id = v_victim
      returning role into v_role;
    select p.player_name into v_name from public.room_players p where p.id = v_victim;
    v_grief := public.mafia_grief(p_room_id, v_victim, coalesce((v_sd->'settings'->>'reveal_roles')::boolean, false));
    v_result := 'قُتل ' || coalesce(v_name, 'لاعب') || ' هذه الليلة'
      || case when coalesce((v_sd->'settings'->>'reveal_roles')::boolean, false) then '، وكان ' || public.mafia_role_ar(v_role) else '' end
      || '.' || v_grief;
  else
    v_result := case when v_round = 1 and coalesce((v_sd->'settings'->>'no_first_kill')::boolean, false) then 'انتهت ليلة التعارف. لا قتل في الليلة الأولى.' else 'لم يُقتل أحد هذه الليلة.' end;
  end if;

  -- سجل الليلة (خاص، يظهر في ملخص النهاية فقط).
  insert into public.room_mafia_nights (room_id, round, kill_target, save_target, guard_target, guard_by, victim)
  values (p_room_id, v_round, v_kill, v_save, v_guard, v_guard_by, v_victim)
  on conflict (room_id, round) do update set kill_target = excluded.kill_target, save_target = excluded.save_target,
    guard_target = excluded.guard_target, guard_by = excluded.guard_by, victim = excluded.victim;

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

create or replace function public.mafia_progress(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_phase text;
  v_round int;
  v_narrator boolean := public.mafia_is_narrator(p_room_id);
  v_first_safe boolean;
begin
  if not (v_narrator or public.is_room_host(p_room_id) or public.my_player_id(p_room_id) is not null) then
    return null;
  end if;
  select s.state_data->>'phase', coalesce((s.state_data->>'round')::int, 1) into v_phase, v_round
    from public.room_game_state s where s.room_id = p_room_id;
  select coalesce((s.state_data->'settings'->>'no_first_kill')::boolean, false) into v_first_safe
    from public.room_game_state s where s.room_id = p_room_id;
  if v_phase = 'vote' then
    return jsonb_build_object('phase', 'vote',
      'done', (select count(*) from public.room_mafia_votes v
                 join public.room_mafia_roles r on r.room_id = v.room_id and r.player_id = v.voter_id and r.alive
                where v.room_id = p_room_id and v.round = v_round),
      'total', (select count(*) from public.room_mafia_roles r where r.room_id = p_room_id and r.alive),
      'waiting', case when v_narrator then (
          select coalesce(jsonb_agg(p.player_name order by p.joined_at), '[]'::jsonb)
            from public.room_mafia_roles r join public.room_players p on p.id = r.player_id
           where r.room_id = p_room_id and r.alive
             and not exists (select 1 from public.room_mafia_votes v where v.room_id = p_room_id and v.round = v_round and v.voter_id = r.player_id)) end);
  end if;
  if v_phase = 'night' and v_narrator then
    return jsonb_build_object('phase', 'night',
      'done', (select count(*) from public.room_mafia_actions a
                 join public.room_mafia_roles r on r.room_id = a.room_id and r.player_id = a.actor_id and r.alive
                where a.room_id = p_room_id and a.round = v_round and a.kind in ('kill', 'save', 'inspect', 'guard')),
      'total', (select count(*) from public.room_mafia_roles r
                 where r.room_id = p_room_id and r.alive and r.role in ('mafia', 'doctor', 'detective', 'bodyguard')
                     and not (r.role = 'mafia' and v_round = 1 and v_first_safe)),
      'mafia_split', (select count(distinct a.target_id) > 1 from public.room_mafia_actions a
                       where a.room_id = p_room_id and a.round = v_round and a.kind = 'kill'),
      'waiting', (select coalesce(jsonb_agg(jsonb_build_object('name', p.player_name, 'role', r.role) order by p.joined_at), '[]'::jsonb)
                    from public.room_mafia_roles r join public.room_players p on p.id = r.player_id
                   where r.room_id = p_room_id and r.alive and r.role in ('mafia', 'doctor', 'detective', 'bodyguard')
                     and not (r.role = 'mafia' and v_round = 1 and v_first_safe)
                     and not exists (select 1 from public.room_mafia_actions a where a.room_id = p_room_id and a.round = v_round and a.actor_id = r.player_id)));
  end if;
  return jsonb_build_object('phase', v_phase);
end;
$$;

-- الاشتباه الليلي: من ليس له دور ليلي (غير الجاسوس) يختار من يشك فيه. لا يؤثر على اللعب.
create or replace function public.mafia_suspect(p_room_id uuid, p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_sd jsonb;
  v_role text;
begin
  select state_data into v_sd from public.room_game_state where room_id = p_room_id;
  if coalesce(v_sd->>'phase', '') <> 'night' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  select r.role into v_role from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = v_me and r.alive;
  if v_role is null or v_role in ('mafia', 'doctor', 'detective', 'bodyguard', 'spy') then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ACTIVE');
  end if;
  if p_target_id = v_me or not exists (select 1 from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = p_target_id and r.alive) then
    return jsonb_build_object('ok', false, 'reason', 'BAD_TARGET');
  end if;
  insert into public.room_mafia_suspects (room_id, round, actor_id, target_id)
  values (p_room_id, coalesce((v_sd->>'round')::int, 1), v_me, p_target_id)
  on conflict (room_id, round, actor_id) do update set target_id = excluded.target_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.mafia_suspect(uuid, uuid) from public, anon;
grant execute on function public.mafia_suspect(uuid, uuid) to authenticated;

-- اختياري الليلة.
create or replace function public.mafia_my_suspect(p_room_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.target_id from public.room_mafia_suspects s, public.room_game_state g
   where s.room_id = p_room_id and g.room_id = p_room_id and s.actor_id = public.my_player_id(p_room_id)
     and s.round = coalesce((g.state_data->>'round')::int, 1);
$$;
revoke all on function public.mafia_my_suspect(uuid) from public, anon;
grant execute on function public.mafia_my_suspect(uuid) to authenticated;

-- أكثر من اشتُبه فيه، بعد نهاية المباراة (أو للراوي).
create or replace function public.mafia_suspicions(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when (select g.state_data->>'phase' from public.room_game_state g where g.room_id = p_room_id) = 'over'
                   or public.mafia_is_narrator(p_room_id)
    then (select coalesce(jsonb_agg(jsonb_build_object('name', p.player_name, 'times', x.c, 'role', r.role) order by x.c desc, p.player_name), '[]'::jsonb)
            from (select s.target_id, count(*) c from public.room_mafia_suspects s where s.room_id = p_room_id group by s.target_id order by count(*) desc limit 3) x
            join public.room_players p on p.id = x.target_id
            left join public.room_mafia_roles r on r.room_id = p_room_id and r.player_id = x.target_id)
    end;
$$;
revoke all on function public.mafia_suspicions(uuid) from public, anon;
grant execute on function public.mafia_suspicions(uuid) to authenticated;

-- خروج لاعب أو طرده أثناء اللعب: يُعاد حساب الفائز فورًا.
create or replace function public.mafia_after_leave()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_winner text;
begin
  if not old.alive then
    return old;
  end if;
  select state_data into v_sd from public.room_game_state where room_id = old.room_id for update;
  if v_sd is null or coalesce(v_sd->>'phase', '') not in ('night', 'day', 'vote') then
    return old;
  end if;
  v_winner := public.mafia_winner(old.room_id);
  if v_winner is not null then
    update public.room_game_state
       set state_data = state_data || jsonb_build_object('phase', 'over', 'winner', v_winner, 'runoff', null, 'nominees', null,
             'day_ends_at', null, 'vote_ends_at', null, 'night_ends_at', null,
             'last_result', 'خرج لاعب من الغرفة، فانحسمت اللعبة.',
             'log', coalesce(v_sd->'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('round', coalesce((v_sd->>'round')::int, 1), 'type', 'vote', 'text', 'خرج لاعب من الغرفة، فانحسمت اللعبة.')))
     where room_id = old.room_id;
  end if;
  return old;
end;
$$;
drop trigger if exists mafia_after_leave on public.room_mafia_roles;
create trigger mafia_after_leave after delete on public.room_mafia_roles
  for each row execute function public.mafia_after_leave();

create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;
insert into public.app_migrations (name) values ('mafia_v9.sql') on conflict do nothing;

notify pgrst, 'reload schema';
