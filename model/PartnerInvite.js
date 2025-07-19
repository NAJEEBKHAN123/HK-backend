const mongoose = require('mongoose');

const inviteSchema = new mongoose.Schema({
  email: {
    type: String,
    required: false,
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  shortCode: String,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 10*365*24*60*60*1000) // 7 days
  },
  used: {
    type: Boolean,
    default: false
  },
  usedAt: Date
}, { timestamps: true });

module.exports = mongoose.model('PartnerInvite', inviteSchema);