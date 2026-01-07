const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
  partner: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
  
  amount: { type: Number, required: true },
  method: { type: String, enum: ['stripe_connect', 'bank_transfer', 'paypal'], required: true },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'], default: 'pending' },
  currency: { type: String, default: 'EUR' },
  
  // Stripe Connect
  stripeTransferId: String,
  stripePayoutId: String,
  
  // Bank Transfer
  bankDetails: {
    bankName: String,
    accountName: String,
    iban: String,
    swift: String
  },
  
  // PayPal
  paypalEmail: String,
  paypalTransactionId: String,
  
  // Manual details
  transactionId: String,
  receiptUrl: String,
  
  // Timing
  requestedAt: { type: Date, default: Date.now },
  processedAt: Date,
  completedAt: Date,
  
  // Admin
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  adminNotes: String,
  failureReason: String
  
}, {
  timestamps: true
});

// Virtuals
payoutSchema.virtual('amountDisplay').get(function() {
  return `€${this.amount.toFixed(2)}`;
});

payoutSchema.virtual('statusColor').get(function() {
  const colors = {
    pending: 'yellow',
    processing: 'blue',
    completed: 'green',
    failed: 'red',
    cancelled: 'gray'
  };
  return colors[this.status] || 'gray';
});

// Methods
payoutSchema.methods.markAsProcessing = function(stripeTransferId = null) {
  this.status = 'processing';
  if (stripeTransferId) this.stripeTransferId = stripeTransferId;
  this.processedAt = new Date();
  return this.save();
};

payoutSchema.methods.markAsCompleted = function(transactionId = null, receiptUrl = null) {
  this.status = 'completed';
  this.completedAt = new Date();
  if (transactionId) this.transactionId = transactionId;
  if (receiptUrl) this.receiptUrl = receiptUrl;
  return this.save();
};

payoutSchema.methods.markAsFailed = function(reason) {
  this.status = 'failed';
  this.failureReason = reason;
  return this.save();
};

const Payout = mongoose.model('Payout', payoutSchema);
module.exports = Payout;