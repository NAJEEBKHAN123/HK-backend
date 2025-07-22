const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const partnerSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [/\S+@\S+\.\S+/, 'Please use a valid email address']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  referralCode: {
    type: String,
    unique: true,
    required: true,
    default: () => `HKP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'suspended'],
    default: 'active'
  },
  commissionRate: {
    type: Number,
    default: 10, // 10% commission
    min: 0,
    max: 100
  },
  commissionEarned: {
    type: Number,
    default: 0
  },
  commissionPaid: {
    type: Number,
    default: 0
  },
  stripeAccountId: String,
  clientsReferred: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client'
  }],
  ordersReferred: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  }],
  referralClicks: {
    type: Number,
    default: 0
  },
  lastClickIP: String,
  lastClickDate: Date
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtuals
partnerSchema.virtual('referralLink').get(function() {
  return `${process.env.FRONTEND_URL}/signup?ref=${this.referralCode}`;
});

partnerSchema.virtual('availableCommission').get(function() {
  return this.commissionEarned - this.commissionPaid;
});

partnerSchema.virtual('conversionRate').get(function() {
  if (this.referralClicks === 0) return 0;
  return ((this.clientsReferred.length / this.referralClicks) * 100).toFixed(2);
});

// Middleware
partnerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Methods
partnerSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

partnerSchema.methods.addCommission = async function(amount, orderId, clientId) {
  this.commissionEarned += amount;
  this.ordersReferred.push(orderId);
  this.clientsReferred.push(clientId);
  return this.save();
};

module.exports = mongoose.model('Partner', partnerSchema);