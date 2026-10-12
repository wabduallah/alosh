import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { JoinRoom } from "@/components/join-room";
import { findCard } from "@/lib/catalog";

/** Room codes use this alphabet only (no I, O, 0, 1). */
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5}$/;

/**
 * Which game a room code belongs to, for the link preview (WhatsApp shows the page title).
 * A plain REST read with the public key, short timeout: the preview must never hold up the page.
 */
async function roomGame(code: string): Promise<string | null> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key || !CODE_PATTERN.test(code)) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch(`${url}/rest/v1/game_rooms?select=status,game:games(slug,title_ar)&room_code=eq.${code}&limit=1`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ status: string; game: { slug: string; title_ar: string } | null }>;
    const game = rows[0]?.game;
    if (!game) return null;
    return findCard(game.slug)?.title ?? game.title_ar ?? null;
  } catch {
    return null;
  }
}

/** Join page opened from the QR code or a shared link (/join/CODE). The code is prefilled. */
export const Route = createFileRoute("/join/$code")({
  loader: async ({ params }) => ({ game: await roomGame(params.code.toUpperCase()) }),
  head: ({ params, loaderData }) => {
    const code = params.code.toUpperCase();
    const game = loaderData?.game;
    const title = game ? `انضموا إلى غرفة «${game}» في العش — الرمز ${code}` : `انضموا إلى غرفتي في العش — الرمز ${code}`;
    return {
      meta: [
        { title },
        { name: "description", content: "افتحوا الرابط من الجوال واكتبوا أسماءكم، بدون تسجيل ولا تحميل." },
      ],
    };
  },
  component: JoinWithCode,
});

function JoinWithCode() {
  const { code } = Route.useParams();
  return (
    <Shell>
      <JoinRoom initialCode={code} />
    </Shell>
  );
}
