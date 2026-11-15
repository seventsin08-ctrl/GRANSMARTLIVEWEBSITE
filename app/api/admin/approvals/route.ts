import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getAdminSession, isSuperAdmin } from "../session";

async function ensureTable() {
  await env.DB!.prepare("CREATE TABLE IF NOT EXISTS admin_login_challenges (id TEXT PRIMARY KEY, username TEXT NOT NULL, requested_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL, code_hash TEXT, attempts INTEGER NOT NULL DEFAULT 0, approved_by TEXT, used_at INTEGER)").run();
}

async function codeHash(id: string, code: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${env.ADMIN_SESSION_SECRET}:${id}:${code}`));
  return Array.from(new Uint8Array(bytes)).map(x => x.toString(16).padStart(2, "0")).join("");
}

export async function GET() {
  const session = await getAdminSession();
  if (!session || !isSuperAdmin(session)) return NextResponse.json({ error: "Only an owner/superadmin can review staff sign-ins." }, { status: 403 });
  if (!env.DB || !env.ADMIN_SESSION_SECRET) return NextResponse.json({ error: "Admin sign-in is not configured." }, { status: 503 });
  await ensureTable();
  const now = Date.now();
  await env.DB.prepare("UPDATE admin_login_challenges SET status='expired' WHERE status IN ('pending','approved') AND expires_at<=?").bind(now).run();
  const requests = await env.DB.prepare("SELECT id,username,requested_at,expires_at FROM admin_login_challenges WHERE status='pending' AND expires_at>? ORDER BY requested_at").bind(now).all();
  return NextResponse.json({ requests: requests.results }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session || !isSuperAdmin(session)) return NextResponse.json({ error: "Only an owner/superadmin can review staff sign-ins." }, { status: 403 });
  if (!env.DB || !env.ADMIN_SESSION_SECRET) return NextResponse.json({ error: "Admin sign-in is not configured." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const id = String(body?.id || "");
  if (!id) return NextResponse.json({ error: "A sign-in request is required." }, { status: 400 });
  await ensureTable();
  const now = Date.now();
  const challenge = await env.DB.prepare("SELECT id,username,status,expires_at FROM admin_login_challenges WHERE id=?").bind(id).first<any>();
  if (!challenge || challenge.status !== "pending" || challenge.expires_at <= now) return NextResponse.json({ error: "That sign-in request has expired or was already reviewed." }, { status: 409 });

  if (body.action === "reject") {
    await env.DB.prepare("UPDATE admin_login_challenges SET status='rejected',approved_by=? WHERE id=? AND status='pending'").bind(session.username, id).run();
    return NextResponse.json({ ok: true });
  }
  if (body.action !== "approve") return NextResponse.json({ error: "Choose approve or reject." }, { status: 400 });
  const staff = await env.DB.prepare("SELECT active FROM staff WHERE username=?").bind(challenge.username).first<any>();
  if (!staff?.active) return NextResponse.json({ error: "This staff account is no longer active." }, { status: 409 });
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = crypto.getRandomValues(new Uint8Array(5));
  const code = Array.from(random, byte => alphabet[byte % alphabet.length]).join("");
  const hash = await codeHash(id, code);
  const expiresAt = now + 5 * 60 * 1000;
  const result = await env.DB.prepare("UPDATE admin_login_challenges SET status='approved',code_hash=?,attempts=0,approved_by=?,expires_at=? WHERE id=? AND status='pending' AND expires_at>?").bind(hash, session.username, expiresAt, id, now).run();
  if (!result.meta.changes) return NextResponse.json({ error: "That sign-in request has expired or was already reviewed." }, { status: 409 });
  return NextResponse.json({ ok: true, username: challenge.username, code, expiresAt }, { headers: { "Cache-Control": "no-store" } });
}
