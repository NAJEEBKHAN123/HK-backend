const mongoose = require('mongoose');

const commissionTransactionSchema = new mongoose.Schema({
  partner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner',
    required: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  amount: {
    type: Number, // In cents
    required: true,
    min: 0
  },
  type: {
    type: String,
    enum: ['EARNED', 'PAID_OUT', 'ADJUSTED', 'HOLD', 'HOLD_RELEASED', 'BONUS'],
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED', 'ON_HOLD', 'CANCELLED'],
    default: 'PENDING'
  },
  description: {
    type: String,
    required: true
  },
  adminNotes: String,
  paymentMethod: {
    type: String,
    enum: ['BANK_TRANSFER', 'PAYPAL', 'STRIPE_CONNECT', 'CASH', 'OTHER']
  },
  transactionId: String, // External payment reference
  balanceBefore: Number,
  balanceAfter: Number,
  metadata: mongoose.Schema.Types.Mixed,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for faster queries
commissionTransactionSchema.index({ partner: 1, createdAt: -1 });
commissionTransactionSchema.index({ order: 1 });
commissionTransactionSchema.index({ status: 1 });
commissionTransactionSchema.index({ type: 1 });

// Virtual for amount in euros
commissionTransactionSchema.virtual('amountEuros').get(function() {
  return this.amount / 100;
});

// Virtual for display
commissionTransactionSchema.virtual('displayAmount').get(function() {
  return `€${(this.amount / 100).toFixed(2)}`;
});

const CommissionTransaction = mongoose.model('CommissionTransaction', commissionTransactionSchema);

module.exports = CommissionTransaction;