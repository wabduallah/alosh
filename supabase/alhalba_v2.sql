-- =============================================================================
-- «الحلبة» الإصدار 2. يُشغَّل بعد schema_alhalba.sql، وتشغيله مرة ثانية آمن.
--
-- ما الجديد:
--   * المضيف يقدر يشارك في الحلبة (الافتراضي)، فتكفي غرفة من شخصين.
--   * من يحسب الإجابات: المضيف، إلا إذا كان هو صاحب المزايدة، فيحسبها المتحدّي
--     أو أي لاعب آخر في الحلبة. والمتحدّي يقدر يحسب دائمًا.
--   * الإثبات ينتهي تلقائيًا: عند الوصول للعدد المطلوب، أو بعد انتهاء الوقت
--     (أي جهاز في الغرفة يقدر يُنهيه بعد مهلة قصيرة). لا يُقبل عدّ بعد الوقت.
--   * قلوب: لكل لاعب عدد محاولات (1 إلى 3). الفشل ينقص قلبًا، ومن تنتهي قلوبه يخرج.
--   * من ينضم أثناء المباراة يدخل الحلبة في الجولة التالية، ومن يغادر الغرفة يُستبعد.
--   * «مباراة جديدة»: يصفّر النقاط ويعيد الجميع إلى الحلبة.
-- =============================================================================

-- Scores are host-only for browsers. The game's own server functions (like
-- halba_resolve, when a player ends a round after the time is up) mark the
-- transaction as trusted; browsers cannot set this flag.
create or replace function public.room_players_guard_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_client_request() and coalesce(current_setting('alosh.trusted', true), '') <> 'on' then
    if new.room_id is distinct from old.room_id
       or new.user_id is distinct from old.user_id
       or new.joined_at is distinct from old.joined_at then
      raise exception 'PLAYER_FIELDS_LOCKED' using hint = 'room_id, user_id and joined_at cannot be changed';
    end if;
    if (new.score is distinct from old.score or new.is_host is distinct from old.is_host)
       and not public.is_room_host(old.room_id) then
      raise exception 'HOST_ONLY' using hint = 'only the room host can change score or is_host';
    end if;
  end if;
  return new;
end;
$$;

-- Players still in the room, among a list of ids.
create or replace function public.halba_present(p_room_id uuid, p_ids jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(f), '[]'::jsonb)
    from jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)) f
   where exists (select 1 from public.room_players p where p.room_id = p_room_id and p.id::text = f);
$$;

