const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');

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
    validate: [validator.isEmail, 'Invalid email'],
    lowercase: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    select: false,
    minlength: 8
  },
  referralCode: {
    type: String,
    unique: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'suspended'],
    default: 'pending'
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  joinedAt: Date
}, { timestamps: true });

// Password hashing
partnerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Generate referral code
partnerSchema.pre('save', function(next) {
  if (!this.referralCode) {
    this.referralCode = `HKP-${require('crypto').randomBytes(3).toString('hex').toUpperCase()}`;
  }
  next();
});

module.exports = mongoose.model('Partner', partnerSchema);