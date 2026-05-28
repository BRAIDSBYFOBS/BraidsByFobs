// ============================================================
// Firebase configuration & shared module
// Site version: 2026.05.28
// Deploy: 2026-05-28 (cache-bust)
// ------------------------------------------------------------
// 1. Replace the firebaseConfig values below with your own from
//    Firebase Console > Project Settings > General > Your apps.
// 2. The Cloud Functions URL is filled in after you deploy
//    Functions ("firebase deploy --only functions"). Until then,
//    Stripe checkout will throw a friendly error.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, GoogleAuthProvider,
  signInWithPopup, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc,
  setDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
  serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---- YOUR CONFIG GOES HERE ---------------------------------
export const firebaseConfig = {
    apiKey: "AIzaSyD1NyBrTydCH7qrnwe97G4wc2oJzgTJ6Q8",
    authDomain: "braids-by-fobs.firebaseapp.com",
    projectId: "braids-by-fobs",
    storageBucket: "braids-by-fobs.firebasestorage.app",
    messagingSenderId: "594130482778",
    appId: "1:594130482778:web:299cb5e2e5c55b80b84a63"
};

// URL of your deployed `createCheckoutSession` Cloud Function.
// After `firebase deploy --only functions`, paste the URL here.
// Example: "https://us-central1-yourproj.cloudfunctions.net/createCheckoutSession"
export const FUNCTIONS_BASE_URL = "https://uploadimage-2agee2jgtq-uc.a.run.app";

// Admin email allowlist — these users see the /admin page.
// (Also enforced in Firestore security rules.)
export const ADMIN_EMAILS = ["blessingfobs@gmail.com"];

// Bump this when you push a release so browsers pick up CSS/JS changes.
export const SITE_VERSION = "2026.05.28";

// GitHub repo that hosts the site. Used by the admin "Upload photo" buttons
// to deep-link to the right /upload/<branch>/images/... page on GitHub so the
// admin can commit photos straight into the repo (which is what gets served
// by GitHub Pages).
export const GITHUB_REPO = "BRAIDSBYFOBS/BraidsByFobs";
export const GITHUB_BRANCH = "main";

// ------------------------------------------------------------
// True until you've replaced the placeholder values above.
// Used by the data layer to skip Firestore calls (which would otherwise
// retry forever in the background and hang awaits).
export const isPlaceholderConfig =
  !firebaseConfig.apiKey ||
  firebaseConfig.apiKey.includes("REPLACE") ||
  !firebaseConfig.projectId ||
  firebaseConfig.projectId.includes("REPLACE");

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, GoogleAuthProvider,
  signInWithPopup, updateProfile,
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc,
  deleteDoc, query, where, orderBy, limit, serverTimestamp, onSnapshot
};

// Deep-link to GitHub's "Upload files" page for a directory inside the repo.
// Returns "" if GITHUB_REPO hasn't been configured yet.
export function githubUploadUrl(repoPath) {
  if (!GITHUB_REPO || GITHUB_REPO.includes("REPLACE_WITH")) return "";
  const clean = String(repoPath || "").replace(/^\/+|\/+$/g, "");
  return `https://github.com/${GITHUB_REPO}/upload/${GITHUB_BRANCH}/${clean}`;
}

// Deep-link to browse a directory in the repo on GitHub.
export function githubBrowseUrl(repoPath) {
  if (!GITHUB_REPO || GITHUB_REPO.includes("REPLACE_WITH")) return "";
  const clean = String(repoPath || "").replace(/^\/+|\/+$/g, "");
  return `https://github.com/${GITHUB_REPO}/tree/${GITHUB_BRANCH}/${clean}`;
}

// Compress an image on-device before upload so we stay under the function's
// payload limit and the repo stays small. Resizes to fit `maxDim` on the
// longest side and re-encodes as JPEG. GIFs (which may be animated) and
// small files are returned as-is.
export async function compressImage(file, maxDim = 1600, quality = 0.85) {
  if (!file || !file.type || !file.type.startsWith("image/")) return file;
  if (file.type === "image/gif") return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (_) {
    return file;
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > maxDim ? maxDim / longest : 1;
  if (scale === 1 && file.size < 800 * 1024) return file;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", quality));
  if (!blob) return file;
  const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], newName, { type: "image/jpeg" });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

// Upload an image to the GitHub repo via the `uploadImage` Cloud Function.
// `folder` must be one of "styles" | "site". Returns the repo-relative path
// (e.g. "images/styles/1716...-photo.jpg") which is what the admin form saves.
export async function uploadImageToRepo(file, folder) {
  if (!file) throw new Error("No file selected");
  if (!auth.currentUser) throw new Error("You must be signed in to upload");
  if (!FUNCTIONS_BASE_URL) {
    throw new Error("FUNCTIONS_BASE_URL is empty in scripts/firebase-config.js — deploy functions first.");
  }
  const compressed = await compressImage(file);
  const contentBase64 = await fileToBase64(compressed);
  const idToken = await auth.currentUser.getIdToken();

  const base = FUNCTIONS_BASE_URL.replace(/\/$/, "");
  // Gen-2 deploy prints a *.run.app URL that IS the function — no /uploadImage suffix.
  const url = /\.run\.app$/i.test(base) ? base : `${base}/uploadImage`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify({
      folder,
      filename: compressed.name,
      contentBase64,
      contentType: compressed.type
    })
  }).catch((err) => {
    throw new Error(
      err.message === "Failed to fetch"
        ? "Could not reach the upload server (network/CORS). If this persists, redeploy functions with invoker:public or run the gcloud invoker fix in the README."
        : err.message
    );
  });

  let body = null;
  try { body = await resp.json(); } catch (_) { /* ignore */ }
  if (!resp.ok) {
    throw new Error((body && body.error) || `Upload failed (${resp.status})`);
  }
  return body.path;
}

// True when the Cloud Function URL has been configured (so we can choose
// between "click a file picker" and "upload through GitHub UI" in the admin).
export function canUploadViaFunction() {
  return !!FUNCTIONS_BASE_URL;
}

// Convenience: is current user admin?
export function isAdmin(user) {
  return !!user && ADMIN_EMAILS.includes((user.email || "").toLowerCase());
}

// Format helpers reused across pages
export const fmtMoney = (cents) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export const fmtDate = (d) => {
  if (!d) return "";
  const date = d.toDate ? d.toDate() : new Date(d);
  return date.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric"
  });
};

export const fmtTime = (d) => {
  if (!d) return "";
  const date = d.toDate ? d.toDate() : new Date(d);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

export const fmtDuration = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
};
