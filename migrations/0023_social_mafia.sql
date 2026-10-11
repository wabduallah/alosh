-- المافيا (social-mafia): roles, night and day rounds, votes.
-- Roles are private: a player sees only their own role (mafia_my_role). Roles of
-- everyone are shown only when the game is over (mafia_players).
-- Rounds: night (mafia kills, doctor saves, detective inspects) -> host resolves
-- -> day (host opens a vote) -> host closes the vote and one player is removed.

-- 1) Tables (locked to clients; access only through the functions below)
create table if not exists public.room_mafia_roles (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  player_id uuid not null references public.room_players(id) on delete cascade,
  role text not null check (role in ('mafia', 'citizen', 'doctor', 'detective')),
  alive boolean not null default true,
  primary key (room_id, player_id)
);

create table if not exists public.room_mafia_actions (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  round int not null,
  actor_id uuid not null references public.room_players(id) on delete cascade,
  kind text not null check (kind in ('kill', 'save', 'inspect')),
  target_id uuid not null references public.room_players(id) on delete cascade,
  primary key (room_id, round, actor_id)
);

create table if not exists public.room_mafia_votes (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  round int not null,
  voter_id uuid not null references public.room_players(id) on delete cascade,
  target_id uuid not null references public.room_players(id) on delete cascade,
  primary key (room_id, round, voter_id)
);

alter table public.room_mafia_roles enable row level security;
alter table public.room_mafia_actions enable row level security;
alter table public.room_mafia_votes enable row level security;
revoke all on public.room_mafia_roles from anon, authenticated;
revoke all on public.room_mafia_actions from anon, authenticated;
revoke all on public.room_mafia_votes from anon, authenticated;

-- 2) Winner: 'mafia' when mafia alive >= others alive, 'citizens' when no mafia is alive
create or replace function public.mafia_winner(p_room_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when x.mafia_alive = 0 then 'citizens'
    when x.mafia_alive >= x.other_alive then 'mafia'
    else null
  end
  from (
    select count(*) filter (where r.role = 'mafia' and r.alive) as mafia_alive,
           count(*) filter (where r.role <> 'mafia' and r.alive) as other_alive
    from public.room_mafia_roles r
    where r.room_id = p_room_id
  ) x;
$$;

-- 3) Host starts: 5 to 14 players (not counting the host). Roles are dealt randomly.
create or replace function public.mafia_start(p_room_id uuid)
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

  v_mafia := case when v_n >= 10 then 3 when v_n >= 7 then 2 else 1 end;
  delete from public.room_mafia_roles where room_id = p_room_id;
  for i in 1..v_n loop
    insert into public.room_mafia_roles (room_id, player_id, role)
    values (p_room_id, v_players[i],
      case
        when i <= v_mafia then 'mafia'
        when i = v_mafia + 1 then 'doctor'
        when i = v_mafia + 2 then 'detective'
        else 'citizen'
      end);
  end loop;

  update public.room_game_state
    set state_data = state_data || jsonb_build_object(
      'phase', 'night', 'round', 1, 'winner', null, 'last_result', null)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- 4) Players list: name and alive flag for everyone; role only when the game is over
create or replace function public.mafia_players(p_room_id uuid)
returns table (player_id uuid, player_name text, alive boolean, player_role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.player_name,
         coalesce(r.alive, true),
         case when (select s.state_data->>'phase' from public.room_game_state s where s.room_id = p_room_id) = 'over'
              then r.role end
  from public.room_players p
  left join public.room_mafia_roles r on r.room_id = p.room_id and r.player_id = p.id
  where p.room_id = p_room_id and not p.is_host
  order by p.joined_at;
$$;

-- 5) My role: only for the caller
create or replace function public.mafia_my_role(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_role text;
  v_alive boolean;
  v_result text;
begin
  if v_me is null then
    return null;
  end if;
  select r.role, r.alive into v_role, v_alive
    from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = v_me;
  if not found then
    return jsonb_build_object('started', false);
  end if;

  if v_role = 'detective' then
    select case when t.role = 'mafia' then 'mafia' else 'not_mafia' end into v_result
      from public.room_mafia_actions a
      join public.room_mafia_roles t on t.room_id = a.room_id and t.player_id = a.target_id
      where a.room_id = p_room_id and a.actor_id = v_me and a.kind = 'inspect'
      order by a.round desc limit 1;
  end if;

  return jsonb_build_object(
    'started', true,
    'role', v_role,
    'alive', v_alive,
    'teammates', case when v_role = 'mafia' then (
        select coalesce(jsonb_agg(p.player_name order by p.joined_at), '[]'::jsonb)
        from public.room_mafia_roles m
        join public.room_players p on p.id = m.player_id
        where m.room_id = p_room_id and m.role = 'mafia' and m.player_id <> v_me
      ) else '[]'::jsonb end,
    'inspect', v_result
  );
end;
$$;

-- 6) Night action (alive players with a role): mafia kills, doctor saves, detective inspects
create or replace function public.mafia_night_action(p_room_id uuid, p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  v_kind := case v_role when 'mafia' then 'kill' when 'doctor' then 'save' when 'detective' then 'inspect' end;
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

  insert into public.room_mafia_actions (room_id, round, actor_id, kind, target_id)
    values (p_room_id, v_round, v_me, v_kind, p_target_id)
    on conflict (room_id, round, actor_id)
    do update set kind = excluded.kind, target_id = excluded.target_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- 7) Host resolves the night: the most chosen kill wins unless the doctor saved that player
