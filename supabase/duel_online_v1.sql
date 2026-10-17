-- =============================================================================
-- «منافسة العش» أونلاين، الإصدار 1: لاعبان، كل واحد من جواله، والخادم يحسم كل شيء.
-- تشغيله مرة ثانية آمن.
--
-- 1) الغرفة: غرفة عادية من game_rooms للعبة nest-duel، تقبل لاعبين فقط (ROOM_FULL للثالث).
--    عند دخول الثاني تبدأ مباراة: عد 5 ثوانٍ ثم 60 ثانية لعب، بساعة الخادم.
-- 2) اللعب: سلسلة تحديات قصيرة، نفسها للاثنين وبالترتيب نفسه (ذاكرة، لون الكلمة، حساب، الحرف المختلف).
--    كل إجابة صحيحة = نقطة. الإجابة تُحسم في duel_answer، ولا يعرف المتصفح إجابة أي تحدٍ.
-- 3) النهاية: أول من يصل للهدف (10) يفوز فورًا، وإلا عند انتهاء الوقت الأعلى نقاطًا، والتساوي تعادل.
--    duel_settle يغلق المباراة بعد ends_at بساعة الخادم، ويطلبه أي جوال.
-- 4) «إعادة التحدي»: duel_rematch من كل لاعب، وعند الصوتين مباراة جديدة في الغرفة نفسها.
-- الجداول للقراءة فقط من المتصفح، والبذرة في جدول بلا صلاحيات.
-- =============================================================================

-- اللعبة في جدول الألعاب (الغرف تحتاجها). 14 حدّ اللعب على جوال واحد، والغرفة الأونلاين تُقفل عند 2.
insert into public.games (slug, title_ar, description_ar, min_players, max_players, is_active, home_status, icon, category)
values ('nest-duel', 'منافسة العش',
        'بطولة مواجهات سريعة 1 ضد 1 على جوال واحد، أو مواجهة أونلاين كل لاعب من جواله.',
        2, 14, true, 'live', '⚡', 'classic')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- الجداول
-- ---------------------------------------------------------------------
create table if not exists public.duel_matches (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.game_rooms (id) on delete cascade,
  round_no      int  not null default 1,
  status        text not null default 'live' check (status in ('live', 'over')),
  target        int  not null default 10,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  winner_id     uuid references public.room_players (id) on delete set null,
  end_reason    text check (end_reason in ('target', 'time')),
  rematch_votes uuid[] not null default '{}',
  created_at    timestamptz not null default now(),
  unique (room_id, round_no)
);
create index if not exists duel_matches_room_idx on public.duel_matches (room_id, round_no desc);

create table if not exists public.duel_scores (
  match_id  uuid not null references public.duel_matches (id) on delete cascade,
  player_id uuid not null references public.room_players (id) on delete cascade,
  points    int  not null default 0,
  idx       int  not null default 0,
  tries     int  not null default 0,
  issued_at timestamptz not null,
  last_at   timestamptz,
  primary key (match_id, player_id)
);

create table if not exists public.duel_secrets (
  match_id uuid primary key references public.duel_matches (id) on delete cascade,
  seed     text not null default md5(random()::text || clock_timestamp()::text)
);

alter table public.duel_matches enable row level security;
alter table public.duel_scores  enable row level security;
alter table public.duel_secrets enable row level security;
revoke all on public.duel_matches, public.duel_scores, public.duel_secrets from anon, authenticated;
grant select on public.duel_matches, public.duel_scores to authenticated;

