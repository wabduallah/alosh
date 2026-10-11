-- Sayed al-khedaa (سيد الخداع): database layer for one bluff round.
-- Flow per question: host starts fakes -> players write fake answers ->
-- host opens voting (options shuffled, owners hidden) -> players vote ->
-- host reveals and the server scores -> host finishes the round.
-- The three bluff tables have RLS and no policies: clients reach them only
-- through the functions below.

create table if not exists public.room_bluff_answers (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  player_id uuid not null references public.room_players(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, player_id)
);

create table if not exists public.room_bluff_options (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  opt_key text not null,
  text text not null,
  owner_player_id uuid references public.room_players(id) on delete cascade,
  is_correct boolean not null default false,
  primary key (room_id, opt_key)
);

create table if not exists public.room_bluff_votes (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  player_id uuid not null references public.room_players(id) on delete cascade,
  opt_key text not null,
  primary key (room_id, player_id)
);

alter table public.room_bluff_answers enable row level security;
alter table public.room_bluff_options enable row level security;
alter table public.room_bluff_votes enable row level security;
revoke all on public.room_bluff_answers, public.room_bluff_options, public.room_bluff_votes from anon, authenticated;

-- 1) Host opens fakes for the active question and clears the previous round.
create or replace function public.bluff_start_fakes(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or v_state.active_question_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_QUESTION');
  end if;

  delete from public.room_bluff_votes where room_id = p_room_id;
  delete from public.room_bluff_options where room_id = p_room_id;
  delete from public.room_bluff_answers where room_id = p_room_id;

  update public.room_game_state
    set state_data = state_data || jsonb_build_object('phase', 'fakes', 'buzzer_open', false, 'buzzer', null, 'reveal', null)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- 2) A player submits a fake answer. The correct answer is rejected.
create or replace function public.bluff_submit_fake(p_room_id uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_text text := left(btrim(coalesce(p_text, '')), 60);
  v_phase text;
  v_correct text;
  v_question uuid;
begin
  v_pid := public.my_player_id(p_room_id);
  if v_pid is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  if exists (select 1 from public.room_players p where p.id = v_pid and p.is_host) then
    return jsonb_build_object('ok', false, 'reason', 'HOST_CANNOT_PLAY');
  end if;
  if v_text = '' then
    return jsonb_build_object('ok', false, 'reason', 'EMPTY');
  end if;

  select s.state_data->>'phase', s.active_question_id into v_phase, v_question
    from public.room_game_state s where s.room_id = p_room_id;
  if v_phase is distinct from 'fakes' or v_question is null then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;

  select q.correct_answer into v_correct from public.questions_bank q where q.id = v_question;
  if lower(btrim(coalesce(v_correct, ''))) = lower(v_text) then
    return jsonb_build_object('ok', false, 'reason', 'SAME_AS_CORRECT');
  end if;

  insert into public.room_bluff_answers (room_id, player_id, text)
  values (p_room_id, v_pid, v_text)
  on conflict (room_id, player_id) do update set text = excluded.text, created_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

-- 3) Counts only, safe for everyone in the room.
create or replace function public.bluff_status(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'phase', coalesce(s.state_data->>'phase', ''),
    'submitted', (select count(*) from public.room_bluff_answers a where a.room_id = p_room_id),
    'voted', (select count(*) from public.room_bluff_votes v where v.room_id = p_room_id),
    'players', (select count(*) from public.room_players p where p.room_id = p_room_id and not p.is_host)
  )
  from public.room_game_state s
  where s.room_id = p_room_id;
$$;

