import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getAdminSession, isFullAdmin } from "../admin/session";
import { ensureFinanceSchema, expenseCategories } from "./core";

const moneyValue = (value: unknown) => value===null||value===undefined||String(value).trim()===""?null:Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
const dateValid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!env.DB) return NextResponse.json({ error: "Finance data is unavailable." }, { status: 503 });
  const db = env.DB;
  await ensureFinanceSchema(db);
  const params = new URL(request.url).searchParams;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const start = params.get("start") || today;
  const end = params.get("end") || today;
  if (!dateValid(start) || !dateValid(end) || start > end) return NextResponse.json({ error: "Choose a valid date range." }, { status: 400 });
  const owner = isFullAdmin(session);
  const canCash = owner || session.permissions.includes("cash_remits") || session.permissions.includes("cash_remits_manage");
  const manageCash = owner || session.permissions.includes("cash_remits_manage");
  const canExpenses = owner || session.permissions.includes("expenses") || session.permissions.includes("expenses_manage");
  const canProfit = owner || session.permissions.includes("profit") || session.permissions.includes("reports");
  const result: any = { start, end };
  if (canCash) {
    const current = await db.prepare("SELECT * FROM cash_sessions WHERE status='open' LIMIT 1").first<any>();
    const entries = current ? await db.prepare("SELECT * FROM cash_entries WHERE session_id=? ORDER BY created_at DESC").bind(current.id).all<any>() : { results: [] };
    const history = await db.prepare(`SELECT * FROM cash_sessions ${manageCash ? "" : "WHERE opened_by=? OR closed_by=?"} ORDER BY opened_at DESC LIMIT 50`).bind(...(manageCash ? [] : [session.username, session.username])).all<any>();
    result.cash = { current, entries: entries.results, history: history.results, manageAll: manageCash };
  }
  if (canExpenses) {
    const expenses = await db.prepare("SELECT * FROM expenses WHERE date(occurred_at,'+8 hours') BETWEEN ? AND ? ORDER BY occurred_at DESC LIMIT 250").bind(start, end).all<any>();
    result.expenses = expenses.results;
    result.expenseTotal = expenses.results.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
  }
  if (canProfit) {
    const [orders, costs, expenseRows] = await Promise.all([
      db.prepare("SELECT id,created_at,items,total FROM orders WHERE paid=1 AND date(created_at,'+8 hours') BETWEEN ? AND ? ORDER BY created_at").bind(start, end).all<any>(),
      db.prepare("SELECT product_id,unit_cost FROM product_costs").all<any>(),
      db.prepare("SELECT amount FROM expenses WHERE date(occurred_at,'+8 hours') BETWEEN ? AND ?").bind(start, end).all<any>(),
    ]);
    const currentCosts = new Map(costs.results.map((row: any) => [row.product_id, Number(row.unit_cost)]));
    let revenue = 0, costOfGoods = 0, uncostedOrders = 0, costedOrders = 0;
    for (const order of orders.results) {
      revenue += Number(order.total || 0);
      let orderCost = 0, complete = true;
      for (const item of JSON.parse(order.items || "[]")) {
        const unitCost = item.unitCost !== undefined && item.unitCost !== null ? Number(item.unitCost) : currentCosts.get(item.id);
        if (unitCost === undefined || !Number.isFinite(unitCost)) { complete = false; continue; }
        orderCost += unitCost * Number(item.qty || 0);
      }
      if (complete) { costOfGoods += orderCost; costedOrders++; } else uncostedOrders++;
    }
    const expenseTotal = expenseRows.results.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
    const profitComplete = uncostedOrders === 0;
    const estimatedProfit = profitComplete ? revenue - costOfGoods - expenseTotal : null;
    result.profit = { revenue, costOfGoods, expenses: expenseTotal, estimatedProfit, margin: profitComplete && revenue > 0 ? estimatedProfit! / revenue * 100 : null, paidOrders: orders.results.length, costedOrders, uncostedOrders, profitComplete };
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!env.DB) return NextResponse.json({ error: "Finance data is unavailable." }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const db = env.DB;
  await ensureFinanceSchema(db);
  const owner = isFullAdmin(session);
  const manager = owner || session.permissions.includes("cash_remits_manage");
  const now = new Date().toISOString();

  if (body.action === "cash-open") {
    if (!(owner || session.permissions.includes("cash_remits") || session.permissions.includes("cash_remits_manage"))) return NextResponse.json({ error: "Cash & remits access is not enabled for this account." }, { status: 403 });
    const openingFloat = moneyValue(body.openingFloat);
    if (openingFloat === null) return NextResponse.json({ error: "Enter a valid opening cash amount." }, { status: 400 });
    const id = crypto.randomUUID();
    try { await db.prepare("INSERT INTO cash_sessions (id,opened_by,opened_at,opening_float,notes,status) VALUES (?,?,?,?,?,'open')").bind(id, session.username, now, openingFloat, String(body.notes || "").slice(0, 200)).run(); }
    catch { return NextResponse.json({ error: "A cash session is already open. Close it before starting another." }, { status: 409 }); }
    return NextResponse.json({ ok: true, id });
  }

  if (body.action === "cash-adjust") {
    if (!(owner || session.permissions.includes("cash_remits") || session.permissions.includes("cash_remits_manage"))) return NextResponse.json({ error: "Cash & remits access is not enabled for this account." }, { status: 403 });
    const amount = moneyValue(body.amount), direction = body.direction === "in" ? "in" : body.direction === "out" ? "out" : "";
    const note = String(body.note || "").trim().slice(0, 200);
    const current = await db.prepare("SELECT id,opened_by FROM cash_sessions WHERE status='open' LIMIT 1").first<any>();
    if (!current) return NextResponse.json({ error: "Open a cash session before recording cash in or out." }, { status: 409 });
    if (!manager && current.opened_by !== session.username) return NextResponse.json({ error: "Only the cashier who opened this session or an admin can update it." }, { status: 403 });
    if (amount === null || amount <= 0 || !direction || !note) return NextResponse.json({ error: "Enter an amount, choose cash in or out, and add a reason." }, { status: 400 });
    await db.prepare("INSERT INTO cash_entries (id,session_id,kind,amount,payment_method,note,actor,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), current.id, direction === "in" ? "cash-in" : "cash-out", direction === "in" ? amount : -amount, "Cash", note, session.username, now).run();
    return NextResponse.json({ ok: true });
  }

  if (body.action === "cash-close") {
    if (!(owner || session.permissions.includes("cash_remits") || session.permissions.includes("cash_remits_manage"))) return NextResponse.json({ error: "Cash & remits access is not enabled for this account." }, { status: 403 });
    const countedCash = moneyValue(body.countedCash);
    const current = await db.prepare("SELECT * FROM cash_sessions WHERE status='open' LIMIT 1").first<any>();
    if (!current) return NextResponse.json({ error: "There is no open cash session." }, { status: 409 });
    if (!manager && current.opened_by !== session.username) return NextResponse.json({ error: "Only the cashier who opened this session or an admin can close it." }, { status: 403 });
    if (countedCash === null) return NextResponse.json({ error: "Enter the counted cash amount." }, { status: 400 });
    const totals = await db.prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM cash_entries WHERE session_id=?").bind(current.id).first<any>();
    const expectedCash = Number(current.opening_float) + Number(totals?.amount || 0);
    const variance = countedCash - expectedCash;
    const result = await db.prepare("UPDATE cash_sessions SET closed_by=?,closed_at=?,counted_cash=?,expected_cash=?,variance=?,notes=CASE WHEN ?='' THEN notes ELSE ? END,status='closed' WHERE id=? AND status='open'").bind(session.username, now, countedCash, expectedCash, variance, String(body.notes || "").trim().slice(0, 200), String(body.notes || "").trim().slice(0, 200), current.id).run();
    if (!result.meta.changes) return NextResponse.json({ error: "This cash session was already closed. Refresh and check the history." }, { status: 409 });
    return NextResponse.json({ ok: true, expectedCash, countedCash, variance });
  }

  if (body.action === "expense") {
    if (!(owner || session.permissions.includes("expenses") || session.permissions.includes("expenses_manage"))) return NextResponse.json({ error: "Expense access is not enabled for this account." }, { status: 403 });
    const amount = moneyValue(body.amount), category = String(body.category || ""), paymentMethod = body.paymentMethod === "Cash" ? "Cash" : body.paymentMethod === "Digital" ? "Digital" : "";
    const note = String(body.note || "").trim().slice(0, 200);
    if (amount === null || amount <= 0 || !(expenseCategories as readonly string[]).includes(category) || !paymentMethod || !note) return NextResponse.json({ error: "Enter a valid amount, category, payment method, and note." }, { status: 400 });
    const current = paymentMethod === "Cash" ? await db.prepare("SELECT id,opened_by FROM cash_sessions WHERE status='open' LIMIT 1").first<any>() : null;
    if (paymentMethod === "Cash" && !current) return NextResponse.json({ error: "Open a cash session before recording a cash expense." }, { status: 409 });
    if (current && !manager && current.opened_by !== session.username) return NextResponse.json({ error: "Only the cashier who opened this session or an admin can record this cash expense." }, { status: 403 });
    const id = crypto.randomUUID();
    const statements = [db.prepare("INSERT INTO expenses (id,occurred_at,category,amount,payment_method,note,actor,cash_session_id) VALUES (?,?,?,?,?,?,?,?)").bind(id, now, category, amount, paymentMethod, note, session.username, current?.id || null)];
    if (current) statements.push(db.prepare("INSERT INTO cash_entries (id,session_id,kind,amount,payment_method,note,actor,created_at) VALUES (?,?, 'expense', ?, 'Cash', ?, ?, ?)").bind(crypto.randomUUID(), current.id, -amount, `${category}: ${note}`, session.username, now));
    await db.batch(statements);
    return NextResponse.json({ ok: true, id });
  }

  return NextResponse.json({ error: "Unknown finance action." }, { status: 400 });
}
