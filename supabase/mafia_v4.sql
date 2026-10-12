-- =============================================================================
-- «المافيا» الإصدار 4. يُشغَّل بعد mafia_v3.sql، وتشغيله مرة ثانية آمن.
--
--   * مباراة جديدة بنفس الغرفة: mafia_reset يرجع الغرفة للإعدادات بنفس اللاعبين،
--     ويحفظ آخر إعدادات ليختارها المضيف من جديد.
--   * دوران اختياريان:
--       القنّاص: رصاصة واحدة في المباراة، يطلقها في النهار على لاعب حي.
--       العرّافة: مرة واحدة في المباراة تعرف دور لاعب خرج من اللعبة.
-- =============================================================================

do $$
declare c record;
begin
  for c in select con.conname, rel.relname from pg_constraint con join pg_class rel on rel.oid = con.conrelid
            where rel.relname in ('room_mafia_roles', 'room_mafia_actions') and con.contype = 'c'
              and pg_get_constraintdef(con.oid) ~ '(role|kind)'
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
  end loop;
end $$;
alter table public.room_mafia_roles add constraint room_mafia_roles_role_check
  check (role in ('mafia', 'citizen', 'doctor', 'detective', 'jester', 'mayor', 'bodyguard', 'sniper', 'seer'));
alter table public.room_mafia_actions add constraint room_mafia_actions_kind_check
  check (kind in ('kill', 'save', 'inspect', 'guard', 'shoot', 'reveal'));

create or replace function public.mafia_role_ar(p_role text)
returns text language sql immutable as $$
  select case p_role when 'mafia' then 'مافيا' when 'citizen' then 'مواطنًا' when 'doctor' then 'الطبيب'
    when 'detective' then 'المحقق' when 'jester' then 'المهرّج' when 'mayor' then 'العمدة'
    when 'bodyguard' then 'الحارس' when 'sniper' then 'القنّاص' when 'seer' then 'العرّافة' else '' end;
$$;

-- Start: as v3, with the sniper and the seer.
create or replace function public.mafia_start(p_room_id uuid, p_settings jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_state public.room_game_state%rowtype;
  v_players uuid[];
  v_n int;
  v_mafia int;
  v_roles text[] := '{}';
  v_settings jsonb;
  v_day int;
  v_mayor uuid;
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

  v_mafia := case when jsonb_typeof(p_settings->'mafia') = 'number' and (p_settings->>'mafia')::int > 0
                  then (p_settings->>'mafia')::int
                  else case when v_n >= 10 then 3 when v_n >= 7 then 2 else 1 end end;
  if v_mafia * 2 >= v_n then
    return jsonb_build_object('ok', false, 'reason', 'BAD_MAFIA_COUNT');
  end if;
  v_day := coalesce((p_settings->>'day_seconds')::int, 0);
  if v_day not in (0, 60, 120, 180, 300) then
    v_day := 0;
  end if;
  v_settings := jsonb_build_object(
    'mafia', v_mafia,
    'auto_mafia', not (jsonb_typeof(p_settings->'mafia') = 'number' and (p_settings->>'mafia')::int > 0),
    'reveal_roles', coalesce((p_settings->>'reveal_roles')::boolean, false),
    'day_seconds', v_day,
    'jester', coalesce((p_settings->>'jester')::boolean, false),
    'mayor', coalesce((p_settings->>'mayor')::boolean, false),
    'bodyguard', coalesce((p_settings->>'bodyguard')::boolean, false),
    'sniper', coalesce((p_settings->>'sniper')::boolean, false),
    'seer', coalesce((p_settings->>'seer')::boolean, false));

  for i in 1..v_mafia loop
    v_roles := array_append(v_roles, 'mafia');
  end loop;
  v_roles := v_roles || array['doctor', 'detective']::text[];
  if (v_settings->>'bodyguard')::boolean then v_roles := array_append(v_roles, 'bodyguard'); end if;
  if (v_settings->>'mayor')::boolean then v_roles := array_append(v_roles, 'mayor'); end if;
  if (v_settings->>'jester')::boolean then v_roles := array_append(v_roles, 'jester'); end if;
  if (v_settings->>'sniper')::boolean then v_roles := array_append(v_roles, 'sniper'); end if;
  if (v_settings->>'seer')::boolean then v_roles := array_append(v_roles, 'seer'); end if;
  -- At least one plain citizen.
  if array_length(v_roles, 1) >= v_n then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY_ROLES');
  end if;

  delete from public.room_mafia_roles where room_id = p_room_id;
  delete from public.room_mafia_actions where room_id = p_room_id;
  delete from public.room_mafia_votes where room_id = p_room_id;
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
      'settings', v_settings, 'mayor', v_mayor::text, 'last_votes', null, 'day_ends_at', null,
      'log', '[]'::jsonb, 'players_count', v_n, 'last_shot', null, 'last_settings', null)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'mafia', v_mafia);
end;
$function$;

