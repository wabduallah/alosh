-- Remove 9 unused tables from an old version of the app. Each one is empty.
-- promo_codes is NOT removed here (it has 3 rows).
-- The guard stops the migration if any of these tables has data.

do $$
declare
  t text;
begin
  foreach t in array array['account', 'categories', 'games_legacy', 'payments', 'profiles',
                           'session', 'subscriptions', 'users', 'verification'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select 1 from public.%I limit 1', t);
      if found then
        raise exception 'Table % is not empty; stopping', t;
      end if;
    end if;
  end loop;
end $$;

drop table if exists public.session, public.account, public.users, public.categories,
  public.games_legacy, public.payments, public.profiles, public.subscriptions, public.verification;
