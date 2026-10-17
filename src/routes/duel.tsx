import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { NestDuel } from "@/components/nest-duel";

/** «منافسة العش»: a 1-against-1 tournament on one phone. No room, no sign-in. */
export const Route = createFileRoute("/duel")({
  head: () => ({
    meta: [
      { title: "منافسة العش: تحديات سريعة 1 ضد 1 على جوال واحد — العش" },
      { name: "description", content: "بطولة سريعة من 2 إلى 14 لاعبًا على جوال واحد: ردة الفعل، النقر المتسارع، إيقاف المؤشر، والذاكرة الخاطفة." },
    ],
    links: [{ rel: "canonical", href: "https://www.al3sh.app/duel" }],
  }),
  component: DuelPage,
});

function DuelPage() {
  return (
    <Shell play>
      <NestDuel />
    </Shell>
  );
}
