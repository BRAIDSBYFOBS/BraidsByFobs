// Shared UI helpers: navbar auth state, mobile nav toggle, year stamp.

import { auth, onAuthStateChanged, signOut, isAdmin } from "./firebase-config.js";
import { getSiteContent } from "./site-content.js";

export function injectNav(activeKey = "") {
  const navHTML = `
    <nav class="nav">
      <div class="container nav-inner">
        <a href="${rootPath()}index.html" class="brand">Braids <span>By Fobs</span></a>
        <button class="nav-toggle" aria-label="Open menu">&#9776;</button>
        <div class="nav-links">
          <a href="${rootPath()}index.html" data-key="home">Home</a>
          <a href="${rootPath()}pages/styles.html" data-key="styles">Styles</a>
          <a href="${rootPath()}pages/book.html" data-key="book">Book</a>
          <a href="${rootPath()}index.html#about" data-key="about">About</a>
          <a href="${rootPath()}pages/account.html" data-key="account" data-auth="required" style="display:none">My Account</a>
          <a href="${rootPath()}pages/admin.html" data-key="admin" data-auth="admin" style="display:none">Admin</a>
          <a href="${rootPath()}pages/login.html" data-key="login" data-auth="guest">Login</a>
          <a href="#" data-key="logout" data-auth="required" style="display:none">Log out</a>
          <a href="${rootPath()}pages/book.html" class="btn btn-accent" style="padding:8px 16px" data-key="cta">Book Now</a>
        </div>
      </div>
    </nav>
  `;
  const slot = document.getElementById("nav-slot");
  if (slot) slot.innerHTML = navHTML;

  // Active link highlight
  if (activeKey) {
    document.querySelectorAll(`.nav-links a[data-key="${activeKey}"]`).forEach(a => {
      a.style.color = "var(--color-accent-hover)";
    });
  }

  // Mobile toggle
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => links.classList.toggle("open"));
  }

  // Logout
  const logoutLink = document.querySelector('[data-key="logout"]');
  if (logoutLink) {
    logoutLink.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut(auth);
      window.location.href = `${rootPath()}index.html`;
    });
  }

  // Auth-state visibility
  onAuthStateChanged(auth, (user) => {
    const showFor = (sel, ok) =>
      document.querySelectorAll(sel).forEach(el => el.style.display = ok ? "" : "none");
    showFor('[data-auth="required"]', !!user);
    showFor('[data-auth="guest"]', !user);
    showFor('[data-auth="admin"]', isAdmin(user));
  });
}

export function injectFooter() {
  const footerHTML = `
    <footer class="footer">
      <div class="container">
        <div class="footer-grid">
          <div>
            <div class="brand" style="color:#fff; margin-bottom:10px" id="footer-brand">Braids <span>By Fobs</span></div>
            <p style="color:#a8978a; max-width:340px" id="footer-blurb">
              Protective hairstyles crafted with care. Box braids, knotless,
              feed-ins, locs, twists &mdash; tailored to you.
            </p>
          </div>
          <div>
            <h4>Explore</h4>
            <a href="${rootPath()}index.html">Home</a>
            <a href="${rootPath()}pages/styles.html">Styles</a>
            <a href="${rootPath()}pages/book.html">Book</a>
          </div>
          <div>
            <h4>Account</h4>
            <a href="${rootPath()}pages/login.html">Login</a>
            <a href="${rootPath()}pages/signup.html">Sign up</a>
            <a href="${rootPath()}pages/account.html">My bookings</a>
          </div>
          <div>
            <h4>Contact</h4>
            <a id="footer-email" href="mailto:hello@braidsbyfobs.com">hello@braidsbyfobs.com</a>
            <a id="footer-phone" href="tel:+10000000000">(000) 000-0000</a>
            <a id="footer-instagram" href="https://instagram.com/" target="_blank" rel="noopener">Instagram</a>
          </div>
        </div>
        <div class="copy">&copy; <span id="year"></span> <span id="footer-copy-brand">Braids By Fobs</span>. All rights reserved.</div>
      </div>
    </footer>
  `;
  const slot = document.getElementById("footer-slot");
  if (slot) slot.innerHTML = footerHTML;
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  // Overlay editable content (contact info, blurb, brand name) when available.
  getSiteContent().then((content) => {
    const c = content.contact || {};
    if (c.email) {
      const a = document.getElementById("footer-email");
      if (a) { a.href = `mailto:${c.email}`; a.textContent = c.email; }
    }
    if (c.phone) {
      const a = document.getElementById("footer-phone");
      if (a) {
        a.href = `tel:${c.phone.replace(/[^0-9+]/g, "")}`;
        a.textContent = c.phone;
      }
    }
    if (c.instagram) {
      const a = document.getElementById("footer-instagram");
      if (a) a.href = c.instagram;
    }
    if (c.footerBlurb) {
      const p = document.getElementById("footer-blurb");
      if (p) p.textContent = c.footerBlurb;
    }
    if (content.brandName) {
      const copy = document.getElementById("footer-copy-brand");
      if (copy) copy.textContent = content.brandName;
    }
  }).catch(() => { /* keep defaults */ });
}

// Where is the site root from the current page?
export function rootPath() {
  // If we're inside /pages/, root is "../"; otherwise it's "./"
  const path = window.location.pathname.replace(/\\/g, "/");
  return /\/pages\//.test(path) ? "../" : "./";
}

// Build a path to an image in /images/styles relative to current page
export function styleImgSrc(filename) {
  if (!filename) return "";
  if (/^https?:/.test(filename)) return filename;
  return `${rootPath()}images/styles/${filename}`;
}

// Tiny query-string helpers
export const qs = (k) => new URLSearchParams(window.location.search).get(k);

// Toast-ish alert utility
export function showAlert(container, message, type = "error") {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
}
export function clearAlert(container) {
  if (container) container.innerHTML = "";
}

// Tiny HTML escaper for any user-supplied text we inject
export function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Guard a page so only signed-in users can view it
export function requireAuth(redirectTo = "login.html") {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (!user) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `${redirectTo}?next=${next}`;
      } else {
        resolve(user);
      }
    });
  });
}

// Guard a page so only admins can view it
export function requireAdmin(redirectTo = "../index.html") {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (!isAdmin(user)) {
        window.location.href = redirectTo;
      } else {
        resolve(user);
      }
    });
  });
}
