import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";

async function signOrderTrackingToken(id: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.ADMIN_SESSION_SECRET || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`grain-order:${id}`)));
  return btoa(String.fromCharCode(...signature)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function GET(request: Request) {
  if (!env.DB || !env.ADMIN_SESSION_SECRET) return NextResponse.json({ error: "Order tracking is unavailable." }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const id = String(params.get("id") || "");
  const token = String(params.get("token") || "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !token) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  const expected = await signOrderTrackingToken(id);
  let mismatch = expected.length ^ token.length;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ (token.charCodeAt(i) || 0);
  if (mismatch) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  const order = await env.DB.prepare("SELECT number,status,method FROM orders WHERE id=?").bind(id).first<any>();
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  return NextResponse.json({ number: order.number, status: order.status, method: order.method }, { headers: { "Cache-Control": "no-store" } });
}
