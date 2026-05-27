// Admin → Expenses tab.
// Records business expenses, charts monthly totals, breaks them out by
// category, and forecasts the next month's spend using two methods that are
// shown side-by-side so the admin can see whether they agree:
//   1) Linear-regression trend on the last 6 months
//   2) Weighted moving average of the last 3 months (weights 3,2,1)
// The "smart" headline forecast averages the two when both are available and
// flags when their disagreement is large.

import {
  db, collection, getDocs, addDoc, doc, getDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, fmtMoney, fmtDate, serverTimestamp
} from "./firebase-config.js";
import { escapeHtml } from "./common.js";

const COLLECTION = "expenses";

let _all = [];

export async function renderExpenses(container) {
  container.innerHTML = `<div class="center-spinner"><div class="spinner"></div></div>`;
  try {
    _all = await loadAll();
    paint(container);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Couldn't load expenses</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function loadAll() {
  const snap = await getDocs(query(collection(db, COLLECTION), orderBy("date", "desc")));
  return snap.docs.map(d => normalize({ id: d.id, ...d.data() }));
}

function normalize(e) {
  const date = e.date && e.date.toDate ? e.date.toDate() : (e.date ? new Date(e.date) : null);
  return { ...e, date };
}

function paint(container) {
  const months = buildMonthlySeries(_all, 12);
  const thisMonth = months[months.length - 1];
  const lastMonth = months[months.length - 2] || { total: 0 };
  const avg12 = months.reduce((s, m) => s + m.total, 0) / Math.max(1, months.length);

  const forecast = computeForecast(months);
  const categoriesThisMonth = categoryBreakdown(filterByMonth(_all, thisMonth.year, thisMonth.month));

  const recent = _all.slice(0, 50);

  container.innerHTML = `
    <div class="stat-grid">
      ${statCard("This month", fmtMoney(thisMonth.total),
        deltaTag(thisMonth.total, lastMonth.total))}
      ${statCard("Last month", fmtMoney(lastMonth.total))}
      ${statCard("12-month avg", fmtMoney(Math.round(avg12)))}
      ${statCard("Smart forecast (next month)",
        forecast.headline != null ? fmtMoney(forecast.headline) : "—",
        forecast.note ? `<span class="stat-sub">${escapeHtml(forecast.note)}</span>` : "")}
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Monthly spend &middot; last 12 months</h3>
        <button class="btn btn-primary" id="exp-new">+ Add expense</button>
      </div>
      <div class="chart-wrap">
        ${barChartSvg(months, forecast)}
      </div>
      <div class="forecast-grid">
        <div>
          <div class="row-label">Linear trend (last 6 mo)</div>
          <div class="row-value">${forecast.linear != null ? fmtMoney(forecast.linear) : "—"}</div>
        </div>
        <div>
          <div class="row-label">Weighted moving avg (last 3 mo)</div>
          <div class="row-value">${forecast.wma != null ? fmtMoney(forecast.wma) : "—"}</div>
        </div>
        <div>
          <div class="row-label">3-month outlook</div>
          <div class="row-value">${forecast.threeMonths != null ? fmtMoney(forecast.threeMonths) : "—"}</div>
        </div>
      </div>
      <p class="muted-note">
        Forecasts are an estimate based on past spend only — they don't account
        for one-offs, taxes, or planned investments. Use them as a guide.
      </p>
    </div>

    <div class="panel">
      <h3>This month by category</h3>
      ${categoriesThisMonth.length === 0
        ? `<p class="muted-note" style="margin:0">No expenses logged this month yet.</p>`
        : `<div class="cat-list">
            ${categoriesThisMonth.map(c => categoryRow(c, thisMonth.total)).join("")}
          </div>`}
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Recent transactions</h3></div>
      ${recent.length === 0
        ? `<div class="empty-state"><h3>No expenses logged yet</h3><p>Click "Add expense" above to get started.</p></div>`
        : `<div class="table-card">
            <table class="data">
              <thead>
                <tr><th>Date</th><th>Category</th><th>Vendor</th><th>Description</th><th style="text-align:right">Amount</th><th></th></tr>
              </thead>
              <tbody>
                ${recent.map(rowHtml).join("")}
              </tbody>
            </table>
          </div>`}
    </div>
  `;

  container.querySelector("#exp-new").addEventListener("click", () => openModal(null, container));
  container.querySelectorAll("[data-action]").forEach(el => {
    el.addEventListener("click", () => {
      const id = el.closest("tr").dataset.id;
      if (el.dataset.action === "edit") openModal(id, container);
      if (el.dataset.action === "delete") removeExpense(id, container);
    });
  });
}

function rowHtml(e) {
  return `
    <tr data-id="${escapeHtml(e.id)}">
      <td style="white-space:nowrap">${e.date ? fmtDate(e.date) : "—"}</td>
      <td>${escapeHtml(e.category || "—")}</td>
      <td>${escapeHtml(e.vendor || "—")}</td>
      <td>${escapeHtml(e.description || "")}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${fmtMoney(e.amountCents || 0)}</td>
      <td style="white-space:nowrap;text-align:right">
        <button class="btn btn-ghost small-btn" data-action="edit">Edit</button>
        <button class="btn btn-ghost small-btn" data-action="delete" style="color:var(--color-danger);border-color:var(--color-danger)">Delete</button>
      </td>
    </tr>
  `;
}

function statCard(label, value, extra = "") {
  return `
    <div class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      ${extra || ""}
    </div>
  `;
}

function deltaTag(now, prev) {
  if (!prev || prev <= 0) return "";
  const pct = ((now - prev) / prev) * 100;
  const sign = pct >= 0 ? "+" : "";
  const tone = pct > 5 ? "up" : pct < -5 ? "down" : "flat";
  const arrow = pct >= 0 ? "▲" : "▼";
  return `<span class="stat-delta delta-${tone}">${arrow} ${sign}${pct.toFixed(0)}% vs last mo</span>`;
}

function categoryRow(c, monthTotal) {
  const pct = monthTotal > 0 ? Math.round((c.total / monthTotal) * 100) : 0;
  return `
    <div class="cat-row">
      <div class="cat-row-head">
        <strong>${escapeHtml(c.name)}</strong>
        <span>${fmtMoney(c.total)} <span class="muted">· ${pct}%</span></span>
      </div>
      <div class="cat-bar"><div class="cat-bar-fill" style="width:${pct}%"></div></div>
    </div>
  `;
}

// ----- Monthly aggregation & forecasting -----

function buildMonthlySeries(items, n = 12) {
  const series = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    series.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      total: 0
    });
  }
  for (const e of items) {
    if (!e.date) continue;
    const y = e.date.getFullYear();
    const m = e.date.getMonth();
    const slot = series.find(s => s.year === y && s.month === m);
    if (slot) slot.total += Number(e.amountCents || 0);
  }
  return series;
}

