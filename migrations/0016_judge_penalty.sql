-- The host now chooses the penalty for a wrong answer: none, half, or full points.
-- Replaces judge_answer(uuid, boolean) with a version that takes a penalty.

drop function if exists public.judge_answer(uuid, boolean);

create or replace function public.judge_answer(p_room_id uuid, p_correct boolean, p_penalty text default 'none')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_points int;
  v_player_id uuid;
  v_done jsonb;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  if p_penalty not in ('none', 'half', 'full') then
    raise exception 'BAD_PENALTY';
  end if;

  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or v_state.active_question_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_QUESTION');
  end if;

  if v_state.state_data -> 'buzzer' is null or jsonb_typeof(v_state.state_data -> 'buzzer') = 'null' then
    return jsonb_build_object('ok', false, 'reason', 'NO_BUZZER');
  end if;

  v_player_id := (v_state.state_data -> 'buzzer' ->> 'player_id')::uuid;
  select points into v_points from public.questions_bank where id = v_state.active_question_id;

  if p_correct then
    update public.room_players set score = score + coalesce(v_points, 0)
      where id = v_player_id and room_id = p_room_id;

    v_done := coalesce(v_state.state_data -> 'answered', '[]'::jsonb) || to_jsonb(v_state.active_question_id::text);
    update public.room_game_state
      set active_question_id = null,
          state_data = v_state.state_data || jsonb_build_object(
            'phase', 'board', 'buzzer_open', false, 'buzzer', null, 'answered', v_done)
      where room_id = p_room_id;
  else
    if p_penalty = 'full' then
      update public.room_players set score = score - coalesce(v_points, 0)
        where id = v_player_id and room_id = p_room_id;
    elsif p_penalty = 'half' then
      update public.room_players set score = score - floor(coalesce(v_points, 0) / 2.0)::int
        where id = v_player_id and room_id = p_room_id;
    end if;

    update public.room_game_state
      set state_data = v_state.state_data || jsonb_build_object('buzzer_open', true, 'buzzer', null)
      where room_id = p_room_id;
  end if;

  return jsonb_build_object('ok', true, 'correct', p_correct, 'penalty', p_penalty);
end;
$$;

revoke execute on function public.judge_answer(uuid, boolean, text) from public, anon;
grant execute on function public.judge_answer(uuid, boolean, text) to authenticated, service_role;
