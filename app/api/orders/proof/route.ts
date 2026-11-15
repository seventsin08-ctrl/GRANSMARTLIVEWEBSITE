import { env } from "@/lib/platform";
import { NextResponse } from "next/server";
import { getAdminSession, hasAdminSession } from "../../admin/session";

const allowedTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session || !(await hasAdminSession("orders")) && !(await hasAdminSession("payment"))) {
    return new Response("Sign in with order or payment access to view this proof.", { status: 403 });
  }
  if (!env.DB || !env.BUCKET) return new Response("Payment proof storage is unavailable.", { status: 503 });
  const orderId = new URL(request.url).searchParams.get("orderId") || "";
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return new Response("Not found", { status: 404 });
  const order = await env.DB.prepare("SELECT details FROM orders WHERE id=?").bind(orderId).first<{ details: string }>();
  if (!order) return new Response("Not found", { status: 404 });
  let key = "";
  try { key = String(JSON.parse(order.details || "{}").paymentProofKey || ""); } catch {}
  if (!key || !key.startsWith(`proofs/${orderId}.`) || !/^proofs\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(key)) {
    return new Response("No proof was attached to this order.", { status: 404 });
  }
  const object = await env.BUCKET.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline; filename=payment-proof",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