function filterByMonth(items, year, month) {
  return items.filter(e => e.date && e.date.getFullYear() === year && e.date.getMonth() === month);
}

function categoryBreakdown(items) {
  const map = new Map();
  for (const e of items) {
    const key = (e.category || "Uncategorized").trim() || "Uncategorized";
    map.set(key, (map.get(key) || 0) + Number(e.amountCents || 0));
  }
  return Array.from(map.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
}

function computeForecast(monthsSeries) {
  // Exclude the current (still-accumulating) month from the model so it
  // doesn't pull the forecast down mid-month. We forecast that current month
  // is what "next month" will look like.
  const completed = monthsSeries.slice(0, -1);
  const haveAny = completed.some(m => m.total > 0);
  if (!haveAny) {
    return { linear: null, wma: null, headline: null, threeMonths: null, note: "Log a few months to see forecasts." };
  }

  const linear = linearRegressionForecast(completed.slice(-6));
  const wma = weightedMovingAverage(completed.slice(-3));

  const candidates = [linear, wma].filter(v => v != null && v >= 0);
  const headline = candidates.length
    ? Math.round(candidates.reduce((a, b) => a + b, 0) / candidates.length)
    : null;

  let note = "";
  if (linear != null && wma != null) {
    const spread = Math.abs(linear - wma);
    const base = Math.max(1, (linear + wma) / 2);
    if (spread / base > 0.25) note = "trend & average disagree";
  }

  // Three-month outlook: project the linear trend three steps ahead and sum,
  // falling back to 3× headline if the trend isn't computable.
  let threeMonths = null;
  if (linear != null) {
    threeMonths = Math.round(
      linearRegressionForecast(completed.slice(-6), 1)
      + linearRegressionForecast(completed.slice(-6), 2)
      + linearRegressionForecast(completed.slice(-6), 3)
    );
  } else if (headline != null) {
    threeMonths = headline * 3;
  }
  if (threeMonths != null && threeMonths < 0) threeMonths = 0;

  return { linear, wma, headline, threeMonths, note };
}

// Best-fit line over [0..n-1], project k steps past the end (default 1).
function linearRegressionForecast(months, stepsAhead = 1) {
  const pts = months.map((m, i) => [i, m.total]);
  if (pts.length < 2) return null;
  const n = pts.length;
  const sumX = pts.reduce((s, p) => s + p[0], 0);
  const sumY = pts.reduce((s, p) => s + p[1], 0);
  const sumXY = pts.reduce((s, p) => s + p[0] * p[1], 0);
  const sumX2 = pts.reduce((s, p) => s + p[0] * p[0], 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return Math.round(sumY / n);
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const next = intercept + slope * (n - 1 + stepsAhead);
  return Math.max(0, Math.round(next));
}

function weightedMovingAverage(months) {
  if (months.length === 0) return null;
  const weights = months.length === 3 ? [1, 2, 3] : months.map((_, i) => i + 1);
  let num = 0, den = 0;
  months.forEach((m, i) => {
    num += weights[i] * m.total;
    den += weights[i];
  });
  return Math.round(num / den);
}

// ----- SVG bar chart -----

function barChartSvg(months, forecast) {
  const W = 720, H = 220, PAD_L = 40, PAD_R = 16, PAD_T = 16, PAD_B = 36;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const totals = months.map(m => m.total);
  const forecastVal = forecast.headline || 0;
  const maxVal = Math.max(1, ...totals, forecastVal);
  const bw = chartW / (months.length + 1) * 0.7;
  const step = chartW / (months.length + 1);

  const yTicks = 4;
  const tickHtml = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = (maxVal * i) / yTicks;
    const y = PAD_T + chartH - (chartH * i) / yTicks;
    return `
      <line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#ece4d8" stroke-width="1"/>
      <text x="${PAD_L - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="#8a7a6a">${fmtMoneyShort(v)}</text>
    `;
  }).join("");

  const bars = months.map((m, i) => {
    const x = PAD_L + step * (i + 0.5) - bw / 2;
    const h = (m.total / maxVal) * chartH;
    const y = PAD_T + chartH - h;
    const isCurrent = i === months.length - 1;
    return `
      <rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="3"
            fill="${isCurrent ? "#c89b5b" : "#5c3a21"}" opacity="${isCurrent ? 0.9 : 1}">
        <title>${escapeHtml(m.label)}: ${fmtMoney(m.total)}</title>
      </rect>
      <text x="${x + bw / 2}" y="${H - PAD_B + 14}" text-anchor="middle" font-size="10" fill="#6b5b50">${escapeHtml(m.label)}</text>
    `;
  }).join("");

  let forecastMark = "";
  if (forecast.headline != null && forecast.headline > 0) {
    const x = PAD_L + step * (months.length + 0.5) - bw / 2;
    const h = (forecast.headline / maxVal) * chartH;
    const y = PAD_T + chartH - h;
    forecastMark = `
      <rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="3"
            fill="none" stroke="#c89b5b" stroke-width="2" stroke-dasharray="4 3">
        <title>Forecast: ${fmtMoney(forecast.headline)}</title>
      </rect>
      <text x="${x + bw / 2}" y="${H - PAD_B + 14}" text-anchor="middle" font-size="10" fill="#a87f44">Forecast</text>
    `;
  }

  return `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Monthly expense bar chart">
      ${tickHtml}
      ${bars}
      ${forecastMark}
    </svg>
  `;
}

