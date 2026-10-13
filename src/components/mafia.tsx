import { useEffect, useRef, useState } from "react";
import { FeedbackButton } from "@/components/feedback";
import { Glyph } from "@/components/brand";
import { buttonBase, buttonTone, cx } from "@/components/ui";
import { playCue } from "@/lib/sfx";
import { supabase } from "@/lib/supabase";

/**
 * «المافيا»: shared pieces for the host, player and TV screens.
 * The rules live in the database (supabase/mafia_v2.sql + mafia_v3.sql).
 */

export type MafiaSettings = {
  mafia?: number;
  auto_mafia?: boolean;
  reveal_roles?: boolean;
  day_seconds?: number;
  jester?: boolean;
  mayor?: boolean;
  bodyguard?: boolean;
  sniper?: boolean;
  seer?: boolean;
  spy?: boolean;
  vote_seconds?: number;
  narrator?: "host" | "random";
  lovers?: boolean;
  dead_see_roles?: boolean;
};
export type MafiaVote = { voter: string; target: string; weight: number; auto?: boolean };
/** What everyone sees after a vote: how many votes each player got, without who cast them. */
export type MafiaTally = { target: string; votes: number };
export type MafiaLogEntry = { round: number; type: "night" | "vote" | "shot"; text: string; votes?: MafiaVote[]; tally?: MafiaTally[] };
export type MafiaPublicState = {
  phase?: string;
  round?: number;
  winner?: string | null;
  last_result?: string | null;
  runoff?: string[] | null;
  settings?: MafiaSettings;
  mayor?: string | null;
  last_votes?: MafiaVote[] | null;
  last_tally?: MafiaTally[] | null;
  day_ends_at?: string | null;
  vote_ends_at?: string | null;
  narrator_id?: string | null;
  narrator_name?: string | null;
  log?: MafiaLogEntry[];
  last_shot?: { text: string; at: string } | null;
  last_settings?: MafiaSettings | null;
};
export type MafiaPlayerRow = { player_id: string; player_name: string; alive: boolean; player_role: string | null; is_mayor?: boolean };

export const ROLE_NAMES: Record<string, string> = {
  mafia: "مافيا",
  citizen: "مواطن",
  doctor: "طبيب",
  detective: "محقق",
  jester: "مهرّج",
  mayor: "العمدة",
  bodyguard: "حارس",
  sniper: "قنّاص",
  seer: "عرّافة",
  spy: "جاسوس",
};
export const ROLE_ICONS: Record<string, string> = {
  mafia: "🔪",
  citizen: "🙂",
  doctor: "🩺",
  detective: "🔍",
  jester: "🃏",
  mayor: "👑",
  bodyguard: "🛡️",
  sniper: "🎯",
  seer: "🔮",
  spy: "🕶️",
};
export const ROLE_HINTS: Record<string, string> = {
  mafia: "كل ليلة اتفقوا مع زملائكم على ضحية. ترون اختيارات بعض هنا. نهارًا لا تكشفوا أنفسكم.",
  citizen: "استمعوا للنقاش وصوّتوا لإقصاء المافيا.",
  doctor: "كل ليلة احموا لاعبًا. لا تحموا نفس اللاعب ليلتين متتاليتين، وتحمون أنفسكم مرة واحدة فقط.",
  detective: "كل ليلة تحققوا من لاعب واحد. النتيجة تظهر بعد انتهاء الليل.",
  jester: "أنت المهرّج: تفوز وحدك إذا أقصوك بالتصويت. خلّهم يشكّون فيك… بدون ما تكشف نفسك.",
  mayor: "الكل يعرف أنك العمدة، وصوتك بصوتين. انتبه: المافيا تعرفك أيضًا.",
  bodyguard: "كل ليلة احرس لاعبًا. إذا هاجمته المافيا تموت أنت بدلًا منه.",
  sniper: "معك رصاصة واحدة في المباراة، تطلقها في النهار على من تشكّ فيه. لا يعرف أحد من أطلقها.",
  seer: "مرة واحدة في المباراة تعرف دور لاعب خرج من اللعبة. استخدمها في الوقت المناسب.",
  spy: "أنت حليف المافيا: تعرفهم ويعرفونك، لكنك لا تختار ضحية. نهارًا ضلّل المواطنين، ولو ادّعيت أنك مافيا.",
};

