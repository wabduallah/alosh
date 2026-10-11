import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { JoinRoom } from "@/components/join-room";

/** Join page with a typed code (/join). */
export const Route = createFileRoute("/join/")({
  head: () => ({ meta: [{ title: "انضمام إلى غرفة — العش" }] }),
  component: JoinPage,
});

function JoinPage() {
  return (
    <Shell>
      <JoinRoom />
    </Shell>
  );
}
