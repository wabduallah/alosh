-- =============================================================================
-- «المافيا» الإصدار 2. تشغيله مرة ثانية آمن.
--
-- دوال المافيا كانت في قاعدة البيانات فقط؛ هذا الملف ينسخها إلى المستودع مع
-- هذه التعديلات:
--   1) المحقق: تحقيق واحد كل ليلة يُقفل بعد اختياره، ونتيجته تظهر بعد انتهاء
--      الليل. (قبل هذا كان يقدر يغيّر هدفه ويرى النتيجة فورًا، فيكشف الجميع
--      في ليلة واحدة.) ويرى سجل تحقيقاته كاملًا.
--   2) mafia_progress: كم اختار في الليل (للمضيف فقط) وكم صوّت (للجميع)،
--      بدون كشف من اختار ماذا.
--   3) mafia_team_picks: كل فرد من المافيا يرى اختيارات زملائه هذه الليلة.
--   4) التعادل في التصويت: جولة إعادة بين المتعادلين فقط؛ إذا تعادلوا مرة
--      ثانية لا يُقصى أحد.
--   5) الطبيب: لا يحمي نفس اللاعب ليلتين متتاليتين، ويحمي نفسه مرة واحدة في
--      المباراة.
-- =============================================================================

-- Start: same as before, and clears leftovers of an earlier game in the room.
create or replace function public.mafia_start(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_state public.room_game_state%rowtype;
  v_players uuid[];
  v_n int;
  v_mafia int;
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

  select array_agg(p.id order by random()) into v_players
    from public.room_players p where p.room_id = p_room_id and not p.is_host;
  v_n := coalesce(array_length(v_players, 1), 0);
  if v_n < 5 then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ENOUGH_PLAYERS');
  end if;
  if v_n > 14 then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY_PLAYERS');
  end if;

  v_mafia := case when v_n >= 10 then 3 when v_n >= 7 then 2 else 1 end;
  delete from public.room_mafia_roles where room_id = p_room_id;
  delete from public.room_mafia_actions where room_id = p_room_id;
  delete from public.room_mafia_votes where room_id = p_room_id;
  for i in 1..v_n loop
    insert into public.room_mafia_roles (room_id, player_id, role)
    values (p_room_id, v_players[i],
      case
        when i <= v_mafia then 'mafia'
        when i = v_mafia + 1 then 'doctor'
        when i = v_mafia + 2 then 'detective'
        else 'citizen'
      end);
  end loop;

  update public.room_game_state
    set state_data = state_data || jsonb_build_object(
      'phase', 'night', 'round', 1, 'winner', null, 'last_result', null, 'runoff', null)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.mafia_night_action(p_room_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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
  v_kind := case v_role when 'mafia' then 'kill' when 'doctor' then 'save' when 'detective' then 'inspect' end;
  if v_kind is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTION');
  end if;

  select r.role, r.alive into v_target_role, v_target_alive
    from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = p_target_id;
  if not found or not v_target_alive then
    return jsonb_build_object('ok', false, 'reason', 'BAD_TARGET');
  end if;
  if v_kind = 'kill' and v_target_role = 'mafia' then
    return jsonb_build_object('ok', false, 'reason', 'BAD_TARGET');
  end if;
  if v_kind <> 'save' and p_target_id = v_me then
    return jsonb_build_object('ok', false, 'reason', 'BAD_TARGET');
  end if;

  -- The detective gets one inspection a night, and cannot change it.
  if v_kind = 'inspect' and exists (
    select 1 from public.room_mafia_actions a where a.room_id = p_room_id and a.round = v_round and a.actor_id = v_me
  ) then
    return jsonb_build_object('ok', false, 'reason', 'LOCKED');
  end if;

  -- The doctor: not the same player two nights running, and themself once a game.
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
$function$;

create or replace function public.mafia_my_role(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_me uuid := public.my_player_id(p_room_id);
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
  select r.role, r.alive into v_role, v_alive
    from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = v_me;
  if not found then
    return jsonb_build_object('started', false);
  end if;
  select s.state_data->>'phase', coalesce((s.state_data->>'round')::int, 1) into v_phase, v_round
    from public.room_game_state s where s.room_id = p_room_id;

  if v_role = 'detective' then
    -- Results only for nights that are over.
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
    'teammates', case when v_role = 'mafia' then (
        select coalesce(jsonb_agg(p.player_name order by p.joined_at), '[]'::jsonb)
        from public.room_mafia_roles m
        join public.room_players p on p.id = m.player_id
        where m.room_id = p_room_id and m.role = 'mafia' and m.player_id <> v_me
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
         where a.room_id = p_room_id and a.actor_id = v_me and a.kind = 'save' and a.target_id = v_me and a.round < v_round) end
  );
end;
$function$;

-- Tonight's picks of the whole mafia team, for mafia members only.
create or replace function public.mafia_team_picks(p_room_id uuid)
returns table(player_name text, target_id uuid, target_name text)
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_round int;
begin
  if v_me is null or not exists (
    select 1 from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = v_me and r.role = 'mafia'
  ) then
    return;
  end if;
  select coalesce((s.state_data->>'round')::int, 1) into v_round from public.room_game_state s
   where s.room_id = p_room_id and s.state_data->>'phase' = 'night';
  if v_round is null then
    return;
  end if;
  return query
    select p.player_name, a.target_id, t.player_name
      from public.room_mafia_actions a
      join public.room_players p on p.id = a.actor_id
      join public.room_players t on t.id = a.target_id
     where a.room_id = p_room_id and a.round = v_round and a.kind = 'kill'
     order by p.joined_at;
end;
$function$;

-- How far the current phase is: votes for everyone, night actions for the host only.
create or replace function public.mafia_progress(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_phase text;
  v_round int;
  v_host boolean := public.is_room_host(p_room_id) or public.is_app_admin();
begin
  if not (v_host or public.my_player_id(p_room_id) is not null) then
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
  if v_phase = 'night' and v_host then
    return jsonb_build_object('phase', 'night',
      'done', (select count(*) from public.room_mafia_actions a
                 join public.room_mafia_roles r on r.room_id = a.room_id and r.player_id = a.actor_id and r.alive
                where a.room_id = p_room_id and a.round = v_round),
      'total', (select count(*) from public.room_mafia_roles r
                 where r.room_id = p_room_id and r.alive and r.role in ('mafia', 'doctor', 'detective')),
      'mafia_split', (select count(distinct a.target_id) > 1 from public.room_mafia_actions a
                       where a.room_id = p_room_id and a.round = v_round and a.kind = 'kill'));
  end if;
  return jsonb_build_object('phase', v_phase);
end;
$function$;

create or replace function public.mafia_resolve_night(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_state public.room_game_state%rowtype;
  v_round int;
  v_kill uuid;
  v_save uuid;
  v_name text;
  v_winner text;
  v_result text;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or coalesce(v_state.state_data->>'phase', '') <> 'night' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_round := coalesce((v_state.state_data->>'round')::int, 1);

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

  if v_kill is not null and v_kill is distinct from v_save then
    update public.room_mafia_roles set alive = false
      where room_id = p_room_id and player_id = v_kill;
    select p.player_name into v_name from public.room_players p where p.id = v_kill;
    v_result := 'قُتل ' || coalesce(v_name, 'لاعب') || ' هذه الليلة.';
  else
    v_result := 'لم يُقتل أحد هذه الليلة.';
  end if;

  v_winner := public.mafia_winner(p_room_id);
  update public.room_game_state
    set state_data = state_data || jsonb_build_object(
      'phase', case when v_winner is null then 'day' else 'over' end,
      'winner', v_winner,
      'runoff', null,
      'last_result', v_result)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'winner', v_winner);
end;
$function$;

create or replace function public.mafia_open_vote(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  if not exists (
    select 1 from public.room_game_state s
    where s.room_id = p_room_id and s.state_data->>'phase' = 'day'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  update public.room_game_state
    set state_data = state_data || jsonb_build_object('phase', 'vote', 'runoff', null)
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.mafia_vote(p_room_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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

  insert into public.room_mafia_votes (room_id, round, voter_id, target_id)
    values (p_room_id, v_round, v_me, p_target_id)
    on conflict (room_id, round, voter_id)
    do update set target_id = excluded.target_id;

  return jsonb_build_object('ok', true);
end;
$function$;

-- Close the vote. A tie the first time: a second vote between the tied players only.
create or replace function public.mafia_close_vote(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_state public.room_game_state%rowtype;
  v_round int;
  v_top uuid;
  v_top_count int;
  v_ties int;
  v_tied jsonb;
  v_names text;
  v_name text;
  v_winner text;
  v_result text;
  v_runoff jsonb;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or coalesce(v_state.state_data->>'phase', '') <> 'vote' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_round := coalesce((v_state.state_data->>'round')::int, 1);
  v_runoff := v_state.state_data->'runoff';

  select t.target_id, t.c into v_top, v_top_count
    from (
      select v.target_id, count(*) as c
      from public.room_mafia_votes v
      where v.room_id = p_room_id and v.round = v_round
      group by v.target_id
    ) t
    order by t.c desc
    limit 1;
  select count(*), coalesce(jsonb_agg(t.target_id::text), '[]'::jsonb) into v_ties, v_tied
    from (
      select v.target_id, count(*) as c
      from public.room_mafia_votes v
      where v.room_id = p_room_id and v.round = v_round
      group by v.target_id
    ) t
    where t.c = v_top_count;

  if v_top is not null and v_ties > 1 and jsonb_typeof(v_runoff) is distinct from 'array' then
    -- First tie: vote again between the tied players.
    select string_agg(p.player_name, ' و' order by p.joined_at) into v_names
      from public.room_players p where v_tied @> to_jsonb(p.id::text);
    delete from public.room_mafia_votes where room_id = p_room_id and round = v_round;
    update public.room_game_state
      set state_data = state_data || jsonb_build_object(
        'runoff', v_tied,
        'last_result', 'تعادل بين ' || coalesce(v_names, 'لاعبين') || '. صوّتوا مرة ثانية بينهم فقط.')
      where room_id = p_room_id;
    return jsonb_build_object('ok', true, 'runoff', true);
  end if;

  if v_top is not null and v_ties = 1 then
    update public.room_mafia_roles set alive = false
      where room_id = p_room_id and player_id = v_top;
    select p.player_name into v_name from public.room_players p where p.id = v_top;
    v_result := 'أُقصي ' || coalesce(v_name, 'لاعب') || ' بالتصويت.';
  elsif v_top is null then
    v_result := 'لم يصوّت أحد، لم يُقصَ أحد.';
  else
    v_result := 'تعادل مرة ثانية، لم يُقصَ أحد.';
  end if;

  v_winner := public.mafia_winner(p_room_id);
  update public.room_game_state
    set state_data = state_data || jsonb_build_object(
      'phase', case when v_winner is null then 'night' else 'over' end,
      'round', case when v_winner is null then v_round + 1 else v_round end,
      'winner', v_winner,
      'runoff', null,
      'last_result', v_result)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'winner', v_winner);
end;
$function$;

-- Unchanged, kept here so the repository has every mafia function.
create or replace function public.mafia_players(p_room_id uuid)
returns table(player_id uuid, player_name text, alive boolean, player_role text)
language sql stable security definer set search_path to 'public' as $function$
  select p.id,
         p.player_name,
         coalesce(r.alive, true),
         case when (select s.state_data->>'phase' from public.room_game_state s where s.room_id = p_room_id) = 'over'
              then r.role end
  from public.room_players p
  left join public.room_mafia_roles r on r.room_id = p.room_id and r.player_id = p.id
  where p.room_id = p_room_id and not p.is_host
  order by p.joined_at;
$function$;

create or replace function public.mafia_winner(p_room_id uuid)
returns text language sql stable security definer set search_path to 'public' as $function$
  select case
    when x.mafia_alive = 0 then 'citizens'
    when x.mafia_alive >= x.other_alive then 'mafia'
    else null
  end
  from (
    select count(*) filter (where r.role = 'mafia' and r.alive) as mafia_alive,
           count(*) filter (where r.role <> 'mafia' and r.alive) as other_alive
    from public.room_mafia_roles r
    where r.room_id = p_room_id
  ) x;
$function$;

revoke all on function public.mafia_team_picks(uuid), public.mafia_progress(uuid) from public, anon;
grant execute on function public.mafia_team_picks(uuid), public.mafia_progress(uuid) to authenticated;

notify pgrst, 'reload schema';
