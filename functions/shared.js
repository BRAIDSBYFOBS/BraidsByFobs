// Shared Firebase init + CORS helper for Cloud Functions.

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const ALLOWED_ORIGINS = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:5000",
];

function setCors(req, res) {
  const origin = req.get("origin");
  if (ALLOWED_ORIGINS.includes(origin) || /\.github\.io$/.test(origin || "")) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    res.set("Access-Control-Allow-Origin", "*");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = { admin, db, setCors };
