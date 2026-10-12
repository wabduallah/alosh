-- =============================================================================
-- «الحلبة» الإصدار 4. يُشغَّل بعد alhalba_v3.sql، وتشغيله مرة ثانية آمن.
--
-- الجديد:
--   * وضع الفرق: فريقان (أحمر وأزرق)، أي عضو يزايد ويتحدى ويكتب لفريقه،
--     والنقاط والمحاولات للفريق.
--   * أوراق قوة، كل ورقة مرة واحدة لكل لاعب في المباراة:
--       مضاعفة: نقاط الجولة ×2، تُلعب في أول 10 ثوانٍ من الإجابة.
--       تبديل الموضوع: موضوع جديد أثناء المزايدة.
--       سرقة: إذا فشل صاحب المزايدة، يكمل المتحدّي الباقي ويأخذ النقاط.
--   * اختيار التصنيفات قبل المباراة.
--   * توقعات المتفرجين: من لا يلعب الجولة يتوقع «ينجح أو يفشل»، والتوقع
--     الصحيح يعطي 50 نقطة تشجيع.
--   * إحصاءات نهاية المباراة: أعلى مزايدة نجحت، أكثر من أجاب صح، أجرأ تحدي،
--     أفضل مشجع.
--
-- كل الدوال مبنية على «الطرف» (side): اللاعب نفسه في الأوضاع الفردية،
-- ولون الفريق في وضع الفرق.
-- =============================================================================

-- The side a player fights for: their team in team mode, else themselves.
create or replace function public.halba_side(p_sd jsonb, p_pid text)
returns text language sql immutable as $$
  select case when p_sd->>'mode' = 'teams' then p_sd->'teams'->>p_pid else p_pid end;
$$;

-- May this player bid or challenge this round?
create or replace function public.halba_can_fight2(p_sd jsonb, p_pid text)
returns boolean language sql immutable as $$
  select p_pid is not null
     and public.halba_side(p_sd, p_pid) is not null
     and coalesce(p_sd->'fighters', '[]'::jsonb) @> to_jsonb(public.halba_side(p_sd, p_pid))
     and (jsonb_typeof(p_sd->'duel') is distinct from 'array' or (p_sd->'duel') @> to_jsonb(public.halba_side(p_sd, p_pid)));
$$;

create or replace function public.halba_used(p_sd jsonb, p_pid text, p_power text)
returns boolean language sql immutable as $$
  select coalesce(p_sd->'powers'->p_pid, '[]'::jsonb) @> to_jsonb(p_power);
$$;

create or replace function public.halba_use(p_sd jsonb, p_pid text, p_power text)
returns jsonb language sql immutable as $$
  select p_sd || jsonb_build_object('powers',
    coalesce(p_sd->'powers', '{}'::jsonb) || jsonb_build_object(p_pid, coalesce(p_sd->'powers'->p_pid, '[]'::jsonb) || to_jsonb(p_power)));
$$;

-- Topic categories for the setup screen (topics themselves stay server-only).
create or replace function public.halba_categories()
returns table(category text, topics int)
language sql stable security definer set search_path = public as $$
  select coalesce(t.category, 'عام'), count(*)::int from public.alhalba_topics t group by 1 order by 1;
$$;

-- A random unused topic from the chosen categories.
create or replace function public.halba_pick_topic(p_sd jsonb)
returns public.alhalba_topics language plpgsql stable security definer set search_path = public as $$
declare
  v_topic public.alhalba_topics%rowtype;
  v_cats jsonb := p_sd->'categories';
  v_used jsonb := coalesce(p_sd->'used_topics', '[]'::jsonb);
begin
  select * into v_topic from public.alhalba_topics t
   where (jsonb_typeof(v_cats) is distinct from 'array' or jsonb_array_length(v_cats) = 0 or v_cats @> to_jsonb(coalesce(t.category, 'عام')))
     and not (v_used @> to_jsonb(t.id::text))
   order by random() limit 1;
  if not found then
    select * into v_topic from public.alhalba_topics t
     where (jsonb_typeof(v_cats) is distinct from 'array' or jsonb_array_length(v_cats) = 0 or v_cats @> to_jsonb(coalesce(t.category, 'عام')))
     order by random() limit 1;
  end if;
  return v_topic;
