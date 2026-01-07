const CommissionTransaction = require('../model/CommissionTransaction');
const Partner = require('../model/Partner');
const Order = require('../model/Order');

class CommissionService {
  // ========== EARN COMMISSION ==========
  static async earnCommission(orderId) {
    try {
      console.log('💰 Processing commission for order:', orderId);
      
      // Find the order with partner details
      const order = await Order.findById(orderId);
      
      if (!order) {
        throw new Error('Order not found');
      }
      
      // Check if order has a referral
      if (order.clientType !== 'REFERRAL' || !order.referralInfo.referredBy) {
        console.log('ℹ️ No referral for this order');
        return null;
      }
      
      // Check if commission already processed
      if (order.referralInfo.commissionProcessed) {
        console.log('ℹ️ Commission already processed for this order');
        return null;
      }
      
      const partner = await Partner.findById(order.referralInfo.referredBy);
      if (!partner) {
        throw new Error('Partner not found');
      }
      
      const commissionAmount = 40000; // €400 in cents
      
      console.log('🎯 Commission details:', {
        orderId: order._id,
        partnerId: partner._id,
        partnerName: partner.name,
        commissionAmount: commissionAmount
      });
      
      // Create commission transaction
      const transaction = await CommissionTransaction.create({
        partner: partner._id,
        order: order._id,
        amount: commissionAmount,
        type: 'EARNED',
        status: 'COMPLETED',
        description: `€400 commission for order #${order._id}`,
        metadata: {
          orderAmount: order.finalPrice,
          orderDate: order.createdAt,
          customerEmail: order.customerDetails.email,
          plan: order.plan
        }
      });
      
      // Update partner's commission totals
      partner.commission.earned += commissionAmount;
      partner.commission.available += commissionAmount;
      partner.referrals.totalOrders += 1;
      partner.referrals.totalSales += order.finalPrice;
      await partner.save();
      
      // Update order
      order.referralInfo.commissionProcessed = true;
      order.commission.status = 'approved';
      await order.save();
      
      console.log('✅ Commission earned successfully:', {
        transactionId: transaction._id,
        newBalance: partner.commission.available,
        partnerEmail: partner.email
      });
      
      return transaction;
      
    } catch (error) {
      console.error('❌ Error earning commission:', error);
      throw error;
    }
  }
  
  // ========== PROCESS PAYOUT ==========
  static async processPayout(partnerId, amount, adminId, paymentData = {}) {
    try {
      console.log('💸 Processing payout:', { partnerId, amount });
      
      const partner = await Partner.findById(partnerId);
      if (!partner) {
        throw new Error('Partner not found');
      }
      
      // Validate payout amount
      const amountInCents = Math.round(amount * 100);
      
      if (amountInCents <= 0) {
        throw new Error('Payout amount must be greater than 0');
      }
      
      const withdrawable = partner.commission.available - partner.commission.pending - partner.commission.onHold;
      
      if (amountInCents > withdrawable) {
        throw new Error(`Insufficient withdrawable funds. Available: €${(withdrawable / 100).toFixed(2)}`);
      }
      
      // Check minimum payout
      if (partner.minimumPayout && amountInCents < partner.minimumPayout) {
        throw new Error(`Minimum payout is €${(partner.minimumPayout / 100).toFixed(2)}`);
      }
      
      // Create payout transaction
      const transaction = await CommissionTransaction.create({
        partner: partnerId,
        amount: amountInCents,
        type: 'PAID_OUT',
        status: 'COMPLETED',
        description: `Payout processed by admin`,
        adminNotes: paymentData.notes || '',
        paymentMethod: paymentData.method || partner.preferredPayoutMethod || 'BANK_TRANSFER',
        transactionId: paymentData.transactionId,
        balanceBefore: partner.commission.available,
        balanceAfter: partner.commission.available - amountInCents,
        metadata: {
          processedBy: adminId,
          payoutDate: new Date(),
          ...paymentData
        }
      });
      
      // Update partner balances
      partner.commission.paid += amountInCents;
      partner.commission.available -= amountInCents;
      partner.lastPayoutAt = new Date();
      await partner.save();
      
      console.log('✅ Payout processed successfully:', {
        transactionId: transaction._id,
        amount: amount,
        newBalance: partner.commission.available
      });
      
      return {
        transaction,
        partner,
        balanceBefore: partner.commission.available + amountInCents,
        balanceAfter: partner.commission.available
      };
      
    } catch (error) {
      console.error('❌ Payout error:', error);
      throw error;
    }
  }
  
