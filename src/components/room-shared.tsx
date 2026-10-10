import { Check } from "lucide-react";
import { PictureIcons } from "@/components/icons";
import { cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import type { Snapshot } from "@/lib/lamma/types";

export function QuestionVisual({ snap }: { snap: Snapshot }) {
  const q = snap.room.question;
  if (!q) return null;
  if (q.imageUrl) {
    return (
      <img
        src={q.imageUrl}
        alt=""
        className="mx-auto max-h-72 w-auto max-w-full rounded-2xl border border-white/10 bg-white/[0.03] object-contain p-2"
      />
    );
  }
  if (q.icons.length) return <PictureIcons names={q.icons} />;
  return null;
}


/** Guest names under the question. A green check appears as soon as a guest has answered. */
export function GuestsStrip({ snap }: { snap: Snapshot }) {
  const { t } = useI18n();
  const answered = snap.players.filter((p) => p.answered).length;
  // Live standings: the three leaders, shown while the round is in progress.
  const leaders = [...snap.players].sort((a, b) => b.score - a.score).slice(0, 3);
  const rules = [
    snap.room.targetScore > 0 ? t("room.goal", { n: snap.room.targetScore }) : null,
    snap.room.pointsPerCorrect > 0 ? t("room.pointsPerCorrect", { n: snap.room.pointsPerCorrect }) : null,
    snap.room.streakMultiplier ? t("room.streak") : null,
    snap.room.eliminationMode ? t("room.elimination") : null,
    snap.room.reactionBonus ? t("room.speedBonus") : null,
    snap.room.majorityMode ? t("room.groupGuess") : null,
    snap.players.find((p) => p.id === snap.yourId)?.eliminated ? t("room.eliminatedWatching") : null,
  ].filter(Boolean);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {snap.players.map((player) => (
          <span
            key={player.id}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-bold transition-colors duration-200",
              player.eliminated && "opacity-40 line-through",
              player.answered ? "border-emerald/50 bg-emerald/15 text-ivory" : "border-white/10 bg-white/[0.03] text-muted",
            )}
          >
            {player.answered ? (
              <Check className="size-3.5 text-emerald" strokeWidth={3} aria-label={t("room.answeredLabel")} />
            ) : (
              <span className="size-1.5 rounded-full bg-white/30" aria-hidden="true" />
            )}
            {player.name}
          </span>
        ))}
      </div>
      {leaders.length ? (
        <p className="text-center text-xs text-ivory/80">
          {t("room.leaders")}: {leaders.map((p) => `${p.name} ${p.score}`).join(" · ")}
        </p>
      ) : null}
      <p className="text-center text-xs text-muted">
        {t("room.answeredCount", { a: answered, b: snap.players.length })}{rules.length ? ` · ${rules.join(" · ")}` : ""}
      </p>
    </div>
  );
}
