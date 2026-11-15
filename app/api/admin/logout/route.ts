import { NextResponse } from "next/server";
export async function POST(request:Request) { const response = NextResponse.json({ ok: true }); response.cookies.set("moss_admin", "", { httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "lax", path: "/", maxAge: 0 }); return response; }
