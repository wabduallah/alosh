-- أسئلة متوسطة وصعبة للألعاب المنشورة. آمن للتكرار عبر source.
insert into questions (game_id, prompt_ar, prompt_en, kind, choices, correct, difficulty, points, status, source)
select g.id, q.prompt_ar, q.prompt_en, 'choice', q.choices::jsonb, q.correct, q.difficulty, q.points, 'published', 'difficulty'
from games g
join (
  values
    ('ما المدينة التي تسمى عاصمة الضباب؟', 'London', 'medium', 12, '[{"id":"a","ar":"لندن","en":"London"},{"id":"b","ar":"باريس","en":"Paris"},{"id":"c","ar":"مدريد","en":"Madrid"}]', 'a'),
    ('من العالم الذي وضع قوانين الحركة الثلاثة؟', 'Newton', 'medium', 12, '[{"id":"a","ar":"نيوتن","en":"Newton"},{"id":"b","ar":"أينشتاين","en":"Einstein"},{"id":"c","ar":"فاراداي","en":"Faraday"}]', 'a'),
    ('أي بحر يفصل بين أوروبا وأفريقيا؟', 'Mediterranean', 'medium', 12, '[{"id":"a","ar":"المتوسط","en":"Mediterranean"},{"id":"b","ar":"الأحمر","en":"Red"},{"id":"c","ar":"الأسود","en":"Black"}]', 'a'),
    ('ما العنصر الذي رمزه Au؟', 'Gold', 'hard', 16, '[{"id":"a","ar":"الذهب","en":"Gold"},{"id":"b","ar":"الفضة","en":"Silver"},{"id":"c","ar":"النحاس","en":"Copper"}]', 'a'),
    ('في أي عام توحّدت ألمانيا الحديثة؟', '1990', 'hard', 16, '[{"id":"a","ar":"1990","en":"1990"},{"id":"b","ar":"1989","en":"1989"},{"id":"c","ar":"1945","en":"1945"}]', 'a'),
    ('ما أطول نهر في آسيا؟', 'Yangtze', 'hard', 16, '[{"id":"a","ar":"اليانغتسي","en":"Yangtze"},{"id":"b","ar":"الجانج","en":"Ganges"},{"id":"c","ar":"الميكونغ","en":"Mekong"}]', 'a')
) as q(prompt_ar, prompt_en, difficulty, points, choices, correct) on true
where g.status = 'published' and g.engine in ('quiz', 'choice', 'trivia')
  and not exists (
    select 1 from questions x where x.game_id = g.id and x.prompt_ar = q.prompt_ar and x.source = 'difficulty'
  );
