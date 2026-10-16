import { createFileRoute } from "@tanstack/react-router";
import { InfoPage } from "@/components/info-page";

export const Route = createFileRoute("/copyright")({
  head: () => ({
    meta: [
      { title: "حقوق الملكية — العش" },
      { name: "description", content: "ملكية محتوى العش وتصميمه، والخطوط المستعملة، والإبلاغ عن محتوى مخالف." },
    ],
    links: [{ rel: "canonical", href: "https://www.al3sh.app/copyright" }],
  }),
  component: () => <InfoPage page="copyright" />,
});
