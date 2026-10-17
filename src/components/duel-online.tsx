import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button, buttonBase, buttonTone, cx, inputClass } from "@/components/ui";
import { Glyph } from "@/components/brand";
import { QrCode } from "@/components/qr-code";
import { sound } from "@/lib/duel-sound";
import {
  cleanCode,
  createDuelRoom,
  currentChallenge,
  friendlyDuelError,
  joinDuelRoom,
  sendAnswer,
  settleMatch,
  useDuelRoom,
  useServerClock,
  validCode,
  voteRematch,
  type AnswerResult,
  type Challenge,
  type DuelMatch,
  type DuelPlayerRow,
  type DuelScore,
} from "@/lib/duel-online";

/*
 * «منافسة العش» online: each player on their own phone, full screen.
 *   /duel        → «أونلاين» card: create a room, or type a code to join.
 *   /duel/CODE   → waiting for the opponent → 5-second countdown → 60 seconds of challenges → result → rematch.
 * The screen follows the server: the clock is the server's, a challenge comes from the server
 * without its answer, and the result shows when the server closes the match.
 */

const NAME_KEY = "al3sh.duel.name";
const readName = () => {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveName = (n: string) => {
  try {
    window.localStorage.setItem(NAME_KEY, n);
  } catch {
    /* only a convenience */
  }
};
const cleanName = (raw: string) => raw.trim().replace(/\s+/g, " ");

const duelLink = (code: string) => (typeof window === "undefined" ? `/duel/${code}` : `${window.location.origin}/duel/${code}`);

/* ======================================================================
 * Entry on /duel: create or join
 * ==================================================================== */

export function OnlineEntry() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"" | "create" | "join">("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(readName()), []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const n = cleanName(name);
    if (n.length < 2 || n.length > 24) return setError("الاسم بين حرفين و24 حرفًا.");
    setBusy(true);
    setError(null);
    try {
      saveName(n);
      const roomCode = await createDuelRoom(n);
      void navigate({ to: "/duel/$code", params: { code: roomCode } });
    } catch (err) {
      setError(friendlyDuelError(err));
    } finally {
      setBusy(false);
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = cleanCode(code);
    if (!validCode(c)) return setError("الرمز 5 أحرف أو أرقام.");
    void navigate({ to: "/duel/$code", params: { code: c } });
  };

  return (
    <section aria-labelledby="duel-online" className="surface relative grid gap-4 overflow-hidden rounded-[24px] border border-violet/50 p-5 sm:p-6">
      <span aria-hidden="true" className="pointer-events-none absolute -top-16 -end-10 size-48 rounded-full bg-violet/25 blur-3xl" />
      <div className="relative">
        <h2 id="duel-online" className="text-[20px] leading-8">
          🌐 أونلاين: كل لاعب من جواله
        </h2>
        <p className="text-[14px] leading-6 text-mist">مواجهة 1 ضد 1 لمدة 60 ثانية. أول من يصل إلى 10 نقاط يفوز، أو الأعلى نقاطًا عند انتهاء الوقت.</p>
      </div>
      <div className="relative grid grid-cols-2 gap-2">
        <Button tone={mode === "create" ? "primary" : "quiet"} onClick={() => {
            setMode("create");
            setError(null);
          }} className="touch-manipulation">
          إنشاء غرفة
        </Button>
        <Button tone={mode === "join" ? "primary" : "quiet"} onClick={() => {
            setMode("join");
            setError(null);
          }} className="touch-manipulation">
          انضمام لغرفة
        </Button>
      </div>
      {mode === "create" ? (
        <form onSubmit={create} className="relative flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسمك" aria-label="اسمك" maxLength={24} className={cx(inputClass, "select-text")} />
          <Button type="submit" disabled={busy || !name.trim()} className="shrink-0 touch-manipulation px-5">
            {busy ? "لحظة…" : "أنشئ"}
          </Button>
        </form>
      ) : null}
      {mode === "join" ? (
        <form onSubmit={join} className="relative flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="رمز الغرفة"
            aria-label="رمز الغرفة"
            maxLength={5}
            dir="ltr"
            autoCapitalize="characters"
            className={cx(inputClass, "room-code text-center tracking-[0.3em] select-text")}
          />
          <Button type="submit" disabled={cleanCode(code).length !== 5} className="shrink-0 touch-manipulation px-5">
            ادخل
          </Button>
        </form>
      ) : null}
      {error ? <p className="relative text-[14px] text-wrong">{error}</p> : null}
    </section>
  );
}

/* ======================================================================
 * The room: /duel/CODE
 * ==================================================================== */

export function DuelRoomScreen({ code }: { code: string }) {
  const duel = useDuelRoom(code);
  const { serverNow, ready } = useServerClock();
  const { room, players, me, matches, scores, error, loading } = duel;
  const match = matches[0] ?? null;
  const opponent = players.find((p) => p.id !== me?.id) ?? null;

  if (loading && !room) return <Centered>لحظة…</Centered>;
  if (error && !room) {
    return (
      <Centered>
        <p className="text-[17px] text-ivory">{error}</p>
        <Link to="/duel" className={cx(buttonBase, buttonTone("quiet"))}>
          رجوع
        </Link>
      </Centered>
    );
  }
  if (!room) return null;
  if (!me) return <JoinForm roomId={room.id} code={room.room_code} players={players} onJoined={duel.reload} />;
  if (!match || !opponent) return <Waiting code={room.room_code} />;
  if (!ready) return <Centered>نضبط الساعة مع الخادم…</Centered>;
  return <MatchView key={match.id} duel={duel} match={match} me={me} opponent={opponent} scores={scores} serverNow={serverNow} />;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid min-h-[50vh] max-w-md place-content-center justify-items-center gap-4 text-center text-mist">{children}</div>;
}

function JoinForm({ roomId, code, players, onJoined }: { roomId: string; code: string; players: DuelPlayerRow[]; onJoined: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(readName()), []);
  const host = players[0];

  if (players.length >= 2) {
    return (
      <Centered>
        <p className="text-[18px] font-bold text-ivory">الغرفة {code} فيها لاعبان.</p>
        <p>المواجهة 1 ضد 1 فقط. أنشئ غرفة جديدة وادعُ خصمك.</p>
        <Link to="/duel" className={cx(buttonBase, buttonTone("primary"))}>
          منافسة العش
        </Link>
      </Centered>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = cleanName(name);
    if (n.length < 2 || n.length > 24) return setError("الاسم بين حرفين و24 حرفًا.");
    setBusy(true);
    setError(null);
    try {
      saveName(n);
      await joinDuelRoom(roomId, code, n);
      onJoined();
    } catch (err) {
      setError(friendlyDuelError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="surface mx-auto grid max-w-md gap-4 rounded-[28px] p-6 text-center">
      <p className="text-[14px] text-mist">منافسة العش · أونلاين</p>
      <p className="room-code text-[34px] leading-[44px] text-gold">{code}</p>
      {host ? (
        <p className="text-[17px] text-ivory">
          <span className="font-bold">{host.player_name}</span> يتحداك! 60 ثانية، والأسرع يفوز.
        </p>
      ) : null}
      <form onSubmit={submit} className="grid gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسمك" aria-label="اسمك" maxLength={24} className={cx(inputClass, "select-text")} />
        <Button type="submit" disabled={busy || !name.trim()} className="min-h-14 touch-manipulation text-[17px]">
          {busy ? "لحظة…" : "⚡ اقبل التحدي"}
        </Button>
      </form>
      {error ? <p className="text-[14px] text-wrong">{error}</p> : null}
    </section>
  );
}

function Waiting({ code }: { code: string }) {
  const link = duelLink(code);
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: "منافسة العش", text: `تحدّني في منافسة العش! الرمز ${code}`, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      }
    } catch {
      /* the person closed the share sheet */
    }
  };
  return (
    <section className="surface relative mx-auto grid max-w-md justify-items-center gap-3 overflow-hidden rounded-[28px] p-6 text-center">
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-24 mx-auto size-64 rounded-full bg-violet/25 blur-3xl" />
      <p className="relative text-[15px] font-semibold text-mist">رمز الغرفة</p>
      <p className="room-code relative rounded-[18px] border border-gold/40 bg-night/60 px-5 py-2 text-[44px] leading-[56px] text-gold shadow-glow-gold">{code}</p>
      <QrCode text={link} className="relative size-44" />
      <Button onClick={share} className="relative min-h-14 w-full touch-manipulation text-[17px]">
        <Glyph name="copy" className="size-5" />
        {copied ? "نُسخ الرابط" : "أرسل الرابط لخصمك"}
      </Button>
      <p className="relative flex items-center gap-2 rounded-[14px] border border-line bg-glass px-4 py-3 text-[15px] text-mist">
        <span className="inline-block size-2.5 animate-pulse rounded-full bg-gold" />
        بانتظار خصمك… تبدأ المواجهة لحظة دخوله.
      </p>
    </section>
  );
}

/* ======================================================================
 * One match: countdown → play → result
 * ==================================================================== */

type Duel = ReturnType<typeof useDuelRoom>;

function useNow(serverNow: () => number, fps = 10) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = window.setInterval(() => setNow(serverNow()), 1000 / fps);
    return () => window.clearInterval(t);
  }, [serverNow, fps]);
  return now;
}

