const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
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
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
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
      validator: function(v) {
        return v < new Date();
      },
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
    required: [true, 'ID image URL is required'],
    match: [/^https?:\/\//, 'Invalid image URL format']
  },
  plan: {
    type: String,
    required: [true, 'Plan type is required'],
    enum: {
      values: ['STARTER Pack', 'TURNKEY Pack', 'PREMIUM Pack'],
      message: 'Invalid plan type'
    }
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative']
  },
  status: {
    type: String,
    enum: ['Pending', 'Processing', 'Completed', 'Cancelled'],
    default: 'Pending'
  },
  paymentMethod: {
    type: String,
    enum: ['Bank Transfer', 'Credit Card', 'PayPal', 'Other']
  },
  paymentConfirmedAt: Date,
  transactionReference: String,
  stripeSessionId: String
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
orderSchema.index({ email: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);