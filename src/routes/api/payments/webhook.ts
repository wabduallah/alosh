import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleWebhook } = await import("@/lib/lamma/payments.server");
        return handleWebhook(request);
      },
    },
  },
});
