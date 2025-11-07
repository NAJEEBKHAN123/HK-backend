require("dotenv").config();
const express = require("express");
const cors = require("cors");
const DBConnection = require("./db");
const bookingRouter = require("./routes/booking");
const contactRouter = require("./routes/contact.route");
const orderRouter = require("./routes/orderRoutes");
const adminRoutes = require("./routes/superAdminRoute");
const paymentRoutes = require("./routes/paymentRoutes");
const partnerAuthRoutes = require("./routes/partnerAuth");
const partnerAdminRoutes = require("./routes/admin");
const clientRoutes = require("./routes/clientRoute");

const app = express();

// ✅ Allowed origins
const allowedOrigins = [
  "http://localhost:5173",
  "https://ouvrir-societe-hong-kong.fr",
  "https://www.ouvrir-societe-hong-kong.fr",
];

// ✅ CORS setup
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like Postman, or same-server calls)
      if (!origin) return callback(null, true);

      // Check if origin matches one of the allowed domains
      if (allowedOrigins.some((o) => origin.startsWith(o))) {
        return callback(null, true);
      }

      console.warn(`❌ CORS blocked from origin: ${origin}`);
      return callback(new Error("CORS not allowed from this origin: " + origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ✅ Handle preflight requests globally
app.options("*", cors());

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database Connection
DBConnection();

// Routes
app.use("/api/bookings", bookingRouter);
app.use("/api/contact", contactRouter);
app.use("/api/orders", orderRouter);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/partner-auth", partnerAuthRoutes);
app.use("/api/partner-admin", partnerAdminRoutes);
app.use("/api/client", clientRoutes);

// Health Check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// Default route
app.get("/", (req, res) => {
  res.send("Home page");
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.stack);

  res.status(500).json({
    success: false,
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// Server Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(
    `✅ Server running in ${
      process.env.NODE_ENV || "development"
    } mode on port ${PORT}`
  );
});
