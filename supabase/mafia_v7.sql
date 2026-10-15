-- =============================================================================
-- «المافيا»، الإصدار 7. يُشغَّل بعد mafia_v6.sql، وتشغيله مرة ثانية آمن.
--
-- 1) الجاسوس: كل جولتين يتحقق ليلًا من لاعب واحد: مواطن عادي أم صاحب دور خاص؟
--    النتيجة فورية له وللمافيا (mafia_spy_check).
-- 2) دور جديد «المتخفي» (disguised): أول مرة يُقصى فيها بالتصويت لا يموت؛ يُعلن أنه المتخفي
--    وينتهي تصويت ذلك النهار بلا إقصاء. في المرة الثانية يُقصى كالعادة.
-- 3) الراوي يرى الليل مباشرة: ضحية المافيا، ومن يحمي الطبيب، ومع من يحقق المحقق… (mafia_night_live).
-- =============================================================================

alter table public.room_mafia_roles drop constraint if exists room_mafia_roles_role_check;
alter table public.room_mafia_roles add constraint room_mafia_roles_role_check
  check (role in ('mafia', 'citizen', 'doctor', 'detective', 'jester', 'mayor', 'bodyguard', 'sniper', 'seer', 'spy', 'disguised'));
alter table public.room_mafia_actions drop constraint if exists room_mafia_actions_kind_check;
alter table public.room_mafia_actions add constraint room_mafia_actions_kind_check
  check (kind in ('kill', 'save', 'inspect', 'guard', 'shoot', 'reveal', 'spy'));

create or replace function public.mafia_role_ar(p_role text)
returns text language sql immutable set search_path = public as $$
  select case p_role when 'mafia' then 'مافيا' when 'citizen' then 'مواطنًا' when 'doctor' then 'الطبيب'
    when 'detective' then 'المحقق' when 'jester' then 'المهرّج' when 'mayor' then 'العمدة'
    when 'bodyguard' then 'الحارس' when 'sniper' then 'القنّاص' when 'seer' then 'العرّافة'
    when 'spy' then 'الجاسوس' when 'disguised' then 'المتخفي' else '' end;
$$;

-- البداية: دور المتخفي.
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
    'spy', v_spy = 1,
    'lovers', coalesce((p_settings->>'lovers')::boolean, false),
    'disguised', coalesce((p_settings->>'disguised')::boolean, false),
    'dead_see_roles', coalesce((p_settings->>'dead_see_roles')::boolean, true));

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
      'log', '[]'::jsonb, 'players_count', v_n, 'last_shot', null, 'last_settings', null, 'unmasked', '[]'::jsonb)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'mafia', v_mafia, 'narrator', v_narrator_name);
end;
$$;

