import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Egg, Glyph } from "@/components/brand";
import { Button, cx, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { playCue } from "@/lib/sfx";
import { vibrate } from "@/lib/prefs";
import { Timer, useSecondsLeft } from "@/components/halba";
import { ResultShare, type ShareResult } from "@/components/result-share";
import { useLivePoll } from "@/lib/live";
import { useSiteSettings } from "@/lib/site-settings";

/**
 * «تحديات العش»: 2 to 6 teams, each picks its categories, on a 200/400/600 board with aids and steals.
 * Nobody sees the answer before it is settled, the host included: the team votes from its phones on
 * 6 options (or true/false), and the server settles it (supabase/grid_v2.sql).
 */

export type GridCell = { id: string; p: number; done: boolean; by: string | null };
export type GridTeam = { key: string; name: string; c: number };
export type GridVote = { o: number; at: string };
export type GridState = {
  game?: "grid";
  v?: number;
  phase?: "board" | "question" | "steal" | "reveal" | "over";
  settings?: GridSettings;
  last_settings?: GridSettings | null;
  teams?: GridTeam[];
  order?: string[];
  members?: Record<string, string>;
  cats?: string[];
  cat_team?: string[];
  cells?: GridCell[][];
  scores?: Record<string, number>;
  aids?: Record<string, string[]>;
  /** One steal per team for the whole game: true while it is still unused. */
  steals?: Record<string, boolean>;
  turn?: string;
  cur?: {
    c: number;
    i: number;
    id: string;
    p: number;
    team: string;
    answering: string;
    tried: string[];
    cat: string;
    q: string;
    media?: string | null;
    kind: "mc" | "tf";
    options: string[];
    out: number[];
    votes: Record<string, GridVote>;
    picks?: Array<{ team: string; o: number | null; ok: boolean }>;
    aids: string[];
    tries: number;
    ends_at: string;
    steal: boolean;
  } | null;
  reveal?: { answer: string; correct: number | null; by: string | null; gain: number; stolen: boolean } | null;
  winner?: string | null;
};
type GridSettings = { seconds?: number; per_team?: number; host_plays?: boolean; team_names?: string[]; categories?: string[] };
export type GridPlayer = { id: string; player_name: string; is_host: boolean; avatar?: { c?: number | null; e?: string | null } | null };

/** Six team colors, in order. */
export const GRID_COLORS = [
  { color: "#ff5a7a", fill: "#83184340" },
  { color: "#6bb8ff", fill: "#1e3a8a40" },
  { color: "#4ade80", fill: "#14532d4d" },
  { color: "#fbbf24", fill: "#78350f4d" },
  { color: "#c084fc", fill: "#581c874d" },
  { color: "#2dd4bf", fill: "#134e4a4d" },
];
export const DEFAULT_TEAM_NAMES = ["عش النسور", "عش الصقور", "عش الشاهين", "عش العقاب", "عش الحبارى", "عش الهدهد"];
const LETTERS = ["أ", "ب", "ج", "د", "هـ", "و"];

export const AIDS: Record<string, { name: string; hint: string }> = {
  double: { name: "ضاعِف", hint: "نقاط السؤال ×2" },
  two: { name: "جوابان", hint: "محاولتان بدل واحدة" },
  time: { name: "وقت إضافي", hint: "+30 ثانية" },
};

const ERRORS: Record<string, string> = {
  NOT_HOST: "هذا للمضيف فقط.",
  NOT_PLAYING: "ابدأ اللعبة من صفحة الغرفة أولًا.",
  TEAMS_COUNT: "من 2 إلى 6 فرق.",
  PICK_CATEGORIES: "كل فريق يختار العدد نفسه من الفئات، ولا تتكرر فئة.",
  TEAMS: "يحتاج كل فريق لاعبًا واحدًا على الأقل.",
  TWO_TEAMS: "لاعب في فريقين.",
  NOT_ENOUGH: "هذه الفئة لا تكفي أسئلتها للوحة.",
  WRONG_PHASE: "هذه الخطوة غير متاحة الآن.",
  CELL_DONE: "هذه الخانة لُعبت.",
  AID_USED: "هذه الوسيلة استُخدمت.",
  QUESTION_GONE: "حُذف هذا السؤال من البنك.",
  NOT_YOUR_TURN: "ليس دور فريقك.",
  TIME_UP: "انتهى الوقت.",
  BAD_OPTION: "هذا الخيار غير متاح.",
  NOT_IN_ROOM: "أنت لست في هذه الغرفة.",
  EMPTY_NAME: "اكتب اسمًا.",
  NAME_NOT_ALLOWED: "هذا الاسم غير مسموح.",
};
const SETUP_SQL = "اللعبة الجديدة تحتاج تشغيل الملف supabase/grid_v2.sql في Supabase.";

const isGrid = (s: GridState) => s.game === "grid" && Array.isArray(s.teams);
const teamOf = (s: GridState, key: string | null | undefined) => s.teams?.find((t) => t.key === key) ?? null;
const colorOf = (t: GridTeam | null) => GRID_COLORS[(t?.c ?? 0) % GRID_COLORS.length];

/** Calls a grid RPC and turns its result into an error message, or null when it worked. */
async function gridRpc(fn: string, args: Record<string, unknown>) {
  if (!supabase) return "الاتصال بقاعدة البيانات غير مضبوط بعد.";
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return error.code === "PGRST202" || error.code === "42883" ? SETUP_SQL : "تعذّر تنفيذ الخطوة، حاول مرة أخرى.";
  const res = data as { ok: boolean; reason?: string; category?: string; team?: string } | null;
  if (res && res.ok === false) {
    const extra = res.category ? ` (${res.category})` : res.team ? ` (${res.team})` : "";
    return (ERRORS[res.reason ?? ""] ?? "تعذّر تنفيذ الخطوة.") + extra;
  }
  return null;
}

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

/** Sounds on the big screen and host device; vibration on the phones of the team that answers. */
function useGridCues(state: GridState, opts: { sound?: boolean; myTeam?: string | null }) {
  const last = useRef<string>("");
  useEffect(() => {
    const key = `${state.phase}:${state.cur?.id ?? ""}:${state.cur?.answering ?? ""}:${state.cur?.tries ?? ""}`;
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
    if (opts.myTeam && state.cur && (state.phase === "question" || state.phase === "steal") && state.cur.answering === opts.myTeam) vibrate([200, 80, 200]);
  }, [state.phase, state.cur?.id, state.cur?.answering, state.cur?.tries, state.reveal?.by, opts.sound, opts.myTeam]);
}

/** When the timer runs out, any screen asks the server to settle (it checks the time itself). */
function useAutoTimeout(roomId: string, state: GridState, left: number | null) {
  const asked = useRef("");
  useEffect(() => {
    const cur = state.cur;
    if (!cur || (state.phase !== "question" && state.phase !== "steal") || left === null || left > 0) return;
    const key = `${cur.id}:${cur.answering}:${cur.ends_at}`;
    if (asked.current === key) return;
    asked.current = key;
    // A small random delay so all the phones don't ask at the same moment.
    const t = window.setTimeout(() => void supabase?.rpc("grid_timeout", { p_room_id: roomId }), 300 + Math.random() * 900);
    return () => window.clearTimeout(t);
  }, [roomId, state.phase, state.cur, left]);
}

/* ---------------- Shared pieces ---------------- */

function TeamName({ team, className }: { team: GridTeam | null; className?: string }) {
  if (!team) return null;
  return (
    <span className={cx("font-bold", className)} style={{ color: colorOf(team).color }}>
      {team.name}
    </span>
  );
}

export function Scoreboard({ state, big = false }: { state: GridState; big?: boolean }) {
  const active = state.phase === "board" ? state.turn : state.phase === "question" || state.phase === "steal" ? state.cur?.answering : null;
  const teams = state.teams ?? [];
  return (
    <div className="grid gap-2 sm:gap-3" style={{ gridTemplateColumns: `repeat(${big || teams.length <= 3 ? teams.length || 1 : Math.ceil(teams.length / 2)}, minmax(0, 1fr))` }}>
      {teams.map((t) => {
        const on = active === t.key;
        const c = colorOf(t);
        return (
          <div
            key={t.key}
            className={cx("min-w-0 rounded-[20px] border-2 p-2.5 text-center transition sm:p-3", on ? "scale-[1.02]" : "opacity-85", big && "p-[0.8vw]")}
            style={{ borderColor: on ? c.color : "transparent", background: c.fill }}
          >
            <p className={cx("truncate font-semibold", big ? "text-[clamp(16px,1.6vw,30px)]" : "text-[14px]")} style={{ color: c.color }}>
              {t.name}
              {on ? (state.phase === "board" ? " · الدور" : " · يجاوب") : ""}
            </p>
            <p dir="ltr" className={cx("font-display font-extrabold tabular-nums text-ivory", big ? "text-[clamp(28px,3.4vw,64px)] leading-none" : "text-[30px] leading-10")}>
              {state.scores?.[t.key] ?? 0}
            </p>
            <p className={cx("mt-1 truncate text-mist", big ? "text-[clamp(12px,1.1vw,20px)]" : "text-[11px]")}>
              {[...(state.aids?.[t.key] ?? []).map((a) => AIDS[a]?.name), ...(state.steals?.[t.key] ? ["سرقة"] : [])].join(" · ") || "بلا وسائل"}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** The board, in rows of up to 6 categories so it stays readable with many teams. */
function Board({ state, onPick, big = false }: { state: GridState; onPick?: (c: number, i: number) => void; big?: boolean }) {
  const cats = state.cats ?? [];
  const cells = state.cells ?? [];
  // The big screen fits up to 12 columns; phones get rows of up to 6.
  const per = big || cats.length <= 6 ? cats.length || 1 : Math.ceil(cats.length / Math.ceil(cats.length / 6));
  const groups: number[][] = [];
  for (let s = 0; s < cats.length; s += per) groups.push(cats.map((_, i) => i).slice(s, s + per));
  return (
    <div className="grid gap-3">
      {groups.map((cols, g) => (
        <div key={g} className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
          {cols.map((c) => {
            const owner = teamOf(state, state.cat_team?.[c]);
            return (
              <div
                key={`h${c}`}
                className={cx(
                  "relative grid min-h-12 place-items-center rounded-[12px] bg-gold/15 px-1 pt-1 text-center font-bold leading-tight text-gold",
                  big ? "min-h-[5.6vh] text-[clamp(13px,1.4vw,28px)]" : "text-[12px] sm:text-[14px]",
                )}
                title={owner ? `اختيار ${owner.name}` : undefined}
              >
                {owner ? <span aria-hidden="true" className="absolute top-1 start-1 size-2 rounded-full" style={{ background: colorOf(owner).color }} /> : null}
                {cats[c]}
              </div>
            );
          })}
          {[0, 1, 2, 3, 4, 5].map((row) =>
            cols.map((c) => {
              const cell = cells[c]?.[row];
              if (!cell) return <div key={`${c}-${row}`} />;
              const live = state.cur && state.cur.c === c && state.cur.i === row && state.phase !== "board";
              const clickable = !!onPick && !cell.done && state.phase === "board";
              const by = teamOf(state, cell.by);
              return (
                <button
                  key={`${c}-${row}`}
                  type="button"
                  disabled={!clickable}
                  onClick={() => onPick?.(c, row)}
                  className={cx(
                    "grid place-items-center rounded-[12px] border font-display font-extrabold tabular-nums transition",
                    big ? cx("min-h-[6.2vh]", cats.length > 8 ? "text-[clamp(14px,1.6vw,34px)]" : "text-[clamp(16px,2.1vw,42px)]") : "min-h-11 text-[16px] sm:min-h-12 sm:text-[20px]",
                    cell.done ? "border-transparent text-transparent" : "border-line-strong/70 bg-deep-2/80 text-gold",
                    clickable && "hover:border-gold hover:bg-gold/10",
                    live && "beat border-gold bg-gold/20",
                  )}
                  style={cell.done ? { background: by ? colorOf(by).fill : "#ffffff08" } : undefined}
                  aria-label={cell.done ? `${cats[c]} ${cell.p} (لُعبت${by ? `، ${by.name}` : ""})` : `${cats[c]} ${cell.p}`}
                >
                  {cell.done ? <span style={{ color: by ? colorOf(by).color : undefined }}>{by ? "●" : "—"}</span> : cell.p}
                </button>
              );
            }),
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The question with its options. The answering team taps to vote (and can change its vote until
 * it is settled); everyone else watches the votes come in. Nobody sees which option is right.
 */
function QuestionCard({ roomId, state, meId, big = false }: { roomId: string; state: GridState; meId?: string | null; big?: boolean }) {
  const cur = state.cur;
  const live = state.phase === "question" || state.phase === "steal";
  const left = useSecondsLeft(live ? cur?.ends_at : null);
  useAutoTimeout(roomId, state, left);
  const [sending, setSending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!cur) return null;

  const answering = teamOf(state, cur.answering);
  const myTeam = meId ? state.members?.[meId] ?? null : null;
  const canVote = live && !!meId && myTeam === cur.answering && left !== 0;
  const mine = meId ? cur.votes?.[meId]?.o ?? null : null;
  const teamVotes = Object.entries(cur.votes ?? {}).filter(([pid]) => state.members?.[pid] === cur.answering);
  const counts = new Map<number, number>();
  for (const [, v] of teamVotes) counts.set(v.o, (counts.get(v.o) ?? 0) + 1);
  const teamSize = Object.values(state.members ?? {}).filter((k) => k === cur.answering).length;

  async function pass() {
    setSending(-1);
    setError(null);
    const e = await gridRpc("grid_pass", { p_room_id: roomId });
    setSending(null);
    if (e) setError(e);
  }

  async function vote(i: number) {
    setSending(i);
    setError(null);
    const e = await gridRpc("grid_vote", { p_room_id: roomId, p_option: i });
    setSending(null);
    if (e) setError(e);
    else vibrate(30);
  }

  return (
    <div className={cx("rounded-[24px] border border-gold/40 bg-night/60 p-4 text-center shadow-glow-gold sm:p-5", big && "p-[2vw]")}>
      <p className={cx("font-semibold text-mist", big ? "text-[clamp(16px,1.6vw,30px)]" : "text-[14px]")}>
        {cur.cat} · <bdi dir="ltr">{cur.p}</bdi> نقطة
        {cur.aids.length ? ` · ${cur.aids.map((a) => AIDS[a]?.name).join("، ")}` : ""}
        {cur.kind === "tf" ? " · صح أو خطأ" : ""}
      </p>
      <p className={cx("mt-2 font-display font-extrabold text-ivory", big ? "text-[clamp(26px,3.2vw,64px)] leading-[1.35]" : "text-[22px] leading-[36px]")}>{cur.q}</p>
      {cur.media ? <img src={cur.media} alt="" className="mx-auto mt-3 max-h-[36vh] rounded-[16px]" /> : null}

      {live && answering ? (
        <div className="mt-3 grid justify-items-center gap-1">
          <p className={cx("font-bold", big ? "text-[clamp(18px,2vw,38px)]" : "text-[17px]")} style={{ color: colorOf(answering).color }}>
            {cur.steal ? `سرقة ${answering.name} (مرة واحدة في اللعبة)` : `يصوّت ${answering.name}`}
            {state.phase === "question" && cur.tries > 1 ? " · محاولتان" : ""}
          </p>
          <Timer seconds={left} label="الوقت" sound={big} />
        </div>
      ) : null}

      <ul className={cx("mt-4 grid gap-2", cur.kind === "tf" ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2", big && "gap-[0.8vw]")}>
        {cur.options.map((o, i) => {
          const out = cur.out?.includes(i);
          const n = counts.get(i) ?? 0;
          const picked = mine === i;
          const right = !live && state.reveal?.correct === i;
          return (
            <li key={i}>
              <button
                type="button"
                disabled={!canVote || out || sending !== null}
                onClick={() => void vote(i)}
                aria-pressed={canVote ? picked : undefined}
                className={cx(
                  "relative flex w-full items-center gap-3 rounded-[16px] border-2 px-3 text-start font-bold transition",
                  big ? "min-h-[7vh] text-[clamp(18px,1.9vw,38px)]" : "min-h-14 text-[17px]",
                  out ? "border-transparent bg-wrong-fill/10 text-muted line-through" : right ? "border-correct bg-correct-fill/20 text-ivory" : picked ? "border-gold bg-gold/15 text-ivory" : "border-line-strong/60 bg-deep-2/70 text-ivory",
                  canVote && !out && "hover:border-gold/70 active:scale-[0.98]",
                )}
              >
                <span
                  className={cx("grid shrink-0 place-items-center rounded-full font-display text-[15px]", big ? "size-[3vw] min-h-9 min-w-9" : "size-9", picked || right ? "btn-gold" : "bg-white/10 text-mist")}
                  aria-hidden="true"
                >
                  {cur.kind === "tf" ? (i === 0 ? "✓" : "✗") : LETTERS[i]}
                </span>
                <span className="min-w-0 flex-1">{o}</span>
                {n > 0 && live ? (
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[13px] font-bold text-on-gold" style={{ background: answering ? colorOf(answering).color : undefined }}>
                    {n}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {canVote && cur.steal ? (
        <Button tone="quiet" className="mt-3 min-h-11 w-full text-[15px]" disabled={sending !== null} onClick={() => void pass()}>
          تخطَّ واحتفظ بسرقتكم لسؤال آخر
        </Button>
      ) : null}
      {live ? (
        <p className={cx("mt-3 text-mist", big ? "text-[clamp(14px,1.3vw,24px)]" : "text-[13px]")}>
          صوّت {teamVotes.length} من {teamSize}
          {canVote ? (mine === null ? " · اختر إجابة فريقك" : " · تقدر تغيّر صوتك قبل الحسم") : ""}
          {" · "}الأكثر أصواتًا يُعتمد، وعند التعادل الأسبق
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[14px] font-semibold text-wrong">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function RevealCard({ state, big = false }: { state: GridState; big?: boolean }) {
  const r = state.reveal;
  if (!r) return null;
  const by = teamOf(state, r.by);
  const wrong = (state.cur?.picks ?? []).filter((p) => !p.ok);
  return (
    <div className={cx("rounded-[24px] border p-5 text-center", big && "p-[2vw]", by ? "border-correct/50 bg-correct-fill/15" : "border-wrong/50 bg-wrong-fill/15")}>
      <p className={cx("text-mist", big ? "text-[clamp(16px,1.6vw,30px)]" : "text-[14px]")}>الإجابة الصحيحة</p>
      <p className={cx("font-display font-extrabold text-ivory", big ? "text-[clamp(30px,3.8vw,76px)]" : "text-[28px] leading-10")}>{r.answer}</p>
      <p className={cx("mt-2 font-bold", big ? "text-[clamp(18px,2vw,38px)]" : "text-[17px]")} style={{ color: by ? colorOf(by).color : undefined }}>
        {by ? `${r.stolen ? "سرقها" : "كسبها"} ${by.name} +${r.gain}` : "لا نقاط لأحد"}
      </p>
      {wrong.length ? (
        <ul className={cx("mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-mist", big ? "text-[clamp(13px,1.2vw,22px)]" : "text-[13px]")}>
          {wrong.map((p, i) => {
            const t = teamOf(state, p.team);
            return (
              <li key={i}>
                <TeamName team={t} />: {p.o === null ? "لم يصوّت" : state.cur?.options[p.o]}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function ranking(state: GridState) {
  return [...(state.teams ?? [])].sort((a, b) => (state.scores?.[b.key] ?? 0) - (state.scores?.[a.key] ?? 0));
}

export function gridShare(state: GridState): ShareResult {
  const w = teamOf(state, state.winner);
  const rows = ranking(state);
  return {
    slug: "tactical-grid",
    title: "🎲 تحديات العش",
    headline: w ? w.name : "تعادل",
    sub: w ? `🏆 الفائز بـ ${state.scores?.[w.key] ?? 0} نقطة` : `${state.scores?.[rows[0]?.key ?? ""] ?? 0} نقطة للمتصدرين`,
    rows: rows.map((t) => ({ name: t.name, value: String(state.scores?.[t.key] ?? 0), color: colorOf(t).color })),
  };
}

function OverCard({ state, big = false }: { state: GridState; big?: boolean }) {
  const w = teamOf(state, state.winner);
  return (
    <div className={cx("grid justify-items-center gap-3 rounded-[28px] border border-gold/40 bg-night/60 p-6 text-center shadow-glow-gold", big && "p-[3vw]")}>
      <Glyph name="trophy" className={cx("text-gold", big ? "size-[6vw]" : "size-12")} />
      <p className={cx("font-display font-extrabold", big ? "text-[clamp(36px,5vw,96px)]" : "text-[32px] leading-[44px]")} style={{ color: w ? colorOf(w).color : undefined }}>
        {w ? `فاز ${w.name}` : "تعادل!"}
      </p>
      <ol className="grid w-full max-w-md gap-1.5">
        {ranking(state).map((t, i) => (
          <li key={t.key} className={cx("flex items-center justify-between rounded-[14px] px-4 py-2", big ? "text-[clamp(16px,1.8vw,34px)]" : "text-[16px]")} style={{ background: colorOf(t).fill }}>
            <span>
              <span className="text-mist">{i + 1}. </span>
              <TeamName team={t} />
            </span>
            <span dir="ltr" className="font-display font-extrabold tabular-nums text-ivory">
              {state.scores?.[t.key] ?? 0}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TeamLists({ state, players, big = false }: { state: GridState; players: GridPlayer[]; big?: boolean }) {
  const teams = state.teams ?? [];
  return (
    <div className={cx("grid gap-3", teams.length <= 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
      {teams.map((t) => (
        <ul key={t.key} className="grid content-start gap-1.5 rounded-[18px] p-3" style={{ background: colorOf(t).fill }}>
          <li className={cx(big ? "text-[clamp(14px,1.4vw,26px)]" : "text-[13px]")}>
            <TeamName team={t} />
          </li>
          {players
            .filter((p) => state.members?.[p.id] === t.key)
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

/** The board for the team whose turn it is (host or a member): aids, then a cell. */
function BoardControls({ roomId, state, onError }: { roomId: string; state: GridState; onError: (e: string | null) => void }) {
  const turn = teamOf(state, state.turn);
  const left = state.aids?.[state.turn ?? ""] ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPicked([]), [state.turn]);
  async function open(c: number, i: number) {
    setBusy(true);
    onError(null);
    const e = await gridRpc("grid_open", { p_room_id: roomId, p_cat: c, p_cell: i, p_aids: picked });
    setBusy(false);
    onError(e);
  }
  return (
    <div className="grid gap-3">
      <p className="text-center text-[17px]">
        دور <TeamName team={turn} />: اختاروا خانة
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
      <Board state={state} onPick={busy ? undefined : (c, i) => void open(c, i)} />
    </div>
  );
}

/* ---------------- Host ---------------- */

export function GridHostPanel({ roomId }: { roomId: string }) {
  const { state, players, reload } = useGridLive(roomId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  useGridCues(state, { sound: true });

  useEffect(() => {
    supabase?.rpc("my_player_id", { p_room_id: roomId }).then(({ data }) => setHostId(typeof data === "string" ? data : null));
  }, [roomId]);

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const e = await gridRpc(fn, { p_room_id: roomId, ...args });
    setBusy(false);
    setError(e);
    if (!e) await reload();
    return !e;
  }

  if (!isGrid(state)) return <GridSetup roomId={roomId} state={state} players={players} busy={busy} error={error} onStart={(setup) => run("grid_start", { p_setup: setup })} />;

  const hostTeam = hostId ? teamOf(state, state.members?.[hostId]) : null;
  return (
    <section className="mx-auto mt-2 grid max-w-4xl gap-4">
      {hostTeam ? (
        <p className="rounded-[16px] p-2.5 text-center text-[15px]" style={{ background: colorOf(hostTeam).fill }}>
          أنت تلعب مع <TeamName team={hostTeam} />
        </p>
      ) : null}
      <Scoreboard state={state} />
      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-[14px] font-semibold text-wrong">
          <Glyph name="alert" className="size-4" />
          {error}
        </p>
      ) : null}

      {state.phase === "board" ? <BoardControls roomId={roomId} state={state} onError={setError} /> : null}

      {state.phase === "question" || state.phase === "steal" ? (
        <>
          <QuestionCard roomId={roomId} state={state} meId={hostId} />
          <p className="text-center text-[13px] text-mist">
            الإجابة مخفية عن الجميع، وأنت منهم. يُحسم السؤال حين يصوّت كل الفريق أو ينتهي الوقت.
            {state.cur?.kind === "mc" ? " إذا أخطأ الفريق ينتقل السؤال للفريق التالي اللي سرقته معه، ويُشطب خياره. لكل فريق سرقة واحدة في اللعبة." : " أسئلة صح أو خطأ بلا سرقة."}
          </p>
        </>
      ) : null}

      {state.phase === "reveal" ? (
        <>
          <QuestionCard roomId={roomId} state={state} />
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
          <TeamsManager roomId={roomId} state={state} players={players} onDone={reload} />
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

/** During the game: rename a team, and put players who joined late (or anyone) in a team. */
function TeamsManager({ roomId, state, players, onDone }: { roomId: string; state: GridState; players: GridPlayer[]; onDone: () => Promise<void> }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const teams = state.teams ?? [];
  const eligible = players.filter((p) => !p.is_host || state.settings?.host_plays);
  const loose = eligible.filter((p) => !state.members?.[p.id]);

  async function rename(t: GridTeam) {
    const name = (names[t.key] ?? "").trim();
    if (!name || name === t.name) return;
    const e = await gridRpc("grid_rename", { p_room_id: roomId, p_team: t.key, p_name: name });
    setNote(e);
    if (!e) {
      setNames({ ...names, [t.key]: "" });
      await onDone();
    }
  }
  async function assign(p: GridPlayer, key: string) {
    const e = await gridRpc("grid_assign", { p_room_id: roomId, p_player_id: p.id, p_team: key || null });
    setNote(e);
    if (!e) await onDone();
  }

  return (
    <details className="surface rounded-[20px] p-4" open={loose.length > 0}>
      <summary className="cursor-pointer text-[15px] font-semibold text-ivory">
        الفرق{loose.length ? <span className="text-gold"> · {loose.length} بلا فريق</span> : null}
      </summary>
      <div className="mt-3 grid gap-3">
        <TeamLists state={state} players={players} />
        <div className="grid gap-2 sm:grid-cols-2">
          {teams.map((t) => (
            <form
              key={t.key}
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void rename(t);
              }}
            >
              <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: colorOf(t).color }} />
              <input className={cx(inputClass, "min-h-11")} maxLength={24} placeholder={t.name} aria-label={`اسم ${t.name}`} value={names[t.key] ?? ""} onChange={(e) => setNames({ ...names, [t.key]: e.target.value })} />
              <Button type="submit" tone="quiet" className="min-h-11 px-4" disabled={!(names[t.key] ?? "").trim()}>
                غيّر
              </Button>
            </form>
          ))}
        </div>
        <ul className="grid gap-1.5">
          {eligible.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[14px] text-ivory">{p.player_name}</span>
              <select
                aria-label={`فريق ${p.player_name}`}
                className={cx(inputClass, "min-h-10 w-auto py-0 text-[14px]")}
                value={state.members?.[p.id] ?? ""}
                onChange={(e) => void assign(p, e.target.value)}
              >
                <option value="">بلا فريق</option>
                {teams.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        {note ? <p className="text-[13px] font-semibold text-wrong">{note}</p> : null}
      </div>
    </details>
  );
}

type Category = { name: string; easy: number; medium: number; hard: number; total: number };
const SECONDS = [30, 45, 60, 90];
const PER_TEAM: Record<number, number> = { 2: 3, 3: 2, 4: 2, 5: 1, 6: 1 };

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
  onStart: (setup: Record<string, unknown>) => Promise<boolean>;
}) {
  const last = state.last_settings ?? (state.game === "grid" ? state.settings : null) ?? null;
  const [cats, setCats] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<number>(last?.seconds ?? 60);
  const [hostPlays, setHostPlays] = useState<boolean>(last?.host_plays ?? false);
  const [names, setNames] = useState<string[]>(() => {
    const saved = last?.team_names ?? [];
    return saved.length >= 2 ? saved.slice(0, 6) : DEFAULT_TEAM_NAMES.slice(0, 2);
  });
  const [picks, setPicks] = useState<string[][]>([]);
  const [active, setActive] = useState(0);
  const [teamOfPlayer, setTeamOfPlayer] = useState<Record<string, number>>({});

  // The admin's default question time (admin panel → الموقع), when the room has no earlier match.
  const site = useSiteSettings();
  const appliedDefault = useRef(false);
  useEffect(() => {
    const d = site?.game_defaults?.["tactical-grid"]?.seconds;
    if (appliedDefault.current || last?.seconds || typeof d !== "number" || !SECONDS.includes(d)) return;
    appliedDefault.current = true;
    setSeconds(d);
  }, [site, last?.seconds]);

  useEffect(() => {
    if (!supabase) return;
    supabase.rpc("grid_categories").then(({ data, error: e }) => {
      if (e) setLoadError(e.code === "PGRST202" || e.code === "42883" ? SETUP_SQL : "تعذّر تحميل الفئات.");
      else setCats((data ?? []) as Category[]);
    });
  }, [roomId]);

  const n = names.length;
  const available = cats?.length ?? 0;
  // Fewer categories per team as teams grow: 2 teams 3 each, 3-4 teams 2 each, 5-6 teams 1 each (8 at most).
  const perTeam = PER_TEAM[n] ?? 1;
  const playing = useMemo(() => players.filter((p) => !p.is_host || hostPlays), [players, hostPlays]);

  // Keep the picks in shape when the team count or the per-team count changes.
  useEffect(() => {
    setPicks((cur) => Array.from({ length: n }, (_, i) => (cur[i] ?? []).slice(0, perTeam)));
    setActive((a) => Math.min(a, n - 1));
  }, [n, perTeam]);
  // New players join the smallest team; the host can move anyone.
  useEffect(() => {
    setTeamOfPlayer((cur) => {
      const next: Record<string, number> = {};
      const size = Array(n).fill(0) as number[];
      for (const p of playing) {
        const t = cur[p.id];
        if (t !== undefined && t < n) {
          next[p.id] = t;
          size[t]++;
        }
      }
      for (const p of playing) {
        if (next[p.id] !== undefined) continue;
        const t = size.indexOf(Math.min(...size));
        next[p.id] = t;
        size[t]++;
      }
      return next;
    });
  }, [playing, n]);

  const owner = (cat: string) => picks.findIndex((list) => list.includes(cat));
  function toggleCat(cat: string) {
    const o = owner(cat);
    if (o === active) {
      setPicks(picks.map((l, i) => (i === active ? l.filter((x) => x !== cat) : l)));
      return;
    }
    if (o >= 0 || (picks[active]?.length ?? 0) >= perTeam) return;
    const next = picks.map((l, i) => (i === active ? [...l, cat] : l));
    setPicks(next);
    if ((next[active]?.length ?? 0) >= perTeam) {
      const empty = next.findIndex((l) => l.length < perTeam);
      if (empty >= 0) setActive(empty);
    }
  }
  function randomFill() {
    const pool = [...(cats ?? []).map((c) => c.name)].filter((c) => owner(c) < 0).sort(() => Math.random() - 0.5);
    setPicks(picks.map((l) => [...l, ...pool.splice(0, perTeam - l.length)]));
  }
  function balance() {
    const shuffled = [...playing].sort(() => Math.random() - 0.5);
    setTeamOfPlayer(Object.fromEntries(shuffled.map((p, i) => [p.id, i % n])));
  }
  function addTeam() {
    if (n >= 6) return;
    const unused = DEFAULT_TEAM_NAMES.find((d) => !names.includes(d)) ?? `فريق ${n + 1}`;
    setNames([...names, unused]);
  }
  function removeTeam(i: number) {
    if (n <= 2) return;
    setNames(names.filter((_, k) => k !== i));
    setPicks(picks.filter((_, k) => k !== i));
    setTeamOfPlayer(Object.fromEntries((Object.entries(teamOfPlayer) as Array<[string, number]>).map(([pid, t]) => [pid, t === i ? 0 : t > i ? t - 1 : t])));
  }

  const sizes = names.map((_, i) => playing.filter((p) => teamOfPlayer[p.id] === i).length);
  const catsReady = picks.length === n && picks.every((l) => l.length === perTeam);
  const ready = catsReady && sizes.every((s) => s > 0) && available >= perTeam * n;

  function start() {
    void onStart({
      teams: names.map((name, i) => ({ name: name.trim(), members: playing.filter((p) => teamOfPlayer[p.id] === i).map((p) => p.id) })),
      cats: picks,
      seconds,
      host_plays: hostPlays,
    });
  }

  return (
    <section className="mx-auto mt-2 grid max-w-3xl gap-4">
      {/* الفرق */}
      <div className="surface grid gap-3 rounded-[24px] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[20px] leading-8">
            الفرق <span className="text-[14px] font-normal text-mist">({n} من 6)</span>
          </h2>
          <div className="flex gap-2">
            <Button tone="quiet" className="min-h-10 px-3 text-[14px]" onClick={balance} disabled={playing.length < 2}>
              <Glyph name="refresh" className="size-4" />
              وزّع عشوائيًا
            </Button>
            <Button tone="outline" className="min-h-10 px-3 text-[14px]" onClick={addTeam} disabled={n >= 6 || n >= Math.max(2, playing.length)}>
              <Glyph name="plus" className="size-4" />
              فريق
            </Button>
          </div>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[14px] border border-line px-3">
          <span className="text-[15px] text-ivory">
            ألعب مع الفرق <span className="text-[13px] text-mist">(تصوّت من هذا الجهاز، والإجابة مخفية عنك مثل الكل)</span>
          </span>
          <input type="checkbox" className="size-5 accent-[var(--color-gold)]" checked={hostPlays} onChange={(e) => setHostPlays(e.target.checked)} />
        </label>
        <div className={cx("grid gap-3", n <= 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3")}>
          {names.map((name, i) => {
            const c = GRID_COLORS[i];
            return (
              <div key={i} className="grid content-start gap-2 rounded-[18px] p-3" style={{ background: c.fill }}>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
                  <input
                    className={cx(inputClass, "min-h-10 bg-night/40 font-bold")}
                    style={{ color: c.color }}
                    maxLength={24}
                    value={name}
                    aria-label={`اسم الفريق ${i + 1}`}
                    onChange={(e) => setNames(names.map((x, k) => (k === i ? e.target.value : x)))}
                    onBlur={() => !name.trim() && setNames(names.map((x, k) => (k === i ? DEFAULT_TEAM_NAMES[i] : x)))}
                  />
                  {n > 2 ? (
                    <button type="button" aria-label={`احذف ${name}`} className="grid size-10 shrink-0 place-items-center rounded-full text-mist hover:text-wrong" onClick={() => removeTeam(i)}>
                      <Glyph name="x" className="size-4" />
                    </button>
                  ) : null}
                </div>
                <ul className="grid gap-1">
                  {playing
                    .filter((p) => teamOfPlayer[p.id] === i)
                    .map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setTeamOfPlayer({ ...teamOfPlayer, [p.id]: (i + 1) % n })}
                          className="flex min-h-10 w-full items-center gap-2 rounded-[12px] px-2 text-start text-[15px] font-semibold text-ivory hover:bg-white/5"
                          title="انقل للفريق التالي"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {p.player_name}
                            {p.is_host ? <span className="text-[12px] font-normal text-mist"> (أنت)</span> : null}
                          </span>
                          <Glyph name="refresh" className="size-4 text-mist" />
                        </button>
                      </li>
                    ))}
                  {sizes[i] === 0 ? <li className="px-2 text-[13px] text-mist">بلا لاعبين بعد</li> : null}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="text-[13px] text-mist">اضغط اسم اللاعب لنقله إلى الفريق التالي. اسم الفريق يتغيّر من خانته.</p>
      </div>

      {/* الفئات */}
      <div className="surface grid gap-3 rounded-[24px] p-5">
        <h2 className="text-[20px] leading-8">فئات كل فريق</h2>
        <p className="text-[13px] text-mist">
          {n} فرق: كل فريق يختار {perTeam === 1 ? "فئة واحدة" : perTeam === 2 ? "فئتين" : "3 فئات"}، واللوحة {perTeam * n} فئات. كلما زادت الفرق قلّت فئات كل فريق. اختر الفريق ثم فئاته.
        </p>
        <div role="tablist" className="flex flex-wrap gap-1.5">
          {names.map((name, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={active === i}
              onClick={() => setActive(i)}
              className={cx("min-h-10 rounded-full border-2 px-3 text-[14px] font-bold", active === i ? "bg-night/60" : "border-transparent opacity-75")}
              style={{ borderColor: active === i ? GRID_COLORS[i].color : undefined, color: GRID_COLORS[i].color, background: active === i ? undefined : GRID_COLORS[i].fill }}
            >
              {name || DEFAULT_TEAM_NAMES[i]} ({picks[i]?.length ?? 0}/{perTeam})
            </button>
          ))}
        </div>
        {loadError ? <p className="text-[14px] text-wrong">{loadError}</p> : null}
        {cats === null && !loadError ? <p className="text-[14px] text-mist">جارٍ تحميل الفئات…</p> : null}
        {cats && cats.length < perTeam * n ? <p className="text-[14px] text-wrong">الفئات المتاحة ({cats.length}) أقل من المطلوب ({perTeam * n}). أضف أسئلة من لوحة الإدارة.</p> : null}
        <div className="flex flex-wrap gap-2">
          {(cats ?? []).map((c) => {
            const o = owner(c.name);
            const mineNow = o === active;
            const full = (picks[active]?.length ?? 0) >= perTeam;
            return (
              <button
                key={c.name}
                type="button"
                aria-pressed={o >= 0}
                disabled={(o >= 0 && !mineNow) || (o < 0 && full)}
                onClick={() => toggleCat(c.name)}
                className={cx(
                  "inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 text-[15px] font-semibold transition disabled:opacity-60",
                  o < 0 ? "border-line-strong/70 text-mist hover:text-ivory" : "text-ivory",
                )}
                style={o >= 0 ? { borderColor: GRID_COLORS[o].color, background: GRID_COLORS[o].fill } : undefined}
              >
                {o >= 0 ? <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: GRID_COLORS[o].color }} /> : null}
                {c.name}
                {o >= 0 && !mineNow ? <span className="text-[11px] opacity-80">{names[o]}</span> : <span className="text-[11px] opacity-70">{c.total}</span>}
              </button>
            );
          })}
        </div>
        <Button tone="quiet" className="min-h-10 w-fit px-4 text-[14px]" disabled={!cats || catsReady} onClick={randomFill}>
          أكمل الفئات عشوائيًا
        </Button>
      </div>

      {/* الوقت */}
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

      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-[14px] font-semibold text-wrong">
          <Glyph name="alert" className="size-4" />
          {error}
        </p>
      ) : null}
      <Button tone="primary" className="min-h-14 text-[18px]" disabled={!ready || busy} onClick={start}>
        {busy ? "نجهّز اللوحة…" : "ابدأ التحدي"}
      </Button>
      {!ready ? (
        <p className="text-center text-[13px] text-mist">
          {!sizes.every((s) => s > 0) ? "في كل فريق لاعب واحد على الأقل. " : ""}
          {!catsReady ? `كل فريق يختار ${perTeam} ${perTeam === 1 ? "فئة" : "فئات"}.` : ""}
        </p>
      ) : null}
    </section>
  );
}

/* ---------------- Player ---------------- */

export function GridPlayerPanel({ roomId, meId }: { roomId: string; meId: string | null }) {
  const { state } = useGridLive(roomId);
  const myKey = meId ? state.members?.[meId] ?? null : null;
  const myTeam = teamOf(state, myKey);
  const [error, setError] = useState<string | null>(null);
  useGridCues(state, { myTeam: myKey });

  if (!isGrid(state)) {
    return <Note>المضيف يجهّز الفرق والفئات. تابعوا الشاشة الكبيرة.</Note>;
  }
  const answering = state.cur ? teamOf(state, state.cur.answering) : null;
  return (
    <section className="grid gap-4">
      {myTeam ? (
        <p className="rounded-[16px] p-3 text-center text-[17px]" style={{ background: colorOf(myTeam).fill }}>
          أنت في <TeamName team={myTeam} />
        </p>
      ) : state.phase !== "over" ? (
        <Note>لست في فريق بعد. اطلب من المضيف يضيفك من «الفرق».</Note>
      ) : null}
      <Scoreboard state={state} />
      {error ? (
        <p role="alert" className="text-center text-[14px] font-semibold text-wrong">
          {error}
        </p>
      ) : null}
      {state.phase === "board" ? (
        state.turn === myKey ? (
          <>
            <p className="beat rounded-[16px] border-2 p-3 text-center text-[17px] font-extrabold" style={{ borderColor: colorOf(myTeam).color, color: colorOf(myTeam).color }}>
              دور فريقك! اتفقوا واختاروا خانة
            </p>
            <BoardControls roomId={roomId} state={state} onError={setError} />
          </>
        ) : (
          <Note>
            دور <TeamName team={teamOf(state, state.turn)} /> يختار خانة.
          </Note>
        )
      ) : null}
      {state.phase === "question" || state.phase === "steal" ? (
        <>
          {answering && answering.key === myKey ? (
            <p className="beat rounded-[16px] border-2 p-3 text-center text-[18px] font-extrabold" style={{ borderColor: colorOf(answering).color, color: colorOf(answering).color }}>
              {state.phase === "steal" ? "فرصة سرقة لفريقك! صوّتوا وتُستهلك سرقتكم، أو تخطّوا" : "فريقك يجاوب! صوّت على الإجابة"}
            </p>
          ) : null}
          <QuestionCard roomId={roomId} state={state} meId={meId} />
        </>
      ) : null}
      {state.phase === "reveal" ? (
        <>
          <QuestionCard roomId={roomId} state={state} />
          <RevealCard state={state} />
        </>
      ) : null}
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
    return <p className="text-center font-display text-[clamp(24px,3vw,56px)] font-extrabold text-ivory">المضيف يجهّز الفرق والفئات…</p>;
  }
  return (
    <div className="grid gap-[1vw]">
      <Scoreboard state={state} big />
      {state.phase === "board" ? (
        <>
          <p className="text-center font-display text-[clamp(18px,2vw,40px)] font-extrabold leading-tight">
            دور <TeamName team={teamOf(state, state.turn)} />
          </p>
          <Board state={state} big />
        </>
      ) : null}
      {state.phase === "question" || state.phase === "steal" ? <QuestionCard roomId={roomId} state={state} big /> : null}
      {state.phase === "reveal" ? (
        <>
          <QuestionCard roomId={roomId} state={state} big />
          <RevealCard state={state} big />
        </>
      ) : null}
      {state.phase === "over" ? (
        <>
          <OverCard state={state} big />
          <TeamLists state={state} players={players} big />
        </>
      ) : null}
    </div>
  );
}
