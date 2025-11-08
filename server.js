require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

// Test route - if this works, the problem is in your routes
app.get("/", (req, res) => {
  res.send("Basic server is working");
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Basic routes work" });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
  console.log("If this works, the problem is in your route files");
});