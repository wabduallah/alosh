-- =============================================================================
-- «المافيا»، الإصدار 12: المافيا تقتل بالاتفاق. يُشغَّل بعد mafia_v11.sql، وتشغيله مرة ثانية آمن.
--
-- كان: إذا اختلفت المافيا تُختار الضحية بالأكثر ثم بالقرعة.
-- صار: الضحية تُعتمد فقط إذا اختار كل أفراد المافيا الأحياء الاسم نفسه. إذا اختلفوا أو لم يختر
-- أحدهم حين تنتهي الليلة، فلا قتل («لم يُقتل أحد هذه الليلة»)، والراوي يرى في تقريره أنهم لم يتفقوا.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.mafia_settle_vote(uuid,jsonb,boolean)') is null then
    raise exception 'شغّل mafia_v11.sql أولًا، ثم mafia_v12.sql.';
  end if;
end $$;

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
$function$;

create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;
insert into public.app_migrations (name) values ('mafia_v12.sql') on conflict do nothing;

notify pgrst, 'reload schema';
