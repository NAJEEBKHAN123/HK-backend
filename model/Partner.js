const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const partnerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 6,
    select: false
  },
  referralCode: {
    type: String,
    unique: true,
    uppercase: true
  },
  referralLink: String,
  status: {
    type: String,
    enum: ['pending', 'active', 'suspended', 'inactive'],
    default: 'pending'
  },
  
  // Commission Fields (stored in EUROS)
  commissionEarned: {
    type: Number,
    default: 0
  },
  commissionPaid: {
    type: Number,
    default: 0
  },
  commissionOnHold: {
    type: Number,
    default: 0
  },
  availableCommission: {
    type: Number,
    default: 0
  },
  commissionRate: {
    type: Number,
    default: 10 // 10%
  },
  totalReferralSales: {
    type: Number,
    default: 0
  },
  
  // Click Tracking
  referralClicks: {
    type: Number,
    default: 0
  },
  lastClickAt: Date,
  lastClickIP: String,
  clickHistory: [{
    timestamp: Date,
    ip: String,
    userAgent: String,
    referrer: String
  }],
  
  // Relationships
  clientsReferred: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client'
  }],
  ordersReferred: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  }],
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner'
  },
  
  // Metadata
  joinedAt: Date,
  lastLoginAt: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  
  // Settings
  paymentMethod: {
    type: String,
    enum: ['bank_transfer', 'paypal', 'stripe', null],
    default: null
  },
  paymentDetails: mongoose.Schema.Types.Mixed,
  
}, {
  timestamps: true
});

// Virtual for withdrawable commission
partnerSchema.virtual('withdrawableCommission').get(function() {
  const available = this.availableCommission || 0;
  const onHold = this.commissionOnHold || 0;
  return Math.max(0, available - onHold);
});

// Virtual for conversion rate
partnerSchema.virtual('conversionRate').get(function() {
  if (this.referralClicks === 0) return '0.00';
  const rate = ((this.clientsReferred?.length || 0) / this.referralClicks * 100);
  return rate.toFixed(2);
});

// ========== METHODS ==========

partnerSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

partnerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

