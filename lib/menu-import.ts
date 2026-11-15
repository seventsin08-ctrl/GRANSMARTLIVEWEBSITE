import { MenuOptionGroup } from "./menu-options";

export type ImportedMenuItem = { category: string; name: string; price: number; description: string; customOptions: MenuOptionGroup[] };
export type MenuImportResult = { items: ImportedMenuItem[]; errors: string[] };

function listChoices(value: string) {
  return value.split(/[,;]+/).map(part => part.trim()).filter(Boolean).slice(0, 30).map(part => {
    const match = part.match(/^(.*?)\s*(?:\(\s*\+?₱?\s*(\d+(?:\.\d{1,2})?)\s*\)|\+\s*₱?\s*(\d+(?:\.\d{1,2})?)|=\s*₱?\s*(\d+(?:\.\d{1,2})?))$/i);
    return { name: (match ? match[1] : part).trim(), price: match ? Number(match[2] || match[3] || match[4] || 0) : 0 };
  }).filter(x => x.name);
}

function splitBlocks(source: string) {
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: string[][] = []; let block: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (block.length) blocks.push(block); block = []; continue; }
    if (/^category\s*:/i.test(line) && block.some(x => /^name\s*:/i.test(x))) { blocks.push(block); block = []; }
    block.push(line);
  }
  if (block.length) blocks.push(block);
  return blocks;
}

export function parseMenuImport(source: string): MenuImportResult {
  const items: ImportedMenuItem[] = []; const errors: string[] = [];
  const blocks = splitBlocks(source);
  if (blocks.length > 500) return { items: [], errors: ["Import up to 500 products at a time."] };
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]; const fields = new Map<string, string>();
    for (const line of block) {
      const match = line.match(/^(category|name|product|price|description|add-ons?|addons?|variations?|sizes?)\s*:\s*(.*)$/i);
      if (match) fields.set(match[1].toLowerCase().replace(/s$/, ""), match[2].trim());
    }
    let category = fields.get("category") || "";
    let name = fields.get("name") || fields.get("product") || "";
    let priceText = fields.get("price") || "";
    let addOnText = fields.get("add-on") || fields.get("addon") || fields.get("add-on") || "";
    let variationText = fields.get("variation") || "";
    let sizeText = fields.get("size") || "";
    let description = fields.get("description") || "";
    if (!name && block.length >= 3) {
      category = block[0].replace(/^category\s*:\s*/i, "");
      name = block[1].replace(/^(?:name|product)\s*:\s*/i, "");
      priceText = block[2].replace(/^price\s*:\s*/i, "");
      addOnText = block[3]?.replace(/^add-ons?\s*:\s*/i, "") || "";
      const choiceLine = block[4] || "";
      if (/^sizes?\s*:/i.test(choiceLine)) sizeText = choiceLine.replace(/^sizes?\s*:\s*/i, "");
      else variationText = choiceLine.replace(/^variations?\s*:\s*/i, "");
      description = block[5]?.replace(/^description\s*:\s*/i, "") || "";
    }
    const price = Number(priceText.replace(/[^\d.]/g, ""));
    if (!category || !name || !priceText || !Number.isFinite(price) || price < 0) {
      errors.push(`Block ${index + 1}: add a category, product name, and valid price.`); continue;
    }
    const customOptions: MenuOptionGroup[] = [];
    const addOns = listChoices(addOnText);
    const variations = listChoices(variationText);
    const sizes = listChoices(sizeText);
    if (addOns.length) customOptions.push({ name: "Add-ons", multiple: true, required: false, choices: addOns });
    if (sizes.length) customOptions.push({ name: "Size", multiple: false, required: true, choices: sizes });
    if (variations.length) customOptions.push({ name: "Variation", multiple: false, required: true, choices: variations });
    items.push({ category: category.slice(0, 60), name: name.slice(0, 80), price: Math.min(price, 1000000), description: description.slice(0, 240), customOptions });
  }
  if (!blocks.length) errors.push("Paste at least one product block to preview.");
  return { items, errors };
}
