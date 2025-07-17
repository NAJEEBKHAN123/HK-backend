const express = require('express');
const router = express.Router();
const {
  createOrder,
  getOrder,
  getAllOrders,
  updateOrder,
  deleteOrder,
  handlePaymentCancel
} = require('../controller/orderController');

// Order Routes
router.post('/', createOrder);
router.get('/', getAllOrders);
router.get('/:id', getOrder);
router.delete('/:id', deleteOrder);

// Payment Handling
// router.get('/payment-cancelled', handlePaymentCancel);
// router.post('/stripe-webhook', handleStripeWebhook);

module.exports = router;