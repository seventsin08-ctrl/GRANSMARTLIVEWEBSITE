import type { D1Database } from "@/lib/platform";
export async function ensureFinanceSchema(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS product_costs (product_id TEXT PRIMARY KEY NOT NULL, unit_cost REAL NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS cash_sessions (id TEXT PRIMARY KEY NOT NULL, opened_by TEXT NOT NULL, opened_at TEXT NOT NULL, opening_float REAL NOT NULL, closed_by TEXT, closed_at TEXT, counted_cash REAL, expected_cash REAL, variance REAL, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open')"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS cash_session_one_open ON cash_sessions(status) WHERE status='open'"),
    db.prepare("CREATE TABLE IF NOT EXISTS cash_entries (id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, order_id TEXT, kind TEXT NOT NULL, amount REAL NOT NULL, payment_method TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS order_payments (id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL UNIQUE, received_by TEXT NOT NULL, method TEXT NOT NULL, amount REAL NOT NULL, received_at TEXT NOT NULL, cash_session_id TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY NOT NULL, occurred_at TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL, payment_method TEXT NOT NULL, note TEXT NOT NULL, actor TEXT NOT NULL, cash_session_id TEXT)"),
  ]);
}

export const expenseCategories = ["Ingredients", "Packaging", "Utilities", "Rent", "Payroll", "Delivery", "Equipment", "Other"] as const;
