-- برة السالفة (Outsider): database layer.
-- Each round: host starts it (random topic, random word, random outsider) ->
-- everyone but the outsider sees the word, the outsider sees only that they are
-- "برة" -> host opens voting -> players vote for the outsider -> host reveals:
-- if the outsider is not caught they win; if caught, they may guess the word
-- and win alone, otherwise the others win.
-- Secrets (topic, word, outsider) live in a table with no client access.

insert into public.games (slug, title_ar, description_ar, min_players, max_players, is_active)
select 'outsider', 'برة السالفة', 'واحد منكم لا يعرف الموضوع. هل تكشفه قبل أن يكشف نفسه؟', 3, 8, true
where not exists (select 1 from public.games where slug = 'outsider');

create table if not exists public.outsider_topics (
  id uuid primary key default gen_random_uuid(),
  title_ar text not null,
  words jsonb not null
);

insert into public.outsider_topics (title_ar, words)
select * from (values
  ('حيوانات', '["أسد","فيل","زرافة","بطريق","دلفين"]'::jsonb),
  ('فواكه', '["مانجو","تفاح","عنب","رمان","أناناس"]'::jsonb),
  ('دول', '["مصر","اليابان","البرازيل","كندا","المغرب"]'::jsonb),
  ('مهن', '["طبيب","مهندس","طيار","طباخ","معلم"]'::jsonb),
  ('أشياء في البيت', '["ثلاجة","كرسي","مروحة","مكنسة","وسادة"]'::jsonb),
  ('رياضات', '["كرة القدم","السباحة","الشطرنج","التنس","الملاكمة"]'::jsonb)
) as v(title_ar, words)
where not exists (select 1 from public.outsider_topics);

create table if not exists public.room_outsider_secrets (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  player_id uuid not null references public.room_players(id) on delete cascade,
  is_outsider boolean not null,
  topic text not null,
  word text not null,
  primary key (room_id, player_id)
);

create table if not exists public.room_outsider_votes (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  voter_id uuid not null references public.room_players(id) on delete cascade,
  target_id uuid not null references public.room_players(id) on delete cascade,
  primary key (room_id, voter_id)
);

alter table public.outsider_topics enable row level security;
alter table public.room_outsider_secrets enable row level security;
alter table public.room_outsider_votes enable row level security;
revoke all on public.outsider_topics, public.room_outsider_secrets, public.room_outsider_votes from anon, authenticated;

-- 1) Host starts a round.
create or replace function public.outsider_start_round(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topic record;
  v_word text;
  v_outsider uuid;
  v_round int;
  v_players int;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  if not exists (select 1 from public.game_rooms r where r.id = p_room_id and r.status = 'playing') then
    return jsonb_build_object('ok', false, 'reason', 'ROOM_NOT_PLAYING');
  end if;
  select count(*) into v_players from public.room_players p where p.room_id = p_room_id and not p.is_host;
  if v_players < 3 then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ENOUGH_PLAYERS');
  end if;

  select t.title_ar, t.words->>(floor(random() * jsonb_array_length(t.words))::int) as word
    into v_topic
    from public.outsider_topics t
    order by random()
    limit 1;
  v_word := v_topic.word;

  select p.id into v_outsider from public.room_players p
    where p.room_id = p_room_id and not p.is_host
    order by random() limit 1;

  delete from public.room_outsider_votes where room_id = p_room_id;
  delete from public.room_outsider_secrets where room_id = p_room_id;

  insert into public.room_outsider_secrets (room_id, player_id, is_outsider, topic, word)
  select p.id, (p.id = v_outsider), v_topic.title_ar, v_word
  from public.room_players p
  where p.room_id = p_room_id and not p.is_host;

  select coalesce((s.state_data->>'round')::int, 0) + 1 into v_round
    from public.room_game_state s where s.room_id = p_room_id;

  update public.room_game_state
    set state_data = state_data || jsonb_build_object(
          'phase', 'discuss', 'round', v_round, 'reveal', null, 'buzzer_open', false, 'buzzer', null)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'round', v_round);
