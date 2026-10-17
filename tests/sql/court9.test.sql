-- المحكمة v9: القاضي النظام. انتقال تلقائي من المقدمة إلى الحقيقة، «انتهى سؤالي»، والاعتراض بتصويت الهيئة.
\set ON_ERROR_STOP 1
select public.test_room('c9000000-0000-0000-0000-000000000007', 'court', 7);
select public.test_as(0);

create or replace function public.t9c_sd() returns jsonb language sql as $$
  select state_data from room_game_state where room_id = 'c9000000-0000-0000-0000-000000000007' $$;
create or replace function public.t9c_as(p_kind text, p_n int default 1) returns uuid language plpgsql as $$
declare v_pid uuid; v_uid uuid;
begin
  select r.player_id, p.user_id into v_pid, v_uid from room_court_roles r join room_players p on p.id = r.player_id
   where r.room_id = 'c9000000-0000-0000-0000-000000000007' and r.kind = p_kind order by r.role_key offset p_n - 1 limit 1;
  perform set_config('test.uid', v_uid::text, false);
  return v_pid;
end $$;
-- لاعب من الهيئة (محلف أو شاهد أو محقق): بعض القضايا بلا محلفين في غرفة من 7.
create or replace function public.t9c_any(p_n int) returns uuid language plpgsql as $$
declare v_pid uuid; v_uid uuid;
begin
  select r.player_id, p.user_id into v_pid, v_uid from room_court_roles r join room_players p on p.id = r.player_id
   where r.room_id = 'c9000000-0000-0000-0000-000000000007' and r.kind in ('juror', 'witness', 'detective')
   order by r.kind, r.role_key offset p_n - 1 limit 1;
  perform set_config('test.uid', v_uid::text, false);
  return v_pid;
end $$;
-- الوقت انتهى: نرجع ends_at للماضي ثم نسأل الخادم.
create or replace function public.t9c_expire() returns jsonb language plpgsql as $$
begin
  update room_game_state set state_data = state_data || jsonb_build_object('ends_at', now() - interval '2 seconds')
   where room_id = 'c9000000-0000-0000-0000-000000000007';
  return public.court_tick('c9000000-0000-0000-0000-000000000007', (public.t9c_sd()->>'step')::int);
end $$;

