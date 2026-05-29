// Booking page logic: Acuity-style flow
//   1. Pick style
//   2. Pick date + time slot (filtering out unavailable slots in Firestore)
//   3. Confirm contact info
//   4. Save confirmed booking + redirect to success page

import {
  auth, db, collection, doc, getDoc, getDocs, addDoc,
  query, where, serverTimestamp, onAuthStateChanged,
  fmtMoney, fmtDuration, fmtDate,
  isPlaceholderConfig
} from "./firebase-config.js";
import { escapeHtml, qs, showAlert, clearAlert, styleImgSrc, rootPath } from "./common.js";
import { getAllStyles, getStyleById } from "./styles-data.js";

// ----- Business hours config (override per-day in Firestore `availability/{YYYY-MM-DD}` if needed)
const DEFAULT_HOURS = {
  // 0 = Sunday ... 6 = Saturday
  0: null,                      // closed
  1: { open: 9,  close: 18 },   // Mon
  2: { open: 9,  close: 18 },
  3: { open: 9,  close: 18 },
  4: { open: 9,  close: 20 },
  5: { open: 9,  close: 20 },
  6: { open: 8,  close: 17 },
  defaultSlotMinutes: 30
};

// ----- State
const state = {
  step: 1,
  styles: [],
  selectedStyle: null,
  selectedDate: null,     // Date (midnight local)
  selectedSlot: null,     // Date (start time)
  customer: { name: "", email: "", phone: "", notes: "" },
  user: null
};

// ----- Bootstrap
export async function initBookingPage() {
  state.styles = await getAllStyles();

  // Pre-select style from ?style=...
  const preStyle = qs("style");
  if (preStyle) {
    state.selectedStyle = await getStyleById(preStyle);
  }

  // Watch auth
  onAuthStateChanged(auth, (user) => {
    state.user = user;
    if (user && !state.customer.email) {
      state.customer.name = user.displayName || "";
      state.customer.email = user.email || "";
    }
    render();
  });

  render();
}

// ----- Renderer
function render() {
  document.getElementById("step-tabs").innerHTML = `
    <div class="tab ${state.step === 1 ? "active" : ""}">1. Style</div>
    <div class="tab ${state.step === 2 ? "active" : ""}">2. Date &amp; time</div>
    <div class="tab ${state.step === 3 ? "active" : ""}">3. Your info</div>
  `;
  const main = document.getElementById("step-content");
  if (state.step === 1) main.innerHTML = stepStyleHTML();
  if (state.step === 2) main.innerHTML = stepDateHTML();
  if (state.step === 3) main.innerHTML = stepInfoHTML();
  bindStepHandlers();
  renderSummary();
}

