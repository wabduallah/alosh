-- =============================================================================
-- «المحكمة»، الإصدار 9: القاضي النظام. يُشغَّل بعد court_v8.sql، وتشغيله مرة ثانية آمن.
--
-- اختيار جديد للقاضي في الإعداد: «النظام» (settings.judge = 'system'). لا أحد يحكم بيده:
-- 1) الانتقال تلقائي في كل الجلسة: المقدمة (90 ثانية لقراءة البطاقات)، والأدلة، والاستجواب،
--    والمرافعات، والتصويت، ثم الحكم (20 ثانية) وكشف الحقيقة.
-- 2) المنصة تتصعّد وحدها، ودور الأسئلة يمشي بالطابور، وصاحب الدور يقدر ينهي سؤاله بنفسه.
-- 3) الاعتراض يحسمه تصويت المحلّفين والشهود والمحقق خلال 15 ثانية (court_objection_vote):
--    الأكثرية تقبل، والتعادل أو عدم التصويت رفض.
-- والمضيف يبقى معه أدوات احتياطية، ويقدر يلعب أي دور بلا تعارض.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.court_undo(uuid,integer)') is null then
    raise exception 'شغّل court_v8.sql أولًا، ثم court_v9.sql.';
  end if;
  -- البداية الأصلية تبقى كما هي باسم court_start_base، وcourt_start تضيف القاضي النظام فوقها.
  if to_regprocedure('public.court_start_base(uuid,jsonb)') is null then
    alter function public.court_start(uuid, jsonb) rename to court_start_base;
  end if;
end $$;

revoke all on function public.court_start_base(uuid, jsonb) from public, anon, authenticated;

create or replace function public.court_start(p_room_id uuid, p_settings jsonb default '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_s jsonb := coalesce(p_settings, '{}'::jsonb);
  v_res jsonb;
  v_secs int;
begin
  if v_s->>'judge' is distinct from 'system' then
    return public.court_start_base(p_room_id, v_s);
  end if;
  -- النظام ينقل الجلسة: انتقال تلقائي، ومنصة تتصعّد، ولكل مرحلة وقت.
  v_s := v_s || jsonb_build_object('judge', 'host', 'auto', true, 'escalate', true,
    'question_seconds', case when coalesce((v_s->>'question_seconds')::int, 0) <= 0 then 180 else (v_s->>'question_seconds')::int end,
    'closing_seconds', case when coalesce((v_s->>'closing_seconds')::int, 0) <= 0 then 60 else (v_s->>'closing_seconds')::int end,
    'vote_seconds', case when coalesce((v_s->>'vote_seconds')::int, 0) <= 0 then 60 else (v_s->>'vote_seconds')::int end);
  v_res := public.court_start_base(p_room_id, v_s);
  if not coalesce((v_res->>'ok')::boolean, false) then
    return v_res;
  end if;
  v_secs := 90;
  update public.room_game_state
     set state_data = jsonb_set(state_data, '{settings,judge}', '"system"'::jsonb)
       || jsonb_build_object(
            'steps', (select jsonb_agg(case when st->>'phase' = 'intro' then st || jsonb_build_object('seconds', v_secs)
                                            when st->>'phase' = 'verdict' then st || '{"seconds":20}'::jsonb
                                            else st end order by o)
                        from jsonb_array_elements(state_data->'steps') with ordinality t(st, o)),
            'ends_at', case when state_data->>'phase' = 'intro' then to_jsonb(now() + make_interval(secs => v_secs)) else coalesce(state_data->'ends_at', 'null'::jsonb) end)
   where room_id = p_room_id;
  return v_res;
end;
$function$;

revoke all on function public.court_start(uuid, jsonb) from public, anon;
grant execute on function public.court_start(uuid, jsonb) to authenticated;

-- حسم الاعتراض: بتصويت الهيئة (الأكثرية تقبل) أو رفض تلقائي.
create or replace function public.court_settle_objection(p_sd jsonb, p_by_vote boolean)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare
  v_yes int := 0;
  v_no int := 0;
  v_accept boolean := false;
  v_by text := p_sd->'objection'->>'by';
begin
  if p_by_vote then
    select count(*) filter (where value::boolean), count(*) filter (where not value::boolean) into v_yes, v_no
      from jsonb_each_text(coalesce(p_sd->'objection'->'votes', '{}'::jsonb));
    v_accept := v_yes > v_no;
  end if;
  return p_sd || jsonb_build_object(
    'objection', (p_sd->'objection') || jsonb_build_object('status', case when v_accept then 'accepted' else 'rejected' end,
                  'ruled_at', now(), 'auto', true, 'tally', jsonb_build_object('yes', v_yes, 'no', v_no)),
    'objection_points', case when v_accept and v_by is not null
      then coalesce(p_sd->'objection_points', '{}'::jsonb) || jsonb_build_object(v_by, coalesce((p_sd->'objection_points'->>v_by)::int, 0) + 1)
      else coalesce(p_sd->'objection_points', '{}'::jsonb) end);
end;
$function$;

revoke all on function public.court_settle_objection(jsonb, boolean) from public, anon, authenticated;

-- صوت المحلّف أو الشاهد أو المحقق على الاعتراض، حين يكون القاضي النظام.
create or replace function public.court_objection_vote(p_room_id uuid, p_accept boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_kind text;
  v_sd jsonb;
  v_votes jsonb;
  v_eligible int;
begin
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' or v_sd->'settings'->>'judge' is distinct from 'system' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ALLOWED');
  end if;
  if jsonb_typeof(v_sd->'objection') is distinct from 'object' or v_sd->'objection'->>'status' <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'NO_OBJECTION');
  end if;
  select kind into v_kind from public.room_court_roles where room_id = p_room_id and player_id = v_me;
  if v_kind is null or v_kind not in ('juror', 'witness', 'detective') or v_me::text = v_sd->'objection'->>'by' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ALLOWED');
  end if;
  v_votes := coalesce(v_sd->'objection'->'votes', '{}'::jsonb) || jsonb_build_object(v_me::text, coalesce(p_accept, false));
  v_sd := v_sd || jsonb_build_object('objection', (v_sd->'objection') || jsonb_build_object('votes', v_votes));
  select count(*) into v_eligible from public.room_court_roles
   where room_id = p_room_id and kind in ('juror', 'witness', 'detective') and player_id::text <> coalesce(v_sd->'objection'->>'by', '');
  -- صوّت الجميع: يُحسم الآن.
  if (select count(*) from jsonb_object_keys(v_votes)) >= v_eligible then
    v_sd := public.court_settle_objection(v_sd, true);
  end if;
  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.court_objection_vote(uuid, boolean) from public, anon;