create or replace function public.halba_start_round(
  p_room_id uuid, p_mode text default null, p_rounds int default null,
  p_host_plays boolean default true, p_lives int default 2)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_fighters jsonb;
  v_lives jsonb;
  v_new jsonb;
  v_used jsonb;
  v_topic public.alhalba_topics%rowtype;
  v_duel jsonb := null;
  v_round int;
  v_max int;
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
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if coalesce(v_sd->>'phase', '') not in ('', 'idle', 'result') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;

  -- First round: settings, and everyone enters the ring (the host too, unless they only referee).
  if v_sd->'fighters' is null then
    v_max := greatest(1, least(coalesce(p_lives, 2), 3));
    select coalesce(jsonb_agg(p.id::text order by p.joined_at), '[]'::jsonb) into v_fighters
      from public.room_players p
     where p.room_id = p_room_id and (not p.is_host or coalesce(p_host_plays, true));
    if jsonb_array_length(v_fighters) < 2 then
      return jsonb_build_object('ok', false, 'reason',
        case when coalesce(p_host_plays, true) then 'NOT_ENOUGH_PLAYERS' else 'NOT_ENOUGH_GUESTS' end);
    end if;
    select coalesce(jsonb_object_agg(f, v_max), '{}'::jsonb) into v_lives from jsonb_array_elements_text(v_fighters) f;
    v_sd := v_sd || jsonb_build_object(
      'fighters', v_fighters, 'knocked', '[]'::jsonb, 'lives', v_lives, 'max_lives', v_max,
      'host_plays', coalesce(p_host_plays, true),
      'mode', case when p_mode in ('ffa', 'duel') then p_mode else 'ffa' end,
      'max_rounds', greatest(1, least(coalesce(p_rounds, 7), 30)),
      'round', 0, 'used_topics', '[]'::jsonb);
  else
    -- Later rounds: drop players who left, and let newcomers in with full lives.
    v_fighters := public.halba_present(p_room_id, v_sd->'fighters');
    select coalesce(jsonb_agg(p.id::text order by p.joined_at), '[]'::jsonb) into v_new
      from public.room_players p
     where p.room_id = p_room_id
       and (not p.is_host or coalesce((v_sd->>'host_plays')::boolean, false))
       and not (v_sd->'fighters' @> to_jsonb(p.id::text))
       and not (coalesce(v_sd->'knocked', '[]'::jsonb) @> to_jsonb(p.id::text));
    v_lives := coalesce(v_sd->'lives', '{}'::jsonb);
    select v_lives || coalesce(jsonb_object_agg(f, coalesce((v_sd->>'max_lives')::int, 1)), '{}'::jsonb)
      into v_lives from jsonb_array_elements_text(v_new) f;
    v_fighters := v_fighters || v_new;
    v_sd := v_sd || jsonb_build_object('fighters', v_fighters, 'lives', v_lives);
  end if;

  if jsonb_array_length(v_fighters) < 2 then
    update public.room_game_state set state_data = v_sd || jsonb_build_object('phase', 'over') where room_id = p_room_id;
    return jsonb_build_object('ok', false, 'reason', 'GAME_OVER');
  end if;
  v_round := coalesce((v_sd->>'round')::int, 0) + 1;
  if v_round > coalesce((v_sd->>'max_rounds')::int, 7) then
    update public.room_game_state set state_data = v_sd || jsonb_build_object('phase', 'over') where room_id = p_room_id;
    return jsonb_build_object('ok', false, 'reason', 'GAME_OVER');
  end if;

  v_used := coalesce(v_sd->'used_topics', '[]'::jsonb);
  select * into v_topic from public.alhalba_topics t
    where not (v_used @> to_jsonb(t.id::text)) order by random() limit 1;
  if not found then
    v_used := '[]'::jsonb;
    select * into v_topic from public.alhalba_topics t order by random() limit 1;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'NO_TOPICS');
    end if;
  end if;
  if v_sd->>'mode' = 'duel' then
    select jsonb_agg(f) into v_duel
      from (select f from jsonb_array_elements_text(v_fighters) f order by random() limit 2) x;
  end if;

  update public.room_game_state
    set active_question_id = null,
        state_data = v_sd || jsonb_build_object(
          'phase', 'bid', 'round', v_round,
          'used_topics', v_used || to_jsonb(v_topic.id::text),
          'topic', jsonb_build_object('id', v_topic.id, 'text', v_topic.topic_ar, 'min', v_topic.min_answers,
                                      'seconds', v_topic.time_limit_sec, 'category', v_topic.category),
          'duel', v_duel, 'bid', v_topic.min_answers - 1, 'bidder', null, 'bidder_name', null,
          'challenger', null, 'challenger_name', null, 'count', 0, 'result', null,
          'bid_ends_at', to_jsonb(now() + interval '20 seconds'), 'prove_ends_at', null)
    where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'round', v_round);
end;
$$;

