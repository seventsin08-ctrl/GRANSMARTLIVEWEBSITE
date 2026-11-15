export type MenuOptionChoice = { name: string; price: number };
export type MenuOptionGroup = { name: string; multiple: boolean; required: boolean; choices: MenuOptionChoice[] };

export function normalizeMenuOptions(value: unknown): MenuOptionGroup[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((group: any) => ({
    name: String(group?.name || "Options").trim().slice(0, 40),
    multiple: group?.multiple === true,
    required: group?.required === true,
    choices: (Array.isArray(group?.choices) ? group.choices : []).slice(0, 30)
      .map((choice: any) => ({ name: String(choice?.name || "").trim().slice(0, 60), price: Number(choice?.price) }))
      .filter((choice: MenuOptionChoice) => choice.name && Number.isFinite(choice.price) && choice.price >= 0 && choice.price <= 100000),
  })).filter(group => group.name && group.choices.length > 0);
}

export function parseMenuOptions(value: unknown): MenuOptionGroup[] {
  if (Array.isArray(value)) return normalizeMenuOptions(value);
  try { return normalizeMenuOptions(JSON.parse(String(value || "[]"))); } catch { return []; }
}

export async function ensureProductOptionsColumn(db: any) {
  const columns = await db.prepare("PRAGMA table_info(products)").all<any>();
  if (!(columns.results || []).some((column: any) => column.name === "custom_options")) {
    try { await db.prepare("ALTER TABLE products ADD COLUMN custom_options TEXT NOT NULL DEFAULT '[]'").run(); }
    catch (error) {
      const current = await db.prepare("PRAGMA table_info(products)").all<any>();
      if (!(current.results || []).some((column: any) => column.name === "custom_options")) throw error;
    }
  }
}
