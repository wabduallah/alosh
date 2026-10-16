-- =============================================================================
-- الموقع، الإصدار 1. يُشغَّل بعد mafia_v8.sql، وتشغيله مرة ثانية آمن.
--
-- 0) مفاتيح جديدة في site_settings: test_guests, home, theme, info, pages.
-- 1) الضيوف التجريبيون: المدير يفعّلهم لأي لعبة من لوحة الإدارة (site_settings.test_guests)،
--    ثم يضيف ضيوفًا إلى غرفته ويلعب بدور أي واحد منهم من جهازه. يعمل مع كل لعبة تعرف لاعبها
--    بـ my_player_id() (كل ألعاب الموقع اليوم، وأي لعبة جديدة تتبع نفس الطريقة).
-- 2) حد لإنشاء الغرف: 30 غرفة في الساعة لكل مضيف (المدير مستثنى)، ضد الإغراق.
-- 3) search_path ثابت للدوال التي نبّه عليها فاحص الأمان في Supabase.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.mafia_night_timeout(uuid)') is null or to_regclass('public.app_migrations') is null then
    raise exception 'شغّل الملفات حتى mafia_v8.sql أولًا، ثم site_v1.sql.';
  end if;
end $$;

-- 0) مفاتيح إعدادات الموقع الجديدة: الضيوف التجريبيون، الرئيسية، الألوان، معلومات التواصل، الصفحات.
alter table public.site_settings drop constraint if exists site_settings_key_check;
alter table public.site_settings add constraint site_settings_key_check
  check (key in ('announcement', 'game_defaults', 'test_guests', 'home', 'theme', 'info', 'pages'));

-- 1) الضيوف التجريبيون ----------------------------------------------------------
alter table public.room_players add column if not exists is_test boolean not null default false;

-- المقعد: أي ضيف يلعب المدير بدوره الآن في هذه الغرفة.
create table if not exists public.room_test_seats (
  room_id    uuid not null references public.game_rooms (id) on delete cascade,
  controller uuid not null,
  player_id  uuid not null references public.room_players (id) on delete cascade,
  primary key (room_id, controller)
);
alter table public.room_test_seats enable row level security;
revoke all on public.room_test_seats from anon, authenticated;

-- اللاعب الحالي: مقعد الضيف التجريبي إن وُجد، وإلا اللاعب نفسه. كل الألعاب تمر من هنا.
create or replace function public.my_player_id(p_room_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.player_id from public.room_test_seats s where s.room_id = p_room_id and s.controller = auth.uid()),
    (select id from public.room_players where room_id = p_room_id and user_id = auth.uid() limit 1));
$$;

-- الجرس كان يعرف اللاعب مباشرة: صار يمر من my_player_id.
create or replace function public.press_buzzer(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.room_players%rowtype;
  v_state jsonb;
begin
  select * into v_player from public.room_players where id = public.my_player_id(p_room_id);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;

  update public.room_game_state s
  set state_data = jsonb_set(
        s.state_data,
        '{buzzer}',
        jsonb_build_object(
          'player_id', v_player.id,
          'player_name', v_player.player_name,
          'team_color', v_player.team_color,
          'at', to_jsonb(clock_timestamp())
        ),
        true)
  where s.room_id = p_room_id
    and coalesce((s.state_data ->> 'buzzer_open')::boolean, false)
    and coalesce(jsonb_typeof(s.state_data -> 'buzzer'), 'null') = 'null'
    and exists (select 1 from public.game_rooms r where r.id = p_room_id and r.status = 'playing')
  returning s.state_data into v_state;

  if v_state is null then
    return jsonb_build_object('ok', false, 'reason', 'LOCKED');
  end if;
  return jsonb_build_object('ok', true, 'buzzer', v_state -> 'buzzer');
end;
$$;

-- مسموح: المدير، في لعبة فعّل لها الضيوف التجريبيين.
create or replace function public.test_guests_allowed(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_app_admin() and exists (
    select 1 from public.game_rooms r
      join public.games g on g.id = r.game_id
      join public.site_settings s on s.key = 'test_guests'
     where r.id = p_room_id and coalesce((s.value->'games'->>g.slug)::boolean, false));
$$;

create or replace function public.test_guests_status(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  -- Not allowed (anymore): still tell the admin about a leftover seat, so they can go back to themselves.
  select case when not public.test_guests_allowed(p_room_id) then jsonb_build_object('allowed', false,
    'seat', (select s.player_id from public.room_test_seats s where s.room_id = p_room_id and s.controller = auth.uid()))
  else jsonb_build_object(
    'allowed', true,
    'seat', (select s.player_id from public.room_test_seats s where s.room_id = p_room_id and s.controller = auth.uid()),
    'guests', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.player_name) order by p.joined_at), '[]'::jsonb)
                 from public.room_players p where p.room_id = p_room_id and p.is_test)) end;
