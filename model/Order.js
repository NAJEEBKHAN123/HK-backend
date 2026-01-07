const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  plan: {
    type: String,
    required: true,
    enum: ['STARTER', 'SMART', 'PREMIUM']
  },
  
  customerDetails: {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    birthday: { type: Date },
    idFrontImage: { type: String, required: true },
    idBackImage: { type: String, required: true }
  },
  
  // PRICING
  originalPrice: { type: Number, required: true }, // Full price in cents
  finalPrice: { type: Number, required: true }, // What client pays
  
  // 🔥 FIXED €400 COMMISSION SYSTEM
  commission: {
    amount: { type: Number, default: 0 }, // Always 40000 (€400 in cents) for referrals
    status: { type: String, enum: ['pending', 'approved', 'paid', 'cancelled'], default: 'pending' },
    paidAt: Date,
    paymentMethod: { type: String, enum: ['stripe_connect', 'manual_bank', 'paypal', null], default: null },
    stripeTransferId: String,
    stripePayoutId: String
  },
  
  // ORDER STATUS
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  
  // 🔥 CLIENT TYPE - MOST IMPORTANT
  clientType: {
    type: String,
    enum: ['DIRECT', 'REFERRAL'],
    default: 'DIRECT',
    required: true
  },
  
  // REFERRAL INFO
  referralInfo: {
    referralCode: String,
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
    partnerName: String,
    partnerEmail: String,
    partnerStripeAccountId: String,
    commissionProcessed: { type: Boolean, default: false }
  },
  
  // CLIENT
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  
  // STRIPE PAYMENT DATA
  stripe: {
    sessionId: String,
    paymentIntentId: String,
    customerId: String,
    subscriptionId: String,
    paymentStatus: { type: String, enum: ['pending', 'succeeded', 'failed', 'refunded'], default: 'pending' },
    amountPaid: Number,
    currency: { type: String, default: 'eur' },
    paymentMethod: String,
    receiptUrl: String,
    metadata: mongoose.Schema.Types.Mixed
  },
  
  // PAYMENT INFO
  paymentConfirmedAt: Date,
  transactionReference: String,
  
  // ADMIN
  adminNotes: String,
  cancellationReason: String,
  cancelledAt: Date,
  
  // TIMESTAMPS
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtuals
orderSchema.virtual('isReferral').get(function() {
  return this.clientType === 'REFERRAL';
});

orderSchema.virtual('commissionDisplay').get(function() {
  return this.clientType === 'REFERRAL' ? '€400' : '€0';
});

orderSchema.virtual('platformEarnings').get(function() {
  if (this.clientType === 'DIRECT') {
    return this.finalPrice; // You get all
  } else if (this.clientType === 'REFERRAL') {
    return Math.max(0, this.finalPrice - 40000); // You get (price - €400)
  }
  return this.finalPrice;
});

orderSchema.virtual('partnerEarnings').get(function() {
  return this.clientType === 'REFERRAL' ? 40000 : 0; // €400 in cents
});

orderSchema.virtual('stripeCheckoutUrl').get(function() {
  if (!this.stripe.sessionId) return null;
  return `https://dashboard.stripe.com/test/payments/${this.stripe.sessionId}`;
});

// Pre-save: Set commission based on client type
orderSchema.pre('save', function(next) {
  if (this.clientType === 'REFERRAL') {
    // 🔥 FIXED: Always €400 commission
    this.commission.amount = 40000; // €400 in cents
    this.commission.status = 'pending';
  } else {
    this.commission.amount = 0;
    this.commission.status = 'pending';
  }
  
  // Update timestamps
  if (this.isModified()) {
    this.updatedAt = new Date();
  }
  
  next();
});

// Method to process commission
orderSchema.methods.processCommission = async function() {
  if (this.clientType !== 'REFERRAL' || !this.referralInfo.referredBy) {
    throw new Error('Not a referral order or no partner assigned');
  }
  
  if (this.referralInfo.commissionProcessed) {
    throw new Error('Commission already processed for this order');
  }
  
  // Create commission transaction
  const CommissionTransaction = mongoose.model('CommissionTransaction');
  await CommissionTransaction.create({
    partner: this.referralInfo.referredBy,
    order: this._id,
    amount: 40000, // €400 in cents
    type: 'EARNED',
    status: 'COMPLETED',
    description: `€400 commission for order #${this._id}`,
    metadata: {
      orderAmount: this.finalPrice,
      orderDate: this.createdAt,
      customerEmail: this.customerDetails.email
    }
  });
  
  // Update order
  this.referralInfo.commissionProcessed = true;
  this.commission.status = 'approved';
  await this.save();
  
  // Update partner's commission totals
  const Partner = mongoose.model('Partner');
  await Partner.findByIdAndUpdate(this.referralInfo.referredBy, {
    $inc: {
      'commission.earned': 40000,
      'commission.available': 40000,
      'referrals.totalSales': this.finalPrice,
      'referrals.totalOrders': 1
    },
    $addToSet: {
      'referrals.orders': this._id,
      'referrals.clients': this.client
    }
  });
  
  return this;
};

// Process commission payout via Stripe Connect
orderSchema.methods.processStripePayout = async function(stripe) {
  if (this.commission.status !== 'approved') {
    throw new Error('Commission must be approved first');
  }
  
  if (!this.referralInfo.partnerStripeAccountId) {
    throw new Error('Partner does not have Stripe Connect setup');
  }
  
  try {
    // Create transfer to partner's Stripe Connect account
    const transfer = await stripe.transfers.create({
      amount: 40000, // €400 in cents
      currency: 'eur',
      destination: this.referralInfo.partnerStripeAccountId,
      description: `Commission for order ${this._id}`,
      metadata: {
        orderId: this._id.toString(),
        partnerId: this.referralInfo.referredBy.toString(),
        commissionAmount: 400
      }
    });
    
    // Create payout transaction
    const CommissionTransaction = mongoose.model('CommissionTransaction');
    await CommissionTransaction.create({
      partner: this.referralInfo.referredBy,
      order: this._id,
      amount: 40000,
      type: 'PAID_OUT',
      status: 'COMPLETED',
      description: `Stripe payout for order #${this._id}`,
      paymentMethod: 'stripe_connect',
      transactionId: transfer.id
    });
    
    // Update order commission
    this.commission.status = 'paid';
    this.commission.paidAt = new Date();
    this.commission.paymentMethod = 'stripe_connect';
    this.commission.stripeTransferId = transfer.id;
    await this.save();
    
    // Update partner
    const Partner = mongoose.model('Partner');
    await Partner.findByIdAndUpdate(this.referralInfo.referredBy, {
      $inc: {
        'commission.paid': 40000,
        'commission.available': -40000
      }
    });
    
    return { success: true, transferId: transfer.id };
    
  } catch (error) {
    console.error('Stripe transfer error:', error);
    throw error;
  }
};

// Calculate earnings breakdown
orderSchema.methods.getEarningsBreakdown = function() {
  const priceInEuros = this.finalPrice / 100;
  
  if (this.clientType === 'DIRECT') {
    return {
      platformEarnings: priceInEuros,
      partnerEarnings: 0,
      commission: 0,
      clientPaid: priceInEuros
    };
  } else {
    return {
      platformEarnings: (this.finalPrice - 40000) / 100,
      partnerEarnings: 400,
      commission: 400,
      clientPaid: priceInEuros
    };
  }
};

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;