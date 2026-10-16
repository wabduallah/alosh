-- =============================================================================
-- «المافيا»، الإصدار 11: إصلاح إغلاق التصويت. يُشغَّل بعد mafia_v10.sql، وتشغيله مرة ثانية آمن.
--
-- العطل: إغلاق التصويت (بالزر أو بانتهاء الوقت) يفشل دائمًا بـ «تعذّر تنفيذ الخطوة»، والجولة تعلق
-- في التصويت. السبب: mafia_settle_vote تفرّغ جدولًا مؤقتًا بـ «delete from pg_temp.mafia_t;» بلا WHERE،
-- وSupabase يرفض أي DELETE بلا WHERE («DELETE requires a WHERE clause») حتى داخل الدوال.
-- الإصلاح: «where true». والغرفة العالقة تُكمل بضغط «أغلق التصويت» مرة ثانية بعد تشغيل الملف.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.mafia_settle_vote(uuid,jsonb,boolean)') is null then
    raise exception 'شغّل mafia_v9.sql وmafia_v10.sql أولًا، ثم mafia_v11.sql.';
  end if;
end $$;

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
$function$;

create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;
insert into public.app_migrations (name) values ('mafia_v11.sql') on conflict do nothing;

notify pgrst, 'reload schema';
