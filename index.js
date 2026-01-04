require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { connectDB } = require("./db"); // ✅ Correct import

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

// ✅ CORS - Must be FIRST, before any other middleware
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

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Correct DB connection
(async () => {
  try {
    await connectDB(); // ✅ Call the actual function
    console.log("✅ Database connected successfully");
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
    // Don't exit - let the app run without DB for health checks
  }
})();

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

// Health check
app.get("/api/health", (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  res.status(200).json({
    status: "healthy",
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// Home route
app.get("/", (req, res) => {
  res.json({ 
    message: "Server is running",
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.message);
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === "development" ? err.message : "Internal Server Error",
  });
});

// ✅ Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`);
});

// ✅ Export for Vercel serverless
module.exports = app;