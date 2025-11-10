require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();

// Simple CORS
app.use(cors({
  origin: ["http://localhost:5173", "https://ouvrir-societe-hong-kong.fr"],
  credentials: true
}));

app.use(express.json());

// Test route without any external routes
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", message: "Basic server working" });
});

app.get("/", (req, res) => {
  res.json({ message: "Server is running" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Basic server running on port ${PORT}`);
});