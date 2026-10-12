-- =============================================================================
-- الغرف، الإصدار 1: جولة جديدة في نفس الغرفة. يُشغَّل بعد polish_v1.sql، وتشغيله مرة ثانية آمن.
--
-- بعد انتهاء اللعبة يقدر المضيف أن يلعب اللعبة نفسها من جديد أو يختار لعبة أخرى،
-- واللاعبون يبقون في الغرفة بالرمز نفسه:
--   - تُمسح بيانات اللعبة السابقة (الأدوار والأصوات والإجابات وحالة اللعب) وتُصفّر النقاط والفرق.
--   - تعود الغرفة إلى «بانتظار البدء» مع اللعبة الجديدة، ويزيد رقم الجولة session.
--   - صفحات اللاعبين والتلفزيون تراقب session وgame_id وتعيد التحميل تلقائيًا.
-- =============================================================================

alter table public.game_rooms add column if not exists session int not null default 1;
comment on column public.game_rooms.session is 'رقم الجولة في الغرفة. يزيد مع كل «لعبة جديدة» من المضيف.';
grant select (session) on public.game_rooms to anon, authenticated;

create or replace function public.room_next_game(p_room_id uuid, p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.game_rooms%rowtype;
  v_game public.games%rowtype;
  v_players int;
  v_sd jsonb;
  v_keep jsonb := '{}'::jsonb;
  t text;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;

  select * into v_room from public.game_rooms where id = p_room_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'ROOM_NOT_FOUND');
  end if;

  select * into v_game from public.games
   where slug = p_slug and is_active and coalesce(home_status, 'live') = 'live';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'GAME_UNAVAILABLE');
  end if;

  select count(*) into v_players from public.room_players where room_id = p_room_id;
  if v_players > v_game.max_players then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY', 'players', v_players, 'max', v_game.max_players);
  end if;

  -- بيانات اللعبة السابقة.
  foreach t in array array[
    'room_mafia_roles', 'room_mafia_actions', 'room_mafia_votes',
    'room_bluff_answers', 'room_bluff_options', 'room_bluff_votes',
    'room_outsider_secrets', 'room_outsider_votes'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I where room_id = $1', t) using p_room_id;
    end if;
  end loop;

  -- اللعبة نفسها من جديد: تبقى إعداداتها الأخيرة لتُعرض جاهزة (مثل إعدادات المافيا).
  select state_data into v_sd from public.room_game_state where room_id = p_room_id;
  if v_room.game_id = v_game.id and v_sd is not null and coalesce(v_sd->'settings', v_sd->'last_settings') is not null then
    v_keep := jsonb_build_object('last_settings', coalesce(v_sd->'settings', v_sd->'last_settings'));
  end if;
  insert into public.room_game_state (room_id, active_question_id, state_data)
  values (p_room_id, null, v_keep)
  on conflict (room_id) do update set active_question_id = null, state_data = excluded.state_data;

  perform set_config('alosh.trusted', 'on', true);
  update public.room_players set score = 0, team_color = null where room_id = p_room_id;
  perform set_config('alosh.trusted', '', true);

  update public.game_rooms
     set game_id = v_game.id, status = 'lobby', current_round = 1, session = session + 1
   where id = p_room_id;

  return jsonb_build_object('ok', true, 'slug', v_game.slug, 'session', v_room.session + 1);
end;
$$;

revoke all on function public.room_next_game(uuid, text) from public, anon;
grant execute on function public.room_next_game(uuid, text) to authenticated;

notify pgrst, 'reload schema';
