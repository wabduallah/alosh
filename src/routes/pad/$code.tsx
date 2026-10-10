import { createFileRoute } from "@tanstack/react-router";
import { PadScreen } from "@/components/arena";

/** Player pad alias: a phone opened straight on the pad. */
export const Route = createFileRoute("/pad/$code")({
  component: PadPage,
});

function PadPage() {
  const { code } = Route.useParams();
  return <PadScreen code={code.toUpperCase()} />;
}
