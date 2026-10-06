-- Move an older auth table off the reserved name USER.
do $$
begin
  if to_regclass('public."user"') is not null and to_regclass('public.users') is null then
    alter table public."user" rename to users;
  end if;
end $$;
