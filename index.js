require("dotenv").config();
const express = require("express");
const cors = require("cors");
const DBConnection = require("./db");

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "https://www.ouvrir-societe-hong-kong.fr",
  "https://ouvrir-societe-hong-kong.fr",
  "https://backend.ouvrir-societe-hong-kong.fr",
  "https://hk-backend-production.up.railway.app"
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// DB connection
DBConnection();

console.log("🔍 Testing routes one by one...");

// Test 1: Basic server without any custom routes
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    message: "Basic server is working",
    test: "No custom routes loaded yet"
  });
});

const PORT = process.env.PORT || 3000;

// Load routes one by one with error handling
try {
  console.log("1. Testing booking routes...");
  const bookingRouter = require("./routes/booking");
  app.use("/api/bookings", bookingRouter);
  console.log("✅ Booking routes loaded successfully");
} catch (error) {
  console.log("❌ Booking routes failed:", error.message);
  process.exit(1);
}

try {
  console.log("2. Testing contact routes...");
  const contactRouter = require("./routes/contact.route");
  app.use("/api/contact", contactRouter);
  console.log("✅ Contact routes loaded successfully");
} catch (error) {
  console.log("❌ Contact routes failed:", error.message);
  process.exit(1);
}

try {
  console.log("3. Testing order routes...");
  const orderRouter = require("./routes/orderRoutes");
  app.use("/api/orders", orderRouter);
  console.log("✅ Order routes loaded successfully");
} catch (error) {
  console.log("❌ Order routes failed:", error.message);
  process.exit(1);
}

try {
  console.log("4. Testing admin routes...");
  const adminRoutes = require("./routes/superAdminRoute");
  app.use("/api/admin", adminRoutes);
  console.log("✅ Admin routes loaded successfully");
} catch (error) {
  console.log("❌ Admin routes failed:", error.message);
  process.exit(1);
}

try {
  console.log("5. Testing payment routes...");
  const paymentRoutes = require("./routes/paymentRoutes");
  app.use("/api/payments", paymentRoutes);
  console.log("✅ Payment routes loaded successfully");
} catch (error) {
  console.log("❌ Payment routes failed:", error.message);
  process.exit(1);
}

try {
  console.log("6. Testing partner auth routes...");
  const partnerAuthRoutes = require("./routes/partnerAuth");
  app.use("/api/partner-auth", partnerAuthRoutes);
  console.log("✅ Partner auth routes loaded successfully");
} catch (error) {
  console.log("❌ Partner auth routes failed:", error.message);
  process.exit(1);
}

try {
  console.log("7. Testing partner admin routes...");
  const partnerAdminRoutes = require("./routes/admin");
  app.use("/api/partner-admin", partnerAdminRoutes);
  console.log("✅ Partner admin routes loaded successfully");
} catch (error) {
  console.log("❌ Partner admin routes failed:", error.message);
  process.exit(1);
}

try {
  console.log("8. Testing client routes...");
  const clientRoutes = require("./routes/clientRoute");
  app.use("/api/client", clientRoutes);
  console.log("✅ Client routes loaded successfully");
} catch (error) {
  console.log("❌ Client routes failed:", error.message);
  process.exit(1);
}

console.log("🎉 All routes loaded successfully!");

app.get("/", (req, res) => {
  res.send("Home page - All routes are working!");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log("✅ All routes loaded without errors");
});