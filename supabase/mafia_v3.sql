-- =============================================================================
-- «المافيا» الإصدار 3. يُشغَّل بعد mafia_v2.sql، وتشغيله مرة ثانية آمن.
--
--   * إعدادات قبل البداية (mafia_start(p_room_id, p_settings)):
--       mafia        عدد المافيا يدويًا (فارغ = تلقائي كما كان)
--       reveal_roles كشف دور من يخرج (افتراضيًا مخفي حتى النهاية كما كان)
--       day_seconds  مؤقت النهار: 0 بدون، أو 60/120/180/300 ثانية
--       jester, mayor, bodyguard  أدوار اختيارية
--   * أدوار اختيارية:
--       المهرّج: يفوز وحده إذا أُقصي بالتصويت.
--       العمدة: معروف للجميع من البداية، وصوته بصوتين.
--       الحارس: يحرس لاعبًا كل ليلة؛ إذا هاجمته المافيا يموت الحارس بدلًا منه
--               (إلا إذا حماه الطبيب، فلا يموت أحد).
--   * كشف الأصوات: بعد كل تصويت تُحفظ «من صوّت على من» لتظهر للجميع.
--   * سجل المباراة (log) لملخص النهاية: نتيجة كل ليلة وكل تصويت مع الأصوات.
-- =============================================================================

-- 1) الأدوار والأفعال الجديدة -----------------------------------------------------
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
  check (role in ('mafia', 'citizen', 'doctor', 'detective', 'jester', 'mayor', 'bodyguard'));
alter table public.room_mafia_actions add constraint room_mafia_actions_kind_check
  check (kind in ('kill', 'save', 'inspect', 'guard'));

create or replace function public.mafia_role_ar(p_role text)
returns text language sql immutable as $$
  select case p_role when 'mafia' then 'مافيا' when 'citizen' then 'مواطنًا' when 'doctor' then 'الطبيب'
    when 'detective' then 'المحقق' when 'jester' then 'المهرّج' when 'mayor' then 'العمدة'
    when 'bodyguard' then 'الحارس' else '' end;
$$;

-- 2) البداية بالإعدادات -----------------------------------------------------------
drop function if exists public.mafia_start(uuid);
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
    'bodyguard', coalesce((p_settings->>'bodyguard')::boolean, false));

  for i in 1..v_mafia loop
    v_roles := array_append(v_roles, 'mafia');
  end loop;
  v_roles := v_roles || array['doctor', 'detective']::text[];
  if (v_settings->>'bodyguard')::boolean then v_roles := array_append(v_roles, 'bodyguard'); end if;
  if (v_settings->>'mayor')::boolean then v_roles := array_append(v_roles, 'mayor'); end if;
  if (v_settings->>'jester')::boolean then v_roles := array_append(v_roles, 'jester'); end if;
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
      'log', '[]'::jsonb, 'players_count', v_n)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'mafia', v_mafia);
end;
$function$;

-- 3) أفعال الليل: الحارس --------------------------------------------------------
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
  if v_kind = 'kill' and v_target_role = 'mafia' then
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
$function$;

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
                 where r.room_id = p_room_id and r.alive and r.role in ('mafia', 'doctor', 'detective', 'bodyguard')),
      'mafia_split', (select count(distinct a.target_id) > 1 from public.room_mafia_actions a
                       where a.room_id = p_room_id and a.round = v_round and a.kind = 'kill'));
  end if;
  return jsonb_build_object('phase', v_phase);
end;
$function$;

-- 4) الفجر: الحارس، كشف الدور، مؤقت النهار، السجل -----------------------------
create or replace function public.mafia_resolve_night(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
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
    v_victim := v_guard_by;          -- the bodyguard dies in their place
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
    set state_data = state_data || jsonb_build_object('phase', 'vote', 'runoff', null, 'day_ends_at', null)
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$function$;

-- 5) إغلاق التصويت: صوت العمدة بصوتين، المهرّج، كشف الأصوات، السجل --------------
create or replace function public.mafia_close_vote(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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
  v_votes jsonb;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or coalesce(v_state.state_data->>'phase', '') <> 'vote' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_sd := v_state.state_data;
  v_round := coalesce((v_sd->>'round')::int, 1);
  v_runoff := v_sd->'runoff';

  -- Who voted for whom, with the mayor's double vote.
  select coalesce(jsonb_agg(jsonb_build_object('voter', vp.player_name, 'target', tp.player_name,
           'weight', case when r.role = 'mayor' then 2 else 1 end) order by tp.player_name, vp.joined_at), '[]'::jsonb)
    into v_votes
    from public.room_mafia_votes v
    join public.room_mafia_roles r on r.room_id = v.room_id and r.player_id = v.voter_id and r.alive
    join public.room_players vp on vp.id = v.voter_id
    join public.room_players tp on tp.id = v.target_id
   where v.room_id = p_room_id and v.round = v_round;

  with t as (
    select v.target_id, sum(case when r.role = 'mayor' then 2 else 1 end) as c
      from public.room_mafia_votes v
      join public.room_mafia_roles r on r.room_id = v.room_id and r.player_id = v.voter_id and r.alive
     where v.room_id = p_room_id and v.round = v_round
     group by v.target_id
  )
  select (select t.target_id from t order by t.c desc limit 1),
         (select max(t.c) from t)
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
        'runoff', v_tied, 'last_result', v_result, 'last_votes', v_votes,
        'log', coalesce(v_sd->'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('round', v_round, 'type', 'vote', 'text', v_result, 'votes', v_votes)))
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
      'last_result', v_result,
      'last_votes', v_votes,
      'log', coalesce(v_sd->'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('round', v_round, 'type', 'vote', 'text', v_result, 'votes', v_votes)))
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'winner', v_winner);
end;
$function$;

-- 6) قائمة اللاعبين: العمدة معروف، والدور يظهر لمن خرج إذا فُعّل الكشف ---------
drop function if exists public.mafia_players(uuid);
create function public.mafia_players(p_room_id uuid)
returns table(player_id uuid, player_name text, alive boolean, player_role text, is_mayor boolean)
language sql stable security definer set search_path to 'public' as $function$
  with s as (
    select s.state_data->>'phase' as phase, coalesce((s.state_data->'settings'->>'reveal_roles')::boolean, false) as reveal
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
  where p.room_id = p_room_id and not p.is_host
  order by p.joined_at;
$function$;

revoke all on function public.mafia_start(uuid, jsonb), public.mafia_players(uuid) from public, anon;
grant execute on function public.mafia_start(uuid, jsonb), public.mafia_players(uuid) to authenticated;
revoke all on function public.mafia_role_ar(text) from public, anon;

notify pgrst, 'reload schema';
