-- =============================================================================
-- «الحلبة» الإصدار 6. يُشغَّل بعد alhalba_v5.sql، وتشغيله مرة ثانية آمن.
--
-- القوانين:
--   * وقت الإجابة يتناسب مع المزايدة: 10 ثوانٍ + «الإيقاع» لكل إجابة (6 ثوانٍ افتراضيًا)،
--     ومثله للسرقة على ما بقي. ويبقى للمضيف خيار الوقت الثابت.
--   * سقف المزايدة 15.
--   * خسارة حقيقية: النقاط تنزل تحت الصفر.
--   * التوقع للجميع: بعد بدء الإجابة يتوقع كل من ليس في طرف الإجابة أو التحدي.
--   * مطابقة أذكى: الإجابة القريبة من القائمة (حرف زائد أو ناقص، أو إحداهما داخل الأخرى)
--     تذهب للحَكَم بدل الرفض، والمواضيع المفتوحة (مثل «أعذار للتأخر») لا تُرفض فيها إجابة تلقائيًا.
--   * انتقال تلقائي للجولة التالية بعد 8 ثوانٍ من النتيجة (يوقفه المضيف).
--   * قاعدة الفوز: أعلى نقاط، أو آخر من بقي.
--   * جولة جماعية كل عدة جولات: الكل يكتب في نفس الوقت، والإجابة الصحيحة التي لم
--     يكتبها غيرك تعطيك 100 نقطة.
--   * مستويات المواضيع: سهل / متوسط / صعب.
--   * إحصائية «أفضل سرقة» لملخص النهاية.
-- =============================================================================

-- الجداول ----------------------------------------------------------------------

alter table public.alhalba_topics add column if not exists difficulty int;
alter table public.alhalba_topics add column if not exists open_ended boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alhalba_topics_difficulty_check') then
    alter table public.alhalba_topics add constraint alhalba_topics_difficulty_check check (difficulty is null or difficulty between 1 and 3);
  end if;
end $$;
comment on column public.alhalba_topics.difficulty is '1 سهل، 2 متوسط، 3 صعب. الفارغ يُعامل متوسطًا.';
comment on column public.alhalba_topics.open_ended is 'موضوع مفتوح (آراء وأمثلة لا تنتهي): ما لا يطابق القائمة يحكم فيه الحَكَم ولا يُرفض تلقائيًا.';

-- إجابات الجولة الجماعية: سرية حتى نهاية الجولة (تُقرأ عبر الدوال فقط).
create table if not exists public.room_halba_group (
  room_id   uuid not null references public.game_rooms (id) on delete cascade,
  player_id uuid not null references public.room_players (id) on delete cascade,
  side      text not null,
  text      text not null,
  norm      text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, player_id, norm)
);
alter table public.room_halba_group enable row level security;
revoke all on public.room_halba_group from anon, authenticated;

-- أدوات ---------------------------------------------------------------------------

-- Is one text one edit away from another (a letter added, removed or changed)?
create or replace function public.halba_edit1(a text, b text)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  la int := char_length(a);
  lb int := char_length(b);
  i int := 1;
  j int := 1;
  diff int := 0;
begin
  if a = b then
    return true;
  end if;
  if abs(la - lb) > 1 or least(la, lb) < 3 then
    return false;
  end if;
  while i <= la and j <= lb loop
    if substr(a, i, 1) = substr(b, j, 1) then
      i := i + 1;
      j := j + 1;
    else
      diff := diff + 1;
      if diff > 1 then
        return false;
      end if;
      if la > lb then
        i := i + 1;
      elsif lb > la then
        j := j + 1;
      else
        i := i + 1;
        j := j + 1;
      end if;
    end if;
  end loop;
  return diff + (la - i + 1) + (lb - j + 1) <= 1;
end;
$$;

-- Close to one of the listed answers (both already normalized with halba_norm)?
create or replace function public.halba_near(p_norm text, p_list text[])
returns boolean language sql immutable set search_path = public as $$
  select exists (
    select 1 from unnest(coalesce(p_list, '{}')) x
     where public.halba_edit1(p_norm, x)
        or (char_length(p_norm) >= 4 and char_length(x) >= 4 and (strpos(x, p_norm) > 0 or strpos(p_norm, x) > 0)));
$$;

drop function if exists public.halba_pick_topic(jsonb);
drop function if exists public.halba_start_round(uuid, text, int, boolean, int, text[], text, int, int);

