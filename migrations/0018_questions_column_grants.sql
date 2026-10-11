-- Players read questions through questions_public, so they never need the
-- answer column. Instead of letting the view bypass the table, grant SELECT
-- only on the safe columns of questions_bank, and let the view run with the
-- caller's rights (security_invoker) as Supabase recommends.
-- correct_answer stays unreadable for anon and authenticated.
-- Admins manage questions in the SQL editor (postgres role), so this does not
-- change their workflow.

begin;

revoke select on public.questions_bank from anon, authenticated;

grant select (id, game_slug, category_ar, question_text, media_url, options, fake_answers, points, difficulty, created_at)
  on public.questions_bank to anon, authenticated;

drop policy if exists "questions: public read" on public.questions_bank;
create policy "questions: public read" on public.questions_bank
  for select to anon, authenticated
  using (true);

create or replace view public.questions_public with (security_invoker = true) as
 SELECT id,
    game_slug,
    category_ar,
    question_text,
    media_url,
    options,
    fake_answers,
    points,
    difficulty,
    created_at
   FROM public.questions_bank;

grant select on public.questions_public to anon, authenticated;

commit;
