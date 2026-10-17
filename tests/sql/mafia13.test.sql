-- المافيا v13: إعادة التوزيع، جولة إعادة أقصر، غياب الراوي (يكمل أو يتوقف)، ومنع الكتابة المباشرة على الحالة.
\set ON_ERROR_STOP 1
select public.test_room('a1300000-0000-0000-0000-000000000002', 'social-mafia', 7);

create or replace function public.t13_sd() returns jsonb language sql as $$
  select state_data from room_game_state where room_id = 'a1300000-0000-0000-0000-000000000002' $$;
create or replace function public.t13_as_player(p_id uuid) returns void language sql as $$
  select set_config('test.uid', (select user_id::text from room_players where id = p_id), false) $$;

do $$
declare r uuid := 'a1300000-0000-0000-0000-000000000002'; v jsonb; n int; x record; t1 uuid; t2 uuid; nid uuid;
begin
  -- 1) إعادة التوزيع من المضيف وسط اللعبة: أدوار جديدة بالإعدادات نفسها.
  perform public.test_as(0);
  assert (public.mafia_start(r, '{"mafia": 2, "vote_seconds": 60, "day_seconds": 0}')->>'ok')::boolean, 'start';
  perform public.mafia_resolve_night(r);
  assert public.t13_sd()->>'phase' = 'day', 'day';
  v := public.mafia_redeal(r);
  assert (v->>'ok')::boolean, 'redeal: ' || v::text;
  assert public.t13_sd()->>'phase' = 'night' and (public.t13_sd()->>'round')::int = 1, 'fresh night 1';
  assert (public.t13_sd()->'settings'->>'mafia')::int = 2 and (public.t13_sd()->'settings'->>'vote_seconds')::int = 60, 'same settings';
  assert (select count(*) from room_mafia_roles where room_id = r) = 7, 'roles dealt again';
  assert public.t13_sd()->'settings'->>'host_away' = 'auto', 'host_away default auto';

  -- لاعب عادي لا يعيد التوزيع.
  perform public.test_as(3);
  assert public.mafia_redeal(r)->>'reason' = 'NOT_NARRATOR', 'player cannot redeal';

  -- 2) جولة الإعادة: نصف وقت التصويت.
  perform public.test_as(0);
  perform public.mafia_resolve_night(r);
  perform public.mafia_open_vote(r);
  select m.player_id into t1 from room_mafia_roles m where m.room_id = r and m.role <> 'mafia' and m.alive order by m.player_id limit 1;
  select m.player_id into t2 from room_mafia_roles m where m.room_id = r and m.role <> 'mafia' and m.alive and m.player_id <> t1 order by m.player_id limit 1;
  n := 0;
  for x in select m.player_id from room_mafia_roles m where m.room_id = r and m.alive and m.player_id not in (t1, t2) order by m.player_id loop
    exit when n >= 2;
    perform public.t13_as_player(x.player_id);
    perform public.mafia_vote(r, case when n = 0 then t1 else t2 end);
    n := n + 1;
  end loop;
  perform public.test_as(0);
  v := public.mafia_close_vote(r);
  assert (v->>'runoff')::boolean, 'tie gives a runoff: ' || v::text;
  assert extract(epoch from (public.t13_sd()->>'vote_ends_at')::timestamptz - now()) between 25 and 31, 'runoff 30 s';
  -- إعادة بلا أصوات ← لا إقصاء.
  perform public.mafia_close_vote(r);
  assert public.t13_sd()->>'phase' = 'night', 'no one out: ' || (public.t13_sd()->>'last_result');

  -- 3) غياب الراوي (يكمل): الراوي نبض ثم غاب دقيقتين.
  assert (public.mafia_narrator_ping(r)->>'ok')::boolean, 'ping';
  perform public.test_as(3);
  assert public.mafia_narrator_ping(r)->>'reason' = 'NOT_NARRATOR', 'only the narrator pings';
  assert not (public.mafia_auto_step(r)->>'away')::boolean, 'narrator present: nothing';
  update room_mafia_presence set narrator_seen = now() - interval '2 minutes' where room_id = r;
  v := public.mafia_auto_step(r);
  assert (v->>'away')::boolean and public.t13_sd()->>'host_away' = 'auto', 'away flag: ' || v::text;
  update room_game_state set state_data = state_data || jsonb_build_object('night_ends_at', now() - interval '1 second') where room_id = r;
  perform public.mafia_auto_step(r);
  assert public.t13_sd()->>'phase' in ('day', 'over'), 'night resolved by the server: ' || (public.t13_sd()->>'phase');
  if public.t13_sd()->>'phase' = 'day' then
    perform public.mafia_auto_step(r);
    assert nullif(public.t13_sd()->>'day_ends_at', '') is not null, 'day gets a timer';
    update room_game_state set state_data = state_data || jsonb_build_object('day_ends_at', now() - interval '1 second') where room_id = r;
    perform public.mafia_auto_step(r);
    assert public.t13_sd()->>'phase' = 'vote', 'vote opened by the server';
  end if;
  -- رجع الراوي: تختفي اللافتة.
  perform public.test_as(0);
  perform public.mafia_narrator_ping(r);
  assert nullif(public.t13_sd()->>'host_away', '') is null, 'back';

  -- 4) غياب الراوي (يتوقف).
  v := public.mafia_redeal(r);
  update room_game_state set state_data = jsonb_set(state_data, '{settings,host_away}', '"pause"') where room_id = r;
  update room_mafia_presence set narrator_seen = now() - interval '2 minutes' where room_id = r;
  perform public.test_as(3);
  v := public.mafia_auto_step(r);
  assert (v->>'paused')::boolean and public.t13_sd()->>'host_away' = 'pause', 'paused';
  assert public.t13_sd()->>'phase' = 'night', 'stays in its phase';
end $$;

-- 5) لا كتابة مباشرة على حالة المافيا من المتصفح، حتى للمضيف.
select public.test_as(0);
set role authenticated;
do $$
begin
  begin
    update room_game_state set state_data = state_data || '{"winner": "citizens"}' where room_id = 'a1300000-0000-0000-0000-000000000002';
    raise exception 'direct write went through';
  exception when others then
    assert sqlerrm = 'SERVER_ONLY', 'guard: ' || sqlerrm;
  end;
end $$;
reset role;

drop function public.t13_sd(); drop function public.t13_as_player(uuid);
select 'ok mafia13';