function renderSummary() {
  const s = state.selectedStyle;
  const summary = document.getElementById("summary-content");
  if (!s) {
    summary.innerHTML = `<p style="margin:0">Pick a style to get started.</p>`;
    return;
  }
  summary.innerHTML = `
    <div style="display:flex; gap:12px; align-items:center; margin-bottom:14px">
      <div style="width:56px;height:70px;border-radius:8px;background:#e7ddd1;overflow:hidden;flex-shrink:0">
        ${s.image ? `<img src="${styleImgSrc(s.image)}" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.remove()">` : ""}
      </div>
      <div>
        <div style="font-weight:600">${escapeHtml(s.name)}</div>
        <div style="font-size:0.85rem;color:var(--color-muted)">${fmtDuration(s.durationMin)}</div>
      </div>
    </div>
    <div class="summary-row"><span>Service</span><span>${fmtMoney(s.priceCents)}</span></div>
    ${state.selectedDate ? `<div class="summary-row"><span>Date</span><span>${fmtDate(state.selectedDate)}</span></div>` : ""}
    ${state.selectedSlot ? `<div class="summary-row"><span>Time</span><span>${state.selectedSlot.toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit"})}</span></div>` : ""}
    <div class="summary-row total"><span>Total</span><span>${fmtMoney(s.priceCents || 0)}</span></div>
    <div style="font-size:0.78rem;color:var(--color-muted);margin-top:6px">
      Payment is due at your appointment. No online deposit required.
    </div>
  `;
}

// ----- Step 1: Style
function stepStyleHTML() {
  const sel = state.selectedStyle?.id;
  return `
    <h2 style="margin-bottom:8px">Choose your style</h2>
    <p>Tap a style to select it. You can change this any time.</p>
    <div class="style-grid" style="margin-top:18px">
      ${state.styles.map(s => `
        <button class="style-card" data-style-id="${s.id}" type="button"
          style="text-align:left; cursor:pointer; border:2px solid ${sel === s.id ? "var(--color-accent)" : "transparent"}">
          <div class="thumb">
            <div class="placeholder">${escapeHtml(s.name)}</div>
            ${s.image ? `<img src="${styleImgSrc(s.image)}" alt="" onerror="this.remove()">` : ""}
          </div>
          <div class="body">
            <h3>${escapeHtml(s.name)}</h3>
            <p style="margin:0; font-size:0.88rem">${escapeHtml(s.shortDesc || "")}</p>
            <div class="meta">
              <span class="duration">${fmtDuration(s.durationMin)}</span>
              <span class="price">${fmtMoney(s.priceCents)}</span>
            </div>
          </div>
        </button>
      `).join("")}
    </div>
    <div style="display:flex; justify-content:flex-end; margin-top:24px">
      <button class="btn btn-primary" id="to-step-2" ${state.selectedStyle ? "" : "disabled"}>
        Continue &rarr;
      </button>
    </div>
  `;
}

// ----- Step 2: Date + time
function stepDateHTML() {
  return `
    <h2 style="margin-bottom:8px">Pick a date &amp; time</h2>
    <p>Times shown reflect real availability. Sundays we're closed.</p>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-top:18px" id="cal-wrap">
      <div class="calendar" id="calendar"></div>
      <div id="slots-wrap">
        <h3 style="font-size:1.05rem; margin-bottom:8px">Available times</h3>
        <div id="slots" style="min-height:80px">
          <p style="color:var(--color-muted); font-size:0.92rem">Select a date.</p>
        </div>
      </div>
    </div>
    <div style="display:flex; justify-content:space-between; margin-top:24px">
      <button class="btn btn-ghost" id="back-step-1">&larr; Back</button>
      <button class="btn btn-primary" id="to-step-3" ${state.selectedSlot ? "" : "disabled"}>
        Continue &rarr;
      </button>
    </div>
  `;
}

// ----- Step 3: Customer info
function stepInfoHTML() {
  const c = state.customer;
  return `
    <h2 style="margin-bottom:8px">Almost there</h2>
    <p>We'll use this info to confirm your appointment.</p>
    <div id="info-alert"></div>
    <form id="info-form" style="margin-top:8px">
      <div class="field">
        <label for="name">Full name</label>
        <input id="name" name="name" type="text" value="${escapeHtml(c.name)}" required />
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" value="${escapeHtml(c.email)}" required />
      </div>
      <div class="field">
        <label for="phone">Phone</label>
        <input id="phone" name="phone" type="tel" value="${escapeHtml(c.phone)}" required />
      </div>
      <div class="field">
        <label for="notes">Notes (hair length, color preference, etc.)</label>
        <textarea id="notes" name="notes">${escapeHtml(c.notes)}</textarea>
      </div>
      <div style="display:flex; justify-content:space-between; margin-top:16px">
        <button class="btn btn-ghost" type="button" id="back-step-2">&larr; Back</button>
        <button class="btn btn-primary" type="submit" id="confirm-btn">
          Confirm booking &rarr;
        </button>
      </div>
      ${!state.user ? `
        <p style="text-align:center; font-size:0.85rem; color:var(--color-muted); margin-top:14px">
          Have an account? <a href="login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}">Log in</a> to autofill.
        </p>` : ""}
    </form>
  `;
}

// ----- Step handlers
function bindStepHandlers() {
  if (state.step === 1) {
    document.querySelectorAll("[data-style-id]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.styleId;
        state.selectedStyle = state.styles.find(s => s.id === id);
        render();
      });
    });
    document.getElementById("to-step-2")?.addEventListener("click", () => {
      if (state.selectedStyle) { state.step = 2; render(); }
    });
  }

  if (state.step === 2) {
    renderCalendar();
    document.getElementById("back-step-1").addEventListener("click", () => { state.step = 1; render(); });
    document.getElementById("to-step-3").addEventListener("click", () => {
      if (state.selectedSlot) { state.step = 3; render(); }
    });
  }

  if (state.step === 3) {
    document.getElementById("back-step-2").addEventListener("click", () => { state.step = 2; render(); });
    const form = document.getElementById("info-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const alertSlot = document.getElementById("info-alert");
      clearAlert(alertSlot);
      state.customer = {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        phone: form.phone.value.trim(),
        notes: form.notes.value.trim()
      };
      const btn = document.getElementById("confirm-btn");
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Confirming...`;
      try {
        const bookingId = await createBooking();
        stashConfirmation(bookingId);
        window.location.href = `${rootPath()}pages/success.html?bookingId=${encodeURIComponent(bookingId)}`;
      } catch (err) {
        showAlert(alertSlot, err.message);
        btn.disabled = false;
        btn.textContent = "Confirm booking →";
      }
    });
  }
}

