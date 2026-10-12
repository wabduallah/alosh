import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Egg, Glyph } from "@/components/brand";
import { Button, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { playCue } from "@/lib/sfx";
import { vibrate } from "@/lib/prefs";
import { TEAMS, Timer, useSecondsLeft } from "@/components/halba";
import { ResultShare, type ShareResult } from "@/components/result-share";
import { useLivePoll } from "@/lib/live";

/**
 * «تحديات العش»: two teams, up to six categories, a 200/400/600 board, aids and steals.
 * The rules run on the server (supabase/grid_v1.sql); these are the host, player and TV views.
 */

export type GridCell = { id: string; p: number; done: boolean; by: "red" | "blue" | null };
export type GridState = {
  game?: "grid";
  phase?: "board" | "question" | "steal" | "reveal" | "over";
  settings?: { categories?: string[]; seconds?: number };
  last_settings?: { categories?: string[]; seconds?: number } | null;
  cats?: string[];
  cells?: GridCell[][];
  scores?: { red?: number; blue?: number };
  aids?: { red?: string[]; blue?: string[] };
  turn?: "red" | "blue";
  cur?: {
    c: number;
    i: number;
    id: string;
    p: number;
    team: "red" | "blue";
    cat: string;
    q: string;
    media?: string | null;
    aids: string[];
    tries: number;
    ends_at: string;
    steal: boolean;
  } | null;
  reveal?: { answer: string; by: "red" | "blue" | null; gain: number; stolen: boolean } | null;
  winner?: "red" | "blue" | "tie" | null;
};
export type GridPlayer = { id: string; player_name: string; is_host: boolean; team_color: string | null; avatar?: { c?: number | null; e?: string | null } | null };

export const AIDS: Record<string, { name: string; hint: string; icon: string }> = {
  double: { name: "ضاعِف", hint: "نقاط السؤال ×2", icon: "✖️2" },
  two: { name: "جوابان", hint: "محاولتان بدل واحدة", icon: "✌️" },
  time: { name: "وقت إضافي", hint: "+30 ثانية", icon: "⏱️" },
};

const ERRORS: Record<string, string> = {
  NOT_HOST: "هذا للمضيف فقط.",
  NOT_PLAYING: "ابدأ اللعبة من صفحة الغرفة أولًا.",
  PICK_CATEGORIES: "اختر فئتين على الأقل، وحتى 6 فئات.",
  TEAMS: "يحتاج كل فريق لاعبًا واحدًا على الأقل.",
  NOT_ENOUGH: "هذه الفئة لا تكفي أسئلتها للوحة.",
  WRONG_PHASE: "هذه الخطوة غير متاحة الآن.",
  CELL_DONE: "هذه الخانة لُعبت.",
  AID_USED: "هذه الوسيلة استُخدمت.",
  QUESTION_GONE: "حُذف هذا السؤال من البنك.",
};

const other = (t: "red" | "blue") => (t === "red" ? "blue" : "red");
const isGrid = (s: GridState) => s.game === "grid";

/** Live state and players, from realtime with a polling fallback. */
export function useGridLive(roomId: string) {
  const [state, setState] = useState<GridState>({});
  const [players, setPlayers] = useState<GridPlayer[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: gs }, { data: ps }] = await Promise.all([
      supabase.from("room_game_state").select("state_data").eq("room_id", roomId).maybeSingle(),
      supabase.from("room_players").select("*").eq("room_id", roomId).order("joined_at"),
    ]);
    if (gs) setState((gs.state_data ?? {}) as GridState);
    if (ps) setPlayers(ps as GridPlayer[]);
  }, [roomId]);
  useLivePoll(`grid-${roomId}`, [{ table: "room_game_state", filter: `room_id=eq.${roomId}` }, { table: "room_players", filter: `room_id=eq.${roomId}` }], load);
  return { state, players, reload: load };
}