create or replace function public.mafia_resolve_night(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_round int;
  v_kill uuid;
  v_save uuid;
  v_name text;
  v_winner text;
  v_result text;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or coalesce(v_state.state_data->>'phase', '') <> 'night' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_round := coalesce((v_state.state_data->>'round')::int, 1);

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

  if v_kill is not null and v_kill is distinct from v_save then
    update public.room_mafia_roles set alive = false
      where room_id = p_room_id and player_id = v_kill;
    select p.player_name into v_name from public.room_players p where p.id = v_kill;
    v_result := 'قُتل ' || coalesce(v_name, 'لاعب') || ' هذه الليلة.';
  else
    v_result := 'لم يُقتل أحد هذه الليلة.';
  end if;

  v_winner := public.mafia_winner(p_room_id);
  update public.room_game_state
    set state_data = state_data || jsonb_build_object(
      'phase', case when v_winner is null then 'day' else 'over' end,
      'winner', v_winner,
      'last_result', v_result)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'winner', v_winner);
end;
$$;

-- 8) Host opens the vote during the day
create or replace function public.mafia_open_vote(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    set state_data = state_data || jsonb_build_object('phase', 'vote')
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 9) Alive player votes for another alive player (one vote each, can change it)
create or replace function public.mafia_vote(p_room_id uuid, p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_state public.room_game_state%rowtype;
  v_round int;
  v_alive boolean;
  v_target_alive boolean;
begin
  if v_me is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id;
  if not found or coalesce(v_state.state_data->>'phase', '') <> 'vote' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_round := coalesce((v_state.state_data->>'round')::int, 1);

  select r.alive into v_alive from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = v_me;
  if not found or not v_alive then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ACTIVE');
  end if;
  select r.alive into v_target_alive from public.room_mafia_roles r where r.room_id = p_room_id and r.player_id = p_target_id;
  if not found or not v_target_alive or p_target_id = v_me then
    return jsonb_build_object('ok', false, 'reason', 'BAD_TARGET');
  end if;

  insert into public.room_mafia_votes (room_id, round, voter_id, target_id)
    values (p_room_id, v_round, v_me, p_target_id)
    on conflict (room_id, round, voter_id)
    do update set target_id = excluded.target_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- 10) Host closes the vote: the most voted player is removed (a tie removes nobody)
create or replace function public.mafia_close_vote(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_round int;
  v_top uuid;
  v_top_count int;
  v_ties int;
  v_name text;
  v_winner text;
  v_result text;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found or coalesce(v_state.state_data->>'phase', '') <> 'vote' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_round := coalesce((v_state.state_data->>'round')::int, 1);

  select t.target_id, t.c into v_top, v_top_count
    from (
      select v.target_id, count(*) as c
      from public.room_mafia_votes v
      where v.room_id = p_room_id and v.round = v_round
      group by v.target_id
    ) t
    order by t.c desc
    limit 1;
  select count(*) into v_ties
    from (
      select count(*) as c
      from public.room_mafia_votes v
      where v.room_id = p_room_id and v.round = v_round
      group by v.target_id
    ) t
    where t.c = v_top_count;

  if v_top is not null and v_ties = 1 then
    update public.room_mafia_roles set alive = false
      where room_id = p_room_id and player_id = v_top;
    select p.player_name into v_name from public.room_players p where p.id = v_top;
    v_result := 'أُقصي ' || coalesce(v_name, 'لاعب') || ' بالتصويت.';
  else
    v_result := 'تعادل في التصويت، لم يُقصَ أحد.';
  end if;

  v_winner := public.mafia_winner(p_room_id);
  update public.room_game_state
    set state_data = state_data || jsonb_build_object(
      'phase', case when v_winner is null then 'night' else 'over' end,
      'round', case when v_winner is null then v_round + 1 else v_round end,
      'winner', v_winner,
      'last_result', v_result)
    where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'winner', v_winner);
end;
$$;

-- 11) Grants: only signed-in players, and the host checks happen inside the functions
do $$
declare
  f text;
begin
  foreach f in array array[
    'mafia_winner(uuid)', 'mafia_start(uuid)', 'mafia_players(uuid)', 'mafia_my_role(uuid)',
    'mafia_night_action(uuid,uuid)', 'mafia_resolve_night(uuid)', 'mafia_open_vote(uuid)',
    'mafia_vote(uuid,uuid)', 'mafia_close_vote(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
