import { createHmac, timingSafeEqual } from "node:crypto";
import { getSql } from "@/lib/db";
import { ready } from "./engine.server";

type Ctx = { userId: string | null; email: string | null };

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hex(size = 8): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(size))).toString("hex");
}

export async function grantPlan(userId: string, planId: string, source: string, endsAt: string | null) {
  const sql = await getSql();
  await ready(sql);
  await sql`insert into subscriptions (id, user_id, plan_id, status, source, ends_at) values (${hex()}, ${userId}, ${planId}, 'active', ${source}, ${endsAt})`;
}

function endsFor(interval: string): string | null {
  if (interval === "month") return new Date(Date.now() + 30 * 864e5).toISOString();
  if (interval === "year") return new Date(Date.now() + 365 * 864e5).toISOString();
  return null;
}

async function stripeSession(amountSar: number, title: string, paymentId: string, origin: string) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", `${origin}/premium?payment=${paymentId}`);
  body.set("cancel_url", `${origin}/premium?canceled=1`);
  body.set("client_reference_id", paymentId);
  body.set("line_items[0][quantity]", "1");
  body.set("line_items[0][price_data][currency]", "sar");
  body.set("line_items[0][price_data][unit_amount]", String(amountSar * 100));
  body.set("line_items[0][price_data][product_data][name]", title);
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return { error: `stripe ${res.status}` };
  const json = (await res.json()) as { url?: string; id?: string };
  return { url: json.url, externalId: json.id };
}

async function moyasarInvoice(amountSar: number, title: string, paymentId: string, origin: string) {
  const key = process.env.MOYASAR_SECRET_KEY;
  if (!key) return null;
  const res = await fetch("https://api.moyasar.com/v1/invoices", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountSar * 100,
      currency: "SAR",
      description: title,
      callback_url: `${origin}/api/payments/webhook?provider=moyasar&payment=${paymentId}`,
      success_url: `${origin}/premium?payment=${paymentId}`,
    }),
  });
  if (!res.ok) return { error: `moyasar ${res.status}` };
  const json = (await res.json()) as { url?: string; id?: string };
  return { url: json.url, externalId: json.id };
}

async function tapCharge(amountSar: number, title: string, paymentId: string, origin: string, email: string | null) {
  const key = process.env.TAP_SECRET_KEY;
  if (!key) return null;
  const res = await fetch("https://api.tap.company/v2/charges", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: amountSar,
      currency: "SAR",
      description: title,
      customer: { email: email || "guest@lamma.play", first_name: "Lamma" },
      source: { id: "src_all" },
      redirect: { url: `${origin}/premium?payment=${paymentId}` },
      metadata: { paymentId },
    }),
  });
  if (!res.ok) return { error: `tap ${res.status}` };
  const json = (await res.json()) as { transaction?: { url?: string }; id?: string };
  return { url: json.transaction?.url, externalId: json.id };
}

export async function checkoutNow(
  input: { planId: string; provider: string; promo: string; origin: string },
  ctx: Ctx,
): Promise<
  | { ok: false; error: string }
  | { ok: true; status: "paid" | "redirect" | "needs_provider"; url?: string; paymentId: string }
