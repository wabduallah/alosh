-- =============================================================================
-- «الحلبة»: لعبة المزايدة والتحدي.
--
-- كل جولة: يظهر موضوع (مثل «دول تبدأ بحرف الميم»). اللاعبون في الحلبة يزايدون
-- على عدد الإجابات التي يقدرون يذكرونها. أي لاعب يقدر يقول «تحدي» على صاحب
-- أعلى مزايدة، أو ينتهي وقت المزايدة. صاحب المزايدة يذكر إجاباته بصوت عالٍ
-- خلال وقت الموضوع، والمضيف يحسب الإجابات الصحيحة.
--   * نجح: يكسب (المزايدة × 100) نقطة، ويخسرها المتحدّي إن وُجد.
--   * فشل: يخسر (المزايدة × 100) نقطة لصالح المتحدّي، ويخرج من الحلبة.
-- تنتهي المباراة عندما يبقى لاعب واحد في الحلبة، أو بعد عدد الجولات المختار،
-- والفائز صاحب أعلى نقاط.
--
-- الوضعان: «الكل ضد الكل» (كل من في الحلبة يزايد) و«نزال ثنائي» (لاعبان
-- عشوائيان في كل جولة).
--
-- يُشغَّل مرة واحدة بعد schema_al3sh_core.sql و admin_panel.sql، وتشغيله مرة
-- ثانية آمن. اللعبة تُضاف موقوفة؛ فعّلها من لوحة الإدارة بعد نشر الواجهة.
-- =============================================================================

-- 1) المواضيع
create table if not exists public.alhalba_topics (
  id uuid primary key default gen_random_uuid(),
  topic_ar text not null check (char_length(btrim(topic_ar)) between 3 and 160),
  min_answers int not null default 3 check (min_answers between 1 and 30),
  time_limit_sec int not null default 30 check (time_limit_sec between 10 and 180),
  category text,
  created_at timestamptz not null default now()
);
comment on table public.alhalba_topics is 'مواضيع «الحلبة». تقرأها دوال الخادم فقط، ويديرها المدير.';
create unique index if not exists alhalba_topics_topic_key on public.alhalba_topics (md5(topic_ar));

alter table public.alhalba_topics enable row level security;
revoke all on public.alhalba_topics from anon;
grant select, insert, update, delete on public.alhalba_topics to authenticated;
grant all on public.alhalba_topics to service_role;

drop policy if exists "alhalba topics: admin manage" on public.alhalba_topics;
create policy "alhalba topics: admin manage" on public.alhalba_topics
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

insert into public.alhalba_topics (topic_ar, min_answers, time_limit_sec, category) values
  ('دول تبدأ بحرف الميم', 3, 30, 'جغرافيا'),
  ('دول عربية', 5, 30, 'جغرافيا'),
  ('عواصم أوروبية', 4, 30, 'جغرافيا'),
  ('مدن سعودية', 5, 30, 'جغرافيا'),
  ('دول تطل على البحر الأحمر', 3, 30, 'جغرافيا'),
  ('أندية فازت بدوري أبطال أوروبا', 3, 30, 'رياضة'),
  ('أندية في الدوري السعودي', 5, 30, 'رياضة'),
  ('رياضات تُلعب بالكرة', 5, 30, 'رياضة'),
  ('رياضات أولمبية', 5, 30, 'رياضة'),
  ('حيوانات تعيش في البحر', 5, 30, 'طبيعة'),
  ('طيور', 5, 30, 'طبيعة'),
  ('فواكه', 6, 30, 'طبيعة'),
  ('خضروات', 5, 30, 'طبيعة'),
  ('حيوانات تبدأ بحرف الألف', 3, 30, 'طبيعة'),
  ('أكلات شعبية خليجية', 4, 30, 'أكل'),
  ('أنواع حلويات', 5, 30, 'أكل'),
  ('توابل وبهارات', 4, 30, 'أكل'),
  ('مشروبات ساخنة', 4, 30, 'أكل'),
  ('كواكب المجموعة الشمسية', 3, 25, 'علوم'),
  ('عناصر في الجدول الدوري', 5, 30, 'علوم'),
  ('أعضاء في جسم الإنسان', 6, 30, 'علوم'),
  ('ألوان', 6, 25, 'عام'),
  ('مهن ووظائف', 6, 30, 'عام'),
  ('أدوات في المطبخ', 6, 30, 'عام'),
  ('أشياء تجدها في المدرسة', 6, 30, 'عام'),
  ('وسائل نقل', 5, 30, 'عام'),
  ('أسماء أولاد تبدأ بحرف العين', 4, 30, 'أسماء'),
  ('أسماء بنات تبدأ بحرف الميم', 4, 30, 'أسماء'),
  ('أنبياء ذُكروا في القرآن', 5, 30, 'ثقافة'),
  ('سور قرآنية', 6, 30, 'ثقافة'),
  ('شركات سيارات', 6, 30, 'تقنية'),
  ('تطبيقات على الجوال', 6, 30, 'تقنية')