$$;

create or replace function public.test_guest_add(p_room_id uuid, p_count int default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  i int;
begin
  if not public.test_guests_allowed(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ALLOWED');
  end if;
  select count(*) into v_n from public.room_players where room_id = p_room_id and is_test;
  for i in 1..greatest(1, least(coalesce(p_count, 1), 12)) loop
    v_n := v_n + 1;
    insert into public.room_players (room_id, user_id, player_name, is_host, is_test)
    values (p_room_id, null, 'ضيف تجريبي ' || v_n, false, true);
  end loop;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'reason', case when sqlerrm like '%ROOM_FULL%' then 'ROOM_FULL' when sqlerrm like '%ROOM_FINISHED%' then 'ROOM_FINISHED' else 'FAILED' end);
end;
$$;

-- العب بدور ضيف (أو ارجع لنفسك بـ null).
create or replace function public.test_guest_act(p_room_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_player_id is null then
    delete from public.room_test_seats where room_id = p_room_id and controller = auth.uid();
    return jsonb_build_object('ok', true);
  end if;
  if not public.test_guests_allowed(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ALLOWED');
  end if;
  if not exists (select 1 from public.room_players where id = p_player_id and room_id = p_room_id and is_test) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_A_GUEST');
  end if;
  insert into public.room_test_seats (room_id, controller, player_id) values (p_room_id, auth.uid(), p_player_id)
  on conflict (room_id, controller) do update set player_id = excluded.player_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.test_guest_remove(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_app_admin() and (public.is_room_host(p_room_id) or public.test_guests_allowed(p_room_id))) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ALLOWED');
  end if;
  delete from public.room_players where room_id = p_room_id and is_test;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.test_guests_allowed(uuid) from public, anon;
revoke all on function public.test_guests_status(uuid) from public, anon;
revoke all on function public.test_guest_add(uuid, int) from public, anon;
revoke all on function public.test_guest_act(uuid, uuid) from public, anon;
revoke all on function public.test_guest_remove(uuid) from public, anon;
grant execute on function public.test_guests_allowed(uuid) to authenticated;
grant execute on function public.test_guests_status(uuid) to authenticated;
grant execute on function public.test_guest_add(uuid, int) to authenticated;
grant execute on function public.test_guest_act(uuid, uuid) to authenticated;
grant execute on function public.test_guest_remove(uuid) to authenticated;

-- 2) حد إنشاء الغرف -----------------------------------------------------------------
create or replace function public.game_rooms_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_client_request() and not public.is_app_admin()
     and (select count(*) from public.game_rooms where host_id = new.host_id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'TOO_MANY_ROOMS' using hint = 'room limit per hour';
  end if;
  return new;
end;
$$;
drop trigger if exists game_rooms_rate_limit on public.game_rooms;
create trigger game_rooms_rate_limit before insert on public.game_rooms
  for each row execute function public.game_rooms_rate_limit();

-- 3) search_path ثابت ---------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('halba_waiting', 'halba_duel_uneven', 'halba_pending', 'funnel_since', 'court_ev',
                                'court_case_min', 'court_kind_ar', 'court_win_of', 'court_apply_variant')
  loop
    execute format('alter function %s set search_path = public', r.sig);
  end loop;
end $$;

-- سجل الملفات (app_v1.sql): هذا الملف شُغّل.
create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;
insert into public.app_migrations (name) values ('site_v1.sql') on conflict do nothing;

notify pgrst, 'reload schema';
