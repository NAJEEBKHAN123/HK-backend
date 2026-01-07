const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const partnerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, minlength: 6, select: false },
  
  referralCode: { type: String, unique: true, uppercase: true },
  referralLink: String,
  
  status: { type: String, enum: ['pending', 'active', 'suspended', 'inactive'], default: 'pending' },
  
  // 🔥 FIXED €400 COMMISSION SYSTEM (all amounts in cents)
  commission: {
    earned: { type: Number, default: 0 },      // Total earned (in cents)
    available: { type: Number, default: 0 },   // Available for payout (in cents)
    paid: { type: Number, default: 0 },        // Already paid (in cents)
    pending: { type: Number, default: 0 },     // In process (in cents)
    onHold: { type: Number, default: 0 }       // On hold (in cents)
  },
  
  // Referral Stats
  referrals: {
    totalClients: { type: Number, default: 0 },
    totalOrders: { type: Number, default: 0 },
    totalSales: { type: Number, default: 0 }, // Total sales referred (in cents)
    clients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Client' }],
    orders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }]
  },
  
  // Click tracking
  referralClicks: { type: Number, default: 0 },
  lastClickAt: Date,
  lastClickIP: String,
  clickHistory: [{
    timestamp: Date,
    ip: String,
    userAgent: String,
    referrer: String
  }],
  
  // STRIPE CONNECT
  stripeConnect: {
    accountId: String,
    status: { type: String, enum: ['not_connected', 'pending', 'active', 'suspended'], default: 'not_connected' },
    chargesEnabled: { type: Boolean, default: false },
    payoutsEnabled: { type: Boolean, default: false },
    detailsSubmitted: { type: Boolean, default: false }
  },
  
  // Bank Details
  bankDetails: {
    bankName: String,
    accountName: String,
    iban: String,
    swift: String,
    verified: { type: Boolean, default: false }
  },
  
  // PayPal
  paypalEmail: String,
  
  // Settings
  preferredPayoutMethod: { type: String, enum: ['stripe_connect', 'bank_transfer', 'paypal'], default: 'stripe_connect' },
  autoPayoutEnabled: { type: Boolean, default: true },
  payoutThreshold: { type: Number, default: 10000 }, // €100 in cents
  minimumPayout: { type: Number, default: 10000 }, // €100 in cents
  
  // Timestamps
  joinedAt: { type: Date, default: Date.now },
  lastLoginAt: Date,
  lastPayoutAt: Date,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtuals
partnerSchema.virtual('withdrawableAmount').get(function() {
  return Math.max(0, this.commission.available - this.commission.pending - this.commission.onHold);
});

partnerSchema.virtual('hasStripeConnect').get(function() {
  return !!this.stripeConnect.accountId && this.stripeConnect.chargesEnabled;
});

partnerSchema.virtual('commissionDisplay').get(function() {
  const formatEuros = (cents) => `€${(cents / 100).toFixed(2)}`;
  return {
    earned: formatEuros(this.commission.earned),
    available: formatEuros(this.commission.available),
    paid: formatEuros(this.commission.paid),
    pending: formatEuros(this.commission.pending),
    onHold: formatEuros(this.commission.onHold),
    withdrawable: formatEuros(this.commission.available - this.commission.pending - this.commission.onHold)
  };
});

