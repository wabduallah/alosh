import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { EmptyState } from "@/components/empty-state";
import { Glyph } from "@/components/brand";
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
        title="التصنيف"
        text="يعود التصنيف مع قائمة الألعاب الجديدة."
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
