import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { Shell } from "@/components/shell";
import { cx, inputClass } from "@/components/ui";
import { createLiarsRoom, listLiarsCategories } from "@/lib/liars/rpc";
import { saveToken } from "@/lib/liars/tokens";
import {
  DEFAULT_TIMER,
  ERROR_TEXT,
  MAX_CATEGORIES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  POINT_LEVELS,
  TIMER_CHOICES,
} from "@/lib/liars/types";

export const Route = createFileRoute("/games/liars/setup")({
  loader: () => listLiarsCategories(),
  head: () => ({
    meta: [
      { title: "إعداد الكذابون — العش" },
      { name: "description", content: "اختر حتى 6 فئات، اضبط المؤقت والمساعدات، وافتح العش." },
    ],
  }),
  component: SetupPage,
});

function SetupPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const categories = data.ok ? data.categories : [];
  const [selected, setSelected] = useState<string[]>([]);
  const [timerSeconds, setTimerSeconds] = useState<number>(DEFAULT_TIMER);
  const [fiftyFifty, setFiftyFifty] = useState(true);
  const [speedBonus, setSpeedBonus] = useState(true);
  const [penalty, setPenalty] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(MAX_PLAYERS);
  const [hostPlays, setHostPlays] = useState(false);
  const [hostName, setHostName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data.ok) {
    return (
      <Shell>
        <section className="glass-card mx-auto mt-8 max-w-lg rounded-3xl p-6 text-center">
          <h1 className="text-2xl font-extrabold text-ivory">الكذابون غير جاهزة بعد</h1>
          <p className="mt-2 text-muted">{ERROR_TEXT[data.error]}</p>
        </section>
      </Shell>
    );
  }

  const full = selected.length >= MAX_CATEGORIES;
  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_CATEGORIES ? prev : [...prev, id]));

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await createLiarsRoom({
        data: {
          categories: selected,
          settings: { timerSeconds, fiftyFifty, speedBonus, penalty, maxPlayers },
          hostName: hostPlays ? hostName : "",
        },
      });
      if (!res.ok) {
        setError(ERROR_TEXT[res.error]);
        return;
      }
      saveToken(res.code, "host", res.hostToken);
      saveToken(res.code, "player", res.playerToken);
      void navigate({ to: "/games/liars/arena", search: { code: res.code, view: "host" } });
    } catch {
      setError("تعذّر الاتصال بالخادم. حاول مجددًا.");
    } finally {
      setBusy(false);
    }
  }

  const canCreate = selected.length > 0 && (!hostPlays || hostName.trim().length >= 2) && !busy;

  return (
    <Shell>
      <div className="mx-auto max-w-5xl space-y-8 pb-28">
        <header className="space-y-2">
          <h1 className="text-3xl font-extrabold text-ivory sm:text-4xl">إعداد الكذابون</h1>
          <p className="max-w-2xl text-muted">
            اختر حتى {MAX_CATEGORIES} فئات. كل فئة عمود في اللوحة فيه 9 أسئلة، من {POINT_LEVELS[0]} إلى{" "}
            {POINT_LEVELS[POINT_LEVELS.length - 1]} نقطة. ترتيب اختيارك هو ترتيب الأعمدة.
          </p>
        </header>

        <section aria-labelledby="cats-title" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="cats-title" className="text-xl font-extrabold text-ivory">
              الفئات
            </h2>
            <p className={cx("text-sm font-bold tabular-nums", full ? "text-neon" : "text-muted")} aria-live="polite">
              اخترت {selected.length} من {MAX_CATEGORIES}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-5">
            {categories.map((cat) => {
              const order = selected.indexOf(cat.id);
              const on = order >= 0;
              const disabled = !cat.ready || (!on && full);
              return (
                <button
                  key={cat.id}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => toggle(cat.id)}
                  className={cx(
                    "relative flex min-h-20 items-center gap-3 rounded-2xl border px-3 py-3 text-start transition",
                    on ? "border-neon bg-neon/12 shadow-[0_0_18px_rgb(6_182_212/0.25)]" : "border-white/10 bg-white/[0.03]",
                    !disabled && !on && "hover:border-neon/50",
                    disabled && "cursor-not-allowed opacity-40",
                  )}
                >
                  <span className="text-2xl" aria-hidden="true">
                    {cat.icon}
                  </span>
                  <span className="min-w-0 font-extrabold leading-tight text-ivory">{cat.nameAr}</span>
                  {on ? (
                    <span className="absolute end-2 top-2 grid size-6 place-items-center rounded-full bg-neon text-xs font-extrabold text-night">
                      {order + 1}
                    </span>
                  ) : null}
                  {!cat.ready ? <span className="absolute bottom-1.5 end-2 text-[10px] text-muted">قريبًا</span> : null}
                </button>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="opts-title" className="grid gap-6 lg:grid-cols-2">
          <h2 id="opts-title" className="sr-only">
            خيارات اللعبة
          </h2>
          <div className="glass-card space-y-3 rounded-3xl p-5">
            <h3 className="font-extrabold text-ivory">مؤقت السؤال</h3>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="مؤقت السؤال">
              {TIMER_CHOICES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={timerSeconds === s}
                  onClick={() => setTimerSeconds(s)}
                  className={cx(
                    "min-h-11 rounded-full border px-4 text-sm font-bold tabular-nums transition",
                    timerSeconds === s ? "border-neon bg-neon text-night" : "border-white/15 text-ivory hover:border-neon/60",
                  )}
                >
                  {s === 0 ? "بلا مؤقت" : `${s} ث`}
                </button>
              ))}
            </div>
            <p className="text-sm text-muted">
              {timerSeconds === 0 ? "يُكشف الجواب عندما يجيب كل اللاعبين المتصلين، أو عندما يكشفه المضيف." : "عند انتهاء الوقت يُكشف الجواب تلقائيًا."}
            </p>

            <h3 className="pt-3 font-extrabold text-ivory">الحد الأقصى للاعبين</h3>
            <div className="flex items-center gap-3">
              <StepButton label="أقل" onClick={() => setMaxPlayers((n) => Math.max(MIN_PLAYERS, n - 1))} disabled={maxPlayers <= MIN_PLAYERS}>
                <Minus className="size-4" />
              </StepButton>
              <span className="w-10 text-center text-2xl font-extrabold tabular-nums text-ivory" aria-live="polite">
                {maxPlayers}
              </span>
              <StepButton label="أكثر" onClick={() => setMaxPlayers((n) => Math.min(MAX_PLAYERS, n + 1))} disabled={maxPlayers >= MAX_PLAYERS}>
                <Plus className="size-4" />
              </StepButton>
            </div>
          </div>

          <div className="glass-card space-y-1 rounded-3xl p-5">
            <h3 className="mb-2 font-extrabold text-ivory">المساعدات والمعدّلات</h3>
            <Toggle id="opt-fifty" checked={fiftyFifty} onChange={setFiftyFifty} title="حذف إجابتين" body="كل لاعب يستطيع مرة واحدة إخفاء خيارين كاذبين." />
            <Toggle id="opt-speed" checked={speedBonus} onChange={setSpeedBonus} title="مكافأة السرعة" body="الإجابة الصحيحة السريعة تكسب حتى 50% إضافية." />
            <Toggle id="opt-penalty" checked={penalty} onChange={setPenalty} title="خصم الكذبة" body="من يصدّق خيارًا كاذبًا يخسر نصف نقاط الخانة." />
            <Toggle id="opt-host" checked={hostPlays} onChange={setHostPlays} title="أشارك كلاعب" body="تظهر لك خانة إجابة على هذا الجهاز بجانب الشاشة." />
            {hostPlays ? (
              <label className="block space-y-1.5 pt-2 text-sm">
                <span className="text-muted">اسمك في اللعبة</span>
                <input
                  id="opt-host-name"
                  className={inputClass}
                  value={hostName}
                  maxLength={16}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="مثال: أبو فهد"
                />
              </label>
            ) : null}
          </div>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-night/90 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            {error ? (
              <span role="alert" className="text-crimson">
                {error}
              </span>
            ) : selected.length ? (
              <span className="text-muted">
                {selected.length} فئات، {selected.length * 9} سؤالًا في اللوحة
              </span>
            ) : (
              <span className="text-muted">اختر فئة واحدة على الأقل للبدء.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link to="/" className="min-h-12 rounded-full border border-white/15 px-5 py-3 text-sm font-bold text-ivory">
              رجوع
            </Link>
            <button
              type="button"
              disabled={!canCreate}
              onClick={() => void create()}
              className="min-h-12 rounded-full bg-neon px-6 font-extrabold text-night shadow-[0_0_22px_rgb(6_182_212/0.4)] disabled:opacity-50 disabled:shadow-none"
            >
              {busy ? "جارٍ الإنشاء…" : "افتح العش"}
            </button>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function StepButton({ children, label, onClick, disabled }: { children: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 place-items-center rounded-full border border-white/15 text-ivory hover:border-neon/60 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  title,
  body,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  body: string;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-2xl px-1 py-2.5">
      <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden="true"
        className={cx(
          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-neon",
          checked ? "border-neon bg-neon text-night" : "border-white/25",
        )}
      >
        {checked ? <Check className="size-4" /> : null}
      </span>
      <span>
        <span className="block font-bold text-ivory">{title}</span>
        <span className="block text-sm text-muted">{body}</span>
      </span>
    </label>
  );
}
