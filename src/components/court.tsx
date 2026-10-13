import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Glyph } from "@/components/brand";
import { Button, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { playCue } from "@/lib/sfx";
import { vibrate } from "@/lib/prefs";
import { useSecondsLeft } from "@/components/halba";
import { ResultShare, type ShareResult } from "@/components/result-share";
import { useLivePoll } from "@/lib/live";

/**
 * «المحكمة»: a case, secret role cards, evidence in rounds, questioning, closing speeches,
 * a guilty / not guilty vote, then the truth. The rules run on the server (supabase/court_v1.sql);
 * the host moves the session forward with one button, and every screen follows the same phase.
 */

export type CourtKind = "accused" | "prosecutor" | "lawyer" | "detective" | "witness" | "juror";
type Step = { phase: CourtPhase; stage?: number; side?: "prosecutor" | "lawyer"; seconds?: number };
type CourtPhase = "intro" | "evidence" | "question" | "closing" | "vote" | "verdict" | "over";
export type CourtEvidence = { stage: number; title: string; text: string; icon: string };
type CastRow = { player_id: string; player_name: string; kind: CourtKind; name: string; brief: string | null };
type PointsRow = { player_id: string; player_name: string; kind: CourtKind; name: string; vote: boolean | null; points: number; why: string[] };
type CardReveal = { player_name: string; kind: CourtKind; name: string; secret: string; later: string | null };

export type CourtState = {
  game?: "court";
  phase?: CourtPhase;
  step?: number;
  steps?: Step[];
  stage?: number;
  side?: "prosecutor" | "lawyer" | null;
  ends_at?: string | null;
  case?: { id: string; title: string; category: string | null; intro: string; difficulty: number };
  cast?: CastRow[];
  evidence?: CourtEvidence[];
  stand?: string | null;
  objection?: { kind: CourtKind; name: string; at: string; n: number } | null;
  votes_count?: number;
  voters_count?: number;
  verdict?: { guilty: boolean; votes_guilty: number; votes_innocent: number } | null;
  truth?: { guilty: boolean; text: string; correct: boolean } | null;
  points?: PointsRow[] | null;
  cards?: CardReveal[] | null;
  settings?: CourtSettings;
  last_settings?: CourtSettings | null;
};
type CourtSettings = { case_id?: string | null; host_plays?: boolean; question_seconds?: number; closing_seconds?: number; vote_seconds?: number; used_cases?: string[] };
type MyCard = {
  started: boolean;
  late?: boolean;
  kind?: CourtKind;
  kind_ar?: string;
  name?: string;
  brief?: string | null;
  secret?: string;
  later?: string | null;
  later_pending?: boolean;
  vote?: boolean | null;
  objections_left?: number;
};
type Player = { id: string; player_name: string; is_host: boolean };

export const KINDS: Record<CourtKind, { label: string; icon: string; goal: string }> = {
  accused: { label: "المتهم", icon: "🙍", goal: "دافع عن نفسك. تكسب 300 نقطة إذا حُكم ببراءتك، سواء كنت بريئًا أو لا." },
  prosecutor: { label: "المدعي العام", icon: "📂", goal: "أثبت التهمة بالأدلة. تكسب 200 إذا كان الحكم صحيحًا، و100 لصوتك الصحيح." },
  lawyer: { label: "المحامي", icon: "💼", goal: "دافع عن موكلك واكشف الثغرات. 200 إذا بُرّئ، و100 إذا كان الحكم صحيحًا، و100 لصوتك الصحيح." },
  detective: { label: "المحقق", icon: "🔎", goal: "اربط الأدلة بالأحداث وساعد المحكمة على الحقيقة. 200 إذا كان الحكم صحيحًا، و100 لصوتك الصحيح." },
  witness: { label: "شاهد", icon: "👁️", goal: "أجب بما تعرفه حين تُسأل. 200 إذا كان الحكم صحيحًا، و100 لصوتك الصحيح." },
  juror: { label: "محلّف", icon: "🗳️", goal: "استمع واسأل، ثم صوّت. صوتك الصحيح = 100 نقطة." },
};
const KIND_ORDER: CourtKind[] = ["accused", "prosecutor", "lawyer", "detective", "witness", "juror"];

const ERRORS: Record<string, string> = {
  NOT_HOST: "هذا للمضيف فقط.",
  NOT_PLAYING: "ابدأ اللعبة من صفحة الغرفة أولًا.",
  NOT_ENOUGH_PLAYERS: "المحكمة تحتاج 4 لاعبين على الأقل.",
  TOO_MANY_PLAYERS: "المحكمة تتسع لـ 12 لاعبًا كحد أقصى.",
  NO_CASE: "لا توجد قضية مناسبة لهذا العدد. أضف قضايا من لوحة الإدارة.",
  CASE_NEEDS_MORE: "هذه القضية تحتاج لاعبين أكثر.",
  ALREADY_STARTED: "المحاكمة بدأت.",
  WRONG_PHASE: "هذه الخطوة غير متاحة الآن.",
  NOT_ALLOWED: "الاعتراض للمدعي والمحامي فقط.",
  NO_OBJECTIONS: "استخدمت اعتراضيك.",
  BUSY: "انتظر ثواني، هناك اعتراض الآن.",
  ACCUSED: "المتهم لا يصوّت.",
  NOT_IN_CASE: "لست من أطراف هذه القضية.",
  OVER: "انتهت المحاكمة.",
};
const SETUP_HINT = "لعبة المحكمة تحتاج تشغيل الملفين supabase/court_v1.sql و supabase/court_cases_v1.sql في Supabase.";

const isCourt = (s: CourtState) => s.game === "court";

function stepLabel(step: Step | undefined) {
  if (!step) return "";
  switch (step.phase) {
    case "intro":
      return "القضية";
    case "evidence":
      return `أدلة الجولة ${step.stage}`;
    case "question":
      return `الاستجواب ${step.stage}`;
    case "closing":
      return step.side === "prosecutor" ? "مرافعة المدعي" : "مرافعة المحامي";
    case "vote":
      return "التصويت";
    case "verdict":
      return "الحكم";
    case "over":
      return "الحقيقة";
  }
}

/** What the host's button says: the next step, as an action. */
function nextAction(step: Step | undefined) {
  if (!step) return "التالي";
  switch (step.phase) {
    case "evidence":
      return `اعرض أدلة الجولة ${step.stage}`;
    case "question":
      return "ابدأ الاستجواب";
    case "closing":
      return step.side === "prosecutor" ? "مرافعة المدعي العام" : "مرافعة المحامي";
    case "vote":
      return "افتح التصويت";
    case "verdict":
      return "أعلن الحكم";
    case "over":
      return "اكشف الحقيقة";
    default:
      return "التالي";
  }
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Live state and players, from realtime with a polling fallback. */
export function useCourtLive(roomId: string) {
  const [state, setState] = useState<CourtState>({});
  const [players, setPlayers] = useState<Player[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: gs }, { data: ps }] = await Promise.all([
      supabase.from("room_game_state").select("state_data").eq("room_id", roomId).maybeSingle(),
      supabase.from("room_players").select("id, player_name, is_host").eq("room_id", roomId).order("joined_at"),
    ]);
    if (gs) setState((gs.state_data ?? {}) as CourtState);
    if (ps) setPlayers(ps as Player[]);
  }, [roomId]);
  useLivePoll(`court-${roomId}`, [{ table: "room_game_state", filter: `room_id=eq.${roomId}` }, { table: "room_players", filter: `room_id=eq.${roomId}` }], load);
  return { state, players, reload: load };
}

