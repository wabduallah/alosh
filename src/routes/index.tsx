import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { cx, inputClass } from "@/components/ui";
import { joinLiarsRoom } from "@/lib/liars/rpc";
import { saveToken } from "@/lib/liars/tokens";
import { ERROR_TEXT, POINT_LEVELS } from "@/lib/liars/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "العش — ألعاب جماعية للعائلة والأصدقاء" },
      { name: "description", content: "افتح عشًا على الشاشة الكبيرة، ويلعب الجميع من جوالاتهم. أول لعبة: الكذابون." },
    ],
  }),
  component: Home,
});

/** A slice of the real board: three columns, four levels, one cell open. */
const PREVIEW = [
  { icon: "🌐", name: "ثقافة عامة" },
  { icon: "🇸🇦", name: "السعودية" },
  { icon: "🚀", name: "فضاء" },
];

function BoardPreview() {
  return (
    <div className="glass-card rounded-3xl p-3 sm:p-4" aria-hidden="true">
      <div className="grid grid-cols-3 gap-2">
        {PREVIEW.map((c) => (
          <div key={c.name} className="flex flex-col items-center gap-0.5 rounded-xl border border-violet/40 bg-violet/15 px-1 py-2">
            <span className="text-xl">{c.icon}</span>
            <span className="text-xs font-extrabold text-ivory">{c.name}</span>
          </div>
        ))}
        {POINT_LEVELS.slice(0, 4).map((points, row) =>
          PREVIEW.map((c, col) => {
            const used = (row === 0 && col !== 1) || (row === 1 && col === 2);
            const open = row === 2 && col === 1;
            return (
              <div
                key={`${c.name}-${points}`}
                className={cx(
                  "grid h-11 place-items-center rounded-xl border text-lg font-extrabold tabular-nums sm:h-12 sm:text-xl",
                  open && "border-neon bg-neon text-night shadow-[0_0_24px_rgb(6_182_212/0.55)]",
                  used && "border-white/5 bg-white/[0.02] text-transparent",
                  !open && !used && "border-neon/30 bg-deep text-neon",
                )}
              >
                {used ? "" : points}
              </div>
            );
          }),
        )}
      </div>
      <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-bold text-ivory">
        في أي مدينة يقع المسجد النبوي؟
      </p>
    </div>
  );
}

function QuickJoin() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await joinLiarsRoom({ data: { code, name } });
      if (!res.ok) {
        setError(ERROR_TEXT[res.error]);
        return;
      }
      saveToken(res.code, "player", res.playerToken);
      void navigate({ to: "/games/liars/arena", search: { code: res.code, view: "pad" } });
    } catch {
      setError("تعذّر الاتصال بالخادم. حاول مجددًا.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      id="join"
      className="glass-card scroll-mt-24 space-y-4 rounded-3xl p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <h2 className="text-xl font-extrabold text-ivory">انضمام سريع</h2>
        <p className="mt-1 text-sm text-muted">اكتب الرمز الظاهر على شاشة المضيف، ثم اسمك.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className="block space-y-1.5 text-sm">
          <span className="text-muted">رمز العش</span>
          <input
            id="join-code"
            className={cx(inputClass, "text-center text-xl font-extrabold tracking-[0.3em] uppercase")}
            dir="ltr"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            placeholder="ABC23"
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="text-muted">اسمك</span>
          <input
            id="join-name"
            className={inputClass}
            maxLength={16}
            autoComplete="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: نورة"
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-crimson">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || code.length < 4 || name.trim().length < 2}
        className="min-h-12 w-full rounded-full border border-neon px-6 font-extrabold text-neon transition hover:bg-neon/10 disabled:opacity-50"
      >
        {busy ? "جارٍ الانضمام…" : "ادخل العش"}
      </button>
    </form>
  );
}

const STEPS = [
  { title: "افتح عشًا", body: "المضيف يختار حتى 6 فئات ويضبط المؤقت والمساعدات، ثم يعرض الشاشة على التلفاز." },
  { title: "انضموا بالرمز", body: "كل لاعب يمسح رمز QR أو يكتب رمز العش من جواله. لا حاجة لتسجيل حساب." },
  { title: "اختر خانة", body: "صاحب الدور يختار فئة ونقاطًا من اللوحة، فيظهر السؤال على كل الشاشات معًا." },
  { title: "اكشف الكذابين", body: "لكل سؤال إجابة صادقة وثلاث كاذبة. من يختار الصادقة يكسب نقاط الخانة، ويُكشف الجواب للجميع." },
];

