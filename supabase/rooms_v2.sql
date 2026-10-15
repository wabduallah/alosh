-- =============================================================================
-- الغرف، الإصدار 2: طرد اللاعبين وإنهاء الغرفة للجميع. يُشغَّل بعد rooms_v1.sql، وتشغيله مرة ثانية آمن.
--
-- 1) room_kick: المضيف يُخرج أي لاعب في أي وقت (قبل اللعب وأثناءه)، ولا يستطيع اللاعب
--    الرجوع لنفس الغرفة بنفس الحساب (room_bans). في المحكمة تُحدَّث قائمة الأطراف.
-- 2) room_end: المضيف ينهي الغرفة للجميع من أي لعبة.
-- 3) الانضمام يرفض من طُرد (KICKED).
-- =============================================================================

create table if not exists public.room_bans (
  room_id uuid not null references public.game_rooms (id) on delete cascade,
  user_id uuid not null,
  at      timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.room_bans enable row level security;
revoke all on public.room_bans from anon, authenticated;

-- الانضمام: كما كان، ويُرفض من طرده المضيف.
create or replace function public.room_players_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_max int;
  v_count int;
begin
  -- قفل صف الغرفة يمنع تجاوز السعة عند انضمام عدة لاعبين في اللحظة نفسها.
  select r.status, g.max_players into v_status, v_max
  from public.game_rooms r
  join public.games g on g.id = r.game_id
  where r.id = new.room_id
  for update of r;

  if v_status is null then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_status = 'finished' then
    raise exception 'ROOM_FINISHED';
  end if;
  if new.user_id is not null and exists (select 1 from public.room_bans b where b.room_id = new.room_id and b.user_id = new.user_id) then
    raise exception 'KICKED';
  end if;
  select count(*) into v_count from public.room_players where room_id = new.room_id;
  if v_count >= v_max then
    raise exception 'ROOM_FULL';
  end if;

  new.player_name := btrim(regexp_replace(new.player_name, '\s+', ' ', 'g'));
  if public.is_client_request() then
    new.score := 0;
    new.joined_at := now();
  end if;
  return new;
end;
$$;

-- الطرد: للمضيف (أو المدير). لا يُطرد المضيف نفسه.
create or replace function public.room_kick(p_room_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.room_players%rowtype;
  v_sd jsonb;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select * into v_p from public.room_players where id = p_player_id and room_id = p_room_id;
  if not found then
    return jsonb_build_object('ok', true, 'gone', true);
  end if;
  if v_p.is_host then
    return jsonb_build_object('ok', false, 'reason', 'IS_HOST');
  end if;
  if v_p.user_id is not null then
    insert into public.room_bans (room_id, user_id) values (p_room_id, v_p.user_id) on conflict do nothing;
  end if;
  delete from public.room_players where id = p_player_id;

  -- المحكمة: تُحدَّث قائمة الأطراف، ويُزال من الدور والمنصة، ولا يُنتظر صوته.
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' = 'court' and coalesce(v_sd->>'phase', '') <> '' and to_regprocedure('public.court_cast(uuid)') is not null then
    v_sd := v_sd || jsonb_build_object(
      'cast', public.court_cast(p_room_id),
      'stand', case when v_sd->>'stand' = p_player_id::text then null else v_sd->'stand' end,
      'asking', case when v_sd->>'asking' = p_player_id::text then null else v_sd->'asking' end,
      'queue', coalesce((select jsonb_agg(q) from jsonb_array_elements(coalesce(v_sd->'queue', '[]'::jsonb)) q where q->>'player_id' <> p_player_id::text), '[]'::jsonb),
      'voters_count', greatest(0, coalesce((v_sd->>'voters_count')::int, 0)
                              - case when v_sd->>'phase' = 'vote' and exists (select 1 from jsonb_array_elements(coalesce(v_sd->'cast', '[]'::jsonb)) c
                                                                               where c->>'player_id' = p_player_id::text and c->>'kind' <> 'accused') then 1 else 0 end));
    update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  end if;
  return jsonb_build_object('ok', true, 'name', v_p.player_name);
end;
$$;
revoke all on function public.room_kick(uuid, uuid) from public, anon;
grant execute on function public.room_kick(uuid, uuid) to authenticated;

-- إنهاء الغرفة للجميع: من أي لعبة، في أي مرحلة.
create or replace function public.room_end(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  update public.game_rooms set status = 'finished' where id = p_room_id and status <> 'finished';
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.room_end(uuid) from public, anon;
grant execute on function public.room_end(uuid) to authenticated;

notify pgrst, 'reload schema';
