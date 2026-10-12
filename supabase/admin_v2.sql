-- =============================================================================
-- لوحة الإدارة، الإصدار 2. يُشغَّل بعد admin_panel.sql و alhalba_v4.sql،
-- وتشغيله مرة ثانية آمن.
--
--   1) admin_stats(): إحصاءات اللوحة (الغرف واللاعبون حسب اليوم واللعبة والساعة،
--      وحجم المحتوى). تُحسب من الغرف الموجودة في القاعدة، للمدير فقط.
--   2) إجابات مرجعية لمواضيع «الحلبة»: الإجابة المكتوبة التي تطابق إحداها تُقبل
--      تلقائيًا، ويبقى الحَكَم لما ليس في القائمة. القائمة لا تصل للاعبين أبدًا:
--      جدول المواضيع يقرأه المدير ودوال الخادم فقط.
-- =============================================================================

-- 1) الإحصاءات ------------------------------------------------------------------

create or replace function public.admin_stats(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days int := greatest(1, least(coalesce(p_days, 30), 365));
  v_from timestamptz;
  v_tz text := 'Asia/Riyadh';
  v_out jsonb;
begin
  if not public.is_app_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  v_from := (date_trunc('day', now() at time zone v_tz) - make_interval(days => v_days - 1)) at time zone v_tz;

  with r as (
    select g.id, g.game_id, g.status, g.created_at,
           (g.created_at at time zone v_tz) as local_at,
           (select count(*) from public.room_players p where p.room_id = g.id and not p.is_host) as guests,
           (select count(*) from public.room_players p where p.room_id = g.id) as people
      from public.game_rooms g
     where g.created_at >= v_from
  ),
  days as (
    select d::date as day from generate_series((v_from at time zone v_tz)::date, (now() at time zone v_tz)::date, interval '1 day') d
  )
  select jsonb_build_object(
    'days', v_days,
    'totals', (select jsonb_build_object(
        'rooms', count(*),
        'played', count(*) filter (where status in ('playing', 'finished')),
        'finished', count(*) filter (where status = 'finished'),
        'people', coalesce(sum(people), 0),
        'avg_people', coalesce(round(avg(people) filter (where people > 0), 1), 0)
      ) from r),
    'now', (select jsonb_build_object(
        'lobby', count(*) filter (where status = 'lobby'),
        'playing', count(*) filter (where status = 'playing'),
        'people', coalesce(sum((select count(*) from public.room_players p where p.room_id = g.id)), 0)
      ) from public.game_rooms g where g.status in ('lobby', 'playing') and g.created_at > now() - interval '12 hours'),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object(
        'day', to_char(d.day, 'YYYY-MM-DD'),
        'rooms', (select count(*) from r where r.local_at::date = d.day),
        'people', (select coalesce(sum(people), 0) from r where r.local_at::date = d.day)
      ) order by d.day), '[]'::jsonb) from days d),
    'by_game', (select coalesce(jsonb_agg(x order by (x->>'rooms')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('slug', ga.slug, 'title', ga.title_ar, 'active', ga.is_active,
               'rooms', count(r.id), 'people', coalesce(sum(r.people), 0)) as x
          from public.games ga left join r on r.game_id = ga.id
         group by ga.id) s),
    'by_hour', (select coalesce(jsonb_agg(jsonb_build_object('hour', h,
        'rooms', (select count(*) from r where extract(hour from r.local_at) = h)) order by h), '[]'::jsonb)
        from generate_series(0, 23) h),
    'content', jsonb_build_object(
        'questions', (select coalesce(jsonb_object_agg(game_slug, n), '{}'::jsonb) from (select game_slug, count(*) n from public.questions_bank group by 1) q),
        'heads_words', (select count(*) from public.heads_words),
        'outsider_topics', (select count(*) from public.outsider_topics),
        'halba_topics', (select count(*) from public.alhalba_topics),
        'halba_with_answers', (select count(*) from public.alhalba_topics where cardinality(answers) > 0))
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.admin_stats(int) from public, anon;
grant execute on function public.admin_stats(int) to authenticated;

-- 2) إجابات «الحلبة» المرجعية ----------------------------------------------------

alter table public.alhalba_topics add column if not exists answers text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alhalba_topics_answers_size') then
    alter table public.alhalba_topics add constraint alhalba_topics_answers_size check (cardinality(answers) <= 400);
  end if;
end $$;
comment on column public.alhalba_topics.answers is 'إجابات مقبولة تلقائيًا. لا تُعرض للاعبين.';

-- Same as v4, plus: an answer matching the topic's list is accepted at once.
create or replace function public.halba_answer(p_room_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state public.room_game_state%rowtype;
  v_sd jsonb;
  v_me text := public.my_player_id(p_room_id)::text;
  v_text text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  v_norm text;
  v_answers jsonb;
  v_auto boolean;
  v_count int;
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
  v_norm := public.halba_norm(v_text);
  v_answers := coalesce(v_sd->'answers', '[]'::jsonb);
  if jsonb_array_length(v_answers) >= 60 then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY');
  end if;
  if exists (select 1 from jsonb_array_elements(v_answers) a where a->>'norm' = v_norm and a->>'status' <> 'no') then
    return jsonb_build_object('ok', false, 'reason', 'DUPLICATE');
  end if;
  v_auto := exists (
    select 1 from public.alhalba_topics t, unnest(t.answers) a
     where t.id::text = v_sd->'topic'->>'id' and public.halba_norm(a) = v_norm);
  v_answers := v_answers || jsonb_build_array(jsonb_build_object(
    'n', jsonb_array_length(v_answers), 'text', v_text, 'norm', v_norm,
    'status', case when v_auto then 'ok' else 'pending' end, 'auto', v_auto,
    'by', v_me, 'steal', v_sd->>'phase' = 'steal'));
  v_count := coalesce((v_sd->>'count')::int, 0) + case when v_auto then 1 else 0 end;
  v_sd := v_sd || jsonb_build_object('answers', v_answers, 'count', v_count);
  if v_auto and v_count >= public.halba_goal(v_sd) then
    perform public.halba_end_answers(p_room_id, v_sd);
    return jsonb_build_object('ok', true, 'auto', true, 'done', true);
  end if;
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'auto', v_auto);
end;
$$;

revoke all on function public.halba_answer(uuid, text) from public, anon;
grant execute on function public.halba_answer(uuid, text) to authenticated;

notify pgrst, 'reload schema';
