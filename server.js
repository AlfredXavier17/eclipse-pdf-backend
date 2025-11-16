// =============================================
//  Eclipse PDF – FINAL CLEAN STRIPE BACKEND
// =============================================
const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bodyParser = require("body-parser");
require("dotenv").config();

const app = express();

// Stripe client
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Where we store premium status on server
const premiumFile = path.join(__dirname, "premium.json");

// Make sure file exists
if (!fs.existsSync(premiumFile)) {
  fs.writeFileSync(
    premiumFile,
    JSON.stringify(
      {
        isPremium: false,
        customerId: null,
        subscriptionId: null,
        lastPaid: null
      },
      null,
      2
    )
  );
}

app.use(cors());
app.use(express.static(path.join(__dirname, "web"))); // serve success.html + cancel.html

// =====================================================
// 🟦 CREATE CHECKOUT SESSION (TEST MODE)
// =====================================================
app.post("/create-checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID, // 💎 USE ENV VARIABLE
          quantity: 1,
        },
      ],
      success_url: "https://eclipse-pdf-backend.onrender.com/success.html",
      cancel_url: "https://eclipse-pdf-backend.onrender.com/cancel.html",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Checkout Error:", err.message);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// =====================================================
// 🟩 MARK PREMIUM (ONLY CALLED BY success.html)
// =====================================================
app.post("/mark-premium", (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(premiumFile, "utf8"));
    data.isPremium = true;
    fs.writeFileSync(premiumFile, JSON.stringify(data, null, 2));
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ mark-premium Error:", err.message);
    res.status(500).json({ ok: false });
  }
});

// =====================================================
// 📡 ENTITLEMENT CHECK (Electron app checks this)
// =====================================================
app.get("/entitlement", (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(premiumFile, "utf8"));
    res.json({
      isPremium: data.isPremium === true
    });
  } catch {
    res.json({ isPremium: false });
  }
});

// =====================================================
// ⚡ STRIPE WEBHOOK — SAVES CUSTOMER + SUBSCRIPTION
// =====================================================
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
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook signature failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const data = JSON.parse(fs.readFileSync(premiumFile, "utf8"));

    if (event.type === "invoice.paid") {
      const invoice = event.data.object;
      console.log("💎 Subscription payment successful");

      data.isPremium = true;
      data.customerId = invoice.customer;
      data.subscriptionId = invoice.subscription;
      data.lastPaid = Date.now();

      fs.writeFileSync(premiumFile, JSON.stringify(data, null, 2));
    }

    if (event.type === "customer.subscription.deleted") {
      console.log("🟥 Subscription canceled");

      data.isPremium = false;
      fs.writeFileSync(premiumFile, JSON.stringify(data, null, 2));
    }

    res.json({ received: true });
  }
);

// =====================================================
// 🧾 MANAGE SUBSCRIPTION PORTAL
// =====================================================
app.post("/manage-subscription", async (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(premiumFile, "utf8"));

    if (!data.customerId) {
      return res.json({ error: "No subscription found." });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: data.customerId,
      return_url: "https://eclipse-pdf.com", // your real site later
    });

    res.json({ url: portal.url });
  } catch (err) {
    console.error("❌ Portal error:", err.message);
    res.status(500).json({ error: "Failed to open portal" });
  }
});

// =====================================================
// 🚀 START SERVER
// =====================================================
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log("🔥 Backend running on port " + PORT);
});
