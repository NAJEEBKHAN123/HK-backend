// routes/adminRoutes.js - FOR ADMIN AUTHENTICATION (/api/admin/...)
const express = require("express");
const router = express.Router();

console.log("🔄 Loading admin authentication routes...");

const { 
  loginAdmin,
  verifyAdmin: verifyAdminController, // Rename controller to avoid conflict
  getAdminData 
} = require("../controller/supeAdminController");

// IMPORTANT: Use verifyAdmin middleware for admin routes, NOT protect
const { verifyAdmin } = require("../middleware/authMiddleware");

console.log("✅ Middleware check:", {
  hasVerifyAdmin: typeof verifyAdmin === 'function',
  hasProtect: typeof require("../middleware/authMiddleware").protect === 'function'
});

// ========== PUBLIC ROUTES (no auth) ==========
router.post("/login", loginAdmin);

// ========== PROTECTED ROUTES (admin auth required) ==========
// Use verifyAdmin middleware for admin authentication endpoints
router.get("/verify", verifyAdmin, verifyAdminController);
router.get("/:id", verifyAdmin, getAdminData);

// Debug endpoint to verify middleware is working
router.get("/debug/check-middleware", verifyAdmin, (req, res) => {
  res.json({
    success: true,
    message: "✅ verifyAdmin middleware is working correctly",
    admin: req.admin ? {
      id: req.admin._id,
      name: req.admin.name,
      email: req.admin.email
    } : null,
    timestamp: new Date().toISOString()
  });
});

console.log("✅ Admin authentication routes loaded successfully");

module.exports = router;