-- هل تعرف (heads-up): database layer for the turn-based guessing game.
-- Each turn: host starts it -> one guesser is chosen (every player guesses once
-- before anyone repeats) -> everyone except the guesser sees the current word on
-- their phone and describes it aloud -> host marks correct (the guesser's TEAM
-- gets 1 point) or passes (word goes to the back) -> host ends the turn when the
-- timer runs out. Two teams: players are split into team_color 'A' and 'B' on the
-- first turn. The game ends when every word is answered.

-- 1) Host starts a turn. Builds the shuffled word queue on the first turn.
create or replace function public.heads_start_turn(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_queue jsonb;
  v_guessed jsonb;
  v_guesser uuid;
  v_game uuid;
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
  if coalesce(v_state.state_data->>'phase', '') not in ('', 'idle', 'between', 'heads_idle') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;

  -- Split players into two teams once (A and B alternate over a shuffled list).
  if v_state.state_data->'teams' is null then
    update public.room_players p set team_color = t.team
      from (
        select x.id, case when x.rn % 2 = 1 then 'A' else 'B' end as team
        from (select rp.id, row_number() over (order by random()) as rn
              from public.room_players rp where rp.room_id = p_room_id and not rp.is_host) x
      ) t
      where p.id = t.id;
    v_state.state_data := v_state.state_data || jsonb_build_object(
      'teams', jsonb_build_array('A', 'B'),
      'team_scores', jsonb_build_object('A', 0, 'B', 0));
  end if;

  -- Build the queue once: every word of this game, shuffled.
  v_queue := v_state.state_data->'queue';
  if v_queue is null or jsonb_typeof(v_queue) <> 'array' then
    select r.game_id into v_game from public.game_rooms r where r.id = p_room_id;
    select coalesce(jsonb_agg(q.id::text order by random()), '[]'::jsonb) into v_queue
      from public.questions_bank q
      join public.games g on g.slug = q.game_slug
      where g.id = v_game;
  end if;

  -- Pick the next guesser who has not guessed yet in this cycle.
  v_guessed := coalesce(v_state.state_data->'guessed', '[]'::jsonb);
  if not exists (
    select 1 from public.room_players p
    where p.room_id = p_room_id and not p.is_host and not (v_guessed @> to_jsonb(p.id::text))
  ) then
    v_guessed := '[]'::jsonb;
  end if;
  select p.id into v_guesser from public.room_players p
    where p.room_id = p_room_id and not p.is_host and not (v_guessed @> to_jsonb(p.id::text))
    order by random() limit 1;
  if v_guesser is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ENOUGH_PLAYERS');
  end if;

  if jsonb_array_length(v_queue) = 0 then
    update public.room_game_state
      set active_question_id = null,
          state_data = state_data || jsonb_build_object('queue', v_queue, 'phase', 'over')
      where room_id = p_room_id;
    return jsonb_build_object('ok', false, 'reason', 'GAME_OVER');
  end if;

  update public.room_game_state
    set active_question_id = (v_queue->>0)::uuid,
        state_data = (v_state.state_data) || jsonb_build_object(
          'phase', 'turn',
          'queue', v_queue - 0,
          'guessed', v_guessed || jsonb_build_array(v_guesser::text),
          'guesser_id', v_guesser::text,
          'turn_ends_at', to_jsonb(now() + interval '60 seconds'),
          'buzzer_open', false,
          'buzzer', null)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'guesser', v_guesser);
end;
$$;

