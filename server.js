// =============================================
//  Eclipse PDF – Stripe + Firestore Backend (FINAL)
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
const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const app = express();

// =========================
// 💳 Stripe Setup
// =========================
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const LIVE_PRICE_ID = "price_1ST9PrJ6zNG9KpDmFEZOcAjk";

// =========================
// Middleware
// =========================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "web"))); // success.html / cancel.html

// =====================================================
// 🧠 Firestore helpers
// =====================================================
async function updateUser(uid, data) {
  const clean = {};
  for (const [k, v] of Object.entries(data)) {
    clean[k] = v === undefined ? null : v;
  }
  await db.collection("users").doc(uid).set(clean, { merge: true });
}

async function getUser(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

// =====================================================
// ✅ SYNC USER (CALLED AFTER GOOGLE SIGN-IN)
// =====================================================
app.post("/sync-user", async (req, res) => {
  try {
    const { uid, email, displayName } = req.body;
    if (!uid || !email) {
      return res.status(400).json({ error: "Missing uid or email" });
    }

    await updateUser(uid, {
      uid,
      email,
      displayName: displayName || email.split("@")[0],
      isPremium: false,
      createdAt: Date.now()
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ sync-user error:", err);
    res.status(500).json({ error: "Failed to sync user" });
  }
});

// =====================================================
// ⏱️ SYNC USAGE (TRIAL TIME)
// =====================================================
app.post("/sync-usage", async (req, res) => {
  try {
    const { uid, dailySecondsUsed, date } = req.body;
    if (!uid) return res.json({ success: false });

    await updateUser(uid, {
      dailySecondsUsed,
      lastUsageDate: date
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ sync-usage error:", err);
    res.json({ success: false });
  }
});

// =====================================================
// 🟦 CREATE CHECKOUT SESSION
// =====================================================
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: "Missing UID" });

    const user = await getUser(uid);
    let customerId = user?.customerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { uid }
      });
      customerId = customer.id;
      await updateUser(uid, { customerId });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: LIVE_PRICE_ID, quantity: 1 }],
      success_url: "https://eclipse-pdf-backend.onrender.com/success.html",
      cancel_url: "https://eclipse-pdf-backend.onrender.com/cancel.html"
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ checkout error:", err);
    res.status(500).json({ error: "Checkout failed" });
  }
});

// =====================================================
// ⚡ STRIPE WEBHOOK
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
      console.error("❌ Webhook signature error:", err.message);
      return res.status(400).send("Webhook error");
    }

    // ✅ Payment completed
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const customer = await stripe.customers.retrieve(session.customer);
      const uid = customer.metadata.uid;

      await updateUser(uid, {
        isPremium: true,
        subscriptionId: session.subscription,
        lastPaid: Date.now()
      });
    }

    // 🔁 Renewal
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

    // ❌ Canceled
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const customer = await stripe.customers.retrieve(sub.customer);
      const uid = customer.metadata.uid;

      await updateUser(uid, {
        isPremium: false,
        subscriptionId: null
      });
    }

    res.json({ received: true });
  }
);

// =====================================================
// 🧾 CUSTOMER PORTAL
// =====================================================
app.post("/manage-subscription", async (req, res) => {
  try {
    const { uid } = req.body;
    const user = await getUser(uid);
    if (!user?.customerId) return res.json({ error: "No customer" });

    const portal = await stripe.billingPortal.sessions.create({
      customer: user.customerId,
      return_url: "https://eclipse-pdf.com"
    });

    res.json({ url: portal.url });
  } catch (err) {
    console.error("❌ portal error:", err);
    res.status(500).json({ error: "Portal failed" });
  }
});

// =====================================================
// ⭐ ENTITLEMENT CHECK
// =====================================================
app.post("/entitlement", async (req, res) => {
  try {
    const { uid } = req.body;
    const user = uid ? await getUser(uid) : null;

    res.json({
      isPremium: user?.isPremium === true
    });
  } catch {
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
