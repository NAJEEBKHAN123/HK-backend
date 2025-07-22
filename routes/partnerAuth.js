const express = require('express');
const router = express.Router();
const partnerController = require('../controller/partnerController');
const { protect, verifyAdmin } = require('../middleware/authMiddleware');

// Public routes
router.post('/verify-invite', partnerController.verifyInvite);
router.post('/register', partnerController.registerPartner);
router.get('/verify-referral', partnerController.verifyReferral);

// Admin-protected routes
router.post('/generate-credentials', 
  protect,
  verifyAdmin,
  partnerController.generatePartnerCredential
);

// Partner-protected routes
router.get('/dashboard', protect, partnerController.getPartnerDashboard);
router.post('/request-payout', protect, partnerController.requestPayout);

module.exports = router;