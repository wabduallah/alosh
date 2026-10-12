-- =============================================================================
-- تحسينات الموقع، الإصدار 1. تشغيله مرة ثانية آمن.
--
-- 1) الألعاب من مكان واحد: حالة كل لعبة في الرئيسية (متاحة / قريبًا / مخفية) وترتيبها،
--    وأسماء الرئيسية ووصفها في جدول الألعاب، و«خلية الحروف» قريبًا حتى تُبنى.
-- 2) قياس الغرف: وقت البدء والانتهاء لكل غرفة، وإغلاق الغرف المهجورة، وقمع للوحة الإحصاءات.
-- 3) ضبط قاعدة البيانات: سياسات أسرع، فهارس ناقصة، search_path للدوال، وصلاحيات أضيق.
--
-- لا يحذف أي جدول أو صف.
-- =============================================================================

-- 1) الألعاب ------------------------------------------------------------------

alter table public.games add column if not exists home_status text not null default 'live';
alter table public.games add column if not exists sort_order int not null default 100;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'games_home_status_check') then
    alter table public.games add constraint games_home_status_check check (home_status in ('live', 'soon', 'hidden'));
  end if;
end $$;

comment on column public.games.home_status is 'في الرئيسية: live متاحة (إذا كانت مفعّلة)، soon قريبًا، hidden مخفية.';
comment on column public.games.sort_order is 'ترتيب اللعبة في الرئيسية وصفحة إنشاء الغرفة (الأصغر أولًا).';

-- أسماء الرئيسية ووصفها (المعتمدة)، والترتيب الحالي.
update public.games set title_ar = 'الحلبة', sort_order = 10,
  description_ar = 'تحدي المواجهة المباشرة والمزايدة! أجب أسرع وخاطر بنقاطك لتسيطر على الحلبة وتطيح بخصومك.'
 where slug = 'alhalba';
update public.games set title_ar = 'تحديات العش', sort_order = 20,
  description_ar = 'لوحة أسئلة على الشاشة الكبيرة. اختاروا التصنيفات وتنافسوا على النقاط.'
 where slug = 'tactical-grid';
update public.games set title_ar = 'سيد الخداع', sort_order = 30,
  description_ar = 'اكتبوا إجابات مزيفة مقنعة، وصوّتوا على الإجابة الحقيقية. من يخدع أكثر يكسب.'
 where slug = 'bluff-master';
update public.games set title_ar = 'هل تعرف', sort_order = 40,
  description_ar = 'اختاروا فريقين. مخمِّن يتوسط الفريق، وزملاؤه يصفون الكلمة دون أن يقولوها.'
 where slug = 'heads-up';
update public.games set title_ar = 'برة السالفة', sort_order = 50,
  description_ar = 'لاعب واحد لا يعرف الموضوع. هل تكشفه قبل أن يكشف نفسه؟'
 where slug = 'outsider';
update public.games set title_ar = 'المافيا', sort_order = 60,
  description_ar = 'المواطنون ضد المافيا. من يكذب ومن يصدق؟'
 where slug = 'social-mafia';

-- «خلية الحروف» بلا واجهة خاصة بعد: قريبًا، ولا تُفتح لها غرف جديدة.
update public.games set title_ar = 'خلية الحروف', is_active = false, home_status = 'soon', sort_order = 100
 where slug = 'hex-letters';

-- ألعاب «قريبًا» المعروضة في الرئيسية، لتتحكم بها لوحة الإدارة أيضًا.
insert into public.games (slug, title_ar, description_ar, min_players, max_players, is_active, home_status, sort_order) values
  ('word-guess', 'خمّن الكلمة', 'كلمة خماسية في ست محاولات، والجميع يتابع النتيجة على الشاشة.', 1, 10, false, 'soon', 70),
  ('secret-code', 'الأسماء السرية', 'فريقان يتنافسان بتلميحات كلمة واحدة لكشف الكلمات.', 4, 10, false, 'soon', 80),
  ('one-word', 'كلمة واحدة', 'تلميح واحد فقط لكل كلمة، وإذا تكررت التلميحات تُلغى.', 3, 8, false, 'soon', 90)
