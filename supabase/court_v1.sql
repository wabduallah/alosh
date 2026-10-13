-- =============================================================================
-- «المحكمة» ⚖️، الإصدار 1. يُشغَّل بعد admin_v4.sql، وتشغيله مرة ثانية آمن.
--
-- قضية غامضة تُحاكَم في الغرفة. لكل لاعب دور وبطاقة سرية: المتهم، المدعي العام، المحامي،
-- الشهود، المحقق، والباقي محلّفون. القاضي هو النظام، والمضيف يدير الجلسة بزر «التالي».
--
-- المراحل ثابتة وتُبنى عند البداية من أدلة القضية:
--   intro (القضية والبطاقات) ← evidence 1 ← question 1 ← evidence 2 ← question 2 ← …
--   ← closing (المدعي) ← closing (المحامي) ← vote ← verdict (حكم المحلفين) ← over (الحقيقة والنقاط)
--
-- الحكم «مذنب» أو «بريء». يصوّت الجميع إلا المتهم، والتعادل = بريء (الشك لصالح المتهم).
-- النقاط: كل صوت يطابق الحقيقة 100. المتهم 300 إن بُرّئ. المدعي والمحقق والشهود 200 إن كان
-- الحكم صحيحًا. المحامي 200 إن بُرّئ موكله، و100 إضافية إن كان الحكم صحيحًا.
--
-- القضايا في court_cases وتُدار من لوحة الإدارة (تبويب «القضايا»). لا يقرؤها اللاعبون:
-- كل لاعب يصله ما يخصه فقط عبر court_my_card، والحقيقة لا تُكشف إلا في النهاية.
-- =============================================================================

-- القضايا ------------------------------------------------------------------------