/**
 * The full role card shown when roles are dealt: which side, what the role does,
 * when it acts, and how it wins. Every role has one.
 */
export const ROLE_INFO: Record<string, { team: string; does: string; when: string; wins: string }> = {
  mafia: {
    team: "المافيا",
    does: "تختارون مع زملائكم ضحية كل ليلة. ترون اختيارات بعضكم، والضحية من يختاره أكثركم.",
    when: "في الليل من جوالك، وفي النهار تتظاهر أنك مواطن.",
    wins: "تفوز المافيا إذا صار عددها (مع الجاسوس) مساويًا لعدد الباقين.",
  },
  citizen: {
    team: "المواطنون",
    does: "لا قدرة خاصة لك، لكن صوتك هو سلاح المواطنين.",
    when: "في النهار: ناقش واتّهم وصوّت.",
    wins: "يفوز المواطنون إذا أُقصيت المافيا كلها.",
  },
  doctor: {
    team: "المواطنون",
    does: "تحمي لاعبًا من القتل كل ليلة. لا تحمي نفس اللاعب ليلتين متتاليتين، وتحمي نفسك مرة واحدة فقط.",
    when: "كل ليلة من جوالك.",
    wins: "مع المواطنين.",
  },
  detective: {
    team: "المواطنون",
    does: "تحقق من لاعب واحد كل ليلة: هل هو مافيا أم لا. النتيجة تظهر لك وحدك بعد انتهاء الليل.",
    when: "كل ليلة من جوالك. انتبه: الجاسوس يظهر لك «ليس مافيا».",
    wins: "مع المواطنين.",
  },
  jester: {
    team: "وحدك",
    does: "هدفك أن يقصيك اللاعبون بالتصويت. تصرّف بطريقة تثير الشك… بدون أن تكشف أنك المهرّج.",
    when: "في النهار أثناء النقاش.",
    wins: "تفوز وحدك إذا أُقصيت بالتصويت (لا يكفي أن تُقتل ليلًا).",
  },
  mayor: {
    team: "المواطنون",
    does: "الجميع يعرف أنك العمدة، وصوتك في التصويت يُحسب بصوتين.",
    when: "في التصويت. انتبه: المافيا تعرفك أيضًا.",
    wins: "مع المواطنين.",
  },
  bodyguard: {
    team: "المواطنون",
    does: "تحرس لاعبًا كل ليلة. إذا هاجمته المافيا تموت أنت بدلًا منه وينجو هو.",
    when: "كل ليلة من جوالك.",
    wins: "مع المواطنين.",
  },
  sniper: {
    team: "المواطنون",
    does: "معك رصاصة واحدة في المباراة كلها، تقتل بها من تشكّ فيه. لا يعرف أحد من أطلقها.",
    when: "في النهار فقط، من جوالك وفي أي لحظة.",
    wins: "مع المواطنين. اختر جيدًا: إن أصبت مواطنًا خسر فريقك لاعبًا.",
  },
  seer: {
    team: "المواطنون",
    does: "مرة واحدة في المباراة تكشف الدور الحقيقي للاعب خرج من اللعبة (قُتل أو أُقصي).",
    when: "بعد أن يخرج أحد، في أي وقت من جوالك.",
    wins: "مع المواطنين.",
  },
  spy: {
    team: "المافيا (حليف)",
    does: "تفتح عينك مع المافيا: تعرفهم ويعرفونك، لكنك لا تختار ضحية معهم. مهمتك التضليل في النهار، حتى لو ادّعيت أنك أنت المافيا.",
    when: "في الليل ترى المافيا في جوالك، وفي النهار تناقش وتصوّت.",
    wins: "تفوز مع المافيا. المحقق يراك «ليس مافيا»، والمافيا لا تستطيع قتلك.",
  },
};

/** The lovers are not a role: two citizens tied together. */
export const LOVERS_INFO = "أنتما العاشقان، وكلاكما من المواطنين. إذا مات أحدكما (قتلًا أو إقصاءً أو برصاصة) مات الآخر حزنًا. احمِ عاشقك في النقاش بدون أن تكشفكما.";

