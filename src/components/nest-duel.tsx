import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, cx, inputClass } from "@/components/ui";
import { Glyph } from "@/components/brand";
import {
  DEFAULT_TARGET,
  MAX_PLAYERS,
  MINI_GAMES,
  MINI_GAME_IDS,
  MIN_PLAYERS,
  NAME_MAX,
  TARGETS,
  applyOutcome,
  champion,
  cleanName,
  decide,
  nameProblem,
  pairKey,
  pickMiniGame,
  planRound,
  pointsText,
  ranking,
  type DuelPlayer,
  type MetCounts,
  type MiniGameId,
  type Outcome,
  type Pair,
  type Side,
  type SideResult,
} from "@/lib/nest-duel";

/*
 * «منافسة العش»: a quick 1-against-1 tournament on one phone.
 *
 *   Setup  → names (2–14), target points, how to play (one split screen, or taking turns).
 *   Board  → leaderboard and the next pair.
 *   Match  → a full-screen arena: a short guide for both players, 3-2-1, the mini-game, the result.
 *   Winner → confetti and the top three.
 *
 * Everything runs in this browser: no room, no server. The roster and an unfinished
 * tournament are kept in localStorage, so a refresh does not lose them.
 */

/* ======================================================================
 * Sound: short tones from the Web Audio API, no audio files.
 * The context is created on the first tap (browsers block audio before a gesture).
 * ==================================================================== */

type SoundKind = "tap" | "beep" | "go" | "win" | "lose" | "draw" | "foul" | "champion";

const sound = (() => {
  let ctx: AudioContext | null = null;
  let on = true;

  function audio(): AudioContext | null {
    if (typeof window === "undefined" || !on) return null;
    try {
      if (!ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        ctx = new Ctor();
      }
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }

  /** One tone: frequency in Hz, start offset and length in seconds. */
  function tone(c: AudioContext, freq: number, at: number, len: number, type: OscillatorType = "sine", vol = 0.14) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const t0 = c.currentTime + at;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + len + 0.02);
  }

  return {
    setOn(v: boolean) {
      on = v;
    },
    /** Call from a tap so later sounds are allowed. */
    unlock() {
      audio();
    },
    play(kind: SoundKind) {
      const c = audio();
      if (!c) return;
      try {
        switch (kind) {
          case "tap":
            tone(c, 660, 0, 0.04, "triangle", 0.08);
            break;
          case "beep":
            tone(c, 520, 0, 0.12, "square", 0.06);
            break;
          case "go":
            tone(c, 880, 0, 0.18, "square", 0.08);
            break;
          case "win":
            [523, 659, 784, 1047].forEach((f, i) => tone(c, f, i * 0.09, 0.16, "triangle"));
            break;
          case "lose":
            [392, 330, 262].forEach((f, i) => tone(c, f, i * 0.12, 0.2, "sine"));
            break;
          case "draw":
            [440, 440].forEach((f, i) => tone(c, f, i * 0.15, 0.12, "triangle"));
            break;
          case "foul":
            tone(c, 140, 0, 0.35, "sawtooth", 0.1);
            break;
          case "champion":
            [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(c, f, i * 0.11, 0.22, "triangle"));
            break;
        }
      } catch {
        /* sound is a bonus: never break the game for it */
      }
    },
  };
})();

/* ======================================================================
 * Timers: every timeout a screen starts is cleared when it unmounts,
 * so a mini-game can never fire into the next one.
 * ==================================================================== */

function useTimers() {
  const ids = useRef<number[]>([]);
  useEffect(
    () => () => {
      ids.current.forEach((id) => window.clearTimeout(id));
      ids.current = [];
    },
    [],
  );
  return useMemo(
    () => ({
      after(ms: number, fn: () => void) {
        const id = window.setTimeout(() => {
          ids.current = ids.current.filter((x) => x !== id);
          try {
            fn();
          } catch (error) {
            console.error("nest-duel timer", error);
          }
        }, ms);
        ids.current.push(id);
        return id;
      },
      clearAll() {
        ids.current.forEach((id) => window.clearTimeout(id));
        ids.current = [];
      },
    }),
    [],
  );
}

/* ======================================================================
 * Saved state (this browser only). Every read and write may throw, so both are guarded.
 * ==================================================================== */

type Mode = "split" | "turns";
type Settings = { target: number; mode: Mode; facing: boolean; sound: boolean };
const DEFAULT_SETTINGS: Settings = { target: DEFAULT_TARGET, mode: "split", facing: true, sound: true };

type Roster = Array<{ id: string; name: string }>;

type Tour = {
  players: DuelPlayer[];
  target: number;
  round: number;
  queue: Pair[];
  /** Matches in the current round, for «المواجهة 2 من 4». */
  roundSize: number;
  rest: string | null;
  lastRest: string | null;
  met: MetCounts;
  lastGame: MiniGameId | null;
  winner: string | null;
};

type Saved = { roster: Roster; settings: Settings; tour: Tour | null };
const STORE_KEY = "al3sh.nest-duel.v1";

function loadSaved(): Saved | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Saved>;
    const roster = Array.isArray(data.roster) ? data.roster.filter((r) => r && typeof r.id === "string" && typeof r.name === "string").slice(0, MAX_PLAYERS) : [];
    const s = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
    const settings: Settings = {
      target: (TARGETS as readonly number[]).includes(s.target) ? s.target : DEFAULT_TARGET,
      mode: s.mode === "turns" ? "turns" : "split",
      facing: s.facing !== false,
      sound: s.sound !== false,
    };
    const tour = data.tour && Array.isArray(data.tour.players) && Array.isArray(data.tour.queue) ? data.tour : null;
    return { roster, settings, tour };
  } catch {
    return null;
  }
}

function save(data: Saved) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    /* private mode or full storage: the game still works, it just will not survive a refresh */
  }
}

const newId = () => Math.random().toString(36).slice(2, 10);

/** A fresh tournament from the roster, with its first round planned. */
function startTour(roster: Roster, target: number): Tour {
  const players: DuelPlayer[] = roster.map((r) => ({ id: r.id, name: r.name, points: 0, wins: 0, draws: 0, losses: 0, rests: 0 }));
  return nextRound({ players, target, round: 0, queue: [], roundSize: 0, rest: null, lastRest: null, met: {}, lastGame: null, winner: null });
}

/** Plans the next round when the current one is over. */
function nextRound(t: Tour): Tour {
  if (t.queue.length) return t;
  const { pairs, rest } = planRound(t.players, t.met, t.lastRest);
  const players = rest ? t.players.map((p) => (p.id === rest ? { ...p, rests: p.rests + 1 } : p)) : t.players;
  return { ...t, players, round: t.round + 1, queue: pairs, roundSize: pairs.length, rest, lastRest: rest };
}

/* ======================================================================
 * The page
 * ==================================================================== */

type View = "setup" | "board" | "match" | "champion";
type Match = { a: DuelPlayer; b: DuelPlayer; game: MiniGameId };

