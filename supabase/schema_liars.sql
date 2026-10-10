-- =====================================================================
-- العش · لعبة «الكذابون» (Liars)
-- مخطط قاعدة البيانات والبيانات الأولية.
--
-- طريقة التشغيل: شغّل الملف كاملًا مرة واحدة في Supabase → SQL Editor.
-- الملف آمن لإعادة التشغيل: لا يحذف شيئًا، ويحدّث البيانات الأولية فقط.
--
-- ملاحظات تصميم:
-- * جدولا games و categories موجودان مسبقًا في هذا المشروع (من محرك الغرف
--   السابق). لا يُعاد إنشاؤهما: يُضاف لهما ما يلزم من أعمدة فقط.
-- * لعبة liars تُسجَّل في games مع visible = false حتى لا تظهر في قائمة
--   محرك الغرف القديم. صفحات «الكذابون» تقرأها بالـ slug مباشرة.
-- * room_answers جدول إضافي ضروري: يحفظ إجابة كل لاعب لكل خانة، ويمنع
--   الإجابة المكررة، ويُحسب منه التصنيف عند كشف الإجابة.
-- * كل الجداول الجديدة عليها RLS بلا سياسات: الوصول من الخادم فقط عبر
--   DATABASE_URL، ولا يستطيع مفتاح المتصفح (anon) قراءتها أو الكتابة فيها.
--   الإجابات الصحيحة لا تصل للمتصفح إلا عند كشفها.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) games: أنواع الألعاب
-- ---------------------------------------------------------------------
create table if not exists games (
  id text primary key,
  name_ar text not null,
  name_en text not null,
  description_ar text not null,
  description_en text not null,
  category text not null,
  tier text not null default 'free',
  engine text not null,
  min_players integer not null default 2,
  max_players integer not null default 14,
  default_seconds integer not null default 30,
  default_rounds integer not null default 6,
  scoring jsonb not null default '{}'::jsonb,
  visible boolean not null default true,
  status text not null default 'published',
  sort_order integer not null default 0,
  icon text not null default 'Gamepad2',
  source text not null default 'admin',
  created_at timestamptz not null default now()
);

alter table games add column if not exists slug text;
create unique index if not exists games_slug_key on games (slug);

insert into games (
  id, slug, name_ar, name_en, description_ar, description_en, category, tier, engine,
  min_players, max_players, default_seconds, default_rounds, scoring, visible, status, sort_order, icon, source
) values (
  'liars', 'liars', 'الكذابون', 'Liars',
  'شبكة أسئلة من 6 فئات و9 مستويات نقاط. اختر الخانة، أجب قبل الجميع، واحذر الخيارات الكاذبة.',
  'A grid of up to 6 categories and 9 point levels. Pick a cell, answer fast, and dodge the lies.',
  'grid', 'free', 'liars',
  1, 14, 30, 54,
  '{"levels":[100,200,300,400,500,600,700,800,1000]}'::jsonb,
  false, 'published', 1, 'Grid3x3', 'seed'
)
on conflict (id) do update set
  slug = excluded.slug,
  name_ar = excluded.name_ar,
  name_en = excluded.name_en,
  description_ar = excluded.description_ar,
  description_en = excluded.description_en,
  engine = excluded.engine,
  scoring = excluded.scoring,
  status = excluded.status;

-- ---------------------------------------------------------------------
-- 3) categories: الفئات العشرون
-- ---------------------------------------------------------------------
create table if not exists categories (
  id text primary key,
  name_ar text not null,
  name_en text not null,
  sort_order integer not null default 0
);

alter table categories add column if not exists icon text not null default '';
alter table categories add column if not exists active boolean not null default true;

insert into categories (id, name_ar, name_en, icon, sort_order, active) values
  ('general', 'ثقافة عامة', 'General knowledge', '🌐', 1, true),
  ('riddles', 'ألغاز', 'Riddles', '🧩', 2, true),
  ('proverbs', 'أمثال', 'Proverbs', '📜', 3, true),
  ('saudi', 'السعودية', 'Saudi Arabia', '🇸🇦', 4, true),
  ('history', 'تاريخ', 'History', '🏛️', 5, true),
  ('cinema', 'سينما', 'Cinema', '🎬', 6, true),
  ('tech', 'تكنولوجيا', 'Technology', '💻', 7, true),
  ('sports', 'رياضة', 'Sports', '⚽', 8, true),
  ('myths', 'خرافات', 'Myths', '🦇', 9, true),
  ('science', 'علوم', 'Science', '🔬', 10, true),
  ('space', 'فضاء', 'Space', '🚀', 11, true),
  ('literature', 'أدب', 'Literature', '📚', 12, true),
  ('artists', 'فنانون', 'Artists', '🎨', 13, true),
  ('food', 'أكلات شعبية', 'Popular dishes', '🍲', 14, true),
  ('geography', 'جغرافيا', 'Geography', '🗺️', 15, true),
  ('linguistics', 'لغويات', 'Linguistics', '🔤', 16, true),
  ('cars', 'سيارات', 'Cars', '🚗', 17, true),
  ('legends', 'أساطير', 'Legends', '🐉', 18, true),
  ('folklore', 'فلكلور', 'Folklore', '🪘', 19, true),
  ('misc', 'منوعات', 'Miscellaneous', '🎲', 20, true)
on conflict (id) do update set
  name_ar = excluded.name_ar,
  name_en = excluded.name_en,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  active = excluded.active;

-- ---------------------------------------------------------------------
-- 4) questions_grid: 9 مستويات نقاط لكل فئة
-- ---------------------------------------------------------------------
create table if not exists questions_grid (
  id bigint generated always as identity primary key,
  category_id text not null references categories (id) on delete cascade,
  level smallint not null check (level between 1 and 9),
  points integer not null check (points > 0),
  question text not null check (char_length(question) between 3 and 400),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  correct_index smallint not null check (correct_index >= 0),
  status text not null default 'published' check (status in ('draft', 'published')),
  source text not null default 'admin',
  created_at timestamptz not null default now(),
  constraint questions_grid_correct_in_range check (correct_index < jsonb_array_length(options))
);

-- يسمح بأكثر من سؤال لنفس الخانة لاحقًا، ويمنع تكرار نص السؤال نفسه.
create unique index if not exists questions_grid_unique_question on questions_grid (category_id, level, md5(question));
create index if not exists questions_grid_pick_idx on questions_grid (category_id, level) where status = 'published';