function MatchView({ duel, match, me, opponent, scores, serverNow }: { duel: Duel; match: DuelMatch; me: DuelPlayerRow; opponent: DuelPlayerRow; scores: DuelScore[]; serverNow: () => number }) {
  const now = useNow(serverNow);
  const start = Date.parse(match.starts_at);
  const end = Date.parse(match.ends_at);
  const phase = match.status === "over" ? "over" : now < start ? "countdown" : now < end ? "playing" : "settling";
  const myScore = scores.find((s) => s.player_id === me.id);
  const oppScore = scores.find((s) => s.player_id === opponent.id);
  // My points from my own answers arrive before the table change does.
  const [localPoints, setLocalPoints] = useState(0);

  // Time is up and the server has not closed it yet: ask it to (both phones may ask; the second is harmless).
  const reload = duel.reload;
  useEffect(() => {
    if (phase !== "settling") return;
    let alive = true;
    const ask = () => {
      void settleMatch(match.id).then(() => alive && reload());
    };
    const first = window.setTimeout(ask, 100 + Math.random() * 300);
    const repeat = window.setInterval(ask, 1500);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(repeat);
    };
  }, [phase, match.id, reload]);

  // Beeps for 3-2-1 and «ابدأ!».
  const lastBeep = useRef<number | null>(null);
  const left = Math.ceil((start - now) / 1000);
  useEffect(() => {
    if (phase !== "countdown" || left > 3 || left < 1 || lastBeep.current === left) return;
    lastBeep.current = left;
    sound.play("beep");
  }, [phase, left]);
  useEffect(() => {
    if (phase === "playing" && lastBeep.current !== 0) {
      lastBeep.current = 0;
      sound.play("go");
    }
  }, [phase]);

  if (phase === "over") return <Result duel={duel} match={match} me={me} opponent={opponent} myScore={myScore} oppScore={oppScore} />;

  return (
    <FullScreen>
      <TopBar
        match={match}
        now={now}
        me={me}
        opponent={opponent}
        myPoints={Math.max(myScore?.points ?? 0, localPoints)}
        oppPoints={Math.max(oppScore?.points ?? 0, duel.opponentLive?.points ?? 0)}
        oppOnline={!duel.subscribed || duel.online.includes(opponent.id)}
      />
      {phase === "countdown" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-[18px] text-mist">
            ضد <span className="font-bold text-ivory">{opponent.player_name}</span>
          </p>
          <p key={left} className="animate-[beat_0.8s_ease-out] text-[120px] leading-none font-black text-gold">
            {left > 3 ? "استعد" : left}
          </p>
          <p className="max-w-xs text-[15px] leading-7 text-mist">تحديات سريعة: ذاكرة، لون الكلمة، حساب، الحرف المختلف. كل إجابة صحيحة نقطة.</p>
        </div>
      ) : phase === "playing" ? (
        <Play duel={duel} match={match} onPoints={setLocalPoints} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-[40px] font-black text-ivory">⏱️ انتهى الوقت</p>
          <p className="text-mist">نحسب النتيجة…</p>
        </div>
      )}
    </FullScreen>
  );
}

