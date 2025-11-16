const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bodyParser = require("body-parser");

const app = express();

// 🟢 YOUR REAL LIVE SECRET KEY
require("dotenv").config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 📁 local premium file
const premiumFile = path.join(__dirname, "../premium.json");

// DO NOT USE express.json() — it breaks Stripe webhook raw-body
app.use(cors());
app.use(express.static(path.join(__dirname, "../web")));

// =========================================
// 🧨 CREATE CHECKOUT SESSION (LIVE SUBSCRIPTION)
// =========================================
app.post("/create-checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: "price_1ST9PrJ6zNG9KpDmFEZOcAjk", // LIVE price ID
          quantity: 1,
        },
      ],
      success_url: "https://eclipse-pdf-backend.onrender.com/success.html",
      cancel_url: "https://eclipse-pdf-backend.onrender.com/cancel.html",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Error creating checkout session:", err);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// =========================================
// 💎 SET PREMIUM TRUE (called by success.html)
// =========================================
app.post("/mark-premium", (req, res) => {
  try {
    fs.writeFileSync(
      premiumFile,
      JSON.stringify({ isPremium: true, at: Date.now() }, null, 2)
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("❌ Error writing premium.json:", e);
    res.status(500).json({ ok: false });
  }
});

// =========================================
// 📡 ENTITLEMENT CHECK
// =========================================
app.get("/entitlement", (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(premiumFile, "utf8"));
    res.json({ isPremium: !!data.isPremium });
  } catch {
    res.json({ isPremium: false });
  }
});

// =========================================
// ⚡ STRIPE WEBHOOK (handles subscription events)
// =========================================
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        "whsec_16fdae4a51531d618ba9e11176d1810bf4bb5dd1ab023a0cee0b1777bf83d14a" // your webhook secret
      );
    } catch (err) {
      console.error("❌ Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // 🟢 Subscription paid (first month or renewal)
    if (event.type === "invoice.paid") {
      console.log("💎 Subscription active / renewed");

      const invoice = event.data.object;
      const customerId = invoice.customer;
      const subscriptionId = invoice.subscription;

      fs.writeFileSync(
        premiumFile,
        JSON.stringify(
          {
            isPremium: true,
            lastPaid: Date.now(),
            customerId: customerId,
            subscriptionId: subscriptionId
          },
          null,
          2
        )
      );
    }

    // 🔴 Subscription canceled
    if (event.type === "customer.subscription.deleted") {
      console.log("🟥 Subscription canceled");
      fs.writeFileSync(
        premiumFile,
        JSON.stringify({ isPremium: false }, null, 2)
      );
    }

    res.json({ received: true });
  }
);

// =========================================
// 🧾 CUSTOMER PORTAL
// =========================================
app.post("/manage-subscription", async (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(premiumFile, "utf8"));

    if (!data.customerId) {
      return res.json({ error: "No subscription found." });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: data.customerId,
      return_url: "https://google.com", // you can change this later
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Portal error:", err);
    res.status(500).json({ error: "Failed to open portal" });
  }
});

// =========================================
// 🚀 START SERVER
// =========================================
app.listen(4242, () =>
  console.log("🔥 Stripe LIVE server running at http://localhost:4242")
);