insert into questions_grid (category_id, level, points, question, options, correct_index, status, source) values
  ('general', 1, 100, 'كم عدد أيام الأسبوع؟', '["5", "6", "8", "7"]'::jsonb, 3, 'published', 'seed'),
  ('general', 2, 200, 'ما لون حجر الزمرد؟', '["أحمر", "أصفر", "أخضر", "أزرق"]'::jsonb, 2, 'published', 'seed'),
  ('general', 3, 300, 'كم عدد القارات بحسب التقسيم الشائع؟', '["7", "8", "5", "6"]'::jsonb, 0, 'published', 'seed'),
  ('general', 4, 400, 'ما العملة الرسمية لليابان؟', '["الين", "الروبية", "الوون", "اليوان"]'::jsonb, 0, 'published', 'seed'),
  ('general', 5, 500, 'من مؤلف رواية «البؤساء»؟', '["تشارلز ديكنز", "ليو تولستوي", "فيكتور هوغو", "ألكسندر دوما"]'::jsonb, 2, 'published', 'seed'),
  ('general', 6, 600, 'ما أصغر عدد أولي؟', '["2", "0", "3", "1"]'::jsonb, 0, 'published', 'seed'),
  ('general', 7, 700, 'في أي مدينة يقع متحف اللوفر؟', '["روما", "باريس", "لندن", "مدريد"]'::jsonb, 1, 'published', 'seed'),
  ('general', 8, 800, 'ما اللغة الرسمية في البرازيل؟', '["الإنجليزية", "البرتغالية", "الفرنسية", "الإسبانية"]'::jsonb, 1, 'published', 'seed'),
  ('general', 9, 1000, 'كم عدد الدول الأعضاء في الأمم المتحدة؟', '["190", "193", "195", "200"]'::jsonb, 1, 'published', 'seed'),
  ('riddles', 1, 100, 'ما الشيء الذي له أسنان ولا يعض؟', '["الساعة", "المفتاح", "الكتاب", "المشط"]'::jsonb, 3, 'published', 'seed'),
  ('riddles', 2, 200, 'ما الشيء الذي كلما أخذت منه كبر؟', '["الحفرة", "الجبل", "البحر", "النهر"]'::jsonb, 0, 'published', 'seed'),
  ('riddles', 3, 300, 'ما الذي يمشي بلا أرجل ويبكي بلا عيون؟', '["الريح", "النهر", "السحاب", "الظل"]'::jsonb, 2, 'published', 'seed'),
  ('riddles', 4, 400, 'ما الشيء الذي له رقبة وليس له رأس؟', '["الشمعة", "الباب", "الكرسي", "الزجاجة"]'::jsonb, 3, 'published', 'seed'),
  ('riddles', 5, 500, 'ما الشيء الذي يكتب ولا يقرأ؟', '["الكتاب", "الدفتر", "القلم", "المعلم"]'::jsonb, 2, 'published', 'seed'),
  ('riddles', 6, 600, 'ما الشيء الذي إذا لمسته صاح؟', '["الجرس", "الكرسي", "الباب", "المصباح"]'::jsonb, 0, 'published', 'seed'),
  ('riddles', 7, 700, 'ما الذي يحمل السفن الثقيلة ولا يقدر على حمل مسمار صغير؟', '["البحر", "الرافعة", "الحبل", "الجمل"]'::jsonb, 0, 'published', 'seed'),
  ('riddles', 8, 800, 'إذا كان بعد غدٍ هو الجمعة، فما اليوم الذي كان قبل أمس؟', '["الأربعاء", "الثلاثاء", "الاثنين", "الأحد"]'::jsonb, 2, 'published', 'seed'),
  ('riddles', 9, 1000, 'رجل لديه 3 بنات، ولكل بنت أخ واحد. كم عدد أبنائه وبناته معًا؟', '["6", "4", "3", "5"]'::jsonb, 1, 'published', 'seed'),
  ('proverbs', 1, 100, 'أكمل المثل: «الصبر مفتاح ...»', '["الأمل", "الخير", "الفرج", "النجاح"]'::jsonb, 2, 'published', 'seed'),
  ('proverbs', 2, 200, 'أكمل المثل: «من جدّ ...»', '["سعد", "وجد", "فاز", "نجح"]'::jsonb, 1, 'published', 'seed'),
  ('proverbs', 3, 300, 'أكمل المثل: «الوقت كالسيف إن لم تقطعه ...»', '["قطعك", "قتلك", "سبقك", "غلبك"]'::jsonb, 0, 'published', 'seed'),
  ('proverbs', 4, 400, 'أكمل المثل: «اتقِ شرّ من ...»', '["صاحبته", "أسأت إليه", "أحسنت إليه", "عرفته"]'::jsonb, 2, 'published', 'seed'),
  ('proverbs', 5, 500, 'أكمل المثل: «إن كان الكلام من فضة فالسكوت من ...»', '["حديد", "ذهب", "ألماس", "لؤلؤ"]'::jsonb, 1, 'published', 'seed'),
  ('proverbs', 6, 600, 'أكمل المثل: «رجع بخفّي ...»', '["جميل", "حنين", "عنتر", "سليم"]'::jsonb, 1, 'published', 'seed'),
  ('proverbs', 7, 700, 'أكمل المثل: «يداك أوكتا وفوك ...»', '["أكل", "نفخ", "قال", "شرب"]'::jsonb, 1, 'published', 'seed'),
  ('proverbs', 8, 800, 'أكمل المثل: «سبق السيفُ ...»', '["الرمح", "العذل", "القول", "الوعد"]'::jsonb, 1, 'published', 'seed'),
  ('proverbs', 9, 1000, 'أكمل المثل: «أعطِ القوس ...»', '["حاملها", "صانعها", "باريها", "راميها"]'::jsonb, 2, 'published', 'seed'),
  ('saudi', 1, 100, 'ما عاصمة المملكة العربية السعودية؟', '["الرياض", "جدة", "مكة المكرمة", "الدمام"]'::jsonb, 0, 'published', 'seed'),
  ('saudi', 2, 200, 'ما اللون الغالب في علم المملكة العربية السعودية؟', '["الأخضر", "الأسود", "الأحمر", "الأزرق"]'::jsonb, 0, 'published', 'seed'),
  ('saudi', 3, 300, 'في أي مدينة يقع المسجد النبوي؟', '["المدينة المنورة", "الطائف", "جدة", "مكة المكرمة"]'::jsonb, 0, 'published', 'seed'),
  ('saudi', 4, 400, 'ما اسم الجسر الذي يربط السعودية بالبحرين؟', '["جسر الملك عبدالله", "جسر الملك سلمان", "جسر الملك خالد", "جسر الملك فهد"]'::jsonb, 3, 'published', 'seed'),
  ('saudi', 5, 500, 'في أي عام أُعلن توحيد المملكة العربية السعودية باسمها الحالي؟', '["1953", "1932", "1945", "1902"]'::jsonb, 1, 'published', 'seed'),
  ('saudi', 6, 600, 'ما أكبر صحراء رملية في المملكة؟', '["النفود", "الجافورة", "الربع الخالي", "الدهناء"]'::jsonb, 2, 'published', 'seed'),
  ('saudi', 7, 700, 'في أي محافظة يقع موقع الحِجر (مدائن صالح)؟', '["نجران", "العُلا", "حائل", "تبوك"]'::jsonb, 1, 'published', 'seed'),
  ('saudi', 8, 800, 'في أي يوم يُحتفل بيوم التأسيس السعودي؟', '["23 سبتمبر", "22 فبراير", "15 مارس", "1 يناير"]'::jsonb, 1, 'published', 'seed'),
  ('saudi', 9, 1000, 'في أي عام يبدأ تأسيس الدولة السعودية الأولى بحسب يوم التأسيس؟', '["1727", "1744", "1824", "1902"]'::jsonb, 0, 'published', 'seed'),
  ('history', 1, 100, 'من أول إنسان مشى على سطح القمر؟', '["نيل آرمسترونغ", "جون غلين", "باز ألدرين", "يوري غاغارين"]'::jsonb, 0, 'published', 'seed'),
  ('history', 2, 200, 'في أي دولة تقع أهرامات الجيزة؟', '["المكسيك", "العراق", "مصر", "السودان"]'::jsonb, 2, 'published', 'seed'),
  ('history', 3, 300, 'في أي عام بدأت الحرب العالمية الثانية؟', '["1914", "1939", "1929", "1945"]'::jsonb, 1, 'published', 'seed'),
  ('history', 4, 400, 'من القائد الذي عبر بالجيش إلى الأندلس عام 711م؟', '["خالد بن الوليد", "طارق بن زياد", "عقبة بن نافع", "صلاح الدين الأيوبي"]'::jsonb, 1, 'published', 'seed'),
  ('history', 5, 500, 'أي حضارة ابتكرت الكتابة المسمارية؟', '["الصينية", "السومرية", "الفرعونية", "الرومانية"]'::jsonb, 1, 'published', 'seed'),
  ('history', 6, 600, 'في أي عام فتح العثمانيون القسطنطينية؟', '["1492", "1453", "1517", "1299"]'::jsonb, 1, 'published', 'seed'),
  ('history', 7, 700, 'من القائد المنتصر في معركة حطين؟', '["سيف الدين قطز", "الظاهر بيبرس", "نور الدين زنكي", "صلاح الدين الأيوبي"]'::jsonb, 3, 'published', 'seed'),
  ('history', 8, 800, 'ما المعركة التي هُزم فيها المغول على يد المماليك عام 1260م؟', '["عين جالوت", "القادسية", "حطين", "اليرموك"]'::jsonb, 0, 'published', 'seed'),
  ('history', 9, 1000, 'في أي عام سقط جدار برلين؟', '["1990", "1991", "1989", "1985"]'::jsonb, 2, 'published', 'seed'),
  ('cinema', 1, 100, 'ما اسم الشبل بطل فيلم «الأسد الملك»؟', '["سكار", "سيمبا", "نالا", "تيمون"]'::jsonb, 1, 'published', 'seed'),
  ('cinema', 2, 200, 'في أي دولة تُصنع أفلام «بوليوود»؟', '["تركيا", "الهند", "مصر", "اليابان"]'::jsonb, 1, 'published', 'seed'),
  ('cinema', 3, 300, 'ما الفيلم الذي أخرجه جيمس كاميرون عن غرق سفينة شهيرة عام 1912؟', '["المدمر", "الهاوية", "تايتانيك", "أفاتار"]'::jsonb, 2, 'published', 'seed'),
  ('cinema', 4, 400, 'ما اسم مدرسة السحر في سلسلة «هاري بوتر»؟', '["الأرض الوسطى", "نارنيا", "هوغوورتس", "أوز"]'::jsonb, 2, 'published', 'seed'),
  ('cinema', 5, 500, 'ما اسم التمثال الذهبي الذي يُمنح في حفل جوائز الأكاديمية الأمريكية؟', '["إيمي", "توني", "غرامي", "أوسكار"]'::jsonb, 3, 'published', 'seed'),
  ('cinema', 6, 600, 'من أخرج فيلم «الرسالة» عام 1976؟', '["مصطفى العقاد", "حسن الإمام", "صلاح أبو سيف", "يوسف شاهين"]'::jsonb, 0, 'published', 'seed'),
  ('cinema', 7, 700, 'في أي دولة يُقام مهرجان «كان» السينمائي؟', '["ألمانيا", "إيطاليا", "إسبانيا", "فرنسا"]'::jsonb, 3, 'published', 'seed'),
  ('cinema', 8, 800, 'ما الشخصية التي أدّاها روبرت داوني جونيور في أفلام مارفل؟', '["ثور", "آيرون مان", "هالك", "كابتن أمريكا"]'::jsonb, 1, 'published', 'seed'),
  ('cinema', 9, 1000, 'من أخرج ثلاثية «سيد الخواتم»؟', '["بيتر جاكسون", "ستيفن سبيلبرغ", "جيمس كاميرون", "كريستوفر نولان"]'::jsonb, 0, 'published', 'seed'),
  ('tech', 1, 100, 'ما الشركة المصنّعة لهاتف آيفون؟', '["سامسونج", "نوكيا", "آبل", "هواوي"]'::jsonb, 2, 'published', 'seed'),
  ('tech', 2, 200, 'إلامَ يرمز الاختصار www؟', '["Wide World Web", "World Wide Web", "World Web Window", "Web World Wide"]'::jsonb, 1, 'published', 'seed'),
  ('tech', 3, 300, 'من أسّس شركة مايكروسوفت مع بول ألن؟', '["ستيف جوبز", "إيلون ماسك", "مارك زوكربيرغ", "بيل غيتس"]'::jsonb, 3, 'published', 'seed'),
  ('tech', 4, 400, 'كم بتًا في البايت الواحد؟', '["10", "8", "16", "4"]'::jsonb, 1, 'published', 'seed'),
  ('tech', 5, 500, 'أي لغة برمجة يحمل شعارها فنجان قهوة؟', '["روبي", "سي", "جافا", "بايثون"]'::jsonb, 2, 'published', 'seed'),
  ('tech', 6, 600, 'إلامَ يرمز الاختصار CPU؟', '["وحدة الرسوميات", "وحدة الطاقة", "وحدة التخزين الرئيسية", "وحدة المعالجة المركزية"]'::jsonb, 3, 'published', 'seed'),
  ('tech', 7, 700, 'في أي عام أُعلن عن أول هاتف آيفون؟', '["2007", "2005", "2010", "2009"]'::jsonb, 0, 'published', 'seed'),
  ('tech', 8, 800, 'ما متصفح الويب الرسومي الذي انتشر على نطاق واسع عام 1993؟', '["موزاييك", "نتسكيب", "كروم", "فايرفوكس"]'::jsonb, 0, 'published', 'seed'),
  ('tech', 9, 1000, 'من مخترع الشبكة العنكبوتية العالمية (الويب)؟', '["آلان تورنغ", "لينوس تورفالدس", "فينت سيرف", "تيم بيرنرز لي"]'::jsonb, 3, 'published', 'seed'),
  ('sports', 1, 100, 'كم لاعبًا لكل فريق داخل ملعب كرة القدم؟', '["10", "11", "12", "9"]'::jsonb, 1, 'published', 'seed'),
  ('sports', 2, 200, 'كم دقيقة يستمر الشوط الواحد في مباراة كرة القدم؟', '["60", "30", "40", "45"]'::jsonb, 3, 'published', 'seed'),
  ('sports', 3, 300, 'أي منتخب فاز بكأس العالم لكرة القدم 2022؟', '["فرنسا", "كرواتيا", "الأرجنتين", "البرازيل"]'::jsonb, 2, 'published', 'seed'),
  ('sports', 4, 400, 'في أي لعبة تُقال عبارة «كش ملك»؟', '["الشطرنج", "البلوت", "الدومينو", "الطاولة"]'::jsonb, 0, 'published', 'seed'),
  ('sports', 5, 500, 'كم حلقة في شعار الألعاب الأولمبية؟', '["5", "4", "6", "7"]'::jsonb, 0, 'published', 'seed'),
  ('sports', 6, 600, 'أي دولة استضافت كأس العالم لكرة القدم 2022؟', '["السعودية", "قطر", "روسيا", "الإمارات"]'::jsonb, 1, 'published', 'seed'),
  ('sports', 7, 700, 'كم نقطة تُحتسب للرمية من خارج القوس في كرة السلة؟', '["4", "1", "3", "2"]'::jsonb, 2, 'published', 'seed'),
  ('sports', 8, 800, 'في أي مدينة أُقيمت أول دورة ألعاب أولمبية حديثة عام 1896؟', '["باريس", "روما", "أثينا", "لندن"]'::jsonb, 2, 'published', 'seed'),
  ('sports', 9, 1000, 'ما المسافة الرسمية لسباق الماراثون؟', '["21.1 كم", "40 كم", "50 كم", "42.195 كم"]'::jsonb, 3, 'published', 'seed'),
  ('myths', 1, 100, '«الخفافيش عمياء تمامًا». هذه العبارة:', '["صحيحة للصغار منها فقط", "حقيقة علمية", "خرافة، فالخفافيش ترى", "صحيحة في النهار فقط"]'::jsonb, 2, 'published', 'seed'),
  ('myths', 2, 200, '«سور الصين العظيم يُرى بالعين المجردة من القمر». هذه العبارة:', '["يُرى بصعوبة", "حقيقة", "يُرى ليلًا فقط", "خرافة"]'::jsonb, 3, 'published', 'seed'),
  ('myths', 3, 300, '«الإنسان يستخدم 10% فقط من دماغه». هذه العبارة:', '["خرافة، فنحن نستخدم الدماغ كله", "حقيقة مثبتة", "الصحيح 1%", "الصحيح 30%"]'::jsonb, 0, 'published', 'seed'),
  ('myths', 4, 400, '«ذاكرة السمكة الذهبية 3 ثوانٍ فقط». هذه العبارة:', '["الصحيح دقيقة واحدة", "الصحيح ثانية واحدة", "حقيقة", "خرافة، فهي تتذكر لأشهر"]'::jsonb, 3, 'published', 'seed'),
  ('myths', 5, 500, '«البرق لا يضرب المكان نفسه مرتين». هذه العبارة:', '["صحيحة فوق البحر", "خرافة", "صحيحة في الصيف", "حقيقة"]'::jsonb, 1, 'published', 'seed'),
  ('myths', 6, 600, '«النعامة تدفن رأسها في الرمل عند الخوف». هذه العبارة:', '["تفعل ذلك لتنام", "حقيقة", "خرافة، فهي تخفض رأسها أو تهرب", "تفعل ذلك ليلًا"]'::jsonb, 2, 'published', 'seed'),
  ('myths', 7, 700, '«الثور يهيج بسبب اللون الأحمر». هذه العبارة:', '["خرافة، فحركة القماش هي ما يستثيره", "يهيج من الأزرق", "يهيج من الأبيض", "حقيقة"]'::jsonb, 0, 'published', 'seed'),
  ('myths', 8, 800, '«طقطقة الأصابع تسبب التهاب المفاصل». هذه العبارة:', '["تسبب الروماتيزم فورًا", "تسبب الكسور", "خرافة لم تثبتها الدراسات", "حقيقة مثبتة"]'::jsonb, 2, 'published', 'seed'),
  ('myths', 9, 1000, '«الشعر والأظافر تستمر في النمو بعد الموت». هذه العبارة:', '["خرافة، فالجلد ينكمش فتبدو أطول", "حقيقة لأسابيع", "تنمو الأظافر فقط", "حقيقة لأيام"]'::jsonb, 0, 'published', 'seed'),
  ('science', 1, 100, 'ما الغاز الذي نتنفسه لنبقى أحياء؟', '["النيتروجين", "ثاني أكسيد الكربون", "الهيليوم", "الأكسجين"]'::jsonb, 3, 'published', 'seed'),
  ('science', 2, 200, 'كم عدد عظام جسم الإنسان البالغ؟', '["216", "186", "206", "300"]'::jsonb, 2, 'published', 'seed'),
  ('science', 3, 300, 'ما الرمز الكيميائي للذهب؟', '["Au", "Gd", "Ag", "Go"]'::jsonb, 0, 'published', 'seed'),
  ('science', 4, 400, 'ما أكبر عضو في جسم الإنسان؟', '["الرئتان", "القلب", "الجلد", "الكبد"]'::jsonb, 2, 'published', 'seed'),
  ('science', 5, 500, 'عند أي درجة مئوية يغلي الماء عند مستوى سطح البحر؟', '["80", "120", "90", "100"]'::jsonb, 3, 'published', 'seed'),
  ('science', 6, 600, 'ما وحدة قياس القوة في النظام الدولي؟', '["جول", "باسكال", "نيوتن", "واط"]'::jsonb, 2, 'published', 'seed'),
  ('science', 7, 700, 'ما الجسيم الذي يحمل شحنة سالبة في الذرة؟', '["النيوترون", "البروتون", "الفوتون", "الإلكترون"]'::jsonb, 3, 'published', 'seed'),
  ('science', 8, 800, 'ما سرعة الضوء في الفراغ تقريبًا؟', '["150,000 كم/ث", "30,000 كم/ث", "3,000,000 كم/ث", "300,000 كم/ث"]'::jsonb, 3, 'published', 'seed'),
  ('science', 9, 1000, 'ما العنصر الأكثر وفرة في الكون؟', '["الأكسجين", "الهيدروجين", "الهيليوم", "الكربون"]'::jsonb, 1, 'published', 'seed'),
  ('space', 1, 100, 'ما أقرب نجم إلى الأرض؟', '["بروكسيما سنتوري", "الشعرى اليمانية", "الشمس", "نجم القطب"]'::jsonb, 2, 'published', 'seed'),
  ('space', 2, 200, 'ما الكوكب الملقب بالكوكب الأحمر؟', '["عطارد", "المريخ", "المشتري", "الزهرة"]'::jsonb, 1, 'published', 'seed'),
  ('space', 3, 300, 'ما أكبر كوكب في المجموعة الشمسية؟', '["زحل", "المشتري", "نبتون", "الأرض"]'::jsonb, 1, 'published', 'seed'),
  ('space', 4, 400, 'كم عدد كواكب المجموعة الشمسية؟', '["9", "10", "7", "8"]'::jsonb, 3, 'published', 'seed'),
  ('space', 5, 500, 'ما اسم أول قمر صناعي أُطلق إلى الفضاء؟', '["فوستوك 1", "هابل", "سبوتنيك 1", "أبولو 11"]'::jsonb, 2, 'published', 'seed'),
  ('space', 6, 600, 'ما الكوكب الأقرب إلى الشمس؟', '["عطارد", "الأرض", "الزهرة", "المريخ"]'::jsonb, 0, 'published', 'seed'),
  ('space', 7, 700, 'ما اسم المجرة التي تنتمي إليها الأرض؟', '["المثلث", "ماجلان الكبرى", "درب التبانة", "أندروميدا"]'::jsonb, 2, 'published', 'seed'),
  ('space', 8, 800, 'من أول رائد فضاء عربي؟', '["الأمير سلطان بن سلمان", "محمد فارس", "هزاع المنصوري", "ريانة برناوي"]'::jsonb, 0, 'published', 'seed'),
  ('space', 9, 1000, 'كم يستغرق ضوء الشمس تقريبًا للوصول إلى الأرض؟', '["8 ساعات", "ساعة", "8 ثوانٍ", "8 دقائق"]'::jsonb, 3, 'published', 'seed'),
  ('literature', 1, 100, 'من الشاعر الملقب بـ«أمير الشعراء»؟', '["حافظ إبراهيم", "نزار قباني", "أحمد شوقي", "المتنبي"]'::jsonb, 2, 'published', 'seed'),
  ('literature', 2, 200, 'من مؤلف مسرحية «روميو وجولييت»؟', '["غوته", "موليير", "تشارلز ديكنز", "وليام شكسبير"]'::jsonb, 3, 'published', 'seed'),
  ('literature', 3, 300, 'في أي كتاب تروي شهرزاد حكاياتها لشهريار؟', '["ألف ليلة وليلة", "كليلة ودمنة", "البخلاء", "الأغاني"]'::jsonb, 0, 'published', 'seed'),
  ('literature', 4, 400, 'من نقل «كليلة ودمنة» إلى العربية؟', '["ابن المقفع", "ابن خلدون", "المتنبي", "الجاحظ"]'::jsonb, 0, 'published', 'seed'),
  ('literature', 5, 500, 'من الأديب المصري الفائز بجائزة نوبل للآداب عام 1988؟', '["نجيب محفوظ", "يوسف إدريس", "طه حسين", "توفيق الحكيم"]'::jsonb, 0, 'published', 'seed'),
  ('literature', 6, 600, 'من قائل البيت «الخيل والليل والبيداء تعرفني»؟', '["أبو تمام", "عنترة بن شداد", "البحتري", "المتنبي"]'::jsonb, 3, 'published', 'seed'),
  ('literature', 7, 700, 'من مؤلف كتاب «المقدمة»؟', '["ابن سينا", "ابن رشد", "الفارابي", "ابن خلدون"]'::jsonb, 3, 'published', 'seed'),
  ('literature', 8, 800, 'من مؤلف رواية «موسم الهجرة إلى الشمال»؟', '["الطيب صالح", "حنا مينه", "عبد الرحمن منيف", "غسان كنفاني"]'::jsonb, 0, 'published', 'seed'),
  ('literature', 9, 1000, 'من صاحب المعلقة التي مطلعها «قفا نبكِ من ذكرى حبيب ومنزل»؟', '["امرؤ القيس", "زهير بن أبي سلمى", "طرفة بن العبد", "لبيد بن ربيعة"]'::jsonb, 0, 'published', 'seed'),
  ('artists', 1, 100, 'من رسم لوحة «الموناليزا»؟', '["مايكل أنجلو", "رافائيل", "ليوناردو دا فينشي", "فان غوخ"]'::jsonb, 2, 'published', 'seed'),
  ('artists', 2, 200, 'من الفنان الملقب بـ«فنان العرب»؟', '["راشد الماجد", "محمد عبده", "عبد المجيد عبدالله", "طلال مداح"]'::jsonb, 1, 'published', 'seed'),
  ('artists', 3, 300, 'من رسم لوحة «ليلة النجوم»؟', '["بابلو بيكاسو", "كلود مونيه", "فنسنت فان غوخ", "سلفادور دالي"]'::jsonb, 2, 'published', 'seed'),
  ('artists', 4, 400, 'من المطربة الملقبة بـ«كوكب الشرق»؟', '["نجاة الصغيرة", "وردة", "فيروز", "أم كلثوم"]'::jsonb, 3, 'published', 'seed'),
  ('artists', 5, 500, 'من رسم سقف كنيسة سيستينا؟', '["ليوناردو دا فينشي", "رامبرانت", "دوناتيلو", "مايكل أنجلو"]'::jsonb, 3, 'published', 'seed'),
  ('artists', 6, 600, 'من الفنان الملقب بـ«العندليب الأسمر»؟', '["محمد عبد الوهاب", "فريد الأطرش", "عبد الحليم حافظ", "وديع الصافي"]'::jsonb, 2, 'published', 'seed'),
  ('artists', 7, 700, 'إلى أي مدرسة فنية ينتمي سلفادور دالي؟', '["السريالية", "الانطباعية", "التكعيبية", "الواقعية"]'::jsonb, 0, 'published', 'seed'),
  ('artists', 8, 800, 'من المطربة الملقبة بـ«جارة القمر»؟', '["فيروز", "ماجدة الرومي", "صباح", "أم كلثوم"]'::jsonb, 0, 'published', 'seed'),
  ('artists', 9, 1000, 'من الرسام الإسباني الذي أسس الحركة التكعيبية مع جورج براك؟', '["بابلو بيكاسو", "دييغو فيلاسكيز", "خوان ميرو", "فرانسيسكو غويا"]'::jsonb, 0, 'published', 'seed'),
  ('food', 1, 100, 'ما الطبق السعودي الشهير المكوّن من الأرز واللحم والبهارات؟', '["الحنيني", "القرصان", "المطازيز", "الكبسة"]'::jsonb, 3, 'published', 'seed'),
  ('food', 2, 200, 'من أي دولة أصل البيتزا؟', '["اليونان", "فرنسا", "إيطاليا", "إسبانيا"]'::jsonb, 2, 'published', 'seed'),
  ('food', 3, 300, 'ما المكوّن الأساسي في طبق الحمص بالطحينة؟', '["العدس", "الحمص", "الفول", "الفاصوليا"]'::jsonb, 1, 'published', 'seed'),
  ('food', 4, 400, 'ما الطبق الياباني المكوّن من الأرز مع السمك النيء غالبًا؟', '["السوشي", "الأودون", "الرامن", "التيمبورا"]'::jsonb, 0, 'published', 'seed'),
  ('food', 5, 500, 'من أي حبوب يُصنع الجريش؟', '["القمح", "الشعير", "الذرة", "الأرز"]'::jsonb, 0, 'published', 'seed'),
  ('food', 6, 600, 'ما الطبق الإسباني الشهير بالأرز والزعفران والمأكولات البحرية؟', '["البرياني", "التاكو", "الريزوتو", "الباييلا"]'::jsonb, 3, 'published', 'seed'),
  ('food', 7, 700, 'ما الطبق الذي يُطهى في حفرة تحت الأرض ويشتهر في اليمن والسعودية؟', '["المطبّق", "الكبسة", "الجريش", "المندي"]'::jsonb, 3, 'published', 'seed'),
  ('food', 8, 800, 'في أي دولة يشتهر طبق «الكشري»؟', '["المغرب", "مصر", "لبنان", "العراق"]'::jsonb, 1, 'published', 'seed'),
  ('food', 9, 1000, 'ما الطبق الحجازي المكوّن من عجينة رقيقة محشوة تُطوى وتُقلى؟', '["المرقوق", "المعصوب", "الهريس", "المطبّق"]'::jsonb, 3, 'published', 'seed'),
  ('geography', 1, 100, 'ما أكبر محيط في العالم؟', '["المحيط الأطلسي", "المحيط المتجمد الشمالي", "المحيط الهندي", "المحيط الهادئ"]'::jsonb, 3, 'published', 'seed'),
  ('geography', 2, 200, 'ما عاصمة مصر؟', '["أسوان", "الإسكندرية", "الجيزة", "القاهرة"]'::jsonb, 3, 'published', 'seed'),
  ('geography', 3, 300, 'ما أعلى جبل في العالم؟', '["كليمنجارو", "K2", "مون بلان", "إيفرست"]'::jsonb, 3, 'published', 'seed'),
  ('geography', 4, 400, 'ما أكبر دولة في العالم من حيث المساحة؟', '["الصين", "روسيا", "الولايات المتحدة", "كندا"]'::jsonb, 1, 'published', 'seed'),
  ('geography', 5, 500, 'ما عاصمة أستراليا؟', '["سيدني", "ملبورن", "بيرث", "كانبرا"]'::jsonb, 3, 'published', 'seed'),
  ('geography', 6, 600, 'ما أكبر صحراء حارة في العالم؟', '["صحراء غوبي", "الصحراء الكبرى", "الربع الخالي", "صحراء أتاكاما"]'::jsonb, 1, 'published', 'seed'),
  ('geography', 7, 700, 'ما المضيق الذي يفصل بين أوروبا وأفريقيا؟', '["مضيق جبل طارق", "مضيق البوسفور", "مضيق هرمز", "مضيق باب المندب"]'::jsonb, 0, 'published', 'seed'),
  ('geography', 8, 800, 'ما عاصمة كندا؟', '["فانكوفر", "أوتاوا", "تورنتو", "مونتريال"]'::jsonb, 1, 'published', 'seed'),
  ('geography', 9, 1000, 'أي هذه الدول لا تطل على أي بحر أو محيط؟', '["منغوليا", "فيتنام", "البرتغال", "تشيلي"]'::jsonb, 0, 'published', 'seed'),
  ('linguistics', 1, 100, 'كم عدد حروف الهجاء في اللغة العربية؟', '["28", "32", "30", "26"]'::jsonb, 0, 'published', 'seed'),
  ('linguistics', 2, 200, 'ما جمع كلمة «كتاب»؟', '["مكاتب", "كُتُب", "كتّاب", "كتابات"]'::jsonb, 1, 'published', 'seed'),
  ('linguistics', 3, 300, 'ما ضدّ كلمة «الصدق»؟', '["الوفاء", "الأمانة", "الكذب", "الصراحة"]'::jsonb, 2, 'published', 'seed'),
  ('linguistics', 4, 400, 'ما مفرد كلمة «أقلام»؟', '["أقلم", "قلم", "قلامة", "مقلمة"]'::jsonb, 1, 'published', 'seed'),
  ('linguistics', 5, 500, 'ما إعراب «سريعًا» في جملة «جاء الرجل سريعًا»؟', '["حال", "مفعول به", "نعت", "تمييز"]'::jsonb, 0, 'published', 'seed'),
  ('linguistics', 6, 600, 'ما معنى كلمة «الغيث»؟', '["البرق", "المطر", "الريح", "الثلج"]'::jsonb, 1, 'published', 'seed'),
  ('linguistics', 7, 700, 'ما مثنى كلمة «عين» في حالة الرفع؟', '["عينين", "أعين", "عيون", "عينان"]'::jsonb, 3, 'published', 'seed'),
  ('linguistics', 8, 800, 'ما العلامة الأصلية لنصب الاسم المفرد؟', '["السكون", "الفتحة", "الكسرة", "الضمة"]'::jsonb, 1, 'published', 'seed'),
  ('linguistics', 9, 1000, 'ما إعراب «الطالبُ» في جملة «نجح الطالبُ»؟', '["خبر مرفوع", "مبتدأ مرفوع", "فاعل مرفوع", "مفعول به منصوب"]'::jsonb, 2, 'published', 'seed'),
  ('cars', 1, 100, 'إلى أي دولة تنتمي شركة «تويوتا»؟', '["كوريا الجنوبية", "اليابان", "ألمانيا", "الصين"]'::jsonb, 1, 'published', 'seed'),
  ('cars', 2, 200, 'ما الحيوان في شعار شركة «فيراري»؟', '["أسد", "نسر", "حصان جامح", "ثور"]'::jsonb, 2, 'published', 'seed'),
  ('cars', 3, 300, 'ما الشركة التي تنتج سيارة «موستانج»؟', '["دودج", "شيفروليه", "فورد", "تويوتا"]'::jsonb, 2, 'published', 'seed'),
  ('cars', 4, 400, 'إلى أي دولة تنتمي شركة «مرسيدس بنز»؟', '["السويد", "ألمانيا", "فرنسا", "إيطاليا"]'::jsonb, 1, 'published', 'seed'),
  ('cars', 5, 500, 'ما الحيوان في شعار شركة «لامبورغيني»؟', '["أسد", "ثور", "حصان", "نمر"]'::jsonb, 1, 'published', 'seed'),
  ('cars', 6, 600, 'إلامَ يرمز الاختصار ABS في السيارات؟', '["نظام حقن الوقود", "نظام التعليق الهوائي", "نظام منع انغلاق المكابح", "نظام التوجيه الآلي"]'::jsonb, 2, 'published', 'seed'),
  ('cars', 7, 700, 'ما الشركة التي أنتجت سيارة «بيتل» (الخنفساء)؟', '["فولكس فاجن", "بورشه", "أودي", "بي إم دبليو"]'::jsonb, 0, 'published', 'seed'),
  ('cars', 8, 800, 'من حصل على براءة اختراع أول سيارة بمحرك احتراق داخلي عام 1886؟', '["هنري فورد", "رودولف ديزل", "غوتليب دايملر", "كارل بنز"]'::jsonb, 3, 'published', 'seed'),
  ('cars', 9, 1000, 'ما اسم سباق التحمّل الشهير الذي يستمر 24 ساعة في فرنسا؟', '["لومان", "دايتونا", "إنديانابوليس", "موناكو"]'::jsonb, 0, 'published', 'seed'),
  ('legends', 1, 100, 'ما الطائر الأسطوري الذي يُقال إنه ينبعث من رماده؟', '["الغريفين", "التنين", "العنقاء", "الرخ"]'::jsonb, 2, 'published', 'seed'),
  ('legends', 2, 200, 'من إله البحر في الأساطير الإغريقية؟', '["هاديس", "أبولو", "زيوس", "بوسيدون"]'::jsonb, 3, 'published', 'seed'),
  ('legends', 3, 300, 'ما اسم الحصان المجنّح في الأساطير الإغريقية؟', '["بيغاسوس", "سنتور", "سيربيروس", "مينوتور"]'::jsonb, 0, 'published', 'seed'),
  ('legends', 4, 400, 'من البطل الإغريقي الذي كانت نقطة ضعفه في كعبه؟', '["هرقل", "أوديسيوس", "بيرسيوس", "أخيل"]'::jsonb, 3, 'published', 'seed'),
  ('legends', 5, 500, 'ما الكائن الأسطوري الذي نصفه إنسان ونصفه سمكة؟', '["الغول", "القنطور", "حورية البحر", "الميدوسا"]'::jsonb, 2, 'published', 'seed'),
  ('legends', 6, 600, 'ما اسم الكائن الإغريقي الذي يحوّل من ينظر إليه إلى حجر؟', '["سفينكس", "كيميرا", "ميدوسا", "هيدرا"]'::jsonb, 2, 'published', 'seed'),
  ('legends', 7, 700, 'من إله الرعد في الأساطير الإسكندنافية؟', '["ثور", "فريا", "أودين", "لوكي"]'::jsonb, 0, 'published', 'seed'),
  ('legends', 8, 800, 'ما اسم الملحمة السومرية التي يبحث بطلها عن الخلود؟', '["ملحمة جلجامش", "الأوديسة", "الإلياذة", "الشاهنامة"]'::jsonb, 0, 'published', 'seed'),
  ('legends', 9, 1000, 'في الأساطير المصرية القديمة، من إله العالم الآخر وحاكم الموتى؟', '["حورس", "رع", "آمون", "أوزيريس"]'::jsonb, 3, 'published', 'seed'),
  ('folklore', 1, 100, 'ما الرقصة الشعبية السعودية التي تُؤدّى بالسيوف؟', '["التنورة", "الدبكة", "السامري", "العرضة"]'::jsonb, 3, 'published', 'seed'),
  ('folklore', 2, 200, 'ما المناسبة الشعبية الخليجية التي يجوب فيها الأطفال البيوت في منتصف رمضان؟', '["العيدية", "الغبقة", "الحية بية", "القرقيعان"]'::jsonb, 3, 'published', 'seed'),
  ('folklore', 3, 300, 'ما الآلة الوترية الشعبية ذات الوتر الواحد في البادية؟', '["الربابة", "العود", "القانون", "الناي"]'::jsonb, 0, 'published', 'seed'),
  ('folklore', 4, 400, 'ما اسم الزي النسائي الأسود الذي تلبسه المرأة فوق ملابسها في الخليج؟', '["العباءة", "البشت", "الثوب", "الشماغ"]'::jsonb, 0, 'published', 'seed'),
  ('folklore', 5, 500, 'ما اسم المعطف الرجالي التقليدي الذي يُلبس فوق الثوب في المناسبات؟', '["البشت", "الغترة", "الشماغ", "العقال"]'::jsonb, 0, 'published', 'seed'),
  ('folklore', 6, 600, 'ما اسم الإناء التقليدي الذي تُصبّ منه القهوة العربية؟', '["المحماسة", "الفنجال", "الدلّة", "المبخرة"]'::jsonb, 2, 'published', 'seed'),
  ('folklore', 7, 700, 'ما الاسم الخليجي للحكايات الشعبية التي ترويها الجدات للأطفال؟', '["المقامات", "المواويل", "الأهازيج", "الحزاوي"]'::jsonb, 3, 'published', 'seed'),
  ('folklore', 8, 800, 'ما اسم الشعر الشعبي العامي في الجزيرة العربية؟', '["الزجل الأندلسي", "الموشحات", "الشعر الحر", "الشعر النبطي"]'::jsonb, 3, 'published', 'seed'),
  ('folklore', 9, 1000, 'ما أشهر سوق في الجاهلية كانت تُلقى فيه القصائد قرب الطائف؟', '["سوق المربد", "سوق دومة الجندل", "سوق عكاظ", "سوق حباشة"]'::jsonb, 2, 'published', 'seed'),
  ('misc', 1, 100, 'كم لونًا في قوس قزح؟', '["7", "8", "6", "5"]'::jsonb, 0, 'published', 'seed'),
  ('misc', 2, 200, 'ما الحيوان الملقب بـ«سفينة الصحراء»؟', '["الحمار", "الفيل", "الجمل", "الحصان"]'::jsonb, 2, 'published', 'seed'),
  ('misc', 3, 300, 'ما أسرع حيوان بري؟', '["الأسد", "الفهد", "الغزال", "الحصان"]'::jsonb, 1, 'published', 'seed'),
  ('misc', 4, 400, 'ما الطائر الذي لا يطير ويعيش في القارة القطبية الجنوبية؟', '["النعامة", "الكيوي", "الإيمو", "البطريق"]'::jsonb, 3, 'published', 'seed'),
  ('misc', 5, 500, 'كم عدد أسنان الإنسان البالغ عادةً؟', '["30", "32", "28", "36"]'::jsonb, 1, 'published', 'seed'),
  ('misc', 6, 600, 'ما أكبر حيوان على وجه الأرض؟', '["القرش الحوتي", "الزرافة", "الفيل الأفريقي", "الحوت الأزرق"]'::jsonb, 3, 'published', 'seed'),
  ('misc', 7, 700, 'كم قلبًا للأخطبوط؟', '["2", "3", "1", "8"]'::jsonb, 1, 'published', 'seed'),
  ('misc', 8, 800, 'ما أصلب مادة طبيعية معروفة؟', '["الحديد", "الغرانيت", "الألماس", "الياقوت"]'::jsonb, 2, 'published', 'seed'),
  ('misc', 9, 1000, 'كم مربعًا في رقعة الشطرنج؟', '["81", "64", "49", "100"]'::jsonb, 1, 'published', 'seed')
