-- تحديات العش v3: فرق متعددة، تصويت بلا إجابة ظاهرة، خيارات عشوائية، صح وخطأ بلا سرقة، سرقة متسلسلة.
\set ON_ERROR_STOP 1
delete from questions_bank where game_slug = 'tactical-grid' and category_ar in ('اختبار عواصم', 'اختبار صح', 'اختبار أرقام');
insert into questions_bank (game_slug, category_ar, question_text, correct_answer, difficulty, points)
select 'tactical-grid', 'اختبار عواصم', 'اختبار: ما عاصمة ' || c || '؟', a, d, 200
  from (values ('فرنسا', 'باريس', 'easy'), ('اليابان', 'طوكيو', 'easy'), ('مصر', 'القاهرة', 'medium'), ('كندا', 'أوتاوا', 'medium'),
               ('أستراليا', 'كانبرا', 'hard'), ('تركيا', 'أنقرة', 'hard'), ('إيطاليا', 'روما', 'easy'), ('ألمانيا', 'برلين', 'medium')) v(c, a, d);
insert into questions_bank (game_slug, category_ar, question_text, correct_answer, difficulty, points)
select 'tactical-grid', 'اختبار صح', 'اختبار: صح أم خطأ ' || n, case when n % 2 = 0 then 'صح' else 'خطأ' end,
       (array['easy', 'easy', 'medium', 'medium', 'hard', 'hard'])[n], 200
  from generate_series(1, 6) n;
insert into questions_bank (game_slug, category_ar, question_text, correct_answer, difficulty, points)
select 'tactical-grid', 'اختبار أرقام', 'اختبار: كم عدد ' || n || '؟', (n * 7)::text, (array['easy', 'easy', 'medium', 'medium', 'hard', 'hard'])[n], 200
  from generate_series(1, 6) n;
select public.test_room('e0000000-0000-0000-0000-000000000001', 'tactical-grid', 4);

create or replace function public.test_pid(p_room uuid, p_n int) returns text language sql as $$
  select id::text from room_players where room_id = p_room and user_id = ('00000000-0000-0000-0000-' || lpad(to_hex(40960 + p_n), 12, '0'))::uuid
$$;
create or replace function public.test_gs(p_room uuid) returns jsonb language sql as $$
  select state_data from room_game_state where room_id = p_room
$$;
-- موضع الإجابة الصحيحة في خيارات السؤال الحالي.
create or replace function public.test_right(p_room uuid) returns int language sql as $$
  select (n - 1)::int from room_game_state s, jsonb_array_elements_text(s.state_data->'cur'->'options') with ordinality t(x, n)
   where s.room_id = p_room and public.grid_is_correct((s.state_data->'cur'->>'id')::uuid, x) limit 1
$$;
create or replace function public.test_wrong(p_room uuid, p_skip int default 0) returns int language sql as $$
  select (n - 1)::int from room_game_state s, jsonb_array_elements_text(s.state_data->'cur'->'options') with ordinality t(x, n)
   where s.room_id = p_room and not public.grid_is_correct((s.state_data->'cur'->>'id')::uuid, x)
     and not ((s.state_data->'cur'->'out') @> to_jsonb((n - 1)::int))
   order by n offset p_skip limit 1
$$;

do $$
declare
  r uuid := 'e0000000-0000-0000-0000-000000000001';
  p1 text := public.test_pid(r, 1); p2 text := public.test_pid(r, 2); p3 text := public.test_pid(r, 3); p4 text := public.test_pid(r, 4);
  host text := public.test_pid(r, 0);
  setup jsonb;
  st jsonb;
  res jsonb;
  ch jsonb;
  idx int[] := '{}';
  i int;
  q uuid;