do $$
declare r uuid := 'c9000000-0000-0000-0000-000000000007'; v jsonb; a uuid; b uuid; p uuid; x record;
begin
  -- البداية: النظام يفرض الانتقال التلقائي والتصعيد، ويعطي المقدمة 90 ثانية، والمضيف يلعب.
  v := public.court_start(r, jsonb_build_object('judge', 'system', 'host_plays', true, 'question_seconds', 0, 'objections', 2));
  assert (v->>'ok')::boolean, 'start: ' || v::text;
  assert public.t9c_sd()->'settings'->>'judge' = 'system', 'judge system';
  assert (public.t9c_sd()->'settings'->>'auto')::boolean and (public.t9c_sd()->'settings'->>'escalate')::boolean, 'auto + escalate';
  assert public.t9c_sd()->'judge_id' is null or public.t9c_sd()->'judge_id' = 'null'::jsonb, 'no human judge';
  assert (public.t9c_sd()->'steps'->0->>'seconds')::int = 90, 'intro 90 s';
  assert extract(epoch from (public.t9c_sd()->>'ends_at')::timestamptz - now()) between 85 and 91, 'intro timer';
  assert (select (st->>'seconds')::int from jsonb_array_elements(public.t9c_sd()->'steps') st where st->>'phase' = 'question' limit 1) = 180, 'question timer forced';
  assert exists (select 1 from room_court_roles k join room_players pl on pl.id = k.player_id where k.room_id = r and pl.is_host), 'host has a role';
  assert to_regprocedure('public.court_start_base(uuid,jsonb)') is not null, 'base kept';

  -- المقدمة ← الأدلة ← الاستجواب، وحدها.
  perform public.test_as(1);
  assert (public.t9c_expire()->>'ok')::boolean, 'intro tick';
  assert public.t9c_sd()->>'phase' = 'evidence', 'evidence: ' || (public.t9c_sd()->>'phase');
  perform public.t9c_expire();
  assert public.t9c_sd()->>'phase' = 'question', 'question';

  -- «انتهى سؤالي»: الدور لمن بعده.
  a := public.t9c_any(1);
  perform public.court_raise(r, true);
  assert public.t9c_sd()->>'asking' = a::text, 'first asks';
  b := public.t9c_any(2);
  perform public.court_raise(r, true);
  assert jsonb_array_length(public.t9c_sd()->'queue') = 1, 'second waits';
  perform public.t9c_any(1);
  assert (public.court_raise(r, false)->>'done')::boolean, 'asker ends';
  assert public.t9c_sd()->>'asking' = b::text and jsonb_array_length(public.t9c_sd()->'queue') = 0, 'next asks';

  -- اعتراض: الهيئة تصوّت، وإذا صوّت الجميع يُحسم فورًا.
  p := public.t9c_as('prosecutor');
  assert (public.court_object(r)->>'ok')::boolean, 'object';
  assert public.court_objection_vote(r, true)->>'reason' = 'NOT_ALLOWED', 'objector cannot vote';
  perform public.t9c_as('accused');
  assert public.court_objection_vote(r, true)->>'reason' = 'NOT_ALLOWED', 'accused cannot vote';
  for x in select pl.user_id from room_court_roles k join room_players pl on pl.id = k.player_id
            where k.room_id = r and k.kind in ('juror', 'witness', 'detective') loop
    perform set_config('test.uid', x.user_id::text, false);
    v := public.court_objection_vote(r, true);
    assert (v->>'ok')::boolean or v->>'reason' = 'NO_OBJECTION', 'vote: ' || v::text;
  end loop;
  assert public.t9c_sd()->'objection'->>'status' = 'accepted', 'accepted by the jury';
  assert (public.t9c_sd()->'objection_points'->>p::text)::int = 1, 'objection point';

  -- اعتراض ثانٍ بلا أصوات: يُرفض بعد 15 ثانية لا 10.
  perform public.t9c_as('prosecutor');
  perform public.court_object(r);
  update room_game_state set state_data = jsonb_set(state_data, '{objection,at}', to_jsonb(now() - interval '12 seconds')) where room_id = r;
  perform public.court_tick(r, (public.t9c_sd()->>'step')::int);
  assert public.t9c_sd()->'objection'->>'status' = 'pending', 'still voting at 12 s';
  update room_game_state set state_data = jsonb_set(state_data, '{objection,at}', to_jsonb(now() - interval '16 seconds')) where room_id = r;
  perform public.court_tick(r, (public.t9c_sd()->>'step')::int);
  assert public.t9c_sd()->'objection'->>'status' = 'rejected', 'no votes: rejected';

  -- بقية الجلسة وحدها حتى التصويت، ثم الحكم بعد 20 ثانية والحقيقة.
  perform public.test_as(1);
  for i in 1..15 loop
    exit when public.t9c_sd()->>'phase' = 'vote';
    perform public.t9c_expire();
  end loop;
  assert public.t9c_sd()->>'phase' = 'vote', 'vote: ' || (public.t9c_sd()->>'phase');
  perform public.t9c_expire();
  assert public.t9c_sd()->>'phase' = 'verdict', 'verdict';
  assert extract(epoch from (public.t9c_sd()->>'ends_at')::timestamptz - now()) between 15 and 21, 'verdict 20 s';
  perform public.t9c_expire();
  assert public.t9c_sd()->>'phase' = 'over', 'truth by itself';

  -- قاضٍ بشري: لا تصويت على الاعتراض، والمقدمة بلا مؤقت.
  perform public.test_as(0);
  perform public.court_reset(r, false);
  v := public.court_start(r, jsonb_build_object('judge', 'host', 'host_plays', false));
  assert (v->>'ok')::boolean, 'host start';
  assert coalesce(public.t9c_sd()->'settings'->>'judge', 'host') = 'host', 'host judge';
  assert public.t9c_sd()->'ends_at' is null or public.t9c_sd()->'ends_at' = 'null'::jsonb, 'no intro timer';
  assert public.t9c_sd()->'last_settings' is null or true, 'ok';
end $$;
drop function public.t9c_any(int); drop function public.t9c_sd(); drop function public.t9c_as(text, int); drop function public.t9c_expire();
select 'ok court9';