export function NestDuel() {
  const [ready, setReady] = useState(false);
  const [roster, setRoster] = useState<Roster>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [tour, setTour] = useState<Tour | null>(null);
  const [view, setView] = useState<View>("setup");
  const [match, setMatch] = useState<Match | null>(null);
  const [howTo, setHowTo] = useState(false);
  /** A tournament left from a previous visit, offered before it is resumed. */
  const [resumable, setResumable] = useState<Tour | null>(null);

  // Load after the first paint (the page also renders on the server, without localStorage).
  useEffect(() => {
    const saved = loadSaved();
    if (saved) {
      setRoster(saved.roster);
      setSettings(saved.settings);
      if (saved.tour && !saved.tour.winner) setResumable(saved.tour);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) save({ roster, settings, tour });
  }, [ready, roster, settings, tour]);

  useEffect(() => {
    sound.setOn(settings.sound);
  }, [settings.sound]);

  // No pull-to-refresh or bounce while the game is open.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const before = [html.style.overscrollBehaviorY, body.style.overscrollBehaviorY];
    html.style.overscrollBehaviorY = "none";
    body.style.overscrollBehaviorY = "none";
    return () => {
      html.style.overscrollBehaviorY = before[0];
      body.style.overscrollBehaviorY = before[1];
    };
  }, []);

  const begin = () => {
    sound.unlock();
    setResumable(null);
    setTour(startTour(roster, settings.target));
    setView("board");
    window.scrollTo({ top: 0 });
  };

  const resume = () => {
    if (!resumable) return;
    setTour(nextRound(resumable));
    setResumable(null);
    setView("board");
  };

  const openMatch = () => {
    if (!tour?.queue.length) return;
    sound.unlock();
    const [aId, bId] = tour.queue[0];
    const a = tour.players.find((p) => p.id === aId);
    const b = tour.players.find((p) => p.id === bId);
    if (!a || !b) {
      // A pair that no longer matches the players (should not happen): skip it.
      setTour(nextRound({ ...tour, queue: tour.queue.slice(1) }));
      return;
    }
    setMatch({ a, b, game: pickMiniGame(tour.lastGame) });
    setView("match");
  };

  const finishMatch = useCallback(
    (outcome: Outcome) => {
      if (!tour || !match) return;
      const players = applyOutcome(tour.players, match.a.id, match.b.id, outcome);
      const key = pairKey(match.a.id, match.b.id);
      const done: Tour = {
        ...tour,
        players,
        queue: tour.queue.slice(1),
        met: { ...tour.met, [key]: (tour.met[key] ?? 0) + 1 },
        lastGame: match.game,
      };
      const champ = champion(players, tour.target);
      setMatch(null);
      if (champ) {
        setTour({ ...done, winner: champ.id });
        setView("champion");
        sound.play("champion");
      } else {
        setTour(nextRound(done));
        setView("board");
      }
      window.scrollTo({ top: 0 });
    },
    [tour, match],
  );

  const abortMatch = useCallback(() => {
    setMatch(null);
    setView("board");
  }, []);

  const endTour = () => {
    if (!window.confirm("تنهي البطولة؟ تضيع النقاط، والأسماء تبقى.")) return;
    setTour(null);
    setView("setup");
  };

  const again = () => {
    setTour(startTour(roster, settings.target));
    setView("board");
  };

  return (
    <div className="mx-auto grid max-w-2xl gap-4 select-none [-webkit-touch-callout:none]">
      {view === "setup" ? (
        <Setup
          roster={roster}
          setRoster={setRoster}
          settings={settings}
          setSettings={setSettings}
          onStart={begin}
          onHowTo={() => setHowTo(true)}
          resumable={resumable}
          onResume={resume}
          onDropResume={() => setResumable(null)}
        />
      ) : null}
      {view === "board" && tour ? <Board tour={tour} onPlay={openMatch} onEnd={endTour} onHowTo={() => setHowTo(true)} /> : null}
      {view === "champion" && tour ? <Champion tour={tour} onAgain={again} onSetup={() => {
            setTour(null);
            setView("setup");
          }} /> : null}
      {view === "match" && match ? <MatchScreen key={`${tour?.round}-${tour?.queue.length}`} match={match} settings={settings} onFinish={finishMatch} onAbort={abortMatch} /> : null}
      {howTo ? <HowToSheet onClose={() => setHowTo(false)} /> : null}
    </div>
  );
}

/* ======================================================================
 * Setup: names, settings, start
 * ==================================================================== */

const chip = (on: boolean) =>
  cx(
    "min-h-12 flex-1 touch-manipulation rounded-full border px-4 text-[15px] font-semibold transition",
    on ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/50 text-mist hover:border-glow hover:text-ivory",
  );

