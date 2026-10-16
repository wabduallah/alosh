-- الغرف: الطرد يمنع الرجوع، والإنهاء للجميع، وغير المضيف لا يطرد.
\set ON_ERROR_STOP 1
select public.test_room('b0000000-0000-0000-0000-000000000001', 'tactical-grid', 3);
do $$
declare r uuid := 'b0000000-0000-0000-0000-000000000001'; victim uuid; vuser uuid; v jsonb;
begin
  select id, user_id into victim, vuser from room_players where room_id = r and not is_host order by player_name limit 1;
  perform public.test_as(2);
  assert public.room_kick(r, victim)->>'reason' = 'NOT_HOST', 'guest cannot kick';
  perform public.test_as(0);
  assert (public.room_kick(r, victim)->>'ok')::boolean, 'host kicks';
  assert not exists (select 1 from room_players where id = victim), 'gone';
  begin
    insert into room_players (room_id, user_id, player_name, is_host) values (r, vuser, 'رجعت', false);
    assert false, 'kicked player rejoined';
  exception when others then
    assert sqlerrm like '%KICKED%', 'expected KICKED, got ' || sqlerrm;
  end;
  assert (public.room_end(r)->>'ok')::boolean, 'room_end';
  assert (select status from game_rooms where id = r) = 'finished', 'finished';
end $$;
select 'ok rooms';