grant execute on function public.court_objection_vote(uuid, boolean) to authenticated;

-- court_tick: القاضي النظام يحسم الاعتراض بتصويت المحلّفين، وينقل المقدمة والحكم وحده.
create or replace function public.court_tick(p_room_id uuid, p_step integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sd jsonb;
  v_queue jsonb;
  v_done boolean := false;
  v_order jsonb;
  v_len int;
  v_secs int;
  v_start timestamptz;
  v_slot numeric;
  v_index int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_SESSION');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' or coalesce((v_sd->>'step')::int, -1) <> p_step then
    return jsonb_build_object('ok', true, 'stale', true);
  end if;
  if jsonb_typeof(v_sd->'objection') = 'object' and v_sd->'objection'->>'status' = 'pending'
     and (v_sd->'objection'->>'at')::timestamptz <= now() - (case when v_sd->'settings'->>'judge' = 'system' then interval '15 seconds' else interval '10 seconds' end) then
    -- القاضي النظام: تصويت المحلّفين يحسم. وإلا: يُرفض وحده.
    v_sd := public.court_settle_objection(v_sd, v_sd->'settings'->>'judge' = 'system');
    v_done := true;
  end if;
  if v_sd->>'phase' = 'question' and nullif(v_sd->>'asking', '') is not null and nullif(v_sd->>'asking_since', '') is not null
     and coalesce(v_sd->'paused'->>'step', '') <> p_step::text
     and (v_sd->>'asking_since')::timestamptz <= now() - make_interval(secs => coalesce((v_sd->'settings'->>'turn_seconds')::int, 45) - 1) then
    v_queue := coalesce(v_sd->'queue', '[]'::jsonb);
    v_sd := v_sd || jsonb_build_object('asking', v_queue->0->'player_id',
      'asking_since', case when v_queue->0 is null then null else to_jsonb(now()) end,
      'queue', coalesce(v_queue - 0, '[]'::jsonb), 'golden', null);
    v_done := true;
  end if;
  -- تصعيد المنصة: الشهود، ثم المحقق، ثم المتهم (أو المتهمان)، كل واحد جزء من وقت الاستجواب.
  if v_sd->>'phase' = 'question' and coalesce((v_sd->'settings'->>'escalate')::boolean, true)
     and nullif(v_sd->>'ends_at', '') is not null and jsonb_typeof(v_sd->'golden') is distinct from 'object' then
    v_secs := coalesce((v_sd->'steps'->(p_step)->>'seconds')::int, 0);
    select coalesce(jsonb_agg(x->'player_id' order by case x->>'kind' when 'witness' then 1 when 'detective' then 2 else 3 end, o), '[]'::jsonb)
      into v_order
      from jsonb_array_elements(v_sd->'cast') with ordinality t(x, o)
     where x->>'kind' in ('witness', 'detective', 'accused');
    v_len := jsonb_array_length(v_order);
    if v_secs > 0 and v_len > 0 then
      v_start := (v_sd->>'ends_at')::timestamptz - make_interval(secs => v_secs);
      v_slot := greatest(30, v_secs::numeric / v_len);
      v_index := least(v_len - 1, floor(extract(epoch from (now() + interval '1 second' - v_start)) / v_slot)::int);
      if v_index >= 0 and v_index > coalesce((v_sd->>'stand_slot')::int, -1) then
        v_sd := v_sd || jsonb_build_object('stand', v_order->v_index, 'stand_slot', v_index);
        v_done := true;
      end if;
    end if;
  end if;
  if v_done then
    update public.room_game_state set state_data = v_sd where room_id = p_room_id;
    return jsonb_build_object('ok', true, 'turn', true);
  end if;
  if v_sd->>'phase' = 'vote' and coalesce((v_sd->>'voters_count')::int, 0) > 0
     and coalesce((v_sd->>'votes_count')::int, 0) >= (v_sd->>'voters_count')::int then
    return public.court_advance(p_room_id, p_step);
  end if;
  if coalesce((v_sd->'settings'->>'auto')::boolean, false)
     and v_sd->>'phase' in ('intro', 'evidence', 'question', 'closing', 'vote', 'verdict')
     and nullif(v_sd->>'ends_at', '') is not null
     and (v_sd->>'ends_at')::timestamptz <= now() + interval '1 second' then
    return public.court_advance(p_room_id, p_step);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'NOT_YET');
