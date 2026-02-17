const express = require('express');
const router = express.Router();
const partnerController = require('../controller/partnerController');
const { protect, verifyAdmin, verifyPartner } = require('../middleware/authMiddleware');

// ========== PUBLIC ROUTES (No Authentication Required) ==========

// Click tracking
router.get('/track-click/:code', partnerController.trackClick);

// Test click endpoint (for debugging)
router.get('/test-click/:code', partnerController.testClickTracking);

// Debug click stats
router.get('/debug-clicks/:code', partnerController.debugPartnerClicks);

// Legacy referral verification
router.get('/verify-referral', partnerController.verifyReferral);

// Partner login
router.post('/login', partnerController.loginPartner);

// Partner registration
router.post('/register', partnerController.registerPartner);

// Verify partner invite
router.post('/verify-invite', partnerController.verifyInvite);

// ========== PROTECTED PARTNER ROUTES ==========

// Verify partner token
router.get('/verify', protect, verifyPartner, partnerController.verifyPartners);

// Get partner dashboard
router.get('/dashboard', protect, verifyPartner, partnerController.getPartnerDashboard);

// Get current partner info
router.get('/me', protect, verifyPartner, partnerController.getCurrentPartner);

// Request payout
router.post('/request-payout', protect, verifyPartner, partnerController.requestPayout);

// Logout
router.post('/logout', protect, verifyPartner, partnerController.logoutPartner);

// Test authentication
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

// ========== ADMIN ROUTES ==========

// Generate partner credentials
router.post('/admin/generate-credentials', verifyAdmin, partnerController.generatePartnerCredential);

// Get all partners
router.get('/admin/partners', verifyAdmin, partnerController.getAllPartners);

// Get partner details
router.get('/admin/partners/:id', verifyAdmin, partnerController.getAdminPartnerDetails);

// Get partner statistics
router.get('/admin/partner-stats', verifyAdmin, partnerController.getPartnerStats);

// Update partner status
router.put('/admin/partners/:id/status', verifyAdmin, partnerController.updatePartnerStatus);

// Process payout
router.post('/admin/partners/:id/payout', verifyAdmin, partnerController.adminProcessPayout);

// Manual click update (admin only)
router.put('/admin/partners/:id/update-clicks', verifyAdmin, partnerController.manualUpdateClicks);

// Get click stats (admin only)
router.get('/admin/partners/:id/click-stats', verifyAdmin, partnerController.getClickStats);

// ✅ NEW: Debug partner orders
router.get('/admin/partners/:id/debug-orders', verifyAdmin, partnerController.debugPartnerOrders);

// ✅ NEW: Fix partner orders
router.post('/admin/partners/:id/fix-orders', verifyAdmin, partnerController.fixPartnerOrders);



// ========== STRIPE CONNECT ROUTES ==========

// Partner routes
router.get('/stripe/status', protect, verifyPartner, partnerController.getStripeBalance);
router.get('/stripe/onboarding', protect, verifyPartner, partnerController.getStripeOnboardingLink);
router.get('/stripe/sync-status', protect, verifyPartner, (req, res) => {
  // This calls syncStripeAccountStatus for the logged-in partner
  req.params.id = req.partner.id;
  return partnerController.syncStripeAccountStatus(req, res);
});

// Admin routes
router.get('/admin/stripe/status/:partnerId', verifyAdmin, partnerController.checkPartnerStripeStatus);
router.post('/admin/stripe/setup/:partnerId', verifyAdmin, partnerController.setupStripeConnectForPartner);
router.get('/admin/stripe/sync/:partnerId', verifyAdmin, partnerController.syncStripeAccountStatus);
router.get('/admin/stripe/test-transfer/:partnerId', verifyAdmin, partnerController.testInstantTransfer);

module.exports = router;