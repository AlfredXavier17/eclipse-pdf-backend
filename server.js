// =============================================
//  Eclipse PDF – Stripe + Firestore Backend
// =============================================
const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");
const path = require("path");
const bodyParser = require("body-parser");
require("dotenv").config();

// =========================
// 🔥 Firebase Admin Setup
// =========================
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const app = express();

// 🔐 Stripe secret (LIVE MODE)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 💵 Stripe price ID
const LIVE_PRICE_ID = "price_1ST9PrJ6zNG9KpDmFEZOcAjk";

// CORS + static files
app.use(cors());
app.use(express.static(path.join(__dirname, "web"))); // success.html / cancel.html

// =====================================================
// ⭐ Firestore helper: Update user data
// =====================================================
async function updateUser(uid, data) {
  await db.collection("users").doc(uid).set(data, { merge: true });
}

// =====================================================
// ⭐ Firestore helper: Get user data
// =====================================================
async function getUser(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

// =====================================================
// 🟦 CREATE CHECKOUT SESSION
// =====================================================
app.post("/create-checkout-session", express.json(), async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) return res.status(400).json({ error: "Missing UID" });

    // Get user to see if a Stripe customer already exists
    const userData = await getUser(uid);

    let customerId = userData?.customerId;

    // If no customer, create one
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { uid }
      });

      customerId = customer.id;

      await updateUser(uid, { customerId });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: LIVE_PRICE_ID,
          quantity: 1
        }
      ],
      customer: customerId,
      success_url: "https://eclipse-pdf-backend.onrender.com/success.html",
      cancel_url: "https://eclipse-pdf-backend.onrender.com/cancel.html"
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Checkout Error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// =====================================================
// ⚡ STRIPE WEBHOOK → UPDATE FIRESTORE
// =====================================================
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook signature failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // invoice.paid → user subscribed
    if (event.type === "invoice.paid") {
      const invoice = event.data.object;

      const customer = await stripe.customers.retrieve(invoice.customer);
      const uid = customer.metadata.uid;

      await updateUser(uid, {
        isPremium: true,
        subscriptionId: invoice.subscription,
        lastPaid: Date.now()
      });
    }

    // subscription canceled
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;

      const customer = await stripe.customers.retrieve(subscription.customer);
      const uid = customer.metadata.uid;

      await updateUser(uid, {
        isPremium: false
      });
    }

    res.json({ received: true });
  }
);

// =====================================================
// 🧾 Customer portal
// =====================================================
app.post("/manage-subscription", express.json(), async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) return res.json({ error: "Missing UID" });

    const userData = await getUser(uid);

    if (!userData?.customerId) {
      return res.json({ error: "No customer found." });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: userData.customerId,
      return_url: "https://eclipse-pdf.com"
    });

    res.json({ url: portal.url });
  } catch (err) {
    console.error("❌ Portal error:", err);
    res.status(500).json({ error: "Failed to open portal" });
  }
});




// =====================================================
// ⭐ ENTITLEMENT CHECK (Electron → Backend → Firestore)
// =====================================================
app.post("/entitlement", express.json(), async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.json({ isPremium: false });
    }

    const userData = await getUser(uid);

    res.json({
      isPremium: userData?.isPremium === true
    });
  } catch (err) {
    console.error("Entitlement error:", err);
    res.json({ isPremium: false });
  }
});


// =====================================================
// 🚀 Start server
// =====================================================
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log("🔥 Backend running on port " + PORT);
});
