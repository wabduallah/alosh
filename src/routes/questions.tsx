import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/questions")({
  head: () => ({ meta: [{ title: "بنك الأسئلة — العش" }, { name: "description", content: "فئات الأسئلة المرتبطة بكل لعبة." }] }),
  component: QuestionsPage,
});

/** The question library is tied to the game list, which is being rebuilt. */
function QuestionsPage() {
  return (
    <Shell>
      <section className="glass-card mx-auto mt-8 max-w-xl rounded-3xl p-6 text-center">
        <h1 className="text-2xl font-extrabold text-ivory">بنك الأسئلة</h1>
        <p className="mt-2 text-sm text-muted">يعود بنك الأسئلة مع قائمة الألعاب الجديدة.</p>
        <Link to="/" className="mt-5 inline-flex min-h-11 items-center rounded-full border border-white/15 px-5 text-sm font-bold text-ivory">
          العودة للرئيسية
        </Link>
      </section>
    </Shell>
  );
}