// Password hashing
partnerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Generate referral code
partnerSchema.pre('save', function(next) {
  if (!this.referralCode) {
    const crypto = require('crypto');
    this.referralCode = `HKP${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  }
  
  if (!this.referralLink && this.referralCode) {
    const backendUrl = process.env.NODE_ENV === 'production' 
      ? 'https://hk-backend-tau.vercel.app' 
      : 'http://localhost:3000';
    this.referralLink = `${backendUrl}/api/partner-auth/track-click/${this.referralCode}`;
  }
  
  next();
});

// Methods
partnerSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Add commission method (for manual addition if needed)
partnerSchema.methods.addCommission = async function(amount, description) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const amountInCents = Math.round(amount * 100);
    
    // Create commission transaction
    const CommissionTransaction = mongoose.model('CommissionTransaction');
    await CommissionTransaction.create([{
      partner: this._id,
      amount: amountInCents,
      type: 'EARNED',
      status: 'COMPLETED',
      description: description || 'Manual commission addition'
    }], { session });
    
    // Update partner
    this.commission.earned += amountInCents;
    this.commission.available += amountInCents;
    await this.save({ session });
    
    await session.commitTransaction();
    
    return {
      success: true,
      amount: amountInCents,
      newBalance: this.commission.available
    };
    
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Process payout method
partnerSchema.methods.processPayout = async function(amount, method, adminNotes = '') {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const amountInCents = Math.round(amount * 100);
    const withdrawable = this.commission.available - this.commission.pending - this.commission.onHold;
    
    if (amountInCents > withdrawable) {
      throw new Error(`Insufficient withdrawable funds. Available: €${(withdrawable / 100).toFixed(2)}`);
    }
    
    if (amountInCents < this.minimumPayout) {
      throw new Error(`Minimum payout is €${(this.minimumPayout / 100).toFixed(2)}`);
    }
    
    // Create payout transaction
    const CommissionTransaction = mongoose.model('CommissionTransaction');
    const transaction = await CommissionTransaction.create([{
      partner: this._id,
      amount: amountInCents,
      type: 'PAID_OUT',
      status: 'COMPLETED',
      description: `Payout via ${method}`,
      adminNotes: adminNotes,
      paymentMethod: method,
      balanceBefore: this.commission.available,
      balanceAfter: this.commission.available - amountInCents
    }], { session });
    
    // Update partner
    this.commission.paid += amountInCents;
    this.commission.available -= amountInCents;
    this.lastPayoutAt = new Date();
    await this.save({ session });
    
    await session.commitTransaction();
    
    return {
      success: true,
      transaction: transaction[0],
      newBalance: this.commission.available
    };
    
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Hold commission method
partnerSchema.methods.holdCommission = async function(amount, reason, adminNotes = '') {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const amountInCents = Math.round(amount * 100);
    
    if (amountInCents > this.commission.available) {
      throw new Error('Hold amount exceeds available commission');
    }
    
    // Create hold transaction
    const CommissionTransaction = mongoose.model('CommissionTransaction');
    await CommissionTransaction.create([{
      partner: this._id,
      amount: amountInCents,
      type: 'HOLD',
      status: 'ON_HOLD',
      description: reason || 'Commission placed on hold',
      adminNotes: adminNotes,
      balanceBefore: this.commission.available,
      balanceAfter: this.commission.available - amountInCents
    }], { session });
    
    // Update partner
    this.commission.onHold += amountInCents;
    this.commission.available -= amountInCents;
    await this.save({ session });
    
    await session.commitTransaction();
    
    return {
      success: true,
      amount: amountInCents,
      newAvailable: this.commission.available,
      newOnHold: this.commission.onHold
    };
    
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Release hold method
partnerSchema.methods.releaseHold = async function(amount, reason) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const amountInCents = Math.round(amount * 100);
    
    if (amountInCents > this.commission.onHold) {
      throw new Error('Release amount exceeds held commission');
    }
    
    // Create release transaction
    const CommissionTransaction = mongoose.model('CommissionTransaction');
    await CommissionTransaction.create([{
      partner: this._id,
      amount: amountInCents,
      type: 'HOLD_RELEASED',
      status: 'COMPLETED',
      description: reason || 'Hold released',
      balanceBefore: this.commission.available,
      balanceAfter: this.commission.available + amountInCents
    }], { session });
    
    // Update partner
    this.commission.onHold -= amountInCents;
    this.commission.available += amountInCents;
    await this.save({ session });
    
    await session.commitTransaction();
    
    return {
      success: true,
      amount: amountInCents,
      newAvailable: this.commission.available,
      newOnHold: this.commission.onHold
    };
    
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Get commission summary
partnerSchema.methods.getCommissionSummary = async function() {
  const CommissionTransaction = mongoose.model('CommissionTransaction');
  
  // Calculate recent earnings (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const recentEarnings = await CommissionTransaction.aggregate([
    {
      $match: {
        partner: this._id,
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
        partner: this._id,
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
  
  return {
    summary: {
      earned: this.commission.earned,
      paid: this.commission.paid,
      available: this.commission.available,
      onHold: this.commission.onHold,
      pending: this.commission.pending,
      withdrawable: this.commission.available - this.commission.pending - this.commission.onHold
    },
    recentEarnings: recentEarnings[0]?.total || 0,
    pendingPayouts: pendingPayouts[0]?.total || 0
  };
};

module.exports = mongoose.model('Partner', partnerSchema);