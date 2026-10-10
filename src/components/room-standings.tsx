import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { buildScorecardText, rankScorecard, type BravoMode } from "@/lib/lamma/bravo-engine";
import type { Snapshot } from "@/lib/lamma/types";

/** Final ranking after a game: podium for the top three, full table below, plus a copy-to-share scorecard. */
export function Standings({
  players,
  yourId,
  roomCode,
  mode,
}: {
  players: Snapshot["players"];
  yourId: string | null;
  roomCode: string;
  mode: BravoMode;
}) {
  const { t } = useI18n();
  const ranked = rankScorecard(players);
  const [copied, setCopied] = useState(false);
  const resetCopied = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetCopied.current !== null) window.clearTimeout(resetCopied.current);
    };
  }, []);

  async function shareScorecard() {
    try {
      await navigator.clipboard.writeText(buildScorecardText({ roomCode, mode, rows: ranked }));
      setCopied(true);
      resetCopied.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="space-y-6 text-center">
      <h2 className="font-display text-5xl">{t("room.standingsTitle")}</h2>
      <button
        type="button"
        onClick={() => void shareScorecard()}
        className="min-h-11 rounded-full border border-neon/40 px-5 font-bold text-neon transition hover:bg-neon/10"
      >
        {copied ? t("room.copiedResult") : t("room.copyResult")}
      </button>
      <ol className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-3">
        {ranked.slice(0, 3).map((row) => (
          <li
            key={row.id}
            className={cx("glass-card rounded-2xl p-4", row.place === 1 && "border-neon/50 shadow-[0_0_32px_rgb(6_182_212/0.25)]")}
          >
            <p className="font-display text-4xl text-neon">{row.place}</p>
            <p className="text-2xl font-bold">{row.name}</p>
            <p className="tabular-nums text-ivory">{row.score}</p>
            <p className="text-xs text-muted">{row.gap === 0 ? t("room.leader") : `−${row.gap}`}</p>
          </li>
        ))}
      </ol>
      <ol className="mx-auto max-w-3xl space-y-2 text-start">
        {ranked.map((row) => (
          <li
            key={row.id}
            className={cx(
              "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3",
              row.id === yourId ? "border-neon/50 bg-neon/10" : "border-white/10 bg-white/[0.03]",
            )}
          >
            <span className="flex items-center gap-3">
              <span className="w-8 font-display text-xl tabular-nums text-neon">{row.place}</span>
              <span className="font-bold">{row.name}</span>
            </span>
            <span className="flex items-center gap-4 tabular-nums">
              <span className="text-sm text-muted">{row.gap === 0 ? "—" : `−${row.gap}`}</span>
              <span className="text-lg font-bold">{row.score}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
