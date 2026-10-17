-- =============================================================================
-- «المافيا»، الإصدار 13: إعادة التوزيع، وغياب الراوي، وقوانين يحسمها الخادم. يُشغَّل بعد mafia_v12.sql،
-- وتشغيله مرة ثانية آمن.
--
-- 1) «🔄 إعادة توزيع الأدوار» (mafia_redeal): للراوي، مضيفًا كان أو ضيفًا، في أي مرحلة. أدوار جديدة
--    بالإعدادات نفسها، وترتيب السهرة يبقى.
-- 2) غياب الراوي: جواله ينبض كل 15 ثانية (mafia_narrator_ping). إذا غاب أكثر من دقيقة تكمل اللعبة
--    بالوقت على الخادم (mafia_auto_step، تطلبه جوالات اللاعبين)، أو تتوقف حتى يرجع، حسب الإعداد
--    «إذا غاب الراوي» (settings.host_away: auto | pause).
-- 3) قوانين:
--    - التعادل: جولة إعادة بين المتعادلين بنصف وقت التصويت، وإذا استمر التعادل فلا إقصاء.
--    - من خرج قبل حسم الليل لا تُحسب قدرته (الطبيب أيضًا).
--    - حالة لعبتي المافيا والمحكمة لا تتغير من المتصفح مباشرة، بل من دوالها على الخادم فقط.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.mafia_settle_vote(uuid,jsonb,boolean)') is null then
    raise exception 'شغّل ملفات المافيا حتى mafia_v12.sql أولًا، ثم mafia_v13.sql.';
  end if;
end $$;

-- الراوي: دوال النظام تتصرف باسمه.
create or replace function public.mafia_is_narrator(p_room_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when public.is_app_admin() then true
    -- داخل دوال النظام فقط (mafia_redeal وmafia_auto_step): set_config محلي للمعاملة.
    when coalesce(current_setting('alosh.mafia_auto', true), '') = 'on' then true
    when (select s.state_data->>'narrator_id' from public.room_game_state s where s.room_id = p_room_id) is null
      then public.is_room_host(p_room_id)
    else (select (s.state_data->>'narrator_id')::uuid from public.room_game_state s where s.room_id = p_room_id)
         = public.my_player_id(p_room_id)
  end;
$function$;

-- البداية: يقدر يبدأها النظام (لإعادة التوزيع)، وخيار «إذا غاب الراوي».
create or replace function public.mafia_start(p_room_id uuid, p_settings jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not (public.is_room_host(p_room_id) or public.is_app_admin() or coalesce(current_setting('alosh.mafia_auto', true), '') = 'on') then
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
    'host_away', case when p_settings->>'host_away' = 'pause' then 'pause' else 'auto' end,
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
      'log', '[]'::jsonb, 'players_count', v_n, 'last_shot', null, 'last_settings', null, 'unmasked', '[]'::jsonb, 'nominees', null, 'timer_paused', null, 'reveal_i', null, 'host_away', null,
      'evening', v_state.state_data->'evening')
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'mafia', v_mafia, 'narrator', v_narrator_name);
end;
$function$;

