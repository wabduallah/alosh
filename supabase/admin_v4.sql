-- =============================================================================
-- لوحة الإدارة، الإصدار 4. يُشغَّل بعد admin_v3.sql و polish_v1.sql، وتشغيله مرة ثانية آمن.
--
-- 1) أرقام صادقة: أجهزة التجربة، واستبعاد غرف التجربة (أقل من 3 أشخاص أو من جهاز تجربة)،
--    و«مجموعات لعبت فعلًا» مع المقارنة بالمدة السابقة، و«مضيفون رجعوا».
-- 2) صلاحيات: لا يقرأ الزوار الإجابات المزيفة الجاهزة، ولا كتابة عبر عرض الأسئلة،
--    ولا «تفريغ الجداول» لأي مستخدم.
-- 3) صحة المحتوى: شبكة تحديات العش، توزيع الصعوبة، مواضيع الحلبة الناقصة، والمكررات.
-- 4) الرسائل: بلاغات واقتراحات اللاعبين.
-- 5) لعبة جديدة: بيانات اللعبة كاملة (أيقونة، تصنيف، قواعد) وطلب تطوير للمدير.
-- =============================================================================

-- 1) أجهزة التجربة ------------------------------------------------------------------

-- مضيفون (أجهزة) يعلّمهم المدير «تجربة»: غرفهم لا تُحسب عند الاستبعاد.
create table if not exists public.admin_test_hosts (
  user_id    uuid primary key,
  label      text,
  created_at timestamptz not null default now()
);
alter table public.admin_test_hosts enable row level security;
revoke all on public.admin_test_hosts from anon;
grant select, insert, update, delete on public.admin_test_hosts to authenticated;
drop policy if exists "test hosts: admin manage" on public.admin_test_hosts;
create policy "test hosts: admin manage" on public.admin_test_hosts
  for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());

-- A room counts as real: 3 people or more, and not hosted from a test device or an admin account.
create or replace function public.admin_room_is_real(p_room_id uuid, p_host uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.room_players p where p.room_id = p_room_id) >= 3
     and not exists (select 1 from public.admin_test_hosts t where t.user_id = p_host)
     and not exists (select 1 from auth.users u where u.id = p_host and u.raw_app_meta_data->>'role' = 'admin');
$$;
revoke all on function public.admin_room_is_real(uuid, uuid) from public, anon, authenticated;

