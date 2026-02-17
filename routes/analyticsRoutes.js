const express = require('express');
const router = express.Router();
const analyticsController = require('../controller/analyticsController');
const { verifyAdmin, protect, verifyPartner } = require('../middleware/authMiddleware');

// ========== PARTNER ANALYTICS (ADMIN) ==========

// Get partner performance analytics
router.get('/admin/partners/:id/performance', verifyAdmin, analyticsController.getPartnerPerformance);

// Get partner sales analytics
router.get('/admin/partners/:id/sales', verifyAdmin, analyticsController.getPartnerSales);

// Get partner overview stats
router.get('/admin/partners/:id/overview', verifyAdmin, analyticsController.getPartnerOverview);

// ========== PARTNER ANALYTICS (PARTNER SELF) ==========

// Partner can view their own performance
router.get('/partner/performance', protect, verifyPartner, async (req, res) => {
  // Redirect to admin endpoint with partner's own ID
  req.params.id = req.partner.id;
  return analyticsController.getPartnerPerformance(req, res);
});

// Partner can view their own sales
router.get('/partner/sales', protect, verifyPartner, async (req, res) => {
  req.params.id = req.partner.id;
  return analyticsController.getPartnerSales(req, res);
});

// ========== GLOBAL ANALYTICS (ADMIN) ==========

// Get global partner performance summary
router.get('/admin/summary', verifyAdmin, async (req, res) => {
  try {
    const Partner = require('../model/Partner');
    const Order = require('../model/Order');
    
    const totalPartners = await Partner.countDocuments({ status: 'active' });
    const totalReferralOrders = await Order.countDocuments({ 
      clientType: 'REFERRAL',
      status: 'completed'
    });
    
    const totalReferralSales = await Order.aggregate([
      { $match: { clientType: 'REFERRAL', status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$finalPrice' } } }
    ]);
    
    const totalCommissions = await Order.aggregate([
      { $match: { clientType: 'REFERRAL', status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$commission.amount' } } }
    ]);
    
    res.json({
      success: true,
      data: {
        totalPartners,
        totalReferralOrders,
        totalReferralSales: totalReferralSales[0]?.total / 100 || 0,
        totalCommissions: totalCommissions[0]?.total / 100 || 0,
        averageCommissionPerPartner: totalPartners > 0 
          ? ((totalCommissions[0]?.total || 0) / totalPartners / 100).toFixed(2)
          : '0.00'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;