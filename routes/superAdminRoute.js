const express = require("express");
const router = express.Router();
const { 
  loginAdmin,
  verifyAdmin,
  getAdminData 
} = require("../controller/supeAdminController");
const { protect } = require("../middleware/authMiddleware");

// Admin routes
router.post("/login", loginAdmin); // POST /api/admin/login
router.get("/verify", protect, verifyAdmin); // GET /api/admin/verify
router.get("/:id", protect, getAdminData); // GET /api/admin/:id

module.exports = router;