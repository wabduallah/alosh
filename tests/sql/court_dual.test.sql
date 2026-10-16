-- المحكمة: قضايا المتهمَين بثلاث جولات (court_cases_v7.sql). كل قضية بخمسة لاعبين (الإفادات بدل الأدوار الاختيارية)
-- وبثمانية (كل الأدوار): متهمان أحدهما مذنب، ثلاث جولات أدلة، والتصويت الصحيح يعطي «تحققت العدالة».
\set ON_ERROR_STOP 1

do $$
declare
  r uuid := 'cd000000-0000-0000-0000-000000000004';
  v_slug text; n int; v jsonb; s int; x record; c record; v_sd jsonb; v_stages int[];
begin
  for v_slug in select unnest(array['gold-watch-dual', 'oud-swap-dual', 'wedding-photos-dual', 'camel-pageant-dual']) loop
    select * into c from court_cases where slug = v_slug;
    assert c.id is not null, 'case missing: ' || v_slug;
    assert public.court_case_min(c.roles) = 5, v_slug || ' needs 5 players';
    assert (select count(*) from jsonb_array_elements(c.roles) z where z->>'kind' = 'accused' and (z->>'guilty')::boolean) = 1, v_slug || ' one guilty';
    assert (select count(*) from jsonb_array_elements(c.roles) z where z->>'kind' = 'accused' and not (z->>'guilty')::boolean) = 1, v_slug || ' one innocent';
    assert (select (l->>'stages')::int from jsonb_array_elements(public.court_cases_list()) l where l->>'id' = c.id::text) = 3, v_slug || ' list stages';

    foreach n in array array[5, 8] loop
      perform public.test_room(r, 'court', n);
      perform public.test_as(0);
      v := public.court_start(r, jsonb_build_object('host_plays', false, 'case_id', c.id));
      assert (v->>'ok')::boolean, v_slug || ' start ' || n || ': ' || v::text;
      select state_data into v_sd from room_game_state where room_id = r;
      select array_agg(distinct (st->>'stage')::int order by (st->>'stage')::int) into v_stages
        from jsonb_array_elements(v_sd->'steps') st where st->>'phase' = 'evidence';
      assert v_stages = array[1, 2, 3], v_slug || ' three rounds: ' || v_stages::text;
      assert jsonb_array_length(v_sd->'accused') = 2, v_slug || ' two accused';
      if n = 5 then
        assert (v_sd->>'fallbacks')::int > 0, v_slug || ' fallbacks at 5';
      else
        assert (select count(*) from room_court_roles where room_id = r and kind <> 'juror') = jsonb_array_length(c.roles), v_slug || ' all roles at 8';
      end if;

      -- حتى التصويت، ثم يصوّت الجميع بالحق.
      for i in 1..20 loop
        exit when (select state_data->>'phase' from room_game_state where room_id = r) = 'vote';
        select (state_data->>'step')::int into s from room_game_state where room_id = r;
        perform public.court_next(r, s);
      end loop;
      assert (select jsonb_array_length(state_data->'evidence') from room_game_state where room_id = r) >= jsonb_array_length(c.evidence), v_slug || ' all evidence shown';
      for x in select p.user_id from room_court_roles k join room_players p on p.id = k.player_id where k.room_id = r and k.kind <> 'accused' loop
        perform set_config('test.uid', x.user_id::text, false);
        perform public.court_vote(r, (select (y->>'guilty')::boolean from jsonb_array_elements(c.roles) y where y->>'key' = 'accused-1'), c.culprit, null, 'accused-1');
        perform public.court_vote(r, (select (y->>'guilty')::boolean from jsonb_array_elements(c.roles) y where y->>'key' = 'accused-2'), null, null, 'accused-2');
      end loop;
      perform public.test_as(0);
      if (select state_data->>'phase' from room_game_state where room_id = r) = 'vote' then
        perform public.court_next(r, (select (state_data->>'step')::int from room_game_state where room_id = r));
      end if;
      perform public.court_next(r, (select (state_data->>'step')::int from room_game_state where room_id = r));
      select state_data into v_sd from room_game_state where room_id = r;
      assert v_sd->>'phase' = 'over', v_slug || ' over';
      assert (v_sd->'truth'->>'correct')::boolean, v_slug || ' justice at ' || n || ': ' || (v_sd->'truth')::text;
      assert v_sd->'truth'->>'culprit_key' = c.culprit, v_slug || ' culprit';
      assert exists (select 1 from jsonb_array_elements(v_sd->'points') p where (p->>'pick_ok')::boolean), v_slug || ' culprit points';
    end loop;
  end loop;
end $$;
select 'ok court_dual';
