require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const { connectDB } = require("./db");

const bookingRouter = require("./routes/booking");
const contactRouter = require("./routes/contact.route");
const orderRouter = require("./routes/orderRoutes");
const adminRoutes = require("./routes/superAdminRoute");
const partnerAuthRoutes = require("./routes/partnerAuth");
const partnerAdminRoutes = require("./routes/admin");
const clientRoutes = require("./routes/clientRoute");
const commissionRoutes = require('./routes/commissionRoutes');
const stripeRoutes = require('./routes/stripeRoutes');

const app = express();

// CORS
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://www.ouvrir-societe-hong-kong.fr",
    "https://ouvrir-societe-hong-kong.fr",
    "https://hk-backend-tau.vercel.app"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));

// 🔥 CRITICAL FIX: Stripe webhook route FIRST (needs raw body)
app.post("/api/orders/webhook", 
  express.raw({type: 'application/json'}), 
  require("./controller/orderController").handleStripeWebhook
);

// Regular JSON parsing for all OTHER routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection
(async () => {
  try {
    await connectDB();
    console.log("✅ Database connected successfully");
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
  }
})();

// ✅ Emergency admin route
app.post("/api/emergency-admin", async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (email !== process.env.EMERGENCY_EMAIL || password !== process.env.EMERGENCY_PASSWORD) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const Admin = require("./models/Admin");
    const admin = await Admin.findOne({ email: process.env.DEFAULT_ADMIN_EMAIL });
    
    if (!admin) {
      const newAdmin = await Admin.create({
        email: process.env.DEFAULT_ADMIN_EMAIL,
        password: process.env.DEFAULT_ADMIN_PASSWORD,
        role: "superadmin",
        isActive: true
      });
      return res.json({ success: true, message: "Emergency admin created", admin: newAdmin });
    }

    res.json({ success: true, message: "Admin exists", admin });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Routes
app.use("/api/admin", adminRoutes);
app.use("/api/bookings", bookingRouter);
app.use("/api/contact", contactRouter);
app.use("/api/orders", orderRouter);
app.use("/api/stripe", stripeRoutes);
app.use("/api/partner-auth", partnerAuthRoutes);
app.use("/api/partner-admin", partnerAdminRoutes);
app.use("/api/client", clientRoutes);
app.use('/api/commission', commissionRoutes);

// Health check
app.get("/api/health", (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = dbState === 1 ? "connected" : "disconnected";
  
  res.status(200).json({
    status: "healthy",
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// Diagnostic endpoint
app.get("/api/diagnostic", (req, res) => {
  res.json({
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    dbConnected: mongoose.connection.readyState === 1,
    timestamp: new Date().toISOString(),
    routes: [
      "/api/orders",
      "/api/stripe",
      "/api/partner-auth",
      "/api/commission"
    ]
  });
});

app.get("/", (req, res) => {
  res.json({ 
    message: "Server is running with Stripe integration",
    timestamp: new Date().toISOString()
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.message);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === "development" ? err.message : "Internal Server Error",
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`💳 Stripe integration: ACTIVE`);
  console.log(`🔗 Webhook: /api/orders/webhook`);
  console.log(`⚠️  IMPORTANT: Webhook route is now BEFORE body parsers`);
});