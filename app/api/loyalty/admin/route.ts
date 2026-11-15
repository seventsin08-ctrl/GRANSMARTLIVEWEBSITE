import { env } from "@/lib/platform";
import { NextResponse } from "next/server";
import { getAdminSession, hasAdminSession, isFullAdmin } from "../../admin/session";
import { cardHash, loyaltyConfig, readSettings } from "../core";

const randomCode=()=>{const alphabet="23456789ABCDEFGHJKLMNPQRSTUVWXYZ";const bytes=crypto.getRandomValues(new Uint8Array(10));return "MOSS-"+Array.from(bytes,x=>alphabet[x%alphabet.length]).join("")};
export async function GET(){
 const session=await getAdminSession();if(!session||!(isFullAdmin(session)||session.permissions.includes("loyalty")||session.permissions.includes("loyalty_manage")))return NextResponse.json({error:"Loyalty access is not enabled for this account."},{status:403});
 const db=env.DB!;const cards=await db.prepare("SELECT id,suffix,points,active,created_at FROM loyalty_cards ORDER BY created_at DESC LIMIT 500").all();const events=await db.prepare("SELECT e.id,e.card_id,e.order_id,e.kind,e.amount,e.reason,e.actor,e.created_at,c.suffix FROM loyalty_events e JOIN loyalty_cards c ON c.id=e.card_id ORDER BY e.created_at DESC LIMIT 200").all();
 return NextResponse.json({cards:cards.results,events:events.results,config:loyaltyConfig(await readSettings(db)),products:(await db.prepare("SELECT p.id,p.name,c.name AS category FROM products p JOIN categories c ON c.id=p.category_id WHERE p.available=1 AND c.active=1 ORDER BY c.sort,p.name").all()).results,canManage:isFullAdmin(session)||session.permissions.includes("loyalty_manage")});
}
export async function POST(request:Request){
 const session=await getAdminSession();if(!session||!(isFullAdmin(session)||session.permissions.includes("loyalty")||session.permissions.includes("loyalty_manage")))return NextResponse.json({error:"Loyalty access is not enabled for this account."},{status:403});
 const body=await request.json().catch(()=>null);if(!body)return NextResponse.json({error:"Invalid request."},{status:400});const db=env.DB!;
 if(body.action==="issue") { const code=randomCode(),id=crypto.randomUUID(),created=new Date().toISOString();await db.prepare("INSERT INTO loyalty_cards (id,code_hash,suffix,points,active,created_at) VALUES (?,?,?,0,1,?)").bind(id,await cardHash(code),code.slice(-4),created).run();return NextResponse.json({ok:true,code,card:{id,suffix:code.slice(-4),points:0,active:1,created_at:created}}); }
 if(body.action==="deactivate"){await db.prepare("UPDATE loyalty_cards SET active=0 WHERE id=?").bind(String(body.id)).run();return NextResponse.json({ok:true});}
 if(body.action==="adjust"){
  if(!(isFullAdmin(session)||session.permissions.includes("loyalty_manage")))return NextResponse.json({error:"Only an authorized loyalty manager can adjust points."},{status:403});
  const amount=Math.trunc(Number(body.amount)),reason=String(body.reason||"").trim().slice(0,140);if(!Number.isInteger(amount)||amount===0||Math.abs(amount)>50||!reason)return NextResponse.json({error:"Enter a reason and a points adjustment from 1 to 50."},{status:400});
  const card=await db.prepare("SELECT points FROM loyalty_cards WHERE id=? AND active=1").bind(String(body.id)).first<any>();if(!card)return NextResponse.json({error:"Active card not found."},{status:404});if(Number(card.points)+amount<0)return NextResponse.json({error:"The adjustment cannot reduce points below zero."},{status:409});
  await db.batch([db.prepare("UPDATE loyalty_cards SET points=points+? WHERE id=? AND active=1").bind(amount,String(body.id)),db.prepare("INSERT INTO loyalty_events (id,card_id,order_id,kind,amount,reason,actor,created_at) SELECT ?,?,NULL,'adjust',?,?,?,? WHERE changes()=1").bind(crypto.randomUUID(),String(body.id),amount,reason,session.username,new Date().toISOString())]);return NextResponse.json({ok:true});
 }
 if(body.action==="settings"){
  if(!(isFullAdmin(session)||session.permissions.includes("loyalty_manage")))return NextResponse.json({error:"Only a loyalty manager can edit the program."},{status:403});
  const cfg=body.config||{};const active=await db.prepare("SELECT id FROM products WHERE available=1").all<any>();const valid=new Set(active.results.map((x:any)=>x.id));const settings={loyaltyEnabled:cfg.enabled?"true":"false",loyaltyRule:cfg.rule==="order"?"order":"drink",loyaltyPoints:String(Math.max(1,Math.min(10,Math.trunc(Number(cfg.points)||1)))),loyaltyThreshold:String(Math.max(1,Math.min(50,Math.trunc(Number(cfg.threshold)||5)))),loyaltyProducts:JSON.stringify(Array.isArray(cfg.eligible)?cfg.eligible.filter((x:string)=>valid.has(x)).slice(0,100):[]),loyaltyToppingsFree:cfg.toppingsFree?"true":"false",loyaltyPolicy:String(cfg.policy||"If you lose your loyalty card, purchase a new card. Points cannot be transferred.").slice(0,200)};
  for(const [key,value] of Object.entries(settings))await db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key,value).run();return NextResponse.json({ok:true});
 }
 return NextResponse.json({error:"Unknown loyalty action."},{status:400});
}
