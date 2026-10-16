-- المحكمة: متهمان، تصويت لكل متهم، حكم بلا أصوات، إيقاف المؤقت، حد الاعتراضات، التوزيع لأكثر من 12.
\set ON_ERROR_STOP 1
select public.test_room('c0000000-0000-0000-0000-000000000001', 'court', 7);
select public.test_as(0);
do $$
declare r uuid := 'c0000000-0000-0000-0000-000000000001'; s int; v jsonb; x record; total int;
begin
  -- قضية بمتهمَين حتى التصويت
  v := public.court_start(r, jsonb_build_object('host_plays', true, 'question_seconds', 120, 'objections', 1, 'case_id', (select id from court_cases where slug = 'savings-box')));
  assert (v->>'ok')::boolean, 'court_start: ' || v::text;
  assert (select jsonb_array_length(state_data->'accused') from room_game_state where room_id = r) = 2, 'two accused';
  for i in 1..12 loop
    select (state_data->>'step')::int into s from room_game_state where room_id = r;
    exit when (select state_data->>'phase' from room_game_state where room_id = r) = 'vote';
    perform public.court_next(r, s);
    -- المؤقت: إيقاف و+30 واستئناف أثناء الاستجواب
    if (select state_data->>'phase' from room_game_state where room_id = r) = 'question' and s = 1 then
      perform public.court_timer(r, s + 1, 'pause');
      assert (select (state_data->'paused'->>'left')::int from room_game_state where room_id = r) between 118 and 120, 'paused left';
      perform public.court_timer(r, s + 1, 'add');
      perform public.court_timer(r, s + 1, 'resume');
      assert (select extract(epoch from (state_data->>'ends_at')::timestamptz - now()) from room_game_state where room_id = r) between 147 and 151, 'resume +30';
    end if;
  end loop;
  -- الحد: اعتراض واحد
  for x in select p.user_id from room_court_roles c join room_players p on p.id = c.player_id where c.room_id = r and c.kind = 'prosecutor' loop
    perform set_config('test.uid', x.user_id::text, false);
  end loop;
  -- الكل يصوّت: الأولى بريئة والثاني مذنب
  for x in select c.player_id, c.kind, p.user_id from room_court_roles c join room_players p on p.id = c.player_id where c.room_id = r and c.kind <> 'accused' loop
    perform set_config('test.uid', x.user_id::text, false);
    perform public.court_vote(r, false, 'salman', case when x.kind in ('prosecutor', 'lawyer') then null else 'lawyer' end, 'accused-1');
    perform public.court_vote(r, true, null, null, 'accused-2');
  end loop;
  assert (select state_data->>'phase' from room_game_state where room_id = r) = 'verdict', 'auto verdict when all voted';
  perform public.test_as(0);
  perform public.court_next(r, (select (state_data->>'step')::int from room_game_state where room_id = r));
  assert (select (state_data->'truth'->>'correct')::boolean from room_game_state where room_id = r), 'both verdicts correct';

  -- حكم بلا أصوات: لا نقاط
  perform public.court_reset(r, true);
  v := public.court_start(r, jsonb_build_object('host_plays', true, 'case_id', (select id from court_cases where slug = 'salty-cake')));
  for i in 1..14 loop
    exit when (select state_data->>'phase' from room_game_state where room_id = r) = 'over';
    perform public.court_next(r, (select (state_data->>'step')::int from room_game_state where room_id = r));
  end loop;
  select sum((pt->>'points')::int) into total from room_game_state, jsonb_array_elements(state_data->'points') pt where room_id = r;
  assert coalesce(total, 0) = 0, 'no votes, no points: ' || total;
  assert (select (state_data->'truth'->>'no_votes')::boolean from room_game_state where room_id = r), 'no_votes flag';
end $$;

-- أكثر من 12 لاعبًا: الزيادة محلّفون
-- (حد الغرفة من إعدادات اللعبة: يرفعه المدير من صفحة الألعاب)
update games set max_players = 30 where slug = 'court';
select public.test_room('c0000000-0000-0000-0000-000000000002', 'court', 15);
select public.test_as(0);
do $$
declare r uuid := 'c0000000-0000-0000-0000-000000000002'; v jsonb;
begin
  v := public.court_start(r, '{"host_plays": true}');
  assert (v->>'ok')::boolean, 'start 16: ' || v::text;
  assert (select count(*) from room_court_roles where room_id = r) = 16, 'all dealt';
  assert (select count(*) from room_court_roles where room_id = r and kind = 'juror') >= 9, 'extras are jurors';
end $$;
select 'ok court';