end;
$function$;

-- court_raise: «انتهى سؤالي» من صاحب الدور نفسه.
create or replace function public.court_raise(p_room_id uuid, p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_name text;
  v_sd jsonb;
  v_queue jsonb;
begin
  select p.player_name into v_name from public.room_court_roles r join public.room_players p on p.id = r.player_id
   where r.room_id = p_room_id and r.player_id = v_me;
  if v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'phase' <> 'question' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  select coalesce(jsonb_agg(q), '[]'::jsonb) into v_queue from jsonb_array_elements(coalesce(v_sd->'queue', '[]'::jsonb)) q where q->>'player_id' <> v_me::text;
  if not p_on and v_sd->>'asking' = v_me::text then
    update public.room_game_state
       set state_data = state_data || jsonb_build_object(
         'asking', v_queue->0->'player_id', 'asking_since', case when v_queue->0 is null then null else to_jsonb(now()) end,
         'queue', coalesce(v_queue - 0, '[]'::jsonb), 'golden', null)
     where room_id = p_room_id;
    return jsonb_build_object('ok', true, 'done', true);
  end if;
  if p_on and nullif(v_sd->>'asking', '') is null then
    update public.room_game_state set state_data = state_data || jsonb_build_object('queue', v_queue, 'asking', v_me, 'asking_since', now()) where room_id = p_room_id;
    return jsonb_build_object('ok', true, 'asking', true);
  end if;
  if p_on and coalesce(v_sd->>'asking', '') <> v_me::text then
    v_queue := v_queue || jsonb_build_array(jsonb_build_object('player_id', v_me, 'name', v_name, 'at', now()));
  end if;
  update public.room_game_state set state_data = state_data || jsonb_build_object('queue', v_queue) where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$function$;

create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;
insert into public.app_migrations (name) values ('court_v9.sql') on conflict do nothing;

notify pgrst, 'reload schema';
