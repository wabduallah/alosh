import { createFileRoute } from "@tanstack/react-router";
import { PadScreen } from "@/components/arena";

export const Route = createFileRoute("/play_/$code")({
  component: ControllerPage,
});

function ControllerPage() {
  const { code } = Route.useParams();
  return <PadScreen code={code.toUpperCase()} />;
}
