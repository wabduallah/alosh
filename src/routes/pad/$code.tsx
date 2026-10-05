import { createFileRoute } from "@tanstack/react-router";
import { PadScreen } from "@/components/arena";

export const Route = createFileRoute("/pad/$code")({
  component: PadPage,
});

function PadPage() {
  const { code } = Route.useParams();
  return <PadScreen code={code.toUpperCase()} />;
}
