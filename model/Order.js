const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  // User Information
  fullName: { 
    type: String, 
    required: [true, 'Full name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Invalid email format']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  birthday: {
    type: Date,
    required: [true, 'Birthday is required'],
    validate: {
      validator: (v) => v < new Date(),
      message: 'Birthday must be in the past'
    }
  },
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true,
    maxlength: [200, 'Address cannot exceed 200 characters']
  },
  idImage: {
    type: String,
    required: [true, 'ID image URL is required']
  },

  // Order Details
  plan: {
    type: String,
    required: [true, 'Plan type is required'],
    enum: {
      values: ['STARTER', 'TURNKEY', 'PREMIUM'],
      message: 'Invalid plan type'
    },
    uppercase: true
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative']
  },

  // Payment Tracking
  stripeSessionId: {
    type: String,
    index: true
  },
  paymentIntentId: String,
  paymentMethod: String,
  transactionReference: String,

  // Status Tracking
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'cancelled', 'failed'],
    default: 'pending'
  },
   cancellationReason: {
    type: String,
    enum: ['user_cancelled', 'payment_failed', 'expired', 'abandoned', 'other'],
    default: null
  },

  // Timestamps
  paymentConfirmedAt: Date,
  cancelledAt: Date,
  failedAt: Date
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
orderSchema.index({ email: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ stripeSessionId: 1 });

module.exports = mongoose.model('Order', orderSchema);