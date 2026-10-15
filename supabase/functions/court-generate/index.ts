// «المحكمة»: مولّد قضايا بالذكاء الاصطناعي (Supabase Edge Function).
//
// التفعيل مرة واحدة:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy court-generate
// (اختياري) COURT_AI_MODEL لتغيير النموذج.
//
// يستقبل {category, difficulty, dual, guilty, players, idea} ويعيد {case} بنفس شكل court_cases
// (title, category, difficulty, summary, intro, guilty, truth, roles, evidence, suspects, culprit, juror_clues).
// القضية مسودة: المضيف يراجعها ويعدّلها قبل اللعب. الحد: 5 طلبات في الساعة لكل مستخدم (30 للمدير).

import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = Deno.env.get("COURT_AI_MODEL") ?? "claude-sonnet-5-5";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SCHEMA = `{
  "title": "عنوان قصير (حتى 60 حرفًا)",
  "category": "نوع القضية بكلمة أو كلمتين",
  "difficulty": 1 | 2 | 3,
  "summary": "سطر للمضيف لا يكشف الحقيقة",
  "intro": "القصة كما تُعرض للجميع، 3 إلى 5 جمل، تذكر المتهم والتهمة",
  "guilty": true | false,            // حقيقة المتهم الأول
  "truth": "ماذا حدث فعلًا، وكيف تربط الأدلة بالحل (3 إلى 5 جمل)",
  "roles": [
    {"key": "accused", "kind": "accused", "name": "اسم، صفة", "brief": "وصف معلن", "secret": "ما يعرفه ويخفيه وقصته أمام المحكمة", "guilty": true|false, "goal": "هدف سري (اختياري)"},
    // متهم ثانٍ إذا طُلب: {"key": "accused-2", "kind": "accused", ..., "guilty": true|false}
    {"key": "prosecutor", "kind": "prosecutor", "name": "المدعي العام", "brief": "...", "secret": "ملفه، وما يعرفه من أدلة، ونقطة ضعف الاتهام", "exhibits": [{"icon": "📎", "title": "...", "text": "...", "time": "21:00"}]},
    {"key": "lawyer", "kind": "lawyer", "name": "المحامي", "brief": "...", "secret": "ما يقوله موكله، والثغرات التي يبحث عنها", "exhibits": [{"icon": "📎", "title": "...", "text": "..."}]},
    {"key": "w1", "kind": "witness", "name": "اسم، صفة", "brief": "...", "secret": "ما رآه بالضبط، وما لم يره", "win": "truth" | "convict" | "acquit", "goal": "..."},
    {"key": "detective", "kind": "detective", "name": "...", "brief": "...", "secret": "...", "later": "معلومة تصله في الجولة 2", "later_stage": 2, "optional": true, "fallback": "إفادته إذا لم يلعبه أحد", "fallback_stage": 2},
    {"key": "w2", "kind": "witness", ..., "optional": true, "fallback": "..."}
  ],
  "evidence": [ {"stage": 1 | 2, "icon": "إيموجي", "title": "عنوان", "text": "نص الدليل", "time": "21:20 (اختياري، بنظام 24 ساعة)"} ],
  "suspects": [ {"key": "s1", "name": "اسم المشتبه"} ],   // 3 أو 4، منهم المتهم والفاعل الحقيقي
  "culprit": "مفتاح الفاعل من suspects",
  "juror_clues": ["معلومة صغيرة أو شك قد يضلل", "..."]   // 4
}`;

function prompt(o: { category?: string; difficulty: number; dual: boolean; guilty: string; players: number; idea?: string }) {
  return `اكتب قضية جديدة للعبة «المحكمة»، لعبة سهرات جماعية بالجوال. اللاعبون أدوار: متهم ومدعٍ عام ومحامٍ وشهود ومحقق، والباقي محلّفون يصوّتون مذنب أو بريء ثم تُكشف الحقيقة.

الشروط:
- عربية فصحى سهلة، بأسماء وأماكن سعودية وخليجية، ومواضيع عائلية مناسبة للجميع (لا عنف دموي ولا مخدرات ولا محتوى غير لائق).
- الصعوبة ${o.difficulty} من 3. ${o.category ? `النوع: ${o.category}.` : "اختر النوع: سرقة، احتيال، حادث، عمل، مدرسة، حيّ، أو فكاهية."}
- ${o.dual ? "متهمان (accused و accused-2)، ولكل منهما حقيقته: يمكن أن يكون أحدهما مذنبًا والآخر بريئًا، أو كلاهما شريكين." : "متهم واحد."}
- حقيقة المتهم${o.dual ? " الأول" : ""}: ${o.guilty === "guilty" ? "مذنب" : o.guilty === "innocent" ? "بريء" : "اختر أنت"}.
- مناسبة لـ ${o.players} لاعبين تقريبًا: أدوار أساسية (المتهم، المدعي، المحامي، شاهد واحد على الأقل) ثم أدوار اختيارية (optional) لكل منها fallback.
- 5 إلى 7 أدلة على جولتين. الأدلة تلمّح ولا تكشف الحل صراحة، وفيها تناقض في الأوقات يُكتشف بالخط الزمني، ودليل واحد على الأقل يضلل.
- لا يوجد دليل واحد يحسم القضية وحده: الحل يأتي من ربط دليلين أو شهادة ودليل.
- شاهد واحد على الأقل له مصلحة (win: convict أو acquit) وهدف سري.
- لكل من المدعي والمحامي دليل في ملفه (exhibits) يكشفه متى شاء، أحدهما قوي والآخر ضعيف أو مضلل.
- أسرار الأدوار تصف ما يعرفه الشخص فقط، وتخبره كيف يتصرف، دون أن تكشف الحقيقة كاملة لمن لا يعرفها.
${o.idea ? `- فكرة المضيف: ${o.idea}` : ""}

أعد كائن JSON واحدًا فقط بهذا الشكل، بلا أي نص قبله أو بعده:
${SCHEMA}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD" }, 405);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "NOT_CONFIGURED" }, 503);

  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return json({ error: "NO_SESSION" }, 401);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const isAdmin = who.user.app_metadata?.role === "admin";
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("court_ai_log").select("id", { count: "exact", head: true }).eq("user_id", who.user.id).gte("at", since);
  if ((count ?? 0) >= (isAdmin ? 30 : 5)) return json({ error: "TOO_MANY" }, 429);

  const body = await req.json().catch(() => ({}));
  const o = {
    category: typeof body.category === "string" ? body.category.slice(0, 40) : undefined,
    difficulty: [1, 2, 3].includes(Number(body.difficulty)) ? Number(body.difficulty) : 2,
    dual: body.dual === true,
    guilty: ["guilty", "innocent"].includes(body.guilty) ? body.guilty : "any",
    players: Math.max(4, Math.min(12, Number(body.players) || 7)),
    idea: typeof body.idea === "string" ? body.idea.slice(0, 300) : undefined,
  };

  await admin.from("court_ai_log").insert({ user_id: who.user.id });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 6000, messages: [{ role: "user", content: prompt(o) }] }),
  });
  if (!res.ok) return json({ error: "AI_FAILED", status: res.status }, 502);
  const out = await res.json();
  const text: string = (out.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return json({ case: parsed });
  } catch {
    return json({ error: "BAD_JSON" }, 502);
  }
});
