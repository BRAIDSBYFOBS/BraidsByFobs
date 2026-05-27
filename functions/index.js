// Cloud Functions for Braids By Fobs
// ------------------------------------------------------------
// Three endpoints:
//   POST /createCheckoutSession  -> creates a Stripe Checkout session for a booking deposit
//   POST /stripeWebhook          -> updates the booking status when Stripe confirms payment
//   POST /uploadImage            -> admin-only: commits an image straight into the repo
//
// Setup:
//   1. firebase functions:secrets:set STRIPE_SECRET_KEY
//   2. firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
//   3. firebase functions:secrets:set GITHUB_TOKEN
//      (Create a fine-grained PAT at github.com/settings/tokens?type=beta
//       with Repository access = your site repo, and "Contents: Read and write"
//       under Repository permissions.)
//   4. Edit functions/.env and set GITHUB_REPO=owner/repo (and optionally
//      GITHUB_BRANCH=main).
//   5. firebase deploy --only functions
//   6. In Stripe dashboard, add a webhook endpoint pointing to the deployed
//      stripeWebhook URL and select the "checkout.session.completed" event.

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const GITHUB_TOKEN = defineSecret("GITHUB_TOKEN");

// Repo target for /uploadImage. Read from functions/.env so the value can be
// changed without editing code. Fall back to a sensible default if .env hasn't
// been populated yet — the function will return a clear error in that case.
const GITHUB_REPO = process.env.GITHUB_REPO || "";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

// Admins permitted to call /uploadImage. MUST match ADMIN_EMAILS in
// scripts/firebase-config.js and the email list in firestore.rules.
const ADMIN_EMAILS = new Set(["blessingfobs@gmail.com"]);

// Image upload limits. Browser-side compression keeps files well under this.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;  // 8 MB decoded
const ALLOWED_FOLDERS = new Set(["styles", "site"]);
const FILENAME_RE = /^[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|gif)$/i;

// Allowed origins for CORS (your GitHub Pages site + local dev)
const ALLOWED_ORIGINS = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:5000",
  // Add your GitHub Pages origin once known, e.g.:
  // "https://your-username.github.io"
];

function setCors(req, res) {
  const origin = req.get("origin");
  if (ALLOWED_ORIGINS.includes(origin) || /\.github\.io$/.test(origin || "")) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    res.set("Access-Control-Allow-Origin", "*");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

// ---------- createCheckoutSession ----------
exports.createCheckoutSession = onRequest(
  { secrets: [STRIPE_SECRET_KEY] },
  async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
      const stripe = require("stripe")(STRIPE_SECRET_KEY.value());
      const { bookingId, successUrl, cancelUrl } = req.body || {};
      if (!bookingId || !successUrl || !cancelUrl) {
        return res.status(400).json({ error: "Missing bookingId/successUrl/cancelUrl" });
      }

      const bookingSnap = await db.collection("bookings").doc(bookingId).get();
      if (!bookingSnap.exists) return res.status(404).json({ error: "Booking not found" });
      const booking = bookingSnap.data();

      if (booking.status !== "pending") {
        return res.status(409).json({ error: "Booking is not in a payable state" });
      }

      const amount = booking.depositCents || 0;
      if (amount <= 0) return res.status(400).json({ error: "No deposit configured" });

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: {
              name: `Deposit: ${booking.styleName}`,
              description: `Appointment ${new Date(booking.startAt.toDate()).toLocaleString()}`
            },
            unit_amount: amount
          },
          quantity: 1
        }],
        customer_email: booking.customer?.email || undefined,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { bookingId }
      });

      return res.json({ url: session.url, id: session.id });
    } catch (err) {
      console.error("createCheckoutSession error", err);
      return res.status(500).json({ error: err.message });
    }
  }
);