create table if not exists public.court_cases (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique,
  title       text not null check (char_length(btrim(title)) between 2 and 80),
  category    text check (category is null or char_length(category) <= 40),
  difficulty  int not null default 2 check (difficulty between 1 and 3),
  summary     text not null default '' check (char_length(summary) <= 300),
  intro       text not null check (char_length(btrim(intro)) between 20 and 2000),
  guilty      boolean not null,
  truth       text not null check (char_length(btrim(truth)) between 10 and 2000),
  roles       jsonb not null,
  evidence    jsonb not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.court_cases is 'قضايا لعبة المحكمة: القصة والحقيقة والأدوار (بأسرارها) والأدلة لكل جولة. للمدير فقط.';
comment on column public.court_cases.roles is '[{key, kind: accused|prosecutor|lawyer|detective|witness, name, brief, secret, later, optional}] بالترتيب: الأدوار الاختيارية تُوزَّع حسب عدد اللاعبين.';
comment on column public.court_cases.evidence is '[{stage: 1..3, title, text, icon}] تظهر أدلة كل جولة معًا.';

alter table public.court_cases enable row level security;
revoke all on public.court_cases from anon, authenticated;
grant select, insert, update, delete on public.court_cases to authenticated;
drop policy if exists "court_cases: admin" on public.court_cases;
create policy "court_cases: admin" on public.court_cases for all to authenticated
  using ((select public.is_app_admin())) with check ((select public.is_app_admin()));

-- يتحقق من بنية القضية قبل الحفظ، ويرسل سببًا واضحًا للوحة الإدارة.
create or replace function public.court_cases_validate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
  e jsonb;
  v_keys text[] := '{}';
  v_kind text;
  v_count jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(new.roles) <> 'array' or jsonb_array_length(new.roles) < 4 or jsonb_array_length(new.roles) > 12 then
    raise exception 'BAD_CASE: الأدوار من 4 إلى 12.';
  end if;
  for r in select * from jsonb_array_elements(new.roles) loop
    v_kind := r->>'kind';
    if v_kind is null or v_kind not in ('accused', 'prosecutor', 'lawyer', 'detective', 'witness') then
      raise exception 'BAD_CASE: نوع دور غير معروف (%).', coalesce(v_kind, '-');
    end if;
    if char_length(btrim(coalesce(r->>'name', ''))) < 2 then
      raise exception 'BAD_CASE: كل دور يحتاج اسمًا.';
    end if;
    if char_length(btrim(coalesce(r->>'secret', ''))) < 5 then
      raise exception 'BAD_CASE: دور «%» يحتاج معلومة سرية.', r->>'name';
    end if;
    if coalesce(r->>'key', '') = '' or (r->>'key') = any (v_keys) then
      raise exception 'BAD_CASE: مفاتيح الأدوار يجب أن تكون مختلفة.';
    end if;
    v_keys := array_append(v_keys, r->>'key');
    v_count := jsonb_set(v_count, array[v_kind], to_jsonb(coalesce((v_count->>v_kind)::int, 0) + 1));
    if v_kind in ('accused', 'prosecutor', 'lawyer') and coalesce((r->>'optional')::boolean, false) then
      raise exception 'BAD_CASE: المتهم والمدعي والمحامي أدوار أساسية.';
    end if;
  end loop;
  if coalesce((v_count->>'accused')::int, 0) <> 1 or coalesce((v_count->>'prosecutor')::int, 0) <> 1 or coalesce((v_count->>'lawyer')::int, 0) <> 1 then
    raise exception 'BAD_CASE: القضية تحتاج متهمًا واحدًا ومدعيًا واحدًا ومحاميًا واحدًا.';
  end if;
  if (select count(*) from jsonb_array_elements(new.roles) x where not coalesce((x->>'optional')::boolean, false)) < 4 then
    raise exception 'BAD_CASE: تحتاج 4 أدوار أساسية على الأقل (مع شاهد أو محقق).';
  end if;
  if jsonb_typeof(new.evidence) <> 'array' or jsonb_array_length(new.evidence) < 2 or jsonb_array_length(new.evidence) > 15 then
    raise exception 'BAD_CASE: الأدلة من 2 إلى 15.';
  end if;
  for e in select * from jsonb_array_elements(new.evidence) loop
    if coalesce((e->>'stage')::int, 0) not between 1 and 3 then
      raise exception 'BAD_CASE: جولة الدليل 1 أو 2 أو 3.';
    end if;
    if char_length(btrim(coalesce(e->>'title', ''))) < 2 or char_length(btrim(coalesce(e->>'text', ''))) < 5 then
      raise exception 'BAD_CASE: كل دليل يحتاج عنوانًا ونصًا.';
    end if;
  end loop;
  if not exists (select 1 from jsonb_array_elements(new.evidence) ev where (ev->>'stage')::int = 1) then
    raise exception 'BAD_CASE: تحتاج دليلًا واحدًا على الأقل في الجولة الأولى.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists court_cases_validate on public.court_cases;
create trigger court_cases_validate before insert or update on public.court_cases
  for each row execute function public.court_cases_validate();

-- بيانات المباراة الخاصة (لا يقرؤها أحد إلا عبر الدوال) ----------------------------

create table if not exists public.room_court (
  room_id   uuid primary key references public.game_rooms (id) on delete cascade,
  case_id   uuid references public.court_cases (id) on delete set null,
  guilty    boolean not null,
  truth     text not null,
  evidence  jsonb not null
);
create table if not exists public.room_court_roles (
  room_id     uuid not null references public.game_rooms (id) on delete cascade,
  player_id   uuid not null references public.room_players (id) on delete cascade,
  role_key    text not null,
  kind        text not null,
  name        text not null,
  brief       text,
  secret      text,
  later       text,
  later_stage int,
  primary key (room_id, player_id)
);
create table if not exists public.room_court_votes (
  room_id   uuid not null references public.game_rooms (id) on delete cascade,
  player_id uuid not null references public.room_players (id) on delete cascade,
  guilty    boolean not null,
  at        timestamptz not null default now(),
  primary key (room_id, player_id)
);
alter table public.room_court enable row level security;
alter table public.room_court_roles enable row level security;
alter table public.room_court_votes enable row level security;
revoke all on public.room_court, public.room_court_roles, public.room_court_votes from anon, authenticated;

-- الدوال ---------------------------------------------------------------------------

-- عدد اللاعبين الذي تناسبه القضية: الأدوار الأساسية حدّها الأدنى (ولا يقل عن 4).
create or replace function public.court_case_min(p_roles jsonb)
returns int
language sql
immutable
as $$
  select greatest(4, count(*)::int) from jsonb_array_elements(p_roles) x where not coalesce((x->>'optional')::boolean, false);
$$;

-- قائمة القضايا للمضيف: بلا أسرار ولا حقيقة.
create or replace function public.court_cases_list()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'title', c.title, 'category', c.category, 'difficulty', c.difficulty,
           'summary', c.summary, 'min', public.court_case_min(c.roles), 'roles', jsonb_array_length(c.roles))
         order by c.difficulty, c.title), '[]'::jsonb)
    from public.court_cases c
   where c.is_active;
