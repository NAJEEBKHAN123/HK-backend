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
    default: 10,
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
  availableCommission: {
    type: Number,
    default: 0
  },
  stripeAccountId: {
    type: String,
    select: false
  },
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
  totalReferralSales: {
    type: Number,
    default: 0
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner'
  }
  
},{ 
  timestamps: true,
  toJSON: { 
    virtuals: true,
    getters: true,
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.stripeAccountId;
      delete ret.__v;
      return ret;
    }
  },
  toObject: { 
    virtuals: true,
    getters: true 
  }
});

// Virtual Properties
partnerSchema.virtual('referralLink').get(function() {
  const frontendUrl = process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL_PROD 
    : process.env.FRONTEND_URL;
  return `${frontendUrl}/signup?ref=${this.referralCode}`;
});

partnerSchema.virtual('totalClientsReferred').get(function() {
  if (Array.isArray(this.clientsReferred)) {
    return this.clientsReferred.length;
  }
  return 0;
});

partnerSchema.virtual('totalOrdersReferred').get(function() {
  return this.ordersReferred?.length || 0;
});


partnerSchema.virtual('conversionRate').get(function() {
  if (!this.referralClicks || this.referralClicks === 0) return 0;
  const clientsReferred = this.totalClientsReferred;
  const rate = (clientsReferred / this.referralClicks) * 100;
  return parseFloat(rate.toFixed(2));
});

// Middleware
partnerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});


// Method to compare passwords
partnerSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to update referral stats
partnerSchema.methods.updateReferralStats = async function(order) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    this.ordersReferred.push(order._id);
    this.commissionEarned += order.partnerCommission;
    this.availableCommission += order.partnerCommission;
    this.totalReferralSales += order.finalPrice;
    
    await this.save({ session });
    await session.commitTransaction();
    
    return this;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Static method to find by referral code
partnerSchema.statics.findByReferralCode = function(code) {
  return this.findOne({ referralCode: code, status: 'active' });
};

// Indexes for better performance
partnerSchema.index({ email: 1 }, { unique: true });
partnerSchema.index({ referralCode: 1 }, { unique: true });
partnerSchema.index({ status: 1 });
partnerSchema.index({ referredBy: 1 });

const Partner = mongoose.model('Partner', partnerSchema);
module.exports = Partner; 