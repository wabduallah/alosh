import { Link } from "@tanstack/react-router";
import { GameIcon } from "@/components/icons";
import { CATALOG } from "@/lib/lamma/catalog";
import { useI18n } from "@/lib/i18n";
import type { GameCard } from "@/lib/lamma/types";

export function GameTile({ game }: { game: GameCard }) {
  const { t, lang } = useI18n();
  const name = lang === "en" ? game.nameEn : game.nameAr;
  const desc = lang === "en" ? game.descriptionEn : game.descriptionAr;
  return (
    <article className="neon-card flex h-full flex-col rounded-3xl border border-[#3D352B] bg-[#1B1917] p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-14 place-items-center rounded-2xl bg-neon/15 text-neon">
          <GameIcon name={game.icon} className="size-7" />
        </span>
      </div>
      <h3 className="mt-4 text-lg font-extrabold leading-snug">{name}</h3>
      <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ivory/65">{desc}</p>
      <p className="mt-3 text-sm text-ivory/80">{t("browse.players", { min: game.minPlayers, max: game.maxPlayers })}</p>
      <p className="text-sm text-ivory/55">{t(`mode.${game.playMode}`)} · {t("browse.minutes", { min: game.durationMin, max: game.durationMax })}</p>
      <Link to="/games/$slug" params={{ slug: game.id }} className="mt-4">
        <span className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-neon font-extrabold text-night">{t("browse.play")}</span>
      </Link>
    </article>
  );
}

export function CategoryCards({ active }: { active?: string }) {
  const { t, lang } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {CATALOG.map((cat) => (
        <Link
          key={cat.id}
          to="/games"
          search={{ cat: cat.id }}
          className={`rounded-3xl border bg-[#171513] p-4 ${active === cat.id ? "border-[#D4AF37]" : "border-[#3D352B]"}`}
        >
          <span className="grid size-10 place-items-center rounded-xl bg-neon/15 text-neon">
            <GameIcon name={cat.icon} className="size-5" />
          </span>
          <span className="mt-3 block text-sm font-extrabold">{lang === "en" ? cat.en : cat.ar}</span>
          <span className="mt-1 block text-xs text-ivory/50">{t(`cat.${cat.id}`)}</span>
        </Link>
      ))}
    </div>
  );
}