on conflict (slug) do nothing;

-- الزوار يقرؤون كل لعبة غير مخفية (لتظهر «قريبًا»)، وإنشاء الغرف ما زال يشترط أن تكون مفعّلة.
drop policy if exists "games: read active" on public.games;
drop policy if exists "games: read listed" on public.games;
create policy "games: read listed" on public.games for select to anon, authenticated
  using (is_active or home_status <> 'hidden' or (select public.is_app_admin()));

-- الإدارة: سياسة لكل عملية بدل ALL، حتى لا تتكرر سياستان على القراءة.
drop policy if exists "games: admin manage" on public.games;
drop policy if exists "games: admin insert" on public.games;
drop policy if exists "games: admin update" on public.games;
drop policy if exists "games: admin delete" on public.games;
create policy "games: admin insert" on public.games for insert to authenticated with check ((select public.is_app_admin()));
create policy "games: admin update" on public.games for update to authenticated using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
create policy "games: admin delete" on public.games for delete to authenticated using ((select public.is_app_admin()));

grant select (home_status, sort_order) on public.games to anon, authenticated;
grant update (home_status, sort_order) on public.games to authenticated;

-- 2) قياس الغرف ---------------------------------------------------------------

alter table public.game_rooms add column if not exists started_at timestamptz;
alter table public.game_rooms add column if not exists ended_at timestamptz;
comment on column public.game_rooms.started_at is 'أول مرة صارت الغرفة playing.';
comment on column public.game_rooms.ended_at is 'وقت إنهاء المضيف للغرفة. يبقى فارغًا للغرف المهجورة التي أُغلقت تلقائيًا.';

create index if not exists game_rooms_created_at_idx on public.game_rooms (created_at);

create or replace function public.game_rooms_track_times()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'playing' and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'finished' and old.status is distinct from 'finished'
     and coalesce(current_setting('alosh.expire', true), '') <> '1' then
    new.ended_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.game_rooms_track_times() from public, anon, authenticated;

drop trigger if exists game_rooms_track_times on public.game_rooms;
create trigger game_rooms_track_times before update of status on public.game_rooms
  for each row execute function public.game_rooms_track_times();

-- بداية القياس: وقت تشغيل هذا الملف أول مرة (لا تتغير عند إعادة تشغيله).
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'funnel_since') then
    execute format('create function public.funnel_since() returns timestamptz language sql immutable as %L',
                   format('select %L::timestamptz', now()));
  end if;
end $$;
revoke all on function public.funnel_since() from public, anon;
grant execute on function public.funnel_since() to authenticated;

-- الغرف التي لم يحدث فيها شيء منذ 6 ساعات تُغلق دون أن تُحسب «منتهية».
create or replace function public.expire_stale_rooms()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  perform set_config('alosh.expire', '1', true);
  with stale as (
    select r.id
      from public.game_rooms r
      left join public.room_game_state s on s.room_id = r.id
     where r.status in ('lobby', 'playing')
       and greatest(r.created_at, coalesce(s.updated_at, r.created_at),
                    coalesce((select max(p.joined_at) from public.room_players p where p.room_id = r.id), r.created_at))
           < now() - interval '6 hours'
  )
  update public.game_rooms g set status = 'finished' from stale where g.id = stale.id;
  get diagnostics v_n = row_count;
  perform set_config('alosh.expire', '', true);
  return v_n;
end;
$$;
revoke all on function public.expire_stale_rooms() from public, anon, authenticated;

-- قمع الغرف لكل لعبة: فُتحت ← دخلها لاعبون ← بدأت ← انتهت، مع متوسط اللاعبين والمدة.
create or replace function public.admin_funnel(p_days int default 30)
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
revoke all on function public.admin_funnel(int) from public, anon;
grant execute on function public.admin_funnel(int) to authenticated;

