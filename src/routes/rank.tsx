import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/rank")({
  head: () => ({ meta: [{ title: "التصنيف — العش" }] }),
  component: RankPage,
});

/** The leaderboard ranked games by rooms opened. It returns with the new games list. */
function RankPage() {
  return (
    <Shell>
      <section className="glass-card mx-auto mt-8 max-w-xl rounded-3xl p-6 text-center">
        <h1 className="text-2xl font-extrabold text-ivory">التصنيف</h1>
        <p className="mt-2 text-sm text-muted">يعود التصنيف مع قائمة الألعاب الجديدة.</p>
        <Link to="/" className="mt-5 inline-flex min-h-11 items-center rounded-full border border-white/15 px-5 text-sm font-bold text-ivory">
          العودة للرئيسية
        </Link>
      </section>
    </Shell>
  );
}