function fmtMoneyShort(cents) {
  const v = cents / 100;
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(v)}`;
}

// ----- Modal -----

async function removeExpense(id, container) {
  if (!confirm("Delete this expense?")) return;
  try {
    await deleteDoc(doc(db, COLLECTION, id));
    _all = _all.filter(e => e.id !== id);
    paint(container);
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

async function openModal(id, container) {
  let existing = {
    date: new Date(),
    category: "",
    vendor: "",
    amountCents: 0,
    description: "",
    notes: ""
  };
  if (id) {
    const snap = await getDoc(doc(db, COLLECTION, id));
    if (snap.exists()) existing = normalize({ id: snap.id, ...snap.data() });
  }
  const modal = ensureModalRoot();
  const dateStr = isoDate(existing.date || new Date());
  const knownCats = uniqueCategories(_all);
  modal.innerHTML = `
    <div class="modal-backdrop">
      <div class="form-card modal-card">
        <h2>${id ? "Edit expense" : "Log expense"}</h2>
        <div id="exp-modal-alert"></div>
        <form id="exp-form">
          <div class="row-2">
            <div class="field"><label>Date</label><input name="date" type="date" value="${escapeHtml(dateStr)}" required></div>
            <div class="field"><label>Amount (USD)</label><input name="amount" type="number" min="0" step="0.01" value="${((existing.amountCents || 0) / 100).toFixed(2)}" required></div>
          </div>
          <div class="row-2">
            <div class="field">
              <label>Category</label>
              <input name="category" list="exp-cat-options" value="${escapeHtml(existing.category)}" placeholder="e.g. Hair, Tools, Rent">
              <datalist id="exp-cat-options">
                ${knownCats.map(c => `<option value="${escapeHtml(c)}"></option>`).join("")}
              </datalist>
            </div>
            <div class="field"><label>Vendor</label><input name="vendor" value="${escapeHtml(existing.vendor)}"></div>
          </div>
          <div class="field"><label>Description</label><input name="description" value="${escapeHtml(existing.description)}"></div>
          <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(existing.notes)}</textarea></div>
          <div style="display:flex;gap:8px;justify-content:space-between">
            ${id ? `<button type="button" class="btn btn-ghost" id="exp-delete" style="color:var(--color-danger);border-color:var(--color-danger)">Delete</button>` : `<div></div>`}
            <div style="display:flex;gap:8px">
              <button type="button" class="btn btn-ghost" id="exp-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">Save</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;
  const close = () => { modal.innerHTML = ""; };
  document.getElementById("exp-cancel").addEventListener("click", close);

  document.getElementById("exp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = {
      date: new Date(form.date.value + "T12:00:00"),
      category: form.category.value.trim() || "Uncategorized",
      vendor: form.vendor.value.trim(),
      amountCents: Math.round(parseFloat(form.amount.value) * 100),
      description: form.description.value.trim(),
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
      _all = await loadAll();
      paint(container);
    } catch (err) {
      document.getElementById("exp-modal-alert").innerHTML =
        `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  const del = document.getElementById("exp-delete");
  if (del) {
    del.addEventListener("click", async () => {
      if (!confirm("Delete this expense?")) return;
      try {
        await deleteDoc(doc(db, COLLECTION, id));
        close();
        _all = _all.filter(e => e.id !== id);
        paint(container);
      } catch (err) {
        document.getElementById("exp-modal-alert").innerHTML =
          `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      }
    });
  }
}

function uniqueCategories(items) {
  return Array.from(new Set(items.map(e => (e.category || "").trim()).filter(Boolean))).sort();
}

function isoDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
