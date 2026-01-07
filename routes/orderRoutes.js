const express = require('express');
const router = express.Router();
const orderController = require('../controller/orderController');
const { protect, verifyAdmin } = require('../middleware/authMiddleware');

// ====================
// PUBLIC ROUTES
// ====================

// Create new order (with Stripe Checkout)
router.post('/', orderController.createOrder);

// Get public order details (for success page) - FIXED VERSION
router.get('/:orderId/public', orderController.getPublicOrder);

// Get order by session ID (for frontend to find order)
router.get('/session/:sessionId', orderController.getOrderBySession);

// Quick order lookup (debug endpoint)
router.get('/lookup/:orderId', async (req, res) => {
  try {
    const Order = require('../model/Order');
    const order = await Order.findById(req.params.orderId)
      .select('plan originalPrice status stripeSessionId customerDetails.email createdAt stripePaymentStatus')
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        exists: false,
        message: 'Order not found in database'
      });
    }

    res.json({
      success: true,
      exists: true,
      data: {
        id: order._id,
        plan: order.plan,
        price: order.originalPrice,
        status: order.status,
        stripeSessionId: order.stripeSessionId,
        stripePaymentStatus: order.stripePaymentStatus || 'pending',
        email: order.customerDetails?.email,
        createdAt: order.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ====================
// AUTO-COMPLETE ROUTES
// ====================

// Complete specific order
router.post('/complete/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await orderController.autoCompleteOrder(orderId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
    
  } catch (error) {
    console.error('Manual completion error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Complete all pending orders
router.post('/complete-all-pending', async (req, res) => {
  try {
    const Order = require('../model/Order');
    const pendingOrders = await Order.find({ status: 'pending' });
    
    console.log(`🔄 Found ${pendingOrders.length} pending orders`);
    
    const results = [];
    for (const order of pendingOrders) {
      const result = await orderController.autoCompleteOrder(order._id);
      results.push({
        orderId: order._id,
        email: order.customerDetails?.email,
        ...result
      });
      
      // Small delay to avoid overwhelming
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    const successful = results.filter(r => r.success).length;
    
    res.json({
      success: true,
      message: `Processed ${pendingOrders.length} orders, ${successful} successful`,
      total: pendingOrders.length,
      successful,
      failed: pendingOrders.length - successful,
      results
    });
    
  } catch (error) {
    console.error('Complete all error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Quick status check
router.get('/status/:orderId', async (req, res) => {
  try {
    const Order = require('../model/Order');
    const order = await Order.findById(req.params.orderId)
      .select('_id plan status stripePaymentStatus customerDetails.email createdAt');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        id: order._id,
        plan: order.plan,
        status: order.status,
        stripePaymentStatus: order.stripePaymentStatus || 'none',
        email: order.customerDetails?.email,
        createdAt: order.createdAt,
        needsCompletion: order.status !== 'completed'
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ====================
// PROTECTED ROUTES (Authenticated users)
// ====================

// Get specific order (authenticated users)
router.get('/:orderId', protect, orderController.getOrder);

// Cancel order
router.put('/:id/cancel', protect, orderController.cancelOrder);

// ====================
// ADMIN ROUTES
// ====================

// Get all orders
router.get('/', verifyAdmin, orderController.getAllOrders);

// Update order (admin only)
router.patch('/:id', verifyAdmin, orderController.updateOrder);

// Get order statistics
router.get('/stats/overview', verifyAdmin, orderController.getOrderStats);

// ====================
// STRIPE WEBHOOK
// ====================

// Stripe webhook - MUST BE RAW BODY PARSER
router.post('/webhook', 
  express.raw({type: 'application/json'}), 
  orderController.handleStripeWebhook
);

// ====================
// DEBUG/HEALTH ROUTES
// ====================

// Health check for orders
router.get('/health/check', (req, res) => {
  res.json({
    success: true,
    message: 'Orders API is working',
    timestamp: new Date().toISOString(),
    endpoints: [
      'POST / - Create order',
      'GET /:orderId/public - Public order details',
      'GET /session/:sessionId - Find order by session',
      'GET /lookup/:orderId - Quick order lookup',
      'POST /complete/:orderId - Complete order manually',
      'POST /complete-all-pending - Complete all pending orders',
      'POST /webhook - Stripe webhook endpoint'
    ]
  });
});

// Test order creation
router.post('/test/create', async (req, res) => {
  try {
    const Order = require('../model/Order');
    const testOrder = {
      plan: 'STARTER',
      originalPrice: 390000, // €3,900.00 in cents
      finalPrice: 390000,
      status: 'completed',
      source: 'DIRECT',
      customerDetails: {
        fullName: 'Test Customer',
        email: 'test@example.com',
        phone: '+33123456789',
        address: '123 Test Street, Paris',
        birthday: new Date('1990-01-01'),
        idFrontImage: 'https://example.com/id-front.jpg',
        idBackImage: 'https://example.com/id-back.jpg'
      },
      stripeSessionId: 'cs_test_' + Math.random().toString(36).substring(7),
      stripePaymentStatus: 'succeeded',
      paymentMethod: 'card',
      paymentConfirmedAt: new Date()
    };

    const order = await Order.create(testOrder);
    
    res.json({
      success: true,
      message: 'Test order created',
      orderId: order._id,
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Debug endpoint to check order status
router.get('/debug/status/:orderId', async (req, res) => {
  try {
    const Order = require('../model/Order');
    const order = await Order.findById(req.params.orderId);
    
    if (!order) {
      return res.json({ 
        exists: false,
        message: 'Order not found'
      });
    }
    
    res.json({
      exists: true,
      order: {
        id: order._id,
        status: order.status,
        stripePaymentStatus: order.stripePaymentStatus,
        stripeSessionId: order.stripeSessionId,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        price: order.originalPrice,
        plan: order.plan
      },
      webhook: {
        processed: order.stripePaymentStatus === 'succeeded',
        message: order.stripePaymentStatus === 'succeeded' 
          ? 'Webhook processed successfully' 
          : 'Waiting for webhook'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;