on conflict (category_id, level, md5(question)) do nothing;

-- ---------------------------------------------------------------------
-- 2) game_rooms: الغرف النشطة وحالتها
-- ---------------------------------------------------------------------
create table if not exists game_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{4,8}$'),
  game_id text not null references games (id),
  host_token text not null,
  host_user_id text,
  state text not null default 'lobby' check (state in ('lobby', 'board', 'question', 'reveal', 'finished')),
  -- الإعدادات: المؤقت، المساعدات، المعدّلات، الحد الأقصى للاعبين.
  settings jsonb not null default '{}'::jsonb,
  -- الفئات المختارة بترتيب أعمدة اللوحة (6 كحد أقصى).
  categories text[] not null default '{}' check (cardinality(categories) <= 6),
  -- الخانات التي فُتحت، بصيغة "category_id:level".
  used_cells text[] not null default '{}',
  used_question_ids bigint[] not null default '{}',
  -- اللاعب الذي عليه اختيار الخانة التالية.
  picker_id uuid,
  -- الخانة المفتوحة حاليًا.
  cell_key text,
  cell_points integer,
  question_id bigint references questions_grid (id) on delete set null,
  question_started_at timestamptz,
  ends_at timestamptz,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '8 hours')
);

create index if not exists game_rooms_state_idx on game_rooms (state);
create index if not exists game_rooms_expires_idx on game_rooms (expires_at);

