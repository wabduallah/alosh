-- =============================================================================
-- «المحكمة»، الإصدار 7. يُشغَّل بعد court_v6.sql، وتشغيله مرة ثانية آمن.
--
-- حكم بلا أصوات: لا نقاط للحكم (لا للمتهم ولا للمدعي والمحامي ولا لمن يفوز بالحقيقة)،
-- ولا يُحسب في إحصاءات القضايا. تبقى نقاط الاعتراضات المقبولة.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.court_timer(uuid,integer,text)') is null then
    raise exception 'شغّل ملفات المحكمة حتى court_v6.sql أولًا، ثم court_v7.sql.';
  end if;
end $$;

-- حكم بلا أصوات: بلا نقاط حكم، وبلا إحصاء.
create or replace function public.court_advance(p_room_id uuid, p_step int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no_votes boolean := false;
  v_sd jsonb;
  v_court public.room_court%rowtype;
  v_step int;
  v_next jsonb;
  v_phase text;
  v_secs int;
  v_g int;
  v_i int;
  v_pp int;
  v_pl int;
  v_best text;
  v_verdict boolean;
  v_points jsonb := '[]'::jsonb;
  v_row record;
  v_pts int;
  v_why text[];
  v_win text;
  v_obj int;
  v_has_suspects boolean;
  v_evening jsonb;
  v_totals jsonb;
  v_t jsonb;
  v_n int;
  v_acc record;
  v_list jsonb := '[]'::jsonb;
  v_correct int;
  v_convicted int;
  v_acquitted int;
  v_all_correct boolean;
  v_self boolean;
begin
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
  v_has_suspects := v_court.suspects is not null and jsonb_array_length(v_court.suspects) > 0;

  v_sd := v_sd || jsonb_build_object('step', v_step + 1, 'phase', v_phase, 'objection', null,
    'ends_at', case when v_secs > 0 then to_jsonb(now() + make_interval(secs => v_secs)) else 'null'::jsonb end,
    'side', v_next->'side', 'queue', '[]'::jsonb, 'asking', null, 'asking_since', null, 'golden', null, 'stand_slot', null);

  if v_phase = 'evidence' then
    v_sd := v_sd || jsonb_build_object('stage', (v_next->>'stage')::int, 'stand', null,
      'evidence', (v_sd->'evidence') || coalesce((
        select jsonb_agg(public.court_ev(e) order by o)
          from jsonb_array_elements(v_court.evidence) with ordinality t(e, o)
         where (e->>'stage')::int = (v_next->>'stage')::int), '[]'::jsonb));
  elsif v_phase = 'closing' then
    v_sd := v_sd || jsonb_build_object('stand', null);
  elsif v_phase = 'vote' then
    delete from public.room_court_votes where room_id = p_room_id;
    select count(*) into v_i from public.room_court_roles where room_id = p_room_id and kind <> 'accused';
    v_sd := v_sd || jsonb_build_object('stand', null, 'votes_count', 0, 'voters_count', v_i);
  elsif v_phase = 'verdict' then
    -- حكم لكل متهم: التعادل لصالحه.
    for v_acc in select r.role_key, r.name, p.player_name, r.player_id from public.room_court_roles r join public.room_players p on p.id = r.player_id
                  where r.room_id = p_room_id and r.kind = 'accused' order by r.role_key loop
      select count(*) filter (where vv), count(*) filter (where not vv)
        into v_g, v_i
        from (select coalesce((verdicts->>v_acc.role_key)::boolean,
                              case when v_acc.role_key = (select min(role_key) from public.room_court_roles where room_id = p_room_id and kind = 'accused') then guilty end) vv
                from public.room_court_votes where room_id = p_room_id) x
       where vv is not null;
      v_list := v_list || jsonb_build_array(jsonb_build_object('key', v_acc.role_key, 'name', v_acc.name, 'player_name', v_acc.player_name,
        'player_id', v_acc.player_id, 'guilty', v_g > v_i, 'votes_guilty', v_g, 'votes_innocent', v_i));
    end loop;
    v_g := coalesce((v_list->0->>'votes_guilty')::int, 0);
    v_i := coalesce((v_list->0->>'votes_innocent')::int, 0);
    v_verdict := coalesce((v_list->0->>'guilty')::boolean, false);
    select count(*) filter (where pleading = 'prosecutor'), count(*) filter (where pleading = 'lawyer') into v_pp, v_pl
      from public.room_court_votes where room_id = p_room_id;
    v_best := case when v_pp > v_pl then 'prosecutor' when v_pl > v_pp then 'lawyer' else null end;
    v_sd := v_sd || jsonb_build_object(
      'verdict', jsonb_build_object('guilty', v_verdict, 'votes_guilty', v_g, 'votes_innocent', v_i, 'list', v_list),
      'pleading', jsonb_build_object('prosecutor', v_pp, 'lawyer', v_pl, 'winner', v_best));
  elsif v_phase = 'over' then
    v_verdict := coalesce((v_sd->'verdict'->>'guilty')::boolean, false);
    v_best := v_sd->'pleading'->>'winner';
    -- الحكم والحقيقة لكل متهم.
    select coalesce(jsonb_agg(x || jsonb_build_object('truth', r.guilty, 'correct', (x->>'guilty')::boolean = r.guilty) order by x->>'key'), '[]'::jsonb)
      into v_list
      from jsonb_array_elements(coalesce(v_sd->'verdict'->'list', '[]'::jsonb)) x
      join public.room_court_roles r on r.room_id = p_room_id and r.role_key = x->>'key';
    v_n := greatest(1, jsonb_array_length(v_list));
    select count(*) filter (where (x->>'correct')::boolean), count(*) filter (where (x->>'guilty')::boolean), count(*) filter (where not (x->>'guilty')::boolean)
      into v_correct, v_convicted, v_acquitted from jsonb_array_elements(v_list) x;
    v_no_votes := not exists (select 1 from jsonb_array_elements(v_list) x
                               where coalesce((x->>'votes_guilty')::int, 0) + coalesce((x->>'votes_innocent')::int, 0) > 0);
    v_all_correct := v_correct = jsonb_array_length(v_list) and v_n > 0 and not v_no_votes;
    perform set_config('alosh.trusted', 'on', true);
    for v_row in
      select r.player_id, r.kind, r.name, r.win, r.goal, r.role_key, p.player_name, v.guilty vote, v.culprit pick, coalesce(v.verdicts, '{}'::jsonb) verdicts
        from public.room_court_roles r
        join public.room_players p on p.id = r.player_id
        left join public.room_court_votes v on v.room_id = r.room_id and v.player_id = r.player_id
       where r.room_id = p_room_id
    loop
      v_pts := 0;
      v_why := '{}';
      -- صوت صحيح لكل متهم.
      v_i := 0;
      if v_row.kind <> 'accused' then
        select count(*) into v_i from jsonb_array_elements(v_list) x
         where coalesce((v_row.verdicts->>(x->>'key'))::boolean, case when x->>'key' = v_list->0->>'key' then v_row.vote end) = (x->>'truth')::boolean;
      end if;
      if v_i > 0 then
        v_pts := v_pts + 100 * v_i;
        v_why := array_append(v_why, case when v_i > 1 then 'صوتان صحيحان' else 'صوت صحيح' end);
      end if;
      if v_has_suspects and v_row.kind <> 'accused' and v_row.pick is not null and v_row.pick = v_court.culprit then
        v_pts := v_pts + 150;
        v_why := array_append(v_why, 'عرف الفاعل');
      end if;
      v_win := public.court_win_of(v_row.kind, v_row.win);
      if v_no_votes then
        null;
      elsif v_row.kind = 'accused' then
        select not (x->>'guilty')::boolean into v_self from jsonb_array_elements(v_list) x where x->>'key' = v_row.role_key;
        if coalesce(v_self, false) then
          v_pts := v_pts + 300;
          v_why := array_append(v_why, 'نجا من الإدانة');
        end if;
      elsif v_win = 'convict' and v_convicted > 0 then
        v_pts := v_pts + 200 * v_convicted / v_n;
        v_why := array_append(v_why, case when v_n > 1 and v_convicted < v_n then 'أُدين أحد المتهمين' else 'أُدين المتهم' end);
      elsif v_win = 'acquit' and v_acquitted > 0 then
        v_pts := v_pts + 200 * v_acquitted / v_n;
        v_why := array_append(v_why, case when v_n > 1 and v_acquitted < v_n then 'بُرّئ أحد المتهمين' else 'بُرّئ المتهم' end);
      elsif v_win = 'truth' and v_correct > 0 then
        v_pts := v_pts + 200 * v_correct / v_n;
        v_why := array_append(v_why, 'تحققت العدالة');
      end if;
      if v_row.kind in ('prosecutor', 'lawyer') and v_correct > 0 and not v_no_votes then
        v_pts := v_pts + 100 * v_correct / v_n;
        v_why := array_append(v_why, 'الحكم صحيح');
      end if;
      if v_best is not null and v_row.kind = v_best then
        v_pts := v_pts + 50;
        v_why := array_append(v_why, 'أفضل مرافعة');
      end if;
      v_obj := coalesce((v_sd->'objection_points'->>v_row.player_id::text)::int, 0);
      if v_obj > 0 then
        v_pts := v_pts + 50 * v_obj;
        v_why := array_append(v_why, case when v_obj > 1 then 'اعتراضان مقبولان' else 'اعتراض مقبول' end);
      end if;
      if v_pts > 0 then
        update public.room_players set score = score + v_pts where id = v_row.player_id;
      end if;
      v_points := v_points || jsonb_build_array(jsonb_build_object(
        'player_id', v_row.player_id, 'player_name', v_row.player_name, 'kind', v_row.kind, 'name', v_row.name,
        'vote', v_row.vote, 'pick', v_row.pick, 'points', v_pts, 'why', to_jsonb(v_why),
        'vote_ok', v_i > 0, 'votes_ok', v_i, 'verdicts', v_row.verdicts,
        'pick_ok', v_has_suspects and v_row.pick is not null and v_row.pick = v_court.culprit));
    end loop;
    select coalesce(jsonb_agg(x order by (x->>'points')::int desc, x->>'player_name'), '[]'::jsonb) into v_points from jsonb_array_elements(v_points) x;

    -- ترتيب السهرة: يتجمع من قضية لقضية.
    v_evening := coalesce(v_sd->'settings'->'evening', '{}'::jsonb);
    v_totals := coalesce(v_evening->'totals', '{}'::jsonb);
    for v_t in select * from jsonb_array_elements(v_points) loop
      v_totals := v_totals || jsonb_build_object(v_t->>'player_id', jsonb_build_object(
        'name', v_t->>'player_name',
        'points', coalesce((v_totals->(v_t->>'player_id')->>'points')::int, 0) + (v_t->>'points')::int,
        'matches', coalesce((v_totals->(v_t->>'player_id')->>'matches')::int, 0) + 1,
        'smart', coalesce((v_totals->(v_t->>'player_id')->>'smart')::int, 0)
                 + coalesce((v_t->>'votes_ok')::int, 0) + case when (v_t->>'pick_ok')::boolean then 1 else 0 end,
        'speaker', coalesce((v_totals->(v_t->>'player_id')->>'speaker')::int, 0)
                 + case when v_t->>'kind' in ('prosecutor', 'lawyer', 'accused') then (v_t->>'points')::int else 0 end));
    end loop;
    v_evening := jsonb_build_object('matches', coalesce((v_evening->>'matches')::int, 0) + 1, 'totals', v_totals);

    v_sd := v_sd || jsonb_build_object(
      'truth', jsonb_build_object('guilty', v_court.guilty, 'text', v_court.truth, 'correct', v_all_correct, 'list', v_list, 'no_votes', v_no_votes,
        'culprit', (select s->>'name' from jsonb_array_elements(v_court.suspects) s where s->>'key' = v_court.culprit),
        'culprit_key', v_court.culprit, 'variant', v_court.variant),
      'points', v_points,
      'settings', (v_sd->'settings') || jsonb_build_object('evening', v_evening),
      'cards', (select coalesce(jsonb_agg(jsonb_build_object('player_name', p.player_name, 'kind', r.kind, 'name', r.name, 'secret', r.secret, 'later', r.later,
                    'goal', r.goal, 'win', public.court_win_of(r.kind, r.win), 'clue', r.clue, 'guilty', r.guilty)
                  order by case r.kind when 'accused' then 1 when 'prosecutor' then 2 when 'lawyer' then 3 when 'detective' then 4 when 'witness' then 5 else 6 end, r.role_key), '[]'::jsonb)
                  from public.room_court_roles r join public.room_players p on p.id = r.player_id
                 where r.room_id = p_room_id and (r.kind <> 'juror' or r.clue is not null)),
      'goals', (select coalesce(jsonb_agg(jsonb_build_object('player_id', r.player_id, 'player_name', p.player_name, 'name', r.name, 'goal', r.goal) order by r.role_key), '[]'::jsonb)
                  from public.room_court_roles r join public.room_players p on p.id = r.player_id
                 where r.room_id = p_room_id and r.goal is not null),
      'evidence', coalesce((select jsonb_agg(public.court_ev(e) order by o) from jsonb_array_elements(v_court.evidence) with ordinality t(e, o)), '[]'::jsonb)
                  || coalesce((select jsonb_agg(e) from jsonb_array_elements(v_sd->'evidence') e where coalesce((e->>'presented')::boolean, false)), '[]'::jsonb));
    if not v_no_votes then
    insert into public.court_results (room_id, case_id, players, verdict, truth, votes_guilty, votes_innocent, variant)
    values (p_room_id, v_court.case_id, (select count(*) from public.room_court_roles where room_id = p_room_id), v_verdict, v_court.guilty,
            coalesce((v_sd->'verdict'->>'votes_guilty')::int, 0), coalesce((v_sd->'verdict'->>'votes_innocent')::int, 0), v_court.variant);
    end if;
  end if;

  update public.room_game_state set state_data = v_sd where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'phase', v_phase);
end;
$$;
revoke all on function public.court_advance(uuid, int) from public, anon;

-- سجل الملفات (app_v1.sql): هذا الملف شُغّل.
create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;
insert into public.app_migrations (name) values ('court_v7.sql') on conflict do nothing;

notify pgrst, 'reload schema';
