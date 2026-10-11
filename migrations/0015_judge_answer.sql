-- Server-side judging for the host's buzzer decision.
-- The host's browser used to write the score itself, so two judgments at the
-- same moment could overwrite each other. This function does the work in one
-- transaction, locked on the room state row.

create or replace function public.judge_answer(p_room_id uuid, p_correct boolean)
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

  -- Lock the state row so two judgments can't run at the same time.
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or v_state.active_question_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_QUESTION');
  end if;

  if v_state.state_data -> 'buzzer' is null or jsonb_typeof(v_state.state_data -> 'buzzer') = 'null' then
    return jsonb_build_object('ok', false, 'reason', 'NO_BUZZER');
  end if;

  v_player_id := (v_state.state_data -> 'buzzer' ->> 'player_id')::uuid;

  if p_correct then
    select points into v_points from public.questions_bank where id = v_state.active_question_id;
    update public.room_players set score = score + coalesce(v_points, 0)
      where id = v_player_id and room_id = p_room_id;

    v_done := coalesce(v_state.state_data -> 'answered', '[]'::jsonb) || to_jsonb(v_state.active_question_id::text);
    update public.room_game_state
      set active_question_id = null,
          state_data = v_state.state_data || jsonb_build_object(
            'phase', 'board', 'buzzer_open', false, 'buzzer', null, 'answered', v_done)
      where room_id = p_room_id;
  else
    update public.room_game_state
      set state_data = v_state.state_data || jsonb_build_object('buzzer_open', true, 'buzzer', null)
      where room_id = p_room_id;
  end if;

  return jsonb_build_object('ok', true, 'correct', p_correct);
end;
$$;

revoke execute on function public.judge_answer(uuid, boolean) from public, anon;
grant execute on function public.judge_answer(uuid, boolean) to authenticated, service_role;
