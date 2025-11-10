const express = require("express");
const router = express.Router();

console.log("Loading admin routes..."); // Debug line

const { 
  loginAdmin,
  verifyAdmin,
  getAdminData 
} = require("../controller/supeAdminController");
const { protect } = require("../middleware/authMiddleware");

// Make sure routes are defined in correct order
router.post("/login", loginAdmin);
router.get("/verify", protect, verifyAdmin);
router.get("/:id", protect, getAdminData);

console.log("Admin routes loaded successfully"); // Debug line

module.exports = router;