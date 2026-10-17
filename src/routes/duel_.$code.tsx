import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { DuelRoomScreen } from "@/components/duel-online";

/** «منافسة العش» online: one room, two phones. */
export const Route = createFileRoute("/duel_/$code")({
  head: () => ({
    meta: [
      { title: "منافسة العش أونلاين — العش" },
      { name: "description", content: "مواجهة 1 ضد 1، كل لاعب من جواله: 60 ثانية من التحديات السريعة، والأسرع يفوز." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DuelRoomPage,
});

function DuelRoomPage() {
  const { code } = Route.useParams();
  return (
    <Shell play>
      <DuelRoomScreen code={code.toUpperCase()} />
    </Shell>
  );
}