create or replace function public.halba_add(p_room_id uuid, p_sd jsonb, p_side text, p_delta int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_side is null or p_delta = 0 then
    return p_sd;
  end if;
  if p_sd->>'mode' = 'teams' then
    return p_sd || jsonb_build_object('team_scores', coalesce(p_sd->'team_scores', '{}'::jsonb)
      || jsonb_build_object(p_side, coalesce((p_sd->'team_scores'->>p_side)::int, 0) + p_delta));
  end if;
  perform set_config('alosh.trusted', 'on', true);
  update public.room_players set score = score + p_delta where id::text = p_side and room_id = p_room_id;
  perform set_config('alosh.trusted', '', true);
  return p_sd;
end;
$$;

create or replace function public.halba_pick_topic(p_sd jsonb, p_need_list boolean default false)
returns public.alhalba_topics language plpgsql stable security definer set search_path = public as $$
declare
  v_topic public.alhalba_topics%rowtype;
  v_cats jsonb := p_sd->'categories';
  v_levels jsonb := p_sd->'levels';
  v_used jsonb := coalesce(p_sd->'used_topics', '[]'::jsonb);
  v_lists boolean := coalesce(p_sd->>'judge', 'both') <> 'manual';
begin
  select * into v_topic from public.alhalba_topics t
   where (jsonb_typeof(v_cats) is distinct from 'array' or jsonb_array_length(v_cats) = 0 or v_cats @> to_jsonb(coalesce(t.category, 'عام')))
     and (jsonb_typeof(v_levels) is distinct from 'array' or jsonb_array_length(v_levels) = 0 or v_levels @> to_jsonb(coalesce(t.difficulty, 2)))
     and (not p_need_list or (cardinality(t.answers) >= 10 and not t.open_ended))
     and not (v_used @> to_jsonb(t.id::text))
   order by (v_lists and cardinality(t.answers) > 0) desc, random() limit 1;
  if not found then
    select * into v_topic from public.alhalba_topics t
     where (jsonb_typeof(v_cats) is distinct from 'array' or jsonb_array_length(v_cats) = 0 or v_cats @> to_jsonb(coalesce(t.category, 'عام')))
       and (jsonb_typeof(v_levels) is distinct from 'array' or jsonb_array_length(v_levels) = 0 or v_levels @> to_jsonb(coalesce(t.difficulty, 2)))
       and (not p_need_list or (cardinality(t.answers) >= 10 and not t.open_ended))
     order by random() limit 1;
  end if;
  return v_topic;
end;
$$;

create or replace function public.halba_round_fields(p_sd jsonb, p_topic public.alhalba_topics)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.halba_bid_fields(p_topic) || jsonb_build_object('checking', false, 'result_at', null, 'group_result', null, 'group_ends_at', null, 'group_counts', '{}'::jsonb, 'topic_open', p_topic.open_ended);
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

-- الجولة (داخلي): مثل v5 بلا فحص المضيف، ومعها إعدادات v6 والجولة الجماعية.
create or replace function public.halba_round_core(
  p_room_id uuid, p_mode text default null, p_rounds int default null,
  p_host_plays boolean default true, p_lives int default 2, p_categories text[] default null,
  p_judge text default null, p_answer_seconds int default null, p_bid_seconds int default null,
  p_extra jsonb default null)
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
  v_group boolean := false;
  v_levels jsonb;
begin
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
      -- v6: answer pace (seconds per answer), how the winner is chosen, the automatic next
      -- round, a group round every N rounds, and topic levels (1 easy, 2 medium, 3 hard).
      'pace', case when coalesce((p_extra->>'pace')::int, 0) between 3 and 12 then (p_extra->>'pace')::int else 6 end,
      'win_rule', case when p_extra->>'win_rule' = 'last' then 'last' else 'score' end,
      'auto_next', coalesce((p_extra->>'auto_next')::boolean, true),
      'group_every', case when coalesce((p_extra->>'group_every')::int, 0) between 2 and 10 then (p_extra->>'group_every')::int else 0 end,
      'levels', case when jsonb_typeof(p_extra->'levels') = 'array' and jsonb_array_length(p_extra->'levels') between 1 and 2 then p_extra->'levels' else null end,
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

  -- A group round every N rounds: everyone types at once, on a topic with a long answer list.
  if coalesce((v_sd->>'group_every')::int, 0) > 0 and v_round % (v_sd->>'group_every')::int = 0 then
    v_topic := public.halba_pick_topic(v_sd, true);
    v_group := v_topic.id is not null;
  end if;
  if v_group then
    delete from public.room_halba_group where room_id = p_room_id;
    update public.room_game_state
      set active_question_id = null,
          state_data = v_sd || public.halba_round_fields(v_sd, v_topic) || jsonb_build_object(
            'phase', 'group', 'round', v_round, 'duel', null, 'bid_ends_at', null,
            'group_ends_at', to_jsonb(now() + interval '60 seconds'),
            'used_topics', coalesce(v_sd->'used_topics', '[]'::jsonb) || to_jsonb(v_topic.id::text))
      where room_id = p_room_id;
    return jsonb_build_object('ok', true, 'round', v_round, 'group', true);
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
  v_sd := v_sd || jsonb_build_object('fighters', v_fighters, 'phase', case when v_over then 'over' else 'result' end,
                                     'result_at', to_jsonb(now()));
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'over', v_over);
end;
$$;

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

