import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { EmptyState } from "@/components/empty-state";
import { Glyph } from "@/components/brand";
import { buttonBase, buttonTone, cx } from "@/components/ui";

export const Route = createFileRoute("/questions")({
  head: () => ({ meta: [{ title: "بنك الأسئلة — العش" }, { name: "description", content: "فئات الأسئلة المرتبطة بكل لعبة." }] }),
  component: QuestionsPage,
});

/** The question library is tied to the game list, which is being rebuilt. */
function QuestionsPage() {
  return (
    <Shell>
      <EmptyState
        title="بنك الأسئلة"
        text="يعود بنك الأسئلة مع قائمة الألعاب الجديدة."
        action={
          <Link to="/" className={cx(buttonBase, buttonTone("quiet"), "min-h-12 px-6")}>
            <Glyph name="home" className="size-[18px]" />
            العودة للرئيسية
          </Link>
        }
      />
    </Shell>
  );
}