end;
$$;

-- 2) A player's own card: outsiders learn nothing but that they are outsiders.
create or replace function public.outsider_my_card(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when s.is_outsider then jsonb_build_object('is_outsider', true)
    else jsonb_build_object('is_outsider', false, 'topic', s.topic, 'word', s.word)
  end
  from public.room_outsider_secrets s
  where s.room_id = p_room_id and s.player_id = public.my_player_id(p_room_id);
$$;

-- 3) Counts for the host and players.
create or replace function public.outsider_status(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'phase', coalesce(s.state_data->>'phase', ''),
    'round', coalesce((s.state_data->>'round')::int, 0),
    'voted', (select count(*) from public.room_outsider_votes v where v.room_id = p_room_id),
    'players', (select count(*) from public.room_players p where p.room_id = p_room_id and not p.is_host)
  )
  from public.room_game_state s
  where s.room_id = p_room_id;
$$;

-- 4) Host opens voting.
create or replace function public.outsider_open_vote(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select s.state_data->>'phase' into v_phase from public.room_game_state s where s.room_id = p_room_id for update;
  if v_phase is distinct from 'discuss' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  update public.room_game_state set state_data = state_data || jsonb_build_object('phase', 'vote')
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 5) A player votes for who they think the outsider is (can change until reveal).
create or replace function public.outsider_vote(p_room_id uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
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
  if p_target = v_pid then
    return jsonb_build_object('ok', false, 'reason', 'SELF_VOTE');
  end if;
  if not exists (select 1 from public.room_players p where p.id = p_target and p.room_id = p_room_id and not p.is_host) then
    return jsonb_build_object('ok', false, 'reason', 'BAD_TARGET');
  end if;

  insert into public.room_outsider_votes (room_id, voter_id, target_id) values (p_room_id, v_pid, p_target)
  on conflict (room_id, voter_id) do update set target_id = excluded.target_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 6) Host reveals the votes. Caught means exactly one player has the most votes and it is the outsider.
