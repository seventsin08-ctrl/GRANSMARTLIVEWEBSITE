import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getAdminSession, hasAdminSession, isFullAdmin, isSuperAdmin } from "./session";
import { loyaltyConfig, readSettings } from "../loyalty/core";
import { ensureFinanceSchema } from "../finance/core";
import { ensureProductOptionsColumn, normalizeMenuOptions, parseMenuOptions } from "../../../lib/menu-options";

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({error:"Sign in required."},{status:401});
  const db=env.DB!; await ensureFinanceSchema(db); await ensureProductOptionsColumn(db); const {searchParams}=new URL(request.url);
  const allowed=(p:string)=>isFullAdmin(session)||session.permissions.includes(p);
  const out:any={session:{username:session.username,role:session.role,permissions:session.permissions}};
  if(allowed("orders")||allowed("kitchen")) {
    const rows=await db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200").all<any>();
    out.orders=rows.results.map((o:any)=>({...o,items:JSON.parse(o.items).map(({unitCost,...item}:any)=>item),details:JSON.parse(o.details)}));
  }
  if(allowed("products")||allowed("categories")) {
    const [cats,products,settings]=await Promise.all([db.prepare("SELECT * FROM categories ORDER BY sort,name").all(),db.prepare("SELECT p.*,pc.unit_cost FROM products p LEFT JOIN product_costs pc ON pc.product_id=p.id ORDER BY p.name").all(),db.prepare("SELECT key,value FROM settings").all<any>()]);
    out.menu={categories:cats.results,products:products.results,settings:Object.fromEntries(settings.results.map((x:any)=>[x.key,x.value]))};
  }
  if(isSuperAdmin(session)) { const s=await db.prepare("SELECT id,username,role,permissions,active FROM staff ORDER BY username").all(); out.staff=s.results.map((x:any)=>({...x,permissions:JSON.parse(x.permissions)})); }
  if(allowed("reports")) {
    const mDate=(d:number)=>new Date(d).toLocaleDateString("en-CA",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"});const start=searchParams.get("start")||mDate(Date.now()-6*86400000);const end=searchParams.get("end")||mDate(Date.now());
    const rows=await db.prepare("SELECT * FROM orders WHERE date(created_at,'+8 hours') BETWEEN ? AND ? ORDER BY created_at DESC").bind(start,end).all<any>();
    const paid=rows.results.filter((o:any)=>o.paid===1);const products=(await db.prepare("SELECT p.id,p.name,c.name AS category FROM products p JOIN categories c ON c.id=p.category_id WHERE p.available=1 AND c.active=1").all<any>()).results;
    const productSales:any=Object.fromEntries(products.map((p:any)=>[p.id,{id:p.id,name:p.name,category:p.category,qty:0,orders:0}]));const categorySales:any={};for(const p of products)categorySales[p.category]??={name:p.category,qty:0,orders:0};
    const daily:any={},fulfillment:any={},pairs:any={};let loyaltyRedemptions=0;
    for(const o of paid){const day=new Date(o.created_at).toLocaleDateString("en-CA",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"});daily[day]??={date:day,revenue:0,orders:0};daily[day].revenue+=o.total;daily[day].orders++;
      fulfillment[o.method]??={method:o.method,orders:0,revenue:0};fulfillment[o.method].orders++;fulfillment[o.method].revenue+=o.total;if(o.reward_applied)loyaltyRedemptions++;
      const orderItems=JSON.parse(o.items);const ids=[...new Set(orderItems.filter((i:any)=>!i.reward).map((i:any)=>i.id))];const seenProducts=new Set<string>(),seenCategories=new Set<string>();
      for(const i of orderItems){if(i.reward)continue;const sale=productSales[i.id];if(sale){sale.qty+=i.qty;if(!seenProducts.has(i.id)){sale.orders++;seenProducts.add(i.id)}const cat=categorySales[sale.category];cat.qty+=i.qty;if(!seenCategories.has(sale.category)){cat.orders++;seenCategories.add(sale.category)}}}
      for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const key=[ids[i],ids[j]].sort().join("|");pairs[key]=(pairs[key]||0)+1;}
    }
    const ranked=Object.values(productSales).sort((a:any,b:any)=>b.qty-a.qty),pairList=Object.entries(pairs).map(([key,count]:any)=>{const [a,b]=key.split("|");return {items:[productSales[a]?.name,productSales[b]?.name],orders:count}}).sort((a:any,b:any)=>b.orders-a.orders);
    const revenue=paid.reduce((a:number,o:any)=>a+o.total,0);const suggestion=pairList[0]?.orders>=2?`“${pairList[0].items.join(" + ") }” appeared together in ${pairList[0].orders} paid orders; consider a clearly priced combo test.`:paid.length>=2?"No repeat pair appeared in 2 or more paid orders in this period; there isn’t enough combo evidence yet.":"Not enough paid orders for a combo suggestion yet.";
    const sold=ranked.filter((p:any)=>p.qty>0);out.report={start,end,paidRevenue:revenue,paidCount:paid.length,averageOrderValue:paid.length?revenue/paid.length:0,pending:rows.results.filter((o:any)=>o.paid===0&&o.status!=="cancelled").length,cancelled:rows.results.filter((o:any)=>o.status==="cancelled").length,best:sold.slice(0,5).map((p:any)=>[p.name,p.qty]),slowest:sold.slice(-5).reverse().map((p:any)=>[p.name,p.qty]),least:ranked.filter((p:any)=>p.qty===0).map((p:any)=>[p.name,0]).slice(0,8),daily:Object.values(daily).sort((a:any,b:any)=>a.date.localeCompare(b.date)),fulfillment:Object.values(fulfillment),categories:Object.values(categorySales).sort((a:any,b:any)=>b.qty-a.qty),pairs:pairList.slice(0,5),suggestion,loyaltyRedemptions};
  }
  return NextResponse.json(out,{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request:Request){
  const body=await request.json().catch(()=>null); if(!body)return NextResponse.json({error:"Invalid request."},{status:400});
  const action=String(body.action||""); const perms:Record<string,string>={status:["preparing","ready"].includes(body.status)?"kitchen":"orders",paid:"payment",cancel:"orders",product:"products","import-menu":"products","reset-products":"products",category:"categories",settings:"branding",staff:"staff","reset-sales":"staff"};
  const currentSession=await getAdminSession();
  const permission=perms[action]||""; if(!permission||!await hasAdminSession(permission))return NextResponse.json({error:"You do not have access to this area."},{status:403}); if((action==="cancel"||action==="refund")&&!isFullAdmin(currentSession))return NextResponse.json({error:"Only an Admin or Owner/Superadmin can cancel or refund an order."},{status:403}); if(action==="settings"&&Object.prototype.hasOwnProperty.call(body.settings||{},"paymentOptions")&&!isFullAdmin(currentSession))return NextResponse.json({error:"Only an Admin or Owner/Superadmin can change payment accounts or QR codes."},{status:403});
  if(action==="staff"&&!isSuperAdmin(currentSession))return NextResponse.json({error:"Only an owner/superadmin can manage accounts."},{status:403});
  if(action==="reset-sales") {
    if(!isSuperAdmin(currentSession))return NextResponse.json({error:"Only an owner/superadmin can reset sales."},{status:403});
    if(body.confirmation!=="RESET SALES")return NextResponse.json({error:"Type RESET SALES to confirm this action."},{status:400});
    if(!env.DB)return NextResponse.json({error:"Sales database is unavailable."},{status:503});
    await ensureFinanceSchema(env.DB);
    const count=await env.DB!.prepare("SELECT COUNT(*) AS n FROM orders").first<any>();
    const deletedOrders=Number(count?.n||0);
    await env.DB!.batch([
      env.DB!.prepare("DELETE FROM cash_entries WHERE order_id IN (SELECT id FROM orders)"),
      env.DB!.prepare("DELETE FROM order_payments WHERE order_id IN (SELECT id FROM orders)"),
      env.DB!.prepare("DELETE FROM loyalty_events WHERE order_id IN (SELECT id FROM orders)"),
      env.DB!.prepare("DELETE FROM inventory_movements WHERE order_id IN (SELECT id FROM orders)"),
      env.DB!.prepare("DELETE FROM orders"),
    ]);
    return NextResponse.json({ok:true,deletedOrders});
  }
  const db=env.DB!; await ensureFinanceSchema(db); await ensureProductOptionsColumn(db);
  if(action==="reset-products") {
    if(!isSuperAdmin(currentSession))return NextResponse.json({error:"Only an Owner/Superadmin can reset all products."},{status:403});
    if(body.confirmation!=="RESET PRODUCTS")return NextResponse.json({error:"Type RESET PRODUCTS to confirm this action."},{status:400});
    const count=await db.prepare("SELECT COUNT(*) AS n FROM products").first<any>();
    const deletedProducts=Number(count?.n||0);
    await db.batch([
      db.prepare("DELETE FROM inventory_movements WHERE product_id IN (SELECT id FROM products)"),
      db.prepare("DELETE FROM product_costs WHERE product_id IN (SELECT id FROM products)"),
      db.prepare("DELETE FROM products"),
    ]);
    return NextResponse.json({ok:true,deletedProducts});
  }
  if(action==="import-menu") {
    const incoming=Array.isArray(body.items)?body.items:[];
    if(!incoming.length||incoming.length>500)return NextResponse.json({error:"Import between 1 and 500 products at a time."},{status:400});
    if(incoming.some((raw:any)=>!String(raw?.category||"").trim()||!String(raw?.name||"").trim()||!Number.isFinite(Number(raw?.price))||Number(raw.price)<0||Number(raw.price)>1000000))return NextResponse.json({error:"Every imported item needs a category, name, and valid price."},{status:400});
    const categories=await db.prepare("SELECT id,name,sort FROM categories ORDER BY sort,name").all<any>();
    const categoryByName=new Map<string,{id:string;name:string;sort:number}>((categories.results||[]).map((c:any)=>[String(c.name).trim().toLowerCase(),c]));
    for(const raw of incoming){
      const category=String(raw?.category||"").trim().slice(0,60);const name=String(raw?.name||"").trim().slice(0,80);const price=Number(raw?.price);
      if(!category||!name||!Number.isFinite(price)||price<0||price>1000000)return NextResponse.json({error:"Every imported item needs a category, name, and valid price."},{status:400});
      const key=category.toLowerCase();if(!categoryByName.has(key)){const row={id:crypto.randomUUID(),name:category,sort:categoryByName.size};await db.prepare("INSERT INTO categories (id,name,sort,active) VALUES (?,?,?,1)").bind(row.id,row.name,row.sort).run();categoryByName.set(key,row);}
    }
    const statements=incoming.map((raw:any)=>{
      const category=String(raw.category).trim().slice(0,60);const cat=categoryByName.get(category.toLowerCase())!;const options=normalizeMenuOptions(raw.customOptions);
      return db.prepare("INSERT INTO products (id,category_id,name,description,price,image,available,featured,customization,custom_options) VALUES (?,?,?,?,?,'',1,0,0,?)").bind(crypto.randomUUID(),cat.id,String(raw.name).trim().slice(0,80),String(raw.description||"").slice(0,240),Number(raw.price),JSON.stringify(options));
    });
    for(let i=0;i<statements.length;i+=100)await db.batch(statements.slice(i,i+100));
    return NextResponse.json({ok:true,imported:incoming.length});
  }

  if(action==="status") { if(!["preparing","ready","completed"].includes(body.status))return NextResponse.json({error:"Use the cancel action to cancel an order."},{status:400});const result=await db.prepare("UPDATE orders SET status=? WHERE id=? AND ((?='preparing' AND status='new') OR (?='ready' AND status='preparing') OR (?='completed' AND status='ready'))").bind(body.status,body.id,body.status,body.status,body.status).run();if(!result.meta.changes)return NextResponse.json({error:"That order has already changed. Refresh the list."},{status:409}); }
  if(action==="paid") {
    const paymentMethod=body.paymentMethod==="Digital"?"Digital":"Cash";
    const cashSession=paymentMethod==="Cash"?await db.prepare("SELECT id FROM cash_sessions WHERE status='open' LIMIT 1").first<any>():null;
    if(paymentMethod==="Cash"&&!cashSession)return NextResponse.json({error:"Open a cash session before recording cash payments, or choose Digital if that is how the customer paid."},{status:409});
    const order=await db.prepare("SELECT loyalty_card_id,items,total,number FROM orders WHERE id=? AND paid=0 AND status!='cancelled'").bind(body.id).first<any>();
    if(!order)return NextResponse.json({error:"Order is already paid or no longer available."},{status:409});
    let earned=0;if(order.loyalty_card_id){const cfg=loyaltyConfig(await readSettings(db));if(cfg.enabled){const lineItems=JSON.parse(order.items);const eligibleQty=lineItems.filter((x:any)=>x.eligible).reduce((sum:number,x:any)=>sum+x.qty,0);earned=eligibleQty?(cfg.rule==="order"?cfg.points:eligibleQty*cfg.points):0;}}
    const paidAt=new Date().toISOString(),paymentId=crypto.randomUUID();const statements:any[]=[
      db.prepare("UPDATE orders SET paid=1 WHERE id=? AND paid=0 AND status!='cancelled'").bind(body.id),
      db.prepare("INSERT INTO order_payments (id,order_id,received_by,method,amount,received_at,cash_session_id) SELECT ?,?,?,?,?,?,? WHERE changes()=1").bind(paymentId,body.id,currentSession?.username||"staff",paymentMethod,Number(order.total||0),paidAt,cashSession?.id||null),
    ];
    if(paymentMethod==="Cash")statements.push(db.prepare("INSERT INTO cash_entries (id,session_id,order_id,kind,amount,payment_method,note,actor,created_at) SELECT ?,?,?,?,?,?,?,?,? FROM order_payments WHERE order_id=? AND received_at=? AND method='Cash' AND NOT EXISTS (SELECT 1 FROM cash_entries WHERE order_id=? AND kind='sale')").bind(crypto.randomUUID(),cashSession.id,body.id,"sale",Number(order.total||0),"Cash",`Order #${order.number}`,currentSession?.username||"staff",paidAt,body.id,paidAt,body.id));
    if(earned>0&&order.loyalty_card_id){statements.push(db.prepare("INSERT OR IGNORE INTO loyalty_events (id,card_id,order_id,kind,amount,reason,actor,created_at) SELECT ?,?,?, 'earn', ?, 'Paid order points', ?, ? FROM orders WHERE id=? AND paid=1 AND EXISTS (SELECT 1 FROM order_payments WHERE order_id=? AND received_at=?)").bind(crypto.randomUUID(),order.loyalty_card_id,body.id,earned,currentSession?.username||"staff",paidAt,body.id,body.id,paidAt));statements.push(db.prepare("UPDATE loyalty_cards SET points=points+? WHERE id=? AND active=1 AND changes()=1").bind(earned,order.loyalty_card_id));}
    const saved=await db.batch(statements);if(!saved[0]?.meta?.changes)return NextResponse.json({error:"That order was already updated. Refresh the list."},{status:409});
  }
  if(action==="cancel") {
    const order=await db.prepare("SELECT items FROM orders WHERE id=?").bind(body.id).first<any>();if(!order)return NextResponse.json({error:"Order not found."},{status:404});
    const quantities:any={};for(const item of JSON.parse(order.items))quantities[item.id]=(quantities[item.id]||0)+item.qty;
    const stockRows=Object.entries(quantities).length?await db.prepare(`SELECT id FROM products WHERE track_stock=1 AND id IN (${Object.keys(quantities).map(()=>"?").join(",")})`).bind(...Object.keys(quantities)).all<any>():{results:[]};
    const stockIds=new Set(stockRows.results.map((p:any)=>p.id));const now=new Date().toISOString();const statements:any[]=[
      db.prepare("UPDATE orders SET status='cancelled' WHERE id=? AND paid=0 AND status!='cancelled'").bind(body.id),
      db.prepare("INSERT OR IGNORE INTO loyalty_events (id,card_id,order_id,kind,amount,reason,actor,created_at) SELECT ?,loyalty_card_id,id,'refund',reward_points,'Cancelled order reward returned',?,? FROM orders WHERE id=? AND status='cancelled' AND paid=0 AND reward_applied=1 AND NOT EXISTS (SELECT 1 FROM loyalty_events WHERE order_id=? AND kind='refund')").bind(crypto.randomUUID(),currentSession?.username||"staff",now,body.id,body.id),
      db.prepare("UPDATE loyalty_cards SET points=points+(SELECT reward_points FROM orders WHERE id=?) WHERE id=(SELECT card_id FROM loyalty_events WHERE order_id=? AND kind='refund') AND changes()=1").bind(body.id,body.id),
    ];
    for(const stockId of stockIds){statements.push(db.prepare("INSERT OR IGNORE INTO inventory_movements (id,product_id,order_id,kind,qty_delta,reason,actor,created_at) SELECT ?,?,?,'release',?,'Cancelled order stock returned',?,? FROM orders WHERE id=? AND status='cancelled' AND paid=0 AND NOT EXISTS (SELECT 1 FROM inventory_movements WHERE order_id=? AND product_id=? AND kind='release')").bind(crypto.randomUUID(),stockId,body.id,quantities[stockId],currentSession?.username||"staff",now,body.id,body.id,stockId));statements.push(db.prepare("UPDATE products SET stock_qty=stock_qty+(SELECT qty_delta FROM inventory_movements WHERE order_id=? AND product_id=? AND kind='release') WHERE id=? AND changes()=1").bind(body.id,stockId,stockId));}
    await db.batch(statements);
  }
  if(action==="product") {
    const p=body.product||{}; if(!p.name||!p.categoryId||!Number.isFinite(Number(p.price)))return NextResponse.json({error:"Name, category and a valid price are required."},{status:400});
    const unitCost=p.unitCost===""||p.unitCost===null||p.unitCost===undefined?null:Number(p.unitCost);if(unitCost!==null&&(!Number.isFinite(unitCost)||unitCost<0||unitCost>1000000))return NextResponse.json({error:"Enter a valid unit cost or leave it blank."},{status:400});
    const id=String(p.id||crypto.randomUUID());
    await db.prepare("INSERT INTO products (id,category_id,name,description,price,image,available,featured,customization,custom_options) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,name=excluded.name,description=excluded.description,price=excluded.price,image=excluded.image,available=excluded.available,featured=excluded.featured,customization=excluded.customization,custom_options=excluded.custom_options").bind(id,String(p.categoryId),String(p.name).slice(0,80),String(p.description||"").slice(0,240),Math.max(0,Number(p.price)),String(p.image||"").slice(0,800),p.available===false?0:1,p.featured?1:0,p.customization?1:0,JSON.stringify(parseMenuOptions(p.customOptions??p.custom_options))).run();
    if(unitCost===null)await db.prepare("DELETE FROM product_costs WHERE product_id=?").bind(id).run();else await db.prepare("INSERT INTO product_costs (product_id,unit_cost,updated_at) VALUES (?,?,?) ON CONFLICT(product_id) DO UPDATE SET unit_cost=excluded.unit_cost,updated_at=excluded.updated_at").bind(id,unitCost,new Date().toISOString()).run();
  }
  if(action==="category") { const c=body.category||{}; if(!c.name)return NextResponse.json({error:"Category name is required."},{status:400}); await db.prepare("INSERT INTO categories (id,name,sort,active) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sort=excluded.sort,active=excluded.active").bind(String(c.id||crypto.randomUUID()),String(c.name).slice(0,60),Number(c.sort)||0,c.active===false?0:1).run(); }
  if(action==="settings") for(const [key,value] of Object.entries(body.settings||{})) if(["brandName","tagline","logo","adminLogo","heroImage","methods","paymentOptions","heroTitle","heroSubtitle","heroLayout","template","productCardStyle","pageLayout","themeColor","paperColor","fontChoice","logoPosition","sectionOrder","heroButtons","storyButtons"].includes(key)) {
    let saved:any=value;
    if(key==="themeColor"||key==="paperColor") saved=/^#[0-9a-fA-F]{6}$/.test(String(value))?String(value):key==="themeColor"?"#315941":"#fcfbf7";
    if(key==="fontChoice") saved=["serif","sans","editorial","rounded","humanist","geometric","playful","compact"].includes(String(value))?String(value):"serif";
    if(key==="heroLayout") saved=["left","center","right"].includes(String(value))?String(value):"left";
    if(key==="template") saved=["garden","sunday","after-dark"].includes(String(value))?String(value):"garden";
    if(key==="productCardStyle") saved=["classic","soft","minimal","framed","editorial","accent","floating","compact","rounded","image-first"].includes(String(value))?String(value):"classic";
    if(key==="pageLayout") saved=["default","sidebar","magazine","grid-focus","list","mosaic","storefront","kiosk"].includes(String(value))?String(value):"default";
    if(key==="logoPosition") saved=["left","right","center"].includes(String(value))?String(value):"left";
    if(key==="logo"||key==="adminLogo"||key==="heroImage") saved=/^\/api\/assets\?key=(brand%2F|brand%2f)[a-z0-9-]+\.(png|jpe?g|webp|gif)$/i.test(String(value))?String(value):"";
    if(key==="heroTitle"||key==="heroSubtitle"||key==="brandName"||key==="tagline") saved=String(value).slice(0,key==="heroSubtitle"?240:120);
    if(key==="methods") { const list=Array.isArray(value)?value.slice(0,8):[];saved=list.filter((m:any)=>m&&typeof m.name==="string").map((m:any)=>({name:m.name.trim().slice(0,40),enabled:!!m.enabled,payment:String(m.payment||"Pay at counter").slice(0,80),acceptsProof:m.acceptsProof===true,paymentImage:/^\/api\/assets\?key=(brand%2F|brand%2f)[a-z0-9-]+\.(png|jpe?g|webp|gif)$/i.test(String(m.paymentImage||""))?String(m.paymentImage):""})).filter((m:any)=>m.name); }
    if(key==="paymentOptions") { const list=Array.isArray(value)?value.slice(0,8):[];saved=list.filter((m:any)=>m&&typeof m.name==="string").map((m:any)=>({name:m.name.trim().slice(0,40),enabled:!!m.enabled,instructions:String(m.instructions||"").slice(0,160),image:/^\/api\/assets\?key=(brand%2F|brand%2f)[a-z0-9-]+\.(png|jpe?g|webp|gif)$/i.test(String(m.image||""))?String(m.image):"",acceptsProof:m.acceptsProof===true} )).filter((m:any)=>m.name);if(saved.length){let active=saved.findIndex((m:any)=>m.enabled);if(active<0)active=0;saved=saved.map((m:any,i:number)=>({...m,enabled:i===active}));} }
    if(key==="heroButtons"||key==="storyButtons"){
      const buttons=Array.isArray(value)?value.slice(0,4):[];const categories=await db.prepare("SELECT id FROM categories").all<any>();const categoryIds=new Set(categories.results.map((c:any)=>c.id));
      saved=buttons.filter((b:any)=>b&&typeof b.label==="string").map((b:any)=>({label:b.label.slice(0,32),action:["menu","cart","story"].includes(b.action)||String(b.action).startsWith("category:")&&categoryIds.has(String(b.action).slice(9))?b.action:"menu",style:["primary","secondary","text"].includes(b.style)?b.style:"primary"}));
    }
    if(key==="sectionOrder") {const order=Array.isArray(value)?value:[];saved=["intro","menu","story"].filter(x=>order.includes(x));for(const x of ["intro","menu","story"])if(!saved.includes(x))saved.push(x)}
    await db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key,typeof saved==="string"?saved:JSON.stringify(saved)).run();
  }
  if(action==="staff") {
    const u=body.staff||{}; if(!/^[a-z0-9._-]{3,32}$/.test(String(u.username||"")))return NextResponse.json({error:"Use 3–32 letters, numbers, dots, dashes or underscores for the username."},{status:400});
    if(String(u.username).toLowerCase()==="admin")return NextResponse.json({error:"The admin username is reserved for the owner account."},{status:409});
    const roleAliases:Record<string,string>={"Owner/Admin":"Admin",Counter:"Staff",Kitchen:"Staff",Custom:"Staff"};
    const role=roleAliases[String(u.role)]||String(u.role);
    const roles=["Owner/Superadmin","Admin","Staff"]; if(!roles.includes(role))return NextResponse.json({error:"Choose Owner/Superadmin, Admin, or Staff."},{status:400});
    if(u.id&&u.active===false) {
      const existing=await db.prepare("SELECT role,active FROM staff WHERE id=?").bind(u.id).first<any>();
      if(existing?.active&&existing.role==="Owner/Superadmin"){const count=await db.prepare("SELECT COUNT(*) AS n FROM staff WHERE role='Owner/Superadmin' AND active=1").first<any>();if((count?.n||0)<=1)return NextResponse.json({error:"Keep at least one active owner/superadmin account."},{status:409});}
      await db.prepare("UPDATE staff SET active=0 WHERE id=?").bind(u.id).run();
    }
    else {
      const allowedPermissions=["orders","kitchen","payment","products","categories","branding","reports","attendance","schedule","attendance_manage","schedule_manage","loyalty","loyalty_manage","inventory","cash_remits","cash_remits_manage","expenses","expenses_manage","profit"];
      const perms=role==="Owner/Superadmin"||role==="Admin"?allowedPermissions:(Array.isArray(u.permissions)?u.permissions.filter((x:string)=>allowedPermissions.includes(x)):[]);
      let hash=""; if(u.password){if(String(u.password).length<10)return NextResponse.json({error:"Staff passwords must be at least 10 characters."},{status:400}); const salt=crypto.getRandomValues(new Uint8Array(16)); const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(u.password)),"PBKDF2",false,["deriveBits"]); const bits=new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:100000,hash:"SHA-256"},key,256)); hash=`pbkdf2-sha256$${Array.from(salt).map(x=>x.toString(16).padStart(2,"0")).join("")}$${Array.from(bits).map(x=>x.toString(16).padStart(2,"0")).join("")}`; }
      if(u.id){
       const existing=await db.prepare("SELECT role,active FROM staff WHERE id=?").bind(u.id).first<any>();
       if(existing?.active&&existing.role==="Owner/Superadmin"&&(role!=="Owner/Superadmin"||u.active===false)){const count=await db.prepare("SELECT COUNT(*) AS n FROM staff WHERE role='Owner/Superadmin' AND active=1").first<any>();if((count?.n||0)<=1)return NextResponse.json({error:"Keep at least one active owner/superadmin account."},{status:409});}
       if(hash)await db.prepare("UPDATE staff SET username=?,role=?,permissions=?,password_hash=?,active=1 WHERE id=?").bind(String(u.username).toLowerCase(),role,JSON.stringify(perms),hash,u.id).run();else await db.prepare("UPDATE staff SET username=?,role=?,permissions=?,active=1 WHERE id=?").bind(String(u.username).toLowerCase(),role,JSON.stringify(perms),u.id).run(); }
      else { if(!hash)return NextResponse.json({error:"Add a password for the new account."},{status:400}); await db.prepare("INSERT INTO staff (id,username,password_hash,role,permissions,active) VALUES (?,?,?,?,?,1)").bind(crypto.randomUUID(),String(u.username).toLowerCase(),hash,role,JSON.stringify(perms)).run(); }
    }
  }
  return NextResponse.json({ok:true});
}