drop function if exists public.admin_stats(int);
create or replace function public.admin_stats(p_days int default 30, p_exclude boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days int := greatest(1, least(coalesce(p_days, 30), 365));
  v_from timestamptz;
  v_prev timestamptz;
  v_tz text := 'Asia/Riyadh';
  v_out jsonb;
begin
  if not public.is_app_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  v_from := (date_trunc('day', now() at time zone v_tz) - make_interval(days => v_days - 1)) at time zone v_tz;
  v_prev := v_from - make_interval(days => v_days);

  with r_all as (
    select g.id, g.game_id, g.status, g.created_at, g.host_id, g.started_at,
           (g.created_at at time zone v_tz) as local_at,
           (select count(*) from public.room_players p where p.room_id = g.id) as people,
           public.admin_room_is_real(g.id, g.host_id) as real
      from public.game_rooms g
     where g.created_at >= v_prev
  ),
  r as (
    select * from r_all where created_at >= v_from and (not p_exclude or real)
  ),
  -- «مجموعات لعبت فعلًا»: 3 أشخاص أو أكثر، بدأت اللعبة، ومن غير أجهزة التجربة.
  groups as (
    select * from r_all where real and (started_at is not null or status in ('playing', 'finished'))
  ),
  hosts as (
    select host_id, min(created_at) as first_at from public.game_rooms g
     where public.admin_room_is_real(g.id, g.host_id) and (g.started_at is not null or g.status in ('playing', 'finished'))
     group by host_id
  ),
  days as (
    select d::date as day from generate_series((v_from at time zone v_tz)::date, (now() at time zone v_tz)::date, interval '1 day') d
  )
  select jsonb_build_object(
    'days', v_days,
    'excluded', coalesce(p_exclude, false),
    'test_hosts', (select count(*) from public.admin_test_hosts),
    'totals', (select jsonb_build_object(
        'rooms', count(*),
        'played', count(*) filter (where status in ('playing', 'finished')),
        'finished', count(*) filter (where status = 'finished'),
        'people', coalesce(sum(people), 0),
        'avg_people', coalesce(round(avg(people) filter (where people > 0), 1), 0),
        'test_rooms', (select count(*) from r_all where created_at >= v_from and not real)
      ) from r),
    'groups', jsonb_build_object(
        'now', (select count(*) from groups where created_at >= v_from),
        'before', (select count(*) from groups where created_at < v_from),
        'people', (select coalesce(round(avg(people), 1), 0) from groups where created_at >= v_from)),
    -- Hosts of real groups in this period, and those who had one before (they came back).
    'hosts', jsonb_build_object(
        'active', (select count(distinct host_id) from groups where created_at >= v_from),
        'returning', (select count(distinct g.host_id) from groups g join hosts h on h.host_id = g.host_id
                       where g.created_at >= v_from
                         and exists (select 1 from public.game_rooms o
                                      where o.host_id = g.host_id and o.created_at < g.created_at - interval '6 hours'
                                        and public.admin_room_is_real(o.id, o.host_id)
                                        and (o.started_at is not null or o.status in ('playing', 'finished')))),
        'ever', (select count(*) from hosts)),
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
               'rooms', count(r.id), 'people', coalesce(sum(r.people), 0),
               'groups', (select count(*) from groups gr where gr.game_id = ga.id and gr.created_at >= v_from)) as x
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
revoke all on function public.admin_stats(int, boolean) from public, anon;
grant execute on function public.admin_stats(int, boolean) to authenticated;

drop function if exists public.admin_funnel(int);
create or replace function public.admin_funnel(p_days int default 30, p_exclude boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_days int := greatest(1, least(coalesce(p_days, 30), 365));
  v_tz text := 'Asia/Riyadh';
  v_from timestamptz;
  v_out jsonb;
begin
  if not public.is_app_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  perform public.expire_stale_rooms();
  v_from := greatest(
    (date_trunc('day', now() at time zone v_tz) - make_interval(days => v_days - 1)) at time zone v_tz,
    public.funnel_since());

  with r as (
    select g.id, g.game_id, g.started_at, g.ended_at,
           (select count(*) from public.room_players p where p.room_id = g.id) as people,
           (select count(*) from public.room_players p where p.room_id = g.id and not p.is_host) as guests
      from public.game_rooms g
     where g.created_at >= v_from
       and (not coalesce(p_exclude, false) or public.admin_room_is_real(g.id, g.host_id))
  ),
  per as (
    select ga.slug, ga.title_ar as title,
           count(r.id) as opened,
           count(r.id) filter (where r.guests > 0) as joined,
           count(r.id) filter (where r.started_at is not null) as started,
           count(r.id) filter (where r.started_at is not null and r.ended_at is not null) as finished,
           round(avg(r.people) filter (where r.started_at is not null), 1) as avg_people,
           round(avg(extract(epoch from (r.ended_at - r.started_at)) / 60.0)
                 filter (where r.started_at is not null and r.ended_at is not null)) as avg_minutes
      from public.games ga left join r on r.game_id = ga.id
     group by ga.id
  )
  select jsonb_build_object(
    'since', v_from,
    'tracking_from', public.funnel_since(),
    'totals', (select jsonb_build_object(
        'opened', coalesce(sum(opened), 0), 'joined', coalesce(sum(joined), 0),
        'started', coalesce(sum(started), 0), 'finished', coalesce(sum(finished), 0),
        'avg_people', (select round(avg(people) filter (where started_at is not null), 1) from r),
        'avg_minutes', (select round(avg(extract(epoch from (ended_at - started_at)) / 60.0)
                                     filter (where started_at is not null and ended_at is not null)) from r))
      from per),
    'by_game', (select coalesce(jsonb_agg(to_jsonb(per) order by per.opened desc, per.slug), '[]'::jsonb) from per where per.opened > 0)
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.admin_funnel(int, boolean) from public, anon;
grant execute on function public.admin_funnel(int, boolean) to authenticated;

-- 2) الصلاحيات ----------------------------------------------------------------------

-- الإجابات المزيفة الجاهزة لـ«سيد الخداع» يقرؤها الخادم فقط (bluff_open_vote).
revoke select on public.questions_public from anon, authenticated;
grant select (id, game_slug, category_ar, question_text, media_url, options, points, difficulty, created_at)
  on public.questions_public to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.questions_public from anon, authenticated;
revoke select on public.questions_bank from anon, authenticated;
grant select (id, game_slug, category_ar, question_text, media_url, options, points, difficulty, created_at)
  on public.questions_bank to anon, authenticated;

-- لا «تفريغ» لأي جدول من حسابات الزوار واللاعبين (القواعد لا تنطبق على التفريغ).
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate on public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;

-- 3) صحة المحتوى -----------------------------------------------------------------------

create or replace function public.admin_norm(p text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(public.halba_norm(coalesce(p, '')), '[[:punct:]؟،؛«»"'']', '', 'g');
$$;

create or replace function public.admin_content_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  return jsonb_build_object(
    -- «تحديات العش»: كل فئة تحتاج سؤالين على الأقل من كل مستوى لتظهر للمضيف.
    'grid', (select coalesce(jsonb_agg(jsonb_build_object('category', c, 'easy', e, 'medium', m, 'hard', h) order by c), '[]'::jsonb)
               from (select category_ar c,
                            count(*) filter (where difficulty = 'easy') e,
                            count(*) filter (where difficulty = 'medium') m,
                            count(*) filter (where difficulty = 'hard') h
                       from public.questions_bank where game_slug = 'tactical-grid' group by 1) x),
    -- توزيع الصعوبة لكل لعبة أسئلة.
    'difficulty', (select coalesce(jsonb_agg(jsonb_build_object('game', game_slug, 'easy', e, 'medium', m, 'hard', h, 'total', e + m + h) order by game_slug), '[]'::jsonb)
               from (select game_slug,
                            count(*) filter (where difficulty = 'easy') e,
                            count(*) filter (where difficulty = 'medium') m,
                            count(*) filter (where difficulty = 'hard') h
                       from public.questions_bank group by 1) x),
    'halba', jsonb_build_object(
        'total', (select count(*) from public.alhalba_topics),
        'no_answers', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'topic', topic_ar) order by topic_ar), '[]'::jsonb)
                         from public.alhalba_topics where cardinality(answers) = 0),
        'no_level', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'topic', topic_ar) order by topic_ar), '[]'::jsonb)
                       from public.alhalba_topics where difficulty is null),
        'short', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'topic', topic_ar, 'answers', cardinality(answers), 'min', min_answers) order by topic_ar), '[]'::jsonb)
                    from public.alhalba_topics where cardinality(answers) > 0 and cardinality(answers) < min_answers * 2),
        'levels', (select jsonb_build_object('easy', count(*) filter (where difficulty = 1), 'medium', count(*) filter (where difficulty = 2),
                                             'hard', count(*) filter (where difficulty = 3), 'open', count(*) filter (where open_ended))
                     from public.alhalba_topics)),
    -- المكررات بعد توحيد الكتابة (الهمزات والتشكيل و«ال» والمسافات وعلامات الترقيم).
    'duplicates', jsonb_build_object(
        'questions', (select coalesce(jsonb_agg(jsonb_build_object('game', game_slug, 'text', t, 'count', n, 'ids', ids)), '[]'::jsonb)
                        from (select game_slug, min(question_text) t, count(*) n, jsonb_agg(id) ids
                                from public.questions_bank group by game_slug, public.admin_norm(question_text) having count(*) > 1) d),
        'halba', (select coalesce(jsonb_agg(jsonb_build_object('text', t, 'count', n, 'ids', ids)), '[]'::jsonb)
                    from (select min(topic_ar) t, count(*) n, jsonb_agg(id) ids
                            from public.alhalba_topics group by public.admin_norm(topic_ar) having count(*) > 1) d),
        'heads', (select coalesce(jsonb_agg(jsonb_build_object('text', t, 'count', n, 'ids', ids)), '[]'::jsonb)
                    from (select min(word) t, count(*) n, jsonb_agg(id) ids
                            from public.heads_words group by public.admin_norm(word) having count(*) > 1) d),
        'outsider', (select coalesce(jsonb_agg(jsonb_build_object('text', t, 'count', n, 'ids', ids)), '[]'::jsonb)
                       from (select min(title_ar) t, count(*) n, jsonb_agg(id) ids
                               from public.outsider_topics group by public.admin_norm(title_ar) having count(*) > 1) d))
  );