$$;
revoke all on function public.court_cases_list() from public, anon;
grant execute on function public.court_cases_list() to authenticated;

create or replace function public.court_kind_ar(p_kind text)
returns text
language sql
immutable
as $$
  select case p_kind when 'accused' then 'المتهم' when 'prosecutor' then 'المدعي العام' when 'lawyer' then 'المحامي'
                     when 'detective' then 'المحقق' when 'witness' then 'شاهد' else 'محلّف' end;
$$;

-- يبدأ المحاكمة: يختار القضية، يوزّع الأدوار، ويبني مراحل الجلسة.
-- p_settings: {case_id, host_plays, question_seconds, closing_seconds, vote_seconds}
create or replace function public.court_start(p_room_id uuid, p_settings jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_case public.court_cases%rowtype;
  v_host_plays boolean := coalesce((p_settings->>'host_plays')::boolean, true);
  v_players uuid[];
  v_n int;
  v_used jsonb;
  v_q int := coalesce((p_settings->>'question_seconds')::int, 180);
  v_c int := coalesce((p_settings->>'closing_seconds')::int, 60);
  v_v int := coalesce((p_settings->>'vote_seconds')::int, 60);
  v_roles jsonb := '[]'::jsonb;
  v_r jsonb;
  v_optional_slots int;
  v_steps jsonb := '[]'::jsonb;
  v_cast jsonb := '[]'::jsonb;
  v_stage int;
  v_settings jsonb;
  i int;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  if not exists (select 1 from public.game_rooms where id = p_room_id and status = 'playing') then
    return jsonb_build_object('ok', false, 'reason', 'NOT_PLAYING');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NO_STATE');
  end if;
  if v_sd->>'game' = 'court' and coalesce(v_sd->>'phase', '') <> '' then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_STARTED');
  end if;
  if v_q not in (0, 120, 180, 300) then v_q := 180; end if;
  if v_c not in (0, 45, 60, 90) then v_c := 60; end if;
  if v_v not in (0, 30, 60, 90) then v_v := 60; end if;

  select array_agg(p.id order by random()) into v_players
    from public.room_players p
   where p.room_id = p_room_id and (v_host_plays or not p.is_host);
  v_n := coalesce(array_length(v_players, 1), 0);
  if v_n < 4 then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ENOUGH_PLAYERS');
  end if;
  if v_n > 12 then
    return jsonb_build_object('ok', false, 'reason', 'TOO_MANY_PLAYERS');
  end if;

  -- القضية: المختارة، أو قضية عشوائية تناسب العدد ولم تُلعب في هذه الغرفة.
  v_used := coalesce(v_sd->'last_settings'->'used_cases', '[]'::jsonb);
  if nullif(p_settings->>'case_id', '') is not null then
    select * into v_case from public.court_cases where id = (p_settings->>'case_id')::uuid and is_active;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'NO_CASE');
    end if;
  else
    select * into v_case from public.court_cases c
     where c.is_active and public.court_case_min(c.roles) <= v_n
     order by (v_used ? c.id::text), random()
     limit 1;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'NO_CASE');
    end if;
  end if;
  if public.court_case_min(v_case.roles) > v_n then
    return jsonb_build_object('ok', false, 'reason', 'CASE_NEEDS_MORE', 'min', public.court_case_min(v_case.roles));
  end if;

  -- الأدوار: الأساسية كلها، ثم الاختيارية بالترتيب حسب المقاعد، وتُحفظ بترتيب القضية.
  v_optional_slots := v_n - (select count(*) from jsonb_array_elements(v_case.roles) x where not coalesce((x->>'optional')::boolean, false));
  for v_r in select x from jsonb_array_elements(v_case.roles) with ordinality t(x, o) order by o loop
    if coalesce((v_r->>'optional')::boolean, false) then
      if v_optional_slots <= 0 then
        continue;
      end if;
      v_optional_slots := v_optional_slots - 1;
    end if;
    v_roles := v_roles || jsonb_build_array(v_r);
  end loop;

  delete from public.room_court where room_id = p_room_id;
  delete from public.room_court_roles where room_id = p_room_id;
  delete from public.room_court_votes where room_id = p_room_id;
  insert into public.room_court (room_id, case_id, guilty, truth, evidence)
  values (p_room_id, v_case.id, v_case.guilty, v_case.truth, v_case.evidence);

  for i in 1..v_n loop
    v_r := v_roles->(i - 1);
    if v_r is null then
      insert into public.room_court_roles (room_id, player_id, role_key, kind, name, brief, secret)
      values (p_room_id, v_players[i], 'juror-' || i, 'juror', 'محلّف',
              'عضو في هيئة المحلفين.',
              'لا تعرف عن القضية إلا ما يُعرض في الجلسة. اسأل المتهم والشهود، وانتبه للتناقض بين الأقوال والأدلة، ثم صوّت بالعدل. كل صوت يطابق الحقيقة = 100 نقطة.');
    else
      insert into public.room_court_roles (room_id, player_id, role_key, kind, name, brief, secret, later, later_stage)
      values (p_room_id, v_players[i], v_r->>'key', v_r->>'kind', btrim(v_r->>'name'),
              nullif(btrim(coalesce(v_r->>'brief', '')), ''), btrim(v_r->>'secret'),
              nullif(btrim(coalesce(v_r->>'later', '')), ''),
              case when nullif(btrim(coalesce(v_r->>'later', '')), '') is null then null
                   else greatest(1, least(3, coalesce((v_r->>'later_stage')::int, 2))) end);
    end if;
  end loop;

  -- الطاقم المعلن: من يلعب أي دور (بلا الأسرار)، بترتيب الأدوار.
  select coalesce(jsonb_agg(jsonb_build_object('player_id', r.player_id, 'player_name', p.player_name, 'kind', r.kind, 'name', r.name, 'brief', r.brief)
           order by case r.kind when 'accused' then 1 when 'prosecutor' then 2 when 'lawyer' then 3 when 'detective' then 4 when 'witness' then 5 else 6 end, r.role_key), '[]'::jsonb)
    into v_cast
    from public.room_court_roles r join public.room_players p on p.id = r.player_id
   where r.room_id = p_room_id;

  -- المراحل.
  v_steps := jsonb_build_array(jsonb_build_object('phase', 'intro'));
  for v_stage in select distinct (e->>'stage')::int s from jsonb_array_elements(v_case.evidence) e order by 1 loop
    v_steps := v_steps
      || jsonb_build_array(jsonb_build_object('phase', 'evidence', 'stage', v_stage))
      || jsonb_build_array(jsonb_build_object('phase', 'question', 'stage', v_stage, 'seconds', v_q));
  end loop;
  v_steps := v_steps || jsonb_build_array(
    jsonb_build_object('phase', 'closing', 'side', 'prosecutor', 'seconds', v_c),
    jsonb_build_object('phase', 'closing', 'side', 'lawyer', 'seconds', v_c),
    jsonb_build_object('phase', 'vote', 'seconds', v_v),
    jsonb_build_object('phase', 'verdict'),
    jsonb_build_object('phase', 'over'));

  v_settings := jsonb_build_object('case_id', nullif(p_settings->>'case_id', ''), 'host_plays', v_host_plays,
    'question_seconds', v_q, 'closing_seconds', v_c, 'vote_seconds', v_v,
    'used_cases', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(v_used || jsonb_build_array(v_case.id::text)) x));

  update public.room_game_state
     set active_question_id = null,
         state_data = jsonb_build_object(
           'game', 'court', 'phase', 'intro', 'step', 0, 'steps', v_steps, 'stage', 0, 'ends_at', null,
           'case', jsonb_build_object('id', v_case.id, 'title', v_case.title, 'category', v_case.category, 'intro', v_case.intro, 'difficulty', v_case.difficulty),
           'cast', v_cast, 'evidence', '[]'::jsonb, 'stand', null, 'objection', null, 'objections', '{}'::jsonb,
           'votes_count', 0, 'voters_count', 0, 'verdict', null, 'truth', null, 'points', null, 'cards', null,
           'settings', v_settings, 'last_settings', null)
   where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'case', v_case.title);
