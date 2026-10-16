-- المافيا v10: تقرير الليلة، إعلان المحاولة الفاشلة، المؤقت، نتيجة السهرة، كشف الأدوار.
\set ON_ERROR_STOP 1
select public.test_room('a9000000-0000-0000-0000-000000000003', 'social-mafia', 6);
create or replace function public.t10_pid(p_role text, p_n int default 1) returns uuid language sql as $$
  select m.player_id from room_mafia_roles m join room_players p on p.id = m.player_id
   where m.room_id = 'a9000000-0000-0000-0000-000000000003' and m.role = p_role and m.alive order by p.player_name offset p_n - 1 limit 1 $$;
create or replace function public.t10_as(p_role text, p_n int default 1) returns void language sql as $$
  select set_config('test.uid', (select p.user_id::text from room_players p where p.id = public.t10_pid(p_role, p_n)), false) $$;
create or replace function public.t10_sd() returns jsonb language sql as $$
  select state_data from room_game_state where room_id = 'a9000000-0000-0000-0000-000000000003' $$;

do $$
declare r uuid := 'a9000000-0000-0000-0000-000000000003'; v jsonb; rep jsonb; left1 int;
begin
  perform public.test_as(0);
  perform public.mafia_start(r, '{"mafia": 1, "announce_saves": true, "day_seconds": 120}');
  -- الليلة: المافيا تختار المحقق، والطبيب يحميه، والمحقق يحقق مع المافيا.
  perform public.t10_as('mafia'); perform public.mafia_night_action(r, public.t10_pid('detective'));
  perform public.t10_as('doctor'); perform public.mafia_night_action(r, public.t10_pid('detective'));
  perform public.t10_as('detective'); perform public.mafia_night_action(r, public.t10_pid('mafia'));
  perform public.t10_as('citizen');
  assert public.mafia_night_report(r) is null, 'report narrator only';
  perform public.test_as(0);
  perform public.mafia_resolve_night(r);
  assert public.t10_sd()->>'last_result' like '%الطبيب أنقذ الضحية%', 'announce save: ' || (public.t10_sd()->>'last_result');
  rep := public.mafia_night_report(r);
  assert (rep->>'saved')::boolean and rep->>'victim' is null and (rep->'inspect'->>'mafia')::boolean, 'report: ' || rep::text;
  assert jsonb_array_length(rep->'picks') = 1, 'picks';

  -- المؤقت: إيقاف، +30 أثناء الإيقاف، استئناف.
  assert (public.mafia_timer(r, 'pause')->>'ok')::boolean, 'pause';
  assert public.t10_sd()->'day_ends_at' = 'null' and (public.t10_sd()->'timer_paused'->>'left')::int between 115 and 121, 'paused: ' || (public.t10_sd()->>'timer_paused');
  perform public.mafia_timer(r, 'add');
  left1 := (public.t10_sd()->'timer_paused'->>'left')::int;
  assert left1 between 145 and 151, 'add while paused';
  perform public.mafia_timer(r, 'resume');
  assert public.t10_sd()->'timer_paused' = 'null' and extract(epoch from (public.t10_sd()->>'day_ends_at')::timestamptz - now()) between 140 and 152, 'resumed';
  perform public.mafia_timer(r, 'add');
  assert extract(epoch from (public.t10_sd()->>'day_ends_at')::timestamptz - now()) between 170 and 182, 'add 30';
  perform public.mafia_timer(r, 'pause');
  perform public.mafia_open_vote(r);
  assert public.t10_sd()->'timer_paused' = 'null', 'pause cleared on phase change';

  -- النهاية: المافيا تُقصى بالتصويت الشفوي ← فوز المواطنين، ثم السهرة وكشف الأدوار.
  v := public.mafia_oral_result(r, jsonb_build_object(public.t10_pid('mafia')::text, 1), true);
  assert v->>'winner' = 'citizens', 'citizens win';
  assert (public.mafia_evening(r)->>'matches')::int = 1 and (public.mafia_evening(r)->'wins'->>'citizens')::int = 1, 'evening counts current match';
  assert (public.mafia_reveal_step(r, 2)->>'ok')::boolean and (public.t10_sd()->>'reveal_i')::int = 2, 'reveal step';
  perform public.mafia_reset(r);
  assert (public.t10_sd()->'evening'->>'matches')::int = 1, 'evening kept after reset';
  assert (select sum((value->>'finds')::int) from jsonb_each(public.t10_sd()->'evening'->'players')) = 1, 'detective find counted';
  perform public.mafia_start(r, '{"mafia": 1}');
  assert (public.t10_sd()->'evening'->>'matches')::int = 1 and (public.mafia_evening(r)->>'matches')::int = 1, 'evening survives the next start';
end $$;
drop function public.t10_pid(text, int); drop function public.t10_as(text, int); drop function public.t10_sd();
select 'ok mafia10';
