import { createMiddleware } from "@tanstack/react-start";

/** Optional session for public play. Signed-out callers get a null user id. */
export const optionalUser = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("@/lib/auth/client");
    return next({ sendContext: { bearerToken: getBearerToken() ?? undefined } });
  })
  .server(async ({ next, context }) => {
    const { getSessionUser } = await import("@/lib/auth/verify.server");
    const user = await getSessionUser(context.bearerToken);
    return next({
      context: {
        userId: user?.id ?? null,
        email: user?.email ?? null,
      },
    });
  });
