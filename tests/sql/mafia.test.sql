-- المافيا: الجاسوس كل جولتين، المتخفي ينجو أول تصويت، مؤقت الليل، من لم يختر.
\set ON_ERROR_STOP 1
select public.test_room('a0000000-0000-0000-0000-000000000001', 'social-mafia', 8);
select public.test_as(0);
do $$
declare r uuid := 'a0000000-0000-0000-0000-000000000001'; v jsonb; x record; spy_user text; mafia_user text; dis uuid; cit uuid;
begin
  v := public.mafia_start(r, '{"mafia": 1, "spy": true, "disguised": true, "night_seconds": 45}');
  assert (v->>'ok')::boolean, 'mafia_start: ' || v::text;
  assert (select extract(epoch from (state_data->>'night_ends_at')::timestamptz - now()) from room_game_state where room_id = r) between 43 and 46, 'night timer';
  assert jsonb_array_length(public.mafia_progress(r)->'waiting') = 3, 'waiting: mafia, doctor, detective';
  select p.user_id::text into spy_user from room_mafia_roles m join room_players p on p.id = m.player_id where m.room_id = r and m.role = 'spy';
  select p.user_id::text into mafia_user from room_mafia_roles m join room_players p on p.id = m.player_id where m.room_id = r and m.role = 'mafia';
  select player_id into dis from room_mafia_roles where room_id = r and role = 'disguised';
  select player_id into cit from room_mafia_roles where room_id = r and role = 'citizen' limit 1;
  -- الجاسوس
  perform set_config('test.uid', spy_user, false);
  assert (public.mafia_spy_check(r, dis)->>'special')::boolean, 'disguised is special';
  assert public.mafia_spy_check(r, cit)->>'reason' = 'SPY_WAIT', 'spy waits two rounds';
  perform set_config('test.uid', mafia_user, false);
  assert jsonb_array_length(public.mafia_my_role(r)->'spy_checks') = 1, 'mafia sees spy check';
  -- مؤقت الليل: قبل الوقت يُرفض، وبعده يُحسم من أي جوال
  assert public.mafia_night_timeout(r)->>'reason' = 'NOT_YET', 'night not yet';
  update room_game_state set state_data = state_data || jsonb_build_object('night_ends_at', now() - interval '2 seconds') where room_id = r;
  assert (public.mafia_night_timeout(r)->>'ok')::boolean, 'night timeout';
  assert (select state_data->>'phase' from room_game_state where room_id = r) = 'day', 'day after timeout';
  -- المتخفي: ينجو أول مرة
  perform public.test_as(0);
  perform public.mafia_open_vote(r);
  for x in select m.player_id, p.user_id from room_mafia_roles m join room_players p on p.id = m.player_id where m.room_id = r and m.alive and m.player_id <> dis loop
    perform set_config('test.uid', x.user_id::text, false);
    perform public.mafia_vote(r, dis);
  end loop;
  perform public.test_as(0);
  assert (public.mafia_close_vote(r)->>'unmasked')::boolean, 'disguised unmasked';
  assert (select alive from room_mafia_roles where room_id = r and player_id = dis), 'disguised alive';
  -- والمرة الثانية يُقصى
  perform public.mafia_resolve_night(r);
  perform public.mafia_open_vote(r);
  for x in select m.player_id, p.user_id from room_mafia_roles m join room_players p on p.id = m.player_id where m.room_id = r and m.alive and m.player_id <> dis loop
    perform set_config('test.uid', x.user_id::text, false);
    perform public.mafia_vote(r, dis);
  end loop;
  perform public.test_as(0);
  perform public.mafia_close_vote(r);
  assert not (select alive from room_mafia_roles where room_id = r and player_id = dis), 'disguised out the second time';
end $$;
select 'ok mafia';
