import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { cardHash, loyaltyConfig, readSettings } from "../loyalty/core";
import { ensureFinanceSchema } from "../finance/core";
import { ensureProductOptionsColumn, parseMenuOptions } from "../../../lib/menu-options";

async function signOrderTrackingToken(id: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.ADMIN_SESSION_SECRET || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`grain-order:${id}`)));
  return btoa(String.fromCharCode(...signature)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function POST(request: Request) {
  if (!env.DB) return NextResponse.json({ error: "Order service unavailable." }, { status: 503 });
  let body: any = null;
  let paymentProof: File | null = null;
  if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      body = JSON.parse(String(form.get("order") || ""));
      const file = form.get("paymentProof");
      if (file instanceof File && file.size > 0) paymentProof = file;
    } catch { body = null; }
  } else body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.items) || !body.items.length || body.items.length > 40) return NextResponse.json({ error: "Please add an item to your order." }, { status: 400 });
  const db=env.DB;await ensureFinanceSchema(db);await ensureProductOptionsColumn(db);const settings=await readSettings(db);const loyalty=loyaltyConfig(settings);
  const catalog = await db.prepare("SELECT p.id,p.name,p.price,p.available,p.track_stock,p.stock_qty,p.custom_options,pc.unit_cost,c.name AS category FROM products p JOIN categories c ON c.id=p.category_id LEFT JOIN product_costs pc ON pc.product_id=p.id WHERE p.available=1 AND c.active=1").all<any>();
  const lookup = new Map(catalog.results.map((p:any)=>[p.id,p]));const eligible=new Set(loyalty.eligible);
  let card:any=null;const code=String(body.loyaltyCode||"").trim();
  if(code){if(!loyalty.enabled)return NextResponse.json({error:"The shop loyalty program is currently paused."},{status:409});if(!/^MOSS-[23456789A-HJ-NP-Z]{10}$/i.test(code))return NextResponse.json({error:"Enter the code printed on your card."},{status:400});card=await db.prepare("SELECT id,points,active FROM loyalty_cards WHERE code_hash=?").bind(await cardHash(code)).first<any>();if(!card||!card.active)return NextResponse.json({error:"That card code wasn’t found or is inactive."},{status:404});}
  const redeem=body.redeem===true;const rewardId=String(body.rewardProductId||"");
  if(redeem&&(!card||!loyalty.enabled||Number(card.points)<loyalty.threshold))return NextResponse.json({error:`A valid card with at least ${loyalty.threshold} points is needed for a free drink.`},{status:409});
  if(redeem&&(!eligible.has(rewardId)||!body.items.some((x:any)=>String(x.id)===rewardId)))return NextResponse.json({error:"Choose an eligible drink in your basket to redeem."},{status:400});
  let total=0;const items:any[]=[];const requested:any={};
  for(const row of body.items){
    const product=lookup.get(String(row.id));const qty=Math.max(1,Math.min(20,Math.floor(Number(row.qty)||1)));
    if(!product)return NextResponse.json({error:"One item is no longer available. Please review your basket."},{status:409});
    if(product.track_stock)requested[product.id]=(requested[product.id]||0)+qty;
    const isTea=product.category==="Milk Tea";const optionGroups=parseMenuOptions(product.custom_options);let optionCost=0;let selectedOptions:any={};
    if(optionGroups.length){const submitted=row.customization?.options||{};for(const group of optionGroups){const choices=new Map(group.choices.map(choice=>[choice.name,choice.price]));const selected=group.multiple?(Array.isArray(submitted[group.name])?submitted[group.name]:[]):(typeof submitted[group.name]==="string"?submitted[group.name]:"");if(group.required&&(group.multiple?!selected.length:!selected))return NextResponse.json({error:`Choose an option for ${product.name}: ${group.name}.`},{status:400});if(group.multiple){const unique=[...new Set(selected)].slice(0,group.choices.length);for(const name of unique){if(!choices.has(name))return NextResponse.json({error:`Refresh the menu and choose valid ${group.name} for ${product.name}.`},{status:400});optionCost+=choices.get(name)!;}selectedOptions[group.name]=unique;}else if(selected){if(!choices.has(selected))return NextResponse.json({error:`Refresh the menu and choose a valid ${group.name} for ${product.name}.`},{status:400});optionCost+=choices.get(selected)!;selectedOptions[group.name]=selected;}}
    }
    const customization=optionGroups.length?{size:"Regular",sugar:"50%",toppings:[],options:selectedOptions}:isTea?{size:["Regular","Large"].includes(row.customization?.size)?row.customization.size:"Regular",sugar:["0%","25%","50%","75%","100%"].includes(row.customization?.sugar)?row.customization.sugar:"50%",toppings:Array.isArray(row.customization?.toppings)?row.customization.toppings.filter((t:string)=>["Pearls","Grass jelly","Cream foam"].includes(t)).slice(0,3):[]}:{size:"Regular",sugar:"50%",toppings:[]};
    const toppingCost=customization.toppings.length*20;const largeCost=customization.size==="Large"?25:0;const qualifies=loyalty.enabled&&eligible.has(product.id)&&isTea;
    const unitCost=product.unit_cost===null?null:Number(product.unit_cost);
    if(redeem&&product.id===rewardId){const paidAddOns=loyalty.toppingsFree?0:toppingCost;const rewardUnit=paidAddOns+optionCost;total+=rewardUnit;if(rewardUnit>0)items.push({id:product.id,name:product.name,image:product.image||"",qty:1,unit:rewardUnit,unitCost,customization,reward:true,eligible:false});else items.push({id:product.id,name:product.name,image:product.image||"",qty:1,unit:0,unitCost,customization,reward:true,eligible:false});if(qty>1){const regularUnit=Number(product.price)+toppingCost+largeCost+optionCost;total+=regularUnit*(qty-1);items.push({id:product.id,name:product.name,image:product.image||"",qty:qty-1,unit:regularUnit,unitCost,customization,eligible:qualifies});}}
    else{const unit=Number(product.price)+toppingCost+largeCost+optionCost;total+=unit*qty;items.push({id:product.id,name:product.name,image:product.image||"",qty,unit,unitCost,customization,eligible:qualifies});}
  }
  let method=String(body.method||"Pick Up").trim().slice(0,40);let methods:any[]=[];try{methods=JSON.parse(settings.methods||"[]")}catch{}
  if(!Array.isArray(methods)||!methods.length)methods=[{name:"Dine In",enabled:true,payment:"Pay at counter"},{name:"Pick Up",enabled:true,payment:"Pay on pickup"},{name:"Delivery",enabled:true,payment:"Cash on delivery"}];
  const selected=methods.find((m:any)=>String(m?.name||"").trim().toLowerCase()===method.toLowerCase()&&m.enabled);if(!selected)return NextResponse.json({error:"That order method is currently unavailable."},{status:409});method=String(selected.name).trim();
  let paymentOptions:any[]=[];try{paymentOptions=JSON.parse(settings.paymentOptions||"[]").filter((m:any)=>m?.enabled).slice(0,1)}catch{}
  const legacyPayment=paymentOptions.length?null:{name:String(selected.payment||(method==="Delivery"?"Cash on delivery":"Pay at counter")),enabled:true,acceptsProof:selected.acceptsProof===true};
  const paymentChoice=String(body.paymentChoice||legacyPayment?.name||"").trim().slice(0,40);const selectedPayment=paymentOptions.length?paymentOptions.find((m:any)=>m.enabled&&String(m.name).toLowerCase()===paymentChoice.toLowerCase()):legacyPayment;
  if(!selectedPayment)return NextResponse.json({error:"Please choose an available payment method."},{status:409});
  const detailsInput=body.details||{};const details:Record<string,string>={name:String(detailsInput.name||"").trim().slice(0,100),phone:String(detailsInput.phone||"").trim().slice(0,40),address:String(detailsInput.address||"").trim().slice(0,300),table:String(detailsInput.table||"").trim().slice(0,40),note:String(detailsInput.note||"").trim().slice(0,300)};
  if(method.toLowerCase().includes("delivery")&&(!details.address||!details.phone))return NextResponse.json({error:"Please provide a delivery address and contact number."},{status:400});if(method.toLowerCase().includes("dine")&&!details.table)return NextResponse.json({error:"Please enter a table number."},{status:400});if(!details.name||!details.phone)return NextResponse.json({error:"Please provide your name and contact number."},{status:400});
  const acceptsProof=selectedPayment.acceptsProof===true;const proofTypes:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
  if(paymentProof&&!acceptsProof)return NextResponse.json({error:"This payment method does not accept proof images."},{status:400});
  if(paymentProof&&(!proofTypes[paymentProof.type]||paymentProof.size>5*1024*1024))return NextResponse.json({error:"Choose a JPG, PNG, or WebP proof image up to 5 MB."},{status:400});
  if(paymentProof&&!env.BUCKET)return NextResponse.json({error:"Payment proof storage is unavailable. Please contact the shop."},{status:503});
  const id=crypto.randomUUID(),createdAt=new Date().toISOString(),pay=String(selectedPayment.name).slice(0,80);let number="";for(let attempt=0;attempt<50;attempt++){const candidate=Math.floor(1000+Math.random()*9000).toString();const existing=await db.prepare("SELECT 1 AS found FROM orders WHERE number=? LIMIT 1").bind(candidate).first();if(!existing){number=candidate;break}}if(!number)return NextResponse.json({error:"Order tracking codes are temporarily unavailable. Please ask the team for help."},{status:503});
  let proofKey="";if(paymentProof){proofKey=`proofs/${id}.${proofTypes[paymentProof.type]}`;try{await env.BUCKET!.put(proofKey,await paymentProof.arrayBuffer(),{httpMetadata:{contentType:paymentProof.type}});details.paymentProofKey=proofKey}catch{return NextResponse.json({error:"We couldn’t save the payment proof. Please try again."},{status:503});}}
  const stockIds=Object.keys(requested);for(const stockId of stockIds)if(Number(lookup.get(stockId)?.stock_qty)<requested[stockId])return NextResponse.json({error:`${lookup.get(stockId)?.name||"An item"} has limited stock. Please refresh the menu and adjust your order.`},{status:409});
  const insert=db.prepare("INSERT INTO orders (id,number,created_at,items,total,method,details,payment_method,paid,status,loyalty_card_id,reward_product_id,reward_applied,reward_points) SELECT ?,?,?,?,?,?,?,?,0,'new',?,?,?,? WHERE (SELECT COUNT(*) FROM inventory_movements WHERE order_id=? AND kind='reserve')=? AND (?=0 OR EXISTS (SELECT 1 FROM loyalty_events WHERE order_id=? AND kind='redeem'))").bind(id,number,createdAt,JSON.stringify(items),total,method,JSON.stringify(details),pay,card?.id||null,redeem?rewardId:null,redeem?1:0,redeem?loyalty.threshold:0,id,stockIds.length,redeem?1:0,id);
  try{
    const statements:any[]=[];
    for(const stockId of stockIds){const qty=requested[stockId];statements.push(db.prepare("UPDATE products SET stock_qty=stock_qty-? WHERE id=? AND available=1 AND track_stock=1 AND stock_qty>=?").bind(qty,stockId,qty));statements.push(db.prepare("INSERT OR IGNORE INTO inventory_movements (id,product_id,order_id,kind,qty_delta,reason,actor,created_at) SELECT ?,?,?,'reserve',?,?,?,? WHERE changes()=1").bind(crypto.randomUUID(),stockId,id,-qty,"Reserved at order confirmation","customer",createdAt));}
    if(redeem){statements.push(db.prepare("UPDATE loyalty_cards SET points=points-? WHERE id=? AND active=1 AND points>=?").bind(loyalty.threshold,card.id,loyalty.threshold));statements.push(db.prepare("INSERT OR IGNORE INTO loyalty_events (id,card_id,order_id,kind,amount,reason,actor,created_at) SELECT ?,?,?,'redeem',?,?,?,? WHERE changes()=1").bind(crypto.randomUUID(),card.id,id,-loyalty.threshold,`Free drink redemption · order #${number}`,"customer",createdAt));}
    const orderIndex=statements.length;statements.push(insert);
    for(const stockId of stockIds){statements.push(db.prepare("INSERT OR IGNORE INTO inventory_movements (id,product_id,order_id,kind,qty_delta,reason,actor,created_at) SELECT ?,product_id,order_id,'release',-qty_delta,'Order could not be saved','system',? FROM inventory_movements WHERE order_id=? AND product_id=? AND kind='reserve' AND NOT EXISTS (SELECT 1 FROM orders WHERE id=?) AND NOT EXISTS (SELECT 1 FROM inventory_movements WHERE order_id=? AND product_id=? AND kind='release')").bind(crypto.randomUUID(),createdAt,id,stockId,id,id,stockId));statements.push(db.prepare("UPDATE products SET stock_qty=stock_qty+(SELECT qty_delta FROM inventory_movements WHERE order_id=? AND product_id=? AND kind='release') WHERE id=? AND changes()=1").bind(id,stockId,stockId));}
    if(redeem){statements.push(db.prepare("INSERT OR IGNORE INTO loyalty_events (id,card_id,order_id,kind,amount,reason,actor,created_at) SELECT ?,card_id,order_id,'refund',-amount,'Order not saved; points returned','system',? FROM loyalty_events WHERE order_id=? AND kind='redeem' AND NOT EXISTS (SELECT 1 FROM orders WHERE id=?) AND NOT EXISTS (SELECT 1 FROM loyalty_events WHERE order_id=? AND kind='refund')").bind(crypto.randomUUID(),createdAt,id,id,id));statements.push(db.prepare("UPDATE loyalty_cards SET points=points+(SELECT amount FROM loyalty_events WHERE order_id=? AND kind='refund') WHERE id=(SELECT card_id FROM loyalty_events WHERE order_id=? AND kind='refund') AND changes()=1").bind(id,id));}
    const result=await db.batch(statements);if(!result[orderIndex]?.meta?.changes){if(proofKey)await env.BUCKET?.delete(proofKey);return NextResponse.json({error:"A tracked item just sold out or the card points changed. Your basket was not saved; please refresh and try again."},{status:409});}
  }catch(e){if(proofKey)await env.BUCKET?.delete(proofKey);return NextResponse.json({error:"We couldn’t save that order. Please try again."},{status:500});}
  const trackingToken = await signOrderTrackingToken(id);
  return NextResponse.json({id,number,total,payment:pay,method,createdAt,trackingToken,reward:redeem?`Free drink applied · ${loyalty.threshold} points redeemed`:null},{status:201});
}