// ----- Calendar
const calState = { viewMonth: monthStart(new Date()) };

function renderCalendar() {
  const el = document.getElementById("calendar");
  const today = new Date(); today.setHours(0,0,0,0);
  const m = calState.viewMonth;
  const monthName = m.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const firstDow = new Date(m.getFullYear(), m.getMonth(), 1).getDay();
  const lastDate = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(`<div></div>`);
  for (let d = 1; d <= lastDate; d++) {
    const date = new Date(m.getFullYear(), m.getMonth(), d);
    const dow = date.getDay();
    const closed = !DEFAULT_HOURS[dow];
    const past = date < today;
    const disabled = closed || past;
    const selected = state.selectedDate && sameDay(date, state.selectedDate);
    const isToday = sameDay(date, today);
    cells.push(`
      <div class="day ${disabled ? "disabled" : ""} ${selected ? "selected" : ""} ${isToday ? "today" : ""}"
           data-date="${date.toISOString()}">${d}</div>
    `);
  }
  el.innerHTML = `
    <div class="calendar-head">
      <button type="button" id="cal-prev" aria-label="Previous month">&larr;</button>
      <div style="font-weight:600">${monthName}</div>
      <button type="button" id="cal-next" aria-label="Next month">&rarr;</button>
    </div>
    <div class="calendar-grid">
      ${["S","M","T","W","T","F","S"].map(d => `<div class="dow">${d}</div>`).join("")}
      ${cells.join("")}
    </div>
  `;
  document.getElementById("cal-prev").addEventListener("click", () => {
    calState.viewMonth = new Date(m.getFullYear(), m.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById("cal-next").addEventListener("click", () => {
    calState.viewMonth = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    renderCalendar();
  });
  el.querySelectorAll(".day").forEach(day => {
    if (day.classList.contains("disabled")) return;
    day.addEventListener("click", async () => {
      state.selectedDate = new Date(day.dataset.date);
      state.selectedSlot = null;
      renderCalendar();
      await renderSlots();
      renderSummary();
      document.getElementById("to-step-3")?.toggleAttribute("disabled", !state.selectedSlot);
    });
  });
}

async function renderSlots() {
  const slotsEl = document.getElementById("slots");
  if (!state.selectedDate) return;
  slotsEl.innerHTML = `<div class="center-spinner" style="padding:20px"><div class="spinner"></div></div>`;

  const slots = await buildSlotsForDate(state.selectedDate, state.selectedStyle);
  const taken = await fetchTakenSlots(state.selectedDate);

  if (!slots.length) {
    slotsEl.innerHTML = `<p style="color:var(--color-muted)">No times available on this day.</p>`;
    return;
  }
  slotsEl.innerHTML = `
    <div class="slot-grid">
      ${slots.map(slot => {
        const conflict = taken.some(t => slot < t.end && t.start < new Date(slot.getTime() + state.selectedStyle.durationMin * 60000));
        const selected = state.selectedSlot && slot.getTime() === state.selectedSlot.getTime();
        return `<button type="button" class="slot ${conflict ? "taken" : ""} ${selected ? "selected" : ""}"
                  data-slot="${slot.toISOString()}" ${conflict ? "disabled" : ""}>
          ${slot.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </button>`;
      }).join("")}
    </div>
  `;
  slotsEl.querySelectorAll(".slot:not(.taken)").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedSlot = new Date(btn.dataset.slot);
      slotsEl.querySelectorAll(".slot").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      renderSummary();
      document.getElementById("to-step-3").disabled = false;
    });
  });
}