-- الليل: لا حماية من طبيب خرج.
create or replace function public.mafia_resolve_night(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- المافيا تقتل فقط إذا اتفقت: كل أفراد المافيا الأحياء اختاروا الاسم نفسه. لا قرعة عند الاختلاف.
  select case when count(distinct a.target_id) = 1
                and count(*) >= (select count(*) from public.room_mafia_roles m
                                  where m.room_id = p_room_id and m.role = 'mafia' and m.alive)
              then (array_agg(a.target_id))[1] end
    into v_kill
    from public.room_mafia_actions a
    join public.room_mafia_roles r on r.room_id = a.room_id and r.player_id = a.actor_id and r.alive and r.role = 'mafia'
   where a.room_id = p_room_id and a.round = v_round and a.kind = 'kill';
  -- من خرج قبل حسم الليل تتوقف قدرته: الحماية من طبيب حي فقط.
  select a.target_id into v_save
    from public.room_mafia_actions a
    join public.room_mafia_roles r on r.room_id = a.room_id and r.player_id = a.actor_id and r.alive
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
$function$;

-- التصويت: جولة إعادة أقصر.
create or replace function public.mafia_settle_vote(p_room_id uuid, p_counts jsonb, p_pick boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Supabase يرفض DELETE بلا WHERE (pg-safeupdate)، حتى داخل الدوال.
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
        -- جولة الإعادة قصيرة: نصف وقت التصويت (20 ثانية على الأقل).
        'vote_ends_at', case when v_secs > 0 then to_jsonb(now() + make_interval(secs => greatest(20, v_secs / 2))) else null end,
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
$function$;

-- 1) إعادة توزيع الأدوار -------------------------------------------------------------
create or replace function public.mafia_redeal(p_room_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sd jsonb;
  v_set jsonb;
begin
  if not (public.mafia_is_narrator(p_room_id) or public.is_room_host(p_room_id)) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_NARRATOR');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if coalesce(v_sd->>'phase', '') = '' or jsonb_typeof(v_sd->'settings') is distinct from 'object' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_STARTED');
  end if;
  v_set := v_sd->'settings';
  if coalesce((v_set->>'auto_mafia')::boolean, false) then
    v_set := v_set - 'mafia';
  end if;
  -- الحالة أولًا (بلا مرحلة)، ثم حذف الأدوار: فلا يحسب مشغّل الخروج فائزًا.
  update public.room_game_state
     set active_question_id = null,
         state_data = jsonb_build_object('last_settings', v_sd->'settings', 'evening', v_sd->'evening')
   where room_id = p_room_id;
  delete from public.room_mafia_roles where room_id = p_room_id;
  delete from public.room_mafia_actions where room_id = p_room_id;
  delete from public.room_mafia_votes where room_id = p_room_id;
  delete from public.room_mafia_vote_log where room_id = p_room_id;
  delete from public.room_mafia_nights where room_id = p_room_id;
  delete from public.room_mafia_suspects where room_id = p_room_id;
  perform set_config('alosh.mafia_auto', 'on', true);
  v_sd := public.mafia_start(p_room_id, v_set);
  perform set_config('alosh.mafia_auto', 'off', true);
  return v_sd;
end;
$function$;

revoke all on function public.mafia_redeal(uuid) from public, anon;
grant execute on function public.mafia_redeal(uuid) to authenticated;

-- 2) غياب الراوي -----------------------------------------------------------------------
create table if not exists public.room_mafia_presence (
  room_id uuid primary key references public.game_rooms (id) on delete cascade,
  narrator_seen timestamptz not null default now()
);
alter table public.room_mafia_presence enable row level security;
revoke all on public.room_mafia_presence from anon, authenticated;