-- اختياري: إغلاق الغرف المهجورة كل ساعة حتى بدون فتح لوحة الإدارة.
-- يحتاج تفعيل إضافة pg_cron من Supabase (Database ← Extensions)، ثم شغّل:
--   select cron.schedule('alosh-expire-rooms', '7 * * * *', 'select public.expire_stale_rooms()');

-- 3) ضبط قاعدة البيانات ------------------------------------------------------

-- السياسات: auth.uid() و is_app_admin() تُحسب مرة للاستعلام بدل كل صف.
alter policy "rooms: create as host" on public.game_rooms
  with check ((host_id = (select auth.uid()))
              and exists (select 1 from public.games g where g.id = game_rooms.game_id and g.is_active));
alter policy "rooms: host updates" on public.game_rooms
  using ((host_id = (select auth.uid())) or (select public.is_app_admin()))
  with check ((host_id = (select auth.uid())) or (select public.is_app_admin()));
alter policy "rooms: host deletes" on public.game_rooms
  using ((host_id = (select auth.uid())) or (select public.is_app_admin()));
alter policy "players: join" on public.room_players
  with check (((user_id = (select auth.uid())) and ((not is_host) or public.is_room_host(room_id)))
              or ((user_id is null) and public.is_room_host(room_id))
              or (select public.is_app_admin()));
alter policy "players: self or host updates" on public.room_players
  using ((user_id = (select auth.uid())) or public.is_room_host(room_id) or (select public.is_app_admin()))
  with check ((user_id = (select auth.uid())) or public.is_room_host(room_id) or (select public.is_app_admin()));
alter policy "players: leave or host removes" on public.room_players
  using ((user_id = (select auth.uid())) or public.is_room_host(room_id) or (select public.is_app_admin()));

-- فهارس المفاتيح الأجنبية (حذف اللاعبين والغرف أسرع).
create index if not exists room_bluff_answers_player_idx on public.room_bluff_answers (player_id);
create index if not exists room_bluff_options_owner_idx on public.room_bluff_options (owner_player_id);
create index if not exists room_bluff_votes_player_idx on public.room_bluff_votes (player_id);
create index if not exists room_mafia_actions_actor_idx on public.room_mafia_actions (actor_id);
create index if not exists room_mafia_actions_target_idx on public.room_mafia_actions (target_id);
create index if not exists room_mafia_roles_player_idx on public.room_mafia_roles (player_id);
create index if not exists room_mafia_votes_target_idx on public.room_mafia_votes (target_id);
create index if not exists room_mafia_votes_voter_idx on public.room_mafia_votes (voter_id);
create index if not exists room_outsider_secrets_player_idx on public.room_outsider_secrets (player_id);
create index if not exists room_outsider_votes_target_idx on public.room_outsider_votes (target_id);
create index if not exists room_outsider_votes_voter_idx on public.room_outsider_votes (voter_id);

-- search_path ثابت للدوال المساعدة.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.halba_use(jsonb,text,text)', 'public.halba_credit(jsonb,boolean,integer,text)', 'public.halba_goal(jsonb)',
    'public.halba_can_fight(jsonb,uuid)', 'public.halba_can_fight2(jsonb,text)', 'public.halba_norm(text)',
    'public.halba_used(jsonb,text,text)', 'public.halba_side(jsonb,text)', 'public.name_norm(text)',
    'public.blocked_names_set_norm()', 'public.mafia_role_ar(text)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('alter function %s set search_path = public', f);
    end if;
  end loop;
end $$;

-- صلاحيات: دالة المشغّل لا تُستدعى مباشرة، ودوال الغرف للمسجّلين فقط (ومنهم الضيوف).
revoke execute on function public.room_players_check_name() from public, anon, authenticated;
revoke execute on function public.is_room_host(uuid) from public, anon;
revoke execute on function public.my_player_id(uuid) from public, anon;
grant execute on function public.is_room_host(uuid) to authenticated;
grant execute on function public.my_player_id(uuid) to authenticated;

notify pgrst, 'reload schema';