-- 2) Host marks the current word as guessed: the guesser gets its points.
create or replace function public.heads_correct(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_points int;
  v_guesser uuid;
  v_team text;
  v_answered jsonb;
  v_next jsonb;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or v_state.active_question_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_WORD');
  end if;
  if coalesce(v_state.state_data->>'phase', '') <> 'turn' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;

  v_points := 1;
  v_guesser := (v_state.state_data->>'guesser_id')::uuid;
  select p.team_color into v_team from public.room_players p where p.id = v_guesser and p.room_id = p_room_id;
  if v_team is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_TEAM');
  end if;
  update public.room_game_state
    set state_data = state_data || jsonb_build_object(
      'team_scores', jsonb_set(
        coalesce(state_data->'team_scores', '{"A":0,"B":0}'::jsonb),
        array[v_team],
        to_jsonb(coalesce((state_data->'team_scores'->>v_team)::int, 0) + v_points)))
    where room_id = p_room_id;

  v_answered := coalesce(v_state.state_data->'answered', '[]'::jsonb) || to_jsonb(v_state.active_question_id::text);
  v_next := coalesce(v_state.state_data->'queue', '[]'::jsonb);

  if jsonb_array_length(v_next) = 0 then
    update public.room_game_state
      set active_question_id = null,
          state_data = state_data || jsonb_build_object('phase', 'turn_over', 'answered', v_answered)
      where room_id = p_room_id;
  else
    update public.room_game_state
      set active_question_id = (v_next->>0)::uuid,
          state_data = state_data || jsonb_build_object('answered', v_answered, 'queue', v_next - 0)
      where room_id = p_room_id;
  end if;

  return jsonb_build_object('ok', true, 'points', v_points);
end;
$$;

-- 3) Host passes: the current word goes to the back of the queue, no points.
create or replace function public.heads_pass(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_queue jsonb;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or v_state.active_question_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_WORD');
  end if;
  if coalesce(v_state.state_data->>'phase', '') <> 'turn' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;

  v_queue := coalesce(v_state.state_data->'queue', '[]'::jsonb) || to_jsonb(v_state.active_question_id::text);
  update public.room_game_state
    set active_question_id = (v_queue->>0)::uuid,
        state_data = state_data || jsonb_build_object('queue', v_queue - 0)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- 4) Host ends the turn (timer ran out or the guesser is done). Unanswered word returns to the queue.
create or replace function public.heads_end_turn(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_queue jsonb;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NO_STATE');
  end if;
  if coalesce(v_state.state_data->>'phase', '') not in ('turn', 'turn_over') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;

  v_queue := coalesce(v_state.state_data->'queue', '[]'::jsonb);
  if v_state.active_question_id is not null then
    v_queue := v_queue || to_jsonb(v_state.active_question_id::text);
  end if;

  update public.room_game_state
    set active_question_id = null,
        state_data = state_data || jsonb_build_object(
          'phase', case when jsonb_array_length(v_queue) = 0 then 'over' else 'between' end,
          'queue', v_queue,
          'turn_ends_at', null,
          'buzzer_open', false,
          'buzzer', null)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- 5) The current word for describers only. The guesser and the host never get it.
create or replace function public.heads_my_word(p_room_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select q.question_text
  from public.room_game_state s
  join public.questions_bank q on q.id = s.active_question_id
  where s.room_id = p_room_id
    and s.state_data->>'phase' = 'turn'
    and coalesce(s.state_data->>'guesser_id', '') <> coalesce(public.my_player_id(p_room_id)::text, '')
    and public.my_player_id(p_room_id) is not null
    and not public.is_room_host(p_room_id);
$$;

revoke execute on function public.heads_start_turn(uuid) from public, anon;
revoke execute on function public.heads_correct(uuid) from public, anon;
revoke execute on function public.heads_pass(uuid) from public, anon;
revoke execute on function public.heads_end_turn(uuid) from public, anon;
revoke execute on function public.heads_my_word(uuid) from public, anon;
grant execute on function public.heads_start_turn(uuid) to authenticated, service_role;
grant execute on function public.heads_correct(uuid) to authenticated, service_role;
grant execute on function public.heads_pass(uuid) to authenticated, service_role;
grant execute on function public.heads_end_turn(uuid) to authenticated, service_role;
grant execute on function public.heads_my_word(uuid) to authenticated, service_role;
