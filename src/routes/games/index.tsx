import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { GamesGrid } from "@/components/games-grid";

export const Route = createFileRoute("/games/")({
  head: () => ({
    meta: [
      { title: "الألعاب — العش" },
      { name: "description", content: "ألعاب العش الجماعية: الحلبة، تحديات العش، سيد الخداع، هل تعرف، برة السالفة، والمافيا. شاشة واحدة وجوال لكل لاعب، مجانًا وبدون تسجيل." },
    ],
  }),
  component: GamesPage,
});

function GamesPage() {
  return (
    <Shell>
      <p className="mb-5 max-w-2xl text-[16px] leading-[29px] text-mist">
        اختاروا لعبة وافتحوا غرفتها على التلفزيون أو اللابتوب، وكل لاعب ينضم من جواله بالرمز. اضغطوا اسم اللعبة لقراءة طريقتها كاملة.
      </p>
      <GamesGrid titleAs="h1" />
    </Shell>
  );
}
