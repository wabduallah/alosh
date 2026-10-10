-- Bravo fast-elimination mode: players who answer wrong (or not at all) in a round are out.
alter table players add column if not exists eliminated boolean not null default false;
