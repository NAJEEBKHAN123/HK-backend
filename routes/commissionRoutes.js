// routes/commissionRoutes.js
const express = require('express');
const router = express.Router();
const commissionController = require('../controller/commissionController');
const { verifyAdmin, verifyPartner } = require('../middleware/authMiddleware');

// ========== ADMIN ROUTES ==========

// Get partner transactions
router.get('/admin/partner/:partnerId/transactions', verifyAdmin, commissionController.getPartnerTransactions);

// Get partner commission summary
router.get('/admin/partner/:partnerId/summary', verifyAdmin, commissionController.getPartnerCommissionSummary);

// Process payout
router.post('/admin/partner/:partnerId/payout', verifyAdmin, commissionController.processPayout);

// Adjust commission
router.post('/admin/partner/:partnerId/adjust', verifyAdmin, commissionController.adjustCommission);

// Get transaction by ID
router.get('/admin/transaction/:transactionId', verifyAdmin, commissionController.getTransactionById);

// Update transaction status
router.put('/admin/transaction/:transactionId/status', verifyAdmin, commissionController.updateTransactionStatus);

// ========== PARTNER ROUTES ==========

// Partner access to their own transactions
router.get('/partner/transactions', verifyPartner, (req, res) => {
  req.params.partnerId = req.partner._id;
  commissionController.getPartnerTransactions(req, res);
});

// Partner commission summary
router.get('/partner/summary', verifyPartner, (req, res) => {
  req.params.partnerId = req.partner._id;
  commissionController.getPartnerCommissionSummary(req, res);
});

// Partner request payout (triggers admin notification)
router.post('/partner/request-payout', verifyPartner, async (req, res) => {
  try {
    const { amount, paymentMethod, notes } = req.body;
    const partnerId = req.partner._id;
    
    // Convert to cents
    const amountInCents = Math.round(parseFloat(amount) * 100);
    
    // Create a pending payout request
    const CommissionTransaction = require('../model/CommissionTransaction');
    const transaction = await CommissionTransaction.create({
      partner: partnerId,
      amount: amountInCents,
      type: 'PAID_OUT',
      status: 'PENDING',
      paymentMethod: paymentMethod,
      description: `Payout request by partner: ${notes || 'No notes'}`,
      balanceBefore: req.partner.commissionEarned,
      balanceAfter: req.partner.commissionEarned,
      availableBefore: req.partner.availableCommission,
      availableAfter: req.partner.availableCommission - amountInCents,
      metadata: {
        requestedBy: 'PARTNER',
        requestNotes: notes,
        requestedAt: new Date()
      }
    });
    
    // TODO: Send notification to admin
    
    res.status(200).json({
      success: true,
      message: 'Payout request submitted for admin approval',
      data: {
        transactionId: transaction._id,
        amount: amountInCents,
        amountFormatted: `€${(amountInCents/100).toFixed(2)}`,
        status: 'PENDING'
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;