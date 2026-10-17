-- منافسة العش أونلاين: غرفة لاعبين، مباراة تبدأ وحدها، إجابات يحكمها الخادم، حسم بالهدف أو بالوقت، وإعادة التحدي.
\set ON_ERROR_STOP 1
select public.test_room('d1000000-0000-0000-0000-000000000001', 'nest-duel', 1);

create or replace function public.td_m() returns public.duel_matches language sql as $$
  select * from duel_matches where room_id = 'd1000000-0000-0000-0000-000000000001' order by round_no desc limit 1 $$;
-- الإجابة الصحيحة للاعب الحالي (من البذرة، كما يحسبها الخادم).
create or replace function public.td_right(p_match uuid) returns text language sql as $$
  select duel_challenge(x.seed, s.idx)->>'answer' from duel_secrets x join duel_scores s on s.match_id = x.match_id
   where x.match_id = p_match and s.player_id = duel_me('d1000000-0000-0000-0000-000000000001') $$;
-- يقدّم ساعة المباراة: البداية مرّت، والتحدي الحالي ظهر منذ 5 ثوانٍ.
create or replace function public.td_go(p_match uuid) returns void language sql as $$
  update duel_matches set starts_at = now() - interval '10 seconds', ends_at = now() + interval '50 seconds' where id = p_match;
  update duel_scores set issued_at = now() - interval '5 seconds' where match_id = p_match $$;

