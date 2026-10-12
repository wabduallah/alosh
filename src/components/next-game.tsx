import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button, cx } from "@/components/ui";
import { GameIcon, Glyph } from "@/components/brand";
import { supabase } from "@/lib/supabase";
import { useGames } from "@/lib/catalog";

/** Games with their own «play again» on the game-over screen; here they only offer other games. */
const OWN_REMATCH = new Set(["alhalba", "social-mafia"]);

/**
 * After a game: play it again or pick another game, in the same room with the same players
 * and the same code (room_next_game in supabase/rooms_v1.sql). The host then lands on the
 * room's lobby to start, and every other screen reloads into the new game by itself.
 */
export function NextGame({ roomId, roomCode, currentSlug, className }: { roomId: string; roomCode: string; currentSlug: string | null; className?: string }) {
  const navigate = useNavigate();
  const games = useGames().filter((g) => !g.soon);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = games.find((g) => g.id === currentSlug) ?? null;
  const others = games.filter((g) => g.id !== currentSlug);

  async function go(slug: string) {
    if (!supabase) return;
    setBusy(slug);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("room_next_game", { p_room_id: roomId, p_slug: slug });
    if (rpcError) {
      setBusy(null);
      const missing = rpcError.code === "PGRST202" || rpcError.code === "42883";
      return setError(missing ? "هذه الميزة تحتاج تشغيل الملف supabase/rooms_v1.sql في Supabase." : "تعذّر بدء جولة جديدة، حاول مرة أخرى.");
    }
    const res = data as { ok: boolean; reason?: string; players?: number; max?: number };
    if (!res.ok) {
      setBusy(null);
      const messages: Record<string, string> = {
        NOT_HOST: "هذا للمضيف فقط.",
        ROOM_NOT_FOUND: "لم نجد هذه الغرفة.",
        GAME_UNAVAILABLE: "هذه اللعبة غير متاحة الآن.",
        TOO_MANY: `في الغرفة ${res.players ?? ""} لاعبين، وحد هذه اللعبة ${res.max ?? ""}.`,
      };
      return setError(messages[res.reason ?? ""] ?? "تعذّر بدء جولة جديدة.");
    }
    navigate({ to: "/play", search: { game: slug, room: roomCode } });
  }

  return (
    <section aria-labelledby="next-game-title" className={cx("surface grid gap-4 rounded-[24px] p-5 sm:p-6", className)}>
      <div>
        <h2 id="next-game-title" className="flex items-center gap-2 text-[20px] leading-8">
          <Glyph name="refresh" className="size-6 text-gold" />
          جولة جديدة في نفس الغرفة
        </h2>
        <p className="mt-1 text-[14px] leading-6 text-mist">
          اللاعبون يبقون معك بالرمز نفسه <bdi className="font-bold text-gold">{roomCode}</bdi>، وتنتقل شاشاتهم تلقائيًا. النقاط تبدأ من الصفر.
        </p>
      </div>

      {current && !OWN_REMATCH.has(current.id) ? (
        <Button tone="primary" className="min-h-14 w-full text-[17px]" disabled={!!busy} onClick={() => go(current.id)}>
          <Glyph name="refresh" />
          {busy === current.id ? "جارٍ التجهيز…" : `العب ${current.title} من جديد`}
        </Button>
      ) : null}

      {others.length ? (
        <div className="grid gap-2">
          <p className="text-[14px] font-semibold text-ivory">{current && !OWN_REMATCH.has(current.id) ? "أو غيّر اللعبة:" : "غيّر اللعبة:"}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {others.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => go(g.id)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-[16px] border border-line-strong/70 bg-deep-2/50 px-3 py-2 text-start transition hover:border-glow disabled:opacity-60"
                >
                  <GameIcon id={g.id} size="sm" className="size-10!" />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-[16px] font-bold text-ivory">{busy === g.id ? "جارٍ التجهيز…" : g.title}</span>
                    <span className="text-[12px] text-mist">
                      <bdi dir="ltr">{g.players}</bdi> لاعب
                    </span>
                  </span>
                  <Glyph name="forward" className="size-5 text-mist" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-[14px] font-semibold text-wrong">
          <Glyph name="alert" className="size-4" />
          {error}
        </p>
      ) : null}
    </section>
  );
}
