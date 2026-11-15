import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "../admin/session";

export async function GET(request:Request){
  if(!env.BUCKET)return new Response("Image storage unavailable",{status:404});
  const key=new URL(request.url).searchParams.get("key")||""; if(!/^(brand|menu)\/[a-z0-9-]+\.(png|jpe?g|webp|gif)$/i.test(key))return new Response("Not found",{status:404});
  const obj=await env.BUCKET.get(key); if(!obj)return new Response("Not found",{status:404});
  return new Response(obj.body,{headers:{"Content-Type":obj.httpMetadata?.contentType||"image/jpeg","Cache-Control":"public, max-age=86400"}});
}
export async function POST(request:Request){
  if(!await hasAdminSession("branding")&&!await hasAdminSession("products"))return NextResponse.json({error:"Sign in with branding or product access to upload images."},{status:403});
  if(!env.BUCKET)return NextResponse.json({error:"Image storage is not configured."},{status:503});
  const form=await request.formData();const file=form.get("file");const group=form.get("group")==="menu"?"menu":"brand";
  if(!(file instanceof File)||!file.type.startsWith("image/")||file.size>5*1024*1024)return NextResponse.json({error:"Choose an image up to 5 MB."},{status:400});
  const ext=file.type==="image/png"?"png":file.type==="image/webp"?"webp":file.type==="image/gif"?"gif":"jpg";const key=`${group}/${crypto.randomUUID()}.${ext}`;
  await env.BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type}});
  return NextResponse.json({url:`/api/assets?key=${encodeURIComponent(key)}`});
}