export const WINNERS: Record<string, string> = {
  mafia: "فازت المافيا",
  citizens: "فاز المواطنون",
  jester: "فاز المهرّج!",
};

/** Seconds until a timestamp, ticking. */
export function useCountdown(until: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [until]);
  if (!until) return null;
  const end = Date.parse(until.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(end) ? null : Math.max(0, Math.ceil((end - now) / 1000));
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** What the narrator says at each moment: shown to the host to read out, spoken by the TV when the voice is on. */
export function narratorLine(state: MafiaPublicState, rows: MafiaPlayerRow[]) {
  const phase = state.phase ?? "";
  const s = state.settings ?? {};
  if (phase === "") return "مرحبًا بكم في المافيا. ستصل أدواركم على جوالاتكم؛ احفظوها سرًّا ولا تُروها لأحد.";
  if (phase === "night") {
    const parts = [
      state.round && state.round > 1 ? "حلّ الليل من جديد… أغمضوا أعينكم جميعًا." : "حلّ الليل… أغمضوا أعينكم جميعًا.",
      // The spy meets the mafia on the first night only.
      s.spy && (state.round ?? 1) <= 1
        ? "المافيا والجاسوس: افتحوا أعينكم وتعرّفوا على بعض. المافيا تختار ضحيتها من الجوال."
        : "المافيا: افتحوا جوالاتكم بهدوء واختاروا ضحيتكم.",
      "الطبيب: من تحمي الليلة؟",
      "المحقق: من تشكّ فيه؟",
    ];
    if (s.bodyguard) parts.push("الحارس: من تحرس؟");
    return parts.join(" ");
  }
  if (phase === "day") {
    const night = [...(state.log ?? [])].reverse().find((l) => l.type === "night")?.text ?? (state.last_shot ? "" : (state.last_result ?? ""));
    return `طلع الصباح… افتحوا أعينكم. ${night} والآن ناقشوا: من بينكم المافيا؟`;
  }
  if (phase === "vote") {
    if (Array.isArray(state.runoff)) {
      const names = rows.filter((r) => state.runoff?.includes(r.player_id)).map((r) => r.player_name).join(" و");
      return `تعادل! أعيدوا التصويت بين ${names} فقط.`;
    }
    return "انتهى النقاش. صوّتوا من جوالاتكم لإقصاء من تظنونه من المافيا.";
  }
  if (phase === "over") return `انتهت اللعبة. ${WINNERS[state.winner ?? ""] ?? ""}`;
  return "";
}

const VOICE_KEY = "alosh-mafia-voice";
export function voicePreference() {
  try {
    return localStorage.getItem(VOICE_KEY) === "1";
  } catch {
    return false;
  }
}
export function setVoicePreference(on: boolean) {
  try {
    localStorage.setItem(VOICE_KEY, on ? "1" : "0");
  } catch {
    // Storage blocked: kept for this visit.
  }
}

/** Speaks Arabic text with the device voice, if it has one. */
export function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth || !text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ar-SA";
    const voice = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith("ar"));
    if (voice) u.voice = voice;
    u.rate = 0.92;
    synth.speak(u);
  } catch {
    // No speech on this device.
  }
}

/** Sounds (and the narrator's voice) on each change of phase. For the TV. */
export function useMafiaCues(state: MafiaPublicState, rows: MafiaPlayerRow[], voice: boolean) {
  const last = useRef("");
  useEffect(() => {
    const key = `${state.round ?? 0}:${state.phase ?? ""}:${Array.isArray(state.runoff) ? "r" : ""}`;
    if (!last.current) {
      last.current = key;
      return;
    }
    if (key === last.current) return;
    last.current = key;
    const phase = state.phase ?? "";
    if (phase === "night") playCue(state.round && state.round > 1 ? "gavel" : "night");
    else if (phase === "day") playCue("day");
    else if (phase === "vote") playCue("round");
    else if (phase === "over") playCue("victory");
    if (voice) window.setTimeout(() => speak(narratorLine(state, rows)), phase === "night" && (state.round ?? 1) > 1 ? 1600 : 700);
    // Only a new phase, round or runoff cues a sound.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.round, state.runoff?.join(","), voice]);

  // The sniper's shot: a bang, and the narrator says what happened.
  const lastShot = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const at = state.last_shot?.at ?? null;
    if (lastShot.current === undefined) {
      lastShot.current = at;
      return;
    }
    if (!at || at === lastShot.current) return;
    lastShot.current = at;
    playCue("gavel");
    if (voice && state.last_shot?.text) speak(state.last_shot.text);
  }, [state.last_shot?.at, state.last_shot?.text, voice]);
}