// ---------- stripeWebhook ----------
exports.stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] },
  async (req, res) => {
    const stripe = require("stripe")(STRIPE_SECRET_KEY.value());
    const sig = req.headers["stripe-signature"];

    let event;
    try {
      // req.rawBody is provided by Cloud Functions
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        STRIPE_WEBHOOK_SECRET.value()
      );
    } catch (err) {
      console.error("Webhook signature verification failed", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const bookingId = session.metadata?.bookingId;
        if (bookingId) {
          await db.collection("bookings").doc(bookingId).update({
            status: "confirmed",
            paymentStatus: "deposit_paid",
            stripeSessionId: session.id,
            paidAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      }
      return res.json({ received: true });
    } catch (err) {
      console.error("Webhook handler error", err);
      return res.status(500).send(`Webhook handler error: ${err.message}`);
    }
  }
);

// ---------- uploadImage ----------
// Admin-only. Browser sends { folder, filename, contentBase64, contentType }
// with an Authorization: Bearer <id-token> header. We verify the caller is
// an admin and PUT the file into the repo at images/{folder}/{ts}-{name}.
// On success the response is { path: "images/styles/1716....jpg" } and the
// admin form stores that path on the document. GitHub Pages republishes the
// site automatically within ~1-2 minutes of the commit.
exports.uploadImage = onRequest(
  { secrets: [GITHUB_TOKEN] },
  async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
      if (!GITHUB_REPO) {
        return res.status(500).json({
          error: "Server not configured: set GITHUB_REPO in functions/.env and redeploy."
        });
      }

      // Auth: verify Firebase ID token + admin allowlist + email_verified.
      const authHeader = req.get("Authorization") || "";
      const tokenMatch = authHeader.match(/^Bearer (.+)$/);
      if (!tokenMatch) {
        return res.status(401).json({ error: "Missing Authorization bearer token" });
      }
      let decoded;
      try {
        decoded = await admin.auth().verifyIdToken(tokenMatch[1]);
      } catch (err) {
        return res.status(401).json({ error: "Invalid auth token" });
      }
      const email = (decoded.email || "").toLowerCase();
      if (!ADMIN_EMAILS.has(email) || !decoded.email_verified) {
        return res.status(403).json({ error: "Admin access required" });
      }

      // Validate body.
      const { folder, filename, contentBase64, contentType } = req.body || {};
      if (!ALLOWED_FOLDERS.has(folder)) {
        return res.status(400).json({ error: `Invalid folder: ${folder}` });
      }
      if (typeof filename !== "string" || !FILENAME_RE.test(filename)) {
        return res.status(400).json({ error: "Invalid filename (alphanumeric, dot, dash, underscore only; JPG/PNG/WEBP/GIF)" });
      }
      if (typeof contentBase64 !== "string" || !contentBase64.length) {
        return res.status(400).json({ error: "Missing image data" });
      }
      if (typeof contentType !== "string" || !/^image\//.test(contentType)) {
        return res.status(400).json({ error: "Not an image content type" });
      }
      // Rough size check: base64 expands ~33%, so true bytes ≈ 0.75 * length.
      const approxBytes = Math.floor(contentBase64.length * 0.75);
      if (approxBytes > MAX_IMAGE_BYTES) {
        return res.status(413).json({ error: `Image too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)` });
      }

      // Compose the repo path. Timestamp prefix avoids overwriting existing files.
      const safeName = filename.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
      const repoPath = `images/${folder}/${Date.now()}-${safeName}`;

      // PUT to the GitHub Contents API.
      const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURI(repoPath)}`;
      const ghResp = await fetch(apiUrl, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN.value()}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "BraidsByFobs-Admin"
        },
        body: JSON.stringify({
          message: `Upload ${repoPath} via admin`,
          content: contentBase64,
          branch: GITHUB_BRANCH,
          committer: { name: "Admin Upload", email }
        })
      });

      if (!ghResp.ok) {
        const text = await ghResp.text().catch(() => "");
        console.error("GitHub API error", ghResp.status, text);
        return res.status(502).json({
          error: `GitHub rejected the upload (${ghResp.status}). Check that GITHUB_TOKEN is valid and has write access to ${GITHUB_REPO}.`
        });
      }

      return res.json({ path: repoPath, branch: GITHUB_BRANCH });
    } catch (err) {
      console.error("uploadImage error", err);
      return res.status(500).json({ error: err.message });
    }
  }
);
