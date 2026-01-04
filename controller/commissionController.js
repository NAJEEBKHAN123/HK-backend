const Partner = require('../model/Partner');
const CommissionTransaction = require('../model/CommissionTransaction');
const Order = require('../model/Order');
const mongoose = require('mongoose');

exports.processPayout = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { partnerId } = req.params;
    const { 
      amount, 
      paymentMethod = 'BANK_TRANSFER',
      transactionId,
      adminNotes 
    } = req.body;
    
    const adminId = req.admin?._id || req.user?._id;
    
    console.log('💰 Processing payout request:', {
      partnerId,
      amount,
      paymentMethod,
      adminId
    });
    
    const amountInEuros = parseFloat(amount);
    
    if (isNaN(amountInEuros) || amountInEuros <= 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: "Invalid amount provided"
      });
    }
    
    const partner = await Partner.findById(partnerId).session(session);
    
    if (!partner) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        error: "Partner not found"
      });
    }
    
    console.log('📊 Partner commission status:', {
      earned: partner.commissionEarned,
      paid: partner.commissionPaid,
      available: partner.availableCommission,
      onHold: partner.commissionOnHold,
      withdrawable: partner.withdrawableCommission,
      requested: amountInEuros
    });
    
    const result = await partner.processPayout(
      amountInEuros,
      adminId,
      paymentMethod,
      transactionId,
      adminNotes
    );
    
    await session.commitTransaction();
    session.endSession();
    
    console.log('✅ Payout successful:', {
      partnerId,
      amountInEuros,
      newAvailable: partner.availableCommission
    });
    
    res.status(200).json({
      success: true,
      message: `Payout of €${amountInEuros} processed successfully`,
      data: {
        partner: partner.getCommissionSummary(),
        transaction: result.transaction,
        payoutDetails: {
          amount: amountInEuros,
          paymentMethod: paymentMethod,
          transactionId: transactionId
        }
      }
    });
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('❌ Payout error:', error.message);
    
    res.status(400).json({
      success: false,
      error: error.message || "Failed to process payout"
    });
  }
};

exports.adjustCommission = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { partnerId } = req.params;
    const { 
      amount, 
      type,
      reason,
      referenceOrderId,
      adminNotes 
    } = req.body;
    
    const adminId = req.admin?._id || req.user?._id;
    
    console.log('🔧 Commission adjustment request:', {
      partnerId,
      amount,
      type,
      reason,
      adminId
    });
    
    const amountInEuros = parseFloat(amount);
    
    if (isNaN(amountInEuros) || amountInEuros <= 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: "Invalid amount provided"
      });
    }
    
    if (!['ADD', 'DEDUCT', 'HOLD', 'RELEASE_HOLD', 'BONUS'].includes(type)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: "Invalid adjustment type"
      });
    }
    
    if (!reason || reason.trim() === '') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: "Reason is required for adjustment"
      });
    }
    
    const partner = await Partner.findById(partnerId).session(session);
    
    if (!partner) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        error: "Partner not found"
      });
    }
    
    const result = await partner.adjustCommission(
      amountInEuros,
      type,
      reason,
      adminId,
      referenceOrderId,
      adminNotes
    );
    
    await session.commitTransaction();
    session.endSession();
    
    console.log('✅ Commission adjustment successful:', {
      partnerId,
      type,
      amountInEuros
    });
    
    res.status(200).json({
      success: true,
      message: `Commission ${type.toLowerCase()} of €${amountInEuros} processed successfully`,
      data: {
        partner: partner.getCommissionSummary(),
        transaction: result.transaction,
        adjustmentDetails: {
          type: type,
          amount: amountInEuros,
          reason: reason
        }
      }
    });
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('❌ Commission adjustment error:', error);
    res.status(400).json({
      success: false,
      error: error.message || "Adjustment failed"
    });
  }
};

