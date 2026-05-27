// Cloud Functions for Braids By Fobs
// ------------------------------------------------------------
// Two endpoints:
//   POST /createCheckoutSession  -> creates a Stripe Checkout session for a booking deposit
//   POST /stripeWebhook          -> updates the booking status when Stripe confirms payment
//
// Setup:
//   1. firebase functions:secrets:set STRIPE_SECRET_KEY
//   2. firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
//   3. firebase deploy --only functions
//   4. In Stripe dashboard, add a webhook endpoint pointing to the deployed
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
