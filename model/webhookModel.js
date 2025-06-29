const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  eventId: { type: String, required: true, index: true },
  eventName: { type: String, required: true },
  invitee: {
    name: { type: String, required: true },
    email: {
      type: String,
      required: true,
      lowercase: true,
      match: [/.+\@.+\..+/, 'Please fill a valid email address']
    },
    phone: { type: String }
  },
  guests: [{
    name: String,
    email: String
  }],
  meetingMethod: {
    type: String,
    enum: ['zoom', 'google_meet', 'phone', 'in_person', 'other'],
    required: true
  },
  locationDetails: String,
  currentStatus: {
    type: String,
    enum: ['employee', 'freelance', 'entrepreneur', 'other'],
    required: true
  },
  mainObjective: {
    type: String,
    required: true,
    maxlength: 500
  },
  businessType: {
    type: String,
    required: true
  },
  estimatedRevenue: {
    type: String,
    required: true
  },
  existingCompany: {
    type: String,
    required: true
  },
  specificQuestions: {
    type: String,
    required: true,
    maxlength: 1000
  },
  status: {
    type: String,
    enum: ['scheduled', 'completed', 'canceled'],
    default: 'scheduled'
  }
}, { timestamps: true });

module.exports = mongoose.model('Booking', bookingSchema);