end;
$$;
revoke all on function public.admin_content_health() from public, anon;
grant execute on function public.admin_content_health() to authenticated;

-- 4) الرسائل: بلاغات واقتراحات اللاعبين -----------------------------------------------------

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id    uuid,
  game_slug  text,
  room_code  text,
  kind       text not null default 'problem' check (kind in ('problem', 'idea', 'other')),
  message    text not null check (char_length(btrim(message)) between 3 and 1000),
  contact    text check (contact is null or char_length(contact) <= 100),
  page       text check (page is null or char_length(page) <= 200),
  status     text not null default 'new' check (status in ('new', 'read', 'done'))
);
create index if not exists feedback_created_idx on public.feedback (created_at desc);
create index if not exists feedback_user_idx on public.feedback (user_id, created_at desc);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon;
grant select, update, delete on public.feedback to authenticated;
drop policy if exists "feedback: admin read" on public.feedback;
create policy "feedback: admin read" on public.feedback for select to authenticated using (public.is_app_admin());
drop policy if exists "feedback: admin update" on public.feedback;
create policy "feedback: admin update" on public.feedback for update to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
drop policy if exists "feedback: admin delete" on public.feedback;
create policy "feedback: admin delete" on public.feedback for delete to authenticated using (public.is_app_admin());

