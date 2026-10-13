-- =============================================================================
-- «الحلبة» الإصدار 5. يُشغَّل بعد alhalba_v4.sql و admin_v2.sql و admin_v3.sql،
-- وتشغيله مرة ثانية آمن.
--
-- الجديد:
--   * نزال ثنائي عادل: كل جولة تختار اللاعبَين الأقل نزالات (والقرعة بين
--     المتساوين، وبدون تكرار نفس اللاعب جولتين متتاليتين قدر الإمكان).
--     ولا تنتهي المباراة قبل أن يلعب الجميع عددًا متساويًا من النزالات،
--     حتى لو زادت الجولات عن العدد المختار.
--   * إعدادات المضيف قبل البدء:
--       وقت المزايدة (أو الافتراضي)، ووقت الإجابة (أو وقت الموضوع)،
--       وطريقة المطابقة: تلقائي (قائمة إجابات الموضوع)، يدوي (الحَكَم)، أو الاثنان.
--   * الكتابة بعدد المزايدة: من زايد على 10 يكتب 10 إجابات بالضبط. عند
--     الإجابة العاشرة (أو انتهاء الوقت) يتوقف الإدخال، ويطابق النظام كل
--     الإجابات مرة واحدة، ثم يحكم الحَكَم على ما لم يُطابَق (حسب الطريقة)،
--     وتظهر النتيجة.
--
-- حالات الإجابة: wait (كُتبت ولم تُطابَق بعد)، ok، no، pending (تنتظر الحَكَم).
-- =============================================================================

-- 1) نزال ثنائي عادل -------------------------------------------------------------

-- Duel mode: do some fighters still have fewer duels than others?
create or replace function public.halba_duel_uneven(p_sd jsonb, p_fighters jsonb)
returns boolean language sql immutable as $$
  select p_sd->>'mode' = 'duel'
     and coalesce((p_sd->>'round')::int, 0) < 60
     and (select coalesce(min(coalesce((p_sd->'duels'->>f)::int, 0)) < max(coalesce((p_sd->'duels'->>f)::int, 0)), false)
            from jsonb_array_elements_text(coalesce(p_fighters, '[]'::jsonb)) f);
$$;

-- A topic: unused, from the chosen categories; topics with an answer list first
-- when answers are matched automatically.
create or replace function public.halba_pick_topic(p_sd jsonb)
returns public.alhalba_topics language plpgsql stable security definer set search_path = public as $$
declare
  v_topic public.alhalba_topics%rowtype;
  v_cats jsonb := p_sd->'categories';
  v_used jsonb := coalesce(p_sd->'used_topics', '[]'::jsonb);
  v_lists boolean := coalesce(p_sd->>'judge', 'both') <> 'manual';
begin
  select * into v_topic from public.alhalba_topics t
   where (jsonb_typeof(v_cats) is distinct from 'array' or jsonb_array_length(v_cats) = 0 or v_cats @> to_jsonb(coalesce(t.category, 'عام')))
     and not (v_used @> to_jsonb(t.id::text))
   order by (v_lists and cardinality(t.answers) > 0) desc, random() limit 1;
  if not found then
    select * into v_topic from public.alhalba_topics t
     where (jsonb_typeof(v_cats) is distinct from 'array' or jsonb_array_length(v_cats) = 0 or v_cats @> to_jsonb(coalesce(t.category, 'عام')))
     order by random() limit 1;
  end if;
  return v_topic;
end;
$$;

-- The bidding fields plus the host's times.
create or replace function public.halba_round_fields(p_sd jsonb, p_topic public.alhalba_topics)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.halba_bid_fields(p_topic) || jsonb_build_object('checking', false);
  v_answer int := coalesce((p_sd->>'answer_seconds')::int, 0);
  v_bid int := coalesce((p_sd->>'bid_seconds')::int, 0);