function Setup({
  roster,
  setRoster,
  settings,
  setSettings,
  onStart,
  onHowTo,
  resumable,
  onResume,
  onDropResume,
}: {
  roster: Roster;
  setRoster: (r: Roster) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  onStart: () => void;
  onHowTo: () => void;
  resumable: Tour | null;
  onResume: () => void;
  onDropResume: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const full = roster.length >= MAX_PLAYERS;

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (full) return;
    const name = cleanName(draft);
    const problem = nameProblem(name, roster.map((r) => r.name));
    if (problem) return setError(problem);
    setRoster([...roster, { id: newId(), name }]);
    setDraft("");
    setError(null);
  };

  const saveEdit = (id: string) => {
    const name = cleanName(editText);
    const problem = nameProblem(name, roster.filter((r) => r.id !== id).map((r) => r.name));
    if (problem) return setEditError(problem);
    setRoster(roster.map((r) => (r.id === id ? { ...r, name } : r)));
    setEditing(null);
    setEditError(null);
  };

  const set = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });

  return (
    <>
      <header className="surface relative grid gap-3 overflow-hidden rounded-[28px] p-5 sm:p-7">
        <span aria-hidden="true" className="pointer-events-none absolute -top-20 -start-16 size-56 rounded-full bg-[#3b82f6]/25 blur-3xl" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-20 -end-16 size-56 rounded-full bg-[#f43f5e]/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-[18px] bg-gradient-to-br from-[#3b82f6] via-violet to-[#f43f5e] text-[30px] shadow-[0_0_28px_-6px_#a855f7]">
            ⚡
          </span>
          <div className="min-w-0">
            <h1 className="text-[28px] leading-10">منافسة العش</h1>
            <p className="text-[14px] leading-6 text-mist">مواجهات سريعة 1 ضد 1 على جوال واحد</p>
          </div>
        </div>
        <Button tone="quiet" onClick={onHowTo} className="relative min-h-12 w-full touch-manipulation sm:w-fit">
          <Glyph name="question" className="size-5 text-gold" />
          كيف تلعب؟
        </Button>
      </header>

      {resumable ? (
        <section className="surface grid gap-3 rounded-[24px] border border-gold/50 p-5">
          <p className="text-[16px] font-semibold text-ivory">عندك بطولة لم تنتهِ (الجولة {resumable.round}).</p>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={onResume} className="touch-manipulation">
              كمّل البطولة
            </Button>
            <Button tone="quiet" onClick={onDropResume} className="touch-manipulation">
              ابدأ من جديد
            </Button>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="duel-names" className="surface grid gap-4 rounded-[24px] p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="duel-names" className="text-[20px] leading-8">
            اللاعبون
          </h2>
          <span className={cx("text-[14px] font-semibold", full ? "text-gold" : "text-mist")}>
            {roster.length} من {MAX_PLAYERS}
          </span>
        </div>

        <form onSubmit={add} className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            maxLength={NAME_MAX + 4}
            placeholder={full ? "اكتمل العدد" : "اسم اللاعب"}
            disabled={full}
            aria-label="اسم اللاعب"
            aria-invalid={!!error}
            enterKeyHint="done"
            className={cx(inputClass, "select-text")}
          />
          <Button type="submit" disabled={full || !draft.trim()} className="shrink-0 touch-manipulation px-5">
            أضف
          </Button>
        </form>
        {error ? <p className="-mt-2 text-[14px] text-wrong">{error}</p> : null}

        {roster.length ? (
          <ol className="grid gap-2">
            {roster.map((r, i) => (
              <li key={r.id} className="flex min-h-14 items-center gap-2 rounded-[16px] border border-line bg-deep-2/50 px-3 py-1.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-night/60 text-[14px] font-bold text-gold">{i + 1}</span>
                {editing === r.id ? (
                  <form
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveEdit(r.id);
                    }}
                  >
                    <input
                      autoFocus
                      value={editText}
                      onChange={(e) => {
                        setEditText(e.target.value);
                        setEditError(null);
                      }}
                      maxLength={NAME_MAX + 4}
                      aria-label={`تعديل اسم ${r.name}`}
                      aria-invalid={!!editError}
                      className={cx(inputClass, "min-h-11 min-w-0 flex-1 select-text")}
                    />
                    <button type="submit" aria-label="حفظ" className="grid size-11 shrink-0 touch-manipulation place-items-center rounded-full bg-correct-fill text-night">
                      <Glyph name="check" className="size-5" />
                    </button>
                    <button type="button" aria-label="إلغاء" onClick={() => {
                        setEditing(null);
                        setEditError(null);
                      }} className="grid size-11 shrink-0 touch-manipulation place-items-center rounded-full border border-line-strong/70 text-mist">
                      <Glyph name="x" className="size-5" />
                    </button>
                    {editError ? <p className="w-full text-[13px] text-wrong">{editError}</p> : null}
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ivory">{r.name}</span>
                    <button
                      type="button"
                      aria-label={`تعديل ${r.name}`}
                      onClick={() => {
                        setEditing(r.id);
                        setEditText(r.name);
                        setEditError(null);
                      }}
                      className="grid size-11 shrink-0 touch-manipulation place-items-center rounded-full border border-line-strong/70 text-mist hover:text-ivory"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      aria-label={`حذف ${r.name}`}
                      onClick={() => setRoster(roster.filter((x) => x.id !== r.id))}
                      className="grid size-11 shrink-0 touch-manipulation place-items-center rounded-full border border-wrong/60 text-wrong hover:bg-wrong-fill/15"
                    >
                      <Glyph name="x" className="size-5" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[15px] leading-7 text-mist">أضف من {MIN_PLAYERS} إلى {MAX_PLAYERS} لاعبين.</p>
        )}
      </section>

      <section aria-labelledby="duel-settings" className="surface grid gap-4 rounded-[24px] p-5 sm:p-6">
        <h2 id="duel-settings" className="text-[20px] leading-8">
          الإعدادات
        </h2>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-[15px] font-semibold text-ivory">الفوز بالبطولة عند</legend>
          <div className="flex gap-2">
            {TARGETS.map((t) => (
              <button key={t} type="button" aria-pressed={settings.target === t} onClick={() => set({ target: t })} className={chip(settings.target === t)}>
                {t} نقاط
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-[15px] font-semibold text-ivory">طريقة اللعب</legend>
          <div className="flex gap-2">
            <button type="button" aria-pressed={settings.mode === "split"} onClick={() => set({ mode: "split" })} className={chip(settings.mode === "split")}>
              شاشة مقسومة
            </button>
            <button type="button" aria-pressed={settings.mode === "turns"} onClick={() => set({ mode: "turns" })} className={chip(settings.mode === "turns")}>
              بالتناوب
            </button>
          </div>
          <p className="text-[13px] leading-6 text-mist">
            {settings.mode === "split" ? "اللاعبان معًا على الجوال نفسه، لكل واحد نصف الشاشة." : "كل لاعب يلعب دوره على الشاشة كاملة، ثم يسلّم الجوال لخصمه."}
          </p>
        </fieldset>
        {settings.mode === "split" ? (
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-[15px] font-semibold text-ivory">جلسة اللاعبين</legend>
            <div className="flex gap-2">
              <button type="button" aria-pressed={settings.facing} onClick={() => set({ facing: true })} className={chip(settings.facing)}>
                متقابلين
              </button>
              <button type="button" aria-pressed={!settings.facing} onClick={() => set({ facing: false })} className={chip(!settings.facing)}>
                بجانب بعض
              </button>
            </div>
            <p className="text-[13px] leading-6 text-mist">{settings.facing ? "الجوال على الطاولة بينكما، والنصف العلوي مقلوب لمن يجلس مقابلك." : "الاثنان يمسكان الجوال من جهة واحدة."}</p>
          </fieldset>
        ) : null}
        <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-[16px] border border-line bg-deep-2/40 px-4">
          <span className="text-[15px] font-semibold text-ivory">المؤثرات الصوتية</span>
          <input type="checkbox" checked={settings.sound} onChange={(e) => set({ sound: e.target.checked })} className="size-5 accent-[#ffa53a]" />
        </label>
      </section>

      <div className="sticky bottom-[max(12px,env(safe-area-inset-bottom))] z-10 grid gap-1">
        <Button onClick={onStart} disabled={roster.length < MIN_PLAYERS} className="min-h-16 w-full touch-manipulation text-[19px] shadow-lift">
          ⚡ ابدأ التحدي
        </Button>
        {roster.length < MIN_PLAYERS ? <p className="text-center text-[13px] text-mist">أضف لاعبين على الأقل.</p> : null}
      </div>
    </>
  );
}

/* ======================================================================
 * Leaderboard and the next match
 * ==================================================================== */

function Leaderboard({ players, target, highlight }: { players: DuelPlayer[]; target: number; highlight?: string[] }) {
  const rows = ranking(players);
  return (
    <section aria-labelledby="duel-board" className="surface grid gap-3 rounded-[24px] p-4 sm:p-6">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="duel-board" className="text-[20px] leading-8">
          🏆 لوحة الصدارة
        </h2>
        <span className="text-[13px] text-mist">الفوز عند {target} نقاط</span>
      </div>
      <ol className="grid gap-1.5">
        {rows.map((p, i) => {
          const pct = Math.min(100, (p.points / target) * 100);
          const hot = highlight?.includes(p.id);
          return (
            <li key={p.id} className={cx("relative overflow-hidden rounded-[14px] border px-3 py-2", hot ? "border-gold/70 bg-gold/10" : "border-line bg-deep-2/40")}>
              <span aria-hidden="true" className="absolute inset-y-0 start-0 bg-gradient-to-l from-violet/35 to-[#3b82f6]/25" style={{ width: `${pct}%` }} />
              <div className="relative flex items-center gap-3">
                <span className={cx("grid size-8 shrink-0 place-items-center rounded-full text-[14px] font-bold", i === 0 ? "btn-gold" : "bg-night/60 text-mist")}>{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ivory">{p.name}</span>
                <span className="text-[12px] text-faint" title="فوز · تعادل · خسارة">
                  {p.wins}ف · {p.draws}ت · {p.losses}خ
                </span>
                <span className="min-w-12 text-end text-[20px] font-bold text-gold tabular-nums">{pointsText(p.points)}</span>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="text-[12px] text-faint">ف فوز = نقطة · ت تعادل = ½ · خ خسارة = 0</p>
    </section>
  );
}

function Board({ tour, onPlay, onEnd, onHowTo }: { tour: Tour; onPlay: () => void; onEnd: () => void; onHowTo: () => void }) {
  const next = tour.queue[0];
  const name = (id: string | null) => tour.players.find((p) => p.id === id)?.name ?? "";
  const index = tour.roundSize - tour.queue.length + 1;
  return (
    <>
      <section className="surface relative grid gap-4 overflow-hidden rounded-[28px] p-5 text-center sm:p-7">
        <span aria-hidden="true" className="pointer-events-none absolute -top-16 start-0 size-48 rounded-full bg-[#3b82f6]/25 blur-3xl" />
        <span aria-hidden="true" className="pointer-events-none absolute -top-16 end-0 size-48 rounded-full bg-[#f43f5e]/25 blur-3xl" />
        <p className="relative text-[14px] font-semibold text-violet-text">
          الجولة {tour.round} · المواجهة {index} من {tour.roundSize}
        </p>
        {next ? (
          <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span className="truncate rounded-[16px] border border-[#60a5fa]/60 bg-[#3b82f6]/15 px-2 py-3 text-[20px] font-bold text-[#bfdbfe] shadow-[0_0_24px_-8px_#3b82f6]">{name(next[0])}</span>
            <span className="text-[22px] font-black text-gold">ضد</span>
            <span className="truncate rounded-[16px] border border-[#fb7185]/60 bg-[#f43f5e]/15 px-2 py-3 text-[20px] font-bold text-[#fecdd3] shadow-[0_0_24px_-8px_#f43f5e]">{name(next[1])}</span>
          </div>
        ) : null}
        {tour.rest ? <p className="relative text-[14px] text-mist">يرتاح هذه الجولة: {name(tour.rest)}</p> : null}
        <Button onClick={onPlay} className="relative min-h-16 w-full touch-manipulation text-[19px]">
          ⚡ ابدأ المواجهة
        </Button>
        <p className="relative text-[13px] text-faint">اللعبة المصغّرة تُختار بالقرعة عند البداية.</p>
      </section>
      <Leaderboard players={tour.players} target={tour.target} highlight={next ? [...next] : []} />
      <div className="grid grid-cols-2 gap-2">
        <Button tone="quiet" onClick={onHowTo} className="touch-manipulation">
          كيف تلعب؟
        </Button>
        <Button tone="danger" onClick={onEnd} className="touch-manipulation">
          إنهاء البطولة
        </Button>
      </div>
    </>
  );
}

/* ======================================================================
 * The arena: one full-screen layer, split in two halves or one panel for a turn.
 * Side «a» is on top (upside down when the players face each other), «b» at the bottom.
 * ==================================================================== */

const SIDE_TONE: Record<Side, { ring: string; text: string; soft: string; bg: string; glow: string }> = {
  a: { ring: "border-[#60a5fa]", text: "text-[#bfdbfe]", soft: "bg-[#3b82f6]/15", bg: "bg-[#1d4ed8]", glow: "shadow-[0_0_40px_-6px_#3b82f6]" },
  b: { ring: "border-[#fb7185]", text: "text-[#fecdd3]", soft: "bg-[#f43f5e]/15", bg: "bg-[#be123c]", glow: "shadow-[0_0_40px_-6px_#f43f5e]" },
};

function Arena({ sides, facing, children }: { sides: Side[]; facing: boolean; children: (side: Side) => ReactNode }) {
  // While the arena is open the page under it must not scroll.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-[60] flex touch-none flex-col bg-night select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {sides.map((side, i) => (
        <div
          key={side}
          className={cx(
            "relative flex min-h-0 flex-1 flex-col",
            sides.length === 2 && i === 0 && facing && "rotate-180",
            sides.length === 2 && i === 0 && "border-b-2 border-violet shadow-[0_0_24px_#663ade]",
            i === 0 ? "pt-[env(safe-area-inset-top)]" : "",
            i === sides.length - 1 ? "pb-[env(safe-area-inset-bottom)]" : "",
          )}
        >
          {children(side)}
        </div>
      ))}
    </div>
  );
}

/** The player's name at the top of their half. */
function NameTag({ side, name }: { side: Side; name: string }) {
  const t = SIDE_TONE[side];
  return (
    <div className="pointer-events-none flex w-full justify-center pt-2">
      <span className={cx("max-w-[80%] truncate rounded-full border px-4 py-1 text-[15px] font-bold", t.ring, t.soft, t.text)}>{name}</span>
    </div>
  );
}

const BOTH: Side[] = ["a", "b"];
const SINGLE: Record<Side, Side[]> = { a: ["a"], b: ["b"] };

type Stage = { kind: "intro" } | { kind: "count"; turn: Side | null; n: number } | { kind: "play"; turn: Side | null } | { kind: "pass"; next: Side } | { kind: "result"; outcome: Outcome };

function MatchScreen({ match, settings, onFinish, onAbort }: { match: Match; settings: Settings; onFinish: (o: Outcome) => void; onAbort: () => void }) {
  const split = settings.mode === "split";
  const facing = split && settings.facing;
  const game = MINI_GAMES[match.game];
  const names: Record<Side, string> = { a: match.a.name, b: match.b.name };
  const timers = useTimers();
  const [stage, setStage] = useState<Stage>({ kind: "intro" });
  const [readySides, setReadySides] = useState<Side[]>([]);
  const results = useRef<Partial<Record<Side, SideResult>>>({});
  const finished = useRef(false);

  // 3-2-1 with a beep each second, then the mini-game.
  const countdown = useCallback(
    (turn: Side | null) => {
      timers.clearAll();
      setStage({ kind: "count", turn, n: 3 });
      sound.play("beep");
      timers.after(800, () => {
        setStage({ kind: "count", turn, n: 2 });
        sound.play("beep");
      });
      timers.after(1600, () => {
        setStage({ kind: "count", turn, n: 1 });
        sound.play("beep");
      });
      timers.after(2400, () => setStage({ kind: "play", turn }));
    },
    [timers],
  );

  const ready = (side: Side) => {
    sound.unlock();
    sound.play("tap");
    const next = readySides.includes(side) ? readySides : [...readySides, side];
    setReadySides(next);
    if (next.length === 2) countdown(null);
  };

  const showResult = useCallback(
    (res: Partial<Record<Side, SideResult>>) => {
      const outcome = decide(match.game, res.a, res.b);
      results.current = res;
      setStage({ kind: "result", outcome });
      sound.play(outcome === "draw" ? "draw" : "win");
    },
    [match.game],
  );

  // A mini-game reports here. In turns mode the first player's result waits for the second.
  const onGameDone = useCallback(
    (res: Partial<Record<Side, SideResult>>) => {
      if (split) return showResult(res);
      const merged = { ...results.current, ...res };
      results.current = merged;
      if (stage.kind === "play" && stage.turn === "a") {
        setStage({ kind: "pass", next: "b" });
        sound.play("beep");
      } else {
        showResult(merged);
      }
    },
    [split, stage, showResult],
  );

  const finish = () => {
    if (finished.current || stage.kind !== "result") return;
    finished.current = true;
    sound.play("tap");
    onFinish(stage.outcome);
  };

  const exit = () => {
    if (window.confirm("توقف المواجهة؟ لن تُحسب، وتبقى في قائمة الانتظار.")) onAbort();
  };

  /* ---- the game itself ---- */
  if (stage.kind === "play") {
    const sides: Side[] = stage.turn ? SINGLE[stage.turn] : BOTH;
    const props = { sides, facing, names, onDone: onGameDone };
    switch (match.game) {
      case "reflex":
        return <Reflex {...props} />;
      case "taps":
        return <Taps {...props} />;
      case "precision":
        return <Precision {...props} />;
      case "memory":
        return <Memory {...props} />;
    }
  }

  /* ---- intro, countdown, hand-over, result ---- */
  const sides: Side[] = split ? BOTH : SINGLE.b;
  return (
    <Arena sides={sides} facing={facing}>
      {(panelSide) => {
        const opp: Side = panelSide === "a" ? "b" : "a";
        const t = SIDE_TONE[panelSide];

        if (stage.kind === "intro") {
          if (!split) {
            return (
              <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-5 py-6 text-center">
                <p className="text-[15px] font-semibold text-violet-text">المواجهة التالية</p>
                <div className="grid w-full max-w-md grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <span className={cx("truncate rounded-[16px] border px-2 py-3 text-[20px] font-bold", SIDE_TONE.a.ring, SIDE_TONE.a.soft, SIDE_TONE.a.text)}>{names.a}</span>
                  <span className="text-[20px] font-black text-gold">ضد</span>
                  <span className={cx("truncate rounded-[16px] border px-2 py-3 text-[20px] font-bold", SIDE_TONE.b.ring, SIDE_TONE.b.soft, SIDE_TONE.b.text)}>{names.b}</span>
                </div>
                <GameCard id={match.game} />
                <p className="max-w-sm text-[14px] leading-6 text-mist">كل لاعب يلعب دوره على الشاشة كاملة. يبدأ {names.a}، ثم {names.b}.</p>
                <Button onClick={() => (sound.unlock(), countdown("a"))} className="min-h-16 w-full max-w-md touch-manipulation text-[18px]">
                  جاهز؟ دور {names.a}
                </Button>
                <button type="button" onClick={exit} className="min-h-11 text-[14px] text-faint underline">
                  توقف المواجهة
                </button>
              </div>
            );
          }
          const isReady = readySides.includes(panelSide);
          return (
            <div className="flex flex-1 flex-col items-center justify-between gap-2 overflow-hidden px-4 py-3 text-center">
              <NameTag side={panelSide} name={names[panelSide]} />
              <div className="grid justify-items-center gap-2">
                <p className="text-[14px] text-mist">
                  ضد <span className="font-bold text-ivory">{names[opp]}</span>
                </p>
                <p className="text-[24px] font-bold text-ivory">
                  <span aria-hidden="true">{game.icon} </span>
                  {game.title}
                </p>
                <p className="max-w-sm text-[15px] leading-7 text-ivory/90">{game.hint}</p>
              </div>
              <div className="flex w-full max-w-sm items-center gap-2">
                <button
                  type="button"
                  onPointerDown={() => ready(panelSide)}
                  disabled={isReady}
                  className={cx(
                    "min-h-16 flex-1 rounded-full text-[18px] font-bold transition",
                    isReady ? "border border-correct bg-correct-fill/20 text-correct" : cx("text-white", t.bg, t.glow),
                  )}
                >
                  {isReady ? "✓ جاهز. ننتظر خصمك" : "✋ جاهز"}
                </button>
                {panelSide === "b" ? (
                  <button type="button" aria-label="توقف المواجهة" onClick={exit} className="grid size-14 shrink-0 place-items-center rounded-full border border-line-strong/70 text-mist">
                    <Glyph name="x" />
                  </button>
                ) : null}
              </div>
            </div>
          );
        }

        if (stage.kind === "count") {
          const who = stage.turn ?? panelSide;
          return (
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <NameTag side={who} name={names[who]} />
              <p className="text-[18px] text-mist">
                {game.icon} {game.title}
              </p>
              <p key={stage.n} className={cx("text-[120px] leading-none font-black", SIDE_TONE[who].text, "animate-[beat_0.8s_ease-out]")}>
                {stage.n}
              </p>
            </div>
          );
        }

        if (stage.kind === "pass") {
          const first = results.current.a;
          return (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 px-5 text-center">
              <p className="text-[16px] text-mist">نتيجة {names.a}</p>
              <p className={cx("text-[30px] font-bold", SIDE_TONE.a.text)}>{resultText(match.game, first)}</p>
              <p className="text-[20px] text-ivory">
                سلّم الجوال إلى <span className={cx("font-bold", SIDE_TONE.b.text)}>{names.b}</span>
              </p>
              <p className="max-w-sm text-[15px] leading-7 text-mist">{game.hint}</p>
              <Button onClick={() => countdown("b")} className="min-h-16 w-full max-w-md touch-manipulation text-[18px]">
                جاهز؟ دور {names.b}
              </Button>
            </div>
          );
        }

        if (stage.kind === "result") {
          // In turns mode the one panel shows both players.
          const shown: Side[] = split ? [panelSide] : ["a", "b"];
          return (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-5 py-4 text-center">
              {shown.map((s) => {
                const o = stage.outcome;
                const won = o === s;
                const title = o === "draw" ? "تعادل" : won ? "فزت!" : "خسرت";
                const plus = o === "draw" ? "+½" : won ? "+1" : "+0";
                return (
                  <div key={s} className={cx("grid w-full max-w-sm justify-items-center gap-1 rounded-[22px] border p-4", SIDE_TONE[s].ring, SIDE_TONE[s].soft, won && SIDE_TONE[s].glow)}>
                    <p className={cx("text-[15px] font-bold", SIDE_TONE[s].text)}>{names[s]}</p>
                    <p className="text-[34px] leading-tight font-black text-ivory">
                      {won ? "🏆 " : o === "draw" ? "🤝 " : ""}
                      {title}{" "}
                      <span dir="ltr" className="text-gold">
                        {plus}
                      </span>
                    </p>
                    <p className="text-[15px] text-mist">{resultText(match.game, results.current[s])}</p>
                  </div>
                );
              })}
              <Button onClick={finish} className="min-h-14 w-full max-w-sm touch-manipulation text-[17px]">
                متابعة
              </Button>
            </div>
          );
        }
        return null;
      }}
    </Arena>
  );
}

/** What a player did, in words. */
function resultText(game: MiniGameId, r: SideResult | undefined): string {
  if (r?.foul) return "ضغط قبل الأخضر";
  if (typeof r?.value !== "number") return game === "memory" ? "لم يُكمل التسلسل" : game === "precision" ? "لم يوقف المؤشر" : game === "taps" ? "0 نقرة" : "لم يضغط";
  switch (game) {
    case "reflex":
      return `ردة الفعل: ${Math.round(r.value)} ملّي ثانية`;
    case "taps":
      return `${r.value} نقرة`;
    case "precision":
      return r.value <= ZONE ? `في المنطقة الخضراء (${Math.round(r.value * 100)}٪ عن المركز)` : `بعيد عن المركز ${Math.round(r.value * 100)}٪`;
    case "memory":
      return `أعاد التسلسل في ${(r.value / 1000).toFixed(2)} ثانية`;
  }
}

function GameCard({ id }: { id: MiniGameId }) {
  const g = MINI_GAMES[id];
  return (
    <div className="grid w-full max-w-md gap-1 rounded-[22px] border border-violet/60 bg-violet/15 p-4 shadow-[0_0_30px_-10px_#663ade]">
      <p className="text-[24px] font-bold text-ivory">
        <span aria-hidden="true">{g.icon} </span>
        {g.title}
      </p>
      <p className="text-[15px] leading-7 text-ivory/90">{g.hint}</p>
    </div>
  );
}

/* ======================================================================
 * The four mini-games. Each one:
 *   - plays for the sides it is given (both on a split screen, one in a turn),
 *   - owns its timers and clears them when it unmounts,
 *   - reports once through onDone.
 * ==================================================================== */

type GameProps = { sides: Side[]; facing: boolean; names: Record<Side, string>; onDone: (r: Partial<Record<Side, SideResult>>) => void };

/** Calls onDone at most once. */
function useOnce(onDone: GameProps["onDone"]) {
  const done = useRef(false);
  const fn = useRef(onDone);
  fn.current = onDone;
  return useCallback((r: Partial<Record<Side, SideResult>>) => {
    if (done.current) return;
    done.current = true;
    fn.current(r);
  }, []);
}

/* ---- 1. Reflex: red for 2–5 s, then green. First tap after green wins; a tap on red loses. ---- */

function Reflex({ sides, facing, names, onDone }: GameProps) {
  const timers = useTimers();
  const report = useOnce(onDone);
  const [green, setGreen] = useState(false);
  const [marks, setMarks] = useState<Partial<Record<Side, SideResult>>>({});
  const greenAt = useRef(0);
  const res = useRef<Partial<Record<Side, SideResult>>>({});

  useEffect(() => {
    const wait = 2000 + Math.random() * 3000;
    timers.after(wait, () => {
      greenAt.current = performance.now();
      setGreen(true);
      sound.play("go");
      // Nobody pressed within 2.5 s of green.
      timers.after(2500, () => report(res.current));
    });
  }, [timers, report]);

  const locked = useRef(false);

  const press = (side: Side) => {
    if (locked.current || res.current[side]) return;
    // The round is decided by this tap (a foul, or the first tap after green): ignore any later tap.
    locked.current = true;
    if (!greenAt.current) {
      res.current = { ...res.current, [side]: { foul: true } };
      setMarks({ ...res.current });
      sound.play("foul");
      timers.clearAll();
      timers.after(700, () => report(res.current));
      return;
    }
    res.current = { ...res.current, [side]: { value: Math.round(performance.now() - greenAt.current) } };
    setMarks({ ...res.current });
    sound.play("tap");
    // Split screen: the first tap after green wins at once. A turn: this player is done.
    timers.clearAll();
    timers.after(500, () => report(res.current));
  };

  return (
    <Arena sides={sides} facing={facing}>
      {(side) => {
        const mine = marks[side];
        return (
          <button
            type="button"
            onPointerDown={() => press(side)}
            className={cx("flex flex-1 flex-col items-center justify-center gap-3 transition-colors duration-75", green ? "bg-[#16a34a]" : "bg-[#b91c1c]")}
          >
            <NameTag side={side} name={names[side]} />
            <span className="text-[44px] font-black text-white drop-shadow">{mine?.foul ? "مبكر! ❌" : mine ? `${Math.round(mine.value ?? 0)} ms` : green ? "اضغط!" : "انتظر…"}</span>
            <span className="text-[15px] text-white/80">{green ? "" : "لا تضغط قبل الأخضر"}</span>
          </button>
        );
      }}
    </Arena>
  );
}

/* ---- 2. Tap battle: 5 seconds, most taps wins. ---- */

const TAP_MS = 5000;

function Taps({ sides, facing, names, onDone }: GameProps) {
  const timers = useTimers();
  const report = useOnce(onDone);
  const counts = useRef<Record<Side, number>>({ a: 0, b: 0 });
  const [, force] = useState(0);
  const [left, setLeft] = useState(TAP_MS / 1000);
  const over = useRef(false);

  useEffect(() => {
    for (let s = 1; s <= TAP_MS / 1000; s++) timers.after(s * 1000, () => setLeft(TAP_MS / 1000 - s));
    timers.after(TAP_MS, () => {
      over.current = true;
      const out: Partial<Record<Side, SideResult>> = {};
      for (const s of sides) out[s] = { value: counts.current[s] };
      timers.after(400, () => report(out));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tap = (side: Side) => {
    if (over.current) return;
    counts.current[side] += 1;
    force((n) => n + 1);
    sound.play("tap");
  };

  return (
    <Arena sides={sides} facing={facing}>
      {(side) => {
        const t = SIDE_TONE[side];
        return (
          <div className="flex flex-1 flex-col items-center gap-2 px-4 pb-4">
            <NameTag side={side} name={names[side]} />
            <div className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-gold transition-[width] duration-1000 ease-linear" style={{ width: `${(left / (TAP_MS / 1000)) * 100}%` }} />
            </div>
            <p className="text-[15px] text-mist">{left > 0 ? `${left} ثوانٍ` : "انتهى الوقت"}</p>
            <button
              type="button"
              onPointerDown={() => tap(side)}
              className={cx("grid w-full max-w-sm flex-1 place-items-center rounded-[32px] border-4 text-white active:scale-[0.98]", t.ring, t.bg, t.glow)}
            >
              <span className="grid justify-items-center">
                <span className="text-[72px] leading-none font-black tabular-nums">{counts.current[side]}</span>
                <span className="text-[18px] font-bold">انقر! 👆</span>
              </span>
            </button>
          </div>
        );
      }}
    </Arena>
  );
}

/* ---- 3. Precision: a marker swings across a bar; stop it closest to the centre. ---- */

/** Half the width of the green zone, as a share of the bar. */
const ZONE = 0.05;
const SWING_MS = 1400;
const PRECISION_MS = 6000;

function Precision({ sides, facing, names, onDone }: GameProps) {
  const timers = useTimers();
  const report = useOnce(onDone);
  const markers = useRef<Partial<Record<Side, HTMLDivElement | null>>>({});
  const stopped = useRef<Partial<Record<Side, number>>>({});
  const [, force] = useState(0);
  const start = useRef(0);
  const phase = useRef(Math.random());
  const raf = useRef(0);

  /** Position 0..1 at a time: there and back once per SWING_MS. */
  const pos = (now: number) => {
    const x = ((now - start.current) / SWING_MS + phase.current) % 1;
    return x < 0.5 ? x * 2 : 2 - x * 2;
  };

  const finish = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const out: Partial<Record<Side, SideResult>> = {};
    for (const s of sides) if (typeof stopped.current[s] === "number") out[s] = { value: Math.round(Math.abs(stopped.current[s]! - 0.5) * 100) / 100 };
    timers.after(700, () => report(out));
  }, [sides, timers, report]);

  useEffect(() => {
    start.current = performance.now();
    const loop = (now: number) => {
      const p = pos(now);
      for (const s of sides) {
        const el = markers.current[s];
        if (el && stopped.current[s] === undefined) el.style.left = `${p * 100}%`;
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    timers.after(PRECISION_MS, finish);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = (side: Side) => {
    if (stopped.current[side] !== undefined) return;
    const p = pos(performance.now());
    stopped.current[side] = p;
    const el = markers.current[side];
    if (el) el.style.left = `${p * 100}%`;
    force((n) => n + 1);
    sound.play(Math.abs(p - 0.5) <= ZONE ? "go" : "tap");
    if (sides.every((s) => stopped.current[s] !== undefined)) {
      timers.clearAll();
      finish();
    }
  };

  return (
    <Arena sides={sides} facing={facing}>
      {(side) => {
        const t = SIDE_TONE[side];
        const at = stopped.current[side];
        const hit = at !== undefined && Math.abs(at - 0.5) <= ZONE;
        return (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 pb-4">
            <NameTag side={side} name={names[side]} />
            <div dir="ltr" className="relative h-16 w-full max-w-md rounded-full border-2 border-white/15 bg-night/80">
              <div className="absolute inset-y-0 rounded-sm bg-correct-fill/70 shadow-[0_0_20px_#10b981]" style={{ left: `${(0.5 - ZONE) * 100}%`, width: `${ZONE * 200}%` }} />
              <div className="absolute inset-y-[-6px] left-1/2 w-0.5 bg-white/70" />
              <div
                ref={(el) => {
                  markers.current[side] = el;
                }}
                className={cx("absolute inset-y-[-10px] w-2 -translate-x-1/2 rounded-full", at === undefined ? "bg-gold shadow-[0_0_14px_#ffa53a]" : hit ? "bg-white" : "bg-wrong")}
                style={{ left: "50%" }}
              />
            </div>
            <p className="h-7 text-[18px] font-bold text-ivory">{at === undefined ? "" : hit ? "🎯 في الأخضر!" : `بعيد ${Math.round(Math.abs(at - 0.5) * 100)}٪`}</p>
            <button
              type="button"
              onPointerDown={() => stop(side)}
              disabled={at !== undefined}
              className={cx("min-h-24 w-full max-w-sm rounded-[28px] border-4 text-[24px] font-black text-white disabled:opacity-50", t.ring, t.bg, t.glow)}
            >
              ✋ أوقف
            </button>
          </div>
        );
      }}
    </Arena>
  );
}

/* ---- 4. Flash memory: 4 colours for 1.5 s, then repeat them in order. ---- */

const COLORS = [
  { id: 0, name: "أحمر", cls: "bg-[#ef4444]", n: "1" },
  { id: 1, name: "أزرق", cls: "bg-[#3b82f6]", n: "2" },
  { id: 2, name: "أخضر", cls: "bg-[#22c55e]", n: "3" },
  { id: 3, name: "أصفر", cls: "bg-[#eab308]", n: "4" },
] as const;
const SHOW_MS = 1500;
const ANSWER_MS = 8000;

function Memory({ sides, facing, names, onDone }: GameProps) {
  const timers = useTimers();
  const report = useOnce(onDone);
  const seq = useMemo(() => Array.from({ length: 4 }, () => Math.floor(Math.random() * 4)), []);
  const [showing, setShowing] = useState(true);
  const entered = useRef<Record<Side, number[]>>({ a: [], b: [] });
  const state = useRef<Partial<Record<Side, "ok" | "wrong">>>({});
  const [, force] = useState(0);
  const openAt = useRef(0);

  useEffect(() => {
    timers.after(SHOW_MS, () => {
      setShowing(false);
      openAt.current = performance.now();
      sound.play("go");
      timers.after(ANSWER_MS, () => report({}));
    });
  }, [timers, report]);

  const press = (side: Side, color: number) => {
    if (showing || state.current[side]) return;
    const mine = entered.current[side];
    if (seq[mine.length] !== color) {
      state.current[side] = "wrong";
      sound.play("foul");
      force((n) => n + 1);
      // Everyone failed: a draw now rather than waiting out the clock.
      if (sides.every((s) => state.current[s] === "wrong")) {
        timers.clearAll();
        timers.after(700, () => report({}));
      }
      return;
    }
    mine.push(color);
    sound.play("tap");
    if (mine.length === seq.length) {
      state.current[side] = "ok";
      timers.clearAll();
      const value = Math.round(performance.now() - openAt.current);
      timers.after(500, () => report({ [side]: { value } }));
    }
    force((n) => n + 1);
  };

  return (
    <Arena sides={sides} facing={facing}>
      {(side) => {
        const st = state.current[side];
        const count = entered.current[side].length;
        return (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 pb-4">
            <NameTag side={side} name={names[side]} />
            {showing ? (
              <>
                <p className="text-[16px] text-mist">احفظ الترتيب</p>
                <div dir="rtl" className="flex gap-2">
                  {seq.map((c, i) => (
                    <span key={i} className={cx("grid size-16 place-items-center rounded-[16px] text-[22px] font-black text-white shadow-lg", COLORS[c].cls)}>
                      {COLORS[c].n}
                    </span>
                  ))}
                </div>
                <p className="text-[13px] text-faint">من اليمين إلى اليسار</p>
              </>
            ) : (
              <>
                <div className="flex gap-2" aria-label={`أدخلت ${count} من 4`}>
                  {seq.map((_, i) => (
                    <span key={i} className={cx("size-4 rounded-full", i < count ? "bg-gold" : "bg-white/15")} />
                  ))}
                </div>
                <p className="h-7 text-[18px] font-bold text-ivory">{st === "wrong" ? "❌ خطأ" : st === "ok" ? "✓ صحيح!" : "أعد التسلسل"}</p>
                <div className="grid w-full max-w-xs flex-1 grid-cols-2 gap-2 max-h-72">
                  {COLORS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-label={c.name}
                      disabled={!!st}
                      onPointerDown={() => press(side, c.id)}
                      className={cx("grid min-h-16 place-items-center rounded-[20px] text-[26px] font-black text-white active:brightness-125 disabled:opacity-40", c.cls)}
                    >
                      {c.n}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      }}
    </Arena>
  );
}

/* ======================================================================
 * Champion: confetti and the top three
 * ==================================================================== */

function Champion({ tour, onAgain, onSetup }: { tour: Tour; onAgain: () => void; onSetup: () => void }) {
  const top = ranking(tour.players);
  const [first, second, third] = top;
  const podium: Array<{ p: DuelPlayer | undefined; place: number; h: string; medal: string }> = [
    { p: second, place: 2, h: "h-24", medal: "🥈" },
    { p: first, place: 1, h: "h-36", medal: "🥇" },
    { p: third, place: 3, h: "h-16", medal: "🥉" },
  ];
  return (
    <>
      <Confetti />
      <section className="surface relative grid gap-5 overflow-hidden rounded-[28px] p-5 text-center sm:p-7">
        <span aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-gold/25 blur-3xl" />
        <p className="relative text-[16px] font-semibold text-violet-text">بطل منافسة العش</p>
        <h1 className="relative text-[36px] leading-tight">🏆 {first?.name}</h1>
        <p className="relative text-[15px] text-mist">وصل إلى {pointsText(first?.points ?? 0)} نقاط</p>
        <div dir="rtl" className="relative grid grid-cols-3 items-end gap-2">
          {podium.map(({ p, place, h, medal }) =>
            p ? (
              <div key={place} className="grid gap-1">
                <span className="text-[30px]">{medal}</span>
                <span className="truncate text-[16px] font-bold text-ivory">{p.name}</span>
                <span className="text-[14px] text-gold">{pointsText(p.points)} نقاط</span>
                <div className={cx("grid place-items-center rounded-t-[16px] text-[28px] font-black", h, place === 1 ? "btn-gold" : place === 2 ? "bg-[#94a3b8]/40 text-ivory" : "bg-[#b45309]/45 text-ivory")}>{place}</div>
              </div>
            ) : (
              <div key={place} />
            ),
          )}
        </div>
      </section>
      <Leaderboard players={tour.players} target={tour.target} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Button onClick={onAgain} className="min-h-14 touch-manipulation text-[17px]">
          بطولة جديدة بنفس اللاعبين
        </Button>
        <Button tone="quiet" onClick={onSetup} className="min-h-14 touch-manipulation">
          تعديل اللاعبين
        </Button>
      </div>
    </>
  );
}

/** Falling paper for 5 seconds, on a canvas over the page. Skipped when the system asks for less motion. */
function Confetti() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);
    const colors = ["#ffa53a", "#ffc04d", "#3b82f6", "#a855f7", "#f43f5e", "#22c55e"];
    const bits = Array.from({ length: 160 }, () => ({
      x: Math.random() * canvas.width,
      y: -Math.random() * canvas.height * 0.6,
      w: (6 + Math.random() * 6) * dpr,
      h: (10 + Math.random() * 8) * dpr,
      vy: (2 + Math.random() * 3) * dpr,
      vx: (Math.random() - 0.5) * 2 * dpr,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const b of bits) {
        b.x += b.vx;
        b.y += b.vy;
        b.r += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
      if (now - t0 < 5000) raf = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-40 h-full w-full" />;
}

/* ======================================================================
 * How to play
 * ==================================================================== */

function HowToSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-night/75 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="duel-howto"
        onClick={(e) => e.stopPropagation()}
        className="surface sheet-up max-h-[88vh] w-full touch-auto overflow-y-auto rounded-t-[28px] px-5 pt-3 pb-[max(24px,env(safe-area-inset-bottom))] shadow-lift sm:max-w-lg sm:rounded-[28px] sm:pt-6"
      >
        <div className="flex items-center gap-3">
          <h2 id="duel-howto" className="text-[24px] leading-9">
            كيف تلعب؟
          </h2>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="ms-auto grid size-12 place-items-center rounded-full border border-line-strong/70 bg-deep-2/60 text-ivory">
            <Glyph name="x" />
          </button>
        </div>
        <ol className="mt-3 grid gap-3 text-[15px] leading-7 text-mist">
          {HOW_TO_STEPS.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="btn-gold grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <h3 className="mt-5 text-[18px] text-ivory">الألعاب المصغّرة</h3>
        <ul className="mt-2 grid gap-2">
          {MINI_GAME_IDS.map((id) => (
            <li key={id} className="rounded-[16px] border border-line bg-deep-2/50 p-3">
              <p className="font-bold text-ivory">
                {MINI_GAMES[id].icon} {MINI_GAMES[id].title}
              </p>
              <p className="text-[14px] leading-6 text-mist">{MINI_GAMES[id].rule}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The rules as the page and the «كيف تلعب» sheet show them. */
export const HOW_TO_STEPS = [
  "اكتبوا أسماءكم، من لاعبين إلى 14، وتقدرون تعدّلون أي اسم أو تحذفونه قبل البداية.",
  "كل مواجهة لاعب ضد لاعب بالقرعة. في كل جولة يلعب الجميع مرة، وإذا كان العدد فرديًا يرتاح لاعب واحد، ولا يرتاح أحد جولتين متتاليتين.",
  "قبل كل مواجهة تظهر لكل لاعب اللعبة المصغّرة وتعليمتها، ويضغط كل واحد «جاهز»، ثم عدّ تنازلي 3، 2، 1.",
  "في كل مواجهة لعبة مصغّرة بالقرعة، من 3 إلى 10 ثوانٍ تقريبًا.",
  "الفوز = نقطة، التعادل = نصف نقطة لكل لاعب، الخسارة = صفر.",
  "أول من يصل إلى 10 نقاط (أو الهدف الذي تختارونه) يفوز بالبطولة.",
  "طريقة اللعب: شاشة مقسومة (الاثنان معًا، لكل واحد نصف) أو بالتناوب (كل لاعب دوره على الشاشة كاملة ثم يسلّم الجوال).",
];