-- 4) Host opens voting: correct answer + player fakes (deduplicated), topped up
-- with bank fakes to at least 3 fakes, then shuffled through random keys.
create or replace function public.bluff_open_vote(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_correct text;
  v_bank jsonb;
  v_rec record;
  v_fakes int;
  v_total int;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or v_state.active_question_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_QUESTION');
  end if;
  if coalesce(v_state.state_data->>'phase', '') <> 'fakes' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;

  select q.correct_answer, q.fake_answers into v_correct, v_bank
    from public.questions_bank q where q.id = v_state.active_question_id;

  insert into public.room_bluff_options (room_id, opt_key, text, owner_player_id, is_correct)
  values (p_room_id, 'c_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10), v_correct, null, true);

  for v_rec in
    select a.player_id, a.text from public.room_bluff_answers a
    where a.room_id = p_room_id order by random()
  loop
    if not exists (
      select 1 from public.room_bluff_options o
      where o.room_id = p_room_id and lower(btrim(o.text)) = lower(btrim(v_rec.text))
    ) then
      insert into public.room_bluff_options (room_id, opt_key, text, owner_player_id, is_correct)
      values (p_room_id, 'f_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10), v_rec.text, v_rec.player_id, false);
    end if;
  end loop;

  select count(*) into v_fakes from public.room_bluff_options o where o.room_id = p_room_id and not o.is_correct;

  for v_rec in
    select btrim(f.value) as fake_text
    from jsonb_array_elements_text(coalesce(v_bank, '[]'::jsonb)) as f(value)
    order by random()
  loop
    exit when v_fakes >= 3;
    if v_rec.fake_text <> '' and not exists (
      select 1 from public.room_bluff_options o
      where o.room_id = p_room_id and lower(btrim(o.text)) = lower(v_rec.fake_text)
    ) then
      insert into public.room_bluff_options (room_id, opt_key, text, owner_player_id, is_correct)
      values (p_room_id, 'b_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10), v_rec.fake_text, null, false);
      v_fakes := v_fakes + 1;
    end if;
  end loop;

  select count(*) into v_total from public.room_bluff_options o where o.room_id = p_room_id;
  if v_total < 2 then
    raise exception 'NOT_ENOUGH_OPTIONS';
  end if;

  update public.room_game_state
    set state_data = state_data || jsonb_build_object('phase', 'vote')
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'options', v_total);
end;
$$;

-- 5) Options for the voting screen. Never returns the correct flag or owners.
create or replace function public.bluff_options(p_room_id uuid)
returns table (opt_key text, opt_text text, is_mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  select o.opt_key,
         o.text,
         (o.owner_player_id is not null and o.owner_player_id = public.my_player_id(p_room_id))
  from public.room_bluff_options o
  join public.room_game_state s on s.room_id = o.room_id
  where o.room_id = p_room_id
    and s.state_data->>'phase' = 'vote'
  order by o.opt_key;
$$;

-- 6) A player votes once, and cannot vote for their own fake answer.
create or replace function public.bluff_vote(p_room_id uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_owner uuid;
  v_phase text;
begin
  v_pid := public.my_player_id(p_room_id);
  if v_pid is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  if exists (select 1 from public.room_players p where p.id = v_pid and p.is_host) then
    return jsonb_build_object('ok', false, 'reason', 'HOST_CANNOT_PLAY');
  end if;
  select s.state_data->>'phase' into v_phase from public.room_game_state s where s.room_id = p_room_id;
  if v_phase is distinct from 'vote' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  select o.owner_player_id into v_owner from public.room_bluff_options o
    where o.room_id = p_room_id and o.opt_key = p_key;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'BAD_OPTION');
  end if;
  if v_owner = v_pid then
    return jsonb_build_object('ok', false, 'reason', 'OWN_ANSWER');
  end if;
  if exists (select 1 from public.room_bluff_votes v where v.room_id = p_room_id and v.player_id = v_pid) then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_VOTED');
  end if;

  insert into public.room_bluff_votes (room_id, player_id, opt_key) values (p_room_id, v_pid, p_key);
  return jsonb_build_object('ok', true);
end;
$$;

-- 7) Host reveals: scores the round once, then stores the reveal for everyone.
-- Correct voters get the full points. Each vote on a player's fake gives that
-- player half the points, rounded down.
create or replace function public.bluff_reveal(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_points int;
  v_reveal jsonb;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or v_state.active_question_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_QUESTION');
  end if;
  if coalesce(v_state.state_data->>'phase', '') <> 'vote' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;

  select coalesce(q.points, 0) into v_points from public.questions_bank q where q.id = v_state.active_question_id;

  update public.room_players p
    set score = p.score + v_points
    where p.room_id = p_room_id
      and p.id in (
        select v.player_id from public.room_bluff_votes v
        join public.room_bluff_options o on o.room_id = v.room_id and o.opt_key = v.opt_key
        where v.room_id = p_room_id and o.is_correct
      );

  update public.room_players p
    set score = p.score + sub.pts
    from (
      select o.owner_player_id as pid, count(*)::int * floor(v_points / 2.0)::int as pts
      from public.room_bluff_votes v
      join public.room_bluff_options o on o.room_id = v.room_id and o.opt_key = v.opt_key
      where v.room_id = p_room_id and o.owner_player_id is not null
      group by o.owner_player_id
    ) sub
    where p.id = sub.pid and p.room_id = p_room_id;

  select jsonb_agg(
           jsonb_build_object(
             'key', o.opt_key,
             'text', o.text,
             'is_correct', o.is_correct,
             'owner', (select rp.player_name from public.room_players rp where rp.id = o.owner_player_id),
             'votes', (select count(*) from public.room_bluff_votes v where v.room_id = o.room_id and v.opt_key = o.opt_key)
           )
           order by o.is_correct desc, o.opt_key
         )
    into v_reveal
    from public.room_bluff_options o
    where o.room_id = p_room_id;

  update public.room_game_state
    set state_data = state_data || jsonb_build_object('phase', 'reveal', 'reveal', coalesce(v_reveal, '[]'::jsonb))
    where room_id = p_room_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- 8) Host closes the round: marks the question answered and returns to the board.
create or replace function public.bluff_finish_round(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_done jsonb;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or v_state.active_question_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_QUESTION');
  end if;
  if coalesce(v_state.state_data->>'phase', '') <> 'reveal' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;

  v_done := coalesce(v_state.state_data->'answered', '[]'::jsonb) || to_jsonb(v_state.active_question_id::text);

  update public.room_game_state
    set active_question_id = null,
        state_data = state_data || jsonb_build_object(
          'phase', 'board', 'buzzer_open', false, 'buzzer', null, 'reveal', null, 'answered', v_done)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Only signed-in players and the host call these; never anon.
revoke execute on function public.bluff_start_fakes(uuid) from public, anon;
revoke execute on function public.bluff_submit_fake(uuid, text) from public, anon;
revoke execute on function public.bluff_status(uuid) from public, anon;
revoke execute on function public.bluff_open_vote(uuid) from public, anon;
revoke execute on function public.bluff_options(uuid) from public, anon;
revoke execute on function public.bluff_vote(uuid, text) from public, anon;
revoke execute on function public.bluff_reveal(uuid) from public, anon;
revoke execute on function public.bluff_finish_round(uuid) from public, anon;
grant execute on function public.bluff_start_fakes(uuid) to authenticated, service_role;
grant execute on function public.bluff_submit_fake(uuid, text) to authenticated, service_role;
grant execute on function public.bluff_status(uuid) to authenticated, service_role;
grant execute on function public.bluff_open_vote(uuid) to authenticated, service_role;
grant execute on function public.bluff_options(uuid) to authenticated, service_role;
grant execute on function public.bluff_vote(uuid, text) to authenticated, service_role;
grant execute on function public.bluff_reveal(uuid) to authenticated, service_role;
grant execute on function public.bluff_finish_round(uuid) to authenticated, service_role;
