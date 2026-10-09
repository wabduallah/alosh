import { createHmac, timingSafeEqual } from "node:crypto";

const NAME = "alosh_admin";

function secret(): string {
  return (process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_BOOTSTRAP_CODE || "").trim();
}

export function adminCodeMatches(input: string): boolean {
  const expected = process.env.ADMIN_BOOTSTRAP_CODE?.trim();
  if (!expected) return false;
  return input.trim() === expected;
}

export function issueAdminCookie(): string | null {
  if (!secret()) return null;
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const body = `v1.${exp}`;
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${NAME}=${body}.${sig}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure}`;
}

export function adminCookieValid(header: string | null): boolean {
  if (!header || !secret()) return false;
  const raw = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${NAME}=`));
  if (!raw) return false;
  const token = raw.slice(NAME.length + 1);
  const split = token.lastIndexOf(".");
  if (split < 0) return false;
  const body = token.slice(0, split);
  const sig = token.slice(split + 1);
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const exp = Number(body.split(".")[1]);
  return Number.isFinite(exp) && exp > Date.now();
}
