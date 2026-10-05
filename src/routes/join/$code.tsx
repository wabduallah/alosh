import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { JoinForm } from "./index";

export const Route = createFileRoute("/join/$code")({
  component: JoinCode,
});

function JoinCode() {
  const { code } = Route.useParams();
  return (
    <Shell>
      <JoinForm initial={code.toUpperCase()} />
    </Shell>
  );
}