-- Who may count answers and end the proof right now.
create or replace function public.halba_may_judge(p_room_id uuid, p_sd jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_host_player text;
begin
  if public.is_app_admin() then
    return true;
  end if;
  if v_me is not null and p_sd->>'bidder' = v_me::text then
    return false; -- nobody judges their own answers
  end if;
  if public.is_room_host(p_room_id) then
    return true;
  end if;
  if v_me is not null and p_sd->>'challenger' = v_me::text then
    return true;
  end if;
  -- The host is the one proving and nobody challenged: the other fighters count.
  select p.id::text into v_host_player from public.room_players p where p.room_id = p_room_id and p.is_host limit 1;
  return v_me is not null
     and p_sd->>'bidder' = v_host_player
     and coalesce(p_sd->'fighters', '[]'::jsonb) @> to_jsonb(v_me::text);
end;
$$;

-- Ends the proof and moves points. Callers check permissions first.
create or replace function public.halba_resolve(p_room_id uuid, v_sd jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_bid int := coalesce((v_sd->>'bid')::int, 1);
  v_count int := coalesce((v_sd->>'count')::int, 0);
  v_ok boolean;
  v_points int;
  v_bidder uuid := (v_sd->>'bidder')::uuid;
  v_chal uuid := nullif(v_sd->>'challenger', '')::uuid;
  v_fighters jsonb := coalesce(v_sd->'fighters', '[]'::jsonb);
  v_knocked jsonb := coalesce(v_sd->'knocked', '[]'::jsonb);
  v_lives jsonb := coalesce(v_sd->'lives', '{}'::jsonb);
  v_left int;
  v_out boolean := false;
  v_over boolean;
begin
  v_ok := v_count >= v_bid;
  v_points := v_bid * 100;
  perform set_config('alosh.trusted', 'on', true);
  if v_ok then
    update public.room_players set score = score + v_points where id = v_bidder and room_id = p_room_id;
    if v_chal is not null then
      update public.room_players set score = greatest(0, score - v_points) where id = v_chal and room_id = p_room_id;
    end if;
    v_left := coalesce((v_lives->>(v_bidder::text))::int, 1);
  else
    update public.room_players set score = greatest(0, score - v_points) where id = v_bidder and room_id = p_room_id;
    if v_chal is not null then
      update public.room_players set score = score + v_points where id = v_chal and room_id = p_room_id;
    end if;
    v_left := greatest(0, coalesce((v_lives->>(v_bidder::text))::int, 1) - 1);
    v_lives := v_lives || jsonb_build_object(v_bidder::text, v_left);
    if v_left = 0 then
      v_out := true;
      v_fighters := v_fighters - (v_bidder::text);
      v_knocked := v_knocked || to_jsonb(v_bidder::text);
    end if;
  end if;
  perform set_config('alosh.trusted', '', true);
  v_fighters := public.halba_present(p_room_id, v_fighters);
  v_over := jsonb_array_length(v_fighters) < 2
            or coalesce((v_sd->>'round')::int, 1) >= coalesce((v_sd->>'max_rounds')::int, 7);
  update public.room_game_state
    set state_data = v_sd || jsonb_build_object(
      'phase', case when v_over then 'over' else 'result' end,
      'fighters', v_fighters, 'knocked', v_knocked, 'lives', v_lives,
      'result', jsonb_build_object(
        'success', v_ok, 'bidder_name', v_sd->>'bidder_name', 'challenger_name', v_sd->>'challenger_name',
        'bid', v_bid, 'count', v_count, 'points', v_points, 'knocked_out', v_out, 'lives_left', v_left))
    where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'success', v_ok, 'over', v_over);
end;
$$;

-- +1 / -1 while the clock runs (3 seconds of grace). Reaching the bid wins at once.
create or replace function public.halba_count(p_room_id uuid, p_delta int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_count int;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' <> 'prove' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if not public.halba_may_judge(p_room_id, v_sd) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_JUDGE');
  end if;
  if now() > (v_sd->>'prove_ends_at')::timestamptz + interval '3 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'TIME_UP');
  end if;
  v_count := greatest(0, coalesce((v_sd->>'count')::int, 0) + sign(coalesce(p_delta, 0))::int);
  v_sd := v_sd || jsonb_build_object('count', v_count);
  if v_count >= coalesce((v_sd->>'bid')::int, 1) then
    perform public.halba_resolve(p_room_id, v_sd);
    return jsonb_build_object('ok', true, 'count', v_count, 'done', true);
  end if;
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

-- Ends the proof: a judge at any time, or anyone in the room once the time is up.
create or replace function public.halba_finish(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' <> 'prove' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if not public.halba_may_judge(p_room_id, v_sd) then
    if not (public.is_room_host(p_room_id) or public.my_player_id(p_room_id) is not null)
       or now() < (v_sd->>'prove_ends_at')::timestamptz + interval '4 seconds' then
      return jsonb_build_object('ok', false, 'reason', 'NOT_JUDGE');
    end if;
  end if;
  return public.halba_resolve(p_room_id, v_sd);
end;
$$;

-- A new match in the same room: scores back to zero, everyone back in the ring.
create or replace function public.halba_reset(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  update public.room_players set score = 0 where room_id = p_room_id;
  update public.room_game_state
     set active_question_id = null, state_data = '{}'::jsonb
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- The old 3-argument version is replaced by the 5-argument one above.
drop function if exists public.halba_start_round(uuid, text, int);

revoke all on function public.halba_start_round(uuid, text, int, boolean, int), public.halba_count(uuid, int),
  public.halba_finish(uuid), public.halba_reset(uuid), public.halba_resolve(uuid, jsonb),
  public.halba_may_judge(uuid, jsonb), public.halba_present(uuid, jsonb) from public, anon;
grant execute on function public.halba_start_round(uuid, text, int, boolean, int), public.halba_count(uuid, int),
  public.halba_finish(uuid), public.halba_reset(uuid), public.halba_may_judge(uuid, jsonb) to authenticated;
