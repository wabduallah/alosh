-- Majlis challenge: host-written questions belong to one room (room_id); the shared bank ignores them.
alter table questions add column if not exists room_id text references rooms (id) on delete cascade;
create index if not exists questions_room_id_idx on questions (room_id);

-- Hidden game row that hosts Majlis rooms. Not listed in the public catalogue (visible = false).
insert into games (id, name_ar, name_en, description_ar, description_en, category, engine, min_players, max_players, default_seconds, default_rounds, visible, status, source, sort_order, icon)
values ('majlis-custom', 'تحدي المجالس', 'Majlis Challenge', 'أسئلة يكتبها المضيف بنقاط محددة', 'Host-written questions with set points', 'social', 'choice', 2, 14, 30, 5, false, 'published', 'system', 900, 'Users')
on conflict (id) do nothing;
