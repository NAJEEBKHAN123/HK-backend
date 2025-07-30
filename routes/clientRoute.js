const express = require("express");
const router = express.Router();
const clientAuthController = require("../controller/clientAuthController");
const { verifyAdmin, protect, verifyPartner } = require("../middleware/authMiddleware");

router.post("/signup", clientAuthController.clientSignup);
router.post("/login", clientAuthController.clientLogin);


// Admin routes
router.get("/admin", protect, verifyAdmin, clientAuthController.getAllClients);
router.get("/admin/:id", protect, verifyAdmin, clientAuthController.getClient);
router.put("/admin/:id", protect, verifyAdmin, clientAuthController.updateClient);
router.put("/admin/:id/status", protect, verifyAdmin, clientAuthController.updateClientStatus);
router.delete("/admin/:id", protect, verifyAdmin, clientAuthController.deleteClient);


router.get('/partner/:id', protect, verifyPartner, clientAuthController.getClientForPartner)

module.exports = router;
