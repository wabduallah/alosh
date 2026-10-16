import { createFileRoute } from "@tanstack/react-router";
import { InfoPage } from "@/components/info-page";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "الأسئلة الشائعة — العش" },
      { name: "description", content: "إجابات قصيرة عن العش: مجاني، بدون تسجيل، وكيف تبدأ الغرفة." },
    ],
    links: [{ rel: "canonical", href: "https://www.al3sh.app/faq" }],
  }),
  component: () => <InfoPage page="faq" />,
});
