const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  source: {
    type: String,
    required: true,
    enum: ['DIRECT', 'REFERRAL'],
    default: 'DIRECT'
  },
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client'
  },
  plan: {
    type: String,
    required: true,
    enum: ['STARTER', 'TURNKEY', 'PREMIUM']
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
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner'
  },
  referralCode: String,
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled', 'failed'],
    default: 'pending'
  },
  customerDetails: {
    fullName: String,
    email: String,
    phone: String,
    address: String,
    birthday: Date,
    idImage: String
  },
  stripeSessionId: String,
  paymentIntentId: String,
  paymentMethod: String,
  paymentConfirmedAt: Date
}, { timestamps: true });

orderSchema.pre('save', function(next) {
  if (this.isModified('partnerCommission') || this.isModified('originalPrice')) {
    this.finalPrice = this.originalPrice - (this.partnerCommission || 0);
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);