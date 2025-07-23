const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  plan: {
    type: String,
    required: true,
    enum: ['STARTER', 'TURNKEY', 'PREMIUM']
  },
  customerDetails: {
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    phone: String,
    address: String,
    birthday: Date,
    idImage: { type: String, required: true }
  },
  originalPrice: {
    type: Number,
    required: true
  },
  finalPrice: {
    type: Number,
    required: true
  },
  partnerCommission: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  source: {
    type: String,
    enum: ['DIRECT', 'REFERRAL'],
    default: 'DIRECT'
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner',
    default: null
  },
  referralCode: {
    type: String,
    default: null
  },
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    default: null
  },
  stripeSessionId: String,
  paymentIntentId: String,
  paymentMethod: String,
  paymentConfirmedAt: Date,
  cancellationReason: String
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Pre-save hook for price calculations
orderSchema.pre('save', function(next) {
  // For referral orders, calculate final price
  if (this.source === 'REFERRAL' && this.partnerCommission > 0) {
    this.finalPrice = this.originalPrice - this.partnerCommission;
  } else {
    // For direct orders, ensure proper defaults
    this.partnerCommission = 0;
    this.finalPrice = this.originalPrice;
    this.referredBy = null;
    this.referralCode = null;
    this.source = 'DIRECT';
  }
  next();
});

// Indexes for better query performance
orderSchema.index({ client: 1 });
orderSchema.index({ referredBy: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'customerDetails.email': 1 });

module.exports = mongoose.model('Order', orderSchema);