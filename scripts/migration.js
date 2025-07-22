// Run this using: node scripts/resetReferralData.js
import mongoose from 'mongoose';
import Order from '../model/Order.js';
import Client from '../model/Client.js';
import dotenv from 'dotenv';

dotenv.config();
await mongoose.connect(process.env.MONGO_URI);

// Reset all orders
await Order.updateMany({}, {
  $set: {
    source: 'DIRECT',
    partnerCommission: 0,
    referralCode: null,
    referredBy: null
  }
});

// Remove referral fields from clients
await Client.updateMany({}, {
  $unset: {
    source: '',
    referralCode: '',
    referredBy: ''
  }
});

console.log("✅ Referral data reset");
process.exit();
