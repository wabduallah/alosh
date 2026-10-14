-- قضايا محكمة أعمق + متهم ثانٍ. يُشغَّل بعد court_cases_v3.sql

do $$
declare
  v_id uuid;
begin
  select id into v_id from public.court_cases where slug = 'shadow-transfer-dual' limit 1;
  if v_id is null then
    insert into public.court_cases (
      slug, title, category, intro, difficulty, guilty, truth, evidence, roles, is_active, min_players
    ) values (
      'shadow-transfer-dual',
      'تحويل الظل',
      'جريمة مالية',
      'اختفى مبلغ تشغيلي من حساب الشركة بعد منتصف الليل. صلاحيات التحويل محدودة، لكن سجل الدخول يتضارب مع الكاميرات، واثنان من الموظفين في دائرة الشك.',
      3,
      true,
      'الحقيقة: المتهمان تنسيقا على تحويل جزئي ثم إخفاء أثره عبر تأخير البلاغ وتعديل تقرير المناوبة.',
      jsonb_build_array(
        jsonb_build_object('stage', 1, 'icon', '💻', 'title', 'سجل التحويل', 'time', '00:12',
          'text', 'عملية تحويل من حساب التشغيل إلى حساب وسيط في 00:12 من جهاز داخل المكتب المالي.'),
        jsonb_build_object('stage', 1, 'icon', '🎥', 'title', 'كاميرا الممر', 'time', '00:09',
          'text', 'شخص بغطاء رأس يمر أمام المكتب المالي. الوجه غير واضح. ساعة الجدار تختلف ثانيتين عن سجل النظام.'),
        jsonb_build_object('stage', 2, 'icon', '📱', 'title', 'رسالة مشفّرة', 'time', '00:40',
          'text', 'رسالة من رقم غير مسجّل: «أأجّل التقرير». وصلت للجهاز اللوحي المشترك.'),
        jsonb_build_object('stage', 2, 'icon', '🧾', 'title', 'نسختان من التقرير', 'time', null,
          'text', 'النسخة المطبوعة بتوقيع صباحي. النسخة الرقمية عُدّلت الساعة 03:10 بلا اسم معدّل.'),
        jsonb_build_object('stage', 3, 'icon', '🔑', 'title', 'مفتاح الخزنة المؤقت', 'time', '23:50',
          'text', 'إخراج مفتاح الخزنة قبل الحادث بعشرين دقيقة، وإرجاعه بعد ساعتين بتوقيع غير مقروء.'),
        jsonb_build_object('stage', 3, 'icon', '⏱️', 'title', 'فجوة السجل', 'time', '00:15',
          'text', 'بين 00:14 و00:17 لا حركة في السجل، بينما شاهد يدّعي سماع نقاش عند 00:16.')
      ),
      jsonb_build_array(
        jsonb_build_object('key', 'accused-1', 'kind', 'accused', 'name', 'المتهم الأول — المشرف المالي',
          'secret', 'أنت نفّذت التحويل تحت ضغط شريكك. لا تعترف بالكامل.'),
        jsonb_build_object('key', 'accused-2', 'kind', 'accused', 'name', 'المتهم الثاني — مشرف المناوبة',
          'secret', 'أنت أخّرت مراجعة السجل وسهّلت إخفاء الأثر.'),
        jsonb_build_object('key', 'prosecutor', 'kind', 'prosecutor', 'name', 'المدعي العام',
          'secret', 'اربط صلاحية التحويل بالأول وتأخير التقرير بالثاني.'),
        jsonb_build_object('key', 'lawyer', 'kind', 'lawyer', 'name', 'المحامي',
          'secret', 'ابنِ الشك على اختلاف ساعة الكاميرا وغياب اسم المعدّل.'),
        jsonb_build_object('key', 'detective', 'kind', 'detective', 'name', 'المحقق', 'optional', true,
          'secret', 'رتّب الخط الزمني من 23:50 حتى 03:10.',
          'fallback', 'توقيع إرجاع المفتاح لا يطابق أي نموذج.', 'fallback_stage', 2),
        jsonb_build_object('key', 'witness-a', 'kind', 'witness', 'name', 'شاهد الممر',
          'secret', 'سمعت نقاشًا حوالي 00:16. لم أرَ الوجوه.',
          'later', 'الإضاءة كانت خافتة.', 'later_stage', 2),
        jsonb_build_object('key', 'witness-b', 'kind', 'witness', 'name', 'موظف البوابة', 'optional', true,
          'secret', 'رأيت أحد المتهمين عند البوابة بعد منتصف الليل.',
          'fallback', 'البوابة كانت مزدحمة.', 'fallback_stage', 3)
      ),
      true,
      6
    );
  end if;