-- Not caught: the outsider wins now. Caught: the outsider gets a chance to guess the word.
create or replace function public.outsider_reveal(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text;
  v_top int;
  v_top_player uuid;
  v_outsider uuid;
  v_outsider_name text;
  v_caught boolean;
  v_votes jsonb;
  v_topic text;
  v_word text;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select s.state_data->>'phase' into v_phase from public.room_game_state s where s.room_id = p_room_id for update;
  if v_phase is distinct from 'vote' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;

  select sec.player_id, sec.topic, sec.word into v_outsider, v_topic, v_word
    from public.room_outsider_secrets sec where sec.room_id = p_room_id and sec.is_outsider;
  select p.player_name into v_outsider_name from public.room_players p where p.id = v_outsider;

  -- Tally: highest count and whether it is unique.
  select t.target_id, t.cnt into v_top_player, v_top
    from (select v.target_id, count(*)::int as cnt from public.room_outsider_votes v
          where v.room_id = p_room_id group by v.target_id order by count(*) desc limit 1) t;
  v_caught := v_top_player is not null and v_top_player = v_outsider
    and (select count(*) from (select v.target_id from public.room_outsider_votes v where v.room_id = p_room_id
          group by v.target_id having count(*) = v_top) z) = 1;

  select jsonb_agg(jsonb_build_object('name', p.player_name, 'votes', (
           select count(*) from public.room_outsider_votes v where v.room_id = p_room_id and v.target_id = p.id))
         order by p.player_name)
    into v_votes
    from public.room_players p where p.room_id = p_room_id and not p.is_host;

  if v_caught then
    update public.room_game_state set state_data = state_data || jsonb_build_object(
        'phase', 'guess',
        'reveal', jsonb_build_object('outsider', v_outsider_name, 'caught', true, 'votes', coalesce(v_votes, '[]'::jsonb)))
      where room_id = p_room_id;
  else
    update public.room_players set score = score + 300 where id = v_outsider and room_id = p_room_id;
    update public.room_game_state set state_data = state_data || jsonb_build_object(
        'phase', 'done',
        'reveal', jsonb_build_object('outsider', v_outsider_name, 'caught', false, 'topic', v_topic, 'word', v_word,
                                     'votes', coalesce(v_votes, '[]'::jsonb)))
      where room_id = p_room_id;
  end if;

  return jsonb_build_object('ok', true, 'caught', v_caught);
end;
$$;

-- 7) The caught outsider guesses the word. Right: the outsider wins alone (300).
-- Wrong: every other player wins (150 each).
create or replace function public.outsider_guess(p_room_id uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_phase text;
  v_word text;
  v_topic text;
  v_guess text := left(btrim(coalesce(p_text, '')), 40);
  v_ok boolean;
  v_reveal jsonb;
begin
  v_pid := public.my_player_id(p_room_id);
  if v_pid is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  select s.state_data->>'phase' into v_phase from public.room_game_state s where s.room_id = p_room_id for update;
  if v_phase is distinct from 'guess' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  select sec.word, sec.topic into v_word, v_topic from public.room_outsider_secrets sec
    where sec.room_id = p_room_id and sec.player_id = v_pid and sec.is_outsider;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_OUTSIDER');
  end if;
  if v_guess = '' then
    return jsonb_build_object('ok', false, 'reason', 'EMPTY');
  end if;

  v_ok := lower(btrim(v_word)) = lower(v_guess);
  if v_ok then
    update public.room_players set score = score + 300 where id = v_pid and room_id = p_room_id;
  else
    update public.room_players p set score = p.score + 150
      where p.room_id = p_room_id and not p.is_host and p.id <> v_pid;
  end if;

  select s.state_data->'reveal' into v_reveal from public.room_game_state s where s.room_id = p_room_id;
  update public.room_game_state set state_data = state_data || jsonb_build_object(
      'phase', 'done',
      'reveal', coalesce(v_reveal, '{}'::jsonb) || jsonb_build_object('topic', v_topic, 'word', v_word, 'guess', v_guess, 'guess_ok', v_ok))
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'correct', v_ok);
end;
$$;

-- 8) Host ends the round and returns to the lobby state to start another.
create or replace function public.outsider_finish_round(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select s.state_data->>'phase' into v_phase from public.room_game_state s where s.room_id = p_room_id for update;
  if v_phase is distinct from 'done' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  update public.room_game_state set state_data = state_data || jsonb_build_object('phase', 'idle')
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.outsider_start_round(uuid) from public, anon;
revoke execute on function public.outsider_my_card(uuid) from public, anon;
revoke execute on function public.outsider_status(uuid) from public, anon;
revoke execute on function public.outsider_open_vote(uuid) from public, anon;
revoke execute on function public.outsider_vote(uuid, uuid) from public, anon;
revoke execute on function public.outsider_reveal(uuid) from public, anon;
revoke execute on function public.outsider_guess(uuid, text) from public, anon;
revoke execute on function public.outsider_finish_round(uuid) from public, anon;
grant execute on function public.outsider_start_round(uuid) to authenticated, service_role;
grant execute on function public.outsider_my_card(uuid) to authenticated, service_role;
grant execute on function public.outsider_status(uuid) to authenticated, service_role;
grant execute on function public.outsider_open_vote(uuid) to authenticated, service_role;
grant execute on function public.outsider_vote(uuid, uuid) to authenticated, service_role;
grant execute on function public.outsider_reveal(uuid) to authenticated, service_role;
grant execute on function public.outsider_guess(uuid, text) to authenticated, service_role;
grant execute on function public.outsider_finish_round(uuid) to authenticated, service_role;
