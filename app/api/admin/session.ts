import { env } from "cloudflare:workers";
import { headers } from "next/headers";

const enc = new TextEncoder();
function b64(value: Uint8Array) { return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function unb64(value: string) { return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0)); }
async function sign(value: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(env.ADMIN_SESSION_SECRET || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value))));
}
export type AdminClaims = { username: string; role: string; permissions: string[]; owner?: boolean };
export function isSuperAdmin(user: { username?: string; role?: string; owner?: boolean } | null | undefined) {
  return !!user && (user.owner === true || user.role === "Owner/Superadmin");
}
export function isFullAdmin(user: { username?: string; role?: string; owner?: boolean } | null | undefined) {
  return isSuperAdmin(user) || user?.role === "Admin" || user?.role === "Owner/Admin";
}
export async function makeSession(user: AdminClaims, rememberDevice = false) {
  const payload = b64(enc.encode(JSON.stringify({ ...user, exp: Date.now() + (rememberDevice ? 30 : 8) * 24 * 60 * 60 * 1000 })));
  return `${payload}.${await sign(payload)}`;
}
export async function getAdminSession() {
  const token = (await headers()).get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith("moss_admin="))?.slice("moss_admin=".length);
  if (!token || !env.ADMIN_SESSION_SECRET) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await sign(payload);
  if (signature.length !== expected.length) return null;
  let mismatch = 0; for (let i = 0; i < signature.length; i++) mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  if (mismatch) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(unb64(payload)));
    if (claims.exp <= Date.now()) return null;
    if (claims.owner !== true) {
      if (!env.DB) return null;
      const current = await env.DB.prepare("SELECT role,permissions,active FROM staff WHERE username=?").bind(claims.username).first<any>();
      if (!current || !current.active) return null;
      const role = current.role === "Owner/Admin" ? "Admin" : ["Counter", "Kitchen", "Custom"].includes(current.role) ? "Staff" : current.role;
      return { username: claims.username, role, permissions: JSON.parse(current.permissions) };
    }
    return (claims.owner === true ? { ...claims, role: "Owner/Superadmin" } : claims) as AdminClaims;
  } catch { return null; }
}
export async function hasAdminSession(permission?: string) { const session = await getAdminSession(); return !!session && (isFullAdmin(session) || !permission || session.permissions.includes(permission)); }
