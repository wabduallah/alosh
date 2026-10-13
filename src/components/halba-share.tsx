import { useState } from "react";
import { FeedbackButton } from "@/components/feedback";
import { Glyph } from "@/components/brand";
import { halbaAwards, halbaWinner, TEAMS, type HalbaPlayer, type HalbaState } from "@/components/halba";
import { buttonBase, buttonTone, cx } from "@/components/ui";

/**
 * «الحلبة» result sharing: a picture of the final result (winner and awards)
 * made in the browser, plus a ready WhatsApp message.
 */

const W = 1080;

function site() {
  return typeof window === "undefined" ? "https://al3sh.app" : window.location.origin;
}

function resultText(state: HalbaState, players: HalbaPlayer[]) {
  const w = halbaWinner(state, players);
  const lines = [`🥊 انتهت مباراة الحلبة على العش`, w ? `الفائز: ${w.name} (${w.why})` : ""];
  for (const a of halbaAwards(state, players)) lines.push(`• ${a.title}: ${a.name} (${a.detail})`);
  lines.push("", `العبوا معنا: ${site()}`);
  return lines.filter((l, i) => l || i > 1).join("\n");
}

/** Draws the result card on a canvas and returns it as a PNG. */
async function drawResult(state: HalbaState, players: HalbaPlayer[]): Promise<Blob | null> {
  const awards = halbaAwards(state, players);
  const teams = state.mode === "teams";
  const top = teams ? 600 : 520;
  const H = Math.max(1080, top + awards.length * 180 + 230);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    await document.fonts?.ready;
  } catch {
    // Fall back to system fonts.
  }
  const display = `"Baloo Bhaijaan 2", "Readex Pro", system-ui, sans-serif`;
  const sans = `"Readex Pro", "Tajawal", system-ui, sans-serif`;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#831843");
  bg.addColorStop(1, "#1e1b4b");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 260, 40, W / 2, 260, 520);
  glow.addColorStop(0, "rgba(255,90,122,0.35)");
  glow.addColorStop(1, "rgba(255,90,122,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const fit = (text: string, max: number, size: number, family: string, weight = 800) => {
    let s = size;
    do {
      ctx.font = `${weight} ${s}px ${family}`;
      s -= 4;
    } while (ctx.measureText(text).width > max && s > 24);
  };

  ctx.fillStyle = "#ffb3c4";
  ctx.font = `700 44px ${sans}`;
  ctx.fillText("🥊 الحلبة", W / 2, 140);

  const w = halbaWinner(state, players);
  ctx.fillStyle = "#f5efe3";
  fit(w ? w.name : "انتهت المباراة", W - 160, 120, display);
  ctx.fillText(w ? w.name : "انتهت المباراة", W / 2, 320);
  if (w) {
    ctx.fillStyle = "#ffb547";
    ctx.font = `700 46px ${sans}`;
    const tie = w.name.includes("،") || w.name.startsWith("تعادل");
    ctx.fillText(tie ? w.why : teams ? "🏆 الفائز" : `🏆 الفائز · ${w.why}`, W / 2, 410);
  }

  if (teams) {
    const red = state.team_scores?.red ?? 0;
    const blue = state.team_scores?.blue ?? 0;
    ctx.font = `800 54px ${display}`;
    ctx.fillStyle = TEAMS.red.color;
    ctx.fillText(`${TEAMS.red.name} ${red}`, W * 0.72, 510);
    ctx.fillStyle = TEAMS.blue.color;
    ctx.fillText(`${TEAMS.blue.name} ${blue}`, W * 0.28, 510);
  }

  const icons: Record<string, string> = { bid: "🏆", correct: "🧠", bold: "🥊", cheer: "📣" };
  let y = top;
  for (const a of awards) {
    ctx.fillStyle = "rgba(10,12,40,0.45)";
    ctx.strokeStyle = "rgba(255,181,71,0.45)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(90, y, W - 180, 150, 32);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillStyle = "#c9c3e6";
    ctx.font = `600 36px ${sans}`;
    ctx.fillText(`${icons[a.key] ?? ""} ${a.title}`, W - 130, y + 58);
    ctx.fillStyle = "#f5efe3";
    fit(a.name, W - 560, 54, display);
    ctx.fillText(a.name, W - 130, y + 122);
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffb547";
    ctx.font = `700 38px ${sans}`;
    ctx.fillText(a.detail, 130, y + 104);
    ctx.textAlign = "center";
    y += 180;
  }

  ctx.fillStyle = "#f5efe3";
  ctx.font = `800 52px ${display}`;
  ctx.fillText("العش", W / 2, H - 120);
  ctx.fillStyle = "#c9c3e6";
  ctx.font = `500 34px ${sans}`;
  ctx.direction = "ltr";
  ctx.fillText(site().replace(/^https?:\/\//, ""), W / 2, H - 70);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

const LINK = cx(buttonBase, buttonTone("quiet"));

/** Share the result: the picture (phone share sheet, or a download), or a WhatsApp message. */
export function HalbaShare({ state, players }: { state: HalbaState; players: HalbaPlayer[] }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function shareImage() {
    setBusy(true);
    setNote(null);
    try {
      const blob = await drawResult(state, players);
      if (!blob) throw new Error("no image");
      const file = new File([blob], "alhalba-result.png", { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text: resultText(state, players) });
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
        <button type="button" className={cx(buttonBase, buttonTone("secondary"))} onClick={shareImage} disabled={busy}>
          <Glyph name="trophy" />
          {busy ? "نجهّز الصورة…" : "صورة النتيجة"}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(resultText(state, players))}`} target="_blank" rel="noopener noreferrer" className={LINK}>
          <Glyph name="whatsapp" />
          النتيجة بالواتساب
        </a>
      </div>
      {note ? <p className="text-[13px] text-mist">{note}</p> : null}
      <FeedbackButton />
    </div>
  );
}