// ----- Slot math
function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms))
  ]);
}

async function buildSlotsForDate(date, style) {
  const dow = date.getDay();
  const dateKey = ymd(date);

  // Custom availability override?
  let hours = DEFAULT_HOURS[dow];
  if (!isPlaceholderConfig) {
    try {
      const overrideSnap = await withTimeout(
        getDoc(doc(db, "availability", dateKey)), 4000, "availability"
      );
      if (overrideSnap.exists()) {
        const data = overrideSnap.data();
        if (data.closed) return [];
        if (data.open != null && data.close != null) hours = { open: data.open, close: data.close };
      }
    } catch (_) { /* ignore - probably not set up yet */ }
  }

  if (!hours) return [];

  const step = DEFAULT_HOURS.defaultSlotMinutes;
  const duration = style?.durationMin || 60;
  const slots = [];
  const start = new Date(date); start.setHours(hours.open, 0, 0, 0);
  const close = new Date(date); close.setHours(hours.close, 0, 0, 0);

  // Don't offer slots that end after closing.
  const lastStart = new Date(close.getTime() - duration * 60000);
  let cur = new Date(start);
  const now = new Date();
  while (cur <= lastStart) {
    if (cur > now) slots.push(new Date(cur));
    cur = new Date(cur.getTime() + step * 60000);
  }
  return slots;
}

async function fetchTakenSlots(date) {
  if (isPlaceholderConfig) return [];
  const startOfDay = new Date(date); startOfDay.setHours(0,0,0,0);
  const endOfDay = new Date(date); endOfDay.setHours(23,59,59,999);
  try {
    const q = query(
      collection(db, "bookings"),
      where("startAt", ">=", startOfDay),
      where("startAt", "<=", endOfDay)
    );
    const snap = await withTimeout(getDocs(q), 5000, "bookings");
    return snap.docs
      .map(d => d.data())
      .filter(b => b.status !== "cancelled")
      .map(b => ({
        start: b.startAt.toDate ? b.startAt.toDate() : new Date(b.startAt),
        end: b.endAt?.toDate ? b.endAt.toDate() : new Date(b.endAt)
      }));
  } catch (err) {
    console.warn("Couldn't read bookings (Firestore not configured yet?):", err.message);
    return [];
  }
}

// ----- Create booking (confirmed — no Stripe yet)
async function createBooking() {
  const s = state.selectedStyle;
  const start = state.selectedSlot;
  const end = new Date(start.getTime() + s.durationMin * 60000);

  const bookingData = {
    userId: state.user?.uid || null,
    customer: state.customer,
    styleId: s.id,
    styleName: s.name,
    priceCents: s.priceCents,
    depositCents: s.depositCents || 0,
    durationMin: s.durationMin,
    startAt: start,
    endAt: end,
    status: "confirmed",
    paymentStatus: "due_at_appointment",
    createdAt: serverTimestamp()
  };

  if (isPlaceholderConfig) {
    const localId = "local-" + Date.now();
    return localId;
  }

  try {
    const ref = await withTimeout(addDoc(collection(db, "bookings"), bookingData), 6000, "addDoc");
    return ref.id;
  } catch (err) {
    console.warn("Firestore unavailable.", err.message);
    throw new Error(`Couldn't save your booking. ${err.message}`);
  }
}

function stashConfirmation(bookingId) {
  const s = state.selectedStyle;
  const start = state.selectedSlot;
  const end = new Date(start.getTime() + s.durationMin * 60000);
  sessionStorage.setItem("confirmedBooking", JSON.stringify({
    id: bookingId,
    styleName: s.name,
    priceCents: s.priceCents,
    durationMin: s.durationMin,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    customer: { ...state.customer }
  }));
}

// ----- date helpers
function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
