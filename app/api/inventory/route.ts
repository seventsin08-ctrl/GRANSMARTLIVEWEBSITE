import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getAdminSession, hasAdminSession, isFullAdmin } from "../admin/session";

export async function GET(){
 const session=await getAdminSession();if(!session||!(isFullAdmin(session)||session.permissions.includes("inventory")))return NextResponse.json({error:"Inventory access is not enabled for this account."},{status:403});
 const db=env.DB!;const products=await db.prepare("SELECT id,name,available,track_stock,stock_qty,stock_unit,low_threshold FROM products ORDER BY name").all<any>();const moves=await db.prepare("SELECT m.*,p.name AS product_name FROM inventory_movements m JOIN products p ON p.id=m.product_id ORDER BY m.created_at DESC LIMIT 200").all();
 return NextResponse.json({products:products.results,low:products.results.filter((p:any)=>p.track_stock&&p.low_threshold>0&&p.stock_qty<=p.low_threshold),movements:moves.results});
}
export async function POST(request:Request){
 if(!await hasAdminSession("inventory"))return NextResponse.json({error:"Inventory access is not enabled for this account."},{status:403});const body=await request.json().catch(()=>null);if(!body)return NextResponse.json({error:"Invalid request."},{status:400});const db=env.DB!,id=String(body.id||""),now=new Date().toISOString();
 if(body.action==="tracking"){
  const tracked=!!body.tracked,qty=Math.max(0,Math.min(100000,Math.trunc(Number(body.quantity)||0))),threshold=Math.max(0,Math.min(100000,Math.trunc(Number(body.threshold)||0))),unit=String(body.unit||"each").trim().slice(0,20)||"each",reason=String(body.reason||"").trim().slice(0,120);
  const current=await db.prepare("SELECT track_stock,stock_qty FROM products WHERE id=?").bind(id).first<any>();if(!current)return NextResponse.json({error:"Product not found."},{status:404});
  if(tracked&&!current.track_stock&&!reason)return NextResponse.json({error:"Add a reason for the opening stock count."},{status:400});
  await db.batch([db.prepare("UPDATE products SET track_stock=?,stock_qty=?,stock_unit=?,low_threshold=? WHERE id=?").bind(tracked?1:0,tracked?(current.track_stock?Number(current.stock_qty):qty):Number(current.stock_qty),unit,threshold,id),...(tracked&&!current.track_stock?[db.prepare("INSERT INTO inventory_movements (id,product_id,order_id,kind,qty_delta,reason,actor,created_at) VALUES (?,?,NULL,'opening',?,?,?,?)").bind(crypto.randomUUID(),id,qty,reason,(await getAdminSession())?.username||"staff",now)]:[])]);
  return NextResponse.json({ok:true});
 }
 if(body.action==="adjust"){
  const delta=Math.trunc(Number(body.delta)),reason=String(body.reason||"").trim().slice(0,120);if(!Number.isInteger(delta)||delta===0||Math.abs(delta)>100000||!reason)return NextResponse.json({error:"Enter a reason and a quantity change."},{status:400});
  const result=await db.batch([db.prepare("UPDATE products SET stock_qty=stock_qty+? WHERE id=? AND track_stock=1 AND stock_qty+?>=0").bind(delta,id,delta),db.prepare("INSERT INTO inventory_movements (id,product_id,order_id,kind,qty_delta,reason,actor,created_at) SELECT ?,?,NULL,'adjust',?,?,?,? WHERE changes()=1").bind(crypto.randomUUID(),id,delta,reason,(await getAdminSession())?.username||"staff",now)]);
  if(!result[0].meta.changes)return NextResponse.json({error:"Stock did not change. Check tracking and make sure the count stays at zero or above."},{status:409});return NextResponse.json({ok:true});
 }
 return NextResponse.json({error:"Unknown inventory action."},{status:400});
}