create or replace function public.halba_begin_prove(p_room_id uuid, v_sd jsonb, p_challenger uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cname text;
  v_secs int;
begin
  -- Time to type: fixed by the host, or 10 seconds + the pace (6 by default) for each answer of the bid.
  v_secs := case when coalesce((v_sd->>'answer_seconds')::int, 0) > 0 then (v_sd->>'answer_seconds')::int
                 else least(180, 10 + coalesce((v_sd->>'pace')::int, 6) * coalesce((v_sd->>'bid')::int, 1)) end;
  v_sd := jsonb_set(v_sd, '{topic,seconds}', to_jsonb(v_secs));
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

create or replace function public.halba_check(p_room_id uuid, p_sd jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sd jsonb := p_sd;
  v_answers jsonb := coalesce(p_sd->'answers', '[]'::jsonb);
  v_judge text := coalesce(p_sd->>'judge', 'both');
  v_list text[];
  v_has_list boolean;
  v_open boolean := coalesce((p_sd->>'topic_open')::boolean, false);
  v_near boolean;
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
      -- Close to a listed answer (a letter more or less, or one inside the other): the judge decides.
      v_near := not v_match and v_judge <> 'manual' and public.halba_near(v_answers->i->>'norm', v_list);
      v_status := case when v_match then 'ok'
                       when v_judge = 'auto' and v_has_list and not v_near and not v_open then 'no'
                       else 'pending' end;
      v_answers := jsonb_set(v_answers, array[i::text], (v_answers->i) || jsonb_build_object('status', v_status, 'auto', v_match, 'near', v_near));
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
        'prove_ends_at', to_jsonb(now() + make_interval(secs =>
          case when coalesce((v_sd->>'answer_seconds')::int, 0) > 0 then greatest(15, (v_sd->>'answer_seconds')::int / 2)
               else least(120, greatest(15, 8 + coalesce((v_sd->>'pace')::int, 6)
                                           * (coalesce((v_sd->>'bid')::int, 1) - coalesce((v_sd->>'count')::int, 0)))) end)))
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
    if v_need > coalesce((v_sd->'stats'->'steal'->>'need')::int, 0) then
      v_sd := jsonb_set(v_sd, '{stats,steal}', jsonb_build_object('name', v_sd->>'challenger_name', 'need', v_need), true);
    end if;
  end if;
  v_sd := v_sd || jsonb_build_object('steal_result', jsonb_build_object(
    'success', v_ok, 'name', v_sd->>'challenger_name', 'need', v_need, 'count', v_count, 'points', v_points));
  return public.halba_after_round(p_room_id, v_sd) || jsonb_build_object('success', v_ok);
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
  if p_amount is null or p_amount <= coalesce((v_sd->>'bid')::int, 0) then
    return jsonb_build_object('ok', false, 'reason', 'BID_TOO_LOW');
  end if;
  if p_amount > 15 then
    return jsonb_build_object('ok', false, 'reason', 'BID_TOO_HIGH');
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
  -- During bidding: those outside the ring. Once the proof starts: everyone but the
  -- answering side and the challenger's side.
  if (v_sd->>'phase' = 'bid' and public.halba_can_fight2(v_sd, v_me))
     or (v_sd->>'phase' = 'prove' and (public.halba_side(v_sd, v_me) is not distinct from v_sd->>'performer_side'
                                     or public.halba_side(v_sd, v_me) is not distinct from v_sd->>'challenger_side')) then
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
  delete from public.room_halba_group where room_id = p_room_id;
  update public.room_players set score = 0, team_color = null where room_id = p_room_id;
  update public.room_game_state set active_question_id = null, state_data = '{}'::jsonb where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;


-- يبدأ جولة (للمضيف).
create or replace function public.halba_start_round(
  p_room_id uuid, p_mode text default null, p_rounds int default null,
  p_host_plays boolean default true, p_lives int default 2, p_categories text[] default null,
  p_judge text default null, p_answer_seconds int default null, p_bid_seconds int default null,
  p_extra jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  return public.halba_round_core(p_room_id, p_mode, p_rounds, p_host_plays, p_lives, p_categories,
                                 p_judge, p_answer_seconds, p_bid_seconds, p_extra);
end;
$$;

-- الجولة التالية تلقائيًا: 8 ثوانٍ بعد النتيجة، من أي جهاز في الغرفة (إن لم يوقفها المضيف).
create or replace function public.halba_auto_next(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sd jsonb;
begin
  if not (public.is_room_host(p_room_id) or public.my_player_id(p_room_id) is not null) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id;
  if v_sd->>'phase' is distinct from 'result' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if not coalesce((v_sd->>'auto_next')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'PAUSED');
  end if;
  if now() < coalesce((v_sd->>'result_at')::timestamptz, now()) + interval '8 seconds' - interval '1 second' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_YET');
  end if;
  return public.halba_round_core(p_room_id);
end;
$$;

-- يوقف المضيف الانتقال التلقائي أو يعيده.
create or replace function public.halba_set_auto(p_room_id uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    raise exception 'HOST_ONLY';
  end if;
  update public.room_game_state
     set state_data = state_data || jsonb_build_object('auto_next', coalesce(p_on, false),
                                                       'result_at', case when coalesce(p_on, false) then to_jsonb(now()) else state_data->'result_at' end)
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- الجولة الجماعية -------------------------------------------------------------------

-- Who takes part in a group round, and for which side: everyone who plays the match
-- (the knocked-out too), never a host who only judges.
create or replace function public.halba_group_side(p_room_id uuid, p_sd jsonb, p_pid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_pid is null then null
    when exists (select 1 from public.room_players p where p.id = p_pid and p.room_id = p_room_id
                    and p.is_host and not coalesce((p_sd->>'host_plays')::boolean, false)) then null
    when p_sd->>'mode' = 'teams' then p_sd->'teams'->>(p_pid::text)
    else p_pid::text
  end;
$$;

create or replace function public.halba_group_answer(p_room_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sd jsonb;
  v_me uuid := public.my_player_id(p_room_id);
  v_side text;
  v_text text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  v_norm text;
  v_n int;
begin
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'phase' is distinct from 'group' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_side := public.halba_group_side(p_room_id, v_sd, v_me);
  if v_side is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  if now() > (v_sd->>'group_ends_at')::timestamptz + interval '1 second' then
    return jsonb_build_object('ok', false, 'reason', 'TIME_UP');
  end if;
  if char_length(v_text) = 0 or char_length(v_text) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'BAD_ANSWER');
  end if;
  v_norm := public.halba_norm(v_text);
  -- One list per side: a teammate's answer counts once.
  if exists (select 1 from public.room_halba_group g where g.room_id = p_room_id and g.side = v_side and g.norm = v_norm) then
    return jsonb_build_object('ok', false, 'reason', 'DUPLICATE');
  end if;
  select count(*) into v_n from public.room_halba_group g where g.room_id = p_room_id and g.player_id = v_me;
  if v_n >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY');
  end if;
  insert into public.room_halba_group (room_id, player_id, side, text, norm) values (p_room_id, v_me, v_side, v_text, v_norm);
  -- Everyone sees how many answers each player wrote, not what.
  update public.room_game_state
     set state_data = state_data || jsonb_build_object('group_counts',
           coalesce(state_data->'group_counts', '{}'::jsonb) || jsonb_build_object(v_me::text, v_n + 1))
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- My own answers in the group round (hidden from the others until the end).
create or replace function public.halba_group_mine(p_room_id uuid)
returns table (text text)
language sql stable security definer set search_path = public as $$
  select g.text from public.room_halba_group g
   where g.room_id = p_room_id and g.player_id = public.my_player_id(p_room_id)
   order by g.created_at;
$$;

-- Ends the group round: answers on the topic's list (or one letter away) are correct;
-- a correct answer no other side wrote gives 100 points.
create or replace function public.halba_group_finish(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sd jsonb;
  v_list text[];
  v_rows jsonb;
  r record;
begin
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'phase' is distinct from 'group' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if not (public.is_room_host(p_room_id) or public.is_app_admin()
          or (public.my_player_id(p_room_id) is not null and now() >= (v_sd->>'group_ends_at')::timestamptz + interval '2 seconds')) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_YET');
  end if;
  select coalesce(array_agg(public.halba_norm(a)), '{}') into v_list
    from public.alhalba_topics t, unnest(t.answers) a where t.id::text = v_sd->'topic'->>'id';

  -- Each answer: correct? written by only this side?
  with a as (
    select g.side, g.player_id, g.text, g.norm, g.created_at,
           (g.norm = any(v_list) or public.halba_near(g.norm, v_list)) as valid
      from public.room_halba_group g where g.room_id = p_room_id
  ), c as (
    -- Near answers count as the listed answer they are close to, for uniqueness too.
    select a.*, coalesce((select x from unnest(v_list) x where x = a.norm limit 1),
                         (select x from unnest(v_list) x where public.halba_edit1(a.norm, x)
                             or (char_length(a.norm) >= 4 and char_length(x) >= 4 and (strpos(x, a.norm) > 0 or strpos(a.norm, x) > 0)) limit 1),
                         a.norm) as canon
      from a
  ), u as (
    select c.*, (select count(distinct c2.side) from c c2 where c2.canon = c.canon and c2.valid) = 1 as unique_one from c
  )
  select coalesce(jsonb_agg(jsonb_build_object('side', s.side, 'points', s.points, 'answers', s.answers) order by s.points desc, s.side), '[]'::jsonb)
    into v_rows
    from (
      select u.side,
             100 * count(*) filter (where u.valid and u.unique_one) as points,
             jsonb_agg(jsonb_build_object('text', u.text, 'valid', u.valid, 'unique', u.valid and u.unique_one) order by u.created_at) as answers
        from u group by u.side
    ) s;

  for r in select x->>'side' as side, (x->>'points')::int as points from jsonb_array_elements(v_rows) x loop
    if r.points > 0 then
      v_sd := public.halba_add(p_room_id, v_sd, r.side, r.points);
    end if;
  end loop;
  if jsonb_array_length(v_rows) > 0 and (v_rows->0->>'points')::int > coalesce((v_sd->'stats'->'group'->>'points')::int, 0) then
    v_sd := jsonb_set(v_sd, '{stats,group}', jsonb_build_object('side', v_rows->0->>'side', 'points', (v_rows->0->>'points')::int), true);
  end if;
  v_sd := v_sd || jsonb_build_object('group_result', v_rows, 'result', null, 'steal_result', null);
  return public.halba_after_round(p_room_id, v_sd);
end;
$$;

-- الصلاحيات -------------------------------------------------------------------------

revoke all on function
  public.halba_round_core(uuid, text, int, boolean, int, text[], text, int, int, jsonb),
  public.halba_pick_topic(jsonb, boolean), public.halba_round_fields(jsonb, public.alhalba_topics),
  public.halba_add(uuid, jsonb, text, int), public.halba_after_round(uuid, jsonb),
  public.halba_begin_prove(uuid, jsonb, uuid), public.halba_check(uuid, jsonb),
  public.halba_resolve_steal(uuid, jsonb), public.halba_group_side(uuid, jsonb, uuid)
from public, anon, authenticated;

revoke all on function
  public.halba_start_round(uuid, text, int, boolean, int, text[], text, int, int, jsonb),
  public.halba_auto_next(uuid), public.halba_set_auto(uuid, boolean),
  public.halba_group_answer(uuid, text), public.halba_group_mine(uuid), public.halba_group_finish(uuid),
  public.halba_bid(uuid, int), public.halba_predict(uuid, boolean), public.halba_swap(uuid),
  public.halba_steal(uuid, boolean), public.halba_reset(uuid)
from public, anon;
grant execute on function
  public.halba_start_round(uuid, text, int, boolean, int, text[], text, int, int, jsonb),
  public.halba_auto_next(uuid), public.halba_set_auto(uuid, boolean),
  public.halba_group_answer(uuid, text), public.halba_group_mine(uuid), public.halba_group_finish(uuid),
  public.halba_bid(uuid, int), public.halba_predict(uuid, boolean), public.halba_swap(uuid),
  public.halba_steal(uuid, boolean), public.halba_reset(uuid)
to authenticated;

notify pgrst, 'reload schema';