exports.getPartnerTransactions = async (req, res) => {
  try {
    const { partnerId } = req.params;
    const { 
      page = 1, 
      limit = 20,
      type,
      status,
      startDate,
      endDate,
      search 
    } = req.query;
    
    const skip = (page - 1) * limit;
    
    const query = { partner: partnerId };
    
    if (type) query.type = type;
    if (status) query.status = status;
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    if (search) {
      query.$or = [
        { description: { $regex: search, $options: 'i' } },
        { referenceNumber: { $regex: search, $options: 'i' } },
        { transactionId: { $regex: search, $options: 'i' } }
      ];
    }
    
    const transactions = await CommissionTransaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('referenceOrder', 'plan originalPrice createdAt status')
      .populate('processedBy', 'name email')
      .lean();
    
    const formattedTransactions = transactions.map(transaction => ({
      ...transaction,
      amountFormatted: new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(transaction.amount),
      balanceAfterFormatted: new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(transaction.balanceAfter)
    }));
    
    const total = await CommissionTransaction.countDocuments(query);
    
    const summary = await CommissionTransaction.aggregate([
      { $match: { partner: new mongoose.Types.ObjectId(partnerId) } },
      {
        $group: {
          _id: '$type',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);
    
    res.status(200).json({
      success: true,
      data: formattedTransactions,
      summary: summary,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('❌ Get transactions error:', error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch transactions"
    });
  }
};

exports.getPartnerCommissionSummary = async (req, res) => {
  try {
    const { partnerId } = req.params;
    
    const partner = await Partner.findById(partnerId)
      .populate('clientsReferred', 'name email')
      .populate('ordersReferred', 'plan originalPrice status')
      .lean();
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: "Partner not found"
      });
    }
    
    const recentTransactions = await CommissionTransaction.find({ 
      partner: partnerId 
    })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('referenceOrder', 'plan originalPrice')
    .lean();
    
    const formattedTransactions = recentTransactions.map(transaction => ({
      ...transaction,
      amountFormatted: new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(transaction.amount)
    }));
    
    const now = new Date();
    const last30Days = new Date(now.setDate(now.getDate() - 30));
    
    const monthlyStats = await CommissionTransaction.aggregate([
      {
        $match: {
          partner: new mongoose.Types.ObjectId(partnerId),
          type: 'EARNED',
          createdAt: { $gte: last30Days },
          status: 'COMPLETED'
        }
      },
      {
        $group: {
          _id: null,
          totalEarned: { $sum: '$amount' },
          transactionCount: { $sum: 1 }
        }
      }
    ]);
    
    const totalPaid = await CommissionTransaction.aggregate([
      {
        $match: {
          partner: new mongoose.Types.ObjectId(partnerId),
          type: 'PAID_OUT',
          status: 'COMPLETED'
        }
      },
      {
        $group: {
          _id: null,
          totalPaid: { $sum: '$amount' }
        }
      }
    ]);
    
    const holdTransactions = await CommissionTransaction.aggregate([
      {
        $match: {
          partner: new mongoose.Types.ObjectId(partnerId),
          type: 'HOLD',
          status: 'COMPLETED'
        }
      },
      {
        $group: {
          _id: null,
          totalHold: { $sum: '$amount' }
        }
      }
    ]);
    
    const releasedHold = await CommissionTransaction.aggregate([
      {
        $match: {
          partner: new mongoose.Types.ObjectId(partnerId),
          type: 'HOLD_RELEASED',
          status: 'COMPLETED'
        }
      },
      {
        $group: {
          _id: null,
          totalReleased: { $sum: '$amount' }
        }
      }
    ]);
    
    const currentHold = (holdTransactions[0]?.totalHold || 0) - (releasedHold[0]?.totalReleased || 0);
    
    res.status(200).json({
      success: true,
      data: {
        summary: {
          earned: partner.commissionEarned || 0,
          paid: partner.commissionPaid || 0,
          available: partner.availableCommission || 0,
          onHold: currentHold,
          withdrawable: Math.max(0, (partner.availableCommission || 0) - currentHold),
          commissionRate: partner.commissionRate || 10,
          formatted: {
            earned: new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: 'EUR',
              minimumFractionDigits: 0
            }).format(partner.commissionEarned || 0),
            available: new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: 'EUR',
              minimumFractionDigits: 0
            }).format(partner.availableCommission || 0)
          }
        },
        recentTransactions: formattedTransactions,
        monthlyEarnings: monthlyStats[0]?.totalEarned || 0,
        totalPaidOut: totalPaid[0]?.totalPaid || 0,
        stats: {
          totalClients: partner.clientsReferred?.length || 0,
          totalOrders: partner.ordersReferred?.length || 0,
          conversionRate: partner.conversionRate || '0.00',
          totalSales: partner.totalReferralSales || 0,
          avgOrderValue: partner.ordersReferred?.length > 0 
            ? (partner.totalReferralSales || 0) / partner.ordersReferred.length
            : 0
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Get summary error:', error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch commission summary"
    });
  }
};

exports.getTransactionById = async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    const transaction = await CommissionTransaction.findById(transactionId)
      .populate('partner', 'name email referralCode')
      .populate('referenceOrder', 'plan originalPrice customerDetails.email')
      .populate('processedBy', 'name email')
      .lean();
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: "Transaction not found"
      });
    }
    
    transaction.amountFormatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0
    }).format(transaction.amount);
    
    transaction.balanceAfterFormatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0
    }).format(transaction.balanceAfter);
    
    res.status(200).json({
      success: true,
      data: transaction
    });
    
  } catch (error) {
    console.error('❌ Get transaction error:', error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch transaction"
    });
  }
};

exports.updateTransactionStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { transactionId } = req.params;
    const { status, adminNotes } = req.body;
    const adminId = req.admin?._id || req.user?._id;
    
    const transaction = await CommissionTransaction.findById(transactionId).session(session);
    
    if (!transaction) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        error: "Transaction not found"
      });
    }
    
    transaction.status = status;
    if (adminNotes) {
      transaction.adminNotes = adminNotes;
    }
    transaction.processedBy = adminId;
    
    await transaction.save({ session });
    
    if (transaction.type === 'PAID_OUT' && status === 'CANCELLED') {
      const partner = await Partner.findById(transaction.partner).session(session);
      if (partner) {
        partner.commissionPaid -= transaction.amount;
        partner.availableCommission += transaction.amount;
        await partner.save({ session });
      }
    }
    
    await session.commitTransaction();
    session.endSession();
    
    res.status(200).json({
      success: true,
      message: `Transaction status updated to ${status}`,
      data: transaction
    });
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('❌ Update transaction error:', error);
    res.status(500).json({
      success: false,
      error: "Failed to update transaction status"
    });
  }
};