-- Any player sends a message (5 an hour at most). The game comes from the room code.
create or replace function public.submit_feedback(p_kind text, p_message text, p_room_code text default null, p_contact text default null, p_page text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_text text := btrim(coalesce(p_message, ''));
  v_code text := upper(btrim(coalesce(p_room_code, '')));
  v_slug text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_SESSION');
  end if;
  if char_length(v_text) < 3 or char_length(v_text) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'BAD_MESSAGE');
  end if;
  if (select count(*) from public.feedback f where f.user_id = v_uid and f.created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY');
  end if;
  if v_code <> '' then
    select ga.slug into v_slug from public.game_rooms r join public.games ga on ga.id = r.game_id where r.room_code = v_code limit 1;
  end if;
  insert into public.feedback (user_id, game_slug, room_code, kind, message, contact, page)
  values (v_uid, v_slug, nullif(v_code, ''), case when p_kind in ('problem', 'idea', 'other') then p_kind else 'other' end,
          v_text, nullif(left(btrim(coalesce(p_contact, '')), 100), ''), nullif(left(coalesce(p_page, ''), 200), ''));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.submit_feedback(text, text, text, text, text) from public, anon;
grant execute on function public.submit_feedback(text, text, text, text, text) to authenticated;

-- 5) لعبة جديدة -------------------------------------------------------------------------

alter table public.games add column if not exists icon text;
alter table public.games add column if not exists category text;
alter table public.games add column if not exists how_to jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'games_category_check') then
    alter table public.games add constraint games_category_check check (category is null or category in ('words', 'talk', 'strategy', 'classic'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'games_icon_check') then
    alter table public.games add constraint games_icon_check check (icon is null or char_length(icon) <= 16);
  end if;
end $$;
comment on column public.games.how_to is 'قواعد مختصرة: {goal, minutes, steps[]} لصفحة اللعبة.';

-- طلب التطوير: فكرة اللعبة كما يكتبها المدير (خاص بالمدير).
create table if not exists public.game_ideas (
  slug       text primary key references public.games (slug) on update cascade on delete cascade,
  brief      jsonb not null default '{}'::jsonb,
  status     text not null default 'idea' check (status in ('idea', 'building', 'ready')),
  updated_at timestamptz not null default now()
);
alter table public.game_ideas enable row level security;
revoke all on public.game_ideas from anon;
grant select, insert, update, delete on public.game_ideas to authenticated;
drop policy if exists "game ideas: admin manage" on public.game_ideas;
create policy "game ideas: admin manage" on public.game_ideas
  for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());

-- Adds a game to the site as «قريبًا» with everything its page needs, plus the development brief.
create or replace function public.admin_add_game(p_game jsonb, p_brief jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text := lower(btrim(coalesce(p_game->>'slug', '')));
  v_title text := btrim(coalesce(p_game->>'title', ''));
  v_min int := coalesce((p_game->>'min_players')::int, 2);
  v_max int := coalesce((p_game->>'max_players')::int, 10);
begin
  if not public.is_app_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if v_slug !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' or char_length(v_slug) not between 3 and 40 then
    return jsonb_build_object('ok', false, 'reason', 'BAD_SLUG');
  end if;
  if char_length(v_title) < 2 or char_length(v_title) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'BAD_TITLE');
  end if;
  if v_min < 1 or v_max < v_min or v_max > 100 then
    return jsonb_build_object('ok', false, 'reason', 'BAD_PLAYERS');
  end if;
  if exists (select 1 from public.games where slug = v_slug) then
    return jsonb_build_object('ok', false, 'reason', 'SLUG_TAKEN');
  end if;
  insert into public.games (slug, title_ar, description_ar, min_players, max_players, is_active, home_status, sort_order, icon, category, how_to)
  values (v_slug, v_title, left(btrim(coalesce(p_game->>'description', '')), 300), v_min, v_max, false,
          case when p_game->>'home_status' = 'hidden' then 'hidden' else 'soon' end,
          coalesce((p_game->>'sort_order')::int, 500),
          nullif(left(btrim(coalesce(p_game->>'icon', '')), 16), ''),
          case when p_game->>'category' in ('words', 'talk', 'strategy', 'classic') then p_game->>'category' else 'talk' end,
          case when jsonb_typeof(p_game->'how_to') = 'object' then p_game->'how_to' else null end);
  insert into public.game_ideas (slug, brief) values (v_slug, coalesce(p_brief, '{}'::jsonb));
  return jsonb_build_object('ok', true, 'slug', v_slug);
end;
$$;
revoke all on function public.admin_add_game(jsonb, jsonb) from public, anon;
grant execute on function public.admin_add_game(jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