-- التصويت: المتخفي ينجو من أول إقصاء.
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

  -- المتخفي: أول إقصاء له لا يُميته. يُعلن نفسه، وينتهي تصويت اليوم بلا إقصاء.
  if v_top is not null and v_ties = 1
     and exists (select 1 from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = v_top and r.role = 'disguised' and r.alive)
     and not (coalesce(v_sd->'unmasked', '[]'::jsonb) @> to_jsonb(v_top::text)) then
    select p.player_name into v_name from public.room_players p where p.id = v_top;
    v_result := 'صوّتم على ' || coalesce(v_name, 'لاعب') || '… لكنه 🎭 المتخفي! نجا هذه المرة، وانتهى تصويت اليوم بلا إقصاء.';
    update public.room_game_state
      set state_data = state_data || jsonb_build_object(
        'phase', 'night', 'round', v_round + 1, 'runoff', null, 'vote_ends_at', null,
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

-- بطاقتي: تحقيقات الجاسوس.
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
    -- انضم بعد توزيع الأدوار: يدخل المباراة القادمة.
    return jsonb_build_object('started', false, 'late', coalesce(v_sd->>'phase', '') <> '');
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
    'lover', (select p.player_name from public.room_mafia_roles m join public.room_players p on p.id = m.partner_id
               where m.room_id = p_room_id and m.player_id = v_me),
    'inspect', case when jsonb_array_length(v_inspections) > 0
                    then case when (v_inspections->-1->>'mafia')::boolean then 'mafia' else 'not_mafia' end end,
    'inspections', v_inspections,
    'pending_inspect', v_pending,
    'my_pick', v_pick,
    -- الجاسوس ونتائجه: له وللمافيا.
    'spy_checks', case when v_role in ('spy', 'mafia') then (
        select coalesce(jsonb_agg(jsonb_build_object('round', a.round, 'name', p.player_name, 'special', t.role not in ('citizen')) order by a.round), '[]'::jsonb)
          from public.room_mafia_actions a
          join public.room_mafia_roles t on t.room_id = a.room_id and t.player_id = a.target_id
          join public.room_players p on p.id = a.target_id
         where a.room_id = p_room_id and a.kind = 'spy') end,
    'spy_ready', case when v_role = 'spy' then v_phase = 'night' and not exists (
        select 1 from public.room_mafia_actions a where a.room_id = p_room_id and a.actor_id = v_me and a.kind = 'spy' and a.round > v_round - 2) end,
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

-- الجاسوس: كل جولتين، ليلًا، يتحقق من لاعب: مواطن عادي أم صاحب دور خاص.
create or replace function public.mafia_spy_check(p_room_id uuid, p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_sd jsonb;
  v_round int;
  v_role text;
  v_alive boolean;
  v_target_role text;
  v_target_alive boolean;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id;
  if coalesce(v_sd->>'phase', '') <> 'night' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_round := coalesce((v_sd->>'round')::int, 1);
  select r.role, r.alive into v_role, v_alive from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = v_me;
  if v_role is distinct from 'spy' or not v_alive then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ACTIVE');
  end if;
  if exists (select 1 from public.room_mafia_actions a where a.room_id = p_room_id and a.actor_id = v_me and a.kind = 'spy' and a.round > v_round - 2) then
    return jsonb_build_object('ok', false, 'reason', 'SPY_WAIT');
  end if;
  select r.role, r.alive into v_target_role, v_target_alive from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = p_target_id;
  if v_target_role is null or not v_target_alive or v_target_role in ('mafia', 'spy') then
    return jsonb_build_object('ok', false, 'reason', 'BAD_TARGET');
  end if;
  insert into public.room_mafia_actions (room_id, round, actor_id, kind, target_id)
  values (p_room_id, v_round, v_me, 'spy', p_target_id)
  on conflict (room_id, round, actor_id) do nothing;
  return jsonb_build_object('ok', true, 'special', v_target_role <> 'citizen');
end;
$$;
revoke all on function public.mafia_spy_check(uuid, uuid) from public, anon;
grant execute on function public.mafia_spy_check(uuid, uuid) to authenticated;

-- الراوي يرى الليل مباشرة: من اختار ماذا ومن.
create or replace function public.mafia_night_live(p_room_id uuid)
returns table (actor text, actor_role text, kind text, target text, target_role text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_round int;
begin
  if not public.mafia_is_narrator(p_room_id) then
    return;
  end if;
  select coalesce((s.state_data->>'round')::int, 1) into v_round
    from public.room_game_state s where s.room_id = p_room_id and s.state_data->>'phase' = 'night';
  if v_round is null then
    return;
  end if;
  return query
    select ap.player_name, ar.role, a.kind, tp.player_name, tr.role
      from public.room_mafia_actions a
      join public.room_players ap on ap.id = a.actor_id
      join public.room_mafia_roles ar on ar.room_id = a.room_id and ar.player_id = a.actor_id
      join public.room_players tp on tp.id = a.target_id
      join public.room_mafia_roles tr on tr.room_id = a.room_id and tr.player_id = a.target_id
     where a.room_id = p_room_id and a.round = v_round and a.kind in ('kill', 'save', 'inspect', 'guard', 'spy')
     order by case a.kind when 'kill' then 0 when 'save' then 1 when 'guard' then 2 when 'inspect' then 3 else 4 end, ap.player_name;
end;
$$;
revoke all on function public.mafia_night_live(uuid) from public, anon;
grant execute on function public.mafia_night_live(uuid) to authenticated;

notify pgrst, 'reload schema';
