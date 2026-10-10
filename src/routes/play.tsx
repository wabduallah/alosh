import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";

/**
 * The create-room page is being rebuilt. The `game` search param is kept so links
 * such as <Link to="/play" search={{ game }}> elsewhere in the app stay valid.
 */
export const Route = createFileRoute("/play")({
  validateSearch: (search: Record<string, unknown>) => ({
    game: typeof search.game === "string" ? search.game : "",
  }),
  head: () => ({ meta: [{ title: "إنشاء لعبة — العش" }] }),
  component: CreatePage,
});

function CreatePage() {
  return (
    <Shell>
      <section className="glass-card mx-auto mt-8 max-w-xl rounded-3xl p-6 text-center">
        <h1 className="text-2xl font-extrabold text-neon">إنشاء غرفة</h1>
        <p className="mt-2 text-sm text-muted">قائمة الألعاب وصفحة الإنشاء قيد البناء.</p>
        <Link to="/" className="mt-5 inline-flex min-h-11 items-center rounded-full border border-white/15 px-5 text-sm font-bold text-ivory">
          العودة للرئيسية
        </Link>
      </section>
    </Shell>
  );
}
