// ============================================================
// Firebase configuration & shared module
// Deploy: 2026-05-27 (cache-bust)
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
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

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
export const FUNCTIONS_BASE_URL = "";

// Admin email allowlist — these users see the /admin page.
// (Also enforced in Firestore security rules.)
export const ADMIN_EMAILS = ["blessingfobs@gmail.com"];

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
export const storage = getStorage(app);

export {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, GoogleAuthProvider,
  signInWithPopup, updateProfile,
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc,
  deleteDoc, query, where, orderBy, limit, serverTimestamp, onSnapshot,
  storageRef, uploadBytes, getDownloadURL, deleteObject
};

// Upload a File/Blob to Firebase Storage and return its public download URL.
// `folder` is a path under /uploads (e.g. "styles", "site"). The filename is
// randomized so re-uploads never clobber each other.
export async function uploadImage(file, folder = "misc") {
  if (!file) throw new Error("No file selected");
  if (!file.type || !file.type.startsWith("image/")) {
    throw new Error("Please choose an image file");
  }
  const MAX_BYTES = 10 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    throw new Error("Image is larger than 10 MB");
  }
  const safeFolder = String(folder).replace(/[^a-z0-9_-]/gi, "") || "misc";
  const ext = (file.name.split(".").pop() || "jpg")
    .toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `uploads/${safeFolder}/${id}.${ext}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file, { contentType: file.type });
  return await getDownloadURL(r);
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
