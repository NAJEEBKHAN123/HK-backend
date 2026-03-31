// models/Partner.js - ENHANCED VERSION
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
  
  // 🔥 STRIPE CONNECT - ENHANCED
  stripeConnect: {
    accountId: String,
    status: { 
      type: String, 
      enum: ['not_connected', 'pending', 'active', 'suspended'], 
      default: 'not_connected' 
    },
    chargesEnabled: { type: Boolean, default: false },
    payoutsEnabled: { type: Boolean, default: false },
    detailsSubmitted: { type: Boolean, default: false },
    // 🔥 NEW: Track when setup was completed
    connectedAt: Date,
    lastSyncedAt: Date,
    // 🔥 NEW: Store account capabilities
    capabilities: {
      card_payments: String,
      transfers: String
    }
  },
  
  // Bank Details (fallback if no Stripe)
  bankDetails: {
    bankName: String,
    accountName: String,
    iban: String,
    swift: String,
    verified: { type: Boolean, default: false }
  },
  
  // PayPal (alternative)
  paypalEmail: String,
  
  // 🔥 PAYOUT SETTINGS
  payoutSettings: {
    preferredMethod: { 
      type: String, 
      enum: ['stripe_connect', 'bank_transfer', 'paypal'], 
      default: 'stripe_connect' 
    },
    autoPayoutEnabled: { type: Boolean, default: true },
    payoutThreshold: { type: Number, default: 10000 }, // €100 in cents
    minimumPayout: { type: Number, default: 10000 }, // €100 in cents
  },
  
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
  return !!this.stripeConnect.accountId && 
         this.stripeConnect.chargesEnabled && 
         this.stripeConnect.status === 'active';
});

partnerSchema.virtual('canReceiveAutoPayouts').get(function() {
  return this.hasStripeConnect && 
         this.payoutSettings.autoPayoutEnabled &&
         this.stripeConnect.payoutsEnabled;
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
    this.referralCode = `HKP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  }
  
  if (!this.referralLink && this.referralCode) {
    const backendUrl = process.env.NODE_ENV === 'production' 
      ? 'https://hk-backend-sn76.vercel.app' 
      : 'http://localhost:3000';
    this.referralLink = `${backendUrl}/api/partner-auth/track-click/${this.referralCode}`;
  }
  
  next();
});

// Methods
partnerSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// 🔥 NEW: Check if partner can receive instant transfers
partnerSchema.methods.canReceiveInstantTransfer = function() {
  return this.stripeConnect?.accountId && 
         this.stripeConnect?.chargesEnabled &&
         this.stripeConnect?.status === 'active';
};

// 🔥 NEW: Process instant Stripe transfer
partnerSchema.methods.processInstantTransfer = async function(orderAmount, orderId, stripe) {
  if (!this.canReceiveInstantTransfer()) {
    throw new Error('Partner cannot receive instant transfers - Stripe Connect not fully set up');
  }
  
  const commissionAmount = 40000; // €400 in cents
  
  try {
    // Create transfer to partner's Stripe Connect account
    const transfer = await stripe.transfers.create({
      amount: commissionAmount,
      currency: 'eur',
      destination: this.stripeConnect.accountId,
      description: `€400 commission for order ${orderId}`,
      metadata: {
        orderId: orderId.toString(),
        partnerId: this._id.toString(),
        partnerEmail: this.email,
        type: 'instant_commission',
        orderAmount: orderAmount
      }
    });
    
    console.log(`✅ Instant transfer created: ${transfer.id} for €400 to ${this.email}`);
    
    // Update partner commission
    this.commission.earned = (this.commission.earned || 0) + commissionAmount;
    this.commission.paid = (this.commission.paid || 0) + commissionAmount;
    this.lastPayoutAt = new Date();
    
    await this.save();
    
    return {
      success: true,
      transferId: transfer.id,
      amount: commissionAmount,
      partner: this.email
    };
    
  } catch (error) {
    console.error(`❌ Instant transfer failed for ${this.email}:`, error.message);
    throw error;
  }
};

module.exports = mongoose.model('Partner', partnerSchema);