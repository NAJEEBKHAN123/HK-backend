const express = require('express');
const router = express.Router();
const commissionController = require('../controller/commissionController');
const { verifyAdmin } = require('../middleware/authMiddleware');

// ========== ADMIN COMMISSION ROUTES ==========

// Get partner transactions
router.get('/admin/partner/:id/transactions', verifyAdmin, commissionController.getPartnerTransactions);

// Process payout
router.post('/admin/partner/:id/payout', verifyAdmin, commissionController.processPayout);

// Adjust commission
router.post('/admin/partner/:id/adjust', verifyAdmin, commissionController.adjustCommission);

// Get commission summary
router.get('/admin/partner/:id/summary', verifyAdmin, commissionController.getCommissionSummary);

module.exports = router;