end $$;

do $$
declare
  v_id uuid;
begin
  select id into v_id from public.court_cases where slug = 'museum-gap' limit 1;
  if v_id is null then
    insert into public.court_cases (
      slug, title, category, intro, difficulty, guilty, truth, evidence, roles, is_active, min_players
    ) values (
      'museum-gap',
      'فجوة المتحف',
      'سرقة أثر',
      'اختفت قطعة من خزانة عرض بعد حفل افتتاح. المفاتيح محدودة، وسجل الزوار أكبر من العدد عند الباب.',
      3,
      false,
      'الحقيقة: المتهم بريء. السرقة عبر نسخة مفتاح قديمة أثناء ازدحام الحفل بينما المتهم كان في قاعة أخرى.',
      jsonb_build_array(
        jsonb_build_object('stage', 1, 'icon', '🗝️', 'title', 'سجل المفاتيح', 'time', '19:40',
          'text', 'المفتاح الرسمي مع المتهم من 19:40 إلى 21:05. لا سجل لنسخة ثانية في النظام.'),
        jsonb_build_object('stage', 1, 'icon', '📷', 'title', 'صورة جماعية', 'time', '20:20',
          'text', 'صورة تُظهر المتهم في القاعة الجانبية بين 20:15 و20:30.'),
        jsonb_build_object('stage', 2, 'icon', '🚪', 'title', 'باب الخدمة', 'time', '20:22',
          'text', 'مستشعر باب الخدمة فُتح 18 ثانية. لا كاميرا مباشرة على هذا الباب.'),
        jsonb_build_object('stage', 2, 'icon', '🧾', 'title', 'قائمة الزوار', 'time', null,
          'text', 'البطاقات الممسوحة أقل بثلاثة من توقيعات الاستقبال.'),
        jsonb_build_object('stage', 3, 'icon', '🧰', 'title', 'صندوق الصيانة', 'time', '18:50',
          'text', 'صندوق أدوات مفتوح قرب باب الخدمة وفيه مفك يناسب قفلًا قديمًا.'),
        jsonb_build_object('stage', 3, 'icon', '📧', 'title', 'بريد قديم', 'time', null,
          'text', 'رسالة من موظف سابق تطلب الإبقاء على نسخة مفتاح للطوارئ بلا رد موثّق.')
      ),
      jsonb_build_array(
        jsonb_build_object('key', 'accused', 'kind', 'accused', 'name', 'أمين العرض',
          'secret', 'أنت بريء. كنت مع الضيوف في القاعة الجانبية.'),
        jsonb_build_object('key', 'prosecutor', 'kind', 'prosecutor', 'name', 'المدعي العام',
          'secret', 'اربط سجل المفتاح بالمتهم.'),
        jsonb_build_object('key', 'lawyer', 'kind', 'lawyer', 'name', 'المحامي',
          'secret', 'استخدم الصورة الجماعية وباب الخدمة ونسخة المفتاح القديمة.'),
        jsonb_build_object('key', 'detective', 'kind', 'detective', 'name', 'المحقق', 'optional', true,
          'secret', 'ركز على فرق عدد الزوار ومفك القفل القديم.',
          'fallback', 'القفل القديم استُهدف من باب الخدمة.', 'fallback_stage', 2),
        jsonb_build_object('key', 'witness', 'kind', 'witness', 'name', 'منسق الحفل',
          'secret', 'رأيت المتهم في القاعة الجانبية أثناء كلمة الراعي.',
          'later', 'ومضة إضاءة من باب الخدمة حوالي 20:22.', 'later_stage', 2)
      ),
      true,
      5
    );
  end if;
end $$;
