const express = require('express');
const router = express.Router();
const paymentController = require('../controller/paymentController');

// Create payment session
router.post('/sessions', paymentController.createPaymentSession);

// Cancel payment session
router.post('/sessions/:orderId/cancel', paymentController.cancelPayment);

// Verify payment status
router.get('/verify/:sessionId', paymentController.verifyPayment);

// Stripe webhook
router.post('/webhook', 
  express.raw({ type: 'application/json' }), 
  paymentController.handleWebhook
);

// New download routes
router.post('/orders/:orderId/download-token', paymentController.generateDownloadToken);
router.get('/orders/:orderId/receipt', paymentController.downloadReceipt);

module.exports = router;