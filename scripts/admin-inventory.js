// Admin → Inventory tab.
// Tracks items on hand: name, category, qty, unit cost, reorder threshold.
// Provides search, category filter, low-stock filter, inline +/- quantity
// adjustments, and per-item add/edit/delete via a modal.

import {
  db, collection, getDocs, addDoc, doc, getDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, fmtMoney, serverTimestamp
} from "./firebase-config.js";
import { escapeHtml } from "./common.js";

const COLLECTION = "inventory";

const DEFAULT_ITEM = {
  name: "",
  category: "",
  sku: "",
  qty: 0,
  unitCostCents: 0,
  reorderAt: 0,
  supplier: "",
  notes: ""
};

let _items = [];
let _filters = { search: "", category: "All", lowOnly: false };

export async function renderInventory(container) {
  container.innerHTML = `<div class="center-spinner"><div class="spinner"></div></div>`;
  try {
    _items = await loadItems();
    paint(container);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Couldn't load inventory</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function loadItems() {
  const snap = await getDocs(query(collection(db, COLLECTION), orderBy("name", "asc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function paint(container) {
  const categories = ["All", ...uniqueCategories(_items)];
  const totalItems = _items.length;
  const totalValue = _items.reduce((sum, i) => sum + (i.qty || 0) * (i.unitCostCents || 0), 0);
  const lowStock = _items.filter(isLow);

  const filtered = applyFilters(_items, _filters);

  container.innerHTML = `
    <div class="stat-grid">
      ${statCard("Items tracked", String(totalItems))}
      ${statCard("Stock value", fmtMoney(totalValue))}
      ${statCard("Low stock", String(lowStock.length), lowStock.length ? "warn" : "")}
    </div>

    <div class="toolbar">
      <input type="search" id="inv-search" placeholder="Search items…" value="${escapeHtml(_filters.search)}">
      <select id="inv-cat">
        ${categories.map(c => `<option value="${escapeHtml(c)}" ${c === _filters.category ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
      </select>
      <label class="inline-check">
        <input type="checkbox" id="inv-low" ${_filters.lowOnly ? "checked" : ""}>
        Low stock only
      </label>
      <div style="flex:1"></div>
      <button class="btn btn-primary" id="inv-new">+ Add item</button>
    </div>

    ${filtered.length === 0
      ? `<div class="empty-state"><h3>${_items.length === 0 ? "No inventory yet" : "No items match your filters"}</h3>
           ${_items.length === 0 ? `<p>Click "Add item" to start tracking supplies.</p>` : ""}
         </div>`
      : `<div class="table-card">
          <table class="data">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th style="text-align:center">Qty</th>
                <th>Unit cost</th>
                <th>Stock value</th>
                <th>Reorder at</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(rowHtml).join("")}
            </tbody>
          </table>
        </div>`
    }
  `;

  container.querySelector("#inv-search").addEventListener("input", (e) => {
    _filters.search = e.target.value;
    paint(container);
    container.querySelector("#inv-search").focus();
  });
  container.querySelector("#inv-cat").addEventListener("change", (e) => {
    _filters.category = e.target.value;
    paint(container);
  });
  container.querySelector("#inv-low").addEventListener("change", (e) => {
    _filters.lowOnly = e.target.checked;
    paint(container);
  });
  container.querySelector("#inv-new").addEventListener("click", () => openModal(null, container));

  container.querySelectorAll("[data-action]").forEach(el => {
    el.addEventListener("click", async () => {
      const id = el.closest("tr").dataset.id;
      const action = el.dataset.action;
      if (action === "edit") return openModal(id, container);
      if (action === "delete") return removeItem(id, container);
      if (action === "inc") return adjustQty(id, 1, container);
      if (action === "dec") return adjustQty(id, -1, container);
    });
  });
}

function rowHtml(it) {
  const status = isLow(it)
    ? `<span class="badge badge-cancelled">Low</span>`
    : `<span class="badge badge-confirmed">OK</span>`;
  const value = (it.qty || 0) * (it.unitCostCents || 0);
  return `
    <tr data-id="${escapeHtml(it.id)}">
      <td>
        <strong>${escapeHtml(it.name || "")}</strong>
        ${it.sku ? `<br/><span class="row-sub">${escapeHtml(it.sku)}</span>` : ""}
      </td>
      <td>${escapeHtml(it.category || "—")}</td>
      <td>
        <div class="qty-adjust">
          <button class="qty-btn" data-action="dec" ${(it.qty || 0) <= 0 ? "disabled" : ""}>−</button>
          <span class="qty-val">${it.qty || 0}</span>
          <button class="qty-btn" data-action="inc">+</button>
        </div>
      </td>
      <td>${fmtMoney(it.unitCostCents || 0)}</td>
      <td>${fmtMoney(value)}</td>
      <td>${it.reorderAt ?? 0}</td>
      <td>${status}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost small-btn" data-action="edit">Edit</button>
        <button class="btn btn-ghost small-btn" data-action="delete" style="color:var(--color-danger);border-color:var(--color-danger)">Delete</button>
      </td>
    </tr>
  `;
}

function statCard(label, value, tone = "") {
  return `
    <div class="stat-card ${tone}">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(value)}</div>
    </div>
  `;
}

function isLow(it) {
  const at = Number(it.reorderAt || 0);
  const qty = Number(it.qty || 0);
  return at > 0 && qty <= at;
}

function uniqueCategories(items) {
  return Array.from(new Set(items.map(i => (i.category || "").trim()).filter(Boolean))).sort();
}

function applyFilters(items, f) {
  const term = f.search.trim().toLowerCase();
  return items.filter(it => {
    if (f.category !== "All" && (it.category || "") !== f.category) return false;
    if (f.lowOnly && !isLow(it)) return false;
    if (term) {
      const blob = `${it.name || ""} ${it.sku || ""} ${it.supplier || ""} ${it.notes || ""}`.toLowerCase();
      if (!blob.includes(term)) return false;
    }
    return true;
  });
}

async function adjustQty(id, delta, container) {
  const it = _items.find(x => x.id === id);
  if (!it) return;
  const next = Math.max(0, Number(it.qty || 0) + delta);
  it.qty = next;
  try {
    await updateDoc(doc(db, COLLECTION, id), { qty: next, updatedAt: serverTimestamp() });
  } catch (err) {
    console.warn("Inventory update failed", err);
  }
  paint(container);
}

async function removeItem(id, container) {
  if (!confirm("Delete this inventory item?")) return;
  try {
    await deleteDoc(doc(db, COLLECTION, id));
    _items = _items.filter(x => x.id !== id);
    paint(container);
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

async function openModal(id, container) {
  let existing = { ...DEFAULT_ITEM };
  if (id) {
    const snap = await getDoc(doc(db, COLLECTION, id));
    if (snap.exists()) existing = { id: snap.id, ...snap.data() };
  }
  const modal = ensureModalRoot();
  modal.innerHTML = `
    <div class="modal-backdrop">
      <div class="form-card modal-card">
        <h2>${id ? "Edit item" : "New item"}</h2>
        <div id="inv-modal-alert"></div>
        <form id="inv-form">
          <div class="field"><label>Name</label><input name="name" value="${escapeHtml(existing.name)}" required></div>
          <div class="row-2">
            <div class="field"><label>Category</label><input name="category" value="${escapeHtml(existing.category)}" placeholder="e.g. Hair, Tools, Supplies"></div>
            <div class="field"><label>SKU / code</label><input name="sku" value="${escapeHtml(existing.sku)}"></div>
          </div>
          <div class="row-2">
            <div class="field"><label>Quantity on hand</label><input name="qty" type="number" min="0" step="1" value="${Number(existing.qty || 0)}" required></div>
            <div class="field"><label>Unit cost (USD)</label><input name="unitCost" type="number" min="0" step="0.01" value="${((existing.unitCostCents || 0) / 100).toFixed(2)}"></div>
          </div>
          <div class="row-2">
            <div class="field"><label>Reorder when at/under</label><input name="reorderAt" type="number" min="0" step="1" value="${Number(existing.reorderAt || 0)}"></div>
            <div class="field"><label>Supplier</label><input name="supplier" value="${escapeHtml(existing.supplier)}"></div>
          </div>
          <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(existing.notes)}</textarea></div>
          <div style="display:flex;gap:8px;justify-content:space-between">
            ${id ? `<button type="button" class="btn btn-ghost" id="inv-delete" style="color:var(--color-danger);border-color:var(--color-danger)">Delete</button>` : `<div></div>`}
            <div style="display:flex;gap:8px">
              <button type="button" class="btn btn-ghost" id="inv-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">Save</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;
  const close = () => { modal.innerHTML = ""; };
  document.getElementById("inv-cancel").addEventListener("click", close);

  document.getElementById("inv-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = {
      name: form.name.value.trim(),
      category: form.category.value.trim(),
      sku: form.sku.value.trim(),
      qty: Math.max(0, parseInt(form.qty.value, 10) || 0),
      unitCostCents: Math.round(parseFloat(form.unitCost.value || "0") * 100),
      reorderAt: Math.max(0, parseInt(form.reorderAt.value, 10) || 0),
      supplier: form.supplier.value.trim(),
      notes: form.notes.value.trim(),
      updatedAt: serverTimestamp()
    };
    try {
      if (id) {
        await setDoc(doc(db, COLLECTION, id), data, { merge: true });
      } else {
        await addDoc(collection(db, COLLECTION), { ...data, createdAt: serverTimestamp() });
      }
      close();
      _items = await loadItems();
      paint(container);
    } catch (err) {
      document.getElementById("inv-modal-alert").innerHTML =
        `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  const del = document.getElementById("inv-delete");
  if (del) {
    del.addEventListener("click", async () => {
      if (!confirm("Delete this item?")) return;
      try {
        await deleteDoc(doc(db, COLLECTION, id));
        close();
        _items = _items.filter(x => x.id !== id);
        paint(container);
      } catch (err) {
        document.getElementById("inv-modal-alert").innerHTML =
          `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      }
    });
  }
}

function ensureModalRoot() {
  let m = document.getElementById("modal-root");
  if (!m) {
    m = document.createElement("div");
    m.id = "modal-root";
    document.body.appendChild(m);
  }
  return m;
}
