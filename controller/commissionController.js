const CommissionTransaction = require('../model/CommissionTransaction');
const Partner = require('../model/Partner');

// ✅ GET commission transactions for a partner
exports.getPartnerTransactions = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50, page = 1 } = req.query;
    const skip = (page - 1) * limit;

    console.log(`📊 Getting transactions for partner: ${id}, limit: ${limit}`);

    // Verify partner exists
    const partner = await Partner.findById(id);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    // Get transactions
    const transactions = await CommissionTransaction.find({ partner: id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await CommissionTransaction.countDocuments({ partner: id });

    // Format transactions for frontend
    const formattedTransactions = transactions.map(trans => ({
      _id: trans._id,
      type: trans.type,
      amount: trans.amount || 0,
      description: trans.description || '',
      status: trans.status || 'COMPLETED',
      paymentMethod: trans.paymentMethod,
      transactionId: trans.transactionId,
      adminNotes: trans.adminNotes,
      balanceAfter: trans.balanceAfter || 0,
      createdAt: trans.createdAt,
      updatedAt: trans.updatedAt
    }));

    res.json({
      success: true,
      data: formattedTransactions,
      count: transactions.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit)
    });

  } catch (error) {
    console.error('❌ Get transactions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transactions',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ Process payout (admin)
exports.processPayout = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod, transactionId, adminNotes } = req.body;

    console.log('💰 Processing payout:', {
      partnerId: id,
      amount,
      paymentMethod,
      transactionId
    });

    const amountInCents = Math.round(amount * 100);
    
    if (amountInCents <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount'
      });
    }

    const partner = await Partner.findById(id);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    // Check available balance
    const availableBalance = partner.commission?.available || 0;
    if (amountInCents > availableBalance) {
      return res.status(400).json({
        success: false,
        error: `Insufficient funds. Available: €${(availableBalance / 100).toFixed(2)}`
      });
    }

    // Create payout transaction
    const transaction = await CommissionTransaction.create({
      partner: partner._id,
      amount: amountInCents,
      type: 'PAID_OUT',
      status: 'COMPLETED',
      description: `Payout via ${paymentMethod}`,
      adminNotes: adminNotes,
      paymentMethod: paymentMethod,
      transactionId: transactionId,
      balanceBefore: partner.commission.available,
      balanceAfter: partner.commission.available - amountInCents
    });

    // Update partner
    partner.commission.paid = (partner.commission.paid || 0) + amountInCents;
    partner.commission.available = partner.commission.available - amountInCents;
    partner.lastPayoutAt = new Date();
    await partner.save();

    res.json({
      success: true,
      message: `Payout of €${amount.toFixed(2)} processed successfully`,
      data: transaction,
      newBalance: partner.commission.available
    });

  } catch (error) {
    console.error('❌ Payout error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process payout'
    });
  }
};

