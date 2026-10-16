-- =============================================================================
-- «المافيا»، الإصدار 10: لوحة الراوي. يُشغَّل بعد mafia_v9.sql، وتشغيله مرة ثانية آمن.
--
-- 1) تقرير الليلة للراوي بعد كل حسم (mafia_night_report)، وخيار «أعلن المحاولة الفاشلة».
-- 2) إيقاف المؤقت واستئنافه وإضافة 30 ثانية (mafia_timer).
-- 3) نتيجة السهرة عبر المباريات (mafia_evening)، تبقى بعد «مباراة جديدة».
-- 4) كشف الأدوار واحدًا واحدًا في النهاية، على شاشة التلفزيون (mafia_reveal_step).
-- =============================================================================

do $$
begin
  if to_regprocedure('public.mafia_oral_result(uuid,jsonb,boolean)') is null then
    raise exception 'شغّل mafia_v9.sql أولًا، ثم mafia_v10.sql.';
  end if;
end $$;

-- البداية: خيار إعلان المحاولة الفاشلة، والسهرة تبقى.
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
    'announce_saves', coalesce((p_settings->>'announce_saves')::boolean, false),
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
      'log', '[]'::jsonb, 'players_count', v_n, 'last_shot', null, 'last_settings', null, 'unmasked', '[]'::jsonb, 'nominees', null, 'timer_paused', null, 'reveal_i', null,
      'evening', v_state.state_data->'evening')
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'mafia', v_mafia, 'narrator', v_narrator_name);
end;
$$;

-- الحسم: «حاولت المافيا القتل… لكن الطبيب أنقذ الضحية» إن اختارها المضيف.
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
    v_result := case
      when v_round = 1 and coalesce((v_sd->'settings'->>'no_first_kill')::boolean, false) then 'انتهت ليلة التعارف. لا قتل في الليلة الأولى.'
      when v_kill is not null and coalesce((v_sd->'settings'->>'announce_saves')::boolean, false) then
        case when v_kill = v_save then 'حاولت المافيا القتل الليلة، لكن الطبيب أنقذ الضحية!' else 'حاولت المافيا القتل الليلة، لكن الضحية نجت!' end
      else 'لم يُقتل أحد هذه الليلة.' end;
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

