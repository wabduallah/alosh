import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { Button, cx, inputClass } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { createRoom } from "@/lib/lamma/rpc";

/** Majlis challenge: the host writes the questions, each with its own points. Limits mirror engine.server.ts. */
const MAX_QUESTIONS = 15;
const MAX_CHOICES = 4;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 14;
const POINT_CHOICES = [50, 100, 200, 300, 500];
const SECOND_CHOICES = [10, 20, 30, 60];
const TARGET_CHOICES = [0, 300, 500, 1000];

type Draft = { prompt: string; choices: string[]; correct: number; points: number };

const blankDraft = (): Draft => ({ prompt: "", choices: ["", "", "", ""], correct: 0, points: 100 });

export const Route = createFileRoute("/majlis")({
  head: () => ({ meta: [{ title: "تحدي المجالس — العش" }] }),
  component: MajlisPage,
});

/** Number of leading choices in use; blank choices may only trail. Returns null when the draft is invalid. */
function usedChoices(draft: Draft): number | null {
  const count = draft.choices.reduce((n, c, i) => (c.trim() ? i + 1 : n), 0);
  if (count < 2) return null;
  if (draft.choices.slice(0, count).some((c) => !c.trim())) return null;
  if (draft.correct >= count) return null;
  return count;
}