-- ---------------------------------------------------------------------
-- 5) room_players: اللاعبون والنقاط وحالة الاتصال
-- ---------------------------------------------------------------------
create table if not exists room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references game_rooms (id) on delete cascade,
  token text not null,
  name text not null check (char_length(name) between 2 and 16),
  user_id text,
  is_host boolean not null default false,
  seat integer not null,
  score integer not null default 0,
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  -- مساعدة «حذف إجابتين»: مرة واحدة لكل لاعب في اللعبة.
  helper_used boolean not null default false,
  helper_cell text,
  helper_hidden smallint[],
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index if not exists room_players_room_idx on room_players (room_id);
create unique index if not exists room_players_room_name_idx on room_players (room_id, lower(name));
create unique index if not exists room_players_room_seat_idx on room_players (room_id, seat);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'game_rooms_picker_fk') then
    alter table game_rooms
      add constraint game_rooms_picker_fk foreign key (picker_id) references room_players (id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- room_answers: إجابة واحدة لكل لاعب في كل خانة
-- ---------------------------------------------------------------------
create table if not exists room_answers (
  id bigint generated always as identity primary key,
  room_id uuid not null references game_rooms (id) on delete cascade,
  player_id uuid not null references room_players (id) on delete cascade,
  cell_key text not null,
  question_id bigint references questions_grid (id) on delete set null,
  choice smallint not null check (choice >= 0),
  is_correct boolean not null,
  awarded integer not null,
  response_ms integer not null check (response_ms >= 0),
  -- يصبح true عند إضافة النقاط لرصيد اللاعب، فلا تُضاف مرتين.
  applied boolean not null default false,
  created_at timestamptz not null default now(),
  unique (room_id, cell_key, player_id)
);

alter table room_answers add column if not exists applied boolean not null default false;

create index if not exists room_answers_cell_idx on room_answers (room_id, cell_key);

-- ---------------------------------------------------------------------
-- الصلاحيات: الوصول من الخادم فقط
-- ---------------------------------------------------------------------
alter table questions_grid enable row level security;
alter table game_rooms enable row level security;
alter table room_players enable row level security;
alter table room_answers enable row level security;

commit;
