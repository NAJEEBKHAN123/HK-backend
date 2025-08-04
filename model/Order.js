const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  plan: {
    type: String,
    required: true,
    enum: ['STARTER', 'SMART', 'PREMIUM']
  },
 customerDetails: {
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
  },
  phone: {
    type: String,
    trim: true
  },
  address: {
    type: String,
    trim: true
  },
  birthday: {
    type: Date,
    validate: {
      validator: function(value) {
        // Validate that birthday is in the past
        return value < new Date();
      },
      message: 'Birthday must be a date in the past'
    }
  },
  idImage: {
    type: String,
    required: [true, 'ID image is required'],
    validate: {
      validator: function(value) {
        // Validate URL format for the image
        return /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/.test(value);
      },
      message: 'Invalid image URL format'
    }
  }
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
  transactionReference: String,
  adminNotes: String,
  cancellationReason: String,
  cancelledAt: Date,
  isCommissionProcessed: {
    type: Boolean,
    default: false
  },
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.partnerCommission;
      delete ret.referredBy;
      delete ret.referralCode;
      delete ret.stripeSessionId;
      delete ret.paymentIntentId;
      delete ret.isCommissionProcessed;
      delete ret.__v;
      return ret;
    }
  }
});

// Calculate final price and commission
orderSchema.pre('save', function(next) {
  if (this.source === 'REFERRAL' && this.isModified('status') && this.status === 'completed') {
    // Calculate commission based on partner's rate (default 10%)
    this.partnerCommission = this.originalPrice * 0.10;
    this.finalPrice = this.originalPrice - this.partnerCommission;
  } else if (this.source === 'DIRECT') {
    this.finalPrice = this.originalPrice;
    this.partnerCommission = 0;
  }
  next();
});

// Update partner stats after order completion
orderSchema.post('save', async function(doc) {
  if (doc.source === 'REFERRAL' && doc.status === 'completed' && !doc.isCommissionProcessed) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const partner = await Partner.findById(doc.referredBy).session(session);
      if (partner) {
        // Update partner stats
        partner.ordersReferred.push(doc._id);
        partner.commissionEarned += doc.partnerCommission;
        partner.availableCommission += doc.partnerCommission;
        partner.totalReferralSales += doc.originalPrice;
        await partner.save({ session });
        
        // Mark order as processed
        doc.isCommissionProcessed = true;
        await doc.save({ session });
      }
      
      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      console.error('Error updating partner stats:', error);
    } finally {
      session.endSession();
    }
  }
});

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;