-- المافيا v12: القتل بالاتفاق. اختلاف المافيا أو غياب أحدهم = لا قتل.
\set ON_ERROR_STOP 1
select public.test_room('a1200000-0000-0000-0000-000000000001', 'social-mafia', 7);

create or replace function public.t12_as(p_role text, p_n int default 1) returns uuid language plpgsql as $$
declare v_pid uuid; v_uid uuid;
begin
  select m.player_id, p.user_id into v_pid, v_uid from room_mafia_roles m join room_players p on p.id = m.player_id
   where m.room_id = 'a1200000-0000-0000-0000-000000000001' and m.role = p_role and m.alive order by p.player_name offset p_n - 1 limit 1;
  perform set_config('test.uid', v_uid::text, false);
  return v_pid;
end $$;
create or replace function public.t12_pid(p_role text, p_n int default 1) returns uuid language sql as $$
  select m.player_id from room_mafia_roles m join room_players p on p.id = m.player_id
   where m.room_id = 'a1200000-0000-0000-0000-000000000001' and m.role = p_role and m.alive order by p.player_name offset p_n - 1 limit 1 $$;
create or replace function public.t12_alive() returns int language sql as $$
  select count(*)::int from room_mafia_roles where room_id = 'a1200000-0000-0000-0000-000000000001' and alive $$;

do $$
declare r uuid := 'a1200000-0000-0000-0000-000000000001'; a uuid; b uuid;
begin
  perform public.test_as(0);
  assert (public.mafia_start(r, '{"mafia": 2}')->>'ok')::boolean, 'start';
  a := public.t12_pid('citizen', 1);
  b := public.t12_pid('citizen', 2);

  -- الليلة 1: المافيا مختلفة ← لا قتل.
  perform public.t12_as('mafia', 1); perform public.mafia_night_action(r, a);
  perform public.t12_as('mafia', 2); perform public.mafia_night_action(r, b);
  perform public.test_as(0);
  perform public.mafia_resolve_night(r);
  assert public.t12_alive() = 7, 'split: nobody dies';
  assert (select state_data->>'last_result' from room_game_state where room_id = r) like 'لم يُقتل%', 'split text';

  -- النهار ← تصويت بلا أصوات ← الليلة 2.
  perform public.mafia_open_vote(r);
  perform public.mafia_close_vote(r);
  assert (select state_data->>'phase' from room_game_state where room_id = r) = 'night', 'night 2';

  -- الليلة 2: واحد فقط اختار ← لا قتل.
  perform public.t12_as('mafia', 1); perform public.mafia_night_action(r, a);
  perform public.test_as(0);
  perform public.mafia_resolve_night(r);
  assert public.t12_alive() = 7, 'one pick only: nobody dies';
  perform public.mafia_open_vote(r);
  perform public.mafia_close_vote(r);

  -- الليلة 3: اتفقوا ← يُقتل.
  perform public.t12_as('mafia', 1); perform public.mafia_night_action(r, a);
  perform public.t12_as('mafia', 2); perform public.mafia_night_action(r, a);
  perform public.test_as(0);
  perform public.mafia_resolve_night(r);
  assert not (select alive from room_mafia_roles where room_id = r and player_id = a), 'agreed: the target dies';
end $$;
drop function public.t12_as(text, int); drop function public.t12_pid(text, int); drop function public.t12_alive();
select 'ok mafia12';
