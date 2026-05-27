// Loads editable homepage / footer copy from Firestore (`site/content`) and
// falls back to a baked-in default so the site is never blank. Admins edit
// these values from pages/admin.html → "Site" tab.

import { db, doc, getDoc, isPlaceholderConfig } from "./firebase-config.js";

export const DEFAULT_CONTENT = {
  brandName: "Braids By Fobs",
  brandTagline: "By Fobs",
  hero: {
    eyebrow: "Protective styles, expertly braided",
    headline: "Beautiful braids,\nbooked in minutes.",
    lead: "Browse our gallery of knotless braids, twists, locs, and cornrows. Pick a style, choose a time, and we'll handle the rest — all online.",
    primaryCtaLabel: "Browse styles",
    secondaryCtaLabel: "Book an appointment",
    imageUrl: ""
  },
  features: [
    { title: "Pick a style", body: "Explore the gallery and read what's included for each style." },
    { title: "Choose your time", body: "Real-time calendar shows when we're actually available." },
    { title: "Pay your deposit", body: "Secure your slot with a small deposit. Balance due at your appointment." }
  ],
  featured: {
    eyebrow: "Most loved",
    heading: "Featured styles",
    body: "A few favorites — see the full gallery for everything we offer."
  },
  about: {
    eyebrow: "About",
    heading: "Hi, I'm Fobs.",
    body: "I've been braiding hair for over a decade, specializing in knotless braids and scalp-friendly protective styles. Every appointment is one-on-one and tailored to your hair, lifestyle, and the look you're going for.\n\nSessions are by appointment only so I can give you my full attention — no rushed chairs, no overbooking. Browse the gallery, book a time, and let's make magic.",
    ctaLabel: "Book with me",
    imageUrl: ""
  },
  testimonials: {
    heading: "What clients say",
    items: [
      { text: "My knotless braids lasted nine weeks and my edges thanked me. Booking online was effortless.", who: "Amara K." },
      { text: "Fobs is so gentle with my daughter's hair. We've found our forever braider.", who: "Janelle T." },
      { text: "The boho knotless install was unreal. I get compliments daily.", who: "Sade R." }
    ]
  },
  cta: {
    heading: "Ready for your next style?",
    body: "Pick a date, lock it in with a deposit, and show up to be pampered.",
    ctaLabel: "Book your appointment"
  },
  contact: {
    email: "hello@braidsbyfobs.com",
    phone: "(000) 000-0000",
    instagram: "https://instagram.com/",
    footerBlurb: "Protective hairstyles crafted with care. Box braids, knotless, feed-ins, locs, twists — tailored to you."
  }
};

let _cache = null;
let _inflight = null;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

// Merge user-saved partial content over the defaults. Top-level keys win as
// whole objects (so admin can clear a section by saving an empty object).
function applyDefaults(saved) {
  const out = JSON.parse(JSON.stringify(DEFAULT_CONTENT));
  if (!saved || typeof saved !== "object") return out;
  for (const key of Object.keys(DEFAULT_CONTENT)) {
    if (saved[key] == null) continue;
    if (Array.isArray(DEFAULT_CONTENT[key])) {
      out[key] = Array.isArray(saved[key]) ? saved[key] : DEFAULT_CONTENT[key];
    } else if (typeof DEFAULT_CONTENT[key] === "object") {
      out[key] = { ...DEFAULT_CONTENT[key], ...saved[key] };
    } else {
      out[key] = saved[key];
    }
  }
  return out;
}

export async function getSiteContent() {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  if (isPlaceholderConfig) {
    _cache = applyDefaults(null);
    return _cache;
  }
  _inflight = (async () => {
    try {
      const snap = await withTimeout(getDoc(doc(db, "site", "content")), 5000);
      _cache = applyDefaults(snap.exists() ? snap.data() : null);
    } catch (err) {
      console.warn("Site content unavailable, using defaults.", err.message);
      _cache = applyDefaults(null);
    } finally {
      _inflight = null;
    }
    return _cache;
  })();
  return _inflight;
}

export function invalidateSiteContentCache() {
  _cache = null;
  _inflight = null;
}
