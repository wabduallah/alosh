-- =============================================================================
-- «المحكمة»، الإصدار 8: لوحة القاضي. يُشغَّل بعد court_v7.sql، وتشغيله مرة ثانية آمن.
--
-- 1) التراجع: بعد «التالي» يقدر القاضي يرجع خطوة خلال ثوانٍ (court_undo).
--    لا تراجع بعد كشف الحقيقة، لأن النقاط توزّعت.
-- 2) «🔨 نظام في المحكمة!» و«🌙 ترتيب السهرة» على كل الشاشات (court_flash).
-- 3) عدّاد الأسئلة: كم مرة أخذ كل لاعب دور السؤال في القضية (state_data.asked).
-- =============================================================================

do $$
begin
  if to_regprocedure('public.court_timer(uuid,integer,text)') is null then
    raise exception 'شغّل court_v7.sql أولًا، ثم court_v8.sql.';
  end if;
end $$;

-- «التالي» يحفظ ما قبله، ليقدر القاضي يتراجع.
create or replace function public.court_next(p_room_id uuid, p_step integer default null::integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_prev jsonb;
  v_res jsonb;
begin
  if not public.court_can_run(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_prev from public.room_game_state where room_id = p_room_id for update;
  v_res := public.court_advance(p_room_id, p_step);
  if coalesce((v_res->>'ok')::boolean, false) and not coalesce((v_res->>'stale')::boolean, false) then
    update public.room_game_state
       set state_data = state_data || jsonb_build_object('undo',
         case when v_res->>'phase' = 'over' then 'null'::jsonb
              else jsonb_build_object('step', (state_data->>'step')::int, 'at', now(),
                     'evidence_n', jsonb_array_length(coalesce(v_prev->'evidence', '[]'::jsonb)),
                     'prev', v_prev - 'evidence' - 'undo') end)
     where room_id = p_room_id;
  end if;
  return v_res;
end;
$function$;

-- التراجع خطوة: الحالة كما كانت، والوقت يكمل من حيث توقّف.
create or replace function public.court_undo(p_room_id uuid, p_step int)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sd jsonb;
  v_u jsonb;
  v_prev jsonb;
  v_gap interval;
begin
  if not public.court_can_run(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  v_u := v_sd->'undo';
  if v_sd->>'game' is distinct from 'court' or jsonb_typeof(v_u) is distinct from 'object'
     or (v_u->>'step')::int is distinct from coalesce((v_sd->>'step')::int, -1)
     or p_step is distinct from (v_u->>'step')::int or v_sd->>'phase' = 'over' then
    return jsonb_build_object('ok', false, 'reason', 'NO_UNDO');
  end if;
  v_gap := now() - (v_u->>'at')::timestamptz;
  if v_gap > interval '20 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'TOO_LATE');
  end if;
  -- أصوات فُتحت ثم تراجع القاضي عنها: تُلغى.
  if v_sd->>'phase' = 'vote' then
    delete from public.room_court_votes where room_id = p_room_id;
  end if;
  v_prev := v_u->'prev';
  v_prev := v_prev || jsonb_build_object(
    'evidence', coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(coalesce(v_sd->'evidence', '[]'::jsonb)) with ordinality t(e, o)
                           where o <= coalesce((v_u->>'evidence_n')::int, 0) or coalesce((e->>'presented')::boolean, false)), '[]'::jsonb),
    'ends_at', case when nullif(v_prev->>'ends_at', '') is null then 'null'::jsonb else to_jsonb((v_prev->>'ends_at')::timestamptz + v_gap) end,
    'asking_since', case when nullif(v_prev->>'asking_since', '') is null then 'null'::jsonb else to_jsonb((v_prev->>'asking_since')::timestamptz + v_gap) end,
    'asked', coalesce(v_sd->'asked', '{}'::jsonb),
    'objection_points', coalesce(v_sd->'objection_points', '{}'::jsonb),
    'flash', coalesce(v_sd->'flash', 'null'::jsonb),
    'undo', null,
    'undone_at', now());
  -- رجوع السائل نفسه ليس سؤالًا جديدًا.
  perform set_config('alosh.court_nocount', 'on', true);
  update public.room_game_state set state_data = v_prev where room_id = p_room_id;
  perform set_config('alosh.court_nocount', 'off', true);
  return jsonb_build_object('ok', true, 'phase', v_prev->>'phase');
end;
$function$;

revoke all on function public.court_undo(uuid, int) from public, anon;
grant execute on function public.court_undo(uuid, int) to authenticated;

-- «نظام في المحكمة!» أو «ترتيب السهرة» على كل الشاشات لثوانٍ.
create or replace function public.court_flash(p_room_id uuid, p_kind text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sd jsonb;
begin
  if not public.court_can_run(p_room_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  if p_kind not in ('order', 'evening', 'hide') then
    return jsonb_build_object('ok', false, 'reason', 'BAD_KIND');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_STARTED');
  end if;
  if p_kind = 'hide' then
    update public.room_game_state set state_data = state_data || jsonb_build_object('flash', null) where room_id = p_room_id;
    return jsonb_build_object('ok', true);
  end if;
  -- ضغطات متتالية: مرة كل 3 ثوانٍ تكفي.
  if v_sd->'flash'->>'kind' = p_kind and (v_sd->'flash'->>'at')::timestamptz > now() - interval '3 seconds' then
    return jsonb_build_object('ok', true, 'repeat', true);
  end if;
  update public.room_game_state
     set state_data = state_data || jsonb_build_object('flash', jsonb_build_object('kind', p_kind, 'at', now()))
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.court_flash(uuid, text) from public, anon;
grant execute on function public.court_flash(uuid, text) to authenticated;

-- عدّاد الأسئلة: كل مرة يتغيّر فيها «يسأل الآن» إلى لاعب، يُحسب له سؤال.
create or replace function public.court_count_asked()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_id text := new.state_data->>'asking';
begin
  if coalesce(current_setting('alosh.court_nocount', true), '') = 'on' then
    return new;
  end if;
  new.state_data := new.state_data || jsonb_build_object('asked',
    coalesce(new.state_data->'asked', '{}'::jsonb) || jsonb_build_object(v_id, coalesce((new.state_data->'asked'->>v_id)::int, 0) + 1));
  return new;
end;
$function$;

drop trigger if exists court_count_asked on public.room_game_state;
create trigger court_count_asked
  before update on public.room_game_state
  for each row
  when (new.state_data->>'game' = 'court'
        and nullif(new.state_data->>'asking', '') is not null
        and new.state_data->>'asking' is distinct from old.state_data->>'asking')
  execute function public.court_count_asked();

create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;
insert into public.app_migrations (name) values ('court_v8.sql') on conflict do nothing;

notify pgrst, 'reload schema';
