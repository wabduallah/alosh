import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { JoinRoom } from "@/components/join-room";

/** Join page opened from the QR code (/join/CODE). The code is prefilled. */
export const Route = createFileRoute("/join/$code")({
  head: () => ({ meta: [{ title: "انضمام إلى غرفة — العش" }] }),
  component: JoinWithCode,
});

function JoinWithCode() {
  const { code } = Route.useParams();
  return (
    <Shell>
      <JoinRoom initialCode={code} />
    </Shell>
  );
}
