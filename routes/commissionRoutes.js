const express = require('express');
const router = express.Router();
const CommissionService = require('../services/commissionService');
const CommissionTransaction = require('../model/CommissionTransaction');
const { verifyAdmin, protect, verifyPartner } = require('../middleware/authMiddleware');

// ========== ADMIN ROUTES ==========

// Process payout
router.post('/admin/partner/:id/payout', verifyAdmin, async (req, res) => {
  try {
    const { amount, paymentMethod, transactionId, notes } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid amount is required'
      });
    }
    
    const result = await CommissionService.processPayout(
      req.params.id,
      parseFloat(amount),
      req.admin.id,
      {
        method: paymentMethod,
        transactionId: transactionId,
        notes: notes
      }
    );
    
    res.json({
      success: true,
      message: `Payout of €${amount} processed successfully`,
      data: result
    });
    
  } catch (error) {
    console.error('Payout route error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Adjust commission
router.post('/admin/partner/:id/adjust', verifyAdmin, async (req, res) => {
  try {
    const { amount, type, reason, notes } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid amount is required'
      });
    }
    
    if (!type || !['ADD', 'DEDUCT'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Type must be ADD or DEDUCT'
      });
    }
    
    if (!reason || reason.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Reason is required'
      });
    }
    
    const result = await CommissionService.adjustCommission(
      req.params.id,
      {
        amount: parseFloat(amount),
        type: type,
        reason: reason,
        adminNotes: notes,
        adminId: req.admin.id
      }
    );
    
    res.json({
      success: true,
      message: `Commission ${type.toLowerCase()}ed successfully`,
      data: result
    });
    
  } catch (error) {
    console.error('Adjust route error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Hold commission
router.post('/admin/partner/:id/hold', verifyAdmin, async (req, res) => {
  try {
    const { amount, reason, notes, holdUntil } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid amount is required'
      });
    }
    
    if (!reason || reason.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Reason is required'
      });
    }
    
    const result = await CommissionService.holdCommission(
      req.params.id,
      {
        amount: parseFloat(amount),
        reason: reason,
        adminNotes: notes,
        adminId: req.admin.id,
        holdUntil: holdUntil
      }
    );
    
    res.json({
      success: true,
      message: `Commission of €${amount} placed on hold`,
      data: result
    });
    
  } catch (error) {
    console.error('Hold route error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Release hold
router.post('/admin/transaction/:id/release-hold', verifyAdmin, async (req, res) => {
  try {
    const result = await CommissionService.releaseHold(req.params.id);
    
    res.json({
      success: true,
      message: 'Hold released successfully',
      data: result
    });
    
  } catch (error) {
    console.error('Release hold error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get partner transactions (admin view)
router.get('/admin/partner/:id/transactions', verifyAdmin, async (req, res) => {
  try {
    const { type, status, startDate, endDate, limit } = req.query;
    
    const transactions = await CommissionService.getPartnerTransactions(
      req.params.id,
      { type, status, startDate, endDate, limit: parseInt(limit) || 50 }
    );
    
    res.json({
      success: true,
      data: transactions
    });
    
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get partner commission summary
router.get('/admin/partner/:id/commission-summary', verifyAdmin, async (req, res) => {
  try {
    const summary = await CommissionService.getPartnerSummary(req.params.id);
    
    res.json({
      success: true,
      data: summary
    });
    
  } catch (error) {
    console.error('Get summary error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Force process commission for an order
router.post('/admin/order/:id/process-commission', verifyAdmin, async (req, res) => {
  try {
    const order = await require('../model/Order').findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }
    
    if (order.clientType !== 'REFERRAL') {
      return res.status(400).json({
        success: false,
        error: 'Order is not a referral'
      });
    }
    
    if (order.referralInfo.commissionProcessed) {
      return res.status(400).json({
        success: false,
        error: 'Commission already processed for this order'
      });
    }
    
    const transaction = await CommissionService.earnCommission(order._id);
    
    res.json({
      success: true,
      message: 'Commission processed successfully',
      data: transaction
    });
    
  } catch (error) {
    console.error('Process commission error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Auto-process commissions for all paid orders
router.post('/admin/process-all-commissions', verifyAdmin, async (req, res) => {
  try {
    const result = await CommissionService.processCommissionsForPaidOrders();
    
    res.json({
      success: true,
      message: `Commissions processed: ${result.processed} successful, ${result.failed} failed`,
      data: result
    });
    
  } catch (error) {
    console.error('Process all commissions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ========== PARTNER ROUTES ==========

// Get partner's own transactions
router.get('/partner/transactions', protect, verifyPartner, async (req, res) => {
  try {
    const { type, status, startDate, endDate, limit } = req.query;
    
    const transactions = await CommissionService.getPartnerTransactions(
      req.partner.id,
      { type, status, startDate, endDate, limit: parseInt(limit) || 50 }
    );
    
    res.json({
      success: true,
      data: transactions
    });
    
  } catch (error) {
    console.error('Get partner transactions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get partner's own summary
router.get('/partner/commission-summary', protect, verifyPartner, async (req, res) => {
  try {
    const summary = await CommissionService.getPartnerSummary(req.partner.id);
    
    res.json({
      success: true,
      data: summary
    });
    
  } catch (error) {
    console.error('Get partner summary error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Partner request payout
router.post('/partner/request-payout', protect, verifyPartner, async (req, res) => {
  try {
    const { amount, paymentMethod } = req.body;
    const partner = req.partner;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid amount is required'
      });
    }
    
    const amountInCents = Math.round(amount * 100);
    const withdrawable = partner.commission.available - partner.commission.pending - partner.commission.onHold;
    
    // Check if partner has enough available commission
    if (amountInCents > withdrawable) {
      return res.status(400).json({
        success: false,
        error: `Insufficient withdrawable funds. Available: €${(withdrawable / 100).toFixed(2)}`
      });
    }
    
    // Check minimum payout
    if (partner.minimumPayout && amountInCents < partner.minimumPayout) {
      return res.status(400).json({
        success: false,
        error: `Minimum payout is €${(partner.minimumPayout / 100).toFixed(2)}`
      });
    }
    
    // Create payout request (pending admin approval)
    const transaction = await CommissionTransaction.create({
      partner: partner.id,
      amount: amountInCents,
      type: 'PAID_OUT',
      status: 'PENDING',
      description: 'Payout request by partner',
      paymentMethod: paymentMethod || partner.preferredPayoutMethod,
      metadata: {
        requestedBy: 'partner',
        requestDate: new Date(),
        amountRequested: amount
      }
    });
    
    // Update partner's pending amount
    partner.commission.pending += amountInCents;
    await partner.save();
    
    // TODO: Send notification to admin
    console.log(`📧 Payout request from ${partner.email}: €${amount}`);
    
    res.json({
      success: true,
      message: 'Payout request submitted for admin approval',
      data: {
        transactionId: transaction._id,
        amount: amount,
        status: 'PENDING'
      }
    });
    
  } catch (error) {
    console.error('Request payout error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get payout methods
router.get('/partner/payout-methods', protect, verifyPartner, async (req, res) => {
  try {
    const partner = req.partner;
    
    const payoutMethods = [];
    
    // Check Stripe Connect
    if (partner.stripeConnect.accountId && partner.stripeConnect.chargesEnabled) {
      payoutMethods.push({
        method: 'stripe_connect',
        label: 'Stripe Connect',
        enabled: true,
        accountId: partner.stripeConnect.accountId
      });
    }
    
    // Check bank details
    if (partner.bankDetails && partner.bankDetails.iban) {
      payoutMethods.push({
        method: 'bank_transfer',
        label: 'Bank Transfer',
        enabled: partner.bankDetails.verified || false,
        bankDetails: partner.bankDetails
      });
    }
    
    // Check PayPal
    if (partner.paypalEmail) {
      payoutMethods.push({
        method: 'paypal',
        label: 'PayPal',
        enabled: true,
        email: partner.paypalEmail
      });
    }
    
    res.json({
      success: true,
      data: {
        preferredMethod: partner.preferredPayoutMethod,
        methods: payoutMethods,
        settings: {
          autoPayoutEnabled: partner.autoPayoutEnabled,
          payoutThreshold: partner.payoutThreshold / 100,
          minimumPayout: partner.minimumPayout / 100
        }
      }
    });
    
  } catch (error) {
    console.error('Get payout methods error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ========== PUBLIC/UTILITY ROUTES ==========

// Test commission system
router.get('/test', async (req, res) => {
  try {
    // Find a test partner
    const Partner = require('../model/Partner');
    const partner = await Partner.findOne();
    
    if (!partner) {
      return res.json({
        success: false,
        message: 'No partner found for testing'
      });
    }
    
    res.json({
      success: true,
      message: 'Commission system is working',
      partner: {
        id: partner._id,
        name: partner.name,
        email: partner.email,
        commission: partner.commissionDisplay
      }
    });
    
  } catch (error) {
    console.error('Test route error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;