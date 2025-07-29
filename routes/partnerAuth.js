const express = require('express');
const router = express.Router();
const partnerController = require('../controller/partnerController');
const { protect, verifyAdmin, verifyPartner } = require('../middleware/authMiddleware');

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

router.post('/request-payout', protect, partnerController.requestPayout);
router.get('/dashboard', protect,verifyPartner, partnerController.getPartnerDashboard);
router.post('/logout', verifyPartner, partnerController.logoutPartner);
router.get('/verify', protect, partnerController.verifyPartners);

// Authentication routes
router.post('/login', partnerController.loginPartner);
router.get('/me', protect, partnerController.getCurrentPartner);


// Admin partner management routes
router.get('/admin/partners', protect, verifyAdmin, partnerController.getAllPartners);
router.get('/admin/partners/:id', protect, verifyAdmin, partnerController.getAdminPartnerDetails);
router.get('/admin/partner-stats', protect, verifyAdmin, partnerController.getPartnerStats);
router.put('/admin/partners/:id/status', protect, verifyAdmin, partnerController.updatePartnerStatus);
router.post('/admin/partners/:id/payout', protect, verifyAdmin, partnerController.adminProcessPayout);



module.exports = router;