const express = require('express');
const router = express.Router();
const partnerController = require('../controller/partnerController');
const { protect, verifyAdmin, verifyPartner } = require('../middleware/authMiddleware');

// ========== PUBLIC ROUTES ==========
router.post('/verify-invite', partnerController.verifyInvite);
router.post('/register', partnerController.registerPartner);
router.get('/verify-referral', partnerController.verifyReferral);
router.post('/login', partnerController.loginPartner);

// ========== PARTNER PROTECTED ROUTES ==========
// FIXED: Added verifyPartner middleware
router.get('/verify', protect, verifyPartner, partnerController.verifyPartners);
router.get('/dashboard', protect, verifyPartner, partnerController.getPartnerDashboard);
router.get('/me', protect, verifyPartner, partnerController.getCurrentPartner);
router.post('/request-payout', protect, verifyPartner, partnerController.requestPayout);
router.post('/logout', protect, verifyPartner, partnerController.logoutPartner);

// ========== ADMIN PROTECTED ROUTES ==========
router.post('/generate-credentials', protect, verifyAdmin, partnerController.generatePartnerCredential);
router.get('/admin/partners', protect, verifyAdmin, partnerController.getAllPartners);
router.get('/admin/partners/:id', protect, verifyAdmin, partnerController.getAdminPartnerDetails);
router.get('/admin/partner-stats', protect, verifyAdmin, partnerController.getPartnerStats);
router.put('/admin/partners/:id/status', protect, verifyAdmin, partnerController.updatePartnerStatus);
router.post('/admin/partners/:id/payout', protect, verifyAdmin, partnerController.adminProcessPayout);

// ========== TEST ROUTES ==========
router.get('/test-auth', protect, verifyPartner, (req, res) => {
  res.json({
    success: true,
    message: 'Partner authentication is working!',
    partner: {
      id: req.partner._id,
      name: req.partner.name,
      email: req.partner.email,
      status: req.partner.status
    }
  });
});

module.exports = router;