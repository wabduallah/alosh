-- المافيا v9: الطرد يحسم، الممتنع، الترشيح، التصويت الشفوي، الاشتباه الليلي، الليلة الأولى بلا قتل.
\set ON_ERROR_STOP 1
select public.test_room('a9000000-0000-0000-0000-000000000003', 'social-mafia', 6);

create or replace function public.t9_uid(p_role text, p_n int default 1) returns text language sql as $$
  select p.user_id::text from room_mafia_roles m join room_players p on p.id = m.player_id
   where m.room_id = 'a9000000-0000-0000-0000-000000000003' and m.role = p_role and m.alive order by p.player_name offset p_n - 1 limit 1 $$;
create or replace function public.t9_pid(p_role text, p_n int default 1) returns uuid language sql as $$
  select m.player_id from room_mafia_roles m join room_players p on p.id = m.player_id
   where m.room_id = 'a9000000-0000-0000-0000-000000000003' and m.role = p_role and m.alive order by p.player_name offset p_n - 1 limit 1 $$;
create or replace function public.t9_as(p_role text, p_n int default 1) returns void language sql as $$
  select set_config('test.uid', public.t9_uid(p_role, p_n), false) $$;
create or replace function public.t9_sd() returns jsonb language sql as $$
  select state_data from room_game_state where room_id = 'a9000000-0000-0000-0000-000000000003' $$;

do $$
declare r uuid := 'a9000000-0000-0000-0000-000000000003'; v jsonb; c1 uuid; c2 uuid; c3 uuid;
begin
  perform public.test_as(0);
  v := public.mafia_start(r, '{"mafia": 1, "no_first_kill": true, "nominate": true, "vote_mode": "count"}');
  assert (v->>'ok')::boolean, 'start: ' || v::text;
  assert not (public.t9_sd()->'settings'->>'dead_see_roles')::boolean, 'dead see roles off by default';
  assert public.t9_sd()->'settings'->>'vote_mode' = 'count', 'vote mode';
  -- الليلة الأولى بلا قتل: المافيا لا تختار، ولا تُنتظر.
  perform public.t9_as('mafia');
  assert public.mafia_night_action(r, public.t9_pid('citizen'))->>'reason' = 'FIRST_NIGHT', 'no kill night 1';
  perform public.test_as(0);
  assert not exists (select 1 from jsonb_array_elements(public.mafia_progress(r)->'waiting') w where w->>'role' = 'mafia'), 'mafia not waited for';
  -- الاشتباه: المواطن يختار، والطبيب لا.
  perform public.t9_as('citizen');
  assert (public.mafia_suspect(r, public.t9_pid('mafia'))->>'ok')::boolean, 'citizen suspects';
  assert public.mafia_my_suspect(r) = public.t9_pid('mafia'), 'my suspect';
  assert public.mafia_suspect(r, (select player_id from room_mafia_roles m join room_players p on p.id = m.player_id where m.room_id = r and p.user_id::text = public.t9_uid('citizen')))->>'reason' = 'BAD_TARGET', 'not self';
  perform public.t9_as('doctor');
  assert public.mafia_suspect(r, public.t9_pid('mafia'))->>'reason' = 'NOT_ACTIVE', 'doctor acts instead';
  perform public.test_as(0);
  assert public.mafia_suspicions(r)->0->>'role' = 'mafia', 'narrator sees suspicions';
  perform public.mafia_resolve_night(r);
  assert public.t9_sd()->>'last_result' like '%التعارف%', 'night 1 text: ' || (public.t9_sd()->>'last_result');
  assert (select count(*) from room_mafia_roles where room_id = r and alive) = 6, 'nobody died night 1';

  -- الترشيح: 2 أو 3 فقط، والتصويت عليهم.
  c1 := public.t9_pid('citizen', 1); c2 := public.t9_pid('citizen', 2); c3 := public.t9_pid('mafia');
  assert public.mafia_nominate(r, array[c1])->>'reason' = 'NOMINEES', 'one nominee rejected';
  assert (public.mafia_nominate(r, array[c1, c3])->>'ok')::boolean, 'nominate';
  perform public.t9_as('doctor');
  assert public.mafia_vote(r, c2)->>'reason' = 'NOT_NOMINEE', 'vote non-nominee';
  assert (public.mafia_vote(r, c3)->>'ok')::boolean, 'vote nominee';
  perform public.test_as(0);
  assert exists (select 1 from public.mafia_vote_details(r) d where d.round = 1 and d.voter is not null), 'narrator sees live votes';

  -- الشفوي بالعدد: تعادل ← إعادة، ثم إقصاء المافيا ← فوز المواطنين.
  v := public.mafia_oral_result(r, jsonb_build_object(c1::text, 2, c3::text, 2));
  assert (v->>'runoff')::boolean and public.t9_sd()->>'phase' = 'vote', 'oral tie → runoff';
  assert public.mafia_oral_result(r, jsonb_build_object(c2::text, 5))->>'reason' = 'NOT_IN_RUNOFF', 'runoff only';
  v := public.mafia_oral_result(r, jsonb_build_object(c3::text, 4, c1::text, 1));
  assert v->>'winner' = 'citizens', 'oral counts eliminate mafia: ' || v::text;
  assert public.t9_sd()->'last_tally'->0->>'votes' = '4', 'tally kept';
  assert public.mafia_suspicions(r)->0->>'role' = 'mafia', 'suspicions at the end';