create or replace function public.mafia_narrator_ping(p_room_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.mafia_is_narrator(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_NARRATOR');
  end if;
  insert into public.room_mafia_presence (room_id, narrator_seen) values (p_room_id, now())
  on conflict (room_id) do update set narrator_seen = now();
  -- رجع الراوي: تختفي لافتة الغياب.
  update public.room_game_state set state_data = state_data || jsonb_build_object('host_away', null)
   where room_id = p_room_id and nullif(state_data->>'host_away', '') is not null;
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.mafia_narrator_ping(uuid) from public, anon;
grant execute on function public.mafia_narrator_ping(uuid) to authenticated;

-- يطلبه أي جوال في الغرفة كل قليل. لا يفعل شيئًا ما دام الراوي حاضرًا.
create or replace function public.mafia_auto_step(p_room_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_seen timestamptz;
  v_sd jsonb;
  v_phase text;
  v_prog jsonb;
  v_done boolean;
  v_res jsonb;
begin
  if public.my_player_id(p_room_id) is null and not public.is_room_host(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  select narrator_seen into v_seen from public.room_mafia_presence where room_id = p_room_id;
  if v_seen is null or v_seen > now() - interval '60 seconds' then
    return jsonb_build_object('ok', true, 'away', false);
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  v_phase := coalesce(v_sd->>'phase', '');
  if v_phase not in ('night', 'day', 'vote') then
    return jsonb_build_object('ok', true, 'away', true);
  end if;

  -- إيقاف مؤقت: تتوقف المؤقتات حتى يرجع الراوي.
  if coalesce(v_sd->'settings'->>'host_away', 'auto') = 'pause' then
    if v_sd->>'host_away' is distinct from 'pause' then
      update public.room_game_state
         set state_data = state_data || jsonb_build_object('host_away', 'pause', 'day_ends_at', null, 'vote_ends_at', null, 'night_ends_at', null)
       where room_id = p_room_id;
    end if;
    return jsonb_build_object('ok', true, 'away', true, 'paused', true);
  end if;

  -- يكمل النظام: كل مرحلة بوقت، ثم تُحسم على الخادم.
  perform set_config('alosh.mafia_auto', 'on', true);
  if v_sd->>'host_away' is distinct from 'auto' then
    update public.room_game_state set state_data = state_data || jsonb_build_object('host_away', 'auto') where room_id = p_room_id;
  end if;
  v_prog := public.mafia_progress(p_room_id);
  v_done := coalesce((v_prog->>'total')::int, 0) > 0 and coalesce((v_prog->>'done')::int, 0) >= (v_prog->>'total')::int
            and not coalesce((v_prog->>'mafia_split')::boolean, false);
  if v_phase = 'night' then
    if nullif(v_sd->>'night_ends_at', '') is null then
      update public.room_game_state set state_data = state_data || jsonb_build_object('night_ends_at', now() + interval '60 seconds') where room_id = p_room_id;
    elsif v_done or (v_sd->>'night_ends_at')::timestamptz <= now() then
      v_res := public.mafia_resolve_night(p_room_id);
    end if;
  elsif v_phase = 'day' then
    if nullif(v_sd->>'day_ends_at', '') is null then
      update public.room_game_state set state_data = state_data || jsonb_build_object('day_ends_at', now() + interval '120 seconds') where room_id = p_room_id;
    elsif (v_sd->>'day_ends_at')::timestamptz <= now() then
      v_res := public.mafia_open_vote(p_room_id);
    end if;
  else
    if nullif(v_sd->>'vote_ends_at', '') is null then
      update public.room_game_state set state_data = state_data || jsonb_build_object('vote_ends_at', now() + interval '60 seconds') where room_id = p_room_id;
    elsif v_done or (v_sd->>'vote_ends_at')::timestamptz <= now() then
      v_res := public.mafia_close_vote_core(p_room_id);
    end if;
  end if;
  perform set_config('alosh.mafia_auto', 'off', true);
  return jsonb_build_object('ok', true, 'away', true, 'step', v_res);
end;
$function$;

revoke all on function public.mafia_auto_step(uuid) from public, anon;
grant execute on function public.mafia_auto_step(uuid) to authenticated;

-- 3) الحالة لا تتغير من المتصفح مباشرة في المافيا والمحكمة ---------------------------------
-- دوال اللعبتين (security definer) تعمل باسم مالكها، أما الكتابة المباشرة من المتصفح فباسم authenticated.
create or replace function public.room_game_state_guard()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if current_user in ('authenticated', 'anon') and not public.is_app_admin()
     and exists (select 1 from public.game_rooms r join public.games g on g.id = r.game_id
                  where r.id = new.room_id and g.slug in ('social-mafia', 'court')) then
    raise exception 'SERVER_ONLY' using hint = 'mafia and court change only through their functions';
  end if;
  return new;
end;
$function$;

drop trigger if exists room_game_state_guard on public.room_game_state;
create trigger room_game_state_guard
  before insert or update on public.room_game_state
  for each row execute function public.room_game_state_guard();

create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;
insert into public.app_migrations (name) values ('mafia_v13.sql') on conflict do nothing;

notify pgrst, 'reload schema';
