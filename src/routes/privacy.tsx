import { createFileRoute } from "@tanstack/react-router";
import { InfoPage } from "@/components/info-page";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "سياسة الخصوصية — العش" },
      { name: "description", content: "ما الذي يحفظه العش عن اللاعبين ولماذا، وكيف تتحكم فيه." },
    ],
    links: [{ rel: "canonical", href: "https://www.al3sh.app/privacy" }],
  }),
  component: () => <InfoPage page="privacy" />,
});