/** Who voted for whom, grouped by the player they voted for. For the narrator only (mafia_vote_details). */
export function VotesView({ votes, big = false, title = "من صوّت على من (للراوي فقط)" }: { votes: MafiaVote[]; big?: boolean; title?: string }) {
  if (votes.length === 0) return null;
  const groups = new Map<string, MafiaVote[]>();
  for (const v of votes) groups.set(v.target, [...(groups.get(v.target) ?? []), v]);
  const rows = [...groups.entries()]
    .map(([target, list]) => ({ target, list, total: list.reduce((s, v) => s + v.weight, 0) }))
    .sort((a, b) => b.total - a.total);
  return (
    <div className={cx("text-start", big ? "text-[clamp(16px,1.5vw,30px)]" : "text-[14px]")}>
      <p className={cx("mb-2 font-bold text-mist", big ? "text-[clamp(14px,1.3vw,26px)]" : "text-[13px]")}>{title}</p>
      <ul className="grid gap-1.5">
        {rows.map((r) => (
          <li key={r.target} className="flex flex-wrap items-baseline gap-x-2 rounded-[12px] bg-deep-2/60 px-3 py-1.5">
            <b className="text-ivory">{r.target}</b>
            <span className="tabular-nums text-gold">{r.total}</span>
            <span className="min-w-0 flex-1 text-mist">
              ← {r.list.map((v) => `${v.voter}${v.weight > 1 ? " (×2)" : ""}${v.auto ? " (تلقائي)" : ""}`).join("، ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What everyone sees after a vote: votes per player, without who cast them. */
export function TallyView({ tally, big = false }: { tally: MafiaTally[]; big?: boolean }) {
  if (tally.length === 0) return null;
  return (
    <div className={cx("text-start", big ? "text-[clamp(16px,1.5vw,30px)]" : "text-[14px]")}>
      <p className={cx("mb-2 font-bold text-mist", big ? "text-[clamp(14px,1.3vw,26px)]" : "text-[13px]")}>نتيجة التصويت</p>
      <ul className="flex flex-wrap gap-1.5">
        {tally.map((t) => (
          <li key={t.target} className="flex items-baseline gap-2 rounded-[12px] bg-deep-2/60 px-3 py-1.5">
            <b className="text-ivory">{t.target}</b>
            <span className="tabular-nums text-gold">{t.votes}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The role card dealt to a player: name, side, what it does, when, and how it wins. */
export function RoleCard({ role, open = true }: { role: string; open?: boolean }) {
  const info = ROLE_INFO[role];
  if (!info) return null;
  const side = info.team.startsWith("المافيا") ? "border-wrong/50 bg-wrong-fill/10" : info.team === "وحدك" ? "border-gold/50 bg-gold/10" : "border-correct/40 bg-correct-fill/10";
  return (
    <details open={open} className={cx("group mt-3 rounded-[18px] border p-4 text-start", side)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[15px] font-bold text-ivory">
        <span aria-hidden="true">{ROLE_ICONS[role]}</span>
        بطاقة دورك: {ROLE_NAMES[role]}
        <span className="ms-auto text-[12px] font-semibold text-mist">{info.team}</span>
      </summary>
      <dl className="mt-3 grid gap-2 text-[14px] leading-6">
        <div>
          <dt className="font-bold text-gold">ماذا تفعل</dt>
          <dd className="text-ivory">{info.does}</dd>
        </div>
        <div>
          <dt className="font-bold text-gold">متى</dt>
          <dd className="text-ivory">{info.when}</dd>
        </div>
        <div>
          <dt className="font-bold text-gold">متى تفوز</dt>
          <dd className="text-ivory">{info.wins}</dd>
        </div>
      </dl>
    </details>
  );
}

/** End of the match: the winner, everyone's role, and what happened night by night. */
export function MafiaSummary({ state, rows, big = false }: { state: MafiaPublicState; rows: MafiaPlayerRow[]; big?: boolean }) {
  const log = state.log ?? [];
  const rounds = [...new Set(log.map((l) => l.round))];
  return (
    <div className={cx("grid gap-4 text-start", big && "lg:grid-cols-2 lg:items-start")}>
      <ul className={cx("grid gap-1.5", big ? "grid-cols-2 text-[clamp(15px,1.4vw,28px)]" : "grid-cols-2 text-[14px]")}>
        {rows.map((p) => (
          <li key={p.player_id} className={cx("flex min-w-0 items-center gap-2 rounded-[12px] px-3 py-1.5", p.player_role === "mafia" || p.player_role === "spy" ? "bg-wrong-fill/20" : "bg-deep-2/60")}>
            <span aria-hidden="true">{ROLE_ICONS[p.player_role ?? ""] ?? "•"}</span>
            <span className={cx("min-w-0 flex-1 truncate font-semibold", p.alive ? "text-ivory" : "text-mist line-through")}>{p.player_name}</span>
            <span className="shrink-0 text-mist">{ROLE_NAMES[p.player_role ?? ""] ?? ""}</span>
          </li>
        ))}
      </ul>
      {rounds.length > 0 ? (
        <ol className={cx("grid gap-2", big ? "text-[clamp(14px,1.3vw,26px)]" : "text-[13px]")}>
          {rounds.map((r) => (
            <li key={r} className="rounded-[14px] border border-line bg-deep-2/40 px-3 py-2">
              <p className="mb-1 font-bold text-gold">الجولة {r}</p>
              {log
                .filter((l) => l.round === r)
                .map((l, i) => (
                  <p key={i} className="leading-relaxed text-ivory">
                    <span aria-hidden="true">{l.type === "night" ? "🌙 " : l.type === "shot" ? "🎯 " : "🗳️ "}</span>
                    {l.text}
                    {l.tally && l.tally.length > 0 ? (
                      <span className="block text-mist">{l.tally.map((t) => `${t.target} ${t.votes}`).join(" · ")}</span>
                    ) : null}
                  </p>
                ))}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/* ---------------- End-of-match recap (mafia_v6.sql) ---------------- */

export type MafiaRecap = {
  nights: Array<{ round: number; target: string | null; victim: string | null; saved: boolean; guarded: boolean; guard_died: boolean; picks: Array<{ by: string; target: string }> }>;
  doctor: { name: string; saves: number } | null;
  detective: { name: string; checks: Array<{ round: number; name: string; role: string }> } | null;
  sniper: { name: string; target: string; role: string } | null;
  seer: { name: string; target: string; role: string } | null;
  bodyguard: { name: string; saves: number } | null;
  lovers: string[] | null;
};

/** The recap, once the match is over (null before mafia_v6.sql, or for someone outside the room). */
export function useMafiaRecap(roomId: string | null | undefined, over: boolean) {
  const [recap, setRecap] = useState<MafiaRecap | null>(null);
  useEffect(() => {
    if (!over || !roomId || !supabase) {
      setRecap(null);
      return;
    }
    let live = true;
    void supabase.rpc("mafia_summary", { p_room_id: roomId }).then(({ data }) => {
      if (live && data && typeof data === "object") setRecap(data as MafiaRecap);
    });
    return () => {
      live = false;
    };
  }, [roomId, over]);
  return recap;
}

/** Short highlights: who saved whom, the detective's score, the sniper's shot, the lovers. */
export function recapHighlights(recap: MafiaRecap | null): string[] {
  if (!recap) return [];
  const out: string[] = [];
  if (recap.doctor) out.push(`🩺 الطبيب ${recap.doctor.name}: ${recap.doctor.saves === 0 ? "لم ينقذ أحدًا" : recap.doctor.saves === 1 ? "أنقذ ضحية واحدة" : recap.doctor.saves === 2 ? "أنقذ ضحيتين" : `أنقذ ${recap.doctor.saves} ضحايا`}`);
  if (recap.detective) {
    const checks = recap.detective.checks;
    const found = checks.filter((c) => c.role === "mafia").length;
    out.push(`🔎 المحقق ${recap.detective.name}: ${checks.length === 0 ? "لم يحقق مع أحد" : `كشف ${found} من المافيا في ${checks.length === 1 ? "تحقيق واحد" : checks.length === 2 ? "تحقيقين" : `${checks.length} تحقيقات`}`}`);
  }
  if (recap.bodyguard && recap.bodyguard.saves > 0) out.push(`🛡️ الحارس ${recap.bodyguard.name}: حمى ${recap.bodyguard.saves === 1 ? "لاعبًا واحدًا" : recap.bodyguard.saves === 2 ? "لاعبَين" : `${recap.bodyguard.saves} لاعبين`}`);
  if (recap.sniper) out.push(`🎯 القنّاص ${recap.sniper.name}: أصاب ${recap.sniper.target}${recap.sniper.role === "mafia" ? " وكان مافيا!" : `، وكان ${ROLE_NAMES[recap.sniper.role] ?? ""}`}`);
  if (recap.seer) out.push(`🔮 العرّافة ${recap.seer.name}: كشفت أن ${recap.seer.target} كان ${ROLE_NAMES[recap.seer.role] ?? ""}`);
  if (recap.lovers && recap.lovers.length === 2) out.push(`❤️ العاشقان: ${recap.lovers[0]} و${recap.lovers[1]}`);
  return out;
}

/** Night by night: whom the mafia chose (and who chose it), and whether a save worked. */
export function MafiaRecapView({ recap, big = false }: { recap: MafiaRecap | null; big?: boolean }) {
  if (!recap) return null;
  const highlights = recapHighlights(recap);
  return (
    <div className={cx("grid gap-3 text-start", big ? "text-[clamp(14px,1.3vw,26px)]" : "text-[13px]")}>
      {highlights.length > 0 ? (
        <ul className="grid gap-1.5 rounded-[14px] border border-gold/30 bg-gold/5 px-3 py-2">
          <li className="font-bold text-gold">أبرز اللحظات</li>
          {highlights.map((h) => (
            <li key={h} className="text-ivory">
              {h}
            </li>
          ))}
        </ul>
      ) : null}
      {recap.nights.length > 0 ? (
        <ol className="grid gap-1.5">
          {recap.nights.map((n) => (
            <li key={n.round} className="rounded-[14px] border border-line bg-deep-2/40 px-3 py-2">
              <p className="font-bold text-ivory">
                🌙 الليلة {n.round}:{" "}
                {!n.target
                  ? "لم تختر المافيا أحدًا."
                  : n.saved
                    ? `اختارت المافيا ${n.target}، وأنقذه الطبيب.`
                    : n.guarded && !n.victim
                      ? `اختارت المافيا ${n.target}، ونجا بحماية الحارس والطبيب.`
                      : n.guard_died
                        ? `اختارت المافيا ${n.target}، ومات الحارس ${n.victim} بدلًا منه.`
                        : `قتلت المافيا ${n.victim ?? n.target}.`}
              </p>
              {n.picks.length > 0 ? <p className="text-mist">{n.picks.map((x) => `${x.by} ← ${x.target}`).join(" · ")}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/* ---------------- Share ---------------- */

function site() {
  return typeof window === "undefined" ? "https://al3sh.app" : window.location.origin;
}

function shareText(state: MafiaPublicState, rows: MafiaPlayerRow[], recap: MafiaRecap | null = null) {
  const lines = [`🕵️ انتهت لعبة المافيا على العش: ${WINNERS[state.winner ?? ""] ?? ""}`];
  const mafia = rows.filter((r) => r.player_role === "mafia").map((r) => r.player_name);
  if (mafia.length) lines.push(`المافيا كانوا: ${mafia.join("، ")}`);
  const special = rows.filter((r) => r.player_role && !["mafia", "citizen"].includes(r.player_role));
  for (const r of special) lines.push(`${ROLE_ICONS[r.player_role ?? ""]} ${ROLE_NAMES[r.player_role ?? ""]}: ${r.player_name}`);
  const highlights = recapHighlights(recap);
  if (highlights.length) lines.push("", ...highlights);
  lines.push("", `العبوا معنا: ${site()}`);
  return lines.join("\n");
}

async function drawImage(state: MafiaPublicState, rows: MafiaPlayerRow[], recap: MafiaRecap | null = null): Promise<Blob | null> {
  const W = 1080;
  const perCol = Math.ceil(rows.length / 2);
  const highlights = recapHighlights(recap).slice(0, 5);
  const extra = highlights.length ? highlights.length * 58 + 40 : 0;
  const H = Math.max(1080, 560 + perCol * 96 + 200 + extra);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    await document.fonts?.ready;
  } catch {
    // System fonts.
  }
  const display = `"Baloo Bhaijaan 2", "Readex Pro", system-ui, sans-serif`;
  const sans = `"Readex Pro", "Tajawal", system-ui, sans-serif`;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0b1030");
  bg.addColorStop(1, "#1e1b4b");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.fillStyle = "#c9c3e6";
  ctx.font = `700 44px ${sans}`;
  ctx.fillText("🕵️ المافيا", W / 2, 140);
  ctx.fillStyle = "#f5efe3";
  ctx.font = `800 104px ${display}`;
  ctx.fillText(WINNERS[state.winner ?? ""] ?? "انتهت اللعبة", W / 2, 300);
  ctx.fillStyle = "#ffb547";
  ctx.font = `600 40px ${sans}`;
  const n = state.round ?? 1;
  ctx.fillText(n === 1 ? "جولة واحدة" : n === 2 ? "جولتان" : n <= 10 ? `${n} جولات` : `${n} جولة`, W / 2, 380);

  rows.forEach((r, i) => {
    const col = i < perCol ? 0 : 1;
    const row = i % perCol;
    const x = col === 0 ? W - 90 : W / 2 - 20;
    const y = 470 + row * 96;
    ctx.fillStyle = r.player_role === "mafia" ? "rgba(194,29,79,0.35)" : "rgba(10,12,40,0.5)";
    ctx.beginPath();
    ctx.roundRect(x - 430, y - 58, 430, 80, 24);
    ctx.fill();
    ctx.textAlign = "right";
    ctx.fillStyle = r.alive ? "#f5efe3" : "#8a86a8";
    ctx.font = `700 40px ${sans}`;
    ctx.fillText(`${ROLE_ICONS[r.player_role ?? ""] ?? ""} ${r.player_name}`, x - 24, y);
    ctx.textAlign = "left";
    ctx.fillStyle = "#c9c3e6";
    ctx.font = `500 32px ${sans}`;
    ctx.fillText(ROLE_NAMES[r.player_role ?? ""] ?? "", x - 410, y);
    ctx.textAlign = "center";
  });

  if (highlights.length) {
    ctx.fillStyle = "#f5efe3";
    ctx.font = `500 34px ${sans}`;
    const top = 470 + perCol * 96 + 20;
    highlights.forEach((h, i) => ctx.fillText(h, W / 2, top + i * 58, W - 120));
  }

  ctx.fillStyle = "#f5efe3";
  ctx.font = `800 52px ${display}`;
  ctx.fillText("العش", W / 2, H - 110);
  ctx.fillStyle = "#c9c3e6";
  ctx.font = `500 32px ${sans}`;
  ctx.direction = "ltr";
  ctx.fillText(site().replace(/^https?:\/\//, ""), W / 2, H - 62);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

export function MafiaShare({ state, rows, recap = null }: { state: MafiaPublicState; rows: MafiaPlayerRow[]; recap?: MafiaRecap | null }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function share() {
    setBusy(true);
    setNote(null);
    try {
      const blob = await drawImage(state, rows, recap);
      if (!blob) throw new Error("no image");
      const file = new File([blob], "mafia-result.png", { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text: shareText(state, rows, recap) });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
        setNote("حُفظت الصورة. أرسلها في مجموعة الواتساب.");
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setNote("تعذّر تجهيز الصورة.");
    }
    setBusy(false);
  }
  return (
    <div className="grid justify-items-center gap-2">
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className={cx(buttonBase, buttonTone("secondary"))} onClick={share} disabled={busy}>
          <Glyph name="trophy" />
          {busy ? "نجهّز الصورة…" : "صورة النتيجة"}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(shareText(state, rows, recap))}`} target="_blank" rel="noopener noreferrer" className={cx(buttonBase, buttonTone("quiet"))}>
          <Glyph name="whatsapp" />
          النتيجة بالواتساب
        </a>
      </div>
      {note ? <p className="text-[13px] text-mist">{note}</p> : null}
      <FeedbackButton />
    </div>
  );
}
