import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { EmptyState } from "@/components/empty-state";
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
        title="بنك الأسئلة قريبًا"
        text="يرجع بنك الأسئلة مع قائمة الألعاب الجديدة. إلى ذلك الحين، الأسئلة جاهزة داخل كل لعبة."
        action={
          <a href="/#games" className={cx(buttonBase, buttonTone("quiet"), "min-h-14 px-7")}>
            استعرضوا الألعاب
          </a>
        }
      />
    </Shell>
  );
}