> {
  if (!ctx.userId) return { ok: false, error: "ASK_SIGNIN" };
  const sql = await getSql();
  await ready(sql);
  const plans = await sql<{ id: string; name_ar: string; price_sar: number; interval_unit: string }>`select id, name_ar, price_sar, interval_unit from plans where id = ${input.planId} and active = true`;
  const plan = plans[0];
  if (!plan || plan.interval_unit === "free") return { ok: false, error: "BAD_INPUT" };
  let amount = num(plan.price_sar);
  let promoCode: string | null = null;
  if (input.promo) {
    const { redeemNow } = await import("./engine.server");
    const promo = await redeemNow({ promo: input.promo }, ctx);
    if (!promo.ok) return promo;
    if (promo.kind === "days" || promo.kind === "lifetime") {
      const paymentId = hex();
      await sql`insert into payments (id, user_id, plan_id, provider, amount_sar, status, promo_code) values (${paymentId}, ${ctx.userId}, ${plan.id}, 'promo', 0, 'paid', ${input.promo.toUpperCase()})`;
      return { ok: true, status: "paid", paymentId };
    }
    if (promo.discount > 0) {
      amount = Math.max(0, Math.round(amount * (100 - promo.discount) / 100));
      promoCode = input.promo.toUpperCase();
    }
  }
  const paymentId = hex();
  if (amount <= 0) {
    await grantPlan(ctx.userId, plan.id, "promo", endsFor(plan.interval_unit));
    await sql`insert into payments (id, user_id, plan_id, provider, amount_sar, status, promo_code) values (${paymentId}, ${ctx.userId}, ${plan.id}, 'promo', 0, 'paid', ${promoCode})`;
    return { ok: true, status: "paid", paymentId };
  }
  const origin = input.origin.replace(/\/$/, "");
  const provider = input.provider === "moyasar" || input.provider === "tap" ? input.provider : "stripe";
  const session =
    provider === "moyasar"
      ? await moyasarInvoice(amount, plan.name_ar, paymentId, origin)
      : provider === "tap"
        ? await tapCharge(amount, plan.name_ar, paymentId, origin, ctx.email)
        : await stripeSession(amount, plan.name_ar, paymentId, origin);
  if (!session) {
    await sql`insert into payments (id, user_id, plan_id, provider, amount_sar, status, promo_code, meta) values (${paymentId}, ${ctx.userId}, ${plan.id}, ${provider}, ${amount}, 'needs_provider', ${promoCode}, ${JSON.stringify({ hint: "Set the provider secret on the host" })}::jsonb)`;
    return { ok: true, status: "needs_provider", paymentId };
  }
  if ("error" in session && session.error) {
    await sql`insert into payments (id, user_id, plan_id, provider, amount_sar, status, promo_code, meta) values (${paymentId}, ${ctx.userId}, ${plan.id}, ${provider}, ${amount}, 'failed', ${promoCode}, ${JSON.stringify({ error: session.error })}::jsonb)`;
    return { ok: false, error: "PAY_FAILED" };
  }
  await sql`insert into payments (id, user_id, plan_id, provider, amount_sar, status, promo_code, external_id) values (${paymentId}, ${ctx.userId}, ${plan.id}, ${provider}, ${amount}, 'pending', ${promoCode}, ${session.externalId ?? null})`;
  if (!session.url) return { ok: true, status: "needs_provider", paymentId };
  return { ok: true, status: "redirect", url: session.url, paymentId };
}

export async function markPaymentPaid(paymentId: string): Promise<boolean> {
  const sql = await getSql();
  await ready(sql);
  const rows = await sql<{ id: string; user_id: string | null; plan_id: string; status: string }>`select id, user_id, plan_id, status from payments where id = ${paymentId}`;
  const payment = rows[0];
  if (!payment || payment.status === "paid" || !payment.user_id) return false;
  const plans = await sql<{ interval_unit: string }>`select interval_unit from plans where id = ${payment.plan_id}`;
  await grantPlan(payment.user_id, payment.plan_id, "payment", endsFor(plans[0]?.interval_unit ?? "month"));
  await sql`update payments set status = 'paid' where id = ${paymentId}`;
  return true;
}

export async function handleWebhook(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") || "stripe";
  const raw = await request.text();
  if (provider === "stripe") {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const header = request.headers.get("stripe-signature");
    if (!secret || !header || !verifyStripe(raw, header, secret)) {
      return new Response("invalid signature", { status: 400 });
    }
    const event = JSON.parse(raw) as { type?: string; data?: { object?: { client_reference_id?: string; payment_status?: string } } };
    if (event.type === "checkout.session.completed" && event.data?.object?.payment_status === "paid") {
      const id = event.data.object.client_reference_id;
      if (id) await markPaymentPaid(id);
    }
    return new Response("ok");
  }
  return new Response("ignored", { status: 202 });
}

function verifyStripe(payload: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const idx = part.indexOf("=");
      return [part.slice(0, idx), part.slice(idx + 1)];
    }),
  );
  const signed = `${parts.t}.${payload}`;
  const expected = createHmac("sha256", secret).update(signed).digest("hex");
  const given = parts.v1 ?? "";
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