/** Sounds on the big screen and host device; vibration on the phones of the team that plays. */
function useGridCues(state: GridState, opts: { sound?: boolean; myTeam?: string | null }) {
  const last = useRef<string>("");
  useEffect(() => {
    const key = `${state.phase}:${state.cur?.id ?? ""}:${state.cur?.steal ? 1 : 0}`;
    if (key === last.current) return;
    const first = last.current === "";
    last.current = key;
    if (first) return;
    if (opts.sound) {
      if (state.phase === "question") playCue("round");
      else if (state.phase === "steal") playCue("steal");
      else if (state.phase === "reveal") playCue(state.reveal?.by ? "correct" : "wrong");
      else if (state.phase === "over") playCue("victory");
    }
    if (opts.myTeam && state.cur) {
      const answering = state.phase === "steal" ? other(state.cur.team) : state.cur.team;
      if ((state.phase === "question" || state.phase === "steal") && answering === opts.myTeam) vibrate([200, 80, 200]);
    }
  }, [state.phase, state.cur?.id, state.cur?.steal, state.reveal?.by, opts.sound, opts.myTeam]);
}

/* ---------------- Shared pieces ---------------- */

export function Scoreboard({ state, big = false }: { state: GridState; big?: boolean }) {
  const turn = state.phase === "board" ? state.turn : state.cur ? (state.phase === "steal" ? other(state.cur.team) : state.cur.team) : null;
  return (
    <div className="grid grid-cols-2 gap-3">
      {(["red", "blue"] as const).map((t) => {
        const on = turn === t && state.phase !== "over" && state.phase !== "reveal";
        return (
          <div
            key={t}
            className={cx("rounded-[20px] border-2 p-3 text-center transition", on ? "scale-[1.02]" : "opacity-85", big && "p-[0.8vw]")}
            style={{ borderColor: on ? TEAMS[t].color : "transparent", background: TEAMS[t].fill }}
          >
            <p className={cx("font-semibold", big ? "text-[clamp(16px,1.6vw,30px)]" : "text-[14px]")} style={{ color: TEAMS[t].color }}>
              {TEAMS[t].name}
              {on ? " · الدور" : ""}
            </p>
            <p dir="ltr" className={cx("font-display font-extrabold tabular-nums text-ivory", big ? "text-[clamp(28px,3.4vw,64px)] leading-none" : "text-[34px] leading-10")}>
              {state.scores?.[t] ?? 0}
            </p>
            <p className={cx("mt-1 text-mist", big ? "text-[clamp(12px,1.1vw,20px)]" : "text-[12px]")}>
              {(state.aids?.[t] ?? []).length ? (state.aids?.[t] ?? []).map((a) => AIDS[a]?.name).join(" · ") : "بلا وسائل"}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function Board({ state, onPick, big = false }: { state: GridState; onPick?: (c: number, i: number) => void; big?: boolean }) {
  const cats = state.cats ?? [];
  const cells = state.cells ?? [];
  return (
    <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${cats.length || 1}, minmax(0, 1fr))` }}>
      {cats.map((cat) => (
        <div
          key={cat}
          className={cx(
            "grid min-h-12 place-items-center rounded-[12px] bg-gold/15 px-1 text-center font-bold leading-tight text-gold",
            big ? "min-h-[5.6vh] text-[clamp(13px,1.4vw,28px)]" : "text-[12px] sm:text-[14px]",
          )}
        >
          {cat}
        </div>
      ))}
      {[0, 1, 2, 3, 4, 5].map((row) =>
        cats.map((cat, c) => {
          const cell = cells[c]?.[row];
          if (!cell) return <div key={`${cat}-${row}`} />;
          const live = state.cur && state.cur.c === c && state.cur.i === row && state.phase !== "board";
          const clickable = !!onPick && !cell.done && state.phase === "board";
          return (
            <button
              key={`${cat}-${row}`}
              type="button"
              disabled={!clickable}
              onClick={() => onPick?.(c, row)}
              className={cx(
                "grid place-items-center rounded-[12px] border font-display font-extrabold tabular-nums transition",
                big ? "min-h-[6.6vh] text-[clamp(16px,2.1vw,42px)]" : "min-h-11 text-[16px] sm:min-h-12 sm:text-[20px]",
                cell.done ? "border-transparent text-transparent" : "border-line-strong/70 bg-deep-2/80 text-gold",
                clickable && "hover:border-gold hover:bg-gold/10",
                live && "beat border-gold bg-gold/20",
              )}
              style={cell.done ? { background: cell.by ? TEAMS[cell.by].fill : "#ffffff08" } : undefined}
              aria-label={cell.done ? `${cat} ${cell.p} (لُعبت)` : `${cat} ${cell.p}`}
            >
              {cell.done ? (cell.by ? "●" : "—") : cell.p}
            </button>
          );
        }),
      )}
    </div>
  );
}

function QuestionCard({ state, big = false, answer }: { state: GridState; big?: boolean; answer?: string | null }) {
  const cur = state.cur;
  const left = useSecondsLeft(state.phase === "question" || state.phase === "steal" ? cur?.ends_at : null);
  if (!cur) return null;
  const answering = state.phase === "steal" ? other(cur.team) : cur.team;
  return (
    <div className={cx("rounded-[24px] border border-gold/40 bg-night/60 p-5 text-center shadow-glow-gold", big && "p-[2.4vw]")}>
      <p className={cx("font-semibold text-mist", big ? "text-[clamp(16px,1.6vw,30px)]" : "text-[14px]")}>
        {cur.cat} · <bdi dir="ltr">{cur.p}</bdi> نقطة
        {cur.aids.length ? ` · ${cur.aids.map((a) => AIDS[a]?.name).join("، ")}` : ""}
      </p>
      <p className={cx("mt-3 font-display font-extrabold text-ivory", big ? "text-[clamp(28px,3.6vw,72px)] leading-[1.35]" : "text-[24px] leading-[38px]")}>{cur.q}</p>
      {cur.media ? <img src={cur.media} alt="" className="mx-auto mt-4 max-h-[40vh] rounded-[16px]" /> : null}
      {state.phase === "question" || state.phase === "steal" ? (
        <div className="mt-4 grid justify-items-center gap-1">
          <p className={cx("font-bold", big ? "text-[clamp(18px,2vw,38px)]" : "text-[17px]")} style={{ color: TEAMS[answering].color }}>
            {state.phase === "steal" ? `فرصة سرقة: ${TEAMS[answering].name}` : `يجاوب ${TEAMS[answering].name}`}
            {state.phase === "question" && cur.tries > 1 ? " · محاولتان" : ""}
          </p>
          <Timer seconds={left} label="الوقت" sound={big} />
        </div>
      ) : null}
      {answer ? (
        <p className="mt-4 rounded-[14px] border border-correct/50 bg-correct-fill/15 px-4 py-2 text-[16px] font-bold text-ivory">الإجابة: {answer}</p>
      ) : null}
    </div>
  );
}

function RevealCard({ state, big = false }: { state: GridState; big?: boolean }) {
  const r = state.reveal;
  if (!r) return null;
  return (
    <div className={cx("rounded-[24px] border p-5 text-center", big && "p-[2vw]", r.by ? "border-correct/50 bg-correct-fill/15" : "border-wrong/50 bg-wrong-fill/15")}>
      <p className={cx("text-mist", big ? "text-[clamp(16px,1.6vw,30px)]" : "text-[14px]")}>الإجابة</p>
      <p className={cx("font-display font-extrabold text-ivory", big ? "text-[clamp(30px,3.8vw,76px)]" : "text-[28px] leading-10")}>{r.answer}</p>
      <p className={cx("mt-2 font-bold", big ? "text-[clamp(18px,2vw,38px)]" : "text-[17px]")} style={{ color: r.by ? TEAMS[r.by].color : undefined }}>
        {r.by ? `${r.stolen ? "سرقها" : "كسبها"} ${TEAMS[r.by].name} +${r.gain}` : "لا نقاط لأحد"}
      </p>
    </div>
  );
}

export function gridShare(state: GridState): ShareResult {
  const red = state.scores?.red ?? 0;
  const blue = state.scores?.blue ?? 0;
  const w = state.winner;
  return {
    slug: "tactical-grid",
    title: "🎲 تحديات العش",
    headline: w && w !== "tie" ? TEAMS[w].name : "تعادل",
    sub: w && w !== "tie" ? `🏆 الفائز بـ ${Math.max(red, blue)} نقطة` : `${red} لكل فريق`,
    rows: [
      { name: TEAMS.red.name, value: String(red), color: TEAMS.red.color },
      { name: TEAMS.blue.name, value: String(blue), color: TEAMS.blue.color },
    ].sort((a, b) => Number(b.value) - Number(a.value)),
  };
}

function OverCard({ state, big = false }: { state: GridState; big?: boolean }) {
  const w = state.winner;
  return (
    <div className={cx("grid justify-items-center gap-2 rounded-[28px] border border-gold/40 bg-night/60 p-6 text-center shadow-glow-gold", big && "p-[3vw]")}>
      <Glyph name="trophy" className={cx("text-gold", big ? "size-[6vw]" : "size-12")} />
      <p className={cx("font-display font-extrabold", big ? "text-[clamp(36px,5vw,96px)]" : "text-[34px] leading-[46px]")} style={{ color: w && w !== "tie" ? TEAMS[w].color : undefined }}>
        {w && w !== "tie" ? `فاز ${TEAMS[w].name}` : "تعادل!"}
      </p>
      <p dir="ltr" className={cx("font-display font-bold tabular-nums text-ivory", big ? "text-[clamp(22px,2.4vw,46px)]" : "text-[20px]")}>
        {state.scores?.red ?? 0} : {state.scores?.blue ?? 0}
      </p>
    </div>
  );
}

function TeamLists({ players, big = false }: { players: GridPlayer[]; big?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {(["red", "blue"] as const).map((t) => (
        <ul key={t} className="grid content-start gap-1.5 rounded-[18px] p-3" style={{ background: TEAMS[t].fill }}>
          <li className={cx("font-bold", big ? "text-[clamp(14px,1.4vw,26px)]" : "text-[13px]")} style={{ color: TEAMS[t].color }}>
            {TEAMS[t].name}
          </li>
          {players
            .filter((p) => !p.is_host && p.team_color === t)
            .map((p, i) => (
              <li key={p.id} className={cx("flex items-center gap-2 font-semibold text-ivory", big ? "text-[clamp(14px,1.4vw,26px)]" : "text-[14px]")}>
                <Egg name={p.player_name} index={i + 1} avatar={p.avatar} size="sm" />
                <span className="min-w-0 truncate">{p.player_name}</span>
              </li>
            ))}
        </ul>
      ))}
    </div>
  );
}

/* ---------------- Host ---------------- */

type Category = { name: string; easy: number; medium: number; hard: number; total: number };
const SECONDS = [30, 45, 60, 90];

export function GridHostPanel({ roomId }: { roomId: string }) {
  const { state, players, reload } = useGridLive(roomId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  useGridCues(state, { sound: true });

  async function run(fn: string, args: Record<string, unknown>) {
    if (!supabase) return false;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(fn, { p_room_id: roomId, ...args });
    setBusy(false);
    if (rpcError) {
      const missing = rpcError.code === "PGRST202" || rpcError.code === "42883";
      setError(missing ? "اللعبة الجديدة تحتاج تشغيل الملف supabase/grid_v1.sql في Supabase." : "تعذّر تنفيذ الخطوة، حاول مرة أخرى.");
      return false;
    }
    const res = data as { ok: boolean; reason?: string; category?: string };
    if (!res?.ok) {
      setError((ERRORS[res?.reason ?? ""] ?? "تعذّر تنفيذ الخطوة.") + (res?.category ? ` (${res.category})` : ""));
      return false;
    }
    await reload();
    return true;
  }

  // The host sees the answer while the team thinks.
  const curId = state.cur?.id ?? null;
  useEffect(() => {
    setAnswer(null);
    if (!supabase || !curId) return;
    supabase.rpc("room_correct_answer", { p_room_id: roomId }).then(({ data }) => setAnswer((data as string | null) ?? null));
  }, [curId, roomId]);

  if (!isGrid(state)) return <GridSetup roomId={roomId} state={state} players={players} busy={busy} error={error} onStart={(args) => run("grid_start", args)} />;

  return (
    <section className="mx-auto mt-2 grid max-w-4xl gap-4">
      <Scoreboard state={state} />
      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-[14px] font-semibold text-wrong">
          <Glyph name="alert" className="size-4" />
          {error}
        </p>
      ) : null}

      {state.phase === "board" ? <BoardControls state={state} busy={busy} onOpen={(c, i, aids) => run("grid_open", { p_cat: c, p_cell: i, p_aids: aids })} /> : null}

      {state.phase === "question" || state.phase === "steal" ? (
        <>
          <QuestionCard state={state} answer={answer} />
          <div className="grid grid-cols-2 gap-3">
            <Button tone="primary" className="min-h-14 text-[17px]" disabled={busy} onClick={() => run("grid_judge", { p_correct: true })}>
              <Glyph name="check" />
              إجابة صحيحة
            </Button>
            <Button tone="danger" className="min-h-14 text-[17px]" disabled={busy} onClick={() => run("grid_judge", { p_correct: false })}>
              خطأ / انتهى الوقت
            </Button>
          </div>
          <p className="text-center text-[13px] text-mist">
            {state.phase === "question" ? "إذا أخطأ الفريق، تنتقل فرصة السرقة للفريق الآخر بوقت أقصر." : "إذا أخطأ هذا الفريق أيضًا، لا يكسب أحد."}
          </p>
        </>
      ) : null}

      {state.phase === "reveal" ? (
        <>
          <RevealCard state={state} />
          <Button tone="primary" className="min-h-14 text-[17px]" disabled={busy} onClick={() => run("grid_next", {})}>
            التالي
            <Glyph name="forward" />
          </Button>
        </>
      ) : null}

      {state.phase === "over" ? (
        <>
          <OverCard state={state} />
          <ResultShare result={gridShare(state)} fileName="tahadiyat-alesh.png" />
        </>
      ) : null}

      {state.phase !== "over" ? (
        <>
          <details className="surface rounded-[20px] p-4">
            <summary className="cursor-pointer text-[15px] font-semibold text-ivory">الفرق</summary>
            <div className="mt-3">
              <TeamLists players={players} />
            </div>
          </details>
          <button
            type="button"
            className="w-fit text-[13px] text-mist underline-offset-4 hover:text-ivory hover:underline"
            disabled={busy}
            onClick={() => {
              if (window.confirm("إنهاء اللعبة الآن وإعلان الفائز بالنقاط الحالية؟")) void run("grid_finish", {});
            }}
          >
            إنهاء اللعبة الآن
          </button>
        </>
      ) : null}
    </section>
  );
}

function BoardControls({ state, busy, onOpen }: { state: GridState; busy: boolean; onOpen: (c: number, i: number, aids: string[]) => void }) {
  const turn = state.turn ?? "red";
  const left = state.aids?.[turn] ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => setPicked([]), [turn]);
  return (
    <div className="grid gap-3">
      <p className="text-center text-[17px] font-bold" style={{ color: TEAMS[turn].color }}>
        دور {TEAMS[turn].name}: اختاروا خانة
      </p>
      {left.length ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="text-[13px] text-mist">وسائل قبل الفتح:</span>
          {left.map((a) => {
            const on = picked.includes(a);
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                title={AIDS[a]?.hint}
                onClick={() => setPicked(on ? picked.filter((x) => x !== a) : [...picked, a])}
                className={cx("min-h-10 rounded-full border px-3 text-[14px] font-semibold", on ? "border-gold bg-gold/15 text-gold" : "border-line-strong/70 text-mist hover:text-ivory")}
              >
                {AIDS[a]?.name} <span className="text-[11px] opacity-75">({AIDS[a]?.hint})</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <Board state={state} onPick={busy ? undefined : (c, i) => onOpen(c, i, picked)} />
    </div>
  );
}

function GridSetup({
  roomId,
  state,
  players,
  busy,
  error,
  onStart,
}: {
  roomId: string;
  state: GridState;
  players: GridPlayer[];
  busy: boolean;
  error: string | null;
  onStart: (args: Record<string, unknown>) => Promise<boolean>;
}) {
  const [cats, setCats] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const last = state.last_settings ?? null;
  const [picked, setPicked] = useState<string[]>(last?.categories ?? []);
  const [seconds, setSeconds] = useState<number>(last?.seconds ?? 60);
  const guests = useMemo(() => players.filter((p) => !p.is_host), [players]);
  const [teams, setTeams] = useState<Record<string, "red" | "blue">>({});

  useEffect(() => {
    if (!supabase) return;
    supabase.rpc("grid_categories").then(({ data, error: e }) => {
      if (e) setLoadError(e.code === "PGRST202" || e.code === "42883" ? "اللعبة الجديدة تحتاج تشغيل الملف supabase/grid_v1.sql في Supabase." : "تعذّر تحميل الفئات.");
      else setCats((data ?? []) as Category[]);
    });
  }, [roomId]);

  // New players join the smaller team; the host can tap a name to move it.
  useEffect(() => {
    setTeams((cur) => {
      const next: Record<string, "red" | "blue"> = {};
      let red = 0;
      let blue = 0;
      for (const p of guests) {
        const t = cur[p.id];
        if (t) {
          next[p.id] = t;
          if (t === "red") red++;
          else blue++;
        }
      }
      for (const p of guests) {
        if (next[p.id]) continue;
        const t = red <= blue ? "red" : "blue";
        next[p.id] = t;
        if (t === "red") red++;
        else blue++;
      }
      return next;
    });
  }, [guests]);

  const counts = { red: guests.filter((p) => teams[p.id] === "red").length, blue: guests.filter((p) => teams[p.id] === "blue").length };
  const ready = picked.length >= 2 && counts.red > 0 && counts.blue > 0;

  return (
    <section className="mx-auto mt-2 grid max-w-3xl gap-4">
      <div className="surface grid gap-3 rounded-[24px] p-5">
        <h2 className="text-[20px] leading-8">
          اختر الفئات <span className="text-[14px] font-normal text-mist">({picked.length} من 6)</span>
        </h2>
        {loadError ? <p className="text-[14px] text-wrong">{loadError}</p> : null}
        {cats === null && !loadError ? <p className="text-[14px] text-mist">جارٍ تحميل الفئات…</p> : null}
        {cats && cats.length === 0 ? <p className="text-[14px] text-mist">لا توجد فئات فيها سؤالان من كل مستوى بعد. أضف أسئلة من لوحة الإدارة.</p> : null}
        <div className="flex flex-wrap gap-2">
          {(cats ?? []).map((c) => {
            const on = picked.includes(c.name);
            const n = picked.indexOf(c.name);
            return (
              <button
                key={c.name}
                type="button"
                aria-pressed={on}
                disabled={!on && picked.length >= 6}
                onClick={() => setPicked(on ? picked.filter((x) => x !== c.name) : [...picked, c.name])}
                className={cx(
                  "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold transition disabled:opacity-40",
                  on ? "border-gold bg-gold/15 text-gold" : "border-line-strong/70 text-mist hover:text-ivory",
                )}
              >
                {on ? <span className="grid size-5 place-items-center rounded-full bg-gold text-[11px] text-on-gold">{n + 1}</span> : null}
                {c.name}
                <span className="text-[11px] opacity-70">{c.total}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="surface grid gap-3 rounded-[24px] p-5">
        <h2 className="text-[18px] leading-7">وقت السؤال</h2>
        <div className="flex flex-wrap gap-2">
          {SECONDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={seconds === s}
              onClick={() => setSeconds(s)}
              className={cx("min-h-11 rounded-full border px-4 text-[15px] font-semibold", seconds === s ? "border-gold bg-gold/15 text-gold" : "border-line-strong/70 text-mist hover:text-ivory")}
            >
              {s} ثانية
            </button>
          ))}
        </div>
        <p className="text-[13px] text-mist">فرصة السرقة ثلث هذا الوقت (بين 10 و30 ثانية).</p>
      </div>

      <div className="surface grid gap-3 rounded-[24px] p-5">
        <h2 className="text-[18px] leading-7">الفرق</h2>
        <p className="text-[13px] text-mist">اضغط اسم اللاعب لنقله إلى الفريق الآخر.</p>
        <div className="grid grid-cols-2 gap-3">
          {(["red", "blue"] as const).map((t) => (
            <ul key={t} className="grid content-start gap-1.5 rounded-[18px] p-3" style={{ background: TEAMS[t].fill }}>
              <li className="text-[14px] font-bold" style={{ color: TEAMS[t].color }}>
                {TEAMS[t].name} ({counts[t]})
              </li>
              {guests
                .filter((p) => teams[p.id] === t)
                .map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setTeams({ ...teams, [p.id]: other(t) })}
                      className="flex min-h-10 w-full items-center gap-2 rounded-[12px] px-2 text-start text-[15px] font-semibold text-ivory hover:bg-white/5"
                    >
                      <span className="min-w-0 flex-1 truncate">{p.player_name}</span>
                      <Glyph name="refresh" className="size-4 text-mist" />
                    </button>
                  </li>
                ))}
            </ul>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-[14px] font-semibold text-wrong">
          <Glyph name="alert" className="size-4" />
          {error}
        </p>
      ) : null}
      <Button tone="primary" className="min-h-14 text-[18px]" disabled={!ready || busy} onClick={() => onStart({ p_categories: picked, p_seconds: seconds, p_teams: teams })}>
        {busy ? "نجهّز اللوحة…" : "ابدأ التحدي"}
      </Button>
      {!ready ? <p className="text-center text-[13px] text-mist">اختر فئتين على الأقل، وفي كل فريق لاعب واحد على الأقل.</p> : null}
    </section>
  );
}

/* ---------------- Player ---------------- */

export function GridPlayerPanel({ roomId, meId }: { roomId: string; meId: string | null }) {
  const { state, players } = useGridLive(roomId);
  const me = players.find((p) => p.id === meId) ?? null;
  const myTeam = (me?.team_color as "red" | "blue" | null) ?? null;
  useGridCues(state, { myTeam });

  if (!isGrid(state)) {
    return <Note>المضيف يختار الفئات ويقسّم الفرق. تابعوا الشاشة الكبيرة.</Note>;
  }
  const answering = state.cur ? (state.phase === "steal" ? other(state.cur.team) : state.cur.team) : null;
  return (
    <section className="grid gap-4">
      {myTeam ? (
        <p className="rounded-[16px] p-3 text-center text-[17px] font-bold" style={{ background: TEAMS[myTeam].fill, color: TEAMS[myTeam].color }}>
          أنت في {TEAMS[myTeam].name}
        </p>
      ) : null}
      <Scoreboard state={state} />
      {state.phase === "board" ? (
        <Note>{state.turn === myTeam ? "دور فريقك! اتفقوا على الخانة وقولوها للمضيف." : `دور ${TEAMS[state.turn ?? "red"].name} يختار خانة.`}</Note>
      ) : null}
      {state.phase === "question" || state.phase === "steal" ? (
        <>
          {answering === myTeam ? (
            <p className="beat rounded-[16px] border-2 p-3 text-center text-[18px] font-extrabold" style={{ borderColor: TEAMS[myTeam].color, color: TEAMS[myTeam].color }}>
              {state.phase === "steal" ? "فرصة سرقة لفريقك! جاوبوا بصوت عالٍ" : "فريقك يجاوب! قولوا الإجابة للمضيف"}
            </p>
          ) : null}
          <QuestionCard state={state} />
        </>
      ) : null}
      {state.phase === "reveal" ? <RevealCard state={state} /> : null}
      {state.phase === "over" ? (
        <>
          <OverCard state={state} />
          <ResultShare result={gridShare(state)} fileName="tahadiyat-alesh.png" />
        </>
      ) : null}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="surface rounded-[18px] p-4 text-center text-[15px] text-mist">{children}</p>;
}

/* ---------------- TV ---------------- */

export function GridTv({ roomId }: { roomId: string }) {
  const { state, players } = useGridLive(roomId);
  useGridCues(state, { sound: true });
  if (!isGrid(state)) {
    return (
      <div className="grid gap-[2vw]">
        <p className="text-center font-display text-[clamp(24px,3vw,56px)] font-extrabold text-ivory">المضيف يجهّز اللوحة…</p>
        <TeamLists players={players} big />
      </div>
    );
  }
  return (
    <div className="grid gap-[1vw]">
      <Scoreboard state={state} big />
      {state.phase === "board" ? (
        <>
          <p className="text-center font-display text-[clamp(18px,2vw,40px)] font-extrabold leading-tight" style={{ color: TEAMS[state.turn ?? "red"].color }}>
            دور {TEAMS[state.turn ?? "red"].name}
          </p>
          <Board state={state} big />
        </>
      ) : null}
      {state.phase === "question" || state.phase === "steal" ? <QuestionCard state={state} big /> : null}
      {state.phase === "reveal" ? (
        <>
          <p className="text-center font-display text-[clamp(22px,2.6vw,50px)] font-extrabold text-ivory">{state.cur?.q}</p>
          <RevealCard state={state} big />
        </>
      ) : null}
      {state.phase === "over" ? <OverCard state={state} big /> : null}
    </div>
  );
}
