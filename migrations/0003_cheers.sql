-- Ephemeral phone-to-TV reactions. Pruned in the app; the column only holds the live tail.
alter table rooms add column if not exists cheers jsonb not null default '[]'::jsonb;
