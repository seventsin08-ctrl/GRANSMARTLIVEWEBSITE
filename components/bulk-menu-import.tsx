"use client";

import { useState } from "react";
import { parseMenuImport } from "../lib/menu-import";
import type { MenuOptionGroup } from "../lib/menu-options";

function parseChoiceEditor(value: string) {
  return value.split(/[,;]+/).map(part => part.trim()).filter(Boolean).slice(0, 30).map(part => {
    const match = part.match(/^(.*?)\s*(?:\(\s*\+?₱?\s*(\d+(?:\.\d{1,2})?)\s*\)|\+\s*₱?\s*(\d+(?:\.\d{1,2})?)|=\s*₱?\s*(\d+(?:\.\d{1,2})?))$/i);
    return { name: (match ? match[1] : part).trim(), price: match ? Number(match[2] || match[3] || match[4] || 0) : 0 };
  }).filter(choice => choice.name);
}

export function BulkMenuImport({ save, offline, money }: any) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = () => {
    const result = parseMenuImport(text);
    setItems(result.items);
    setErrors(result.errors);
    setMessage(result.items.length ? `${result.items.length} products ready to review.` : "");
  };
  const updateItem = (index: number, patch: any) => setItems(old => old.map((item, i) => i === index ? { ...item, ...patch } : item));
  const updateGroup = (index: number, groupIndex: number, patch: Partial<MenuOptionGroup>) => setItems(old => old.map((item, i) => i === index ? { ...item, customOptions: item.customOptions.map((group: MenuOptionGroup, j: number) => j === groupIndex ? { ...group, ...patch } : group) } : item));
  const addGroup = (index: number) => setItems(old => old.map((item, i) => i === index ? { ...item, customOptions: [...item.customOptions, { name: "Variation", multiple: false, required: true, choices: [] }] } : item));
  const importItems = async () => {
    if (!items.length || errors.length || offline) return;
    setBusy(true); setMessage("");
    try {
      const result = await save("import-menu", { items });
      setMessage(`${result.imported} products imported. Their categories were added as needed.`);
      setItems([]); setErrors([]); setText("");
    } catch (error: any) { setMessage(error.message || "Could not import the menu."); }
    finally { setBusy(false); }
  };

  return <div className="admin-content">
    <div className="admin-heading"><div><h3>Bulk menu import</h3><p>Paste 1–500 products. Review and edit the preview before adding them to your menu.</p></div></div>
    <section className="dashboard-card bulk-import-card">
      <h4>Paste menu text</h4>
      <p>Use a blank line between products. Each item needs a category, name, and base price. Option prices are added to the base price.</p>
      <pre>{`Category: Drink
Name: Water
Price: 10
Add-ons: Cup (+5), Bottle (+15)
Variations: Nawasa, Wilkins`}</pre>
      <p>Or use five lines per product: category, name, price, add-ons, variations. Add a blank line before the next product.</p>
      <textarea className="bulk-import-input" value={text} onChange={e => setText(e.target.value)} placeholder={`Chicken
Fried chicken
190
Wings, thigh
Spicy, sweet, mild`} aria-label="Paste menu text" />
      <div className="bulk-import-actions"><button className="button button-green" disabled={!text.trim() || offline} onClick={preview}>Preview menu</button><small>Choices without a price cost ₱0 extra. Variations require one choice; add-ons can be selected together.</small></div>
      {errors.length > 0 && <div className="bulk-import-errors" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}
      {message && <p className="muted" role="status">{message}</p>}
      {items.length > 0 && <>
        <h4>Preview · {items.length} products</h4>
        <div className="bulk-import-preview">{items.map((item, index) => <article className="bulk-import-row" key={`${item.name}-${index}`}>
          <div className="bulk-import-product-fields">
            <label>Category<input value={item.category} onChange={e => updateItem(index, { category: e.target.value })} /></label>
            <label>Product name<input value={item.name} onChange={e => updateItem(index, { name: e.target.value })} /></label>
            <label>Base price (₱)<input type="number" min="0" step="0.01" value={item.price} onChange={e => updateItem(index, { price: Number(e.target.value) })} /></label>
          </div>
          {item.customOptions.map((group: MenuOptionGroup, groupIndex: number) => <div className="bulk-import-option" key={`${group.name}-${groupIndex}`}>
            <label>Option group<input value={group.name} onChange={e => updateGroup(index, groupIndex, { name: e.target.value })} /></label>
            <label>Selection<select value={group.multiple ? "multiple" : "single"} onChange={e => updateGroup(index, groupIndex, { multiple: e.target.value === "multiple", required: e.target.value === "single" })}><option value="single">Choose one</option><option value="multiple">Choose any</option></select></label>
            <label className="bulk-option-choices">Choices and extra prices<textarea rows={2} value={group.choices.map(choice => `${choice.name}${choice.price ? ` (+${choice.price})` : ""}`).join(", ")} onChange={e => updateGroup(index, groupIndex, { choices: parseChoiceEditor(e.target.value) })} /></label>
          </div>)}
          <button type="button" className="bulk-add-option" onClick={() => addGroup(index)}>＋ Add an option group</button>
        </article>)}</div>
        <button className="button button-green" disabled={busy || offline || errors.length > 0 || items.some(item => !item.category.trim() || !item.name.trim() || !Number.isFinite(Number(item.price)) || Number(item.price) < 0 || item.customOptions.some((group: MenuOptionGroup) => !group.name.trim() || !group.choices.length))} onClick={importItems}>{busy ? "Importing…" : `Import ${items.length} products`}</button>
      </>}
    </section>
  </div>;
}
