const express = require('express');
const router = express.Router();
const bookingController = require('../controller/webhookController');

// POST: Calendly webhook handler
router.post('/webhook', bookingController.handleWebhook);

// GET: Fetch all bookings (optional)
router.get('/', bookingController.getBookings);

module.exports = router;