/** My role card: reloaded when the phase, round or objections change. */
function useMyCard(roomId: string, state: CourtState) {
  const [card, setCard] = useState<MyCard | null>(null);
  const key = `${state.game ?? ""}:${state.step ?? -1}:${state.stage ?? 0}:${state.objection?.at ?? ""}:${state.votes_count ?? 0}`;
  const reload = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.rpc("court_my_card", { p_room_id: roomId });
    setCard((data ?? null) as MyCard | null);
  }, [roomId]);
  useEffect(() => {
    void reload();
  }, [reload, key]);
  return { card, reload };
}

/** Sounds on the big screen and host; vibration on phones when something concerns everyone. */
function useCourtCues(state: CourtState, opts: { sound?: boolean; vibe?: boolean }) {
  const last = useRef("");
  const lastObjection = useRef<string | null>(null);
  useEffect(() => {
    const key = `${state.step ?? -1}`;
    if (key === last.current) return;
    const first = last.current === "";
    last.current = key;
    if (first || !isCourt(state)) return;
    if (opts.sound) {
      if (state.phase === "evidence") playCue("round");
      else if (state.phase === "verdict" || state.phase === "intro") playCue("gavel");
      else if (state.phase === "over") playCue(state.truth?.correct ? "victory" : "wrong");
      else playCue("click");
    }
    if (opts.vibe && (state.phase === "vote" || state.phase === "evidence")) vibrate([150, 60, 150]);
  }, [state.step, state.phase, state.truth?.correct, opts.sound, opts.vibe]);
  useEffect(() => {
    const at = state.objection?.at ?? null;
    if (!at || at === lastObjection.current) return;
    const first = lastObjection.current === null && Date.now() - Date.parse(at) > 6000;
    lastObjection.current = at;
    if (first) return;
    if (opts.sound) playCue("gavel");
    if (opts.vibe) vibrate(120);
  }, [state.objection?.at, opts.sound, opts.vibe]);
}

/** Seconds left on the step's timer, or null when it has none. */
function useStepLeft(state: CourtState) {
  return useSecondsLeft(state.ends_at ?? null);
}

/* ---------------- Shared pieces ---------------- */

function Clock({ seconds, big = false }: { seconds: number | null; big?: boolean }) {
  if (seconds === null) return null;
  const hot = seconds <= 10;
  return (
    <span
      dir="ltr"
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 font-display font-extrabold tabular-nums",
        big ? "py-1 text-[clamp(22px,2.6vw,52px)]" : "py-0.5 text-[20px]",
        seconds === 0 ? "border-wrong/60 text-wrong" : hot ? "beat border-wrong/60 text-wrong" : "border-gold/50 text-gold",
      )}
    >
      {seconds === 0 ? "انتهى الوقت" : mmss(seconds)}
    </span>
  );
}

function Steps({ state, big = false }: { state: CourtState; big?: boolean }) {
  const all = state.steps ?? [];
  const cur = state.step ?? 0;
  // The verdict is part of «الحكم»: it shows on the vote's chip.
  const at = all[cur]?.phase === "verdict" ? cur - 1 : cur;
  const list = useRef<HTMLOListElement>(null);
  // Keep the current step in view on narrow screens.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-current="step"]');
    const box = list.current;
    if (el && box) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [at]);
  return (
    <ol ref={list} className={cx("no-scrollbar flex gap-1 overflow-x-auto", big ? "text-[clamp(11px,1vw,18px)]" : "text-[11px]")} aria-label="مراحل الجلسة">
      {all.map((s, i) =>
        s.phase === "verdict" ? null : (
          <li
            key={i}
            aria-current={i === at ? "step" : undefined}
            className={cx("shrink-0 rounded-full px-2.5 py-1 font-semibold whitespace-nowrap", i === at ? "btn-gold" : i < at ? "bg-gold/15 text-gold" : "bg-deep-2/70 text-faint")}
          >
            {stepLabel(s)}
          </li>
        ),
      )}
    </ol>
  );
}

function CaseHeader({ state, big = false, children }: { state: CourtState; big?: boolean; children?: ReactNode }) {
  const left = useStepLeft(state);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className={cx("min-w-0 flex-1 font-display font-extrabold text-ivory", big ? "text-[clamp(22px,2.6vw,52px)] leading-tight" : "text-[20px] leading-8")}>
          <span aria-hidden="true">⚖️ </span>
          {state.case?.title}
        </h2>
        <Clock seconds={left} big={big} />
        {children}
      </div>
      <Steps state={state} big={big} />
    </div>
  );
}

