// Loads hairstyles either from Firestore (if configured + seeded) or from the
// local data/seed-styles.json fallback. This means the site works immediately
// after `git clone` even before you've set up Firebase.

import {
  db, collection, getDocs, doc, getDoc, isPlaceholderConfig
} from "./firebase-config.js";
import { rootPath } from "./common.js";

let _cache = null;

// Race any Firestore call against a timeout. Without this, the SDK retries
// forever in the background and our `await` never resolves when the config
// is bad or the network is unreachable.
function withTimeout(promise, ms, label = "Firestore") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    )
  ]);
}

async function fetchFirestoreStyles() {
  if (isPlaceholderConfig) return null;
  try {
    const snap = await withTimeout(getDocs(collection(db, "styles")), 5000, "styles fetch");
    if (snap.empty) return null;
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("Firestore styles unavailable, using seed file.", err.message);
    return null;
  }
}

async function fetchSeedStyles() {
  const res = await fetch(`${rootPath()}data/seed-styles.json`);
  if (!res.ok) throw new Error("Could not load seed styles");
  return res.json();
}

export async function getAllStyles({ activeOnly = true } = {}) {
  if (!_cache) {
    const fromDb = await fetchFirestoreStyles();
    _cache = fromDb && fromDb.length ? fromDb : await fetchSeedStyles();
  }
  return activeOnly ? _cache.filter(s => s.active !== false) : _cache;
}

export async function getFeaturedStyles(maxN = 3) {
  const all = await getAllStyles();
  const featured = all.filter(s => s.featured);
  return (featured.length ? featured : all).slice(0, maxN);
}

export async function getStyleById(id) {
  if (!id) return null;
  if (!isPlaceholderConfig) {
    try {
      const snap = await withTimeout(getDoc(doc(db, "styles", id)), 5000, "style fetch");
      if (snap.exists()) return { id: snap.id, ...snap.data() };
    } catch (_) {
      /* fall through to seed */
    }
  }
  const all = await getAllStyles({ activeOnly: false });
  return all.find(s => s.id === id) || null;
}

export function invalidateStyleCache() { _cache = null; }
