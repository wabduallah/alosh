-- Shared helpers for the SQL tests (loaded by replay.sh before the *.test.sql files).
-- test_room(slug, players): a playing room with a host (user a…00) and N guests (user a…01..N).
create or replace function public.test_room(p_room uuid, p_slug text, p_guests int)
returns void language plpgsql as $$
declare i int;
begin
  delete from public.game_rooms where id = p_room;
  insert into public.game_rooms (id, room_code, host_id, game_id, status)
  select p_room, upper(substr(md5(p_room::text), 1, 5)), '00000000-0000-0000-0000-00000000a000', g.id, 'playing' from public.games g where g.slug = p_slug;
  insert into public.room_game_state (room_id, state_data) values (p_room, '{}') on conflict (room_id) do update set state_data = '{}';
  insert into public.room_players (id, room_id, user_id, player_name, is_host)
  values (gen_random_uuid(), p_room, '00000000-0000-0000-0000-00000000a000', 'المضيف', true);
  for i in 1..p_guests loop
    insert into public.room_players (id, room_id, user_id, player_name, is_host)
    values (gen_random_uuid(), p_room, ('00000000-0000-0000-0000-' || lpad(to_hex(40960 + i), 12, '0'))::uuid, 'لاعب' || i, false);
  end loop;
end $$;
-- as(user index): 0 = host, n = guest n.
create or replace function public.test_as(p_n int) returns void language sql as $$
  select set_config('test.uid', ('00000000-0000-0000-0000-' || lpad(to_hex(40960 + p_n), 12, '0'))::text, false)
$$;