  // ========== ADJUST COMMISSION ==========
  static async adjustCommission(partnerId, adjustmentData) {
    try {
      const { amount, type, reason, adminNotes, adminId } = adjustmentData;
      
      console.log('🔄 Adjusting commission:', { partnerId, amount, type });
      
      const partner = await Partner.findById(partnerId);
      if (!partner) {
        throw new Error('Partner not found');
      }
      
      const amountInCents = Math.round(amount * 100);
      const balanceBefore = partner.commission.available;
      let balanceAfter = balanceBefore;
      let transactionType = 'ADJUSTED';
      
      // Calculate new balance
      if (type === 'ADD') {
        balanceAfter = balanceBefore + amountInCents;
      } else if (type === 'DEDUCT') {
        if (amountInCents > partner.commission.available) {
          throw new Error('Deduction amount exceeds available commission');
        }
        balanceAfter = balanceBefore - amountInCents;
      } else {
        throw new Error('Invalid adjustment type');
      }
      
      // Create adjustment transaction
      const transaction = await CommissionTransaction.create({
        partner: partnerId,
        amount: amountInCents,
        type: transactionType,
        status: 'COMPLETED',
        description: reason || `Commission ${type.toLowerCase()}ed by admin`,
        adminNotes: adminNotes || '',
        balanceBefore: balanceBefore,
        balanceAfter: balanceAfter,
        metadata: {
          adjustmentType: type,
          adjustedBy: adminId,
          reason: reason
        }
      });
      
      // Update partner balances
      if (type === 'ADD') {
        partner.commission.earned += amountInCents;
        partner.commission.available = balanceAfter;
      } else if (type === 'DEDUCT') {
        partner.commission.earned -= amountInCents;
        partner.commission.available = balanceAfter;
      }
      
      await partner.save();
      
      console.log('✅ Commission adjusted successfully');
      
      return {
        transaction,
        partner,
        adjustmentType: type,
        balanceBefore,
        balanceAfter
      };
      
    } catch (error) {
      console.error('❌ Adjustment error:', error);
      throw error;
    }
  }
  
  // ========== HOLD COMMISSION ==========
  static async holdCommission(partnerId, holdData) {
    try {
      const { amount, reason, adminNotes, adminId, holdUntil } = holdData;
      
      console.log('🔒 Placing hold on commission:', { partnerId, amount });
      
      const partner = await Partner.findById(partnerId);
      if (!partner) {
        throw new Error('Partner not found');
      }
      
      const amountInCents = Math.round(amount * 100);
      
      if (amountInCents > partner.commission.available) {
        throw new Error('Hold amount exceeds available commission');
      }
      
      const balanceBefore = partner.commission.available;
      const balanceAfter = balanceBefore - amountInCents;
      
      // Create hold transaction
      const transaction = await CommissionTransaction.create({
        partner: partnerId,
        amount: amountInCents,
        type: 'HOLD',
        status: 'ON_HOLD',
        description: reason || 'Commission placed on hold',
        adminNotes: adminNotes || `Hold until: ${holdUntil || 'Not specified'}`,
        balanceBefore: balanceBefore,
        balanceAfter: balanceAfter,
        metadata: {
          heldBy: adminId,
          holdUntil: holdUntil,
          holdReason: reason
        }
      });
      
      // Update partner balances
      partner.commission.onHold += amountInCents;
      partner.commission.available = balanceAfter;
      await partner.save();
      
      console.log('✅ Commission held successfully');
      
      return {
        transaction,
        partner,
        balanceBefore,
        balanceAfter
      };
      
    } catch (error) {
      console.error('❌ Hold error:', error);
      throw error;
    }
  }
  
  // ========== RELEASE HOLD ==========
  static async releaseHold(transactionId) {
    try {
      console.log('🔓 Releasing hold:', transactionId);
      
      const transaction = await CommissionTransaction.findById(transactionId);
      if (!transaction || transaction.type !== 'HOLD') {
        throw new Error('Hold transaction not found');
      }
      
      const partner = await Partner.findById(transaction.partner);
      if (!partner) {
        throw new Error('Partner not found');
      }
      
      // Create release transaction
      const releaseTransaction = await CommissionTransaction.create({
        partner: transaction.partner,
        amount: transaction.amount,
        type: 'HOLD_RELEASED',
        status: 'COMPLETED',
        description: 'Hold released',
        adminNotes: `Released from hold transaction: ${transactionId}`,
        balanceBefore: partner.commission.available,
        balanceAfter: partner.commission.available + transaction.amount,
        metadata: {
          originalHoldId: transactionId,
          releasedAt: new Date()
        }
      });
      
      // Update partner balances
      partner.commission.onHold -= transaction.amount;
      partner.commission.available += transaction.amount;
      await partner.save();
      
      // Update original hold transaction
      transaction.status = 'COMPLETED';
      await transaction.save();
      
      console.log('✅ Hold released successfully');
      
      return {
        releaseTransaction,
        partner,
        releasedAmount: transaction.amount
      };
      
    } catch (error) {
      console.error('❌ Release hold error:', error);
      throw error;
    }
  }
  