-- تقرير الليلة الأخيرة، للراوي فقط: من اختارت المافيا ومن اختار كل منهم، من حمى الطبيب ومن حرس الحارس،
-- مع من حقق المحقق والجاسوس ونتيجتهما، ومن مات.
create or replace function public.mafia_night_report(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_round int;
  n record;
begin
  if not public.mafia_is_narrator(p_room_id) then
    return null;
  end if;
  select * into n from public.room_mafia_nights where room_id = p_room_id order by round desc limit 1;
  if not found then
    return null;
  end if;
  v_round := n.round;
  return jsonb_build_object(
    'round', v_round,
    'target', (select player_name from public.room_players where id = n.kill_target),
    'picks', (select coalesce(jsonb_agg(jsonb_build_object('by', ap.player_name, 'target', tp.player_name) order by ap.player_name), '[]'::jsonb)
                from public.room_mafia_actions a join public.room_players ap on ap.id = a.actor_id join public.room_players tp on tp.id = a.target_id
               where a.room_id = p_room_id and a.round = v_round and a.kind = 'kill'),
    'save', (select player_name from public.room_players where id = n.save_target),
    'saved', n.kill_target is not null and n.kill_target = n.save_target,
    'guard', (select player_name from public.room_players where id = n.guard_target),
    'guard_by', (select player_name from public.room_players where id = n.guard_by),
    'victim', (select player_name from public.room_players where id = n.victim),
    'inspect', (select jsonb_build_object('by', ap.player_name, 'target', tp.player_name, 'mafia', tr.role = 'mafia')
                  from public.room_mafia_actions a join public.room_players ap on ap.id = a.actor_id join public.room_players tp on tp.id = a.target_id
                  left join public.room_mafia_roles tr on tr.room_id = a.room_id and tr.player_id = a.target_id
                 where a.room_id = p_room_id and a.round = v_round and a.kind = 'inspect' limit 1),
    'spy', (select jsonb_build_object('by', ap.player_name, 'target', tp.player_name, 'special', tr.role not in ('citizen'))
              from public.room_mafia_actions a join public.room_players ap on ap.id = a.actor_id join public.room_players tp on tp.id = a.target_id
              left join public.room_mafia_roles tr on tr.room_id = a.room_id and tr.player_id = a.target_id
             where a.room_id = p_room_id and a.round = v_round and a.kind = 'spy' limit 1));
end;
$$;
revoke all on function public.mafia_night_report(uuid) from public, anon;
grant execute on function public.mafia_night_report(uuid) to authenticated;

-- المؤقت: إيقاف، استئناف، أو +30 ثانية للمرحلة الحالية (النهار أو التصويت أو الليل).
create or replace function public.mafia_timer(p_room_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_key text;
  v_ends timestamptz;
  v_left int;
begin
  if not public.mafia_is_narrator(p_room_id) then
    raise exception 'HOST_ONLY';
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  v_key := case v_sd->>'phase' when 'day' then 'day_ends_at' when 'vote' then 'vote_ends_at' when 'night' then 'night_ends_at' end;
  if v_key is null then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_ends := nullif(v_sd->>v_key, '')::timestamptz;

  if p_action = 'pause' then
    if v_ends is null then
      return jsonb_build_object('ok', false, 'reason', 'NO_TIMER');
    end if;
    v_left := greatest(1, ceil(extract(epoch from v_ends - now()))::int);
    v_sd := v_sd || jsonb_build_object(v_key, null, 'timer_paused', jsonb_build_object('key', v_key, 'left', v_left));
  elsif p_action = 'resume' then
    if jsonb_typeof(v_sd->'timer_paused') <> 'object' then
      return jsonb_build_object('ok', false, 'reason', 'NOT_PAUSED');
    end if;
    v_sd := v_sd || jsonb_build_object(v_key, now() + make_interval(secs => (v_sd->'timer_paused'->>'left')::int), 'timer_paused', null);
  elsif p_action = 'add' then
    if jsonb_typeof(v_sd->'timer_paused') = 'object' then
      v_sd := jsonb_set(v_sd, '{timer_paused,left}', to_jsonb((v_sd->'timer_paused'->>'left')::int + 30));
    elsif v_ends is not null then
      v_sd := v_sd || jsonb_build_object(v_key, greatest(v_ends, now()) + interval '30 seconds');
    else
      return jsonb_build_object('ok', false, 'reason', 'NO_TIMER');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'BAD_ACTION');
  end if;
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.mafia_timer(uuid, text) from public, anon;
grant execute on function public.mafia_timer(uuid, text) to authenticated;

-- الإيقاف لا يعبر من مرحلة لأخرى.
create or replace function public.mafia_pause_clear()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.state_data ? 'timer_paused' and jsonb_typeof(new.state_data->'timer_paused') = 'object'
     and (old.state_data->>'phase' is distinct from new.state_data->>'phase' or old.state_data->>'round' is distinct from new.state_data->>'round'
          or old.state_data->'runoff' is distinct from new.state_data->'runoff') then
    new.state_data := new.state_data || jsonb_build_object('timer_paused', null);
  end if;
  return new;
end;
$$;
drop trigger if exists mafia_pause_clear on public.room_game_state;
create trigger mafia_pause_clear before update of state_data on public.room_game_state
  for each row execute function public.mafia_pause_clear();

-- نتيجة السهرة: المباريات السابقة (state.evening) ومعها المباراة الحالية إن انتهت.
-- {"matches", "wins": {"mafia", "citizens", "jester"}, "players": {"<اسم>": {"played", "won", "finds"}}}
create or replace function public.mafia_evening(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_ev jsonb;
  v_winner text;
  x record;
  v_p jsonb;
begin
  select state_data into v_sd from public.room_game_state where room_id = p_room_id;
  v_ev := coalesce(case when jsonb_typeof(v_sd->'evening') = 'object' then v_sd->'evening' end, jsonb_build_object('matches', 0, 'wins', jsonb_build_object('mafia', 0, 'citizens', 0, 'jester', 0), 'players', '{}'::jsonb));
  if coalesce(v_sd->>'phase', '') <> 'over' or not exists (select 1 from public.room_mafia_roles where room_id = p_room_id) then
    return v_ev;
  end if;
  v_winner := v_sd->>'winner';
  v_ev := jsonb_set(v_ev, '{matches}', to_jsonb(coalesce((v_ev->>'matches')::int, 0) + 1));
  if v_winner in ('mafia', 'citizens', 'jester') then
    v_ev := jsonb_set(v_ev, array['wins', v_winner], to_jsonb(coalesce((v_ev->'wins'->>v_winner)::int, 0) + 1));
  end if;
  for x in
    select p.player_name, r.role,
           (select count(*) from public.room_mafia_actions a join public.room_mafia_roles t on t.room_id = a.room_id and t.player_id = a.target_id
             where a.room_id = p_room_id and a.actor_id = r.player_id and a.kind = 'inspect' and t.role = 'mafia') as finds
      from public.room_mafia_roles r join public.room_players p on p.id = r.player_id
     where r.room_id = p_room_id
  loop
    v_p := coalesce(v_ev->'players'->x.player_name, jsonb_build_object('played', 0, 'won', 0, 'finds', 0));
    v_p := jsonb_build_object(
      'played', coalesce((v_p->>'played')::int, 0) + 1,
      'won', coalesce((v_p->>'won')::int, 0) + case
        when v_winner = 'mafia' and x.role in ('mafia', 'spy') then 1
        when v_winner = 'citizens' and x.role not in ('mafia', 'spy', 'jester') then 1
        when v_winner = 'jester' and x.role = 'jester' then 1 else 0 end,
      'finds', coalesce((v_p->>'finds')::int, 0) + x.finds);
    v_ev := jsonb_set(v_ev, array['players', x.player_name], v_p);
  end loop;
  return v_ev;
end;
$$;
revoke all on function public.mafia_evening(uuid) from public, anon;
grant execute on function public.mafia_evening(uuid) to authenticated;

-- كشف الأدوار في النهاية: الراوي يتقدم لاعبًا لاعبًا، والتلفزيون يعرض (null = إغلاق).
create or replace function public.mafia_reveal_step(p_room_id uuid, p_index int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mafia_is_narrator(p_room_id) then
    raise exception 'HOST_ONLY';
  end if;
  update public.room_game_state
     set state_data = state_data || jsonb_build_object('reveal_i', case when p_index is null then null else greatest(0, p_index) end)
   where room_id = p_room_id and state_data->>'phase' = 'over';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_OVER');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.mafia_reveal_step(uuid, int) from public, anon;
grant execute on function public.mafia_reveal_step(uuid, int) to authenticated;

-- مباراة جديدة: السهرة تبقى.
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
  -- السهرة: تُحسب قبل حذف أدوار هذه المباراة.
  v_sd := v_sd || jsonb_build_object('evening', public.mafia_evening(p_room_id));
  delete from public.room_mafia_roles where room_id = p_room_id;
  delete from public.room_mafia_actions where room_id = p_room_id;
  delete from public.room_mafia_votes where room_id = p_room_id;
  delete from public.room_mafia_vote_log where room_id = p_room_id;
  delete from public.room_mafia_nights where room_id = p_room_id;
  delete from public.room_mafia_suspects where room_id = p_room_id;
  update public.room_game_state
    set active_question_id = null,
        state_data = jsonb_build_object('last_settings', v_sd->'settings', 'evening', v_sd->'evening')
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;
insert into public.app_migrations (name) values ('mafia_v10.sql') on conflict do nothing;

notify pgrst, 'reload schema';