begin
  -- الخيارات: 6، فيها الصحيح مرة واحدة، وفي أماكن مختلفة.
  q := (select id from questions_bank where category_ar = 'اختبار عواصم' and correct_answer = 'باريس');
  for i in 1..30 loop
    ch := public.grid_choices(q);
    assert ch->>'kind' = 'mc' and jsonb_array_length(ch->'options') = 6, 'six options';
    assert (select count(*) from jsonb_array_elements_text(ch->'options') x where x = 'باريس') = 1, 'correct once';
    idx := idx || (select (n - 1)::int from jsonb_array_elements_text(ch->'options') with ordinality t(x, n) where x = 'باريس');
  end loop;
  assert (select count(distinct x) from unnest(idx) x) > 2, 'correct answer moves around';
  assert (select bool_and(x like '%ا%' or x ~ '[ء-ي]') from jsonb_array_elements_text(ch->'options') x), 'options are words';
  -- الأرقام: خيارات رقمية فقط.
  ch := public.grid_choices((select id from questions_bank where category_ar = 'اختبار أرقام' and correct_answer = '14'));
  assert (select bool_and(public.grid_num(x) is not null) from jsonb_array_elements_text(ch->'options') x), 'numeric options';
  assert jsonb_array_length(ch->'options') = 6, 'six numeric options';
  -- صح أو خطأ.
  ch := public.grid_choices((select id from questions_bank where category_ar = 'اختبار صح' limit 1));
  assert ch = '{"kind": "tf", "options": ["صح", "خطأ"]}'::jsonb, 'tf options';

  perform public.test_as(0);
  -- أخطاء البداية.
  assert public.grid_start(r, '{"teams": [{"members": []}], "cats": [["اختبار عواصم"]]}')->>'reason' = 'TEAMS_COUNT', 'one team';
  setup := jsonb_build_object('teams', jsonb_build_array(
             jsonb_build_object('name', '', 'members', jsonb_build_array(p1, p2)),
             jsonb_build_object('name', 'المتحدون', 'members', jsonb_build_array(p3, p1)),
             jsonb_build_object('name', 'عش ثالث', 'members', jsonb_build_array(p4))),
           'cats', '[["اختبار عواصم"], ["اختبار صح"], ["اختبار أرقام"]]'::jsonb, 'seconds', 30);
  assert public.grid_start(r, setup)->>'reason' = 'TWO_TEAMS', 'player in two teams';
  setup := jsonb_set(setup, '{teams,1,members}', jsonb_build_array(p3));
  assert public.grid_start(r, jsonb_set(setup, '{cats}', '[["اختبار عواصم", "اختبار صح"], ["اختبار أرقام"], []]'))->>'reason' = 'PICK_CATEGORIES', 'uneven cats';
  assert public.grid_start(r, jsonb_set(setup, '{teams,2,members}', jsonb_build_array(host)))->>'reason' = 'TEAMS', 'host not playing';
  -- البداية.
  perform public.test_as(1);
  assert public.grid_start(r, setup)->>'reason' = 'NOT_HOST', 'host only';
  perform public.test_as(0);
  res := public.grid_start(r, setup);
  assert (res->>'ok')::boolean, 'start: ' || res::text;
  st := public.test_gs(r);
  assert st->'teams'->0->>'name' = 'عش النسور' and st->'teams'->1->>'name' = 'المتحدون', 'names';
  assert st->>'turn' = 't1' and st->'members'->>p3 = 't2' and jsonb_array_length(st->'cells') = 3, 'board';
  assert st->'cat_team' = '["t1", "t2", "t3"]', 'cat owners';

  -- السؤال الأول (عواصم): فريق آخر لا يفتح، عضو الفريق يفتح بوسيلة «ضاعِف».
  perform public.test_as(3);
  assert public.grid_open(r, 0, 0, '{}')->>'reason' = 'NOT_YOUR_TURN', 'other team cannot open';
  perform public.test_as(1);
  assert (public.grid_open(r, 0, 0, '{double}')->>'ok')::boolean, 'member opens';
  st := public.test_gs(r);
  assert st->'cur'->>'kind' = 'mc' and jsonb_array_length(st->'cur'->'options') = 6, 'mc question';
  assert not (st->'cur' ? 'answer') and not (st->'cur' ? 'correct'), 'no answer in the state';
  perform public.test_as(0);
  assert public.room_correct_answer(r) is null, 'host does not get the answer';
  -- تصويت: فريق آخر مرفوض، والفريق يخطئ ← سرقة للفريق التالي مع شطب الخيار.
  perform public.test_as(3);
  assert public.grid_vote(r, 0)->>'reason' = 'NOT_YOUR_TURN', 'not your turn';
  perform public.test_as(1);
  assert (public.grid_vote(r, public.test_wrong(r))->>'ok')::boolean, 'vote 1';
  assert public.test_gs(r)->>'phase' = 'question', 'waits for all';
  perform public.test_as(2);
  res := public.grid_vote(r, public.test_wrong(r));
  assert res->>'steal' = 't2', 'steal goes to t2: ' || res::text;
  st := public.test_gs(r);
  assert st->>'phase' = 'steal' and jsonb_array_length(st->'cur'->'out') = 1 and st->'cur'->'votes' = '{}', 'steal state';
  perform public.test_as(3);
  assert public.grid_vote(r, (st->'cur'->'out'->>0)::int)->>'reason' = 'BAD_OPTION', 'struck option';
  res := public.grid_vote(r, public.test_right(r));
  st := public.test_gs(r);
  assert st->>'phase' = 'reveal' and st->'reveal'->>'by' = 't2' and (st->'reveal'->>'stolen')::boolean, 'stolen';
  assert (st->'reveal'->>'gain')::int = 200 and (st->'scores'->>'t2')::int = 200, 'steal earns plain points';
  assert (st->'reveal'->>'correct')::int = public.test_right(r), 'reveal points at correct option';
  perform public.test_as(0);
  assert (public.grid_next(r)->>'ok')::boolean and public.test_gs(r)->>'turn' = 't2', 'turn t2';

  -- صح أو خطأ: خطأ = لا سرقة.
  assert (public.grid_open(r, 1, 0, '{}')->>'ok')::boolean, 'host opens for t2';
  assert public.test_gs(r)->'cur'->>'kind' = 'tf', 'tf';
  perform public.test_as(3);
  res := public.grid_vote(r, public.test_wrong(r));
  st := public.test_gs(r);
  assert st->>'phase' = 'reveal' and st->'reveal'->'by' = 'null', 'tf wrong: nobody, no steal';
  perform public.test_as(0);
  perform public.grid_next(r);
  assert public.test_gs(r)->>'turn' = 't3', 'turn t3';

  -- انتهاء الوقت بلا أصوات: سرقة متسلسلة t3 ← t1 ← t2 ثم لا أحد.
  perform public.test_as(4);
  assert (public.grid_open(r, 0, 2, '{}')->>'ok')::boolean, 't3 opens';
  assert public.grid_timeout(r)->>'reason' = 'NOT_YET', 'not yet';
  update room_game_state set state_data = jsonb_set(state_data, '{cur,ends_at}', to_jsonb(now() - interval '5 seconds')) where room_id = r;
  assert public.grid_timeout(r)->>'steal' = 't1', 'timeout → t1';
  update room_game_state set state_data = jsonb_set(state_data, '{cur,ends_at}', to_jsonb(now() - interval '5 seconds')) where room_id = r;
  assert public.grid_timeout(r)->>'steal' = 't2', 'timeout → t2';
  update room_game_state set state_data = jsonb_set(state_data, '{cur,ends_at}', to_jsonb(now() - interval '5 seconds')) where room_id = r;
  res := public.grid_timeout(r);
  assert (res->>'done')::boolean and public.test_gs(r)->'reveal'->'by' = 'null', 'all tried: nobody';
  perform public.test_as(0);
  perform public.grid_next(r);

  -- «جوابان» والتعادل: t1 بصوتين مختلفين، الأسبق يُعتمد؛ الخطأ الأول يعطي محاولة ثانية.
  perform public.test_as(1);
  assert (public.grid_open(r, 0, 1, '{two}')->>'ok')::boolean, 't1 opens with two';
  perform public.grid_vote(r, public.test_wrong(r, 0));
  perform public.test_as(2);
  res := public.grid_vote(r, public.test_right(r));
  assert (res->>'retry')::boolean, 'tie → first vote (wrong) wins, retry: ' || res::text;
  st := public.test_gs(r);
  assert st->>'phase' = 'question' and (st->'cur'->>'tries')::int = 1 and jsonb_array_length(st->'cur'->'out') = 1, 'second try';
  perform public.grid_vote(r, public.test_right(r));
  perform public.test_as(1);
  res := public.grid_vote(r, public.test_right(r));
  assert public.test_gs(r)->'reveal'->>'by' = 't1', 'second try correct';

  -- الاسم والنقل والنهاية.
  perform public.test_as(0);
  assert (public.grid_rename(r, 't3', '  عش   البواسل ')->>'ok')::boolean and public.test_gs(r)->'teams'->2->>'name' = 'عش البواسل', 'rename';
  assert public.grid_rename(r, 't9', 'x')->>'reason' = 'WRONG_PHASE', 'unknown team';
  assert (public.grid_assign(r, p4::uuid, 't1')->>'ok')::boolean and public.test_gs(r)->'members'->>p4 = 't1', 'assign';
  assert public.grid_assign(r, host::uuid, 't1')->>'reason' = 'NOT_IN_ROOM', 'host not playing cannot join';
  assert (public.grid_finish(r)->>'ok')::boolean, 'finish';
  st := public.test_gs(r);
  assert st->>'phase' = 'over' and st->>'winner' = 'tie', 'tie 200/200: ' || (st->'scores')::text;
end $$;

-- المضيف يلعب: يدخل فريقًا ويصوّت.
do $$
declare
  r uuid := 'e0000000-0000-0000-0000-000000000001';
  host text := public.test_pid(r, 0); p1 text := public.test_pid(r, 1);
begin
  perform public.test_as(0);
  assert (public.grid_start(r, jsonb_build_object('host_plays', true, 'teams', jsonb_build_array(
            jsonb_build_object('members', jsonb_build_array(host)), jsonb_build_object('members', jsonb_build_array(p1))),
          'cats', '[["اختبار عواصم"], ["اختبار أرقام"]]'::jsonb))->>'ok')::boolean, 'host plays';
  assert public.test_gs(r)->'members'->>host = 't1', 'host in t1';
  perform public.grid_open(r, 1, 0, '{}');
  assert (public.grid_vote(r, public.test_right(r))->>'done')::boolean, 'host vote settles (only member)';
  assert public.test_gs(r)->'reveal'->>'by' = 't1', 'host team scores';
end $$;
select 'ok grid';