do $$
declare r uuid := 'd1000000-0000-0000-0000-000000000001'; m duel_matches; v jsonb; a uuid; b uuid; i int;
begin
  -- 1) الثاني دخل: مباراة تبدأ بعد 5 ثوانٍ ومدتها 60.
  m := public.td_m();
  assert m.id is not null and m.status = 'live' and m.round_no = 1, 'match started on the second player';
  assert extract(epoch from m.starts_at - now()) between 4 and 6, 'countdown 5 s';
  assert extract(epoch from m.ends_at - m.starts_at) = 60, '60 s';
  assert (select count(*) from duel_scores where match_id = m.id) = 2, 'two scores';
  assert (select status from game_rooms where id = r) = 'playing', 'room playing';

  -- الثالث مرفوض.
  begin
    insert into room_players (room_id, user_id, player_name) values (r, '00000000-0000-0000-0000-00000000a009', 'ثالث');
    raise exception 'third joined';
  exception when others then
    assert sqlerrm = 'ROOM_FULL', 'room full: ' || sqlerrm;
  end;

  -- 2) قبل البداية: لا إجابة، ولا يُكشف أول تحدٍ.
  perform public.test_as(0);
  assert public.duel_answer(m.id, 0, '1')->>'reason' = 'NOT_STARTED', 'not started';
  assert public.duel_current(m.id)->'next' = 'null'::jsonb, 'no challenge before start';

  -- 3) بعد البداية: التحدي يصل بلا إجابة.
  perform public.td_go(m.id);
  v := public.duel_current(m.id);
  assert v->'next' ? 'kind' and not (v->'next' ? 'answer') and not (v->'next' ? 'min_ms'), 'public challenge: ' || v::text;

  -- إجابة خاطئة: لا نقطة، والتحدي التالي.
  v := public.duel_answer(m.id, 0, 'x');
  assert (v->>'ok')::boolean and not (v->>'correct')::boolean and (v->>'idx')::int = 1 and (v->>'points')::int = 0, 'wrong: ' || v::text;
  -- أسرع من إنسان: مرفوض.
  v := public.duel_answer(m.id, 1, public.td_right(m.id));
  assert v->>'reason' = 'TOO_FAST', 'too fast: ' || v::text;
  -- إجابة قديمة: STALE مع التحدي الحالي.
  v := public.duel_answer(m.id, 0, 'x');
  assert v->>'reason' = 'STALE' and (v->>'idx')::int = 1, 'stale';

  -- 4) الكتابة المباشرة مرفوضة.
  set local role authenticated;
  begin
    update duel_scores set points = 99 where match_id = m.id;
    raise exception 'direct write went through';
  exception when insufficient_privilege then null;
  end;
  begin
    perform seed from duel_secrets where match_id = m.id;
    raise exception 'seed was readable';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 5) الهدف: المضيف يجيب 10 صحيحة فيفوز فورًا.
  perform public.test_as(0);
  for i in 1..10 loop
    update duel_scores set issued_at = now() - interval '5 seconds' where match_id = m.id;
    v := public.duel_answer(m.id, (select idx from duel_scores where match_id = m.id and player_id = duel_me(r)), public.td_right(m.id));
    assert (v->>'correct')::boolean, 'right ' || i || ': ' || v::text;
  end loop;
  m := public.td_m();
  assert m.status = 'over' and m.end_reason = 'target' and m.winner_id = duel_me(r), 'won by target';
  perform public.test_as(1);
  assert public.duel_answer(m.id, 0, '1')->>'reason' = 'OVER', 'over for the other';

  -- 6) إعادة التحدي: صوت واحد ينتظر، والصوتان يبدآن الجولة 2.
  assert (public.duel_rematch(r)->>'waiting')::boolean, 'one vote waits';
  assert (public.duel_rematch(r)->>'waiting')::boolean, 'same vote twice still waits';
  perform public.test_as(0);
  assert (public.duel_rematch(r)->>'started')::boolean, 'two votes start';
  m := public.td_m();
  assert m.round_no = 2 and m.status = 'live', 'round 2';

  -- 7) الحسم بالوقت: نقطة لكل واحد = تعادل؛ وقبل الوقت لا حسم.
  perform public.td_go(m.id);
  assert public.duel_settle(m.id)->>'reason' = 'NOT_YET', 'not yet';
  perform public.test_as(0);
  perform public.duel_answer(m.id, 0, public.td_right(m.id));
  perform public.test_as(1);
  perform public.duel_answer(m.id, 0, public.td_right(m.id));
  update duel_matches set ends_at = now() - interval '1 second' where id = m.id;
  assert public.duel_answer(m.id, 1, '1')->>'reason' = 'TIME_UP', 'time up';
  m := public.td_m();
  assert m.status = 'over' and m.end_reason = 'time' and m.winner_id is null, 'draw on time: ' || coalesce(m.winner_id::text, 'null');
  assert (public.duel_settle(m.id)->>'already')::boolean, 'settle twice is harmless';

  -- 8) جولة 3: الأعلى نقاطًا يفوز بالوقت.
  perform public.duel_rematch(r);
  perform public.test_as(0);
  perform public.duel_rematch(r);
  m := public.td_m();
  perform public.td_go(m.id);
  perform public.duel_answer(m.id, 0, public.td_right(m.id));
  update duel_matches set ends_at = now() - interval '1 second' where id = m.id;
  perform public.test_as(1);
  assert (public.duel_settle(m.id)->>'ok')::boolean, 'settle by the loser works too';
  m := public.td_m();
  perform public.test_as(0);
  assert m.winner_id = duel_me(r), 'higher points wins on time';

  -- 9) كل أنواع التحديات تتولد، والخيارات تحوي الإجابة.
  for i in 0..199 loop
    v := public.duel_challenge('seed-x', i);
    assert v->>'kind' in ('memory', 'ink', 'math', 'odd'), 'kind';
    if v->>'kind' = 'math' then assert v->'options' @> to_jsonb((v->>'answer')::int), 'math options: ' || v::text; end if;
    if v->>'kind' = 'ink' then assert v->>'word' <> v->>'ink', 'ink differs from word'; end if;
    if v->>'kind' = 'odd' then
      assert jsonb_array_length(public.duel_public(v)->'cells') = 12, 'odd cells';
      assert public.duel_public(v)->'cells'->>((v->>'answer')::int) = v->>'odd', 'odd at answer';
    end if;
  end loop;
  assert (select count(distinct duel_challenge('seed-x', g)->>'kind') from generate_series(0, 199) g) = 4, 'four kinds';
end $$;

drop function public.td_m(); drop function public.td_right(uuid); drop function public.td_go(uuid);
select 'ok duel_online';
