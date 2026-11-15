import { env } from "@/lib/platform";
import { NextResponse } from "next/server";
import { cardHash, loyaltyConfig, readSettings } from "./core";

export async function POST(request:Request){
 if(!env.DB)return NextResponse.json({error:"Loyalty service is unavailable."},{status:503});const body=await request.json().catch(()=>({}));const code=String(body.code||"").trim();if(!/^MOSS-[23456789A-HJ-NP-Z]{10}$/i.test(code))return NextResponse.json({error:"Enter the code printed on your card."},{status:400});
 const hash=await cardHash(code);const card=await env.DB.prepare("SELECT id,points,active FROM loyalty_cards WHERE code_hash=?").bind(hash).first<any>();if(!card||!card.active)return NextResponse.json({error:"That card code wasn’t found or is inactive."},{status:404});const config=loyaltyConfig(await readSettings(env.DB));
 return NextResponse.json({points:card.points,threshold:config.threshold,eligibleProducts:config.eligible,rewardAvailable:config.enabled&&card.points>=config.threshold,toppingsFree:config.toppingsFree},{headers:{"Cache-Control":"no-store"}});
}
