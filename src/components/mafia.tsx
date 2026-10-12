import { useEffect, useRef, useState } from "react";
import { Glyph } from "@/components/brand";
import { buttonBase, buttonTone, cx } from "@/components/ui";
import { playCue } from "@/lib/sfx";

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
};
export type MafiaVote = { voter: string; target: string; weight: number };
export type MafiaLogEntry = { round: number; type: "night" | "vote"; text: string; votes?: MafiaVote[] };
export type MafiaPublicState = {
  phase?: string;
  round?: number;
  winner?: string | null;
  last_result?: string | null;
  runoff?: string[] | null;
  settings?: MafiaSettings;
  mayor?: string | null;
  last_votes?: MafiaVote[] | null;
  day_ends_at?: string | null;
  log?: MafiaLogEntry[];
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
};
export const ROLE_ICONS: Record<string, string> = {
  mafia: "🔪",
  citizen: "🙂",
  doctor: "🩺",
  detective: "🔍",
  jester: "🃏",
  mayor: "👑",
  bodyguard: "🛡️",
};
export const ROLE_HINTS: Record<string, string> = {
  mafia: "كل ليلة اتفقوا مع زملائكم على ضحية. ترون اختيارات بعض هنا. نهارًا لا تكشفوا أنفسكم.",
  citizen: "استمعوا للنقاش وصوّتوا لإقصاء المافيا.",
  doctor: "كل ليلة احموا لاعبًا. لا تحموا نفس اللاعب ليلتين متتاليتين، وتحمون أنفسكم مرة واحدة فقط.",
  detective: "كل ليلة تحققوا من لاعب واحد. النتيجة تظهر بعد انتهاء الليل.",
  jester: "أنت المهرّج: تفوز وحدك إذا أقصوك بالتصويت. خلّهم يشكّون فيك… بدون ما تكشف نفسك.",
  mayor: "الكل يعرف أنك العمدة، وصوتك بصوتين. انتبه: المافيا تعرفك أيضًا.",
  bodyguard: "كل ليلة احرس لاعبًا. إذا هاجمته المافيا تموت أنت بدلًا منه.",
};

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
      "المافيا: افتحوا جوالاتكم بهدوء واختاروا ضحيتكم.",
      "الطبيب: من تحمي الليلة؟",
      "المحقق: من تشكّ فيه؟",
    ];
    if (s.bodyguard) parts.push("الحارس: من تحرس؟");
    return parts.join(" ");
  }
  if (phase === "day") return `طلع الصباح… افتحوا أعينكم. ${state.last_result ?? ""} والآن ناقشوا: من بينكم المافيا؟`;
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
}

/** Who voted for whom, grouped by the player they voted for. */
export function VotesView({ votes, big = false }: { votes: MafiaVote[]; big?: boolean }) {
  if (votes.length === 0) return null;
  const groups = new Map<string, MafiaVote[]>();
  for (const v of votes) groups.set(v.target, [...(groups.get(v.target) ?? []), v]);
  const rows = [...groups.entries()]
    .map(([target, list]) => ({ target, list, total: list.reduce((s, v) => s + v.weight, 0) }))
    .sort((a, b) => b.total - a.total);
  return (
    <div className={cx("text-start", big ? "text-[clamp(16px,1.5vw,30px)]" : "text-[14px]")}>
      <p className={cx("mb-2 font-bold text-mist", big ? "text-[clamp(14px,1.3vw,26px)]" : "text-[13px]")}>من صوّت على من</p>
      <ul className="grid gap-1.5">
        {rows.map((r) => (
          <li key={r.target} className="flex flex-wrap items-baseline gap-x-2 rounded-[12px] bg-deep-2/60 px-3 py-1.5">
            <b className="text-ivory">{r.target}</b>
            <span className="tabular-nums text-gold">{r.total}</span>
            <span className="min-w-0 flex-1 text-mist">
              ← {r.list.map((v) => `${v.voter}${v.weight > 1 ? " (×2)" : ""}`).join("، ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
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
          <li key={p.player_id} className={cx("flex min-w-0 items-center gap-2 rounded-[12px] px-3 py-1.5", p.player_role === "mafia" ? "bg-wrong-fill/20" : "bg-deep-2/60")}>
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
                    <span aria-hidden="true">{l.type === "night" ? "🌙 " : "🗳️ "}</span>
                    {l.text}
                    {l.votes && l.votes.length > 0 ? (
                      <span className="block text-mist">
                        {l.votes.map((v) => `${v.voter}${v.weight > 1 ? "×2" : ""} ← ${v.target}`).join(" · ")}
                      </span>
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

/* ---------------- Share ---------------- */

function site() {
  return typeof window === "undefined" ? "https://al3sh.app" : window.location.origin;
}

function shareText(state: MafiaPublicState, rows: MafiaPlayerRow[]) {
  const lines = [`🕵️ انتهت لعبة المافيا على العش: ${WINNERS[state.winner ?? ""] ?? ""}`];
  const mafia = rows.filter((r) => r.player_role === "mafia").map((r) => r.player_name);
  if (mafia.length) lines.push(`المافيا كانوا: ${mafia.join("، ")}`);
  const special = rows.filter((r) => r.player_role && !["mafia", "citizen"].includes(r.player_role));
  for (const r of special) lines.push(`${ROLE_ICONS[r.player_role ?? ""]} ${ROLE_NAMES[r.player_role ?? ""]}: ${r.player_name}`);
  lines.push("", `العبوا معنا: ${site()}`);
  return lines.join("\n");
}

async function drawImage(state: MafiaPublicState, rows: MafiaPlayerRow[]): Promise<Blob | null> {
  const W = 1080;
  const perCol = Math.ceil(rows.length / 2);
  const H = Math.max(1080, 560 + perCol * 96 + 200);
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

  ctx.fillStyle = "#f5efe3";
  ctx.font = `800 52px ${display}`;
  ctx.fillText("العش", W / 2, H - 110);
  ctx.fillStyle = "#c9c3e6";
  ctx.font = `500 32px ${sans}`;
  ctx.direction = "ltr";
  ctx.fillText(site().replace(/^https?:\/\//, ""), W / 2, H - 62);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

export function MafiaShare({ state, rows }: { state: MafiaPublicState; rows: MafiaPlayerRow[] }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function share() {
    setBusy(true);
    setNote(null);
    try {
      const blob = await drawImage(state, rows);
      if (!blob) throw new Error("no image");
      const file = new File([blob], "mafia-result.png", { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text: shareText(state, rows) });
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
        <a href={`https://wa.me/?text=${encodeURIComponent(shareText(state, rows))}`} target="_blank" rel="noopener noreferrer" className={cx(buttonBase, buttonTone("quiet"))}>
          <Glyph name="whatsapp" />
          النتيجة بالواتساب
        </a>
      </div>
      {note ? <p className="text-[13px] text-mist">{note}</p> : null}
    </div>
  );
}