end $$;

-- الاختيار الشفوي المباشر، والممتنع، والطرد.
select public.test_room('a9000000-0000-0000-0000-000000000003', 'social-mafia', 6);
do $$
declare r uuid := 'a9000000-0000-0000-0000-000000000003'; v jsonb; x record;
begin
  perform public.test_as(0);
  perform public.mafia_start(r, '{"mafia": 2, "vote_mode": "pick", "vote_seconds": 30}');
  perform public.mafia_resolve_night(r);
  -- الراوي: لا إقصاء.
  v := public.mafia_oral_result(r, '{}', true);
  assert public.t9_sd()->>'last_result' like '%لا إقصاء%' and public.t9_sd()->>'phase' = 'night', 'pick none';
  assert public.mafia_oral_result(r, jsonb_build_object(public.t9_pid('citizen',1)::text, 1, public.t9_pid('citizen',2)::text, 1), true)->>'reason' = 'WRONG_PHASE', 'night: no oral';
  perform public.mafia_resolve_night(r);
  -- الراوي يختار مواطنًا.
  v := public.mafia_oral_result(r, jsonb_build_object(public.t9_pid('citizen')::text, 1), true);
  assert jsonb_array_length(public.t9_sd()->'last_tally') = 0, 'pick shows no tally';
  assert (select count(*) from room_mafia_roles where room_id = r and alive) = 5, 'picked out';
  perform public.mafia_resolve_night(r);
  -- تصويت بالجوال: صوت واحد ثم انتهاء الوقت ← الباقون ممتنعون.
  perform public.mafia_open_vote(r);
  perform public.t9_as('doctor');
  perform public.mafia_vote(r, public.t9_pid('mafia'));
  update room_game_state set state_data = state_data || jsonb_build_object('vote_ends_at', now() - interval '3 seconds') where room_id = r;
  perform public.test_as(0);
  v := public.mafia_vote_timeout(r);
  assert not exists (select 1 from room_mafia_vote_log l where l.room_id = r and l.auto), 'no random votes';
  assert (select count(*) from room_mafia_roles where room_id = r and alive) = 4, 'the one vote decided';
  -- الآن: 1 مافيا… أو 2؟ نتحقق من الطرد: طرد مواطن حتى تتساوى المافيا ← تنتهي.
  if public.t9_sd()->>'phase' <> 'over' then
    for x in select m.player_id from room_mafia_roles m where m.room_id = r and m.alive and m.role not in ('mafia', 'spy') loop
      exit when public.t9_sd()->>'phase' = 'over';
      perform public.room_kick(r, x.player_id);
    end loop;
    assert public.t9_sd()->>'phase' = 'over' and public.t9_sd()->>'winner' = 'mafia', 'kick ends the game: ' || coalesce(public.t9_sd()->>'winner', 'null');
  end if;
end $$;
drop function public.t9_uid(text, int); drop function public.t9_pid(text, int); drop function public.t9_as(text, int); drop function public.t9_sd();
select 'ok mafia9';
