-- =============================================================================
-- لوحة الإدارة (/admin)
--
-- المدير: مستخدم في Supabase Auth عنده app_metadata.role = "admin"، وتتحقق منه
-- الدالة public.is_app_admin(). لا يقدر المتصفح يضبط هذا الدور؛ يضبطه صاحب
-- المشروع فقط من SQL Editor:
--
--   update auth.users
--      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'
--    where email = 'admin@example.com';
--
-- ثم يسجّل المدير خروجًا ودخولًا ليصله الدور الجديد.
--
-- يُشغَّل هذا الملف مرة واحدة بعد schema_al3sh_core.sql، وتشغيله مرة ثانية آمن.
-- =============================================================================

-- 1) كلمات «على راسك» ومواضيع «برة السالفة»: يقرأها ويعدّلها المدير فقط.
--    الألعاب نفسها تقرأها من دوال الخادم كما هي، فلا يتغير شيء على اللاعبين.
grant select, insert, update, delete on public.heads_words to authenticated;
grant select, insert, update, delete on public.outsider_topics to authenticated;

drop policy if exists "heads words: admin manage" on public.heads_words;
create policy "heads words: admin manage" on public.heads_words
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists "outsider topics: admin manage" on public.outsider_topics;
create policy "outsider topics: admin manage" on public.outsider_topics
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- 2) بنك الأسئلة مع الإجابات الصحيحة، للمدير فقط.
--    عمود correct_answer ما زال مقفلًا على المتصفح؛ هذه الدالة ترفض أي حساب غير مدير.
create or replace function public.admin_questions(p_game_slug text default null)
returns setof public.questions_bank
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  return query
    select q.*
      from public.questions_bank q
     where p_game_slug is null or q.game_slug = p_game_slug
     order by q.game_slug, q.category_ar, q.points, q.created_at;
end;
$$;

revoke all on function public.admin_questions(text) from public, anon;
grant execute on function public.admin_questions(text) to authenticated;
