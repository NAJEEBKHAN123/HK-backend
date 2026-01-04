const express = require("express");
const router = express.Router();
const clientAuthController = require("../controller/clientAuthController");
const { verifyAdmin, protect, verifyPartner } = require("../middleware/authMiddleware");

router.post("/signup", clientAuthController.clientSignup);
router.post("/login", clientAuthController.clientLogin);

// Admin routes - REMOVED protect
router.get("/admin", verifyAdmin, clientAuthController.getAllClients);
router.get("/admin/:id", verifyAdmin, clientAuthController.getClient);
router.put("/admin/:id", verifyAdmin, clientAuthController.updateClient);
router.put("/admin/:id/status", verifyAdmin, clientAuthController.updateClientStatus);
router.delete("/admin/:id", verifyAdmin, clientAuthController.deleteClient);
router.get("/admin/:id/orders", verifyAdmin, clientAuthController.getClientOrders);

// Partner routes
router.get('/partner/:id', protect, verifyPartner, clientAuthController.getClientForPartner);

// ✅ ADD THIS NEW ROUTE for detailed client info with orders
router.get('/partner/:id/details', protect, verifyPartner, clientAuthController.getClientDetailsForPartner);

module.exports = router;