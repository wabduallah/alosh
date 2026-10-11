-- Players (anonymous sessions, not admins) saw zero questions: questions_bank
-- only allows app admins (RLS), and questions_public was security_invoker, so
-- it inherited that filter. The view itself already hides correct_answer, so
-- it can run with the owner's rights and expose only its safe columns.

create or replace view public.questions_public with (security_invoker = false) as
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