on conflict do nothing;

-- 2) اللعبة نفسها (موقوفة حتى تفعّلها من لوحة الإدارة)
insert into public.games (slug, title_ar, description_ar, min_players, max_players, is_active)
values ('alhalba', 'الحلبة', 'تحدي المواجهة المباشرة والمزايدة! أجب أسرع وخاطر بنقاطك لتسيطر على الحلبة وتطيح بخصومك.', 2, 10, false)
on conflict (slug) do nothing;

-- 3) دوال اللعب. الحالة كلها في room_game_state.state_data:
--    phase: idle | bid | prove | result | over
--    mode, max_rounds, round, fighters (من بقي في الحلبة), knocked, duel,
--    topic {id,text,min,seconds,category}, bid, bidder, bidder_name,
--    bid_ends_at, challenger, challenger_name, prove_ends_at, count, result, used_topics

-- يبدأ جولة جديدة: موضوع عشوائي، ومزايدة لمدة 20 ثانية.
create or replace function public.halba_start_round(p_room_id uuid, p_mode text default null, p_rounds int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_fighters jsonb;
  v_used jsonb;
  v_topic public.alhalba_topics%rowtype;
  v_duel jsonb := null;
  v_mode text;
  v_round int;
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

  -- First round: everyone (except the host) enters the ring.
  if v_sd->'fighters' is null then
    select coalesce(jsonb_agg(p.id::text order by p.joined_at), '[]'::jsonb) into v_fighters
      from public.room_players p where p.room_id = p_room_id and not p.is_host;
    if jsonb_array_length(v_fighters) < 2 then
      return jsonb_build_object('ok', false, 'reason', 'NOT_ENOUGH_PLAYERS');
    end if;
    v_mode := case when p_mode in ('ffa', 'duel') then p_mode else 'ffa' end;
    v_sd := v_sd || jsonb_build_object(
      'fighters', v_fighters,
      'knocked', '[]'::jsonb,
      'mode', v_mode,
      'max_rounds', greatest(1, least(coalesce(p_rounds, 7), 30)),
      'round', 0,
      'used_topics', '[]'::jsonb);
  end if;
  v_fighters := v_sd->'fighters';
  if jsonb_array_length(v_fighters) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'GAME_OVER');
  end if;
  v_round := coalesce((v_sd->>'round')::int, 0) + 1;
  if v_round > coalesce((v_sd->>'max_rounds')::int, 7) then
    return jsonb_build_object('ok', false, 'reason', 'GAME_OVER');
  end if;

  v_used := coalesce(v_sd->'used_topics', '[]'::jsonb);
  select * into v_topic from public.alhalba_topics t
    where not (v_used @> to_jsonb(t.id::text)) order by random() limit 1;
  if not found then
    v_used := '[]'::jsonb;
    select * into v_topic from public.alhalba_topics t order by random() limit 1;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'NO_TOPICS');
    end if;
  end if;

  if v_sd->>'mode' = 'duel' then
    select jsonb_agg(f) into v_duel
      from (select f from jsonb_array_elements_text(v_fighters) f order by random() limit 2) x;
  end if;

  update public.room_game_state
    set active_question_id = null,
        state_data = v_sd || jsonb_build_object(
          'phase', 'bid',
          'round', v_round,
          'used_topics', v_used || to_jsonb(v_topic.id::text),
          'topic', jsonb_build_object('id', v_topic.id, 'text', v_topic.topic_ar, 'min', v_topic.min_answers,
                                      'seconds', v_topic.time_limit_sec, 'category', v_topic.category),
          'duel', v_duel,
          'bid', v_topic.min_answers - 1,
          'bidder', null,
          'bidder_name', null,
          'challenger', null,
          'challenger_name', null,
          'count', 0,
          'result', null,
          'bid_ends_at', to_jsonb(now() + interval '20 seconds'),
          'prove_ends_at', null)
    where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'round', v_round);