partnerSchema.pre('save', async function(next) {
  if (!this.referralCode) {
    const crypto = require('crypto');
    this.referralCode = `HKP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  }
  
  if (!this.referralLink && this.referralCode) {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    this.referralLink = `${backendUrl}/api/partner-auth/track-click/${this.referralCode}`;
  }
  
  next();
});

// ========== COMMISSION METHODS ==========

partnerSchema.methods.getCommissionSummary = function() {
  const earned = this.commissionEarned || 0;
  const paid = this.commissionPaid || 0;
  const onHold = this.commissionOnHold || 0;
  const available = this.availableCommission || 0;
  const withdrawable = Math.max(0, available - onHold);
  
  return {
    earned: earned,
    paid: paid,
    onHold: onHold,
    available: available,
    withdrawable: withdrawable,
    pendingPayout: available > 0 ? available : 0
  };
};

partnerSchema.methods.addCommission = async function(orderAmount, orderId, description = 'Commission from order') {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const commissionRate = this.commissionRate || 10;
    const commissionAmount = orderAmount * (commissionRate / 100);
    
    this.commissionEarned += commissionAmount;
    this.availableCommission += commissionAmount;
    this.totalReferralSales += orderAmount;
    
    await this.save({ session });
    
    const CommissionTransaction = mongoose.model('CommissionTransaction');
    await CommissionTransaction.create([{
      partner: this._id,
      referenceOrder: orderId,
      amount: commissionAmount,
      type: 'EARNED',
      status: 'COMPLETED',
      description: description,
      balanceBefore: this.commissionEarned - commissionAmount,
      balanceAfter: this.commissionEarned,
      metadata: {
        orderAmount: orderAmount,
        commissionRate: commissionRate
      }
    }], { session });
    
    await session.commitTransaction();
    
    console.log(`✅ Commission added: €${commissionAmount} to partner ${this.email}`);
    
    return {
      success: true,
      commissionAmount: commissionAmount,
      newBalance: this.commissionEarned,
      transactionId: this._id
    };
    
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Commission add error:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

partnerSchema.methods.processPayout = async function(
  amount, 
  processedById, 
  paymentMethod = 'BANK_TRANSFER',
  transactionId = '',
  adminNotes = ''
) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const available = this.availableCommission || 0;
    const onHold = this.commissionOnHold || 0;
    const withdrawable = Math.max(0, available - onHold);
    
    console.log('💰 Payout request:', {
      requested: amount,
      available: available,
      onHold: onHold,
      withdrawable: withdrawable
    });
    
    if (amount > withdrawable) {
      throw new Error(
        `Insufficient commission. Available: €${available}, On Hold: €${onHold}, Withdrawable: €${withdrawable}, Requested: €${amount}`
      );
    }
    
    if (amount <= 0) {
      throw new Error('Invalid payout amount');
    }
    
    this.commissionPaid += amount;
    this.availableCommission -= amount;
    
    await this.save({ session });
    
    const CommissionTransaction = mongoose.model('CommissionTransaction');
    const transaction = await CommissionTransaction.create([{
      partner: this._id,
      amount: amount,
      type: 'PAID_OUT',
      status: 'COMPLETED',
      paymentMethod: paymentMethod,
      transactionId: transactionId,
      description: `Payout via ${paymentMethod} - ${adminNotes || 'No notes'}`,
      processedBy: processedById,
      adminNotes: adminNotes,
      balanceBefore: this.commissionEarned,
      balanceAfter: this.commissionEarned,
      availableBefore: available,
      availableAfter: this.availableCommission
    }], { session });
    
    await session.commitTransaction();
    
    console.log(`✅ Payout processed: €${amount} for partner ${this.email}`);
    
    return {
      success: true,
      transaction: transaction[0],
      newBalance: this.availableCommission,
      paidOut: amount
    };
    
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Payout error:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

partnerSchema.methods.adjustCommission = async function(
  amount,
  type,
  reason,
  processedById,
  referenceOrderId = null,
  adminNotes = ''
) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    let description = '';
    let balanceBefore = this.commissionEarned;
    let availableBefore = this.availableCommission;
    let onHoldBefore = this.commissionOnHold || 0;
    
    console.log(`🔧 Commission adjustment:`, {
      type: type,
      amount: amount,
      reason: reason,
      balanceBefore: balanceBefore,
      availableBefore: availableBefore,
      onHoldBefore: onHoldBefore
    });
    
    switch(type) {
      case 'ADD':
      case 'BONUS':
        this.commissionEarned += amount;
        this.availableCommission += amount;
        description = `${type === 'BONUS' ? 'Bonus' : 'Adjustment added'}: ${reason}`;
        break;
        
      case 'DEDUCT':
        if (amount > this.availableCommission) {
          throw new Error(`Cannot deduct more than available commission`);
        }
        this.commissionEarned -= amount;
        this.availableCommission -= amount;
        description = `Deduction: ${reason}`;
        break;
        
      case 'HOLD':
        if (amount > this.availableCommission) {
          throw new Error(`Cannot hold more than available commission`);
        }
        this.commissionOnHold = (this.commissionOnHold || 0) + amount;
        description = `Commission held: ${reason}`;
        break;
        
      case 'RELEASE_HOLD':
        if (amount > (this.commissionOnHold || 0)) {
          throw new Error(`Cannot release more than held commission`);
        }
        this.commissionOnHold = Math.max(0, (this.commissionOnHold || 0) - amount);
        description = `Hold released: ${reason}`;
        break;
        
      default:
        throw new Error(`Invalid adjustment type: ${type}`);
    }
    
    await this.save({ session });
    
    const CommissionTransaction = mongoose.model('CommissionTransaction');
    const transaction = await CommissionTransaction.create([{
      partner: this._id,
      referenceOrder: referenceOrderId,
      amount: amount,
      type: type,
      status: 'COMPLETED',
      description: description,
      processedBy: processedById,
      adminNotes: adminNotes,
      balanceBefore: balanceBefore,
      balanceAfter: this.commissionEarned,
      availableBefore: availableBefore,
      availableAfter: this.availableCommission,
      onHoldBefore: onHoldBefore,
      onHoldAfter: this.commissionOnHold,
      metadata: {
        reason: reason,
        adjustmentType: type
      }
    }], { session });
    
    await session.commitTransaction();
    
    console.log(`✅ Commission adjustment successful: ${type} €${amount}`);
    
    return {
      success: true,
      transaction: transaction[0],
      newBalance: this.commissionEarned,
      available: this.availableCommission,
      onHold: this.commissionOnHold
    };
    
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Adjustment error:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

module.exports = mongoose.model('Partner', partnerSchema);