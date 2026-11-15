import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { ensureProductOptionsColumn, parseMenuOptions } from "../../../lib/menu-options";

const categories = ["Milk Tea", "Coffee & Matcha", "Fries & Snacks", "Rice Meals", "Cakes & Sweets"];
const items = [
  ["classic-milk-tea", "Classic Pearl Milk Tea", "Silky black tea, fresh milk and chewy pearls.", 145, "https://images.unsplash.com/photo-1558857563-b371033873b8?auto=format&fit=crop&w=760&q=85", "Milk Tea", 1],
  ["brown-sugar", "Brown Sugar Cloud", "Caramelized brown sugar and a soft milk cloud.", 165, "https://images.unsplash.com/photo-1558857563-b371033873b8?auto=format&fit=crop&w=760&q=85", "Milk Tea", 1],
  ["matcha-latte", "Garden Matcha Latte", "Bright matcha whisked with creamy milk.", 175, "https://images.unsplash.com/photo-1515823064-d6e0c04616a7?auto=format&fit=crop&w=760&q=85", "Coffee & Matcha", 0],
  ["iced-latte", "Honey Oat Latte", "Espresso, oat milk and a little local honey.", 155, "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=760&q=85", "Coffee & Matcha", 0],
  ["truffle-fries", "Sea Salt Fries", "Golden fries with house sea salt.", 115, "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=760&q=85", "Fries & Snacks", 0],
  ["chicken-bowl", "Ginger Chicken Bowl", "Ginger soy chicken, rice and crisp greens.", 215, "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=760&q=85", "Rice Meals", 0],
  ["ube-cake", "Ube Velvet Slice", "Soft ube chiffon with cream cheese frosting.", 145, "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=760&q=85", "Cakes & Sweets", 0],
  ["lemon-loaf", "Lemon Tea Cake", "Tender lemon loaf, finished with citrus glaze.", 125, "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=760&q=85", "Cakes & Sweets", 0],
];

export async function GET() {
  if (!env.DB) return NextResponse.json({ error: "Menu database unavailable." }, { status: 503 });
  await ensureProductOptionsColumn(env.DB);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM categories").first<{ n: number }>();
  if (!count?.n) {
    for (let i = 0; i < categories.length; i++) await env.DB.prepare("INSERT OR IGNORE INTO categories (id,name,sort,active) VALUES (?,?,?,1)").bind(`cat-${i + 1}`, categories[i], i).run();
    for (const [id,name,description,price,image,category,customization] of items) await env.DB.prepare("INSERT OR IGNORE INTO products (id,category_id,name,description,price,image,available,featured,customization) VALUES (?,?,?,?,?,?,1,0,?)").bind(id, `cat-${categories.indexOf(category as string)+1}`, name, description, price, image, customization).run();
    for (const [key,value] of Object.entries({ brandName: "Grain Smart", tagline: "Slow sips. Little joys.", logo: "", heroImage: "", heroTitle:"Great blessings are given to those who wait.",heroSubtitle:"Handcrafted milk tea, comfort food and something sweet for the walk home.",heroLayout:"left",template:"garden",productCardStyle:"classic",pageLayout:"default",themeColor:"#315941",paperColor:"#fcfbf7",fontChoice:"serif",logoPosition:"left",sectionOrder:JSON.stringify(["intro","menu","story"]),heroButtons:JSON.stringify([{label:"Explore the menu",action:"menu",style:"primary"},{label:"Open my bag",action:"cart",style:"secondary"}]),storyButtons:JSON.stringify([{label:"Find your new favourite",action:"menu",style:"text"}]),methods: JSON.stringify([{name:"Dine In",enabled:true,payment:"Pay at counter"},{name:"Pick Up",enabled:true,payment:"Pay on pickup"},{name:"Delivery",enabled:true,payment:"Cash on delivery"}]),loyaltyEnabled:"true",loyaltyRule:"drink",loyaltyPoints:"1",loyaltyThreshold:"5",loyaltyProducts:JSON.stringify(items.filter(x=>x[5]==="Milk Tea").map(x=>x[0])),loyaltyToppingsFree:"false",loyaltyPolicy:"If you lose your loyalty card, purchase a new card. Points cannot be transferred." })) await env.DB.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)").bind(key,value).run();
  }
  // Repair partial/legacy initialization without overwriting shop edits. In particular,
  // the checkout must never offer fallback methods that the order API cannot recognize.
  const defaults: Record<string,string> = { brandName:"Grain Smart",tagline:"Slow sips. Little joys.",logo:"",heroImage:"",heroTitle:"Great blessings are given to those who wait.",heroSubtitle:"Handcrafted milk tea, comfort food and something sweet for the walk home.",heroLayout:"left",template:"garden",productCardStyle:"classic",pageLayout:"default",themeColor:"#315941",paperColor:"#fcfbf7",fontChoice:"serif",logoPosition:"left",sectionOrder:JSON.stringify(["intro","menu","story"]),heroButtons:JSON.stringify([{label:"Explore the menu",action:"menu",style:"primary"},{label:"Open my bag",action:"cart",style:"secondary"}]),storyButtons:JSON.stringify([{label:"Find your new favourite",action:"menu",style:"text"}]),methods:JSON.stringify([{name:"Dine In",enabled:true,payment:"Pay at counter"},{name:"Pick Up",enabled:true,payment:"Pay on pickup"},{name:"Delivery",enabled:true,payment:"Cash on delivery"}]),loyaltyEnabled:"true",loyaltyRule:"drink",loyaltyPoints:"1",loyaltyThreshold:"5",loyaltyProducts:JSON.stringify(items.filter(x=>x[5]==="Milk Tea").map(x=>x[0])),loyaltyToppingsFree:"false",loyaltyPolicy:"If you lose your loyalty card, purchase a new card. Points cannot be transferred." };
  await Promise.all(Object.entries(defaults).map(([key,value])=>env.DB!.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)").bind(key,value).run()));
  const [catResult, productResult, settingResult] = await Promise.all([
    env.DB.prepare("SELECT id,name,sort,active FROM categories ORDER BY sort,name").all(),
    env.DB.prepare("SELECT id,category_id,name,description,price,image,available,customization,custom_options,track_stock,stock_qty FROM products ORDER BY name").all(),
    env.DB.prepare("SELECT key,value FROM settings").all(),
  ]);
  const products=(productResult.results as any[]).map(p=>{const soldOut=!p.available||!!p.track_stock&&p.stock_qty<=0;return {id:p.id,category_id:p.category_id,name:p.name,description:p.description,price:p.price,image:p.image,customization:p.customization,custom_options:parseMenuOptions(p.custom_options),available:!soldOut,soldOut,soldOutReason:!p.available?"Unavailable":"Out of stock"}});
  return NextResponse.json({ categories: catResult.results, products, settings: Object.fromEntries((settingResult.results as Array<{key:string;value:string}>).map(x=>[x.key,x.value])) }, { headers: { "Cache-Control": "no-store" } });
}
