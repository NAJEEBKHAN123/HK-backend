// models/CommissionTransaction.js - UPDATED
const mongoose = require('mongoose');

const commissionTransactionSchema = new mongoose.Schema({
  partner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner',
    required: true,
    index: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    index: true
  },
  amount: {
    type: Number, // In cents
    required: true,
    min: 0,
    get: v => Math.round(v),
    set: v => Math.round(v)
  },
  type: {
    type: String,
    enum: ['EARNED', 'PAID_OUT', 'ADJUSTED', 'HOLD', 'HOLD_RELEASED', 'BONUS'],
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED', 'ON_HOLD', 'CANCELLED'],
    default: 'PENDING',
    index: true
  },
  description: {
    type: String,
    required: true
  },
  referenceNumber: {
    type: String,
    unique: true,
    sparse: true
  },
  adminNotes: String,
  paymentMethod: {
    type: String,
    enum: ['BANK_TRANSFER', 'PAYPAL', 'STRIPE_CONNECT', 'CASH', 'OTHER', null],
    default: null
  },
  transactionId: String,
  balanceBefore: Number,
  balanceAfter: Number,
  metadata: mongoose.Schema.Types.Mixed,
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    getters: true 
  },
  toObject: { 
    virtuals: true,
    getters: true 
  }
});

// Indexes
commissionTransactionSchema.index({ partner: 1, createdAt: -1 });
commissionTransactionSchema.index({ status: 1 });
commissionTransactionSchema.index({ type: 1, status: 1 });

// Virtuals
commissionTransactionSchema.virtual('amountEuros').get(function() {
  return this.amount / 100;
});

commissionTransactionSchema.virtual('displayAmount').get(function() {
  return `€${(this.amount / 100).toFixed(2)}`;
});

// Pre-save middleware
commissionTransactionSchema.pre('save', function(next) {
  // Generate reference number if not exists
  if (!this.referenceNumber) {
    this.referenceNumber = `COMM-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }
  
  // Update timestamps
  if (this.isModified()) {
    this.updatedAt = new Date();
  }
  
  next();
});

// Static methods
commissionTransactionSchema.statics.getPartnerSummary = async function(partnerId) {
  const summary = await this.aggregate([
    {
      $match: {
        partner: mongoose.Types.ObjectId(partnerId),
        status: 'COMPLETED'
      }
    },
    {
      $group: {
        _id: '$type',
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ]);
  
  return summary;
};

const CommissionTransaction = mongoose.model('CommissionTransaction', commissionTransactionSchema);

module.exports = CommissionTransaction;