begin
  if v_answer > 0 then
    v := jsonb_set(v, '{topic,seconds}', to_jsonb(v_answer));
  end if;
  if v_bid > 0 then
    v := v || jsonb_build_object('bid_ends_at', to_jsonb(now() + make_interval(secs => v_bid)));
  end if;
  return v;
end;
$$;

drop function if exists public.halba_start_round(uuid, text, int, boolean, int, text[]);

create or replace function public.halba_start_round(
  p_room_id uuid, p_mode text default null, p_rounds int default null,
  p_host_plays boolean default true, p_lives int default 2, p_categories text[] default null,
  p_judge text default null, p_answer_seconds int default null, p_bid_seconds int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_people jsonb;
  v_fighters jsonb;
  v_lives jsonb;
  v_new jsonb;
  v_teams jsonb;
  v_topic public.alhalba_topics%rowtype;
  v_duel jsonb := null;
  v_duels jsonb;
  v_round int;
  v_max int;
  v_pid text;
  v_red int;
  v_blue int;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  if not exists (select 1 from public.game_rooms r where r.id = p_room_id and r.status = 'playing') then
    return jsonb_build_object('ok', false, 'reason', 'ROOM_NOT_PLAYING');
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NO_STATE');
  end if;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if coalesce(v_sd->>'phase', '') not in ('', 'idle', 'result') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;

  if v_sd->'fighters' is null then
    -- First round: settings, people, teams.
    v_max := greatest(1, least(coalesce(p_lives, 2), 3));
    select coalesce(jsonb_agg(p.id::text order by random()), '[]'::jsonb) into v_people
      from public.room_players p
     where p.room_id = p_room_id and (not p.is_host or coalesce(p_host_plays, true));
    if jsonb_array_length(v_people) < 2 then
      return jsonb_build_object('ok', false, 'reason',
        case when coalesce(p_host_plays, true) then 'NOT_ENOUGH_PLAYERS' else 'NOT_ENOUGH_GUESTS' end);
    end if;
    v_sd := v_sd || jsonb_build_object(
      'mode', case when p_mode in ('ffa', 'duel', 'teams') then p_mode else 'ffa' end,
      'max_rounds', greatest(1, least(coalesce(p_rounds, 7), 30)),
      'max_lives', v_max, 'host_plays', coalesce(p_host_plays, true),
      'categories', case when p_categories is null or cardinality(p_categories) = 0 then null else to_jsonb(p_categories) end,
      'judge', case when p_judge in ('auto', 'manual', 'both') then p_judge else 'both' end,
      'answer_seconds', case when coalesce(p_answer_seconds, 0) between 15 and 180 then p_answer_seconds else 0 end,
      'bid_seconds', case when coalesce(p_bid_seconds, 0) between 10 and 60 then p_bid_seconds else 0 end,
      'duels', '{}'::jsonb, 'last_duel', '[]'::jsonb,
      'knocked', '[]'::jsonb, 'round', 0, 'used_topics', '[]'::jsonb, 'powers', '{}'::jsonb,
      'team_scores', jsonb_build_object('red', 0, 'blue', 0),
      'stats', jsonb_build_object('correct', '{}'::jsonb, 'cheers', '{}'::jsonb));
    if v_sd->>'mode' = 'teams' then
      select coalesce(jsonb_object_agg(x.pid, case when x.rn % 2 = 1 then 'red' else 'blue' end), '{}'::jsonb) into v_teams
        from (select f as pid, row_number() over () as rn from jsonb_array_elements_text(v_people) f) x;
      v_fighters := '["red","blue"]'::jsonb;
      v_lives := jsonb_build_object('red', v_max, 'blue', v_max);
      v_sd := v_sd || jsonb_build_object('teams', v_teams);
      perform set_config('alosh.trusted', 'on', true);
      update public.room_players p set team_color = v_teams->>p.id::text where p.room_id = p_room_id;
      perform set_config('alosh.trusted', '', true);
    else
      v_fighters := v_people;
      select coalesce(jsonb_object_agg(f, v_max), '{}'::jsonb) into v_lives from jsonb_array_elements_text(v_people) f;
    end if;
    v_sd := v_sd || jsonb_build_object('fighters', v_fighters, 'lives', v_lives);
  elsif v_sd->>'mode' = 'teams' then
    -- Later rounds, teams: drop people who left; newcomers join the smaller team.
    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_teams
      from jsonb_each_text(coalesce(v_sd->'teams', '{}'::jsonb)) t(k, v)
     where exists (select 1 from public.room_players p where p.room_id = p_room_id and p.id::text = t.k);
    for v_pid in
      select p.id::text from public.room_players p
       where p.room_id = p_room_id and (not p.is_host or coalesce((v_sd->>'host_plays')::boolean, false))
         and not (v_teams ? p.id::text)
       order by p.joined_at
    loop
      select count(*) filter (where v = 'red'), count(*) filter (where v = 'blue') into v_red, v_blue from jsonb_each_text(v_teams) t(k, v);
      v_teams := v_teams || jsonb_build_object(v_pid, case when v_red <= v_blue then 'red' else 'blue' end);
    end loop;
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_fighters
      from jsonb_array_elements_text(coalesce(v_sd->'fighters', '[]'::jsonb)) f
     where exists (select 1 from jsonb_each_text(v_teams) t(k, v) where v = f);
    v_sd := v_sd || jsonb_build_object('teams', v_teams, 'fighters', v_fighters);
    perform set_config('alosh.trusted', 'on', true);
    update public.room_players p set team_color = v_teams->>p.id::text where p.room_id = p_room_id;
    perform set_config('alosh.trusted', '', true);
  else
    -- Later rounds, players: drop people who left; newcomers enter with full lives.
    v_fighters := public.halba_present(p_room_id, v_sd->'fighters');
    select coalesce(jsonb_agg(p.id::text order by p.joined_at), '[]'::jsonb) into v_new
      from public.room_players p
     where p.room_id = p_room_id
       and (not p.is_host or coalesce((v_sd->>'host_plays')::boolean, false))
       and not (v_sd->'fighters' @> to_jsonb(p.id::text))
       and not (coalesce(v_sd->'knocked', '[]'::jsonb) @> to_jsonb(p.id::text));
    v_lives := coalesce(v_sd->'lives', '{}'::jsonb);
    select v_lives || coalesce(jsonb_object_agg(f, coalesce((v_sd->>'max_lives')::int, 1)), '{}'::jsonb)
      into v_lives from jsonb_array_elements_text(v_new) f;
    v_sd := v_sd || jsonb_build_object('fighters', v_fighters || v_new, 'lives', v_lives);
    v_fighters := v_fighters || v_new;
  end if;

  if jsonb_array_length(v_fighters) < 2 then
    update public.room_game_state set state_data = v_sd || jsonb_build_object('phase', 'over') where room_id = p_room_id;
    return jsonb_build_object('ok', false, 'reason', 'GAME_OVER');
  end if;
  v_round := coalesce((v_sd->>'round')::int, 0) + 1;
  -- The chosen number of rounds; a duel match goes on until everyone has fought equally.
  if v_round > coalesce((v_sd->>'max_rounds')::int, 7) and not public.halba_duel_uneven(v_sd, v_fighters) then
    update public.room_game_state set state_data = v_sd || jsonb_build_object('phase', 'over') where room_id = p_room_id;
    return jsonb_build_object('ok', false, 'reason', 'GAME_OVER');
  end if;

  v_topic := public.halba_pick_topic(v_sd);
  if v_topic.id is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_TOPICS');
  end if;
  if v_sd->>'mode' = 'duel' then
    -- Fewest duels first; between equals, not someone who just fought; then a draw.
    v_duels := coalesce(v_sd->'duels', '{}'::jsonb);
    select jsonb_agg(f) into v_duel
      from (select f from jsonb_array_elements_text(v_fighters) f
             order by coalesce((v_duels->>f)::int, 0),
                      coalesce(v_sd->'last_duel', '[]'::jsonb) @> to_jsonb(f),
                      random()
             limit 2) x;
    select v_duels || coalesce(jsonb_object_agg(f, coalesce((v_duels->>f)::int, 0) + 1), '{}'::jsonb)
      into v_duels from jsonb_array_elements_text(v_duel) f;
    v_sd := v_sd || jsonb_build_object('duels', v_duels, 'last_duel', v_duel);
  end if;

  update public.room_game_state
    set active_question_id = null,
        state_data = v_sd || public.halba_round_fields(v_sd, v_topic) || jsonb_build_object(
          'round', v_round, 'duel', v_duel,
          'used_topics', coalesce(v_sd->'used_topics', '[]'::jsonb) || to_jsonb(v_topic.id::text))
    where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'round', v_round);
