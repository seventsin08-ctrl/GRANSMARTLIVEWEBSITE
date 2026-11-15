import { env, clientIp } from "@/lib/platform";
import { NextResponse } from "next/server";

async function signOrderTrackingToken(id: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.ADMIN_SESSION_SECRET || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`grain-order:${id}`)));
  return btoa(String.fromCharCode(...signature)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function POST(request: Request) {
  if (!env.DB || !env.ADMIN_SESSION_SECRET) return NextResponse.json({ error: "Order tracking is unavailable." }, { status: 503 });
  const { code } = await request.json().catch(() => ({ code: "" }));
  const number = String(code || "").trim().replace(/^#/, "");
  if (!/^\d{4}$/.test(number)) return NextResponse.json({ error: "Enter the four digit code shown on your receipt." }, { status: 400 });
  const ip = clientIp(request);
  const ipHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip)))).map(x => x.toString(16).padStart(2, "0")).join("");
  const now = Date.now();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS order_tracking_attempts (ip_hash TEXT NOT NULL, attempted_at INTEGER NOT NULL)").run();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM order_tracking_attempts WHERE ip_hash=? AND attempted_at>? ").bind(ipHash, now - 15 * 60 * 1000).first<{ n: number }>();
  if ((recent?.n || 0) >= 8) return NextResponse.json({ error: "Too many tries. Wait 15 minutes before trying again." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  const orders = await env.DB.prepare("SELECT id,number,status,method,items,total,payment_method,created_at FROM orders WHERE number=? LIMIT 2").bind(number).all<any>();
  if (orders.results.length !== 1) {
    await env.DB.prepare("INSERT INTO order_tracking_attempts (ip_hash,attempted_at) VALUES (?,?)").bind(ipHash, now).run();
    return NextResponse.json({ error: "We couldn’t find one order with that code. Check the receipt and try again." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const order = orders.results[0];
  let storedItems: any[] = [];
  try { storedItems = JSON.parse(order.items || "[]"); } catch { storedItems = []; }
  const productIds=[...new Set(storedItems.map((item:any)=>String(item.id||"")).filter(Boolean))];
  const images=productIds.length?await env.DB.prepare(`SELECT id,image FROM products WHERE id IN (${productIds.map(()=>"?").join(",")})`).bind(...productIds).all<any>():{results:[]};
  const imageById=new Map(images.results.map((item:any)=>[item.id,item.image]));
  const items = storedItems.map((item: any) => {
    const customization = item.customization || {};
    const optionDetails=Object.entries(customization.options||{}).map(([group,value])=>`${group}: ${Array.isArray(value)?value.join(", "):value}`);
    const detail = [...optionDetails,...(optionDetails.length?[]:[customization.size && customization.size !== "Regular" ? customization.size : "", customization.sugar || "", ...(Array.isArray(customization.toppings) ? customization.toppings : [])])].filter(Boolean).join(" · ");
    return { name: String(item.name || "Item"), qty: Number(item.qty || 0), unitPrice: Number(item.unit ?? item.unitPrice ?? 0), image:String(item.image||imageById.get(String(item.id||""))||""), detail };
  });
  const trackingToken = await signOrderTrackingToken(order.id);
  return NextResponse.json({ id: order.id, number: order.number, status: order.status, method: order.method, payment: order.payment_method, total: Number(order.total || 0), createdAt: order.created_at, items, trackingToken }, { headers: { "Cache-Control": "no-store" } });
}