// ✅ Adjust commission (admin)
exports.adjustCommission = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, type, reason, adminNotes } = req.body;

    console.log('📝 Adjusting commission:', {
      partnerId: id,
      amount,
      type,
      reason
    });

    const amountInCents = Math.round(amount * 100);
    
    if (amountInCents <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount'
      });
    }

    if (!['ADD', 'DEDUCT', 'HOLD', 'RELEASE_HOLD'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid adjustment type'
      });
    }

    const partner = await Partner.findById(id);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    let result;
    
    if (type === 'ADD') {
      // Add commission
      const transaction = await CommissionTransaction.create({
        partner: partner._id,
        amount: amountInCents,
        type: 'ADJUSTMENT',
        status: 'COMPLETED',
        description: `Manual addition: ${reason}`,
        adminNotes: adminNotes,
        balanceBefore: partner.commission.available,
        balanceAfter: partner.commission.available + amountInCents
      });
      
      // Update partner
      partner.commission.earned = (partner.commission.earned || 0) + amountInCents;
      partner.commission.available = (partner.commission.available || 0) + amountInCents;
      await partner.save();
      
      result = { success: true, transaction };
      
    } else if (type === 'DEDUCT') {
      // For deduction, check if partner has enough balance
      const availableBalance = partner.commission?.available || 0;
      if (amountInCents > availableBalance) {
        return res.status(400).json({
          success: false,
          error: `Insufficient funds for deduction. Available: €${(availableBalance / 100).toFixed(2)}`
        });
      }
      
      // Create deduction transaction
      const transaction = await CommissionTransaction.create({
        partner: partner._id,
        amount: amountInCents,
        type: 'ADJUSTMENT',
        status: 'COMPLETED',
        description: `Manual deduction: ${reason}`,
        adminNotes: adminNotes,
        balanceBefore: partner.commission.available,
        balanceAfter: partner.commission.available - amountInCents
      });
      
      // Update partner
      partner.commission.available -= amountInCents;
      partner.commission.earned = Math.max(0, partner.commission.earned - amountInCents);
      await partner.save();
      
      result = { success: true, transaction };
      
    } else if (type === 'HOLD') {
      // Place commission on hold
      const availableBalance = partner.commission?.available || 0;
      if (amountInCents > availableBalance) {
        return res.status(400).json({
          success: false,
          error: `Insufficient funds for hold. Available: €${(availableBalance / 100).toFixed(2)}`
        });
      }
      
      const transaction = await CommissionTransaction.create({
        partner: partner._id,
        amount: amountInCents,
        type: 'HOLD',
        status: 'ON_HOLD',
        description: `Commission placed on hold: ${reason}`,
        adminNotes: adminNotes,
        balanceBefore: partner.commission.available,
        balanceAfter: partner.commission.available - amountInCents
      });
      
      // Update partner
      partner.commission.onHold = (partner.commission.onHold || 0) + amountInCents;
      partner.commission.available -= amountInCents;
      await partner.save();
      
      result = { success: true, transaction };
      
    } else if (type === 'RELEASE_HOLD') {
      // Release hold
      const onHoldBalance = partner.commission?.onHold || 0;
      if (amountInCents > onHoldBalance) {
        return res.status(400).json({
          success: false,
          error: `Release amount exceeds held commission. On hold: €${(onHoldBalance / 100).toFixed(2)}`
        });
      }
      
      const transaction = await CommissionTransaction.create({
        partner: partner._id,
        amount: amountInCents,
        type: 'HOLD_RELEASED',
        status: 'COMPLETED',
        description: `Hold released: ${reason}`,
        adminNotes: adminNotes,
        balanceBefore: partner.commission.available,
        balanceAfter: partner.commission.available + amountInCents
      });
      
      // Update partner
      partner.commission.onHold -= amountInCents;
      partner.commission.available += amountInCents;
      await partner.save();
      
      result = { success: true, transaction };
    }

    res.json({
      success: true,
      message: `Commission ${type.toLowerCase()}ed successfully`,
      data: result.transaction,
      newBalance: partner.commission.available,
      newOnHold: partner.commission.onHold
    });

  } catch (error) {
    console.error('❌ Adjustment error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to adjust commission'
    });
  }
};

// ✅ Get commission summary
exports.getCommissionSummary = async (req, res) => {
  try {
    const { id } = req.params;

    const partner = await Partner.findById(id);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    // Calculate recent earnings (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentEarnings = await CommissionTransaction.aggregate([
      {
        $match: {
          partner: partner._id,
          type: 'EARNED',
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);

    // Get pending payouts
    const pendingPayouts = await CommissionTransaction.aggregate([
      {
        $match: {
          partner: partner._id,
          type: 'PAID_OUT',
          status: 'PENDING'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);

    const summary = {
      earned: partner.commission.earned || 0,
      paid: partner.commission.paid || 0,
      available: partner.commission.available || 0,
      onHold: partner.commission.onHold || 0,
      pending: partner.commission.pending || 0,
      withdrawable: Math.max(0, (partner.commission.available || 0) - (partner.commission.pending || 0) - (partner.commission.onHold || 0)),
      recentEarnings: recentEarnings[0]?.total || 0,
      pendingPayouts: pendingPayouts[0]?.total || 0
    };

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('❌ Get summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get commission summary'
    });
  }
};