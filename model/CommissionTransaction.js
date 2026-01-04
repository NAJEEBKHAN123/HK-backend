const mongoose = require('mongoose');

const commissionTransactionSchema = new mongoose.Schema({
  partner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner',
    required: true
  },
  
  referenceOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  
  amount: {
    type: Number,
    required: true,
    get: v => parseFloat(v.toFixed(2)),
    set: v => parseFloat(v.toFixed(2))
  },
  
  type: {
    type: String,
    enum: ['EARNED', 'PAID_OUT', 'HOLD', 'HOLD_RELEASED', 'ADJUSTED', 'BONUS', 'DEDUCTED', 'ADDED'],
    required: true
  },
  
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED'],
    default: 'COMPLETED'
  },
  
  paymentMethod: {
    type: String,
    enum: ['BANK_TRANSFER', 'PAYPAL', 'STRIPE', 'CASH', 'OTHER', null],
    default: null
  },
  
  transactionId: String,
  
  description: {
    type: String,
    required: true
  },
  
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  adminNotes: String,
  
  balanceBefore: {
    type: Number,
    get: v => parseFloat(v.toFixed(2)),
    set: v => parseFloat(v.toFixed(2))
  },
  
  balanceAfter: {
    type: Number,
    get: v => parseFloat(v.toFixed(2)),
    set: v => parseFloat(v.toFixed(2))
  },
  
  availableBefore: {
    type: Number,
    get: v => parseFloat(v.toFixed(2)),
    set: v => parseFloat(v.toFixed(2))
  },
  
  availableAfter: {
    type: Number,
    get: v => parseFloat(v.toFixed(2)),
    set: v => parseFloat(v.toFixed(2))
  },
  
  onHoldBefore: {
    type: Number,
    default: 0,
    get: v => parseFloat(v.toFixed(2)),
    set: v => parseFloat(v.toFixed(2))
  },
  
  onHoldAfter: {
    type: Number,
    default: 0,
    get: v => parseFloat(v.toFixed(2)),
    set: v => parseFloat(v.toFixed(2))
  },
  
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  referenceNumber: String,
  
  paymentDate: Date,
  
  bankDetails: {
    accountName: String,
    accountNumber: String,
    bankName: String,
    iban: String,
    swiftCode: String
  },
  
  proofOfPayment: String,
  
  notes: String
  
}, {
  timestamps: true,
  toJSON: { getters: true, virtuals: true },
  toObject: { getters: true, virtuals: true }
});

// Generate reference number before saving
commissionTransactionSchema.pre('save', function(next) {
  if (!this.referenceNumber) {
    const crypto = require('crypto');
    this.referenceNumber = `CTX-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
  }
  
  if (this.type === 'PAID_OUT' && this.status === 'COMPLETED' && !this.paymentDate) {
    this.paymentDate = new Date();
  }
  
  next();
});

// Virtual for formatted amount
commissionTransactionSchema.virtual('amountFormatted').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(this.amount);
});

// Virtual for formatted balance
commissionTransactionSchema.virtual('balanceAfterFormatted').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(this.balanceAfter);
});

// Index for better query performance
commissionTransactionSchema.index({ partner: 1, createdAt: -1 });
commissionTransactionSchema.index({ type: 1, status: 1 });
commissionTransactionSchema.index({ referenceNumber: 1 }, { unique: true });

const CommissionTransaction = mongoose.model('CommissionTransaction', commissionTransactionSchema);

module.exports = CommissionTransaction;