function FullScreen({ children }: { children: ReactNode }) {
  useEffect(() => {
    const html = document.documentElement;
    const before = [document.body.style.overflow, html.style.overscrollBehaviorY];
    document.body.style.overflow = "hidden";
    html.style.overscrollBehaviorY = "none";
    return () => {
      document.body.style.overflow = before[0];
      html.style.overscrollBehaviorY = before[1];
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-[60] flex touch-none flex-col bg-night pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

/** The timer, my bar and the opponent's bar. */
function TopBar({ match, now, me, opponent, myPoints, oppPoints, oppOnline }: { match: DuelMatch; now: number; me: DuelPlayerRow; opponent: DuelPlayerRow; myPoints: number; oppPoints: number; oppOnline: boolean }) {
  const start = Date.parse(match.starts_at);
  const end = Date.parse(match.ends_at);
  const total = end - start;
  const left = Math.max(0, Math.min(total, end - Math.max(now, start)));
  const secs = Math.ceil(left / 1000);
  const bar = (who: string, pts: number, tone: "me" | "opp", note?: string) => (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[14px]">
        <span className={cx("min-w-0 truncate font-bold", tone === "me" ? "text-[#bfdbfe]" : "text-[#fecdd3]")}>
          {who}
          {note ? <span className="ms-2 text-[12px] font-normal text-wrong">{note}</span> : null}
        </span>
        <span dir="ltr" className="font-bold text-ivory tabular-nums">
          {pts} / {match.target}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-white/10">
        <div
          className={cx("h-full rounded-full transition-[width] duration-300", tone === "me" ? "bg-[#3b82f6] shadow-[0_0_12px_#3b82f6]" : "bg-[#f43f5e] shadow-[0_0_12px_#f43f5e]")}
          style={{ width: `${Math.min(100, (pts / match.target) * 100)}%` }}
        />
      </div>
    </div>
  );
  return (
    <div className="grid gap-2 border-b border-line bg-deep/80 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-mist">الجولة {match.round_no}</span>
        <span className={cx("text-[26px] font-black tabular-nums", secs <= 10 && now >= start ? "text-wrong" : "text-gold")}>
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
        </span>
      </div>
      {bar(`${me.player_name} (أنت)`, myPoints, "me")}
      {bar(opponent.player_name, oppPoints, "opp", oppOnline ? undefined : "غير متصل")}
    </div>
  );
}

/* ======================================================================
 * Playing: one challenge at a time, from the server
 * ==================================================================== */

const COLORS = [
  { n: 1, name: "أحمر", cls: "bg-[#ef4444]", ink: "text-[#f87171]" },
  { n: 2, name: "أزرق", cls: "bg-[#3b82f6]", ink: "text-[#60a5fa]" },
  { n: 3, name: "أخضر", cls: "bg-[#22c55e]", ink: "text-[#4ade80]" },
  { n: 4, name: "أصفر", cls: "bg-[#eab308]", ink: "text-[#facc15]" },
] as const;

function Play({ duel, match, onPoints }: { duel: Duel; match: DuelMatch; onPoints: (n: number) => void }) {
  const [cur, setCur] = useState<{ idx: number; ch: Challenge | null; points: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<"right" | "wrong" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const alive = useRef(true);
  const sendProgress = duel.sendProgress;

  // The current challenge from the server; asked again until it comes (a slow network, or a clock a bit ahead).
  const hasChallenge = !!cur?.ch;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (hasChallenge) return;
    let stop = false;
    const fetchIt = () =>
      currentChallenge(match.id)
        .then((r) => {
          if (stop || !alive.current) return;
          if (r.ok && r.next) {
            setCur({ idx: r.idx ?? 0, ch: r.next, points: r.points ?? 0 });
            setProblem(null);
          }
        })
        .catch(() => !stop && alive.current && setProblem("انقطع الاتصال. نحاول مرة أخرى…"));
    void fetchIt();
    const t = window.setInterval(fetchIt, 1500);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [match.id, hasChallenge]);

  const submit = useCallback(
    async (answer: string) => {
      if (!cur || busy) return;
      setBusy(true);
      try {
        let r: AnswerResult = await sendAnswer(match.id, cur.idx, answer);
        // Faster than the server allows (a quick hand on a slow network): wait the rest, then once more.
        for (let i = 0; i < 3 && r.reason === "TOO_FAST"; i++) {
          await new Promise((ok) => window.setTimeout(ok, Math.min(2000, (r.wait_ms ?? 200) + 60)));
          r = await sendAnswer(match.id, cur.idx, answer);
        }
        if (!alive.current) return;
        if (r.ok) {
          setFlash(r.correct ? "right" : "wrong");
          sound.play(r.correct ? "tap" : "foul");
          window.setTimeout(() => alive.current && setFlash(null), 260);
          setCur({ idx: r.idx ?? cur.idx + 1, ch: r.next ?? null, points: r.points ?? cur.points });
          sendProgress({ points: r.points ?? 0, idx: r.idx ?? 0 });
          onPoints(r.points ?? 0);
          if (r.over) duel.reload();
        } else if (r.reason === "STALE") {
          setCur({ idx: r.idx ?? cur.idx, ch: r.next ?? null, points: r.points ?? cur.points });
        } else if (r.reason === "OVER" || r.reason === "TIME_UP") {
          duel.reload();
        }
        setProblem(null);
      } catch {
        if (alive.current) setProblem("لم تصل الإجابة. حاول مرة أخرى.");
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [cur, busy, match.id, sendProgress, duel, onPoints],
  );

  return (
    <div className={cx("relative flex flex-1 flex-col items-center justify-center gap-4 overflow-hidden px-4 py-4 transition-colors", flash === "right" && "bg-correct-fill/15", flash === "wrong" && "bg-wrong-fill/15")}>
      {problem ? <p className="absolute top-2 rounded-full bg-wrong-fill/20 px-3 py-1 text-[13px] text-ivory">{problem}</p> : null}
      {!cur?.ch ? (
        <p className="text-mist">لحظة…</p>
      ) : (
        <ChallengeView key={cur.idx} ch={cur.ch} disabled={busy} onAnswer={submit} />
      )}
    </div>
  );
}

function ChallengeView({ ch, disabled, onAnswer }: { ch: Challenge; disabled: boolean; onAnswer: (a: string) => void }) {
  switch (ch.kind) {
    case "memory":
      return <MemoryChallenge ch={ch} disabled={disabled} onAnswer={onAnswer} />;
    case "ink":
      return (
        <div className="grid w-full max-w-sm justify-items-center gap-5">
          <p className="text-[15px] text-mist">اضغط لون الحبر، لا الكلمة</p>
          <p className={cx("text-[64px] leading-none font-black", COLORS[ch.ink - 1].ink)}>{COLORS[ch.word - 1].name}</p>
          <div className="grid w-full grid-cols-2 gap-3">
            {COLORS.map((c) => (
              <button
                key={c.n}
                type="button"
                disabled={disabled}
                onPointerDown={() => onAnswer(String(c.n))}
                className={cx("min-h-20 rounded-[20px] text-[20px] font-bold text-white shadow-lg active:brightness-125 disabled:opacity-60", c.cls)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      );
    case "math":
      return (
        <div className="grid w-full max-w-sm justify-items-center gap-5">
          <p className="text-[15px] text-mist">احسب بسرعة</p>
          <p dir="ltr" className="text-[64px] leading-none font-black text-ivory tabular-nums">
            {ch.a} {ch.op} {ch.b}
          </p>
          <div className="grid w-full grid-cols-2 gap-3">
            {ch.options.map((o) => (
              <button
                key={o}
                type="button"
                disabled={disabled}
                onPointerDown={() => onAnswer(String(o))}
                className="min-h-20 rounded-[20px] border-2 border-violet bg-violet/25 text-[30px] font-black text-ivory tabular-nums shadow-[0_0_20px_-6px_#663ade] active:brightness-125 disabled:opacity-60"
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      );
    case "odd":
      return (
        <div className="grid w-full max-w-sm justify-items-center gap-5">
          <p className="text-[15px] text-mist">اضغط الحرف المختلف</p>
          <div className="grid w-full grid-cols-4 gap-2">
            {ch.cells.map((letter, i) => (
              <button
                key={i}
                type="button"
                disabled={disabled}
                onPointerDown={() => onAnswer(String(i))}
                className="grid aspect-square place-items-center rounded-[16px] border border-line-strong/70 bg-deep-2/80 text-[40px] font-bold text-ivory active:bg-violet/40 disabled:opacity-60"
              >
                {letter}
              </button>
            ))}
          </div>
        </div>
      );
  }
}

function MemoryChallenge({ ch, disabled, onAnswer }: { ch: Extract<Challenge, { kind: "memory" }>; disabled: boolean; onAnswer: (a: string) => void }) {
  const [showing, setShowing] = useState(true);
  const [entered, setEntered] = useState("");
  const seq = useMemo(() => ch.show.split(""), [ch.show]);
  useEffect(() => {
    const t = window.setTimeout(() => setShowing(false), ch.show_ms || 1500);
    return () => window.clearTimeout(t);
  }, [ch.show_ms]);
  const press = (n: number) => {
    if (showing || disabled || entered.length >= seq.length) return;
    const next = entered + n;
    setEntered(next);
    sound.play("tap");
    if (next.length === seq.length) onAnswer(next);
  };
  return (
    <div className="grid w-full max-w-sm justify-items-center gap-5">
      <p className="text-[15px] text-mist">{showing ? "احفظ الترتيب (من اليمين)" : "أعد الترتيب"}</p>
      {showing ? (
        <div className="flex gap-2">
          {seq.map((d, i) => (
            <span key={i} className={cx("grid size-16 place-items-center rounded-[16px] text-[24px] font-black text-white shadow-lg", COLORS[Number(d) - 1].cls)}>
              {d}
            </span>
          ))}
        </div>
      ) : (
        <>
          <div className="flex gap-2" aria-label={`أدخلت ${entered.length} من 4`}>
            {seq.map((_, i) => (
              <span key={i} className={cx("size-4 rounded-full", i < entered.length ? "bg-gold" : "bg-white/15")} />
            ))}
          </div>
          <div className="grid w-full grid-cols-2 gap-3">
            {COLORS.map((c) => (
              <button
                key={c.n}
                type="button"
                aria-label={c.name}
                disabled={disabled}
                onPointerDown={() => press(c.n)}
                className={cx("min-h-20 rounded-[20px] text-[26px] font-black text-white active:brightness-125 disabled:opacity-60", c.cls)}
              >
                {c.n}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ======================================================================
 * Result and rematch
 * ==================================================================== */

function Result({ duel, match, me, opponent, myScore, oppScore }: { duel: Duel; match: DuelMatch; me: DuelPlayerRow; opponent: DuelPlayerRow; myScore?: DuelScore; oppScore?: DuelScore }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const won = match.winner_id === me.id;
  const draw = !match.winner_id;
  const played = useRef(false);
  useEffect(() => {
    if (played.current) return;
    played.current = true;
    sound.play(draw ? "draw" : won ? "champion" : "lose");
  }, [won, draw]);

  const tally = useMemo(() => {
    const t = { me: 0, opp: 0 };
    for (const m of duel.matches) {
      if (m.status !== "over") continue;
      if (m.winner_id === me.id) t.me++;
      else if (m.winner_id === opponent.id) t.opp++;
    }
    return t;
  }, [duel.matches, me.id, opponent.id]);

  const start = Date.parse(match.starts_at);
  const myPoints = myScore?.points ?? 0;
  const tries = myScore?.tries ?? 0;
  const accuracy = tries ? Math.round((myPoints / tries) * 100) : 0;
  const avg = tries && myScore?.last_at ? (Date.parse(myScore.last_at) - start) / tries / 1000 : 0;
  const iVoted = match.rematch_votes.includes(me.id);
  const theyVoted = match.rematch_votes.includes(opponent.id);

  const rematch = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await voteRematch(match.room_id);
      if (!r.ok) setError(r.reason === "NO_OPPONENT" ? "خصمك خرج من الغرفة." : "تعذّرت إعادة التحدي.");
      duel.reload();
    } catch {
      setError("تعذّر الاتصال، حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="surface relative mx-auto grid max-w-md gap-4 overflow-hidden rounded-[28px] p-6 text-center">
      <span aria-hidden="true" className={cx("pointer-events-none absolute inset-x-0 -top-24 mx-auto size-72 rounded-full blur-3xl", won ? "bg-gold/30" : draw ? "bg-violet/25" : "bg-wrong-fill/20")} />
      <p className="relative text-[14px] text-mist">
        الجولة {match.round_no} · {match.end_reason === "target" ? `وصل للهدف (${match.target}) أولًا` : "انتهى الوقت"}
      </p>
      <h1 className="relative text-[40px] leading-tight">{won ? "🏆 فزت!" : draw ? "🤝 تعادل" : "خسرت"}</h1>
      <p className="relative text-[16px] text-ivory">
        {won ? `تغلّبت على ${opponent.player_name}` : draw ? "نفس النقاط بالضبط" : `${opponent.player_name} كان أسرع هذه المرة`}
      </p>
      <div className="relative grid grid-cols-2 gap-2">
        <div className="rounded-[18px] border border-[#60a5fa]/60 bg-[#3b82f6]/15 p-3">
          <p className="truncate text-[14px] font-bold text-[#bfdbfe]">{me.player_name}</p>
          <p className="text-[36px] font-black text-ivory tabular-nums">{myPoints}</p>
        </div>
        <div className="rounded-[18px] border border-[#fb7185]/60 bg-[#f43f5e]/15 p-3">
          <p className="truncate text-[14px] font-bold text-[#fecdd3]">{opponent.player_name}</p>
          <p className="text-[36px] font-black text-ivory tabular-nums">{oppScore?.points ?? 0}</p>
        </div>
      </div>
      <dl className="relative grid grid-cols-3 gap-2 text-[13px]">
        <div className="rounded-[14px] bg-deep-2/60 p-2">
          <dt className="text-mist">محاولات</dt>
          <dd className="text-[18px] font-bold text-ivory">{tries}</dd>
        </div>
        <div className="rounded-[14px] bg-deep-2/60 p-2">
          <dt className="text-mist">الدقة</dt>
          <dd className="text-[18px] font-bold text-ivory">{accuracy}%</dd>
        </div>
        <div className="rounded-[14px] bg-deep-2/60 p-2">
          <dt className="text-mist">لكل تحدٍ</dt>
          <dd className="text-[18px] font-bold text-ivory">{avg ? `${avg.toFixed(1)} ث` : "—"}</dd>
        </div>
      </dl>
      {duel.matches.length > 1 ? (
        <p className="relative text-[15px] text-mist">
          نتيجة الغرفة: أنت <span className="font-bold text-gold">{tally.me}</span> · {opponent.player_name} <span className="font-bold text-gold">{tally.opp}</span>
        </p>
      ) : null}
      {theyVoted && !iVoted ? <p className="relative rounded-[14px] border border-gold/50 bg-gold/10 p-2 text-[15px] font-semibold text-ivory">{opponent.player_name} يريد إعادة التحدي!</p> : null}
      <Button onClick={rematch} disabled={busy || iVoted} className="relative min-h-16 w-full touch-manipulation text-[18px]">
        {iVoted ? "بانتظار خصمك يوافق…" : "⚡ إعادة التحدي"}
      </Button>
      {error ? <p className="relative text-[14px] text-wrong">{error}</p> : null}
      <Link to="/duel" className={cx(buttonBase, buttonTone("quiet"), "relative")}>
        خروج
      </Link>
    </section>
  );
}
