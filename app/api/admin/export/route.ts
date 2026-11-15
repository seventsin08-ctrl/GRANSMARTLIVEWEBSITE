import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getAdminSession, isFullAdmin } from "../session";
import { ensureFinanceSchema } from "../../finance/core";

const field = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = (rows: unknown[][]) => rows.map(row => row.map(field).join(",")).join("\r\n");
const dateValid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const peso = (value: number) => Number(value || 0).toFixed(2);
const timeInManila = (value: string | null) => value ? new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", hour12: false }) : "";

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!env.DB) return NextResponse.json({ error: "The report database is unavailable." }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const type = params.get("type");
  const start = params.get("start") || new Date().toISOString().slice(0, 10);
  const end = params.get("end") || start;
  if (!dateValid(start) || !dateValid(end) || start > end) return NextResponse.json({ error: "Choose a valid report date range." }, { status: 400 });

  let contents: string;
  let name: string;
  if (type === "sales") {
    if (!(isFullAdmin(session) || session.permissions.includes("reports"))) return NextResponse.json({ error: "Sales report access is not enabled for this account." }, { status: 403 });
    const orders = await env.DB.prepare("SELECT number,created_at,items,total,method,payment_method,paid,status FROM orders WHERE date(created_at,'+8 hours') BETWEEN ? AND ? ORDER BY created_at").bind(start, end).all<any>();
    const monthly: Record<string, { revenue: number; orders: number }> = {};
    const daily: Record<string, { revenue: number; orders: number }> = {};
    const paid = orders.results.filter((order: any) => order.paid === 1);
    const revenue = paid.reduce((sum: number, order: any) => sum + Number(order.total || 0), 0);
    for (const order of paid) {
      const day = new Date(order.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
      const month = day.slice(0, 7);
      daily[day] ??= { revenue: 0, orders: 0 };
      daily[day].revenue += Number(order.total || 0);
      daily[day].orders++;
      monthly[month] ??= { revenue: 0, orders: 0 };
      monthly[month].revenue += Number(order.total || 0);
      monthly[month].orders++;
    }
    const rows: unknown[][] = [
      ["GrainSmart sales export", "", "", "", "", "", "", "", "", "", "", ""],
      ["Period start", start], ["Period end", end],
      ["Record type", "Date", "Month", "Order number", "Time (Asia/Manila)", "Order method", "Payment method", "Paid", "Status", "Items", "Quantity", "Amount (PHP)"],
      ["SUMMARY", start, "", "", "", "", "", "", "", "Paid revenue", paid.length, peso(revenue)],
      ["SUMMARY", start, "", "", "", "", "", "", "", "Payment due", orders.results.filter((order: any) => order.paid === 0 && order.status !== "cancelled").length, ""],
      ["SUMMARY", start, "", "", "", "", "", "", "", "Cancelled orders", orders.results.filter((order: any) => order.status === "cancelled").length, ""],
    ];
    for (const [month, values] of Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b))) rows.push(["MONTHLY REVENUE", "", month, "", "", "", "", "", "", "Paid orders", values.orders, peso(values.revenue)]);
    for (const [day, values] of Object.entries(daily).sort(([a], [b]) => a.localeCompare(b))) rows.push(["DAILY SALES", day, day.slice(0, 7), "", "", "", "", "", "", "Paid orders", values.orders, peso(values.revenue)]);
    for (const order of orders.results) {
      const items = JSON.parse(order.items || "[]");
      const itemText = items.map((item: any) => `${item.qty} x ${item.name}`).join("; ");
      const quantity = items.reduce((sum: number, item: any) => sum + Number(item.qty || 0), 0);
      const day = new Date(order.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
      rows.push(["ORDER", day, day.slice(0, 7), order.number, timeInManila(order.created_at), order.method, order.payment_method, order.paid ? "Paid" : "Unpaid", order.status, itemText, quantity, peso(order.total)]);
      for (const item of items) rows.push(["ITEM", day, day.slice(0, 7), order.number, timeInManila(order.created_at), order.method, order.payment_method, order.paid ? "Paid" : "Unpaid", order.status, item.name, item.qty, peso(Number(item.unit || 0) * Number(item.qty || 0))]);
    }
    contents = csv(rows);
    name = `grainsmart-sales-${start}-to-${end}.csv`;
  } else if (type === "finance") {
    if (!(isFullAdmin(session) || session.permissions.includes("reports") || session.permissions.includes("profit") || session.permissions.includes("cash_remits_manage") || session.permissions.includes("expenses_manage"))) return NextResponse.json({ error: "Finance export access is not enabled for this account." }, { status: 403 });
    await ensureFinanceSchema(env.DB);
    const [orders, expenses, sessions, entries, costs] = await Promise.all([
      env.DB.prepare("SELECT id,number,created_at,items,total FROM orders WHERE paid=1 AND date(created_at,'+8 hours') BETWEEN ? AND ? ORDER BY created_at").bind(start, end).all<any>(),
      env.DB.prepare("SELECT occurred_at,category,amount,payment_method,note,actor FROM expenses WHERE date(occurred_at,'+8 hours') BETWEEN ? AND ? ORDER BY occurred_at").bind(start, end).all<any>(),
      env.DB.prepare("SELECT * FROM cash_sessions WHERE date(opened_at,'+8 hours') BETWEEN ? AND ? ORDER BY opened_at").bind(start, end).all<any>(),
      env.DB.prepare("SELECT e.*,s.opened_by FROM cash_entries e JOIN cash_sessions s ON s.id=e.session_id WHERE date(e.created_at,'+8 hours') BETWEEN ? AND ? ORDER BY e.created_at").bind(start, end).all<any>(),
      env.DB.prepare("SELECT product_id,unit_cost FROM product_costs").all<any>(),
    ]);
    const costMap = new Map(costs.results.map((row: any) => [row.product_id, Number(row.unit_cost)]));
    let revenue = 0, costOfGoods = 0, uncosted = 0;
    const rows: unknown[][] = [["GrainSmart finance export"], ["Period start", start], ["Period end", end], ["Record type", "Date", "Staff", "Reference", "Method / category", "Amount (PHP)", "Details"]];
    for (const order of orders.results) {
      revenue += Number(order.total || 0);
      let orderCost = 0, complete = true;
      for (const item of JSON.parse(order.items || "[]")) {
        const unitCost = item.unitCost !== undefined && item.unitCost !== null ? Number(item.unitCost) : costMap.get(item.id);
        if (unitCost === undefined || !Number.isFinite(unitCost)) { complete = false; continue; }
        orderCost += unitCost * Number(item.qty || 0);
      }
      if (complete) costOfGoods += orderCost; else uncosted++;
      rows.push(["PAID ORDER", new Date(order.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }), "", `#${order.number}`, "Paid sale", peso(order.total), `COGS ${complete ? peso(orderCost) : "missing"}`]);
    }
    let expenseTotal = 0;
    for (const expense of expenses.results) { expenseTotal += Number(expense.amount || 0); rows.push(["EXPENSE", timeInManila(expense.occurred_at), expense.actor, expense.category, expense.payment_method, peso(expense.amount), expense.note]); }
    for (const cash of sessions.results) rows.push(["CASH SESSION", timeInManila(cash.opened_at), cash.opened_by, cash.id, cash.status, cash.variance===null?"":peso(cash.variance), `Opening ${peso(cash.opening_float)} · expected ${cash.expected_cash===null?"":peso(cash.expected_cash)} · counted ${cash.counted_cash===null?"":peso(cash.counted_cash)} · closed ${timeInManila(cash.closed_at)}`]);
    for (const entry of entries.results) rows.push(["CASH MOVEMENT", timeInManila(entry.created_at), entry.actor, entry.order_id||entry.session_id, entry.kind, peso(entry.amount), entry.note]);
    rows.push(["SUMMARY", "", "", "Paid revenue", "", peso(revenue), `${orders.results.length} orders`]);
    rows.push(["SUMMARY", "", "", "Cost of goods", "", uncosted?"Incomplete":peso(costOfGoods), `${uncosted} orders missing item cost`]);
    rows.push(["SUMMARY", "", "", "Recorded expenses", "", peso(expenseTotal), "Entered expenses only"]);
    rows.push(["SUMMARY", "", "", "Estimated net profit", "", uncosted?"Incomplete":peso(revenue-costOfGoods-expenseTotal), "Revenue − item costs − recorded expenses"]);
    contents = csv(rows);
    name = `grainsmart-finance-${start}-to-${end}.csv`;
  } else if (type === "attendance") {
    if (!(isFullAdmin(session) || session.permissions.includes("attendance_manage"))) return NextResponse.json({ error: "Only an admin or attendance manager can export staff attendance." }, { status: 403 });
    const attendance = await env.DB.prepare("SELECT username,clock_in,clock_out FROM attendance WHERE date(clock_in,'+8 hours') BETWEEN ? AND ? ORDER BY clock_in").bind(start, end).all<any>();
    const rows: unknown[][] = [["Staff attendance export"], ["Period start", start], ["Period end", end], ["Staff username", "Clock in (Asia/Manila)", "Clock out (Asia/Manila)", "Elapsed hours", "Shift status"]];
    for (const entry of attendance.results) {
      const elapsed = entry.clock_out ? Math.max(0, (Date.parse(entry.clock_out) - Date.parse(entry.clock_in)) / 3600000) : null;
      rows.push([entry.username, timeInManila(entry.clock_in), timeInManila(entry.clock_out), elapsed === null ? "" : elapsed.toFixed(2), entry.clock_out ? "Complete" : "Still clocked in"]);
    }
    contents = csv(rows);
    name = `grainsmart-attendance-${start}-to-${end}.csv`;
  } else return NextResponse.json({ error: "Choose a sales or attendance export." }, { status: 400 });

  return new Response(`\uFEFF${contents}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
