import { env } from "@/lib/platform";
import { NextResponse } from "next/server";
import { makeSession } from "../../session";

async function ensureTable() {
  await env.DB!.prepare("CREATE TABLE IF NOT EXISTS admin_login_challenges (id TEXT PRIMARY KEY, username TEXT NOT NULL, requested_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL, code_hash TEXT, attempts INTEGER NOT NULL DEFAULT 0, approved_by TEXT, used_at INTEGER)").run();
}

async function codeHash(id: string, code: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${env.ADMIN_SESSION_SECRET}:${id}:${code}`));
  return Array.from(new Uint8Array(bytes)).map(x => x.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  if (!env.DB || !env.ADMIN_SESSION_SECRET) return NextResponse.json({ error: "Admin sign-in is not configured." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const id = String(body?.challengeId || "");
  const code = String(body?.code || "").trim().toUpperCase();
  const rememberDevice = body?.rememberDevice === true;
  if (!id || !/^[A-HJ-NP-Z2-9]{5}$/.test(code)) return NextResponse.json({ error: "Enter the five-character code from your Owner/Superadmin." }, { status: 400 });
  await ensureTable();
  const now = Date.now();
  const challenge = await env.DB.prepare("SELECT username,status,expires_at,code_hash,attempts FROM admin_login_challenges WHERE id=?").bind(id).first<any>();
  if (!challenge || challenge.status !== "approved" || challenge.expires_at <= now || challenge.attempts >= 5) return NextResponse.json({ error: "This sign-in code has expired or is no longer available. Ask your admin to approve a new sign-in." }, { status: 401 });

  const submittedHash = await codeHash(id, code);
  let mismatch = submittedHash.length ^ String(challenge.code_hash || "").length;
  for (let i = 0; i < submittedHash.length; i++) mismatch |= submittedHash.charCodeAt(i) ^ String(challenge.code_hash || "").charCodeAt(i);
  if (mismatch !== 0) {
    await env.DB.prepare("UPDATE admin_login_challenges SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'locked' ELSE status END WHERE id=? AND status='approved' AND attempts<5").bind(id).run();
    return NextResponse.json({ error: "That code did not match. Five incorrect codes cancel this sign-in." }, { status: 401 });
  }

  const consumed = await env.DB.prepare("UPDATE admin_login_challenges SET status='used',used_at=? WHERE id=? AND status='approved' AND expires_at>? AND attempts<5 AND code_hash=?").bind(now, id, now, submittedHash).run();
  if (!consumed.meta.changes) return NextResponse.json({ error: "This code was already used or expired. Ask your admin to approve a new sign-in." }, { status: 401 });
  const staff = await env.DB.prepare("SELECT username,role,permissions,active FROM staff WHERE username=?").bind(challenge.username).first<any>();
  if (!staff?.active) return NextResponse.json({ error: "This staff account is no longer active." }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("moss_admin", await makeSession({ username: staff.username, role: staff.role, permissions: JSON.parse(staff.permissions) }, rememberDevice), { httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "lax", path: "/", maxAge: rememberDevice ? 30 * 24 * 60 * 60 : 8 * 60 * 60 });
  return response;
}