end;
$$;

-- Who may bid or challenge this round: the duel pair, or everyone still in the ring.
create or replace function public.halba_can_fight(p_sd jsonb, p_player uuid)
returns boolean
language sql
immutable
as $$
  select case
    when p_sd->'duel' is not null and jsonb_typeof(p_sd->'duel') = 'array' then (p_sd->'duel') @> to_jsonb(p_player::text)
    else coalesce(p_sd->'fighters', '[]'::jsonb) @> to_jsonb(p_player::text)
  end;
$$;

-- A player raises the bid. Each new bid keeps at least 8 seconds on the clock.
create or replace function public.halba_bid(p_room_id uuid, p_amount int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_me uuid := public.my_player_id(p_room_id);
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
  if not public.halba_can_fight(v_sd, v_me) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FIGHTING');
  end if;
  if p_amount is null or p_amount <= coalesce((v_sd->>'bid')::int, 0) or p_amount > 50 then
    return jsonb_build_object('ok', false, 'reason', 'BID_TOO_LOW');
  end if;
  select player_name into v_name from public.room_players where id = v_me;
  update public.room_game_state
    set state_data = v_sd || jsonb_build_object(
      'bid', p_amount,
      'bidder', v_me::text,
      'bidder_name', v_name,
      'bid_ends_at', to_jsonb(greatest((v_sd->>'bid_ends_at')::timestamptz, now() + interval '8 seconds')))
    where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'bid', p_amount);
end;
$$;