function MajlisPage() {
  const { lang } = useI18n();
  const navigate = useNavigate();
  const [hostName, setHostName] = useState("");
  const [hostIsPlayer, setHostIsPlayer] = useState(true);
  const [maxPlayers, setMaxPlayers] = useState(MIN_PLAYERS);
  const [seconds, setSeconds] = useState(30);
  const [targetScore, setTargetScore] = useState(0);
  const [streakMultiplier, setStreakMultiplier] = useState(false);
  const [eliminationMode, setEliminationMode] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([blankDraft()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const updateDraft = (index: number, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  const updateChoice = (index: number, choice: number, value: string) =>
    setDrafts((list) =>
      list.map((d, i) => (i === index ? { ...d, choices: d.choices.map((c, j) => (j === choice ? value : c)) } : d)),
    );

  function validate(): string | null {
    if (!drafts.length) return "أضف سؤالاً واحداً على الأقل";
    for (const [i, draft] of drafts.entries()) {
      if (!draft.prompt.trim()) return `السؤال ${i + 1}: اكتب نص السؤال`;
      if (usedChoices(draft) === null) return `السؤال ${i + 1}: أدخل خيارين على الأقل بدون فراغات بينها، واختر الإجابة الصحيحة`;
    }
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await createRoom({
      data: {
        gameId: "majlis-custom",
        rounds: drafts.length,
        seconds,
        difficulty: "mixed",
        sound: true,
        music: false,
        maxPlayers,
        locale: lang,
        hostName: hostIsPlayer ? hostName.trim() || undefined : undefined,
        hostIsPlayer,
        hostMode: hostIsPlayer ? "player" : "narrator",
        targetScore,
        streakMultiplier,
        eliminationMode,
        customQuestions: drafts.map((draft) => {
          const count = usedChoices(draft) ?? 0;
          return {
            promptAr: draft.prompt.trim(),
            choices: draft.choices.slice(0, count).map((c) => ({ ar: c.trim() })),
            correct: draft.correct,
            points: draft.points,
          };
        }),
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error === "NO_QUESTIONS" ? "أضف سؤالاً صالحاً واحداً على الأقل" : "تعذّر إنشاء الغرفة، حاول مرة أخرى");
      return;
    }
    sessionStorage.setItem(`lamma:host:${res.code}`, res.hostToken);
    if (res.playerToken) sessionStorage.setItem(`lamma:player:${res.code}`, res.playerToken);
    void navigate({ to: "/room/$code", params: { code: res.code } });
  }

  const segment = (active: boolean) =>
    cx(
      "min-h-12 rounded-xl font-bold transition-all duration-150",
      active ? "bg-neon text-night shadow-[0_0_16px_rgb(6_182_212/0.35)]" : "text-muted hover:text-ivory",
    );
  const card = (active: boolean) =>
    cx(
      "min-h-12 rounded-2xl border font-bold transition-all duration-150",
      active ? "border-neon bg-neon text-night shadow-[0_0_16px_rgb(6_182_212/0.35)]" : "border-white/10 bg-white/[0.03] text-muted hover:border-neon/40 hover:text-ivory",
    );

  return (
    <Shell>
      <header className="mb-5">
        <h1 className="text-3xl font-extrabold text-neon">تحدي المجالس</h1>
        <p className="mt-1 text-sm text-muted">اكتب أسئلتك، وحدّد نقاط كل سؤال. عدد الجولات = عدد الأسئلة (حتى {MAX_QUESTIONS}).</p>
      </header>

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <section className="glass-card space-y-5 rounded-3xl p-4 sm:p-6">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={card(!hostIsPlayer)} onClick={() => setHostIsPlayer(false)}>المضيف يدير فقط</button>
            <button type="button" className={card(hostIsPlayer)} onClick={() => setHostIsPlayer(true)}>المضيف يشارك</button>
          </div>
          {hostIsPlayer ? (
            <label className="block space-y-1">
              <span className="text-sm text-muted">اسمك في اللعبة (اختياري)</span>
              <input className={inputClass} value={hostName} maxLength={16} onChange={(e) => setHostName(e.target.value)} placeholder="المضيف" />
            </label>
          ) : null}

          <div>
            <p className="mb-2 font-bold">الوقت لكل سؤال</p>
            <div className="grid grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-1">
              {SECOND_CHOICES.map((n) => (
                <button key={n} type="button" className={segment(seconds === n)} onClick={() => setSeconds(n)}>{n}</button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 font-bold">عدد اللاعبين</p>
            <div className="grid grid-cols-3 items-center rounded-2xl border border-white/10 bg-white/[0.02]">
              <button type="button" aria-label="تقليل" disabled={maxPlayers <= MIN_PLAYERS} className="min-h-12 text-xl text-muted disabled:opacity-30" onClick={() => setMaxPlayers(Math.max(MIN_PLAYERS, maxPlayers - 1))}>−</button>
              <span className="text-center font-display text-3xl font-bold text-neon tabular-nums">{maxPlayers}</span>
              <button type="button" aria-label="زيادة" disabled={maxPlayers >= MAX_PLAYERS} className="min-h-12 text-xl text-muted disabled:opacity-30" onClick={() => setMaxPlayers(Math.min(MAX_PLAYERS, maxPlayers + 1))}>+</button>
            </div>
          </div>

          <div>
            <p className="mb-2 font-bold">حد النقاط للفوز</p>
            <div className="grid grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-1">
              {TARGET_CHOICES.map((n) => (
                <button key={n} type="button" className={segment(targetScore === n)} onClick={() => setTargetScore(n)}>{n === 0 ? "بلا حد" : n}</button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 font-bold">مضاعف الإجابات المتتالية</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={card(!streakMultiplier)} onClick={() => setStreakMultiplier(false)}>بدون</button>
                <button type="button" className={card(streakMultiplier)} onClick={() => setStreakMultiplier(true)}>تفعيل</button>
              </div>
            </div>
            <div>
              <p className="mb-2 font-bold">الإقصاء السريع</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={card(!eliminationMode)} onClick={() => setEliminationMode(false)}>بدون</button>
                <button type="button" className={card(eliminationMode)} onClick={() => setEliminationMode(true)}>تفعيل</button>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          {drafts.map((draft, index) => (
            <div key={index} className="glass-card space-y-4 rounded-3xl p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <p className="font-display text-xl font-bold text-neon">السؤال {index + 1}</p>
                <button
                  type="button"
                  disabled={drafts.length <= 1}
                  className="min-h-10 rounded-full border border-crimson/50 px-3 text-sm font-bold text-red-200 disabled:opacity-30"
                  onClick={() => setDrafts(drafts.filter((_, i) => i !== index))}
                >
                  حذف
                </button>
              </div>
              <input className={inputClass} value={draft.prompt} maxLength={200} placeholder="نص السؤال" onChange={(e) => updateDraft(index, { prompt: e.target.value })} />
              <div className="space-y-2">
                {draft.choices.map((choice, c) => (
                  <div key={c} className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`الخيار ${c + 1} هو الإجابة الصحيحة`}
                      aria-pressed={draft.correct === c}
                      onClick={() => updateDraft(index, { correct: c })}
                      className={cx("size-11 shrink-0 rounded-full border-2 font-bold transition", draft.correct === c ? "border-emerald bg-emerald/20 text-emerald" : "border-white/15 text-muted")}
                    >
                      {c + 1}
                    </button>
                    <input className={inputClass} value={choice} maxLength={80} placeholder={`الخيار ${c + 1}${c < 2 ? "" : " (اختياري)"}`} onChange={(e) => updateChoice(index, c, e.target.value)} />
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-2 text-sm text-muted">نقاط هذا السؤال</p>
                <div className="grid grid-cols-5 gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-1">
                  {POINT_CHOICES.map((n) => (
                    <button key={n} type="button" className={segment(draft.points === n)} onClick={() => updateDraft(index, { points: n })}>{n}</button>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <Button
            type="button"
            tone="glass"
            disabled={drafts.length >= MAX_QUESTIONS}
            onClick={() => setDrafts([...drafts, blankDraft()])}
            className="w-full"
          >
            أضف سؤالاً ({drafts.length}/{MAX_QUESTIONS})
          </Button>
        </section>

        {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 w-full rounded-full bg-neon font-extrabold text-night shadow-[0_0_22px_rgb(6_182_212/0.35)] transition hover:brightness-110 disabled:opacity-40"
        >
          ابدأ التحدي
        </button>
      </form>
    </Shell>
  );
}