function EvidenceGrid({ items, stage, big = false, compact = false }: { items: CourtEvidence[]; stage?: number; big?: boolean; compact?: boolean }) {
  if (!items.length) return null;
  return (
    <ul className={cx("grid gap-2", big ? "grid-cols-2 gap-[1vw] xl:grid-cols-3" : compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
      {items.map((e, i) => {
        const fresh = stage !== undefined && e.stage === stage;
        return (
          <li
            key={`${e.stage}-${i}`}
            className={cx(
              "rise flex gap-3 rounded-[18px] border p-3",
              big && "rounded-[1.4vw] p-[1.1vw]",
              fresh ? "border-gold/60 bg-gold/10" : "border-line bg-deep-2/50",
            )}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <span aria-hidden="true" className={cx("shrink-0 leading-none", big ? "text-[clamp(26px,2.8vw,56px)]" : "text-[26px]")}>
              {e.icon}
            </span>
            <span className="grid min-w-0 gap-1">
              <span className={cx("font-bold text-ivory", big ? "text-[clamp(16px,1.7vw,34px)]" : "text-[15px]")}>
                {e.title}
                {fresh && !big ? <span className="ms-2 rounded-full bg-gold/20 px-2 text-[11px] text-gold">جديد</span> : null}
              </span>
              <span className={cx("text-mist", big ? "text-[clamp(14px,1.45vw,30px)] leading-snug" : "text-[14px] leading-6")}>{e.text}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function CastGrid({ state, big = false, onPick, busy = false, briefs = true }: { state: CourtState; big?: boolean; onPick?: (id: string | null) => void; busy?: boolean; briefs?: boolean }) {
  const cast = [...(state.cast ?? [])].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const roles = cast.filter((c) => c.kind !== "juror");
  const jurors = cast.filter((c) => c.kind === "juror");
  return (
    <div className="grid gap-2">
      <ul className={cx("grid gap-2", big ? "grid-cols-3 gap-[0.8vw]" : "grid-cols-1 sm:grid-cols-2")}>
        {roles.map((c) => {
          const on = state.stand === c.player_id;
          const Tag = onPick ? "button" : "div";
          return (
            <li key={c.player_id}>
              <Tag
                {...(onPick ? { type: "button" as const, disabled: busy, onClick: () => onPick(on ? null : c.player_id), "aria-pressed": on } : {})}
                className={cx(
                  "flex w-full items-start gap-2.5 rounded-[16px] border p-2.5 text-start transition",
                  big && "rounded-[1.2vw] p-[0.8vw]",
                  on ? "border-gold bg-gold/15 shadow-glow-gold" : "border-line bg-deep-2/50",
                  onPick && !on && "hover:border-glow",
                )}
              >
                <span aria-hidden="true" className={cx("leading-none", big ? "text-[clamp(22px,2.2vw,44px)]" : "text-[22px]")}>
                  {KINDS[c.kind].icon}
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className={cx("font-bold text-ivory", big ? "text-[clamp(15px,1.5vw,30px)]" : "text-[15px]")}>
                    {c.name}
                    {on ? <span className="ms-2 text-gold">· على المنصة</span> : null}
                  </span>
                  <span className={cx("text-mist", big ? "text-[clamp(12px,1.15vw,22px)]" : "text-[12px]")}>
                    {c.kind === "witness" || c.kind === "detective" ? `${KINDS[c.kind].label} · ` : ""}
                    يلعبه <bdi className="text-ivory">{c.player_name}</bdi>
                  </span>
                  {c.brief && big && briefs ? <span className="text-[clamp(12px,1.1vw,20px)] text-faint">{c.brief}</span> : null}
                </span>
              </Tag>
            </li>
          );
        })}
      </ul>
      {jurors.length ? (
        <p className={cx("text-mist", big ? "text-[clamp(13px,1.3vw,26px)]" : "text-[13px]")}>
          🗳️ هيئة المحلفين: {jurors.map((j) => j.player_name).join("، ")}
        </p>
      ) : null}
    </div>
  );
}

function StandBanner({ state, big = false }: { state: CourtState; big?: boolean }) {
  const who = (state.cast ?? []).find((c) => c.player_id === state.stand);
  if (!who) return null;
  return (
    <div className={cx("rise flex items-center justify-center gap-3 rounded-[20px] border border-gold/60 bg-gold/10 p-3 text-center", big && "rounded-[1.6vw] p-[1.2vw]")}>
      <span aria-hidden="true" className={big ? "text-[clamp(28px,3vw,60px)]" : "text-[28px]"}>
        🎙️
      </span>
      <p className={cx("font-display font-extrabold text-ivory", big ? "text-[clamp(20px,2.4vw,48px)]" : "text-[19px]")}>
        على المنصة: {who.name} <span className="text-gold">({who.player_name})</span>
      </p>
    </div>
  );
}

function ObjectionFlash({ state, big = false }: { state: CourtState; big?: boolean }) {
  const at = state.objection?.at ? Date.parse(state.objection.at) : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [at]);
  if (!state.objection || !at || now - at > 6000) return null;
  return (
    <div role="status" className={cx("beat rounded-[20px] border-2 border-wrong bg-[#2b0f1d] p-3 text-center", big && "fixed inset-x-[12vw] top-[28vh] z-40 rounded-[2vw] p-[2.4vw] shadow-[0_30px_120px_#000c]")}>
      <p className={cx("font-display font-extrabold text-wrong", big ? "text-[clamp(48px,7vw,140px)] leading-none" : "text-[30px]")}>اعتراض!</p>
      <p className={cx("font-bold text-ivory", big ? "text-[clamp(18px,2vw,40px)]" : "text-[15px]")}>
        {KINDS[state.objection.kind]?.label}: {state.objection.name}
      </p>
    </div>
  );
}

function ClosingBanner({ state, big = false }: { state: CourtState; big?: boolean }) {
  const side = state.side ?? "prosecutor";
  const who = (state.cast ?? []).find((c) => c.kind === side);
  return (
    <div className={cx("grid justify-items-center gap-2 rounded-[24px] border border-gold/40 bg-night/60 p-5 text-center shadow-glow-gold", big && "p-[2.4vw]")}>
      <span aria-hidden="true" className={big ? "text-[clamp(40px,5vw,96px)]" : "text-[40px]"}>
        {KINDS[side].icon}
      </span>
      <p className={cx("font-display font-extrabold text-ivory", big ? "text-[clamp(28px,3.6vw,72px)]" : "text-[26px]")}>{side === "prosecutor" ? "مرافعة المدعي العام" : "مرافعة المحامي"}</p>
      {who ? <p className={cx("text-mist", big ? "text-[clamp(16px,1.8vw,34px)]" : "text-[15px]")}>يتكلم {who.player_name}، والباقون يستمعون.</p> : null}
    </div>
  );
}

function VerdictCard({ state, big = false }: { state: CourtState; big?: boolean }) {
  const v = state.verdict;
  if (!v) return null;
  const accused = (state.cast ?? []).find((c) => c.kind === "accused");
  return (
    <div
      className={cx(
        "rise grid justify-items-center gap-2 rounded-[28px] border-2 p-6 text-center",
        big && "p-[3vw]",
        v.guilty ? "border-wrong/70 bg-wrong-fill/15" : "border-correct/60 bg-correct-fill/15",
      )}
    >
      <p className={cx("text-mist", big ? "text-[clamp(16px,1.8vw,34px)]" : "text-[15px]")}>حكم هيئة المحلفين على {accused?.name ?? "المتهم"}</p>
      <p className={cx("font-display font-extrabold", big ? "text-[clamp(56px,8vw,160px)] leading-none" : "text-[46px] leading-[56px]", v.guilty ? "text-wrong" : "text-correct")}>
        {v.guilty ? "مذنب" : "بريء"}
      </p>
      <p dir="rtl" className={cx("font-bold text-ivory", big ? "text-[clamp(16px,1.8vw,34px)]" : "text-[15px]")}>
        مذنب {v.votes_guilty} · بريء {v.votes_innocent}
        {v.votes_guilty === v.votes_innocent ? " · التعادل لصالح المتهم" : ""}
      </p>
    </div>
  );
}

function TruthCard({ state, big = false }: { state: CourtState; big?: boolean }) {
  const t = state.truth;
  if (!t) return null;
  return (
    <div className={cx("grid gap-3 rounded-[24px] border border-gold/40 bg-night/60 p-5", big && "p-[2vw]")}>
      <p className={cx("font-display font-extrabold", big ? "text-[clamp(22px,2.6vw,52px)]" : "text-[20px]", t.correct ? "text-correct" : "text-wrong")}>
        {t.correct ? "⚖️ تحققت العدالة" : "⚠️ خطأ قضائي"}
        <span className={cx("ms-2 text-ivory", big ? "text-[clamp(16px,1.8vw,34px)]" : "text-[15px]")}>الحقيقة: المتهم {t.guilty ? "مذنب" : "بريء"}</span>
      </p>
      <p className={cx("leading-relaxed text-ivory", big ? "text-[clamp(16px,1.7vw,34px)]" : "text-[16px] leading-7")}>{t.text}</p>
    </div>
  );
}

function PointsTable({ state, big = false, meId }: { state: CourtState; big?: boolean; meId?: string | null }) {
  const rows = state.points ?? [];
  if (!rows.length) return null;
  return (
    <ol className={cx("grid gap-1.5", big && "grid-cols-2 gap-[0.6vw]")}>
      {rows.map((r, i) => (
        <li
          key={r.player_id}
          className={cx(
            "flex items-center gap-2 rounded-[14px] border px-3 py-2",
            big && "rounded-[1vw] px-[1vw] py-[0.6vw]",
            r.player_id === meId ? "border-gold/60 bg-gold/10" : "border-line bg-deep-2/50",
          )}
        >
          <span className={cx("w-6 shrink-0 text-center font-display font-bold text-mist tabular-nums", big && "w-[2vw] text-[clamp(14px,1.4vw,28px)]")}>{i + 1}</span>
          <span aria-hidden="true" className={big ? "text-[clamp(18px,1.8vw,36px)]" : "text-[18px]"}>
            {KINDS[r.kind]?.icon}
          </span>
          <span className="grid min-w-0 flex-1">
            <span className={cx("truncate font-bold text-ivory", big ? "text-[clamp(14px,1.45vw,30px)]" : "text-[15px]")}>{r.player_name}</span>
            <span className={cx("text-mist", big ? "truncate text-[clamp(11px,1vw,20px)]" : "text-[12px] leading-5")}>
              {r.kind === "juror" ? "محلّف" : r.name}
              {r.vote !== null ? ` · صوّت ${r.vote ? "مذنب" : "بريء"}` : ""}
              {r.why.length ? ` · ${r.why.join("، ")}` : ""}
            </span>
          </span>
          <span dir="ltr" className={cx("font-display font-extrabold tabular-nums", big ? "text-[clamp(18px,2vw,40px)]" : "text-[20px]", r.points ? "text-gold" : "text-faint")}>
            +{r.points}
          </span>
        </li>
      ))}
    </ol>
  );
}

function CardsReveal({ state, big = false }: { state: CourtState; big?: boolean }) {
  const cards = state.cards ?? [];
  if (!cards.length) return null;
  return (
    <details className={cx("surface rounded-[20px] p-4", big && "p-[1.4vw]")} open={big}>
      <summary className={cx("cursor-pointer font-bold text-ivory", big ? "text-[clamp(16px,1.6vw,32px)]" : "text-[15px]")}>🃏 كشف البطاقات</summary>
      <ul className={cx("mt-3 grid gap-2", big ? "grid-cols-3 gap-[0.8vw]" : "grid-cols-1")}>
        {cards.map((c, i) => (
          <li key={i} className={cx("rounded-[14px] border border-line bg-deep-2/50 p-3", big && "p-[0.8vw]")}>
            <p className={cx("font-bold text-ivory", big ? "text-[clamp(13px,1.3vw,26px)]" : "text-[14px]")}>
              {KINDS[c.kind]?.icon} {c.name} <span className="font-normal text-mist">({c.player_name})</span>
            </p>
            <p className={cx("mt-1 text-mist", big ? "text-[clamp(11px,1vw,20px)] leading-snug" : "text-[13px] leading-6")}>{c.secret}</p>
            {c.later ? <p className={cx("mt-1 text-gold", big ? "text-[clamp(11px,1vw,20px)]" : "text-[13px] leading-6")}>لاحقًا: {c.later}</p> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function courtShare(state: CourtState): ShareResult {
  const rows = (state.points ?? []).slice(0, 8);
  const v = state.verdict;
  return {
    slug: "court",
    title: "⚖️ المحكمة",
    headline: state.truth ? (state.truth.correct ? "تحققت العدالة" : "خطأ قضائي") : "المحكمة",
    sub: `${state.case?.title ?? ""}${v ? ` · الحكم: ${v.guilty ? "مذنب" : "بريء"}` : ""}`,
    rows: rows.map((r) => ({ name: `${KINDS[r.kind]?.icon ?? ""} ${r.player_name}`, value: `+${r.points}` })),
  };
}

/** The player's role card. Hidden by default so neighbours do not read it. */
function RoleCard({ card, open, onToggle }: { card: MyCard; open: boolean; onToggle: () => void }) {
  if (!card.kind) return null;
  const k = KINDS[card.kind];
  return (
    <div className="grid gap-3 rounded-[24px] border border-gold/50 bg-[linear-gradient(160deg,#3a2210cc,#140c2bcc)] p-5 shadow-glow-gold">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="text-[36px] leading-none">
          {k.icon}
        </span>
        <div className="grid min-w-0 flex-1">
          <span className="text-[13px] font-semibold text-gold">{card.name === (card.kind_ar ?? k.label) ? "دورك" : `دورك: ${card.kind_ar ?? k.label}`}</span>
          <span className="font-display text-[21px] leading-8 font-extrabold text-ivory">{card.name}</span>
        </div>
        <Button tone="quiet" className="min-h-10 px-3" onClick={onToggle} aria-expanded={open}>
          <Glyph name={open ? "lock" : "info"} className="size-[18px]" />
          {open ? "أخفِ" : "اعرض بطاقتي"}
        </Button>
      </div>
      {open ? (
        <>
          {card.brief ? <p className="text-[14px] text-mist">{card.brief}</p> : null}
          <div className="rounded-[16px] border border-line-strong/60 bg-night/60 p-3">
            <p className="mb-1 text-[12px] font-bold text-gold">🔒 سري، لك وحدك</p>
            <p className="text-[16px] leading-7 text-ivory">{card.secret}</p>
          </div>
          {card.later ? (
            <div className="rise rounded-[16px] border border-gold/60 bg-gold/10 p-3">
              <p className="mb-1 text-[12px] font-bold text-gold">✉️ معلومة جديدة وصلتك</p>
              <p className="text-[16px] leading-7 text-ivory">{card.later}</p>
            </div>
          ) : card.later_pending ? (
            <p className="text-[13px] text-mist">✉️ ستصلك معلومة إضافية في جولة لاحقة.</p>
          ) : null}
          <p className="text-[13px] leading-6 text-mist">🎯 {k.goal}</p>
        </>
      ) : (
        <p className="text-[13px] text-mist">اضغط «اعرض بطاقتي» وأنت بعيد عن أعين الباقين.</p>
      )}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="surface rounded-[18px] p-4 text-center text-[15px] leading-7 text-mist">{children}</p>;
}

/** What a player should be doing now, by role. */
function Hint({ state, kind }: { state: CourtState; kind?: CourtKind }) {
  const p = state.phase;
  let text = "";
  if (p === "intro") text = "اقرأ القضية على الشاشة وبطاقتك في جوالك. لا تكشف معلوماتك السرية إلا حين يفيدك ذلك.";
  else if (p === "evidence") text = "أدلة جديدة على الشاشة. هل تؤكد شهادة أحد أو تناقضها؟";
  else if (p === "question")
    text =
      kind === "accused" || kind === "witness"
        ? "قد تُستدعى للمنصة. أجب بما تعرفه حسب بطاقتك."
        : kind === "prosecutor" || kind === "lawyer"
          ? "اسأل المتهم والشهود، وابحث عن التناقض بين الأقوال والأدلة."
          : "اسأل من تشاء. المضيف يستدعي من يقف على المنصة.";
  else if (p === "closing") {
    const mine = (state.side === "prosecutor" && kind === "prosecutor") || (state.side === "lawyer" && kind === "lawyer");
    text = mine ? "دورك الآن! لخّص حجتك أمام المحلفين قبل نهاية الوقت." : "استمع للمرافعة، ولا تقاطع.";
  }
  if (!text) return null;
  return <p className="rounded-[16px] bg-deep-2/60 p-3 text-center text-[14px] leading-6 text-ivory">{text}</p>;
}

function useRun(roomId: string, reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (fn: string, args: Record<string, unknown> = {}) => {
      if (!supabase) return false;
      setBusy(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc(fn, { p_room_id: roomId, ...args });
      setBusy(false);
      if (rpcError) {
        const missing = rpcError.code === "PGRST202" || rpcError.code === "42883";
        setError(missing ? SETUP_HINT : "تعذّر تنفيذ الخطوة، حاول مرة أخرى.");
        return false;
      }
      const res = data as { ok: boolean; reason?: string; min?: number };
      if (!res?.ok) {
        setError((ERRORS[res?.reason ?? ""] ?? "تعذّر تنفيذ الخطوة.") + (res?.min ? ` (${res.min} على الأقل)` : ""));
        return false;
      }
      await reload();
      return true;
    },
    [roomId, reload],
  );
  return { run, busy, error, setError };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-center justify-center gap-1.5 text-center text-[14px] font-semibold text-wrong">
      <Glyph name="alert" className="size-4 shrink-0" />
      {error}
    </p>
  );
}

/** Vote buttons and the objection button: the player's actions for the current phase. */
function Actions({ roomId, state, card, reloadCard }: { roomId: string; state: CourtState; card: MyCard | null; reloadCard: () => Promise<void> }) {
  const { run, busy, error } = useRun(roomId, reloadCard);
  if (!card?.kind) return null;
  const canObject = (card.kind === "prosecutor" || card.kind === "lawyer") && (state.phase === "question" || state.phase === "closing");
  return (
    <div className="grid gap-3">
      {state.phase === "vote" ? (
        card.kind === "accused" ? (
          <Note>المحلفون يصوّتون الآن على مصيرك… ({state.votes_count ?? 0} من {state.voters_count ?? 0})</Note>
        ) : (
          <div className="grid gap-2 rounded-[22px] border border-gold/40 bg-night/60 p-4">
            <p className="text-center text-[17px] font-bold text-ivory">حكمك على المتهم؟</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={busy}
                aria-pressed={card.vote === true}
                onClick={() => run("court_vote", { p_guilty: true })}
                className={cx(
                  "min-h-16 rounded-[18px] border-2 font-display text-[22px] font-extrabold transition",
                  card.vote === true ? "border-wrong bg-wrong-fill/30 text-wrong" : "border-line-strong/70 bg-deep-2/60 text-ivory hover:border-wrong/70",
                )}
              >
                مذنب
              </button>
              <button
                type="button"
                disabled={busy}
                aria-pressed={card.vote === false}
                onClick={() => run("court_vote", { p_guilty: false })}
                className={cx(
                  "min-h-16 rounded-[18px] border-2 font-display text-[22px] font-extrabold transition",
                  card.vote === false ? "border-correct bg-correct-fill/30 text-correct" : "border-line-strong/70 bg-deep-2/60 text-ivory hover:border-correct/70",
                )}
              >
                بريء
              </button>
            </div>
            <p className="text-center text-[13px] text-mist">
              {card.vote === null || card.vote === undefined ? "صوتك سري حتى النهاية." : "وصل صوتك. تقدر تغيّره حتى يُعلن الحكم."} صوّت {state.votes_count ?? 0} من {state.voters_count ?? 0}.
            </p>
          </div>
        )
      ) : null}
      {canObject ? (
        <Button tone="danger" className="min-h-14 text-[18px]" disabled={busy || (card.objections_left ?? 0) <= 0} onClick={() => run("court_object")}>
          ✋ اعتراض! <span className="text-[13px] opacity-80">({card.objections_left ?? 0} باقي)</span>
        </Button>
      ) : null}
      <ErrorLine error={error} />
    </div>
  );
}

/** Everything after the start, for a phone: the host's (when the host plays) and the players'. */
function PlayView({ roomId, state, meId, card, reloadCard }: { roomId: string; state: CourtState; meId: string | null; card: MyCard | null; reloadCard: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  // The card opens by itself at the start, and when new information arrives.
  const laterSeen = useRef<string | null>(null);
  useEffect(() => {
    if (state.phase === "intro") setOpen(true);
  }, [state.phase]);
  useEffect(() => {
    if (card?.later && card.later !== laterSeen.current) {
      laterSeen.current = card.later;
      setOpen(true);
      vibrate([100, 60, 100]);
    }
  }, [card?.later]);
  const over = state.phase === "over";
  return (
    <div className="grid gap-4">
      {card?.started && !over ? <RoleCard card={card} open={open} onToggle={() => setOpen((v) => !v)} /> : null}
      <ObjectionFlash state={state} />
      {state.phase === "verdict" ? <VerdictCard state={state} /> : null}
      {over ? (
        <>
          <VerdictCard state={state} />
          <TruthCard state={state} />
          <PointsTable state={state} meId={meId} />
          <CardsReveal state={state} />
        </>
      ) : null}
      {!over ? <Hint state={state} kind={card?.kind} /> : null}
      {state.phase === "question" ? <StandBanner state={state} /> : null}
      {state.phase === "closing" ? <ClosingBanner state={state} /> : null}
      <Actions roomId={roomId} state={state} card={card} reloadCard={reloadCard} />
      {state.phase === "intro" ? (
        <div className="surface grid gap-2 rounded-[20px] p-4">
          <p className="text-[13px] font-bold text-gold">القضية</p>
          <p className="text-[15px] leading-7 text-ivory">{state.case?.intro}</p>
        </div>
      ) : null}
      {!over && (state.evidence ?? []).length ? (
        <section className="grid gap-2">
          <h3 className="text-[15px] font-bold text-ivory">📁 الأدلة</h3>
          <EvidenceGrid items={state.evidence ?? []} stage={state.phase === "evidence" ? state.stage : undefined} compact />
        </section>
      ) : null}
      {!over ? (
        <details className="surface rounded-[20px] p-4">
          <summary className="cursor-pointer text-[15px] font-semibold text-ivory">أطراف القضية</summary>
          <div className="mt-3">
            <CastGrid state={state} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

/* ---------------- Host ---------------- */

type CaseItem = { id: string; title: string; category: string | null; difficulty: number; summary: string; min: number; roles: number };
const LEVEL = ["", "سهلة", "متوسطة", "صعبة"];

export function CourtHostPanel({ roomId }: { roomId: string }) {
  const { state, players, reload } = useCourtLive(roomId);
  const { card, reload: reloadCard } = useMyCard(roomId, state);
  const { run, busy, error } = useRun(roomId, reload);
  useCourtCues(state, { sound: true });
  const me = players.find((p) => p.is_host) ?? null;

  if (!isCourt(state) || !state.phase) return <CourtSetup state={state} players={players} busy={busy} error={error} onStart={(settings) => run("court_start", { p_settings: settings })} />;

  const steps = state.steps ?? [];
  const step = state.step ?? 0;
  const next = steps[step + 1];
  const over = state.phase === "over";
  return (
    <section className="mx-auto mt-2 grid max-w-3xl gap-4">
      <div className="surface grid gap-3 rounded-[24px] p-4">
        <CaseHeader state={state} />
        {!over ? (
          <Button tone="primary" className="min-h-14 text-[18px]" disabled={busy} onClick={() => run("court_next", { p_step: step })}>
            {nextAction(next)}
            <Glyph name="forward" />
          </Button>
        ) : null}
        {state.phase === "vote" ? (
          <p className="text-center text-[14px] text-mist">
            صوّت {state.votes_count ?? 0} من {state.voters_count ?? 0}. أعلن الحكم متى شئت: من لم يصوّت لا يُحسب.
          </p>
        ) : null}
        <ErrorLine error={error} />
      </div>

      {state.phase === "question" ? (
        <div className="surface grid gap-3 rounded-[24px] p-4">
          <p className="text-[15px] font-bold text-ivory">🎙️ من على المنصة؟ <span className="text-[13px] font-normal text-mist">اضغط اسمًا ليظهر على الشاشة، واضغطه مرة ثانية لإنزاله.</span></p>
          <CastGrid state={state} onPick={(id) => void run("court_stand", { p_player_id: id })} busy={busy} />
        </div>
      ) : null}

      {card?.started ? (
        <PlayView roomId={roomId} state={state} meId={me?.id ?? null} card={card} reloadCard={reloadCard} />
      ) : (
        <>
          <ObjectionFlash state={state} />
          {state.phase === "closing" ? <ClosingBanner state={state} /> : null}
          {state.phase === "verdict" || over ? <VerdictCard state={state} /> : null}
          {over ? (
            <>
              <TruthCard state={state} />
              <PointsTable state={state} />
              <CardsReveal state={state} />
            </>
          ) : null}
          {state.phase === "intro" ? <Note>{state.case?.intro}</Note> : null}
          {!over && (state.evidence ?? []).length ? <EvidenceGrid items={state.evidence ?? []} stage={state.phase === "evidence" ? state.stage : undefined} /> : null}
          {state.phase !== "question" && !over ? <CastGrid state={state} /> : null}
        </>
      )}

      {over ? (
        <>
          <ResultShare result={courtShare(state)} fileName="al3sh-court.png" />
          <Button tone="primary" className="min-h-14 text-[17px]" disabled={busy} onClick={() => run("court_reset")}>
            <Glyph name="refresh" />
            قضية جديدة بنفس اللاعبين
          </Button>
        </>
      ) : null}
    </section>
  );
}

function CourtSetup({
  state,
  players,
  busy,
  error,
  onStart,
}: {
  state: CourtState;
  players: Player[];
  busy: boolean;
  error: string | null;
  onStart: (settings: CourtSettings) => Promise<boolean>;
}) {
  const last = state.last_settings ?? null;
  const [cases, setCases] = useState<CaseItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [hostPlays, setHostPlays] = useState(last?.host_plays ?? true);
  const [q, setQ] = useState(last?.question_seconds ?? 180);
  const [c, setC] = useState(last?.closing_seconds ?? 60);
  const [v, setV] = useState(last?.vote_seconds ?? 60);
  const used = new Set(last?.used_cases ?? []);

  useEffect(() => {
    if (!supabase) return;
    supabase.rpc("court_cases_list").then(({ data, error: e }) => {
      if (e) setLoadError(e.code === "PGRST202" || e.code === "42883" ? SETUP_HINT : "تعذّر تحميل القضايا.");
      else setCases((data ?? []) as CaseItem[]);
    });
  }, []);

  const n = players.filter((p) => hostPlays || !p.is_host).length;
  const picked = cases?.find((x) => x.id === caseId) ?? null;
  const fits = (cases ?? []).filter((x) => x.min <= n);
  const ready = n >= 4 && n <= 12 && (picked ? picked.min <= n : fits.length > 0);

  return (
    <section className="mx-auto mt-2 grid max-w-3xl gap-4">
      <div className="surface grid gap-3 rounded-[24px] p-5">
        <h2 className="text-[20px] leading-8">⚖️ جلسة جديدة</h2>
        <p className="text-[14px] leading-6 text-mist">
          في الجلسة {n} {n >= 3 && n <= 10 ? "لاعبين" : "لاعبًا"}. يأخذ كل لاعب دورًا: المتهم والمدعي والمحامي أولًا، ثم الشهود والمحقق، والباقي محلّفون. تحتاجون 4 إلى 12 لاعبًا.
        </p>
        <Choice
          label="المضيف"
          value={hostPlays ? "play" : "judge"}
          onChange={(x) => setHostPlays(x === "play")}
          options={[
            { value: "play", label: "يلعب دورًا ويدير الجلسة" },
            { value: "judge", label: "يدير الجلسة فقط" },
          ]}
        />
      </div>

      <div className="surface grid gap-3 rounded-[24px] p-5">
        <h2 className="text-[18px] leading-7">القضية</h2>
        {loadError ? <p className="text-[14px] text-wrong">{loadError}</p> : null}
        {cases === null && !loadError ? <p className="text-[14px] text-mist">جارٍ تحميل القضايا…</p> : null}
        <ul className="grid gap-2">
          <li>
            <CaseOption on={caseId === null} onClick={() => setCaseId(null)} title="🎲 قضية عشوائية" sub={`تُختار قضية تناسب عددكم${used.size ? "، ولم تلعبوها في هذه الغرفة" : ""}.`} />
          </li>
          {(cases ?? []).map((x) => (
            <li key={x.id}>
              <CaseOption
                on={caseId === x.id}
                disabled={x.min > n}
                onClick={() => setCaseId(x.id)}
                title={x.title}
                sub={`${x.summary}${x.summary ? " · " : ""}${LEVEL[x.difficulty] ?? ""}${x.min > 4 ? ` · ${x.min} لاعبين على الأقل` : ""}${used.has(x.id) ? " · لُعبت" : ""}`}
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="surface grid gap-4 rounded-[24px] p-5">
        <h2 className="text-[18px] leading-7">المؤقتات</h2>
        <Choice label="الاستجواب (لكل جولة)" value={String(q)} onChange={(x) => setQ(Number(x))} options={[{ value: "0", label: "بدون" }, { value: "120", label: "2 د" }, { value: "180", label: "3 د" }, { value: "300", label: "5 د" }]} />
        <Choice label="المرافعة (لكل طرف)" value={String(c)} onChange={(x) => setC(Number(x))} options={[{ value: "0", label: "بدون" }, { value: "45", label: "45 ث" }, { value: "60", label: "دقيقة" }, { value: "90", label: "90 ث" }]} />
        <Choice label="التصويت" value={String(v)} onChange={(x) => setV(Number(x))} options={[{ value: "0", label: "بدون" }, { value: "30", label: "30 ث" }, { value: "60", label: "دقيقة" }, { value: "90", label: "90 ث" }]} />
        <p className="text-[13px] text-mist">المؤقت يظهر للجميع، وأنت تنتقل للمرحلة التالية بزر واحد متى شئت.</p>
      </div>

      <ErrorLine error={error} />
      <Button
        tone="primary"
        className="min-h-14 text-[18px]"
        disabled={!ready || busy}
        onClick={() => onStart({ case_id: caseId, host_plays: hostPlays, question_seconds: q, closing_seconds: c, vote_seconds: v })}
      >
        {busy ? "نوزّع الأدوار…" : "افتح الجلسة ووزّع الأدوار"}
      </Button>
      {!ready ? <p className="text-center text-[13px] text-mist">{n < 4 ? "تحتاجون 4 لاعبين على الأقل." : n > 12 ? "الحد الأقصى 12 لاعبًا." : "لا توجد قضية تناسب هذا العدد."}</p> : null}
    </section>
  );
}

function CaseOption({ on, disabled = false, onClick, title, sub }: { on: boolean; disabled?: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "grid w-full gap-0.5 rounded-[16px] border p-3 text-start transition disabled:opacity-40",
        on ? "border-gold bg-gold/10 shadow-[0_0_0_2px_#ffa53a33]" : "border-line bg-deep-2/50 hover:border-glow",
      )}
    >
      <span className="text-[16px] font-bold text-ivory">{title}</span>
      <span className="text-[13px] leading-5 text-mist">{sub}</span>
    </button>
  );
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[14px] font-semibold text-ivory">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx("min-h-11 rounded-full border px-4 text-[15px] font-semibold transition", value === o.value ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/60 text-mist hover:text-ivory")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Player ---------------- */

export function CourtPlayerPanel({ roomId, meId }: { roomId: string; meId: string | null }) {
  const { state } = useCourtLive(roomId);
  const { card, reload: reloadCard } = useMyCard(roomId, state);
  useCourtCues(state, { vibe: true });

  if (!isCourt(state) || !state.phase) return <Note>المضيف يجهّز الجلسة ويختار القضية. ستصلك بطاقة دورك هنا.</Note>;
  if (card && !card.started && card.late && state.phase !== "over") return <Note>دخلت بعد توزيع الأدوار، فتابع هذه القضية من الشاشة الكبيرة. ستدخل القضية القادمة.</Note>;
  return (
    <section className="grid gap-4">
      <div className="surface rounded-[22px] p-4">
        <CaseHeader state={state} />
      </div>
      <PlayView roomId={roomId} state={state} meId={meId} card={card} reloadCard={reloadCard} />
      {state.phase === "over" ? <ResultShare result={courtShare(state)} fileName="al3sh-court.png" /> : null}
    </section>
  );
}

/* ---------------- TV ---------------- */

export function CourtTv({ roomId }: { roomId: string }) {
  const { state, players } = useCourtLive(roomId);
  useCourtCues(state, { sound: true });
  if (!isCourt(state) || !state.phase) {
    return (
      <div className="grid justify-items-center gap-[2vw] text-center">
        <span aria-hidden="true" className="text-[clamp(56px,8vw,160px)] leading-none">
          ⚖️
        </span>
        <p className="font-display text-[clamp(24px,3vw,56px)] font-extrabold text-ivory">المحكمة تستعد… المضيف يختار القضية</p>
        <p className="text-[clamp(16px,1.6vw,30px)] text-mist">في القاعة: {players.map((p) => p.player_name).join("، ")}</p>
      </div>
    );
  }
  const p = state.phase;
  return (
    <div className="grid gap-[1.4vw]">
      <CaseHeader state={state} big />
      <ObjectionFlash state={state} big />
      {p === "intro" ? (
        <>
          <p className="rise rounded-[1.6vw] border border-gold/40 bg-night/60 p-[1.6vw] text-[clamp(18px,2vw,40px)] leading-relaxed text-ivory">{state.case?.intro}</p>
          <CastGrid state={state} big />
          <p className="text-center text-[clamp(14px,1.4vw,28px)] text-mist">📱 كل لاعب يقرأ بطاقته السرية في جواله.</p>
        </>
      ) : null}
      {p === "evidence" ? (
        <>
          <p className="text-center font-display text-[clamp(22px,2.6vw,52px)] font-extrabold text-gold">📁 أدلة الجولة {state.stage}</p>
          <EvidenceGrid items={(state.evidence ?? []).filter((e) => e.stage === state.stage)} big />
          {(state.stage ?? 1) > 1 ? (
            <details className="text-[clamp(13px,1.2vw,24px)] text-mist">
              <summary>الأدلة السابقة</summary>
              <EvidenceGrid items={(state.evidence ?? []).filter((e) => e.stage !== state.stage)} big />
            </details>
          ) : null}
        </>
      ) : null}
      {p === "question" ? (
        <>
          <p className="text-center font-display text-[clamp(22px,2.6vw,52px)] font-extrabold text-ivory">🎙️ الاستجواب: اسألوا المتهم والشهود</p>
          <StandBanner state={state} big />
          <EvidenceGrid items={state.evidence ?? []} big />
          <CastGrid state={state} big briefs={false} />
        </>
      ) : null}
      {p === "closing" ? (
        <>
          <ClosingBanner state={state} big />
          <EvidenceGrid items={state.evidence ?? []} big />
        </>
      ) : null}
      {p === "vote" ? (
        <div className="grid justify-items-center gap-[1.4vw] text-center">
          <span aria-hidden="true" className="text-[clamp(56px,7vw,140px)] leading-none">
            🗳️
          </span>
          <p className="font-display text-[clamp(30px,4vw,80px)] font-extrabold text-ivory">المحلفون يصوّتون: مذنب أم بريء؟</p>
          <p dir="ltr" className="font-display text-[clamp(28px,3.4vw,68px)] font-extrabold tabular-nums text-gold">
            {state.votes_count ?? 0} / {state.voters_count ?? 0}
          </p>
          <p className="text-[clamp(14px,1.4vw,28px)] text-mist">الأصوات سرية حتى إعلان الحكم.</p>
        </div>
      ) : null}
      {p === "verdict" ? <VerdictCard state={state} big /> : null}
      {p === "over" ? (
        <>
          <div className="grid grid-cols-[1fr_1.4fr] items-start gap-[1.4vw]">
            <VerdictCard state={state} big />
            <TruthCard state={state} big />
          </div>
          <PointsTable state={state} big />
          <CardsReveal state={state} big />
        </>
      ) : null}
    </div>
  );
}