-- Moves the round to «إثبات»: the bidder lists answers, the clock runs.
create or replace function public.halba_begin_prove(p_room_id uuid, v_sd jsonb, p_challenger uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cname text;
begin
  if p_challenger is not null then
    select player_name into v_cname from public.room_players where id = p_challenger;
  end if;
  update public.room_game_state
    set state_data = v_sd || jsonb_build_object(
      'phase', 'prove',
      'challenger', p_challenger::text,
      'challenger_name', v_cname,
      'count', 0,
      'prove_ends_at', to_jsonb(now() + make_interval(secs => coalesce((v_sd->'topic'->>'seconds')::int, 30))))
    where room_id = p_room_id;
end;
$$;

-- «تحدي»: a fighter challenges the top bidder.
create or replace function public.halba_challenge(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_me uuid := public.my_player_id(p_room_id);
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
  if v_sd->>'bidder' = v_me::text then
    return jsonb_build_object('ok', false, 'reason', 'OWN_BID');
  end if;
  if not public.halba_can_fight(v_sd, v_me) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FIGHTING');
  end if;
  perform public.halba_begin_prove(p_room_id, v_sd, v_me);
  return jsonb_build_object('ok', true);
end;
$$;

-- Bidding time is over (anyone in the room may call it once the clock reaches zero).
-- With no bid at all, a random fighter must list the topic's minimum.
create or replace function public.halba_close_bids(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    select f into v_pick
      from jsonb_array_elements_text(case when jsonb_typeof(v_sd->'duel') = 'array' then v_sd->'duel' else v_sd->'fighters' end) f
      order by random() limit 1;
    v_sd := v_sd || jsonb_build_object(
      'bidder', v_pick,
      'bidder_name', (select player_name from public.room_players where id = v_pick::uuid),
      'bid', coalesce((v_sd->'topic'->>'min')::int, 3));
  end if;
  perform public.halba_begin_prove(p_room_id, v_sd, null);
  return jsonb_build_object('ok', true);
end;
$$;

-- The host counts the answers said out loud (+1 / -1).
create or replace function public.halba_count(p_room_id uuid, p_delta int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_count int;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  if v_state.state_data->>'phase' <> 'prove' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_count := greatest(0, coalesce((v_state.state_data->>'count')::int, 0) + sign(coalesce(p_delta, 0))::int);
  update public.room_game_state
    set state_data = state_data || jsonb_build_object('count', v_count)
    where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

-- The host ends the proof: points move, a failed bidder leaves the ring.
create or replace function public.halba_finish(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_bid int;
  v_count int;
  v_ok boolean;
  v_points int;
  v_bidder uuid;
  v_chal uuid;
  v_fighters jsonb;
  v_knocked jsonb;
  v_over boolean;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  select * into v_state from public.room_game_state where room_id = p_room_id for update;
  v_sd := coalesce(v_state.state_data, '{}'::jsonb);
  if v_sd->>'phase' <> 'prove' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_bid := coalesce((v_sd->>'bid')::int, 1);
  v_count := coalesce((v_sd->>'count')::int, 0);
  v_ok := v_count >= v_bid;
  v_points := v_bid * 100;
  v_bidder := (v_sd->>'bidder')::uuid;
  v_chal := nullif(v_sd->>'challenger', '')::uuid;
  v_fighters := coalesce(v_sd->'fighters', '[]'::jsonb);
  v_knocked := coalesce(v_sd->'knocked', '[]'::jsonb);

  if v_ok then
    update public.room_players set score = score + v_points where id = v_bidder and room_id = p_room_id;
    if v_chal is not null then
      update public.room_players set score = greatest(0, score - v_points) where id = v_chal and room_id = p_room_id;
    end if;
  else
    update public.room_players set score = greatest(0, score - v_points) where id = v_bidder and room_id = p_room_id;
    if v_chal is not null then
      update public.room_players set score = score + v_points where id = v_chal and room_id = p_room_id;
    end if;
    v_fighters := v_fighters - (v_bidder::text);
    v_knocked := v_knocked || to_jsonb(v_bidder::text);
  end if;

  v_over := jsonb_array_length(v_fighters) < 2
            or coalesce((v_sd->>'round')::int, 1) >= coalesce((v_sd->>'max_rounds')::int, 7);

  update public.room_game_state
    set state_data = v_sd || jsonb_build_object(
      'phase', case when v_over then 'over' else 'result' end,
      'fighters', v_fighters,
      'knocked', v_knocked,
      'result', jsonb_build_object(
        'success', v_ok,
        'bidder_name', v_sd->>'bidder_name',
        'challenger_name', v_sd->>'challenger_name',
        'bid', v_bid,
        'count', v_count,
        'points', v_points,
        'knocked_out', not v_ok))
    where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'success', v_ok, 'over', v_over);
end;
$$;

revoke all on function public.halba_start_round(uuid, text, int), public.halba_bid(uuid, int), public.halba_challenge(uuid),
  public.halba_close_bids(uuid), public.halba_count(uuid, int), public.halba_finish(uuid),
  public.halba_begin_prove(uuid, jsonb, uuid) from public, anon;
grant execute on function public.halba_start_round(uuid, text, int), public.halba_bid(uuid, int), public.halba_challenge(uuid),
  public.halba_close_bids(uuid), public.halba_count(uuid, int), public.halba_finish(uuid) to authenticated;
grant execute on function public.halba_can_fight(jsonb, uuid) to authenticated;
