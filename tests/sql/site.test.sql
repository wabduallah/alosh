-- الموقع: الضيوف التجريبيون (للمدير فقط، في لعبة مفعّلة)، الجرس عبر المقعد، وحد إنشاء الغرف.
\set ON_ERROR_STOP 1
insert into site_settings (key, value) values ('test_guests', '{"games": {"court": true}}')
on conflict (key) do update set value = excluded.value;
select public.test_room('d0000000-0000-0000-0000-000000000001', 'court', 1);
select public.test_room('d0000000-0000-0000-0000-000000000002', 'tactical-grid', 1);
do $$
declare r uuid := 'd0000000-0000-0000-0000-000000000001'; g uuid; st jsonb;
begin
  -- لاعب عادي: لا يُسمح
  perform public.test_as(1);
  assert not (public.test_guests_status(r)->>'allowed')::boolean, 'guest player not allowed';
  assert public.test_guest_add(r, 2)->>'reason' = 'NOT_ALLOWED', 'non-admin cannot add';
  -- المدير، لعبة مفعّلة
  perform public.test_as(0);
  perform set_config('test.admin', '1', false);
  assert (public.test_guests_status(r)->>'allowed')::boolean, 'admin allowed for court';
  assert (public.test_guest_add(r, 3)->>'ok')::boolean, 'add 3 guests';
  st := public.test_guests_status(r);
  assert jsonb_array_length(st->'guests') = 3, 'three guests';
  g := (st->'guests'->1->>'id')::uuid;
  assert (public.test_guest_act(r, g)->>'ok')::boolean, 'act as guest';
  assert public.my_player_id(r) = g, 'my_player_id follows the seat';
  -- لعبة غير مفعّلة
  assert not (public.test_guests_status('d0000000-0000-0000-0000-000000000002')->>'allowed')::boolean, 'grid not enabled';
  -- لاعب في غرفة ليست ضيفًا تجريبيًا
  assert public.test_guest_act(r, (select id from room_players where room_id = r and not is_test and not is_host))->>'reason' = 'NOT_A_GUEST', 'only test guests';
  -- رجوع للنفس، ثم حذف الضيوف
  perform public.test_guest_act(r, null);
  assert public.my_player_id(r) = (select id from room_players where room_id = r and is_host), 'back to self';
  assert (public.test_guest_remove(r)->>'ok')::boolean, 'remove';
  assert not exists (select 1 from room_players where room_id = r and is_test), 'guests gone';
  perform set_config('test.admin', '', false);
end $$;

-- حد إنشاء الغرف: الثلاثون في الساعة تُقبل، والحادية والثلاثون تُرفض (لغير المدير)
do $$
declare u uuid := '00000000-0000-0000-0000-00000000f001'; i int;
begin
  perform set_config('test.uid', u::text, false);
  for i in 1..30 loop
    insert into game_rooms (host_id, game_id, status) select u, id, 'lobby' from games where slug = 'court';
  end loop;
  begin
    insert into game_rooms (host_id, game_id, status) select u, id, 'lobby' from games where slug = 'court';
    assert false, 'room 31 accepted';
  exception when others then
    assert sqlerrm like '%TOO_MANY_ROOMS%', 'expected TOO_MANY_ROOMS, got ' || sqlerrm;
  end;
end $$;
select 'ok site';