end;
$$;

-- After a round: result or end of the match (a duel match waits until everyone fought equally).
create or replace function public.halba_after_round(p_room_id uuid, p_sd jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sd jsonb := p_sd;
  v_fighters jsonb := coalesce(p_sd->'fighters', '[]'::jsonb);
  v_over boolean;
begin
  if p_sd->>'mode' <> 'teams' then
    v_fighters := public.halba_present(p_room_id, v_fighters);
  end if;
  v_over := jsonb_array_length(v_fighters) < 2
            or (coalesce((p_sd->>'round')::int, 1) >= coalesce((p_sd->>'max_rounds')::int, 7)
                and not public.halba_duel_uneven(p_sd, v_fighters));
  v_sd := v_sd || jsonb_build_object('fighters', v_fighters, 'phase', case when v_over then 'over' else 'result' end);
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'over', v_over);
end;
$$;

-- «تبديل الموضوع»: same as v4, with the host's times.
create or replace function public.halba_swap(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_me text := public.my_player_id(p_room_id)::text;
  v_topic public.alhalba_topics%rowtype;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' <> 'bid' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if not public.halba_can_fight2(v_sd, v_me) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FIGHTING');
  end if;
  if public.halba_used(v_sd, v_me, 'swap') then
    return jsonb_build_object('ok', false, 'reason', 'USED');
  end if;
  v_topic := public.halba_pick_topic(v_sd);
  if v_topic.id is null or v_topic.id::text = v_sd->'topic'->>'id' then
    return jsonb_build_object('ok', false, 'reason', 'NO_TOPICS');
  end if;
  v_sd := public.halba_use(v_sd, v_me, 'swap');
  update public.room_game_state
    set state_data = v_sd || public.halba_round_fields(v_sd, v_topic) || jsonb_build_object(
      'used_topics', coalesce(v_sd->'used_topics', '[]'::jsonb) || to_jsonb(v_topic.id::text),
      'predictions', coalesce(v_sd->'predictions', '{}'::jsonb),
      'swapped_by', (select player_name from public.room_players where id = v_me::uuid))
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 2) الكتابة بعدد المزايدة ثم المطابقة -----------------------------------------------