end;
$$;
revoke all on function public.court_start(uuid, jsonb) from public, anon;
grant execute on function public.court_start(uuid, jsonb) to authenticated;

-- المرحلة التالية. p_step يمنع تكرار الضغطة: لا ينتقل إلا من المرحلة التي يراها المضيف.
create or replace function public.court_next(p_room_id uuid, p_step int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
  v_court public.room_court%rowtype;
  v_step int;
  v_next jsonb;
  v_phase text;
  v_secs int;
  v_g int;
  v_i int;
  v_verdict boolean;
  v_points jsonb := '[]'::jsonb;
  v_row record;
  v_pts int;
  v_why text[];
  v_vote boolean;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_STARTED');
  end if;
  v_step := coalesce((v_sd->>'step')::int, 0);
  if p_step is not null and p_step <> v_step then
    return jsonb_build_object('ok', true, 'stale', true);
  end if;
  if v_sd->>'phase' = 'over' then
    return jsonb_build_object('ok', false, 'reason', 'OVER');
  end if;
  v_next := v_sd->'steps'->(v_step + 1);
  if v_next is null then
    return jsonb_build_object('ok', false, 'reason', 'OVER');
  end if;
  v_phase := v_next->>'phase';
  v_secs := coalesce((v_next->>'seconds')::int, 0);
  select * into v_court from public.room_court where room_id = p_room_id;

  v_sd := v_sd || jsonb_build_object('step', v_step + 1, 'phase', v_phase, 'objection', null,
    'ends_at', case when v_secs > 0 then to_jsonb(now() + make_interval(secs => v_secs)) else 'null'::jsonb end,
    'side', v_next->'side');

  if v_phase = 'evidence' then
    v_sd := v_sd || jsonb_build_object('stage', (v_next->>'stage')::int, 'stand', null,
      'evidence', (v_sd->'evidence') || coalesce((
        select jsonb_agg(jsonb_build_object('stage', (e->>'stage')::int, 'title', e->>'title', 'text', e->>'text', 'icon', coalesce(nullif(e->>'icon', ''), '📄'))
                         order by o)
          from jsonb_array_elements(v_court.evidence) with ordinality t(e, o)
         where (e->>'stage')::int = (v_next->>'stage')::int), '[]'::jsonb));
  elsif v_phase = 'closing' then
    v_sd := v_sd || jsonb_build_object('stand', null);
  elsif v_phase = 'vote' then
    delete from public.room_court_votes where room_id = p_room_id;
    select count(*) into v_i from public.room_court_roles where room_id = p_room_id and kind <> 'accused';
    v_sd := v_sd || jsonb_build_object('stand', null, 'votes_count', 0, 'voters_count', v_i);
  elsif v_phase = 'verdict' then
    select count(*) filter (where guilty), count(*) filter (where not guilty) into v_g, v_i
      from public.room_court_votes where room_id = p_room_id;
    v_verdict := v_g > v_i;  -- التعادل لصالح المتهم
    v_sd := v_sd || jsonb_build_object('verdict', jsonb_build_object('guilty', v_verdict, 'votes_guilty', v_g, 'votes_innocent', v_i));
  elsif v_phase = 'over' then
    v_verdict := coalesce((v_sd->'verdict'->>'guilty')::boolean, false);
    perform set_config('alosh.trusted', 'on', true);
    for v_row in
      select r.player_id, r.kind, r.name, p.player_name, v.guilty vote
        from public.room_court_roles r
        join public.room_players p on p.id = r.player_id
        left join public.room_court_votes v on v.room_id = r.room_id and v.player_id = r.player_id
       where r.room_id = p_room_id
    loop
      v_pts := 0;
      v_why := '{}';
      v_vote := v_row.vote;
      if v_row.kind <> 'accused' and v_vote is not null and v_vote = v_court.guilty then
        v_pts := v_pts + 100;
        v_why := array_append(v_why, 'صوت صحيح');
      end if;
      if v_row.kind = 'accused' and not v_verdict then
        v_pts := v_pts + 300;
        v_why := array_append(v_why, 'نجا من الإدانة');
      elsif v_row.kind in ('prosecutor', 'detective', 'witness') and v_verdict = v_court.guilty then
        v_pts := v_pts + 200;
        v_why := array_append(v_why, 'تحققت العدالة');
      elsif v_row.kind = 'lawyer' then
        if not v_verdict then
          v_pts := v_pts + 200;
          v_why := array_append(v_why, 'برّأ موكله');
        end if;
        if v_verdict = v_court.guilty then
          v_pts := v_pts + 100;
          v_why := array_append(v_why, 'الحكم صحيح');
        end if;
      end if;
      if v_pts > 0 then
        update public.room_players set score = score + v_pts where id = v_row.player_id;
      end if;
      v_points := v_points || jsonb_build_array(jsonb_build_object(
        'player_id', v_row.player_id, 'player_name', v_row.player_name, 'kind', v_row.kind, 'name', v_row.name,
        'vote', v_vote, 'points', v_pts, 'why', to_jsonb(v_why)));
    end loop;
    select coalesce(jsonb_agg(x order by (x->>'points')::int desc, x->>'player_name'), '[]'::jsonb) into v_points from jsonb_array_elements(v_points) x;
    v_sd := v_sd || jsonb_build_object(
      'truth', jsonb_build_object('guilty', v_court.guilty, 'text', v_court.truth, 'correct', v_verdict = v_court.guilty),
      'points', v_points,
      -- كشف البطاقات: أسرار كل الأدوار بعد النهاية.
      'cards', (select coalesce(jsonb_agg(jsonb_build_object('player_name', p.player_name, 'kind', r.kind, 'name', r.name, 'secret', r.secret, 'later', r.later)
                  order by case r.kind when 'accused' then 1 when 'prosecutor' then 2 when 'lawyer' then 3 when 'detective' then 4 when 'witness' then 5 else 6 end, r.role_key), '[]'::jsonb)
                  from public.room_court_roles r join public.room_players p on p.id = r.player_id
                 where r.room_id = p_room_id and r.kind <> 'juror'),
      'evidence', coalesce((
        select jsonb_agg(jsonb_build_object('stage', (e->>'stage')::int, 'title', e->>'title', 'text', e->>'text', 'icon', coalesce(nullif(e->>'icon', ''), '📄')) order by o)
          from jsonb_array_elements(v_court.evidence) with ordinality t(e, o)), v_sd->'evidence'));
  end if;

  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'phase', v_phase);
