const express = require("express");
const router = express.Router();
const clientAuthController = require("../controller/clientAuthController");
const { verifyAdmin, protect, verifyPartner } = require("../middleware/authMiddleware");

router.post("/signup", clientAuthController.clientSignup);
router.post("/login", clientAuthController.clientLogin);


// Admin routes
router.get("/admin", verifyAdmin, clientAuthController.getAllClients);
router.get("/admin/:id", verifyAdmin, clientAuthController.getClient);
router.put("/admin/:id", verifyAdmin, clientAuthController.updateClient);
router.put("/admin/:id/status", verifyAdmin, clientAuthController.updateClientStatus);
router.delete("/admin/:id", verifyAdmin, clientAuthController.deleteClient);


router.get('/partner/:id', protect, verifyPartner, clientAuthController.getClientForPartner)

module.exports = router;