-- Your role: as v2, plus the sniper's bullet and the seer's answer.
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
$function$;

-- Night progress counts only the night actions (not the seer's once-a-game look).
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
                where a.room_id = p_room_id and a.round = v_round and a.kind in ('kill', 'save', 'inspect', 'guard')),
      'total', (select count(*) from public.room_mafia_roles r
                 where r.room_id = p_room_id and r.alive and r.role in ('mafia', 'doctor', 'detective', 'bodyguard')),
      'mafia_split', (select count(distinct a.target_id) > 1 from public.room_mafia_actions a
                       where a.room_id = p_room_id and a.round = v_round and a.kind = 'kill'));
  end if;
  return jsonb_build_object('phase', v_phase);
end;
$function$;

-- «مباراة جديدة»: back to the setup with the same players; the last settings are kept.
create or replace function public.mafia_reset(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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
  update public.room_game_state
    set active_question_id = null,
        state_data = jsonb_build_object('last_settings', v_sd->'settings')
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$function$;

-- 🎯 The sniper: one bullet a game, fired in the day.
create or replace function public.mafia_shoot(p_room_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_sd jsonb;
  v_round int;
  v_role text;
  v_alive boolean;
  v_target_role text;
  v_target_alive boolean;
  v_name text;
  v_result text;
  v_winner text;
begin
  if v_me is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if coalesce(v_sd->>'phase', '') <> 'day' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_round := coalesce((v_sd->>'round')::int, 1);
  select r.role, r.alive into v_role, v_alive from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = v_me;
  if not found or not v_alive or v_role <> 'sniper' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ACTIVE');
  end if;
  if exists (select 1 from public.room_mafia_actions a where a.room_id = p_room_id and a.actor_id = v_me and a.kind = 'shoot') then
    return jsonb_build_object('ok', false, 'reason', 'USED');
  end if;
  select r.role, r.alive into v_target_role, v_target_alive from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = p_target_id;
  if not found or not v_target_alive or p_target_id = v_me then
    return jsonb_build_object('ok', false, 'reason', 'BAD_TARGET');
  end if;

  -- Night actions use (room, round, actor); the sniper has none, so the day's round is free.
  insert into public.room_mafia_actions (room_id, round, actor_id, kind, target_id)
    values (p_room_id, v_round, v_me, 'shoot', p_target_id)
    on conflict (room_id, round, actor_id) do update set kind = excluded.kind, target_id = excluded.target_id;
  update public.room_mafia_roles set alive = false where room_id = p_room_id and player_id = p_target_id;
  select p.player_name into v_name from public.room_players p where p.id = p_target_id;
  v_result := 'دوّى صوت رصاصة! قُتل ' || coalesce(v_name, 'لاعب')
    || case when coalesce((v_sd->'settings'->>'reveal_roles')::boolean, false) then '، وكان ' || public.mafia_role_ar(v_target_role) else '' end
    || '.';
  v_winner := public.mafia_winner(p_room_id);
  update public.room_game_state
    set state_data = state_data || jsonb_build_object(
      'phase', case when v_winner is null then 'day' else 'over' end,
      'winner', v_winner,
      'last_result', v_result,
      'last_shot', jsonb_build_object('text', v_result, 'at', now()),
      'log', coalesce(v_sd->'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('round', v_round, 'type', 'shot', 'text', v_result)))
    where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'winner', v_winner);
end;
$function$;

-- 🔮 The seer: once a game, learn the role of a player who is out.
create or replace function public.mafia_seer(p_room_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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
    raise exception 'NOT_IN_ROOM';
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id;
  if coalesce(v_sd->>'phase', '') in ('', 'over') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_round := coalesce((v_sd->>'round')::int, 1);
  select r.role, r.alive into v_role, v_alive from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = v_me;
  if not found or not v_alive or v_role <> 'seer' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ACTIVE');
  end if;
  if exists (select 1 from public.room_mafia_actions a where a.room_id = p_room_id and a.actor_id = v_me and a.kind = 'reveal') then
    return jsonb_build_object('ok', false, 'reason', 'USED');
  end if;
  select r.role, r.alive into v_target_role, v_target_alive from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = p_target_id;
  if not found or v_target_alive then
    return jsonb_build_object('ok', false, 'reason', 'NOT_DEAD');
  end if;
  insert into public.room_mafia_actions (room_id, round, actor_id, kind, target_id)
    values (p_room_id, v_round, v_me, 'reveal', p_target_id)
    on conflict (room_id, round, actor_id) do update set kind = excluded.kind, target_id = excluded.target_id;
  return jsonb_build_object('ok', true, 'role', v_target_role);
end;
$function$;

revoke all on function public.mafia_reset(uuid), public.mafia_shoot(uuid, uuid), public.mafia_seer(uuid, uuid) from public, anon;
grant execute on function public.mafia_reset(uuid), public.mafia_shoot(uuid, uuid), public.mafia_seer(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
