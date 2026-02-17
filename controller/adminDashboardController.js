// controllers/adminDashboardController.js
const Order = require('../model/Order');
const Partner = require('../model/Partner');
const Client = require('../model/Client');
const CommissionTransaction = require('../model/CommissionTransaction');
const mongoose = require('mongoose');

exports.getDashboardStats = async (req, res) => {
  try {
    console.log('📊 Fetching dashboard stats...');
    
    const { range = '7d' } = req.query;
    
    // Calculate date ranges
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    
    let startDate = new Date();
    switch (range) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      default:
        startDate.setDate(startDate.getDate() - 7);
    }
    
    startDate.setHours(0, 0, 0, 0);

    // Get totals using Promise.all for efficiency
    const [
      totalOrders,
      completedOrders,
      pendingOrders,
      totalPartners,
      totalClients,
      totalRevenueResult,
      todayRevenueResult,
      commissionResult,
      pendingCommissions,
      pendingPayouts
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: 'completed' }),
      Order.countDocuments({ status: 'pending' }),
      Partner.countDocuments({ status: 'active' }),
      Client.countDocuments(),
      Order.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$finalPrice' } } }
      ]),
      Order.aggregate([
        { 
          $match: { 
            status: 'completed',
            createdAt: { $gte: today }
          } 
        },
        { $group: { _id: null, total: { $sum: '$finalPrice' } } }
      ]),
      CommissionTransaction.aggregate([
        {
          $match: {
            type: 'EARNED',
            status: 'COMPLETED'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' }
          }
        }
      ]),
      CommissionTransaction.countDocuments({ 
        status: 'PENDING',
        type: 'EARNED'
      }),
      CommissionTransaction.countDocuments({ 
        type: 'PAID_OUT', 
        status: 'PENDING' 
      })
    ]);

    // Calculate values
    const totalRevenue = totalRevenueResult[0]?.total || 0;
    const todayRevenue = todayRevenueResult[0]?.total || 0;
    const totalCommission = commissionResult[0]?.total || 0;
    const platformEarnings = totalRevenue - totalCommission;

    // Get revenue trend for charts
    const revenueTrend = await Order.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          revenue: { $sum: '$finalPrice' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Get orders by plan type
    const ordersByPlan = await Order.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$plan',
          orders: { $sum: 1 },
          revenue: { $sum: '$finalPrice' }
        }
      }
    ]);

    // Get top performing partners
    const topPartners = await CommissionTransaction.aggregate([
      {
        $match: {
          type: 'EARNED',
          status: 'COMPLETED',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$partner',
          totalCommission: { $sum: '$amount' },
          transactionCount: { $sum: 1 }
        }
      },
      { $sort: { totalCommission: -1 } },
      { $limit: 5 }
    ]);

    // Populate partner details
    if (topPartners.length > 0) {
      const partnerIds = topPartners.map(p => p._id);
      const partners = await Partner.find({ _id: { $in: partnerIds } });
      
      const partnerPerformance = topPartners.map(p => {
        const partner = partners.find(partner => partner._id.equals(p._id));
        return {
          id: p._id,
          name: partner?.name || 'Unknown',
          email: partner?.email || '',
          commission: p.totalCommission,
          orders: p.transactionCount,
          revenue: p.totalCommission * 10 // Estimate 10% commission rate
        };
      });

      stats.charts.partnerPerformance = partnerPerformance;
    }

    // Prepare stats object
    const stats = {
      totals: {
        revenue: totalRevenue / 100, // Convert cents to euros
        commission: totalCommission / 100,
        partners: totalPartners,
        clients: totalClients,
        orders: totalOrders,
        platformEarnings: platformEarnings / 100,
        conversionRate: totalOrders > 0 ? 
          ((completedOrders / totalOrders) * 100).toFixed(2) : 0
      },
      today: {
        revenue: todayRevenue / 100,
        orders: await Order.countDocuments({ 
          status: 'completed',
          createdAt: { $gte: today }
        }),
        clients: await Client.countDocuments({ 
          createdAt: { $gte: today }
        })
      },
      pending: {
        commissions: pendingCommissions,
        payouts: pendingPayouts,
        orders: pendingOrders
      },
      charts: {
        revenueByDay: revenueTrend.map(day => ({
          date: day._id,
          revenue: day.revenue / 100
        })),
        ordersByDay: ordersByPlan.map(plan => ({
          plan: plan._id,
          orders: plan.orders,
          revenue: plan.revenue / 100
        })),
        partnerPerformance: []
      }
    };

    console.log('✅ Dashboard stats fetched successfully');
    
    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('❌ Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard stats',
      message: error.message
    });
  }
};

exports.getQuickStats = async (req, res) => {
  try {
    const [
      totalOrders,
      totalRevenue,
      activePartners,
      pendingCommissions
    ] = await Promise.all([
      Order.countDocuments({ status: 'completed' }),
      Order.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$finalPrice' } } }
      ]),
      Partner.countDocuments({ status: 'active' }),
      CommissionTransaction.countDocuments({ status: 'PENDING' })
    ]);

    res.json({
      success: true,
      data: {
        totalOrders,
        totalRevenue: totalRevenue[0]?.total / 100 || 0,
        activePartners,
        pendingCommissions
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch quick stats'
    });
  }
};

exports.getReports = async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;
    
    const matchStage = { status: 'completed' };
    
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }
    
    let dateFormat;
    switch (groupBy) {
      case 'day':
        dateFormat = "%Y-%m-%d";
        break;
      case 'week':
        dateFormat = "%Y-%U";
        break;
      case 'month':
        dateFormat = "%Y-%m";
        break;
      default:
        dateFormat = "%Y-%m-%d";
    }

    const revenueReport = await Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            $dateToString: { format: dateFormat, date: "$createdAt" }
          },
          revenue: { $sum: '$finalPrice' },
          orders: { $sum: 1 },
          referralOrders: {
            $sum: { $cond: [{ $eq: ["$clientType", "REFERRAL"] }, 1, 0] }
          },
          directOrders: {
            $sum: { $cond: [{ $eq: ["$clientType", "DIRECT"] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const commissionReport = await CommissionTransaction.aggregate([
      {
        $match: {
          type: 'EARNED',
          status: 'COMPLETED',
          ...(startDate && { createdAt: { $gte: new Date(startDate) } }),
          ...(endDate && { createdAt: { $lte: new Date(endDate) } })
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: dateFormat, date: "$createdAt" }
          },
          totalCommission: { $sum: '$amount' },
          transactionCount: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: {
        revenueReport: revenueReport.map(item => ({
          ...item,
          revenue: item.revenue / 100
        })),
        commissionReport: commissionReport.map(item => ({
          ...item,
          totalCommission: item.totalCommission / 100
        }))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate reports'
    });
  }
};