-- اللاعب الحالي في الغرفة، أو null.
create or replace function public.duel_me(p_room uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.room_players where room_id = p_room and user_id = auth.uid() limit 1
$$;

drop policy if exists "duel matches: room reads" on public.duel_matches;
create policy "duel matches: room reads" on public.duel_matches for select
  using (public.duel_me(room_id) is not null);
drop policy if exists "duel scores: room reads" on public.duel_scores;
create policy "duel scores: room reads" on public.duel_scores for select
  using (exists (select 1 from public.duel_matches m where m.id = match_id and public.duel_me(m.room_id) is not null));

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['duel_matches', 'duel_scores'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- الغرفة: لاعبان فقط، ومباراة تبدأ عند الثاني
-- ---------------------------------------------------------------------
create or replace function public.duel_slug(p_room uuid)
returns text language sql stable security definer set search_path = public as $$
  select g.slug from public.game_rooms r join public.games g on g.id = r.game_id where r.id = p_room
$$;

-- مباراة جديدة: عد 5 ثوانٍ ثم 60 ثانية، بساعة الخادم.
create or replace function public.duel_new_match(p_room uuid, p_round int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_start timestamptz := now() + interval '5 seconds';
begin
  insert into public.duel_matches (room_id, round_no, starts_at, ends_at)
  values (p_room, p_round, v_start, v_start + interval '60 seconds')
  returning id into v_id;
  insert into public.duel_secrets (match_id) values (v_id);
  insert into public.duel_scores (match_id, player_id, issued_at)
    select v_id, p.id, v_start from public.room_players p where p.room_id = p_room order by p.joined_at limit 2;
  return v_id;
end $$;

create or replace function public.duel_before_join()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.duel_slug(new.room_id) = 'nest-duel'
     and (select count(*) from public.room_players where room_id = new.room_id) >= 2 then
    raise exception 'ROOM_FULL';
  end if;
  return new;
end $$;

create or replace function public.duel_after_join()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.duel_slug(new.room_id) = 'nest-duel'
     and (select count(*) from public.room_players where room_id = new.room_id) = 2
     and not exists (select 1 from public.duel_matches where room_id = new.room_id) then
    perform public.duel_new_match(new.room_id, 1);
    update public.game_rooms set status = 'playing' where id = new.room_id and status = 'lobby';
  end if;
  return new;
end $$;

drop trigger if exists duel_before_join on public.room_players;
create trigger duel_before_join before insert on public.room_players
  for each row execute function public.duel_before_join();
drop trigger if exists duel_after_join on public.room_players;
create trigger duel_after_join after insert on public.room_players
  for each row execute function public.duel_after_join();

-- ---------------------------------------------------------------------
-- التحديات: التحدي رقم i يُشتق من البذرة، فهو نفسه للاثنين. min_ms = أقل زمن يقدر عليه إنسان.
-- ---------------------------------------------------------------------
create or replace function public.duel_challenge(p_seed text, p_i int)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  b bytea := decode(md5(p_seed || ':' || p_i), 'hex');
  seq text := '';
  a int; c int; ans int; base int; op int; word int; ink int; pr int; pos int; flip boolean;
  common_l text[] := array['ب', 'ج', 'س', 'ص', 'ط', 'ع', 'ف', 'د', 'ر'];
  odd_l    text[] := array['ت', 'خ', 'ش', 'ض', 'ظ', 'غ', 'ق', 'ذ', 'ز'];
begin
  case get_byte(b, 0) % 4
  when 0 then
    -- الذاكرة: 4 ألوان (1..4) تظهر ثانية ونصف، ثم تُعاد بالترتيب.
    for k in 1..4 loop seq := seq || (get_byte(b, k) % 4 + 1)::text; end loop;
    return jsonb_build_object('kind', 'memory', 'show', seq, 'show_ms', 1500, 'answer', seq, 'min_ms', 1900);
  when 1 then
    -- لون الكلمة: اسم لون مكتوب بحبر لون آخر، والمطلوب لون الحبر.
    word := get_byte(b, 5) % 4 + 1;
    ink := (word + get_byte(b, 6) % 3) % 4 + 1;
    return jsonb_build_object('kind', 'ink', 'word', word, 'ink', ink, 'answer', ink::text, 'min_ms', 300);
  when 2 then
    -- حساب سريع: 4 خيارات متتالية، والصحيح في موضع عشوائي بينها.
    op := get_byte(b, 9) % 3;
    if op = 2 then
      a := 2 + get_byte(b, 7) % 8; c := 2 + get_byte(b, 8) % 8; ans := a * c;
    else
      a := 2 + get_byte(b, 7) % 18; c := 2 + get_byte(b, 8) % 18;
      if op = 1 and c > a then ans := a; a := c; c := ans; end if;
      ans := case when op = 0 then a + c else a - c end;
    end if;
    base := greatest(0, ans - get_byte(b, 10) % 4);
    return jsonb_build_object('kind', 'math', 'a', a, 'b', c, 'op', (array['+', '−', '×'])[op + 1],
      'options', jsonb_build_array(base, base + 1, base + 2, base + 3), 'answer', ans::text, 'min_ms', 400);
  else
    -- الحرف المختلف: 12 خانة بالحرف نفسه إلا واحدة.
    pr := get_byte(b, 11) % 9 + 1;
    flip := get_byte(b, 12) % 2 = 1;
    pos := get_byte(b, 13) % 12;
    return jsonb_build_object('kind', 'odd',
      'common', case when flip then odd_l[pr] else common_l[pr] end,
      'odd', case when flip then common_l[pr] else odd_l[pr] end,
      'odd_at', pos, 'answer', pos::text, 'min_ms', 300);
  end case;
end $$;

-- ما يصل للمتصفح: التحدي بلا إجابته ولا min_ms. «الحرف المختلف» يصل قائمة خانات جاهزة.
create or replace function public.duel_public(p_ch jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare cells jsonb := '[]'::jsonb;
begin
  if p_ch->>'kind' = 'odd' then
    for k in 0..11 loop
      cells := cells || to_jsonb(case when k = (p_ch->>'odd_at')::int then p_ch->>'odd' else p_ch->>'common' end);
    end loop;
    return jsonb_build_object('kind', 'odd', 'cells', cells);
  end if;
  return p_ch - 'answer' - 'min_ms';
end $$;

-- ---------------------------------------------------------------------
-- الإجابة، والحسم بالوقت، والحالة الحالية، وإعادة التحدي، وساعة الخادم
-- ---------------------------------------------------------------------
create or replace function public.duel_settle(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.duel_matches%rowtype; v_best int; v_second int; v_top uuid;
begin
  select * into m from public.duel_matches where id = p_match for update;
  if not found or public.duel_me(m.room_id) is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM');
  end if;
  if m.status = 'over' then return jsonb_build_object('ok', true, 'already', true); end if;
  if now() < m.ends_at then return jsonb_build_object('ok', false, 'reason', 'NOT_YET', 'ends_at', m.ends_at); end if;

  select player_id, points into v_top, v_best from public.duel_scores where match_id = p_match order by points desc, last_at asc nulls last limit 1;
  select points into v_second from public.duel_scores where match_id = p_match order by points desc offset 1 limit 1;
  update public.duel_matches
     set status = 'over', end_reason = 'time',
         winner_id = case when v_best = coalesce(v_second, -1) then null else v_top end
   where id = p_match;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.duel_answer(p_match uuid, p_idx int, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.duel_matches%rowtype;
  s public.duel_scores%rowtype;
  v_me uuid; v_seed text; v_ch jsonb; v_ok boolean;
begin
  -- قفل المباراة يرتّب اللاعبين: من يصل للهدف أولًا على الخادم يفوز.
  select * into m from public.duel_matches where id = p_match for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'NO_MATCH'); end if;
  v_me := public.duel_me(m.room_id);
  if v_me is null then return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM'); end if;
  if m.status = 'over' then return jsonb_build_object('ok', false, 'reason', 'OVER'); end if;
  if now() < m.starts_at then return jsonb_build_object('ok', false, 'reason', 'NOT_STARTED'); end if;
  if now() >= m.ends_at then
    perform public.duel_settle(p_match);
    return jsonb_build_object('ok', false, 'reason', 'TIME_UP');
  end if;

  select * into s from public.duel_scores where match_id = p_match and player_id = v_me for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'NOT_PLAYING'); end if;
  select seed into v_seed from public.duel_secrets where match_id = p_match;
  if p_idx is distinct from s.idx then
    return jsonb_build_object('ok', false, 'reason', 'STALE', 'idx', s.idx, 'points', s.points,
                              'next', public.duel_public(public.duel_challenge(v_seed, s.idx)));
  end if;
  v_ch := public.duel_challenge(v_seed, s.idx);
  if now() - s.issued_at < make_interval(secs => (v_ch->>'min_ms')::int / 1000.0) then
    return jsonb_build_object('ok', false, 'reason', 'TOO_FAST',
                              'wait_ms', ceil(extract(epoch from (s.issued_at + make_interval(secs => (v_ch->>'min_ms')::int / 1000.0) - now())) * 1000));
  end if;

  -- خطأ أو صح: التحدي التالي في الحالتين، فالتخمين المتكرر لا ينفع.
  v_ok := coalesce(p_answer, '') = v_ch->>'answer';
  update public.duel_scores
     set points = points + v_ok::int, tries = tries + 1, idx = idx + 1, issued_at = now(), last_at = now()
   where match_id = p_match and player_id = v_me
  returning * into s;

  if s.points >= m.target then
    update public.duel_matches set status = 'over', winner_id = v_me, end_reason = 'target', ends_at = now()
     where id = p_match;
  end if;

  return jsonb_build_object('ok', true, 'correct', v_ok, 'points', s.points, 'idx', s.idx,
    'over', s.points >= m.target, 'next', public.duel_public(public.duel_challenge(v_seed, s.idx)));
end $$;

-- عند فتح الشاشة أو الرجوع بعد انقطاع: تحديّ الحالي ونقاطي.
create or replace function public.duel_current(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.duel_matches%rowtype; s public.duel_scores%rowtype; v_me uuid; v_seed text;
begin
  select * into m from public.duel_matches where id = p_match;
  if not found then return jsonb_build_object('ok', false, 'reason', 'NO_MATCH'); end if;
  v_me := public.duel_me(m.room_id);
  select * into s from public.duel_scores where match_id = p_match and player_id = v_me;
  if not found then return jsonb_build_object('ok', false, 'reason', 'NOT_PLAYING'); end if;
  -- قبل البداية لا يُكشف أول تحدٍ.
  if now() < m.starts_at then return jsonb_build_object('ok', true, 'idx', s.idx, 'points', s.points, 'next', null); end if;
  select seed into v_seed from public.duel_secrets where match_id = p_match;
  return jsonb_build_object('ok', true, 'idx', s.idx, 'points', s.points,
                            'next', public.duel_public(public.duel_challenge(v_seed, s.idx)));
end $$;

create or replace function public.duel_rematch(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.duel_matches%rowtype; v_me uuid := public.duel_me(p_room);
begin
  if v_me is null then return jsonb_build_object('ok', false, 'reason', 'NOT_IN_ROOM'); end if;
  select * into m from public.duel_matches where room_id = p_room order by round_no desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'NO_MATCH'); end if;
  if m.status <> 'over' then return jsonb_build_object('ok', false, 'reason', 'NOT_OVER'); end if;
  if (select count(*) from public.room_players where room_id = p_room) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'NO_OPPONENT');
  end if;
  update public.duel_matches set rematch_votes = array(select distinct x from unnest(rematch_votes || v_me) x)
   where id = m.id returning * into m;
  if cardinality(m.rematch_votes) >= 2 then
    perform public.duel_new_match(p_room, m.round_no + 1);
    return jsonb_build_object('ok', true, 'started', true);
  end if;
  return jsonb_build_object('ok', true, 'waiting', true);
end $$;

create or replace function public.duel_server_time()
returns timestamptz language sql stable as $$ select now() $$;

revoke all on function public.duel_new_match(uuid, int) from public, anon, authenticated;
revoke all on function public.duel_challenge(text, int) from public, anon, authenticated;
revoke all on function public.duel_public(jsonb) from public, anon, authenticated;
revoke all on function public.duel_slug(uuid) from public, anon, authenticated;
grant execute on function public.duel_answer(uuid, int, text), public.duel_settle(uuid), public.duel_current(uuid),
  public.duel_rematch(uuid), public.duel_server_time(), public.duel_me(uuid) to authenticated;

create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;
insert into public.app_migrations (name) values ('duel_online_v1.sql') on conflict do nothing;

notify pgrst, 'reload schema';