end;
$$;

-- The fields every new bidding phase starts from.
create or replace function public.halba_bid_fields(p_topic public.alhalba_topics)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'phase', 'bid',
    'topic', jsonb_build_object('id', p_topic.id, 'text', p_topic.topic_ar, 'min', p_topic.min_answers,
                                'seconds', p_topic.time_limit_sec, 'category', p_topic.category),
    'bid', p_topic.min_answers - 1, 'bidder', null, 'bidder_name', null, 'bidder_side', null,
    'challenger', null, 'challenger_name', null, 'challenger_side', null, 'performer_side', null,
    'count', 0, 'answers', '[]'::jsonb, 'double', false, 'double_by', null,
    'steal_need', null, 'offer_ends_at', null, 'steal_result', null, 'result', null,
    'predictions', '{}'::jsonb,
    'bid_ends_at', to_jsonb(now() + interval '20 seconds'), 'prove_ends_at', null);
$$;

create or replace function public.halba_start_round(
  p_room_id uuid, p_mode text default null, p_rounds int default null,
  p_host_plays boolean default true, p_lives int default 2, p_categories text[] default null)
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
  if v_round > coalesce((v_sd->>'max_rounds')::int, 7) then
    update public.room_game_state set state_data = v_sd || jsonb_build_object('phase', 'over') where room_id = p_room_id;
    return jsonb_build_object('ok', false, 'reason', 'GAME_OVER');
  end if;

  v_topic := public.halba_pick_topic(v_sd);
  if v_topic.id is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_TOPICS');
  end if;
  if v_sd->>'mode' = 'duel' then
    select jsonb_agg(f) into v_duel
      from (select f from jsonb_array_elements_text(v_fighters) f order by random() limit 2) x;
  end if;

  update public.room_game_state
    set active_question_id = null,
        state_data = v_sd || public.halba_bid_fields(v_topic) || jsonb_build_object(
          'round', v_round, 'duel', v_duel,
          'used_topics', coalesce(v_sd->'used_topics', '[]'::jsonb) || to_jsonb(v_topic.id::text))
    where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'round', v_round);
end;
$$;

create or replace function public.halba_bid(p_room_id uuid, p_amount int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_me text := public.my_player_id(p_room_id)::text;
  v_name text;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' <> 'bid' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if now() >= (v_sd->>'bid_ends_at')::timestamptz then
    return jsonb_build_object('ok', false, 'reason', 'TIME_UP');
  end if;
  if not public.halba_can_fight2(v_sd, v_me) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FIGHTING');
  end if;
  if p_amount is null or p_amount <= coalesce((v_sd->>'bid')::int, 0) or p_amount > 50 then
    return jsonb_build_object('ok', false, 'reason', 'BID_TOO_LOW');
  end if;
  select player_name into v_name from public.room_players where id = v_me::uuid;
  update public.room_game_state
    set state_data = v_sd || jsonb_build_object(
      'bid', p_amount, 'bidder', v_me, 'bidder_name', v_name, 'bidder_side', public.halba_side(v_sd, v_me),
      'bid_ends_at', to_jsonb(greatest((v_sd->>'bid_ends_at')::timestamptz, now() + interval '8 seconds')))
    where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'bid', p_amount);
end;
$$;

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
      'count', 0, 'answers', '[]'::jsonb,
      'prove_ends_at', to_jsonb(now() + make_interval(secs => coalesce((v_sd->'topic'->>'seconds')::int, 30))))
    where room_id = p_room_id;
end;
$$;

