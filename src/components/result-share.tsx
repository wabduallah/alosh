import { useState } from "react";
import { Glyph, gameStyle } from "@/components/brand";
import { buttonBase, buttonTone, cx } from "@/components/ui";

/**
 * A result picture for any game: the game name, the winner, a short ranking,
 * and the site's name and address at the bottom (so every shared picture leads back here).
 * Made in the browser on a canvas; shared through the phone's share sheet or downloaded,
 * plus a ready WhatsApp message.
 */

export type ShareRow = { name: string; value: string; color?: string };
export type ShareResult = {
  /** Game id, for its colours. */
  slug: string;
  /** Game name with its emoji, e.g. «🎲 تحديات العش». */
  title: string;
  /** The big line: the winner, or «تعادل». */
  headline: string;
  /** Under the headline, e.g. «🏆 الفائز بـ 2400 نقطة». */
  sub?: string;
  rows: ShareRow[];
};

const W = 1080;

const GAME_TITLES: Record<string, string> = {
  "bluff-master": "🎭 سيد الخداع",
  "tactical-grid": "🎲 تحديات العش",
  "heads-up": "🧠 هل تعرف",
  outsider: "👀 برة السالفة",
  "hex-letters": "🔤 خلية الحروف",
};

/** A result for games scored per player: the top scores, ties named together. */
export function rankingShare(slug: string | null, ranking: Array<{ player_name: string; score: number }>): ShareResult {
  const top = ranking[0]?.score ?? 0;
  const winners = ranking.filter((p) => p.score === top);
  return {
    slug: slug ?? "tactical-grid",
    title: GAME_TITLES[slug ?? ""] ?? "🎲 العش",
    headline: winners.length > 1 ? `تعادل: ${winners.map((w) => w.player_name).join("، ")}` : (winners[0]?.player_name ?? "انتهت اللعبة"),
    sub: `🏆 ${top} نقطة`,
    rows: ranking.slice(0, 8).map((p) => ({ name: p.player_name, value: String(p.score) })),
  };
}

/** A result for two-team games. */
export function teamsShare(slug: string, red: number, blue: number): ShareResult {
  const w = red === blue ? null : red > blue ? "الفريق الأحمر" : "الفريق الأزرق";
  return {
    slug,
    title: GAME_TITLES[slug] ?? "🎲 العش",
    headline: w ?? "تعادل",
    sub: w ? `🏆 ${Math.max(red, blue)} مقابل ${Math.min(red, blue)}` : `${red} لكل فريق`,
    rows: [
      { name: "الفريق الأحمر", value: String(red), color: "#ff5a7a" },
      { name: "الفريق الأزرق", value: String(blue), color: "#6bb8ff" },
    ].sort((a, b) => Number(b.value) - Number(a.value)),
  };
}

export function siteUrl() {
  return typeof window === "undefined" ? "https://al3sh.app" : window.location.origin;
}

export function resultText(r: ShareResult) {
  const lines = [`${r.title}: انتهت اللعبة على العش`, r.headline + (r.sub ? ` (${r.sub.replace(/^🏆\s*/, "")})` : "")];
  for (const row of r.rows.slice(0, 8)) lines.push(`• ${row.name}: ${row.value}`);
  lines.push("", `العبوا معنا مجانًا: ${siteUrl()}`);
  return lines.join("\n");
}

async function draw(r: ShareResult): Promise<Blob | null> {
  const rows = r.rows.slice(0, 8);
  const top = 520;
  const H = Math.max(1080, top + rows.length * 130 + 260);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    await document.fonts?.ready;
  } catch {
    // System fonts are fine.
  }
  const display = `"Baloo Bhaijaan 2", "Readex Pro", system-ui, sans-serif`;
  const sans = `"Readex Pro", "Tajawal", system-ui, sans-serif`;
  const style = gameStyle(r.slug);

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, style.c1);
  bg.addColorStop(1, "#0b1030");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 260, 40, W / 2, 260, 560);
  glow.addColorStop(0, "rgba(255,181,71,0.28)");
  glow.addColorStop(1, "rgba(255,181,71,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.direction = "rtl";
  ctx.textAlign = "center";
  const fit = (text: string, max: number, size: number, family: string, weight = 800) => {
    let s = size;
    do {
      ctx.font = `${weight} ${s}px ${family}`;
      s -= 4;
    } while (ctx.measureText(text).width > max && s > 24);
  };

  ctx.fillStyle = "#f5efe3cc";
  ctx.font = `700 46px ${sans}`;
  ctx.fillText(r.title, W / 2, 140);
  ctx.fillStyle = "#f5efe3";
  fit(r.headline, W - 160, 120, display);
  ctx.fillText(r.headline, W / 2, 320);
  if (r.sub) {
    ctx.fillStyle = "#ffb547";
    ctx.font = `700 46px ${sans}`;
    ctx.fillText(r.sub, W / 2, 410);
  }

  let y = top;
  rows.forEach((row, i) => {
    ctx.fillStyle = "rgba(10,12,40,0.5)";
    ctx.strokeStyle = row.color ?? "rgba(255,181,71,0.45)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(90, y, W - 180, 104, 28);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillStyle = row.color ?? "#f5efe3";
    fit(`${i + 1}. ${row.name}`, W - 520, 50, display);
    ctx.fillText(`${i + 1}. ${row.name}`, W - 130, y + 68);
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffb547";
    ctx.font = `800 46px ${display}`;
    ctx.direction = "ltr";
    ctx.fillText(row.value, 130, y + 68);
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    y += 130;
  });

  ctx.fillStyle = "#f5efe3";
  ctx.font = `800 56px ${display}`;
  ctx.fillText("العش · ألعاب جماعية مجانية", W / 2, H - 120);
  ctx.fillStyle = "#ffb547";
  ctx.font = `700 40px ${sans}`;
  ctx.direction = "ltr";
  ctx.fillText(siteUrl().replace(/^https?:\/\//, ""), W / 2, H - 64);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/** «صورة النتيجة» and «النتيجة بالواتساب» buttons. */
export function ResultShare({ result, fileName = "al3sh-result.png", className }: { result: ShareResult; fileName?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function shareImage() {
    setBusy(true);
    setNote(null);
    try {
      const blob = await draw(result);
      if (!blob) throw new Error("no image");
      const file = new File([blob], fileName, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text: resultText(result) });
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
    <div className={cx("grid justify-items-center gap-2", className)}>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className={cx(buttonBase, buttonTone("secondary"))} onClick={shareImage} disabled={busy}>
          <Glyph name="trophy" />
          {busy ? "نجهّز الصورة…" : "صورة النتيجة"}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(resultText(result))}`} target="_blank" rel="noopener noreferrer" className={cx(buttonBase, buttonTone("quiet"))}>
          <Glyph name="whatsapp" />
          النتيجة بالواتساب
        </a>
      </div>
      {note ? <p className="text-[13px] text-mist">{note}</p> : null}
    </div>
  );
}
