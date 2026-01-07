const express = require('express');
const router = express.Router();
const stripeController = require('../controller/stripeController');
const { protect, verifyPartner, verifyAdmin } = require('../middleware/authMiddleware');

// ========== PARTNER STRIPE CONNECT ROUTES ==========

// Create Stripe Connect account
router.post('/connect/create-account', protect, verifyPartner, stripeController.createConnectAccount);

// Get onboarding link
router.post('/connect/onboarding-link', protect, verifyPartner, stripeController.createOnboardingLink);

// Get Stripe dashboard link
router.get('/connect/dashboard-link', protect, verifyPartner, stripeController.getDashboardLink);

// Get account status
router.get('/connect/status', protect, verifyPartner, stripeController.getAccountStatus);

// ========== ADMIN STRIPE ROUTES ==========

// Get all connected accounts
router.get('/admin/accounts', protect, verifyAdmin, async (req, res) => {
  try {
    const partners = await Partner.find({ stripeAccountId: { $ne: null } })
      .select('name email stripeAccountId stripeAccountStatus stripeOnboardingCompleted referralCode commissionEarned availableCommission')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      partners: partners.map(p => ({
        id: p._id,
        name: p.name,
        email: p.email,
        stripeAccountId: p.stripeAccountId,
        status: p.stripeAccountStatus,
        onboardingCompleted: p.stripeOnboardingCompleted,
        referralCode: p.referralCode,
        commissionEarned: p.commissionEarned,
        availableCommission: p.availableCommission
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create test payment link
router.post('/admin/test-payment', protect, verifyAdmin, stripeController.createPaymentLink);

// Get Stripe balance
router.get('/admin/balance', protect, verifyAdmin, async (req, res) => {
  try {
    const balance = await stripe.balance.retrieve();
    res.json({ success: true, balance });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;