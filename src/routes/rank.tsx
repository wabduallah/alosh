import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { EmptyState } from "@/components/empty-state";
import { buttonBase, buttonTone, cx } from "@/components/ui";

export const Route = createFileRoute("/rank")({
  head: () => ({ meta: [{ title: "التصنيف — العش" }] }),
  component: RankPage,
});

/** The leaderboard ranked games by rooms opened. It returns with the new games list. */
function RankPage() {
  return (
    <Shell>
      <EmptyState
        title="التصنيف قريبًا"
        text="يرجع ترتيب الألعاب مع قائمة الألعاب الجديدة."
        action={
          <a href="/#games" className={cx(buttonBase, buttonTone("quiet"), "min-h-14 px-7")}>
            استعرضوا الألعاب
          </a>
        }
      />
    </Shell>
  );
}
