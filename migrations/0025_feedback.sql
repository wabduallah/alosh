-- ملاحظات الزوار: يرسلها أي زائر (بدون تسجيل)، ويقرأها المشرف فقط.
-- The feedback table: any visitor can send a note, only admins can read it.

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  message    text not null check (char_length(message) between 3 and 1000),
  -- بريد أو طريقة للتواصل، اختيارية ويكتبها الزائر بنفسه.
  contact    text check (contact is null or char_length(contact) <= 200),
  created_at timestamptz not null default now()
);

comment on table public.feedback is 'ملاحظات الزوار. الإضافة للجميع، والقراءة للمشرف فقط.';

alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

-- الزائر يضيف صفًا فقط، ولا يرى ما أضافه غيره.
grant insert (message, contact) on public.feedback to anon, authenticated;
create policy feedback_insert_anyone on public.feedback
  for insert to anon, authenticated
  with check (true);

-- المشرف فقط يقرأ.
grant select on public.feedback to authenticated;
create policy feedback_select_admin on public.feedback
  for select to authenticated
  using (public.is_app_admin());