end;
$$;
revoke all on function public.court_next(uuid, int) from public, anon;
grant execute on function public.court_next(uuid, int) to authenticated;

-- المضيف يستدعي شخصًا للمنصة (أو يفرغها بـ null) أثناء الاستجواب.
create or replace function public.court_stand(p_room_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' or v_sd->>'phase' <> 'question' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  if p_player_id is not null and not exists (select 1 from public.room_court_roles where room_id = p_room_id and player_id = p_player_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  update public.room_game_state set state_data = state_data || jsonb_build_object('stand', p_player_id) where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_stand(uuid, uuid) from public, anon;
grant execute on function public.court_stand(uuid, uuid) to authenticated;

-- التصويت: كل من في القضية إلا المتهم، ويقدر يغيّر صوته حتى يُعلن الحكم.
create or replace function public.court_vote(p_room_id uuid, p_guilty boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_kind text;
  v_sd jsonb;
  v_count int;
begin
  if v_me is null or p_guilty is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' or v_sd->>'phase' <> 'vote' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  select kind into v_kind from public.room_court_roles where room_id = p_room_id and player_id = v_me;
  if v_kind is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_CASE');
  end if;
  if v_kind = 'accused' then
    return jsonb_build_object('ok', false, 'reason', 'ACCUSED');
  end if;
  insert into public.room_court_votes (room_id, player_id, guilty) values (p_room_id, v_me, p_guilty)
  on conflict (room_id, player_id) do update set guilty = excluded.guilty, at = now();
  select count(*) into v_count from public.room_court_votes where room_id = p_room_id;
  update public.room_game_state set state_data = state_data || jsonb_build_object('votes_count', v_count) where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_vote(uuid, boolean) from public, anon;
grant execute on function public.court_vote(uuid, boolean) to authenticated;

-- «اعتراض!»: للمدعي والمحامي، مرتين في المباراة، أثناء الاستجواب والمرافعات.
create or replace function public.court_object(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_kind text;
  v_name text;
  v_sd jsonb;
  v_used int;
begin
  select r.kind, p.player_name into v_kind, v_name
    from public.room_court_roles r join public.room_players p on p.id = r.player_id
   where r.room_id = p_room_id and r.player_id = v_me;
  if v_kind is null or v_kind not in ('prosecutor', 'lawyer') then
    return jsonb_build_object('ok', false, 'reason', 'NOT_ALLOWED');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'phase' not in ('question', 'closing') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_PHASE');
  end if;
  v_used := coalesce((v_sd->'objections'->>v_me::text)::int, 0);
  if v_used >= 2 then
    return jsonb_build_object('ok', false, 'reason', 'NO_OBJECTIONS');
  end if;
  if v_sd->'objection' is not null and v_sd->'objection' <> 'null'::jsonb
     and (v_sd->'objection'->>'at')::timestamptz > now() - interval '6 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'BUSY');
  end if;
  update public.room_game_state
     set state_data = state_data || jsonb_build_object(
       'objection', jsonb_build_object('kind', v_kind, 'name', v_name, 'at', now(), 'n', v_used + 1),
       'objections', coalesce(state_data->'objections', '{}'::jsonb) || jsonb_build_object(v_me::text, v_used + 1))
   where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'left', 1 - v_used);
end;
$$;
revoke all on function public.court_object(uuid) from public, anon;
grant execute on function public.court_object(uuid) to authenticated;

-- بطاقتي: دوري ومعلومتي السرية، والمعلومة اللاحقة بعد وصول جولتها، وصوتي.
create or replace function public.court_my_card(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.my_player_id(p_room_id);
  v_sd jsonb;
  v_r public.room_court_roles%rowtype;
  v_vote boolean;
  v_stage int;
begin
  if v_me is null then
    return null;
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id;
  if v_sd->>'game' is distinct from 'court' then
    return jsonb_build_object('started', false);
  end if;
  select * into v_r from public.room_court_roles where room_id = p_room_id and player_id = v_me;
  if not found then
    return jsonb_build_object('started', false, 'late', coalesce(v_sd->>'phase', '') <> '');
  end if;
  v_stage := coalesce((v_sd->>'stage')::int, 0);
  select guilty into v_vote from public.room_court_votes where room_id = p_room_id and player_id = v_me;
  return jsonb_build_object(
    'started', true, 'kind', v_r.kind, 'kind_ar', public.court_kind_ar(v_r.kind), 'name', v_r.name, 'brief', v_r.brief,
    'secret', v_r.secret,
    'later', case when v_r.later is not null and v_stage >= v_r.later_stage then v_r.later else null end,
    'later_pending', v_r.later is not null and v_stage < v_r.later_stage,
    'vote', v_vote,
    'objections_left', case when v_r.kind in ('prosecutor', 'lawyer') then 2 - coalesce((v_sd->'objections'->>v_me::text)::int, 0) else 0 end);
end;
$$;
revoke all on function public.court_my_card(uuid) from public, anon;
grant execute on function public.court_my_card(uuid) to authenticated;

-- مباراة جديدة في نفس الغرفة: تبقى الإعدادات والقضايا التي لُعبت.
create or replace function public.court_reset(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sd jsonb;
begin
  if not (public.is_room_host(p_room_id) or public.is_app_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HOST');
  end if;
  select state_data into v_sd from public.room_game_state where room_id = p_room_id for update;
  if v_sd->>'game' is distinct from 'court' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_STARTED');
  end if;
  delete from public.room_court where room_id = p_room_id;
  delete from public.room_court_roles where room_id = p_room_id;
  delete from public.room_court_votes where room_id = p_room_id;
  update public.room_game_state
     set state_data = jsonb_build_object('last_settings', (v_sd->'settings') - 'case_id')
   where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.court_reset(uuid) from public, anon;
grant execute on function public.court_reset(uuid) to authenticated;

revoke all on function public.court_case_min(jsonb), public.court_kind_ar(text) from public, anon;
revoke all on function public.court_cases_validate() from public, anon, authenticated;

-- اللعبة في جدول الألعاب ----------------------------------------------------------

insert into public.games (slug, title_ar, description_ar, min_players, max_players, is_active, home_status, sort_order, icon, category)
values ('court', 'المحكمة', 'قضية غامضة وأدلة تظهر بالتدريج. استجوبوا المتهم والشهود، وترافعوا، ثم احكموا: مذنب أم بريء؟',
        4, 12, true, 'live', 60, '⚖️', 'talk')
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
