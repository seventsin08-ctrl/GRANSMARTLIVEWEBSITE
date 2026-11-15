// Netlify platform adapter.
//
// The app was originally written for Cloudflare Workers, where `env.DB` is a
// D1 (SQLite) database and `env.BUCKET` is an R2 bucket. This module provides
// objects with the same shape, backed by Netlify Database (Postgres) and
// Netlify Blobs, so the route handlers keep working unchanged.
import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import pg from "pg";

// Return COUNT(*) / SUM() results as numbers, like D1 does, instead of strings.
pg.types.setTypeParser(20, (v) => Number(v)); // int8
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric

type Row = Record<string, any>;
type RunResult = { success: true; results: Row[]; meta: { changes: number } };
type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Row[]; rowCount: number | null; command: string }> };

let pool: pg.Pool | null = null;
function getPool(): pg.Pool {
  if (!pool) pool = getDatabase().pool as unknown as pg.Pool;
  return pool;
}

// Translate the SQLite dialect used by the route handlers into Postgres.
function translate(sql: string, values: unknown[], lastChanges: number) {
  let text = sql.trim().replace(/;\s*$/, "");
  const isInsertSelect = /^\s*INSERT\b[\s\S]*?\)\s*SELECT\b/i.test(text);

  // SQLite changes() = rows touched by the previous write in this batch.
  text = text.replace(/\bchanges\(\)/gi, String(lastChanges));

  // date(col,'+8 hours') -> calendar date in Philippine time.
  text = text.replace(
    /\bdate\(\s*([\w.]+)\s*,\s*'\+8 hours'\s*\)/gi,
    "to_char((($1)::timestamptz AT TIME ZONE 'UTC') + interval '8 hours', 'YYYY-MM-DD')",
  );

  // INSERT OR IGNORE -> INSERT ... ON CONFLICT DO NOTHING
  if (/^\s*INSERT\s+OR\s+IGNORE\b/i.test(text)) {
    text = text.replace(/^\s*INSERT\s+OR\s+IGNORE\b/i, "INSERT");
    text += " ON CONFLICT DO NOTHING";
  }

  // ? placeholders -> $1, $2, ... (skipping quoted string literals)
  let index = 0;
  let out = "";
  let inString = false;
  for (const ch of text) {
    if (ch === "'") inString = !inString;
    if (ch === "?" && !inString) {
      index++;
      const value = values[index - 1];
      // Untyped parameters in an INSERT ... SELECT list default to text in
      // Postgres; cast numbers so they can go into numeric columns.
      out += isInsertSelect && typeof value === "number" ? `$${index}::numeric` : `$${index}`;
    } else out += ch;
  }
  return out;
}

function normalize(values: unknown[]) {
  return values.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v));
}

class Statement {
  constructor(private db: Database, readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) {
    return new Statement(this.db, this.sql, normalize(values));
  }
  async execute(client: Queryable, lastChanges: number): Promise<RunResult> {
    const result = await client.query(translate(this.sql, this.values, lastChanges), this.values);
    const isRead = result.command === "SELECT";
    return { success: true, results: result.rows, meta: { changes: isRead ? 0 : result.rowCount ?? 0 } };
  }
  async all<T = Row>() {
    const r = await this.execute(getPool(), this.db.lastChanges);
    return r as unknown as { success: true; results: T[]; meta: { changes: number } };
  }
  async first<T = Row>(column?: string): Promise<T | null> {
    const r = await this.execute(getPool(), this.db.lastChanges);
    const row = r.results[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }
  async run() {
    const r = await this.execute(getPool(), this.db.lastChanges);
    this.db.lastChanges = r.meta.changes;
    return r;
  }
}

class Database {
  lastChanges = 0;
  prepare(sql: string) {
    return new Statement(this, sql);
  }
  // Like D1: run all statements in one transaction, in order.
  async batch(statements: Statement[]) {
    const client = await getPool().connect();
    const results: RunResult[] = [];
    let changes = 0;
    try {
      await client.query("BEGIN");
      for (const statement of statements) {
        const r = await statement.execute(client as unknown as Queryable, changes);
        if (!/^\s*SELECT\b/i.test(statement.sql)) changes = r.meta.changes;
        results.push(r);
      }
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

// R2-compatible wrapper around a Netlify Blobs store.
class Bucket {
  private store() {
    return getStore({ name: "uploads", consistency: "strong" });
  }
  async put(key: string, data: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
    await this.store().set(key, data, { metadata: { contentType: options?.httpMetadata?.contentType || "" } });
  }
  async get(key: string) {
    const entry = await this.store().getWithMetadata(key, { type: "arrayBuffer" });
    if (!entry) return null;
    const contentType = String((entry.metadata as Row)?.contentType || "") || undefined;
    return { body: entry.data as ArrayBuffer, httpMetadata: { contentType } };
  }
  async delete(key: string) {
    await this.store().delete(key);
  }
}

export type D1Database = Database;

const db = new Database();
const bucket = new Bucket();

export const env = {
  DB: db as Database | undefined,
  BUCKET: bucket as Bucket | undefined,
  get ADMIN_PASSWORD_HASH() {
    return process.env.ADMIN_PASSWORD_HASH;
  },
  get ADMIN_SESSION_SECRET() {
    return process.env.ADMIN_SESSION_SECRET;
  },
};

export function clientIp(request: Request) {
  return (
    request.headers.get("x-nf-client-connection-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
