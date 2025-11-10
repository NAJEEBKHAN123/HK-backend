require("dotenv").config();
const express = require("express");
const cors = require("cors");
const DBConnection = require("./db");

const adminRoutes = require("./routes/superAdminRoute");

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "https://www.ouvrir-societe-hong-kong.fr",
  "https://ouvrir-societe-hong-kong.fr",
  "https://hk-backend-tau.vercel.app"
];

// ✅ SINGLE CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    console.log('🔍 Incoming request from origin:', origin);
    
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('❌ Blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(cors(corsOptions));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// DB connection
DBConnection();

// Routes
app.use("/api/admin", adminRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
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
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === "development" ? err.message : "Internal Server Error",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`);
});