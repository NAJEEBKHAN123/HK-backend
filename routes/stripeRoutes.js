// routes/stripeRoutes.js
const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { protect, verifyPartner, verifyAdmin } = require('../middleware/authMiddleware'); // Import protect
const Partner = require('../model/Partner');

// ========== PARTNER ROUTES ==========

// Get Stripe Connect status
router.get('/connect/status', protect, verifyPartner, async (req, res) => { // Add protect first
  try {
    console.log('🔍 Stripe status request for partner:', req.partner.email);
    
    const partner = await Partner.findById(req.partner.id);
    
    if (!partner) {
      return res.status(404).json({ success: false, error: 'Partner not found' });
    }
    
    const accountId = partner.stripeConnect?.accountId;
    
    if (!accountId) {
      return res.json({
        success: true,
        hasAccount: false,
        status: 'not_connected',
        message: 'No Stripe account connected'
      });
    }
    
    console.log('📡 Fetching Stripe account:', accountId);
    
    // Fetch account details from Stripe
    const account = await stripe.accounts.retrieve(accountId);
    
    // Update local status
    partner.stripeConnect = {
      ...partner.stripeConnect,
      status: account.charges_enabled ? 'active' : 'pending',
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      lastSyncedAt: new Date(),
      capabilities: {
        card_payments: account.capabilities?.card_payments,
        transfers: account.capabilities?.transfers
      }
    };
    
    await partner.save();
    
    console.log('✅ Stripe status retrieved:', partner.stripeConnect.status);
    
    res.json({
      success: true,
      hasAccount: true,
      accountId: accountId,
      status: partner.stripeConnect.status,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      capabilities: account.capabilities,
      requirements: account.requirements
    });
    
  } catch (error) {
    console.error('❌ Stripe status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create Stripe Connect account
router.post('/connect/create-account', protect, verifyPartner, async (req, res) => { // Add protect first
  try {
    console.log('🔍 Creating Stripe account for partner:', req.partner.email);
    
    const partner = await Partner.findById(req.partner.id);
    
    if (!partner) {
      return res.status(404).json({ success: false, error: 'Partner not found' });
    }
    
    // Check if already has account
    if (partner.stripeConnect?.accountId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Partner already has Stripe account',
        accountId: partner.stripeConnect.accountId
      });
    }
    
    // Create Express account
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'FR', // or get from partner data
      email: partner.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual',
      metadata: {
        partnerId: partner._id.toString(),
        partnerEmail: partner.email,
        referralCode: partner.referralCode
      }
    });
    
    // Save account ID
    partner.stripeConnect = {
      accountId: account.id,
      status: 'pending',
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      connectedAt: new Date()
    };
    
    await partner.save();
    
    console.log(`✅ Stripe account created for ${partner.email}: ${account.id}`);
    
    res.json({
      success: true,
      accountId: account.id,
      message: 'Stripe account created successfully'
    });
    
  } catch (error) {
    console.error('❌ Create account error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get onboarding link
router.post('/connect/onboarding-link', protect, verifyPartner, async (req, res) => { // Add protect first
  try {
    console.log('🔍 Getting onboarding link for partner:', req.partner.email);
    
    const partner = await Partner.findById(req.partner.id);
    
    if (!partner?.stripeConnect?.accountId) {
      return res.status(400).json({ 
        success: false, 
        error: 'No Stripe account found. Please create one first.' 
      });
    }
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    
    console.log('🔗 Creating account link for:', partner.stripeConnect.accountId);
    
    const accountLink = await stripe.accountLinks.create({
      account: partner.stripeConnect.accountId,
      refresh_url: `${frontendUrl}/partner/dashboard?refresh=stripe`,
      return_url: `${frontendUrl}/partner/dashboard?success=stripe`,
      type: 'account_onboarding',
    });
    
    console.log('✅ Onboarding link created');
    
    res.json({
      success: true,
      url: accountLink.url
    });
    
  } catch (error) {
    console.error('❌ Onboarding link error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get dashboard link
router.get('/connect/dashboard-link', protect, verifyPartner, async (req, res) => { // Add protect first
  try {
    console.log('🔍 Getting dashboard link for partner:', req.partner.email);
    
    const partner = await Partner.findById(req.partner.id);
    
    if (!partner?.stripeConnect?.accountId) {
      return res.status(400).json({ 
        success: false, 
        error: 'No Stripe account connected' 
      });
    }
    
    const loginLink = await stripe.accounts.createLoginLink(
      partner.stripeConnect.accountId
    );
    
    
    res.json({
      success: true,
      url: loginLink.url
    });
    
  } catch (error) {
    console.error('❌ Dashboard link error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== ADMIN ROUTES ==========

// Admin: Setup Stripe for partner
router.post('/admin/connect/setup/:partnerId', verifyAdmin, async (req, res) => {
  try {
    console.log('🔍 Admin setting up Stripe for partner:', req.params.partnerId);
    
    const partner = await Partner.findById(req.params.partnerId);
    
    if (!partner) {
      return res.status(404).json({ success: false, error: 'Partner not found' });
    }
    
    if (partner.stripeConnect?.accountId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Partner already has Stripe account' 
      });
    }
    
    // Create account
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'FR',
      email: partner.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        partnerId: partner._id.toString(),
        partnerEmail: partner.email
      }
    });
    
    partner.stripeConnect = {
      accountId: account.id,
      status: 'pending',
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      connectedAt: new Date()
    };
    
    await partner.save();
    
    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${process.env.FRONTEND_URL}/partner/dashboard?refresh=stripe`,
      return_url: `${process.env.FRONTEND_URL}/partner/dashboard?success=stripe`,
      type: 'account_onboarding',
    });
    
    console.log(`✅ Admin created Stripe account for ${partner.email}: ${account.id}`);
    
    res.json({
      success: true,
      accountId: account.id,
      onboardingUrl: accountLink.url,
      message: 'Stripe account created. Share onboarding URL with partner.'
    });
    
  } catch (error) {
    console.error('❌ Admin setup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Check partner's Stripe status
router.get('/admin/connect/status/:partnerId', verifyAdmin, async (req, res) => {
  try {
    console.log('🔍 Admin checking Stripe status for partner:', req.params.partnerId);
    
    const partner = await Partner.findById(req.params.partnerId);
    
    if (!partner) {
      return res.status(404).json({ success: false, error: 'Partner not found' });
    }
    
    const accountId = partner.stripeConnect?.accountId;
    
    if (!accountId) {
      return res.json({
        success: true,
        hasAccount: false,
        partner: {
          name: partner.name,
          email: partner.email
        }
      });
    }
    
    const account = await stripe.accounts.retrieve(accountId);
    
    res.json({
      success: true,
      hasAccount: true,
      partner: {
        name: partner.name,
        email: partner.email,
        accountId: accountId
      },
      stripe: {
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        requirements: account.requirements
      }
    });
    
  } catch (error) {
    console.error('❌ Admin status check error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;