  // ========== GET PARTNER TRANSACTIONS ==========
  static async getPartnerTransactions(partnerId, filters = {}) {
    try {
      const query = { partner: partnerId };
      
      if (filters.type) {
        query.type = filters.type;
      }
      
      if (filters.status) {
        query.status = filters.status;
      }
      
      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) {
          query.createdAt.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          query.createdAt.$lte = new Date(filters.endDate);
        }
      }
      
      const transactions = await CommissionTransaction.find(query)
        .populate('order', 'plan finalPrice customerDetails.email createdAt')
        .sort({ createdAt: -1 })
        .limit(filters.limit || 50)
        .lean();
      
      // Format amounts in euros
      const formattedTransactions = transactions.map(transaction => ({
        ...transaction,
        amountEuros: transaction.amount / 100,
        displayAmount: `€${(transaction.amount / 100).toFixed(2)}`,
        balanceBeforeEuros: transaction.balanceBefore ? transaction.balanceBefore / 100 : null,
        balanceAfterEuros: transaction.balanceAfter ? transaction.balanceAfter / 100 : null
      }));
      
      return formattedTransactions;
      
    } catch (error) {
      console.error('❌ Get transactions error:', error);
      throw error;
    }
  }
  
  // ========== GET PARTNER SUMMARY ==========
  static async getPartnerSummary(partnerId) {
    try {
      const partner = await Partner.findById(partnerId)
        .select('commission commissionDisplay referrals');
      
      if (!partner) {
        throw new Error('Partner not found');
      }
      
      // Calculate recent earnings (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const recentTransactions = await CommissionTransaction.find({
        partner: partnerId,
        type: 'EARNED',
        createdAt: { $gte: thirtyDaysAgo }
      });
      
      const recentEarnings = recentTransactions.reduce((sum, t) => sum + t.amount, 0);
      
      // Get pending payouts
      const pendingPayouts = await CommissionTransaction.find({
        partner: partnerId,
        type: 'PAID_OUT',
        status: 'PENDING'
      });
      
      const totalPending = pendingPayouts.reduce((sum, t) => sum + t.amount, 0);
      
      // Get total commission from orders
      const orders = await Order.find({
        'referralInfo.referredBy': partnerId,
        'referralInfo.commissionProcessed': true
      });
      
      const totalOrdersCommission = orders.reduce((sum, order) => sum + order.commission.amount, 0);
      
      return {
        summary: {
          earned: partner.commission.earned,
          paid: partner.commission.paid,
          available: partner.commission.available,
          onHold: partner.commission.onHold,
          pending: partner.commission.pending,
          withdrawable: partner.commission.available - partner.commission.pending - partner.commission.onHold,
          earnedEuros: (partner.commission.earned / 100).toFixed(2),
          paidEuros: (partner.commission.paid / 100).toFixed(2),
          availableEuros: (partner.commission.available / 100).toFixed(2),
          withdrawableEuros: ((partner.commission.available - partner.commission.pending - partner.commission.onHold) / 100).toFixed(2)
        },
        stats: {
          totalClients: partner.referrals.totalClients,
          totalOrders: partner.referrals.totalOrders,
          totalSales: partner.referrals.totalSales,
          totalSalesEuros: (partner.referrals.totalSales / 100).toFixed(2),
          recentEarnings: recentEarnings,
          recentEarningsEuros: (recentEarnings / 100).toFixed(2),
          pendingPayouts: totalPending,
          pendingPayoutsEuros: (totalPending / 100).toFixed(2),
          totalOrdersCommission: totalOrdersCommission,
          totalOrdersCommissionEuros: (totalOrdersCommission / 100).toFixed(2)
        }
      };
      
    } catch (error) {
      console.error('❌ Get summary error:', error);
      throw error;
    }
  }
  
  // ========== AUTO PROCESS COMMISSION FOR PAID ORDERS ==========
  static async processCommissionsForPaidOrders() {
    try {
      console.log('🔄 Processing commissions for paid referral orders...');
      
      // Find all referral orders with successful payment but commission not processed
      const orders = await Order.find({
        clientType: 'REFERRAL',
        'stripe.paymentStatus': 'succeeded',
        'referralInfo.commissionProcessed': false,
        'referralInfo.referredBy': { $exists: true, $ne: null }
      });
      
      console.log(`📊 Found ${orders.length} orders to process commissions for`);
      
      const results = {
        processed: 0,
        failed: 0,
        errors: []
      };
      
      for (const order of orders) {
        try {
          await this.earnCommission(order._id);
          results.processed++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            orderId: order._id,
            error: error.message
          });
          console.error(`❌ Failed to process commission for order ${order._id}:`, error.message);
        }
      }
      
      console.log(`✅ Commission processing complete: ${results.processed} processed, ${results.failed} failed`);
      return results;
      
    } catch (error) {
      console.error('❌ Auto commission processing error:', error);
      throw error;
    }
  }
}

module.exports = CommissionService;