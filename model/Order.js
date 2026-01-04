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
          return value < new Date();
        },
        message: 'Birthday must be a date in the past'
      }
    },
    idFrontImage: {
      type: String,
      required: [true, 'ID front image is required'],
      validate: {
        validator: function(value) {
          return /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/.test(value);
        },
        message: 'Invalid front image URL format'
      }
    },
    idBackImage: {
      type: String,
      required: [true, 'ID back image is required'],
      validate: {
        validator: function(value) {
          return /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/.test(value);
        },
        message: 'Invalid back image URL format'
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
  referralSource: {
    type: String,
    enum: ['DIRECT', 'PARTNER_REFERRAL', 'AFFILIATE', 'SOCIAL_MEDIA', 'OTHER'],
    default: 'DIRECT'
  },
  referralPartnerName: String,
  clientStatus: {
    type: String,
    enum: ['NEW', 'RETURNING', 'REFERRED'],
    default: 'NEW'
  },
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,

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
  commissionProcessedAt: Date
}, {
  timestamps: true
});

// Virtual for displaying referral status
orderSchema.virtual('referralStatus').get(function() {
  if (this.source === 'REFERRAL' && this.referredBy) {
    return `Referred by ${this.referralPartnerName || 'Partner'}`;
  }
  return 'Direct Client';
});

// Virtual for client status display
orderSchema.virtual('clientStatusDisplay').get(function() {
  if (this.source === 'REFERRAL') return 'Referred';
  if (this.clientStatus === 'RETURNING') return 'Returning';
  return 'New Client';
});

// Calculate final price and commission before saving
orderSchema.pre('save', async function(next) {
  if (this.source === 'REFERRAL' && this.referredBy && !this.isCommissionProcessed) {
    const Partner = mongoose.model('Partner');
    const partner = await Partner.findById(this.referredBy);
    
    if (partner) {
      const commissionRate = partner.commissionRate || 10;
      this.partnerCommission = this.originalPrice * (commissionRate / 100);
      this.finalPrice = this.originalPrice;
    }
  }
  next();
});

// Process commission after order is completed
orderSchema.post('save', async function(doc) {
  if (doc.status === 'completed' && 
      doc.source === 'REFERRAL' && 
      !doc.isCommissionProcessed &&
      doc.referredBy) {
    
    try {
      const Partner = mongoose.model('Partner');
      const partner = await Partner.findById(doc.referredBy);
      
      if (!partner) {
        return;
      }
      
      await partner.addCommission(
        doc.originalPrice,
        doc._id,
        `Commission from ${doc.plan} plan order`
      );
      
      if (doc.client && !partner.clientsReferred.includes(doc.client)) {
        partner.clientsReferred.push(doc.client);
      }
      
      if (!partner.ordersReferred.includes(doc._id)) {
        partner.ordersReferred.push(doc._id);
      }
      
      await partner.save();
      
      doc.isCommissionProcessed = true;
      doc.commissionProcessedAt = new Date();
      await doc.save();
      
    } catch (error) {
      console.error(`Error processing commission:`, error);
    }
  }
});

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;