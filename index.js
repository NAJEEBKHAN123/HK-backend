require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose"); // ✅ ADDED THIS LINE
const { connectDB } = require("./db");

const bookingRouter = require("./routes/booking");
const contactRouter = require("./routes/contact.route");
const orderRouter = require("./routes/orderRoutes");
const adminRoutes = require("./routes/superAdminRoute");
const paymentRoutes = require("./routes/paymentRoutes");
const partnerAuthRoutes = require("./routes/partnerAuth");
const partnerAdminRoutes = require("./routes/admin");
const clientRoutes = require("./routes/clientRoute");
const commissionRoutes = require('./routes/commissionRoutes');

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

// ✅ Add emergency admin route HERE (before other routes)
app.post("/api/emergency-admin", async (req, res) => {
  // ... emergency admin code from above
});

// Routes
app.use("/api/admin", adminRoutes);
app.use("/api/bookings", bookingRouter);
app.use("/api/contact", contactRouter);
app.use("/api/orders", orderRouter);
app.use("/api/payments", paymentRoutes);
app.use("/api/partner-auth", partnerAuthRoutes);
app.use("/api/partner-admin", partnerAdminRoutes);
app.use("/api/client", clientRoutes);
app.use('/api/commission', commissionRoutes);

// Health check (FIXED)
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
  // ... diagnostic code from above
});

app.get("/", (req, res) => {
  res.json({ 
    message: "Server is running",
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



module.exports = app;