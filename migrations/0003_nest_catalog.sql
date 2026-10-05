alter table games add column if not exists play_mode text not null default 'competitive';
alter table games add column if not exists duration_min integer not null default 5;
alter table games add column if not exists duration_max integer not null default 15;
alter table games add column if not exists rules_ar text not null default '';
alter table games add column if not exists rules_en text not null default '';
alter table games add column if not exists how_ar text not null default '';
alter table games add column if not exists how_en text not null default '';
