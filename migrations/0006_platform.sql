create table if not exists sections (
  id text primary key,
  name_ar text not null,
  name_en text not null,
  icon text not null default 'Gamepad2',
  href text not null,
  description_ar text not null default '',
  description_en text not null default '',
  visible boolean not null default true,
  sort_order integer not null default 0
);

insert into sections (id, name_ar, name_en, icon, href, sort_order)
values
  ('home', 'الرئيسية', 'Home', 'House', '/', 1),
  ('games', 'الألعاب', 'Games', 'Gamepad2', '/games', 2),
  ('questions', 'الأسئلة', 'Questions', 'Brain', '/questions', 3),
  ('nest', 'العش', 'Nest', 'Bird', '/', 4),
  ('rank', 'التصنيف', 'Ranks', 'Trophy', '/rank', 5)
on conflict (id) do nothing;

create table if not exists imports (
  id serial primary key,
  filename text not null default 'upload.csv',
  game_id text,
  mapping jsonb not null default '{}'::jsonb,
  row_count integer not null default 0,
  status text not null default 'preview',
  created_at timestamptz not null default now()
);

create table if not exists ai_drafts (
  id serial primary key,
  kind text not null,
  payload jsonb not null,
  status text not null default 'review',
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists addons (
  id text primary key,
  name_ar text not null,
  name_en text not null,
  description_ar text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb
);

insert into addons (id, name_ar, name_en, description_ar)
values
  ('tournaments', 'البطولات', 'Tournaments', 'أدوار إقصاء وجداول مباريات.'),
  ('chat', 'الدردشة', 'Chat', 'دردشة الغرفة.'),
  ('sfx', 'المؤثرات', 'Sound effects', 'مكتبة مؤثرات إضافية.'),
  ('store', 'المتجر', 'Store', 'عناصر تجميلية.'),
  ('points', 'النقاط', 'Points', 'رصيد موسمي.'),
  ('subs', 'الاشتراكات', 'Subscriptions', 'خطط مدفوعة.'),
  ('ads', 'الإعلانات', 'Ads', 'مواضع إعلان.'),
  ('prizes', 'الجوائز', 'Prizes', 'جوائز الغرفة.'),
  ('stats', 'إحصائيات متقدمة', 'Advanced stats', 'تقارير أعمق.'),
  ('ai', 'ميزات ذكاء إضافية', 'Extra AI', 'أدوات محتوى إضافية.')
on conflict (id) do nothing;

alter table games add column if not exists supports_multiplayer boolean not null default true;
alter table games add column if not exists host_can_play boolean not null default true;
alter table games add column if not exists needs_narrator boolean not null default false;