-- Answers of the running phase that are typed but not checked yet.
create or replace function public.halba_waiting(p_sd jsonb)
returns int language sql immutable as $$
  select count(*)::int from jsonb_array_elements(coalesce(p_sd->'answers', '[]'::jsonb)) a
   where a->>'status' = 'wait' and coalesce((a->>'steal')::boolean, false) = (p_sd->>'phase' = 'steal');
$$;

create or replace function public.halba_pending(p_sd jsonb)
returns int language sql immutable as $$
  select count(*)::int from jsonb_array_elements(coalesce(p_sd->'answers', '[]'::jsonb)) a
   where a->>'status' = 'pending' and coalesce((a->>'steal')::boolean, false) = (p_sd->>'phase' = 'steal');
$$;

-- Checks every typed answer at once. auto: the topic's list decides (no list: the judge);
-- manual: the judge decides each; both: the list accepts, the judge decides the rest.
-- Ends the answers when nothing is left for the judge.
create or replace function public.halba_check(p_room_id uuid, p_sd jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sd jsonb := p_sd;
  v_answers jsonb := coalesce(p_sd->'answers', '[]'::jsonb);
  v_judge text := coalesce(p_sd->>'judge', 'both');
  v_list text[];
  v_has_list boolean;
  v_steal boolean := p_sd->>'phase' = 'steal';
  v_count int := coalesce((p_sd->>'count')::int, 0);
  v_match boolean;
  v_status text;
  i int;
begin
  select coalesce(array_agg(public.halba_norm(a)), '{}') into v_list
    from public.alhalba_topics t, unnest(t.answers) a
   where t.id::text = p_sd->'topic'->>'id';
  v_has_list := cardinality(v_list) > 0;
  for i in 0 .. jsonb_array_length(v_answers) - 1 loop
    if v_answers->i->>'status' = 'wait' and coalesce((v_answers->i->>'steal')::boolean, false) = v_steal then
      v_match := v_judge <> 'manual' and (v_answers->i->>'norm') = any(v_list);
      v_status := case when v_match then 'ok' when v_judge = 'auto' and v_has_list then 'no' else 'pending' end;
      v_answers := jsonb_set(v_answers, array[i::text], (v_answers->i) || jsonb_build_object('status', v_status, 'auto', v_match));
      if v_match then
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  v_sd := v_sd || jsonb_build_object('answers', v_answers, 'count', v_count, 'checking', true);
  if v_count >= public.halba_goal(v_sd) or public.halba_pending(v_sd) = 0 then
    return public.halba_end_answers(p_room_id, v_sd) || jsonb_build_object('checked', true, 'done', true);
  end if;
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'checked', true);
end;
$$;

