const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  plan: {
    type: String,
    required: true,
    enum: ['STARTER', 'TURNKEY', 'PREMIUM']
  },
  customerDetails: {
    fullName: String,
    email: String,
    phone: String,
    address: String,
    birthday: Date,
    idImage: String
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
    ref: 'Partner'
  },
  referralCode: String,
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client'
  },
  stripeSessionId: String,
  paymentIntentId: String,
  paymentMethod: String,
  paymentConfirmedAt: Date,
  cancellationReason: String
}, {
  timestamps: true
});

// Add indexes for better query performance
orderSchema.index({ client: 1 });
orderSchema.index({ referredBy: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ createdAt: -1 });

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;