const express = require('express');
const router = express.Router();
const orderController = require('../controller/orderController');
const { protect, verifyAdmin } = require('../middleware/authMiddleware');

// Public routes
router.post('/', orderController.createOrder);
router.post('/webhook', express.raw({ type: 'application/json' }), orderController.handleStripeWebhook);
router.get('/:orderId/public', orderController.getPublicOrder); 

// Admin routes - REMOVED protect
router.get('/', verifyAdmin, orderController.getAllOrders);
router.patch('/:id', verifyAdmin, orderController.updateOrder);

// Protected routes (for authenticated users)
router.get('/:orderId', protect, orderController.getOrder);
router.put('/:id/cancel', protect, orderController.cancelOrder);

module.exports = router;