-- The proof starts with an empty answer list (same as v4, not checking).
create or replace function public.halba_begin_prove(p_room_id uuid, v_sd jsonb, p_challenger uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cname text;
begin
  if p_challenger is not null then
    select player_name into v_cname from public.room_players where id = p_challenger;
  end if;
  update public.room_game_state
    set state_data = v_sd || jsonb_build_object(
      'phase', 'prove', 'challenger', p_challenger::text, 'challenger_name', v_cname,
      'challenger_side', case when p_challenger is null then null else public.halba_side(v_sd, p_challenger::text) end,
      'performer_side', coalesce(v_sd->>'bidder_side', public.halba_side(v_sd, v_sd->>'bidder')),
      'count', 0, 'answers', '[]'::jsonb, 'checking', false,
      'prove_ends_at', to_jsonb(now() + make_interval(secs => coalesce((v_sd->'topic'->>'seconds')::int, 30))))
    where room_id = p_room_id;
end;
$$;

-- The answering side types one answer. Up to the bid (or what a steal needs); the last one
-- starts the check.
create or replace function public.halba_answer(p_room_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_me text := public.my_player_id(p_room_id)::text;
  v_text text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  v_norm text;
  v_answers jsonb;
  v_goal int;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' not in ('prove', 'steal') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if v_me is null or public.halba_side(v_sd, v_me) is distinct from v_sd->>'performer_side' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_BIDDER');
  end if;
  if coalesce((v_sd->>'checking')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'CHECKING');
  end if;
  if now() > (v_sd->>'prove_ends_at')::timestamptz + interval '1 second' then
    return jsonb_build_object('ok', false, 'reason', 'TIME_UP');
  end if;
  if char_length(v_text) = 0 or char_length(v_text) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'BAD_ANSWER');
  end if;
  v_goal := public.halba_goal(v_sd);
  if coalesce((v_sd->>'count')::int, 0) + public.halba_waiting(v_sd) >= v_goal then
    return jsonb_build_object('ok', false, 'reason', 'ENOUGH');
  end if;
  v_norm := public.halba_norm(v_text);
  v_answers := coalesce(v_sd->'answers', '[]'::jsonb);
  if jsonb_array_length(v_answers) >= 60 then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY');
  end if;
  if exists (select 1 from jsonb_array_elements(v_answers) a where a->>'norm' = v_norm and a->>'status' <> 'no') then
    return jsonb_build_object('ok', false, 'reason', 'DUPLICATE');
  end if;
  v_sd := v_sd || jsonb_build_object('answers', v_answers || jsonb_build_array(jsonb_build_object(
    'n', jsonb_array_length(v_answers), 'text', v_text, 'norm', v_norm,
    'status', 'wait', 'auto', false, 'by', v_me, 'steal', v_sd->>'phase' = 'steal')));
  if coalesce((v_sd->>'count')::int, 0) + public.halba_waiting(v_sd) >= v_goal then
    return public.halba_check(p_room_id, v_sd);
  end if;
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- The judge accepts or refuses one checked answer. Ends when the goal is met or nothing waits.
create or replace function public.halba_mark(p_room_id uuid, p_n int, p_ok boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_answers jsonb;
  v_old text;
  v_new text := case when p_ok then 'ok' else 'no' end;
  v_count int;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' not in ('prove', 'steal') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if not public.halba_may_judge(p_room_id, v_sd) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_JUDGE');
  end if;
  v_answers := coalesce(v_sd->'answers', '[]'::jsonb);
  if p_n is null or p_n < 0 or p_n >= jsonb_array_length(v_answers)
     or coalesce((v_answers->p_n->>'steal')::boolean, false) <> (v_sd->>'phase' = 'steal') then
    return jsonb_build_object('ok', false, 'reason', 'NO_ANSWER');
  end if;
  v_old := v_answers->p_n->>'status';
  if v_old = 'wait' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_CHECKED');
  end if;
  if v_old = v_new then
    return jsonb_build_object('ok', true);
  end if;
  v_answers := jsonb_set(v_answers, array[p_n::text, 'status'], to_jsonb(v_new));
  v_count := greatest(0, coalesce((v_sd->>'count')::int, 0)
             + case when v_new = 'ok' then 1 else 0 end
             - case when v_old = 'ok' then 1 else 0 end);
  v_sd := v_sd || jsonb_build_object('answers', v_answers, 'count', v_count);
  if v_count >= public.halba_goal(v_sd)
     or (coalesce((v_sd->>'checking')::boolean, false) and public.halba_pending(v_sd) = 0) then
    perform public.halba_end_answers(p_room_id, v_sd);
    return jsonb_build_object('ok', true, 'count', v_count, 'done', true);
  end if;
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

