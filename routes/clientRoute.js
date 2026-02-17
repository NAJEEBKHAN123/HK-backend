// routes/clientRoutes.js
const express = require("express");
const router = express.Router();
const clientAuthController = require("../controller/clientAuthController");
const { verifyAdmin, protect, verifyPartner } = require("../middleware/authMiddleware");

// Public routes
router.post("/signup", clientAuthController.clientSignup);
router.post("/login", clientAuthController.clientLogin);

// Admin routes - FIXED
router.get("/admin", verifyAdmin, clientAuthController.getAllClients);
router.get("/admin/:id", verifyAdmin, clientAuthController.getClient);
router.put("/admin/:id", verifyAdmin, clientAuthController.updateClient);
router.put("/admin/:id/status", verifyAdmin, clientAuthController.updateClientStatus);
router.delete("/admin/:id", verifyAdmin, clientAuthController.deleteClient);
router.get("/admin/:id/orders", verifyAdmin, clientAuthController.getClientOrders);

// Partner routes
router.get('/partner/:id', protect, verifyPartner, clientAuthController.getClientForPartner);
router.get('/partner/:id/details', protect, verifyPartner, clientAuthController.getClientDetailsForPartner);
// Add this route for partner to get their referred clients
router.get(
  '/partner/referred-clients',
  protect,
  verifyPartner, // Middleware to verify partner
  clientAuthController.getReferredClientsForPartner
);

// DEBUG ROUTE - Add this temporarily
router.get('/debug', verifyAdmin, (req, res) => {
  res.json({
    success: true,
    message: 'Admin route works!',
    admin: req.admin,
    user: req.user
  });
});

module.exports = router;