create or replace function public.halba_challenge(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_me text := public.my_player_id(p_room_id)::text;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' <> 'bid' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if v_sd->>'bidder' is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_BID');
  end if;
  if public.halba_side(v_sd, v_me) = v_sd->>'bidder_side' then
    return jsonb_build_object('ok', false, 'reason', 'OWN_BID');
  end if;
  if not public.halba_can_fight2(v_sd, v_me) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FIGHTING');
  end if;
  perform public.halba_begin_prove(p_room_id, v_sd, v_me::uuid);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.halba_close_bids(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_pick text;
begin
  if not (public.is_room_host(p_room_id) or public.my_player_id(p_room_id) is not null or public.is_app_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' <> 'bid' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if now() < (v_sd->>'bid_ends_at')::timestamptz and not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_YET');
  end if;
  if v_sd->>'bidder' is null then
    select p.id::text into v_pick from public.room_players p
     where p.room_id = p_room_id and public.halba_can_fight2(v_sd, p.id::text)
     order by random() limit 1;
    if v_pick is null then
      return jsonb_build_object('ok', false, 'reason', 'NOT_ENOUGH_PLAYERS');
    end if;
    v_sd := v_sd || jsonb_build_object(
      'bidder', v_pick, 'bidder_side', public.halba_side(v_sd, v_pick),
      'bidder_name', (select player_name from public.room_players where id = v_pick::uuid),
      'bid', coalesce((v_sd->'topic'->>'min')::int, 3));
  end if;
  perform public.halba_begin_prove(p_room_id, v_sd, null);
  return jsonb_build_object('ok', true);
end;
$$;

-- Who counts answers right now: never the answering side. The host does, unless the
-- host's side is answering; then anyone else in the game does. The opponent may too.
create or replace function public.halba_may_judge(p_room_id uuid, p_sd jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_me text := public.my_player_id(p_room_id)::text;
  v_my_side text;
  v_perf text := coalesce(p_sd->>'performer_side', public.halba_side(p_sd, p_sd->>'bidder'));
  v_host text;
begin
  if public.is_app_admin() then
    return true;
  end if;
  v_my_side := public.halba_side(p_sd, v_me);
  if v_me is not null and v_my_side is not distinct from v_perf then
    return false;
  end if;
  if public.is_room_host(p_room_id) then
    return true;
  end if;
  -- The opponent may judge: the challenger during the proof, the bidder during a steal.
  if v_me is not null and ((p_sd->>'phase' = 'prove' and p_sd->>'challenger' = v_me)
                        or (p_sd->>'phase' = 'steal' and p_sd->>'bidder' = v_me)) then
    return true;
  end if;
  select p.id::text into v_host from public.room_players p where p.room_id = p_room_id and p.is_host limit 1;
  return v_me is not null and v_my_side is not null
     and public.halba_side(p_sd, v_host) is not distinct from v_perf;
end;
$$;

create or replace function public.halba_answer(p_room_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_me text := public.my_player_id(p_room_id)::text;
  v_text text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  v_answers jsonb;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' not in ('prove', 'steal') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if v_me is null or public.halba_side(v_sd, v_me) is distinct from v_sd->>'performer_side' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_BIDDER');
  end if;
  if now() > (v_sd->>'prove_ends_at')::timestamptz + interval '1 second' then
    return jsonb_build_object('ok', false, 'reason', 'TIME_UP');
  end if;
  if char_length(v_text) = 0 or char_length(v_text) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'BAD_ANSWER');
  end if;
  v_answers := coalesce(v_sd->'answers', '[]'::jsonb);
  if jsonb_array_length(v_answers) >= 60 then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY');
  end if;
  if exists (select 1 from jsonb_array_elements(v_answers) a where a->>'norm' = public.halba_norm(v_text) and a->>'status' <> 'no') then
    return jsonb_build_object('ok', false, 'reason', 'DUPLICATE');
  end if;
  update public.room_game_state
    set state_data = v_sd || jsonb_build_object('answers', v_answers || jsonb_build_array(jsonb_build_object(
      'n', jsonb_array_length(v_answers), 'text', v_text, 'norm', public.halba_norm(v_text),
      'status', 'pending', 'by', v_me, 'steal', v_sd->>'phase' = 'steal')))
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Adds points to a side (a player's score, or a team score). Returns the new state.
create or replace function public.halba_add(p_room_id uuid, p_sd jsonb, p_side text, p_delta int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_side is null or p_delta = 0 then
    return p_sd;
  end if;
  if p_sd->>'mode' = 'teams' then
    return p_sd || jsonb_build_object('team_scores', coalesce(p_sd->'team_scores', '{}'::jsonb)
      || jsonb_build_object(p_side, greatest(0, coalesce((p_sd->'team_scores'->>p_side)::int, 0) + p_delta)));
  end if;
  perform set_config('alosh.trusted', 'on', true);
  update public.room_players set score = greatest(0, score + p_delta) where id::text = p_side and room_id = p_room_id;
  perform set_config('alosh.trusted', '', true);
  return p_sd;
end;
$$;

-- Credits accepted answers to whoever typed them (spoken ones to the main answerer).
create or replace function public.halba_credit(p_sd jsonb, p_steal boolean, p_count int, p_main text)
returns jsonb language plpgsql immutable as $$
declare
  v_correct jsonb := coalesce(p_sd->'stats'->'correct', '{}'::jsonb);
  v_typed int := 0;
  r record;
begin
  for r in
    select a->>'by' as who, count(*)::int as n
      from jsonb_array_elements(coalesce(p_sd->'answers', '[]'::jsonb)) a
     where a->>'status' = 'ok' and coalesce((a->>'steal')::boolean, false) = p_steal and a->>'by' is not null
     group by 1
  loop
    v_correct := v_correct || jsonb_build_object(r.who, coalesce((v_correct->>r.who)::int, 0) + r.n);
    v_typed := v_typed + r.n;
  end loop;
  if p_main is not null and p_count > v_typed then
    v_correct := v_correct || jsonb_build_object(p_main, coalesce((v_correct->>p_main)::int, 0) + p_count - v_typed);
  end if;
  return jsonb_set(p_sd, '{stats,correct}', v_correct, true);
end;
$$;

-- After a round: result or end of the match.
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
            or coalesce((p_sd->>'round')::int, 1) >= coalesce((p_sd->>'max_rounds')::int, 7);
  v_sd := v_sd || jsonb_build_object('fighters', v_fighters, 'phase', case when v_over then 'over' else 'result' end);
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'over', v_over);
end;
$$;

-- Ends the main proof: points, lives, predictions, stats, and the steal offer.
create or replace function public.halba_resolve(p_room_id uuid, v_sd jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_bid int := coalesce((v_sd->>'bid')::int, 1);
  v_count int := coalesce((v_sd->>'count')::int, 0);
  v_mult int := case when coalesce((v_sd->>'double')::boolean, false) then 2 else 1 end;
  v_ok boolean := coalesce((v_sd->>'count')::int, 0) >= coalesce((v_sd->>'bid')::int, 1);
  v_points int;
  v_perf text := coalesce(v_sd->>'performer_side', public.halba_side(v_sd, v_sd->>'bidder'));
  v_chal text := v_sd->>'challenger_side';
  v_lives jsonb := coalesce(v_sd->'lives', '{}'::jsonb);
  v_left int;
  v_out boolean := false;
  v_stats jsonb;
  v_cheers jsonb;
  r record;
begin
  v_points := v_bid * 100 * v_mult;

  -- Predictions from spectators: 50 points of cheer for each right guess.
  v_cheers := coalesce(v_sd->'stats'->'cheers', '{}'::jsonb);
  for r in select k, v from jsonb_each_text(coalesce(v_sd->'predictions', '{}'::jsonb)) t(k, v) loop
    if (r.v = 'true') = v_ok then
      v_cheers := v_cheers || jsonb_build_object(r.k, coalesce((v_cheers->>r.k)::int, 0) + 50);
      if v_sd->>'mode' <> 'teams' then
        v_sd := public.halba_add(p_room_id, v_sd, r.k, 50);
      end if;
    end if;
  end loop;
  v_sd := jsonb_set(v_sd, '{stats,cheers}', v_cheers, true);
  v_sd := public.halba_credit(v_sd, false, v_count, v_sd->>'bidder');

  if v_ok then
    v_sd := public.halba_add(p_room_id, v_sd, v_perf, v_points);
    v_sd := public.halba_add(p_room_id, v_sd, v_chal, -v_points);
    v_left := coalesce((v_lives->>v_perf)::int, 1);
    if v_bid > coalesce((v_sd->'stats'->'best_bid'->>'bid')::int, 0) then
      v_sd := jsonb_set(v_sd, '{stats,best_bid}', jsonb_build_object('name', v_sd->>'bidder_name', 'bid', v_bid), true);
    end if;
  else
    v_sd := public.halba_add(p_room_id, v_sd, v_perf, -v_points);
    v_sd := public.halba_add(p_room_id, v_sd, v_chal, v_points);
    v_left := greatest(0, coalesce((v_lives->>v_perf)::int, 1) - 1);
    v_lives := v_lives || jsonb_build_object(v_perf, v_left);
    if v_left = 0 then
      v_out := true;
      v_sd := v_sd || jsonb_build_object(
        'fighters', coalesce(v_sd->'fighters', '[]'::jsonb) - v_perf,
        'knocked', coalesce(v_sd->'knocked', '[]'::jsonb) || to_jsonb(v_perf));
    end if;
    if v_sd->>'challenger' is not null and v_bid > coalesce((v_sd->'stats'->'bold'->>'bid')::int, 0) then
      v_sd := jsonb_set(v_sd, '{stats,bold}', jsonb_build_object('name', v_sd->>'challenger_name', 'bid', v_bid), true);
    end if;
  end if;

  v_sd := v_sd || jsonb_build_object('lives', v_lives, 'result', jsonb_build_object(
    'success', v_ok, 'bidder_name', v_sd->>'bidder_name', 'challenger_name', v_sd->>'challenger_name',
    'bid', v_bid, 'count', v_count, 'points', v_points, 'doubled', v_mult = 2,
    'knocked_out', v_out, 'lives_left', v_left, 'side', v_perf));

  -- The challenger may try to steal the rest with their card.
  if not v_ok and v_sd->>'challenger' is not null and v_bid > v_count
     and not public.halba_used(v_sd, v_sd->>'challenger', 'steal') then
    v_sd := v_sd || jsonb_build_object('phase', 'steal_offer', 'offer_ends_at', to_jsonb(now() + interval '10 seconds'));
    update public.room_game_state set state_data = v_sd where room_id = p_room_id;
    return jsonb_build_object('ok', true, 'success', v_ok, 'steal_offer', true);
  end if;
  return public.halba_after_round(p_room_id, v_sd) || jsonb_build_object('success', v_ok);
end;
$$;

-- Ends a steal attempt.
create or replace function public.halba_resolve_steal(p_room_id uuid, v_sd jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_need int := coalesce((v_sd->>'steal_need')::int, 1);
  v_count int := coalesce((v_sd->>'count')::int, 0);
  v_ok boolean;
  v_points int := coalesce((v_sd->>'bid')::int, 1) * 100;
begin
  v_ok := v_count >= v_need;
  v_sd := public.halba_credit(v_sd, true, v_count, v_sd->>'challenger');
  if v_ok then
    v_sd := public.halba_add(p_room_id, v_sd, v_sd->>'challenger_side', v_points);
  end if;
  v_sd := v_sd || jsonb_build_object('steal_result', jsonb_build_object(
    'success', v_ok, 'name', v_sd->>'challenger_name', 'need', v_need, 'count', v_count, 'points', v_points));
  return public.halba_after_round(p_room_id, v_sd) || jsonb_build_object('success', v_ok);
end;
$$;

-- Ends whichever answering phase is running.
create or replace function public.halba_end_answers(p_room_id uuid, v_sd jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if v_sd->>'phase' = 'steal' then
    return public.halba_resolve_steal(p_room_id, v_sd);
  end if;
  return public.halba_resolve(p_room_id, v_sd);
end;
$$;

create or replace function public.halba_goal(p_sd jsonb)
returns int language sql immutable as $$
  select case when p_sd->>'phase' = 'steal' then coalesce((p_sd->>'steal_need')::int, 1) else coalesce((p_sd->>'bid')::int, 1) end;
$$;

create or replace function public.halba_mark(p_room_id uuid, p_n int, p_ok boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_answers jsonb;
  v_old text;
  v_new text := case when p_ok then 'ok' else 'no' end;
  v_count int;
  v_this_phase boolean;
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
  if p_n is null or p_n < 0 or p_n >= jsonb_array_length(v_answers) then
    return jsonb_build_object('ok', false, 'reason', 'NO_ANSWER');
  end if;
  -- Only answers of the running phase count.
  v_this_phase := coalesce((v_answers->p_n->>'steal')::boolean, false) = (v_sd->>'phase' = 'steal');
  if not v_this_phase then
    return jsonb_build_object('ok', false, 'reason', 'NO_ANSWER');
  end if;
  v_old := v_answers->p_n->>'status';
  if v_old = v_new then
    return jsonb_build_object('ok', true);
  end if;
  v_answers := jsonb_set(v_answers, array[p_n::text, 'status'], to_jsonb(v_new));
  v_count := greatest(0, coalesce((v_sd->>'count')::int, 0)
             + case when v_new = 'ok' then 1 else 0 end
             - case when v_old = 'ok' then 1 else 0 end);
  v_sd := v_sd || jsonb_build_object('answers', v_answers, 'count', v_count);
  if v_count >= public.halba_goal(v_sd) then
    perform public.halba_end_answers(p_room_id, v_sd);
    return jsonb_build_object('ok', true, 'count', v_count, 'done', true);
  end if;
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

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
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

create or replace function public.halba_finish(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_pending boolean;
  v_grace interval;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' not in ('prove', 'steal') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if not public.halba_may_judge(p_room_id, v_sd) then
    v_pending := exists (select 1 from jsonb_array_elements(coalesce(v_sd->'answers', '[]'::jsonb)) a where a->>'status' = 'pending');
    v_grace := case when v_pending then interval '20 seconds' else interval '4 seconds' end;
    if not (public.is_room_host(p_room_id) or public.my_player_id(p_room_id) is not null)
       or now() < (v_sd->>'prove_ends_at')::timestamptz + v_grace then
      return jsonb_build_object('ok', false, 'reason', 'NOT_JUDGE');
    end if;
  end if;
  return public.halba_end_answers(p_room_id, v_sd);
end;
$$;

-- «سرقة»: the challenger takes (or skips) the chance to finish the list.
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
        'phase', 'steal', 'performer_side', v_sd->>'challenger_side',
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

-- «مضاعفة»: the answering side doubles the round in its first 10 seconds.
create or replace function public.halba_double(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_me text := public.my_player_id(p_room_id)::text;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  if v_sd->>'phase' <> 'prove' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if v_sd->>'performer_side' is null or public.halba_side(v_sd, v_me) is distinct from v_sd->>'performer_side' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_BIDDER');
  end if;
  -- Only at the start: before any answer counts and within the first 10 seconds.
  if coalesce((v_sd->>'count')::int, 0) > 0
     or now() > (v_sd->>'prove_ends_at')::timestamptz
               - make_interval(secs => coalesce((v_sd->'topic'->>'seconds')::int, 30)) + interval '10 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'TOO_LATE');
  end if;
  if coalesce((v_sd->>'double')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_DOUBLE');
  end if;
  if public.halba_used(v_sd, v_me, 'double') then
    return jsonb_build_object('ok', false, 'reason', 'USED');
  end if;
  v_sd := public.halba_use(v_sd, v_me, 'double');
  update public.room_game_state
    set state_data = v_sd || jsonb_build_object('double', true,
      'double_by', (select player_name from public.room_players where id = v_me::uuid))
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- «تبديل الموضوع»: a fighter swaps the topic during bidding; bids start over.
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
    set state_data = v_sd || public.halba_bid_fields(v_topic) || jsonb_build_object(
      'used_topics', coalesce(v_sd->'used_topics', '[]'::jsonb) || to_jsonb(v_topic.id::text),
      'predictions', coalesce(v_sd->'predictions', '{}'::jsonb),
      'swapped_by', (select player_name from public.room_players where id = v_me::uuid))
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Spectators (anyone not fighting this round) guess: will the answering side make it?
create or replace function public.halba_predict(p_room_id uuid, p_success boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_me text := public.my_player_id(p_room_id)::text;
begin
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  if v_sd->>'phase' not in ('bid', 'prove')
     or (v_sd->>'phase' = 'prove'
         and now() > (v_sd->>'prove_ends_at')::timestamptz
                     - make_interval(secs => coalesce((v_sd->'topic'->>'seconds')::int, 30)) + interval '10 seconds') then
    return jsonb_build_object('ok', false, 'reason', 'TOO_LATE');
  end if;
  if public.halba_can_fight2(v_sd, v_me)
     or public.halba_side(v_sd, v_me) is not distinct from v_sd->>'performer_side' then
    return jsonb_build_object('ok', false, 'reason', 'FIGHTING');
  end if;
  update public.room_game_state
    set state_data = v_sd || jsonb_build_object('predictions',
      coalesce(v_sd->'predictions', '{}'::jsonb) || jsonb_build_object(v_me, coalesce(p_success, false)))
    where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.halba_reset(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  update public.room_players set score = 0, team_color = null where room_id = p_room_id;
  update public.room_game_state set active_question_id = null, state_data = '{}'::jsonb where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

drop function if exists public.halba_start_round(uuid, text, int, boolean, int);

-- Internal helpers: called only from inside the functions above (they run as the owner).
-- Supabase grants new functions to "authenticated" by default, so revoke from it too:
-- before this, any signed-in user could call halba_resolve / halba_begin_prove with a made-up state.
revoke all on function
  public.halba_used(jsonb, text, text), public.halba_use(jsonb, text, text), public.halba_pick_topic(jsonb),
  public.halba_bid_fields(public.alhalba_topics), public.halba_add(uuid, jsonb, text, int),
  public.halba_credit(jsonb, boolean, int, text), public.halba_after_round(uuid, jsonb), public.halba_resolve(uuid, jsonb),
  public.halba_resolve_steal(uuid, jsonb), public.halba_end_answers(uuid, jsonb), public.halba_goal(jsonb),
  public.halba_begin_prove(uuid, jsonb, uuid), public.halba_present(uuid, jsonb)
from public, anon, authenticated;

-- Player actions: signed-in players only (each checks the room and the phase itself).
revoke all on function
  public.halba_start_round(uuid, text, int, boolean, int, text[]), public.halba_steal(uuid, boolean),
  public.halba_double(uuid), public.halba_swap(uuid), public.halba_predict(uuid, boolean), public.halba_categories(),
  public.halba_side(jsonb, text), public.halba_can_fight2(jsonb, text)
from public, anon;
grant execute on function
  public.halba_start_round(uuid, text, int, boolean, int, text[]), public.halba_steal(uuid, boolean),
  public.halba_double(uuid), public.halba_swap(uuid), public.halba_predict(uuid, boolean), public.halba_categories(),
  public.halba_bid(uuid, int), public.halba_challenge(uuid), public.halba_close_bids(uuid), public.halba_answer(uuid, text),
  public.halba_mark(uuid, int, boolean), public.halba_count(uuid, int), public.halba_finish(uuid), public.halba_reset(uuid),
  public.halba_may_judge(uuid, jsonb), public.halba_can_fight2(jsonb, text), public.halba_side(jsonb, text)
to authenticated;

-- Let the API see the new and changed functions right away.
notify pgrst, 'reload schema';