-- Spoken answers (+1 / −1 by the judge), counted toward the goal like typed ones.
create or replace function public.halba_count(p_room_id uuid, p_delta int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_count int;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' not in ('prove', 'steal') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if not public.halba_may_judge(p_room_id, v_sd) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_JUDGE');
  end if;
  if now() > (v_sd->>'prove_ends_at')::timestamptz + interval '3 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'TIME_UP');
  end if;
  v_count := greatest(0, coalesce((v_sd->>'count')::int, 0) + sign(coalesce(p_delta, 0))::int);
  v_sd := v_sd || jsonb_build_object('count', v_count);
  if v_count >= public.halba_goal(v_sd) then
    perform public.halba_end_answers(p_room_id, v_sd);
    return jsonb_build_object('ok', true, 'count', v_count, 'done', true);
  end if;
  if not coalesce((v_sd->>'checking')::boolean, false) and v_count + public.halba_waiting(v_sd) >= public.halba_goal(v_sd) then
    return public.halba_check(p_room_id, v_sd);
  end if;
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

-- Ends the answering: first the check of what was typed, then (once judged) the result.
create or replace function public.halba_finish(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_judge boolean;
  v_member boolean;
  v_grace interval;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' not in ('prove', 'steal') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_judge := public.halba_may_judge(p_room_id, v_sd);
  v_member := public.is_room_host(p_room_id) or public.my_player_id(p_room_id) is not null;
  -- Time is up (or the judge ends it early): check what was typed.
  if not coalesce((v_sd->>'checking')::boolean, false) and public.halba_waiting(v_sd) > 0 then
    if not (v_judge or (v_member and now() >= (v_sd->>'prove_ends_at')::timestamptz + interval '2 seconds')) then
      return jsonb_build_object('ok', false, 'reason', 'NOT_JUDGE');
    end if;
    return public.halba_check(p_room_id, v_sd);
  end if;
  if not v_judge then
    v_grace := case when public.halba_pending(v_sd) > 0 then interval '20 seconds' else interval '4 seconds' end;
    if not v_member or now() < (v_sd->>'prove_ends_at')::timestamptz + v_grace then
      return jsonb_build_object('ok', false, 'reason', 'NOT_JUDGE');
    end if;
  end if;
  return public.halba_end_answers(p_room_id, v_sd);
end;
$$;

-- «سرقة»: same as v4; the steal starts its own typing and check.
create or replace function public.halba_steal(p_room_id uuid, p_take boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_me text := public.my_player_id(p_room_id)::text;
  v_is_chal boolean;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' <> 'steal_offer' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_is_chal := v_me is not null and v_sd->>'challenger' = v_me;
  if coalesce(p_take, false) then
    if not v_is_chal then
      return jsonb_build_object('ok', false, 'reason', 'NOT_CHALLENGER');
    end if;
    v_sd := public.halba_use(v_sd, v_me, 'steal');
    update public.room_game_state
      set state_data = v_sd || jsonb_build_object(
        'phase', 'steal', 'performer_side', v_sd->>'challenger_side', 'checking', false,
        'steal_need', coalesce((v_sd->>'bid')::int, 1) - coalesce((v_sd->>'count')::int, 0),
        'count', 0,
        'prove_ends_at', to_jsonb(now() + make_interval(secs => greatest(15, coalesce((v_sd->'topic'->>'seconds')::int, 30) / 2))))
      where room_id = p_room_id;
    return jsonb_build_object('ok', true);
  end if;
  if not (v_is_chal or public.is_room_host(p_room_id)
          or (public.my_player_id(p_room_id) is not null and now() >= (v_sd->>'offer_ends_at')::timestamptz)) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_YET');
  end if;
  return public.halba_after_round(p_room_id, v_sd);
end;
$$;

-- 3) الصلاحيات -------------------------------------------------------------------

revoke all on function
  public.halba_duel_uneven(jsonb, jsonb), public.halba_round_fields(jsonb, public.alhalba_topics),
  public.halba_waiting(jsonb), public.halba_pending(jsonb), public.halba_check(uuid, jsonb),
  public.halba_pick_topic(jsonb), public.halba_after_round(uuid, jsonb), public.halba_begin_prove(uuid, jsonb, uuid)
from public, anon, authenticated;

revoke all on function
  public.halba_start_round(uuid, text, int, boolean, int, text[], text, int, int), public.halba_swap(uuid),
  public.halba_answer(uuid, text), public.halba_mark(uuid, int, boolean), public.halba_count(uuid, int),
  public.halba_finish(uuid), public.halba_steal(uuid, boolean)
from public, anon;
grant execute on function
  public.halba_start_round(uuid, text, int, boolean, int, text[], text, int, int), public.halba_swap(uuid),
  public.halba_answer(uuid, text), public.halba_mark(uuid, int, boolean), public.halba_count(uuid, int),
  public.halba_finish(uuid), public.halba_steal(uuid, boolean)
to authenticated;

notify pgrst, 'reload schema';
