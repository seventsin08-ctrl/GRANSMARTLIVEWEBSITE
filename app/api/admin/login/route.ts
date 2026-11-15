import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { makeSession } from "../session";

export async function POST(request: Request) {
  if (!env.DB || !env.ADMIN_PASSWORD_HASH || !env.ADMIN_SESSION_SECRET) return NextResponse.json({ error: "Admin sign-in is not configured." }, { status: 503 });
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const ipHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip)))).map(x => x.toString(16).padStart(2, "0")).join("");
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE ip_hash = ? AND succeeded=0 AND attempted_at > ?").bind(ipHash, Date.now() - 15 * 60 * 1000).first<{ n: number }>();
  if ((recent?.n || 0) >= 8) return NextResponse.json({ error: "Too many tries. Wait 15 minutes and try again." }, { status: 429 });
  const { password, username, rememberDevice } = await request.json().catch(() => ({ password: "", username: "", rememberDevice: false }));
  const normalizedUsername = String(username || "").trim().toLowerCase();
  if (!normalizedUsername) return NextResponse.json({ error: "Enter your username." }, { status: 400 });
  const staff = normalizedUsername === "admin" ? null : await env.DB.prepare("SELECT username,password_hash,role,permissions FROM staff WHERE username=? AND active=1").bind(normalizedUsername).first<any>();
  const hash = normalizedUsername === "admin" ? env.ADMIN_PASSWORD_HASH : staff?.password_hash;
  const [kind, salt, stored] = String(hash || "").split("$");
  let valid = false;
  if (kind === "pbkdf2-sha256" && salt && stored) {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password || "")), "PBKDF2", false, ["deriveBits"]);
    const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Uint8Array.from(salt.match(/.{2}/g) || [], x => parseInt(x, 16)), iterations: 100000, hash: "SHA-256" }, material, 256));
    const actual = Array.from(derived).map(x => x.toString(16).padStart(2, "0")).join("");
    valid = actual.length === stored.length && actual === stored;
  }
  await env.DB.prepare("INSERT INTO login_attempts (ip_hash, attempted_at, succeeded) VALUES (?, ?, ?)").bind(ipHash, Date.now(), valid ? 1 : 0).run();
  if (!valid) return NextResponse.json({ error: "That username or password did not match." }, { status: 401 });
  await env.DB.prepare("DELETE FROM login_attempts WHERE attempted_at < ?").bind(Date.now() - 24 * 60 * 60 * 1000).run();
  if (staff) {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_login_challenges (id TEXT PRIMARY KEY, username TEXT NOT NULL, requested_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL, code_hash TEXT, attempts INTEGER NOT NULL DEFAULT 0, approved_by TEXT, used_at INTEGER)").run();
    const now = Date.now();
    await env.DB.prepare("UPDATE admin_login_challenges SET status='replaced' WHERE username=? AND status IN ('pending','approved')").bind(staff.username).run();
    const challengeId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO admin_login_challenges (id,username,requested_at,expires_at,status) VALUES (?,?,?,?,'pending')").bind(challengeId, staff.username, now, now + 10 * 60 * 1000).run();
    return NextResponse.json({ ok: true, requiresApproval: true, challengeId, message: "Your password is correct. An admin must approve this sign-in and give you its one-time code." }, { headers: { "Cache-Control": "no-store" } });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("moss_admin", await makeSession(staff ? {username: staff.username, role: staff.role, permissions: JSON.parse(staff.permissions)} : {username: "admin", role: "Owner/Superadmin", permissions: ["orders","kitchen","payment","products","categories","branding","reports","attendance","schedule","attendance_manage","schedule_manage","loyalty","loyalty_manage","inventory","cash_remits","cash_remits_manage","expenses","expenses_manage","profit"], owner:true}, !!rememberDevice), { httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "lax", path: "/", maxAge: rememberDevice ? 30 * 24 * 60 * 60 : 8 * 60 * 60 });
  return response;
}