const RULES = [
  { title: "النقاط", body: `تسعة مستويات في كل فئة: من ${POINT_LEVELS[0]} إلى ${POINT_LEVELS[POINT_LEVELS.length - 1]}. كلما ارتفعت النقاط صعب السؤال.` },
  { title: "مكافأة السرعة", body: "إن فعّلها المضيف، الإجابة الصحيحة السريعة تكسب حتى 50% إضافية." },
  { title: "خصم الكذبة", body: "إن فعّله المضيف، من يصدّق خيارًا كاذبًا يخسر نصف نقاط الخانة." },
  { title: "حذف إجابتين", body: "مساعدة لمرة واحدة لكل لاعب: تخفي خيارين كاذبين من سؤال واحد." },
  { title: "نهاية اللعبة", body: "تنتهي عندما تُفتح كل خانات اللوحة، أو عندما ينهيها المضيف. الأعلى نقاطًا يفوز." },
];

function Home() {
  return (
    <Shell>
      <section className="grid items-center gap-8 pt-2 lg:grid-cols-[1.1fr_1fr] lg:pt-8">
        <div className="space-y-6">
          <h1 className="text-balance text-5xl font-extrabold leading-tight text-ivory sm:text-6xl">
            العش
            <span className="mt-2 block text-2xl font-bold text-muted sm:text-3xl">شاشة واحدة للعبة، وجوال لكل لاعب.</span>
          </h1>
          <p className="max-w-xl text-lg text-ivory/80">
            افتح عشًا على التلفاز، وادعُ العائلة والأصدقاء بالرمز. أول ألعابنا «الكذابون»: لوحة أسئلة بست فئات، وفي كل سؤال كذبة أو ثلاث.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/games/liars/setup"
              className="inline-flex min-h-13 items-center rounded-full bg-neon px-7 py-3 text-lg font-extrabold text-night shadow-[0_0_28px_rgb(6_182_212/0.45)] transition hover:brightness-110"
            >
              إنشاء عش
            </Link>
            <a
              href="#join"
              onClick={() => window.setTimeout(() => document.getElementById("join-code")?.focus(), 50)}
              className="inline-flex min-h-13 items-center rounded-full border border-neon px-7 py-3 text-lg font-extrabold text-neon transition hover:bg-neon/10"
            >
              انضمام سريع
            </a>
          </div>
        </div>
        <BoardPreview />
      </section>

      <section className="mt-12 grid gap-6 lg:grid-cols-2" aria-label="الألعاب والانضمام">
        <article className="neon-card flex flex-col gap-4 rounded-3xl p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-14 place-items-center rounded-2xl bg-violet/20 text-3xl" aria-hidden="true">
              🎭
            </span>
            <div>
              <h2 className="text-2xl font-extrabold text-ivory">الكذابون</h2>
              <p className="text-sm text-muted">من لاعب واحد إلى 14 لاعبًا</p>
            </div>
          </div>
          <p className="text-ivory/80">
            اختر حتى 6 فئات من 20، لكل فئة 9 أسئلة بنقاط متصاعدة. كل سؤال فيه إجابة صادقة وسط خيارات كاذبة. أسرعكم في كشف الصدق يتصدر.
          </p>
          <ul className="flex flex-wrap gap-2 text-xs font-bold text-ivory/80">
            <li className="rounded-full border border-white/10 px-3 py-1">20 فئة</li>
            <li className="rounded-full border border-white/10 px-3 py-1">54 خانة في اللوحة</li>
            <li className="rounded-full border border-white/10 px-3 py-1">شاشة التلفاز وجوال اللاعب</li>
          </ul>
          <Link
            to="/games/liars/setup"
            className="mt-auto inline-flex min-h-12 items-center justify-center rounded-full bg-neon px-6 font-extrabold text-night transition hover:brightness-110"
          >
            ابدأ الكذابون
          </Link>
        </article>
        <QuickJoin />
      </section>

      <section className="mt-14 space-y-6" aria-labelledby="how-title">
        <h2 id="how-title" className="text-3xl font-extrabold text-ivory">
          تعليمات الموقع وطرق اللعب
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="glass-card rounded-3xl p-5">
              <span className="grid size-9 place-items-center rounded-full bg-neon text-base font-extrabold text-night">{i + 1}</span>
              <h3 className="mt-3 text-lg font-extrabold text-ivory">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
        <div className="glass-card rounded-3xl p-5 sm:p-6">
          <h3 className="text-xl font-extrabold text-ivory">قواعد الكذابون</h3>
          <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {RULES.map((rule) => (
              <div key={rule.title}>
                <dt className="font-bold text-neon">{rule.title}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-ivory/80">{rule.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </Shell>
  );
}
