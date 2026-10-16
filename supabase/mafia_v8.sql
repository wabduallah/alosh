-- =============================================================================
-- «المافيا»، الإصدار 8. يُشغَّل بعد mafia_v7.sql، وتشغيله مرة ثانية آمن.
--
-- 1) مؤقت الليل (night_seconds): يبدأ مع كل ليلة، وحين ينتهي يُحسم الليل من أي جوال في الغرفة
--    (mafia_night_timeout)، بما اختاره أصحاب الأدوار حتى تلك اللحظة.
-- 2) الراوي يرى أسماء من لم يختر بعد ليلًا، ومن لم يصوّت في التصويت (mafia_progress.waiting).
-- =============================================================================

do $$
begin
  if to_regprocedure('public.mafia_spy_check(uuid,uuid)') is null then
    raise exception 'شغّل ملفات المافيا حتى mafia_v7.sql أولًا، ثم mafia_v8.sql.';
  end if;
end $$;

-- كل ليلة جديدة تأخذ موعد نهايتها من الإعداد.
create or replace function public.mafia_night_deadline()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_secs int := coalesce((new.state_data->'settings'->>'night_seconds')::int, 0);
begin
  if new.state_data->>'phase' = 'night' and v_secs > 0 and new.state_data ? 'narrator_id'
     and (tg_op = 'INSERT' or old.state_data->>'phase' is distinct from 'night'
          or old.state_data->>'round' is distinct from new.state_data->>'round') then
    new.state_data := new.state_data || jsonb_build_object('night_ends_at', now() + make_interval(secs => v_secs));
  elsif new.state_data->>'phase' is distinct from 'night' and new.state_data ? 'night_ends_at' and new.state_data->>'night_ends_at' is not null then
    new.state_data := new.state_data || jsonb_build_object('night_ends_at', null);
  end if;
  return new;
end;
$$;
drop trigger if exists mafia_night_deadline on public.room_game_state;
create trigger mafia_night_deadline before insert or update of state_data on public.room_game_state
  for each row execute function public.mafia_night_deadline();

-- البداية: مؤقت الليل.
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

-- حسم الليل: للراوي، أو لانتهاء مؤقت الليل.
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
    v_result := 'لم يُقتل أحد هذه الليلة.';
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

-- انتهى وقت الليل: أي جوال في الغرفة يطلب الحسم، والخادم يتأكد من الوقت.
create or replace function public.mafia_night_timeout(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_out jsonb;
begin
  if not (public.mafia_is_narrator(p_room_id) or public.is_room_host(p_room_id) or public.my_player_id(p_room_id) is not null) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id;
  if coalesce(v_sd->>'phase', '') <> 'night' or nullif(v_sd->>'night_ends_at', '') is null then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if now() < (v_sd->>'night_ends_at')::timestamptz - interval '1 second' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_YET');
  end if;
  perform set_config('alosh.night_timeout', 'on', true);
  v_out := public.mafia_resolve_night(p_room_id);
  perform set_config('alosh.night_timeout', '', true);
  return v_out;
end;
$$;
revoke all on function public.mafia_night_timeout(uuid) from public, anon;
grant execute on function public.mafia_night_timeout(uuid) to authenticated;

-- التقدم: أسماء من لم يختر أو لم يصوّت، للراوي.
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
                 where r.room_id = p_room_id and r.alive and r.role in ('mafia', 'doctor', 'detective', 'bodyguard')),
      'mafia_split', (select count(distinct a.target_id) > 1 from public.room_mafia_actions a
                       where a.room_id = p_room_id and a.round = v_round and a.kind = 'kill'),
      'waiting', (select coalesce(jsonb_agg(jsonb_build_object('name', p.player_name, 'role', r.role) order by p.joined_at), '[]'::jsonb)
                    from public.room_mafia_roles r join public.room_players p on p.id = r.player_id
                   where r.room_id = p_room_id and r.alive and r.role in ('mafia', 'doctor', 'detective', 'bodyguard')
                     and not exists (select 1 from public.room_mafia_actions a where a.room_id = p_room_id and a.round = v_round and a.actor_id = r.player_id)));
  end if;
  return jsonb_build_object('phase', v_phase);
end;
$$;

-- سجل الملفات (app_v1.sql): هذا الملف شُغّل.
create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;
insert into public.app_migrations (name) values ('mafia_v8.sql') on conflict do nothing;

notify pgrst, 'reload schema';
