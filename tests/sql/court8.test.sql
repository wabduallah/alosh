-- المحكمة v8: التراجع خطوة، «نظام في المحكمة» وترتيب السهرة على الشاشات، عدّاد الأسئلة.
\set ON_ERROR_STOP 1
select public.test_room('c8000000-0000-0000-0000-000000000003', 'court', 7);
select public.test_as(0);

create or replace function public.t8_sd() returns jsonb language sql as $$
  select state_data from room_game_state where room_id = 'c8000000-0000-0000-0000-000000000003' $$;
create or replace function public.t8_step() returns int language sql as $$
  select (public.t8_sd()->>'step')::int $$;

do $$
declare r uuid := 'c8000000-0000-0000-0000-000000000003'; v jsonb; s int; w uuid; d uuid; x record; n int;
begin
  v := public.court_start(r, jsonb_build_object('host_plays', false, 'question_seconds', 120, 'objections', 1));
  assert (v->>'ok')::boolean, 'court_start: ' || v::text;

  -- التالي ← أدلة الجولة 1، ثم تراجع: نرجع للمقدمة بلا أدلة.
  s := public.t8_step();
  perform public.court_next(r, s);
  assert public.t8_sd()->>'phase' = 'evidence', 'evidence';
  assert jsonb_array_length(public.t8_sd()->'evidence') > 0, 'evidence shown';
  assert (public.t8_sd()->'undo'->>'step')::int = s + 1, 'undo saved';
  assert public.court_undo(r, s)->>'reason' = 'NO_UNDO', 'undo needs the current step';
  v := public.court_undo(r, s + 1);
  assert (v->>'ok')::boolean, 'undo: ' || v::text;
  assert public.t8_step() = s and public.t8_sd()->>'phase' = 'intro', 'back to intro';
  assert jsonb_array_length(coalesce(public.t8_sd()->'evidence', '[]')) = 0, 'evidence hidden again';
  assert public.court_undo(r, s)->>'reason' = 'NO_UNDO', 'one undo only';

  -- حتى الاستجواب، ثم تراجع: المؤقت يكمل.
  perform public.court_next(r, public.t8_step());
  perform public.court_next(r, public.t8_step());
  assert public.t8_sd()->>'phase' = 'question', 'question: ' || (public.t8_sd()->>'phase');
  -- عدّاد الأسئلة
  select c.player_id into w from room_court_roles c where c.room_id = r and c.kind not in ('prosecutor', 'accused') limit 1;
  select c.player_id into d from room_court_roles c where c.room_id = r and c.kind = 'prosecutor';
  perform public.court_call(r, w, false);
  perform public.court_call(r, d, false);
  perform public.court_call(r, w, false);
  perform public.court_call(r, w, false);
  assert (public.t8_sd()->'asked'->>w::text)::int = 2 and (public.t8_sd()->'asked'->>d::text)::int = 1, 'asked: ' || (public.t8_sd()->'asked')::text;
  perform public.court_timer(r, public.t8_step(), 'resume');

  -- «انتهى» الاستجواب بالغلط ثم تراجع: السائل يرجع بدون سؤال جديد، والمؤقت محفوظ.
  update room_game_state set state_data = state_data || jsonb_build_object('ends_at', now() + interval '100 seconds') where room_id = r;
  perform public.court_next(r, public.t8_step());
  assert public.t8_sd()->>'phase' <> 'question', 'moved on';
  update room_game_state set state_data = jsonb_set(state_data, '{undo,at}', to_jsonb(now() - interval '5 seconds')) where room_id = r;
  v := public.court_undo(r, public.t8_step());
  assert (v->>'ok')::boolean and public.t8_sd()->>'phase' = 'question', 'back to question';
  assert public.t8_sd()->>'asking' = w::text, 'asker back';
  assert (public.t8_sd()->'asked'->>w::text)::int = 2, 'no new question counted';
  assert extract(epoch from (public.t8_sd()->>'ends_at')::timestamptz - now()) between 102 and 106, 'timer shifted';

  -- متأخر: لا تراجع بعد 20 ثانية.
  perform public.court_next(r, public.t8_step());
  update room_game_state set state_data = jsonb_set(state_data, '{undo,at}', to_jsonb(now() - interval '30 seconds')) where room_id = r;
  assert public.court_undo(r, public.t8_step())->>'reason' = 'TOO_LATE', 'too late';

  -- التصويت ثم تراجع: الأصوات تُلغى.
  for i in 1..10 loop
    exit when public.t8_sd()->>'phase' = 'vote';
    perform public.court_next(r, public.t8_step());
  end loop;
  assert public.t8_sd()->>'phase' = 'vote', 'vote';
  for x in select p.user_id from room_court_roles c join room_players p on p.id = c.player_id where c.room_id = r and c.kind <> 'accused' limit 1 loop
    perform set_config('test.uid', x.user_id::text, false);
    perform public.court_vote(r, true, null, null, null);
  end loop;
  perform public.test_as(0);
  assert exists (select 1 from room_court_votes where room_id = r), 'voted';
  assert (public.court_undo(r, public.t8_step())->>'ok')::boolean, 'undo vote';
  assert public.t8_sd()->>'phase' = 'closing' and not exists (select 1 from room_court_votes where room_id = r), 'votes cleared';

  -- نظام في المحكمة، وترتيب السهرة.
  assert (public.court_flash(r, 'order')->>'ok')::boolean and public.t8_sd()->'flash'->>'kind' = 'order', 'order flash';
  assert (public.court_flash(r, 'order')->>'repeat')::boolean, 'rate limit';
  perform public.court_flash(r, 'evening');
  assert public.t8_sd()->'flash'->>'kind' = 'evening', 'evening flash';
  perform public.court_flash(r, 'hide');
  assert public.t8_sd()->'flash' = 'null'::jsonb, 'hide';
  assert public.court_flash(r, 'x')->>'reason' = 'BAD_KIND', 'bad kind';
  perform public.test_as(3);
  assert public.court_flash(r, 'order')->>'reason' = 'NOT_HOST', 'judge only';
  assert public.court_undo(r, public.t8_step())->>'reason' = 'NOT_HOST', 'undo judge only';
  perform public.test_as(0);

  -- الحقيقة: لا تراجع.
  for i in 1..10 loop
    exit when public.t8_sd()->>'phase' = 'over';
    perform public.court_next(r, public.t8_step());
  end loop;
  assert public.t8_sd()->>'phase' = 'over', 'over';
  assert public.court_undo(r, public.t8_step())->>'reason' = 'NO_UNDO', 'no undo after truth';

  -- قضية جديدة: العدّاد يبدأ من الصفر.
  perform public.court_reset(r, false);
  perform public.court_start(r, jsonb_build_object('host_plays', false));
  assert coalesce(public.t8_sd()->'asked', '{}'::jsonb) = '{}'::jsonb, 'asked reset: ' || coalesce((public.t8_sd()->'asked')::text, 'null');
  assert public.t8_sd()->'undo' is null or public.t8_sd()->'undo' = 'null'::jsonb, 'undo reset';
end $$;
drop function public.t8_sd(); drop function public.t8_step();
select 'ok court8';
